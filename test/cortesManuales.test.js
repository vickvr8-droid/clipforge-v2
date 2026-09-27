// Tests del corte manual sobre la linea de tiempo (cutsBuilder.js,
// 05/08/2026). Pedido del user: cortar partes del video directo en la
// linea de tiempo, como en cualquier editor.
//
// Lo que estos tests cuidan sobre todo es el caso que NO es obvio: los
// bloques no particionan el video. buildBlocks() mezcla habla y silencios,
// que son 2 analisis independientes del mismo audio - se solapan y dejan
// huecos. Un corte que cae sobre un hueco no tiene ningun bloque que
// marcar, y sin los bloques 'manual' de relleno no cortaria nada.

const test = require('node:test');
const assert = require('node:assert');

const {
  dividirEnTiempo, cortarRango, restaurarRango, summarize, buildBlocks,
  contarSugerencias, aplicarSugerencias, descartarSugerencias, silenciosASugerencias
} = require('../src/main/cutsBuilder');

const b = (id, start, end, extra = {}) => ({
  id, start, end, text: extra.text ?? 'hola que tal amigos', type: extra.type ?? 'speech', status: extra.status ?? 'keep'
});

// Suma cuanto tiempo queda cortado, fusionando solapes (mismo criterio
// que usa el plan de exportacion).
function duracionCortada(blocks) {
  const cut = blocks.filter((x) => x.status === 'cut').map((x) => [x.start, x.end]).sort((p, q) => p[0] - q[0]);
  let total = 0, finAnterior = -Infinity;
  for (const [s, e] of cut) {
    const ini = Math.max(s, finAnterior);
    if (e > ini) { total += e - ini; finAnterior = e; }
  }
  return total;
}

// ============================================================
// 1. DIVIDIR
// ============================================================

test('dividir parte en dos el bloque que cruza el instante', () => {
  const out = dividirEnTiempo([b('b1', 0, 10)], 4);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual([out[0].start, out[0].end], [0, 4]);
  assert.deepStrictEqual([out[1].start, out[1].end], [4, 10]);
  assert.notStrictEqual(out[0].id, out[1].id, 'las 2 mitades no pueden compartir id');
});

test('dividir NO toca un bloque que apenas roza el instante', () => {
  const blocks = [b('b1', 0, 10), b('b2', 10, 20)];
  assert.strictEqual(dividirEnTiempo(blocks, 10).length, 2, 'el borde exacto no parte nada');
  assert.strictEqual(dividirEnTiempo(blocks, 25).length, 2, 'fuera de rango tampoco');
});

test('al partir un silencio se recalcula su duracion en la etiqueta', () => {
  const out = dividirEnTiempo([b('s1', 0, 10, { type: 'silence', text: '[silencio 10s]', status: 'cut' })], 3);
  assert.match(out[0].text, /\[silencio 3s\]/);
  assert.match(out[1].text, /\[silencio 7s\]/);
});

test('el texto se reparte entre las mitades, sin duplicarse', () => {
  const out = dividirEnTiempo([b('b1', 0, 10, { text: 'uno dos tres cuatro' })], 5);
  assert.strictEqual(out[0].text, 'uno dos');
  assert.strictEqual(out[1].text, 'tres cuatro');
});

// ============================================================
// 2. CORTAR UN RANGO
// ============================================================

test('cortar un rango marca lo de adentro y respeta lo de afuera', () => {
  const out = cortarRango([b('b1', 0, 30)], 10, 20);
  const cortados = out.filter((x) => x.status === 'cut');
  assert.strictEqual(cortados.length, 1);
  assert.deepStrictEqual([cortados[0].start, cortados[0].end], [10, 20]);
  assert.strictEqual(duracionCortada(out), 10, 'se cortan exactamente los 10s pedidos');
  assert.strictEqual(out.filter((x) => x.status === 'keep').length, 2, 'quedan los 2 pedazos de los costados');
});

test('cortar sobre un HUECO sin bloques igual corta (bloque manual de relleno)', () => {
  // Dos bloques con un hueco de 10s entre medio (30-40): el caso real que
  // se da cuando ni whisper ni silencedetect marcaron nada en ese tramo.
  const blocks = [b('b1', 0, 30), b('b2', 40, 60)];
  const out = cortarRango(blocks, 30, 40);
  assert.strictEqual(duracionCortada(out), 10, 'el hueco SI se corta');
  const manual = out.find((x) => x.type === 'manual');
  assert.ok(manual, 'se creo un bloque manual para cubrir el hueco');
  assert.deepStrictEqual([manual.start, manual.end], [30, 40]);
});

test('cortar un rango medio cubierto rellena solo la parte descubierta', () => {
  const blocks = [b('b1', 0, 15)];          // cubre 10-15 del rango pedido
  const out = cortarRango(blocks, 10, 25);  // 15-25 esta descubierto
  assert.strictEqual(duracionCortada(out), 15, 'los 15s completos quedan cortados');
  const manuales = out.filter((x) => x.type === 'manual');
  assert.strictEqual(manuales.length, 1);
  assert.deepStrictEqual([manuales[0].start, manuales[0].end], [15, 25], 'solo el tramo que faltaba');
});

test('cortar con bloques SOLAPADOS no cuenta el solape dos veces', () => {
  // habla y silencio pisandose, tal cual los arma buildBlocks()
  const blocks = [
    b('b1', 10, 20, { type: 'speech' }),
    b('b2', 15, 25, { type: 'silence', text: '[silencio 10s]', status: 'cut' })
  ];
  const out = cortarRango(blocks, 10, 25);
  assert.strictEqual(duracionCortada(out), 15, 'de 10 a 25 son 15s, no 20');
});

test('un rango invalido (fin <= inicio) no cambia nada', () => {
  const blocks = [b('b1', 0, 30)];
  assert.strictEqual(cortarRango(blocks, 20, 20), blocks);
  assert.strictEqual(cortarRango(blocks, 20, 10), blocks);
});

test('el corte manual se refleja en el resumen que ve el user', () => {
  const antes = summarize([b('b1', 0, 100)]);
  assert.strictEqual(antes.porcentajeEliminado, 0);
  const despues = summarize(cortarRango([b('b1', 0, 100)], 20, 45));
  assert.strictEqual(despues.porcentajeEliminado, 25, '25 de 100 segundos');
  assert.strictEqual(despues.keptDurationSec, 75);
});

// ============================================================
// 3. DESHACER
// ============================================================

test('restaurar deshace el corte y saca los bloques manuales', () => {
  const blocks = [b('b1', 0, 30), b('b2', 40, 60)];
  const cortado = cortarRango(blocks, 30, 40);
  assert.strictEqual(duracionCortada(cortado), 10);

  const restaurado = restaurarRango(cortado, 30, 40);
  assert.strictEqual(duracionCortada(restaurado), 0, 'no queda nada cortado');
  assert.strictEqual(restaurado.filter((x) => x.type === 'manual').length, 0, 'sin bloques manuales sueltos');
});

test('restaurar no toca lo que quedo fuera del rango', () => {
  const blocks = [b('b1', 0, 10), b('b2', 10, 20), b('b3', 20, 30)];
  const cortado = cortarRango(blocks, 0, 20);
  const restaurado = restaurarRango(cortado, 0, 10);
  assert.strictEqual(duracionCortada(restaurado), 10, 'sigue cortado 10-20');
  const b1 = restaurado.find((x) => x.start === 0);
  assert.strictEqual(b1.status, 'keep');
});

// ============================================================
// 4. INTEGRIDAD DE LA LINEA DE TIEMPO
// ============================================================

test('cortar nunca pierde ni inventa tiempo cubierto', () => {
  const blocks = [b('b1', 0, 20), b('b2', 20, 50), b('b3', 50, 80)];
  const cubiertoAntes = blocks.reduce((acc, x) => acc + (x.end - x.start), 0);
  const out = cortarRango(blocks, 15, 65);
  const cubiertoDespues = out.reduce((acc, x) => acc + (x.end - x.start), 0);
  assert.strictEqual(cubiertoDespues, cubiertoAntes, 'partir bloques no cambia el tiempo total cubierto');
});

test('todos los bloques resultantes tienen id unico', () => {
  let out = cortarRango([b('b1', 0, 100)], 10, 20);
  out = cortarRango(out, 30, 40);
  out = cortarRango(out, 50, 60);
  const ids = out.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(',')}`);
});

test('cortes encadenados suman bien (3 cortes de 10s = 30s)', () => {
  let out = [b('b1', 0, 100)];
  for (const [s, e] of [[10, 20], [30, 40], [50, 60]]) out = cortarRango(out, s, e);
  assert.strictEqual(duracionCortada(out), 30);
  assert.strictEqual(summarize(out).keptDurationSec, 70);
});

// ============================================================
// 5. SUGERENCIAS DE CORTE (05/08/2026)
// ============================================================
// Pedido del user: "no me gusta que haya cortes automaticos, quiero que
// sean opcionales". Antes, transcribir dejaba los silencios YA cortados
// (224 cortes aplicados solos en una grabacion de 59min). Ahora entran
// como 'propuesta': se ven, pero no tocan el video hasta que se acepten.

test('los silencios detectados entran como SUGERENCIA, no cortados', () => {
  const blocks = buildBlocks(
    [{ start: 0, end: 5, text: 'hola' }],
    [{ start: 5, end: 8, duration: 3 }]
  );
  const silencio = blocks.find((x) => x.type === 'silence');
  assert.strictEqual(silencio.status, 'propuesta', 'no se corta solo');
  assert.strictEqual(contarSugerencias(blocks), 1);
});

test('una sugerencia pendiente NO acorta el video exportado', () => {
  const blocks = buildBlocks(
    [{ start: 0, end: 5, text: 'hola' }],
    [{ start: 5, end: 10, duration: 5 }]
  );
  assert.strictEqual(summarize(blocks).porcentajeEliminado, 0, 'nada eliminado hasta aceptarla');
  assert.strictEqual(summarize(aplicarSugerencias(blocks)).porcentajeEliminado, 50, 'aceptada si corta');
});

test('una alucinacion marcada por el motor SI entra cortada', () => {
  // Este caso no cambia: si el propio motor marca el segmento como
  // repeticion espuria, se corta como antes.
  const blocks = buildBlocks([{ start: 0, end: 5, text: 'eh eh eh', posible_alucinacion: true }], []);
  assert.strictEqual(blocks[0].status, 'cut');
});

test('aceptar y descartar sugerencias en bloque', () => {
  const blocks = buildBlocks([{ start: 0, end: 5, text: 'hola' }], [{ start: 5, end: 8, duration: 3 }]);
  assert.strictEqual(contarSugerencias(aplicarSugerencias(blocks)), 0, 'ya no quedan pendientes');
  assert.strictEqual(aplicarSugerencias(blocks).find((x) => x.type === 'silence').status, 'cut');
  assert.strictEqual(descartarSugerencias(blocks).find((x) => x.type === 'silence').status, 'keep');
});

test('un proyecto viejo puede convertir sus cortes de silencio en sugerencias', () => {
  const viejo = [
    { id: 'b1', start: 0, end: 5, text: 'hola', type: 'speech', status: 'keep' },
    { id: 'b2', start: 5, end: 8, text: '[silencio 3s]', type: 'silence', status: 'cut' },
    { id: 'm1', start: 20, end: 30, text: '[corte manual]', type: 'manual', status: 'cut' }
  ];
  const revisable = silenciosASugerencias(viejo);
  assert.strictEqual(revisable.find((x) => x.id === 'b2').status, 'propuesta', 'el silencio pasa a revisable');
  assert.strictEqual(revisable.find((x) => x.id === 'm1').status, 'cut', 'el corte MANUAL no se desarma solo');
});

test('descartar sugerencias no toca los cortes ya decididos', () => {
  const blocks = [
    { id: 'b1', start: 0, end: 5, text: '', type: 'silence', status: 'propuesta' },
    { id: 'b2', start: 5, end: 10, text: '', type: 'manual', status: 'cut' }
  ];
  const out = descartarSugerencias(blocks);
  assert.strictEqual(out[0].status, 'keep');
  assert.strictEqual(out[1].status, 'cut', 'lo que el user ya corto sigue cortado');
});
