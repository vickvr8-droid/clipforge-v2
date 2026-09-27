// Proceso principal de Electron.
// Crea la ventana de la app y lanza los backends (Python para
// transcripcion, ffmpeg directo para silencios) como procesos hijo.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { transcribeWhisperX } = require('./whisperxBridge');
const { transcribeFasterWhisper } = require('./fasterWhisperBridge');
const { transcribeNube } = require('./nubeBridge');
const protocoloMedia = require('./protocoloMedia');
const { guardarKey, listarKeysSeguras, eliminarKey, obtenerValorKey, obtenerValorPorProveedor } = require('./keysStore');
const { detectSilences } = require('./silenceBridge');
const {
  buildBlocks, summarize, blocksToSrt, blocksToCutsJson, blocksToTranscriptText, blocksToPlainText,
  cortarRango, restaurarRango, rangosCortados,
  contarSugerencias, aplicarSugerencias, descartarSugerencias, silenciosASugerencias
} = require('./cutsBuilder');
const { analizarMuletillas } = require('./llmAnalyzer');
const { probe } = require('./mediaProbe');
const settingsStore = require('./settingsStore');
const escritorExport = require('./escritorExport');
const picosBridge = require('./picosBridge');

// ============================================================
// BORRADO 06/08/2026 — LINEA DE TIEMPO Y VISORES, A REHACER DE CERO
// ============================================================
// A pedido del user, se elimino TODO el subsistema de linea de tiempo y
// visores para rehacerlo bien desde cero. Copia de seguridad completa del
// estado anterior en E:\Clipforge2.
//
// SE BORRO:
//   src/shared/pistaVideo.js    (montaje de pista unica)
//   src/shared/timeline.js      (montaje multi-pista)
//   src/shared/layout916.js     (disposicion del visor 9:16)
//   src/shared/geometria916.js  (recorte "cover" 16:9 -> 9:16)
//   src/main/cropLayoutsBuilder.js (recuadros)
//   src/main/thumbsBridge.js    (miniaturas)
//   src/main/exportPlan.js      (plan de ffmpeg: dependia de la geometria)
//   + sus tests
//
// SE CONSERVO (no es timeline ni visor):
//   transcripcion (whisperx/faster-whisper via pythonBridge),
//   deteccion de silencios, bloques de corte (cutsBuilder + intervalos),
//   analisis con IA, keys cifradas, configuracion de binarios,
//   persistencia de proyectos, y exportRunner.js (ejecuta un plan de
//   ffmpeg; es puro motor y no sabe nada de geometria, asi que sirve
//   igual para lo que se construya encima).
//
// QUEDA DESCONECTADO hasta que se rehaga: la exportacion de VIDEO
// (necesita un planificador nuevo). La exportacion de datos (JSON, SRT,
// transcripcion) sigue funcionando.

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


// Estado en memoria del RECORTE (rango de trabajo) del video, pedido
// 31/07/2026: permite marcar un tramo [inicio,fin] para poder enfocar
// la edicion/reproduccion en solo esa parte del video, sin tocar el
// resto de los datos (blocks/layouts siguen siendo del video completo).
// { inicio, fin, activo, duracionTotal } por inputPath - "activo" decide
// si el visor limita la reproduccion/scrub a ese rango o no.

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
    return {
      blocks: existente.blocks,
      resumen: existente.resumen || summarize(existente.blocks),
      trim: existente.trim || null,
      yaExistia: true
    };
  }

  const outJsonPath = inputPath + `.transcripcion.${motor}.json`;
  const onProgress = (progress) => mainWindow.webContents.send('transcripcion-progreso', progress);

  // DIARIZACION (07/08/2026): si hay una key de HuggingFace guardada, la
  // transcripcion ademas marca QUIEN habla en cada palabra. El token se
  // busca por proveedor y no por id: `keysStore` ya reconoce el prefijo
  // `hf_`, asi que al pegarlo en el panel de keys queda etiquetado solo y
  // no hace falta configurar nada mas.
  // Si no hay key, WhisperX transcribe igual que siempre.
  // Y si el modelo esta clonado en disco, mejor todavia: sin token y sin
  // red. La ruta sale de CLIPFORGE_PYANNOTE_MODELO, misma idea que el resto
  // de los binarios externos.
  const tokenHF = obtenerValorPorProveedor(app, 'HuggingFace');
  const modeloPyannote = (process.env.CLIPFORGE_PYANNOTE_MODELO || '').trim();

  // MOTOR DE NUBE (08/08/2026): 'nvidia' no toca la GPU de esta maquina.
  // La key se busca por PROVEEDOR y no por id, igual que el token de
  // HuggingFace: keysStore reconoce el prefijo `nvapi-`, asi que con
  // pegarla en el panel de API Keys ya queda lista y no hay nada mas que
  // configurar.
  let resultado;
  if (motor === 'nvidia') {
    const apiKey = obtenerValorPorProveedor(app, 'NVIDIA');
    if (!apiKey) {
      throw new Error(
        'No hay ninguna API key de NVIDIA guardada. Pegala en el panel "API Keys" ' +
        '(empieza con nvapi-) y volve a intentar.'
      );
    }
    resultado = await transcribeNube(inputPath, outJsonPath, onProgress, { apiKey });
  } else if (motor === 'fasterwhisper') {
    resultado = await transcribeFasterWhisper(inputPath, outJsonPath, onProgress);
  } else {
    resultado = await transcribeWhisperX(inputPath, outJsonPath, onProgress, { tokenHF, modeloPyannote });
  }

  // Tras transcribir, detectar silencios y armar los bloques de
  // aceptar/rechazar automaticamente (paso siguiente del MVP).
  onProgress({ status: 'detectando silencios (ffmpeg)' });
  let silences = [];
  try {
    // duracionTotal NO es opcional en la practica (GAP registrado el
    // 05/08/2026 y confirmado hoy 07/08): `silencedetect` de ffmpeg no
    // emite `silence_end` cuando el archivo TERMINA en silencio, asi que
    // ese ultimo silencio queda abierto y se pierde. silenceBridge.js
    // tiene el arreglo escrito desde entonces, pero dependia de recibir
    // este dato y nadie se lo pasaba: la rama nunca se ejecutaba con
    // datos reales. Se mide con ffprobe, que ya se importa aca arriba.
    let duracionTotal = 0;
    try { duracionTotal = (await probe(inputPath)).duracion || 0; } catch (e2) { /* sin medida, como antes */ }
    silences = await detectSilences(inputPath, { duracionTotal });
  } catch (e) {
    // Si ffmpeg falla (ej. no esta en PATH en esta sesion), seguir sin
    // silencios en vez de tirar toda la transcripcion.
    onProgress({ status: `silencios fallo (${e.message}), sigo sin ellos` });
  }

  const blocks = buildBlocks(resultado.segments || [], silences);
  cutsState.set(inputPath, blocks);
  const resumen = summarize(blocks);
  actualizarProyecto(inputPath, { motor, blocks, resumen });

  // GUARDADO AUTOMATICO DEL TEXTO (08/08/2026, pedido del user).
  // Los botones de exportar siguen estando, pero hay que acordarse de
  // tocarlos: si uno cierra la app despues de una transcripcion de 40
  // minutos, el texto quedaba solo dentro del proyecto. Ahora queda
  // siempre un .txt al lado del video, que es donde uno lo busca.
  //
  // Va envuelto en try/catch a proposito: la carpeta puede ser de solo
  // lectura, estar en un disco lleno o en una unidad de red que se
  // desconecto. Nada de eso justifica perder una transcripcion que ya
  // costo varios minutos de GPU.
  let textoGuardadoEn = null;
  try {
    const texto = blocksToPlainText(blocks);
    if (texto.trim()) {
      textoGuardadoEn = inputPath + '.txt';
      fs.writeFileSync(textoGuardadoEn, texto, 'utf-8');
    }
  } catch (e) {
    textoGuardadoEn = null;
    onProgress({ status: `no se pudo guardar el .txt (${e.message})` });
  }

  onProgress({ status: 'listo' });
  return { ...resultado, blocks, resumen, textoGuardadoEn };
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

// --- CORTE MANUAL EN LA LINEA DE TIEMPO (05/08/2026) ---
// Toda la logica vive en cutsBuilder.js (funciones puras, con tests).
// Aca solo se aplica sobre el estado en memoria y se persiste, igual que
// 'cortes:toggle'. No hizo falta tocar exportPlan.js: un corte manual
// queda expresado como bloques con status 'cut', que el plan de
// exportacion ya sabe descontar.
ipcMain.handle('cortes:cortar-rango', (event, { inputPath, inicio, fin }) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return null;
  const nuevos = cortarRango(blocks, inicio, fin);
  cutsState.set(inputPath, nuevos);
  const resumen = summarize(nuevos);
  actualizarProyecto(inputPath, { blocks: nuevos, resumen });
  return { blocks: nuevos, resumen };
});

ipcMain.handle('cortes:restaurar-rango', (event, { inputPath, inicio, fin }) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return null;
  const nuevos = restaurarRango(blocks, inicio, fin);
  cutsState.set(inputPath, nuevos);
  const resumen = summarize(nuevos);
  actualizarProyecto(inputPath, { blocks: nuevos, resumen });
  return { blocks: nuevos, resumen };
});

// ============================================================
// Devuelve el historial de un video, armandolo la primera vez. Si el
// proyecto ya tenia bloques cortados (el modelo viejo), la pista arranca
// respetandolos para no perder el trabajo hecho.
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

// Exporta la transcripcion en texto plano, en 2 variantes elegibles
// (soloKeep=true: solo lo que queda en el video final; soloKeep=false:
// transcripcion completa incluyendo lo marcado para cortar). Usa
// blocksToTranscriptText() de cutsBuilder.js (ver seccion 5/pedido
// 05/08/2026 de CTX_PROYECTO_CLIPFORGE_1D.md).
ipcMain.handle('cortes:exportar-transcripcion', (event, { inputPath, soloKeep }) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return { ok: false, error: 'No hay cortes calculados para este archivo todavia.' };
  const sufijo = soloKeep ? '.transcripcion-final.txt' : '.transcripcion-completa.txt';
  const outPath = inputPath + sufijo;
  fs.writeFileSync(outPath, blocksToTranscriptText(blocks, { soloKeep }), 'utf-8');
  return { ok: true, path: outPath };
});

// Transcripcion en texto plano CONTINUO, sin marcas de tiempo (pedido
// 05/08/2026) - ver blocksToPlainText() en cutsBuilder.js para el detalle
// de que incluye.
ipcMain.handle('cortes:exportar-transcripcion-plana', (event, inputPath) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return { ok: false, error: 'No hay cortes calculados para este archivo todavia.' };
  const outPath = inputPath + '.transcripcion-plana.txt';
  fs.writeFileSync(outPath, blocksToPlainText(blocks), 'utf-8');
  return { ok: true, path: outPath };
});



// Crea un clip nuevo en el instante t (primera pista libre en ese
// momento), con la posicion/tamaño que se acaba de dibujar sobre el
// video. Reemplaza al viejo "recuadros:dividir" (dividir tramo).

// Actualiza cualquier subconjunto de campos de un clip puntual
// (start/end/track al arrastrar en la timeline, o xPct/yPct/wPct/hPct
// al mover/redimensionar sobre el video).


// --- Disposicion de celdas del visor 9:16 (30/07/2026, rediseñado el
// mismo dia a pedido del user: modo individual POR COMBINACION EXACTA de
// recuadros activos, no compartido solo por cantidad - ver comentario
// largo en cellLayoutsState arriba) ---
// clave = identidad de la combinacion exacta de recuadros activos ahora
// (ids ordenados joineados con ",", armado en el renderer).
// cantidad = cuantos recuadros tiene esa combinacion (sigue haciendo
// falta aparte para poder armar el arbol por defecto si es la primera
// vez que se ve esa clave).
// ============================================================


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

// --- EXPORTACION DE VIDEO (13/09/2026, 1.3.b) ---
// El bucle corre en el RENDERER (src/renderer/exportVideo.js). El main
// solo hace lo que el renderer no puede: preguntar donde guardar y
// escribir los bytes. Ver escritorExport.js para el por que de los
// pedazos con posicion y del archivo `.parcial`.
ipcMain.handle('export-video:abrir', async (event, { inputPath, sufijo }) => {
  const ajustes = settingsStore.leer().exportacion || {};
  const base = inputPath ? path.basename(inputPath, path.extname(inputPath)) : 'clipforge';
  const carpeta = ajustes.carpetaSalida || (inputPath ? path.dirname(inputPath) : app.getPath('videos'));
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar video',
    defaultPath: path.join(carpeta, `${base}_${sufijo || 'export'}.mp4`),
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
  });
  if (res.canceled || !res.filePath) return null;
  return escritorExport.abrir(res.filePath);
});

ipcMain.handle('export-video:escribir', (event, { id, posicion, datos }) =>
  escritorExport.escribir(id, posicion, datos));

ipcMain.handle('export-video:cerrar', (event, { id, ok }) => escritorExport.cerrar(id, ok));

// Config del motor de transcripcion en la nube. Va aparte de los ajustes
// de exportacion porque no tiene nada que ver con el render, y aparte de
// las keys porque NO es secreto: el function-id y las palabras clave se
// pueden mostrar en pantalla sin problema. La key sigue viviendo cifrada
// en keysStore y no pasa nunca por aca.
ipcMain.handle('nube:obtener', () => ({
  ...settingsStore.leer().nube,
  hayKey: Boolean(obtenerValorPorProveedor(app, 'NVIDIA'))
}));

ipcMain.handle('nube:guardar', (event, cambios) => settingsStore.guardar({ nube: cambios || {} }).nube);

// BORRADO 07/08/2026 — armarPlanExportacion().
// Era codigo HUERFANO y ademas roto: quedo del sistema anterior al
// borrado del 06/08 y referenciaba cuatro cosas que ya no existen en
// este archivo (`planificarExportacion` nunca se importo, y
// `cellLayoutsState`, `clips` y `trim` no estan declaradas). Si algun
// handler la hubiera llamado, tiraba ReferenceError. No la llamaba
// nadie, asi que el error estaba latente esperando a que alguien
// conectara la exportacion.
// El planificador NUEVO no va a poder reusar nada de esto: tiene que
// leer del montaje (`composicionEn`), no de `blocks`+`clips`+`trim`.




// Sugerencias de corte en bloque: "aplicar" acepta todas las propuestas,
// "descartar" las rechaza, "desde-silencios" desarma los cortes
// automaticos de un proyecto viejo para poder revisarlos uno por uno.
ipcMain.handle('cortes:sugerencias', (event, { inputPath, accion }) => {
  const blocks = cutsState.get(inputPath);
  if (!blocks) return null;
  const fn = accion === 'aplicar' ? aplicarSugerencias
    : accion === 'descartar' ? descartarSugerencias
      : accion === 'desde-silencios' ? silenciosASugerencias
        : null;
  if (!fn) return null;
  const nuevos = fn(blocks);
  cutsState.set(inputPath, nuevos);
  const resumen = summarize(nuevos);
  actualizarProyecto(inputPath, { blocks: nuevos, resumen });
  return { blocks: nuevos, resumen, sugerencias: contarSugerencias(nuevos) };
});

// ============================================================
// MONTAJE — estado e IPC (06/08/2026)
// ============================================================
// Conecta src/shared/montaje.js, el modelo escrito despues de investigar
// como lo hacen OpenTimelineIO y MLT/Kdenlive: pista SECUENCIAL con
// huecos explicitos, tres rangos de tiempo y los cuatro modos de recorte.
//
// El HISTORIAL vive aca y no en la ventana: unica fuente de verdad, y
// sobrevive a cualquier redibujo del renderer.
const Montaje = require('../shared/montaje');
// DONDE va cada encuadre dentro del panel vertical. Es lo unico que
// quedo del trio recuadros/layout/geometria: `recuadros.js` se disolvio
// dentro de montaje.js (el encuadre es un clip de ajuste) y
// `geometria916.js` solo lo usa el renderer para dibujar.
const Layout916 = require('../shared/layout916');

const montajeState = new Map();   // inputPath -> historial de Montaje

// montajeUtilizable / montajeInicial / migrarAudioVinculado se mudaron a
// montajeGuardado.js (13/09/2026) para poder probarlos sin Electron: son
// los que deciden si un proyecto guardado abre con su edicion o se rearma.
const { montajeUtilizable, montajeInicial, migrarAudioVinculado, asegurarBaseDeCuadro, necesitaMedirFps } = require('./montajeGuardado');

// BUG CORREGIDO 06/08/2026 (reportado: "añadi un archivo y no salio
// nada"): la duracion venia del elemento <video> del visor, y el visor se
// borro. Sin duracion el modelo no puede crear el clip inicial, asi que
// la pista quedaba vacia y no aparecia nada.
// Ahora la mide el MAIN con ffprobe: es quien tiene acceso al archivo, y
// no deberia depender de que la ventana haya cargado un video primero.
// Por eso esta funcion es async y todos los handlers la esperan.
async function obtenerHistorialMontaje(inputPath) {
  let hist = montajeState.get(inputPath);
  if (!hist) {
    const proyecto = cargarProyecto(inputPath) || {};
    const guardado = proyecto.montaje;
    let fuente = null;
    if (!montajeUtilizable(guardado)) {
      // Un archivo ilegible no debe romper la app: se arma un montaje
      // vacio y la interfaz lo muestra sin clips.
      try { fuente = await probe(inputPath); } catch (e) { fuente = null; }
    }
    let m = migrarAudioVinculado(montajeInicial(inputPath, fuente, guardado));
    // Los encuadres guardados por la version vieja estaban en una lista
    // aparte (`proyecto.recuadros`) porque eran un sistema paralelo. Ahora
    // son elementos del montaje, asi que se pasan una sola vez - despues
    // el montaje ya los tiene y migrarRecuadros() no vuelve a tocar nada.
    m = Montaje.migrarRecuadros(m, proyecto.recuadros);
    // Base de cuadro (13/09/2026, tanda D): un proyecto guardado sin `fps`
    // se lleva a la grilla de cuadros UNA vez, al abrirlo, y va ULTIMO para
    // que tambien alinee los encuadres recien migrados. Si ningun material
    // guardado sabe su fps, se mide el archivo (antes solo se media para un
    // proyecto nuevo). La migracion entra como estado inicial del historial:
    // no es un paso que el user pueda deshacer, igual que las otras.
    if (!fuente && necesitaMedirFps(m)) {
      try { fuente = await probe(inputPath); } catch (e) { fuente = null; }
    }
    m = asegurarBaseDeCuadro(m, fuente);
    hist = Montaje.crearHistorial(m);
    montajeState.set(inputPath, hist);
  }
  return hist;
}

// --- DISPOSICION DEL PANEL 9:16 ---
// El layout dice DONDE va cada encuadre dentro del vertical. No vive en
// el montaje porque no es del montaje: es como se arma la pantalla de
// salida. Pero se sincroniza contra el, y los ids son los de los
// elementos de ajuste.
const layoutState = new Map();   // inputPath -> layout del panel 9:16

// De abajo hacia arriba, el mismo orden en que se apilan las pistas: es
// el que el user ve en la linea de tiempo, asi que es el que tiene que
// mandar en el panel.
function idsDeEncuadres(m) {
  const out = [];
  m.pistas.forEach((p) => p.elementos.forEach((el) => {
    if (Montaje.esAjuste(el)) out.push(el.id);
  }));
  return out;
}

function layoutDelPanel(inputPath, m) {
  const ids = idsDeEncuadres(m);
  let layout = layoutState.get(inputPath);
  if (!layout) layout = (cargarProyecto(inputPath) || {}).layout916 || Layout916.layoutVacio();
  // Los encuadres nuevos entran con lugar propio y los borrados dejan de
  // ocupar. Como esto corre en CADA respuesta, borrar un encuadre desde la
  // linea de tiempo reacomoda el panel solo.
  layout = Layout916.normalizar(layout, ids);
  layoutState.set(inputPath, layout);
  return { layout, ids };
}

// Respuesta unica para TODOS los handlers: la ventana recibe siempre lo
// mismo, asi no hay formas distintas que puedan divergir entre si.
function respuestaMontaje(inputPath, hist) {
  montajeState.set(inputPath, hist);
  const m = hist.presente;
  // La disposicion del panel 9:16 viaja EN LA MISMA respuesta. Antes iba
  // por el canal `recuadros:*`, y esa era la mitad del problema: la lista
  // de encuadres y el montaje eran dos estados que se actualizaban por
  // separado, asi que cualquier operacion que tocara uno dejaba al otro
  // viejo hasta que algo lo refrescara. Ahora los encuadres SON parte del
  // montaje y el layout se sincroniza contra ellos aca, una sola vez.
  const { layout, ids } = layoutDelPanel(inputPath, m);
  actualizarProyecto(inputPath, { montaje: m, layout916: layout });
  return {
    media: m.media,
    layout,
    diagnostico: Layout916.diagnostico(layout, ids),
    // El montaje CRUDO, para el visor (06/08/2026). El renderer carga el
    // mismo src/shared/montaje.js con un <script> y resuelve con
    // capaVisibleEn() que se ve en cada instante, sin un viaje de IPC por
    // cuadro. No es una excepcion a "la aritmetica vive en el main": es el
    // MISMO modulo en los dos lados, el patron que ya se habia usado con
    // geometria916.js para que el preview y la exportacion no divergieran.
    montaje: m,
    // Las pistas salen de ARRIBA hacia ABAJO, que es el orden en que se
    // dibujan: el array las guarda al reves (la ultima es la que tapa).
    pistas: m.pistas.slice().reverse().map((p) => ({
      id: p.id, tipo: p.tipo, nombre: p.nombre, visible: p.visible,
      // Sonido de la pista (tanda D). Van ya resueltos con sus valores por
      // defecto, asi el encabezado no tiene que saber de proyectos viejos.
      silenciada: Montaje.pistaSilenciada(p), ganancia: Montaje.gananciaDe(p),
      // Candado del ripple multipista (tanda E): la pista no se corre cuando
      // se borra con ripple, se cierra un vacio o se hace ripple en otra.
      bloqueada: Montaje.pistaBloqueada(p),
      elementos: Montaje.elementosDePista(m, p.id)
    })),
    duracion: Montaje.duracionMontaje(m),
    puedeDeshacer: Montaje.puedeDeshacer(hist),
    puedeRehacer: Montaje.puedeRehacer(hist)
  };
}

// async porque obtenerHistorialMontaje puede tener que medir el archivo
// con ffprobe la primera vez.
//
// `fn` devuelve el montaje nuevo, o el par [montaje, extra] cuando la
// operacion tiene algo que CONTAR ademas de cambiar el modelo (por
// ejemplo: "esto entro en una pista nueva"). El extra viaja en la misma
// respuesta para no inventar un segundo canal que diga lo mismo.
//
// La PODA va aca y no dentro de cada operacion (pedido del user: "si una
// pista se queda vacia se elimina"). Ponerla en un solo lugar es lo que
// garantiza que no haya operaciones que se olviden: borrar el ultimo clip,
// moverlo a otra pista y cerrar un hueco dejan una pista vacia por caminos
// distintos, y ninguno de los tres tiene por que saberlo.
// Corre ANTES de registrar en el historial, asi la pista que desaparece y
// el movimiento que la vacio son UN solo paso de deshacer.
async function operarMontaje(inputPath, fn) {
  const hist = await obtenerHistorialMontaje(inputPath);
  const salida = fn(hist.presente);
  const [m, extra] = Array.isArray(salida) ? salida : [salida, null];
  const res = respuestaMontaje(inputPath, Montaje.registrar(hist, Montaje.podarPistas(m)));
  return extra ? { ...res, ...extra } : res;
}

ipcMain.handle('montaje:obtener', async (event, { inputPath }) =>
  respuestaMontaje(inputPath, await obtenerHistorialMontaje(inputPath)));

ipcMain.handle('montaje:cortar', async (event, { inputPath, duracion, pistaId, tLinea, todas }) =>
  operarMontaje(inputPath, (m) =>
    (todas ? Montaje.cortarTodasEn(m, tLinea) : Montaje.cortarEn(m, pistaId, tLinea))));

// cerrar=false deja un hueco (Suprimir); cerrar=true corre lo de atras.
// RIPPLE MULTIPISTA (tanda E): lo que corre lo de atras devuelve ademas
// `ripple` = { bloqueo, corridas, ... }. Si otra pista tiene material en
// ese tramo la operacion no se hace (o se hace a medias) y la interfaz
// tiene que decir que pista la freno; si no, el user ve que "no paso nada".
ipcMain.handle('montaje:borrar', async (event, { inputPath, duracion, pistaId, elId, cerrar }) =>
  operarMontaje(inputPath, (m) => {
    if (!cerrar) return Montaje.borrar(m, pistaId, elId);
    const [salida, informe] = Montaje.borrarConRippleConInforme(m, pistaId, elId);
    return [salida, { ripple: informe }];
  }));

ipcMain.handle('montaje:cerrar-hueco', async (event, { inputPath, duracion, pistaId, elId }) =>
  operarMontaje(inputPath, (m) => {
    const [salida, informe] = Montaje.cerrarHuecoConInforme(m, pistaId, elId);
    return [salida, { ripple: informe }];
  }));

ipcMain.handle('montaje:unir', async (event, { inputPath, duracion, pistaId, elId }) =>
  operarMontaje(inputPath, (m) => Montaje.unirConSiguiente(m, pistaId, elId)));

// pistaDestino puede ser el id de una pista, null (se queda en la suya) o
// Montaje.PISTA_NUEVA: soltar el clip por encima de la pista mas alta
// CREA una y lo pone ahi, en un solo paso de historial.
// Devuelve ademas `movido` (13/09/2026, tanda B): si la pareja de sonido
// tuvo que irse a otra pista para no tapar audio ajeno, o si algun clip
// quedo separado de su pareja, la interfaz lo tiene que poder decir.
ipcMain.handle('montaje:mover', async (event, { inputPath, duracion, pistaId, elId, tLinea, pistaDestino }) =>
  operarMontaje(inputPath, (m) => {
    const [salida, informe] = Montaje.moverConInforme(m, pistaId, elId, tLinea, pistaDestino);
    return [salida, { movido: informe }];
  }));

// Los cuatro modos de recorte en un solo canal: el modo decide cual se
// aplica, para no multiplicar canales que hacen casi lo mismo.
ipcMain.handle('montaje:recortar', async (event, { inputPath, duracion, pistaId, elId, modo, borde, valor }) =>
  operarMontaje(inputPath, (m) => {
    // El roll recibe el BORDE (13/09/2026, tanda B): agarrado por la
    // izquierda mueve el corte de la izquierda. Si no hubo cambio se
    // avisa, para que la interfaz no diga "se movio el corte".
    if (modo === 'roll') {
      const salida = Montaje.roll(m, pistaId, elId, valor, borde);
      return salida === m ? [m, { sinCambio: true }] : salida;
    }
    if (modo === 'slip') return Montaje.slip(m, pistaId, elId, valor);
    if (modo === 'slide') return Montaje.slide(m, pistaId, elId, valor);
    // 'recorte' es el arrastre normal del borde: deja un vacio en vez de
    // correr todo lo de atras. 'ripple' sigue siendo la herramienta B.
    if (modo === 'recorte') return Montaje.recortar(m, pistaId, elId, borde, valor);
    const [salida, informe] = Montaje.rippleConInforme(m, pistaId, elId, borde, valor);
    return [salida, { ripple: informe }];
  }));

// SELECCION MULTIPLE (tanda G, paso 9): mover o borrar varios clips es UNA
// operacion y un solo paso de deshacer. refs = [{ pistaId, elId }].
ipcMain.handle('montaje:grupo', async (event, { inputPath, accion, refs, delta }) =>
  operarMontaje(inputPath, (m) => {
    if (accion === 'borrar') return Montaje.borrarGrupo(m, refs);
    const [salida, informe] = Montaje.moverGrupoConInforme(m, refs, delta);
    return [salida, { grupo: informe }];
  }));

// PUENTE TRANSCRIPCION -> MONTAJE (tanda H, paso 11). 'Aplicar cortes a
// la linea': los bloques 'cut' se sacan del montaje con ripple multipista,
// en UN paso de historial (operarMontaje registra una vez), y la respuesta
// trae el resumen para la interfaz. Es explicito y no automatico al marcar
// un bloque: aplicar 192 cortes sin que nadie lo pida ya resulto ilegible
// (CTX 7.11), y asi un Ctrl+Z los devuelve todos juntos.
// El material es el del archivo transcripto (misma ruta); si no esta (se
// reemplazo), no se toca nada y se avisa.
ipcMain.handle('montaje:aplicar-cortes', async (event, { inputPath }) => {
  const blocks = cutsState.get(inputPath) || (cargarProyecto(inputPath) || {}).blocks || [];
  return operarMontaje(inputPath, (m) => {
    const igual = (a, b) => path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();
    // Todos los materiales con esa ruta: el mismo archivo agregado dos veces
    // son dos media, y los clips pueden venir de cualquiera.
    const medias = m.media.filter((x) => igual(x.ruta, inputPath));
    if (!medias.length) return [m, { cortes: { sinMaterial: true } }];
    const rangos = rangosCortados(blocks, medias[0].disponibleIn || 0);
    const [salida, informe] = Montaje.aplicarCortesDeFuente(m, medias.map((x) => x.id), rangos);
    return [salida, { cortes: informe }];
  });
});

// LA ONDA de un material (tanda G, paso 10). Sale del propio archivo del
// material, primera pista de audio, en mono a 16 kHz (ver picosBridge.js).
// Devuelve la piramide, o null si el material no tiene audio. Se guarda en
// proyectos/<slug>/picos: la segunda vez no corre ffmpeg.
ipcMain.handle('media:picos', async (event, { inputPath, mediaId }) => {
  const hist = await obtenerHistorialMontaje(inputPath);
  const media = Montaje.mediaPorId(hist.presente, mediaId);
  if (!media || !media.ruta) return null;
  const dir = path.join(PROYECTOS_DIR, slugProyecto(inputPath));
  try {
    return await picosBridge.picosDeMaterial(dir, mediaId, media.ruta, settingsStore.ffmpegPath());
  } catch (e) {
    console.warn('[picos]', mediaId, e.message);
    return null;
  }
});

// Tamaño y posicion de un material sobre el lienzo. El visor dejo de ser
// un reproductor y paso a ser una base donde se apoyan las capas, asi que
// cada clip lleva su propia transformacion.
// `tLinea` (tanda F): si el clip esta animado, el cambio va a la clave del
// cuadro del cabezal (Montaje.transformar lo resuelve).
ipcMain.handle('montaje:transformar', async (event, { inputPath, duracion, pistaId, elId, cambios, tLinea }) =>
  operarMontaje(inputPath, (m) => Montaje.transformar(m, pistaId, elId, cambios, tLinea)));

// KEYFRAMES (tanda F, 1.4): poner, quitar o cambiar la curva de la clave del
// cuadro de tLinea, en un clip con material o en un encuadre. Un canal para
// las tres, como el recorte. Devuelve `clave` = lo que hay en ese cuadro
// despues, para que la interfaz no tenga que adivinarlo.
ipcMain.handle('montaje:clave', async (event, { inputPath, accion, pistaId, elId, tLinea, curva }) =>
  operarMontaje(inputPath, (m) => {
    let salida = m;
    if (accion === 'poner') salida = Montaje.ponerClave(m, pistaId, elId, tLinea);
    else if (accion === 'quitar') salida = Montaje.quitarClave(m, pistaId, elId, tLinea);
    else if (accion === 'curva') salida = Montaje.curvaDeClave(m, pistaId, elId, tLinea, curva);
    return [salida, { clave: Montaje.claveEn(salida, pistaId, elId, tLinea) }];
  }));

// Volumen de un clip y fps del montaje (13/09/2026, tanda D). Todavia sin
// control propio en la interfaz para los dos: el modelo y el canal quedan
// listos (ver impl-D.md, pendiente).
ipcMain.handle('montaje:volumen', async (event, { inputPath, pistaId, elId, volumen }) =>
  operarMontaje(inputPath, (m) => Montaje.ajustarVolumen(m, pistaId, elId, volumen)));

ipcMain.handle('montaje:fps', async (event, { inputPath, fps }) =>
  operarMontaje(inputPath, (m) => Montaje.fijarFps(m, fps)));

ipcMain.handle('montaje:pista', async (event, { inputPath, duracion, accion, pistaId, tipo, cambios, indice }) =>
  operarMontaje(inputPath, (m) => {
    // 'agregar' YA NO EXISTE (07/08/2026). Con la poda de pistas vacias
    // una pista recien creada se borraria en el mismo paso, asi que el
    // boton "+V" era una promesa que la app no podia cumplir. Las pistas
    // aparecen solas: colocarMedia() y colocarEncuadre() crean una cuando
    // no hay lugar, y las franjas "+ pista" la crean al soltar un clip.
    if (accion === 'actualizar') return Montaje.actualizarPista(m, pistaId, cambios);
    if (accion === 'mover') return Montaje.moverPista(m, pistaId, indice);
    return m;
  }));

// --- PONER MATERIAL EN LA LINEA (06/08/2026) ---
// BUG REAL REPORTADO: el user borro todos los clips y quedo sin salida.
// Habia handlers para cortar, borrar, mover y recortar, pero NINGUNO para
// poner material: una vez vacia la linea no se podia volver a llenar, ni
// reabriendo el proyecto (el montaje vacio se guarda y se reusa). El
// material nunca se habia perdido - seguia en montaje.media -, lo que
// faltaba era la puerta para traerlo de vuelta.
// El material BUSCA LUGAR (07/08/2026). Antes sobrescribia siempre en la
// primera pista, asi que poner dos clips en el mismo instante se comia el
// primero. Ahora colocarMedia() busca una pista libre y, si no hay,
// CREA una - que es lo que el user pidio para no tener que apretar
// "+V" antes de cada clip. `pistaId` sigue estando para forzar un
// destino concreto (ahi si tapa, porque el destino se eligio a mano).
ipcMain.handle('montaje:agregar-clip', async (event, { inputPath, mediaId, pistaId, tLinea }) =>
  operarMontaje(inputPath, (m) => {
    const [salida, info] = Montaje.colocarMedia(m, mediaId, tLinea, pistaId ? { pistaId } : null);
    if (!info) return m;
    return [salida, { colocado: info }];
  }));

// Suma OTRO archivo al material del proyecto, sin cambiar de proyecto.
// El modelo ya soportaba varios media desde el principio; lo que no habia
// era forma de agregarlos.
ipcMain.handle('montaje:agregar-media', async (event, { inputPath, ruta }) => {
  let fuente = null;
  try { fuente = await probe(ruta); } catch (e) { fuente = null; }
  return operarMontaje(inputPath, (m) => {
    const [nuevo] = Montaje.agregarMedia(m, {
      ruta,
      nombre: path.basename(ruta),
      tipo: (fuente && fuente.tieneVideo === false) ? 'audio' : 'video',
      duracion: (fuente && fuente.duracion) || 0,
      ancho: (fuente && fuente.ancho) || 0,
      alto: (fuente && fuente.alto) || 0,
      // ffprobe ya media los fps y se tiraban aca (13/09/2026): la
      // exportacion de video los necesita para decidir a cuantos cuadros
      // por segundo sale el mp4. Campo opcional, sin subir VERSION.
      fps: (fuente && fuente.fps) || 0,
      // Se mide una vez y se guarda: sin esto un video mudo bajaba igual
      // un clip a la pista de audio, y ahi quedaba un clip que no suena.
      tieneAudio: !fuente || fuente.tieneAudio !== false
    });
    return nuevo;
  });
});

// --- ENCUADRES 9:16 COMO ELEMENTOS DEL MONTAJE (07/08/2026) ---
// Reemplaza a los canales `recuadros:*`, que operaban sobre una lista
// aparte. Un encuadre es ahora un elemento de una pista, asi que para
// MOVERLO, CORTARLO, RECORTARLO o BORRARLO no hay canal propio: se usan
// los mismos que para cualquier clip. Aca queda solo lo que es especifico
// del ajuste - crearlo y cambiarle el rectangulo.
ipcMain.handle('montaje:encuadre', async (event, { inputPath, duracion, accion, pistaId, elId, tLinea, dur, rect }) =>
  operarMontaje(inputPath, (m) => {
    if (accion === 'crear') {
      // Sin tramo pedido, el encuadre dura TODO: al dibujar uno se espera
      // verlo en el visor vertical enseguida, no tener que buscar en que
      // segundo quedo. Para acotarlo estan las manijas del clip.
      const largo = dur > 0 ? dur : Math.max(Montaje.MIN_DUR, (duracion || 0) - (tLinea || 0));
      const [salida, info] = Montaje.colocarEncuadre(m, tLinea || 0, largo, rect);
      return [salida, { colocado: info }];
    }
    // Con tLinea, en un encuadre animado va a la clave de ese cuadro (tanda F).
    if (accion === 'ajustar') return Montaje.ajustarEncuadre(m, pistaId, elId, rect, tLinea);
    return m;
  }));

ipcMain.handle('montaje:deshacer', async (event, { inputPath }) =>
  respuestaMontaje(inputPath, Montaje.deshacer(await obtenerHistorialMontaje(inputPath))));

ipcMain.handle('montaje:rehacer', async (event, { inputPath }) =>
  respuestaMontaje(inputPath, Montaje.rehacer(await obtenerHistorialMontaje(inputPath))));

// ============================================================
// DISPOSICION DEL PANEL 9:16 (06/08/2026, reescrito el 07/08/2026)
// ============================================================
// Antes eran TRES modulos y DOS estados paralelos:
//   recuadros.js    QUE pedazo del frame y CUANDO esta activo
//   layout916.js    DONDE va cada uno dentro del panel vertical
//   geometria916.js el recorte "cover" en pixeles
// El primero se disolvio dentro de montaje.js: un encuadre es un clip de
// ajuste, asi que el "cuando" ya lo dice su lugar en la pista y el "que
// pedazo" es su campo `ajuste`. Con eso se fue el estado paralelo, que
// era lo que hacia que la linea de tiempo y el panel vertical pudieran
// contar cosas distintas.
//
// Queda un solo canal, y solo para la DISPOSICION: nada de crear, mover
// ni borrar encuadres aca - eso son operaciones de clip y van por
// `montaje:*`.
ipcMain.handle('layout916:operar', async (event, { inputPath, duracion, accion, id, idB, modo, encaje, x, y, esquina }) =>
  // Pasa por operarMontaje aunque no cambie el montaje: asi la ventana
  // recibe la respuesta completa (montaje + layout) por un solo camino.
  // Devolver el mismo montaje no deja paso de deshacer - registrar()
  // compara por identidad.
  operarMontaje(inputPath, (m) => {
    const ids = idsDeEncuadres(m);
    const actual = layoutDelPanel(inputPath, m).layout;
    let nuevo = null;
    if (accion === 'preset') nuevo = Layout916.aplicarPreset(actual, ids, modo);
    else if (accion === 'mover') nuevo = Layout916.moverCelda(actual, id, x, y);
    else if (accion === 'redimensionar') nuevo = Layout916.redimensionarCelda(actual, id, esquina, x, y);
    else if (accion === 'intercambiar') nuevo = Layout916.intercambiarCeldas(actual, id, idB);
    else if (accion === 'encajar') nuevo = Layout916.encajarCelda(actual, id, encaje);
    if (nuevo) layoutState.set(inputPath, nuevo);
    return m;
  }));

// --- Pantalla de inicio: proyectos guardados ---
// Se reponen tras el borrado del 06/08: los handlers viejos cargaban
// tambien recuadros, disposicion 9:16 y recorte, que ya no existen.
// Ahora solo restauran lo que sobrevive (bloques de corte), y el resto
// lo aportara la linea de tiempo nueva cuando este.
ipcMain.handle('proyectos:listar', () => listarProyectos());

ipcMain.handle('proyectos:abrir', (event, inputPath) => {
  const data = cargarProyecto(inputPath);
  if (!data) return null;
  cutsState.set(inputPath, data.blocks || []);
  montajeState.delete(inputPath);   // se rearma del proyecto al pedirlo
  return data;
});

ipcMain.handle('keys:listar', () => listarKeysSeguras(app));
ipcMain.handle('keys:guardar', (event, { nombre, valor }) => guardarKey(app, { nombre, valor }));
ipcMain.handle('keys:eliminar', (event, id) => eliminarKey(app, id));

// Tiene que correr ANTES de whenReady: Electron congela la tabla de
// esquemas al arrancar y despues ya no acepta privilegios nuevos.
protocoloMedia.registrarEsquema();

app.whenReady().then(() => {
  settingsStore.inicializar(app);
  protocoloMedia.registrarManejador();
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Un export a medias no deja descriptores abiertos ni un .parcial suelto.
  escritorExport.cerrarTodos();
  if (process.platform !== 'darwin') app.quit();
});
