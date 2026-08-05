// settingsStore.js
//
// Rutas de binarios externos (ffmpeg, ffprobe, python de cada motor de
// transcripcion) + preferencias de exportacion, en UN solo lugar.
//
// POR QUE EXISTE (bug encontrado 04/08/2026): whisperxBridge.js y
// fasterWhisperBridge.js tenian la ruta al python.exe HARDCODEADA a
// "C:\Users\vicente\..." - la app solo podia funcionar en esa PC, con
// ese usuario, con los venv en ese lugar exacto. Si alguno se movia,
// spawn tiraba ENOENT y el error que veia el user era un "codigo null"
// sin explicacion. Ahora las rutas se resuelven en 3 niveles, de mayor
// a menor prioridad:
//
//   1. Lo que el user configuro en la app (userData/config.json, editable
//      desde el panel "Ajustes" de la interfaz).
//   2. Variable de entorno (CLIPFORGE_FFMPEG, CLIPFORGE_PYTHON_WHISPERX,
//      CLIPFORGE_PYTHON_FASTERWHISPER, CLIPFORGE_FFPROBE).
//   3. Un default razonable: para ffmpeg/ffprobe el nombre suelto (que
//      Node resuelve contra el PATH del sistema), para los venv de python
//      las rutas historicas que ya usaba el proyecto (para no romper la
//      instalacion existente del user que si las tiene ahi).
//
// Ademas verificarBinarios() permite que la UI avise ANTES de intentar
// exportar/transcribir, en vez de fallar a mitad de camino.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Defaults historicos del proyecto (la instalacion real del user). Se
// dejan como ultimo recurso a proposito: si existen, todo sigue
// funcionando igual que antes de este refactor.
const DEFAULTS = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  pythonWhisperX: 'C:\\Users\\vicente\\remotion-projects\\whisperx-tool\\.venv\\Scripts\\python.exe',
  pythonFasterWhisper: 'C:\\Users\\vicente\\audio-ai-tools\\venv\\Scripts\\python.exe',
  // Preferencias de exportacion recordadas entre sesiones.
  exportacion: {
    ancho: 1080,
    alto: 1920,
    fps: 0,             // 0 = usar los fps del video original
    crf: 20,
    preset: 'medium',
    bitrateAudio: '192k',
    sinRecuadro: 'centrar', // 'centrar' | 'omitir'
    quemarSubtitulos: false,
    carpetaSalida: ''       // vacio = junto al archivo de entrada
  }
};

const ENV_MAP = {
  ffmpeg: 'CLIPFORGE_FFMPEG',
  ffprobe: 'CLIPFORGE_FFPROBE',
  pythonWhisperX: 'CLIPFORGE_PYTHON_WHISPERX',
  pythonFasterWhisper: 'CLIPFORGE_PYTHON_FASTERWHISPER'
};

// El modulo se usa desde bridges que no reciben "app" (whisperxBridge,
// silenceBridge...), asi que la ruta de userData se inyecta una sola vez
// al arrancar (main.js -> inicializar(app)) y queda cacheada aca.
let rutaConfig = null;
let cache = null;

function inicializar(app) {
  rutaConfig = path.join(app.getPath('userData'), 'config.json');
  cache = null;
  return leer();
}

function leer() {
  if (cache) return cache;
  let guardado = {};
  if (rutaConfig && fs.existsSync(rutaConfig)) {
    try {
      guardado = JSON.parse(fs.readFileSync(rutaConfig, 'utf-8'));
    } catch (e) {
      guardado = {}; // config corrupta no debe impedir arrancar la app
    }
  }
  cache = {
    ...DEFAULTS,
    ...guardado,
    exportacion: { ...DEFAULTS.exportacion, ...(guardado.exportacion || {}) }
  };
  return cache;
}

function guardar(cambios) {
  const actual = leer();
  const nuevo = {
    ...actual,
    ...cambios,
    exportacion: { ...actual.exportacion, ...(cambios.exportacion || {}) }
  };
  cache = nuevo;
  if (rutaConfig) {
    try {
      fs.mkdirSync(path.dirname(rutaConfig), { recursive: true });
      fs.writeFileSync(rutaConfig, JSON.stringify(nuevo, null, 2), 'utf-8');
    } catch (e) {
      console.error('[settings] no se pudo guardar config.json:', e.message);
    }
  }
  return nuevo;
}

// Resuelve UNA ruta con la prioridad config > env > default.
function rutaDe(clave) {
  const conf = leer();
  if (conf[clave] && String(conf[clave]).trim()) return String(conf[clave]).trim();
  const env = ENV_MAP[clave] && process.env[ENV_MAP[clave]];
  if (env && env.trim()) return env.trim();
  return DEFAULTS[clave];
}

const ffmpegPath = () => rutaDe('ffmpeg');
const ffprobePath = () => rutaDe('ffprobe');
const pythonWhisperXPath = () => rutaDe('pythonWhisperX');
const pythonFasterWhisperPath = () => rutaDe('pythonFasterWhisper');

// Un binario es "usable" si es una ruta absoluta que existe en disco, o
// un nombre suelto que el sistema puede ejecutar (se prueba de verdad
// con -version en vez de adivinar recorriendo el PATH a mano).
function binarioDisponible(bin, argsVersion = ['-version']) {
  if (!bin) return false;
  if (path.isAbsolute(bin)) return fs.existsSync(bin);
  try {
    const r = spawnSync(bin, argsVersion, { timeout: 5000 });
    return !r.error;
  } catch (e) {
    return false;
  }
}

// Reporte para el panel "Ajustes" de la UI: que hay, que falta y con que
// ruta se esta resolviendo cada cosa, para que el user pueda arreglarlo
// sin abrir DevTools.
function verificarBinarios() {
  const items = [
    { clave: 'ffmpeg', etiqueta: 'ffmpeg', ruta: ffmpegPath(), args: ['-version'], requerido: true },
    { clave: 'ffprobe', etiqueta: 'ffprobe', ruta: ffprobePath(), args: ['-version'], requerido: true },
    { clave: 'pythonWhisperX', etiqueta: 'Python (WhisperX)', ruta: pythonWhisperXPath(), args: ['--version'], requerido: false },
    { clave: 'pythonFasterWhisper', etiqueta: 'Python (faster-whisper)', ruta: pythonFasterWhisperPath(), args: ['--version'], requerido: false }
  ];
  return items.map((it) => ({
    clave: it.clave,
    etiqueta: it.etiqueta,
    ruta: it.ruta,
    requerido: it.requerido,
    disponible: binarioDisponible(it.ruta, it.args)
  }));
}

// Mensaje de error uniforme y accionable cuando falta un binario - lo
// usan los bridges en vez de dejar escapar un ENOENT crudo.
function errorBinarioFaltante(etiqueta, ruta, claveEnv) {
  return new Error(
    `No se encontro ${etiqueta} en "${ruta}". Configuralo en el panel Ajustes de ClipForge` +
    (claveEnv ? ` o definiendo la variable de entorno ${claveEnv}.` : '.')
  );
}

module.exports = {
  DEFAULTS,
  ENV_MAP,
  inicializar,
  leer,
  guardar,
  ffmpegPath,
  ffprobePath,
  pythonWhisperXPath,
  pythonFasterWhisperPath,
  binarioDisponible,
  verificarBinarios,
  errorBinarioFaltante
};
