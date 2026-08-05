// Puente seguro entre el proceso principal y la interfaz web.

const { contextBridge, ipcRenderer } = require('electron');

// Convierte una ruta local (Windows, con espacios/backslashes) a una URL
// file:// valida para el <video> del visor (seccion 7.8 del
// CTX_PROYECTO_CLIPFORGE_1D.md). CORREGIDO 28/07/2026: no usar
// require('url').pathToFileURL aca - con contextIsolation el preload
// sandboxeado de Electron resuelve 'url' al shim de navegador (sin
// pathToFileURL, que es una extension especifica de Node), tira
// "pathToFileURL is not a function" en runtime. Construccion manual en
// vez de depender de ese modulo.
function rutaAFileUrl(rutaLocal) {
  let ruta = String(rutaLocal).replace(/\\/g, '/');
  if (!ruta.startsWith('/')) ruta = '/' + ruta;
  return 'file://' + encodeURI(ruta).replace(/#/g, '%23');
}

contextBridge.exposeInMainWorld('clipForge', {
  version: '0.1.0',
  rutaAFileUrl,
  elegirArchivo: () => ipcRenderer.invoke('elegir-archivo'),
  transcribir: (inputPath, motor) => ipcRenderer.invoke('transcribir', { inputPath, motor }),
  keysListar: () => ipcRenderer.invoke('keys:listar'),
  keysGuardar: (nombre, valor) => ipcRenderer.invoke('keys:guardar', { nombre, valor }),
  keysEliminar: (id) => ipcRenderer.invoke('keys:eliminar', id),
  cortesToggle: (inputPath, blockId) => ipcRenderer.invoke('cortes:toggle', { inputPath, blockId }),
  cortesExportarJson: (inputPath) => ipcRenderer.invoke('cortes:exportar-json', inputPath),
  cortesExportarSrt: (inputPath) => ipcRenderer.invoke('cortes:exportar-srt', inputPath),
  analizarIA: (payload) => ipcRenderer.invoke('analizar-ia:ejecutar', payload),
  recuadrosInicializar: (inputPath) => ipcRenderer.invoke('recuadros:inicializar', { inputPath }),
  recuadrosNormalizar: (inputPath, duracionReal) => ipcRenderer.invoke('recuadros:normalizar', { inputPath, duracionReal }),
  recuadrosCrear: (inputPath, t, duracionTotal, xPct, yPct, wPct, hPct) => ipcRenderer.invoke('recuadros:crear', { inputPath, t, duracionTotal, xPct, yPct, wPct, hPct }),
  recuadrosActualizar: (inputPath, clipId, cambios) => ipcRenderer.invoke('recuadros:actualizar', { inputPath, clipId, cambios }),
  recuadrosEliminar: (inputPath, clipId) => ipcRenderer.invoke('recuadros:eliminar', { inputPath, clipId }),
  recuadrosExportarJson: (inputPath) => ipcRenderer.invoke('recuadros:exportar-json', inputPath),
  // 30/07/2026: "n" (cantidad) paso a ser "clave" (identidad de la
  // combinacion exacta de recuadros activos, ids ordenados joineados) +
  // "cantidad" aparte (sigue haciendo falta para armar el arbol por
  // defecto) - pedido del user: modo individual por combinacion, no
  // compartido solo por cantidad de recuadros activos.
  layout916Obtener: (inputPath, clave, cantidad) => ipcRenderer.invoke('layout916:obtener', { inputPath, clave, cantidad }),
  layout916Preset: (inputPath, clave, cantidad, modo) => ipcRenderer.invoke('layout916:preset', { inputPath, clave, cantidad, modo }),
  layout916Ratio: (inputPath, clave, cantidad, path, nuevoRatio) => ipcRenderer.invoke('layout916:ratio', { inputPath, clave, cantidad, path, nuevoRatio }),
  layout916Distribuir: (inputPath, clave, cantidad) => ipcRenderer.invoke('layout916:distribuir', { inputPath, clave, cantidad }),
  layout916LibreMover: (inputPath, clave, cantidad, pos, xPct, yPct) => ipcRenderer.invoke('layout916:libre-mover', { inputPath, clave, cantidad, pos, xPct, yPct }),
  layout916LibreRedimensionar: (inputPath, clave, cantidad, pos, esquina, xPct, yPct) => ipcRenderer.invoke('layout916:libre-redimensionar', { inputPath, clave, cantidad, pos, esquina, xPct, yPct }),
  // Recorte (rango de trabajo) del video, pedido 31/07/2026 - marcar
  // [inicio,fin] para enfocar edicion/reproduccion en solo un pedazo.
  trimActualizar: (inputPath, inicio, fin, duracionTotal, activo) => ipcRenderer.invoke('trim:actualizar', { inputPath, inicio, fin, duracionTotal, activo }),
  proyectosListar: () => ipcRenderer.invoke('proyectos:listar'),
  proyectosAbrir: (inputPath) => ipcRenderer.invoke('proyectos:abrir', inputPath),
  onProgreso: (callback) => {
    ipcRenderer.on('transcripcion-progreso', (event, data) => callback(data));
  }
});
