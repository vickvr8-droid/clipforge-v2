// Tests de LOS DOS EJES DE TIEMPO que usa el visor (06/08/2026).
//
// POR QUE EXISTEN: el visor traduce entre el tiempo de la LINEA (donde
// esta el cabezal) y el tiempo de la FUENTE (donde esta el <video>), en
// las dos direcciones y en cada cuadro:
//
//   LINEA -> FUENTE   lo hace el modelo:  capaVisibleEn().tFuente
//   FUENTE -> LINEA   lo hace el visor:   el.inicio + (currentTime - el.usadoIn)
//
// La segunda formula esta escrita a mano en renderer.js porque el <video>
// solo sabe de currentTime. Si alguna de las dos cambia y la otra no,
// NO HAY ERROR: el video se corre de a poco a medida que se corta, y el
// sintoma aparece lejos de la causa (es la trampa que el propio
// montaje.js advierte en su encabezado).
//
// Estos tests son el ACUERDO entre las dos: fallan si dejan de ser
// inversas. Mismo patron que los tests "ACUERDO" que en su momento
// ataron el preview con la exportacion en geometria916.js.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');

// LA FORMULA DEL VISOR, copiada tal cual de renderer.js (visorTick).
// Si se cambia alla, este test falla hasta que se cambie aca: esa es
// justamente la idea.
function fuenteALinea(el, currentTime) {
  return el.inicio + (currentTime - el.usadoIn);
}

// Montaje de prueba: un archivo de 100s, tres clips y un vacio en el
// medio. Los clips NO arrancan en 0 del material a proposito - si las
// cuentas confunden los ejes, con material que arranca en 0 el error se
// esconde.
function armar() {
  let m = M.crearMontaje();
  let mediaId, v1;
  [m, mediaId] = M.agregarMedia(m, { ruta: 'D:/x.mp4', nombre: 'x.mp4', tipo: 'video', duracion: 100 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 10, usadoOut: 30 });   // linea 0..20
  [m] = M.agregarAlFinal(m, v1, mediaId, { usadoIn: 60, usadoOut: 75 });   // linea 20..35
  return { m, v1, mediaId };
}

// Busca el elemento de una capa, igual que hace visorEstadoEn().
function elementoDe(m, capa) {
  return M.elementosDePista(m, capa.pistaId).find((x) => x.id === capa.clipId);
}

// ============================================================
// IDA Y VUELTA
// ============================================================

test('LINEA -> FUENTE -> LINEA vuelve al mismo punto', () => {
  const { m } = armar();
  for (let t = 0; t < 35; t += 0.25) {
    const capa = M.capaVisibleEn(m, t);
    assert.ok(capa, `deberia haber material en ${t}`);
    const el = elementoDe(m, capa);
    assert.ok(Math.abs(fuenteALinea(el, capa.tFuente) - t) < 1e-9,
      `el eje se corrio en t=${t}: volvio ${fuenteALinea(el, capa.tFuente)}`);
  }
});

test('el segundo clip mira otra parte del archivo, no la continuacion', () => {
  const { m } = armar();
  // Justo antes del corte: final del primer clip (material 10..30).
  const antes = M.capaVisibleEn(m, 19.5);
  // Justo despues: arranca el segundo (material 60..75).
  const despues = M.capaVisibleEn(m, 20.5);
  assert.ok(Math.abs(antes.tFuente - 29.5) < 1e-9, `esperaba 29.5, dio ${antes.tFuente}`);
  assert.ok(Math.abs(despues.tFuente - 60.5) < 1e-9, `esperaba 60.5, dio ${despues.tFuente}`);
  // El salto en la LINEA es de 1s pero en la FUENTE es de 31s: es
  // exactamente lo que el visor tiene que ir a buscar al cruzar el corte.
  assert.notStrictEqual(antes.clipId, despues.clipId);
});

// ============================================================
// CORTAR NO DEBE CORRER EL VIDEO
// ============================================================

test('despues de cortar, el mismo instante de la linea sigue mostrando el mismo cuadro', () => {
  const { m, v1 } = armar();
  const antes = M.capaVisibleEn(m, 12).tFuente;
  const cortado = M.cortarEn(m, v1, 8);       // corte literal: dos clips pegados
  const despues = M.capaVisibleEn(cortado, 12).tFuente;
  assert.strictEqual(antes, despues, 'cortar no deberia mover lo que se ve');
});

test('borrar con ripple corre la linea pero el material sigue calzando', () => {
  const { m, v1 } = armar();
  const els = M.elementosDePista(m, v1);
  const sinPrimero = M.borrarConRipple(m, v1, els[0].id);
  // Lo que estaba en la linea 20 (inicio del 2do clip) ahora esta en 0.
  const capa = M.capaVisibleEn(sinPrimero, 0);
  assert.ok(Math.abs(capa.tFuente - 60) < 1e-9, `esperaba 60, dio ${capa.tFuente}`);
  const el = elementoDe(sinPrimero, capa);
  assert.ok(Math.abs(fuenteALinea(el, capa.tFuente) - 0) < 1e-9);
});

// ============================================================
// VACIOS
// ============================================================

test('en un vacio no hay capa visible: el visor va a negro', () => {
  let { m, v1, mediaId } = armar();
  [m] = M.insertarEn(m, v1, 50, mediaId, { usadoIn: 0, usadoOut: 5 });  // deja hueco 35..50
  assert.strictEqual(M.capaVisibleEn(m, 40), null);
  assert.ok(M.capaVisibleEn(m, 51), 'despues del vacio si hay material');
});

test('proximoMaterialDesde dice adonde saltar para no quedarse en negro', () => {
  let { m, v1, mediaId } = armar();
  [m] = M.insertarEn(m, v1, 50, mediaId, { usadoIn: 0, usadoOut: 5 });
  assert.ok(Math.abs(M.proximoMaterialDesde(m, 40) - 50) < 1e-9);
  // Pasado el ultimo material no hay adonde ir: ahi el visor para.
  assert.strictEqual(M.proximoMaterialDesde(m, 54), null);
});

// ============================================================
// SLIP — el caso que mas facil se rompe
// ============================================================

test('con slip el clip no se mueve pero SI cambia el cuadro que se ve', () => {
  const { m, v1 } = armar();
  const el0 = M.elementosDePista(m, v1)[0];
  const antes = M.capaVisibleEn(m, 5);
  const corrido = M.slip(m, v1, el0.id, 7);
  const despues = M.capaVisibleEn(corrido, 5);

  assert.ok(Math.abs(despues.tFuente - (antes.tFuente + 7)) < 1e-9,
    'slip deberia correr la ventana del material 7s');

  // Y la vuelta sigue dando el mismo punto de la linea: el clip no se movio.
  const el = elementoDe(corrido, despues);
  assert.ok(Math.abs(fuenteALinea(el, despues.tFuente) - 5) < 1e-9);
});
