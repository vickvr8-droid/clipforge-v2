// exportRunner.js
//
// Ejecuta el plan que arma exportPlan.js: renderiza cada segmento a un
// archivo intermedio en una carpeta temporal, los concatena, y limpia.
// Reporta progreso hacia la interfaz y se puede cancelar a mitad.
//
// POR QUE SEGMENTO POR SEGMENTO Y NO UN SOLO COMANDO:
// - Un video con 200 cortes generaria un filter_complex con miles de
//   nodos; en la practica ffmpeg se vuelve lentisimo o directamente
//   falla, y si falla no hay forma humana de saber en que parte.
// - Renderizando de a uno hay progreso real ("segmento 12 de 87"), el
//   error se puede atribuir al segmento exacto que lo causo, y cancelar
//   es matar un proceso chico en vez de tirar horas de trabajo.
// - El pase final es un concat con copia de streams: no recomprime nada,
//   asi que no se pierde calidad por hacerlo en dos etapas.
//
// DETALLE IMPORTANTE: ffmpeg se lanza con cwd en la carpeta temporal y
// todos los nombres (segmentos, lista de concat, .srt) son RELATIVOS. Eso
// esquiva por completo el escapado de rutas de Windows dentro de los
// filtros de ffmpeg (los dos puntos de "C:" y los backslashes rompen la
// sintaxis de filtros como subtitles= y hay que escaparlos a mano).

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ffmpegPath, binarioDisponible, errorBinarioFaltante } = require('./settingsStore');
const { argsSegmento, argsConcat, srtDeSalida } = require('./exportPlan');

const PESO_RENDER = 0.9; // el 90% del progreso es renderizar segmentos, el 10% final es el concat

// Estado del render en curso. Uno a la vez a proposito: dos exports
// simultaneos competirian por CPU y por la misma carpeta temporal, y no
// hay ningun caso de uso real que lo pida.
let enCurso = null;

function hayExportEnCurso() {
  return !!enCurso;
}

// "00:01:23.45" -> 83.45
function parsearOutTime(txt) {
  const m = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(txt);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function crearCarpetaTemporal(inputPath) {
  const hash = crypto.createHash('md5').update(inputPath + Date.now()).digest('hex').slice(0, 10);
  const dir = path.join(os.tmpdir(), `clipforge-export-${hash}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function limpiarCarpeta(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error('[export] no se pudo limpiar la carpeta temporal:', e.message);
  }
}

// Corre UN ffmpeg y resuelve cuando termina. onTiempo recibe los segundos
// ya procesados del stream de salida (para el progreso fino dentro del
// segmento). Guarda las ultimas lineas de stderr para poder explicar un
// fallo con algo mas util que "codigo 1".
function correrFfmpeg(args, cwd, onTiempo) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!binarioDisponible(bin)) {
      reject(errorBinarioFaltante('ffmpeg', bin, 'CLIPFORGE_FFMPEG'));
      return;
    }
    const proc = spawn(bin, args, { cwd });
    if (enCurso) enCurso.proc = proc;

    let colaStderr = '';
    proc.stdout.on('data', (d) => {
      const txt = d.toString();
      const t = parsearOutTime(txt);
      if (t != null && onTiempo) onTiempo(t);
    });
    proc.stderr.on('data', (d) => {
      colaStderr = (colaStderr + d.toString()).slice(-4000);
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code, signal) => {
      if (enCurso) enCurso.proc = null;
      if (enCurso && enCurso.cancelado) {
        reject(Object.assign(new Error('Exportacion cancelada.'), { cancelado: true }));
        return;
      }
      if (code === 0) { resolve(); return; }
      reject(new Error(
        `ffmpeg fallo (codigo ${code}${signal ? `, señal ${signal}` : ''}).\n` +
        `Comando: ffmpeg ${args.join(' ')}\n${colaStderr.slice(-1500)}`
      ));
    });
  });
}

// Nombre de archivo de salida por defecto: <video>.short.mp4 junto al
// original, o en la carpeta que el user haya configurado. Si ya existe,
// se numera para no pisar un export anterior sin avisar.
function rutaSalidaPorDefecto(inputPath, carpetaSalida) {
  const dir = carpetaSalida && carpetaSalida.trim() ? carpetaSalida.trim() : path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  let candidato = path.join(dir, `${base}.short.mp4`);
  let n = 2;
  while (fs.existsSync(candidato)) {
    candidato = path.join(dir, `${base}.short.${n}.mp4`);
    n++;
  }
  return candidato;
}

function cancelar() {
  if (!enCurso) return false;
  enCurso.cancelado = true;
  if (enCurso.proc) {
    try {
      // SIGKILL directo: ffmpeg con SIGTERM intenta cerrar el contenedor
      // prolijamente y puede quedarse colgado si el archivo intermedio
      // esta a medias - de todas formas se descarta.
      enCurso.proc.kill('SIGKILL');
    } catch (e) { /* ya termino */ }
  }
  return true;
}

// plan: lo que devuelve planificarExportacion() (ok:true)
// onProgress({ fase, segmentoActual, totalSegmentos, porcentaje, mensaje })
async function ejecutar({ plan, inputPath, blocks, outputPath, onProgress }) {
  if (enCurso) throw new Error('Ya hay una exportacion en curso.');

  const salida = outputPath || rutaSalidaPorDefecto(inputPath, plan.opciones.carpetaSalida);
  const dirTemp = crearCarpetaTemporal(inputPath);
  enCurso = { cancelado: false, proc: null, dirTemp };

  const avisar = (datos) => { if (onProgress) onProgress(datos); };
  const total = plan.segmentos.length;
  const duracionSalida = plan.duracionSalida || 1;

  try {
    fs.mkdirSync(path.dirname(salida), { recursive: true });

    // El SRT remapeado se genera siempre: si se quema, ffmpeg lo lee de
    // aca; si no, se copia igual junto al video como archivo suelto para
    // poder subirlo por separado (YouTube/Instagram lo aceptan asi).
    const nombreSrt = 'subs.srt';
    const contenidoSrt = srtDeSalida(blocks, plan.segmentos);
    if (contenidoSrt.trim()) {
      fs.writeFileSync(path.join(dirTemp, nombreSrt), contenidoSrt, 'utf-8');
    }

    // --- Fase 1: renderizar cada segmento ---
    const nombres = [];
    let acumulado = 0;
    for (let i = 0; i < total; i++) {
      if (enCurso.cancelado) throw Object.assign(new Error('Exportacion cancelada.'), { cancelado: true });
      const seg = plan.segmentos[i];
      const nombre = `seg_${String(i).padStart(4, '0')}.mp4`;
      const args = argsSegmento(seg, inputPath, plan.opciones, nombre, plan.fuente.tieneAudio);

      avisar({
        fase: 'render',
        segmentoActual: i + 1,
        totalSegmentos: total,
        porcentaje: Math.round((acumulado / duracionSalida) * PESO_RENDER * 100),
        mensaje: `Renderizando segmento ${i + 1} de ${total}`
      });

      await correrFfmpeg(args, dirTemp, (tSeg) => {
        const pct = ((acumulado + Math.min(tSeg, seg.dur)) / duracionSalida) * PESO_RENDER * 100;
        avisar({
          fase: 'render',
          segmentoActual: i + 1,
          totalSegmentos: total,
          porcentaje: Math.min(Math.round(PESO_RENDER * 100), Math.round(pct)),
          mensaje: `Renderizando segmento ${i + 1} de ${total}`
        });
      });

      acumulado += seg.dur;
      nombres.push(nombre);
    }

    // --- Fase 2: concatenar ---
    // Los nombres son relativos y sin comillas simples por construccion
    // (seg_0001.mp4), asi que la lista de concat no necesita escapado.
    const nombreLista = 'lista.txt';
    fs.writeFileSync(
      path.join(dirTemp, nombreLista),
      nombres.map((n) => `file '${n}'`).join('\n') + '\n',
      'utf-8'
    );

    avisar({
      fase: 'concat',
      segmentoActual: total,
      totalSegmentos: total,
      porcentaje: Math.round(PESO_RENDER * 100),
      mensaje: plan.opciones.quemarSubtitulos
        ? 'Uniendo segmentos y quemando subtitulos'
        : 'Uniendo segmentos'
    });

    const hayCues = contenidoSrt.trim().length > 0;
    const nombreFinal = 'final.mp4';
    await correrFfmpeg(
      argsConcat(nombreLista, nombreFinal, plan.opciones, hayCues ? nombreSrt : null),
      dirTemp,
      (t) => {
        const pct = PESO_RENDER * 100 + (Math.min(t, duracionSalida) / duracionSalida) * (1 - PESO_RENDER) * 100;
        avisar({
          fase: 'concat',
          segmentoActual: total,
          totalSegmentos: total,
          porcentaje: Math.min(99, Math.round(pct)),
          mensaje: 'Uniendo segmentos'
        });
      }
    );

    // Mover el resultado a su destino. copyFile+unlink en vez de rename
    // porque la carpeta temporal del sistema suele estar en otro volumen
    // que el video del user, y rename entre volumenes tira EXDEV.
    fs.copyFileSync(path.join(dirTemp, nombreFinal), salida);

    // El .srt suelto acompaña al video exportado (util incluso si se
    // quemaron los subtitulos: sirve para las plataformas que los piden
    // como archivo aparte).
    let rutaSrt = null;
    if (hayCues) {
      rutaSrt = salida.replace(/\.mp4$/i, '') + '.srt';
      fs.copyFileSync(path.join(dirTemp, nombreSrt), rutaSrt);
    }

    avisar({ fase: 'listo', segmentoActual: total, totalSegmentos: total, porcentaje: 100, mensaje: 'Exportacion terminada' });
    return { ok: true, path: salida, srtPath: rutaSrt, segmentos: total, duracionSalida: plan.duracionSalida };
  } catch (err) {
    if (err && err.cancelado) {
      avisar({ fase: 'cancelado', porcentaje: 0, mensaje: 'Exportacion cancelada' });
      return { ok: false, cancelado: true, error: 'Exportacion cancelada.' };
    }
    avisar({ fase: 'error', porcentaje: 0, mensaje: err.message });
    return { ok: false, error: err.message };
  } finally {
    limpiarCarpeta(dirTemp);
    enCurso = null;
  }
}

module.exports = { ejecutar, cancelar, hayExportEnCurso, rutaSalidaPorDefecto };
