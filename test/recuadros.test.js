// Tests del modelo de RECUADROS 16:9 -> 9:16 (06/08/2026).
//
// Lo que cuidan sobre todo es que un recuadro no se pueda salir del
// frame ni deformarse, porque eso no da error: da un crop invalido que
// ffmpeg rechaza recien al exportar, o una imagen estirada que solo se
// nota mirando el resultado.

// ############################################################
// ## TESTS DE UN MODULO MUERTO (07/08/2026)                  ##
// ############################################################
// `src/shared/recuadros.js` ya no lo carga nadie: el encuadre es un clip
// de ajuste dentro del montaje. Estos tests siguen pasando porque el
// modulo sigue en disco, pero NO cubren nada que la app use.
// Lo que los reemplaza: `test/encuadreAjuste.test.js`.
// Borrar los dos archivos juntos en cuanto haya un commit.

const test = require('node:test');
const assert = require('node:assert');

const R = require('../src/shared/recuadros');
const G = require('../src/shared/geometria916');

const base = (extra = {}) => ({ xPct: 0.1, yPct: 0.1, wPct: 0.3, hPct: 0.4, duracionTotal: 100, ...extra });

// ============================================================
// CREAR
// ============================================================

test('un recuadro nuevo dura todo el video por defecto', () => {
  const [r] = R.crear([], base());
  assert.strictEqual(r.start, 0);
  assert.strictEqual(r.end, 100);
  assert.strictEqual(r.track, 0);
});

test('dos recuadros que conviven en el tiempo van a pistas distintas', () => {
  let l = R.crear([], base());
  l = R.crear(l, base());
  l = R.crear(l, base());
  assert.deepStrictEqual(l.map((r) => r.track), [0, 1, 2]);
});

test('dos recuadros que NO se pisan en el tiempo pueden compartir pista', () => {
  let l = R.crear([], base({ start: 0, end: 10 }));
  l = R.crear(l, base({ start: 20, end: 30 }));
  assert.deepStrictEqual(l.map((r) => r.track), [0, 0]);
});

test('cada recuadro tiene id propio', () => {
  let l = R.crear([], base());
  l = R.crear(l, base());
  assert.notStrictEqual(l[0].id, l[1].id);
});

// ============================================================
// NO SALIRSE DEL FRAME
// ============================================================

test('un recuadro no puede quedar fuera del frame', () => {
  const [r] = R.crear([], base({ xPct: 0.9, yPct: 0.95, wPct: 0.4, hPct: 0.3 }));
  assert.ok(r.xPct + r.wPct <= 1 + 1e-9, `se sale por la derecha: ${r.xPct}+${r.wPct}`);
  assert.ok(r.yPct + r.hPct <= 1 + 1e-9, `se sale por abajo: ${r.yPct}+${r.hPct}`);
  assert.ok(r.xPct >= 0 && r.yPct >= 0);
});

test('pegado al borde se CORRE, no se encoge', () => {
  // El orden importa: acotando la posicion antes que el tamaño, un
  // recuadro empujado contra el borde derecho perderia ancho en vez de
  // frenarse, y el encuadre cambiaria solo.
  const [r] = R.crear([], base({ xPct: 0.95, yPct: 0, wPct: 0.3, hPct: 0.3 }));
  assert.ok(Math.abs(r.wPct - 0.3) < 1e-9, `perdio ancho: ${r.wPct}`);
  assert.ok(Math.abs(r.xPct - 0.7) < 1e-9, `deberia frenar en 0.7, quedo en ${r.xPct}`);
});

test('un recuadro no puede achicarse hasta desaparecer', () => {
  const [r] = R.crear([], base({ wPct: 0, hPct: -1 }));
  assert.ok(r.wPct >= R.MIN_PCT && r.hPct >= R.MIN_PCT);
});

test('mover con actualizar tampoco lo deja salirse', () => {
  const l = R.actualizar(R.crear([], base()), null, {});
  const [r] = R.crear([], base());
  const movido = R.actualizar([r], r.id, { xPct: 5, yPct: 5 })[0];
  assert.ok(movido.xPct + movido.wPct <= 1 + 1e-9);
  assert.ok(movido.yPct + movido.hPct <= 1 + 1e-9);
  assert.strictEqual(l.length, 1);
});

// ============================================================
// ACTIVOS EN EL TIEMPO
// ============================================================

test('activosEn devuelve solo los del instante, ordenados por pista', () => {
  let l = R.crear([], base({ start: 0, end: 50 }));
  l = R.crear(l, base({ start: 0, end: 50 }));
  l = R.crear(l, base({ start: 60, end: 90 }));
  assert.strictEqual(R.activosEn(l, 10).length, 2);
  assert.strictEqual(R.activosEn(l, 55).length, 0);
  assert.strictEqual(R.activosEn(l, 70).length, 1);
  assert.deepStrictEqual(R.activosEn(l, 10).map((r) => r.track), [0, 1]);
});

test('el final es exclusivo: en t = end ya no esta activo', () => {
  const l = R.crear([], base({ start: 0, end: 10 }));
  assert.strictEqual(R.activosEn(l, 9.99).length, 1);
  assert.strictEqual(R.activosEn(l, 10).length, 0);
});

// ============================================================
// NORMALIZAR
// ============================================================

test('normalizar recorta contra la duracion real del archivo', () => {
  const l = R.crear([], base({ start: 0, end: 500, duracionTotal: 500 }));
  const [r] = R.normalizar(l, 100);
  assert.ok(r.end <= 100 + 1e-9, `quedo en ${r.end}`);
});

test('normalizar renumera las pistas sin dejar huecos', () => {
  let l = R.crear([], base());
  l = R.crear(l, base());
  l = R.crear(l, base());
  const sinElDelMedio = R.eliminar(l, l[1].id);
  assert.deepStrictEqual(sinElDelMedio.map((r) => r.track), [0, 2], 'antes de normalizar queda el hueco');
  assert.deepStrictEqual(R.normalizar(sinElDelMedio, 100).map((r) => r.track), [0, 1]);
});

test('normalizar tira los que quedaron sin duracion', () => {
  const l = R.crear([], base({ start: 200, end: 300, duracionTotal: 300 }));
  assert.strictEqual(R.normalizar(l, 100).length <= 1, true);
  // Y lo que sobreviva tiene que ser valido, no un resto degenerado.
  R.normalizar(l, 100).forEach((r) => assert.ok(r.end > r.start));
});

// ============================================================
// ACUERDO CON LA GEOMETRIA
// ============================================================
// El modelo y la matematica del recorte viven en archivos distintos: este
// test es el que verifica que sigan hablando el mismo idioma.

test('un recuadro creado aca lo entiende geometria916 sin traducir nada', () => {
  const [r] = R.crear([], base({ xPct: 0.25, yPct: 0.1, wPct: 0.5, hPct: 0.5 }));
  const rect = G.recorteCoverDeClip(r, 1920, 1080, 1080, 1920);
  assert.ok(rect.w > 0 && rect.h > 0, 'tiene que dar un recorte usable');
  assert.ok(!Number.isNaN(rect.x) && !Number.isNaN(rect.y));
  // El recorte "cover" para un destino vertical sale mas alto que ancho.
  assert.ok(rect.h > rect.w, `esperaba vertical, dio ${rect.w}x${rect.h}`);
  // Y nunca pide pixeles fuera del archivo.
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.w <= 1920 + 1e-6 && rect.y + rect.h <= 1080 + 1e-6);
});
