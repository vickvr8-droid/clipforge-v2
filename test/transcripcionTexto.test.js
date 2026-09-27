// Tests de la EXPORTACION DE LA TRANSCRIPCION COMO TEXTO (cutsBuilder.js).
//
// POR QUE EXISTEN (06/08/2026): las 3 variantes de texto ya estaban
// escritas desde el 05/08/2026, pero al reescribir el renderer se perdio
// el boton de la variante plana y nadie noto que la funcion habia quedado
// inalcanzable. Con estos tests la diferencia entre las 3 variantes queda
// asentada como comportamiento esperado, no como detalle de una sesion:
//
//   final    -> con tiempos, SIN lo marcado para cortar
//   completo -> con tiempos, CON lo marcado para cortar
//   plano    -> sin tiempos, sin encabezado, todo lo dicho, en una linea
//
// En las 3 se excluyen los bloques type='silence': son huecos detectados
// por ffmpeg, no texto hablado.

const test = require('node:test');
const assert = require('node:assert');

const { blocksToTranscriptText, blocksToPlainText } = require('../src/main/cutsBuilder');

const bloques = () => ([
  { id: 'b1', start: 0, end: 2, text: 'hola  que tal', type: 'speech', status: 'keep' },
  { id: 'b2', start: 2, end: 3, text: '', type: 'silence', status: 'propuesta' },
  { id: 'b3', start: 3, end: 5, text: 'esto se corta', type: 'speech', status: 'cut' },
  { id: 'b4', start: 5, end: 7, text: 'lo ultimo', type: 'speech', status: 'propuesta' }
]);

// ============================================================
// TEXTO PLANO CONTINUO ("Solo texto")
// ============================================================

test('el texto plano no lleva marcas de tiempo ni encabezado', () => {
  const out = blocksToPlainText(bloques());
  assert.ok(!/\[\d/.test(out), 'no deberia haber timestamps');
  assert.ok(!/Transcripcion/i.test(out), 'no deberia haber encabezado');
  assert.ok(!/Generado/.test(out), 'no deberia haber fecha de generacion');
});

test('el texto plano incluye TODO lo dicho, tambien lo marcado para cortar', () => {
  const out = blocksToPlainText(bloques());
  assert.match(out, /hola que tal/);
  assert.match(out, /esto se corta/);   // status 'cut' igual entra
  assert.match(out, /lo ultimo/);       // status 'propuesta' tambien
});

test('el texto plano queda en una sola linea con espacios normalizados', () => {
  const out = blocksToPlainText(bloques());
  assert.strictEqual(out.trim(), 'hola que tal esto se corta lo ultimo');
  assert.ok(!out.trim().includes('\n'), 'deberia ser texto corrido');
  assert.ok(!/ {2}/.test(out), 'el doble espacio del bloque 1 deberia colapsar');
});

test('el texto plano ignora los silencios y no explota sin bloques', () => {
  assert.ok(!blocksToPlainText(bloques()).includes('undefined'));
  assert.strictEqual(blocksToPlainText([]).trim(), '');
  assert.strictEqual(blocksToPlainText(null).trim(), '');
});

// ============================================================
// LAS 3 VARIANTES SON DISTINTAS ENTRE SI
// ============================================================

test('"final" saca lo cortado, "completo" lo deja, "plano" tampoco lo saca', () => {
  const bs = bloques();
  const final = blocksToTranscriptText(bs, { soloKeep: true });
  const completo = blocksToTranscriptText(bs, { soloKeep: false });
  const plano = blocksToPlainText(bs);

  assert.ok(!final.includes('esto se corta'), 'el texto final no deberia traer lo cortado');
  assert.ok(completo.includes('esto se corta'));
  assert.ok(plano.includes('esto se corta'));

  // Una propuesta todavia NO esta cortada: entra en las 3.
  for (const v of [final, completo, plano]) assert.ok(v.includes('lo ultimo'));
});

test('las variantes con tiempo si llevan timestamp legible', () => {
  const out = blocksToTranscriptText(bloques(), { soloKeep: false });
  assert.match(out, /\[00:00\] hola/);
  assert.match(out, /\[00:05\] lo ultimo/);
});
