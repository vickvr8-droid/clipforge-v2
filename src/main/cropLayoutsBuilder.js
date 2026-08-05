// cropLayoutsBuilder.js
//
// Modelo de datos NUEVO (29/07/2026, reemplaza el modelo de "tramos"):
// cada recuadro (clip 9:16) tiene su PROPIO rango de tiempo (start/end)
// y una pista (track, 0-based) - independiente de los demas. El video
// puede tener 0, 1 o varios clips activos en un mismo instante (se
// apilan en el visor 9:16 segun su "track", track 0 arriba). Las
// pistas son dinamicas: no hay limite fijo, se crean/desaparecen segun
// el track mas alto que este en uso.
//
// Funciones puras sobre datos planos, sin dependencia de Electron -
// mismo patron que cutsBuilder.js.

let idCounter = 1;
function nuevoId(prefijo) {
  return `${prefijo}${Date.now()}_${idCounter++}`;
}

function crearClipsInicial() {
  return [];
}

// Clips activos en el instante t, ordenados por track ascendente
// (track 0 primero = arriba en el visor 9:16 / en el overlay del
// visor principal).
function clipsEnInstante(clips, t) {
  return clips
    .filter((c) => t >= c.start && t < c.end)
    .sort((a, b) => a.track - b.track);
}

function getClipPorId(clips, id) {
  return clips.find((c) => c.id === id) || null;
}

// Crea un clip nuevo en el instante t, con duracion por defecto
// (3s, recortada a la duracion real si hace falta) y en la primera
// pista libre en ese instante (no pisa a otro clip ya puesto ahi).
function crearClipNuevo(clips, { t, duracionTotal, xPct, yPct, wPct, hPct }) {
  const DUR_DEFAULT = 3;
  const start = Math.max(0, t);
  const end = Math.min(duracionTotal || start + DUR_DEFAULT, start + DUR_DEFAULT);
  let track = 0;
  const ocupadas = clips.filter((c) => start < c.end && end > c.start).map((c) => c.track);
  while (ocupadas.includes(track)) track++;
  const nuevo = { id: nuevoId('c'), start, end, track, xPct, yPct, wPct, hPct };
  return [...clips, nuevo];
}

// Actualiza cualquier subconjunto de campos de un clip (start/end/track/
// posicion) - usado tanto por el arrastre en la linea de tiempo (start/
// end/track) como por el arrastre/resize sobre el video (xPct/yPct/
// wPct/hPct).
function actualizarClip(clips, id, cambios) {
  return clips.map((c) => (c.id === id ? { ...c, ...cambios } : c));
}

function eliminarClip(clips, id) {
  return clips.filter((c) => c.id !== id);
}

// Pase de sanidad: recorta clips que se pasan del final real del video
// (una vez que <video> confirma loadedmetadata), descarta clips de
// duracion <= 0, y renumera tracks para que no queden "huecos" (ej. si
// el unico clip de track 2 se borro, y quedan tracks 0 y 3 usados, pasa
// a ser 0 y 1) - evita que la timeline muestre filas vacias de mas.
function normalizarClips(clips, duracionTotal) {
  const recortados = clips
    .map((c) => ({ ...c, end: Math.min(c.end, duracionTotal) }))
    .filter((c) => c.end - c.start > 0.05);
  const tracksUsados = [...new Set(recortados.map((c) => c.track))].sort((a, b) => a - b);
  const mapaTracks = new Map(tracksUsados.map((t, i) => [t, i]));
  return recortados.map((c) => ({ ...c, track: mapaTracks.get(c.track) }));
}

// Migracion desde el modelo VIEJO de "tramos" (cada tramo con su propio
// array de recuadros compartiendo start/end) a clips independientes -
// para que un proyecto.json guardado antes del 29/07/2026 (formato
// viejo) no rompa la app al reabrirlo. Detecta el formato viejo por la
// presencia del campo "recuadros" (array) en cada elemento.
function migrarDesdeTramosViejo(tramos) {
  if (!Array.isArray(tramos) || !tramos.length) return [];
  const esFormatoViejo = tramos[0] && Array.isArray(tramos[0].recuadros);
  if (!esFormatoViejo) return tramos; // ya es formato nuevo (array de clips), no tocar
  const clips = [];
  for (const tramo of tramos) {
    tramo.recuadros.forEach((r, i) => {
      clips.push({
        id: nuevoId('c'),
        start: tramo.start,
        end: tramo.end,
        track: i,
        xPct: r.xPct, yPct: r.yPct, wPct: r.wPct, hPct: r.hPct
      });
    });
  }
  return clips;
}

// Segmentos [start,end,cubierto:boolean] para pintar la franja roja/
// verde de cobertura (rojo = ningun clip activo, verde = 1+) - fusiona
// los rangos de todos los clips (union de intervalos) en vez de
// depender de "tramos".
function segmentosCobertura(clips, duracionTotal) {
  if (!clips.length) return [{ start: 0, end: duracionTotal, cubierto: false }];
  const puntos = new Set([0, duracionTotal]);
  clips.forEach((c) => { puntos.add(Math.max(0, c.start)); puntos.add(Math.min(duracionTotal, c.end)); });
  const ordenados = [...puntos].sort((a, b) => a - b);
  const segmentos = [];
  for (let i = 0; i < ordenados.length - 1; i++) {
    const s = ordenados[i], e = ordenados[i + 1];
    if (e - s <= 0.001) continue;
    const cubierto = clips.some((c) => c.start <= s && c.end >= e);
    segmentos.push({ start: s, end: e, cubierto });
  }
  return segmentos;
}

function clipsToJson(clips) {
  return {
    generado: new Date().toISOString(),
    clips: clips.map(({ start, end, track, xPct, yPct, wPct, hPct }) => ({ start, end, track, xPct, yPct, wPct, hPct }))
  };
}

// ============================================================
// DISPOSICION DE CELDAS DEL VISOR 9:16 (30/07/2026, pedido del user:
// poder elegir como se acomodan 2+ recuadros activos en el visor 9:16,
// hoy siempre apilados en vertical y en partes iguales)
// ============================================================
// Arbol de "cortes" tipo tiling (mismo concepto que i3/tmux/Blender):
// - hoja: { tipo:'hoja', pos } -> pos = orden 0..n-1 (que clip activo,
//   ordenado por track ascendente, va en esa celda).
// - corte: { tipo:'corte', dir:'fila'|'columna', ratio, a, b } -> 'fila'
//   pone a a ARRIBA de b, 'columna' pone a a la IZQUIERDA de b. ratio =
//   fraccion 0..1 de espacio para "a".
// Por construccion, un arbol asi SIEMPRE cubre el 100% del area sin
// huecos ni superposiciones, sin importar los ratios ni cuantos cortes
// tenga - a diferencia de un modelo de rectangulos sueltos, aca es
// geometricamente imposible que quede un pixel vacio.

function hojaLayout(pos) { return { tipo: 'hoja', pos }; }
function corteLayout(dir, ratio, a, b) { return { tipo: 'corte', dir, ratio, a, b }; }

// Arma una fila/columna de n hojas consecutivas (desde "desde"), todas
// del mismo tamaño - cada corte reparte 1/restantes para "a", lo que da
// partes exactamente iguales sin importar cuantas queden.
function _apilar(dir, n, desde) {
  if (n <= 1) return hojaLayout(desde);
  return corteLayout(dir, 1 / n, hojaLayout(desde), _apilar(dir, n - 1, desde + 1));
}

// Combina varios sub-arboles ya armados en una columna/fila (usado por
// el modo grid para apilar filas completas, cada una de ancho variable
// si la ultima fila no se completa).
function _combinar(dir, arboles) {
  if (arboles.length === 1) return arboles[0];
  const [primero, ...resto] = arboles;
  return corteLayout(dir, 1 / arboles.length, primero, _combinar(dir, resto));
}

function _grid(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const filas = [];
  let pos = 0;
  while (pos < n) {
    const enEstaFila = Math.min(cols, n - pos);
    filas.push(_apilar('columna', enEstaFila, pos));
    pos += enEstaFila;
  }
  return _combinar('fila', filas);
}

// Arbol por defecto para n celdas activas, en 3 modos:
// - 'vertical' (comportamiento historico/actual): apiladas de arriba a
//   abajo, todas del mismo alto.
// - 'horizontal': una al lado de la otra, todas del mismo ancho.
// - 'grid': cuadricula lo mas parecida a cuadrada posible.
function layoutPorDefecto(n, modo = 'vertical') {
  if (n <= 0) return null;
  if (modo === 'libre') return layoutLibre(n);
  if (n === 1) return hojaLayout(0);
  if (modo === 'horizontal') return _apilar('columna', n, 0);
  if (modo === 'grid') return _grid(n);
  return _apilar('fila', n, 0);
}

// Arma un arbol de n hojas TODAS marcadas "libre" (posicion/tamaño
// manual, independiente entre si) - modo pedido por el user 30/07/2026:
// poder mover un recuadro del 9:16 a cualquier lado, no solo agrandar/
// achicar contra su vecino. Se usa una estructura lineal solo para que
// contarHojas/otros helpers sigan funcionando - lo que importa es que
// cada hoja trae su propio rect en "libre", calcularLayout lo respeta
// en vez de calcular la posicion contra el padre. Cascada diagonal
// inicial (no todas apiladas exacto una sobre otra) para que se vean
// distintas al activar el modo por primera vez.
function layoutLibre(n) {
  if (n <= 0) return null;
  const w = 0.55, h = 0.32;
  const hojaLibreI = (i) => ({
    tipo: 'hoja', pos: i,
    libre: { x: Math.min(1 - w, i * 0.08), y: Math.min(1 - h, i * 0.12), w, h }
  });
  if (n === 1) return hojaLibreI(0);
  let nodo = hojaLibreI(n - 1);
  for (let i = n - 2; i >= 0; i--) nodo = corteLayout('fila', 0.5, hojaLibreI(i), nodo);
  return nodo;
}

function contarHojas(tree) {
  if (!tree) return 0;
  return tree.tipo === 'hoja' ? 1 : contarHojas(tree.a) + contarHojas(tree.b);
}

// Recorre el arbol y devuelve las celdas finales (rects 0..1 relativos
// al contenedor completo) + los "divisores" (la linea entre 2 hermanos
// de cada corte, para poder dibujar una manija de arrastre ahi). "path"
// identifica cada nodo de corte como una lista de 'a'/'b' desde la raiz
// - se usa despues para actualizar el ratio de ESE corte puntual.
function calcularLayout(tree, x = 0, y = 0, w = 1, h = 1, path = []) {
  if (!tree) return { celdas: [], divisores: [] };
  if (tree.tipo === 'hoja') {
    // Celda "libre" (30/07/2026): ignora la posicion calculada por el
    // padre y usa su propio rect manual - permite moverla a cualquier
    // lado, incluso superponiendo a otras, sin afectar al resto del
    // arbol (que sigue existiendo pero no se usa para dibujarla).
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
  const ra = calcularLayout(tree.a, rectA.x, rectA.y, rectA.w, rectA.h, [...path, 'a']);
  const rb = calcularLayout(tree.b, rectB.x, rectB.y, rectB.w, rectB.h, [...path, 'b']);
  const divisor = {
    path,
    dir: tree.dir,
    x: tree.dir === 'columna' ? rectA.x + rectA.w : x,
    y: tree.dir === 'fila' ? rectA.y + rectA.h : y
  };
  return { celdas: [...ra.celdas, ...rb.celdas], divisores: [divisor, ...ra.divisores, ...rb.divisores] };
}

// Devuelve el rect (0..1) del NODO en "path" (su area completa, antes de
// aplicar su propio corte) - lo necesita el arrastre de un divisor para
// saber contra que rectangulo convertir la posicion del mouse en ratio.
function rectDelNodo(tree, path, x = 0, y = 0, w = 1, h = 1) {
  if (!path.length || !tree) return { x, y, w, h };
  const [paso, ...resto] = path;
  if (tree.dir === 'fila') {
    const hA = h * tree.ratio;
    return paso === 'a'
      ? rectDelNodo(tree.a, resto, x, y, w, hA)
      : rectDelNodo(tree.b, resto, x, y + hA, w, h - hA);
  }
  const wA = w * tree.ratio;
  return paso === 'a'
    ? rectDelNodo(tree.a, resto, x, y, wA, h)
    : rectDelNodo(tree.b, resto, x + wA, y, w - wA, h);
}

function nodoEnPath(tree, path) {
  let nodo = tree;
  for (const paso of path) nodo = nodo && nodo[paso];
  return nodo;
}

// Cambia el ratio de UN corte puntual (identificado por su path), con
// limite 10%-90% para que nunca se pueda achicar una celda a la nada
// arrastrando de mas.
function actualizarRatioEnPath(tree, path, nuevoRatio) {
  const limitado = Math.min(0.9, Math.max(0.1, nuevoRatio));
  if (!path.length) return { ...tree, ratio: limitado };
  const [paso, ...resto] = path;
  return { ...tree, [paso]: actualizarRatioEnPath(tree[paso], resto, limitado) };
}

// Boton "Distribuir parejo" (pedido del user: que un hueco/desproporcion
// se rellene con lo de alrededor). Como el arbol de cortes YA garantiza
// que no hay huecos por construccion, "distribuir" en la practica
// significa: recalcular el ratio de CADA corte para que todas las hojas
// terminen con exactamente la misma area, sin importar cuantos cortes
// manuales haya hecho el user antes ni que tan desbalanceado haya
// quedado el arbol - el ratio de cada corte pasa a ser
// (hojas del lado a) / (hojas totales de ese corte).
const MIN_LIBRE = 0.08; // tamaño minimo de una celda libre (8% del panel 9:16)

// Mueve una celda "libre" a una posicion x/y nueva (0..1), clampeado
// para que no se salga del panel 9:16 - conserva su w/h actual.
function moverCeldaLibre(tree, pos, xPct, yPct) {
  if (!tree) return tree;
  if (tree.tipo === 'hoja') {
    if (tree.pos !== pos || !tree.libre) return tree;
    const { w, h } = tree.libre;
    const x = Math.min(Math.max(0, 1 - w), Math.max(0, xPct));
    const y = Math.min(Math.max(0, 1 - h), Math.max(0, yPct));
    return { ...tree, libre: { ...tree.libre, x, y } };
  }
  return { ...tree, a: moverCeldaLibre(tree.a, pos, xPct, yPct), b: moverCeldaLibre(tree.b, pos, xPct, yPct) };
}

// Redimensiona una celda "libre" arrastrando una esquina ('tl'/'tr'/
// 'bl'/'br') - mismo criterio que el arrastre de esquina de los
// recuadros del visor 16:9: se fija la esquina OPUESTA y se recalcula
// x/y/w/h en base a donde esta el mouse ahora, con un minimo de tamaño.
function redimensionarCeldaLibre(tree, pos, esquina, xPct, yPct) {
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
    let w = Math.max(MIN_LIBRE, x2 - x);
    let h = Math.max(MIN_LIBRE, y2 - y);
    if (x + w > 1) x = 1 - w;
    if (y + h > 1) y = 1 - h;
    return { ...tree, libre: { x, y, w, h } };
  }
  return { ...tree, a: redimensionarCeldaLibre(tree.a, pos, esquina, xPct, yPct), b: redimensionarCeldaLibre(tree.b, pos, esquina, xPct, yPct) };
}

// "Distribuir parejo" en modo libre no tiene sentido geometrico (no hay
// nocion de "area total repartida"), asi que directamente saca el
// modo libre de cada hoja - vuelve al tiling normal, uniforme, mismo
// comportamiento que ya tenia el boton para los otros 3 presets.
function distribuirProporcional(tree) {
  if (!tree) return tree;
  if (tree.tipo === 'hoja') {
    if (!tree.libre) return tree;
    const { libre, ...resto } = tree;
    return resto;
  }
  const a = distribuirProporcional(tree.a);
  const b = distribuirProporcional(tree.b);
  const nA = contarHojas(a);
  const nB = contarHojas(b);
  return { ...tree, ratio: nA / (nA + nB), a, b };
}

module.exports = {
  crearClipsInicial,
  clipsEnInstante,
  getClipPorId,
  crearClipNuevo,
  actualizarClip,
  eliminarClip,
  normalizarClips,
  migrarDesdeTramosViejo,
  segmentosCobertura,
  clipsToJson,
  // --- disposicion de celdas 9:16 (30/07/2026) ---
  hojaLayout,
  corteLayout,
  layoutPorDefecto,
  contarHojas,
  calcularLayout,
  rectDelNodo,
  nodoEnPath,
  actualizarRatioEnPath,
  distribuirProporcional,
  moverCeldaLibre,
  redimensionarCeldaLibre
};
