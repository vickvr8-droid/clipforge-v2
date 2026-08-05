// Corre el script de transcripcion con el python del venv de
// WhisperX ya existente (no el python del sistema).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const WHISPERX_PYTHON = 'C:\\Users\\vicente\\remotion-projects\\whisperx-tool\\.venv\\Scripts\\python.exe';
const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python-backend', 'transcribe_whisperx.py');

function transcribeWhisperX(inputPath, outJsonPath, onProgress) {
  return new Promise((resolve, reject) => {
    const progressPath = outJsonPath + '.progress.json';
    const proc = spawn(WHISPERX_PYTHON, [TRANSCRIBE_SCRIPT, inputPath, outJsonPath]);

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
        reject(new Error(`Transcripcion fallo (codigo ${code}): ${stderr.slice(-2000)}`));
      }
    });

    proc.on('error', (err) => {
      clearInterval(progressInterval);
      reject(err);
    });
  });
}

module.exports = { transcribeWhisperX };
