// Tests del VINCULO IMAGEN-SONIDO en las operaciones que lo rompian aunque
// vinculoAV.test.js estaba en verde (13/09/2026, tanda B, paso 3 de la
// hoja de ruta de D:\investigacion-clipforge\linea-de-tiempo\INFORME.md).
//
// vinculoAV.test.js cubre ripple/roll/slip/slide en el caso comodo (tres
// clips con material de sobra). La prueba aleatoria (propiedades.test.js)
// encontro que al lado de cada caso probado habia uno que desincronizaba:
// cerrar un vacio, unir, slide contra un vecino sin material, roll desde
// el borde izquierdo, mover un B-roll con sonido a otra pista y tapar a
// medias. Estos son los CASOS FIJOS de la hoja de ruta, uno por defecto,
// con el numero de hallazgo del INFORME.
//
// Ademas de la comprobacion puntual, cada test pasa el resultado por
// verificarMontaje: si la operacion dejo cualquier otro vinculo roto, falla.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

const cerca = (a, b) => Math.abs(a - b) < 1e-9;
const clips = (m, p) => M.elementosDePista(m, p).filter((x) => x.tipo === 'clip');
const huecos = (m, p) => M.elementosDePista(m, p).filter((x) => x.tipo === 'hueco');
const pistaDe = (m, tipo, n) => m.pistas.filter((p) => p.tipo === tipo)[n || 0].id;

// Sano en lo que importa aca: vinculos y estructura. Los pedazos cortos
// son del paso 6 y no aparecen en estos casos armados a mano.
function assertSano(m, contexto) {
  assert.deepStrictEqual(M.verificarMontaje(m).map((f) => `${f.tipo}: ${f.detalle}`), [], contexto);
}

// Tramos [inicio, fin] de los clips de una pista, para comparar de un vistazo.
const tramos = (m, p) => clips(m, p).map((c) => [+c.inicio.toFixed(6), +c.fin.toFixed(6)]);

// La entrevista: un video con sonido de 60 s puesto en la linea (V1 + A1
// vinculados) y cortado en 20 y 40 en todas las pistas.
function entrevista() {
  let m = M.crearMontaje();
  let media;
  [m, media] = M.agregarMedia(m, { ruta: '/x/entrevista.mp4', duracion: 60 });
  [m] = M.colocarMedia(m, media, 0);
  m = M.cortarTodasEn(m, 20);
  m = M.cortarTodasEn(m, 40);
  return { m, media, v1: pistaDe(m, 'video'), a1: pistaDe(m, 'audio') };
}

// ---------- (a) CERRAR UN VACIO (hallazgos 1, 14, 25, 34, 41) ----------

test('Supr y clic en el vacio: V1 y A1 quedan iguales y sincronizados', () => {
  const { m, v1, a1 } = entrevista();
  assertSano(m, 'montaje de partida');
  const borrado = M.borrar(m, v1, clips(m, v1)[1].id);
  assert.deepStrictEqual(tramos(borrado, v1), [[0, 20], [40, 60]]);
  assert.deepStrictEqual(tramos(borrado, a1), tramos(borrado, v1), 'Supr saca imagen y sonido');

  const cerrado = M.cerrarHueco(borrado, v1, huecos(borrado, v1)[0].id);
  assert.deepStrictEqual(tramos(cerrado, v1), [[0, 20], [20, 40]], 'el vacio se cerro');
  assert.deepStrictEqual(tramos(cerrado, a1), tramos(cerrado, v1), 'ANTES: A1 quedaba 20 s atrasado');
  assertSano(cerrado, 'despues de cerrar');
});

// TANDA E (paso 7, ripple multipista): este test decia lo contrario. Antes
// el B-roll de V2/A2 no participaba (no tenia vinculo con lo de detras) y
// el vacio de V1 se cerraba igual, dejando el B-roll sobre otra frase. Con
// el ripple multipista TODAS las pistas no bloqueadas se corren, y un clip
// con material que cruza el final del vacio frena el cierre (decision E2).
// Si el usuario bloquea las pistas del B-roll, vuelve a cerrarse como antes.
test('cerrar un vacio con un B-roll que cruza el final: no se cierra, salvo que sus pistas esten bloqueadas', () => {
  let { m, media, v1 } = entrevista();
  m = M.borrar(m, v1, clips(m, v1)[1].id);
  let otro;
  [m, otro] = M.agregarMedia(m, { ruta: '/x/broll.mp4', duracion: 30 });
  [m] = M.colocarMedia(m, otro, 30);   // V2 + A2 de 30 a 60, cruza el 40
  const v2 = pistaDe(m, 'video', 1);
  const a2 = pistaDe(m, 'audio', 1);
  const [igual, informe] = M.cerrarHuecoConInforme(m, v1, huecos(m, v1)[0].id);
  assert.strictEqual(igual, m, 'no se cierra nada');
  assert.ok(informe.bloqueo && [v2, a2].includes(informe.bloqueo.pistaId), 'el informe nombra la pista del B-roll');
  assert.strictEqual(informe.bloqueo.motivo, 'material');

  let trabado = M.actualizarPista(m, v2, { bloqueada: true });
  trabado = M.actualizarPista(trabado, a2, { bloqueada: true });
  const cerrado = M.cerrarHueco(trabado, v1, huecos(trabado, v1)[0].id);
  assert.deepStrictEqual(tramos(cerrado, v2), [[30, 60]], 'el B-roll bloqueado no se toca');
  assert.deepStrictEqual(tramos(cerrado, v1), [[0, 20], [20, 40]]);
  assertSano(cerrado, 'con B-roll');
  void media;
});

test('cerrar un vacio: se cierra lo que puedan TODAS las pistas que se corren', () => {
  let { m, media, v1, a1 } = entrevista();
  m = M.borrar(m, v1, clips(m, v1)[1].id);
  // Un audio suelto en A1 de 25 a 35: antes del 40 A1 solo tiene 5 s de
  // vacio. Se cierran 5 s en las dos, no 20 en V1.
  let voz;
  [m, voz] = M.agregarMedia(m, { ruta: '/x/voz.wav', tipo: 'audio', duracion: 100 });
  const parcial = M.sobrescribirEn(m, a1, 25, M.clip(voz, 0, 10));
  const cerrado = M.cerrarHueco(parcial, v1, huecos(parcial, v1)[0].id);
  assert.deepStrictEqual(tramos(cerrado, v1), [[0, 20], [35, 55]]);
  assert.deepStrictEqual(tramos(cerrado, a1), [[0, 20], [25, 35], [35, 55]]);
  assertSano(cerrado, 'cierre parcial');
  // Con el audio pegado al 40, A1 no tiene vacio: no se mueve nadie.
  const pegado = M.sobrescribirEn(m, a1, 30, M.clip(voz, 0, 10));
  assert.strictEqual(M.cerrarHueco(pegado, v1, huecos(pegado, v1)[0].id), pegado, 'mismo montaje: no hubo cambio');
  void media;
});

// ---------- (b) SLIDE CONTRA UN VECINO SIN MATERIAL (hallazgos 8, 42) ----------

test('slide +2 y -2 contra vecinos sin material: delta 0 y el largo no cambia', () => {
  let m = M.crearMontaje();
  let media;
  [m, media] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 30 });
  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  // El de antes usa el material hasta el FINAL; el de despues, desde el
  // PRINCIPIO. Ninguno puede crecer hacia el clip del medio.
  m = M.sobrescribirEn(m, v1, 0, M.clip(media, 20, 30));
  m = M.sobrescribirEn(m, v1, 10, M.clip(media, 10, 20));
  m = M.sobrescribirEn(m, v1, 20, M.clip(media, 0, 10));
  m = M.espejarEnAudio(m, v1, a1);
  const largo = M.duracionMontaje(m);
  const medio = clips(m, v1)[1];

  for (const d of [2, -2]) {
    const r = M.slide(m, v1, medio.id, d);
    assert.ok(cerca(M.duracionMontaje(r), largo), `slide ${d}: ANTES el montaje perdia ${d} s`);
    assert.ok(cerca(clips(r, v1)[1].inicio, 10), `slide ${d}: no se podia mover`);
    assertSano(r, `slide ${d}`);
  }
});

test('slide con material de un solo lado: se mueve hacia ese lado y la pareja acompana', () => {
  let m = M.crearMontaje();
  let media;
  [m, media] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 100 });
  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(media, 20, 30));     // puede crecer 70 por el final
  m = M.sobrescribirEn(m, v1, 10, M.clip(media, 50, 60));
  m = M.sobrescribirEn(m, v1, 20, M.clip(media, 0, 10));     // no puede crecer por el principio
  m = M.espejarEnAudio(m, v1, a1);
  const medio = clips(m, v1)[1];
  const adelante = M.slide(m, v1, medio.id, 3);
  assert.ok(cerca(clips(adelante, v1)[1].inicio, 13));
  const atras = M.slide(m, v1, medio.id, -3);
  assert.ok(cerca(clips(atras, v1)[1].inicio, 10), 'hacia atras el vecino de despues no puede crecer');
  assert.ok(cerca(M.duracionMontaje(atras), 30));
  assertSano(adelante, 'slide +3');
  assertSano(atras, 'slide -3');
});

// ---------- (c) UNIR (hallazgo 7) ----------

test('unir con doble clic une la imagen Y el sonido', () => {
  const { m, v1, a1 } = entrevista();
  const unido = M.unirConSiguiente(m, v1, clips(m, v1)[0].id);
  assert.deepStrictEqual(tramos(unido, v1), [[0, 40], [40, 60]]);
  assert.deepStrictEqual(tramos(unido, a1), [[0, 40], [40, 60]], 'ANTES: A1 seguia partido en 20');
  assertSano(unido, 'unido');
  // Y desde el audio tambien.
  const desdeAudio = M.unirConSiguiente(m, a1, clips(m, a1)[1].id);
  assert.deepStrictEqual(tramos(desdeAudio, v1), [[0, 20], [20, 60]]);
  assertSano(desdeAudio, 'unido desde A1');
});

test('unir un clip vinculado con uno suelto: no une nada', () => {
  let { m, v1, a1 } = entrevista();
  // Se le saca a mano el vinculo al segundo pedazo, en V1 y en A1 (como
  // queda despues de tapar solo una de las dos partes).
  const k = clips(m, v1)[1].vinculo;
  m = { ...m, pistas: m.pistas.map((p) => (p.id !== a1 ? p : {
    ...p, elementos: p.elementos.map((el) => (el.vinculo === k ? { ...el, vinculo: undefined } : el))
  })) };
  m = { ...m, pistas: m.pistas.map((p) => (p.id !== v1 ? p : {
    ...p, elementos: p.elementos.map((el) => (el.vinculo === k ? { ...el, vinculo: undefined } : el))
  })) };
  // Unir mezclaria un clip vinculado con uno suelto y dejaria la mitad
  // del sonido sin imagen que lo arrastre.
  assert.strictEqual(M.unirConSiguiente(m, v1, clips(m, v1)[0].id), m);
});

// ---------- (d) y (e) ROLL (hallazgos 12, 13) ----------

test('roll desde el borde in mueve el corte de la IZQUIERDA', () => {
  const { m, v1, a1 } = entrevista();
  const medio = clips(m, v1)[1];
  const r = M.roll(m, v1, medio.id, 18, 'in');
  assert.deepStrictEqual(tramos(r, v1), [[0, 18], [18, 40], [40, 60]], 'ANTES movia el corte del 40');
  assert.deepStrictEqual(tramos(r, a1), tramos(r, v1));
  assertSano(r, 'roll in');
  // Sin borde sigue siendo el de la derecha (lo que manda la interfaz al
  // agarrar el cuerpo del clip).
  const derecha = M.roll(m, v1, medio.id, 42);
  assert.deepStrictEqual(tramos(derecha, v1), [[0, 20], [20, 42], [42, 60]]);
});

test('roll contra un vacio recorta (el vacio absorbe) en las dos pistas', () => {
  let { m, v1, a1 } = entrevista();
  m = M.borrar(m, v1, clips(m, v1)[2].id);   // vacio de 40 a 60... se limpia: queda el final
  m = M.borrar(m, v1, clips(m, v1)[0].id);   // vacio de 0 a 20
  const unico = clips(m, v1)[0];
  const r = M.roll(m, v1, unico.id, 22, 'in');
  assert.deepStrictEqual(tramos(r, v1), [[22, 40]], 'ANTES no hacia nada');
  assert.deepStrictEqual(tramos(r, a1), [[22, 40]]);
  assertSano(r, 'roll contra vacio');
});

test('roll con el vecino de A1 que no es la pareja del vecino de V1: no se mueve', () => {
  // V1: [imagen 1][imagen 2]. A1: [sonido 1][audio suelto]. El sonido
  // de la imagen 2 quedo en A2. Mover el corte estiraria la imagen 2 y
  // achicaria el audio suelto, pero el sonido de la imagen 2 (en A2) no
  // se enteraria: desincroniza a alguien que no participa.
  let m = M.crearMontaje();
  let media, voz, v1, a1, a2;
  [m, media] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 100 });
  [m, voz] = M.agregarMedia(m, { ruta: '/x/voz.wav', tipo: 'audio', duracion: 100 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  [m, a2] = M.agregarPista(m, 'audio', 'A2');
  const k1 = M.nuevoVinculo(), k2 = M.nuevoVinculo();
  m = M.sobrescribirEn(m, v1, 0, M.clip(media, 0, 10, undefined, k1));
  m = M.sobrescribirEn(m, a1, 0, M.clip(media, 0, 10, undefined, k1));
  m = M.sobrescribirEn(m, v1, 10, M.clip(media, 30, 40, undefined, k2));
  m = M.sobrescribirEn(m, a2, 10, M.clip(media, 30, 40, undefined, k2));
  m = M.sobrescribirEn(m, a1, 10, M.clip(voz, 0, 10));
  assertSano(m, 'de partida');
  assert.strictEqual(M.roll(m, v1, clips(m, v1)[0].id, 12), m);
});

// ---------- (f) MOVER CON LA PAREJA Y TAPAR (hallazgos 2, 3, 43) ----------

test('B-roll con sonido a V2 en t=25: la voz de A1 queda intacta y su sonido va a otra pista', () => {
  let m = M.crearMontaje();
  let voz, broll;
  [m, voz] = M.agregarMedia(m, { ruta: '/x/entrevista.mp4', duracion: 60 });
  [m, broll] = M.agregarMedia(m, { ruta: '/x/broll.mp4', duracion: 20 });
  [m] = M.colocarMedia(m, voz, 0);
  let info;
  [m, info] = M.colocarMedia(m, broll, 60);   // cae detras, en V1/A1
  const v1 = info.pistaId, a1 = info.pistaAudio;
  const [conV2, v2] = M.agregarPista(m, 'video', 'V2');

  const [r, informe] = M.moverConInforme(conV2, v1, info.clipId, 25, v2);
  assert.deepStrictEqual(tramos(r, v1), [[0, 60]], 'la imagen de la entrevista no se toca');
  assert.deepStrictEqual(tramos(r, a1), [[0, 60]], 'ANTES: la voz perdia de 25 a 45');
  assert.deepStrictEqual(tramos(r, v2), [[25, 45]]);
  assert.strictEqual(informe.pistaId, v2);
  assert.strictEqual(informe.parejas.length, 1);
  const a2 = informe.parejas[0].hacia;
  assert.notStrictEqual(a2, a1, 'el sonido del B-roll se corrio de pista');
  assert.deepStrictEqual(tramos(r, a2), [[25, 45]]);
  assert.strictEqual(clips(r, a2)[0].vinculo, clips(r, v2)[0].vinculo, 'y sigue vinculado');
  assert.strictEqual(informe.desvinculados, 0);
  assertSano(r, 'B-roll a V2');
  // moverElemento es el mismo movimiento sin informe.
  assert.deepStrictEqual(tramos(M.moverElemento(conV2, v1, info.clipId, 25, v2), a1), [[0, 60]]);
});

test('mover a una PISTA NUEVA lleva la pareja a una pista libre y no tapa la voz', () => {
  let m = M.crearMontaje();
  let voz, broll;
  [m, voz] = M.agregarMedia(m, { ruta: '/x/entrevista.mp4', duracion: 60 });
  [m, broll] = M.agregarMedia(m, { ruta: '/x/broll.mp4', duracion: 20 });
  [m] = M.colocarMedia(m, voz, 0);
  let info;
  [m, info] = M.colocarMedia(m, broll, 60);
  const r = M.moverAPistaNueva(m, info.pistaId, info.clipId, 10);
  assert.deepStrictEqual(tramos(r, info.pistaAudio), [[0, 60]]);
  assert.strictEqual(r.pistas.filter((p) => p.tipo === 'audio').length, 2);
  assertSano(r, 'a pista nueva');
});

test('mover tapando imagen Y sonido de un clip vinculado: los restos siguen vinculados', () => {
  let { m, media, v1, a1 } = entrevista();
  let broll;
  [m, broll] = M.agregarMedia(m, { ruta: '/x/broll.mp4', duracion: 5 });
  let info;
  [m, info] = M.colocarMedia(m, broll, 60);   // V1/A1 de 60 a 65
  // Se suelta en el medio del primer pedazo (0-20): en A1 lo que tapa es
  // justo el sonido de lo que tapa arriba, asi que la pareja va a A1.
  const [r, informe] = M.moverConInforme(m, v1, info.clipId, 8, null);
  assert.deepStrictEqual(tramos(r, v1), [[0, 8], [8, 13], [13, 20], [20, 40], [40, 60]]);
  assert.deepStrictEqual(tramos(r, a1), tramos(r, v1), 'la pareja fue a A1');
  assert.strictEqual(informe.parejas[0].hacia, a1);
  const [izqV, , derV] = clips(r, v1);
  const [izqA, , derA] = clips(r, a1);
  assert.ok(izqV.vinculo && izqV.vinculo === izqA.vinculo, 'ANTES el pedazo izquierdo perdia el vinculo');
  assert.ok(derV.vinculo && derV.vinculo === derA.vinculo, 'ANTES el pedazo derecho perdia el vinculo');
  assert.notStrictEqual(izqV.vinculo, derV.vinculo, 'dos pedazos del mismo clip no comparten vinculo');
  assert.strictEqual(informe.desvinculados, 0);
  assertSano(r, 'tapar imagen y sonido');
  // Y el vinculo sirve: borrar el resto derecho de la imagen saca su sonido.
  const borrado = M.borrar(r, v1, derV.id);
  assert.ok(!clips(borrado, a1).some((c) => c.id === derA.id));
  void media;
});

test('tapar SOLO la imagen de un clip vinculado: sus restos se desvinculan', () => {
  let { m, media, v1, a1 } = entrevista();
  let mudo;
  [m, mudo] = M.agregarMedia(m, { ruta: '/x/mudo.mp4', duracion: 5, tieneAudio: false });
  const r = M.sobrescribirEn(m, v1, 8, M.clip(mudo, 0, 5));
  // La imagen del primer pedazo quedo partida y el sonido entero: ya no
  // son la imagen y el sonido del mismo tramo. Un vinculo que miente es
  // peor que ninguno.
  const [izqV, , derV] = clips(r, v1);
  const sonido = clips(r, a1)[0];
  assert.ok(!izqV.vinculo && !derV.vinculo && !sonido.vinculo);
  assertSano(r, 'tapar solo la imagen');
  void media;
});

test('mover un clip con sonido encima de musica suelta: la musica no se borra', () => {
  let m = M.crearMontaje();
  let video, musica;
  [m, musica] = M.agregarMedia(m, { ruta: '/x/musica.mp3', tipo: 'audio', duracion: 60 });
  [m, video] = M.agregarMedia(m, { ruta: '/x/clip.mp4', duracion: 10 });
  const [conMusica, infoMusica] = M.colocarMedia(m, musica, 0);   // A1 0-60
  const [conClip, info] = M.colocarMedia(conMusica, video, 60);   // V1 60-70, sonido en A1 60-70
  assert.strictEqual(info.pistaAudio, infoMusica.pistaId);
  const [r, informe] = M.moverConInforme(conClip, info.pistaId, info.clipId, 5, null);
  assert.deepStrictEqual(tramos(r, infoMusica.pistaId), [[0, 60]], 'la musica sigue entera');
  assert.notStrictEqual(informe.parejas[0].hacia, infoMusica.pistaId);
  assertSano(r, 'sobre musica');
});
