// Motor alternativo: faster-whisper local (mas rapido, sin alineacion
// por palabra). Usa su propio venv, distinto al de WhisperX.
// Regla 13 del proyecto: no se toca transcribe_large.py original, este
// motor usa python-backend/transcribe_fasterwhisper.py.

const path = require('path');
const { transcribir } = require('./pythonBridge');
const { pythonFasterWhisperPath, ENV_MAP } = require('./settingsStore');

const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python-backend', 'transcribe_fasterwhisper.py');

function transcribeFasterWhisper(inputPath, outJsonPath, onProgress) {
  return transcribir({
    etiqueta: 'faster-whisper',
    pythonPath: pythonFasterWhisperPath(),
    envVar: ENV_MAP.pythonFasterWhisper,
    script: TRANSCRIBE_SCRIPT,
    inputPath,
    outJsonPath,
    onProgress
  });
}

module.exports = { transcribeFasterWhisper };
