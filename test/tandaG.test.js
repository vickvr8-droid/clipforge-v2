// Tests de la TANDA G (19/09/2026): pasos 9 y 10 de la hoja de ruta del
// INFORME de la linea de tiempo.
//   Paso 9: vista previa real al arrastrar (PreviewTl.simular aplica la
//           misma operacion que el main), iman por bordes del clip,
//           autoscroll y seleccion multiple con moverGrupo atomico.
//   Paso 10: onda de los clips (picosBridge en el main y las cuentas del
//           dibujo en PreviewTl).

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('../src/shared/montaje');
const P = require('../src/renderer/previewTl');
const Picos = require('../src/main/picosBridge');

const clips = (m, p) => M.elementosDePista(m, p).filter((x) => x.tipo === 'clip');
const pistaDe = (m, tipo, n) => m.pistas.filter((p) => p.tipo === tipo)[n || 0].id;
const tramos = (m, p) => clips(m, p).map((c) => [+c.inicio.toFixed(6), +c.fin.toFixed(6)]);
function assertSano(m, contexto) {
  assert.deepStrictEqual(M.verificarMontaje(m).map((f) => `${f.tipo}: ${f.detalle}`), [], contexto);
}

// Entrevista de 60 s cortada en 20 y 40, con imagen y sonido vinculados.
function entrevista() {
  let m = M.crearMontaje();
  let media;
  [m, media] = M.agregarMedia(m, { ruta: '/x/entrevista.mp4', duracion: 60, tieneAudio: true });
  [m] = M.colocarMedia(m, media, 0);
  m = M.cortarTodasEn(m, 20);
  m = M.cortarTodasEn(m, 40);
  return { m, media, v1: pistaDe(m, 'video'), a1: pistaDe(m, 'audio') };
}

// Lo que hace el main al soltar: operacion + poda (operarMontaje).
const comoElMain = (m) => M.podarPistas(m);
const sinIdsDeHuecos = (m) => ({
  ...m,
  pistas: m.pistas.map((p) => ({ ...p, elementos: p.elementos.map((e) => (e.tipo === 'hueco' ? { ...e, id: '' } : e)) }))
});

// ---------- Paso 9a: la vista previa ES la operacion ----------

test('simular: cada modo da exactamente lo que aplica el main al soltar', () => {
  const { m, v1 } = entrevista();
  const [c0, c1] = clips(m, v1);
  const casos = [
    [{ modo: 'mover', pistaId: v1, elId: c1.id, inicioDestino: 45, destino: v1 },
      comoElMain(M.moverConInforme(m, v1, c1.id, 45, null)[0])],
    [{ modo: 'recorte', pistaId: v1, elId: c1.id, borde: 'out', ultimo: 35 },
      comoElMain(M.recortar(m, v1, c1.id, 'out', 35))],
    [{ modo: 'ripple', pistaId: v1, elId: c1.id, borde: 'out', ultimo: 35 },
      comoElMain(M.rippleConInforme(m, v1, c1.id, 'out', 35)[0])],
    [{ modo: 'roll', pistaId: v1, elId: c0.id, borde: 'out', ultimo: 23 },
      comoElMain(M.roll(m, v1, c0.id, 23, 'out'))],
    [{ modo: 'slip', pistaId: v1, elId: c1.id, delta: 2 }, comoElMain(M.slip(m, v1, c1.id, 2))],
    [{ modo: 'slide', pistaId: v1, elId: c1.id, delta: 2 }, comoElMain(M.slide(m, v1, c1.id, 2))]
  ];
  for (const [gesto, esperado] of casos) {
    const { montaje } = P.simular(M, m, gesto);
    // Los vacios nuevos llevan un id al azar en cada llamada: se comparan
    // sin ese id (el resto, incluidos los ids de clips, tiene que coincidir).
    assert.deepStrictEqual(sinIdsDeHuecos(montaje), sinIdsDeHuecos(esperado), gesto.modo);
  }
});

test('simular mover: la vista previa incluye la pareja de sonido y la fila destino', () => {
  const { m, v1, a1 } = entrevista();
  const c1 = clips(m, v1)[1];
  const { montaje, informe } = P.simular(M, m, { modo: 'mover', pistaId: v1, elId: c1.id, inicioDestino: 70, destino: v1 });
  const cambios = P.cambiosDeFilas(M, m, montaje);
  const filas = cambios.filas.map((f) => f.pistaId).sort();
  assert.deepStrictEqual(filas, [v1, a1].sort(), 'cambian V1 y A1, no solo la del clip agarrado');
  const enA1 = cambios.filas.find((f) => f.pistaId === a1).clips.map((c) => [c.inicio, c.fin]);
  assert.deepStrictEqual(enA1, [[0, 20], [40, 60], [70, 90]], 'el sonido se ve donde va a quedar');
  assert.ok(informe && informe.movido, 'trae el informe del main para el cartel');
});

test('simular mover a una pista nueva: la vista previa la marca como nueva', () => {
  const { m, v1 } = entrevista();
  const c1 = clips(m, v1)[1];
  const { montaje } = P.simular(M, m, { modo: 'mover', pistaId: v1, elId: c1.id, inicioDestino: 20, destino: M.PISTA_NUEVA });
  const cambios = P.cambiosDeFilas(M, m, montaje);
  assert.strictEqual(cambios.nuevas.filter((f) => f.tipo === 'video').length, 1);
  assert.deepStrictEqual(cambios.nuevas.find((f) => f.tipo === 'video').clips.map((c) => [c.inicio, c.fin]), [[20, 40]]);
});

test('cambiosDeFilas: lo tapado entero sale en perdidos; sin cambio, nada', () => {
  const { m, v1 } = entrevista();
  const [c0, c1] = clips(m, v1);
  // c0 (0-20) encima de c1 (20-40): c1 desaparece entero.
  const { montaje } = P.simular(M, m, { modo: 'mover', pistaId: v1, elId: c0.id, inicioDestino: 20, destino: v1 });
  const cambios = P.cambiosDeFilas(M, m, montaje);
  assert.ok(cambios.perdidos.includes(c1.id), 'c1 se marca como perdido');
  assert.deepStrictEqual(P.cambiosDeFilas(M, m, m), { filas: [], nuevas: [], quitadas: [], perdidos: [] });
});

test('simular ripple con bloqueo: la vista previa muestra que no pasa nada y trae el motivo', () => {
  let { m, v1 } = entrevista();
  let musica;
  [m, musica] = M.agregarMedia(m, { ruta: '/x/musica.mp3', duracion: 100, tipo: 'audio', tieneAudio: true });
  let a2;
  [m, a2] = M.agregarPista(m, 'audio');
  m = M.sobrescribirEn(m, a2, 0, M.clip(musica, 0, 100));
  const c1 = clips(m, v1)[1];
  const { montaje, informe } = P.simular(M, m, { modo: 'ripple', pistaId: v1, elId: c1.id, borde: 'out', ultimo: 30 });
  assert.ok(informe.ripple && informe.ripple.bloqueo, 'la musica frena y la preview lo sabe');
  assert.deepStrictEqual(tramos(montaje, v1), tramos(m, v1), 'la preview no inventa un ripple que no va a pasar');
});

// ---------- Paso 9b: iman por bordes, sin el propio clip ----------

test('puntosSinPropios: excluye los bordes del clip y de su pareja', () => {
  const { m, v1 } = entrevista();
  const c1 = clips(m, v1)[1];   // 20-40, pareja en A1 20-40
  const pts = P.puntosSinPropios(M, m, [{ pistaId: v1, elId: c1.id }], [7]);
  // 20 y 40 siguen siendo bordes de c0 (fin) y c2 (inicio): quedan. Lo que
  // no queda es ningun punto que SOLO aporte c1: aca todos son compartidos,
  // asi que se prueba con un clip suelto.
  assert.ok(pts.includes(7) && pts.includes(0) && pts.includes(60));

  let m2 = M.crearMontaje(); let med;
  [m2, med] = M.agregarMedia(m2, { ruta: '/x/a.mp4', duracion: 10 });
  [m2] = M.colocarMedia(m2, med, 30);
  const v = pistaDe(m2, 'video');
  const suelto = clips(m2, v)[0];
  const sin = P.puntosSinPropios(M, m2, [{ pistaId: v, elId: suelto.id }]);
  assert.ok(!sin.includes(30) && !sin.includes(40), 'el clip no se imanta a si mismo');
});

test('imantarBloque: pega por el inicio o por el fin, lo que este mas cerca', () => {
  assert.deepStrictEqual(P.imantarBloque(9.8, 5, [0, 10, 30], 0.5), { inicio: 10, punto: 10 });
  assert.deepStrictEqual(P.imantarBloque(25.2, 5, [0, 10, 30], 0.5), { inicio: 25, punto: 30 }, 'el fin se pega a 30');
  assert.deepStrictEqual(P.imantarBloque(17, 5, [0, 10, 30], 0.5), { inicio: 17, punto: null });
  assert.deepStrictEqual(P.imantarBloque(17, 5, [10], 0), { inicio: 17, punto: null }, 'iman apagado');
  assert.strictEqual(P.imantarBloque(0.2, 5, [0], 0.5).inicio, 0);
});

test('Shift invierte el iman', () => {
  assert.strictEqual(P.imanActivo(true, false), true);
  assert.strictEqual(P.imanActivo(true, true), false);
  assert.strictEqual(P.imanActivo(false, true), true);
});

test('autoscroll: solo cerca del borde, mas rapido cuanto mas cerca', () => {
  assert.strictEqual(P.pasoDeAutoscroll(500, 0, 1000), 0);
  assert.ok(P.pasoDeAutoscroll(5, 0, 1000) < 0);
  assert.ok(P.pasoDeAutoscroll(995, 0, 1000) > 0);
  assert.ok(P.pasoDeAutoscroll(999, 0, 1000) > P.pasoDeAutoscroll(975, 0, 1000));
  assert.ok(Math.abs(P.pasoDeAutoscroll(-50, 0, 1000)) <= 24, 'con tope');
});

// ---------- Paso 9c: seleccion multiple ----------

test('alternarEnSeleccion: clic comun elige uno, Ctrl suma y saca', () => {
  let s = P.alternarEnSeleccion([], { pistaId: 'p', elId: 'a' }, false);
  s = P.alternarEnSeleccion(s, { pistaId: 'p', elId: 'b' }, true);
  assert.deepStrictEqual(s.map((r) => r.elId), ['a', 'b']);
  s = P.alternarEnSeleccion(s, { pistaId: 'p', elId: 'a' }, true);
  assert.deepStrictEqual(s.map((r) => r.elId), ['b']);
  s = P.alternarEnSeleccion(s, { pistaId: 'p', elId: 'c' }, false);
  assert.deepStrictEqual(s.map((r) => r.elId), ['c']);
});

test('sanearSeleccion: saca lo que ya no existe y sigue a lo que cambio de pista', () => {
  const { m, v1 } = entrevista();
  const [c0] = clips(m, v1);
  const s = P.sanearSeleccion(M, m, [{ pistaId: 'otra', elId: c0.id }, { pistaId: v1, elId: 'no-existe' }]);
  assert.deepStrictEqual(s, [{ pistaId: v1, elId: c0.id }]);
});

test('moverGrupo: dos clips se corren juntos en UN paso, con sus parejas, sin comerse entre si', () => {
  const { m, v1, a1 } = entrevista();
  const [c0, c1] = clips(m, v1);
  // Correr c0 y c1 (0-40) +10: si se movieran de a uno, c0 caeria sobre c1
  // y lo recortaria antes de que c1 se mueva.
  const [salida, informe] = M.moverGrupoConInforme(m, [{ pistaId: v1, elId: c0.id }, { pistaId: v1, elId: c1.id }], 10);
  assert.strictEqual(informe.movidos, 4, 'dos imagenes y sus dos sonidos');
  assert.strictEqual(informe.delta, 10);
  const c0n = clips(salida, v1).find((c) => c.id === c0.id);
  const c1n = clips(salida, v1).find((c) => c.id === c1.id);
  assert.deepStrictEqual([c0n.inicio, c0n.fin, c1n.inicio, c1n.fin], [10, 30, 30, 50], 'los dos enteros');
  assert.deepStrictEqual(tramos(salida, a1), tramos(salida, v1), 'el sonido acompaña');
  assert.strictEqual(c1n.usadoIn, c1.usadoIn, 'no cambia que parte del material se usa');
  assertSano(salida, 'grupo movido');
});

test('moverGrupo: no pasa del 0 y no deforma el grupo', () => {
  const { m, v1 } = entrevista();
  const [, c1, c2] = clips(m, v1);
  const salida = M.moverGrupo(m, [{ pistaId: v1, elId: c1.id }, { pistaId: v1, elId: c2.id }], -35);
  const pos = clips(salida, v1).filter((c) => c.id === c1.id || c.id === c2.id).map((c) => [c.inicio, c.fin]);
  assert.deepStrictEqual(pos, [[0, 20], [20, 40]], 'frena en 0 con -20, no con -35 para uno solo');
  assertSano(salida, 'frenado en 0');
});

test('moverGrupo con fps: el corrimiento cae en cuadro y todos se corren lo mismo', () => {
  let { m, v1 } = entrevista();
  m = M.fijarFps(m, 25);
  const [c0, c1] = clips(m, v1);
  const salida = M.moverGrupo(m, [{ pistaId: v1, elId: c0.id }, { pistaId: v1, elId: c1.id }], 1.013);
  const c0n = clips(salida, v1).find((c) => c.id === c0.id);
  const c1n = clips(salida, v1).find((c) => c.id === c1.id);
  assert.ok(Math.abs(c0n.inicio * 25 - Math.round(c0n.inicio * 25)) < 1e-6, 'inicio en cuadro');
  assert.ok(Math.abs((c1n.inicio - c0n.inicio) - 20) < 1e-9, 'el grupo no se deforma');
  assertSano(salida, 'con fps');
});

test('simular moverGrupo = lo que aplica el main', () => {
  const { m, v1 } = entrevista();
  const [c0, c1] = clips(m, v1);
  const grupo = [{ pistaId: v1, elId: c0.id }, { pistaId: v1, elId: c1.id }];
  const { montaje } = P.simular(M, m, { modo: 'moverGrupo', grupo, delta: 5 });
  // Los restos de un clip tapado a medias nacen con id al azar: se compara
  // la forma (tramos, material y si siguen vinculados) de cada pista.
  const forma = (x) => x.pistas.map((p) => clips(x, p.id).map((c) => [c.inicio, c.fin, c.usadoIn, !!c.vinculo]));
  assert.deepStrictEqual(forma(montaje), forma(comoElMain(M.moverGrupo(m, grupo, 5))));
});

test('borrarGrupo: cada uno deja su vacio, con su sonido, en un solo montaje', () => {
  const { m, v1, a1 } = entrevista();
  const [c0, , c2] = clips(m, v1);
  const salida = M.borrarGrupo(m, [{ pistaId: v1, elId: c0.id }, { pistaId: v1, elId: c2.id }]);
  assert.deepStrictEqual(tramos(salida, v1), [[20, 40]]);
  assert.deepStrictEqual(tramos(salida, a1), [[20, 40]]);
  assertSano(salida, 'grupo borrado');
});

// ---------- Paso 10: onda ----------

function pcm(muestras) {
  const b = Buffer.alloc(muestras.length * 2);
  muestras.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
}

test('acumulador de picos: cubos de 10 ms, pedazos impares y el pico a plena escala', () => {
  const acc = Picos.crearAcumulador();
  // 2 cubos: el primero silencio, el segundo con +32767 y -32768.
  const muestras = new Array(320).fill(0);
  muestras[200] = 32767; muestras[201] = -32768;
  const buf = pcm(muestras);
  acc.agregar(buf.subarray(0, 101));      // corta una muestra por la mitad
  acc.agregar(buf.subarray(101));
  const p = acc.terminar();
  assert.strictEqual(p.niveles[0].min.length, 2);
  assert.strictEqual(p.duracion, 0.02);
  assert.strictEqual(p.niveles[0].max[0], 128, 'silencio en 128');
  assert.strictEqual(p.niveles[0].max[1], 255, 'el pico maximo NO se da vuelta a 0');
  assert.strictEqual(p.niveles[0].min[1], 0);
});

test('piramide: cada nivel junta de a dos (min de mins, max de maxs)', () => {
  const n = 4000;
  const base = { min: new Uint8Array(n).fill(128), max: new Uint8Array(n).fill(128), rms: new Uint8Array(n) };
  base.max[3001] = 250; base.min[3000] = 5;
  const niv = Picos.piramide(base, 10);
  assert.ok(niv.length >= 3);
  assert.strictEqual(niv[1].msPorCubo, 20);
  assert.strictEqual(niv[1].max[1500], 250);
  assert.strictEqual(niv[1].min[1500], 5);
});

test('serializar/deserializar: ida y vuelta, sin audio, y formato viejo se recalcula', () => {
  const acc = Picos.crearAcumulador();
  acc.agregar(pcm(Array.from({ length: 1600 }, (_, i) => Math.round(Math.sin(i / 5) * 20000))));
  const p = acc.terminar();
  const vuelta = Picos.deserializar(Picos.serializar(p));
  assert.deepStrictEqual(Array.from(vuelta.niveles[0].max), Array.from(p.niveles[0].max));
  assert.strictEqual(Picos.deserializar(Picos.serializar(null)), null, 'sin audio se guarda como tal');
  assert.strictEqual(Picos.deserializar('{"formato":0}'), undefined);
  assert.strictEqual(Picos.deserializar('basura'), undefined);
});

test('columnasDeOnda: se indexa por tiempo de FUENTE (un slip mueve la onda sin recalcular)', () => {
  // 10 s a 10 ms: un golpe en la fuente 4,00-4,01 s.
  const n = 1000;
  const base = { min: new Uint8Array(n).fill(128), max: new Uint8Array(n).fill(128), rms: new Uint8Array(n) };
  base.max[400] = 240; base.min[400] = 16;
  const picos = { msPorCubo: 10, niveles: Picos.piramide(base, 10) };
  // Clip que usa la fuente 3-5 s en 200 columnas: el golpe cae en la 100.
  const a = P.columnasDeOnda(picos, 3, 5, 200);
  assert.strictEqual(a.max[100], 240);
  assert.strictEqual(a.max[50], 128);
  // Slip +1 s: usa 4-6 s y el golpe pasa a la columna 0.
  const b = P.columnasDeOnda(picos, 4, 6, 200);
  assert.strictEqual(b.max[0], 240);
  // Muy alejado: 10 s en 20 columnas, el golpe no se pierde al juntar.
  const c = P.columnasDeOnda(picos, 0, 10, 20);
  assert.strictEqual(c.max[8], 240);
  assert.strictEqual(c.min[8], 16);
  // Fuera del archivo: silencio, sin romper.
  const d = P.columnasDeOnda(picos, 20, 30, 10);
  assert.ok(Array.from(d.max).every((v) => v === 128));
});

test('nivelParaEscala: el mas grueso que todavia da una columna por pixel', () => {
  const picos = { niveles: [{ msPorCubo: 10 }, { msPorCubo: 20 }, { msPorCubo: 40 }, { msPorCubo: 80 }] };
  assert.strictEqual(P.nivelParaEscala(picos, 0.001).msPorCubo, 10);
  assert.strictEqual(P.nivelParaEscala(picos, 0.05).msPorCubo, 40);
  assert.strictEqual(P.nivelParaEscala(picos, 5).msPorCubo, 80);
});

test('tramoVisible: el canvas mide lo que se ve, nunca el clip entero (824 s a zoom alto)', () => {
  // Clip de 824 s a 300 px/s = 247.200 px; la vista mide 1500.
  const t = P.tramoVisible(0, 247200, 100000, 101500);
  assert.deepStrictEqual(t, { desde: 100000, hasta: 101500 });
  assert.ok(t.hasta - t.desde <= P.CANVAS_MAX_PX);
  assert.strictEqual(P.tramoVisible(0, 100, 200, 300), null, 'fuera de la vista no se dibuja');
  const enorme = P.tramoVisible(0, 1e6, 0, 1e6);
  assert.ok(enorme.hasta - enorme.desde <= P.CANVAS_MAX_PX, 'con tope aunque la vista sea enorme');
});

test('instantesDeMiniaturas: una por casilla visible, en tiempo de fuente', () => {
  const r = P.instantesDeMiniaturas(10, 20, 1000, { desde: 0, hasta: 300 }, 100);
  assert.deepStrictEqual(r.map((x) => x.x), [0, 100, 200]);
  assert.ok(Math.abs(r[0].t - 10.5) < 1e-9);
});

// Con ffmpeg de verdad: si no esta, se saltea (no es parte del modelo).
const hayFfmpeg = !spawnSync(process.env.CLIPFORGE_FFMPEG || 'ffmpeg', ['-version']).error;
test('picosDeMaterial con ffmpeg real: calcula, guarda y la segunda vez sale del cache', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-picos-'));
  const wav = path.join(dir, 'tono.wav');
  const bin = process.env.CLIPFORGE_FFMPEG || 'ffmpeg';
  const r = spawnSync(bin, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-y', wav]);
  assert.strictEqual(r.status, 0);
  const p = await Picos.picosDeMaterial(dir, 'm1', wav, bin);
  assert.ok(Math.abs(p.duracion - 3) < 0.05, `dura ${p.duracion}`);
  assert.ok(p.niveles[0].max[100] > 135, 'hay onda');
  assert.ok(fs.existsSync(path.join(dir, 'picos', 'm1.json')));
  // Segunda vez: con el archivo borrado igual responde, porque sale del cache.
  fs.unlinkSync(wav);
  const q = await Picos.picosDeMaterial(dir, 'm1', wav, bin);
  assert.deepStrictEqual(Array.from(q.niveles[0].max), Array.from(p.niveles[0].max));
  fs.rmSync(dir, { recursive: true, force: true });
});
