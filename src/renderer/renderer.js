let archivoActual = null;
let bloquesActuales = [];

const btnElegir = document.getElementById('btnElegir');
const btnTranscribir = document.getElementById('btnTranscribir');
const selectorMotor = document.getElementById('selectorMotor');
const archivoElegido = document.getElementById('archivoElegido');
const estado = document.getElementById('estado');
const transcripcionDiv = document.getElementById('transcripcion');
const resumenCortes = document.getElementById('resumenCortes');
const botonesExport = document.getElementById('botonesExport');
const btnExportJson = document.getElementById('btnExportJson');
const btnExportSrt = document.getElementById('btnExportSrt');
const panelIA = document.getElementById('panelIA');
const selectorBackendIA = document.getElementById('selectorBackendIA');
const inputModeloIA = document.getElementById('inputModeloIA');
const selectorKeyIA = document.getElementById('selectorKeyIA');
const inputInstruccionesIA = document.getElementById('inputInstruccionesIA');
const inputSystemPromptIA = document.getElementById('inputSystemPromptIA');
const btnAnalizarIA = document.getElementById('btnAnalizarIA');
const estadoIA = document.getElementById('estadoIA');
const visorContainer = document.getElementById('visorContainer');
const videoPreview = document.getElementById('videoPreview');
const tiempoTexto = document.getElementById('tiempoTexto');
const contadorCortesTL = document.getElementById('contadorCortesTL');
const timelineBlocks = document.getElementById('timelineBlocks');
const playhead = document.getElementById('playhead');
const videoWrap = document.getElementById('videoWrap');
const recuadrosOverlay = document.getElementById('recuadrosOverlay');
const btnModoRecuadro = document.getElementById('btnModoRecuadro');
const btnLimpiarRecuadros = document.getElementById('btnLimpiarRecuadros');
const canvas916 = document.getElementById('canvas916');
const ctx916 = canvas916.getContext('2d');
const divisores916 = document.getElementById('divisores916');
const celdasLibres916 = document.getElementById('celdasLibres916');
const selectLayout916Modo = document.getElementById('selectLayout916Modo');
const btnDistribuir916 = document.getElementById('btnDistribuir916');
const pantallaInicio = document.getElementById('pantallaInicio');
const pantallaTrabajo = document.getElementById('pantallaTrabajo');
const listaProyectos = document.getElementById('listaProyectos');
const btnNuevoProyecto = document.getElementById('btnNuevoProyecto');
const btnVolverProyectos = document.getElementById('btnVolverProyectos');

// Estado de UI para dibujar/mover/redimensionar recuadros sobre el
// overlay. Los recuadros en si YA NO viven en una variable global fija
// - viven en clipsActuales (array plano de clips independientes, ver
// mas abajo "Recuadros = CLIPS independientes con pista propia").
let modoDibujo = false;
let dragInicio = null;
let dragEl = null;
// Estado de arrastre para MOVER un recuadro ya existente (distinto del
// arrastre de dibujar uno nuevo, arriba). Se activa con mousedown sobre un
// ".recuadro" ya puesto, independiente de si modoDibujo esta activo o no.
let moverState = null;
// Estado de arrastre para REDIMENSIONAR un recuadro desde una esquina
// (pedido 29/07/2026). "anchorX/anchorY" es la esquina OPUESTA a la que se
// esta arrastrando, se mantiene fija durante todo el arrastre.
let resizeState = null;

// --- Recuadros = CLIPS independientes con pista propia (rediseño
// 29/07/2026, pedido del user viendo una referencia de DaVinci Resolve).
// Reemplaza el modelo viejo de "tramos" (donde todos los recuadros de un
// tramo compartian obligatoriamente el mismo start/end). Ahora cada
// clip {id, start, end, track, xPct, yPct, wPct, hPct} es independiente:
// tiempo propio, se puede mover/estirar en la linea de tiempo con el
// mouse, y subirlo de pista genera una pista nueva SOLO si hace falta
// (no hay limite fijo de pistas). La fuente de verdad vive en el main
// process (cropLayoutsBuilder.js via IPC) - aca se guarda una copia
// local para pintar la UI.
let clipsActuales = [];        // array PLANO de clips (ya no agrupados por tramo)
let clipSeleccionadoId = null; // ultimo clip clickeado en la timeline (resalte visual)
let clipsActivosIdsPrev = [];  // para no re-renderizar el overlay del video en cada tick, solo cuando cambia el set de clips activos

const layoutTimelineWrap = document.getElementById('layoutTimelineWrap');
const layoutTimelineBands = document.getElementById('layoutTimelineBands');
const clipsTracksRows = document.getElementById('clipsTracksRows');
const btnExportarLayoutsJson = document.getElementById('btnExportarLayoutsJson');
const timelineMaestraWrap = document.getElementById('timelineMaestraWrap');
const timelineScrollWrap = document.getElementById('timelineScrollWrap');
const btnZoomOut = document.getElementById('btnZoomOut');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomReset = document.getElementById('btnZoomReset');
const zoomNivelTexto = document.getElementById('zoomNivelTexto');
const btnMarcarInicio = document.getElementById('btnMarcarInicio');
const btnMarcarFin = document.getElementById('btnMarcarFin');
const btnRestablecerRecorte = document.getElementById('btnRestablecerRecorte');
const chkLimitarRecorte = document.getElementById('chkLimitarRecorte');
const recorteTexto = document.getElementById('recorteTexto');
const trimOverlayIzq = document.getElementById('trimOverlayIzq');
const trimOverlayDer = document.getElementById('trimOverlayDer');
const trimHandleIn = document.getElementById('trimHandleIn');
const trimHandleOut = document.getElementById('trimHandleOut');

// --- Zoom de la linea de tiempo maestra (pedido 31/07/2026) ---
// zoomTimeline = factor multiplicador sobre el 100% del ancho visible.
// Como TODO lo que se dibuja adentro de #timelineMaestraWrap ya usa %
// (bloques, cobertura, pistas, playhead, recorte), agrandar el ancho
// real del wrapper (style.width) alcanza para que todo escale solo, sin
// tocar ninguna funcion de render existente.
let zoomTimeline = 1;
const ZOOM_MIN = 1, ZOOM_MAX = 40;

// --- Recorte / rango de trabajo del video (pedido 31/07/2026) ---
// fin=0 significa "todavia sin definir" (se completa con la duracion
// real del video en loadedmetadata) - asi un proyecto nuevo arranca
// mostrando el video completo, no un recorte de 0 segundos.
let trimActual = { inicio: 0, fin: 0, activo: false };
let trimDragState = null; // { cual: 'in'|'out', containerWidth, left } mientras se arrastra una manija

// Clips activos en el instante t, ordenados por pista (track 0 primero =
// arriba en el visor 9:16 y en el overlay del video) - misma logica que
// clipsEnInstante() de cropLayoutsBuilder.js, duplicada aca porque el
// renderer no tiene acceso directo a los modulos de main (mismo patron
// ya usado con summarize()).
function clipsEnInstanteLocal(t) {
  return clipsActuales.filter((c) => t >= c.start && t < c.end).sort((a, b) => a.track - b.track);
}

// --- Disposicion de celdas del visor 9:16 (30/07/2026) - copia local de
// las funciones puras de cropLayoutsBuilder.js, mismo motivo que
// clipsEnInstanteLocal de arriba (el renderer no puede hacer require()
// de modulos de main). El arbol en si (layoutActual916) SIEMPRE viene
// del main process via IPC - aca solo se lee/dibuja/edita en memoria
// entre un IPC y el siguiente, para que arrastrar un divisor se sienta
// instantaneo sin esperar la ida y vuelta en cada mousemove. ---
let layoutActual916 = null;     // arbol de cortes vigente para claveActualLayout916
// claveActualLayout916 (30/07/2026, pedido del user: que cada combinacion
// especifica de recuadros activos tenga su propio modo, no que se
// comparta por CANTIDAD - antes esto era un numero "n" = cantidad de
// recuadros activos, ahora es un string identidad = ids ordenados de los
// recuadros activos ahora mismo, joineados con ",", ej. "c123_1,c124_2".
// Asi 2 momentos con la MISMA cantidad pero recuadros DISTINTOS ya no
// comparten disposicion - cada combinacion puntual guarda la suya.
let claveActualLayout916 = '';
let cantidadActualLayout916 = 0; // cantidad de recuadros activos - sigue haciendo falta para armar el arbol por defecto (cuantas hojas tiene)
let arrastreDivisor916 = null;  // { path, dir } mientras se arrastra una manija

function calcularLayoutLocal(tree, x = 0, y = 0, w = 1, h = 1, path = []) {
  if (!tree) return { celdas: [], divisores: [] };
  if (tree.tipo === 'hoja') {
    if (tree.libre) return { celdas: [{ pos: tree.pos, ...tree.libre, libre: true }], divisores: [] };
    return { celdas: [{ pos: tree.pos, x, y, w, h }], divisores: [] };
  }
  let rectA, rectB;
  if (tree.dir === 'fila') {
    const hA = h * tree.ratio;
    rectA = { x, y, w, h: hA };
    rectB = { x, y: y + hA, w, h: h - hA };
  } else {
    const wA = w * tree.ratio;
    rectA = { x, y, w: wA, h };
    rectB = { x: x + wA, y, w: w - wA, h };
  }
  const ra = calcularLayoutLocal(tree.a, rectA.x, rectA.y, rectA.w, rectA.h, [...path, 'a']);
  const rb = calcularLayoutLocal(tree.b, rectB.x, rectB.y, rectB.w, rectB.h, [...path, 'b']);
  const divisor = {
    path, dir: tree.dir,
    x: tree.dir === 'columna' ? rectA.x + rectA.w : x,
    y: tree.dir === 'fila' ? rectA.y + rectA.h : y
  };
  return { celdas: [...ra.celdas, ...rb.celdas], divisores: [divisor, ...ra.divisores, ...rb.divisores] };
}

function rectDelNodoLocal(tree, path, x = 0, y = 0, w = 1, h = 1) {
  if (!path.length || !tree) return { x, y, w, h };
  const [paso, ...resto] = path;
  if (tree.dir === 'fila') {
    const hA = h * tree.ratio;
    return paso === 'a' ? rectDelNodoLocal(tree.a, resto, x, y, w, hA) : rectDelNodoLocal(tree.b, resto, x, y + hA, w, h - hA);
  }
  const wA = w * tree.ratio;
  return paso === 'a' ? rectDelNodoLocal(tree.a, resto, x, y, wA, h) : rectDelNodoLocal(tree.b, resto, x + wA, y, w - wA, h);
}

function nodoEnPathLocal(tree, path) {
  let nodo = tree;
  for (const paso of path) nodo = nodo && nodo[paso];
  return nodo;
}

function actualizarRatioEnPathLocal(tree, path, nuevoRatio) {
  const limitado = Math.min(0.9, Math.max(0.1, nuevoRatio));
  if (!path.length) return { ...tree, ratio: limitado };
  const [paso, ...resto] = path;
  return { ...tree, [paso]: actualizarRatioEnPathLocal(tree[paso], resto, limitado) };
}

// --- Celdas "Libre" del visor 9:16 (30/07/2026) - copia local de
// moverCeldaLibre/redimensionarCeldaLibre de cropLayoutsBuilder.js,
// mismo motivo/patron que el resto de las funciones "Local" de arriba.
const MIN_LIBRE_916 = 0.08;
let moverState916 = null;     // { pos, rectLeft, rectTop, rectW, rectH, startClientX, startClientY, startX, startY }
let resizeState916 = null;    // { pos, esquina, rectLeft, rectTop, rectW, rectH }

function moverCeldaLibreLocal(tree, pos, xPct, yPct) {
  if (!tree) return tree;
  if (tree.tipo === 'hoja') {
    if (tree.pos !== pos || !tree.libre) return tree;
    const { w, h } = tree.libre;
    const x = Math.min(Math.max(0, 1 - w), Math.max(0, xPct));
    const y = Math.min(Math.max(0, 1 - h), Math.max(0, yPct));
    return { ...tree, libre: { ...tree.libre, x, y } };
  }
  return { ...tree, a: moverCeldaLibreLocal(tree.a, pos, xPct, yPct), b: moverCeldaLibreLocal(tree.b, pos, xPct, yPct) };
}

function redimensionarCeldaLibreLocal(tree, pos, esquina, xPct, yPct) {
  if (!tree) return tree;
  if (tree.tipo === 'hoja') {
    if (tree.pos !== pos || !tree.libre) return tree;
    const r = tree.libre;
    const anchorX = esquina.includes('l') ? r.x + r.w : r.x;
    const anchorY = esquina.includes('t') ? r.y + r.h : r.y;
    const mx = Math.min(1, Math.max(0, xPct));
    const my = Math.min(1, Math.max(0, yPct));
    let x = Math.min(anchorX, mx), x2 = Math.max(anchorX, mx);
    let y = Math.min(anchorY, my), y2 = Math.max(anchorY, my);
    let w = Math.max(MIN_LIBRE_916, x2 - x);
    let h = Math.max(MIN_LIBRE_916, y2 - y);
    if (x + w > 1) x = 1 - w;
    if (y + h > 1) y = 1 - h;
    return { ...tree, libre: { x, y, w, h } };
  }
  return { ...tree, a: redimensionarCeldaLibreLocal(tree.a, pos, esquina, xPct, yPct), b: redimensionarCeldaLibreLocal(tree.b, pos, esquina, xPct, yPct) };
}

// Pide al main el arbol vigente para la combinacion puntual de recuadros
// activos identificada por "clave" (ids ordenados joineados, ver arriba)
// - lo arma con el default si es la primera vez que se ve esa clave - y
// re-dibuja todo. "cantidad" viaja aparte porque el main la necesita para
// armar el arbol por defecto (cuantas hojas tiene), la clave sola no
// alcanza para eso sin parsearla.
async function sincronizarLayout916(clave, cantidad) {
  claveActualLayout916 = clave;
  cantidadActualLayout916 = cantidad;
  if (!clave || !archivoActual) { layoutActual916 = null; renderDivisores916(); renderCeldasLibres916(); dibujarCanvas916(); return; }
  const arbol = await window.clipForge.layout916Obtener(archivoActual, clave, cantidad);
  // Puede haber cambiado la clave mientras esperabamos la respuesta (el
  // video sigue reproduciendose) - si ya no corresponde, descartar.
  if (claveActualLayout916 !== clave) return;
  layoutActual916 = arbol;
  renderDivisores916();
  renderCeldasLibres916();
  dibujarCanvas916();
}

// Dibuja las manijas de arrastre entre celdas vecinas, superpuestas al
// canvas916 (ver #divisores916 en index.html) - una franja fina que se
// resalta al pasar el mouse, mas facil de agarrar que la linea exacta.
const GROSOR_DIVISOR_916 = 10; // px de zona de agarre, centrada en la linea
function renderDivisores916() {
  if (!divisores916) return;
  if (!layoutActual916) { divisores916.innerHTML = ''; return; }
  const { divisores } = calcularLayoutLocal(layoutActual916);
  divisores916.innerHTML = divisores.map((d, i) => {
    const esFila = d.dir === 'fila';
    const style = esFila
      ? `left:0%; top:${d.y * 100}%; width:100%; height:${GROSOR_DIVISOR_916}px; margin-top:${-GROSOR_DIVISOR_916 / 2}px; cursor:row-resize;`
      : `left:${d.x * 100}%; top:0%; width:${GROSOR_DIVISOR_916}px; height:100%; margin-left:${-GROSOR_DIVISOR_916 / 2}px; cursor:col-resize;`;
    return `<div class="divisor916" data-idx="${i}" style="${style}"></div>`;
  }).join('');
  divisores916.querySelectorAll('.divisor916').forEach((el) => {
    const d = divisores[Number(el.dataset.idx)];
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      arrastreDivisor916 = { path: d.path, dir: d.dir };
      el.classList.add('arrastrando');
    });
  });
}

// Dibuja las celdas en modo "Libre" (30/07/2026) como cajas HTML
// arrastrables/redimensionables encima del canvas916 - mismo patron
// visual y de interaccion que .recuadro/.rHandle del visor 16:9.
function renderCeldasLibres916() {
  if (!celdasLibres916) return;
  if (!layoutActual916) { celdasLibres916.innerHTML = ''; return; }
  const { celdas } = calcularLayoutLocal(layoutActual916);
  const libres = celdas.filter((c) => c.libre);
  if (!libres.length) { celdasLibres916.innerHTML = ''; return; }
  celdasLibres916.innerHTML = libres.map((c) => `
    <div class="celdaLibre916" data-pos="${c.pos}" style="left:${c.x * 100}%; top:${c.y * 100}%; width:${c.w * 100}%; height:${c.h * 100}%;">
      <div class="cHandle916 tl" data-esquina="tl"></div>
      <div class="cHandle916 tr" data-esquina="tr"></div>
      <div class="cHandle916 bl" data-esquina="bl"></div>
      <div class="cHandle916 br" data-esquina="br"></div>
    </div>
  `).join('');
  celdasLibres916.querySelectorAll('.celdaLibre916').forEach((el) => {
    const pos = Number(el.dataset.pos);
    el.addEventListener('mousedown', (ev) => {
      if (ev.target.classList.contains('cHandle916')) return; // lo maneja el handle, no el cuerpo
      ev.preventDefault();
      const rect = canvas916.getBoundingClientRect();
      const celda = celdas.find((c) => c.pos === pos);
      if (!celda || rect.width <= 0 || rect.height <= 0) return;
      moverState916 = {
        pos, rectLeft: rect.left, rectTop: rect.top, rectW: rect.width, rectH: rect.height,
        startClientX: ev.clientX, startClientY: ev.clientY, startX: celda.x, startY: celda.y
      };
      el.classList.add('moviendo916');
    });
    el.querySelectorAll('.cHandle916').forEach((handle) => {
      handle.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rect = canvas916.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        resizeState916 = { pos, esquina: handle.dataset.esquina, rectLeft: rect.left, rectTop: rect.top, rectW: rect.width, rectH: rect.height };
        el.classList.add('redimensionando916');
      });
    });
  });
}

window.addEventListener('mousemove', (ev) => {
  if (!arrastreDivisor916 || !layoutActual916) return;
  const rect = canvas916.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const rectPadre = rectDelNodoLocal(layoutActual916, arrastreDivisor916.path);
  let nuevoRatio;
  if (arrastreDivisor916.dir === 'fila') {
    const yRel = (ev.clientY - rect.top) / rect.height;
    nuevoRatio = (yRel - rectPadre.y) / rectPadre.h;
  } else {
    const xRel = (ev.clientX - rect.left) / rect.width;
    nuevoRatio = (xRel - rectPadre.x) / rectPadre.w;
  }
  layoutActual916 = actualizarRatioEnPathLocal(layoutActual916, arrastreDivisor916.path, nuevoRatio);
  dibujarCanvas916();
  renderDivisores916();
});

window.addEventListener('mouseup', async () => {
  if (!arrastreDivisor916) return;
  const { path } = arrastreDivisor916;
  arrastreDivisor916 = null;
  divisores916.querySelectorAll('.divisor916.arrastrando').forEach((el) => el.classList.remove('arrastrando'));
  if (!archivoActual || !layoutActual916) return;
  const nodo = nodoEnPathLocal(layoutActual916, path);
  if (!nodo) return;
  const confirmado = await window.clipForge.layout916Ratio(archivoActual, claveActualLayout916, cantidadActualLayout916, path, nodo.ratio);
  if (confirmado) { layoutActual916 = confirmado; dibujarCanvas916(); renderDivisores916(); renderCeldasLibres916(); }
});

// Arrastre de una celda "libre" (mover el cuerpo entero).
window.addEventListener('mousemove', (ev) => {
  if (!moverState916 || !layoutActual916) return;
  const s = moverState916;
  const dxPct = (ev.clientX - s.startClientX) / s.rectW;
  const dyPct = (ev.clientY - s.startClientY) / s.rectH;
  layoutActual916 = moverCeldaLibreLocal(layoutActual916, s.pos, s.startX + dxPct, s.startY + dyPct);
  dibujarCanvas916();
  renderCeldasLibres916();
});

// Redimensionar una celda "libre" desde una de sus 4 esquinas.
window.addEventListener('mousemove', (ev) => {
  if (!resizeState916 || !layoutActual916) return;
  const s = resizeState916;
  const xPct = (ev.clientX - s.rectLeft) / s.rectW;
  const yPct = (ev.clientY - s.rectTop) / s.rectH;
  layoutActual916 = redimensionarCeldaLibreLocal(layoutActual916, s.pos, s.esquina, xPct, yPct);
  dibujarCanvas916();
  renderCeldasLibres916();
});

window.addEventListener('mouseup', async () => {
  if (moverState916) {
    const { pos } = moverState916;
    moverState916 = null;
    celdasLibres916.querySelectorAll('.celdaLibre916.moviendo916').forEach((el) => el.classList.remove('moviendo916'));
    if (archivoActual && layoutActual916) {
      const { celdas } = calcularLayoutLocal(layoutActual916);
      const celda = celdas.find((c) => c.pos === pos);
      if (celda) {
        const confirmado = await window.clipForge.layout916LibreMover(archivoActual, claveActualLayout916, cantidadActualLayout916, pos, celda.x, celda.y);
        if (confirmado) { layoutActual916 = confirmado; dibujarCanvas916(); renderCeldasLibres916(); }
      }
    }
  }
  if (resizeState916) {
    const { pos } = resizeState916;
    resizeState916 = null;
    celdasLibres916.querySelectorAll('.celdaLibre916.redimensionando916').forEach((el) => el.classList.remove('redimensionando916'));
    if (archivoActual && layoutActual916) {
      const { celdas } = calcularLayoutLocal(layoutActual916);
      const celda = celdas.find((c) => c.pos === pos);
      if (celda) {
        const confirmado = await window.clipForge.layout916LibreRedimensionar(archivoActual, claveActualLayout916, cantidadActualLayout916, pos, 'br', celda.x + celda.w, celda.y + celda.h);
        if (confirmado) { layoutActual916 = confirmado; dibujarCanvas916(); renderCeldasLibres916(); }
      }
    }
  }
});

if (selectLayout916Modo) {
  selectLayout916Modo.addEventListener('change', async () => {
    if (!archivoActual || !claveActualLayout916) return;
    const nuevo = await window.clipForge.layout916Preset(archivoActual, claveActualLayout916, cantidadActualLayout916, selectLayout916Modo.value);
    if (nuevo) { layoutActual916 = nuevo; dibujarCanvas916(); renderDivisores916(); renderCeldasLibres916(); }
  });
}

if (btnDistribuir916) {
  btnDistribuir916.addEventListener('click', async () => {
    if (!archivoActual || !claveActualLayout916) return;
    const nuevo = await window.clipForge.layout916Distribuir(archivoActual, claveActualLayout916, cantidadActualLayout916);
    if (nuevo) { layoutActual916 = nuevo; dibujarCanvas916(); renderDivisores916(); renderCeldasLibres916(); }
  });
}

// Segmentos [start,end,cubierto] para la franja roja/verde de arriba -
// fusiona los rangos de todos los clips (union de intervalos), igual
// logica que segmentosCobertura() del lado main.
function segmentosCoberturaLocal(dur) {
  if (!clipsActuales.length) return [{ start: 0, end: dur, cubierto: false }];
  const puntos = new Set([0, dur]);
  clipsActuales.forEach((c) => { puntos.add(Math.max(0, c.start)); puntos.add(Math.min(dur, c.end)); });
  const ordenados = [...puntos].sort((a, b) => a - b);
  const segmentos = [];
  for (let i = 0; i < ordenados.length - 1; i++) {
    const s = ordenados[i], e = ordenados[i + 1];
    if (e - s <= 0.001) continue;
    segmentos.push({ start: s, end: e, cubierto: clipsActuales.some((c) => c.start <= s && c.end >= e) });
  }
  return segmentos;
}

// Guarda en el main process los cambios de UN clip puntual (start/end/
// track al arrastrar en la timeline, o xPct/yPct/wPct/hPct al mover/
// redimensionar sobre el video) - llamar al SOLTAR el mouse, no en cada
// mousemove, para no saturar el IPC durante un arrastre.
async function persistirClip(id, cambios) {
  if (!archivoActual) return;
  const nuevos = await window.clipForge.recuadrosActualizar(archivoActual, id, cambios);
  if (nuevos) clipsActuales = nuevos;
}

// Franja de cobertura roja/verde (arriba) + filas de pistas con los
// bloques de clip (abajo) - las 2 vistas conviven, pedido explicito del
// user.
function renderLayoutTimeline() {
  if (!layoutTimelineBands) return;
  const dur = duracionTimeline();
  const segmentos = segmentosCoberturaLocal(dur);
  layoutTimelineBands.innerHTML = segmentos.map((s) => {
    const left = dur > 0 ? (s.start / dur) * 100 : 0;
    const ancho = dur > 0 ? Math.max(0.3, ((s.end - s.start) / dur) * 100) : 0;
    const clase = s.cubierto ? 'conRecuadro' : 'sinRecuadro';
    return `<div class="layoutBanda ${clase}" style="left:${left}%;width:${ancho}%;"></div>`;
  }).join('');
  renderClipsTracks();
}

// Color estable por clip (mismo color en el overlay del video, la fila
// de pistas, y en teoria en el visor 9:16 si se quisiera diferenciar
// ahi tambien) - hash simple del id a un hue, para distinguir cada
// recuadro a simple vista cuando hay varios activos a la vez.
function colorParaClip(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 55%)`;
}

// Alto de fila en pixeles usado para las pistas de clips - tiene que
// coincidir con el alto real de .trackRow en el CSS (index.html) para
// que arrastrar verticalmente un clip cambie de pista de forma
// predecible (redondeo por fila, no por pixel).
const TRACK_ROW_HEIGHT = 32;

function maxTrackActual() {
  return clipsActuales.reduce((m, c) => Math.max(m, c.track), -1);
}

// Estado de arrastre de UN bloque de clip en la fila de pistas: mover
// (cambia start/end igual, y puede cambiar track si se arrastra
// verticalmente a otra fila) o redimensionar desde un borde (cambia
// solo start o solo end, la pista queda fija).
let clipDragState = null;

// Dibuja las filas de pista con los bloques de cada clip - convive con
// renderLayoutTimeline() (franja roja/verde de cobertura), pedido
// explicito del user (seccion 25.1 CTX_PROYECTO_CLIPFORGE_1D.md). Se
// muestra siempre UNA fila vacia de mas al final ("fantasma") para que
// arrastrar un clip ahi genere una pista nueva - si no se usa, no se
// crea ninguna pista de mas (las pistas no tienen limite fijo).
function renderClipsTracks() {
  if (!clipsTracksRows) return;
  const dur = duracionTimeline();
  const maxTrack = maxTrackActual();
  const totalFilas = clipsActuales.length ? maxTrack + 2 : 1;
  let html = '';
  for (let t = 0; t < totalFilas; t++) {
    const esFantasma = t > maxTrack;
    html += `<div class="trackRow${esFantasma ? ' fantasma' : ''}" data-track="${t}">`;
    clipsActuales.filter((c) => c.track === t).forEach((c) => {
      const left = dur > 0 ? (c.start / dur) * 100 : 0;
      const ancho = dur > 0 ? Math.max(0.5, ((c.end - c.start) / dur) * 100) : 0;
      const sel = c.id === clipSeleccionadoId ? ' seleccionado' : '';
      html += `<div class="clipBloque${sel}" data-id="${c.id}" style="left:${left}%;width:${ancho}%;background:${colorParaClip(c.id)};" title="${fmtTiempo(c.start)} - ${fmtTiempo(c.end)}">
        <span class="clipHandle izq" data-corner="izq"></span>
        <span class="clipEtiqueta">${fmtTiempo(c.start)}-${fmtTiempo(c.end)}</span>
        <span class="clipBorrar" title="Quitar recuadro">×</span>
        <span class="clipHandle der" data-corner="der"></span>
      </div>`;
    });
    html += `</div>`;
  }
  clipsTracksRows.innerHTML = html;

  clipsTracksRows.querySelectorAll('.clipBorrar').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!archivoActual) return;
      const id = btn.closest('.clipBloque').dataset.id;
      const nuevos = await window.clipForge.recuadrosEliminar(archivoActual, id);
      if (nuevos) clipsActuales = nuevos;
      renderLayoutTimeline();
      renderRecuadrosOverlay();
      dibujarCanvas916();
    });
  });
  clipsTracksRows.querySelectorAll('.clipBloque').forEach((el) => {
    el.addEventListener('mousedown', (ev) => {
      if (ev.target.classList.contains('clipBorrar') || ev.target.classList.contains('clipHandle')) return;
      iniciarDragClip(ev, el.dataset.id, 'mover');
    });
  });
  clipsTracksRows.querySelectorAll('.clipHandle.izq').forEach((h) => {
    h.addEventListener('mousedown', (ev) => { ev.stopPropagation(); iniciarDragClip(ev, h.closest('.clipBloque').dataset.id, 'resize-izq'); });
  });
  clipsTracksRows.querySelectorAll('.clipHandle.der').forEach((h) => {
    h.addEventListener('mousedown', (ev) => { ev.stopPropagation(); iniciarDragClip(ev, h.closest('.clipBloque').dataset.id, 'resize-der'); });
  });
}

function iniciarDragClip(ev, id, modo) {
  ev.preventDefault();
  ev.stopPropagation();
  const c = clipsActuales.find((x) => x.id === id);
  if (!c || !clipsTracksRows) return;
  clipDragState = {
    id, modo,
    startClientX: ev.clientX, startClientY: ev.clientY,
    startStart: c.start, startEnd: c.end, startTrack: c.track,
    containerWidth: clipsTracksRows.getBoundingClientRect().width
  };
  clipSeleccionadoId = id;
}

window.addEventListener('mousemove', (ev) => {
  if (!clipDragState) return;
  const dur = duracionTimeline();
  if (dur <= 0 || clipDragState.containerWidth <= 0) return;
  const c = clipsActuales.find((x) => x.id === clipDragState.id);
  if (!c) { clipDragState = null; return; }
  const dxTime = ((ev.clientX - clipDragState.startClientX) / clipDragState.containerWidth) * dur;
  const MINDUR = 0.2;
  if (clipDragState.modo === 'mover') {
    const duracionClip = clipDragState.startEnd - clipDragState.startStart;
    let nuevoStart = clipDragState.startStart + dxTime;
    let nuevoEnd = clipDragState.startEnd + dxTime;
    if (nuevoStart < 0) { nuevoStart = 0; nuevoEnd = duracionClip; }
    if (nuevoEnd > dur) { nuevoEnd = dur; nuevoStart = Math.max(0, dur - duracionClip); }
    c.start = nuevoStart; c.end = nuevoEnd;
    const dyTrack = Math.round((ev.clientY - clipDragState.startClientY) / TRACK_ROW_HEIGHT);
    c.track = Math.max(0, clipDragState.startTrack + dyTrack);
  } else if (clipDragState.modo === 'resize-izq') {
    c.start = Math.max(0, Math.min(clipDragState.startStart + dxTime, c.end - MINDUR));
  } else if (clipDragState.modo === 'resize-der') {
    c.end = Math.min(dur, Math.max(clipDragState.startEnd + dxTime, c.start + MINDUR));
  }
  renderLayoutTimeline();
  renderRecuadrosOverlay();
  dibujarCanvas916();
});

window.addEventListener('mouseup', async () => {
  if (!clipDragState) return;
  const c = clipsActuales.find((x) => x.id === clipDragState.id);
  const id = clipDragState.id;
  clipDragState = null;
  if (!c) return;
  await persistirClip(id, { start: c.start, end: c.end, track: c.track });
  renderLayoutTimeline();
  renderRecuadrosOverlay();
  dibujarCanvas916();
});

// Vuelca a disco el JSON de clips (<archivo>.recuadros.json).
if (btnExportarLayoutsJson) {
  btnExportarLayoutsJson.addEventListener('click', async () => {
    if (!archivoActual) return;
    const resultado = await window.clipForge.recuadrosExportarJson(archivoActual);
    if (resultado && resultado.ok) {
      estado.textContent = `Recuadros exportados: ${resultado.path}`;
    } else {
      estado.textContent = `Error exportando recuadros: ${resultado ? resultado.error : 'sin respuesta'}`;
    }
  });
}

const btnColapsarTranscripcion = document.getElementById('btnColapsarTranscripcion');

videoPreview.addEventListener('timeupdate', actualizarPlayhead);
videoPreview.addEventListener('loadedmetadata', async () => {
  renderTimeline();
  actualizarPlayhead();
  // Recorte: si todavia no tenia fin definido (proyecto nuevo, o el
  // primer loadedmetadata de un video recien elegido), completar con la
  // duracion real ahora conocida = recorte por defecto = video completo.
  if (!trimActual.fin || trimActual.fin <= 0) {
    trimActual.fin = videoPreview.duration;
  }
  renderTrim();
  aplicarZoomTimeline();
  // Ajustar el ultimo tramo de layouts a la duracion REAL del video (la
  // estimacion inicial usada al transcribir puede diferir un poco).
  if (archivoActual && isFinite(videoPreview.duration) && videoPreview.duration > 0) {
    const nuevos = await window.clipForge.recuadrosNormalizar(archivoActual, videoPreview.duration);
    if (nuevos) {
      clipsActuales = nuevos;
      renderLayoutTimeline();
      renderRecuadrosOverlay();
    }
  }
});

// --- Pantalla de inicio con proyectos guardados (pedido 29/07/2026) ---
// Completa lo que habia quedado a medias: la funcion de reset (llamada
// desde varios lugares pero nunca definida), el cambio entre
// #pantallaInicio/#pantallaTrabajo, y el listado+apertura de proyectos.

// Reset del estado de trabajo (transcripcion, timeline, recuadros,
// visor). NO toca #pantallaInicio/#pantallaTrabajo ni archivoActual -
// eso lo maneja quien llame a esta funcion segun el caso (elegir
// archivo nuevo, nuevo proyecto, o abrir uno guardado).
function reiniciarEstadoTrabajo() {
  transcripcionDiv.innerHTML = '';
  estado.textContent = '';
  resumenCortes.style.display = 'none';
  botonesExport.style.display = 'none';
  panelIA.style.display = 'none';
  videoPreview.pause();
  videoPreview.removeAttribute('src');
  videoPreview.load();
  timelineBlocks.innerHTML = '';
  bloquesActuales = [];
  clipsActuales = [];
  trimActual = { inicio: 0, fin: 0, activo: false };
  if (chkLimitarRecorte) chkLimitarRecorte.checked = false;
  if (trimOverlayIzq) { trimOverlayIzq.style.width = '0%'; trimOverlayDer.style.width = '0%'; }
  if (recorteTexto) recorteTexto.textContent = '';
  zoomTimeline = 1;
  aplicarZoomTimeline();
  if (timelineScrollWrap) timelineScrollWrap.scrollLeft = 0;
  clipSeleccionadoId = null;
  clipsActivosIdsPrev = [];
  layoutActual916 = null;
  claveActualLayout916 = '';
  cantidadActualLayout916 = 0;
  arrastreDivisor916 = null;
  if (layoutTimelineBands) layoutTimelineBands.innerHTML = '';
  if (clipsTracksRows) clipsTracksRows.innerHTML = '';
  modoDibujo = false;
  recuadrosOverlay.classList.remove('modoActivo');
  btnModoRecuadro.classList.remove('activo');
  btnModoRecuadro.textContent = '+ Recuadro (dibujar)';
  renderRecuadrosOverlay();
  renderDivisores916();
  limpiarCanvas916();
}

function mostrarPantallaTrabajo() {
  pantallaInicio.style.display = 'none';
  pantallaTrabajo.style.display = 'block';
}

function mostrarPantallaInicio() {
  videoPreview.pause();
  pantallaTrabajo.style.display = 'none';
  pantallaInicio.style.display = 'block';
  cargarListaProyectos();
}

// Lista los proyectos guardados (main.js: proyectos:listar) y arma una
// .proyectoCard por cada uno, con boton para reabrirlo. Se guarda
// data-existe en el boton (viene de existeArchivoOriginal, calculado en
// main.js) para poder avisar sin volver a preguntarle al backend.
async function cargarListaProyectos() {
  const proyectos = await window.clipForge.proyectosListar();
  if (!proyectos || !proyectos.length) {
    listaProyectos.innerHTML = '<p style="color:#6b7280;font-size:13px;">No hay proyectos guardados todavia. Elegi "+ Nuevo proyecto" para empezar.</p>';
    return;
  }
  listaProyectos.innerHTML = proyectos.map((p) => {
    const fecha = p.fechaActualizacion ? new Date(p.fechaActualizacion).toLocaleString() : '';
    const metaFaltante = p.existeArchivoOriginal === false
      ? '<span class="proyectoMeta faltante"> · archivo original no encontrado en su ruta</span>'
      : '';
    return `
      <div class="proyectoCard">
        <div class="proyectoInfo">
          <div class="proyectoNombre">${escapeHtml(p.nombreArchivo)}</div>
          <div class="proyectoMeta">${escapeHtml(p.motor || '(sin motor)')} · ${p.totalBlocks} bloques · ${fecha}${metaFaltante}</div>
        </div>
        <button class="btnAbrirProyecto" data-path="${escapeHtml(p.inputPath)}" data-existe="${p.existeArchivoOriginal}">Abrir</button>
      </div>`;
  }).join('');
  listaProyectos.querySelectorAll('.btnAbrirProyecto').forEach((btn) => {
    btn.addEventListener('click', () => abrirProyectoExistente(btn.dataset.path, btn.dataset.existe === 'true'));
  });
}

// Reabre un proyecto ya guardado (main.js: proyectos:abrir) SIN correr
// whisper de nuevo - restaura blocks/layouts/resumen directo del
// proyecto.json y pasa a la pantalla de trabajo.
async function abrirProyectoExistente(inputPath, existeArchivoOriginal) {
  const data = await window.clipForge.proyectosAbrir(inputPath);
  if (!data) {
    estado.textContent = 'No se pudo abrir ese proyecto (datos guardados no encontrados o corruptos).';
    return;
  }
  reiniciarEstadoTrabajo();
  archivoActual = inputPath;
  archivoElegido.textContent = inputPath;
  btnTranscribir.disabled = false;
  mostrarPantallaTrabajo();

  bloquesActuales = data.blocks || [];
  // data.layouts ya viene migrado al formato de clips por main.js
  // (migrarDesdeTramosViejo se aplica en el handler proyectos:abrir).
  clipsActuales = data.layouts || [];
  trimActual = data.trim || { inicio: 0, fin: 0, activo: false };
  if (chkLimitarRecorte) chkLimitarRecorte.checked = !!trimActual.activo;

  renderBloques();
  renderResumen(data.resumen || summarize(bloquesActuales));
  botonesExport.style.display = bloquesActuales.length ? 'flex' : 'none';
  panelIA.style.display = bloquesActuales.length ? 'block' : 'none';
  if (bloquesActuales.length) poblarKeysIA();

  if (existeArchivoOriginal) {
    videoPreview.src = window.clipForge.rutaAFileUrl(inputPath);
  }
  renderTimeline();
  renderLayoutTimeline();
  renderRecuadrosOverlay();
  renderTrim();
  aplicarZoomTimeline();

  estado.textContent = existeArchivoOriginal
    ? `Proyecto reabierto (${bloquesActuales.length} bloques) - no se volvio a transcribir.`
    : 'Proyecto reabierto, pero el archivo de video original no se encontro en su ruta - no se puede reproducir, solo ver los datos guardados.';
}

// summarize() vive del lado main (main.js) normalmente - aca solo hace
// falta un fallback minimo si el proyecto guardado no trajera resumen
// (no deberia pasar, actualizarProyecto siempre lo guarda, pero por las
// dudas de un proyecto.json viejo/parcial).
function summarize(blocks) {
  const cutCount = blocks.filter((b) => b.status === 'cut').length;
  const keptDurationSec = Math.round(blocks.filter((b) => b.status !== 'cut').reduce((acc, b) => acc + ((b.end || 0) - (b.start || 0)), 0));
  const totalDurationSec = Math.round(blocks.reduce((acc, b) => acc + ((b.end || 0) - (b.start || 0)), 0));
  const porcentajeEliminado = totalDurationSec > 0 ? Math.round(((totalDurationSec - keptDurationSec) / totalDurationSec) * 100) : 0;
  return { totalBlocks: blocks.length, cutCount, keptDurationSec, porcentajeEliminado };
}

btnNuevoProyecto.addEventListener('click', () => {
  reiniciarEstadoTrabajo();
  archivoActual = null;
  archivoElegido.textContent = '';
  btnTranscribir.disabled = true;
  mostrarPantallaTrabajo();
});

btnVolverProyectos.addEventListener('click', () => {
  mostrarPantallaInicio();
});

btnElegir.addEventListener('click', async () => {
  const path = await window.clipForge.elegirArchivo();
  if (!path) return;
  // reiniciarEstadoTrabajo() definida arriba (pedido 29/07/2026,
  // pantalla de inicio con proyectos) - factoriza el mismo reset que
  // antes estaba repetido aca.
  reiniciarEstadoTrabajo();
  archivoActual = path;
  archivoElegido.textContent = path;
  btnTranscribir.disabled = false;
});

window.clipForge.onProgreso((data) => {
  const segundos = data.total_sec ? ` (${data.total_sec}s)` : '';
  estado.textContent = `Estado: ${data.status}${segundos}`;
});

function renderResumen(resumen) {
  document.getElementById('rTotal').textContent = resumen.totalBlocks;
  document.getElementById('rCortados').textContent = resumen.cutCount;
  document.getElementById('rDuracion').textContent = resumen.keptDurationSec + 's';
  document.getElementById('rPct').textContent = resumen.porcentajeEliminado + '%';
  resumenCortes.style.display = 'flex';
}

function renderBloques() {
  transcripcionDiv.innerHTML = bloquesActuales.map((b) => {
    const ts = b.start != null ? b.start.toFixed(1) + 's' : '';
    const clases = `bloque ${b.type} ${b.status}`;
    const titulo = b.status === 'propuesta' && b.motivoIA ? ` title="${escapeHtml(b.motivoIA)}"` : '';
    return `<div class="${clases}" data-id="${b.id}"${titulo}><span class="ts">[${ts}]</span>${escapeHtml(b.text)}</div>`;
  }).join('');

  transcripcionDiv.querySelectorAll('.bloque').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const bloqueClickeado = bloquesActuales.find((b) => b.id === id);
      if (bloqueClickeado && videoPreview.src && bloqueClickeado.start != null) {
        videoPreview.currentTime = bloqueClickeado.start;
      }
      const resultado = await window.clipForge.cortesToggle(archivoActual, id);
      if (!resultado) return;
      const idx = bloquesActuales.findIndex((b) => b.id === id);
      if (idx >= 0) bloquesActuales[idx] = resultado.block;
      renderResumen(resultado.resumen);
      renderBloques();
      renderTimeline();
    });
  });
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Transcripcion colapsable (pedido 29/07/2026) - solo oculta/muestra el
// contenido, el panel de "resumen de cortes" y la timeline no dependen de
// esto. #transcripcion tambien tiene max-height+scroll por CSS de por si,
// para que no crezca sin limite aunque este expandida.
btnColapsarTranscripcion.addEventListener('click', () => {
  const colapsada = transcripcionDiv.classList.toggle('colapsada');
  btnColapsarTranscripcion.textContent = colapsada ? 'Expandir' : 'Contraer';
});

// --- Visor de video + linea de tiempo (seccion 7.8 CTX_PROYECTO_CLIPFORGE_1D.md) ---

function fmtTiempo(seg) {
  if (!isFinite(seg) || seg < 0) seg = 0;
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Duracion de referencia para posicionar la timeline: preferir la del
// <video> real una vez cargada (loadedmetadata); mientras tanto, usar
// el ultimo "end" de los bloques como aproximacion para no dividir por 0.
function duracionTimeline() {
  const porVideo = videoPreview.duration;
  if (isFinite(porVideo) && porVideo > 0) return porVideo;
  return bloquesActuales.reduce((acc, b) => Math.max(acc, b.end || 0), 0) || 1;
}

function resaltarBloqueTexto(id) {
  transcripcionDiv.querySelectorAll('.bloque.resaltado').forEach((el) => el.classList.remove('resaltado'));
  const el = transcripcionDiv.querySelector(`.bloque[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('resaltado');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.classList.remove('resaltado'), 1500);
}

function renderTimeline() {
  if (!bloquesActuales.length) {
    timelineBlocks.innerHTML = '';
    contadorCortesTL.textContent = '0';
    return;
  }
  const dur = duracionTimeline();
  contadorCortesTL.textContent = bloquesActuales.filter((b) => b.status === 'cut').length;
  timelineBlocks.innerHTML = bloquesActuales.map((b) => {
    const left = dur > 0 ? (Math.max(0, b.start || 0) / dur) * 100 : 0;
    const ancho = dur > 0 ? Math.max(0.3, ((b.end || 0) - (b.start || 0)) / dur * 100) : 0;
    const tituloCorto = escapeHtml((b.text || '').slice(0, 60));
    return `<div class="tlseg ${b.type} ${b.status}" data-id="${b.id}" title="${tituloCorto}" style="left:${left}%;width:${ancho}%;"></div>`;
  }).join('');
  timelineBlocks.querySelectorAll('.tlseg').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const bloque = bloquesActuales.find((b) => b.id === id);
      if (!bloque) return;
      if (videoPreview.src && bloque.start != null) videoPreview.currentTime = bloque.start;
      resaltarBloqueTexto(id);
    });
  });
}

function actualizarPlayhead() {
  const dur = duracionTimeline();
  // Si "Reproducir solo el recorte" esta activo, la reproduccion normal
  // (no solo el clic/arrastre en la timeline, que ya se clampea aparte)
  // tampoco debe salirse de [inicio,fin] - al llegar al fin, vuelve al
  // inicio (loop), y si por algun motivo quedo antes del inicio, salta
  // ahi directo. Se corta la funcion en este punto porque el propio
  // cambio de currentTime dispara un 'timeupdate' nuevo que termina de
  // sincronizar playhead/overlay/canvas916 con el valor ya corregido.
  if (trimActual.activo && dur > 0 && videoPreview.src) {
    if (videoPreview.currentTime > trimActual.fin) { videoPreview.currentTime = trimActual.inicio; return; }
    if (videoPreview.currentTime < trimActual.inicio - 0.05) { videoPreview.currentTime = trimActual.inicio; return; }
  }
  const pct = dur > 0 ? (videoPreview.currentTime / dur) * 100 : 0;
  playhead.style.left = Math.min(100, Math.max(0, pct)) + '%';
  tiempoTexto.textContent = `${fmtTiempo(videoPreview.currentTime)} / ${fmtTiempo(dur)}`;
  contadorCortesTL.textContent = bloquesActuales.filter((b) => b.status === 'cut').length;
  // El overlay de edicion (#recuadrosOverlay) solo se re-renderiza cuando
  // el SET de clips activos cambia (entramos/salimos del rango de algun
  // clip) - no en cada tick - para no interrumpir un arrastre en curso ni
  // gastar de mas. clipsActivosIdsPrev se compara ordenado para que el
  // orden de iteracion no genere falsos cambios.
  const activosIds = clipsEnInstanteLocal(videoPreview.currentTime || 0).map((c) => c.id).sort();
  const cambioSet = activosIds.join(',') !== clipsActivosIdsPrev.join(',');
  if (cambioSet) {
    clipsActivosIdsPrev = activosIds;
    if (!moverState && !resizeState && !dragInicio) renderRecuadrosOverlay();
    // Si cambio la COMBINACION EXACTA de recuadros activos (30/07/2026,
    // pedido del user: modo individual por combinacion, no compartido por
    // cantidad) - la disposicion de celdas del visor 9:16 tiene que
    // pedirse de nuevo con la clave nueva. Puede ser una combinacion que
    // ya se vio antes en otro punto del video (ej. estos mismos 2
    // recuadros vuelven a estar juntos mas adelante) y en ese caso el
    // main devuelve tal cual habia quedado esa clave, no resetea a la
    // default de una.
    const claveNueva = activosIds.join(',');
    if (claveNueva !== claveActualLayout916) sincronizarLayout916(claveNueva, activosIds.length);
  }
  dibujarCanvas916();
}

// --- Linea de tiempo MAESTRA (pedido 29/07/2026) ---
// Antes, la unica forma de mover el tiempo era el control nativo del
// <video> (o clic en un bloque puntual de habla, que salta a un punto
// fijo). Ahora #timelineMaestraWrap agrupa bloques de habla + franja de
// cobertura + pistas de recuadros bajo un solo eje de tiempo (ver CSS en
// index.html), y clic/arrastre en CUALQUIER parte de esa zona mueve el
// video a ese punto. El <video> sigue siendo la fuente de verdad del
// tiempo (currentTime) - el 'timeupdate' de siempre (actualizarPlayhead,
// ya definida arriba) se sigue disparando igual y sincroniza todo lo
// demas (playhead unico que atraviesa las 3 filas, overlay de recuadros,
// canvas916) sin necesidad de tocar nada de eso.
let scrubMaestro = false;

function tiempoDesdeClickMaestro(ev) {
  if (!timelineMaestraWrap) return null;
  const dur = duracionTimeline();
  const rect = timelineMaestraWrap.getBoundingClientRect();
  if (rect.width <= 0 || dur <= 0) return null;
  const pct = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  return pct * dur;
}

// Si el recorte esta ACTIVO ("Reproducir solo el recorte" marcado), el
// tiempo nunca debe salir de [trimActual.inicio, trimActual.fin] al
// mover el playhead a mano (clic/arrastre en la timeline) - la otra
// mitad del clamp (durante reproduccion normal) vive en actualizarPlayhead().
function clampSiRecorteActivo(t) {
  if (!trimActual.activo) return t;
  return Math.min(trimActual.fin, Math.max(trimActual.inicio, t));
}

if (timelineMaestraWrap) {
  timelineMaestraWrap.addEventListener('mousedown', (ev) => {
    // No interferir con el arrastre de un clip ya puesto (mover/
    // redimensionar en su propia pista) - eso lo maneja iniciarDragClip,
    // que ya escucha su propio mousedown sobre ".clipBloque"/".clipHandle".
    if (ev.target.closest('.clipBloque')) return;
    // Tampoco interferir con el arrastre de las manijas de recorte
    // (in/out) - esas manejan su propio mousedown mas abajo.
    if (ev.target === trimHandleIn || ev.target === trimHandleOut) return;
    if (!videoPreview.src) return;
    scrubMaestro = true;
    const t = tiempoDesdeClickMaestro(ev);
    if (t != null) videoPreview.currentTime = clampSiRecorteActivo(t);
  });
}

window.addEventListener('mousemove', (ev) => {
  if (!scrubMaestro) return;
  const t = tiempoDesdeClickMaestro(ev);
  if (t != null) videoPreview.currentTime = clampSiRecorteActivo(t);
});

window.addEventListener('mouseup', () => { scrubMaestro = false; });

// --- Zoom de la timeline: botones +/-/ajustar + Ctrl+rueda del mouse ---
function aplicarZoomTimeline() {
  if (!timelineMaestraWrap) return;
  timelineMaestraWrap.style.width = (zoomTimeline * 100) + '%';
  if (zoomNivelTexto) zoomNivelTexto.textContent = Math.round(zoomTimeline * 100) + '%';
}

// Mantiene el playhead visible dentro del area visible del scroll al
// cambiar de zoom - sin esto, un zoom alto puede dejar el playhead
// fuera de vista sin que quede claro por que "desaparecio" la timeline.
function centrarScrollEnPlayhead() {
  if (!timelineScrollWrap || !timelineMaestraWrap) return;
  const dur = duracionTimeline();
  if (dur <= 0) return;
  const pct = Math.min(1, Math.max(0, (videoPreview.currentTime || 0) / dur));
  const anchoTotal = timelineMaestraWrap.scrollWidth;
  const anchoVisible = timelineScrollWrap.clientWidth;
  let destino = pct * anchoTotal - anchoVisible / 2;
  destino = Math.max(0, Math.min(destino, Math.max(0, anchoTotal - anchoVisible)));
  timelineScrollWrap.scrollLeft = destino;
}

function cambiarZoom(factor) {
  zoomTimeline = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTimeline * factor));
  aplicarZoomTimeline();
  centrarScrollEnPlayhead();
}

if (btnZoomIn) btnZoomIn.addEventListener('click', () => cambiarZoom(1.6));
if (btnZoomOut) btnZoomOut.addEventListener('click', () => cambiarZoom(1 / 1.6));
if (btnZoomReset) btnZoomReset.addEventListener('click', () => {
  zoomTimeline = 1;
  aplicarZoomTimeline();
  if (timelineScrollWrap) timelineScrollWrap.scrollLeft = 0;
});

// Ctrl+rueda sobre la timeline = zoom (patron estandar de editores de
// video/audio), anclado a la posicion del cursor para no "perder" el
// punto que se esta mirando al hacer zoom in/out.
if (timelineScrollWrap) {
  timelineScrollWrap.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    const rect = timelineScrollWrap.getBoundingClientRect();
    const xRel = ev.clientX - rect.left;
    const anchoAntes = timelineMaestraWrap.scrollWidth || 1;
    const puntoTiempo = (timelineScrollWrap.scrollLeft + xRel) / anchoAntes; // fraccion 0..1 bajo el cursor
    zoomTimeline = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTimeline * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    aplicarZoomTimeline();
    const anchoDespues = timelineMaestraWrap.scrollWidth || 1;
    timelineScrollWrap.scrollLeft = Math.max(0, puntoTiempo * anchoDespues - xRel);
  }, { passive: false });
}

// --- Recorte / rango de trabajo: overlay + manijas arrastrables ---
function renderTrim() {
  if (!trimHandleIn || !timelineMaestraWrap) return;
  const dur = duracionTimeline();
  if (dur <= 0) return;
  if (!trimActual.fin || trimActual.fin > dur) trimActual.fin = dur; // sin definir todavia -> video completo
  const pctIn = Math.min(100, Math.max(0, (trimActual.inicio / dur) * 100));
  const pctOut = Math.min(100, Math.max(0, (trimActual.fin / dur) * 100));
  trimHandleIn.style.left = pctIn + '%';
  trimHandleOut.style.left = pctOut + '%';
  trimOverlayIzq.style.left = '0%';
  trimOverlayIzq.style.width = pctIn + '%';
  trimOverlayDer.style.left = pctOut + '%';
  trimOverlayDer.style.width = (100 - pctOut) + '%';
  if (recorteTexto) {
    const esCompleto = trimActual.inicio <= 0.05 && trimActual.fin >= dur - 0.05;
    recorteTexto.textContent = esCompleto
      ? 'Recorte: video completo'
      : `Recorte: ${fmtTiempo(trimActual.inicio)} - ${fmtTiempo(trimActual.fin)}`;
  }
}

// Guarda el recorte en el proyecto (main.js) - llamar al SOLTAR el mouse
// o al usar un boton, no en cada mousemove del arrastre.
async function persistirTrim() {
  if (!archivoActual) return;
  const dur = duracionTimeline();
  const nuevo = await window.clipForge.trimActualizar(archivoActual, trimActual.inicio, trimActual.fin, dur, chkLimitarRecorte ? chkLimitarRecorte.checked : false);
  if (nuevo) trimActual = nuevo;
  renderTrim();
}

function iniciarDragTrim(ev, cual) {
  ev.preventDefault();
  ev.stopPropagation();
  const rect = timelineMaestraWrap.getBoundingClientRect();
  trimDragState = { cual, containerWidth: rect.width, left: rect.left };
  (cual === 'in' ? trimHandleIn : trimHandleOut).classList.add('arrastrando');
}
if (trimHandleIn) trimHandleIn.addEventListener('mousedown', (ev) => iniciarDragTrim(ev, 'in'));
if (trimHandleOut) trimHandleOut.addEventListener('mousedown', (ev) => iniciarDragTrim(ev, 'out'));

window.addEventListener('mousemove', (ev) => {
  if (!trimDragState) return;
  const dur = duracionTimeline();
  if (dur <= 0 || trimDragState.containerWidth <= 0) return;
  const pct = Math.min(1, Math.max(0, (ev.clientX - trimDragState.left) / trimDragState.containerWidth));
  const t = pct * dur;
  const MIN_GAP = 0.3;
  if (trimDragState.cual === 'in') {
    trimActual.inicio = Math.max(0, Math.min(t, trimActual.fin - MIN_GAP));
  } else {
    trimActual.fin = Math.min(dur, Math.max(t, trimActual.inicio + MIN_GAP));
  }
  renderTrim();
});
window.addEventListener('mouseup', () => {
  if (!trimDragState) return;
  trimHandleIn.classList.remove('arrastrando');
  trimHandleOut.classList.remove('arrastrando');
  trimDragState = null;
  persistirTrim();
});

if (btnMarcarInicio) btnMarcarInicio.addEventListener('click', () => {
  if (!videoPreview.src) return;
  trimActual.inicio = Math.max(0, Math.min(videoPreview.currentTime || 0, trimActual.fin - 0.3));
  renderTrim();
  persistirTrim();
});
if (btnMarcarFin) btnMarcarFin.addEventListener('click', () => {
  if (!videoPreview.src) return;
  const dur = duracionTimeline();
  trimActual.fin = Math.min(dur, Math.max(videoPreview.currentTime || 0, trimActual.inicio + 0.3));
  renderTrim();
  persistirTrim();
});
if (btnRestablecerRecorte) btnRestablecerRecorte.addEventListener('click', () => {
  const dur = duracionTimeline();
  trimActual.inicio = 0;
  trimActual.fin = dur;
  renderTrim();
  persistirTrim();
});
if (chkLimitarRecorte) chkLimitarRecorte.addEventListener('change', () => {
  trimActual.activo = chkLimitarRecorte.checked;
  if (trimActual.activo && videoPreview.src) {
    const t = videoPreview.currentTime;
    if (t < trimActual.inicio || t > trimActual.fin) videoPreview.currentTime = trimActual.inicio;
  }
  persistirTrim();
});

// --- Recuadros + visor 9:16 split layout (pedido 28/07/2026) ---
// Cada recuadro se dibuja sobre #recuadrosOverlay (encima del <video>, mismo
// tamaño renderizado gracias a #videoWrap). Se guardan como fracciones 0..1
// (xPct/yPct/wPct/hPct) del area renderizada -> validas ante cualquier
// resize porque se posicionan con % en CSS, sin necesidad de recalcular.
// El canvas916 recorta cada recuadro del <video> real (drawImage con
// sx/sy/sw/sh) y los apila verticalmente en orden de creacion, con "cover"
// (recorta sobrante) para llenar cada celda sin deformar.

function renderRecuadrosOverlay() {
  // Solo se muestran/editan los clips activos en el instante ACTUAL del
  // video (playhead) - a diferencia del modelo viejo de "tramo que se
  // esta editando" (independiente del playhead), ahora no hay una
  // seleccion de edicion aparte: se edita lo que esta visible ahora.
  const recuadros = clipsEnInstanteLocal(videoPreview.currentTime || 0);
  recuadrosOverlay.innerHTML = recuadros.map((r, i) => `
    <div class="recuadro" data-id="${r.id}" style="left:${r.xPct * 100}%;top:${r.yPct * 100}%;width:${r.wPct * 100}%;height:${r.hPct * 100}%;border-color:${colorParaClip(r.id)};">
      <span class="rNum" style="background:${colorParaClip(r.id)};">${i + 1}</span>
      <span class="rBorrar" data-id="${r.id}" title="Quitar recuadro">×</span>
      <span class="rHandle tl" data-corner="tl"></span>
      <span class="rHandle tr" data-corner="tr"></span>
      <span class="rHandle bl" data-corner="bl"></span>
      <span class="rHandle br" data-corner="br"></span>
    </div>
  `).join('');
  recuadrosOverlay.querySelectorAll('.rBorrar').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!archivoActual) return;
      const nuevos = await window.clipForge.recuadrosEliminar(archivoActual, btn.dataset.id);
      if (nuevos) clipsActuales = nuevos;
      renderRecuadrosOverlay();
      renderLayoutTimeline();
      dibujarCanvas916();
    });
  });
  // Mover un recuadro ya puesto: mousedown sobre el propio recuadro (no
  // sobre el boton de borrar ni sobre una esquina) inicia el arrastre.
  // stopPropagation evita que el mousedown del overlay (modo dibujar, mas
  // abajo) interprete esto como el inicio de un recuadro nuevo.
  recuadrosOverlay.querySelectorAll('.recuadro').forEach((el) => {
    el.addEventListener('mousedown', (ev) => {
      if (ev.target.classList.contains('rBorrar') || ev.target.classList.contains('rHandle')) return;
      ev.stopPropagation();
      ev.preventDefault();
      const id = el.dataset.id;
      const r = clipsActuales.find((x) => x.id === id);
      if (!r) return;
      const rect = recuadrosOverlay.getBoundingClientRect();
      moverState = {
        id,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startXPct: r.xPct,
        startYPct: r.yPct,
        rectW: rect.width,
        rectH: rect.height
      };
      el.classList.add('moviendo');
    });
  });
  // Redimensionar desde una esquina (pedido 29/07/2026): agarrando un
  // "rHandle" se estira/achica/cambia de forma el recuadro, manteniendo
  // fija la esquina OPUESTA a la que se arrastra.
  recuadrosOverlay.querySelectorAll('.rHandle').forEach((handle) => {
    handle.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const padre = handle.closest('.recuadro');
      if (!padre) return;
      const id = padre.dataset.id;
      const r = clipsActuales.find((x) => x.id === id);
      if (!r) return;
      const corner = handle.dataset.corner;
      let anchorX, anchorY;
      if (corner === 'tl') { anchorX = r.xPct + r.wPct; anchorY = r.yPct + r.hPct; }
      else if (corner === 'tr') { anchorX = r.xPct; anchorY = r.yPct + r.hPct; }
      else if (corner === 'bl') { anchorX = r.xPct + r.wPct; anchorY = r.yPct; }
      else { anchorX = r.xPct; anchorY = r.yPct; } // 'br'
      const rect = recuadrosOverlay.getBoundingClientRect();
      resizeState = { id, anchorX, anchorY, rectLeft: rect.left, rectTop: rect.top, rectW: rect.width, rectH: rect.height };
      padre.classList.add('redimensionando');
    });
  });
}

window.addEventListener('mousemove', (ev) => {
  if (resizeState) {
    const r = clipsActuales.find((x) => x.id === resizeState.id);
    if (!r || resizeState.rectW <= 0 || resizeState.rectH <= 0) { resizeState = null; return; }
    const MIN = 0.03; // tamaño minimo (3% del video) para que no colapse a 0
    let curX = (ev.clientX - resizeState.rectLeft) / resizeState.rectW;
    let curY = (ev.clientY - resizeState.rectTop) / resizeState.rectH;
    curX = Math.min(1, Math.max(0, curX));
    curY = Math.min(1, Math.max(0, curY));
    const { anchorX, anchorY } = resizeState;
    let x = Math.min(anchorX, curX);
    let y = Math.min(anchorY, curY);
    let w = Math.max(anchorX, curX) - x;
    let h = Math.max(anchorY, curY) - y;
    if (w < MIN) w = MIN;
    if (h < MIN) h = MIN;
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    r.xPct = x; r.yPct = y; r.wPct = w; r.hPct = h;
    const el = recuadrosOverlay.querySelector(`.recuadro[data-id="${r.id}"]`);
    if (el) {
      el.style.left = (x * 100) + '%';
      el.style.top = (y * 100) + '%';
      el.style.width = (w * 100) + '%';
      el.style.height = (h * 100) + '%';
    }
    dibujarCanvas916();
    return;
  }
  if (!moverState) return;
  const r = clipsActuales.find((x) => x.id === moverState.id);
  if (!r || moverState.rectW <= 0 || moverState.rectH <= 0) { moverState = null; return; }
  const dxPct = (ev.clientX - moverState.startClientX) / moverState.rectW;
  const dyPct = (ev.clientY - moverState.startClientY) / moverState.rectH;
  r.xPct = Math.min(Math.max(moverState.startXPct + dxPct, 0), Math.max(0, 1 - r.wPct));
  r.yPct = Math.min(Math.max(moverState.startYPct + dyPct, 0), Math.max(0, 1 - r.hPct));
  const el = recuadrosOverlay.querySelector(`.recuadro[data-id="${r.id}"]`);
  if (el) {
    el.style.left = (r.xPct * 100) + '%';
    el.style.top = (r.yPct * 100) + '%';
  }
  dibujarCanvas916();
});

window.addEventListener('mouseup', async () => {
  if (resizeState) {
    const id = resizeState.id;
    const el = recuadrosOverlay.querySelector(`.recuadro[data-id="${id}"]`);
    if (el) el.classList.remove('redimensionando');
    resizeState = null;
    const r = clipsActuales.find((x) => x.id === id);
    if (r) await persistirClip(id, { xPct: r.xPct, yPct: r.yPct, wPct: r.wPct, hPct: r.hPct });
  }
  if (moverState) {
    const id = moverState.id;
    const el = recuadrosOverlay.querySelector(`.recuadro[data-id="${id}"]`);
    if (el) el.classList.remove('moviendo');
    moverState = null;
    const r = clipsActuales.find((x) => x.id === id);
    if (r) await persistirClip(id, { xPct: r.xPct, yPct: r.yPct });
  }
});

btnModoRecuadro.addEventListener('click', () => {
  modoDibujo = !modoDibujo;
  recuadrosOverlay.classList.toggle('modoActivo', modoDibujo);
  btnModoRecuadro.classList.toggle('activo', modoDibujo);
  btnModoRecuadro.textContent = modoDibujo ? 'Dibujando... (clic y arrastra)' : '+ Recuadro (dibujar)';
});

// "Limpiar recuadros" ya no borra un tramo entero (ese concepto no
// existe mas) - borra los clips activos en el instante actual del
// video, que son justo los que se ven/editan en el overlay ahora mismo.
btnLimpiarRecuadros.addEventListener('click', async () => {
  if (!archivoActual) return;
  const activos = clipsEnInstanteLocal(videoPreview.currentTime || 0);
  for (const c of activos) {
    const nuevos = await window.clipForge.recuadrosEliminar(archivoActual, c.id);
    if (nuevos) clipsActuales = nuevos;
  }
  renderRecuadrosOverlay();
  renderLayoutTimeline();
  dibujarCanvas916();
});

recuadrosOverlay.addEventListener('mousedown', (ev) => {
  if (!modoDibujo) return;
  const rect = recuadrosOverlay.getBoundingClientRect();
  dragInicio = { x: ev.clientX - rect.left, y: ev.clientY - rect.top, rect };
  dragEl = document.createElement('div');
  dragEl.className = 'recuadro';
  dragEl.style.left = dragInicio.x + 'px';
  dragEl.style.top = dragInicio.y + 'px';
  dragEl.style.width = '0px';
  dragEl.style.height = '0px';
  recuadrosOverlay.appendChild(dragEl);
});

recuadrosOverlay.addEventListener('mousemove', (ev) => {
  if (!dragInicio || !dragEl) return;
  const rect = dragInicio.rect;
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const left = Math.min(x, dragInicio.x);
  const top = Math.min(y, dragInicio.y);
  dragEl.style.left = left + 'px';
  dragEl.style.top = top + 'px';
  dragEl.style.width = Math.abs(x - dragInicio.x) + 'px';
  dragEl.style.height = Math.abs(y - dragInicio.y) + 'px';
});

window.addEventListener('mouseup', async () => {
  if (!dragInicio) return;
  if (dragEl) {
    const leftPx = parseFloat(dragEl.style.left);
    const topPx = parseFloat(dragEl.style.top);
    const wPx = parseFloat(dragEl.style.width);
    const hPx = parseFloat(dragEl.style.height);
    const rect = dragInicio.rect;
    dragEl.remove();
    dragEl = null;
    // Descartar recuadros minusculos (probablemente un clic sin arrastre real).
    if (wPx > 8 && hPx > 8 && rect.width > 0 && rect.height > 0 && archivoActual) {
      const t = videoPreview.currentTime || 0;
      const duracionTotal = duracionTimeline();
      const nuevos = await window.clipForge.recuadrosCrear(
        archivoActual, t, duracionTotal,
        leftPx / rect.width, topPx / rect.height, wPx / rect.width, hPx / rect.height
      );
      if (nuevos) clipsActuales = nuevos;
      renderRecuadrosOverlay();
      renderLayoutTimeline();
      dibujarCanvas916();
    }
  }
  dragInicio = null;
});

function limpiarCanvas916() {
  ctx916.fillStyle = '#000';
  ctx916.fillRect(0, 0, canvas916.width, canvas916.height);
  const clips = clipsEnInstanteLocal(videoPreview.currentTime || 0);
  if (!clips.length) {
    ctx916.fillStyle = '#6b7280';
    ctx916.font = '20px system-ui, sans-serif';
    ctx916.textAlign = 'center';
    ctx916.fillText('Dibuja un recuadro', canvas916.width / 2, canvas916.height / 2 - 12);
    ctx916.fillText('sobre el video ↑', canvas916.width / 2, canvas916.height / 2 + 16);
  }
}

// Recuadros a mostrar en el 9:16 en este instante: los clips activos
// SEGUN LA REPRODUCCION (videoPreview.currentTime, ordenados por track) -
// asi el 9:16 va cambiando solo a medida que el video entra/sale del
// rango de tiempo propio de cada clip.
function dibujarCanvas916() {
  const recuadros = clipsEnInstanteLocal(videoPreview.currentTime || 0);
  if (!recuadros.length || !videoPreview.videoWidth) {
    limpiarCanvas916();
    return;
  }
  const vw = videoPreview.videoWidth;
  const vh = videoPreview.videoHeight;
  const cw = canvas916.width;
  const ch = canvas916.height;
  const n = recuadros.length;
  // La disposicion (arbol de cortes) puede no haber llegado todavia del
  // main (primer frame tras cambiar de combinacion activa) - mientras
  // tanto se usa un apilado vertical simple como respaldo, para no dejar
  // el canvas en blanco un instante. Se compara por CANTIDAD (no por
  // clave completa) porque el arbol tiene que calzar en numero de hojas
  // con "recuadros" para poder dibujarse, sin importar cual combinacion
  // puntual sea.
  const layout = (layoutActual916 && cantidadActualLayout916 === n) ? layoutActual916 : null;
  const { celdas } = layout ? calcularLayoutLocal(layout) : { celdas: recuadros.map((_, i) => ({ pos: i, x: 0, y: i / n, w: 1, h: 1 / n })) };
  ctx916.fillStyle = '#000';
  ctx916.fillRect(0, 0, cw, ch);
  celdas.forEach((celda) => {
    const r = recuadros[celda.pos];
    if (!r) return;
    const destX = celda.x * cw, destY = celda.y * ch, destW = celda.w * cw, destH = celda.h * ch;
    const sx = r.xPct * vw;
    const sy = r.yPct * vh;
    const sw = Math.max(1, r.wPct * vw);
    const sh = Math.max(1, r.hPct * vh);
    // "cover": llena la celda destino recortando el sobrante, sin deformar
    // (misma logica que object-fit:cover, aplicada manualmente).
    const destAspect = destW / destH;
    const srcAspect = sw / sh;
    let csx = sx, csy = sy, csw = sw, csh = sh;
    if (srcAspect > destAspect) {
      const newSw = sh * destAspect;
      csx = sx + (sw - newSw) / 2;
      csw = newSw;
    } else {
      const newSh = sw / destAspect;
      csy = sy + (sh - newSh) / 2;
      csh = newSh;
    }
    try {
      ctx916.drawImage(videoPreview, csx, csy, csw, csh, destX, destY, destW, destH);
    } catch (e) { /* frame todavia no listo, se redibuja en el proximo tick */ }
    // Borde + numero del mismo color que el recuadro en el visor 16:9
    // (colorParaClip(r.id)) - pedido 30/07/2026: que se note claro cual
    // recuadro de arriba corresponde a cual celda de aca abajo.
    const color = colorParaClip(r.id);
    ctx916.strokeStyle = color;
    ctx916.lineWidth = 3;
    ctx916.strokeRect(destX + 1.5, destY + 1.5, Math.max(0, destW - 3), Math.max(0, destH - 3));
    const numTxt = String(celda.pos + 1);
    ctx916.font = 'bold 13px system-ui, sans-serif';
    const anchoPlaca = ctx916.measureText(numTxt).width + 12;
    ctx916.fillStyle = color;
    ctx916.fillRect(destX, destY, anchoPlaca, 20);
    ctx916.fillStyle = '#0b1220';
    ctx916.textAlign = 'left';
    ctx916.textBaseline = 'middle';
    ctx916.fillText(numTxt, destX + 6, destY + 11);
  });
}

// Bucle sincronizado con el video: usa requestVideoFrameCallback (soportado
// por Chromium/Electron) para redibujar en cada frame real mientras se
// reproduce, y se detiene solo al pausar/terminar (no gasta CPU de mas).
function iniciarBucle916() {
  if (videoPreview.requestVideoFrameCallback) {
    const paso = () => {
      dibujarCanvas916();
      if (!videoPreview.paused && !videoPreview.ended) videoPreview.requestVideoFrameCallback(paso);
    };
    videoPreview.requestVideoFrameCallback(paso);
  } else {
    const paso = () => {
      dibujarCanvas916();
      if (!videoPreview.paused && !videoPreview.ended) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
}

videoPreview.addEventListener('play', iniciarBucle916);
videoPreview.addEventListener('seeked', dibujarCanvas916);
videoPreview.addEventListener('loadedmetadata', dibujarCanvas916);

// El canvas916 ahora es responsive por CSS (width:100%, aspect-ratio 9/16 -
// ver index.html), pero el canvas <canvas> tiene ADEMAS una resolucion de
// dibujo real (canvas.width/height en pixeles) que no se actualiza sola
// cuando cambia el tamaño mostrado - sin esto el contenido queda
// estirado/con la resolucion vieja al cambiar el tamaño de la ventana o
// pestaña. ResizeObserver sincroniza la resolucion real con el tamaño
// renderizado cada vez que cambia, y redibuja.
function ajustarTamanoCanvas916() {
  const rect = canvas916.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas916.width !== w || canvas916.height !== h) {
    canvas916.width = w;
    canvas916.height = h;
    dibujarCanvas916();
  }
}

if (window.ResizeObserver) {
  new ResizeObserver(ajustarTamanoCanvas916).observe(canvas916);
} else {
  // Fallback por si ResizeObserver no estuviera disponible (no deberia
  // pasar en Electron/Chromium moderno, pero por si acaso).
  window.addEventListener('resize', ajustarTamanoCanvas916);
}

btnTranscribir.addEventListener('click', async () => {
  if (!archivoActual) return;
  btnTranscribir.disabled = true;
  btnElegir.disabled = true;
  estado.textContent = 'Arrancando...';
  transcripcionDiv.innerHTML = '';
  resumenCortes.style.display = 'none';
  botonesExport.style.display = 'none';

  try {
    const motor = selectorMotor.value;
    estado.textContent = `Arrancando (motor: ${motor})...`;
    const resultado = await window.clipForge.transcribir(archivoActual, motor);
    bloquesActuales = resultado.blocks || [];
    if (resultado.trim) {
      trimActual = resultado.trim;
      if (chkLimitarRecorte) chkLimitarRecorte.checked = !!trimActual.activo;
    }
    renderBloques();
    if (resultado.resumen) renderResumen(resultado.resumen);
    botonesExport.style.display = bloquesActuales.length ? 'flex' : 'none';
    panelIA.style.display = bloquesActuales.length ? 'block' : 'none';
    if (bloquesActuales.length) poblarKeysIA();
    if (bloquesActuales.length) {
      visorContainer.style.display = 'block';
      videoPreview.src = window.clipForge.rutaAFileUrl(archivoActual);
      renderTimeline();
      clipsActuales = await window.clipForge.recuadrosInicializar(archivoActual);
      renderLayoutTimeline();
      renderRecuadrosOverlay();
    }
    estado.textContent = `Listo. ${bloquesActuales.length} bloques (haz clic en uno para marcar/desmarcar corte).`;
  } catch (err) {
    estado.textContent = 'Error: ' + err.message;
  } finally {
    btnTranscribir.disabled = false;
    btnElegir.disabled = false;
  }
});

btnExportJson.addEventListener('click', async () => {
  const r = await window.clipForge.cortesExportarJson(archivoActual);
  estado.textContent = r.ok ? `Cortes guardados en: ${r.path}` : `Error: ${r.error}`;
});

btnExportSrt.addEventListener('click', async () => {
  const r = await window.clipForge.cortesExportarSrt(archivoActual);
  estado.textContent = r.ok ? `SRT exportado en: ${r.path}` : `Error: ${r.error}`;
});

// --- Seccion de API Keys ---
const inputNombreKey = document.getElementById('inputNombreKey');
const inputValorKey = document.getElementById('inputValorKey');
const btnGuardarKey = document.getElementById('btnGuardarKey');
const listaKeys = document.getElementById('listaKeys');

async function renderKeys() {
  const keys = await window.clipForge.keysListar();
  if (keys.length === 0) {
    listaKeys.innerHTML = '<p style="color:#6b7280;font-size:13px;">No hay keys guardadas.</p>';
    return;
  }
  listaKeys.innerHTML = keys.map((k) => `
    <div class="key-item">
      <span class="key-proveedor">${k.proveedor}</span>
      <span class="key-nombre">${k.nombre}</span>
      <span class="key-mask">****${k.ultimos4}</span>
      <button class="btn-eliminar" data-id="${k.id}">Eliminar</button>
    </div>
  `).join('');
  listaKeys.querySelectorAll('.btn-eliminar').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.clipForge.keysEliminar(btn.dataset.id);
      renderKeys();
    });
  });
}

btnGuardarKey.addEventListener('click', async () => {
  const valor = inputValorKey.value.trim();
  if (!valor) return;
  await window.clipForge.keysGuardar(inputNombreKey.value.trim(), valor);
  inputNombreKey.value = '';
  inputValorKey.value = '';
  renderKeys();
  poblarKeysIA();
});

// --- Seccion de Analisis con IA ---
async function poblarKeysIA() {
  const keys = await window.clipForge.keysListar();
  const deOpenRouter = keys.filter((k) => k.proveedor === 'OpenRouter');
  if (deOpenRouter.length === 0) {
    selectorKeyIA.innerHTML = '<option value="">(no hay keys de OpenRouter guardadas)</option>';
    return;
  }
  selectorKeyIA.innerHTML = deOpenRouter.map((k) =>
    `<option value="${k.id}">${k.nombre} (****${k.ultimos4})</option>`
  ).join('');
}

btnAnalizarIA.addEventListener('click', async () => {
  if (!archivoActual || !bloquesActuales.length) return;
  const keyId = selectorKeyIA.value;
  if (!keyId) {
    estadoIA.textContent = 'Guarda primero una API key de OpenRouter (seccion de abajo).';
    return;
  }
  btnAnalizarIA.disabled = true;
  estadoIA.textContent = 'Analizando...';
  try {
    const r = await window.clipForge.analizarIA({
      inputPath: archivoActual,
      backend: selectorBackendIA.value,
      modelo: inputModeloIA.value.trim(),
      keyId,
      instrucciones: inputInstruccionesIA.value.trim(),
      systemPrompt: inputSystemPromptIA.value.trim()
    });
    if (!r.ok) {
      estadoIA.textContent = 'Error: ' + r.error;
      return;
    }
    bloquesActuales = r.blocks;
    renderBloques();
    renderTimeline();
    renderResumen(r.resumen);
    estadoIA.textContent = `✓ ${r.stats.sugerencias} sugerencias del modelo · ${r.stats.tokensIn} in / ${r.stats.tokensOut} out · ${r.stats.aplicadas} aplicadas`;
  } catch (err) {
    estadoIA.textContent = 'Error: ' + err.message;
  } finally {
    btnAnalizarIA.disabled = false;
  }
});

// ============================================================
// Sistema de disposicion libre de paneles - "GUI" / "Ver" (29/07/2026)
// Cada seccion grande de la app (Visor, Resumen, Transcripcion, Exportar,
// Analisis IA, API Keys) tiene un atributo data-panel-id en el HTML.
// Este bloque las envuelve en tiempo de arranque con una cabecera
// (drag handle + acciones) y una manija de resize, sin tocar la logica
// de mostrar/ocultar que ya tenia cada una (esa sigue viviendo en su
// elemento original via style.display, intacta).
// ============================================================
const LAYOUT_KEY = 'clipforge_panel_layout_v1';
const btnGUI = document.getElementById('btnGUI');
const btnVer = document.getElementById('btnVer');
const panelVerLista = document.getElementById('panelVerLista');
const panelesContainer = document.getElementById('panelesContainer');
let panelesRegistro = []; // [{id, titulo, el}]
// Orden en que los paneles aparecen en el HTML, capturado ANTES de aplicar
// el orden guardado. Es la referencia para "Restablecer disposicion".
let ordenOriginalPaneles = [];
let resizePanelState = null;

function cargarLayoutGUI() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
  } catch (e) { return {}; }
}
function guardarLayoutGUI() {
  const datos = {};
  panelesRegistro.forEach((p, i) => {
    datos[p.id] = {
      orden: i,
      layout: p.el.classList.contains('horizontal') ? 'horizontal' : 'vertical',
      contraido: p.el.classList.contains('contraido'),
      oculto: p.el.classList.contains('oculto'),
      alto: p.el.classList.contains('alturaFija') ? p.el.style.height : null
    };
  });
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(datos));
}

function crearHeaderPanel(id, titulo) {
  const header = document.createElement('div');
  header.className = 'panelHeaderGUI';
  header.innerHTML = `
    <span class="panelDrag" draggable="true" title="Arrastra para reordenar">&#8942;&#8942;</span>
    <span class="panelTitulo">${titulo}</span>
    <div class="panelAcciones">
      <button type="button" class="panelAccion" data-accion="horizontal" title="Poner en horizontal (lado a lado)">&#8596;</button>
      <button type="button" class="panelAccion" data-accion="vertical" title="Poner en vertical (ancho completo)">&#8597;</button>
      <button type="button" class="panelAccion" data-accion="contraer" title="Contraer/expandir">&#8963;</button>
      <button type="button" class="panelAccion" data-accion="ocultar" title="Ocultar este panel">&times;</button>
    </div>`;
  return header;
}

function inicializarPanelesGUI() {
  if (!panelesContainer) return;
  const nodos = Array.from(panelesContainer.querySelectorAll('[data-panel-id]'));
  const guardado = cargarLayoutGUI();
  panelesRegistro = nodos.map((el) => {
    const id = el.getAttribute('data-panel-id');
    const titulo = el.getAttribute('data-panel-titulo') || id;
    el.classList.add('panelGUI');
    const body = document.createElement('div');
    body.className = 'panelBody';
    while (el.firstChild) body.appendChild(el.firstChild);
    el.appendChild(crearHeaderPanel(id, titulo));
    el.appendChild(body);
    const handle = document.createElement('div');
    handle.className = 'panelResizeHandle';
    el.appendChild(handle);
    return { id, titulo, el };
  });
  ordenOriginalPaneles = panelesRegistro.map((p) => p.id);
  // aplicar disposicion guardada (orden, horizontal/vertical, contraido, oculto, alto)
  const conOrden = panelesRegistro.slice().sort((a, b) => {
    const oa = guardado[a.id] ? guardado[a.id].orden : 999;
    const ob = guardado[b.id] ? guardado[b.id].orden : 999;
    return oa - ob;
  });
  conOrden.forEach((p) => panelesContainer.appendChild(p.el));
  panelesRegistro = conOrden;
  panelesRegistro.forEach((p) => {
    const g = guardado[p.id];
    // Sin nada guardado el panel arranca en 'vertical' EXPLICITO. Antes se
    // hacia "return" y el panel quedaba sin ninguna de las dos clases:
    // funcionaba de casualidad porque un div ya es block, pero el boton
    // "vertical" no podia mostrarse como activo y "Restablecer
    // disposicion" si dejaba la clase, con lo cual el estado inicial y el
    // restablecido no eran el mismo.
    if (!g) {
      p.el.classList.add('vertical');
    } else {
      p.el.classList.toggle('horizontal', g.layout === 'horizontal');
      p.el.classList.toggle('vertical', g.layout !== 'horizontal');
      p.el.classList.toggle('contraido', !!g.contraido);
      p.el.classList.toggle('oculto', !!g.oculto);
      if (g.alto) { p.el.classList.add('alturaFija'); p.el.style.height = g.alto; }
    }
    sincronizarBotonesPanel(p.el);
  });
  panelesContainer.addEventListener('click', clicAccionPanel);
  panelesContainer.addEventListener('dragstart', dragStartPanel);
  panelesContainer.addEventListener('dragover', dragOverPanel);
  panelesContainer.addEventListener('drop', dropPanel);
  panelesContainer.addEventListener('dragend', dragEndPanel);
  panelesContainer.addEventListener('mousedown', mousedownResizePanel);
  if (btnGUI) btnGUI.addEventListener('click', toggleModoGUI);
  if (btnVer) btnVer.addEventListener('click', toggleMenuVer);
  document.addEventListener('click', (ev) => {
    if (panelVerLista && panelVerLista.classList.contains('abierto') &&
        !panelVerLista.contains(ev.target) && ev.target !== btnVer) {
      panelVerLista.classList.remove('abierto');
      btnVer.classList.remove('activo');
    }
  });
}

function clicAccionPanel(ev) {
  const btn = ev.target.closest('.panelAccion');
  if (!btn) return;
  const panelEl = btn.closest('.panelGUI');
  if (!panelEl) return;
  const accion = btn.dataset.accion;
  if (accion === 'horizontal') {
    panelEl.classList.add('horizontal'); panelEl.classList.remove('vertical');
  } else if (accion === 'vertical') {
    panelEl.classList.add('vertical'); panelEl.classList.remove('horizontal');
  } else if (accion === 'contraer') {
    panelEl.classList.toggle('contraido');
  } else if (accion === 'ocultar') {
    panelEl.classList.add('oculto');
  }
  sincronizarBotonesPanel(panelEl);
  guardarLayoutGUI();
}

// La clase .panelAccion.activo ya estaba definida en el CSS pero nunca se
// asignaba: los 4 botones se veian identicos siempre, asi que en un panel
// no habia forma de saber si estaba en horizontal o en vertical sin
// deducirlo mirando el ancho. Se refleja el estado real del panel.
function sincronizarBotonesPanel(panelEl) {
  const esHorizontal = panelEl.classList.contains('horizontal');
  const contraido = panelEl.classList.contains('contraido');
  panelEl.querySelectorAll(':scope > .panelHeaderGUI .panelAccion').forEach((b) => {
    const a = b.dataset.accion;
    if (a === 'horizontal') b.classList.toggle('activo', esHorizontal);
    else if (a === 'vertical') b.classList.toggle('activo', !esHorizontal);
    else if (a === 'contraer') {
      b.classList.toggle('activo', contraido);
      // El caret tiene que apuntar en el sentido de la accion que hace,
      // no en el del estado: contraido -> "expandir" (abajo).
      b.innerHTML = contraido ? '&#8964;' : '&#8963;';
      b.title = contraido ? 'Expandir' : 'Contraer';
    }
  });
}

function dragStartPanel(ev) {
  const handle = ev.target.closest('.panelDrag');
  if (!handle) { ev.preventDefault(); return; }
  const panelEl = handle.closest('.panelGUI');
  ev.dataTransfer.setData('text/plain', panelEl.dataset.panelId);
  ev.dataTransfer.effectAllowed = 'move';
  // La clase .arrastrando ya existia en el CSS (sombra + z-index) pero
  // nunca se aplicaba, asi que arrastrar no daba ningun feedback visual:
  // el panel se quedaba igual y no se sabia cual se estaba moviendo.
  // Se agrega en un setTimeout(0) porque si se cambia el estilo del nodo
  // DENTRO del dragstart, Chromium ya tomo el "drag image" del elemento
  // y a veces sale la sombra congelada pegada al cursor.
  setTimeout(() => panelEl.classList.add('arrastrando'), 0);
}
function dragOverPanel(ev) {
  if (ev.target.closest('.panelGUI')) ev.preventDefault();
}
// dragend dispara SIEMPRE (incluso si se suelta afuera o se cancela con
// Escape), a diferencia de drop - por eso la limpieza visual va aca y no
// en dropPanel, que no corre si el arrastre se aborta.
function dragEndPanel() {
  panelesRegistro.forEach((p) => p.el.classList.remove('arrastrando'));
}
function dropPanel(ev) {
  const destino = ev.target.closest('.panelGUI');
  if (!destino) return;
  ev.preventDefault();
  const origenId = ev.dataTransfer.getData('text/plain');
  const origen = panelesRegistro.find((p) => p.id === origenId);
  if (!origen || origen.el === destino) return;
  const rect = destino.getBoundingClientRect();
  // El eje de comparacion tiene que seguir al eje en el que estan
  // apilados los paneles: si el destino esta en 'horizontal' quedan lado
  // a lado, y usar clientY (como se hacia antes) daba un resultado
  // aleatorio segun donde caia el cursor en la altura del panel.
  const despues = destino.classList.contains('horizontal')
    ? ev.clientX > rect.left + rect.width / 2
    : ev.clientY > rect.top + rect.height / 2;
  destino.parentNode.insertBefore(origen.el, despues ? destino.nextSibling : destino);
  panelesRegistro = Array.from(panelesContainer.querySelectorAll('[data-panel-id]'))
    .map((el) => panelesRegistro.find((p) => p.el === el))
    .filter(Boolean);
  guardarLayoutGUI();
}

function mousedownResizePanel(ev) {
  const handle = ev.target.closest('.panelResizeHandle');
  if (!handle) return;
  const panelEl = handle.closest('.panelGUI');
  ev.preventDefault();
  resizePanelState = { el: panelEl, y0: ev.clientY, alto0: panelEl.offsetHeight };
  panelEl.classList.add('alturaFija');
  window.addEventListener('mousemove', mousemoveResizePanel);
  window.addEventListener('mouseup', mouseupResizePanel);
}
function mousemoveResizePanel(ev) {
  if (!resizePanelState) return;
  const nuevoAlto = Math.max(80, resizePanelState.alto0 + (ev.clientY - resizePanelState.y0));
  resizePanelState.el.style.height = nuevoAlto + 'px';
}
function mouseupResizePanel() {
  if (!resizePanelState) return;
  resizePanelState = null;
  window.removeEventListener('mousemove', mousemoveResizePanel);
  window.removeEventListener('mouseup', mouseupResizePanel);
  guardarLayoutGUI();
}

function toggleModoGUI() {
  const activo = document.body.classList.toggle('modoGUI');
  btnGUI.classList.toggle('activo', activo);
}

function renderMenuVer() {
  if (!panelVerLista) return;
  let html = '';
  panelesRegistro.forEach((p) => {
    const visible = !p.el.classList.contains('oculto');
    html += `<label><input type="checkbox" data-ver-id="${p.id}" ${visible ? 'checked' : ''}> ${p.titulo}</label>`;
  });
  html += '<hr><label style="cursor:pointer;"><button type="button" id="btnResetLayoutGUI" class="secundario" style="width:100%;">Restablecer disposicion</button></label>';
  panelVerLista.innerHTML = html;
  panelVerLista.querySelectorAll('input[data-ver-id]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const p = panelesRegistro.find((x) => x.id === chk.dataset.verId);
      if (p) p.el.classList.toggle('oculto', !chk.checked);
      guardarLayoutGUI();
    });
  });
  const btnReset = document.getElementById('btnResetLayoutGUI');
  if (btnReset) btnReset.addEventListener('click', () => {
    localStorage.removeItem(LAYOUT_KEY);
    panelesRegistro.forEach((p) => {
      p.el.classList.remove('horizontal', 'contraido', 'oculto', 'alturaFija', 'arrastrando');
      p.el.classList.add('vertical');
      p.el.style.height = '';
      sincronizarBotonesPanel(p.el);
    });
    // "Restablecer" tambien tiene que devolver el ORDEN original, no solo
    // el tamano/visibilidad: antes se borraba la clave de localStorage
    // pero los nodos quedaban movidos en el DOM, asi que el orden viejo
    // seguia en pantalla hasta reiniciar la app (y si el user tocaba
    // cualquier otra accion, guardarLayoutGUI lo volvia a persistir).
    panelesRegistro = ordenOriginalPaneles
      .map((id) => panelesRegistro.find((p) => p.id === id))
      .filter(Boolean);
    panelesRegistro.forEach((p) => panelesContainer.appendChild(p.el));
    renderMenuVer();
  });
}

function toggleMenuVer() {
  const abierto = panelVerLista.classList.toggle('abierto');
  btnVer.classList.toggle('activo', abierto);
  if (abierto) renderMenuVer();
}

renderKeys();
renderRecuadrosOverlay();
limpiarCanvas916();
// Arranque de la app: pantalla de inicio con la lista de proyectos
// guardados (pedido 29/07/2026) - #pantallaTrabajo queda escondida
// hasta que se elija "Nuevo proyecto" o se abra uno de la lista.
mostrarPantallaInicio();
inicializarPanelesGUI();
