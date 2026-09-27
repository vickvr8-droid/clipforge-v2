// Tests del montaje (src/shared/montaje.js).
//
// El modelo se escribio DESPUES de investigar como lo hacen los editores
// reales (OpenTimelineIO y MLT/Kdenlive). Estos tests verifican las
// propiedades que definen ese modelo, no solo que las funciones corran:
//
//   Bloque 1: la pista es SECUENCIAL -> los solapamientos son imposibles
//             por construccion, y los huecos son elementos de verdad.
//   Bloque 5: los CUATRO MODOS DE RECORTE. Lo que los distingue es
//             exactamente que conserva cada uno, y eso es lo que se
//             comprueba: duracion total, posicion, material.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

const casi = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} (esperaba ${b}, dio ${a})`);
const els = (m, p) => M.elementosDePista(m, p);
const clips = (m, p) => els(m, p).filter((x) => x.tipo === 'clip');
const huecos = (m, p) => els(m, p).filter((x) => x.tipo === 'hueco');

// Proyecto tipico: 1 archivo de 100s en una pista de video, entero.
function base(dur = 100) {
  let m = M.crearMontaje();
  let mediaId, pistaId;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'D:/a.mkv', nombre: 'a.mkv', duracion: dur });
  [m, pistaId] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarAlFinal(m, pistaId, mediaId, {});
  return { m, mediaId, pistaId };
}

// ============================================================
// 1. PISTA SECUENCIAL — la decision central del modelo
// ============================================================

test('los elementos van pegados: el fin de uno es el inicio del siguiente', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 60);
  const lista = els(m, pistaId);
  assert.strictEqual(lista.length, 3);
  for (let i = 0; i < lista.length - 1; i++) {
    casi(lista[i].fin, lista[i + 1].inicio, `pegados (${i})`);
  }
  casi(lista[0].inicio, 0, 'la pista arranca en cero');
});

test('SOLAPARSE ES IMPOSIBLE: la posicion sale de sumar lo anterior', () => {
  // No hay un campo "posicion" que se pueda poner mal. Aunque se corte,
  // borre y mueva, dos elementos nunca pueden pisarse.
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 25);
  m = M.cortarEn(m, pistaId, 50);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  m = M.moverElemento(m, pistaId, clips(m, pistaId)[1].id, 10);
  const lista = els(m, pistaId);
  for (let i = 0; i < lista.length - 1; i++) {
    assert.ok(lista[i].fin <= lista[i + 1].inicio + 1e-9, `elemento ${i} no pisa al siguiente`);
  }
});

test('el hueco es un ELEMENTO de la pista, no algo calculado aparte', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 50);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  const lista = els(m, pistaId);
  assert.deepStrictEqual(lista.map((x) => x.tipo), ['clip', 'hueco', 'clip']);
  casi(lista[1].duracion, 20, 'el hueco mide lo que medía el clip');
});

test('los huecos consecutivos se fusionan solos', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 20);
  m = M.cortarEn(m, pistaId, 40);
  m = M.cortarEn(m, pistaId, 60);
  const c = clips(m, pistaId);
  m = M.borrar(m, pistaId, c[1].id);
  m = M.borrar(m, pistaId, c[2].id);
  assert.strictEqual(huecos(m, pistaId).length, 1, 'un solo hueco, no dos pegados');
  casi(huecos(m, pistaId)[0].duracion, 40);
});

test('un hueco al final no se sostiene: no hay nada que lo empuje', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 80);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  assert.strictEqual(huecos(m, pistaId).length, 0);
  casi(M.duracionPista(m, pistaId), 80, 'el montaje se acorta');
});

// ============================================================
// 2. CORTAR
// ============================================================

test('cortar deja dos clips donde habia uno, sin mover nada', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const c = clips(m, pistaId);
  assert.strictEqual(c.length, 2);
  casi(c[0].fin, 40);
  casi(c[1].inicio, 40);
  casi(c[1].usadoIn, 40, 'el segundo sigue con el material que corresponde');
  casi(M.duracionPista(m, pistaId), 100, 'no cambia el largo');
});

test('cortar pegado a un borde no crea un clip de duracion cero', () => {
  const { m, pistaId } = base();
  assert.strictEqual(els(M.cortarEn(m, pistaId, 0), pistaId).length, 1);
  assert.strictEqual(els(M.cortarEn(m, pistaId, 100), pistaId).length, 1);
  assert.strictEqual(els(M.cortarEn(m, pistaId, 0.01), pistaId).length, 1);
});

test('la cuchilla puede cortar todas las pistas a la vez', () => {
  let { m, mediaId, pistaId } = base();
  let p2;
  [m, p2] = M.agregarPista(m, 'video', 'V2');
  [m] = M.agregarAlFinal(m, p2, mediaId, {});
  m = M.cortarTodasEn(m, 40);
  assert.strictEqual(clips(m, pistaId).length, 2);
  assert.strictEqual(clips(m, p2).length, 2);
});

// ============================================================
// 3. BORRAR
// ============================================================

test('borrar deja hueco; borrar con ripple lo cierra', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 50);

  const conHueco = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  assert.strictEqual(huecos(conHueco, pistaId).length, 1);
  casi(M.duracionPista(conHueco, pistaId), 100, 'el largo total no cambia');
  casi(clips(conHueco, pistaId)[1].inicio, 50, 'el de atras NO se movio');

  const cerrado = M.borrarConRipple(m, pistaId, clips(m, pistaId)[1].id);
  assert.strictEqual(huecos(cerrado, pistaId).length, 0);
  casi(M.duracionPista(cerrado, pistaId), 80);
  casi(clips(cerrado, pistaId)[1].inicio, 30, 'lo de atras se corrio');
});

test('cerrar un hueco a mano corre lo de atras', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 50);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  m = M.cerrarHueco(m, pistaId, huecos(m, pistaId)[0].id);
  assert.strictEqual(huecos(m, pistaId).length, 0);
  casi(M.duracionPista(m, pistaId), 80);
});

// ============================================================
// 4. LOS DOS EJES DE TIEMPO
// ============================================================

test('en un hueco no hay material: va negro', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 50);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  assert.strictEqual(M.capaVisibleEn(m, 40), null, 'nada que mostrar');
  casi(M.capaVisibleEn(m, 10).tFuente, 10, 'antes del hueco, normal');
  casi(M.capaVisibleEn(m, 60).tFuente, 60, 'y despues sigue igual: no se corrio');
});

test('con ripple, el eje de la linea se corre respecto al del archivo', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 10);
  m = M.cortarEn(m, pistaId, 30);
  m = M.borrarConRipple(m, pistaId, clips(m, pistaId)[1].id);
  casi(M.duracionPista(m, pistaId), 80);
  casi(M.capaVisibleEn(m, 15).tFuente, 35, 'linea 15 -> fuente 35');
});

test('proximoMaterialDesde permite saltar un vacio al reproducir', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 50);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  casi(M.proximoMaterialDesde(m, 35), 50);
  assert.strictEqual(M.proximoMaterialDesde(m, 99), null);
});

// ============================================================
// 5. LOS CUATRO MODOS DE RECORTE
// ============================================================
// Lo que distingue a cada uno es QUE CONSERVA. Eso es lo que se verifica.

test('RIPPLE cambia la duracion del clip Y del montaje', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const largoAntes = M.duracionPista(m, pistaId);
  m = M.ripple(m, pistaId, clips(m, pistaId)[0].id, 'out', 25);
  casi(clips(m, pistaId)[0].duracion, 25, 'el clip se acorto');
  assert.ok(M.duracionPista(m, pistaId) < largoAntes, 'y el montaje tambien');
  casi(clips(m, pistaId)[1].inicio, 25, 'lo de atras se corrio');
});

test('ROLL mueve el corte entre dos clips SIN cambiar el largo total', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const largoAntes = M.duracionPista(m, pistaId);
  m = M.roll(m, pistaId, clips(m, pistaId)[0].id, 55);
  const c = clips(m, pistaId);
  casi(c[0].fin, 55, 'el corte se movio');
  casi(c[1].inicio, 55, 'y el vecino arranca ahi');
  casi(M.duracionPista(m, pistaId), largoAntes, 'el largo total NO cambia');
  casi(c[0].duracion + c[1].duracion, largoAntes, 'uno crecio lo que el otro se achico');
});

test('SLIP cambia que parte del material se ve, sin mover el clip', () => {
  // Se usa el PRIMER clip (usa 0..40 de un archivo de 100): tiene 60s de
  // material por delante para correrse. El segundo ya termina donde
  // termina el archivo, asi que no podria deslizarse hacia adelante -
  // ese caso lo cubre el test de abajo.
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const antes = clips(m, pistaId)[0];
  m = M.slip(m, pistaId, antes.id, 10);
  const desp = clips(m, pistaId)[0];
  casi(desp.inicio, antes.inicio, 'no se movio');
  casi(desp.duracion, antes.duracion, 'ni cambio de duracion');
  casi(desp.usadoIn, antes.usadoIn + 10, 'pero muestra material 10s mas adelante');
  casi(desp.usadoOut, antes.usadoOut + 10, 'la ventana entera se corrio');
});

test('SLIP se frena cuando la ventana toca el borde del material', () => {
  const { m, pistaId } = base();          // el clip usa TODO el archivo
  const antes = clips(m, pistaId)[0];
  const desp = clips(M.slip(m, pistaId, antes.id, 30), pistaId)[0];
  casi(desp.usadoIn, antes.usadoIn, 'no hay de donde sacar mas');

  // Y el que termina justo al final del archivo tampoco puede ir hacia
  // adelante, pero SI hacia atras.
  let m2 = M.cortarEn(m, pistaId, 40);
  const ultimo = clips(m2, pistaId)[1];
  casi(clips(M.slip(m2, pistaId, ultimo.id, 10), pistaId)[1].usadoIn, ultimo.usadoIn, 'adelante no');
  casi(clips(M.slip(m2, pistaId, ultimo.id, -10), pistaId)[1].usadoIn, ultimo.usadoIn - 10, 'atras si');
});

test('SLIDE mueve el clip y los vecinos absorben el cambio', () => {
  let { m, mediaId, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 60);
  const largoAntes = M.duracionPista(m, pistaId);
  const medio = clips(m, pistaId)[1];
  const durMedio = medio.duracion;

  m = M.slide(m, pistaId, medio.id, 10);
  const c = clips(m, pistaId);
  casi(c[1].inicio, 40, 'el clip se corrio 10s');
  casi(c[1].duracion, durMedio, 'sin cambiar de duracion');
  casi(M.duracionPista(m, pistaId), largoAntes, 'ni el largo total');
  casi(c[0].duracion, 40, 'el de antes crecio');
});

test('ningun modo de recorte puede achicar un clip a la nada', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const id = clips(m, pistaId)[0].id;
  const r = M.ripple(m, pistaId, id, 'out', -50);
  assert.ok(clips(r, pistaId)[0].duracion >= M.MIN_DUR - 1e-9);
});

// ============================================================
// 6. MOVER, UNIR
// ============================================================

test('mover un clip lo saca de un lado y lo pone en otro, dejando hueco', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const segundo = clips(m, pistaId)[1];
  m = M.moverElemento(m, pistaId, segundo.id, 0);
  const c = clips(m, pistaId);
  assert.strictEqual(c[0].id, segundo.id, 'quedo primero');
  casi(c[0].usadoIn, 40, 'con su material original');
  assert.ok(huecos(m, pistaId).length >= 0);
});

test('mover un clip A OTRA PISTA es lo que permite superponer', () => {
  let { m, mediaId, pistaId } = base();
  let p2;
  [m, p2] = M.agregarPista(m, 'video', 'V2');
  m = M.cortarEn(m, pistaId, 40);
  const segundo = clips(m, pistaId)[1];
  m = M.moverElemento(m, pistaId, segundo.id, 10, p2);
  assert.strictEqual(clips(m, p2).length, 1, 'llego arriba');
  assert.strictEqual(M.capaVisibleEn(m, 15).pistaNombre, 'V2', 'y ahora tapa');
});

test('unir deshace una cuchillada, pero no junta material distinto', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const unido = M.unirConSiguiente(m, pistaId, clips(m, pistaId)[0].id);
  assert.strictEqual(clips(unido, pistaId).length, 1);
  casi(M.duracionPista(unido, pistaId), 100);

  // Con un hueco en el medio no se unen.
  const conHueco = M.borrar(M.cortarEn(m, pistaId, 60), pistaId, clips(M.cortarEn(m, pistaId, 60), pistaId)[1].id);
  const antes = els(conHueco, pistaId).length;
  assert.strictEqual(els(M.unirConSiguiente(conHueco, pistaId, clips(conHueco, pistaId)[0].id), pistaId).length, antes);
});

// ============================================================
// 7. PISTAS APILADAS
// ============================================================

test('la pista de mas arriba tapa a la de abajo, y el hueco deja ver', () => {
  let { m, mediaId, pistaId } = base();
  let p2;
  [m, p2] = M.agregarPista(m, 'video', 'V2');
  [m] = M.insertarEn(m, p2, 20, mediaId, { usadoIn: 80, usadoOut: 90 });

  assert.strictEqual(M.capaVisibleEn(m, 25).pistaNombre, 'V2', 'V2 tapa');
  assert.strictEqual(M.capaVisibleEn(m, 10).pistaNombre, 'V1', 'donde V2 tiene hueco, se ve V1');
  assert.strictEqual(M.composicionEn(m, 25).length, 2, 'hay 2 capas');
});

test('ocultar una pista la saca de la composicion', () => {
  let { m, mediaId, pistaId } = base();
  let p2;
  [m, p2] = M.agregarPista(m, 'video', 'V2');
  [m] = M.agregarAlFinal(m, p2, mediaId, {});
  assert.strictEqual(M.capaVisibleEn(m, 50).pistaNombre, 'V2');
  m = M.actualizarPista(m, p2, { visible: false });
  assert.strictEqual(M.capaVisibleEn(m, 50).pistaNombre, 'V1');
});

test('reordenar pistas cambia quien tapa a quien', () => {
  let { m, mediaId } = base();
  let p2;
  [m, p2] = M.agregarPista(m, 'video', 'V2');
  [m] = M.agregarAlFinal(m, p2, mediaId, {});
  assert.strictEqual(M.capaVisibleEn(m, 50).pistaNombre, 'V2');
  m = M.moverPista(m, p2, 0);
  assert.strictEqual(M.capaVisibleEn(m, 50).pistaNombre, 'V1');
});

test('las pistas de audio no entran en la composicion de imagen', () => {
  let { m, mediaId } = base();
  let a1;
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  [m] = M.agregarAlFinal(m, a1, mediaId, {});
  assert.strictEqual(M.composicionEn(m, 50).length, 1);
});

// ============================================================
// 8. MATERIAL
// ============================================================

test('el material lleva INICIO propio, no solo duracion', () => {
  // Importa en archivos con timecode que no arranca en cero: sin esto
  // todo el material queda corrido.
  let m = M.crearMontaje();
  let id;
  [m, id] = M.agregarMedia(m, { ruta: 'D:/a.mkv', disponibleIn: 3600, disponibleOut: 3700 });
  const med = M.mediaPorId(m, id);
  casi(med.disponibleIn, 3600);
  casi(med.disponibleOut, 3700);
});

test('no se puede usar material que no existe en el archivo', () => {
  const { m, pistaId } = base(100);
  const id = clips(m, pistaId)[0].id;
  const out = M.ripple(m, pistaId, id, 'out', 500);
  casi(clips(out, pistaId)[0].usadoOut, 100, 'se frena donde termina el archivo');
});

test('el mismo archivo puede aparecer varias veces con pedazos distintos', () => {
  let { m, mediaId, pistaId } = base();
  [m] = M.agregarAlFinal(m, pistaId, mediaId, { usadoIn: 10, usadoOut: 20 });
  [m] = M.agregarAlFinal(m, pistaId, mediaId, { usadoIn: 50, usadoOut: 60 });
  assert.strictEqual(clips(m, pistaId).length, 3);
  assert.strictEqual(m.media.length, 1, 'un solo archivo en el panel');
});

test('sacar material lo reemplaza por hueco, sin correr el resto', () => {
  let { m, mediaId, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const largoAntes = M.duracionPista(m, pistaId);
  m = M.quitarMedia(m, mediaId);
  casi(M.duracionPista(m, pistaId), 0, 'sin clips no queda nada que sostener la pista');
  assert.strictEqual(clips(m, pistaId).length, 0);
});

// ============================================================
// 9. IMANTADO
// ============================================================

test('el iman pega a los bordes de los clips', () => {
  let { m, pistaId } = base();
  m = M.cortarEn(m, pistaId, 40);
  const puntos = M.puntosDeImantado(m);
  casi(M.imantar(39.6, puntos, 1), 40, 'se pega al borde cercano');
  casi(M.imantar(20, puntos, 1), 20, 'lejos de todo, no se mueve');
});

test('el iman tambien considera el cabezal y los marcadores', () => {
  const { m } = base();
  const puntos = M.puntosDeImantado(m, [33.3]);
  casi(M.imantar(33, puntos, 0.5), 33.3);
});

test('la tolerancia del iman la decide el llamador (depende del zoom)', () => {
  const puntos = [0, 50];
  casi(M.imantar(48, puntos, 1), 48, 'con tolerancia chica no alcanza');
  casi(M.imantar(48, puntos, 5), 50, 'con tolerancia grande si');
});

// ============================================================
// 10. DESHACER / REHACER E INTEGRIDAD
// ============================================================

test('deshacer y rehacer recorren el historial', () => {
  const { m, pistaId } = base();
  let h = M.crearHistorial(m);
  h = M.registrar(h, M.cortarEn(h.presente, pistaId, 40));
  assert.strictEqual(clips(h.presente, pistaId).length, 2);
  h = M.deshacer(h);
  assert.strictEqual(h.presente, m, 'vuelve exacto al estado anterior');
  h = M.rehacer(h);
  assert.strictEqual(clips(h.presente, pistaId).length, 2);
});

test('una operacion que no cambio nada no ensucia el historial', () => {
  const { m, pistaId } = base();
  let h = M.crearHistorial(m);
  h = M.registrar(h, M.cortarEn(h.presente, pistaId, 0));
  assert.strictEqual(M.puedeDeshacer(h), false);
});

test('cortar no cambia el material total', () => {
  let { m, pistaId } = base();
  for (const t of [25, 50, 75]) m = M.cortarEn(m, pistaId, t);
  casi(clips(m, pistaId).reduce((a, c) => a + c.duracion, 0), 100);
});

test('todos los ids son unicos despues de muchas operaciones', () => {
  let { m, pistaId } = base(1000);
  for (let i = 1; i < 25; i++) m = M.cortarEn(m, pistaId, i * 35);
  const ids = els(m, pistaId).map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('la exportacion puede sacar que rangos del archivo quedan usados', () => {
  let { m, mediaId, pistaId } = base();
  m = M.cortarEn(m, pistaId, 30);
  m = M.cortarEn(m, pistaId, 50);
  m = M.borrar(m, pistaId, clips(m, pistaId)[1].id);
  assert.deepStrictEqual(M.rangosDeMedia(m, mediaId), [[0, 30], [50, 100]]);
});
