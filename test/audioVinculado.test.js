// Tests del AUDIO VINCULADO y del ORDEN DE PISTAS (06/08/2026).
//
// PEDIDO DEL USER: "el V1 en teoria deberia estar conectado con un audio,
// pero no es asi" y "en DaVinci el apartado audio no se puede juntar con
// el de video... abajo va todo el audio y arriba todo lo demas".
//
// Son dos reglas distintas y conviene no confundirlas:
//   VINCULO  la imagen y el sonido del MISMO material son una unidad:
//            cortar, borrar y mover afectan a los dos.
//   ORDEN    las pistas de audio van SIEMPRE abajo y las de video arriba;
//            los dos grupos no se entreveran nunca.
//
// El array de pistas guarda de ABAJO hacia ARRIBA (la ultima tapa), asi
// que "audio primero en el array" es "audio abajo en pantalla".

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

function base() {
  let m = M.crearMontaje();
  let mediaId, v1, a1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'E:/T.mov', nombre: 'T.mov', tipo: 'video', duracion: 400 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  return { m, mediaId, v1, a1 };
}

// Un clip de video con su audio, los dos vinculados, cubriendo 0..400.
function conPar() {
  const { m, mediaId, v1, a1 } = base();
  const k = M.nuevoVinculo();
  let out = m;
  [out] = M.agregarAlFinal(out, v1, mediaId, { vinculo: k });
  [out] = M.agregarAlFinal(out, a1, mediaId, { vinculo: k });
  return { m: out, mediaId, v1, a1, k };
}

const tipos = (m) => m.pistas.map((p) => p.tipo);
const nombres = (m) => m.pistas.map((p) => p.nombre);

// ============================================================
// ORDEN: EL AUDIO SIEMPRE ABAJO
// ============================================================

test('agregar pistas en cualquier orden deja el audio abajo', () => {
  let { m } = base();
  [m] = M.agregarPista(m, 'video', 'V2');
  [m] = M.agregarPista(m, 'audio', 'A2');
  [m] = M.agregarPista(m, 'video', 'V3');
  // En el array: primero todo el audio, despues todo el video.
  assert.deepStrictEqual(tipos(m), ['audio', 'audio', 'video', 'video', 'video'],
    `quedo mezclado: ${nombres(m).join(', ')}`);
});

test('una pista de audio no puede subir por encima del video', () => {
  let { m, a1 } = base();
  [m] = M.agregarPista(m, 'video', 'V2');
  const antes = nombres(m);
  // Intento mandar A1 al tope del array (= arriba de todo en pantalla).
  const out = M.moverPista(m, a1, m.pistas.length - 1);
  assert.deepStrictEqual(nombres(out), antes, 'no deberia haberse movido');
  assert.deepStrictEqual(tipos(out), ['audio', 'video', 'video']);
});

test('dentro de su grupo, una pista si se puede reordenar', () => {
  let { m } = base();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  // V2 esta ultima (arriba); la bajo un lugar dentro del grupo de video.
  const out = M.moverPista(m, v2, m.pistas.findIndex((p) => p.tipo === 'video'));
  assert.deepStrictEqual(nombres(out), ['A1', 'V2', 'V1']);
  assert.deepStrictEqual(tipos(out), ['audio', 'video', 'video']);
});

// ============================================================
// VINCULO: SE COMPORTAN COMO UNA UNIDAD
// ============================================================

test('el video entra con su audio, los dos vinculados', () => {
  const { m, v1, a1, k } = conPar();
  const cv = M.elementosDePista(m, v1)[0];
  const ca = M.elementosDePista(m, a1)[0];
  assert.strictEqual(cv.vinculo, k);
  assert.strictEqual(ca.vinculo, k);
  assert.notStrictEqual(cv.id, ca.id, 'son clips distintos, no el mismo');
  assert.strictEqual(M.clipsVinculados(m, k).length, 2);
});

test('cortar el video corta tambien su audio, en el mismo instante', () => {
  const { m, v1, a1 } = conPar();
  const out = M.cortarEn(m, v1, 150);
  assert.strictEqual(M.elementosDePista(out, v1).length, 2, 'el video quedo partido');
  assert.strictEqual(M.elementosDePista(out, a1).length, 2, 'el audio tambien');
  assert.ok(Math.abs(M.elementosDePista(out, a1)[0].fin - 150) < 1e-9, 'y en el mismo punto');
});

test('despues de cortar, cada mitad sigue vinculada con la suya', () => {
  const { m, v1, a1 } = conPar();
  const out = M.cortarEn(m, v1, 150);
  const [v1a, v1b] = M.elementosDePista(out, v1);
  const [a1a, a1b] = M.elementosDePista(out, a1);
  assert.strictEqual(v1a.vinculo, a1a.vinculo, 'las primeras mitades van juntas');
  assert.strictEqual(v1b.vinculo, a1b.vinculo, 'las segundas tambien');
  assert.notStrictEqual(v1a.vinculo, v1b.vinculo, 'pero son parejas distintas');
});

test('borrar el video se lleva su audio', () => {
  const { m, v1, a1 } = conPar();
  const out = M.borrarConRipple(m, v1, M.elementosDePista(m, v1)[0].id);
  assert.strictEqual(M.elementosDePista(out, v1).filter((e) => e.tipo === 'clip').length, 0);
  assert.strictEqual(M.elementosDePista(out, a1).filter((e) => e.tipo === 'clip').length, 0,
    'el audio no puede quedar sonando solo');
});

test('suprimir deja el vacio en las DOS pistas', () => {
  const { m, v1, a1 } = conPar();
  const out = M.borrar(m, v1, M.elementosDePista(m, v1)[0].id);
  assert.strictEqual(M.elementosDePista(out, v1).filter((e) => e.tipo === 'clip').length, 0);
  assert.strictEqual(M.elementosDePista(out, a1).filter((e) => e.tipo === 'clip').length, 0);
});

test('mover el video lleva el audio al mismo instante', () => {
  const { m, v1, a1, mediaId } = conPar();
  // Un segundo par, para tener algo que mover sin quedarnos sin pista.
  let out = M.cortarEn(m, v1, 200);
  const segundo = M.elementosDePista(out, v1)[1];
  out = M.moverElemento(out, v1, segundo.id, 0);

  const enVideo = M.elementosDePista(out, v1).find((x) => x.id === segundo.id);
  const pareja = M.clipsVinculados(out, segundo.vinculo).find((o) => o.pistaId === a1);
  assert.ok(enVideo && pareja, 'los dos tienen que seguir existiendo');
  const enAudio = M.elementosDePista(out, a1).find((x) => x.id === pareja.el.id);
  assert.ok(Math.abs(enVideo.inicio - enAudio.inicio) < 1e-9,
    `quedaron desfasados: video en ${enVideo.inicio}, audio en ${enAudio.inicio}`);
  assert.strictEqual(mediaId, enAudio.mediaId);
});

test('el audio no se sube a una pista de video al mover', () => {
  let { m, v1, a1 } = conPar();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  const clipV = M.elementosDePista(m, v1)[0];
  const out = M.moverElemento(m, v1, clipV.id, 0, v2);   // el video sube a V2
  assert.strictEqual(M.elementosDePista(out, v2).filter((e) => e.tipo === 'clip').length, 1);
  assert.strictEqual(M.elementosDePista(out, a1).filter((e) => e.tipo === 'clip').length, 1,
    'el audio se queda en su pista');
});

// ============================================================
// MIGRACION DE PROYECTOS VIEJOS
// ============================================================

test('un montaje viejo (audio vacio) recupera su audio', () => {
  const { m, mediaId, v1, a1 } = base();
  let viejo = m;
  [viejo] = M.agregarAlFinal(viejo, v1, mediaId, {});   // sin vinculo, como antes
  assert.strictEqual(M.elementosDePista(viejo, a1).length, 0);

  const migrado = M.espejarEnAudio(viejo, v1, a1);
  const cv = M.elementosDePista(migrado, v1)[0];
  const ca = M.elementosDePista(migrado, a1)[0];
  assert.ok(ca, 'ahora tiene audio');
  assert.strictEqual(cv.vinculo, ca.vinculo, 'y quedaron vinculados');
  assert.ok(Math.abs(ca.inicio - cv.inicio) < 1e-9 && Math.abs(ca.fin - cv.fin) < 1e-9,
    'con el mismo lugar y largo');
});

test('la migracion respeta los vacios de la pista de video', () => {
  const { m, mediaId, v1, a1 } = base();
  let viejo = m;
  [viejo] = M.agregarAlFinal(viejo, v1, mediaId, { usadoIn: 0, usadoOut: 100 });
  viejo = M.borrar(viejo, v1, M.elementosDePista(viejo, v1)[0].id);   // deja un hueco
  [viejo] = M.agregarAlFinal(viejo, v1, mediaId, { usadoIn: 100, usadoOut: 200 });

  const migrado = M.espejarEnAudio(viejo, v1, a1);
  const ev = M.elementosDePista(migrado, v1).map((e) => `${e.tipo}@${e.inicio}-${e.fin}`);
  const ea = M.elementosDePista(migrado, a1).map((e) => `${e.tipo}@${e.inicio}-${e.fin}`);
  assert.deepStrictEqual(ea, ev, 'el audio tiene que calcar la pista de video');
});

test('la migracion NO corre dos veces ni repone lo que se borro', () => {
  const { m, v1, a1 } = conPar();
  // Ya tiene vinculos: espejar no debe tocar nada.
  assert.deepStrictEqual(M.espejarEnAudio(m, v1, a1), m);

  // Y si el user borra el audio a proposito, no se lo reponemos.
  const sinAudio = M.borrarConRipple(m, a1, M.elementosDePista(m, a1)[0].id);
  const otraVez = M.espejarEnAudio(sinAudio, v1, a1);
  assert.strictEqual(M.elementosDePista(otraVez, a1).filter((e) => e.tipo === 'clip').length, 0);
});

// ============================================================
// QUE SUENA EN UN INSTANTE (agregado 06/08/2026)
// ============================================================
// PEDIDO: "quiero que sea una opcion que al tocar un vacio salte... sobre
// todo ahora que esta la pista de audio y quiero escuchar el audio".
// Para eso el reproductor tiene que poder distinguir "no hay imagen" de
// "no hay nada": son cosas distintas y antes se confundian.

test('en un vacio de video, si hay audio, capaDeAudioEn lo encuentra', () => {
  const { m, mediaId, v1, a1 } = base();
  let out = m;
  const k = M.nuevoVinculo();
  [out] = M.agregarAlFinal(out, v1, mediaId, { usadoIn: 0, usadoOut: 200, vinculo: k });
  [out] = M.agregarAlFinal(out, a1, mediaId, { usadoIn: 0, usadoOut: 200, vinculo: k });
  // Saco SOLO la imagen y dejo el sonido. Para eso hay que desvincular
  // primero: si no, borrar el video se llevaria su audio, que es
  // justamente lo que hace bien el vinculo.
  const clipV = M.elementosDePista(out, v1)[0];
  out = { ...out, pistas: out.pistas.map((p) => (p.id !== v1 ? p : {
    ...p, elementos: p.elementos.map((e) => ({ ...e, vinculo: undefined }))
  })) };
  out = M.borrar(out, v1, clipV.id);

  assert.strictEqual(M.capaVisibleEn(out, 100), null, 'no hay imagen');
  const audio = M.capaDeAudioEn(out, 100);
  assert.ok(audio, 'pero SI hay sonido');
  assert.ok(Math.abs(audio.tFuente - 100) < 1e-9, 'y apunta al punto correcto del archivo');
});

test('donde no hay nada, tampoco hay audio', () => {
  const { m, mediaId, v1, a1 } = base();
  let out = m;
  const k = M.nuevoVinculo();
  [out] = M.agregarAlFinal(out, v1, mediaId, { usadoIn: 0, usadoOut: 100, vinculo: k });
  [out] = M.agregarAlFinal(out, a1, mediaId, { usadoIn: 0, usadoOut: 100, vinculo: k });
  assert.strictEqual(M.capaVisibleEn(out, 150), null);
  assert.strictEqual(M.capaDeAudioEn(out, 150), null);
});

test('una pista de audio oculta no suena', () => {
  const { m, mediaId, v1, a1 } = base();
  let out = m;
  [out] = M.agregarAlFinal(out, a1, mediaId, { usadoIn: 0, usadoOut: 200 });
  assert.ok(M.capaDeAudioEn(out, 50), 'visible suena');
  out = M.actualizarPista(out, a1, { visible: false });
  assert.strictEqual(M.capaDeAudioEn(out, 50), null, 'oculta no');
});
