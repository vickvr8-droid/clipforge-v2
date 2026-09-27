// Tests de src/shared/geometria916.js — la geometria que COMPARTEN el
// preview del renderer y la exportacion real a video.
//
// POR QUE ESTE ARCHIVO IMPORTA (creado 05/08/2026, junto con la
// unificacion): antes de unificar, esta matematica estaba escrita 3
// veces a mano (cropLayoutsBuilder.js, renderer.js, exportPlan.js). El
// riesgo no era que estuvieran mal ese dia - estaban identicas - sino
// que se separaran despues sin que nadie se diera cuenta, porque
// desincronizarse NO produce ningun error: el preview muestra una cosa,
// el mp4 sale con otra, y solo se nota mirando el video terminado.
//
// El bloque "ACUERDO PREVIEW <-> EXPORT" del final es el que sella eso:
// compara el recorte que dibuja el preview contra el que ffmpeg va a
// recortar, y falla si dejan de coincidir. Si alguien vuelve a copiar
// esta matematica a un tercer lugar y la toca, estos tests se caen.

const test = require('node:test');
const assert = require('node:assert');

const G = require('../src/shared/geometria916');

// FALTAN A PROPOSITO, Y HAY QUE REPONERLOS: los tests "ACUERDO PREVIEW
// <-> EXPORT" de este archivo comparaban el recorte del visor contra el
// de src/main/exportPlan.js. Ese modulo se borro en la reconstruccion del
// 06/08/2026 y todavia no se rehizo, asi que los tests que lo importaban
// se sacaron para que la suite pueda correr.
// CUANDO SE ESCRIBA EL PLANIFICADOR DE EXPORTACION NUEVO, LO PRIMERO ES
// VOLVER A ATARLO ACA: sin ese acuerdo, el preview y el mp4 exportado
// pueden separarse sin que nada avise, y eso recien se nota despues de
// esperar un render largo. Estan en test/geometria916.test.js de la copia
// de E:\Clipforge2, listos para copiar.
// Tambien se sacaron los tests del "arbol de cortes" y de las celdas
// "libres": ese modelo lo reemplazo layout916.js, que trae los suyos.

// ============================================================
// 1. RECORTE "COVER"
// ============================================================

test('cover: una fuente mas ANCHA que el destino se recorta a los costados y se centra', () => {
  // Fuente 400x100 (aspecto 4.0) hacia un destino 1:1 -> tiene que
  // quedarse con un cuadrado de 100x100 centrado horizontalmente.
  const r = G.aplicarCover(0, 0, 400, 100, 1);
  assert.strictEqual(r.w, 100);
  assert.strictEqual(r.h, 100, 'el alto no se toca cuando sobra ancho');
  assert.strictEqual(r.x, 150, 'el sobrante (300) se reparte igual a ambos lados');
  assert.strictEqual(r.y, 0);
});

test('cover: una fuente mas ALTA que el destino se recorta arriba y abajo', () => {
  // Fuente 100x400 (aspecto 0.25) hacia un destino 1:1 -> cuadrado de
  // 100x100 centrado verticalmente.
  const r = G.aplicarCover(0, 0, 100, 400, 1);
  assert.strictEqual(r.w, 100, 'el ancho no se toca cuando sobra alto');
  assert.strictEqual(r.h, 100);
  assert.strictEqual(r.x, 0);
  assert.strictEqual(r.y, 150);
});

test('cover: si la fuente ya tiene el aspecto del destino, no recorta nada', () => {
  const r = G.aplicarCover(10, 20, 90, 160, 9 / 16);
  assert.strictEqual(r.x, 10);
  assert.strictEqual(r.y, 20);
  assert.strictEqual(r.w, 90);
  assert.strictEqual(r.h, 160);
});

test('cover: respeta el desplazamiento (x/y) del recuadro, no asume que arranca en 0,0', () => {
  const r = G.aplicarCover(500, 300, 400, 100, 1);
  assert.strictEqual(r.x, 500 + 150, 'el centrado es relativo al origen del recuadro');
  assert.strictEqual(r.y, 300);
});

test('un recuadro degenerado (ancho 0%) no produce medidas cero ni NaN', () => {
  // Piso de 1px en rectFuenteDeClip: sin eso, un recuadro mal dibujado
  // daria una division por cero y ffmpeg abortaria el render entero.
  const clip = { xPct: 0.5, yPct: 0.5, wPct: 0, hPct: 0 };
  const r = G.recorteCoverDeClip(clip, 1920, 1080, 1080, 1920);
  assert.ok(r.w > 0 && r.h > 0, 'ancho y alto tienen que ser positivos');
  assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), 'sin NaN');
});

// ============================================================
// 3. CLIPS ACTIVOS Y COBERTURA
// ============================================================

test('clipsEnInstante devuelve solo los activos, ordenados por pista', () => {
  const clips = [
    { id: 'c1', start: 0, end: 10, track: 2 },
    { id: 'c2', start: 0, end: 10, track: 0 },
    { id: 'c3', start: 50, end: 60, track: 1 }
  ];
  const activos = G.clipsEnInstante(clips, 5);
  assert.deepStrictEqual(activos.map((c) => c.id), ['c2', 'c1'], 'track 0 primero, y c3 no esta activo');
});

test('el final de un clip es exclusivo (en t = end ya no esta activo)', () => {
  const clips = [{ id: 'c1', start: 0, end: 10, track: 0 }];
  assert.strictEqual(G.clipsEnInstante(clips, 9.999).length, 1);
  assert.strictEqual(G.clipsEnInstante(clips, 10).length, 0, 'evita que 2 clips pegados se pisen 1 frame');
});

test('sin ningun recuadro, todo el video figura como NO cubierto', () => {
  assert.deepStrictEqual(G.segmentosCobertura([], 100), [{ start: 0, end: 100, cubierto: false }]);
});

test('la cobertura marca el hueco entre dos recuadros separados', () => {
  const clips = [
    { start: 0, end: 10, track: 0 },
    { start: 30, end: 50, track: 0 }
  ];
  const segs = G.segmentosCobertura(clips, 60);
  assert.deepStrictEqual(
    segs.map((s) => [s.start, s.end, s.cubierto]),
    [[0, 10, true], [10, 30, false], [30, 50, true], [50, 60, false]]
  );
});
