// Tests del ENCUADRE COMO CLIP DE AJUSTE y de la PODA DE PISTAS
// (07/08/2026).
//
// PEDIDO DEL USER:
//   "hay que rehacer como funciona las pistas de la linea de tiempo. los
//    clips junto a todo lo que pueda ir dentro de la pista son aparte de
//    la pista en si, la pista es aparte, asi arregla el problema que ahora
//    la pista de los encuadres no se puede mezclar con las de video,
//    tambien asi hace que si una pista se queda vacia se elimina (...)
//    permite 'agarrar' un clip y moverlo libremente en otra pista, sin
//    contar la pista de audio claro"
//
// El encuadre dejo de ser un sistema paralelo (`recuadros.js`, con su
// propio campo `track` y su propia banda) y paso a ser un ELEMENTO del
// montaje: un adjustment clip / FX cut. Lo que estos tests cuidan:
//
//   - un encuadre se mueve, se corta y se recorta como cualquier clip,
//     porque ES un elemento de una pista normal;
//   - un ajuste NO tiene imagen propia: no tapa lo que tiene abajo;
//   - un ajuste se coloca ARRIBA de lo que recorta, o no significa nada;
//   - derivar un elemento de otro conserva TODOS sus campos. Esto ya
//     estaba roto antes del encuadre (cortar un clip con escala devolvia
//     las mitades en escala 1) y no daba ningun error: solo se veia mal.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const G = require('../src/shared/geometria916');

// Montaje con una pista visual, una de audio y un material de 60s.
function base() {
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, {
    ruta: '/x/a.mp4', nombre: 'a.mp4', duracion: 60, ancho: 1920, alto: 1080
  });
  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  return { m, mediaId, v1, a1 };
}

const els = (m, pistaId) => M.elementosDePista(m, pistaId);
const clipsDe = (m, pistaId) => els(m, pistaId).filter((e) => e.tipo === 'clip');
const ajustes = (m) => m.pistas.flatMap((p) =>
  p.elementos.filter(M.esAjuste).map((el) => ({ pistaId: p.id, el })));

const RECT = { xPct: 0.2, yPct: 0.1, wPct: 0.4, hPct: 0.8 };

// ============================================================
// EL ENCUADRE ES UN ELEMENTO DE UNA PISTA NORMAL
// ============================================================

test('un encuadre vive en una pista normal, no en una banda aparte', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));

  let info;
  [m, info] = M.colocarEncuadre(m, 2, 5, RECT);

  const pista = M.pistaPorId(m, info.pistaId);
  assert.ok(pista, 'el encuadre quedo en una pista del montaje');
  assert.notStrictEqual(pista.tipo, 'audio');
  const el = pista.elementos.find((x) => x.id === info.clipId);
  assert.ok(M.esAjuste(el));
  assert.strictEqual(el.tipo, 'clip', 'para todo lo demas es un clip');
});

test('el encuadre se coloca ARRIBA del material que recorta', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));

  let info;
  [m, info] = M.colocarEncuadre(m, 0, 10, RECT);

  const visuales = m.pistas.filter(M.esVisual).map((p) => p.id);
  assert.ok(visuales.indexOf(info.pistaId) > visuales.indexOf(v1),
    'un ajuste debajo del video no recortaria nada');
});

test('si no hay pista libre arriba, se crea', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  const antes = m.pistas.filter(M.esVisual).length;

  let info;
  [m, info] = M.colocarEncuadre(m, 0, 10, RECT);

  assert.strictEqual(m.pistas.filter(M.esVisual).length, antes + 1);
  assert.deepStrictEqual(info.pistasNuevas, [info.pistaId]);
});

test('dos encuadres que no se pisan en el tiempo comparten pista', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 30));

  let a, b;
  [m, a] = M.colocarEncuadre(m, 0, 5, RECT);
  [m, b] = M.colocarEncuadre(m, 10, 5, RECT);

  assert.strictEqual(b.pistaId, a.pistaId, 'hay lugar: no hace falta otra pista');
  assert.deepStrictEqual(b.pistasNuevas, []);
});

test('un encuadre se mueve a otra pista visual como cualquier clip', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 5, RECT);

  let v3;
  [m, v3] = M.agregarPista(m, 'video', 'V3');
  m = M.moverElemento(m, info.pistaId, info.clipId, 8, v3);

  const movido = clipsDe(m, v3).find((x) => x.id === info.clipId);
  assert.ok(movido, 'el encuadre llego a la pista nueva');
  assert.ok(Math.abs(movido.inicio - 8) < 1e-6);
  assert.deepStrictEqual(movido.ajuste.rect, M.acotarRect(RECT),
    'mover no le hace perder el recorte');
});

test('un encuadre NO puede bajar a la pista de audio', () => {
  let { m, mediaId, v1, a1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 5, RECT);

  m = M.moverElemento(m, info.pistaId, info.clipId, 3, a1);

  assert.strictEqual(clipsDe(m, a1).length, 0);
  assert.ok(clipsDe(m, info.pistaId).some((x) => x.id === info.clipId),
    'se queda donde estaba, movido en el tiempo');
});

test('cortar un encuadre da dos encuadres con el mismo recorte', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 10, RECT);

  m = M.cortarEn(m, info.pistaId, 4);

  const partes = clipsDe(m, info.pistaId);
  assert.strictEqual(partes.length, 2);
  partes.forEach((p) => {
    assert.ok(M.esAjuste(p), 'las dos mitades siguen siendo encuadres');
    assert.deepStrictEqual(p.ajuste.rect, M.acotarRect(RECT));
  });
  assert.ok(Math.abs(partes[0].duracion - 4) < 1e-6);
  assert.ok(Math.abs(partes[1].duracion - 6) < 1e-6);
});

test('recortar el borde de un encuadre cambia cuanto dura', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 10, RECT);

  // Un encuadre no sale de ningun archivo, asi que su borde no choca
  // contra "el material que existe" como el de un clip de video.
  m = M.recortar(m, info.pistaId, info.clipId, 'out', 6);

  const e = clipsDe(m, info.pistaId)[0];
  assert.ok(Math.abs(e.duracion - 6) < 1e-6);
  assert.ok(M.esAjuste(e));
});

test('dos encuadres pegados NO se unen (cada uno tiene su recorte)', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let a, b;
  [m, a] = M.colocarEncuadre(m, 0, 5, { xPct: 0, yPct: 0, wPct: 0.5, hPct: 1 });
  [m, b] = M.colocarEncuadre(m, 5, 5, { xPct: 0.5, yPct: 0, wPct: 0.5, hPct: 1 });
  assert.strictEqual(b.pistaId, a.pistaId);

  const salida = M.unirConSiguiente(m, a.pistaId, a.clipId);

  assert.strictEqual(clipsDe(salida, a.pistaId).length, 2);
});

test('ajustarEncuadre no deja el recorte fuera del frame', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 5, RECT);

  m = M.ajustarEncuadre(m, info.pistaId, info.clipId, { xPct: 0.95 });

  const r = clipsDe(m, info.pistaId)[0].ajuste.rect;
  assert.ok(r.xPct + r.wPct <= 1 + 1e-9, 'pegado al borde se corre, no se sale');
  assert.ok(Math.abs(r.wPct - 0.4) < 1e-9, 'y tampoco se encoge');
});

// ============================================================
// UN AJUSTE NO TIENE IMAGEN PROPIA
// ============================================================

test('composicionEn distingue las capas de material de las de ajuste', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 10, RECT);

  const capas = M.composicionEn(m, 5);

  assert.deepStrictEqual(capas.map((c) => c.clase), ['media', 'ajuste'],
    'de abajo hacia arriba: primero el video, despues el recorte');
  assert.deepStrictEqual(capas[1].rect, M.acotarRect(RECT));
});

test('un encuadre no tapa el video de abajo', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  [m] = M.colocarEncuadre(m, 0, 10, RECT);

  const capa = M.capaVisibleEn(m, 5);

  assert.ok(capa, 'sigue habiendo imagen');
  assert.strictEqual(capa.mediaId, mediaId);
});

test('encuadresEn devuelve los activos de abajo hacia arriba', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 30));
  let a, b;
  [m, a] = M.colocarEncuadre(m, 0, 10, { xPct: 0, yPct: 0, wPct: 0.5, hPct: 1 });
  // El segundo convive con el primero, asi que va a otra pista, mas arriba.
  [m, b] = M.colocarEncuadre(m, 0, 10, { xPct: 0.5, yPct: 0, wPct: 0.5, hPct: 1 });
  assert.notStrictEqual(b.pistaId, a.pistaId);

  const activos = M.encuadresEn(m, 5);

  assert.deepStrictEqual(activos.map((x) => x.clipId), [a.clipId, b.clipId]);
  assert.strictEqual(M.encuadresEn(m, 20).length, 0, 'fuera de su tramo no estan');
});

// Heredado de recuadros.test.js, que se fue con el modulo. La forma del
// dato (los cuatro porcentajes) se conservo EXACTAMENTE por esto: para
// que geometria916 no tuviera que cambiar ni traducir nada.
test('el rect de un encuadre lo entiende geometria916 sin traducir nada', () => {
  const e = M.encuadre(5, { xPct: 0.25, yPct: 0.1, wPct: 0.5, hPct: 0.5 });

  const rect = G.recorteCoverDeClip(e.ajuste.rect, 1920, 1080, 1080, 1920);

  assert.ok(rect.w > 0 && rect.h > 0, 'tiene que dar un recorte usable');
  assert.ok(!Number.isNaN(rect.x) && !Number.isNaN(rect.y));
  // El recorte "cover" para un destino vertical sale mas alto que ancho.
  assert.ok(rect.h > rect.w, `esperaba vertical, dio ${rect.w}x${rect.h}`);
  // Y nunca pide pixeles fuera del archivo.
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.w <= 1920 + 1e-6 && rect.y + rect.h <= 1080 + 1e-6);
});

// Bug encontrado el 07/08/2026 mirando el visor, no con un test: en un
// tramo con sonido pero sin imagen el visor tiraba "Cannot read
// properties of undefined (reading 'escala')". La capa de audio no traia
// `transformacion` y quien la recibia no tenia como distinguirla de una
// de imagen. Es un caso NORMAL, no un borde: las dos pistas son
// independientes y un vacio de video no implica silencio.
test('la capa de audio tiene la misma forma que una de imagen', () => {
  let { m, mediaId, v1, a1 } = base();
  m = M.sobrescribirEn(m, a1, 0, M.clip(mediaId, 0, 20));

  const capa = M.capaDeAudioEn(m, 5);

  assert.ok(capa, 'hay sonido aunque no haya imagen');
  assert.strictEqual(M.capaVisibleEn(m, 5), null, 'y efectivamente no hay imagen');
  assert.deepStrictEqual(capa.transformacion, M.TRANSFORMACION_BASE);
  assert.strictEqual(capa.clase, 'audio');
});

// ============================================================
// DERIVAR CONSERVA TODOS LOS CAMPOS
// (bug que ya existia antes del encuadre y no daba error)
// ============================================================

test('cortar un clip con escala deja las dos mitades con la misma escala', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  const c = clipsDe(m, v1)[0];
  m = M.transformar(m, v1, c.id, { escala: 1.5, x: 0.1 });

  m = M.cortarEn(m, v1, 8);

  const partes = clipsDe(m, v1);
  assert.strictEqual(partes.length, 2);
  partes.forEach((p) => {
    assert.strictEqual(M.transformacionDe(p).escala, 1.5);
    assert.strictEqual(M.transformacionDe(p).x, 0.1);
  });
});

test('lo que sobrevive a una sobrescritura conserva su escala', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 20));
  const c = clipsDe(m, v1)[0];
  m = M.transformar(m, v1, c.id, { escala: 2 });

  // Tapa el medio: quedan un pedazo a cada lado.
  m = M.sobrescribirEn(m, v1, 5, M.clip(mediaId, 30, 40));

  const sobrevivientes = clipsDe(m, v1).filter((x) => x.usadoIn < 30);
  assert.strictEqual(sobrevivientes.length, 2);
  sobrevivientes.forEach((p) => assert.strictEqual(M.transformacionDe(p).escala, 2));
});

test('mover un clip no le borra la escala', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  const c = clipsDe(m, v1)[0];
  m = M.transformar(m, v1, c.id, { escala: 0.5 });

  m = M.moverElemento(m, v1, c.id, 20);

  assert.strictEqual(M.transformacionDe(clipsDe(m, v1)[0]).escala, 0.5);
});

test('derivar no arrastra los campos calculados al modelo', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  const c = clipsDe(m, v1)[0];

  m = M.moverElemento(m, v1, c.id, 20);

  const guardado = M.pistaPorId(m, v1).elementos.find((x) => x.id === c.id);
  ['inicio', 'fin', 'indice', 'nombre'].forEach((campo) => {
    assert.ok(!(campo in guardado),
      `"${campo}" es calculado: guardarlo lo congela y miente al primer movimiento`);
  });
});

// ============================================================
// PODA DE PISTAS VACIAS
// ============================================================

test('una pista que queda vacia se elimina', () => {
  let { m, mediaId, v1 } = base();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));

  const podado = M.podarPistas(m);

  assert.ok(!M.pistaPorId(podado, v2), 'la vacia se fue');
  assert.ok(M.pistaPorId(podado, v1), 'la que tiene material se queda');
});

test('la poda conserva la ultima pista de cada grupo aunque este vacia', () => {
  const { m, v1, a1 } = base();

  const podado = M.podarPistas(m);

  assert.ok(M.pistaPorId(podado, v1), 'sin ninguna pista no habria donde soltar');
  assert.ok(M.pistaPorId(podado, a1));
});

test('podar no reordena: el audio sigue abajo', () => {
  let { m, mediaId, v1, a1 } = base();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v2, 0, M.clip(mediaId, 0, 10));
  m = M.sobrescribirEn(m, a1, 0, M.clip(mediaId, 0, 10));

  const podado = M.podarPistas(m);

  assert.deepStrictEqual(podado.pistas.map((p) => p.tipo), ['audio', 'video']);
});

test('podar sin nada que podar devuelve el MISMO montaje', () => {
  let { m, mediaId, v1, a1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  m = M.sobrescribirEn(m, a1, 0, M.clip(mediaId, 0, 10));

  // Identidad, no igualdad: el historial compara por referencia y si no,
  // cada operacion inocente dejaria un paso de deshacer que no hace nada.
  assert.strictEqual(M.podarPistas(m), m);
});

test('borrar el ultimo clip de una pista la deja vacia, y la poda la saca', () => {
  let { m, mediaId, v1 } = base();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  m = M.sobrescribirEn(m, v2, 0, M.clip(mediaId, 0, 10));
  const c = clipsDe(m, v2)[0];

  // TANDA E (ripple multipista): este test usaba borrarConRipple. Ahora un
  // ripple que nace en V2 con material de V1 en el mismo tramo se frena
  // (decision E4: no se come la entrevista de abajo). Lo que prueba este
  // test es la poda, asi que borra con Supr comun: el vacio que queda al
  // final de la pista no se sostiene y la pista queda vacia igual.
  assert.strictEqual(M.borrarConRipple(m, v2, c.id), m, 'el ripple en V2 no se come V1');
  m = M.podarPistas(M.borrar(m, v2, c.id));

  assert.ok(!M.pistaPorId(m, v2));
});

// ============================================================
// MIGRACION DE LOS RECUADROS VIEJOS
// ============================================================

const VIEJOS = [
  { id: 'r1', start: 0, end: 5, track: 0, xPct: 0, yPct: 0, wPct: 0.5, hPct: 1 },
  { id: 'r2', start: 8, end: 12, track: 0, xPct: 0.5, yPct: 0, wPct: 0.5, hPct: 1 },
  { id: 'r3', start: 0, end: 5, track: 1, xPct: 0.25, yPct: 0, wPct: 0.5, hPct: 0.5 }
];

test('los recuadros guardados por la version vieja se vuelven encuadres', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 30));

  m = M.migrarRecuadros(m, VIEJOS);

  const todos = ajustes(m);
  assert.strictEqual(todos.length, 3);
  const r1 = todos.find((x) => x.el.id === 'r1');
  assert.ok(r1);
  assert.deepStrictEqual(r1.el.ajuste.rect, M.acotarRect(VIEJOS[0]));
});

test('el campo track viejo se vuelve el orden de las pistas', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 30));

  m = M.migrarRecuadros(m, VIEJOS);

  const de = (id) => ajustes(m).find((x) => x.el.id === id).pistaId;
  assert.strictEqual(de('r1'), de('r2'), 'mismo track viejo, misma pista');
  const orden = m.pistas.filter(M.esVisual).map((p) => p.id);
  assert.ok(orden.indexOf(de('r3')) > orden.indexOf(de('r1')),
    'track 1 iba encima de track 0 en el panel 9:16');
});

test('migrar dos veces no duplica los encuadres', () => {
  let { m, mediaId, v1 } = base();
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 30));

  m = M.migrarRecuadros(m, VIEJOS);
  const otraVez = M.migrarRecuadros(m, VIEJOS);

  assert.strictEqual(ajustes(otraVez).length, 3);
  assert.strictEqual(otraVez, m, 'ni siquiera arma un montaje nuevo');
});

test('un proyecto sin recuadros no cambia al migrar', () => {
  const { m } = base();
  assert.strictEqual(M.migrarRecuadros(m, []), m);
  assert.strictEqual(M.migrarRecuadros(m, null), m);
});
