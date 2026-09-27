// RIPPLE MULTIPISTA (13/09/2026, tanda E, paso 7 de la hoja de ruta de
// D:\investigacion-clipforge\linea-de-tiempo\INFORME.md).
//
// Antes borrar con ripple, ripple, cerrar un vacio e insertar corrian solo
// la pista del clip y su pareja: los encuadres 9:16 de V2 se quedaban
// quietos y pasaban a recortar otra frase (hallazgos 1 y 33). Ahora las
// cuatro sacan o abren el mismo tramo en todas las pistas no bloqueadas,
// con las reglas E1-E4 de DECISIONES.md:
//   E1 un encuadre que cruza el tramo se acorta (o se estira), no frena;
//   E2 material de otra pista en el tramo frena, y el informe nombra la pista;
//   E3 `pista.bloqueada` (candado) no se corre; ninguna nace bloqueada;
//   E4 un ripple que nace en V2+ sigue las mismas reglas.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

const clips = (m, p) => M.elementosDePista(m, p).filter((x) => x.tipo === 'clip');
const huecos = (m, p) => M.elementosDePista(m, p).filter((x) => x.tipo === 'hueco');
const pistaDe = (m, tipo, n) => m.pistas.filter((p) => p.tipo === tipo)[n || 0].id;
const tramos = (m, p) => clips(m, p).map((c) => [+c.inicio.toFixed(6), +c.fin.toFixed(6)]);
const cerca = (a, b) => Math.abs(a - b) < 1e-6;

function assertSano(m, contexto) {
  assert.deepStrictEqual(M.verificarMontaje(m).map((f) => `${f.tipo}: ${f.detalle}`), [], contexto);
}

// El caso del INFORME (hallazgo 33): V1/A1 con un clip de 0 a 10 (fuente
// 0-10) y otro de 10 a 30 (fuente 20-40), vinculados, a 30 fps.
function entrevista() {
  let m = M.crearMontaje({ fps: 30 });
  let media;
  [m, media] = M.agregarMedia(m, { ruta: '/x/entrevista.mp4', duracion: 100 });
  [m] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarPista(m, 'audio', 'A1');
  const v1 = pistaDe(m, 'video');
  const a1 = pistaDe(m, 'audio');
  const k1 = M.nuevoVinculo();
  const k2 = M.nuevoVinculo();
  m = M.sobrescribirEn(m, v1, 0, M.clip(media, 0, 10, null, k1));
  m = M.sobrescribirEn(m, a1, 0, M.clip(media, 0, 10, null, k1));
  m = M.sobrescribirEn(m, v1, 10, M.clip(media, 20, 40, null, k2));
  m = M.sobrescribirEn(m, a1, 10, M.clip(media, 20, 40, null, k2));
  return { m, media, v1, a1 };
}

// Un encuadre en su propia pista V2 (o la que se pida).
function conEncuadre(m, a, dur) {
  const [salida, info] = M.colocarEncuadre(m, a, dur);
  return { m: salida, v2: info.pistaId, eId: info.clipId };
}

const debajoDe = (m, t) => M.composicionEn(m, t).filter((c) => c.clase === 'media').pop();

test('Shift+Supr del primer clip: el encuadre 12-18 sigue sobre la misma fuente (tFuente 22)', () => {
  let { m, v1, a1 } = entrevista();
  let v2, eId;
  ({ m, v2, eId } = conEncuadre(m, 12, 6));
  assert.ok(cerca(debajoDe(m, 12).tFuente, 22), 'antes, en t=12 se ve la fuente 22');

  const [salida, informe] = M.borrarConRippleConInforme(m, v1, clips(m, v1)[0].id);
  assert.ok(!informe.bloqueo);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 20]]);
  assert.deepStrictEqual(tramos(salida, a1), [[0, 20]]);
  assert.deepStrictEqual(tramos(salida, v2), [[2, 8]], 'ANTES: el encuadre quedaba en 12-18');
  assert.strictEqual(M.encuadresEn(salida, 2)[0].clipId, eId);
  assert.ok(cerca(debajoDe(salida, 2).tFuente, 22), 'en t=2 recorta la fuente 22, igual que antes en t=12');
  assertSano(salida);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, salida), []);
});

test('encuadresQueCambiaronDeMaterial detecta el defecto viejo (ripple de una sola pista)', () => {
  let { m, v1, a1 } = entrevista();
  ({ m } = conEncuadre(m, 12, 6));
  const primero = clips(m, v1)[0].id;
  const primeroA = clips(m, a1)[0].id;
  // Lo que hacia borrarConRipple antes: sacar el clip de V1/A1 y nada mas.
  const viejo = {
    ...m,
    pistas: m.pistas.map((p) => ({ ...p, elementos: p.elementos.filter((x) => x.id !== primero && x.id !== primeroA) }))
  };
  const fallas = M.encuadresQueCambiaronDeMaterial(m, viejo);
  assert.ok(fallas.length > 0);
  assert.strictEqual(fallas[0].tipo, 'encuadreCambioDeMaterial');
});

test('E1: un encuadre 0-30 que cruza el tramo borrado queda 0-20 y no frena la operacion', () => {
  let { m, v1 } = entrevista();
  let v2;
  ({ m, v2 } = conEncuadre(m, 0, 30));
  const [salida, informe] = M.borrarConRippleConInforme(m, v1, clips(m, v1)[0].id);
  assert.ok(!informe.bloqueo, 'la correccion del critico: un encuadre largo no rechaza');
  assert.deepStrictEqual(tramos(salida, v1), [[0, 20]]);
  assert.deepStrictEqual(tramos(salida, v2), [[0, 20]]);
  assertSano(salida);
});

test('E1: un encuadre entero dentro de la frase borrada se va con ella', () => {
  let { m, v1 } = entrevista();
  let v2;
  ({ m, v2 } = conEncuadre(m, 2, 5));
  ({ m } = { m: M.colocarEncuadre(m, 15, 5, null, { pistaId: v2 })[0] });
  const salida = M.borrarConRipple(m, v1, clips(m, v1)[0].id);
  assert.deepStrictEqual(tramos(salida, v2), [[5, 10]], 'queda solo el de la segunda frase, corrido');
  assertSano(salida);
});

test('E2/E3: musica sin candado que cruza el tramo frena el borrado; con candado no se mueve', () => {
  let { m, v1, a1 } = entrevista();
  let musica;
  [m, musica] = M.agregarMedia(m, { ruta: '/x/musica.mp3', tipo: 'audio', duracion: 60 });
  let info;
  [m, info] = M.colocarMedia(m, musica, 0);
  const a2 = info.pistaId;
  assert.notStrictEqual(a2, a1);

  const [igual, informe] = M.borrarConRippleConInforme(m, v1, clips(m, v1)[0].id);
  assert.strictEqual(igual, m, 'no se borra nada');
  assert.deepStrictEqual(informe.bloqueo, { pistaId: a2, pistaNombre: M.pistaPorId(m, a2).nombre, motivo: 'material' });

  const trabado = M.actualizarPista(m, a2, { bloqueada: true });
  const salida = M.borrarConRipple(trabado, v1, clips(trabado, v1)[0].id);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 20]]);
  assert.deepStrictEqual(tramos(salida, a2), [[0, 60]], 'la musica bloqueada no se mueve');
  assertSano(salida);
});

test('E3: bloqueada es un campo opcional; destrabar lo saca', () => {
  const { m, v1 } = entrevista();
  assert.ok(!('bloqueada' in M.pistaPorId(m, v1)), 'ninguna pista nace bloqueada');
  const trabado = M.actualizarPista(m, v1, { bloqueada: 1 });
  assert.strictEqual(M.pistaPorId(trabado, v1).bloqueada, true);
  assert.ok(M.pistaBloqueada(M.pistaPorId(trabado, v1)));
  const destrabado = M.actualizarPista(trabado, v1, { bloqueada: false });
  assert.ok(!('bloqueada' in M.pistaPorId(destrabado, v1)));
  assert.strictEqual(M.VERSION, 1, 'no se sube VERSION');
});

test('las pistas del clip y su pareja se corren aunque esten bloqueadas', () => {
  let { m, v1, a1 } = entrevista();
  m = M.actualizarPista(m, a1, { bloqueada: true });
  const salida = M.borrarConRipple(m, v1, clips(m, v1)[0].id);
  assert.deepStrictEqual(tramos(salida, a1), [[0, 20]], 'el sonido del clip borrado es parte de la unidad');
  assertSano(salida);
});

test('un vinculo que quedaria partido por el candado frena la operacion', () => {
  let { m, v1, media } = entrevista();
  // B-roll con sonido en V2/A2 DESPUES del tramo, con A2 bloqueada y V2 no:
  // correr V2 y no A2 separaria la imagen de su sonido.
  let info;
  [m, info] = M.colocarMedia(m, media, 20);   // V1/A1 ocupados hasta 30: va a V2/A2
  const a2 = info.pistaAudio;
  const v2 = info.pistaId;
  assert.notStrictEqual(v2, v1);
  m = M.actualizarPista(m, a2, { bloqueada: true });
  const [igual, informe] = M.borrarConRippleConInforme(m, v1, clips(m, v1)[0].id);
  assert.strictEqual(igual, m);
  assert.strictEqual(informe.bloqueo.motivo, 'vinculo');
  assert.strictEqual(informe.bloqueo.pistaId, a2);
  // Con las dos bloqueadas queda quieto el B-roll entero y se puede.
  const ambas = M.actualizarPista(m, v2, { bloqueada: true });
  const salida = M.borrarConRipple(ambas, v1, clips(ambas, v1)[0].id);
  assert.deepStrictEqual(tramos(salida, v2), [[20, 120]]);
  assertSano(salida);
});

test('E4: un ripple que nace en V2 con material de V1 en el tramo se frena', () => {
  let { m, v1, media } = entrevista();
  let info;
  [m, info] = M.colocarMedia(m, media, 0, { pistaId: null });
  // colocarMedia busca lugar: V1 y A1 estan ocupados en 0-100, va a V2/A2.
  const v2 = info.pistaId;
  m = M.actualizarPista(m, info.pistaAudio, { bloqueada: true });
  const [igual, informe] = M.borrarConRippleConInforme(m, v2, clips(m, v2)[0].id);
  assert.strictEqual(igual, m, 'no se come la entrevista de abajo');
  assert.strictEqual(informe.bloqueo.pistaId, v1);
});

test('ripple del final del primer clip: el encuadre de la segunda frase se corre con ella', () => {
  let { m, v1, a1 } = entrevista();
  let v2;
  ({ m, v2 } = conEncuadre(m, 12, 6));
  const salida = M.ripple(m, v1, clips(m, v1)[0].id, 'out', 6);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 6], [6, 26]]);
  assert.deepStrictEqual(tramos(salida, a1), [[0, 6], [6, 26]]);
  assert.deepStrictEqual(tramos(salida, v2), [[8, 14]], 'ANTES: quieto en 12');
  assert.ok(cerca(debajoDe(salida, 8).tFuente, 22));
  assertSano(salida);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, salida), []);
});

test('ripple del inicio: el encuadre sobre el clip sigue al mismo cuadro de la fuente', () => {
  let { m, v1 } = entrevista();
  let v2;
  ({ m, v2 } = conEncuadre(m, 12, 6));
  // Se saca el principio del segundo clip hasta t=13 (fuente 20-23).
  const salida = M.ripple(m, v1, clips(m, v1)[1].id, 'in', 13);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 10], [10, 27]]);
  assert.deepStrictEqual(tramos(salida, v2), [[10, 15]], 'pierde lo que recortaba de la fuente 22-23');
  assert.ok(cerca(debajoDe(salida, 10).tFuente, 23));
  assert.ok(cerca(debajoDe(salida, 14.5).tFuente, 27.5), 'mismo cuadro que antes en t=17.5');
  assertSano(salida);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, salida), []);
});

test('ripple que ACHICA se frena donde empieza el material de otra pista (delta minimo comun)', () => {
  let { m, v1, a1 } = entrevista();
  let mudo;
  [m, mudo] = M.agregarMedia(m, { ruta: '/x/mudo.mp4', duracion: 6, tieneAudio: false });
  let info;
  [m, info] = M.colocarMedia(m, mudo, 2);   // V2 de 2 a 8
  const v2 = info.pistaId;
  const [salida, informe] = M.rippleConInforme(m, v1, clips(m, v1)[0].id, 'out', 6);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 8], [8, 28]], 'llega hasta el 8, no hasta el 6');
  assert.deepStrictEqual(tramos(salida, a1), [[0, 8], [8, 28]]);
  assert.deepStrictEqual(tramos(salida, v2), [[2, 8]]);
  assert.strictEqual(informe.bloqueo.pistaId, v2, 'el informe dice quien lo freno');
  assertSano(salida);
});

test('ripple que ALARGA: estira el encuadre que termina en el corte y corre el de despues', () => {
  let { m, v1 } = entrevista();
  let v2;
  ({ m, v2 } = conEncuadre(m, 0, 10));
  m = M.colocarEncuadre(m, 10, 5, null, { pistaId: v2 })[0];
  const salida = M.ripple(m, v1, clips(m, v1)[0].id, 'out', 12);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 12], [12, 32]]);
  assert.deepStrictEqual(tramos(salida, v2), [[0, 12], [12, 17]]);
  assertSano(salida);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, salida), []);
});

test('ripple que alarga con un clip de otra pista cruzando el corte: no hace nada', () => {
  let { m, v1 } = entrevista();
  let mudo;
  [m, mudo] = M.agregarMedia(m, { ruta: '/x/mudo.mp4', duracion: 6, tieneAudio: false });
  [m] = M.colocarMedia(m, mudo, 8);   // V2 de 8 a 14, cruza el 10
  const [igual, informe] = M.rippleConInforme(m, v1, clips(m, v1)[0].id, 'out', 12);
  assert.strictEqual(igual, m);
  assert.strictEqual(informe.bloqueo.motivo, 'material');
});

test('cerrar un vacio de V1 acorta el encuadre que lo cruza y corre el resto', () => {
  let { m, v1, a1 } = entrevista();
  m = M.borrar(m, v1, clips(m, v1)[0].id);   // vacio 0-10 en V1 y A1
  let v2;
  ({ m, v2 } = conEncuadre(m, 5, 10));        // 5-15: cruza el final del vacio
  const [salida, informe] = M.cerrarHuecoConInforme(m, v1, huecos(m, v1)[0].id);
  assert.ok(!informe.bloqueo);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 20]]);
  assert.deepStrictEqual(tramos(salida, a1), [[0, 20]]);
  assert.deepStrictEqual(tramos(salida, v2), [[0, 5]]);
  assertSano(salida);
});

test('hallazgo 34: cerrar un vacio de V2 con la entrevista debajo no corre el encuadre sobre otra frase', () => {
  let { m, v1 } = entrevista();
  let v2, eId;
  ({ m, v2, eId } = conEncuadre(m, 12, 6));
  const [igual, informe] = M.cerrarHuecoConInforme(m, v2, huecos(m, v2)[0].id);
  assert.strictEqual(igual, m, 'ANTES: el encuadre saltaba a 0-6');
  assert.strictEqual(informe.bloqueo.pistaId, v1);
  void eId;
});

test('insertar en medio de la entrevista abre el lugar en A1 y en los encuadres', () => {
  let { m, v1, a1, media } = entrevista();
  let v2;
  ({ m, v2 } = conEncuadre(m, 12, 6));
  const [salida, id] = M.insertarEn(m, v1, 5, media, { usadoIn: 50, usadoOut: 53 });
  assert.ok(id);
  assert.deepStrictEqual(tramos(salida, v1), [[0, 5], [5, 8], [8, 13], [13, 33]]);
  assert.deepStrictEqual(tramos(salida, a1), [[0, 5], [8, 13], [13, 33]], 'A1 se parte y se corre igual que V1');
  assert.deepStrictEqual(tramos(salida, v2), [[15, 21]]);
  assertSano(salida);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, salida, { ignorarClips: [id] }), []);
});

test('insertar dentro de un vacio lo pone donde se pidio, no al principio del vacio', () => {
  let { m, v1, media } = entrevista();
  m = M.borrar(m, v1, clips(m, v1)[0].id);   // vacio 0-10
  const [salida, id] = M.insertarEn(m, v1, 4, media, { usadoIn: 50, usadoOut: 52 });
  assert.ok(id);
  assert.deepStrictEqual(tramos(salida, v1), [[4, 6], [12, 32]]);
  assertSano(salida);
});

test('insertar con musica sin candado que cruza el punto: no inserta', () => {
  let { m, v1, media } = entrevista();
  let musica;
  [m, musica] = M.agregarMedia(m, { ruta: '/x/musica.mp3', tipo: 'audio', duracion: 60 });
  [m] = M.colocarMedia(m, musica, 0);
  const [igual, id, informe] = M.insertarEn(m, v1, 5, media, { usadoIn: 50, usadoOut: 53 });
  assert.strictEqual(igual, m);
  assert.strictEqual(id, null);
  assert.strictEqual(informe.bloqueo.motivo, 'material');
});

test('un proyecto guardado sin el campo bloqueada se corre entero (nada queda trabado)', () => {
  // Forma de proyecto.json de antes de la tanda E: pistas sin `bloqueada`.
  let { m, v1 } = entrevista();
  ({ m } = conEncuadre(m, 12, 6));
  const guardado = JSON.parse(JSON.stringify(m));
  assert.ok(guardado.pistas.every((p) => !('bloqueada' in p)));
  const salida = M.borrarConRipple(guardado, v1, clips(guardado, v1)[0].id);
  assertSano(salida);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(guardado, salida), []);
});

test('proyecto real TEST 1 (fixture): abre intacto y cada Shift+Supr deja el montaje sano y los encuadres sobre su frase', () => {
  const { montajeUtilizable, montajeInicial, migrarAudioVinculado, asegurarBaseDeCuadro } = require('../src/main/montajeGuardado');
  const viejo = require('./fixtures/proyecto-viejo-sin-fps.json');
  const guardado = JSON.parse(JSON.stringify(viejo.montaje));
  const fuente = { duracion: 824, ancho: 1920, alto: 1080, fps: 29.97, tieneVideo: true, tieneAudio: true };
  assert.ok(montajeUtilizable(guardado));
  const abierto = migrarAudioVinculado(montajeInicial(viejo.inputPath, fuente, guardado));
  assert.deepStrictEqual(abierto, viejo.montaje, 'la edicion guardada no cambia al abrir');
  const m = asegurarBaseDeCuadro(abierto, fuente);
  let aplicados = 0;
  m.pistas.forEach((p) => clips(m, p.id).forEach((c) => {
    const [salida, informe] = M.borrarConRippleConInforme(m, p.id, c.id);
    if (salida === m) { assert.ok(informe.bloqueo, `sin cambio y sin decir por que (${p.nombre} ${c.id})`); return; }
    aplicados++;
    const s = M.podarPistas(salida);
    assert.deepStrictEqual(M.verificarMontaje(s).map((f) => f.tipo), [], `${p.nombre} ${c.id}`);
    assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, s), [], `${p.nombre} ${c.id}`);
  }));
  assert.ok(aplicados > 0, 'alguno se tiene que poder borrar');
});
