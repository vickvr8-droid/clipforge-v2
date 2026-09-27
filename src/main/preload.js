// Puente seguro entre el proceso principal y la interfaz web.
//
// 06/08/2026: se borraron todos los puentes de LINEA DE TIEMPO y VISORES
// (recuadros, disposicion 9:16, pista/montaje, miniaturas, recorte,
// exportacion de video) porque ese subsistema se rehace de cero. Copia
// del estado anterior en E:\Clipforge2. Lo que queda es lo que no era
// timeline ni visor: elegir archivo, transcribir, bloques de corte,
// analisis con IA, proyectos y keys.

const { contextBridge, ipcRenderer } = require('electron');

// Convierte una ruta local (Windows, con espacios/backslashes) a una URL
// file:// valida para un <video> o <img>. CORREGIDO 28/07/2026: no usar
// require('url').pathToFileURL aca - con contextIsolation el preload
// sandboxeado de Electron resuelve 'url' al shim de navegador (sin
// pathToFileURL, que es una extension especifica de Node), y tira
// "pathToFileURL is not a function" en runtime. Se construye a mano en
// vez de depender de ese modulo.
function rutaAFileUrl(rutaLocal) {
  let ruta = String(rutaLocal).replace(/\\/g, '/');
  if (!ruta.startsWith('/')) ruta = '/' + ruta;
  return 'file://' + encodeURI(ruta).replace(/#/g, '%23');
}

// Para el DECODIFICADOR (mediabunny), no para el <video>. El <video> sigue
// con file://, que Chromium sabe leer por pedazos internamente; lo que no
// se puede es pedir file:// con fetch, y mediabunny usa fetch. Ver
// src/main/protocoloMedia.js.
//
// Se duplica el armado de la URL en vez de importar el modulo del main:
// el preload no puede require() nada de electron mas alla de lo suyo, y
// meter un ipcRenderer.invoke por cada archivo seria un viaje de ida y
// vuelta para concatenar dos strings. La contraparte que la deshace esta
// en protocoloMedia.rutaDesdeUrl().
// El host fijo "archivo" NO es decorativo: el esquema esta registrado como
// `standard`, y una ruta de Windows en el lugar del host hace que fetch
// falle con "Failed to parse URL" antes de llegar al main.
function rutaAMediaUrl(rutaLocal) {
  return 'cf-media://archivo/' + encodeURIComponent(String(rutaLocal));
}

contextBridge.exposeInMainWorld('clipForge', {
  version: '0.1.0',
  rutaAFileUrl,
  rutaAMediaUrl,

  // --- Archivo y transcripcion ---
  elegirArchivo: () => ipcRenderer.invoke('elegir-archivo'),
  transcribir: (inputPath, motor) => ipcRenderer.invoke('transcribir', { inputPath, motor }),

  // --- Bloques de corte (transcripcion + silencios) ---
  cortesToggle: (inputPath, blockId) => ipcRenderer.invoke('cortes:toggle', { inputPath, blockId }),
  cortesCortarRango: (inputPath, inicio, fin) => ipcRenderer.invoke('cortes:cortar-rango', { inputPath, inicio, fin }),
  cortesRestaurarRango: (inputPath, inicio, fin) => ipcRenderer.invoke('cortes:restaurar-rango', { inputPath, inicio, fin }),
  cortesSugerencias: (inputPath, accion) => ipcRenderer.invoke('cortes:sugerencias', { inputPath, accion }),

  // --- Exportacion de DATOS (sigue funcionando; la de video se rehace) ---
  cortesExportarJson: (inputPath) => ipcRenderer.invoke('cortes:exportar-json', inputPath),
  cortesExportarSrt: (inputPath) => ipcRenderer.invoke('cortes:exportar-srt', inputPath),
  cortesExportarTranscripcion: (inputPath, soloKeep) => ipcRenderer.invoke('cortes:exportar-transcripcion', { inputPath, soloKeep }),
  cortesExportarTranscripcionPlana: (inputPath) => ipcRenderer.invoke('cortes:exportar-transcripcion-plana', inputPath),

  // --- Analisis con IA ---
  analizarIA: (payload) => ipcRenderer.invoke('analizar-ia:ejecutar', payload),

  // --- Montaje (linea de tiempo) ---
  // Todos devuelven lo mismo: { media, pistas[{id,tipo,nombre,visible,
  // elementos}], duracion, puedeDeshacer, puedeRehacer }. Las pistas
  // vienen de ARRIBA hacia ABAJO, listas para dibujar.
  montajeObtener: (inputPath, duracion) => ipcRenderer.invoke('montaje:obtener', { inputPath, duracion }),
  montajeCortar: (inputPath, duracion, pistaId, tLinea, todas) => ipcRenderer.invoke('montaje:cortar', { inputPath, duracion, pistaId, tLinea, todas }),
  montajeBorrar: (inputPath, duracion, pistaId, elId, cerrar) => ipcRenderer.invoke('montaje:borrar', { inputPath, duracion, pistaId, elId, cerrar }),
  montajeCerrarHueco: (inputPath, duracion, pistaId, elId) => ipcRenderer.invoke('montaje:cerrar-hueco', { inputPath, duracion, pistaId, elId }),
  montajeUnir: (inputPath, duracion, pistaId, elId) => ipcRenderer.invoke('montaje:unir', { inputPath, duracion, pistaId, elId }),
  montajeGrupo: (inputPath, accion, refs, delta) => ipcRenderer.invoke('montaje:grupo', { inputPath, accion, refs, delta }),
  montajeAplicarCortes: (inputPath) => ipcRenderer.invoke('montaje:aplicar-cortes', { inputPath }),
  mediaPicos: (inputPath, mediaId) => ipcRenderer.invoke('media:picos', { inputPath, mediaId }),
  montajeMover: (inputPath, duracion, pistaId, elId, tLinea, pistaDestino) => ipcRenderer.invoke('montaje:mover', { inputPath, duracion, pistaId, elId, tLinea, pistaDestino }),
  // modo: 'ripple' | 'roll' | 'slip' | 'slide'
  montajeRecortar: (inputPath, duracion, pistaId, elId, modo, borde, valor) => ipcRenderer.invoke('montaje:recortar', { inputPath, duracion, pistaId, elId, modo, borde, valor }),
  montajePista: (inputPath, duracion, accion, opciones) => ipcRenderer.invoke('montaje:pista', { inputPath, duracion, accion, ...(opciones || {}) }),
  // Tamaño y posicion de un material sobre el lienzo del visor.
  // tLinea (tanda F): en un clip animado el cambio va a la clave de ese cuadro.
  montajeTransformar: (inputPath, duracion, pistaId, elId, cambios, tLinea) => ipcRenderer.invoke('montaje:transformar', { inputPath, duracion, pistaId, elId, cambios, tLinea }),
  // Keyframes (tanda F): accion 'poner' | 'quitar' | 'curva'.
  montajeClave: (inputPath, accion, pistaId, elId, tLinea, curva) => ipcRenderer.invoke('montaje:clave', { inputPath, accion, pistaId, elId, tLinea, curva }),
  montajeVolumen: (inputPath, pistaId, elId, volumen) => ipcRenderer.invoke('montaje:volumen', { inputPath, pistaId, elId, volumen }),
  montajeFps: (inputPath, fps) => ipcRenderer.invoke('montaje:fps', { inputPath, fps }),
  // Panel multimedia -> linea de tiempo. Sin estos dos, borrar todos los
  // clips dejaba el proyecto sin salida (bug reportado 06/08/2026).
  montajeAgregarClip: (inputPath, mediaId, pistaId, tLinea) => ipcRenderer.invoke('montaje:agregar-clip', { inputPath, mediaId, pistaId, tLinea }),
  montajeAgregarMedia: (inputPath, ruta) => ipcRenderer.invoke('montaje:agregar-media', { inputPath, ruta }),
  // Encuadre 9:16 = clip de AJUSTE dentro de una pista normal. Solo hay
  // canal para crearlo y para cambiarle el rectangulo: moverlo, cortarlo,
  // recortarlo y borrarlo son las operaciones de cualquier clip.
  montajeEncuadre: (inputPath, duracion, accion, opciones) => ipcRenderer.invoke('montaje:encuadre', { inputPath, duracion, accion, ...(opciones || {}) }),
  montajeDeshacer: (inputPath, duracion) => ipcRenderer.invoke('montaje:deshacer', { inputPath, duracion }),
  montajeRehacer: (inputPath, duracion) => ipcRenderer.invoke('montaje:rehacer', { inputPath, duracion }),

  // --- Disposicion del panel vertical 9:16 ---
  // Los canales `recuadros:*` se fueron el 07/08/2026: un encuadre es un
  // clip de ajuste dentro del montaje, asi que crearlo, moverlo, cortarlo
  // y borrarlo van por `montaje:*` como cualquier clip. Aca queda solo
  // DONDE se acomoda cada uno dentro del panel vertical.
  // Devuelve la respuesta completa del montaje, con `layout` adentro.
  layout916: (inputPath, duracion, accion, opciones) => ipcRenderer.invoke('layout916:operar', { inputPath, duracion, accion, ...(opciones || {}) }),

  // --- Proyectos guardados ---
  proyectosListar: () => ipcRenderer.invoke('proyectos:listar'),
  proyectosAbrir: (inputPath) => ipcRenderer.invoke('proyectos:abrir', inputPath),

  // --- Ajustes de exportacion (rutas de binarios, calidad) ---
  exportAjustesObtener: () => ipcRenderer.invoke('export:ajustes-obtener'),
  exportAjustesGuardar: (cambios) => ipcRenderer.invoke('export:ajustes-guardar', cambios),

  // --- Exportacion de VIDEO (13/09/2026) ---
  // El bucle corre en la ventana (exportVideo.js); el main pregunta donde
  // guardar y escribe los pedazos del mp4 en su POSICION. Ver
  // src/main/escritorExport.js.
  exportVideoAbrir: (inputPath, sufijo) => ipcRenderer.invoke('export-video:abrir', { inputPath, sufijo }),
  exportVideoEscribir: (id, posicion, datos) => ipcRenderer.invoke('export-video:escribir', { id, posicion, datos }),
  exportVideoCerrar: (id, ok) => ipcRenderer.invoke('export-video:cerrar', { id, ok }),

  // --- Keys de proveedores externos ---
  keysListar: () => ipcRenderer.invoke('keys:listar'),
  keysGuardar: (nombre, valor) => ipcRenderer.invoke('keys:guardar', { nombre, valor }),
  keysEliminar: (id) => ipcRenderer.invoke('keys:eliminar', id),

  // --- Config del motor de transcripcion en la nube ---
  nubeObtener: () => ipcRenderer.invoke('nube:obtener'),
  nubeGuardar: (cambios) => ipcRenderer.invoke('nube:guardar', cambios),

  // --- Eventos que manda el main sin que el renderer los pida ---
  onProgreso: (callback) => {
    ipcRenderer.on('transcripcion-progreso', (event, data) => callback(data));
  }
});
