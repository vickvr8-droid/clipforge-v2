// Proceso principal de Electron.
// Crea la ventana de la app y lanza los backends (Python para
// transcripcion, ffmpeg directo para silencios) como procesos hijo.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { transcribeWhisperX } = require('./whisperxBridge');
const { transcribeFasterWhisper } = require('./fasterWhisperBridge');
const { guardarKey, listarKeysSeguras, eliminarKey, obtenerValorKey } = require('./keysStore');
const { detectSilences } = require('./silenceBridge');
const { buildBlocks, summarize, blocksToSrt, blocksToCutsJson } = require('./cutsBuilder');
const { analizarMuletillas } = require('./llmAnalyzer');
const {
  crearClipsInicial, clipsEnInstante, crearClipNuevo, actualizarClip,
  eliminarClip, normalizarClips, migrarDesdeTramosViejo,
  segmentosCobertura, clipsToJson,
  layoutPorDefecto, actualizarRatioEnPath, distribuirProporcional,
  moverCeldaLibre, redimensionarCeldaLibre
} = require('./cropLayoutsBuilder');
// --- Exportacion real a video (ffmpeg) — modulo que ya existia como
// codigo standalone (planificarExportacion + exportRunner.ejecutar) pero
// NUNCA estuvo conectado aca (bug real encontrado 05/08/2026, "feature
// invisible": el backend/tests existian, cero wiring de IPC/UI). Se
// conecta recien ahora, ver CTX_PROYECTO_CLIPFORGE_1D.md.
const { probe } = require('./mediaProbe');
const { planificarExportacion } = require('./exportPlan');
const exportRunner = require('./exportRunner');
const settingsStore = require('./settingsStore');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'ClipForge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Reenvia errores/warnings de la consola del renderer (DevTools) a la
  // terminal donde corre "npm start" (pedido 29/07/2026, verificacion sin
  // acceso visual a la pantalla) - solo level>=2 (warning/error) para no
  // llenar el log con ruido normal de Chromium.
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.log(`[renderer-${level === 3 ? 'error' : 'warn'}] ${message} (${sourceId}:${line})`);
    }
  });

  return win;
}

let mainWindow;

// Estado en memoria de los bloques (cortes) por archivo de entrada.
// Vive solo mientras la app esta abierta - al exportar se escribe a disco.
const cutsState = new Map();

// Estado en memoria de los CLIPS de recuadro (cada uno con su propio
// start/end/track, independiente de los demas - modelo nuevo 29/07/2026,
// reemplaza el viejo de "tramos") por archivo de entrada - separado de
// cutsState a proposito, mismo patron (Map por inputPath).
const layoutsState = new Map();

// Estado en memoria de la DISPOSICION DE CELDAS del visor 9:16 (arbol de
// cortes de cropLayoutsBuilder.js, 30/07/2026) por archivo de entrada.
// Se guarda UN arbol por cada "clave" (30/07/2026, cambio de diseño a
// pedido del user: antes se guardaba por "n" = CANTIDAD de recuadros
// activos al mismo tiempo, lo que hacia que 2 combinaciones DISTINTAS de
// recuadros con la misma cantidad compartieran sin querer el mismo modo.
// Ahora "clave" identifica la combinacion EXACTA: ids de los recuadros
// activos, ordenados y joineados con "," - ej. "c123_1,c124_2". Asi cada
// combinacion puntual que se haya llegado a ver guarda su propio modo,
// y si esa misma combinacion exacta vuelve a aparecer mas adelante en el
// video, se recuerda como habia quedado en vez de resetear cada vez.
const cellLayoutsState = new Map(); // inputPath -> { [clave]: arbol }

// Estado en memoria del RECORTE (rango de trabajo) del video, pedido
// 31/07/2026: permite marcar un tramo [inicio,fin] para poder enfocar
// la edicion/reproduccion en solo esa parte del video, sin tocar el
// resto de los datos (blocks/layouts siguen siendo del video completo).
// { inicio, fin, activo, duracionTotal } por inputPath - "activo" decide
// si el visor limita la reproduccion/scrub a ese rango o no.
const trimState = new Map();

function obtenerOArmarLayout916(inputPath, clave, cantidad) {
  const mapa = cellLayoutsState.get(inputPath) || {};
  if (!mapa[clave]) {
    mapa[clave] = layoutPorDefecto(cantidad, 'vertical');
    cellLayoutsState.set(inputPath, mapa);
  }
  return mapa[clave];
}

// --- Persistencia de PROYECTOS (pedido 29/07/2026) ---
// Objetivo: que cerrar y volver a abrir la app no obligue a correr
// whisper de nuevo sobre un video ya transcrito antes. Cada proyecto
// (1 por archivo de entrada) se guarda como carpeta propia dentro de
// D:\ClipForge\proyectos\<slug>\proyecto.json - carpeta relativa al
// propio repo (path.join desde __dirname), no hardcodeada como "D:\...",
// para que siga funcionando si el repo se mueve de disco/carpeta.
const PROYECTOS_DIR = path.join(__dirname, '..', '..', 'proyectos');

// Nombre de carpeta = basename del archivo + hash corto de la ruta
// completa, para que 2 videos con el mismo nombre en carpetas distintas
// no choquen entre si.
function slugProyecto(inputPath) {
  const base = path.basename(inputPath, path.extname(inputPath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('md5').update(inputPath).digest('hex').slice(0, 8);
  return `${base}_${hash}`;
}

function rutaArchivoProyecto(inputPath) {
  return path.join(PROYECTOS_DIR, slugProyecto(inputPath), 'proyecto.json');
}

// Lee el proyecto guardado de un inputPath, o null si no existe/esta
// corrupto (nunca tira error hacia arriba - un proyecto viejo roto no
// deberia romper el resto de la app).
function cargarProyecto(inputPath) {
  const archivo = rutaArchivoProyecto(inputPath);
  if (!fs.existsSync(archivo)) return null;
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// Guarda/actualiza el proyecto de un inputPath, mezclando con lo que ya
// hubiera guardado (para no perder, ej., los layouts si solo se estan
// actualizando los blocks, o viceversa). Se llama desde varios handlers
// (transcribir, cortes, recuadros) cada vez que algo relevante cambia -
// asi el proyecto queda siempre al dia sin depender de un "guardar"
// manual del user.
function actualizarProyecto(inputPath, cambios) {
  try {
    const archivo = rutaArchivoProyecto(inputPath);
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    let actual = {};
    if (fs.existsSync(archivo)) {
      try { actual = JSON.parse(fs.readFileSync(archivo, 'utf-8')); } catch (e) { actual = {}; }
    }
    const ahora = new Date().toISOString();
    const nuevo = {
      ...actual,
      ...cambios,
      inputPath,
      fechaCreacion: actual.fechaCreacion || ahora,
      fechaActualizacion: ahora
    };
    fs.writeFileSync(archivo, JSON.stringify(nuevo, null, 2), 'utf-8');
    return nuevo;
  } catch (e) {
    console.error('No se pudo guardar el proyecto:', e.message);
    return null;
  }
}

// Lista todos los proyectos guardados (para la pantalla de inicio),
// con lo minimo necesario para mostrarlos sin cargar blocks/layouts
// completos de cada uno. Si el archivo original ya no existe en disco
// (se movio/borro), se marca "existeArchivoOriginal: false" para que la
// UI lo avise en vez de fallar en silencio al intentar reabrirlo.
function listarProyectos() {
  try {
    if (!fs.existsSync(PROYECTOS_DIR)) return [];
    const carpetas = fs.readdirSync(PROYECTOS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    const proyectos = [];
    for (const carpeta of carpetas) {
      const archivo = path.join(PROYECTOS_DIR, carpeta.name, 'proyecto.json');
      if (!fs.existsSync(archivo)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
        proyectos.push({
          inputPath: data.inputPath,
          nombreArchivo: path.basename(data.inputPath || carpeta.name),
          motor: data.motor || '',
          fechaActualizacion: data.fechaActualizacion || '',
          totalBlocks: (data.blocks || []).length,
          existeArchivoOriginal: data.inputPath ? fs.existsSync(data.inputPath) : false
        });
      } catch (e) { /* proyecto.json corrupto, saltear sin romper el resto */ }
    }
    proyectos.sort((a, b) => (b.fechaActualizacion || '').localeCompare(a.fechaActualizacion || ''));
    return proyectos;
  } catch (e) {
    return [];
  }
}

ipcMain.handle('elegir-archivo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Video/Audio', extensions: ['mov', 'mp4', 'mkv', 'wav', 'mp3'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('transcribir', async (event, { inputPath, motor }) => {
  // Si ya existe un proyecto guardado con blocks para este archivo, usar
  // eso directo y NO correr whisper de nuevo (pedido 29/07/2026) - cubre
  // tanto reabrir desde la pantalla de inicio como elegir a mano un
  // archivo que ya se habia transcrito antes.
  const existente = cargarProyecto(inputPath);
  if (existente && existente.blocks && existente.blocks.length) {
    cutsState.set(inputPath, existente.blocks);
    if (existente.layouts) layoutsState.set(inputPath, migrarDesdeTramosViejo(existente.layouts));
    if (existente.trim) trimState.set(inputPath, existente.trim);
    return {
      blocks: existente.blocks,
      resumen: existente.resumen || summarize(existente.blocks),
      trim: existente.trim || null,
      yaExistia: true
    };
  }

  const outJsonPath = inputPath + `.transcripcion.${motor}.json`;
  const onProgress = (progress) => mainWindow.webContents.send('transcripcion-progreso', progress);

  const resultado = motor === 'fasterwhisper'
    ? await transcribeFasterWhisper(inputPath, outJsonPath, onProgress)
    : await transcribeWhisperX(inputPath, outJsonPath, onProgress);

  // Tras transcribir, detectar silencios y armar los bloques de
  // aceptar/rechazar automaticamente (paso siguiente del MVP).
  onProgress({ status: 'detectando silencios (ffmpeg)' });
  let silences = [];
  try {
    silences = await detectSilences(inputPath);
  } catch (e) {
    // Si ffmpeg falla (ej. no esta en PATH en esta sesion), seguir sin
    // silencios en vez de tirar toda la transcripcion.
    onProgress({ status: `silencios fallo (${e.message}), sigo sin ellos` });
  }

  const blocks = buildBlocks(resultado.segments || [], silences);
  cutsState.set(inputPath, blocks);
  const resumen = summarize(blocks);
  actualizarProyecto(inputPath, { motor, blocks, resumen });

  onProgress({ status: 'listo' });
  return { ...resultado, blocks, resumen };
});

ipcMain.handle('cortes:toggle', (event, { inputPath, blockId }) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return null;
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return null;
  // Clic en una propuesta de IA = aceptarla (pasa a cortado). Clic
  // normal en keep/cut = alternar entre los dos como siempre.
  block.status = block.status === 'propuesta' ? 'cut' : (block.status === 'cut' ? 'keep' : 'cut');
  const resumen = summarize(blocks);
  actualizarProyecto(inputPath, { blocks, resumen });
  return { block, resumen };
});

ipcMain.handle('analizar-ia:ejecutar', async (event, { inputPath, backend, modelo, keyId, instrucciones, systemPrompt }) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return { ok: false, error: 'No hay transcripcion cargada para este archivo todavia.' };

  let apiKey = null;
  if (backend === 'openrouter') {
    if (!keyId) return { ok: false, error: 'Elegi una API key de OpenRouter guardada.' };
    apiKey = obtenerValorKey(app, keyId);
    if (!apiKey) return { ok: false, error: 'No se encontro esa key guardada.' };
  }

  try {
    const resultado = await analizarMuletillas({ blocks, backend, modelo, apiKey, instrucciones, systemPromptOverride: systemPrompt });
    const resumen = summarize(resultado.blocks);
    cutsState.set(inputPath, resultado.blocks);
    actualizarProyecto(inputPath, { blocks: resultado.blocks, resumen });
    return { ok: true, blocks: resultado.blocks, stats: resultado.stats, resumen };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('cortes:exportar-json', (event, inputPath) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return { ok: false, error: 'No hay cortes calculados para este archivo todavia.' };
  const outPath = inputPath + '.cortes.json';
  fs.writeFileSync(outPath, JSON.stringify(blocksToCutsJson(blocks), null, 2), 'utf-8');
  return { ok: true, path: outPath };
});

ipcMain.handle('cortes:exportar-srt', (event, inputPath) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return { ok: false, error: 'No hay cortes calculados para este archivo todavia.' };
  const outPath = inputPath + '.srt';
  fs.writeFileSync(outPath, blocksToSrt(blocks), 'utf-8');
  return { ok: true, path: outPath };
});

ipcMain.handle('recuadros:inicializar', (event, { inputPath }) => {
  if (!layoutsState.has(inputPath)) {
    layoutsState.set(inputPath, crearClipsInicial());
  }
  const clips = layoutsState.get(inputPath);
  actualizarProyecto(inputPath, { layouts: clips });
  return clips;
});

ipcMain.handle('recuadros:normalizar', (event, { inputPath, duracionReal }) => {
  const actuales = layoutsState.get(inputPath) || crearClipsInicial();
  const normalizados = normalizarClips(actuales, duracionReal);
  layoutsState.set(inputPath, normalizados);
  actualizarProyecto(inputPath, { layouts: normalizados });
  return normalizados;
});

// Crea un clip nuevo en el instante t (primera pista libre en ese
// momento), con la posicion/tamaño que se acaba de dibujar sobre el
// video. Reemplaza al viejo "recuadros:dividir" (dividir tramo).
ipcMain.handle('recuadros:crear', (event, { inputPath, t, duracionTotal, xPct, yPct, wPct, hPct }) => {
  const actuales = layoutsState.get(inputPath) || crearClipsInicial();
  const nuevos = crearClipNuevo(actuales, { t, duracionTotal, xPct, yPct, wPct, hPct });
  layoutsState.set(inputPath, nuevos);
  actualizarProyecto(inputPath, { layouts: nuevos });
  return nuevos;
});

// Actualiza cualquier subconjunto de campos de un clip puntual
// (start/end/track al arrastrar en la timeline, o xPct/yPct/wPct/hPct
// al mover/redimensionar sobre el video).
ipcMain.handle('recuadros:actualizar', (event, { inputPath, clipId, cambios }) => {
  const actuales = layoutsState.get(inputPath);
  if (!actuales) return null;
  const nuevos = actualizarClip(actuales, clipId, cambios);
  layoutsState.set(inputPath, nuevos);
  actualizarProyecto(inputPath, { layouts: nuevos });
  return nuevos;
});

ipcMain.handle('recuadros:eliminar', (event, { inputPath, clipId }) => {
  const actuales = layoutsState.get(inputPath);
  if (!actuales) return null;
  const nuevos = eliminarClip(actuales, clipId);
  layoutsState.set(inputPath, nuevos);
  actualizarProyecto(inputPath, { layouts: nuevos });
  return nuevos;
});

// --- Disposicion de celdas del visor 9:16 (30/07/2026, rediseñado el
// mismo dia a pedido del user: modo individual POR COMBINACION EXACTA de
// recuadros activos, no compartido solo por cantidad - ver comentario
// largo en cellLayoutsState arriba) ---
// clave = identidad de la combinacion exacta de recuadros activos ahora
// (ids ordenados joineados con ",", armado en el renderer).
// cantidad = cuantos recuadros tiene esa combinacion (sigue haciendo
// falta aparte para poder armar el arbol por defecto si es la primera
// vez que se ve esa clave).
ipcMain.handle('layout916:obtener', (event, { inputPath, clave, cantidad }) => {
  if (!clave || !cantidad) return null;
  return obtenerOArmarLayout916(inputPath, clave, cantidad);
});

// Aplica un preset completo (vertical/horizontal/grid/libre) para la
// combinacion actual - reemplaza el arbol guardado para esa clave de
// punta a punta.
ipcMain.handle('layout916:preset', (event, { inputPath, clave, cantidad, modo }) => {
  if (!clave || !cantidad) return null;
  const mapa = cellLayoutsState.get(inputPath) || {};
  mapa[clave] = layoutPorDefecto(cantidad, modo);
  cellLayoutsState.set(inputPath, mapa);
  actualizarProyecto(inputPath, { cellLayouts916: mapa });
  return mapa[clave];
});

// Cambia el ratio de UN divisor puntual (arrastrado a mano) - "path"
// identifica el corte exacto dentro del arbol (ver cropLayoutsBuilder.js).
ipcMain.handle('layout916:ratio', (event, { inputPath, clave, cantidad, path: rutaCorte, nuevoRatio }) => {
  if (!clave || !cantidad) return null;
  const actual = obtenerOArmarLayout916(inputPath, clave, cantidad);
  const mapa = cellLayoutsState.get(inputPath) || {};
  mapa[clave] = actualizarRatioEnPath(actual, rutaCorte, nuevoRatio);
  cellLayoutsState.set(inputPath, mapa);
  actualizarProyecto(inputPath, { cellLayouts916: mapa });
  return mapa[clave];
});

// Boton "Distribuir parejo": recalcula todos los ratios del arbol para
// que las celdas queden con exactamente la misma area (ver comentario
// completo en distribuirProporcional(), cropLayoutsBuilder.js).
ipcMain.handle('layout916:distribuir', (event, { inputPath, clave, cantidad }) => {
  if (!clave || !cantidad) return null;
  const actual = obtenerOArmarLayout916(inputPath, clave, cantidad);
  const mapa = cellLayoutsState.get(inputPath) || {};
  mapa[clave] = distribuirProporcional(actual);
  cellLayoutsState.set(inputPath, mapa);
  actualizarProyecto(inputPath, { cellLayouts916: mapa });
  return mapa[clave];
});

// Mueve una celda "libre" (arrastre a mano dentro del panel 9:16,
// solo tiene efecto si esa celda esta marcada libre - ver preset
// "Libre" y cropLayoutsBuilder.js, 30/07/2026).
ipcMain.handle('layout916:libre-mover', (event, { inputPath, clave, cantidad, pos, xPct, yPct }) => {
  if (!clave || !cantidad) return null;
  const actual = obtenerOArmarLayout916(inputPath, clave, cantidad);
  const mapa = cellLayoutsState.get(inputPath) || {};
  mapa[clave] = moverCeldaLibre(actual, pos, xPct, yPct);
  cellLayoutsState.set(inputPath, mapa);
  actualizarProyecto(inputPath, { cellLayouts916: mapa });
  return mapa[clave];
});

// Redimensiona una celda "libre" desde una esquina ('tl'/'tr'/'bl'/'br').
ipcMain.handle('layout916:libre-redimensionar', (event, { inputPath, clave, cantidad, pos, esquina, xPct, yPct }) => {
  if (!clave || !cantidad) return null;
  const actual = obtenerOArmarLayout916(inputPath, clave, cantidad);
  const mapa = cellLayoutsState.get(inputPath) || {};
  mapa[clave] = redimensionarCeldaLibre(actual, pos, esquina, xPct, yPct);
  cellLayoutsState.set(inputPath, mapa);
  actualizarProyecto(inputPath, { cellLayouts916: mapa });
  return mapa[clave];
});

// Actualiza el rango de recorte [inicio,fin] (y si esta "activo" o no)
// para enfocar edicion/reproduccion en solo un pedazo del video. Se
// clampea siempre contra duracionTotal para no dejar valores fuera de
// rango guardados (ej. si el video real termino siendo mas corto que
// cuando se marco el recorte).
ipcMain.handle('trim:actualizar', (event, { inputPath, inicio, fin, duracionTotal, activo }) => {
  const previo = trimState.get(inputPath);
  const dur = (isFinite(duracionTotal) && duracionTotal > 0) ? duracionTotal : (previo && previo.duracionTotal) || 0;
  let i = Math.max(0, Math.min(Number(inicio) || 0, dur || Number(inicio) || 0));
  let f = Math.max(0, Math.min(Number(fin) || 0, dur || Number(fin) || 0));
  if (dur > 0 && f - i < 0.2) f = Math.min(dur, i + 0.2);
  const trim = { inicio: i, fin: f, activo: !!activo, duracionTotal: dur };
  trimState.set(inputPath, trim);
  actualizarProyecto(inputPath, { trim });
  return trim;
});

ipcMain.handle('recuadros:exportar-json', (event, inputPath) => {
  const actuales = layoutsState.get(inputPath);
  if (!actuales || !actuales.length) return { ok: false, error: 'No hay recuadros calculados para este archivo todavia.' };
  const outPath = inputPath + '.recuadros.json';
  fs.writeFileSync(outPath, JSON.stringify(clipsToJson(actuales), null, 2), 'utf-8');
  return { ok: true, path: outPath };
});

// --- Exportacion real a video (05/08/2026, wiring nuevo - ver nota en
// los requires de arriba). "preflight" arma el plan SIN renderizar nada
// (para que la UI muestre "esto va a generar 8 segmentos, 47s de salida"
// antes de comprometerse a un export que puede tardar minutos), "iniciar"
// corre el render real reportando progreso.
ipcMain.handle('export:ajustes-obtener', () => ({
  exportacion: settingsStore.leer().exportacion,
  binarios: settingsStore.verificarBinarios()
}));

ipcMain.handle('export:ajustes-guardar', (event, cambios) => {
  const nuevo = settingsStore.guardar({ exportacion: cambios || {} });
  return nuevo.exportacion;
});

async function armarPlanExportacion(inputPath, opciones) {
  const blocks = cutsState.get(inputPath);
  if (!blocks || !blocks.length) return { ok: false, error: 'No hay transcripcion/cortes para este archivo todavia.' };
  const clips = layoutsState.get(inputPath) || [];
  const cellLayouts = cellLayoutsState.get(inputPath) || {};
  const trim = trimState.get(inputPath) || null;
  const fuente = await probe(inputPath);
  const plan = planificarExportacion({ blocks, clips, cellLayouts, trim, fuente, opciones });
  return { ok: plan.ok !== false, plan, blocks, fuente };
}

ipcMain.handle('export:preflight', async (event, { inputPath, opciones }) => {
  try {
    const { ok, plan, error } = await armarPlanExportacion(inputPath, opciones);
    if (!ok) return { ok: false, error: error || plan.error };
    return { ok: true, plan };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('export:iniciar', async (event, { inputPath, opciones, outputPath }) => {
  if (exportRunner.hayExportEnCurso()) return { ok: false, error: 'Ya hay una exportacion en curso.' };
  try {
    const { ok, plan, blocks, error } = await armarPlanExportacion(inputPath, opciones);
    if (!ok) return { ok: false, error: error || plan.error };
    const onProgress = (data) => mainWindow.webContents.send('export-progreso', data);
    const resultado = await exportRunner.ejecutar({ plan, inputPath, blocks, outputPath, onProgress });
    return resultado;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('export:cancelar', () => ({ ok: exportRunner.cancelar() }));

ipcMain.handle('proyectos:listar', () => listarProyectos());

ipcMain.handle('proyectos:abrir', (event, inputPath) => {
  const data = cargarProyecto(inputPath);
  if (!data) return null;
  // Restaurar el estado en memoria (cutsState/layoutsState) para que el
  // resto de los handlers (cortes:toggle, recuadros:*) sigan funcionando
  // normal despues de reabrir, igual que si se acabara de transcribir.
  cutsState.set(inputPath, data.blocks || []);
  layoutsState.set(inputPath, migrarDesdeTramosViejo(data.layouts || []));
  cellLayoutsState.set(inputPath, data.cellLayouts916 || {});
  if (data.trim) trimState.set(inputPath, data.trim);
  return data;
});

ipcMain.handle('keys:listar', () => listarKeysSeguras(app));
ipcMain.handle('keys:guardar', (event, { nombre, valor }) => guardarKey(app, { nombre, valor }));
ipcMain.handle('keys:eliminar', (event, id) => eliminarKey(app, id));

app.whenReady().then(() => {
  settingsStore.inicializar(app);
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
