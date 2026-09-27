// Tests de PISTAS UNIVERSALES y de donde aterriza el material (07/08/2026).
//
// PEDIDO DEL USER:
//   "no quiero que hayan espacios (dejando de lado los audios claro)
//    unicos para ciertos temas, porque sino sera muy incomodo trabajar,
//    las lineas de tiempo deberian ser de uso universal, permitiendo que
//    en una misma linea hayan fotos, videos, efectos"
//   "cuando uno sube un clip se deberia crear una nueva linea a la cual
//    interactuar, para que asi no tenga que hacer click a añadir una
//    nueva pista cada vez"
//
// Las dos reglas que estos tests cuidan, y que si se rompen NO dan error
// (solo material que desaparece sin aviso):
//   - poner material NUNCA tapa lo que ya estaba: si no hay lugar en
//     ninguna pista, se crea una;
//   - una pista visual acepta CUALQUIER material que no sea audio (video,
//     foto, lo que venga despues). El unico grupo separado es el audio,
//     como en DaVinci.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

// Montaje con una pista visual, una de audio y el material indicado.
function base(medias) {
  let m = M.crearMontaje();
  const ids = [];
  for (const med of medias) {
    let id;
    [m, id] = M.agregarMedia(m, { ruta: `/x/${med.nombre}`, ...med });
    ids.push(id);
  }
  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  return { m, ids, v1, a1 };
}

const visuales = (m) => m.pistas.filter((p) => p.tipo !== 'audio');
const clipsDe = (m, pistaId) => M.elementosDePista(m, pistaId).filter((e) => e.tipo === 'clip');

// ============================================================
// TRAMO LIBRE
// ============================================================

test('un tramo sin clips esta libre', () => {
  const { m, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  assert.ok(M.tramoLibre(m, v1, 0, 10));
});

test('un tramo con un clip encima NO esta libre', () => {
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.agregarAlFinal(m, v1, ids[0]);
  assert.ok(!M.tramoLibre(m, v1, 0, 10));
  assert.ok(!M.tramoLibre(m, v1, 9, 12), 'un solape parcial tampoco esta libre');
  assert.ok(M.tramoLibre(m, v1, 10, 20), 'despues del final si');
});

test('un hueco cuenta como libre', () => {
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.agregarAlFinal(m, v1, ids[0]);
  const el = clipsDe(m, v1)[0];
  m = M.borrar(m, v1, el.id);   // deja un hueco del mismo largo
  assert.ok(M.tramoLibre(m, v1, 0, 10), 'un vacio no es material: ahi entra algo');
});

// ============================================================
// DONDE ATERRIZA EL MATERIAL
// ============================================================

test('el primer material va a la pista que ya existe', () => {
  const { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  const [salida, info] = M.colocarMedia(m, ids[0], 0);
  assert.strictEqual(info.pistaId, v1);
  assert.strictEqual(visuales(salida).length, 1, 'no hacia falta crear ninguna');
});

test('si la pista esta ocupada se CREA una nueva en vez de tapar', () => {
  let { m, ids } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  let info;
  [m, info] = M.colocarMedia(m, ids[0], 0);
  const primera = info.pistaId;

  [m, info] = M.colocarMedia(m, ids[0], 0);   // mismo instante, no entra
  assert.notStrictEqual(info.pistaId, primera, 'tiene que ir a otra pista');
  assert.strictEqual(visuales(m).length, 2, 'se creo una pista');
  assert.strictEqual(clipsDe(m, primera).length, 1, 'el clip de antes sigue entero');
});

test('si hay lugar mas adelante en la misma pista, no se crea nada', () => {
  let { m, ids } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  let info;
  [m, info] = M.colocarMedia(m, ids[0], 0);
  const primera = info.pistaId;
  [m, info] = M.colocarMedia(m, ids[0], 20);   // despues del final
  assert.strictEqual(info.pistaId, primera);
  assert.strictEqual(visuales(m).length, 1);
  assert.strictEqual(clipsDe(m, primera).length, 2);
});

test('poner material NUNCA acorta lo que ya estaba', () => {
  let { m, ids } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const antes = M.duracionMontaje(m);
  const materialAntes = m.pistas.reduce((a, p) =>
    a + clipsDe(m, p.id).reduce((b, c) => b + c.duracion, 0), 0);

  [m] = M.colocarMedia(m, ids[0], 5);   // se solapa a medias
  const materialDespues = m.pistas.reduce((a, p) =>
    a + clipsDe(m, p.id).reduce((b, c) => b + c.duracion, 0), 0);

  assert.ok(materialDespues > materialAntes, 'entro material nuevo');
  assert.strictEqual(materialDespues, materialAntes + 10,
    `no se perdio nada: esperaba ${materialAntes + 10}, dio ${materialDespues}`);
  assert.strictEqual(materialAntes, 10, 'un video mudo no baja nada a la pista de audio');
  assert.ok(M.duracionMontaje(m) >= antes);
});

test('un video con sonido baja su audio a una pista de audio', () => {
  const { m, ids, a1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: true }]);
  const [salida, info] = M.colocarMedia(m, ids[0], 0);
  assert.strictEqual(info.pistaAudio, a1);
  assert.strictEqual(clipsDe(salida, a1).length, 1);
  const v = clipsDe(salida, info.pistaId)[0];
  const a = clipsDe(salida, a1)[0];
  assert.ok(v.vinculo && v.vinculo === a.vinculo, 'imagen y sonido quedan vinculados');
});

test('con la pista de audio ocupada se crea otra de audio, no una de video', () => {
  let { m, ids } = base([{ nombre: 'a', duracion: 10, tieneAudio: true }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  let info;
  [m, info] = M.colocarMedia(m, ids[0], 0);
  const p = M.pistaPorId(m, info.pistaAudio);
  assert.strictEqual(p.tipo, 'audio');
  assert.strictEqual(m.pistas.filter((x) => x.tipo === 'audio').length, 2);
});

test('el audio puro va a una pista de audio, no a una visual', () => {
  const { m, ids, a1 } = base([{ nombre: 'm', duracion: 8, tipo: 'audio' }]);
  const [, info] = M.colocarMedia(m, ids[0], 0);
  assert.strictEqual(info.pistaId, a1);
  assert.strictEqual(info.pistaAudio, null, 'no se duplica: ya ES audio');
});

test('con pista elegida a mano SI se sobrescribe (es otro gesto)', () => {
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  [m] = M.colocarMedia(m, ids[0], 0, { pistaId: v1 });
  assert.strictEqual(visuales(m).length, 1, 'pedir una pista concreta manda');
  assert.strictEqual(clipsDe(m, v1).length, 1, 'el de antes quedo tapado');
});

// ============================================================
// UNIVERSALIDAD: LA PISTA NO PREGUNTA QUE ES EL MATERIAL
// ============================================================

test('una foto y un video conviven en la MISMA pista', () => {
  let { m, ids, v1 } = base([
    { nombre: 'v.mp4', duracion: 10, tieneAudio: false },
    { nombre: 'f.jpg', duracion: 5, tipo: 'imagen' }
  ]);
  [m] = M.colocarMedia(m, ids[0], 0);
  [m] = M.colocarMedia(m, ids[1], 10);
  assert.strictEqual(visuales(m).length, 1, 'una foto no necesita su propia pista');
  const els = clipsDe(m, v1);
  assert.strictEqual(els.length, 2);
  assert.deepStrictEqual(els.map((e) => e.nombre), ['v.mp4', 'f.jpg']);
});

test('un material desconocido tambien entra en una pista visual', () => {
  const { m, ids, v1 } = base([{ nombre: 'x', duracion: 4, tipo: 'efecto' }]);
  const [, info] = M.colocarMedia(m, ids[0], 0);
  assert.strictEqual(info.pistaId, v1,
    'todo lo que no es audio es visual: la pista no filtra por tipo');
});

test('una foto se puede mover a cualquier pista visual', () => {
  let { m, ids } = base([{ nombre: 'f.jpg', duracion: 5, tipo: 'imagen' }]);
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  let info;
  [m, info] = M.colocarMedia(m, ids[0], 0);
  m = M.moverElemento(m, info.pistaId, info.clipId, 0, v2);
  assert.strictEqual(clipsDe(m, v2).length, 1);
});

test('un clip de imagen NO se puede mandar a una pista de audio', () => {
  let { m, ids, v1, a1 } = base([{ nombre: 'v.mp4', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const el = clipsDe(m, v1)[0];
  m = M.moverElemento(m, v1, el.id, 2, a1);
  assert.strictEqual(clipsDe(m, a1).length, 0, 'la imagen no baja al audio');
  assert.strictEqual(clipsDe(m, v1).length, 1, 'se queda en su pista');
  assert.ok(Math.abs(clipsDe(m, v1)[0].inicio - 2) < 1e-6, 'pero SI se corre en el tiempo');
});

// ============================================================
// SOLTAR EN UNA PISTA QUE TODAVIA NO EXISTE
// ============================================================
// BUG REPORTADO 07/08/2026: "no me deja arrastrar ningun clip de la
// linea de tiempo hacia arriba". Arrastrar entre pistas ya funcionaba,
// pero con una sola pista visual no habia NINGUNA arriba: no existia el
// destino. En DaVinci se arrastra mas alla de la ultima pista y la pista
// aparece sola; eso es lo que falta y lo que estos tests fijan.

test('mover a una pista nueva la crea y deja el clip ahi', () => {
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const el = clipsDe(m, v1)[0];

  const antes = visuales(m).length;
  m = M.moverAPistaNueva(m, v1, el.id, 4);

  assert.strictEqual(visuales(m).length, antes + 1, 'se creo una pista visual');
  assert.strictEqual(clipsDe(m, v1).length, 0, 'el clip ya no esta en la de origen');
  const nueva = visuales(m).find((p) => p.id !== v1 && clipsDe(m, p.id).length);
  assert.ok(nueva, 'el clip esta en la pista nueva');
  assert.ok(Math.abs(clipsDe(m, nueva.id)[0].inicio - 4) < 1e-6, 'y en el instante pedido');
});

test('la pista nueva sale del MISMO grupo que el origen', () => {
  let { m, ids, a1 } = base([{ nombre: 'm.mp3', duracion: 8, tipo: 'audio' }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const el = clipsDe(m, a1)[0];
  m = M.moverAPistaNueva(m, a1, el.id, 0);
  const nueva = m.pistas.find((p) => p.id !== a1 && clipsDe(m, p.id).length);
  assert.strictEqual(nueva.tipo, 'audio', 'un clip de audio no crea una pista de video');
});

test('crear pista y mover es UN solo cambio, no dos', () => {
  // Si fueran dos operaciones, el primer Ctrl+Z devolveria el clip pero
  // dejaria la pista vacia colgada.
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const el = clipsDe(m, v1)[0];

  let h = M.crearHistorial(m);
  h = M.registrar(h, M.moverAPistaNueva(h.presente, v1, el.id, 4));
  assert.strictEqual(visuales(h.presente).length, 2);

  h = M.deshacer(h);
  assert.strictEqual(visuales(h.presente).length, 1, 'un solo Ctrl+Z deja todo como estaba');
  assert.strictEqual(clipsDe(h.presente, v1).length, 1);
});

test('el clip no se pierde: sigue siendo el mismo material', () => {
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const el = clipsDe(m, v1)[0];
  m = M.moverAPistaNueva(m, v1, el.id, 4);
  const nueva = visuales(m).find((p) => clipsDe(m, p.id).length);
  const c = clipsDe(m, nueva.id)[0];
  assert.strictEqual(c.mediaId, el.mediaId);
  assert.strictEqual(c.usadoIn, el.usadoIn);
  assert.strictEqual(c.usadoOut, el.usadoOut);
});

test('un clip vinculado sube solo la imagen; el sonido se queda abajo', () => {
  let { m, ids, a1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: true }]);
  let info;
  [m, info] = M.colocarMedia(m, ids[0], 0);
  const el = clipsDe(m, info.pistaId)[0];
  m = M.moverAPistaNueva(m, info.pistaId, el.id, 3);

  assert.strictEqual(clipsDe(m, a1).length, 1, 'el audio sigue en su pista');
  assert.ok(Math.abs(clipsDe(m, a1)[0].inicio - 3) < 1e-6, 'pero se movio al mismo instante');
});

// ============================================================
// NOMBRE DE PISTA: AUTOMATICO PERO CAMBIABLE
// ============================================================

test('la pista se nombra sola pero el nombre se puede cambiar', () => {
  let { m, v1 } = base([]);
  assert.strictEqual(M.pistaPorId(m, v1).nombre, 'V1', 'el nombre automatico');
  m = M.actualizarPista(m, v1, { nombre: 'Cámara principal' });
  assert.strictEqual(M.pistaPorId(m, v1).nombre, 'Cámara principal');
});

test('cambiar el nombre no toca nada mas de la pista', () => {
  let { m, ids, v1 } = base([{ nombre: 'a', duracion: 10, tieneAudio: false }]);
  [m] = M.colocarMedia(m, ids[0], 0);
  const antes = clipsDe(m, v1).length;
  m = M.actualizarPista(m, v1, { nombre: 'Otra cosa' });
  assert.strictEqual(clipsDe(m, v1).length, antes);
  assert.strictEqual(M.pistaPorId(m, v1).visible, true);
});

test('el nombre automatico numera por grupo', () => {
  let m = M.crearMontaje();
  let a, b, c;
  [m, a] = M.agregarPista(m, 'video');
  [m, b] = M.agregarPista(m, 'audio');
  [m, c] = M.agregarPista(m, 'video');
  assert.strictEqual(M.pistaPorId(m, a).nombre, 'V1');
  assert.strictEqual(M.pistaPorId(m, b).nombre, 'A1');
  assert.strictEqual(M.pistaPorId(m, c).nombre, 'V2');
});
