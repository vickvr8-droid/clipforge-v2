// ============================================================
// PICOS — la onda de cada material, calculada en el main (19/09/2026)
// ============================================================
// Tanda G, paso 10 de la hoja de ruta del INFORME de la linea de tiempo.
// Portado de D:\transcripcion-prototipo\picos.js (el prototipo de
// Transcripcion), que ya resolvio el problema de fondo: NO se manda el
// archivo al renderer para decodificarlo ahi (con el material real eran
// 7,66 GB contra un tope de 2 GiB de fs.readFile). ffmpeg saca el audio por
// su salida estandar, se consume a medida que llega y solo quedan los picos:
// unos 82 KB para 824 s. La memoria no depende de cuanto dure el archivo.
//
// DE QUE AUDIO SALE (la duda que dejo el critico, hallazgo 27): del propio
// archivo del material (media.ruta), su PRIMERA pista de audio, mezclada a
// mono y bajada a 16 kHz. No del audio extraido para transcribir: ese existe
// solo para el archivo principal, y la linea de tiempo tiene material de
// cualquier archivo. 16 kHz alcanza: la onda se dibuja, no se escucha.
//
// La forma del resultado es la del prototipo: min Y max por columna (una
// onda real es asimetrica), RMS, y una piramide de niveles que se van
// juntando de a dos. La base es 10 ms por columna.
//
// CACHE: proyectos/<slug>/picos/<mediaId>.json. El mediaId no cambia
// mientras el material este en el montaje, y la onda se indexa por tiempo
// de FUENTE, asi que cortar, recortar, hacer slip o roll no la recalcula.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SR = 16000;
const MS_BASE = 10;
const MUESTRAS_POR_CUBO = SR * MS_BASE / 1000;   // 160
// Si cambia el formato de lo guardado, subir esto invalida los caches
// viejos (se recalculan: son derivados, no edicion del usuario).
const FORMATO = 1;

function nivelVacio(n) {
  return { min: new Uint8Array(n), max: new Uint8Array(n), rms: new Uint8Array(n) };
}

// Junta dos columnas: min de mins, max de maxs y la raiz del promedio de
// los cuadrados. Se agrega, no se muestrea: muestrear hace parpadear los
// picos al hacer scroll.
function juntarDeADos(nivel) {
  const n = Math.floor(nivel.min.length / 2);
  if (n < 1) return null;
  const out = nivelVacio(n);
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1;
    out.min[i] = Math.min(nivel.min[a], nivel.min[b]);
    out.max[i] = Math.max(nivel.max[a], nivel.max[b]);
    out.rms[i] = Math.round(Math.sqrt((nivel.rms[a] * nivel.rms[a] + nivel.rms[b] * nivel.rms[b]) / 2));
  }
  return out;
}

function piramide(base, msBase) {
  const niveles = [{ msPorCubo: msBase, ...base }];
  let actual = base, ms = msBase;
  // Por debajo de ~1000 columnas, alejar mas no gana nada.
  while (actual.min.length > 1000) {
    const sig = juntarDeADos(actual);
    if (!sig) break;
    ms *= 2;
    niveles.push({ msPorCubo: ms, ...sig });
    actual = sig;
  }
  return niveles;
}

// Recibe PCM s16le mono en pedazos de cualquier largo (incluso impares) y
// va cerrando cubos de 10 ms. No guarda audio mas alla del cubo en curso.
function crearAcumulador() {
  const mins = [], maxs = [], rmss = [];
  let cubMin = 127, cubMax = -128, cubSuma = 0, cubN = 0;
  let sobra = null;

  const cerrarCubo = () => {
    if (!cubN) return;
    // El techo es obligatorio: 32767/256 redondea a 128 y +128 da 256, que
    // en un Uint8Array se guarda como 0: el pico mas alto se dibujaria como
    // silencio (bug medido en el prototipo).
    mins.push(Math.max(0, Math.round(cubMin) + 128));
    maxs.push(Math.min(255, Math.round(cubMax) + 128));
    rmss.push(Math.min(255, Math.round(Math.sqrt(cubSuma / cubN) * 2)));
    cubMin = 127; cubMax = -128; cubSuma = 0; cubN = 0;
  };

  return {
    agregar(chunk) {
      let buf = chunk;
      if (sobra) { buf = Buffer.concat([sobra, chunk]); sobra = null; }
      const n = buf.length >> 1;
      if (buf.length & 1) sobra = buf.subarray(buf.length - 1);
      for (let i = 0; i < n; i++) {
        const v = buf.readInt16LE(i * 2) / 256;
        if (v < cubMin) cubMin = v;
        if (v > cubMax) cubMax = v;
        cubSuma += v * v;
        if (++cubN >= MUESTRAS_POR_CUBO) cerrarCubo();
      }
    },
    columnas: () => mins.length,
    terminar() {
      cerrarCubo();
      if (!mins.length) return null;
      const base = { min: Uint8Array.from(mins), max: Uint8Array.from(maxs), rms: Uint8Array.from(rmss) };
      return { formato: FORMATO, duracion: mins.length * MS_BASE / 1000, msPorCubo: MS_BASE, niveles: piramide(base, MS_BASE) };
    }
  };
}

// Devuelve la piramide o rechaza con un mensaje legible. Un material sin
// audio resuelve null (no es un error: una foto no tiene onda).
function calcular(ruta, bin) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-nostdin', '-i', ruta, '-map', '0:a:0?',
      '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'];
    let proc;
    try { proc = spawn(bin || 'ffmpeg', args); } catch (e) {
      reject(new Error('No se pudo ejecutar ffmpeg: ' + e.message)); return;
    }
    const acc = crearAcumulador();
    let stderr = '';
    proc.stdout.on('data', (c) => acc.agregar(c));
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => reject(new Error('No se pudo ejecutar ffmpeg: ' + e.message)));
    proc.on('close', (code) => {
      const r = resultadoDeCierre(code, acc.terminar(), stderr);
      if (r.error) { reject(r.error); return; }
      resolve(r.res);
    });
  });
}

// Si ffmpeg termina con error, lo leido es PARCIAL aunque haya columnas:
// se rechaza, asi picosDeMaterial no guarda en la cache una onda cortada
// que despues se serviria para siempre.
function resultadoDeCierre(code, res, stderr) {
  if (code !== 0) {
    return { error: new Error('ffmpeg no pudo leer el audio (codigo ' + code + ').\n' + String(stderr || '').slice(-500).trim()) };
  }
  return { res };
}

// ---------- Guardado ----------
// JSON con los arreglos en base64: legible, y 82 KB de picos son ~110 KB.
function serializar(p) {
  if (!p) return JSON.stringify({ formato: FORMATO, sinAudio: true });
  return JSON.stringify({
    formato: p.formato, duracion: p.duracion, msPorCubo: p.msPorCubo,
    niveles: p.niveles.map((n) => ({
      msPorCubo: n.msPorCubo,
      min: Buffer.from(n.min).toString('base64'),
      max: Buffer.from(n.max).toString('base64'),
      rms: Buffer.from(n.rms).toString('base64')
    }))
  });
}

// Devuelve la piramide, null si se guardo "sin audio", o undefined si no
// sirve (corrupto o de otro formato): en ese caso se recalcula.
function deserializar(texto) {
  let o;
  try { o = JSON.parse(texto); } catch (e) { return undefined; }
  if (!o || o.formato !== FORMATO) return undefined;
  if (o.sinAudio) return null;
  if (!Array.isArray(o.niveles)) return undefined;
  const u8 = (s) => new Uint8Array(Buffer.from(String(s || ''), 'base64'));
  return {
    formato: o.formato, duracion: o.duracion, msPorCubo: o.msPorCubo,
    niveles: o.niveles.map((n) => ({ msPorCubo: n.msPorCubo, min: u8(n.min), max: u8(n.max), rms: u8(n.rms) }))
  };
}

// Picos de un material, con cache en disco y en memoria. Dos pedidos
// simultaneos del mismo material comparten el mismo ffmpeg.
const enCurso = new Map();
function picosDeMaterial(dirProyecto, mediaId, ruta, bin) {
  const archivo = path.join(dirProyecto, 'picos', String(mediaId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
  const clave = archivo;
  if (enCurso.has(clave)) return enCurso.get(clave);
  const tarea = (async () => {
    try {
      if (fs.existsSync(archivo)) {
        const p = deserializar(fs.readFileSync(archivo, 'utf8'));
        if (p !== undefined) return p;
      }
    } catch (e) { /* cache ilegible: se recalcula */ }
    const p = await calcular(ruta, bin);
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.writeFileSync(archivo, serializar(p));
    } catch (e) { /* sin cache se sigue igual; la proxima vez se recalcula */ }
    return p;
  })();
  enCurso.set(clave, tarea);
  tarea.finally(() => enCurso.delete(clave)).catch(() => {});
  return tarea;
}

module.exports = {
  SR, MS_BASE, FORMATO,
  crearAcumulador, piramide, calcular, resultadoDeCierre, serializar, deserializar, picosDeMaterial
};
