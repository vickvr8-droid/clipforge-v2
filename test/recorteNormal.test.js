// Tests del RECORTE NORMAL, el arrastre del borde de un clip (06/08/2026).
//
// BUG REPORTADO: "cuando agarro una esquina de un clip y lo arrastro para
// achicarlo todos los clips se mueven con el para llenar ese espacio; lo
// que deberia pasar es que ese espacio quede como un vacio".
//
// CAUSA: la interfaz mandaba SIEMPRE 'ripple' al arrastrar una manija.
// Ripple, por definicion, corre todo lo de atras para tapar el agujero -
// por eso es el unico modo que cambia el largo del montaje. El arrastre
// normal del borde no hace eso en ningun editor.
//
// LA DIFERENCIA, que es lo que estos tests fijan:
//   recorte : cambia el largo del CLIP. Nadie se mueve. Aparece un vacio.
//   ripple  : cambia el largo del clip Y del MONTAJE, corriendo el resto.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

// Tres clips de 100 pegados: 0..100, 100..200, 200..300.
function base() {
  let m = M.crearMontaje();
  let mediaId, v1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'E:/T.mov', nombre: 'T.mov', tipo: 'video', duracion: 300 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  for (let i = 0; i < 3; i++) {
    [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: i * 100, usadoOut: (i + 1) * 100 });
  }
  return { m, v1, mediaId };
}

const mapa = (m, v1) => M.elementosDePista(m, v1)
  .map((e) => `${e.tipo === 'hueco' ? 'vacio' : 'clip'}@${e.inicio.toFixed(0)}-${e.fin.toFixed(0)}`).join(' ');

// ============================================================
// ACHICAR DEJA UN VACIO Y NO MUEVE A NADIE
// ============================================================

test('achicar por el borde derecho deja un vacio y no corre nada', () => {
  const { m, v1 } = base();
  const segundo = M.elementosDePista(m, v1)[1];          // 100..200
  const out = M.recortar(m, v1, segundo.id, 'out', 160);  // lo achico 40

  assert.strictEqual(M.duracionMontaje(out), 300, `el montaje no deberia cambiar: ${mapa(out, v1)}`);
  const els = M.elementosDePista(out, v1);
  assert.strictEqual(els[1].fin, 160, 'el clip termina donde se solto');
  assert.strictEqual(els[2].tipo, 'hueco', `esperaba un vacio: ${mapa(out, v1)}`);
  assert.strictEqual(els[2].duracion, 40);
  assert.strictEqual(els[3].inicio, 200, 'el tercero NO se movio');
});

test('achicar por el borde izquierdo deja el vacio antes', () => {
  const { m, v1 } = base();
  const segundo = M.elementosDePista(m, v1)[1];
  const out = M.recortar(m, v1, segundo.id, 'in', 130);   // arranca 30 despues

  assert.strictEqual(M.duracionMontaje(out), 300, mapa(out, v1));
  const els = M.elementosDePista(out, v1);
  assert.strictEqual(els[1].tipo, 'hueco');
  assert.strictEqual(els[1].duracion, 30);
  assert.strictEqual(els[2].inicio, 130, 'el clip arranca donde se solto');
  assert.strictEqual(els[3].inicio, 200, 'el tercero sigue en su lugar');
});

test('achicar cambia QUE PARTE del material se ve, no solo el largo', () => {
  const { m, v1 } = base();
  const segundo = M.elementosDePista(m, v1)[1];           // material 100..200
  const out = M.recortar(m, v1, segundo.id, 'in', 130);
  const clip = M.elementosDePista(out, v1).find((x) => x.id === segundo.id);
  assert.strictEqual(clip.usadoIn, 130, 'recortar por el inicio adelanta el material');
  assert.strictEqual(clip.usadoOut, 200);
});

// ============================================================
// AGRANDAR: SE COME EL VACIO, NO PISA AL VECINO
// ============================================================

test('agrandar se come el vacio que dejo el recorte', () => {
  const { m, v1 } = base();
  const segundo = M.elementosDePista(m, v1)[1];
  const achicado = M.recortar(m, v1, segundo.id, 'out', 160);   // vacio de 40
  const devuelta = M.recortar(achicado, v1, segundo.id, 'out', 200);

  assert.strictEqual(M.duracionMontaje(devuelta), 300);
  const els = M.elementosDePista(devuelta, v1);
  assert.strictEqual(els.length, 3, `el vacio deberia haber desaparecido: ${mapa(devuelta, v1)}`);
  assert.strictEqual(els[1].fin, 200);
});

test('agrandar se frena contra el clip de al lado, no lo pisa', () => {
  const { m, v1 } = base();
  const segundo = M.elementosDePista(m, v1)[1];
  const out = M.recortar(m, v1, segundo.id, 'out', 280);   // no hay lugar

  assert.strictEqual(M.duracionMontaje(out), 300, mapa(out, v1));
  const els = M.elementosDePista(out, v1);
  assert.strictEqual(els.length, 3, 'no deberia haber creado ni borrado nada');
  assert.strictEqual(els[1].fin, 200, 'se queda donde estaba');
  assert.strictEqual(els[2].inicio, 200, 'el vecino sigue entero');
});

test('no se puede estirar mas alla del material que existe', () => {
  let m = M.crearMontaje();
  let mediaId, v1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'E:/T.mov', nombre: 'T.mov', tipo: 'video', duracion: 100 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 0, usadoOut: 60 });
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 0, usadoOut: 40 });
  const primero = M.elementosDePista(m, v1)[0];
  // Achico y despues intento estirar mucho mas de lo que da el archivo.
  let out = M.recortar(m, v1, primero.id, 'out', 30);
  out = M.recortar(out, v1, primero.id, 'out', 500);
  const clip = M.elementosDePista(out, v1).find((x) => x.id === primero.id);
  assert.ok(clip.usadoOut <= 100 + 1e-9, `pidio material que no existe: ${clip.usadoOut}`);
});

// ============================================================
// LA DIFERENCIA CON RIPPLE
// ============================================================

test('recorte NO cambia el largo del montaje; ripple SI', () => {
  const { m, v1 } = base();
  const segundo = M.elementosDePista(m, v1)[1];

  const conRecorte = M.recortar(m, v1, segundo.id, 'out', 160);
  const conRipple = M.ripple(m, v1, segundo.id, 'out', 160);

  assert.strictEqual(M.duracionMontaje(conRecorte), 300, 'recorte deja el montaje igual');
  assert.strictEqual(M.duracionMontaje(conRipple), 260, 'ripple lo acorta');

  // Y el tercer clip: con recorte se queda, con ripple se corre.
  assert.strictEqual(M.elementosDePista(conRecorte, v1)[3].inicio, 200);
  assert.strictEqual(M.elementosDePista(conRipple, v1)[2].inicio, 160);
});

// ============================================================
// AUDIO VINCULADO
// ============================================================

test('recortar el video recorta igual a su audio', () => {
  let m = M.crearMontaje();
  let mediaId, v1, a1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'E:/T.mov', nombre: 'T.mov', tipo: 'video', duracion: 300 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  const k = M.nuevoVinculo();
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 0, usadoOut: 200, vinculo: k });
  [m] = M.agregarAlFinal(m, a1, mediaId, { usadoIn: 0, usadoOut: 200, vinculo: k });

  const clipV = M.elementosDePista(m, v1)[0];
  const out = M.recortar(m, v1, clipV.id, 'out', 120);

  const finVideo = M.elementosDePista(out, v1)[0].fin;
  const finAudio = M.elementosDePista(out, a1)[0].fin;
  assert.ok(Math.abs(finVideo - finAudio) < 1e-9,
    `quedaron con largos distintos: video ${finVideo}, audio ${finAudio}`);
  assert.strictEqual(finVideo, 120);
});
