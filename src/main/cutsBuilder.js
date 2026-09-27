// Combina segmentos de transcripcion + silencios detectados en un
// array de "bloques" (estructura sugerida por Gemini en el research
// guardado en CTX_PROYECTO_CLIPFORGE_1D.md seccion 5.4): cada bloque
// tiene {id, start, end, text, type, status}. El editor de aceptar/
// rechazar (renderer) trabaja puramente sobre este array; exportar
// solo relee su estado final, no vuelve a tocar ffmpeg/whisper.

const { fusionar: fusionarIntervalos, restar: restarIntervalos, duracion: duracionIntervalos } = require('./intervalos');

// Tolerancia para comparar tiempos en coma flotante: dividir un bloque en
// t y despues preguntar "¿este pedazo empieza en t?" puede fallar por un
// resto de 1e-16 si se compara con === o >=.
const EPS_CORTE = 1e-6;

function buildBlocks(segments, silences) {
  const blocks = [];
  let idCounter = 1;

  for (const seg of segments || []) {
    blocks.push({
      id: `b${idCounter++}`,
      start: seg.start,
      end: seg.end,
      text: seg.text || '',
      type: 'speech',
      // Si el motor (faster-whisper) ya la marco como posible alucinacion
      // (repeticion de palabra sospechosa), default a "cut".
      status: seg.posible_alucinacion ? 'cut' : 'keep'
    });
  }

  for (const sil of silences || []) {
    blocks.push({
      id: `b${idCounter++}`,
      start: sil.start,
      end: sil.end,
      text: `[silencio ${sil.duration}s]`,
      type: 'silence',
      // CAMBIO 05/08/2026 (pedido del user: "no me gusta que haya cortes
      // automaticos, quiero que sean opcionales"): antes los silencios
      // entraban ya CORTADOS, o sea que el video se recortaba solo sin que
      // nadie lo aprobara - en una grabacion de 59min eso eran 224 cortes
      // aplicados de una. Ahora entran como 'propuesta': se ven marcados,
      // pero NO se descuentan de la exportacion hasta que el user los
      // acepte (exportPlan.js ya trata 'propuesta' como material que se
      // conserva, ver su cabecera).
      status: 'propuesta'
    });
  }

  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

// CORREGIDO 04/08/2026: antes esto SUMABA la duracion de cada bloque
// cortado por separado. Como los bloques de silencio se solapan con los
// de habla (buildBlocks los agrega como dos analisis independientes del
// mismo audio, no como una particion), el solape se contaba dos veces:
// el "% eliminado" salia inflado y en videos con muchos silencios cortos
// llegaba a pasar el 100%, con "metraje resultante" negativo o en 0.
// Ahora se fusionan los intervalos cortados y se restan del total, que es
// la misma cuenta que usa el plan de exportacion (intervalos.js) - asi el
// numero que muestra la interfaz coincide con lo que realmente sale.
function summarize(blocks) {
  const totalDuration = blocks.reduce((acc, b) => Math.max(acc, b.end || 0), 0);
  const cortados = blocks
    .filter((b) => b.status === 'cut')
    .map((b) => [Math.max(0, b.start || 0), Math.max(0, b.end || 0)]);
  const cutDuration = duracionIntervalos(fusionarIntervalos(cortados));
  const keptDuration = Math.max(0, totalDuration - cutDuration);
  const cutCount = blocks.filter((b) => b.status === 'cut').length;
  return {
    totalBlocks: blocks.length,
    cutCount,
    totalDurationSec: Math.round(totalDuration * 10) / 10,
    keptDurationSec: Math.round(keptDuration * 10) / 10,
    porcentajeEliminado: totalDuration > 0 ? Math.round((cutDuration / totalDuration) * 1000) / 10 : 0
  };
}

// ============================================================
// CORTE MANUAL SOBRE LA LINEA DE TIEMPO (05/08/2026)
// ============================================================
// Pedido del user: poder cortar partes del video directo en la linea de
// tiempo, como en cualquier editor, sin depender de marcar bloques de
// transcripcion.
//
// DECISION DE DISEÑO: en vez de inventar un estado nuevo de "cortes
// manuales" (que habria obligado a tocar exportPlan.js, el resumen y el
// remapeo del SRT), un corte manual se expresa en el MISMO modelo de
// bloques que ya existe: se parten los bloques en los bordes del rango y
// los de adentro pasan a status 'cut'. Asi la exportacion, el SRT y el
// "% eliminado" funcionan sin cambiarles una linea - ya saben tratar
// bloques cortados.
//
// EL DETALLE QUE OBLIGA A RELLENAR HUECOS: los bloques NO particionan la
// linea de tiempo. buildBlocks() mezcla habla y silencios, que son dos
// analisis independientes del mismo audio: se solapan entre si y pueden
// dejar tramos sin ningun bloque encima. Si el user corta justo sobre un
// hueco asi, marcar "los bloques de adentro" no cortaria nada (no hay
// ninguno). Por eso cortarRango() rellena lo que quede descubierto con
// bloques 'manual' propios.

// Generador de ids que no chocan con los ya usados, incluyendo los que se
// van creando dentro de la misma operacion.
function crearGeneradorId(blocks) {
  const usados = new Set(blocks.map((b) => b.id));
  return (prefijo) => {
    let n = 1;
    while (usados.has(`${prefijo}${n}`)) n++;
    const id = `${prefijo}${n}`;
    usados.add(id);
    return id;
  };
}

// Reparte el texto de un bloque entre sus 2 mitades al partirlo.
// Es una APROXIMACION deliberada: sin timestamps por palabra no hay forma
// de saber que palabra se dijo exactamente en el instante del corte, asi
// que se reparte por cantidad de palabras en proporcion al tiempo. Los
// tiempos quedan exactos (que es lo que importa para el video); el texto
// puede quedar corrido una palabra en el subtitulo del bloque partido.
function partirTexto(texto, ratio) {
  const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return ['', ''];
  const corte = Math.min(palabras.length, Math.max(0, Math.round(palabras.length * ratio)));
  return [palabras.slice(0, corte).join(' '), palabras.slice(corte).join(' ')];
}

function etiquetaBloque(b) {
  // Un silencio lleva su duracion en el texto - al partirlo hay que
  // recalcularla, si no queda diciendo la duracion del bloque original.
  if (b.type === 'silence') return `[silencio ${Math.round((b.end - b.start) * 100) / 100}s]`;
  return b.text;
}

// Parte en 2 todo bloque que CRUCE el instante t. Los que empiezan o
// terminan justo en t (o no lo tocan) quedan intactos.
function dividirEnTiempo(blocks, t) {
  const genId = crearGeneradorId(blocks);
  const salida = [];
  for (const b of blocks) {
    if (!(b.start < t - EPS_CORTE && t < b.end - EPS_CORTE)) { salida.push(b); continue; }
    const ratio = (t - b.start) / (b.end - b.start);
    const [txtA, txtB] = partirTexto(b.text, ratio);
    const a = { ...b, end: t, text: txtA };
    const c = { ...b, id: genId('p'), start: t, text: txtB };
    salida.push({ ...a, text: etiquetaBloque(a) });
    salida.push({ ...c, text: etiquetaBloque(c) });
  }
  salida.sort((x, y) => x.start - y.start);
  return salida;
}

function dentroDelRango(b, inicio, fin) {
  return b.start >= inicio - EPS_CORTE && b.end <= fin + EPS_CORTE;
}

// Marca [inicio,fin] como cortado: parte los bloques que cruzan los
// bordes, pone en 'cut' los que quedan adentro, y cubre con bloques
// 'manual' cualquier tramo que no tuviera ningun bloque encima.
function cortarRango(blocks, inicio, fin) {
  if (!(fin > inicio + EPS_CORTE)) return blocks;
  let salida = dividirEnTiempo(blocks, inicio);
  salida = dividirEnTiempo(salida, fin);
  salida = salida.map((b) => (dentroDelRango(b, inicio, fin) ? { ...b, status: 'cut' } : b));

  const cubierto = fusionarIntervalos(
    salida.filter((b) => dentroDelRango(b, inicio, fin)).map((b) => [b.start, b.end])
  );
  const huecos = restarIntervalos([[inicio, fin]], cubierto);
  if (huecos.length) {
    const genId = crearGeneradorId(salida);
    for (const [s, e] of huecos) {
      if (e - s <= EPS_CORTE) continue;
      salida.push({ id: genId('m'), start: s, end: e, text: '[corte manual]', type: 'manual', status: 'cut' });
    }
    salida.sort((x, y) => x.start - y.start);
  }
  return salida;
}

// Deshace un corte sobre [inicio,fin]: saca los bloques 'manual' de ese
// tramo y devuelve a 'keep' todo lo que quede adentro (incluidos los
// silencios, que vienen cortados por defecto - si el user pide restaurar
// explicitamente un rango, quiere ver el video completo ahi).
function restaurarRango(blocks, inicio, fin) {
  if (!(fin > inicio + EPS_CORTE)) return blocks;
  let salida = dividirEnTiempo(blocks, inicio);
  salida = dividirEnTiempo(salida, fin);
  salida = salida.filter((b) => !(b.type === 'manual' && dentroDelRango(b, inicio, fin)));
  return salida.map((b) => (dentroDelRango(b, inicio, fin) ? { ...b, status: 'keep' } : b));
}

// --- Manejo en bloque de las SUGERENCIAS (05/08/2026) ---
// Una sugerencia (status 'propuesta') es un corte propuesto que todavia
// no se aplico: se ve marcado en la interfaz pero no afecta al video
// exportado. Las genera la deteccion de silencios y el analisis con IA.

function contarSugerencias(blocks) {
  return blocks.filter((b) => b.status === 'propuesta').length;
}

// "Aceptar todas": las propuestas pasan a corte real.
function aplicarSugerencias(blocks) {
  return blocks.map((b) => (b.status === 'propuesta' ? { ...b, status: 'cut' } : b));
}

// "Descartar todas": las propuestas vuelven a material conservado.
function descartarSugerencias(blocks) {
  return blocks.map((b) => (b.status === 'propuesta' ? { ...b, status: 'keep' } : b));
}

// Convierte a sugerencia los silencios que quedaron CORTADOS de antes.
// Existe para los proyectos guardados antes del cambio de arriba, que
// tienen los silencios ya aplicados: sin esto, un proyecto viejo seguiria
// con sus 224 cortes automaticos puestos y no habria forma de revisarlos
// uno por uno. Solo toca silencios - un corte manual o una propuesta de
// IA ya aceptada por el user no se desarma sola.
function silenciosASugerencias(blocks) {
  return blocks.map((b) => (b.type === 'silence' && b.status === 'cut' ? { ...b, status: 'propuesta' } : b));
}

function fmtSrtTime(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t - Math.floor(t)) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

function blocksToSrt(blocks) {
  const kept = blocks.filter((b) => b.type === 'speech' && b.status === 'keep' && b.text.trim());
  return kept.map((b, i) => {
    return `${i + 1}\n${fmtSrtTime(b.start)} --> ${fmtSrtTime(b.end)}\n${b.text.trim()}\n`;
  }).join('\n');
}

function blocksToCutsJson(blocks) {
  return {
    generado: new Date().toISOString(),
    resumen: summarize(blocks),
    bloques: blocks
  };
}

// "00:01:23" (sin milisegundos, para texto legible - distinto de
// fmtSrtTime que necesita precision para subtitulos).
function fmtTiempoLegible(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Transcripcion en texto plano, con marca de tiempo antes de cada
// bloque (pedido 05/08/2026, distinto del SRT: sin numeros de cue ni
// formato de subtitulo, pensado para leer/copiar-pegar, no para
// reproductor de video).
// soloKeep=true  -> solo lo que queda en el video final (excluye 'cut';
//                   'propuesta' SI se incluye porque todavia no esta
//                   cortado de verdad, mismo criterio que
//                   rangosConservados() de exportPlan.js).
// soloKeep=false -> TODO lo que se dijo en la grabacion completa,
//                   incluidas las partes marcadas para cortar.
// En ambos casos se excluyen los bloques type='silence' (no son texto
// hablado, son huecos detectados por ffmpeg).
function blocksToTranscriptText(blocks, { soloKeep = true } = {}) {
  const filtrados = (blocks || [])
    .filter((b) => b.type === 'speech' && b.text && b.text.trim())
    .filter((b) => soloKeep ? b.status !== 'cut' : true);
  const encabezado = soloKeep
    ? 'Transcripcion (solo lo que queda en el video final)'
    : 'Transcripcion completa (incluye partes marcadas para cortar)';
  const cuerpo = filtrados
    .map((b) => `[${fmtTiempoLegible(b.start)}] ${b.text.trim()}`)
    .join('\n\n');
  return `${encabezado}\nGenerado: ${new Date().toISOString()}\n\n${cuerpo}\n`;
}

// Texto plano CONTINUO de todo lo transcrito (pedido 05/08/2026): sin
// marcas de tiempo, sin encabezado, sin numeros de cue - solo lo que se
// dijo, en orden, para copiar/pegar directo a otro lado (un doc, un
// resumen con IA aparte, etc.). A diferencia de blocksToTranscriptText,
// esta variante NO filtra por status (incluye tanto 'keep' como 'cut'
// como 'propuesta') porque el pedido es "todo lo que tradujo", no una
// version editada segun los cortes - si mas adelante hace falta una
// version filtrada sin tiempos, agregar un parametro soloKeep aca mismo
// siguiendo el mismo patron que blocksToTranscriptText.
function blocksToPlainText(blocks) {
  return (blocks || [])
    .filter((b) => b.type === 'speech' && b.text && b.text.trim())
    .map((b) => b.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() + '\n';
}

// PUENTE CON EL MONTAJE (tanda H, paso 11): los rangos que el user marco
// como 'cut', en tiempo del ARCHIVO. `desplazamiento` es el disponibleIn
// del material (un archivo con timecode no arranca en 0 y los bloques de
// whisper si). Las 'propuesta' NO entran: no estan aceptadas, mismo
// criterio que rangosConservados() de exportPlan.js.
function rangosCortados(blocks, desplazamiento = 0) {
  return (blocks || [])
    .filter((b) => b.status === 'cut' && isFinite(b.start) && isFinite(b.end) && b.end - b.start > EPS_CORTE)
    .map((b) => [b.start + desplazamiento, b.end + desplazamiento]);
}

module.exports = {
  rangosCortados,
  buildBlocks, summarize, blocksToSrt, blocksToCutsJson,
  blocksToTranscriptText, blocksToPlainText,
  // --- corte manual en la linea de tiempo (05/08/2026) ---
  dividirEnTiempo, cortarRango, restaurarRango,
  // --- sugerencias de corte (05/08/2026) ---
  contarSugerencias, aplicarSugerencias, descartarSugerencias, silenciosASugerencias
};
