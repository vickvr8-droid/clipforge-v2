// Deteccion de silencios via ffmpeg (filtro silencedetect), llamado
// directo desde Node (ffmpeg ya esta en PATH, instalado via WinGet -
// ver CTX_MAESTRO seccion 3). No depende de ningun venv de Python.
// Equivalente en JS al script standalone python-backend/detect_silences.py
// (ese se deja como alternativa para correr manual fuera de la app).

const { spawn } = require('child_process');

function detectSilences(inputPath, { noiseDb = -30, minDur = 0.35 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`,
      '-f', 'null', '-'
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', () => {
      const starts = [...stderr.matchAll(/silence_start:\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]));
      const endRe = /silence_end:\s*([-\d.]+)\s*\|\s*silence_duration:\s*([-\d.]+)/g;
      const ends = [...stderr.matchAll(endRe)].map((m) => ({ end: parseFloat(m[1]), duration: parseFloat(m[2]) }));

      const silences = starts.map((start, i) => {
        const e = ends[i] || {};
        return {
          start: Math.round(start * 100) / 100,
          end: e.end != null ? Math.round(e.end * 100) / 100 : null,
          duration: e.duration != null ? Math.round(e.duration * 100) / 100 : null
        };
      }).filter((s) => s.end != null);

      resolve(silences);
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = { detectSilences };
