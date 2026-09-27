// ============================================================
// CLIPFORGE — RENDERER (reescrito 06/08/2026)
// ============================================================
// Se borro TODA la linea de tiempo y los visores para rehacerlos de cero
// (copia del estado anterior completo en E:\Clipforge2). Este archivo
// quedo con lo que NO era timeline ni visor:
//   pantalla de proyectos, elegir archivo, transcribir, editor de bloques
//   de corte, sugerencias, analisis con IA y API keys.
//
// Se reescribio en vez de recortarse a mano: el archivo anterior tenia
// 3207 lineas con la timeline entrelazada en todos lados, y la cirugia
// dejaba restos (referencias a funciones ya borradas) que solo aparecen
// en runtime. Partir de cero sobre lo que sobrevive es mas corto y no
// deja fantasmas.
//
// Los 2 espacios reservados en index.html (#zonaVisores y #zonaTimeline)
// ya estan ocupados: la linea de tiempo primero, y el VISOR despues
// (06/08/2026) - ver el bloque "VISOR" mas abajo para los dos ejes de
// tiempo, que es lo unico delicado de esa parte.

'use strict';

// ---------- Estado ----------
let archivoActual = null;
let bloquesActuales = [];

// ---------- Elementos ----------
const $ = (id) => document.getElementById(id);

const pantallaInicio = $('pantallaInicio');
const app = $('app');
const listaProyectos = $('listaProyectos');
const btnNuevoProyecto = $('btnNuevoProyecto');
const btnInicio = $('btnInicio');

const btnElegir = $('btnElegir');
const btnTranscribir = $('btnTranscribir');
const selectorMotor = $('selectorMotor');
const archivoElegido = $('archivoElegido');
const estado = $('estado');

const transcripcionDiv = $('transcripcion');
const resumenCortes = $('resumenCortes');
const sugerenciasTexto = $('sugerenciasTexto');
const btnAceptarSugerencias = $('btnAceptarSugerencias');
const btnDescartarSugerencias = $('btnDescartarSugerencias');

const btnAnalizarIA = $('btnAnalizarIA');
const selectKeyIA = $('selectKeyIA');
const inputModeloIA = $('inputModeloIA');
const inputInstruccionesIA = $('inputInstruccionesIA');
const estadoIA = $('estadoIA');

const inputNombreKey = $('inputNombreKey');
const inputValorKey = $('inputValorKey');
const btnGuardarKey = $('btnGuardarKey');
const listaKeys = $('listaKeys');
const estadoKeyNvidia = $('estadoKeyNvidia');
const inputNubeFunctionId = $('inputNubeFunctionId');
const inputNubeIdioma = $('inputNubeIdioma');
const inputNubePalabras = $('inputNubePalabras');
const btnGuardarNube = $('btnGuardarNube');

// ---------- Utilidades ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtTiempo(seg) {
  if (!isFinite(seg) || seg < 0) seg = 0;
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.floor(seg % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ============================================================
// PANTALLA DE PROYECTOS
// ============================================================

function mostrarInicio() {
  pantallaInicio.classList.remove('oculto');
  app.classList.add('oculto');
  cargarListaProyectos();
}

function mostrarTrabajo() {
  pantallaInicio.classList.add('oculto');
  app.classList.remove('oculto');
}

function reiniciarEstado() {
  bloquesActuales = [];
  transcripcionDiv.innerHTML = '';
  resumenCortes.classList.add('oculto');
  estado.textContent = '';
  estadoIA.textContent = '';
  renderSugerencias();
  tlDatos = { media: [], pistas: [], duracion: 0, puedeDeshacer: false, puedeRehacer: false };
  elSeleccionado = null;
  cabezal = 0;
  layout916 = null;
  recSeleccionado = null;
  visorReiniciar();
  renderTl();
  renderMedia();
  pintar916(true);
}

async function cargarListaProyectos() {
  const proyectos = await window.clipForge.proyectosListar();
  if (!proyectos || !proyectos.length) {
    listaProyectos.innerHTML = '<div class="sub">Todavía no hay proyectos guardados.</div>';
    return;
  }
  listaProyectos.innerHTML = proyectos.map((p) => `
    <div class="tarjetaProyecto${p.existeArchivoOriginal === false ? ' faltante' : ''}"
         data-path="${escapeHtml(p.inputPath)}" data-existe="${p.existeArchivoOriginal !== false}">
      <div class="nom">${escapeHtml((p.inputPath || '').split(/[\\/]/).pop())}</div>
      <div class="meta">${p.resumen ? `${p.resumen.totalBlocks} bloques · ${p.resumen.porcentajeEliminado}% fuera` : 'sin transcribir'}</div>
      ${p.existeArchivoOriginal === false ? '<div class="meta">el archivo original ya no está</div>' : ''}
    </div>`).join('');

  listaProyectos.querySelectorAll('.tarjetaProyecto').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.existe === 'false') return;
      abrirProyecto(el.dataset.path);
    });
  });
}

async function abrirProyecto(inputPath) {
  const data = await window.clipForge.proyectosAbrir(inputPath);
  if (!data) { estado.textContent = 'No se pudo abrir ese proyecto.'; return; }
  reiniciarEstado();
  archivoActual = inputPath;
  archivoElegido.textContent = inputPath;
  btnTranscribir.disabled = false;
  btnAnalizarIA.disabled = false;
  bloquesActuales = data.blocks || [];
  mostrarTrabajo();
  cargarMontaje(0);
  renderBloques();
  if (data.resumen) renderResumen(data.resumen);
}

btnNuevoProyecto.addEventListener('click', () => { reiniciarEstado(); archivoActual = null; archivoElegido.textContent = 'Ningún archivo'; btnTranscribir.disabled = true; mostrarTrabajo(); });
btnInicio.addEventListener('click', mostrarInicio);

// ============================================================
// ARCHIVO Y TRANSCRIPCION
// ============================================================

btnElegir.addEventListener('click', async () => {
  const ruta = await window.clipForge.elegirArchivo();
  if (!ruta) return;
  reiniciarEstado();
  archivoActual = ruta;
  archivoElegido.textContent = ruta;
  archivoElegido.title = ruta;
  btnTranscribir.disabled = false;
  btnAnalizarIA.disabled = false;
  cargarMontaje(0);
});

// Avisa ANTES de lanzar whisper si el interprete de Python del motor
// elegido no esta donde la app lo busca. Sin esto el unico sintoma es un
// error crudo del spawn a mitad de camino, y el mensaje del main manda a
// un "panel Ajustes" que hoy no existe en la interfaz.
async function motorDisponible(motor) {
  try {
    const ajustes = await window.clipForge.exportAjustesObtener();
    const clave = motor === 'fasterwhisper' ? 'pythonFasterWhisper' : 'pythonWhisperX';
    const bin = (ajustes && ajustes.binarios || []).find((b) => b.clave === clave);
    if (bin && !bin.disponible) {
      return `No se encontró ${bin.etiqueta} en "${bin.ruta}". Configuralo con la variable de entorno CLIPFORGE_PYTHON_${motor === 'fasterwhisper' ? 'FASTERWHISPER' : 'WHISPERX'} o elegí el otro motor.`;
    }
  } catch (e) { /* si el chequeo falla, seguir e intentar igual */ }
  return null;
}

btnTranscribir.addEventListener('click', async () => {
  if (!archivoActual) return;
  const falta = await motorDisponible(selectorMotor.value);
  if (falta) { estado.textContent = falta; return; }
  btnTranscribir.disabled = true;
  estado.textContent = 'Transcribiendo…';
  try {
    const res = await window.clipForge.transcribir(archivoActual, selectorMotor.value);
    if (!res || res.error) {
      estado.textContent = 'Error: ' + ((res && res.error) || 'desconocido');
    } else {
      bloquesActuales = res.blocks || [];
      renderBloques();
      if (res.resumen) renderResumen(res.resumen);
      // El main devuelve "yaExistia" (no "reutilizado"): con el nombre
      // viejo este aviso no aparecia nunca y parecia que habia vuelto a
      // correr whisper cuando en realidad reuso el proyecto guardado.
      if (res.yaExistia) {
        estado.textContent = 'Transcripción ya existente, reutilizada.';
      } else if (res.textoGuardadoEn) {
        // Decir DONDE quedo: un guardado automatico que no se anuncia es
        // lo mismo que no existir, porque nadie va a buscar un archivo
        // que no sabe que esta ahi.
        estado.textContent = `Listo. Texto guardado en ${res.textoGuardadoEn}`;
      } else {
        estado.textContent = 'Listo.';
      }
    }
  } catch (e) {
    estado.textContent = 'Error: ' + e.message;
  }
  btnTranscribir.disabled = false;
});

if (window.clipForge.onProgreso) {
  window.clipForge.onProgreso((data) => {
    if (data && data.pct != null) estado.textContent = `Transcribiendo… ${Math.round(data.pct)}%`;
  });
}

// ============================================================
// EDITOR DE BLOQUES
// ============================================================

function renderResumen(r) {
  if (!r) return;
  resumenCortes.classList.remove('oculto');
  $('rTotal').textContent = r.totalBlocks;
  $('rCortados').textContent = r.cutCount;
  $('rDuracion').textContent = fmtTiempo(r.keptDurationSec);
  $('rPct').textContent = r.porcentajeEliminado + '%';
}

function renderBloques() {
  transcripcionDiv.innerHTML = bloquesActuales.map((b) => {
    const ts = b.start != null ? fmtTiempo(b.start) : '';
    return `<div class="bloque ${b.type} ${b.status}" data-id="${b.id}">
      <span class="ts">${ts}</span>${escapeHtml(b.text)}
    </div>`;
  }).join('');

  renderSugerencias();

  transcripcionDiv.querySelectorAll('.bloque').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!archivoActual) return;
      const res = await window.clipForge.cortesToggle(archivoActual, el.dataset.id);
      if (!res) return;
      const i = bloquesActuales.findIndex((b) => b.id === el.dataset.id);
      if (i >= 0) bloquesActuales[i] = res.block;
      renderResumen(res.resumen);
      renderBloques();
    });
  });
}

// Los silencios entran como 'propuesta' (no se cortan solos): se ven
// marcados pero no afectan al video hasta que se acepten.
function renderSugerencias() {
  const n = bloquesActuales.filter((b) => b.status === 'propuesta').length;
  sugerenciasTexto.textContent = n
    ? `${n} sugerencia${n === 1 ? '' : 's'} sin aplicar`
    : 'Sin sugerencias';
  btnAceptarSugerencias.disabled = n === 0;
  btnDescartarSugerencias.disabled = n === 0;
  $('btnAplicarCortes').disabled = !bloquesActuales.some((b) => b.status === 'cut');
}

async function accionSugerencias(accion) {
  if (!archivoActual) return;
  const res = await window.clipForge.cortesSugerencias(archivoActual, accion);
  if (!res) return;
  bloquesActuales = res.blocks;
  renderBloques();
  renderResumen(res.resumen);
  estado.textContent = accion === 'aplicar'
    ? 'Sugerencias aplicadas.'
    : 'Sugerencias descartadas.';
}

btnAceptarSugerencias.addEventListener('click', () => accionSugerencias('aplicar'));

// PUENTE TRANSCRIPCION -> MONTAJE (tanda H, paso 11). Un solo paso de
// deshacer y un resumen en vez de un cartel por corte.
function textoDeCortes(inf) {
  if (!inf) return 'No se aplicaron cortes.';
  if (inf.sinMaterial) return 'El archivo transcripto no está en la línea de tiempo: no hay dónde aplicar los cortes.';
  const partes = [];
  partes.push(inf.aplicados
    ? `${inf.aplicados} corte${inf.aplicados === 1 ? '' : 's'} aplicado${inf.aplicados === 1 ? '' : 's'} (${fmtTiempo(inf.segundos)} menos).`
    : 'No se aplicó ningún corte.');
  if (inf.sinLugar) partes.push(`${inf.sinLugar} ya no estaba${inf.sinLugar === 1 ? '' : 'n'} en la línea.`);
  if (inf.varios) partes.push(`${inf.varios} aparecía${inf.varios === 1 ? '' : 'n'} en más de un lugar y se cortó en todos.`);
  if (inf.frenados && inf.frenados.length) {
    const f = inf.frenados[0];
    partes.push(`${inf.frenados.length} no se aplicó${inf.frenados.length === 1 ? '' : 'aron'}: ${textoDeRipple({ bloqueo: f.bloqueo }, '', `el de ${fmtTiempo(f.inicio)}`)}`);
  }
  if (inf.aplicados) partes.push('Ctrl+Z los devuelve.');
  return partes.join(' ');
}

$('btnAplicarCortes').addEventListener('click', () => {
  if (!archivoActual) return;
  opTl(window.clipForge.montajeAplicarCortes(archivoActual))
    .then((res) => { if (res) estado.textContent = textoDeCortes(res.cortes); });
});
btnDescartarSugerencias.addEventListener('click', () => accionSugerencias('descartar'));

// ---------- Exportar datos ----------
async function exportar(fn, etiqueta) {
  if (!archivoActual) return;
  const res = await fn(archivoActual);
  estado.textContent = res && res.ok ? `${etiqueta}: ${res.path}` : `No se pudo exportar ${etiqueta}.`;
}
$('btnExportJson').addEventListener('click', () => exportar(window.clipForge.cortesExportarJson, 'JSON'));
$('btnExportSrt').addEventListener('click', () => exportar(window.clipForge.cortesExportarSrt, 'SRT'));
$('btnExportTranscripcionFinal').addEventListener('click', () =>
  exportar((p) => window.clipForge.cortesExportarTranscripcion(p, true), 'Texto final'));
$('btnExportTranscripcionCompleta').addEventListener('click', () =>
  exportar((p) => window.clipForge.cortesExportarTranscripcion(p, false), 'Texto completo'));
// Texto plano CONTINUO: sin marcas de tiempo, sin encabezado, sin filtrar
// por estado de corte. El handler y blocksToPlainText() ya existian desde
// el 05/08/2026, pero al reescribir el renderer el boton no se rehizo, asi
// que la funcion quedaba inalcanzable desde la interfaz.
$('btnExportTranscripcionPlana').addEventListener('click', () =>
  exportar(window.clipForge.cortesExportarTranscripcionPlana, 'Solo texto'));

// ---------- Exportar VIDEO (13/09/2026, 1.3.b) ----------
// Todo el trabajo esta en exportVideo.js y guionExport.js; aca solo los
// botones, el progreso y la cancelacion.
//
// Se exporta el montaje que la ventana YA TIENE (tlDatos.montaje), que es
// el mismo que dibuja el visor. Pedirlo de nuevo al main no agrega nada:
// cada operacion ya devuelve el montaje completo.
const exportUi = {
  vertical: $('btnExportVertical'),
  horizontal: $('btnExportHorizontal'),
  cancelar: $('btnExportCancelar'),
  progreso: $('exportProgreso'),
  estado: $('exportEstado')
};
let exportEnCurso = null;   // { cancelado } mientras corre

async function exportarVideo(modo) {
  if (!exportUi.vertical || exportEnCurso) return;
  if (!archivoActual || !tlDatos.montaje) {
    exportUi.estado.textContent = 'Primero abrí un video.';
    return;
  }
  const senal = { cancelado: false };
  exportEnCurso = senal;
  exportUi.vertical.disabled = true;
  exportUi.horizontal.disabled = true;
  exportUi.cancelar.classList.remove('oculto');
  exportUi.progreso.classList.remove('oculto');
  exportUi.progreso.value = 0;
  try {
    let ajustes = {};
    try { ajustes = ((await window.clipForge.exportAjustesObtener()) || {}).exportacion || {}; } catch (e) { ajustes = {}; }
    const res = await ExportVideo.exportar({
      inputPath: archivoActual,
      // El montaje de ESTE momento. No hace falta copiarlo: cada respuesta
      // del main trae un objeto nuevo y tlDatos se reemplaza entero, asi
      // que seguir editando mientras exporta no toca este.
      montaje: tlDatos.montaje,
      layout: layout916,
      modo,
      ajustes,
      senal,
      alEstado: (txt) => { exportUi.estado.textContent = txt; },
      alProgreso: (hechos, total) => {
        exportUi.progreso.value = total ? hechos / total : 0;
        // Actualizar el texto en cada cuadro es trabajo de layout por nada.
        if (hechos % 15 === 0 || hechos === total) {
          exportUi.estado.textContent = `Exportando… ${hechos} de ${total} cuadros`;
        }
      }
    });
    if (res.cancelado) {
      exportUi.estado.textContent = 'Exportación cancelada.';
    } else {
      // El sonido se describe como salio de verdad (tanda D): con la mezcla,
      // sin sonido porque el montaje no tiene, o sin sonido por un problema.
      const sonido = res.codecAudio ? `con sonido ${res.codecAudio}`
        : (res.tramosDeAudio ? 'SIN sonido' : 'sin sonido: el montaje no tiene audio');
      const avisos = (res.avisos || []).length ? ` Ojo: ${res.avisos.join('; ')}.` : '';
      exportUi.estado.textContent =
        `Listo (${res.cuadros} cuadros a ${+res.fps.toFixed(3)} fps, ${res.codec}, ${sonido}, ${res.segundos.toFixed(1)} s): ${res.ruta}.${avisos}`;
    }
  } catch (e) {
    exportUi.estado.textContent = 'No se pudo exportar: ' + ((e && e.message) || e);
  } finally {
    exportEnCurso = null;
    exportUi.vertical.disabled = false;
    exportUi.horizontal.disabled = false;
    exportUi.cancelar.classList.add('oculto');
    exportUi.progreso.classList.add('oculto');
  }
}

if (exportUi.vertical) {
  exportUi.vertical.addEventListener('click', () => exportarVideo('vertical'));
  exportUi.horizontal.addEventListener('click', () => exportarVideo('horizontal'));
  exportUi.cancelar.addEventListener('click', () => {
    if (exportEnCurso) {
      exportEnCurso.cancelado = true;
      exportUi.estado.textContent = 'Cancelando…';
    }
  });
}

// ============================================================
// ANALISIS CON IA
// ============================================================

async function poblarKeysIA() {
  const keys = await window.clipForge.keysListar();
  const openrouter = (keys || []).filter((k) => k.proveedor === 'OpenRouter');
  selectKeyIA.innerHTML = openrouter.length
    ? openrouter.map((k) => `<option value="${k.id}">${escapeHtml(k.nombre)} (${escapeHtml(k.mask || '')})</option>`).join('')
    : '<option value="">Sin keys de OpenRouter</option>';
}

btnAnalizarIA.addEventListener('click', async () => {
  if (!archivoActual) return;
  btnAnalizarIA.disabled = true;
  estadoIA.textContent = 'Analizando…';
  try {
    const res = await window.clipForge.analizarIA({
      inputPath: archivoActual,
      backend: 'openrouter',
      modelo: inputModeloIA.value.trim(),
      keyId: selectKeyIA.value,
      instrucciones: inputInstruccionesIA.value.trim()
    });
    if (!res || res.error) {
      estadoIA.textContent = 'Error: ' + ((res && res.error) || 'desconocido');
    } else {
      bloquesActuales = res.blocks || bloquesActuales;
      renderBloques();
      if (res.resumen) renderResumen(res.resumen);
      estadoIA.textContent = `${res.propuestas || 0} sugerencias nuevas.`;
    }
  } catch (e) {
    estadoIA.textContent = 'Error: ' + e.message;
  }
  btnAnalizarIA.disabled = false;
});

// ============================================================
// API KEYS
// ============================================================

async function renderKeys() {
  const keys = await window.clipForge.keysListar();
  listaKeys.innerHTML = (keys || []).map((k) => `
    <div class="key-item">
      <span class="key-proveedor">${escapeHtml(k.proveedor || '—')}</span>
      <span class="key-nombre">${escapeHtml(k.nombre)}</span>
      <span class="key-mask">${escapeHtml(k.ultimos4 ? '····' + k.ultimos4 : '')}${k.ilegible ? ' ⚠' : ''}</span>
      <button class="btn-eliminar" data-id="${k.id}">Quitar</button>
    </div>`).join('');

  listaKeys.querySelectorAll('.btn-eliminar').forEach((b) => {
    b.addEventListener('click', async () => {
      await window.clipForge.keysEliminar(b.dataset.id);
      renderKeys();
      poblarKeysIA();
      renderNube();
    });
  });
}

// Panel del motor de nube. Solo muestra config NO secreta: la key vive
// cifrada en el proceso principal y nunca baja al renderer, asi que lo
// unico que se informa aca es SI hay una.
async function renderNube() {
  if (!estadoKeyNvidia) return;
  const conf = await window.clipForge.nubeObtener();
  estadoKeyNvidia.textContent = conf.hayKey
    ? 'Key de NVIDIA detectada. Ya podés elegir "NVIDIA Parakeet (nube)" al transcribir.'
    : 'Sin key de NVIDIA. Pegá una que empiece con nvapi- en el panel de arriba.';
  estadoKeyNvidia.classList.toggle('ok', Boolean(conf.hayKey));
  inputNubeFunctionId.value = conf.functionId || '';
  inputNubeIdioma.value = conf.idioma || 'es-US';
  inputNubePalabras.value = conf.palabrasClave || '';
}

btnGuardarNube.addEventListener('click', async () => {
  await window.clipForge.nubeGuardar({
    functionId: inputNubeFunctionId.value.trim(),
    idioma: inputNubeIdioma.value.trim() || 'es-US',
    palabrasClave: inputNubePalabras.value.trim()
  });
  estado.textContent = 'Configuración de la nube guardada.';
  renderNube();
});

btnGuardarKey.addEventListener('click', async () => {
  const nombre = inputNombreKey.value.trim();
  const valor = inputValorKey.value.trim();
  if (!nombre || !valor) { estado.textContent = 'Falta el nombre o el valor de la key.'; return; }
  await window.clipForge.keysGuardar(nombre, valor);
  inputNombreKey.value = '';
  inputValorKey.value = '';
  renderKeys();
  poblarKeysIA();
  renderNube();
  estado.textContent = 'Key guardada (cifrada).';
});


// ============================================================
// LINEA DE TIEMPO (06/08/2026)
// ============================================================
// Dibuja el montaje de src/shared/montaje.js — modelo secuencial con
// huecos explicitos, escrito despues de investigar OpenTimelineIO y
// MLT/Kdenlive.
//
// TODA la aritmetica vive en el main (via los canales montaje:*). Aca
// solo se dibuja y se traducen gestos del mouse a operaciones: si una
// cuenta se hace en los dos lados, tarde o temprano divergen.

const tlBarra = $('tlBarra');
const tlEncabezados = $('tlEncabezados');
const tlScroll = $('tlScroll');
const tlLienzo = $('tlLienzo');
const tlRegla = $('tlRegla');
const tlPistas = $('tlPistas');
const tlCabezal = $('tlCabezal');
const tlInfo = $('tlInfo');
const tlZoomTexto = $('tlZoomTexto');
const chkIman = $('chkIman');
const chkSaltarVacios = $('chkSaltarVacios');

// Al llegar a un vacio: saltar al proximo material, o atravesarlo.
// ES UNA OPCION porque las dos cosas sirven en momentos distintos, y con
// la pista de audio ya separada saltar puede hacer perder sonido que si
// esta ahi. Arranca APAGADO: reproducir lo que hay es lo que menos
// sorprende; saltar es una comodidad que se pide.
const saltarVacios = () => !!(chkSaltarVacios && chkSaltarVacios.checked);

if (chkSaltarVacios) {
  try {
    chkSaltarVacios.checked = localStorage.getItem('clipforge.saltarVacios') === 'si';
  } catch (e) { /* sin persistencia, arranca apagado */ }
  chkSaltarVacios.addEventListener('change', () => {
    try { localStorage.setItem('clipforge.saltarVacios', chkSaltarVacios.checked ? 'si' : 'no'); } catch (e) { /* idem */ }
    estado.textContent = chkSaltarVacios.checked
      ? 'Los vacíos se saltan al reproducir.'
      : 'Los vacíos se reproducen: pantalla en negro, y se escucha el audio que haya.';
  });
}

let tlDatos = { media: [], pistas: [], duracion: 0, puedeDeshacer: false, puedeRehacer: false };
let herramienta = 'seleccion';
let elSeleccionado = null;      // { pistaId, elId }
let cabezal = 0;                // instante en la LINEA
let zoomTl = 1;                 // 1 = todo el montaje entra en el ancho
let arrastreTl = null;
// SELECCION MULTIPLE (tanda G, paso 9). elSeleccionado sigue siendo "el
// clip principal" (el visor, los keyframes y el recuadro 9:16 lo usan tal
// cual); grupoSel es la lista entera cuando se eligieron varios con
// Ctrl/Shift+clic. Con uno solo, grupoSel tiene ese uno o esta vacia.
let grupoSel = [];
const hayGrupo = () => grupoSel.length > 1;
const ALTO_PISTA = 46;
const ALTO_REGLA = 20;

// Destino "una pista que todavia no existe". La constante sale del modelo
// para que el renderer y el main no puedan quedar diciendo cosas
// distintas; el || es para que la interfaz no se rompa si por alguna
// razon el modulo no cargo.
const PISTA_NUEVA = (window.Montaje && Montaje.PISTA_NUEVA) || '__nueva__';

// Escala: cuanto dura el montaje. Nunca 0, para no dividir por cero
// antes de que haya material.
const durTl = () => Math.max(tlDatos.duracion || 0, 1);

// LARGO DE LA VISTA, distinto del largo del MONTAJE.
//
// La linea de tiempo terminaba EXACTAMENTE donde termina el ultimo clip:
// la pista llegaba pegada al borde derecho, no habia manera de verla
// entera con aire ni de soltar un clip despues del final, porque ahi
// afuera no habia lienzo donde soltarlo. Cualquier editor deja lugar
// despues del ultimo clip por este mismo motivo.
//
// La diferencia importa: durTl() es cuanto DURA el montaje (lo que se le
// manda al main y lo que limita al reproductor), durVista() es cuanto se
// DIBUJA. Mezclarlos haria que el video se pueda "reproducir" sobre un
// vacio que no existe.
const MARGEN_MIN = 5;            // segundos, para montajes cortos
const MARGEN_PROPORCION = 0.08;  // 8% para los largos
const durVista = () => {
  const d = durTl();
  return d + Math.max(MARGEN_MIN, d * MARGEN_PROPORCION);
};

// Tolerancia del iman EN SEGUNDOS, calculada desde el zoom: asi el iman
// se siente igual de fuerte con la linea de tiempo chica o agrandada,
// que es la parte que se suele hacer mal.
// `invertir` (Shift apretado mientras se arrastra, tanda G) da vuelta la
// casilla: prende el iman si estaba apagado y lo apaga si estaba prendido.
function toleranciaIman(invertir) {
  const activo = window.PreviewTl
    ? PreviewTl.imanActivo(!!(chkIman && chkIman.checked), !!invertir)
    : !!(chkIman && chkIman.checked);
  if (!activo) return 0;
  const ancho = tlLienzo ? tlLienzo.getBoundingClientRect().width : 0;
  return ancho > 0 ? (durVista() / ancho) * 8 : 0;   // 8 px de agarre
}

// Todos los bordes de todos los elementos, mas el cabezal.
function puntosIman() {
  const p = new Set([0, cabezal]);
  tlDatos.pistas.forEach((pi) => pi.elementos.forEach((el) => { p.add(el.inicio); p.add(el.fin); }));
  return [...p];
}

function imantar(t, invertir) {
  const tol = toleranciaIman(invertir);
  if (!(tol > 0)) return t;
  let mejor = t, dist = tol;
  for (const p of puntosIman()) {
    const d = Math.abs(p - t);
    if (d <= dist) { dist = d; mejor = p; }
  }
  return mejor;
}

// Posicion del mouse -> instante de la LINEA, en el cuadro mas cercano
// (tanda D, paso 6). El modelo ya redondea en la puerta de cada operacion;
// redondear aca tambien hace que el fantasma, el iman y el cabezal muestren
// el mismo lugar donde el clip va a quedar.
function tiempoDesdeX(clientX) {
  const r = tlLienzo.getBoundingClientRect();
  if (r.width <= 0) return 0;
  const t = Math.max(0, ((clientX - r.left) / r.width) * durVista());
  return tlDatos.montaje && window.Montaje ? Montaje.aCuadro(tlDatos.montaje, t) : t;
}

// Cuadros por segundo del montaje como numero (0 si no tiene base de cuadro).
function fpsTl() {
  const f = tlDatos.montaje && window.Montaje ? Montaje.fpsDe(tlDatos.montaje) : null;
  return f ? f.num / f.den : 0;
}

// ---------- Herramientas ----------
function fijarHerramienta(cual) {
  herramienta = cual;
  document.body.className = document.body.className.replace(/\btl-\S+/g, '').trim();
  document.body.classList.add('tl-' + cual);
  if (tlBarra) tlBarra.querySelectorAll('.herramienta').forEach((b) => b.classList.toggle('activa', b.dataset.tool === cual));
}

if (tlBarra) {
  tlBarra.addEventListener('click', (ev) => {
    const b = ev.target.closest('.herramienta');
    if (b) fijarHerramienta(b.dataset.tool);
  });
}

const ATAJOS = { v: 'seleccion', c: 'cuchilla', b: 'ripple', n: 'roll', y: 'slip', u: 'slide' };
window.addEventListener('keydown', (ev) => {
  // Escape suelta un arrastre SIN aplicarlo (13/09/2026, tanda C). Va
  // antes que cualquier filtro: si hay un clip pegado al mouse, cancelarlo
  // es lo unico que Escape puede querer decir.
  if (ev.key === 'Escape' && arrastreTl) {
    ev.preventDefault();
    cancelarArrastreTl('Arrastre cancelado.');
    return;
  }
  // Solo se cede el teclado cuando se esta ESCRIBIENDO. El filtro viejo
  // salia con cualquier INPUT, y las casillas 'Imán' y 'Saltar vacíos' lo
  // son: despues de tocarlas no andaba ningun atajo (hallazgo 18).
  if (GestosTl.esCampoDeTexto(document.activeElement)) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) rehacerTl(); else deshacerTl();
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  // Espacio = reproducir/pausar, como en cualquier editor. Va antes que
  // las herramientas para que no lo pise ningun atajo de letra.
  if (k === ' ') { ev.preventDefault(); visorAlternar(); return; }
  if (k === 'home') { ev.preventDefault(); visorPausar(); visorIrA(0, true); return; }
  // Flechas: un cuadro; con Shift, un segundo (tanda D, paso 6). Pausa,
  // como en cualquier editor: avanzar de a cuadro es para mirar uno.
  if (k === 'arrowleft' || k === 'arrowright') {
    ev.preventDefault();
    visorPausar();
    visorIrA(GestosTl.cabezalConFlecha({
      cabezal, fps: fpsTl(), sentido: k === 'arrowleft' ? -1 : 1, grande: ev.shiftKey, duracion: tlDatos.duracion || 0
    }), true);
    return;
  }
  if (ATAJOS[k]) { fijarHerramienta(ATAJOS[k]); return; }
  if ((k === 'delete' || k === 'backspace') && hayGrupo()) {
    ev.preventDefault();
    borrarGrupoSel(ev.shiftKey);
    return;
  }
  if ((k === 'delete' || k === 'backspace') && elSeleccionado) {
    ev.preventDefault();
    borrarSeleccionado(ev.shiftKey);
  }
});

// ---------- Datos ----------
function aplicarTl(res) {
  if (!res) return;
  tlDatos = res;
  // Lo elegido que ya no existe (deshacer, borrar) se saca del grupo.
  grupoSel = window.PreviewTl && res.montaje ? PreviewTl.sanearSeleccion(Montaje, res.montaje, grupoSel) : [];
  $('btnDeshacer').disabled = !res.puedeDeshacer;
  $('btnRehacer').disabled = !res.puedeRehacer;
  const clips = res.pistas.flatMap((p) => p.elementos.filter((e) => e.tipo === 'clip'));
  const nEnc = clips.filter((e) => e.ajuste).length;
  const nClips = clips.length - nEnc;
  const nHuecos = res.pistas.reduce((a, p) => a + p.elementos.filter((e) => e.tipo === 'hueco').length, 0);
  if (tlInfo) {
    tlInfo.textContent = `${res.pistas.length} pistas · ${nClips} clips` +
      `${nEnc ? ` · ${nEnc} encuadre${nEnc > 1 ? 's' : ''}` : ''}` +
      `${nHuecos ? ` · ${nHuecos} vacíos` : ''} · ${fmtTiempo(res.duracion)}`;
  }

  // LA DISPOSICION DEL PANEL 9:16 VIENE EN LA MISMA RESPUESTA
  // (07/08/2026). Antes llegaba por el canal `recuadros:*`, y esa era la
  // mitad del bug de fondo: eran dos estados que se refrescaban por
  // separado, asi que cualquier operacion sobre el montaje dejaba el
  // panel vertical mostrando lo de antes hasta que algo mas lo pidiera.
  // Un solo camino, imposible que queden desfasados.
  layout916 = res.layout || null;
  if (aviso916) {
    const d = res.diagnostico || {};
    const partes = [];
    if (d.solapes) partes.push(`${d.solapes} encimad${d.solapes > 1 ? 'as' : 'a'}`);
    if (d.cobertura != null && d.cobertura < 0.999 && nEnc) {
      partes.push(`${Math.round((1 - d.cobertura) * 100)}% en negro`);
    }
    aviso916.textContent = partes.join(' · ');
  }

  renderTl();
  renderMedia();
  // El montaje cambio, asi que lo que se ve bajo el cabezal puede ser
  // otra cosa: el visor tiene que volver a resolverlo.
  visorRefrescar();
  // FORZADO a proposito: si llego una respuesta es porque algo cambio, y
  // no siempre cambia la "firma" que usa pintar916 para decidir si vale
  // la pena rehacer el DOM. Cambiar de preset mueve las celdas pero deja
  // los mismos encuadres activos y la misma seleccion (bug reportado el
  // 06/08/2026: al elegir "Apilados" el panel se quedaba con la
  // disposicion vieja hasta que se tocaba una celda).
  pintar916(true);
}

async function cargarMontaje(duracion) {
  if (!archivoActual) return;
  // Un solo pedido: los encuadres son parte del montaje y el layout viaja
  // con el. Antes hacian falta dos, y el segundo dependia de que el
  // primero ya hubiera medido el archivo.
  aplicarTl(await window.clipForge.montajeObtener(archivoActual, duracion || 0));
}

async function opTl(promesa, mensaje) {
  const res = await promesa;
  if (!res) return null;
  aplicarTl(res);
  if (mensaje) estado.textContent = mensaje;
  // Se devuelve la respuesta para quien necesite CONTAR que paso (por
  // ejemplo: en que pista aterrizo el material, o si hubo que crear una).
  return res;
}

const deshacerTl = () => archivoActual && tlDatos.puedeDeshacer &&
  opTl(window.clipForge.montajeDeshacer(archivoActual, durTl()), 'Deshecho.');
const rehacerTl = () => archivoActual && tlDatos.puedeRehacer &&
  opTl(window.clipForge.montajeRehacer(archivoActual, durTl()), 'Rehecho.');

$('btnDeshacer').addEventListener('click', deshacerTl);
$('btnRehacer').addEventListener('click', rehacerTl);

// Supr con varios clips elegidos: cada uno deja su vacio (con su sonido),
// en UN solo paso de deshacer. Shift+Supr (borrar con ripple) de varios a
// la vez no se hace: cada ripple mueve lo de atras y el segundo ya no
// estaria donde el usuario lo eligio. Se dice en vez de hacer otra cosa.
function borrarGrupoSel(cerrar) {
  if (!hayGrupo() || !archivoActual) return;
  if (cerrar) {
    estado.textContent = 'Quitar cerrando el espacio se hace de a un clip. Supr sin Shift deja los vacíos.';
    return;
  }
  const refs = grupoSel.slice();
  grupoSel = [];
  elSeleccionado = null;
  opTl(window.clipForge.montajeGrupo(archivoActual, 'borrar', refs),
    `${refs.length} clips quitados (quedan sus vacíos). Ctrl+Z para deshacer.`);
}

function borrarSeleccionado(cerrar) {
  if (!elSeleccionado) return;
  const { pistaId, elId } = elSeleccionado;
  elSeleccionado = null;
  // Un VACIO elegido se cierra con Supr (con o sin Shift: cerrar un vacio
  // ya es correr lo de atras). Antes se cerraba con un clic, que era el
  // gesto de deseleccionar; ahora el clic lo elige y lo marca, y cerrar es
  // una tecla que se aprieta a proposito (tanda C).
  const pista = tlDatos.pistas.find((p) => p.id === pistaId);
  const el = pista && pista.elementos.find((x) => x.id === elId);
  // Cerrar un vacio y Shift+Supr son ripple multipista (tanda E): corren
  // todas las pistas no bloqueadas y pueden frenarse. Se dice por que.
  if (el && el.tipo === 'hueco') {
    opTl(window.clipForge.montajeCerrarHueco(archivoActual, durTl(), pistaId, elId))
      .then((res) => { if (res) estado.textContent = textoDeRipple(res.ripple, 'Vacío cerrado.', 'El vacío no se cerró'); });
    return;
  }
  if (cerrar) {
    opTl(window.clipForge.montajeBorrar(archivoActual, durTl(), pistaId, elId, true))
      .then((res) => { if (res) estado.textContent = textoDeRipple(res.ripple, 'Clip quitado y vacío cerrado.', 'El clip no se quitó'); });
    return;
  }
  opTl(window.clipForge.montajeBorrar(archivoActual, durTl(), pistaId, elId, false),
    'Clip quitado — queda un vacío. Elegilo y apretá Supr para cerrarlo.');
}

// El mensaje de una operacion que corre lo de atras (tanda E, ripple
// multipista). `informe.bloqueo` dice que pista la freno: si no se hizo
// nada (sin `corridas`), `fallo` + el motivo; si se hizo a medias, `ok` +
// hasta donde llego. Sin bloqueo, `ok` tal cual.
function textoDeRipple(informe, ok, fallo) {
  const b = informe && informe.bloqueo;
  if (!b) return ok;
  const nombre = b.pistaNombre || 'otra pista';
  const pista = (tlDatos.pistas || []).find((p) => p.id === b.pistaId);
  const consejo = pista && pista.tipo === 'audio'
    ? 'Si esa pista no tiene que correrse (la música, por ejemplo), bloqueala con el candado 🔒.'
    : 'Mové o recortá ese clip, o bloqueá esa pista con el candado 🔒 si no tiene que correrse.';
  const motivo = b.motivo === 'vinculo'
    ? `${nombre} está bloqueada y tiene la imagen o el sonido de un clip que se tendría que correr. Desbloqueala, o bloqueá también la pista de su pareja.`
    : `${nombre} tiene un clip en ese tramo y se partiría. ${consejo}`;
  if (informe.corridas) return `${ok} Llegó hasta donde empieza lo de ${nombre}: ${motivo}`;
  return `${fallo}: ${motivo}`;
}

// ---------- Los ENCUADRES 9:16 SON CLIPS ----------
// PEDIDO DEL USER 07/08/2026: "en la linea de tiempo no se ven
// representados los clips/encuadres y eso no me gusta" y despues "arregla
// el problema que ahora la pista de los encuadres no se puede mezclar con
// las de video".
//
// La primera version les dio una BANDA propia arriba de las pistas. Eso
// resolvia lo de verlos, pero dejaba en pie el problema de fondo: seguian
// siendo un sistema paralelo, con su propio `track`, sus propios canales
// de IPC y su propio arrastre. No se podian mezclar con las pistas de
// video porque no ERAN pistas.
//
// Ahora un encuadre es un CLIP DE AJUSTE dentro de una pista normal (ver
// montaje.js). La banda se fue entera y con ella todo su codigo: se
// dibuja, se selecciona, se mueve, se corta y se recorta con el mismo
// camino que cualquier clip. Lo unico propio que le queda es como se ve.

// Alto de las franjas "+ pista". Chicas a proposito: son un destino, no
// una pista, y no tienen que competir por espacio con el material.
const ALTO_ZONA = 15;

// ---------- Dibujo ----------
function renderTl() {
  if (!tlPistas || !tlEncabezados) return;
  const dur = durVista();

  // El zoom estira el lienzo; todo lo de adentro va en % del tiempo, asi
  // escala solo sin recalcular nada.
  tlLienzo.style.width = (zoomTl * 100) + '%';
  if (tlZoomTexto) tlZoomTexto.textContent = Math.round(zoomTl * 100) + '%';
  // Pixeles por segundo del lienzo YA estirado: manijas y etiquetas se
  // deciden por lo que el clip mide en pantalla, no por su duracion.
  const anchoLienzo = tlLienzo.getBoundingClientRect().width;
  const pxPorSeg = anchoLienzo > 0 ? anchoLienzo / dur : 0;

  // La regla mide ALTO_REGLA en total (su borde va POR DENTRO, como todo
  // el resto: box-sizing:border-box). Sumarle 1 aca corria un pixel a
  // TODOS los encabezados de abajo, y esa fila de menos se notaba mas
  // cuanto mas pistas hay.
  // Las dos franjas para SOLTAR EN UNA PISTA NUEVA: una arriba de todo lo
  // visual, otra abajo de todo el audio. Es el gesto de DaVinci - se
  // arrastra el clip mas alla de la ultima pista y la pista aparece sola.
  // Estan SIEMPRE (no aparecen al empezar a arrastrar) para que el layout
  // no salte a mitad del gesto y para que se vea que el lugar existe.
  const zonaFila = (grupo) => `
    <div class="tlZona" data-grupo="${grupo}" style="height:${ALTO_ZONA}px;"></div>`;
  const zonaHead = (grupo) => `
    <div class="tlHead zona" data-grupo="${grupo}" style="height:${ALTO_ZONA}px;"
         title="Soltá un clip acá para ponerlo en una pista nueva">
      <span class="nom">+ pista</span></div>`;

  tlEncabezados.innerHTML = `<div class="tlHead regla" style="height:${ALTO_REGLA}px;">tiempo</div>` +
    zonaHead('video') +
    tlDatos.pistas.map((p) => `
      <div class="tlHead ${p.tipo}${p.visible ? '' : ' oculta'}${p.silenciada ? ' silenciada' : ''}${p.bloqueada ? ' bloqueada' : ''}" data-id="${p.id}" style="height:${ALTO_PISTA + 1}px;">
        <span class="nom" title="${escapeHtml(p.nombre)} — doble clic para renombrar">${escapeHtml(p.nombre)}</span>
        ${p.tipo === 'audio' ? `
        <button data-accion="silenciar" class="${p.silenciada ? 'activo' : ''}"
                title="${p.silenciada ? 'Volver a escuchar esta pista' : 'Silenciar esta pista (no suena en el visor ni en el video exportado)'}">${p.silenciada ? '🔇' : '🔊'}</button>
        <input type="range" class="tlGanancia" data-accion="ganancia" min="0" max="2" step="0.05"
               value="${p.ganancia != null ? p.ganancia : 1}"
               title="Volumen de la pista: ${Math.round((p.ganancia != null ? p.ganancia : 1) * 100)}%">`
        : `<button data-accion="ver" title="${p.visible ? 'Ocultar' : 'Mostrar'} esta pista">${p.visible ? '◉' : '○'}</button>`}
        <button data-accion="bloquear" class="${p.bloqueada ? 'activo' : ''}"
                title="${p.bloqueada ? 'Pista bloqueada: no se corre cuando quitás o cerrás algo en otra pista. Clic para desbloquear' : 'Bloquear: que esta pista no se corra cuando quitás o cerrás algo en otra (útil para la música)'}">${p.bloqueada ? '🔒' : '🔓'}</button>
        <button data-accion="subir" title="Subir (tapa a las de abajo)">▲</button>
        <button data-accion="bajar" title="Bajar">▼</button>
      </div>`).join('') +
    zonaHead('audio');

  tlPistas.innerHTML =
    zonaFila('video') +
    tlDatos.pistas.map((p) => `
      <div class="tlPista${p.visible ? '' : ' oculta'}${p.silenciada ? ' silenciada' : ''}" data-id="${p.id}" style="height:${ALTO_PISTA + 1}px;">
        ${p.elementos.map((el) => dibujarElemento(p, el, dur, pxPorSeg)).join('')}
      </div>`).join('') +
    zonaFila('audio');

  renderRegla(dur);
  renderCabezal();
  alinearEncabezados();
  pintarOndas();
}

// Filas y encabezados comparten el scroll vertical (tanda C, hallazgo 15):
// las filas scrollean y los encabezados copian su scrollTop. Como solo las
// filas tienen barra horizontal, al fondo quedaban corridos lo que mide esa
// barra; se compensa con relleno abajo en los encabezados.
function alinearEncabezados() {
  if (!tlScroll || !tlEncabezados) return;
  tlEncabezados.style.paddingBottom =
    GestosTl.rellenoParaBarra(tlScroll.offsetHeight, tlScroll.clientHeight) + 'px';
  tlEncabezados.scrollTop = tlScroll.scrollTop;
}

// Marca la seleccion SIN rehacer el HTML. Rehacerlo en el mousedown
// sacaba del documento el nodo que se estaba clickeando, y Chromium no
// dispara click ni dblclick sobre un nodo que ya no esta (hallazgo 28).
function marcarSeleccionEnDom() {
  if (!tlPistas) return;
  tlPistas.querySelectorAll('.tlEl.sel').forEach((n) => n.classList.remove('sel'));
  actualizarControlesClave();
  grupoSel.forEach((r) => {
    const g = tlPistas.querySelector(`.tlEl[data-id="${r.elId}"]`);
    if (g) g.classList.add('sel');
  });
  if (!elSeleccionado) return;
  const n = tlPistas.querySelector(`.tlEl[data-id="${elSeleccionado.elId}"]`);
  if (n) n.classList.add('sel');
}

// Los rombos de las claves (tanda F) dentro de un clip, en % de su ancho.
// Las claves escondidas por un recorte no se dibujan (siguen guardadas).
function rombosDeClaves(el) {
  if (!window.Montaje || !(el.duracion > 0)) return '';
  return Montaje.clavesDe(el)
    .map((c) => (c.tFuente - el.usadoIn) / el.duracion)
    .filter((f) => f >= -1e-9 && f < 1)
    .map((f) => `<span class="tlClave" style="left:${(f * 100).toFixed(3)}%;"></span>`)
    .join('');
}

function dibujarElemento(pista, el, dur, pxPorSeg) {
  const left = (el.inicio / dur) * 100;
  const ancho = ((el.fin - el.inicio) / dur) * 100;
  const sel = (elSeleccionado && elSeleccionado.elId === el.id) || grupoSel.some((r) => r.elId === el.id) ? ' sel' : '';
  const geo = GestosTl.geometriaClip((el.fin - el.inicio) * (pxPorSeg || 0));
  if (el.tipo === 'hueco') {
    // El vacio sigue sin dibujarse hasta apuntarlo (ver el CSS), salvo
    // cuando esta ELEGIDO: elegir algo que no se ve y apretar Supr seria
    // editar a ciegas, que es lo que se vino a arreglar.
    return `<div class="tlEl hueco${sel}" data-id="${el.id}" data-pista="${pista.id}"
      style="left:${left}%;width:${ancho}%;"
      title="Vacío ${fmtTiempo(el.inicio)}–${fmtTiempo(el.fin)} (${el.duracion.toFixed(1)}s) · clic para elegirlo, Supr para cerrarlo">
      <span class="tlEtiqueta">${geo.etiqueta ? 'vacío' : ''}</span></div>`;
  }
  // Manijas proporcionales al ancho en pantalla; un clip angosto no tiene
  // (todo es cuerpo, se puede mover). Ver GestosTl.geometriaClip.
  const manijas = geo.manija > 0
    ? [`<span class="tlManija izq" data-borde="in" style="width:${geo.manija}px;"></span>`,
       `<span class="tlManija der" data-borde="out" style="width:${geo.manija}px;"></span>`]
    : ['', ''];

  // Un ENCUADRE es un clip mas, con las mismas manijas y el mismo
  // arrastre. Se pinta distinto porque hace algo distinto: no aporta
  // imagen, recorta la de abajo. La clase extra es lo UNICO propio que le
  // queda - todo el comportamiento es el de cualquier clip.
  const claves = rombosDeClaves(el);
  if (el.ajuste) {
    return `<div class="tlEl clip ajuste${sel}" data-id="${el.id}" data-pista="${pista.id}"
      style="left:${left}%;width:${ancho}%;"
      title="Encuadre 9:16 · ${fmtTiempo(el.inicio)}–${fmtTiempo(el.fin)} · recorta lo que tiene DEBAJO · arrastralo como cualquier clip">
      ${manijas[0]}${claves}
      <span class="tlEtiqueta">${geo.etiqueta ? '9:16' : ''}</span>
      ${manijas[1]}</div>`;
  }

  // LA ONDA (tanda G, paso 10): un canvas por clip de audio, que pintarOndas
  // recorta a la parte visible. Los datos del tramo de FUENTE van en el
  // nodo: la onda se indexa por usadoIn/usadoOut, asi que un slip o un
  // recorte la mueven sin volver a pedir picos.
  const onda = pista.tipo === 'audio' && el.mediaId
    ? '<canvas class="tlOnda" aria-hidden="true"></canvas>' : '';
  return `<div class="tlEl clip ${pista.tipo}${sel}" data-id="${el.id}" data-pista="${pista.id}"
    data-media="${el.mediaId || ''}" data-in="${el.usadoIn}" data-out="${el.usadoOut}"
    style="left:${left}%;width:${ancho}%;"
    title="${escapeHtml(el.nombre)} · montaje ${fmtTiempo(el.inicio)}–${fmtTiempo(el.fin)} · material ${fmtTiempo(el.usadoIn)}–${fmtTiempo(el.usadoOut)}">
    ${onda}${manijas[0]}${pista.tipo === 'audio' ? '' : claves}
    <span class="tlEtiqueta">${geo.etiqueta ? escapeHtml(el.nombre) : ''}</span>
    ${manijas[1]}</div>`;
}

// El paso entre marcas se elige para que nunca queden encimadas ni tan
// separadas que no sirvan de referencia.
const PASOS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
function renderRegla(dur) {
  if (!tlRegla) return;
  const ancho = tlLienzo.getBoundingClientRect().width;
  if (ancho <= 0) { tlRegla.innerHTML = ''; return; }
  const segPorPx = dur / ancho;
  const paso = PASOS.find((s) => s / segPorPx >= 90) || PASOS[PASOS.length - 1];
  let html = '';
  for (let t = 0; t <= dur; t += paso) {
    const mayor = Math.round(t / paso) % 5 === 0;
    html += `<div class="tlMarca${mayor ? ' mayor' : ''}" style="left:${(t / dur) * 100}%;">${mayor ? `<span>${fmtTiempo(t)}</span>` : ''}</div>`;
  }
  tlRegla.innerHTML = html;
}

function renderCabezal() {
  if (!tlCabezal) return;
  tlCabezal.style.left = (cabezal / durVista()) * 100 + '%';
  actualizarControlesClave();
}

// ---------- Keyframes (tanda F, 1.4) ----------
// Se anima el clip ELEGIDO (de video o un encuadre) en el cuadro del
// cabezal. Poner una clave no cambia lo que se ve: desde ahi, mover o
// escalar la imagen en el visor (o el recuadro 9:16) con el cabezal en otro
// cuadro crea o cambia la clave de ESE cuadro (Montaje.transformar y
// ajustarEncuadre con tLinea). Sin claves, todo sigue fijo como antes.
function objetivoDeClave() {
  if (!elSeleccionado || !window.Montaje || !tlDatos.montaje) return null;
  const { pistaId, elId } = elSeleccionado;
  const pista = tlDatos.montaje.pistas.find((p) => p.id === pistaId);
  if (!pista || pista.tipo === 'audio') return null;
  const el = Montaje.elementosDePista(tlDatos.montaje, pistaId).find((x) => x.id === elId);
  if (!el || el.tipo !== 'clip' || (!el.ajuste && !el.mediaId)) return null;
  return { pistaId, elId, el };
}

function actualizarControlesClave() {
  const btn = $('btnClave');
  if (!btn) return;
  const obj = objetivoDeClave();
  const dentro = !!obj && cabezal >= obj.el.inicio - 1e-6 && cabezal < obj.el.fin - 1e-6;
  const clave = dentro ? Montaje.claveEn(tlDatos.montaje, obj.pistaId, obj.elId, cabezal) : null;
  const lista = obj ? Montaje.clavesEnLinea(tlDatos.montaje, obj.pistaId, obj.elId) : [];
  btn.disabled = !dentro;
  btn.classList.toggle('activa', !!clave);
  btn.title = !obj ? 'Elegí un clip de video o un encuadre para animarlo'
    : !dentro ? 'El cabezal no está sobre el clip elegido'
    : clave ? 'Quitar la clave de este cuadro'
    : 'Poner una clave en este cuadro. Después, con el cabezal en otro cuadro, mové o escalá la imagen (o el recuadro 9:16) y se anima entre las dos.';
  $('btnClaveAnt').disabled = !lista.some((c) => c.tLinea < cabezal - 1e-6);
  $('btnClaveSig').disabled = !lista.some((c) => c.tLinea > cabezal + 1e-6);
  const sel = $('selCurva');
  sel.disabled = !clave;
  sel.value = clave ? (clave.curva || 'lineal') : 'lineal';
}

function saltarAClave(haciaAdelante) {
  const obj = objetivoDeClave();
  if (!obj) return;
  const ts = Montaje.clavesEnLinea(tlDatos.montaje, obj.pistaId, obj.elId).map((c) => c.tLinea);
  const t = haciaAdelante
    ? ts.filter((x) => x > cabezal + 1e-6).sort((a, b) => a - b)[0]
    : ts.filter((x) => x < cabezal - 1e-6).sort((a, b) => b - a)[0];
  if (t === undefined) return;
  visorPausar();
  visorIrA(t, true);
}

if ($('btnClave')) {
  $('btnClave').addEventListener('click', (ev) => {
    ev.currentTarget.blur();
    const obj = objetivoDeClave();
    if (!obj || !archivoActual) return;
    const hay = !!Montaje.claveEn(tlDatos.montaje, obj.pistaId, obj.elId, cabezal);
    opTl(window.clipForge.montajeClave(archivoActual, hay ? 'quitar' : 'poner', obj.pistaId, obj.elId, cabezal),
      hay ? 'Clave quitada.'
        : `Clave puesta${obj.el.ajuste ? ' en el encuadre' : ''}. Llevá el cabezal a otro cuadro y ${obj.el.ajuste ? 'mové el recuadro 9:16' : 'mové o escalá la imagen en el visor'}: se anima entre las claves.`);
  });
  $('btnClaveAnt').addEventListener('click', (ev) => { ev.currentTarget.blur(); saltarAClave(false); });
  $('btnClaveSig').addEventListener('click', (ev) => { ev.currentTarget.blur(); saltarAClave(true); });
  $('selCurva').addEventListener('change', (ev) => {
    const obj = objetivoDeClave();
    const curva = ev.currentTarget.value;
    ev.currentTarget.blur();
    if (!obj || !archivoActual) return;
    const nombres = { lineal: 'lineal', suave: 'suave', mantener: 'salto' };
    opTl(window.clipForge.montajeClave(archivoActual, 'curva', obj.pistaId, obj.elId, cabezal, curva),
      `Desde esta clave: curva ${nombres[curva] || curva}.`);
  });
}

// ---------- Encabezados ----------
if (tlEncabezados) {
  tlEncabezados.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    const head = ev.target.closest('.tlHead');
    if (!b || !head || !archivoActual) return;
    const pistaId = head.dataset.id;
    const p = tlDatos.pistas.find((x) => x.id === pistaId);
    if (!p) return;
    const accion = b.dataset.accion;
    if (accion === 'ver') {
      opTl(window.clipForge.montajePista(archivoActual, durTl(), 'actualizar', { pistaId, cambios: { visible: !p.visible } }));
    } else if (accion === 'silenciar') {
      // SILENCIAR y OCULTAR son cosas distintas desde la tanda D. En audio
      // el boton pasa a ser el mute; `visible: true` a la vez para que una
      // pista vieja guardada "oculta" (que el modelo lee como muda) vuelva a
      // sonar al tocarlo, y no quede muda por un campo que ya no se ve.
      b.blur();
      opTl(window.clipForge.montajePista(archivoActual, durTl(), 'actualizar',
        { pistaId, cambios: { silenciada: !p.silenciada, visible: true } }),
        p.silenciada ? `${p.nombre} vuelve a sonar.` : `${p.nombre} silenciada.`);
    } else if (accion === 'bloquear') {
      // Candado del ripple multipista (tanda E). Suelta el foco como las
      // casillas (tanda C), para que Supr y las flechas sigan andando.
      b.blur();
      opTl(window.clipForge.montajePista(archivoActual, durTl(), 'actualizar',
        { pistaId, cambios: { bloqueada: !p.bloqueada } }),
        p.bloqueada ? `${p.nombre} desbloqueada: se corre con las demás.` : `${p.nombre} bloqueada: no se corre cuando quitás o cerrás algo en otra pista.`);
    } else if (accion === 'ganancia') {
      return;   // lo maneja el 'change' del control
    } else {
      // Las pistas se dibujan de arriba hacia abajo pero se guardan al
      // reves (la ultima tapa), asi que subir en pantalla = subir indice.
      const total = tlDatos.pistas.length;
      const desdeArriba = tlDatos.pistas.findIndex((x) => x.id === pistaId);
      const indiceReal = total - 1 - desdeArriba;
      opTl(window.clipForge.montajePista(archivoActual, durTl(), 'mover',
        { pistaId, indice: indiceReal + (accion === 'subir' ? 1 : -1) }));
    }
  });
}

// Volumen de una pista de audio (tanda D). Se manda al soltar ('change') y
// no en cada movimiento ('input'): cada envio es un paso de deshacer.
// Despues suelta el foco, igual que las casillas (tanda C): si no, las
// flechas moverian el control en vez del cabezal.
if (tlEncabezados) {
  tlEncabezados.addEventListener('change', (ev) => {
    const control = ev.target.closest('input.tlGanancia');
    const head = ev.target.closest('.tlHead');
    if (!control || !head || !archivoActual) return;
    const ganancia = +control.value;
    control.blur();
    opTl(window.clipForge.montajePista(archivoActual, durTl(), 'actualizar',
      { pistaId: head.dataset.id, cambios: { ganancia } }),
      `Volumen de la pista: ${Math.round(ganancia * 100)}%.`);
  });
}

// ---------- Renombrar una pista ----------
// "V1" es solo un nombre automatico. En cuanto hay dos camaras o una
// pista de fotos, ese numero no dice nada; poder escribir "Cámara 2" o
// "Rótulos" es lo que hace que la linea de tiempo se pueda leer de un
// vistazo. Doble clic sobre el nombre, Enter guarda, Escape cancela.
if (tlEncabezados) {
  tlEncabezados.addEventListener('dblclick', (ev) => {
    const nom = ev.target.closest('.nom');
    const head = ev.target.closest('.tlHead');
    if (!nom || !head || !archivoActual || head.classList.contains('regla')) return;
    const pistaId = head.dataset.id;
    const p = tlDatos.pistas.find((x) => x.id === pistaId);
    if (!p) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nomEdit';
    input.value = p.nombre;
    nom.replaceWith(input);
    input.focus();
    input.select();

    let cerrado = false;
    const cerrar = (guardar) => {
      if (cerrado) return;
      cerrado = true;
      const nombre = input.value.trim();
      // Un nombre vacio no se guarda: dejaria una pista sin forma de
      // identificarla. Se vuelve al que tenia.
      if (guardar && nombre && nombre !== p.nombre) {
        opTl(window.clipForge.montajePista(archivoActual, durTl(), 'actualizar',
          { pistaId, cambios: { nombre } }), `Pista renombrada: ${nombre}`);
      } else {
        renderTl();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                       // que no se cuele un atajo
      if (e.key === 'Enter') cerrar(true);
      if (e.key === 'Escape') cerrar(false);
    });
    input.addEventListener('blur', () => cerrar(true));
  });
}

// LOS BOTONES "+V" Y "+A" SE FUERON (07/08/2026). Con la poda de pistas
// vacias una pista recien creada se borraba en el mismo paso, asi que el
// boton prometia algo que la app ya no podia cumplir. Las pistas aparecen
// solas: al poner material que no entra en ninguna, al crear un encuadre,
// y al soltar un clip en una de las franjas "+ pista".

// ---------- Cabezal ----------
if (tlRegla) {
  tlRegla.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    soltarFoco();   // ver soltarFoco: el preventDefault dejaba el foco en la casilla
    // Arrastrar por la regla es hacer scrub: el visor sigue al cabezal.
    const mover = (e) => visorIrA(Math.min(durTl(), tiempoDesdeX(e.clientX)), true);
    mover(ev);
    const soltar = () => { window.removeEventListener('mousemove', mover); window.removeEventListener('mouseup', soltar); };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  });
}

// ---------- Gestos sobre las pistas ----------
// Un mousedown en la linea de tiempo le saca el foco a lo que lo tenga
// (una casilla, un boton). Los mousedown de aca hacen preventDefault, y
// eso impedia que el clic moviera el foco: el teclado seguia yendo a la
// casilla 'Imán' (hallazgo 18). El input de renombrar pista se cierra
// guardando, que es lo mismo que ya hacia al perder el foco.
function soltarFoco() {
  const a = document.activeElement;
  if (a && a !== document.body && typeof a.blur === 'function') a.blur();
}

if (tlPistas) {
  tlPistas.addEventListener('mousedown', (ev) => {
    if (!archivoActual || ev.button !== 0) return;
    soltarFoco();

    const elDom = ev.target.closest('.tlEl');
    if (!elDom) {
      // Clic en el fondo de una pista (despues del ultimo elemento):
      // deselecciona, que es lo que se espera de "clic en lo vacio".
      if (elSeleccionado || grupoSel.length) {
        elSeleccionado = null; grupoSel = []; recSeleccionado = null; marcarSeleccionEnDom(); pintar916();
      }
      return;
    }
    const pistaId = elDom.dataset.pista;
    const elId = elDom.dataset.id;
    const pista = tlDatos.pistas.find((p) => p.id === pistaId);
    const el = pista && pista.elementos.find((x) => x.id === elId);
    if (!el) return;
    const t = imantar(tiempoDesdeX(ev.clientX));
    const manija = ev.target.closest('.tlManija');
    const rect = elDom.getBoundingClientRect();

    const decision = GestosTl.accionDeMousedown({
      herramienta,
      tipo: el.tipo,
      detail: ev.detail,
      borde: manija ? manija.dataset.borde : null,
      sinManijas: !elDom.querySelector('.tlManija'),
      bordeCercano: GestosTl.bordeMasCercano(ev.clientX - rect.left, rect.width)
    });

    // La CUCHILLA corta donde se hace clic (Alt = solo esta pista).
    if (decision.accion === 'cortar') {
      ev.preventDefault();
      opTl(window.clipForge.montajeCortar(archivoActual, durTl(), pistaId, t, !ev.altKey),
        `Cortado en ${fmtTiempo(t)}.`);
      return;
    }

    ev.preventDefault();

    // Clic en un VACIO lo ELIGE (tanda C). Antes lo cerraba en el acto: el
    // vacio no se ve, y "clic en lo gris" es el gesto de deseleccionar en
    // cualquier editor. Cerrarlo es Supr con el vacio elegido.
    if (decision.accion === 'seleccionar-hueco') {
      grupoSel = [];
      elSeleccionado = { pistaId, elId };
      recSeleccionado = null;
      marcarSeleccionEnDom();
      pintar916();
      estado.textContent = `Vacío de ${fmtTiempo(el.duracion)} elegido. Supr para cerrarlo.`;
      return;
    }

    // DOBLE CLIC = unir con el siguiente. Se lee de ev.detail en el
    // segundo mousedown y no con un listener de dblclick: ese evento no
    // llegaba nunca porque el mousedown rehacia el HTML (hallazgo 28). Si
    // algun dia vuelve a llegar, no hay listener que una dos veces.
    if (decision.accion === 'unir') {
      opTl(window.clipForge.montajeUnir(archivoActual, durTl(), pistaId, elId), 'Clips unidos.');
      return;
    }

    // Ctrl (o Cmd) o Shift + clic SUMA o SACA el clip de la seleccion, sin
    // arrastrar ni mover el cabezal (tanda G). Antes solo se podia elegir
    // uno: mover tres clips eran tres arrastres y tres pasos de deshacer.
    if ((ev.ctrlKey || ev.metaKey || ev.shiftKey) && el.tipo === 'clip' && window.PreviewTl) {
      const base = PreviewTl.baseParaSumar(grupoSel, elSeleccionado, (r) => {
        const p = tlDatos.pistas.find((x) => x.id === r.pistaId);
        const e = p && p.elementos.find((x) => x.id === r.elId);
        return !!e && e.tipo === 'clip';
      });
      grupoSel = PreviewTl.alternarEnSeleccion(base, { pistaId, elId }, true);
      elSeleccionado = grupoSel.length ? grupoSel[grupoSel.length - 1] : null;
      recSeleccionado = null;
      marcarSeleccionEnDom();
      pintar916();
      estado.textContent = hayGrupo()
        ? `${grupoSel.length} clips elegidos: arrastrá uno para moverlos juntos, Supr para quitarlos.`
        : '';
      return;
    }
    // Agarrar un clip que ya es parte del grupo conserva el grupo (para
    // arrastrarlos juntos); cualquier otro clic elige solo ese clip.
    const enGrupo = hayGrupo() && grupoSel.some((r) => r.elId === elId);
    if (!enGrupo) grupoSel = [{ pistaId, elId }];

    elSeleccionado = { pistaId, elId };
    // Elegir un ENCUADRE en la linea lo marca tambien sobre el visor, y
    // elegir cualquier otra cosa lo desmarca. Son la misma seleccion vista
    // desde dos lados: sin esto habia que acordarse de cual estaba
    // agarrado en cada panel.
    recSeleccionado = el.ajuste ? elId : null;
    visorIrA(el.inicio, true);   // seleccionar un clip lo muestra en el visor
    marcarSeleccionEnDom();

    // La herramienta decide QUE significa arrastrar (ver
    // GestosTl.accionDeMousedown). Arrastrar el borde con la herramienta
    // normal es un RECORTE que deja vacio; correr lo de atras es RIPPLE (B).
    if (decision.accion !== 'arrastrar') return;
    arrastreTl = {
      pistaId, elId,
      // Con varios elegidos, arrastrar el cuerpo de uno con la herramienta
      // de seleccion mueve el GRUPO (cada clip en su pista, en el tiempo).
      // Los otros modos (recorte, ripple, roll...) siguen siendo de un clip.
      modo: enGrupo && decision.modo === 'mover' ? 'moverGrupo' : decision.modo,
      grupo: enGrupo ? grupoSel.slice() : null,
      // Si al final fue un clic quieto sobre un clip del grupo, queda
      // elegido solo ese (lo que hace cualquier editor al soltar).
      grupoAlClic: enGrupo,
      borde: decision.borde,
      t0: t, inicio0: el.inicio, agarre: t - el.inicio, ultimo: t,
      duracion: el.duracion,
      // Donde se apreto, en pixeles: hasta alejarse UMBRAL_ARRASTRE_PX de
      // aca no es un arrastre, es un clic, y un clic no edita (hallazgo 20).
      x0: ev.clientX, y0: ev.clientY, activo: false,
      // Pista donde se va a soltar. Arranca siendo la propia; cambia si el
      // mouse se va a otra fila mientras se arrastra.
      destino: pistaId
    };
    // Ya no se rehace el HTML aca: el nodo agarrado es el mismo que queda
    // en la pagina, asi que sirve de fantasma tal cual.
    fantasmaTl = elDom;
  });
}

// ---------- Arrastre en vivo ----------
// El cambio real se aplica al SOLTAR (un paso de historial por gesto, no
// uno por pixel). Lo que se dibuja mientras tanto es una vista previa:
// sin esto se suelta a ciegas, que es como el user termino con vacios de
// 10 minutos sin darse cuenta.
let fantasmaTl = null;

// `arrastreEnc` se fue (07/08/2026). Existia porque acotar un encuadre en
// el tiempo era "otro modelo y otro canal"; ahora es un clip, asi que sus
// bordes se arrastran con arrastreTl como los de cualquier otro.

function mostrarDesfase(texto, tLinea) {
  const cartel = $('tlDesfase');
  if (!cartel) return;
  if (texto == null) { cartel.classList.add('oculto'); return; }
  cartel.classList.remove('oculto');
  cartel.textContent = texto;
  cartel.style.left = (Math.max(0, Math.min(tLinea, durVista())) / durVista()) * 100 + '%';
  // Por debajo de la regla VISIBLE: la regla es sticky, y con scroll
  // vertical un top fijo dejaba el cartel escondido arriba.
  cartel.style.top = ((tlScroll ? tlScroll.scrollTop : 0) + ALTO_REGLA + 6) + 'px';
}

function limpiarArrastre() {
  if (fantasmaTl) fantasmaTl.classList.remove('arrastrando');
  fantasmaTl = null;
  if (previewPendiente) { cancelAnimationFrame(previewPendiente); previewPendiente = 0; }
  quitarPreview();
  marcarLineaIman(null);
  marcarTapados(null);
  marcarZona(null);
  mostrarDesfase(null);
}

// Enciende la franja "+ pista" del grupo del clip que se arrastra, para
// que se vea que soltar ahi tiene un efecto. `pistaOrigen` null la apaga.
function marcarZona(pistaOrigen) {
  if (!tlPistas || !tlEncabezados) return;
  const origen = pistaOrigen && tlDatos.pistas.find((p) => p.id === pistaOrigen);
  const grupo = origen ? (origen.tipo === 'audio' ? 'audio' : 'video') : null;
  document.querySelectorAll('.tlZona, .tlHead.zona').forEach((n) =>
    n.classList.toggle('activa', !!grupo && n.dataset.grupo === grupo));
}

// Marca lo que se va a PERDER si se suelta donde esta el mouse. Arrastrar
// un clip encima de otro es una SOBRESCRITURA, igual que en DaVinci: lo de
// abajo se destruye. Eso esta bien; lo que estaba mal era que pasara sin
// que se viera venir.
//
// Hay DOS formas de perder material y se marcan distinto, porque no son lo
// mismo: un clip que queda enteramente debajo desaparece (rojo tachado),
// y uno que queda tapado A MEDIAS pierde solo ese pedazo (franja rayada
// sobre el pedazo exacto). Marcar el clip entero en el segundo caso seria
// mentir sobre lo que se va a perder.
function marcarTapados(pistaId, inicio, fin, elIdMovido) {
  const vacio = { enteros: 0, parciales: 0, segundos: 0 };
  if (!tlPistas) return vacio;
  tlPistas.querySelectorAll('.tlEl.tapado').forEach((n) => n.classList.remove('tapado'));
  tlPistas.querySelectorAll('.tlComido').forEach((n) => n.remove());
  if (!pistaId) return vacio;

  const p = tlDatos.pistas.find((x) => x.id === pistaId);
  if (!p) return vacio;
  const fila = tlPistas.querySelector(`.tlPista[data-id="${pistaId}"]`);
  const dur = durVista();   // la franja se dibuja sobre el lienzo, no sobre el montaje
  const r = { enteros: 0, parciales: 0, segundos: 0 };

  for (const el of p.elementos) {
    // El propio clip que se arrastra no se tapa a si mismo: en el origen
    // va a quedar un vacio. Y tapar un vacio no destruye nada.
    if (el.id === elIdMovido || el.tipo !== 'clip') continue;
    const a = Math.max(el.inicio, inicio);
    const b = Math.min(el.fin, fin);
    if (b - a <= 0.001) continue;
    r.segundos += b - a;

    if (el.inicio >= inicio - 0.001 && el.fin <= fin + 0.001) {
      r.enteros++;
      const n = tlPistas.querySelector(`.tlEl[data-id="${el.id}"]`);
      if (n) n.classList.add('tapado');
    } else if (fila) {
      r.parciales++;
      const franja = document.createElement('div');
      franja.className = 'tlComido';
      franja.style.left = (a / dur) * 100 + '%';
      franja.style.width = ((b - a) / dur) * 100 + '%';
      franja.title = `Se elimina ${fmtTiempo(b - a)} de este clip`;
      fila.appendChild(franja);
    }
  }
  return r;
}

// Cuantos clips desaparecieron entre dos estados de la linea de tiempo.
const idsDeClips = (datos) => datos.pistas.flatMap((p) =>
  p.elementos.filter((e) => e.tipo === 'clip').map((e) => e.id));

// Segundos de material que hay en la linea. Mover no cambia este total
// salvo que se tape algo, asi que la resta antes/despues dice exactamente
// cuanto video se perdio - incluidos los recortes parciales, que no se
// notan contando clips.
const materialTotal = (datos) => datos.pistas.reduce((a, p) =>
  a + p.elementos.filter((e) => e.tipo === 'clip').reduce((s, e) => s + (e.fin - e.inicio), 0), 0);

// A QUE PISTA APUNTA EL MOUSE mientras se arrastra un clip (07/08/2026).
// Sin esto un clip solo se podia mover en horizontal: quedaba encerrado
// en su pista para siempre, que es lo contrario de "pistas universales".
//
// Se frena en el grupo: un clip de imagen no puede caer en una pista de
// audio ni al reves. No es una restriccion de tipo de material (una foto
// y un video comparten pista sin problema), es que el audio se escucha y
// la imagen se ve: son dos mundos, como en cualquier editor.
function pistaBajoElMouse(ev, pistaOrigen) {
  const origen = tlDatos.pistas.find((p) => p.id === pistaOrigen);
  if (!origen) return pistaOrigen;
  const esAudio = origen.tipo === 'audio';
  // El fantasma que sigue al mouse tiene pointer-events:none, asi que lo
  // que hay debajo es la fila de verdad.
  const bajo = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!bajo || !bajo.closest) return pistaOrigen;

  // Franja "+ pista": el destino todavia no existe y se crea al soltar.
  const zona = bajo.closest('.tlZona');
  if (zona) return (zona.dataset.grupo === 'audio') === esAudio ? PISTA_NUEVA : pistaOrigen;

  const fila = bajo.closest('.tlPista[data-id]');
  if (!fila) return pistaOrigen;
  const p = tlDatos.pistas.find((x) => x.id === fila.dataset.id);
  if (!p || (p.tipo === 'audio') !== esAudio) return pistaOrigen;
  return p.id;
}

// Signo explicito: "+3s" y "−3s" se leen de un vistazo, "3s" no dice
// para que lado.
function conSigno(segundos) {
  const s = Math.abs(segundos) < 0.05 ? 0 : segundos;
  return (s > 0 ? '+' : s < 0 ? '−' : '') + fmtTiempo(Math.abs(s));
}

// Suelta un arrastre SIN aplicar nada: Escape, la ventana que pierde el
// foco (Alt+Tab, un dialogo del sistema) o un mousemove sin el boton
// apretado porque el mouseup se perdio. Antes el clip quedaba pegado al
// puntero y el proximo clic, en cualquier lado, lo soltaba ahi (hallazgo 24).
function cancelarArrastreTl(mensaje) {
  if (!arrastreTl) return;
  const habiaEmpezado = arrastreTl.activo;
  arrastreTl = null;
  limpiarArrastre();
  // El fantasma quedo corrido con style.left: se vuelve a dibujar la linea
  // tal como esta, que es lo que el montaje sigue siendo.
  if (habiaEmpezado) renderTl();
  if (mensaje && habiaEmpezado) estado.textContent = mensaje;
}

window.addEventListener('blur', () => cancelarArrastreTl('Arrastre cancelado: la ventana perdió el foco.'));

window.addEventListener('mousemove', (ev) => {
  if (!arrastreTl) return;
  if (GestosTl.botonSuelto(ev.buttons)) { cancelarArrastreTl('Arrastre cancelado.'); return; }
  // Hasta pasar el umbral es un clic: ni fantasma ni cartel ni edicion.
  if (!arrastreTl.activo) {
    if (!GestosTl.superoUmbral(arrastreTl.x0, arrastreTl.y0, ev.clientX, ev.clientY)) return;
    arrastreTl.activo = true;
    if (fantasmaTl) fantasmaTl.classList.add('arrastrando');
  }
  // AUTOSCROLL (tanda G): cerca del borde de la vista, la vista se corre.
  // Sin esto, con zoom, un clip no se podia llevar mas alla de lo visible.
  if (tlScroll && window.PreviewTl) {
    const r = tlScroll.getBoundingClientRect();
    const paso = PreviewTl.pasoDeAutoscroll(ev.clientX, r.left, r.right);
    if (paso) tlScroll.scrollLeft += paso;
  }
  const a = arrastreTl;
  const tMouse = tiempoDesdeX(ev.clientX);
  if (a.modo === 'mover' || a.modo === 'moverGrupo') {
    // IMAN POR LOS BORDES DEL CLIP (tanda G, hallazgos 19 y 37): se pegan el
    // inicio o el fin del clip, no el puntero, y nunca a sus propios bordes
    // ni a los de su pareja o su grupo (antes el clip se pegaba a si mismo).
    const refs = a.modo === 'moverGrupo' ? a.grupo : [{ pistaId: a.pistaId, elId: a.elId }];
    const tol = toleranciaIman(ev.shiftKey);
    let ini = Math.max(0, tMouse - a.agarre);
    let punto = null;
    if (tol > 0 && window.PreviewTl && tlDatos.montaje) {
      if (!a.puntos) a.puntos = PreviewTl.puntosSinPropios(Montaje, tlDatos.montaje, refs, [cabezal]);
      ({ inicio: ini, punto } = PreviewTl.imantarBloque(ini, a.duracion, a.puntos, tol));
    }
    a.inicioDestino = ini;
    a.ultimo = ini + a.agarre;
    marcarLineaIman(punto);
  } else {
    a.ultimo = imantar(tMouse, ev.shiftKey);
    marcarLineaIman(a.ultimo !== tMouse ? a.ultimo : null);
  }
  const delta = a.ultimo - a.t0;

  if (a.modo === 'mover') {
    a.destino = pistaBajoElMouse(ev, a.pistaId);
    const aNueva = a.destino === PISTA_NUEVA;
    marcarZona(aNueva ? a.pistaId : null);
    const destino = a.inicioDestino;
    // El fantasma YA NO se corre con style.left (y encima en su fila de
    // origen): lo que va a quedar lo dibuja la vista previa en cada fila.
    // En una pista nueva no hay nada que tapar: esta vacia por definicion.
    const t = aNueva ? { enteros: 0, parciales: 0, segundos: 0 }
                     : marcarTapados(a.destino, destino, destino + a.duracion, a.elId);
    if (aNueva) marcarTapados(null);
    const partes = [];
    if (t.enteros) partes.push(`borra ${t.enteros} clip${t.enteros > 1 ? 's' : ''}`);
    if (t.parciales) partes.push(`recorta ${t.parciales}`);
    const cambiaPista = aNueva
      ? ' · a una PISTA NUEVA'
      : (a.destino !== a.pistaId
        ? ` · a ${(tlDatos.pistas.find((p) => p.id === a.destino) || {}).nombre || ''}` : '');
    a.texto = `${conSigno(destino - a.inicio0)}  →  ${fmtTiempo(destino)}${cambiaPista}` +
      (partes.length ? `   ⚠ ${partes.join(' y ')} · −${fmtTiempo(t.segundos)}` : '');
    a.tCartel = destino + a.duracion / 2;
  } else if (a.modo === 'moverGrupo') {
    a.texto = `${a.grupo.length} clips ${conSigno(a.inicioDestino - a.inicio0)}`;
    a.tCartel = a.inicioDestino + a.duracion / 2;
  } else if (a.modo === 'ripple') {
    a.texto = `${a.borde === 'in' ? 'inicio' : 'fin'} ${fmtTiempo(a.ultimo)}  (${conSigno(delta)})`;
    a.tCartel = a.ultimo;
  } else if (a.modo === 'roll') {
    a.texto = `corte ${fmtTiempo(a.ultimo)}  (${conSigno(delta)})`;
    a.tCartel = a.ultimo;
  } else {
    a.texto = `${a.modo} ${conSigno(delta)}`;
    a.tCartel = a.ultimo;
  }
  mostrarDesfase(a.texto, a.tCartel);
  programarPreview();
});

// ---------- Vista previa real (tanda G, paso 9) ----------
// En cada cuadro de pantalla (no en cada mousemove: pueden llegar varios por
// cuadro) se aplica sobre la copia local del montaje la MISMA operacion que
// el main va a aplicar al soltar (PreviewTl.simular) y se dibuja el
// resultado en una capa encima de cada fila que cambia. Asi se ven la
// pareja de sonido, los vecinos que absorben un roll o un slide, el recorte
// real (con el tope del material), la pista nueva y el ripple que se frena.
// No se toca tlPistas.innerHTML: el nodo agarrado sigue en la pagina y
// elementFromPoint sigue viendo las filas de verdad.
let previewPendiente = 0;
function programarPreview() {
  if (previewPendiente || !window.PreviewTl) return;
  previewPendiente = requestAnimationFrame(() => {
    previewPendiente = 0;
    const a = arrastreTl;
    if (!a || !a.activo || !tlDatos.montaje) return;
    let r;
    try {
      r = PreviewTl.simular(Montaje, tlDatos.montaje, {
        modo: a.modo, pistaId: a.pistaId, elId: a.elId, borde: a.borde,
        ultimo: a.ultimo, delta: a.modo === 'moverGrupo' ? a.inicioDestino - a.inicio0 : a.ultimo - a.t0,
        inicioDestino: a.inicioDestino, destino: a.destino, grupo: a.grupo
      });
    } catch (e) {
      // Una vista previa que falla no puede romper el arrastre: se suelta
      // igual y el main decide. Se deja rastro para encontrarlo.
      console.warn('[preview]', e);
      return;
    }
    pintarPreview(PreviewTl.cambiosDeFilas(Montaje, tlDatos.montaje, r.montaje));
    // Lo que el main va a contar al soltar, dicho ANTES de soltar.
    const inf = r.informe || {};
    let extra = '';
    if (inf.ripple && inf.ripple.bloqueo) extra = `   ⚠ lo frena ${inf.ripple.bloqueo.pistaNombre || 'otra pista'}`;
    if (inf.sinCambio) extra = '   ⚠ el corte no se puede mover ahí';
    if (inf.movido && (inf.movido.parejas || []).some((x) => x.desde !== x.hacia)) extra = '   · su sonido va a otra pista';
    if (a.modo === 'slip' || a.modo === 'slide') {
      const el = Montaje.elementosDePista(r.montaje, a.pistaId).find((x) => x.id === a.elId);
      if (el) extra = `   material ${fmtTiempo(el.usadoIn)}–${fmtTiempo(el.usadoOut)}`;
    }
    if (extra) mostrarDesfase(a.texto + extra, a.tCartel);
  });
}

function quitarPreview() {
  if (!tlPistas) return;
  tlPistas.querySelectorAll('.tlPrevCapa').forEach((n) => n.remove());
  tlPistas.querySelectorAll('.previa').forEach((n) => n.classList.remove('previa'));
}

function pintarPreview(c) {
  quitarPreview();
  if (!tlPistas || !c) return;
  const dur = durVista();
  const capa = (host, fila) => {
    const d = document.createElement('div');
    d.className = 'tlPrevCapa';
    d.innerHTML = fila ? fila.clips.map((el) =>
      `<div class="tlPrevEl ${fila.tipo}${el.ajuste ? ' ajuste' : ''}" style="left:${(el.inicio / dur) * 100}%;width:${((el.fin - el.inicio) / dur) * 100}%;"></div>`
    ).join('') : '';
    host.appendChild(d);
  };
  const fila = (id) => tlPistas.querySelector(`.tlPista[data-id="${id}"]`);
  c.filas.forEach((f) => { const n = fila(f.pistaId); if (n) { n.classList.add('previa'); capa(n, f); } });
  // Una pista que la poda va a sacar se ve vacia: al soltar desaparece.
  c.quitadas.forEach((id) => { const n = fila(id); if (n) { n.classList.add('previa'); capa(n, null); } });
  c.nuevas.forEach((f) => {
    const z = tlPistas.querySelector(`.tlZona[data-grupo="${f.tipo === 'audio' ? 'audio' : 'video'}"]`);
    if (z) capa(z, f);
  });
}

// Linea vertical en el punto donde pego el iman (null la saca).
function marcarLineaIman(t) {
  if (!tlLienzo) return;
  let n = document.getElementById('tlLineaIman');
  if (t == null) { if (n) n.remove(); return; }
  if (!n) {
    n = document.createElement('div');
    n.id = 'tlLineaIman';
    tlLienzo.appendChild(n);
  }
  n.style.left = (t / durVista()) * 100 + '%';
}

// ---------- Onda en los clips de audio (tanda G, paso 10) ----------
// Los picos se piden UNA vez por material (el main los guarda en la carpeta
// del proyecto) y se dibujan en un canvas por clip RECORTADO a la parte que
// se ve y escalado por devicePixelRatio. Un canvas del largo del clip
// pasaria el limite de ~32.767 px a zoom alto y saldria en blanco.
const picosPorMedia = new Map();   // mediaId -> picos | null | 'pidiendo'
function picosDe(mediaId) {
  if (!mediaId || !window.clipForge || !window.clipForge.mediaPicos || !archivoActual) return null;
  const hay = picosPorMedia.get(mediaId);
  if (hay !== undefined) return hay === 'pidiendo' ? null : hay;
  picosPorMedia.set(mediaId, 'pidiendo');
  const archivo = archivoActual;
  window.clipForge.mediaPicos(archivo, mediaId)
    .then((p) => { picosPorMedia.set(mediaId, p || null); if (archivo === archivoActual) pintarOndas(); })
    .catch(() => picosPorMedia.set(mediaId, null));
  return null;
}

let ondasPendiente = 0;
function pintarOndas() {
  if (ondasPendiente || !tlPistas || !tlScroll || !window.PreviewTl) return;
  ondasPendiente = requestAnimationFrame(() => {
    ondasPendiente = 0;
    const vista = tlScroll.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    tlPistas.querySelectorAll('.tlEl.clip.audio').forEach((nodo) => {
      const cv = nodo.querySelector('canvas.tlOnda');
      if (!cv) return;
      const picos = picosDe(nodo.dataset.media);
      const r = nodo.getBoundingClientRect();
      const tramo = PreviewTl.tramoVisible(0, r.width, vista.left - r.left, vista.right - r.left);
      if (!picos || !tramo) { cv.style.display = 'none'; return; }
      const ancho = tramo.hasta - tramo.desde;
      const alto = Math.max(1, Math.round(nodo.clientHeight));
      cv.style.display = '';
      cv.style.left = tramo.desde + 'px';
      cv.style.width = ancho + 'px';
      cv.width = Math.max(1, Math.round(ancho * dpr));
      cv.height = Math.max(1, Math.round(alto * dpr));
      const usadoIn = parseFloat(nodo.dataset.in);
      const usadoOut = parseFloat(nodo.dataset.out);
      const segPorPx = (usadoOut - usadoIn) / Math.max(1, r.width);
      const cols = PreviewTl.columnasDeOnda(picos,
        usadoIn + tramo.desde * segPorPx, usadoIn + tramo.hasta * segPorPx, cv.width);
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = 'rgba(190, 240, 205, 0.55)';
      const medio = cv.height / 2;
      const escala = cv.height / 256;
      for (let x = 0; x < cv.width; x++) {
        const arriba = (255 - cols.max[x]) * escala;
        const abajo = (255 - cols.min[x]) * escala;
        g.fillRect(x, Math.min(arriba, medio - 0.5), 1, Math.max(1, abajo - arriba));
      }
    });
  });
}

window.addEventListener('mouseup', async () => {
  if (!arrastreTl) return;
  const a = arrastreTl;
  arrastreTl = null;
  limpiarArrastre();
  // No paso el umbral: fue un clic. La seleccion ya quedo hecha en el
  // mousedown y no hay nada que aplicar (hallazgo 20). Tampoco se rehace el
  // HTML, para que el segundo clic de un doble clic caiga en el mismo nodo.
  if (!a.activo) {
    if (a.grupoAlClic) { grupoSel = [{ pistaId: a.pistaId, elId: a.elId }]; marcarSeleccionEnDom(); }
    return;
  }
  if (!archivoActual || a.ultimo == null) return;
  const dur = durTl();
  const delta = a.ultimo - a.t0;

  if (a.modo === 'moverGrupo') {
    const corrido = (a.inicioDestino != null ? a.inicioDestino : a.inicio0) - a.inicio0;
    if (Math.abs(corrido) < 0.01) { renderTl(); return; }
    const res = await opTl(window.clipForge.montajeGrupo(archivoActual, 'mover', a.grupo, corrido));
    const inf = res && res.grupo;
    estado.textContent = `${a.grupo.length} clips movidos ${conSigno(inf ? inf.delta : corrido)}.` +
      (inf && inf.desvinculados ? ` ${inf.desvinculados} clip${inf.desvinculados > 1 ? 's quedaron' : ' quedó'} separado${inf.desvinculados > 1 ? 's' : ''} de su sonido.` : '') +
      ' Ctrl+Z para deshacer.';
    return;
  }
  if (a.modo === 'mover') {
    const cambioDePista = a.destino && a.destino !== a.pistaId;
    const inicioDestino = a.inicioDestino != null ? a.inicioDestino : Math.max(0, a.ultimo - a.agarre);
    if (Math.abs(inicioDestino - a.inicio0) < 0.01 && !cambioDePista) { renderTl(); return; }
    // Se avisa DESPUES tambien, no solo durante el arrastre: el aviso de
    // antes se va con el mouse, y hay que poder enterarse de lo que se
    // perdio cuando ya no se esta mirando el cursor.
    const antes = idsDeClips(tlDatos);
    const materialAntes = materialTotal(tlDatos);
    const res = await opTl(window.clipForge.montajeMover(archivoActual, dur, a.pistaId, a.elId,
      inicioDestino, cambioDePista ? a.destino : null));
    const perdidos = antes.filter((id) => !idsDeClips(tlDatos).includes(id));
    const segundos = materialAntes - materialTotal(tlDatos);
    const aPista = a.destino === PISTA_NUEVA
      ? ' a una pista nueva'
      : (cambioDePista
        ? ` a ${(tlDatos.pistas.find((p) => p.id === a.destino) || {}).nombre || 'otra pista'}` : '');
    estado.textContent = segundos > 0.05
      ? `Clip movido${aPista} — se eliminó ${fmtTiempo(segundos)} de video` +
        (perdidos.length ? ` (${perdidos.length} clip${perdidos.length > 1 ? 's' : ''} entero${perdidos.length > 1 ? 's' : ''})` : ' de otro clip') +
        '. Ctrl+Z para deshacer.'
      : `Clip movido${aPista}.`;
    estado.textContent += avisoDePareja(res && res.movido);
  } else if (a.modo === 'slip') {
    await opTl(window.clipForge.montajeRecortar(archivoActual, dur, a.pistaId, a.elId, 'slip', null, delta),
      'Slip: cambió qué parte del material se ve.');
  } else if (a.modo === 'slide') {
    await opTl(window.clipForge.montajeRecortar(archivoActual, dur, a.pistaId, a.elId, 'slide', null, delta),
      'Slide: el clip se movió y los vecinos absorbieron.');
  } else if (a.modo === 'roll') {
    // Se manda el borde agarrado: sin manija (clic en el cuerpo) sigue
    // siendo el corte de la derecha, como antes.
    const res = await opTl(window.clipForge.montajeRecortar(archivoActual, dur, a.pistaId, a.elId, 'roll', a.borde, a.ultimo),
      'Roll: se movió el corte entre dos clips.');
    if (res && res.sinCambio) {
      estado.textContent = 'Roll: el corte no se pudo mover (sin material para estirar, o el sonido de al lado no acompaña).';
    }
  } else if (a.modo === 'recorte') {
    await opTl(window.clipForge.montajeRecortar(archivoActual, dur, a.pistaId, a.elId, 'recorte', a.borde, a.ultimo),
      `Recortado: el espacio que dejó queda como vacío.`);
  } else {
    const res = await opTl(window.clipForge.montajeRecortar(archivoActual, dur, a.pistaId, a.elId, 'ripple', a.borde, a.ultimo),
      `Ripple: ${a.borde === 'in' ? 'inicio' : 'fin'} ajustado.`);
    if (res) {
      estado.textContent = textoDeRipple(res.ripple, `Ripple: ${a.borde === 'in' ? 'inicio' : 'fin'} ajustado.`,
        'El ripple no se hizo');
    }
  }
});

// Lo que mover le hizo a la pareja de sonido (13/09/2026, tanda B). Si
// en su pista iba a tapar audio de otro clip, el sonido se fue a otra
// pista en vez de borrar esa voz: hay que decirlo, porque el user lo va a
// buscar donde estaba. Y si algun clip quedo separado de su pareja (se
// tapo la imagen y no el sonido), tambien, porque desde ahi cortar o
// borrar uno ya no toca al otro.
function avisoDePareja(movido) {
  if (!movido) return '';
  const nombre = (id) => (tlDatos.pistas.find((p) => p.id === id) || {}).nombre || 'otra pista';
  const corridas = (movido.parejas || []).filter((x) => x.desde !== x.hacia);
  let aviso = '';
  if (corridas.length) {
    aviso += ` Su sonido pasó a ${corridas.map((x) => nombre(x.hacia)).join(', ')} para no tapar otro audio.`;
  }
  if (movido.desvinculados) {
    aviso += ` ${movido.desvinculados} clip${movido.desvinculados > 1 ? 's quedaron' : ' quedó'} separado${movido.desvinculados > 1 ? 's' : ''} de su sonido.`;
  }
  return aviso;
}

// Doble clic en un clip = unir con el siguiente (deshace una cuchillada).
// Ya NO hay listener de dblclick: se detecta con ev.detail === 2 en el
// mousedown de tlPistas (tanda C). Tener los dos uniria dos veces el dia
// que el dblclick vuelva a llegar.

// ---------- Zoom ----------
// ZOOM ANCLADO (tanda C, hallazgos 23, 26 y 50). El lienzo se estira en
// % y scrollLeft queda en px, asi que sin corregirlo lo que se estaba
// mirando se escapaba en cada paso. `anclaClientX` es la x del mouse (rueda);
// sin ella el ancla es el cabezal (botones). Despues de renderTl se mide el
// ancho NUEVO de verdad y se fija scrollLeft para que el instante del ancla
// quede en el mismo pixel.
function fijarZoom(z, anclaClientX) {
  if (!tlScroll || !tlLienzo) return;
  const dur = durVista();
  const anchoVista = tlScroll.clientWidth;
  const anchoAntes = tlLienzo.getBoundingClientRect().width;
  const vistaIzq = tlScroll.getBoundingClientRect().left;
  let t, xEnVista;
  if (anclaClientX != null && anchoAntes > 0) {
    xEnVista = anclaClientX - vistaIzq;
    t = ((tlScroll.scrollLeft + xEnVista) / anchoAntes) * dur;
  } else {
    xEnVista = GestosTl.xDeCabezalEnVista({
      cabezal, dur, anchoLienzo: anchoAntes, scrollLeft: tlScroll.scrollLeft, anchoVista });
    t = cabezal;
  }
  zoomTl = GestosTl.limitarZoom(z, GestosTl.zoomMaximo(dur, anchoVista, fpsTl()));
  renderTl();
  const anchoNuevo = tlLienzo.getBoundingClientRect().width;
  tlScroll.scrollLeft = GestosTl.scrollParaAncla({ t, xEnVista, dur, anchoLienzo: anchoNuevo, anchoVista });
  anchoLienzoPrevio = anchoNuevo;
  alinearEncabezados();
}
$('btnZoomMas').addEventListener('click', () => fijarZoom(zoomTl * 1.5));
$('btnZoomMenos').addEventListener('click', () => fijarZoom(zoomTl / 1.5));
$('btnZoomAjustar').addEventListener('click', () => fijarZoom(1));
if (tlScroll) {
  tlScroll.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    fijarZoom(zoomTl * (ev.deltaY < 0 ? 1.2 : 1 / 1.2), ev.clientX);
  }, { passive: false });

  // UN SOLO SCROLL VERTICAL (hallazgo 15). Las filas scrollean; los
  // encabezados copian. Antes cada uno iba por su lado y el boton 'ocultar'
  // que se veia al lado de V2 era el de A1.
  tlScroll.addEventListener('scroll', () => {
    if (tlEncabezados && tlEncabezados.scrollTop !== tlScroll.scrollTop) {
      tlEncabezados.scrollTop = tlScroll.scrollTop;
    }
    // El canvas de onda mide solo lo visible: al correr la vista se rehace.
    pintarOndas();
  });
}
if (tlEncabezados && tlScroll) {
  // La rueda sobre los nombres de pista no hacia nada (overflow:hidden):
  // se reenvia a las filas, que son las que mandan. Ctrl+rueda no se toca.
  tlEncabezados.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey) return;
    ev.preventDefault();
    tlScroll.scrollTop += ev.deltaY;
  }, { passive: false });
}

// Ancho del lienzo la ultima vez que se lo midio, para que un cambio de
// tamaño del panel conserve el instante del borde izquierdo (hallazgo 32).
let anchoLienzoPrevio = 0;
let pendienteTamanoTl = null;
function alCambiarTamanoTl() {
  if (pendienteTamanoTl || !tlScroll || !tlLienzo) return;
  pendienteTamanoTl = requestAnimationFrame(() => {
    pendienteTamanoTl = null;
    const anchoNuevo = tlLienzo.getBoundingClientRect().width;
    if (anchoNuevo <= 0) return;
    const dur = durVista();
    if (anchoLienzoPrevio > 0 && Math.abs(anchoNuevo - anchoLienzoPrevio) >= 1) {
      const tIzq = (tlScroll.scrollLeft / anchoLienzoPrevio) * dur;
      tlScroll.scrollLeft = GestosTl.scrollParaAncla({
        t: tIzq, xEnVista: 0, dur, anchoLienzo: anchoNuevo, anchoVista: tlScroll.clientWidth });
    }
    anchoLienzoPrevio = anchoNuevo;
    // La regla elige el paso de marcas con el ancho en px del momento, y
    // manijas y etiquetas tambien dependen del ancho: se redibuja todo.
    if (!arrastreTl) renderTl(); else renderRegla(dur);
    alinearEncabezados();
  });
}
if (window.ResizeObserver && tlScroll) new ResizeObserver(alCambiarTamanoTl).observe(tlScroll);

// El cabezal no se iba con la reproduccion: con zoom salia de la vista y
// habia que perseguirlo con Shift+rueda (hallazgo 26). Se pagina solo
// mientras se reproduce; al hacer scrub o elegir un clip, el usuario ya
// esta mirando donde esta.
function seguirCabezal() {
  if (!tlScroll || !tlLienzo || arrastreTl) return;
  const anchoLienzo = tlLienzo.getBoundingClientRect().width;
  const x = (cabezal / durVista()) * anchoLienzo;
  const nuevo = GestosTl.scrollParaSeguir({
    x, scrollLeft: tlScroll.scrollLeft, anchoVista: tlScroll.clientWidth, anchoLienzo });
  if (nuevo != null) tlScroll.scrollLeft = nuevo;
}
if (chkIman) chkIman.addEventListener('change', renderTl);

// Una casilla tocada con el mouse no se queda con el foco (hallazgo 18):
// si se lo queda, Espacio la vuelve a cambiar en vez de reproducir. Vale
// para cualquier casilla de la ventana, por eso se escucha en document.
document.addEventListener('change', (ev) => {
  const n = ev.target;
  if (n && n.tagName === 'INPUT' && (n.type === 'checkbox' || n.type === 'radio')) n.blur();
});

// ============================================================
// PANEL MULTIMEDIA (06/08/2026)
// ============================================================
// POR QUE SE CONSTRUYO AHORA: era un cartel de "pendiente", y esa
// ausencia dejaba el proyecto SIN SALIDA. El user borro todos los clips y
// no pudo volver a poner nada: habia canales para cortar, borrar, mover y
// recortar, pero ninguno para AGREGAR. El material nunca se habia perdido
// (seguia en montaje.media, y se ve aca), lo que faltaba era la puerta
// para traerlo de vuelta a la linea.
//
// El montaje soporta varios archivos desde el principio (media es una
// lista), asi que "+ Añadir archivo" suma material al proyecto actual en
// vez de cambiar de proyecto, que es lo que hace "Abrir archivo".

const listaMedia = $('listaMedia');

function renderMedia() {
  if (!listaMedia) return;
  const media = (tlDatos && tlDatos.media) || [];
  if (!media.length) {
    listaMedia.innerHTML = archivoActual
      ? '<div class="vacio">Sin material todavía.</div>'
      : '<div class="vacio">Abrí un archivo para empezar.</div>';
    return;
  }
  listaMedia.innerHTML = media.map((x) => {
    const dur = Math.max(0, (x.disponibleOut || 0) - (x.disponibleIn || 0));
    return `<div class="itemMedia" data-id="${x.id}" title="${escapeHtml(x.ruta || '')}">
      <span class="icono">${x.tipo === 'audio' ? '♪' : '▤'}</span>
      <span class="datos">
        <div class="nom">${escapeHtml(x.nombre || '(sin nombre)')}</div>
        <div class="dur">${fmtTiempo(dur)}</div>
      </span>
      <button class="poner" title="Poner en la línea de tiempo, en el cabezal">+ Línea</button>
    </div>`;
  }).join('');

  listaMedia.querySelectorAll('.itemMedia').forEach((el) => {
    el.addEventListener('click', () => ponerMediaEnLinea(el.dataset.id));
  });
}

// El material BUSCA LUGAR SOLO (07/08/2026, pedido del user). Ya no tapa
// lo que hubiera en la primera pista: si el instante esta ocupado, baja a
// la siguiente pista con lugar, y si no hay ninguna se crea. Asi poner
// tres clips en el mismo punto arma tres pistas sin tener que apretar
// "+V" antes de cada uno.
async function ponerMediaEnLinea(mediaId, pistaId) {
  if (!archivoActual) return;
  // Con la linea vacia durTl() vale 1 y el cabezal no significa nada:
  // ahi el material va al principio, que es lo que se espera al
  // recuperar un proyecto que se vacio.
  const hayAlgo = tlDatos.pistas.some((p) => p.elementos.some((e) => e.tipo === 'clip'));
  const t = hayAlgo ? cabezal : 0;
  const res = await opTl(window.clipForge.montajeAgregarClip(archivoActual, mediaId, pistaId || null, t));
  const info = res && res.colocado;
  if (!info) { estado.textContent = 'Ese material no se pudo poner en la línea.'; return; }
  const pista = (res.pistas.find((p) => p.id === info.pistaId) || {}).nombre || '';
  const creadas = (info.pistasNuevas || []).length;
  estado.textContent = creadas
    ? `Material puesto en ${fmtTiempo(t)} · pista nueva ${pista} (no tapó nada).`
    : `Material puesto en ${fmtTiempo(t)} · pista ${pista}.`;
}

if ($('btnAgregarMedia')) {
  $('btnAgregarMedia').addEventListener('click', async () => {
    if (!archivoActual) { estado.textContent = 'Abrí un archivo primero.'; return; }
    const ruta = await window.clipForge.elegirArchivo();
    if (!ruta) return;
    await opTl(window.clipForge.montajeAgregarMedia(archivoActual, ruta));
    estado.textContent = 'Material agregado. Clic en él para ponerlo en la línea.';
  });
}

// ============================================================
// VISOR (06/08/2026) — MUESTRA EL MONTAJE, NO EL ARCHIVO
// ============================================================
// Cierra el circulo que faltaba: hasta ahora se editaba a ciegas, porque
// el visor no existia y la linea de tiempo era la unica forma de saber
// que estaba pasando.
//
// LA IDEA CENTRAL, Y LA UNICA QUE HAY QUE ENTENDER ACA: el <video>
// reproduce el ARCHIVO, pero el cabezal se mueve por la LINEA. Son los
// dos ejes de tiempo del modelo, y traducir entre ellos es todo el
// trabajo de este bloque:
//
//     tLinea  -->  capaVisibleEn()  -->  { media, tFuente }
//     tFuente -->  video.currentTime
//     y de vuelta:  tLinea = el.inicio + (video.currentTime - el.usadoIn)
//
// Confundirlos NO da error: el video se va corriendo de a poco a medida
// que se corta, que es justo el bug que el modelo advierte en su
// encabezado.
//
// POR QUE LA CUENTA SE HACE ACA Y NO EN EL MAIN (unica excepcion a la
// regla de arriba, y a proposito): resolver "que se ve" hay que hacerlo a
// 60 cuadros por segundo, y un viaje de IPC por cuadro no sirve. La
// solucion NO es reescribir la cuenta: es cargar el MISMO
// src/shared/montaje.js con un <script> (queda como window.Montaje) y
// llamar a las mismas funciones que llama el main. Mismo archivo, misma
// cuenta, imposible que diverjan - el patron que ya se habia usado con
// geometria916.js para que el preview y la exportacion coincidieran.

const visorVideo = $('visorVideo');
const visorLienzo = $('visorLienzo');
const canvas169 = $('canvas169');
const ctx169 = canvas169 ? canvas169.getContext('2d') : null;
const capaTransformar = $('capaTransformar');
const visorVacio = $('visorVacio');
const visorTiempo = $('visorTiempo');
const visorFuente = $('visorFuente');
const btnVisorPlay = $('btnVisorPlay');

let visorRuta = null;       // que archivo esta cargado en el <video>
let visorClipId = null;     // que clip se esta mostrando ahora
let reproduciendo = false;
let rafVisor = null;

// Margen para comparar tiempos. Un cuadro a 60fps son 16ms; con 20ms
// alcanza para no quedarse trabado en el borde exacto de un corte.
const EPS_VISOR = 0.02;

// Que se ve en un instante de la LINEA, resuelto con el modulo del modelo.
// Devuelve la capa (media + tFuente) y el elemento (que da inicio/fin en
// la linea y usadoIn/Out en el archivo), o null si ahi no hay nada.
function visorEstadoEn(tLinea) {
  const m = tlDatos.montaje;
  if (!m || !window.Montaje) return null;

  // Primero la imagen. Si no hay, todavia puede haber SONIDO: las dos
  // pistas son independientes y un vacio de video no implica silencio.
  // Ese caso se reproduce en negro pero se sigue escuchando.
  let capa = Montaje.capaVisibleEn(m, tLinea);
  let soloAudio = false;
  if (!capa || !capa.media) {
    capa = Montaje.capaDeAudioEn(m, tLinea);
    soloAudio = true;
  }
  if (!capa || !capa.media) return null;

  const el = Montaje.elementosDePista(m, capa.pistaId).find((x) => x.id === capa.clipId);
  return el ? { capa, el, soloAudio } : null;
}

// Deja el <video> apuntando al material correcto. No toca currentTime:
// de eso se encarga visorIrA(), para no re-buscar en cada cuadro.
function visorMostrar(tLinea) {
  if (!visorVideo) return null;
  const st = visorEstadoEn(tLinea);

  if (!st) {
    // Un vacio del montaje tiene que verse NEGRO, no con el ultimo cuadro
    // congelado: si no, un hueco parece un clip que no avanza.
    visorClipId = null;
    if (visorVacio) {
      visorVacio.classList.remove('oculto');
      visorVacio.innerHTML = '<b>Sin material</b>no hay nada en este punto del montaje';
    }
    if (visorFuente) visorFuente.textContent = tlDatos.duracion ? 'vacío' : 'sin material';
    if (!visorVideo.paused) visorVideo.pause();
    // El lienzo se limpia solo: dibujar sin capa deja el negro de la base.
    dibujarLienzo(null);
    return null;
  }

  // El <video> ya no se muestra ni se esconde: vive fuera de la vista y
  // solo aporta cuadros y sonido. Lo que decide si se ve algo es el
  // LIENZO. En un tramo con solo sonido el video sigue corriendo (por eso
  // se escucha) y el lienzo queda en negro con su cartel.
  if (visorVacio) {
    visorVacio.classList.toggle('oculto', !st.soloAudio);
    if (st.soloAudio) visorVacio.innerHTML = '<b>Solo audio</b>acá no hay imagen, pero se sigue escuchando';
  }

  // Cambiar .src reinicia la descarga del archivo, asi que solo se toca
  // cuando el clip visible viene de OTRO material.
  if (st.capa.media.ruta !== visorRuta) {
    visorRuta = st.capa.media.ruta;
    visorVideo.src = window.clipForge.rutaAFileUrl(visorRuta);
  }
  visorClipId = st.capa.clipId;
  visorAjustarSonido(tLinea, st);
  if (visorFuente) {
    const sinImagen = st.soloAudio || st.capa.media.tipo === 'audio';
    const z = Math.round((st.capa.transformacion.escala || 1) * 100);
    visorFuente.textContent = `${st.capa.media.nombre} · ${st.capa.pistaNombre}` +
      (sinImagen ? ' · solo audio' : (z !== 100 ? ` · ${z}%` : ''));
  }
  dibujarLienzo(st);
  return st;
}

// EL SONIDO DEL VISOR (tanda D, paso 5). El visor tiene UN <video> y no
// mezcla: suena lo que trae el archivo de la capa que se ve. Lo que si
// puede hacer es respetar el silencio y el volumen de SU sonido: si la
// pista de audio donde esta ese sonido esta silenciada (o en 0), el <video>
// se calla; si no, toma su ganancia (hasta 100 %, el maximo de un <video>).
// La musica de otra pista NO suena en el visor: lo dice el panel de export.
function visorAjustarSonido(tLinea, st) {
  if (!visorVideo || !window.Montaje || !tlDatos.montaje) return;
  const propia = Montaje.capasDeAudioEn(tlDatos.montaje, tLinea).find((c) =>
    c.mediaId === st.capa.mediaId && Math.abs(c.tFuente - st.capa.tFuente) < 0.05);
  visorVideo.muted = !propia;
  if (propia) visorVideo.volume = Math.max(0, Math.min(1, propia.ganancia));
}

// Lleva el cabezal (y el video) a un instante de la LINEA.
function visorIrA(tLinea, forzarSeek) {
  cabezal = Math.max(0, Math.min(tLinea, durTl()));
  const st = visorMostrar(cabezal);
  if (st && visorVideo) {
    const destino = st.capa.tFuente;
    // Buscar en un archivo grande cuesta; solo se pide si de verdad
    // estamos lejos, o si el salto fue explicito (un corte, un clic).
    if (forzarSeek || Math.abs(visorVideo.currentTime - destino) > 0.25) {
      try { visorVideo.currentTime = destino; } catch (e) { /* aun sin metadata */ }
    }
  }
  renderCabezal();
  visorActualizarTiempo();
  pintar916();
}

function visorActualizarTiempo() {
  if (visorTiempo) visorTiempo.textContent = `${fmtTiempo(cabezal)} / ${fmtTiempo(tlDatos.duracion || 0)}`;
}

// El montaje cambio (un corte, un borrado, un deshacer): hay que volver a
// resolver que se ve, porque el clip bajo el cabezal puede ser otro.
function visorRefrescar() {
  visorClipId = null;
  const st = visorMostrar(cabezal);
  if (st && visorVideo) {
    try { visorVideo.currentTime = st.capa.tFuente; } catch (e) { /* idem */ }
  }
  visorActualizarTiempo();
}

function visorReiniciar() {
  visorPausar();
  visorRuta = null;
  visorClipId = null;
  if (visorVideo) visorVideo.removeAttribute('src');
  if (visorFuente) visorFuente.textContent = '';
  visorActualizarTiempo();
}

// Un cuadro del reproductor. Todo lo delicado pasa aca.
//
// Marca de tiempo del cuadro anterior, para poder ATRAVESAR un vacio en
// tiempo real: ahi no hay ningun video que lleve la cuenta, asi que el
// cabezal avanza con el reloj.
let ultimoCuadro = 0;

function visorTick(ahora) {
  rafVisor = null;
  if (!reproduciendo) return;
  const dt = ultimoCuadro && ahora ? Math.min(0.25, (ahora - ultimoCuadro) / 1000) : 0;
  ultimoCuadro = ahora || 0;

  const st = visorEstadoEn(cabezal);

  if (!st) {
    // Vacio de verdad: ni imagen ni sonido.
    if (saltarVacios()) {
      // Saltar al proximo material en vez de quedarse mirando negro.
      const prox = window.Montaje && tlDatos.montaje
        ? Montaje.proximoMaterialDesde(tlDatos.montaje, cabezal) : null;
      if (prox == null) { visorPausar(); return; }
      visorIrA(prox, true);
      visorVideo.play().catch(() => {});
    } else {
      // Atravesarlo: el vacio dura lo que dura, en negro y en silencio.
      // Sin un <video> que marque el paso del tiempo, lo lleva el reloj.
      cabezal = Math.min(durTl(), cabezal + dt);
      visorMostrar(cabezal);
      renderCabezal();
      visorActualizarTiempo();
      pintar916();
    }
  } else if (st.capa.clipId !== visorClipId) {
    // Cruzamos a otro clip (un corte, o el montaje cambio mientras corria):
    // recargar material y saltar al punto correcto del archivo.
    visorIrA(cabezal, true);
    visorVideo.play().catch(() => {});
  } else {
    // Caso normal: el cabezal lo manda el video. Esta es la traduccion
    // FUENTE -> LINEA.
    const tLinea = st.el.inicio + (visorVideo.currentTime - st.el.usadoIn);
    if (tLinea >= st.el.fin - EPS_VISOR) {
      // Se acabo este clip. El siguiente elemento puede ser otro clip
      // (sigue) o un hueco (lo resuelve el tick que viene).
      visorIrA(st.el.fin + EPS_VISOR, true);
      if (reproduciendo) visorVideo.play().catch(() => {});
    } else {
      cabezal = Math.max(0, tLinea);
      renderCabezal();
      visorActualizarTiempo();
      // El panel vertical se redibuja en CADA cuadro: es lo que lo hace
      // un visor y no una miniatura estatica.
      pintar916();
    }
  }

  if (reproduciendo) seguirCabezal();
  if (cabezal >= durTl() - EPS_VISOR) { visorPausar(); return; }
  rafVisor = requestAnimationFrame(visorTick);
}

function visorReproducir() {
  if (!visorVideo || !tlDatos.montaje) return;
  // Si quedo parado en el final, volver al principio (como cualquier
  // reproductor) en vez de no hacer nada.
  if (cabezal >= durTl() - EPS_VISOR) cabezal = 0;

  const hayAlgo = !!visorEstadoEn(cabezal);
  if (!hayAlgo && saltarVacios()) {
    // Con la opcion activada, dar play parado en un vacio arranca desde
    // el proximo material. Sin ella se atraviesa el vacio, que es lo que
    // se pidio explicitamente.
    const prox = window.Montaje ? Montaje.proximoMaterialDesde(tlDatos.montaje, cabezal) : null;
    if (prox == null) { estado.textContent = 'No hay material para reproducir.'; return; }
    visorIrA(prox, true);
  } else {
    visorIrA(cabezal, true);
  }

  reproduciendo = true;
  ultimoCuadro = 0;   // el primer cuadro no cuenta: no hay delta previo
  if (btnVisorPlay) btnVisorPlay.textContent = '⏸';
  // Parado en un vacio no hay nada que reproducir todavia; el tick hace
  // avanzar el cabezal con el reloj hasta llegar al proximo material.
  visorVideo.play().catch(() => {});
  if (!rafVisor) rafVisor = requestAnimationFrame(visorTick);
}

function visorPausar() {
  reproduciendo = false;
  ultimoCuadro = 0;
  if (btnVisorPlay) btnVisorPlay.textContent = '▶';
  if (visorVideo && !visorVideo.paused) visorVideo.pause();
  if (rafVisor) { cancelAnimationFrame(rafVisor); rafVisor = null; }
}

function visorAlternar() {
  if (reproduciendo) visorPausar(); else visorReproducir();
}

if (btnVisorPlay) btnVisorPlay.addEventListener('click', visorAlternar);
if ($('btnVisorInicio')) $('btnVisorInicio').addEventListener('click', () => { visorPausar(); visorIrA(0, true); });

// ---------- REPINTAR CUANDO EL CUADRO ESTA LISTO ----------
// BUG REPORTADO 07/08/2026: "al mover la linea la imagen no se ve en el
// visor 1; tengo que hacer clicks en los clips para que se vuelvan a ver".
//
// Es una consecuencia directa de haber pasado el visor a canvas. Antes se
// veia un <video> y el navegador repintaba solo al terminar de buscar.
// Ahora el canvas se dibuja UNA vez, en el mismo instante en que se pide
// el seek - y en ese instante el cuadro nuevo todavia no esta decodificado
// (readyState baja a 1 mientras busca), asi que fuenteDelVideo() devuelve
// null y dibujarLienzo() deja el lienzo negro. Como nada volvia a pintar
// cuando el seek terminaba, el visor se quedaba vacio hasta que otra cosa
// forzaba un repintado: hacer clic en un clip cambiaba la seleccion, y ESE
// era el redibujo que lo hacia aparecer.
//
// La solucion es escuchar al video en vez de asumir que ya esta: cuando
// avisa que tiene cuadro, se repinta.
function repintarCuadro() {
  if (reproduciendo) return;   // el bucle de reproduccion ya repinta solo
  // Sin forzar: pintar916 decide por su firma si hace falta rehacer el
  // DOM. Forzarlo aca tiraria y rearmaria los recuadros con cada cuadro
  // que llega, y eso puede cortar un arrastre en curso.
  pintar916();
}

if (visorVideo) {
  // 'seeked' cierra el salto; 'loadeddata' es el primer cuadro de un
  // archivo recien cargado (ahi ademas aparecen videoWidth/Height, que es
  // lo que necesita el marco para encuadrar).
  // ('loadedmetadata' ya tiene su propio oyente mas abajo, que fuerza el
  // redibujo porque ahi recien aparecen las medidas del video.)
  ['seeked', 'loadeddata', 'canplay'].forEach((evento) =>
    visorVideo.addEventListener(evento, repintarCuadro));

  // Cuando el navegador lo soporta, esto avisa por CADA cuadro nuevo que
  // el video presenta - incluido el que aparece despues de un seek fino
  // que no dispara 'seeked'. Es la senal correcta para dibujar sobre un
  // canvas y evita quedarse con el cuadro anterior.
  if (typeof visorVideo.requestVideoFrameCallback === 'function') {
    const seguir = () => {
      repintarCuadro();
      try { visorVideo.requestVideoFrameCallback(seguir); } catch (e) { /* se cerro */ }
    };
    try { visorVideo.requestVideoFrameCallback(seguir); } catch (e) { /* sin soporte real */ }
  }
}

if (visorVideo) {
  // Un archivo que Chromium no sabe decodificar (pasa con algunos .mkv)
  // tiene que decirlo, no quedarse en negro sin explicacion.
  visorVideo.addEventListener('error', () => {
    if (!visorRuta) return;
    visorPausar();
    estado.textContent = `El visor no puede reproducir "${visorRuta.split(/[\\/]/).pop()}" (formato no soportado por Chromium).`;
  });
  // Al terminar el archivo antes de tiempo (clip que llega al final del
  // material) el tick ya lo maneja; esto cubre el caso de que el <video>
  // se pare solo.
  visorVideo.addEventListener('ended', () => { if (reproduciendo) visorPausar(); });
}

// ============================================================
// RECUADROS 16:9 -> 9:16 Y VISOR VERTICAL (06/08/2026)
// ============================================================
// Se dibuja un rectangulo sobre el video horizontal y ese pedazo aparece
// en el panel vertical de al lado. Es la funcion que distingue a
// ClipForge de un editor generico: sacar un short de una grabacion 16:9
// sin perder lo que importa.
//
// TRES PIEZAS, cada una en su archivo, y ninguna sabe de las otras:
//   Recuadros    QUE pedazo del frame y CUANDO esta activo
//   Layout916    DONDE va cada uno dentro del panel vertical
//   Geometria916 el recorte "cover" en pixeles
// Son los MISMOS archivos que carga el proceso principal, asi que lo que
// se ve aca es lo que va a exportarse cuando exista el planificador.
//
// LA TRAMPA DE ESTA PARTE: los recuadros se guardan en PORCENTAJES DEL
// FRAME, no en pixeles de pantalla, y el <video> se dibuja con
// object-fit:contain - o sea que hay franjas negras que NO son video.
// Si la capa donde se dibuja se estirara sobre todo el elemento, un
// recuadro pegado al borde apuntaria a pixeles que no existen en el
// archivo. Por eso ubicarCapa() la posiciona sobre la IMAGEN y no sobre
// el elemento.

const capaRecuadros = $('capaRecuadros');
const capaCeldas = $('capaCeldas');
const lienzo916 = $('lienzo916');
const canvas916 = $('canvas916');
const ctx916 = canvas916 ? canvas916.getContext('2d') : null;
const vacio916 = $('vacio916');
const aviso916 = $('aviso916');

let layout916 = null;
// El encuadre elegido. Es el id de un ELEMENTO del montaje, no de una
// lista aparte: la lista aparte se fue el 07/08/2026.
let recSeleccionado = null;
let arrastreRec = null;

// Rectangulo que ocupa el LIENZO dibujado dentro de su elemento. Antes
// esto media la imagen del <video>; ahora mide el canvas, que es lo que
// se ve. Es mas simple y ademas mas correcto: los recuadros del 9:16
// recortan la imagen COMPUESTA (con las transformaciones ya aplicadas),
// no el archivo crudo.
function rectImagen() {
  if (!canvas169 || !visorLienzo) return null;
  const b = canvas169.getBoundingClientRect();
  const lb = visorLienzo.getBoundingClientRect();
  if (b.width <= 0 || b.height <= 0) return null;
  const escala = Math.min(b.width / canvas169.width, b.height / canvas169.height);
  const w = canvas169.width * escala, h = canvas169.height * escala;
  return { left: (b.left - lb.left) + (b.width - w) / 2, top: (b.top - lb.top) + (b.height - h) / 2, width: w, height: h };
}

// ---------- Dibujo del lienzo 16:9 ----------
// El visor es una BASE: se limpia en negro y encima se dibujan las capas
// del montaje, cada una con su tamaño y posicion. Hoy la fuente de
// cuadros es un solo <video> (el de la capa visible); la estructura ya
// esta lista para varias cuando haga falta apilar de verdad.
function lienzoDelProyecto() {
  const media = (tlDatos && tlDatos.media) || [];
  return window.Lienzo ? Lienzo.lienzoDeMontaje(media, canvas169 ? canvas169.width : 1280)
                       : { ancho: 1280, alto: 720 };
}

// Ajusta la resolucion del canvas a la forma del proyecto: un proyecto
// vertical no puede dibujarse sobre un lienzo apaisado.
function ajustarLienzo() {
  if (!canvas169) return;
  const l = lienzoDelProyecto();
  if (canvas169.height !== l.alto) canvas169.height = l.alto;
}

// Mientras se arrastra el marco, la transformacion todavia no esta
// guardada: se dibuja esta, para ver el resultado antes de soltar.
let transformProvisional = null;

// El material que alimenta al lienzo, o null si todavia no hay cuadros.
function fuenteDelVideo() {
  if (!visorVideo || !visorVideo.videoWidth || visorVideo.readyState < 2) return null;
  return { ancho: visorVideo.videoWidth, alto: visorVideo.videoHeight };
}

// Compone el lienzo del proyecto. El plan lo arma `Composicion`, el mismo
// modulo que va a usar la exportacion; aca solo se ejecuta.
//
// LO QUE TODAVIA NO ESTA: hay UN solo <video> alimentando el lienzo, asi
// que de las capas del plan solo se puede dibujar la que ese <video> esta
// decodificando. El plan ya viene con todas y en orden — cuando haya
// varios elementos de video sincronizados (ver PENDIENTE, "multi-capa
// real") este bucle no cambia, solo va a encontrar fuente para mas de una.
function dibujarLienzo(st) {
  if (!ctx169 || !canvas169) return;
  ajustarLienzo();
  const W = canvas169.width, H = canvas169.height;
  ctx169.fillStyle = Composicion.NEGRO;
  ctx169.fillRect(0, 0, W, H);

  const fuente = fuenteDelVideo();
  if (!st || st.soloAudio || !fuente || !window.Composicion || !tlDatos.montaje) return;

  // Las medidas REALES las tiene el <video> decodificando, no ffprobe.
  // Se pasan por el mismo canal que va a usar la exportacion con su
  // decodificador, asi los dos resuelven el encaje igual.
  const plan = Composicion.planLienzo(tlDatos.montaje, cabezal, { ancho: W, alto: H },
    { [st.capa.mediaId]: fuente });

  for (const capa of plan.capas) {
    // Solo la capa que este <video> esta mostrando: es la unica de la que
    // hay cuadro. Las demas se saltean sin ruido.
    if (capa.clipId !== st.capa.clipId) continue;
    // Mientras se arrastra sobre el visor manda la transformacion en
    // curso: el plan sale del montaje, que todavia no la tiene guardada
    // (se guarda al soltar, un paso de historial por gesto).
    const r = transformProvisional
      ? Lienzo.rectDeCapa(capa.fuente, transformProvisional, { ancho: W, alto: H })
      : capa.dest;
    try {
      ctx169.drawImage(visorVideo, r.x, r.y, r.w, r.h);
    } catch (e) { /* el cuadro todavia no esta decodificado */ }
  }
}

// ---------- Encuadrar: mover y escalar la imagen sobre el lienzo ----------
function ubicarMarcoCapa() {
  if (!capaTransformar) return null;
  const r = rectImagen();
  if (!r) { capaTransformar.style.display = 'none'; return null; }
  capaTransformar.style.display = 'block';
  capaTransformar.style.left = r.left + 'px';
  capaTransformar.style.top = r.top + 'px';
  capaTransformar.style.width = r.width + 'px';
  capaTransformar.style.height = r.height + 'px';
  return r;
}

function renderMarcoCapa() {
  if (!capaTransformar) return;
  const st = visorEstadoEn(cabezal);
  const fuente = fuenteDelVideo();
  if (!ubicarMarcoCapa() || !st || st.soloAudio || !fuente || !window.Lienzo) {
    capaTransformar.innerHTML = '';
    return;
  }
  const L = { ancho: canvas169.width, alto: canvas169.height };
  const rc = Lienzo.rectDeCapa(fuente, transformProvisional || st.capa.transformacion, L);
  const elegido = elSeleccionado && elSeleccionado.elId === st.capa.clipId;
  capaTransformar.innerHTML = `
    <div class="marcoCapa${elegido ? ' sel' : ''}" data-id="${st.capa.clipId}" data-pista="${st.capa.pistaId}"
         style="left:${(rc.x / L.ancho) * 100}%;top:${(rc.y / L.alto) * 100}%;width:${(rc.w / L.ancho) * 100}%;height:${(rc.h / L.alto) * 100}%;">
      <span class="tiradorCapa tl" data-esq="tl"></span><span class="tiradorCapa tr" data-esq="tr"></span>
      <span class="tiradorCapa bl" data-esq="bl"></span><span class="tiradorCapa br" data-esq="br"></span>
    </div>`;
}

let arrastreCapa = null;

if (capaTransformar) {
  capaTransformar.addEventListener('mousedown', (ev) => {
    const marco = ev.target.closest('.marcoCapa.sel');
    if (!marco || !archivoActual) return;
    const st = visorEstadoEn(cabezal);
    const fuente = fuenteDelVideo();
    if (!st || !fuente || !window.Lienzo) return;
    const p = fraccionEn(capaTransformar, ev);
    if (!p) return;
    ev.preventDefault();
    ev.stopPropagation();

    const L = { ancho: canvas169.width, alto: canvas169.height };
    const rect = Lienzo.rectDeCapa(fuente, st.capa.transformacion, L);
    const tirador = ev.target.closest('.tiradorCapa');
    arrastreCapa = {
      pistaId: st.capa.pistaId, elId: st.capa.clipId,
      base: st.capa.transformacion, rect, fuente, L,
      esq: tirador ? tirador.dataset.esq : null,
      // El cuadro donde se agarro: si el clip esta animado, lo que se suelta
      // va a la clave de ESTE cuadro (tanda F).
      tLinea: cabezal,
      inicio: p, actual: p
    };
  });
}

// De un gesto a la transformacion que le corresponde. Igual que con los
// recuadros, el estado entra POR PARAMETRO: leerlo de la variable de
// modulo fue el bug que impidio mover los recuadros.
function transformDelArrastre(a, p) {
  const dx = p.x - a.inicio.x, dy = p.y - a.inicio.y;
  if (!a.esq) {
    // Mover: el corrimiento va en fracciones del lienzo, que es
    // exactamente lo que mide `p` sobre la capa.
    return { ...a.base, x: a.base.x + dx, y: a.base.y + dy };
  }
  // Escalar desde la esquina OPUESTA, que queda fija.
  const anclaX = a.esq.includes('l') ? a.rect.x + a.rect.w : a.rect.x;
  const anclaY = a.esq.includes('t') ? a.rect.y + a.rect.h : a.rect.y;
  const px = p.x * a.L.ancho, py = p.y * a.L.alto;
  // Se conserva la proporcion: la escala es un solo numero, y deformar la
  // imagen no es lo que se pide al arrastrar una esquina.
  const factorX = Math.abs(px - anclaX) / Math.max(1, a.rect.w);
  const factorY = Math.abs(py - anclaY) / Math.max(1, a.rect.h);
  const factor = Math.max(0.02, Math.max(factorX, factorY));
  const w = a.rect.w * factor, h = a.rect.h * factor;
  const rect = {
    x: a.esq.includes('l') ? anclaX - w : anclaX,
    y: a.esq.includes('t') ? anclaY - h : anclaY,
    w, h
  };
  return Lienzo.transformacionDesdeRect(rect, a.fuente, a.L);
}

window.addEventListener('mousemove', (ev) => {
  if (!arrastreCapa) return;
  const p = fraccionEn(capaTransformar, ev);
  if (!p) return;
  arrastreCapa.actual = p;
  transformProvisional = transformDelArrastre(arrastreCapa, p);
  pintar916(true);
});

window.addEventListener('mouseup', () => {
  if (!arrastreCapa) return;
  const a = arrastreCapa;
  arrastreCapa = null;
  const t = transformProvisional;
  transformProvisional = null;
  if (!t || !archivoActual) { pintar916(true); return; }
  const animado = window.Montaje && tlDatos.montaje &&
    Montaje.clavesEnLinea(tlDatos.montaje, a.pistaId, a.elId).length > 0;
  opTl(window.clipForge.montajeTransformar(archivoActual, durTl(), a.pistaId, a.elId, t, a.tLinea),
    animado ? `Clave de este cuadro: ${Math.round(t.escala * 100)}%` : `Encuadre: ${Math.round(t.escala * 100)}%`);
});

function ubicarCapa() {
  if (!capaRecuadros) return null;
  const r = rectImagen();
  if (!r) { capaRecuadros.style.display = 'none'; return null; }
  capaRecuadros.style.display = 'block';
  capaRecuadros.style.left = r.left + 'px';
  capaRecuadros.style.top = r.top + 'px';
  capaRecuadros.style.width = r.width + 'px';
  capaRecuadros.style.height = r.height + 'px';
  return r;
}

// Solo se dibujan los ACTIVOS en el instante del cabezal: un encuadre que
// vale para otro tramo del video no tiene por que estorbar aca.
//
// Salen del MONTAJE, con el mismo modulo que usa el main. Antes salian de
// una lista propia que llegaba por otro canal, y esa duplicacion era la
// causa de que la linea de tiempo y el panel vertical pudieran mostrar
// cosas distintas.
//
// La forma que se devuelve es la que esperan Geometria916 y Layout916
// (id + los cuatro porcentajes), asi que ninguno de los dos se entera de
// que el dato cambio de lugar. `pistaId` se agrega porque ahora hace
// falta para operar sobre el elemento.
function activosAhora() {
  if (!window.Montaje || !tlDatos.montaje) return [];
  return Montaje.encuadresEn(tlDatos.montaje, cabezal)
    .map((c) => ({ id: c.clipId, pistaId: c.pistaId, ...c.rect }));
}

function renderRecuadros() {
  if (!capaRecuadros) return;
  if (!ubicarCapa()) { capaRecuadros.innerHTML = ''; return; }
  capaRecuadros.innerHTML = activosAhora().map((x, i) => `
    <div class="recuadro${recSeleccionado === x.id ? ' sel' : ''}" data-id="${x.id}"
         style="left:${x.xPct * 100}%;top:${x.yPct * 100}%;width:${x.wPct * 100}%;height:${x.hPct * 100}%;">
      <span class="num">${i + 1}</span>
      <button class="quitar" title="Quitar este recuadro">×</button>
      <span class="tirador tl" data-esq="tl"></span><span class="tirador tr" data-esq="tr"></span>
      <span class="tirador bl" data-esq="bl"></span><span class="tirador br" data-esq="br"></span>
    </div>`).join('');
}

// ---------- Acomodar las celdas DENTRO del panel vertical ----------
// Los presets son un punto de partida, no una jaula: cada celda se puede
// mover y estirar a mano, que era el pedido ("no me deja acomodar como
// quiero que se vean en el 916").

// Igual que rectImagen() pero para el canvas: con object-fit:contain el
// 9:16 dibujado es mas angosto que el elemento, y una celda ubicada
// sobre el elemento quedaria corrida respecto de lo que se ve.
function rect916() {
  if (!canvas916 || !lienzo916) return null;
  const b = canvas916.getBoundingClientRect();
  const lb = lienzo916.getBoundingClientRect();
  if (b.width <= 0 || b.height <= 0) return null;
  const escala = Math.min(b.width / canvas916.width, b.height / canvas916.height);
  const w = canvas916.width * escala, h = canvas916.height * escala;
  return { left: (b.left - lb.left) + (b.width - w) / 2, top: (b.top - lb.top) + (b.height - h) / 2, width: w, height: h };
}

// Solo COLOCA la capa sobre el 9:16 dibujado, sin rehacer su contenido.
// Se separa del render para poder reacomodarla al cambiar el tamaño de la
// ventana sin tirar los nodos (y sin pisar un arrastre en curso).
function ubicarCapaCeldas() {
  if (!capaCeldas) return null;
  const r = rect916();
  if (!r || !activosAhora().length || !window.Layout916) {
    capaCeldas.style.display = 'none';
    return null;
  }
  capaCeldas.style.display = 'block';
  capaCeldas.style.left = r.left + 'px';
  capaCeldas.style.top = r.top + 'px';
  capaCeldas.style.width = r.width + 'px';
  capaCeldas.style.height = r.height + 'px';
  return r;
}

function renderCeldas916() {
  if (!capaCeldas) return;
  const activos = activosAhora();
  if (!ubicarCapaCeldas()) { capaCeldas.innerHTML = ''; return; }

  const celdas = Layout916.celdasParaDibujar(layout916, activos.map((x) => x.id));
  capaCeldas.innerHTML = celdas.map((c) => `
    <div class="celda916${recSeleccionado === c.clipId ? ' sel' : ''}" data-id="${c.clipId}"
         style="left:${c.x * 100}%;top:${c.y * 100}%;width:${c.w * 100}%;height:${c.h * 100}%;">
      <span class="rot">${c.pos + 1}</span>
      <span class="tirador916"></span>
    </div>`).join('');
}

let arrastreCelda = null;

function fraccionEn(capa, ev) {
  const b = capa.getBoundingClientRect();
  if (b.width <= 0 || b.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)),
    y: Math.max(0, Math.min(1, (ev.clientY - b.top) / b.height))
  };
}

if (capaCeldas) {
  capaCeldas.addEventListener('mousedown', (ev) => {
    const dom = ev.target.closest('.celda916');
    if (!dom || !archivoActual) return;
    const p = fraccionEn(capaCeldas, ev);
    if (!p) return;
    ev.preventDefault();
    const c = (Layout916.celdasParaDibujar(layout916, activosAhora().map((x) => x.id)) || [])
      .find((x) => x.clipId === dom.dataset.id);
    if (!c) return;
    recSeleccionado = dom.dataset.id;
    arrastreCelda = ev.target.classList.contains('tirador916')
      ? { modo: 'redim', id: c.clipId, base: c }
      : { modo: 'mover', id: c.clipId, base: c, agarre: { x: p.x - c.x, y: p.y - c.y } };
    pintar916(true);
  });
}

window.addEventListener('mousemove', (ev) => {
  if (!arrastreCelda) return;
  const p = fraccionEn(capaCeldas, ev);
  if (!p) return;
  arrastreCelda.actual = p;
  const dom = capaCeldas.querySelector(`.celda916[data-id="${arrastreCelda.id}"]`);
  if (!dom) return;
  const a = arrastreCelda, b = a.base;
  if (a.modo === 'mover') {
    dom.style.left = Math.max(0, Math.min(1 - b.w, p.x - a.agarre.x)) * 100 + '%';
    dom.style.top = Math.max(0, Math.min(1 - b.h, p.y - a.agarre.y)) * 100 + '%';
  } else {
    dom.style.width = Math.max(0.05, p.x - b.x) * 100 + '%';
    dom.style.height = Math.max(0.05, p.y - b.y) * 100 + '%';
  }
});

window.addEventListener('mouseup', () => {
  if (!arrastreCelda) return;
  // Mismo cuidado que con los recuadros: el estado se copia ANTES de
  // anular la variable, y lo que se necesita despues va por parametro.
  const a = arrastreCelda;
  arrastreCelda = null;
  if (!a.actual || !archivoActual) { pintar916(true); return; }
  if (a.modo === 'mover') {
    opTl(window.clipForge.layout916(archivoActual, durTl(), 'mover',
      { id: a.id, x: a.actual.x - a.agarre.x, y: a.actual.y - a.agarre.y }));
  } else {
    opTl(window.clipForge.layout916(archivoActual, durTl(), 'redimensionar',
      { id: a.id, esquina: 'br', x: a.actual.x, y: a.actual.y }));
  }
});

// Dibuja el panel vertical. Se llama en cada cuadro mientras se
// reproduce, asi que no pide nada por IPC ni reserva memoria: solo lee
// del <video> que ya esta decodificando.
//
// EL QUE DECIDE QUE DIBUJAR ES `Composicion.planVertical` (07/08/2026),
// el MISMO modulo que va a usar la exportacion. Aca no queda ninguna
// cuenta: solo ejecutar el plan. Es lo que hace que el mp4 no pueda
// mostrar otra cosa que el preview — antes eran dos caminos separados que
// se comparaban con tests, y un test avisa DESPUES de divergir.
//
// EL 9:16 RECORTA DEL LIENZO YA COMPUESTO, no del archivo crudo: si el
// user agranda o corre la imagen en el 16:9, el encuadre toma exactamente
// lo que se ve.
function dibujar916() {
  if (!ctx916 || !canvas916) return;
  const W = canvas916.width, H = canvas916.height;
  ctx916.fillStyle = Composicion.NEGRO;
  ctx916.fillRect(0, 0, W, H);

  const hayEncuadres = activosAhora().length > 0;
  if (vacio916) vacio916.classList.toggle('oculto', hayEncuadres);
  const listo = canvas169 && canvas169.width > 0;
  if (!hayEncuadres || !listo || !window.Composicion || !tlDatos.montaje) return;

  const plan = Composicion.planVertical(
    tlDatos.montaje, cabezal,
    { ancho: canvas169.width, alto: canvas169.height },
    { ancho: W, alto: H },
    layout916);

  for (const celda of plan.celdas) {
    const { src, dest } = celda;
    try {
      ctx916.drawImage(canvas169, src.x, src.y, src.w, src.h, dest.x, dest.y, dest.w, dest.h);
    } catch (e) { /* el lienzo todavia no tiene nada dibujado */ }
  }
}

// Rehacer el HTML de los recuadros en cada cuadro seria tirar y rearmar
// los nodos 60 veces por segundo, y ademas pisaria el arrastre en curso.
// Solo se rehace cuando cambia QUE recuadros hay (entran y salen segun el
// instante) o cual esta seleccionado; el resto del tiempo alcanza con
// reubicar la capa y repintar el canvas.
let firmaActivos = null;

function pintar916(forzar) {
  // EL ORDEN IMPORTA: primero se compone el lienzo 16:9, porque el panel
  // vertical recorta de EL. Si se dibujara despues, el 9:16 mostraria
  // siempre el cuadro anterior.
  const st = visorEstadoEn(cabezal);
  dibujarLienzo(st);

  // La firma incluye el clip elegido en la LINEA DE TIEMPO: el marco para
  // encuadrar solo se puede agarrar cuando su clip esta seleccionado, asi
  // que al cambiar la seleccion hay que rehacerlo. Sin esto se
  // seleccionaba un clip y el marco seguia sin poder agarrarse.
  // Tambien entra SI YA HAY CUADRO: el marco para encuadrar no se puede
  // dibujar mientras el video no tenga medidas, asi que el instante en
  // que aparece el primer cuadro es un cambio de contenido como
  // cualquier otro. Sin esto el marco no volvia despues de un seek.
  const firma = activosAhora().map((r) => r.id).join(',') + '|' + (recSeleccionado || '') +
    '|' + ((elSeleccionado && elSeleccionado.elId) || '') +
    '|' + (fuenteDelVideo() ? '1' : '0') +
    '|' + ((st && st.capa.clipId) || '') + (st && st.soloAudio ? 'a' : 'v');
  if (forzar || firma !== firmaActivos) {
    firmaActivos = firma;
    renderRecuadros();
    renderCeldas916();
    renderMarcoCapa();
  } else {
    // Sin cambios de contenido alcanza con reacomodar las capas: es lo
    // que corre en cada cuadro mientras se reproduce.
    ubicarCapa();
    ubicarCapaCeldas();
    ubicarMarcoCapa();
  }
  dibujar916();
}

// `opRec` desaparecio (07/08/2026): tocar un encuadre es tocar el
// montaje, asi que va por opTl() como cualquier otra operacion y la
// respuesta ya trae el layout del panel. Habia dos funciones que hacian
// lo mismo con estados distintos, y ahi es donde se desincronizaban.

// ---------- Dibujar, mover y redimensionar con el mouse ----------
// Todo se calcula en FRACCIONES de la capa (0..1), que es como se guarda
// el recuadro: convertir a pixeles y de vuelta en cada paso es lo que
// hace que un encuadre se corra solo al cambiar el tamaño de la ventana.
function fraccionDesde(ev) {
  const b = capaRecuadros.getBoundingClientRect();
  if (b.width <= 0 || b.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)),
    y: Math.max(0, Math.min(1, (ev.clientY - b.top) / b.height))
  };
}

if (capaRecuadros) {
  capaRecuadros.addEventListener('mousedown', (ev) => {
    if (!archivoActual) return;
    const p = fraccionDesde(ev);
    if (!p) return;
    const caja = ev.target.closest('.recuadro');

    if (ev.target.classList.contains('quitar')) {
      ev.preventDefault();
      // Quitar un encuadre es BORRAR UN CLIP: el mismo canal que la tecla
      // Suprimir sobre la linea de tiempo. Se cierra el hueco porque un
      // ajuste no deja nada atras que sostener - lo de abajo sigue igual.
      const r = activosAhora().find((x) => x.id === caja.dataset.id);
      if (!r) return;
      if (recSeleccionado === r.id) recSeleccionado = null;
      opTl(window.clipForge.montajeBorrar(archivoActual, durTl(), r.pistaId, r.id, true),
        'Encuadre quitado.');
      return;
    }

    ev.preventDefault();
    if (!caja) {
      // Sobre el video pelado: se dibuja uno nuevo.
      arrastreRec = { modo: 'nuevo', x0: p.x, y0: p.y, actual: p };
      recSeleccionado = null;
      renderRecuadros();
      return;
    }

    recSeleccionado = caja.dataset.id;
    const r = activosAhora().find((x) => x.id === recSeleccionado);
    if (!r) return;
    // Y queda elegido tambien en la linea de tiempo: es el mismo clip.
    elSeleccionado = { pistaId: r.pistaId, elId: r.id };
    renderTl();
    const tirador = ev.target.closest('.tirador');
    arrastreRec = tirador
      ? { modo: 'redim', id: r.id, pistaId: r.pistaId, esq: tirador.dataset.esq, base: { ...r }, actual: p }
      : { modo: 'mover', id: r.id, pistaId: r.pistaId, base: { ...r }, agarre: { x: p.x - r.xPct, y: p.y - r.yPct }, actual: p };
    renderRecuadros();
  });
}

window.addEventListener('mousemove', (ev) => {
  if (!arrastreRec) return;
  const p = fraccionDesde(ev);
  if (!p) return;
  arrastreRec.actual = p;

  if (arrastreRec.modo === 'nuevo') {
    let caja = $('dibujando');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'dibujando';
      capaRecuadros.appendChild(caja);
    }
    const x = Math.min(arrastreRec.x0, p.x), y = Math.min(arrastreRec.y0, p.y);
    caja.style.left = x * 100 + '%';
    caja.style.top = y * 100 + '%';
    caja.style.width = Math.abs(p.x - arrastreRec.x0) * 100 + '%';
    caja.style.height = Math.abs(p.y - arrastreRec.y0) * 100 + '%';
    return;
  }

  // Mover y redimensionar se dibujan en vivo sobre el DOM; el dato real
  // se manda al soltar (un paso de historial por gesto, no por pixel).
  const dom = capaRecuadros.querySelector(`.recuadro[data-id="${arrastreRec.id}"]`);
  if (!dom) return;
  const r = rectDelArrastre(arrastreRec, p);
  dom.style.left = r.xPct * 100 + '%';
  dom.style.top = r.yPct * 100 + '%';
  dom.style.width = r.wPct * 100 + '%';
  dom.style.height = r.hPct * 100 + '%';
});

// El rectangulo que corresponde a un gesto, en fracciones.
//
// EL ESTADO DEL GESTO ENTRA POR PARAMETRO, no se lee de la variable de
// modulo. BUG REAL (reportado: "no se deja mover los recuadros"): antes
// esta funcion leia `arrastreRec` directo, y el mouseup la anula ANTES de
// llamarla - asi que tiraba "Cannot read properties of null" justo en el
// unico momento que importa, el handler se cortaba y el cambio no se
// guardaba nunca. En pantalla el recuadro se movia (eso lo hacia el
// mousemove, con el estado todavia vivo) y volvia solo al redibujar, que
// es exactamente lo que se veia.
function rectDelArrastre(a, p) {
  const b = a.base;
  if (a.modo === 'mover') {
    return { xPct: p.x - a.agarre.x, yPct: p.y - a.agarre.y, wPct: b.wPct, hPct: b.hPct };
  }
  // Al redimensionar se ancla la esquina OPUESTA a la que se agarro.
  // BUG YA CONOCIDO EN ESTE PROYECTO (05/08 y otra vez al reescribir):
  // mandar siempre "br" hacia que arrastrar tl volviera al rect original
  // y que tr/bl perdieran la mitad del cambio. La esquina real importa.
  const anclaX = a.esq.includes('l') ? b.xPct + b.wPct : b.xPct;
  const anclaY = a.esq.includes('t') ? b.yPct + b.hPct : b.yPct;
  return {
    xPct: Math.min(anclaX, p.x), yPct: Math.min(anclaY, p.y),
    wPct: Math.abs(p.x - anclaX), hPct: Math.abs(p.y - anclaY)
  };
}

window.addEventListener('mouseup', () => {
  if (!arrastreRec) return;
  const a = arrastreRec;
  arrastreRec = null;
  const caja = $('dibujando');
  if (caja) caja.remove();
  if (!archivoActual) return;

  if (a.modo === 'nuevo') {
    const x = Math.min(a.x0, a.actual.x), y = Math.min(a.y0, a.actual.y);
    const w = Math.abs(a.actual.x - a.x0), h = Math.abs(a.actual.y - a.y0);
    // Un clic suelto no deberia crear un recuadro invisible.
    if (w < 0.02 || h < 0.02) { renderRecuadros(); return; }
    // Nace DESDE EL CABEZAL hasta el final: es donde el user esta mirando.
    // Antes empezaba siempre en cero porque no tenia lugar propio en el
    // tiempo; ahora es un clip y su lugar es el instante que se ve.
    crearEncuadre({ xPct: x, yPct: y, wPct: w, hPct: h });
    return;
  }

  const r = rectDelArrastre(a, a.actual);
  // tLinea (tanda F): en un encuadre animado cambia la clave del cuadro del
  // cabezal; en uno fijo, el rectangulo de siempre.
  opTl(window.clipForge.montajeEncuadre(archivoActual, durTl(), 'ajustar',
    { pistaId: a.pistaId, elId: a.id, rect: r, tLinea: cabezal }));
});

// Crear un encuadre es PONER UN CLIP en la linea, asi que la respuesta
// dice donde aterrizo - igual que al soltar material en la linea de
// tiempo. Se deja seleccionado para poder seguir ajustandolo sin buscarlo.
async function crearEncuadre(rect) {
  const res = await opTl(window.clipForge.montajeEncuadre(archivoActual, durTl(), 'crear',
    { tLinea: cabezal, rect }));
  const info = res && res.colocado;
  if (!info) return;
  recSeleccionado = info.clipId;
  estado.textContent = info.pistasNuevas && info.pistasNuevas.length
    ? 'Encuadre creado en una pista nueva — recorta lo que tiene debajo.'
    : 'Encuadre creado — se ve en el panel vertical.';
  pintar916(true);
}

if ($('preset916')) {
  $('preset916').addEventListener('change', (ev) => {
    const modo = ev.target.value;
    ev.target.value = '';
    if (!modo || !archivoActual) return;
    opTl(window.clipForge.layout916(archivoActual, durTl(), 'preset', { modo }), 'Panel vertical acomodado.');
  });
}

// ---------- Mantener las capas pegadas a la imagen ----------
// Las dos capas (recuadros sobre el 16:9, celdas sobre el 9:16) se
// posicionan en PIXELES calculados al dibujar, porque tienen que caer
// sobre la imagen y no sobre el elemento (object-fit deja franjas).
//
// BUG REPORTADO 06/08/2026 (con captura): al plegar un panel lateral los
// recuadros quedaban flotando fuera del video y las celdas del 9:16 se
// desbordaban hasta la linea de tiempo, y no se acomodaban hasta tocarlos.
// CAUSA: solo se escuchaba 'resize' de la ventana, y plegar un panel NO
// dispara resize - la ventana mide lo mismo, lo que cambia es la grilla
// de adentro. Lo mismo pasa al arrastrar un divisor o al extender un
// lateral hasta abajo.
// SOLUCION: observar el tamaño REAL de los dos lienzos. Asi da igual que
// lo haya cambiado: ventana, panel plegado, divisor arrastrado o un modo
// nuevo que se agregue mañana.
let pendientePintar = null;
function repintarCapas() {
  // Coalescido a un cuadro: un arrastre de divisor dispara decenas de
  // avisos seguidos y no hace falta atender uno por uno.
  if (pendientePintar) return;
  pendientePintar = requestAnimationFrame(() => {
    pendientePintar = null;
    pintar916();
  });
}

window.addEventListener('resize', repintarCapas);

if (window.ResizeObserver) {
  const observador = new ResizeObserver(repintarCapas);
  if (visorLienzo) observador.observe(visorLienzo);
  if (lienzo916) observador.observe(lienzo916);
}

// Hasta que no hay metadata no se conoce el tamaño real del video, y sin
// eso rectImagen() no puede ubicar nada: al conocerlo hay que rehacer.
if (visorVideo) {
  visorVideo.addEventListener('loadedmetadata', () => pintar916(true));
}

// ============================================================
// PANELES LATERALES RETRAIBLES
// ============================================================
// Cada lateral se pliega con su boton en las puntas de la barra, para
// darle todo el ancho al visor cuando hace falta mirar el video en serio.
// Se colapsa la COLUMNA de la grilla (ancho 0), no el panel: asi el visor
// recupera el espacio de verdad en vez de quedar con un hueco.
// El estado se recuerda entre sesiones - si alguien trabaja siempre con
// un lateral cerrado, no tiene que volver a cerrarlo cada vez.
// Cada lateral tiene DOS botones: uno lo pliega, el otro lo extiende
// hasta abajo (y ahi la linea de tiempo se angosta en vez de quedar
// tapada, como en cualquier editor).
const LATERALES = [
  { boton: 'btnLatIzq', clase: 'sin-lat-izq', clave: 'clipforge.latIzq' },
  { boton: 'btnLatDer', clase: 'sin-lat-der', clave: 'clipforge.latDer' },
  { boton: 'btnIzqAbajo', clase: 'izq-abajo', clave: 'clipforge.izqAbajo' },
  { boton: 'btnDerAbajo', clase: 'der-abajo', clave: 'clipforge.derAbajo' }
];

function pintarLateral(cfg) {
  const plegado = document.body.classList.contains(cfg.clase);
  const b = $(cfg.boton);
  if (b) {
    b.classList.toggle('plegado', plegado);
    b.setAttribute('aria-pressed', String(plegado));
  }
}

LATERALES.forEach((cfg) => {
  // localStorage puede fallar (modo restringido); si pasa, se arranca
  // con los dos abiertos en vez de romper el arranque de la app.
  try {
    if (localStorage.getItem(cfg.clave) === 'plegado') document.body.classList.add(cfg.clase);
  } catch (e) { /* sin persistencia, no es critico */ }

  const b = $(cfg.boton);
  if (!b) return;
  b.addEventListener('click', () => {
    const plegado = document.body.classList.toggle(cfg.clase);
    try { localStorage.setItem(cfg.clave, plegado ? 'plegado' : 'abierto'); } catch (e) { /* idem */ }
    pintarLateral(cfg);
  });
  pintarLateral(cfg);
});

// ============================================================
// DIVISORES ARRASTRABLES
// ============================================================
// Los 3 divisores son celdas de la grilla, asi que redimensionar es solo
// cambiar una variable CSS: la grilla reacomoda todo lo demas sola. No
// hay que recalcular anchos de paneles ni avisarle a nadie.
//
// Los limites no son arbitrarios: un panel mas angosto que su contenido
// se ve roto, y una linea de tiempo de 60px no sirve para nada.
const DIVISORES = [
  { id: 'divIzq', varCss: '--lat-izq', eje: 'x', min: 180, max: 520, invertido: false, clave: 'clipforge.anchoIzq' },
  { id: 'divDer', varCss: '--lat-der', eje: 'x', min: 240, max: 560, invertido: true, clave: 'clipforge.anchoDer' },
  { id: 'divH', varCss: '--alto-timeline', eje: 'y', min: 120, max: 640, invertido: true, clave: 'clipforge.altoTimeline' }
];

function fijarMedida(cfg, px) {
  const v = Math.round(Math.max(cfg.min, Math.min(cfg.max, px)));
  document.body.style.setProperty(cfg.varCss, v + 'px');
  try { localStorage.setItem(cfg.clave, String(v)); } catch (e) { /* sin persistencia, no es critico */ }
}

DIVISORES.forEach((cfg) => {
  try {
    const guardado = parseInt(localStorage.getItem(cfg.clave), 10);
    if (guardado > 0) document.body.style.setProperty(cfg.varCss, Math.max(cfg.min, Math.min(cfg.max, guardado)) + 'px');
  } catch (e) { /* idem */ }

  const el = $(cfg.id);
  if (!el) return;

  el.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    el.classList.add('arrastrando');
    // Mientras se arrastra, el cursor manda en toda la ventana y se
    // bloquea la seleccion de texto: si no, arrastrar sobre un panel
    // selecciona su contenido y el gesto se siente roto.
    document.body.style.cursor = cfg.eje === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const mover = (e) => {
      // "invertido" = el panel crece cuando el mouse va hacia el borde
      // opuesto (el lateral derecho y la linea de tiempo miden desde el
      // borde derecho/inferior de la ventana, no desde el origen).
      const px = cfg.eje === 'x'
        ? (cfg.invertido ? window.innerWidth - e.clientX : e.clientX)
        : window.innerHeight - e.clientY;
      fijarMedida(cfg, px);
    };
    const soltar = () => {
      el.classList.remove('arrastrando');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  });

  // Doble clic = volver a la medida por defecto, sin tener que apuntar.
  el.addEventListener('dblclick', () => {
    document.body.style.removeProperty(cfg.varCss);
    try { localStorage.removeItem(cfg.clave); } catch (e) { /* idem */ }
  });
});

// ---------- Arranque ----------
renderKeys();
poblarKeysIA();
renderNube();
renderMedia();
mostrarInicio();
