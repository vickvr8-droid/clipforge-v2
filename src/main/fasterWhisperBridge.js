// Motor alternativo: faster-whisper local.
// Mismo patron que whisperxBridge.js, pero usa el venv de
// audio-ai-tools (no el de whisperx-tool) y el script nuevo
// transcribe_fasterwhisper.py (regla 13: no se toco transcribe_large.py
// original, que tiene rutas de salida fijas propias).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const FASTERWHISPER_PYTHON = 'C:\\Users\\vicente\\audio-ai-tools\\venv\\Scripts\\python.exe';
const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python-backend', 'transcribe_fasterwhisper.py');

function transcribeFasterWhisper(inputPath, outJsonPath, onProgress) {
  return new Promise((resolve, reject) => {
    const progressPath = outJsonPath + '.progress.json';
    const proc = spawn(FASTERWHISPER_PYTHON, [TRANSCRIBE_SCRIPT, inputPath, outJsonPath]);

    const progressInterval = setInterval(() => {
      if (fs.existsSync(progressPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
          if (onProgress) onProgress(data);
        } catch (e) { /* archivo a medio escribir, ignorar */ }
      }
    }, 1000);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearInterval(progressInterval);
      if (code === 0 && fs.existsSync(outJsonPath)) {
        resolve(JSON.parse(fs.readFileSync(outJsonPath, 'utf-8')));
      } else {
        reject(new Error(`Transcripcion (faster-whisper) fallo (codigo ${code}): ${stderr.slice(-2000)}`));
      }
    });

    proc.on('error', (err) => {
      clearInterval(progressInterval);
      reject(err);
    });
  });
}

module.exports = { transcribeFasterWhisper };
