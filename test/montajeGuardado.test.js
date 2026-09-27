// Tests de ABRIR UN PROYECTO GUARDADO (13/09/2026).
//
// Lo que protegen: que agregar un campo al modelo (hoy `fps` en el
// material, para la exportacion de video) no borre en silencio la edicion
// de los proyectos que ya estan en disco.
//
// El riesgo es concreto: montajeUtilizable() rechaza cualquier montaje
// con otra `version`, y entonces montajeInicial() arma uno NUEVO desde
// cero con el archivo entero en V1. No hay error ni aviso: el user abre
// su proyecto y los cortes no estan. Por eso el fixture es un proyecto
// REAL guardado antes del cambio, con cortes, un hueco y dos encuadres.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const M = require('../src/shared/montaje');
const G = require('../src/shared/guionExport');
const { montajeUtilizable, montajeInicial, migrarAudioVinculado } = require('../src/main/montajeGuardado');

const viejo = require('./fixtures/proyecto-viejo-sin-fps.json');

// Clonar para que ningun test pueda modificar el fixture de los demas.
const copia = () => JSON.parse(JSON.stringify(viejo.montaje));

test('el fixture es de verdad un proyecto viejo: version 1 y material SIN fps', () => {
  assert.equal(viejo.montaje.version, 1);
  assert.ok(viejo.montaje.media.every((x) => !('fps' in x)));
});

test('Montaje.VERSION no se subio: un cambio de version borra la edicion guardada', () => {
  // Si este test falla porque alguien subio VERSION a proposito, NO se
  // actualiza el numero y listo: hay que escribir antes la migracion en
  // montajeGuardado.js y hacer que el test de abajo siga pasando.
  assert.equal(M.VERSION, 1);
});

test('un proyecto guardado antes de guardar fps abre con su edicion INTACTA', () => {
  const guardado = copia();
  // Aunque ffprobe ahora devuelva fps, el montaje guardado manda.
  const fuente = { duracion: 824, ancho: 1920, alto: 1080, fps: 29.97, tieneVideo: true, tieneAudio: true };
  assert.ok(montajeUtilizable(guardado));
  const m = migrarAudioVinculado(montajeInicial(viejo.inputPath, fuente, guardado));
  assert.deepStrictEqual(m, viejo.montaje);
});

test('un proyecto NUEVO guarda el fps que mide ffprobe', () => {
  const fuente = { duracion: 12, ancho: 1920, alto: 1080, fps: 29.97, tieneVideo: true, tieneAudio: true };
  const m = montajeInicial(path.join('x', 'nuevo.mp4'), fuente, null);
  assert.equal(m.version, M.VERSION);
  assert.equal(m.media[0].fps, 29.97);
});

test('sin fps medido el material NO lleva el campo (no se inventa un 0)', () => {
  const m = montajeInicial(path.join('x', 'nuevo.mp4'), { duracion: 5, ancho: 10, alto: 10 }, null);
  assert.ok(!('fps' in m.media[0]));
  const [m2] = M.agregarMedia(M.crearMontaje(), { ruta: 'a', duracion: 1, fps: NaN });
  assert.ok(!('fps' in m2.media[0]));
});

test('el proyecto viejo se puede EXPORTAR: fps del decodificador o 30', () => {
  const m = copia();
  const mediaId = m.media[0].id;
  // Sin ningun dato: el valor por defecto.
  assert.equal(G.fpsDeMontaje(m), 30);
  // Con lo que midio el decodificador al momento de exportar.
  assert.equal(G.fpsDeMontaje(m, { medidos: { [mediaId]: { fps: 59.94 } } }), 60000 / 1001);

  // Y el guion se arma sobre su edicion: el hueco 190,37..192,51 de V1
  // no pide cuadros.
  const g = G.guionDeExport(m, { fps: 10, desde: 189, hasta: 194, lienzo: { ancho: 1920, alto: 1080 } });
  assert.equal(g.totalCuadros, 50);
  const pedidos = new Set(g.clips.flatMap((c) => c.indices));
  assert.ok(!pedidos.has(20), 'el cuadro de t=191 cae en el hueco y no tiene imagen');
  assert.ok(pedidos.has(0) && pedidos.has(49));
  assert.deepEqual(G.problemasDeExport(m, g, 'vertical'), []);
});
