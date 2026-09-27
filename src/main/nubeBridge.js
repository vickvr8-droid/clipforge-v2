// Motor de transcripcion EN LA NUBE (NVIDIA Riva / NVCF).
//
// Hermano de whisperxBridge.js y fasterWhisperBridge.js: toda la mecanica
// del spawn/progreso/errores vive en pythonBridge.js, aca solo queda que
// interprete usar y que le llega por entorno.
//
// DIFERENCIA IMPORTANTE con los otros dos motores: este NO usa la GPU de
// la maquina. Manda el audio a los servidores de NVIDIA y espera. Lo unico
// que corre local es ffmpeg extrayendo el audio, que son segundos.
//
// La API key viaja por el ENTORNO del proceso hijo, nunca por los
// argumentos: los argumentos de un proceso son visibles para cualquier
// otro proceso de la maquina.

const path = require('path');
const { transcribir } = require('./pythonBridge');
const { pythonNubePath, ffmpegPath, leer, ENV_MAP } = require('./settingsStore');

const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python-backend', 'transcribe_nvidia.py');

function transcribeNube(inputPath, outJsonPath, onProgress, opciones) {
  const o = opciones || {};
  const conf = leer().nube || {};

  const envExtra = {
    // ffmpeg se resuelve del mismo lado que el resto de la app en vez de
    // dejar que el script adivine: si el user lo configuro a mano en
    // Ajustes, el motor de nube tiene que respetar esa misma ruta.
    CLIPFORGE_FFMPEG: ffmpegPath()
  };

  if (o.apiKey) envExtra.CLIPFORGE_NVIDIA_KEY = o.apiKey;
  if (conf.servidor) envExtra.CLIPFORGE_NVIDIA_SERVER = conf.servidor;
  if (conf.functionId) envExtra.CLIPFORGE_NVCF_FUNCTION_ID = conf.functionId;
  if (conf.modelo) envExtra.CLIPFORGE_NVIDIA_MODELO = conf.modelo;
  if (conf.idioma) envExtra.CLIPFORGE_NVIDIA_LANG = conf.idioma;
  // Palabras a favorecer en el reconocimiento (modismos, nombres propios).
  if (conf.palabrasClave) envExtra.CLIPFORGE_PALABRAS_CLAVE = conf.palabrasClave;
  if (conf.boost) envExtra.CLIPFORGE_BOOST_SCORE = String(conf.boost);

  return transcribir({
    etiqueta: 'NVIDIA (nube)',
    pythonPath: pythonNubePath(),
    envVar: ENV_MAP.pythonNube,
    script: TRANSCRIBE_SCRIPT,
    inputPath,
    outJsonPath,
    onProgress,
    envExtra
  });
}

module.exports = { transcribeNube };
