// Motor WhisperX (local, timestamps por palabra).
// Toda la mecanica del spawn/progreso/errores vive en pythonBridge.js -
// aca solo queda cual interprete y cual script usar.

const path = require('path');
const { transcribir } = require('./pythonBridge');
const { pythonWhisperXPath, ENV_MAP } = require('./settingsStore');

const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python-backend', 'transcribe_whisperx.py');

function transcribeWhisperX(inputPath, outJsonPath, onProgress) {
  return transcribir({
    etiqueta: 'WhisperX',
    pythonPath: pythonWhisperXPath(),
    envVar: ENV_MAP.pythonWhisperX,
    script: TRANSCRIBE_SCRIPT,
    inputPath,
    outJsonPath,
    onProgress
  });
}

module.exports = { transcribeWhisperX };
