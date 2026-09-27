// Tests del VINCULO IMAGEN-SONIDO en los cuatro modos de recorte
// (08/08/2026).
//
// EL BUG QUE ESTOS TESTS FIJAN, marcado dos veces en PENDIENTE sin
// resolverse: `ripple`, `roll`, `slip` y `slide` operaban sobre UN clip.
// Si ese clip tenia pareja de audio vinculada, la pareja se quedaba donde
// estaba y la imagen se corria respecto del sonido.
//
// Por que es el peor bug posible en un editor: no rompe nada, no tira
// ningun error, y en la linea de tiempo se sigue viendo bien. Te enteras
// al exportar, cuando los labios no coinciden con la voz — y para
// entonces ya no sabes cual de los veinte recortes que hiciste lo causo.
//
// La invariante que se prueba en todos los casos es siempre la misma, y
// es la unica que importa:
//
//   un clip vinculado y su pareja tienen que ocupar EL MISMO TRAMO de la
//   linea y mirar LA MISMA PARTE del material.
//
// Si eso se cumple, estan sincronizados. Si no, no.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

// Montaje con TRES clips seguidos en V1 y su espejo vinculado en A1.
// Tres y no dos porque `slide` y `roll` necesitan vecinos a los dos lados.
function conVinculo() {
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, {
    ruta: '/x/a.mp4', nombre: 'a.mp4', duracion: 100, ancho: 1920, alto: 1080
  });
  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');

  // Tres tramos de 10s seguidos, cada uno mirando otra parte del archivo.
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  m = M.sobrescribirEn(m, v1, 10, M.clip(mediaId, 20, 30));
  m = M.sobrescribirEn(m, v1, 20, M.clip(mediaId, 40, 50));
  m = M.espejarEnAudio(m, v1, a1);

  return { m, mediaId, v1, a1 };
}

// La pareja de audio de un clip de video.
function pareja(m, v1, a1, indice) {
  const video = M.elementosDePista(m, v1)[indice];
  const audio = M.elementosDePista(m, a1).find((x) => x.vinculo && x.vinculo === video.vinculo);
  return { video, audio };
}

// LA comprobacion. Se usa en todos los tests.
function assertSincronizados(m, v1, a1, indice, contexto) {
  const { video, audio } = pareja(m, v1, a1, indice);
  assert.ok(audio, `${contexto}: el clip ${indice} perdio su pareja de audio`);
  assert.ok(Math.abs(video.inicio - audio.inicio) < 1e-9,
    `${contexto}: DESINCRONIZADO — la imagen empieza en ${video.inicio} y el sonido en ${audio.inicio}`);
  assert.ok(Math.abs(video.fin - audio.fin) < 1e-9,
    `${contexto}: DESINCRONIZADO — la imagen termina en ${video.fin} y el sonido en ${audio.fin}`);
  assert.ok(Math.abs(video.usadoIn - audio.usadoIn) < 1e-9,
    `${contexto}: DESINCRONIZADO — miran partes distintas del material (${video.usadoIn} vs ${audio.usadoIn})`);
}

// ---------- RIPPLE ----------

test('ripple por el borde de salida arrastra al audio vinculado', () => {
  const { m, v1, a1 } = conVinculo();
  const el = M.elementosDePista(m, v1)[0];
  const r = M.ripple(m, v1, el.id, 'out', 6);
  assertSincronizados(r, v1, a1, 0, 'ripple out');
});

test('ripple por el borde de entrada arrastra al audio vinculado', () => {
  const { m, v1, a1 } = conVinculo();
  const el = M.elementosDePista(m, v1)[1];
  const r = M.ripple(m, v1, el.id, 'in', 13);
  assertSincronizados(r, v1, a1, 1, 'ripple in');
});

// ---------- ROLL ----------

test('roll mueve el corte en las DOS pistas, no en una', () => {
  const { m, v1, a1 } = conVinculo();
  const el = M.elementosDePista(m, v1)[0];
  const r = M.roll(m, v1, el.id, 7);
  assertSincronizados(r, v1, a1, 0, 'roll (clip que se achica)');
  assertSincronizados(r, v1, a1, 1, 'roll (clip que crece)');
});

// ---------- SLIP ----------

test('slip corre la ventana del material en las dos pistas', () => {
  const { m, v1, a1 } = conVinculo();
  const el = M.elementosDePista(m, v1)[1];
  const r = M.slip(m, v1, el.id, 5);
  assertSincronizados(r, v1, a1, 1, 'slip');
  // Y ademas tiene que haber hecho algo: un slip que no mueve nada
  // pasaria el test de sincronia sin cumplir su trabajo.
  const { video } = pareja(r, v1, a1, 1);
  assert.ok(Math.abs(video.usadoIn - 25) < 1e-9, `el slip no corrio la ventana: usadoIn=${video.usadoIn}`);
});

// ---------- SLIDE ----------

test('slide mueve el clip y ajusta vecinos en las dos pistas', () => {
  const { m, v1, a1 } = conVinculo();
  const el = M.elementosDePista(m, v1)[1];
  const r = M.slide(m, v1, el.id, 3);
  assertSincronizados(r, v1, a1, 0, 'slide (vecino de antes)');
  assertSincronizados(r, v1, a1, 1, 'slide (el que se mueve)');
  assertSincronizados(r, v1, a1, 2, 'slide (vecino de despues)');
  const { video } = pareja(r, v1, a1, 1);
  assert.ok(Math.abs(video.inicio - 13) < 1e-9, `el slide no movio el clip: inicio=${video.inicio}`);
});

// ---------- EL CASO DIFICIL ----------

test('si una pista puede menos que la otra, MANDA LA MAS RESTRICTIVA', () => {
  // Este es el caso que un arreglo ingenuo (aplicar la misma operacion a
  // cada pista por separado) NO cubre: si el material de audio se termina
  // antes que el de video, cada pista se frena en un punto distinto y
  // quedan desincronizadas igual, pero solo con ciertos archivos. Es
  // exactamente la clase de bug que aparece "a veces".
  let m = M.crearMontaje();
  let vid, aud;
  [m, vid] = M.agregarMedia(m, { ruta: '/x/v.mp4', nombre: 'v.mp4', duracion: 100 });
  // El audio tiene MENOS material disponible que el video.
  [m, aud] = M.agregarMedia(m, { ruta: '/x/a.wav', nombre: 'a.wav', duracion: 12 });

  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');

  const k = M.nuevoVinculo();
  m = M.sobrescribirEn(m, v1, 0, M.clip(vid, 0, 10, undefined, k));
  m = M.sobrescribirEn(m, a1, 0, M.clip(aud, 0, 10, undefined, k));

  const el = M.elementosDePista(m, v1)[0];
  // Se pide estirar hasta 20: el video puede, el audio solo hasta 12.
  const r = M.ripple(m, v1, el.id, 'out', 20);

  const video = M.elementosDePista(r, v1)[0];
  const audio = M.elementosDePista(r, a1)[0];
  assert.ok(Math.abs(video.fin - audio.fin) < 1e-9,
    `DESINCRONIZADO: la imagen llega a ${video.fin} y el sonido a ${audio.fin}`);
  // Y el limite tiene que ser el del audio, que es el que menos tiene.
  assert.ok(Math.abs(video.fin - 12) < 1e-9, `deberia haberse frenado en 12, quedo en ${video.fin}`);
});

// ---------- RECORTAR ----------

test('recortar estirando hacia un hueco NO desincroniza con material asimetrico', () => {
  // PENDIENTE daba a `recortar` por sano ("si respeta el vinculo"). Era
  // cierto a medias: tocaba las dos pistas, pero cada una se frenaba
  // donde se le acababa SU material. Encontrado el 08/08/2026 probando
  // el caso asimetrico que ya habia aparecido en ripple.
  let m = M.crearMontaje();
  let vid, aud;
  [m, vid] = M.agregarMedia(m, { ruta: '/x/v.mp4', nombre: 'v.mp4', duracion: 100 });
  [m, aud] = M.agregarMedia(m, { ruta: '/x/a.wav', nombre: 'a.wav', duracion: 12 });

  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');

  const k = M.nuevoVinculo();
  m = M.sobrescribirEn(m, v1, 0, M.clip(vid, 0, 10, undefined, k));
  m = M.sobrescribirEn(m, a1, 0, M.clip(aud, 0, 10, undefined, k));
  // Material lejos, para que quede hueco donde estirar.
  m = M.sobrescribirEn(m, v1, 30, M.clip(vid, 50, 60));
  m = M.sobrescribirEn(m, a1, 30, M.clip(vid, 50, 60));

  const el = M.elementosDePista(m, v1)[0];
  const r = M.recortar(m, v1, el.id, 'out', 20);

  const video = M.elementosDePista(r, v1)[0];
  const audio = M.elementosDePista(r, a1)[0];
  assert.ok(Math.abs(video.fin - audio.fin) < 1e-9,
    `DESINCRONIZADO: la imagen llega a ${video.fin} y el sonido a ${audio.fin}`);
  assert.ok(Math.abs(video.fin - 12) < 1e-9, `deberia frenarse en 12 (lo que dura el wav), quedo en ${video.fin}`);
});

// ---------- QUE NO SE ROMPA LO QUE YA ANDABA ----------

test('un clip SIN vinculo sigue operando solo', () => {
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, { ruta: '/x/a.mp4', nombre: 'a.mp4', duracion: 100 });
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  m = M.sobrescribirEn(m, v1, 10, M.clip(mediaId, 20, 30));

  const el = M.elementosDePista(m, v1)[0];
  const r = M.ripple(m, v1, el.id, 'out', 6);
  assert.ok(Math.abs(M.elementosDePista(r, v1)[0].fin - 6) < 1e-9);
});
