// exportPlan.js
//
// EL PASO QUE FALTABA: traducir todo lo que el user armo en la interfaz
// (bloques aceptados/cortados + recuadros con su tiempo propio + la
// disposicion de celdas del visor 9:16 + el recorte) a instrucciones
// concretas de ffmpeg que produzcan el short vertical final.
//
// Todo lo de este archivo son FUNCIONES PURAS sobre datos planos (mismo
// criterio que cutsBuilder.js y cropLayoutsBuilder.js): no lanza
// procesos, no toca disco, no depende de Electron. Eso permite razonar
// sobre el plan (y testearlo) sin renderizar nada, y es lo que hace
// posible el "preflight" que la UI muestra antes de exportar.
//
// ------------------------------------------------------------------
// COMO FUNCIONA EL PLAN
// ------------------------------------------------------------------
// 1. RANGOS CONSERVADOS: se parte del recorte [inicio,fin] y se le
//    restan los bloques marcados 'cut' (silencios + habla rechazada +
//    propuestas de IA ya aceptadas). El resultado es la lista de tramos
//    del video original que SI van al resultado final.
//
//    Ojo: los bloques de silencio se solapan con los de habla (asi los
//    arma buildBlocks), por eso hay que hacer aritmetica de intervalos
//    de verdad (fusionar y restar) y no simplemente sumar duraciones -
//    sumar cuenta doble el solapamiento.
//
// 2. SEGMENTOS: cada rango conservado se subdivide en los puntos donde
//    ARRANCA O TERMINA algun recuadro. Dentro de un segmento asi, el
//    conjunto de recuadros activos (y por lo tanto toda la geometria de
//    la salida) es CONSTANTE - lo que permite renderizar cada segmento
//    con un filtro fijo, sin animar nada.
//
// 3. GEOMETRIA: para cada segmento se pide el arbol de celdas de esa
//    combinacion exacta de recuadros (la misma "clave" que usa el visor
//    9:16 en la interfaz, para que lo exportado sea identico a lo que se
//    veia en pantalla), se convierten las celdas a pixeles del lienzo de
//    salida, y cada recuadro se recorta del original con la misma logica
//    "cover" que usa el canvas del preview.
//
// 4. El runner (exportRunner.js) renderiza segmento por segmento y los
//    concatena. Se eligio eso en vez de un unico filter_complex gigante
//    porque un video con muchos cortes generaria un grafo de miles de
//    nodos - fragil, imposible de depurar, y sin progreso reportable.

const { layoutPorDefecto, calcularLayout } = require('./cropLayoutsBuilder');
const { EPS, fusionar: fusionarIntervalos, restar: restarIntervalos, duracion: duracionTotal } = require('./intervalos');

const DUR_MINIMA_SEGMENTO = 0.08; // por debajo de ~2 frames no vale la pena renderizar

// ------------------------------------------------------------------
// 1. Rangos conservados
// ------------------------------------------------------------------
// 'propuesta' NO se descarta: es una sugerencia de la IA que el user
// todavia no acepto (al aceptarla pasa a 'cut', ver cortes:toggle).
function rangosConservados(blocks, trim, duracionFuente) {
  const dur = duracionFuente > 0
    ? duracionFuente
    : (blocks || []).reduce((acc, b) => Math.max(acc, b.end || 0), 0);

  let inicio = 0;
  let fin = dur;
  if (trim && trim.fin > trim.inicio) {
    inicio = Math.max(0, trim.inicio);
    fin = Math.min(dur || trim.fin, trim.fin);
  }
  if (!(fin > inicio)) return [];

  const cortes = (blocks || [])
    .filter((b) => b.status === 'cut')
    .map((b) => [Math.max(0, b.start || 0), Math.max(0, b.end || 0)]);

  return restarIntervalos([[inicio, fin]], cortes);
}

// ------------------------------------------------------------------
// 2. Segmentacion por cambios de recuadros activos
// ------------------------------------------------------------------

function clipsActivosEn(clips, t) {
  return (clips || [])
    .filter((c) => t >= c.start - EPS && t < c.end - EPS)
    .sort((a, b) => a.track - b.track);
}

// Misma clave que arma el renderer para el visor 9:16: ids de los
// recuadros activos ordenados ALFABETICAMENTE y unidos con "," (mientras
// que el ORDEN DE LAS CELDAS va por track). Respetar las dos cosas es lo
// que garantiza que el export use exactamente la disposicion que el user
// dejo guardada para esa combinacion.
function claveCombinacion(clipsActivos) {
  return clipsActivos.map((c) => c.id).sort().join(',');
}

function puntosDeCorte(clips, desde, hasta) {
  const puntos = new Set([desde, hasta]);
  for (const c of clips || []) {
    if (c.start > desde + EPS && c.start < hasta - EPS) puntos.add(c.start);
    if (c.end > desde + EPS && c.end < hasta - EPS) puntos.add(c.end);
  }
  return [...puntos].sort((a, b) => a - b);
}

// ------------------------------------------------------------------
// 3. Geometria
// ------------------------------------------------------------------

// ffmpeg necesita enteros, y yuv420p necesita ancho/alto PARES en cada
// stream intermedio. Se redondea hacia arriba al par mas cercano: si
// sobra un pixel preferimos un solape invisible entre celdas vecinas
// antes que una costura negra de 1px.
function aPar(n) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

// Recorte "cover": misma matematica que dibujarCanvas916() en el
// renderer (object-fit: cover hecho a mano). Replicarla es lo que hace
// que el archivo exportado calce pixel a pixel con el preview.
function recorteCover(clip, fuente, destW, destH) {
  const sx = clip.xPct * fuente.ancho;
  const sy = clip.yPct * fuente.alto;
  const sw = Math.max(1, clip.wPct * fuente.ancho);
  const sh = Math.max(1, clip.hPct * fuente.alto);

  const destAspect = destW / destH;
  const srcAspect = sw / sh;
  let csx = sx, csy = sy, csw = sw, csh = sh;
  if (srcAspect > destAspect) {
    const nuevoSw = sh * destAspect;
    csx = sx + (sw - nuevoSw) / 2;
    csw = nuevoSw;
  } else {
    const nuevoSh = sw / destAspect;
    csy = sy + (sh - nuevoSh) / 2;
    csh = nuevoSh;
  }

  // Clampear dentro del frame real: un recuadro dibujado justo en el
  // borde puede dar coordenadas fraccionarias que se salgan por 1px, y
  // ffmpeg aborta el render entero con "Invalid too big or non positive
  // size for width/height".
  let w = aPar(Math.min(csw, fuente.ancho));
  let h = aPar(Math.min(csh, fuente.alto));
  let x = Math.round(Math.max(0, Math.min(csx, fuente.ancho - w)));
  let y = Math.round(Math.max(0, Math.min(csy, fuente.alto - h)));
  return { x, y, w, h };
}

// Recorte 9:16 centrado, para los tramos conservados que no tienen
// ningun recuadro definido (opcion 'centrar'). Sin esto, esos tramos
// saldrian en negro y el user no entenderia por que.
function recorteCentrado(fuente, destW, destH) {
  const destAspect = destW / destH;
  let w = fuente.alto * destAspect;
  let h = fuente.alto;
  if (w > fuente.ancho) {
    w = fuente.ancho;
    h = fuente.ancho / destAspect;
  }
  const wp = aPar(Math.min(w, fuente.ancho));
  const hp = aPar(Math.min(h, fuente.alto));
  return {
    x: Math.round(Math.max(0, (fuente.ancho - wp) / 2)),
    y: Math.round(Math.max(0, (fuente.alto - hp) / 2)),
    w: wp,
    h: hp
  };
}

// Celdas del arbol (fracciones 0..1) -> rectangulos en pixeles del
// lienzo de salida, ya pares y clampeados adentro del lienzo.
function celdasAPixeles(celdas, destW, destH) {
  return celdas.map((celda) => {
    const w = aPar(celda.w * destW);
    const h = aPar(celda.h * destH);
    const x = Math.round(Math.max(0, Math.min(celda.x * destW, destW - w)));
    const y = Math.round(Math.max(0, Math.min(celda.y * destH, destH - h)));
    return { pos: celda.pos, x, y, w, h, libre: !!celda.libre };
  });
}

// ------------------------------------------------------------------
// Plan completo
// ------------------------------------------------------------------

const OPCIONES_DEFAULT = {
  ancho: 1080,
  alto: 1920,
  fps: 0,                 // 0 = heredar del original
  crf: 20,
  preset: 'medium',
  bitrateAudio: '192k',
  sinRecuadro: 'centrar', // 'centrar' | 'omitir'
  quemarSubtitulos: false
};

function planificarExportacion({ blocks, clips, cellLayouts, trim, fuente, opciones }) {
  const opts = { ...OPCIONES_DEFAULT, ...(opciones || {}) };
  const destW = aPar(opts.ancho);
  const destH = aPar(opts.alto);
  const fps = opts.fps > 0 ? opts.fps : (fuente.fps > 0 ? fuente.fps : 30);
  const avisos = [];

  if (!fuente.tieneVideo || !fuente.ancho || !fuente.alto) {
    return { ok: false, error: 'El archivo de entrada no tiene un stream de video utilizable.' };
  }

  const conservados = rangosConservados(blocks, trim, fuente.duracion);
  if (!conservados.length) {
    return {
      ok: false,
      error: 'No queda nada por exportar: todos los bloques del rango elegido estan marcados para cortar.'
    };
  }

  const segmentos = [];
  let salidaCursor = 0;
  let descartadosPorCortos = 0;
  let tramosSinRecuadro = 0;

  for (const [rangoIni, rangoFin] of conservados) {
    const puntos = puntosDeCorte(clips, rangoIni, rangoFin);
    for (let i = 0; i < puntos.length - 1; i++) {
      const srcStart = puntos[i];
      const srcEnd = puntos[i + 1];
      const dur = srcEnd - srcStart;
      if (dur < DUR_MINIMA_SEGMENTO) { descartadosPorCortos++; continue; }

      // Se evalua en el MEDIO del segmento: en los bordes exactos el
      // resultado depende de como redondee el flotante y podria tomar
      // los recuadros del segmento vecino.
      const medio = srcStart + dur / 2;
      const activos = clipsActivosEn(clips, medio);

      if (!activos.length) {
        tramosSinRecuadro++;
        if (opts.sinRecuadro === 'omitir') continue;
        segmentos.push({
          indice: segmentos.length,
          modo: 'centrado',
          srcStart, srcEnd, dur,
          salidaStart: salidaCursor,
          salidaEnd: salidaCursor + dur,
          clave: '',
          fuentes: [{ clipId: null, recorte: recorteCentrado(fuente, destW, destH), destino: { x: 0, y: 0, w: destW, h: destH } }]
        });
        salidaCursor += dur;
        continue;
      }

      const clave = claveCombinacion(activos);
      const arbol = (cellLayouts && cellLayouts[clave]) || layoutPorDefecto(activos.length, 'vertical');
      const { celdas } = calcularLayout(arbol);
      const enPixeles = celdasAPixeles(celdas, destW, destH);

      const fuentes = [];
      for (const celda of enPixeles) {
        const clip = activos[celda.pos];
        if (!clip) continue; // arbol desincronizado con la cantidad de recuadros
        fuentes.push({
          clipId: clip.id,
          recorte: recorteCover(clip, fuente, celda.w, celda.h),
          destino: { x: celda.x, y: celda.y, w: celda.w, h: celda.h }
        });
      }
      if (!fuentes.length) { descartadosPorCortos++; continue; }

      segmentos.push({
        indice: segmentos.length,
        modo: 'recuadros',
        srcStart, srcEnd, dur,
        salidaStart: salidaCursor,
        salidaEnd: salidaCursor + dur,
        clave,
        fuentes
      });
      salidaCursor += dur;
    }
  }

  if (!segmentos.length) {
    return {
      ok: false,
      error: opts.sinRecuadro === 'omitir'
        ? 'Con la opcion "omitir tramos sin recuadro" no queda ningun tramo con recuadros para exportar.'
        : 'No se pudo armar ningun segmento exportable.'
    };
  }

  if (tramosSinRecuadro > 0 && opts.sinRecuadro === 'centrar') {
    avisos.push(`${tramosSinRecuadro} tramo(s) conservado(s) no tienen recuadro: se exportan con un recorte 9:16 centrado.`);
  }
  if (descartadosPorCortos > 0) {
    avisos.push(`${descartadosPorCortos} tramo(s) de menos de ${DUR_MINIMA_SEGMENTO}s se descartaron por ser demasiado breves.`);
  }
  if (!fuente.tieneAudio) {
    avisos.push('El archivo de entrada no tiene pista de audio: el resultado sale sin sonido.');
  }
  if (segmentos.length > 400) {
    avisos.push(`El plan tiene ${segmentos.length} segmentos: el render va a tardar bastante.`);
  }

  return {
    ok: true,
    opciones: { ...opts, ancho: destW, alto: destH, fps },
    fuente,
    conservados,
    segmentos,
    duracionOriginal: fuente.duracion,
    duracionSalida: salidaCursor,
    duracionConservada: duracionTotal(conservados),
    avisos
  };
}

// ------------------------------------------------------------------
// filter_complex + argumentos de ffmpeg para UN segmento
// ------------------------------------------------------------------
// Un segmento = un archivo intermedio. El grafo es siempre el mismo
// esqueleto: lienzo negro del tamaño de salida + una cadena crop/scale
// por recuadro + un overlay por recuadro encima del lienzo.

function filtroSegmento(seg, opciones) {
  const { ancho, alto, fps } = opciones;

  // Caso 1 sola fuente que ocupa todo el lienzo: se puede resolver sin
  // lienzo ni overlay, un crop+scale directo (mas rapido y menos nodos).
  if (seg.fuentes.length === 1) {
    const f = seg.fuentes[0];
    const cubreTodo = f.destino.x === 0 && f.destino.y === 0 && f.destino.w === ancho && f.destino.h === alto;
    if (cubreTodo) {
      return `[0:v]crop=${f.recorte.w}:${f.recorte.h}:${f.recorte.x}:${f.recorte.y},` +
             `scale=${ancho}:${alto}:flags=lanczos,setsar=1,format=yuv420p[vout]`;
    }
  }

  const partes = [];
  partes.push(`color=c=black:s=${ancho}x${alto}:r=${fps}:d=${seg.dur.toFixed(3)}[base]`);
  seg.fuentes.forEach((f, i) => {
    partes.push(
      `[0:v]crop=${f.recorte.w}:${f.recorte.h}:${f.recorte.x}:${f.recorte.y},` +
      `scale=${f.destino.w}:${f.destino.h}:flags=lanczos,setsar=1[v${i}]`
    );
  });
  let entrada = 'base';
  seg.fuentes.forEach((f, i) => {
    const salida = i === seg.fuentes.length - 1 ? 'mezcla' : `o${i}`;
    // shortest=1 en el primer overlay corta la duracion contra el video
    // real y evita que el lienzo "color" (infinito por naturaleza) alargue
    // el segmento si el -t cayera un frame mas largo.
    const extra = i === 0 ? ':shortest=1' : '';
    partes.push(`[${entrada}][v${i}]overlay=${f.destino.x}:${f.destino.y}${extra}[${salida}]`);
    entrada = salida;
  });
  partes.push(`[${entrada}]format=yuv420p[vout]`);
  return partes.join(';');
}

// nombreSalida es RELATIVO: el runner lanza ffmpeg con cwd en la carpeta
// temporal, lo que evita todo el infierno de escapar rutas de Windows
// (dos puntos, backslashes, espacios) dentro de los filtros.
function argsSegmento(seg, inputPath, opciones, nombreSalida, tieneAudio) {
  const { fps, crf, preset, bitrateAudio } = opciones;
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-ss', seg.srcStart.toFixed(3),
    '-t', seg.dur.toFixed(3),
    '-i', inputPath,
    '-filter_complex', filtroSegmento(seg, opciones),
    '-map', '[vout]'
  ];
  if (tieneAudio) {
    args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', bitrateAudio, '-ar', '48000', '-ac', '2');
  } else {
    args.push('-an');
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-video_track_timescale', '90000',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    nombreSalida
  );
  return args;
}

// Pase final: pegar todos los intermedios. Sin subtitulos quemados es
// una copia de streams (instantanea, sin recomprimir); con subtitulos
// hay que recodificar el video una vez (el audio se sigue copiando).
function argsConcat(nombreLista, nombreSalida, opciones, nombreSrt) {
  const args = ['-hide_banner', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', nombreLista];
  if (opciones.quemarSubtitulos && nombreSrt) {
    const estilo = 'FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,' +
                   'BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=90';
    args.push(
      '-vf', `subtitles=${nombreSrt}:force_style='${estilo}'`,
      '-c:v', 'libx264', '-preset', opciones.preset, '-crf', String(opciones.crf),
      '-pix_fmt', 'yuv420p', '-c:a', 'copy'
    );
  } else {
    args.push('-c', 'copy');
  }
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', nombreSalida);
  return args;
}

// ------------------------------------------------------------------
// Subtitulos remapeados al tiempo de SALIDA
// ------------------------------------------------------------------
// BUG QUE ARREGLA: blocksToSrt() (cutsBuilder.js) escribe los tiempos
// del video ORIGINAL. Apenas se corta un solo silencio, ese SRT queda
// corrido respecto del video exportado y los subtitulos no coinciden con
// lo que se escucha. Aca cada bloque conservado se parte segun los
// segmentos del plan y se traslada al eje de tiempo del resultado.

function fmtSrtTime(t) {
  const seg = Math.max(0, t);
  const h = String(Math.floor(seg / 3600)).padStart(2, '0');
  const m = String(Math.floor((seg % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seg % 60)).padStart(2, '0');
  const ms = String(Math.round((seg - Math.floor(seg)) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

function srtDeSalida(blocks, segmentos) {
  const cues = [];
  const habla = (blocks || []).filter(
    (b) => b.type === 'speech' && b.status !== 'cut' && (b.text || '').trim()
  );
  for (const b of habla) {
    for (const seg of segmentos) {
      const ini = Math.max(b.start, seg.srcStart);
      const fin = Math.min(b.end, seg.srcEnd);
      if (fin - ini <= 0.05) continue;
      cues.push({
        inicio: seg.salidaStart + (ini - seg.srcStart),
        fin: seg.salidaStart + (fin - seg.srcStart),
        texto: b.text.trim()
      });
    }
  }
  cues.sort((a, b) => a.inicio - b.inicio);
  return cues
    .map((c, i) => `${i + 1}\n${fmtSrtTime(c.inicio)} --> ${fmtSrtTime(c.fin)}\n${c.texto}\n`)
    .join('\n');
}

module.exports = {
  OPCIONES_DEFAULT,
  DUR_MINIMA_SEGMENTO,
  fusionarIntervalos,
  restarIntervalos,
  duracionTotal,
  rangosConservados,
  clipsActivosEn,
  claveCombinacion,
  aPar,
  recorteCover,
  recorteCentrado,
  celdasAPixeles,
  planificarExportacion,
  filtroSegmento,
  argsSegmento,
  argsConcat,
  srtDeSalida
};
