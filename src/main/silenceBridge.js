// Deteccion de silencios via ffmpeg (filtro silencedetect), llamado
// directo desde Node. Equivalente en JS al script standalone
// python-backend/detect_silences.py (ese se deja como alternativa para
// correr a mano fuera de la app).
//
// CAMBIOS 04/08/2026:
// - La ruta de ffmpeg sale de settingsStore (configurable) en vez de
//   asumir que esta en el PATH; si falta, el error dice que configurar.
// - Se arregla el silencio FINAL: silencedetect emite "silence_start" sin
//   su "silence_end" cuando el video termina en silencio. El codigo
//   viejo filtraba ese caso (end == null) y lo perdia, justo el silencio
//   mas comun de recortar - el "cola" muerta al final de una grabacion.
//   Ahora se cierra contra la duracion real del archivo.
// - Umbral y duracion minima configurables desde el llamador.

const { spawn } = require('child_process');
const { ffmpegPath, binarioDisponible, errorBinarioFaltante } = require('./settingsStore');

function detectSilences(inputPath, { noiseDb = -30, minDur = 0.35, duracionTotal = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!binarioDisponible(bin)) {
      reject(errorBinarioFaltante('ffmpeg', bin, 'CLIPFORGE_FFMPEG'));
      return;
    }

    const args = [
      '-hide_banner', '-nostdin',
      '-i', inputPath,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`,
      '-f', 'null', '-'
    ];
    const proc = spawn(bin, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', () => {
      const starts = [...stderr.matchAll(/silence_start:\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]));
      const endRe = /silence_end:\s*([-\d.]+)\s*\|\s*silence_duration:\s*([-\d.]+)/g;
      const ends = [...stderr.matchAll(endRe)].map((m) => ({ end: parseFloat(m[1]), duration: parseFloat(m[2]) }));

      const silences = starts.map((start, i) => {
        const e = ends[i];
        if (e) {
          return {
            start: Math.round(start * 100) / 100,
            end: Math.round(e.end * 100) / 100,
            duration: Math.round(e.duration * 100) / 100
          };
        }
        // Silencio abierto al final del archivo: solo se puede cerrar si
        // sabemos cuanto dura el video. Sin ese dato se descarta (mismo
        // comportamiento que antes) para no inventar un fin arbitrario.
        if (duracionTotal > start + minDur) {
          return {
            start: Math.round(start * 100) / 100,
            end: Math.round(duracionTotal * 100) / 100,
            duration: Math.round((duracionTotal - start) * 100) / 100
          };
        }
        return null;
      }).filter(Boolean);

      resolve(silences);
    });

    proc.on('error', (err) => reject(new Error(`No se pudo ejecutar ffmpeg (${bin}): ${err.message}`)));
  });
}

module.exports = { detectSilences };
