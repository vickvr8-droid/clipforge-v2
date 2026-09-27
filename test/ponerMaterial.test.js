// Tests de PONER MATERIAL EN LA LINEA (06/08/2026).
//
// BUG REAL REPORTADO: "borre todos los clips y no puedo añadir nada, ni
// otro video ni el mismo, tampoco sale nada en el panel multimedia".
//
// El montaje quedaba asi en proyecto.json:
//     media:  TEST 1.mov [0..824]     <- el material NUNCA se perdio
//     pistas: V1: 0 elementos, A1: 0 elementos
//
// Habia canales para cortar, borrar, mover y recortar, pero NINGUNO para
// agregar, y el panel multimedia era un cartel de "pendiente". Vaciar la
// linea era irreversible: al reabrir, montajeUtilizable() ve que hay
// media con duracion real, da el montaje vacio por bueno y lo reusa.
//
// Estos tests cuidan el camino de vuelta: que desde el material del
// proyecto se pueda reconstruir la linea de tiempo.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

// Un montaje como el que dejo el bug: con material, sin nada en la linea.
function vaciado() {
  let m = M.crearMontaje();
  let mediaId, v1, a1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'E:/TEST 1.mov', nombre: 'TEST 1.mov', tipo: 'video', duracion: 824 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  return { m, mediaId, v1, a1 };
}

const clipDe = (m, mediaId) => M.clip(mediaId, M.mediaPorId(m, mediaId).disponibleIn,
  M.mediaPorId(m, mediaId).disponibleOut);

// ============================================================
// EL CAMINO DE VUELTA
// ============================================================

test('el material sobrevive aunque la linea quede vacia', () => {
  const { m, mediaId, v1 } = vaciado();
  assert.strictEqual(M.duracionMontaje(m), 0, 'la linea arranca vacia');
  assert.ok(M.mediaPorId(m, mediaId), 'pero el material sigue en el proyecto');
  assert.strictEqual(M.elementosDePista(m, v1).length, 0);
});

test('se puede volver a poner el material en la linea', () => {
  const { m, mediaId, v1 } = vaciado();
  const lleno = M.sobrescribirEn(m, v1, 0, clipDe(m, mediaId));
  const els = M.elementosDePista(lleno, v1);
  assert.strictEqual(els.length, 1, 'deberia haber un clip');
  assert.strictEqual(els[0].tipo, 'clip');
  assert.ok(Math.abs(els[0].inicio) < 1e-9, 'arranca en 0');
  assert.ok(Math.abs(els[0].duracion - 824) < 1e-9, 'cubre todo el material');
  assert.ok(Math.abs(M.duracionMontaje(lleno) - 824) < 1e-9);
});

test('poner material en una pista vacia no necesita cabezal ni nada previo', () => {
  const { m, mediaId, a1 } = vaciado();
  // Incluso en la pista de audio, que tampoco tenia elementos.
  const lleno = M.sobrescribirEn(m, a1, 0, clipDe(m, mediaId));
  assert.strictEqual(M.elementosDePista(lleno, a1).length, 1);
});

test('se puede sumar OTRO archivo al mismo proyecto', () => {
  let { m, mediaId, v1 } = vaciado();
  let segundo;
  [m, segundo] = M.agregarMedia(m, { ruta: 'E:/otro.mp4', nombre: 'otro.mp4', tipo: 'video', duracion: 100 });
  assert.strictEqual(m.media.length, 2, 'el panel multimedia tiene 2 archivos');

  // Y los dos pueden convivir en la misma pista.
  let linea = M.sobrescribirEn(m, v1, 0, clipDe(m, mediaId));
  linea = M.sobrescribirEn(linea, v1, 824, clipDe(linea, segundo));
  const els = M.elementosDePista(linea, v1);
  assert.strictEqual(els.length, 2);
  assert.ok(Math.abs(M.duracionMontaje(linea) - 924) < 1e-9);
});

test('el mismo archivo se puede poner dos veces (el clip REFERENCIA al material)', () => {
  const { m, mediaId, v1 } = vaciado();
  let linea = M.sobrescribirEn(m, v1, 0, clipDe(m, mediaId));
  linea = M.sobrescribirEn(linea, v1, 824, clipDe(linea, mediaId));
  const els = M.elementosDePista(linea, v1);
  assert.strictEqual(els.length, 2, 'dos clips del mismo archivo');
  assert.strictEqual(els[0].mediaId, els[1].mediaId);
  assert.notStrictEqual(els[0].id, els[1].id, 'pero son clips distintos');
});

// ============================================================
// PONER MATERIAL NO EMPUJA (mismo criterio que mover)
// ============================================================

test('poner material encima tapa, no corre lo que ya estaba', () => {
  const { m, mediaId, v1 } = vaciado();
  const uno = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 100));
  const dos = M.sobrescribirEn(uno, v1, 50, M.clip(mediaId, 200, 250));
  // 0..50 del primero + 50..100 del nuevo = 100, no 150.
  assert.ok(Math.abs(M.duracionMontaje(dos) - 100) < 1e-9,
    `la linea deberia seguir midiendo 100, mide ${M.duracionMontaje(dos)}`);
});

test('poner material despues del final deja el vacio del medio', () => {
  const { m, mediaId, v1 } = vaciado();
  const uno = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 100));
  const dos = M.sobrescribirEn(uno, v1, 300, M.clip(mediaId, 0, 50));
  const els = M.elementosDePista(dos, v1);
  assert.strictEqual(els.length, 3, 'clip, vacio, clip');
  assert.strictEqual(els[1].tipo, 'hueco');
  assert.ok(Math.abs(els[1].duracion - 200) < 1e-9);
  assert.ok(Math.abs(M.duracionMontaje(dos) - 350) < 1e-9);
});
