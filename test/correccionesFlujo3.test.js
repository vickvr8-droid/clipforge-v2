// Correcciones del flujo clipforge3 (errores de gravedad media confirmados).
// Informe: D:\investigacion-clipforge\flujo-clipforge3\correcciones.md

const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/montaje');
const P = require('../src/renderer/previewTl');
const Picos = require('../src/main/picosBridge');

// El mismo archivo agregado dos veces como material: dos media, misma ruta.
// El clip de la linea sale del SEGUNDO; 'Aplicar cortes' antes elegia el
// primero y no encontraba nada (aplicados 0, sinLugar 1).
test('aplicar cortes alcanza a los clips de un material duplicado (misma ruta)', () => {
  let m = M.crearMontaje({ fps: 30 });
  let m1, m2;
  [m, m1] = M.agregarMedia(m, { ruta: '/x/charla.mp4', duracion: 60 });
  [m, m2] = M.agregarMedia(m, { ruta: '/x/charla.mp4', duracion: 60 });
  [m] = M.agregarPista(m, 'video', 'V1');
  const v1 = m.pistas.find((p) => p.tipo === 'video').id;
  m = M.sobrescribirEn(m, v1, 0, M.clip(m2, 0, 60));
  const ids = m.media.filter((x) => x.ruta === '/x/charla.mp4').map((x) => x.id);
  assert.strictEqual(ids.length, 2);
  const [s, inf] = M.aplicarCortesDeFuente(m, ids, [[10, 12]]);
  assert.strictEqual(inf.aplicados, 1);
  assert.strictEqual(inf.sinLugar, 0);
  const fin = Math.max(...M.elementosDePista(s, v1).filter((e) => e.tipo === 'clip').map((e) => e.fin));
  assert.ok(Math.abs(fin - 58) < 1e-6, `largo esperado 58, dio ${fin}`);
  // Con un solo id (el que no tiene clips) sigue sin lugar: no se inventa nada.
  const [, inf1] = M.aplicarCortesDeFuente(m, m1, [[10, 12]]);
  assert.strictEqual(inf1.sinLugar, 1);
});

// Un vacio elegido no tiene que entrar al grupo al hacer Ctrl+clic en un clip.
test('baseParaSumar: un vacio elegido no se cuela en la seleccion multiple', () => {
  const vacio = { pistaId: 'p', elId: 'v' };
  const esClip = (r) => r.elId !== 'v';
  assert.deepStrictEqual(P.baseParaSumar([], vacio, esClip), []);
  const g = P.alternarEnSeleccion(P.baseParaSumar([], vacio, esClip), { pistaId: 'p', elId: 'c' }, true);
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(P.baseParaSumar([], { pistaId: 'p', elId: 'c' }, esClip), [{ pistaId: 'p', elId: 'c' }]);
  assert.deepStrictEqual(P.baseParaSumar([{ pistaId: 'p', elId: 'a' }], vacio, esClip), [{ pistaId: 'p', elId: 'a' }]);
  assert.deepStrictEqual(P.baseParaSumar([], null, esClip), []);
});

// ffmpeg que muere a mitad deja columnas leidas: eso NO es una onda valida
// y no puede terminar en la cache.
test('picos: si ffmpeg sale con error se rechaza aunque haya audio parcial', () => {
  const acc = Picos.crearAcumulador();
  acc.agregar(Buffer.alloc(Picos.SR * 2 * 1));   // 1 s de silencio
  const parcial = acc.terminar();
  assert.ok(parcial, 'hay columnas parciales');
  const r = Picos.resultadoDeCierre(1, parcial, 'Error while decoding');
  assert.ok(r.error instanceof Error);
  assert.strictEqual(r.res, undefined);
  assert.strictEqual(Picos.resultadoDeCierre(0, parcial, '').res, parcial);
  assert.strictEqual(Picos.resultadoDeCierre(0, null, '').res, null, 'sin audio sigue siendo null');
});
