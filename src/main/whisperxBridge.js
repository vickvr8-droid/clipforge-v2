// Motor WhisperX (local, timestamps por palabra).
// Toda la mecanica del spawn/progreso/errores vive en pythonBridge.js -
// aca solo queda cual interprete y cual script usar.

const path = require('path');
const { transcribir } = require('./pythonBridge');
const { pythonWhisperXPath, ENV_MAP } = require('./settingsStore');

const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python-backend', 'transcribe_whisperx.py');

// `opciones.tokenHF` prende la DIARIZACION (quien habla en cada momento).
// Sin token el script transcribe igual que siempre - es un agregado, no un
// requisito. El token viaja por el ENTORNO del proceso hijo, nunca por los
// argumentos: los argumentos son visibles para cualquier otro proceso.
function transcribeWhisperX(inputPath, outJsonPath, onProgress, opciones) {
  const o = opciones || {};
  const envExtra = {};
  // El modelo clonado en disco gana: no pide token ni red (es el modo
  // "offline use" que documenta pyannote). El token queda como camino
  // alternativo, para la primera vez o si nadie clono nada.
  if (o.modeloPyannote) envExtra.CLIPFORGE_PYANNOTE_MODELO = o.modeloPyannote;
  if (o.tokenHF) envExtra.CLIPFORGE_HF_TOKEN = o.tokenHF;
  // Acotar cuantas voces se esperan evita que el modelo invente hablantes
  // de mas cuando hay ruido o musica de fondo.
  if (o.minHablantes) envExtra.CLIPFORGE_MIN_HABLANTES = String(o.minHablantes);
  if (o.maxHablantes) envExtra.CLIPFORGE_MAX_HABLANTES = String(o.maxHablantes);

  return transcribir({
    etiqueta: 'WhisperX',
    pythonPath: pythonWhisperXPath(),
    envVar: ENV_MAP.pythonWhisperX,
    script: TRANSCRIBE_SCRIPT,
    inputPath,
    outJsonPath,
    onProgress,
    envExtra
  });
}

module.exports = { transcribeWhisperX };
