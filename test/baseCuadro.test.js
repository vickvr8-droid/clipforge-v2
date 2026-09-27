// BASE DE CUADRO (13/09/2026, tanda D, paso 6 de la hoja de ruta de
// D:\investigacion-clipforge\linea-de-tiempo\INFORME.md, hallazgo 4).
//
// Casos fijos. La propiedad general ("ninguna operacion deja pedazos de
// menos de un cuadro ni fronteras entre cuadros, con tiempos al azar") esta
// en propiedades.test.js; aca van los casos que el INFORME nombra y la
// migracion de un proyecto guardado.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const G = require('../src/shared/guionExport');
const { montajeInicial, asegurarBaseDeCuadro, necesitaMedirFps } = require('../src/main/montajeGuardado');

const viejo = require('./fixtures/proyecto-viejo-sin-fps.json');
const copia = () => JSON.parse(JSON.stringify(viejo.montaje));

const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
// Cuantos cuadros mide `t` (y si es un numero entero).
const cuadros = (m, t) => t / M.duracionCuadro(m);
const enCuadro = (m, t) => cerca(cuadros(m, t), Math.round(cuadros(m, t)), 1e-4);

function entrevista(fps, duracion) {
  let m = M.crearMontaje({ fps });
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'entrevista.mp4', duracion: duracion || 20 });
  const [m2, info] = M.colocarMedia(m, mediaId, 0);
  return { m: m2, mediaId, v1: info.pistaId, a1: info.pistaAudio, clipId: info.clipId };
}

const fronteras = (m, pistaId) => M.elementosDePista(m, pistaId).flatMap((e) => [e.inicio, e.fin]);

// ------------------------------------------------------------
// Las cuentas
// ------------------------------------------------------------

test('fpsComoFraccion: los NTSC van como fraccion exacta y los promedios de celular al estandar', () => {
  assert.deepStrictEqual(M.fpsComoFraccion(29.97), { num: 30000, den: 1001 });
  assert.deepStrictEqual(M.fpsComoFraccion(29.87), { num: 30000, den: 1001 });
  assert.deepStrictEqual(M.fpsComoFraccion(30.02), { num: 30, den: 1 });
  assert.deepStrictEqual(M.fpsComoFraccion(59.94), { num: 60000, den: 1001 });
  assert.deepStrictEqual(M.fpsComoFraccion({ num: 25, den: 1 }), { num: 25, den: 1 });
  assert.deepStrictEqual(M.fpsComoFraccion(15), { num: 15000, den: 1000 });
  assert.equal(M.fpsComoFraccion(0), null);
  assert.equal(M.fpsComoFraccion(NaN), null);
});

test('aCuadro redondea al cuadro mas cercano; pisoCuadro hacia abajo; sin fps no tocan nada', () => {
  const m = M.crearMontaje({ fps: 30 });
  assert.ok(cerca(M.aCuadro(m, 10.013), 10));
  assert.ok(cerca(M.aCuadro(m, 10.02), 10 + 1 / 30));
  assert.ok(cerca(M.pisoCuadro(m, 45.3), 45.3));          // 1359 cuadros justos
  assert.ok(cerca(M.pisoCuadro(m, 45.33), 45.3 + 0 / 30)); // 1359,9 -> 1359
  assert.ok(cerca(M.minDur(m), 1 / 30));
  const continuo = M.crearMontaje();
  assert.ok(!('fps' in continuo), 'un montaje sin fps no inventa el campo');
  assert.equal(M.aCuadro(continuo, 10.013), 10.013);
  assert.equal(M.minDur(continuo), M.MIN_DUR);
});

// ------------------------------------------------------------
// Los casos del hallazgo 4
// ------------------------------------------------------------

test('soltar un clip en t=0.01 con el iman apagado lo deja en un cuadro entero, sin clip de 10 ms', () => {
  let { m, mediaId, v1, a1 } = entrevista(30, 60);
  let otro;
  [m, otro] = M.agregarMedia(m, { ruta: 'broll.mp4', duracion: 20 });
  [m] = M.colocarMedia(m, otro, 70);
  const pistaB = m.pistas.filter((p) => p.tipo === 'video')[1] || m.pistas.find((p) => p.id === v1);
  const broll = M.elementosDePista(m, pistaB.id).find((e) => e.mediaId === otro);
  m = M.moverElemento(m, pistaB.id, broll.id, 0.01, v1);
  const v = M.elementosDePista(m, v1);
  assert.ok(v.every((e) => e.duracion >= 1 / 30 - 1e-9), `ningun pedazo menor a un cuadro: ${v.map((e) => e.duracion)}`);
  assert.ok(fronteras(m, v1).every((t) => enCuadro(m, t)));
  assert.equal(v[0].mediaId, otro, 'aterriza en 0, el cuadro mas cercano a 0.01');
  assert.deepStrictEqual(M.verificarMontaje(m), []);
  assert.ok(a1);
});

test('cortar en 10.013 corta en el cuadro 300 (30 fps) en imagen y sonido', () => {
  let { m, v1, a1 } = entrevista(30);
  m = M.cortarEn(m, v1, 10.013);
  for (const p of [v1, a1]) {
    const els = M.elementosDePista(m, p);
    assert.equal(els.length, 2);
    assert.ok(cerca(els[0].fin, 10));
    assert.ok(cerca(els[1].usadoIn, 10));
  }
  assert.deepStrictEqual(M.verificarMontaje(m), []);
});

test('un corte a UN cuadro del borde vale (el minimo es un cuadro, no 40 ms)', () => {
  let { m, v1 } = entrevista(60);
  m = M.cortarEn(m, v1, 1 / 60);
  const els = M.elementosDePista(m, v1);
  assert.equal(els.length, 2);
  assert.ok(cerca(els[0].duracion, 1 / 60));
  assert.deepStrictEqual(M.verificarMontaje(m), []);
});

test('material de 45,3 s a 29,97 entra en cuadros enteros (el pedazo del ultimo cuadro no)', () => {
  const { m, v1 } = entrevista(29.97, 45.3);
  const [c] = M.elementosDePista(m, v1);
  assert.equal(Math.round(cuadros(m, c.duracion)), 1357);
  assert.ok(enCuadro(m, c.duracion));
  assert.ok(c.usadoOut <= 45.3);
  assert.deepStrictEqual(M.verificarMontaje(m), []);
});

test('recortar, ripple, roll y slide contra el final del material quedan en cuadro', () => {
  // Material de 10,01 s: 300,3 cuadros a 30 fps. Estirar hasta el final del
  // archivo tiene que frenar en el cuadro 300, no en 10,01.
  let m = M.crearMontaje({ fps: 30 });
  let a, b;
  [m, a] = M.agregarMedia(m, { ruta: 'a.mp4', duracion: 10.01 });
  [m, b] = M.agregarMedia(m, { ruta: 'b.mp4', duracion: 10.01 });
  let v1;
  [m, v1] = M.agregarPista(m, 'video');
  m = M.sobrescribirEn(m, v1, 0, M.clip(a, 0, 5));
  m = M.sobrescribirEn(m, v1, 5, M.clip(b, 5, 10));
  m = M.sobrescribirEn(m, v1, 10, M.clip(a, 0, 3));
  const [c0, c1] = M.elementosDePista(m, v1);

  const trasRipple = M.ripple(m, v1, c0.id, 'out', 99);
  assert.ok(cerca(M.elementosDePista(trasRipple, v1)[0].fin, 10), 'ripple frena en el cuadro 300');
  const trasRoll = M.roll(m, v1, c0.id, 99, 'out');
  assert.ok(fronteras(trasRoll, v1).every((t) => enCuadro(trasRoll, t)), 'roll');
  const trasSlide = M.slide(m, v1, c1.id, 7.77);
  assert.ok(fronteras(trasSlide, v1).every((t) => enCuadro(trasSlide, t)), 'slide');
  const trasRecorte = M.recortar(M.borrar(m, v1, c1.id), v1, c0.id, 'out', 9.99);
  assert.ok(fronteras(trasRecorte, v1).every((t) => enCuadro(trasRecorte, t)), 'recorte');
  for (const x of [trasRipple, trasRoll, trasSlide, trasRecorte]) assert.deepStrictEqual(M.verificarMontaje(x), []);
});

test('slip se corre de a cuadros enteros', () => {
  let { m, v1, a1 } = entrevista(25, 30);
  m = M.recortar(m, v1, M.elementosDePista(m, v1)[0].id, 'in', 5);
  const clipDe = (x, p) => M.elementosDePista(x, p).find((e) => e.tipo === 'clip');
  const antes = clipDe(m, v1);
  m = M.slip(m, v1, antes.id, -1.013);
  const despues = clipDe(m, v1);
  assert.ok(cerca(despues.usadoIn - antes.usadoIn, -1.0), `${despues.usadoIn - antes.usadoIn}`);
  assert.ok(cerca(clipDe(m, a1).usadoIn, despues.usadoIn));
});

test('el verificador marca una frontera fuera de cuadro', () => {
  const { m, v1 } = entrevista(30);
  const roto = { ...m, pistas: m.pistas.map((p) => (p.id !== v1 ? p
    : { ...p, elementos: [M.hueco(0.5 + 0.01)].concat(p.elementos) })) };
  assert.ok(M.verificarMontaje(roto).some((f) => f.tipo === 'fueraDeCuadro'));
});

test('el export sale al fps del montaje (la grilla de los cortes)', () => {
  const { m } = entrevista(25);
  assert.equal(G.fpsDeMontaje(m), 25);
  assert.equal(G.fpsDeMontaje(m, { preferido: 60 }), 60, 'lo que elige el user sigue mandando');
});

// ------------------------------------------------------------
// Migracion y cambio de fps
// ------------------------------------------------------------

test('un proyecto NUEVO nace con base de cuadro (el fps del material, o 30)', () => {
  const m = montajeInicial('x/nuevo.mp4', { duracion: 12.3456, fps: 29.97, tieneVideo: true, tieneAudio: true }, null);
  assert.deepStrictEqual(m.fps, { num: 30000, den: 1001 });
  assert.deepStrictEqual(M.verificarMontaje(m), []);
  const wav = montajeInicial('x/voz.wav', { duracion: 7, tieneVideo: false, tieneAudio: true }, null);
  assert.deepStrictEqual(wav.fps, { num: 30, den: 1 });
});

test('MIGRACION: el proyecto viejo real queda en cuadro y conserva su edicion', () => {
  const guardado = copia();
  assert.ok(necesitaMedirFps(guardado), 'sin fps en ningun lado hay que medir el archivo');
  const m = asegurarBaseDeCuadro(guardado, { fps: 29.97 });
  assert.deepStrictEqual(m.fps, { num: 30000, den: 1001 });
  assert.deepStrictEqual(guardado, viejo.montaje, 'no toca el objeto que recibe');

  // Pasa el verificador entero, fronteras en cuadro incluidas.
  assert.deepStrictEqual(M.verificarMontaje(m), []);

  // La edicion es la misma: mismas pistas, mismos elementos en el mismo
  // orden, mismo material, mismos vinculos, mismo usadoIn, y cada frontera
  // a menos de medio cuadro de donde estaba. La unica excepcion es el fin
  // de un clip que usa el material hasta el final del archivo (el ultimo de
  // V1 y A1 termina en el segundo 824 de 824): redondearlo para arriba
  // pediria material que no hay, asi que pierde ese cuadro (hasta uno).
  const medio = M.duracionCuadro(m) / 2 + 1e-9;
  const uno = M.duracionCuadro(m) + 1e-9;
  assert.equal(m.pistas.length, guardado.pistas.length);
  m.pistas.forEach((p, i) => {
    const antes = M.elementosDePista(guardado, guardado.pistas[i].id);
    const ahora = M.elementosDePista(m, p.id);
    assert.equal(p.id, guardado.pistas[i].id);
    assert.deepStrictEqual(ahora.map((e) => [e.id, e.tipo, e.mediaId, e.vinculo, e.usadoIn]),
      antes.map((e) => [e.id, e.tipo, e.mediaId, e.vinculo, e.usadoIn]), `pista ${p.nombre}`);
    ahora.forEach((e, j) => {
      assert.ok(Math.abs(e.inicio - antes[j].inicio) <= medio, `${p.nombre}[${j}] inicio`);
      const med = e.mediaId && M.mediaPorId(m, e.mediaId);
      const alFinal = med && cerca(antes[j].usadoOut, med.disponibleOut, 1e-3);
      assert.ok(Math.abs(e.fin - antes[j].fin) <= (alFinal ? uno : medio), `${p.nombre}[${j}] fin`);
    });
  });
  assert.deepStrictEqual(m.media, guardado.media);
  const enc = (x) => x.pistas.flatMap((p) => p.elementos.filter(M.esAjuste).map((e) => e.ajuste));
  assert.deepStrictEqual(enc(m), enc(guardado), 'los encuadres conservan su recorte');

  // Una sola vez: abrirlo de nuevo no vuelve a tocar nada.
  assert.equal(asegurarBaseDeCuadro(m, { fps: 25 }), m);
  // Guardarlo y volver a abrirlo (JSON ida y vuelta) pasa el verificador.
  assert.deepStrictEqual(M.verificarMontaje(JSON.parse(JSON.stringify(m))), []);
});

test('MIGRACION sin medir: usa el fps guardado del material, o 30', () => {
  const g = copia();
  g.media[0].fps = 25;
  assert.ok(!necesitaMedirFps(g));
  assert.deepStrictEqual(asegurarBaseDeCuadro(g, null).fps, { num: 25, den: 1 });
  assert.deepStrictEqual(asegurarBaseDeCuadro(copia(), null).fps, { num: 30, den: 1 });
});

test('MIGRACION: un resto de 10 ms desaparece con su pareja, y un final que no entra deja un vacio de un cuadro', () => {
  let m = M.crearMontaje();
  let med, v1, a1;
  [m, med] = M.agregarMedia(m, { ruta: 'a.mp4', duracion: 10.02 });
  [m, v1] = M.agregarPista(m, 'video');
  [m, a1] = M.agregarPista(m, 'audio');
  m = M.sobrescribirEn(m, v1, 0, M.clip(med, 0, 0.01));
  m = M.sobrescribirEn(m, v1, 0.01, M.clip(med, 2, 5));
  // Termina en 10.02 del material: redondear su fin para arriba pediria
  // material que no hay.
  m = M.sobrescribirEn(m, v1, 3.01, M.clip(med, 6.99, 10.02));
  m = M.sobrescribirEn(m, v1, 6.05, M.clip(med, 0, 1));
  m = M.espejarEnAudio(m, v1, a1);
  const alineado = M.fijarFps(m, 30);
  assert.deepStrictEqual(M.verificarMontaje(alineado), []);
  const v = M.elementosDePista(alineado, v1);
  const a = M.elementosDePista(alineado, a1);
  assert.equal(v[0].usadoIn, 2, 'el clip de 10 ms ya no esta');
  assert.deepStrictEqual(v.map((e) => [e.tipo, +e.inicio.toFixed(6), +e.fin.toFixed(6)]),
    a.map((e) => [e.tipo, +e.inicio.toFixed(6), +e.fin.toFixed(6)]), 'imagen y sonido iguales');
  assert.ok(v.some((e) => e.tipo === 'hueco'), 'el cuadro que no entra queda como vacio');
  assert.ok(M.elementosDePista(alineado, v1).every((e) => e.tipo === 'hueco' || e.usadoOut <= 10.02 + 1e-9));
});

test('fijarFps con el mismo fps devuelve el mismo objeto (no deja paso de deshacer)', () => {
  const { m } = entrevista(30);
  assert.equal(M.fijarFps(m, 30), m);
  assert.equal(M.fijarFps(m, 30.01), m, '30,01 es 30');
  const a25 = M.fijarFps(m, 25);
  assert.notEqual(a25, m);
  assert.deepStrictEqual(M.verificarMontaje(a25), []);
});

// ------------------------------------------------------------
// Cableado (main.js carga Electron y exportVideo.js el navegador: se
// revisa el texto, como en gestosTl.test.js)
// ------------------------------------------------------------

test('cableado: main.js migra a base de cuadro al abrir, DESPUES de migrar los encuadres', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const iRecuadros = main.indexOf('Montaje.migrarRecuadros(m, proyecto.recuadros)');
  const iCuadro = main.indexOf('m = asegurarBaseDeCuadro(m, fuente)');
  assert.ok(iRecuadros > 0 && iCuadro > iRecuadros, 'la migracion de cuadro va ultima');
  assert.ok(main.indexOf('necesitaMedirFps(m)') > 0);
  assert.match(main, /ipcMain\.handle\('montaje:volumen'/);
  assert.match(main, /ipcMain\.handle\('montaje:fps'/);
});

test('cableado: el export agrega la pista de audio y la intercala antes de cada cuadro', () => {
  const fs = require('fs');
  const path = require('path');
  const ev = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'exportVideo.js'), 'utf8');
  assert.match(ev, /output\.addAudioTrack\(fuenteAudio\)/);
  assert.match(ev, /await mezclador\.avanzarHasta\(t \+ dur\);\s*await fuenteVideo\.add\(t, dur\);/);
  assert.match(ev, /await mezclador\.terminar\(\);[\s\S]*await output\.finalize\(\);/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const pos = (s) => html.indexOf('<script src="' + s + '"');
  assert.ok(pos('../shared/mezclaAudio.js') > pos('../shared/montaje.js') && pos('../shared/montaje.js') > 0 && pos('../shared/mezclaAudio.js') < pos('exportVideo.js'));
});
