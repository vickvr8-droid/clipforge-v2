// Tests del planificador de exportacion.
// Se corren con "npm test" (node:test, sin dependencias extra).
//
// Estos son los tests que faltaban: la exportacion es la parte donde un
// error de aritmetica no se ve en pantalla (sale un mp4 mal y listo), asi
// que conviene verificar los numeros directo sobre el plan.

const test = require('node:test');
const assert = require('node:assert');

const {
  planificarExportacion,
  rangosConservados,
  recorteCover,
  recorteCentrado,
  celdasAPixeles,
  aPar,
  srtDeSalida,
  argsSegmento,
  filtroSegmento
} = require('../src/main/exportPlan');

const { fusionar, restar, duracion } = require('../src/main/intervalos');

const FUENTE = { ancho: 1920, alto: 1080, duracion: 30, fps: 30, tieneVideo: true, tieneAudio: true };

function clip(id, start, end, track, rect) {
  return { id, start, end, track, ...rect };
}

const RECT_COMPLETO = { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };

// ------------------------------------------------------------------
test('fusionar une intervalos solapados y contiguos', () => {
  assert.deepStrictEqual(fusionar([[0, 5], [4, 8], [20, 25]]), [[0, 8], [20, 25]]);
});

test('restar quita el solape parcial y parte por el medio', () => {
  assert.deepStrictEqual(restar([[0, 10]], [[2, 4]]), [[0, 2], [4, 10]]);
  assert.deepStrictEqual(restar([[0, 10]], [[0, 10]]), []);
});

test('duracion no cuenta dos veces los solapes (bug del % eliminado)', () => {
  // Un silencio y un bloque de habla que se solapan: sumar por separado
  // daria 8s, la union real es 6s.
  assert.strictEqual(duracion(fusionar([[0, 5], [3, 6]])), 6);
});

// ------------------------------------------------------------------
test('rangosConservados excluye los bloques marcados cut', () => {
  const blocks = [
    { start: 0, end: 5, status: 'keep' },
    { start: 5, end: 7, status: 'cut' },
    { start: 7, end: 12, status: 'keep' }
  ];
  assert.deepStrictEqual(rangosConservados(blocks, null, 12), [[0, 5], [7, 12]]);
});

test('rangosConservados respeta el trim activo', () => {
  const blocks = [{ start: 0, end: 30, status: 'keep' }];
  const trim = { activo: true, inicio: 10, fin: 20 };
  assert.deepStrictEqual(rangosConservados(blocks, trim, 30), [[10, 20]]);
});

test('rangosConservados ignora el trim si no esta activo', () => {
  const blocks = [{ start: 0, end: 30, status: 'keep' }];
  const trim = { activo: false, inicio: 10, fin: 20 };
  assert.deepStrictEqual(rangosConservados(blocks, trim, 30), [[0, 30]]);
});

test('sin blocks se exporta el video entero', () => {
  assert.deepStrictEqual(rangosConservados([], null, 30), [[0, 30]]);
});

test('las propuestas de IA no aceptadas NO se cortan', () => {
  const blocks = [
    { start: 0, end: 5, status: 'keep' },
    { start: 5, end: 7, status: 'propuesta' }
  ];
  assert.deepStrictEqual(rangosConservados(blocks, null, 7), [[0, 7]]);
});

// ------------------------------------------------------------------
test('aPar redondea a par (libx264 exige dimensiones pares)', () => {
  assert.strictEqual(aPar(1081), 1080);
  assert.strictEqual(aPar(3), 2);
  assert.strictEqual(aPar(1), 2); // nunca 0
});

test('recorteCover respeta el aspecto del destino sin salirse de la fuente', () => {
  // Recuadro cuadrado de 540x540 sobre un 1920x1080, destino 1080x1920 (9:16).
  const c = clip('a', 0, 1, 0, { xPct: 0.25, yPct: 0, wPct: 0.28125, hPct: 0.5 });
  const r = recorteCover(c, FUENTE, 1080, 1920);
  assert.ok(r.w > 0 && r.h > 0);
  // Aspecto del recorte == aspecto del destino (tolerancia de 1px por el redondeo a par).
  assert.ok(Math.abs(r.w / r.h - 1080 / 1920) < 0.01, `aspecto ${r.w}/${r.h}`);
  // Nunca fuera de los limites de la fuente.
  assert.ok(r.x >= 0 && r.y >= 0);
  assert.ok(r.x + r.w <= FUENTE.ancho, `${r.x}+${r.w} > ${FUENTE.ancho}`);
  assert.ok(r.y + r.h <= FUENTE.alto, `${r.y}+${r.h} > ${FUENTE.alto}`);
});

test('recorteCover clampea un recuadro dibujado fuera del cuadro', () => {
  const c = clip('a', 0, 1, 0, { xPct: 0.9, yPct: 0.9, wPct: 0.5, hPct: 0.5 });
  const r = recorteCover(c, FUENTE, 1080, 1920);
  assert.ok(r.x + r.w <= FUENTE.ancho);
  assert.ok(r.y + r.h <= FUENTE.alto);
});

test('recorteCentrado da una franja 9:16 centrada', () => {
  const r = recorteCentrado(FUENTE, 1080, 1920);
  assert.strictEqual(r.h, 1080);          // limitado por la altura
  assert.strictEqual(r.w, aPar(1080 * 1080 / 1920)); // 607 -> 606
  assert.strictEqual(r.x, aPar((1920 - r.w) / 2));
});

test('celdasAPixeles convierte a pixeles pares dentro del lienzo', () => {
  const celdas = [{ pos: 0, x: 0, y: 0, w: 1, h: 0.5 }, { pos: 1, x: 0, y: 0.5, w: 1, h: 0.5 }];
  const px = celdasAPixeles(celdas, 1080, 1920);
  assert.strictEqual(px[0].w, 1080);
  assert.strictEqual(px[0].h, 960);
  assert.strictEqual(px[1].y, 960);
  px.forEach((c) => {
    assert.strictEqual(c.w % 2, 0);
    assert.strictEqual(c.h % 2, 0);
    assert.ok(c.x + c.w <= 1080 && c.y + c.h <= 1920);
  });
});

// ------------------------------------------------------------------
test('plan simple: un recuadro cubriendo todo el video', () => {
  const plan = planificarExportacion({
    blocks: [{ start: 0, end: 30, status: 'keep', type: 'speech', text: 'hola' }],
    clips: [clip('c1', 0, 30, 0, RECT_COMPLETO)],
    cellLayouts: {},
    trim: null,
    fuente: FUENTE,
    opciones: {}
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.segmentos.length, 1);
  assert.strictEqual(plan.segmentos[0].modo, 'recuadros');
  assert.ok(Math.abs(plan.duracionSalida - 30) < 0.01);
});

test('un bloque cortado acorta la duracion de salida', () => {
  const plan = planificarExportacion({
    blocks: [
      { start: 0, end: 10, status: 'keep' },
      { start: 10, end: 15, status: 'cut' },
      { start: 15, end: 30, status: 'keep' }
    ],
    clips: [clip('c1', 0, 30, 0, RECT_COMPLETO)],
    cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.segmentos.length, 2);
  assert.ok(Math.abs(plan.duracionSalida - 25) < 0.01);
  // La salida es continua: el segundo segmento arranca donde termino el primero.
  assert.ok(Math.abs(plan.segmentos[1].salidaStart - plan.segmentos[0].salidaEnd) < 0.001);
});

test('los cambios de recuadro parten el video en segmentos', () => {
  const plan = planificarExportacion({
    blocks: [{ start: 0, end: 30, status: 'keep' }],
    clips: [
      clip('c1', 0, 10, 0, RECT_COMPLETO),
      clip('c2', 10, 20, 0, { xPct: 0.5, yPct: 0, wPct: 0.5, hPct: 1 })
    ],
    cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  assert.strictEqual(plan.ok, true);
  // [0,10) c1 | [10,20) c2 | [20,30) sin recuadro -> centrado
  assert.strictEqual(plan.segmentos.length, 3);
  assert.strictEqual(plan.segmentos[2].modo, 'centrado');
});

test('dos recuadros simultaneos generan dos fuentes en el mismo segmento', () => {
  const plan = planificarExportacion({
    blocks: [{ start: 0, end: 30, status: 'keep' }],
    clips: [
      clip('c1', 0, 30, 0, { xPct: 0, yPct: 0, wPct: 0.5, hPct: 1 }),
      clip('c2', 0, 30, 1, { xPct: 0.5, yPct: 0, wPct: 0.5, hPct: 1 })
    ],
    cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.segmentos.length, 1);
  assert.strictEqual(plan.segmentos[0].fuentes.length, 2);
  // Por defecto (vertical) se apilan: la segunda celda arranca mas abajo.
  const [a, b] = plan.segmentos[0].fuentes;
  assert.strictEqual(a.destino.y, 0);
  assert.ok(b.destino.y > 0);
});

test('opcion "omitir" descarta los tramos sin recuadro', () => {
  const plan = planificarExportacion({
    blocks: [{ start: 0, end: 30, status: 'keep' }],
    clips: [clip('c1', 0, 10, 0, RECT_COMPLETO)],
    cellLayouts: {}, trim: null, fuente: FUENTE,
    opciones: { sinRecuadro: 'omitir' }
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.segmentos.length, 1);
  assert.ok(Math.abs(plan.duracionSalida - 10) < 0.01);
});

test('sin recuadros y en modo centrar se exporta igual, centrado', () => {
  const plan = planificarExportacion({
    blocks: [{ start: 0, end: 30, status: 'keep' }],
    clips: [], cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.segmentos[0].modo, 'centrado');
  assert.ok(plan.avisos.some((a) => a.includes('centrado')));
});

test('si todo esta cortado el plan falla con un mensaje claro', () => {
  const plan = planificarExportacion({
    blocks: [{ start: 0, end: 30, status: 'cut' }],
    clips: [clip('c1', 0, 30, 0, RECT_COMPLETO)],
    cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  assert.strictEqual(plan.ok, false);
  assert.match(plan.error, /No queda nada/i);
});

test('una fuente sin video no se puede planificar', () => {
  const plan = planificarExportacion({
    blocks: [], clips: [], cellLayouts: {}, trim: null,
    fuente: { ...FUENTE, tieneVideo: false }, opciones: {}
  });
  assert.strictEqual(plan.ok, false);
});

test('el plan avisa cuando la fuente no tiene audio', () => {
  const plan = planificarExportacion({
    blocks: [], clips: [clip('c1', 0, 30, 0, RECT_COMPLETO)],
    cellLayouts: {}, trim: null,
    fuente: { ...FUENTE, tieneAudio: false }, opciones: {}
  });
  assert.strictEqual(plan.ok, true);
  assert.ok(plan.avisos.some((a) => /sin sonido/i.test(a)));
});

// ------------------------------------------------------------------
test('el SRT se remapea al tiempo de salida, no al original', () => {
  const blocks = [
    { start: 0, end: 5, status: 'keep', type: 'speech', text: 'primero' },
    { start: 5, end: 10, status: 'cut', type: 'silence' },
    { start: 10, end: 15, status: 'keep', type: 'speech', text: 'segundo' }
  ];
  const plan = planificarExportacion({
    blocks,
    clips: [clip('c1', 0, 30, 0, RECT_COMPLETO)],
    cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  const srt = srtDeSalida(blocks, plan.segmentos);
  // "segundo" ocurre en 10s del original pero en 5s de la salida.
  assert.match(srt, /00:00:05,000 --> 00:00:10,000\nsegundo/);
  assert.ok(!srt.includes('00:00:10,000 --> 00:00:15,000'));
});

test('el SRT omite los bloques cortados', () => {
  const blocks = [{ start: 0, end: 5, status: 'cut', type: 'speech', text: 'muletilla' }];
  const plan = planificarExportacion({
    blocks: [...blocks, { start: 5, end: 10, status: 'keep', type: 'speech', text: 'bueno' }],
    clips: [clip('c1', 0, 30, 0, RECT_COMPLETO)],
    cellLayouts: {}, trim: null, fuente: FUENTE, opciones: {}
  });
  const srt = srtDeSalida(
    [...blocks, { start: 5, end: 10, status: 'keep', type: 'speech', text: 'bueno' }],
    plan.segmentos
  );
  assert.ok(!srt.includes('muletilla'));
  assert.ok(srt.includes('bueno'));
});

// ------------------------------------------------------------------
test('el filtro de una sola fuente a pantalla completa evita el overlay', () => {
  const seg = {
    dur: 5, fuentes: [{ recorte: { x: 0, y: 0, w: 1080, h: 1080 }, destino: { x: 0, y: 0, w: 1080, h: 1920 } }]
  };
  const f = filtroSegmento(seg, { ancho: 1080, alto: 1920, fps: 30 });
  assert.ok(f.includes('crop=') && f.includes('scale='));
  assert.ok(!f.includes('overlay'), 'no deberia usar overlay en el caso simple');
});

test('el filtro de dos fuentes usa lienzo negro y overlays', () => {
  const seg = {
    dur: 5,
    fuentes: [
      { recorte: { x: 0, y: 0, w: 540, h: 960 }, destino: { x: 0, y: 0, w: 1080, h: 960 } },
      { recorte: { x: 540, y: 0, w: 540, h: 960 }, destino: { x: 0, y: 960, w: 1080, h: 960 } }
    ]
  };
  const f = filtroSegmento(seg, { ancho: 1080, alto: 1920, fps: 30 });
  assert.ok(f.includes('color=c=black'));
  assert.strictEqual((f.match(/overlay=/g) || []).length, 2);
  assert.ok(f.includes('[vout]'));
});

test('argsSegmento pone -ss antes de -i (busqueda rapida) y pide progreso', () => {
  const seg = {
    srcStart: 12.5, dur: 3,
    fuentes: [{ recorte: { x: 0, y: 0, w: 1080, h: 1080 }, destino: { x: 0, y: 0, w: 1080, h: 1920 } }]
  };
  const args = argsSegmento(seg, '/videos/a.mp4', { ancho: 1080, alto: 1920, fps: 30, crf: 20, preset: 'medium', bitrateAudio: '192k' }, 'seg_0000.mp4', true);
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
  assert.strictEqual(args[args.indexOf('-ss') + 1], '12.500');
  assert.ok(args.includes('-progress'));
  assert.strictEqual(args[args.length - 1], 'seg_0000.mp4');
});

test('argsSegmento usa -an cuando la fuente no tiene audio', () => {
  const seg = {
    srcStart: 0, dur: 3,
    fuentes: [{ recorte: { x: 0, y: 0, w: 1080, h: 1080 }, destino: { x: 0, y: 0, w: 1080, h: 1920 } }]
  };
  const args = argsSegmento(seg, '/videos/a.mp4', { ancho: 1080, alto: 1920, fps: 30, crf: 20, preset: 'medium', bitrateAudio: '192k' }, 'x.mp4', false);
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('-c:a'));
});
