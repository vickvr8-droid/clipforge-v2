// Tests de MOVER UN CLIP (06/08/2026).
//
// BUG REAL REPORTADO EN VIDEO: el user grabo ClipForge al lado de DaVinci
// y se ve que cada "Clip movido" ALARGA el montaje la duracion del clip
// movido: 11:25 -> 21:42 -> 31:55 -> 42:27 -> 45:00, sobre un archivo que
// dura 11:25. Cuatro arrastres y la linea de tiempo cuadruplico su largo,
// llena de vacios enormes.
//
// CAUSA: moverElemento dejaba un hueco de la duracion completa en el
// origen (bien, eso hace cualquier editor) pero en el destino INSERTABA,
// empujando a la derecha todo lo que hubiera. Sacar N segundos y agregar
// N segundos en otro lado deja el total igual solo si el destino
// SOBRESCRIBE; insertando, el total crece N cada vez.
//
// Los editores reales (DaVinci, Premiere, Kdenlive) tratan el arrastre de
// un clip como OVERWRITE: el clip aterriza encima de lo que haya. Insertar
// empujando es otra operacion distinta, y va con otro gesto.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

// Cuatro clips de 100s pegados: montaje de 400s, como el caso del video
// (un archivo cortado en varios pedazos, sin vacios todavia).
function armar() {
  let m = M.crearMontaje();
  let mediaId, v1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'D:/x.mp4', nombre: 'x.mp4', tipo: 'video', duracion: 400 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  for (let i = 0; i < 4; i++) {
    [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: i * 100, usadoOut: (i + 1) * 100 });
  }
  return { m, v1, mediaId };
}

const ids = (m, v1) => M.elementosDePista(m, v1).map((e) => e.id);
const mapa = (m, v1) => M.elementosDePista(m, v1)
  .map((e) => `${e.tipo}@${e.inicio.toFixed(0)}-${e.fin.toFixed(0)}`).join(' ');

// ============================================================
// EL BUG DEL VIDEO
// ============================================================

test('mover un clip NO alarga el montaje', () => {
  const { m, v1 } = armar();
  const antes = M.duracionMontaje(m);
  assert.strictEqual(antes, 400);

  const segundo = M.elementosDePista(m, v1)[1].id;
  const movido = M.moverElemento(m, v1, segundo, 250);

  assert.strictEqual(M.duracionMontaje(movido), 400,
    `el montaje crecio al mover: ${mapa(movido, v1)}`);
});

test('cuatro movimientos seguidos tampoco lo alargan (el caso grabado)', () => {
  let { m, v1 } = armar();
  const destinos = [250, 100, 300, 0];
  for (const t of destinos) {
    const alguno = M.elementosDePista(m, v1).find((e) => e.tipo === 'clip');
    m = M.moverElemento(m, v1, alguno.id, t);
    assert.strictEqual(M.duracionMontaje(m), 400,
      `crecio despues de mover a ${t}: ${mapa(m, v1)}`);
  }
});

// ============================================================
// QUE SIGNIFICA SOBRESCRIBIR
// ============================================================

test('el clip aterriza exactamente donde se lo suelta', () => {
  const { m, v1 } = armar();
  const cuarto = M.elementosDePista(m, v1)[3].id;
  const movido = M.moverElemento(m, v1, cuarto, 120);
  const el = M.elementosDePista(movido, v1).find((x) => x.id === cuarto);
  assert.ok(el, 'el clip movido deberia seguir existiendo');
  assert.ok(Math.abs(el.inicio - 120) < 1e-6, `aterrizo en ${el.inicio}, esperaba 120`);
  assert.ok(Math.abs(el.duracion - 100) < 1e-6, 'no deberia cambiar de duracion');
});

test('lo que queda debajo del clip se tapa, no se corre', () => {
  const { m, v1 } = armar();
  const els = M.elementosDePista(m, v1);
  const primero = els[0].id;      // ocupa 0..100
  const tercero = els[2].id;      // ocupa 200..300
  // El primero cae justo encima del tercero: el tercero desaparece.
  const movido = M.moverElemento(m, v1, primero, 200);
  assert.ok(!ids(movido, v1).includes(tercero),
    `el clip tapado deberia desaparecer: ${mapa(movido, v1)}`);
  assert.strictEqual(M.duracionMontaje(movido), 400);
});

test('el origen queda como vacio, no se cierra solo', () => {
  const { m, v1 } = armar();
  const segundo = M.elementosDePista(m, v1)[1].id;   // 100..200
  const movido = M.moverElemento(m, v1, segundo, 300);
  const enOrigen = M.elementosDePista(movido, v1).find((e) => Math.abs(e.inicio - 100) < 1e-6);
  assert.strictEqual(enOrigen.tipo, 'hueco', `esperaba un vacio en 100: ${mapa(movido, v1)}`);
  assert.ok(Math.abs(enOrigen.duracion - 100) < 1e-6, 'el vacio conserva el lugar del clip');
});

test('el material que se ve no cambia al mover (el clip lleva su ventana)', () => {
  const { m, v1 } = armar();
  const tercero = M.elementosDePista(m, v1)[2];      // material 200..300
  const movido = M.moverElemento(m, v1, tercero.id, 0);
  const el = M.elementosDePista(movido, v1).find((x) => x.id === tercero.id);
  assert.strictEqual(el.usadoIn, 200);
  assert.strictEqual(el.usadoOut, 300);
});

// ============================================================
// CASOS DE BORDE
// ============================================================

test('soltar mas alla del final si alarga, y rellena con un vacio', () => {
  const { m, v1 } = armar();
  const primero = M.elementosDePista(m, v1)[0].id;
  const movido = M.moverElemento(m, v1, primero, 600);
  const el = M.elementosDePista(movido, v1).find((x) => x.id === primero);
  assert.ok(Math.abs(el.inicio - 600) < 1e-6, `aterrizo en ${el.inicio}`);
  assert.strictEqual(M.duracionMontaje(movido), 700, 'ahora si tiene que crecer');
});

test('mover a otra pista no toca el largo de ninguna de las dos', () => {
  let { m, v1 } = armar();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  const segundo = M.elementosDePista(m, v1)[1].id;
  const movido = M.moverElemento(m, v1, segundo, 100, v2);

  assert.strictEqual(M.duracionPista(movido, v1), 400, 'la pista origen conserva su largo');
  const enV2 = M.elementosDePista(movido, v2).find((x) => x.id === segundo);
  assert.ok(enV2, 'el clip tiene que estar en V2');
  assert.ok(Math.abs(enV2.inicio - 100) < 1e-6);
  assert.strictEqual(M.duracionMontaje(movido), 400);
});

// DECISION, NO DESCUIDO (reportado por el user el 06/08/2026: "paso un
// recuadro sobre otro mas pequeño y el pequeño desaparece"). Un clip que
// queda ENTERAMENTE debajo de otro se destruye: eso es lo que significa
// sobrescribir, y es lo que hacen DaVinci, Premiere y Kdenlive. La
// alternativa (empujarlo) es la que hacia crecer el montaje sin control.
// Lo que SI se arreglo es que pasara en silencio: ahora el clip que va a
// quedar tapado se marca en rojo tachado mientras se arrastra, el cartel
// del arrastre avisa "⚠ tapa N clips", y al soltar el estado dice cuantos
// se eliminaron y que Ctrl+Z los devuelve.
test('un clip grande soltado encima de uno chico lo elimina (sobrescritura)', () => {
  let m = M.crearMontaje();
  let mediaId, v1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'D:/x.mp4', nombre: 'x.mp4', tipo: 'video', duracion: 1000 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 0, usadoOut: 200 });     // grande, 0..200
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 200, usadoOut: 250 });   // chico, 200..250

  const [grande, chico] = M.elementosDePista(m, v1);
  const movido = M.moverElemento(m, v1, grande.id, 180);   // tapa el chico entero

  assert.ok(!ids(movido, v1).includes(chico.id), 'el chico tapado se elimina');
  assert.ok(ids(movido, v1).includes(grande.id), 'el que se arrastro sobrevive');

  // Y se puede volver atras: el historial es el que hace esto reversible.
  const hist = M.registrar(M.crearHistorial(m), movido);
  assert.ok(ids(M.deshacer(hist).presente, v1).includes(chico.id),
    'deshacer tiene que devolver el clip tapado');
});

test('un clip que cae parcialmente encima de otro lo recorta, no lo borra entero', () => {
  const { m, v1 } = armar();
  const primero = M.elementosDePista(m, v1)[0].id;   // 0..100
  // Cae en 250: tapa la segunda mitad del tercero (200..300) y la primera
  // del cuarto (300..400).
  const movido = M.moverElemento(m, v1, primero, 250);
  const els = M.elementosDePista(movido, v1);
  assert.strictEqual(M.duracionMontaje(movido), 400, mapa(movido, v1));
  const tercero = els.find((e) => e.tipo === 'clip' && Math.abs(e.inicio - 200) < 1e-6);
  assert.ok(tercero, `deberia quedar el pedazo 200..250: ${mapa(movido, v1)}`);
  assert.ok(Math.abs(tercero.duracion - 50) < 1e-6, `quedo con ${tercero.duracion}, esperaba 50`);
});
