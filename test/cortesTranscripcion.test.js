// PUENTE TRANSCRIPCION -> MONTAJE (tanda H, paso 11 de la hoja de ruta de
// D:\investigacion-clipforge\linea-de-tiempo\INFORME.md, hallazgos 35/45).
// Los bloques 'cut' estan en tiempo de FUENTE; aplicarCortesDeFuente los
// saca de la linea con el ripple multipista, respetando el vinculo y la
// grilla de cuadros, en una sola operacion (un paso de historial).

const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/montaje');

const clips = (m, p) => M.elementosDePista(m, p).filter((x) => x.tipo === 'clip');
const pistaDe = (m, tipo, n) => m.pistas.filter((p) => p.tipo === tipo)[n || 0].id;
const tramos = (m, p) => clips(m, p).map((c) => [+c.inicio.toFixed(6), +c.fin.toFixed(6)]);
const fuentes = (m, p) => clips(m, p).map((c) => [+c.usadoIn.toFixed(6), +c.usadoOut.toFixed(6)]);
const sano = (m) => assert.deepStrictEqual(M.verificarMontaje(m).map((f) => `${f.tipo}: ${f.detalle}`), []);

// V1/A1 con un clip de 0 a 10 (fuente 0-10) y otro de 10 a 30 (fuente 20-40).
function entrevista() {
  let m = M.crearMontaje({ fps: 30 });
  let media;
  [m, media] = M.agregarMedia(m, { ruta: '/x/entrevista.mp4', duracion: 100 });
  [m] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarPista(m, 'audio', 'A1');
  const v1 = pistaDe(m, 'video'), a1 = pistaDe(m, 'audio');
  const k1 = M.nuevoVinculo(), k2 = M.nuevoVinculo();
  m = M.sobrescribirEn(m, v1, 0, M.clip(media, 0, 10, null, k1));
  m = M.sobrescribirEn(m, a1, 0, M.clip(media, 0, 10, null, k1));
  m = M.sobrescribirEn(m, v1, 10, M.clip(media, 20, 40, null, k2));
  m = M.sobrescribirEn(m, a1, 10, M.clip(media, 20, 40, null, k2));
  return { m, media, v1, a1 };
}

test('rangoFuenteALinea traduce fuente a linea y omite lo que no esta', () => {
  const { m, media, v1, a1 } = entrevista();
  const r = M.rangoFuenteALinea(m, media, [25, 27]);
  assert.deepStrictEqual(r.map((x) => [x.pistaId, x.inicio, x.fin]).sort(), [[v1, 15, 17], [a1, 15, 17]].sort());
  assert.deepStrictEqual(M.rangoFuenteALinea(m, media, [12, 18]), [], 'la fuente 10-20 no esta en la linea');
  // Un rango que cruza el hueco de fuente cae en dos clips.
  assert.strictEqual(M.rangoFuenteALinea(m, media, [8, 22]).length, 4);
});

test('un corte de frase saca el tramo de V1 y A1 juntos y corre lo de atras', () => {
  const { m, media, v1, a1 } = entrevista();
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[25, 27]]);
  assert.strictEqual(inf.aplicados, 1);
  assert.deepStrictEqual(tramos(s, v1), [[0, 10], [10, 15], [15, 28]]);
  assert.deepStrictEqual(fuentes(s, v1), [[0, 10], [20, 25], [27, 40]]);
  assert.deepStrictEqual(fuentes(s, a1), fuentes(s, v1), 'el sonido sigue a la imagen');
  // El vinculo se conserva: cada pedazo de V1 tiene su pareja en A1.
  const vv = clips(s, v1).map((c) => c.vinculo), va = clips(s, a1).map((c) => c.vinculo);
  assert.deepStrictEqual(vv, va);
  assert.strictEqual(new Set(vv).size, 3);
  sano(s);
});

test('varios cortes, solapados y desordenados, en una sola operacion', () => {
  const { m, media, v1, a1 } = entrevista();
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[30, 32], [2, 3], [31, 33], [12, 15]]);
  assert.strictEqual(inf.pedidos, 3, '30-32 y 31-33 se fusionan');
  assert.strictEqual(inf.aplicados, 2);
  assert.strictEqual(inf.sinLugar, 1, '12-15 ya no esta en la linea');
  assert.deepStrictEqual(fuentes(s, v1), [[0, 2], [3, 10], [20, 30], [33, 40]]);
  assert.deepStrictEqual(fuentes(s, a1), fuentes(s, v1));
  assert.ok(Math.abs(M.duracionMontaje(s) - 26) < 1e-6);
  sano(s);
});

test('aplicar dos veces no corta de nuevo (lo cortado ya no esta en la linea)', () => {
  const { m, media } = entrevista();
  const [s1] = M.aplicarCortesDeFuente(m, media, [[25, 27]]);
  const [s2, inf] = M.aplicarCortesDeFuente(s1, media, [[25, 27]]);
  assert.strictEqual(inf.aplicados, 0);
  assert.strictEqual(inf.sinLugar, 1);
  assert.deepStrictEqual(s2, s1);
});

test('los bordes van a cuadro (30 fps) y un corte de menos de un cuadro se omite', () => {
  const { m, media, v1 } = entrevista();
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[25.01, 26.99], [30, 30.01]]);
  assert.strictEqual(inf.aplicados, 1);
  assert.strictEqual(inf.cortos, 2, 'el corte chico aparece en V1 y en A1');
  const cuadro = 1 / 30;
  for (const c of clips(s, v1)) {
    for (const t of [c.inicio, c.fin, c.usadoIn, c.usadoOut]) {
      assert.ok(Math.abs(t / cuadro - Math.round(t / cuadro)) < 1e-6, `fuera de grilla: ${t}`);
    }
  }
  sano(s);
});

test('el encuadre de V2 se acorta y sigue sobre la misma fuente', () => {
  let { m, media, v1 } = entrevista();
  let info;
  [m, info] = M.colocarEncuadre(m, 12, 10);   // 12-22 en linea = fuente 22-32
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[25, 27]]);
  assert.strictEqual(inf.aplicados, 1);
  assert.deepStrictEqual(tramos(s, info.pistaId), [[12, 20]]);
  sano(s);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, s), []);
});

test('material de otra pista frena ESE tramo y el resto se aplica', () => {
  let { m, media, v1, a1 } = entrevista();
  let musica;
  [m, musica] = M.agregarMedia(m, { ruta: '/x/musica.mp3', tipo: 'audio', duracion: 60 });
  [m] = M.agregarPista(m, 'audio', 'A2');
  const a2 = pistaDe(m, 'audio', 1);
  m = M.sobrescribirEn(m, a2, 14, M.clip(musica, 0, 4));   // 14-18 en linea
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[25, 27], [2, 3]]);
  assert.strictEqual(inf.aplicados, 1);
  assert.strictEqual(inf.frenados.length, 1);
  assert.strictEqual(inf.frenados[0].bloqueo.pistaId, a2);
  assert.deepStrictEqual(fuentes(s, v1), [[0, 2], [3, 10], [20, 40]], 'el tramo frenado ni se corta');
  assert.deepStrictEqual(fuentes(s, a1), fuentes(s, v1));
  sano(s);
});

test('con la pista de musica con candado, el corte se aplica y la musica no se mueve', () => {
  let { m, media, v1 } = entrevista();
  let musica;
  [m, musica] = M.agregarMedia(m, { ruta: '/x/musica.mp3', tipo: 'audio', duracion: 60 });
  [m] = M.agregarPista(m, 'audio', 'A2');
  const a2 = pistaDe(m, 'audio', 1);
  m = M.sobrescribirEn(m, a2, 14, M.clip(musica, 0, 4));
  m = M.actualizarPista(m, a2, { bloqueada: true });
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[25, 27]]);
  assert.strictEqual(inf.aplicados, 1);
  assert.deepStrictEqual(tramos(s, a2), [[14, 18]]);
  assert.deepStrictEqual(fuentes(s, v1), [[0, 10], [20, 25], [27, 40]]);
});

test('el mismo material en dos lugares de la linea se corta en los dos', () => {
  let { m, media, v1, a1 } = entrevista();
  const k = M.nuevoVinculo();
  m = M.sobrescribirEn(m, v1, 30, M.clip(media, 24, 30, null, k));
  m = M.sobrescribirEn(m, a1, 30, M.clip(media, 24, 30, null, k));
  const [s, inf] = M.aplicarCortesDeFuente(m, media, [[25, 27]]);
  assert.strictEqual(inf.aplicados, 2);
  assert.strictEqual(inf.varios, 1);
  assert.deepStrictEqual(fuentes(s, v1), [[0, 10], [20, 25], [27, 40], [24, 25], [27, 30]]);
  assert.deepStrictEqual(fuentes(s, a1), fuentes(s, v1));
  sano(s);
});

test('rangosCortados: solo los bloques cut, corridos por el inicio del material', () => {
  const { rangosCortados } = require('../src/main/cutsBuilder');
  const blocks = [
    { id: 'b1', start: 1, end: 2, status: 'cut' },
    { id: 'b2', start: 3, end: 4, status: 'keep' },
    { id: 'b3', start: 5, end: 6, status: 'propuesta' },
    { id: 'b4', start: 7, end: 7, status: 'cut' }
  ];
  assert.deepStrictEqual(rangosCortados(blocks), [[1, 2]]);
  assert.deepStrictEqual(rangosCortados(blocks, 10), [[11, 12]]);
  assert.deepStrictEqual(rangosCortados(null), []);
});

test('de los bloques al montaje, de punta a punta', () => {
  const { rangosCortados } = require('../src/main/cutsBuilder');
  const { m, media, v1, a1 } = entrevista();
  const blocks = [
    { start: 25, end: 26, status: 'cut', type: 'speech' },
    { start: 25.5, end: 27, status: 'cut', type: 'silence' },
    { start: 30, end: 31, status: 'propuesta', type: 'silence' }
  ];
  const [s, inf] = M.aplicarCortesDeFuente(m, media, rangosCortados(blocks));
  assert.strictEqual(inf.aplicados, 1);
  assert.deepStrictEqual(fuentes(s, v1), [[0, 10], [20, 25], [27, 40]]);
  assert.deepStrictEqual(fuentes(s, a1), fuentes(s, v1));
});
