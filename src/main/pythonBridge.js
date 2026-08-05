// pythonBridge.js
//
// Lanzador comun para los scripts de transcripcion de python-backend/.
//
// POR QUE EXISTE: whisperxBridge.js y fasterWhisperBridge.js eran el
// MISMO archivo dos veces (spawn, polling del progress.json, manejo de
// cierre, armado del error) cambiando solo la ruta del python y el nombre
// del script. Cualquier arreglo habia que hacerlo dos veces y era facil
// que quedaran desincronizados. Ahora la logica vive aca una sola vez y
// cada bridge queda en unas pocas lineas.
//
// Mejoras respecto de la version anterior, ademas de la deduplicacion:
// - La ruta del interprete se resuelve via settingsStore (configurable,
//   ya no hardcodeada a "C:\Users\vicente\...").
// - Si el interprete no existe se avisa ANTES de intentar el spawn, con
//   un mensaje que dice que configurar - antes salia un ENOENT crudo o un
//   "codigo null" sin explicacion.
// - Se limpia el .progress.json al terminar, que antes quedaba tirado al
//   lado del video para siempre.
// - Se puede cancelar (el proceso queda referenciado y expuesto).

const { spawn } = require('child_process');
const fs = require('fs');
const { binarioDisponible, errorBinarioFaltante } = require('./settingsStore');

const INTERVALO_PROGRESO_MS = 800;

// Los scripts de Python reportan su avance escribiendo un JSON chico al
// lado del archivo de salida (no por stdout) porque las librerias de
// whisper escupen barras de progreso y logs propios por ahi, y mezclarlo
// hace imposible parsear nada de forma confiable.
function vigilarProgreso(progressPath, onProgress) {
  return setInterval(() => {
    if (!fs.existsSync(progressPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      if (onProgress) onProgress(data);
    } catch (e) { /* archivo a medio escribir, se reintenta al proximo tick */ }
  }, INTERVALO_PROGRESO_MS);
}

function transcribir({ etiqueta, pythonPath, envVar, script, inputPath, outJsonPath, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!binarioDisponible(pythonPath, ['--version'])) {
      reject(errorBinarioFaltante(`el interprete de Python de ${etiqueta}`, pythonPath, envVar));
      return;
    }

    const progressPath = outJsonPath + '.progress.json';
    // PYTHONIOENCODING/UTF8: sin esto, un video con acentos o emojis en
    // el nombre puede hacer estallar el print() del script en Windows
    // (cp1252) y matar la transcripcion ya terminada al escribir el log.
    const proc = spawn(pythonPath, [script, inputPath, outJsonPath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });

    const timer = vigilarProgreso(progressPath, onProgress);
    let colaStderr = '';
    proc.stderr.on('data', (d) => { colaStderr = (colaStderr + d.toString()).slice(-4000); });

    const limpiar = () => {
      clearInterval(timer);
      try { if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath); } catch (e) { /* no critico */ }
    };

    proc.on('close', (code) => {
      limpiar();
      if (code === 0 && fs.existsSync(outJsonPath)) {
        try {
          resolve(JSON.parse(fs.readFileSync(outJsonPath, 'utf-8')));
        } catch (e) {
          reject(new Error(`La transcripcion de ${etiqueta} termino bien pero el JSON de salida no se pudo leer: ${e.message}`));
        }
        return;
      }
      reject(new Error(
        `La transcripcion con ${etiqueta} fallo (codigo ${code}).\n${colaStderr.slice(-1500)}`
      ));
    });

    proc.on('error', (err) => {
      limpiar();
      reject(new Error(`No se pudo ejecutar ${etiqueta} (${pythonPath}): ${err.message}`));
    });
  });
}

module.exports = { transcribir };
