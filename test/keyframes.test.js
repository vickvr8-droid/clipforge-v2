// KEYFRAMES (13/09/2026, tanda F, paso 8 de la hoja de ruta; 1.4 de
// PENDIENTE.md). Las claves viven en tiempo de FUENTE (el eje de usadoIn y
// usadoOut) y nacen en cuadros. Lo que cuidan estos tests:
//   - que una clave nazca en un cuadro aunque el instante llegue suelto;
//   - que cortar, recortar, ripple, slip y unir dejen la animacion pegada
//     al contenido: el mismo cuadro de la fuente se ve igual antes y despues
//     (comparando Composicion.planLienzo y planVertical cuadro a cuadro);
//   - que un encuadre animado al que el ripple le saca o le abre un tramo
//     por el medio (E1) siga igual sobre su frase;
//   - que el verificador vea claves rotas y que un proyecto guardado con
//     claves abra igual.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const C = require('../src/shared/composicion');
const L916 = require('../src/shared/layout916');
const Guardado = require('../src/main/montajeGuardado');

const FPS = 30;
const CUADRO = 1 / FPS;
const LIENZO = { ancho: 1920, alto: 1080 };
const SALIDA = { ancho: 1080, alto: 1920 };
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// Entrevista de 60 s a 30 fps en V1/A1: clip anterior [0-10] y el clip del
// punch-in con fuente [10-30] pegado detras.
function base() {
  let m = M.crearMontaje({ fps: FPS });
  let a, v1, a1;
  [m, a] = M.agregarMedia(m, { ruta: 'entrevista.mp4', duracion: 60, ancho: 1920, alto: 1080 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  [m] = M.colocarMedia(m, a, 0);
  m = M.cortarEn(m, v1, 10);
  m = M.cortarEn(m, v1, 30);
  // Se borra lo que sigue a 30 para quedarse con dos clips.
  const tercero = M.elementosDePista(m, v1)[2];
  m = M.borrarConRipple(m, v1, tercero.id);
  return { m, a, v1, a1 };
}

const clipsDe = (m, pistaId) => M.elementosDePista(m, pistaId).filter((e) => e.tipo === 'clip');

// Donde se ve el cuadro `s` de la fuente del material `mediaId`, o null.
function lineaDeFuente(m, mediaId, s) {
  for (const p of m.pistas) {
    if (p.tipo === 'audio') continue;
    for (const e of M.elementosDePista(m, p.id)) {
      if (e.tipo === 'clip' && e.mediaId === mediaId && s >= e.usadoIn - 1e-6 && s < e.usadoOut - 1e-6) {
        return e.inicio + (s - e.usadoIn);
      }
    }
  }
  return null;
}

// Lo que se dibuja del cuadro `s` de la fuente: el rectangulo en el lienzo
// y los recortes del panel vertical.
function dibujoDeFuente(m, mediaId, s, layout) {
  const t = lineaDeFuente(m, mediaId, s);
  if (t === null) return null;
  const lienzo = C.planLienzo(m, t, LIENZO, {});
  const capa = lienzo.capas.find((c) => c.mediaId === mediaId);
  // El layout con solo los encuadres ACTIVOS: la mitad derecha de un corte
  // trae id nuevo, y un layout con dos ids reparte el panel distinto aunque
  // se vea uno solo. Eso es del layout, no de la animacion.
  const activos = M.encuadresEn(m, t);
  const vertical = C.planVertical(m, t, LIENZO, SALIDA, L916.normalizar(L916.layoutVacio(), activos.map((x) => x.clipId)));
  return { dest: capa && capa.dest, celdas: layout === false ? [] : vertical.celdas.map((c) => c.src) };
}

function mismoDibujo(antes, despues, mediaId, desde, hasta, layout) {
  let comparados = 0;
  for (let k = Math.round(desde * FPS); k < Math.round(hasta * FPS); k++) {
    const s = k / FPS;
    const a = dibujoDeFuente(antes, mediaId, s, layout);
    const d = dibujoDeFuente(despues, mediaId, s, layout);
    if (!a || !d) continue;
    comparados++;
    for (const campo of ['x', 'y', 'w', 'h']) {
      assert.ok(cerca(a.dest[campo], d.dest[campo], 1e-6), `fuente ${s}: dest.${campo} ${a.dest[campo]} -> ${d.dest[campo]}`);
    }
    assert.strictEqual(a.celdas.length, d.celdas.length, `fuente ${s}: celdas`);
    a.celdas.forEach((c, i) => ['x', 'y', 'w', 'h'].forEach((campo) =>
      assert.ok(cerca(c[campo], d.celdas[i][campo], 1e-6), `fuente ${s}: celda ${i}.${campo} ${c[campo]} -> ${d.celdas[i][campo]}`)));
  }
  return comparados;
}

// ============================================================
// NACEN EN CUADROS
// ============================================================

test('ponerClave: la clave cae en el cuadro del instante, contado desde el clip', () => {
  const { m, v1 } = base();
  const clip = clipsDe(m, v1)[1];
  const m2 = M.ponerClave(m, v1, clip.id, 12.345, { escala: 2 });
  const [clave] = M.clavesDe(clipsDe(m2, v1)[1]);
  const cuadros = (clave.tFuente - clip.usadoIn) * FPS;
  assert.ok(cerca(cuadros, Math.round(cuadros), 1e-9), `cuadro ${cuadros}`);
  assert.ok(cerca(clave.tFuente, 10 + 70 / FPS, 1e-9), 'el cuadro mas cercano a 12.345 es el 70 desde 10');
  assert.strictEqual(clave.escala, 2);
  assert.deepStrictEqual(M.verificarMontaje(m2), []);
});

test('ponerClave: la primera clave no cambia lo que se ve; con dos, interpola', () => {
  const { m, v1 } = base();
  const id = clipsDe(m, v1)[1].id;
  let x = M.transformar(m, v1, id, { escala: 1.2 });
  x = M.ponerClave(x, v1, id, 12);
  assert.ok(cerca(M.composicionEn(x, 20)[0].transformacion.escala, 1.2), 'una sola clave: el valor que tenia');
  x = M.ponerClave(x, v1, id, 15, { escala: 2, x: 0.1 });
  const en = (t) => M.composicionEn(x, t).find((c) => c.clase === 'media').transformacion;
  assert.ok(cerca(en(12).escala, 1.2));
  assert.ok(cerca(en(13.5).escala, 1.6), `medio: ${en(13.5).escala}`);
  assert.ok(cerca(en(13.5).x, 0.05));
  assert.ok(cerca(en(15).escala, 2));
  assert.ok(cerca(en(25).escala, 2), 'despues de la ultima, la ultima');
  assert.ok(cerca(en(10).escala, 1.2), 'antes de la primera, la primera');
});

test('curvas: mantener salta en la siguiente y suave arranca despacio', () => {
  const { m, v1 } = base();
  const id = clipsDe(m, v1)[1].id;
  let x = M.ponerClave(m, v1, id, 12, { escala: 1 });
  x = M.ponerClave(x, v1, id, 16, { escala: 3 });
  const en = (mm, t) => M.composicionEn(mm, t).find((c) => c.clase === 'media').transformacion.escala;
  const suave = M.curvaDeClave(x, v1, id, 12, 'suave');
  assert.ok(en(suave, 13) < en(x, 13), 'suave va por debajo de la lineal al principio');
  assert.ok(cerca(en(suave, 14), 2), 'y pasa por el medio en el medio');
  const seco = M.curvaDeClave(x, v1, id, 12, 'mantener');
  assert.ok(cerca(en(seco, 15.9), 1));
  assert.ok(cerca(en(seco, 16), 3));
  assert.strictEqual(M.curvaDeClave(x, v1, id, 13, 'suave'), x, 'sin clave en ese cuadro no cambia nada');
  assert.strictEqual(M.claveEn(seco, v1, id, 12).curva, 'mantener');
  assert.strictEqual(M.claveEn(M.curvaDeClave(seco, v1, id, 12, 'lineal'), v1, id, 12).curva, undefined, 'la lineal no se guarda');
});

test('transformar con tLinea en un clip animado cambia la clave de ese cuadro, no la base', () => {
  const { m, v1 } = base();
  const id = clipsDe(m, v1)[1].id;
  let x = M.ponerClave(m, v1, id, 12, { escala: 1 });
  x = M.ponerClave(x, v1, id, 15, { escala: 2 });
  const y = M.transformar(x, v1, id, { x: 0.3 }, 15);
  assert.strictEqual(M.clavesDe(clipsDe(y, v1)[1]).length, 2);
  assert.ok(cerca(M.claveEn(y, v1, id, 15).x, 0.3));
  assert.ok(cerca(M.claveEn(y, v1, id, 15).escala, 2), 'lo que no llega se conserva');
  const z = M.transformar(x, v1, id, { escala: 3 }, 13);
  assert.strictEqual(M.clavesDe(clipsDe(z, v1)[1]).length, 3, 'en un cuadro sin clave, la crea');
  // Sin claves, igual que siempre (la base fija).
  const fijo = M.transformar(m, v1, id, { escala: 1.5 }, 13);
  assert.strictEqual(M.clavesDe(clipsDe(fijo, v1)[1]).length, 0);
  assert.strictEqual(M.transformacionDe(clipsDe(fijo, v1)[1]).escala, 1.5);
});

test('quitarClave: al sacar la ultima el clip queda fijo en ese valor y sin campo claves', () => {
  const { m, v1 } = base();
  const id = clipsDe(m, v1)[1].id;
  let x = M.ponerClave(m, v1, id, 12, { escala: 1.4, y: -0.1 });
  x = M.ponerClave(x, v1, id, 15, { escala: 2 });
  x = M.quitarClave(x, v1, id, 15);
  assert.strictEqual(M.clavesDe(clipsDe(x, v1)[1]).length, 1);
  x = M.quitarClave(x, v1, id, 12);
  const c = clipsDe(x, v1)[1];
  assert.ok(!('claves' in c.transformacion));
  assert.ok(cerca(c.transformacion.escala, 1.4));
  assert.ok(cerca(c.transformacion.y, -0.1));
  assert.strictEqual(M.quitarClave(x, v1, id, 12), x, 'sin clave no hace nada');
});

// ============================================================
// LA PRUEBA DEL INFORME: PUNCH-IN ENTRE FUENTE 12 Y 15
// ============================================================

function punchIn() {
  const b = base();
  let { m } = b;
  const id = clipsDe(m, b.v1)[1].id;
  m = M.ponerClave(m, b.v1, id, 12, { escala: 1, x: 0, y: 0 });
  m = M.ponerClave(m, b.v1, id, 15, { escala: 2, x: 0.15, y: -0.1 });
  // Un encuadre animado encima, de 10 a 30, que sigue a la persona.
  let info;
  [m, info] = M.colocarEncuadre(m, 10, 20, { xPct: 0.1, yPct: 0, wPct: 0.3, hPct: 1 });
  m = M.ponerClave(m, info.pistaId, info.clipId, 12, { xPct: 0.1 });
  m = M.ponerClave(m, info.pistaId, info.clipId, 15, { xPct: 0.5, wPct: 0.25 });
  const layout = L916.normalizar(L916.layoutVacio(), [info.clipId]);
  return { ...b, m, id, enc: info, layout };
}

test('INFORME: el punch-in cortado en 13,5 y con ripple del clip anterior se dibuja igual cuadro a cuadro', () => {
  const { m, a, v1, layout } = punchIn();
  assert.deepStrictEqual(M.verificarMontaje(m), []);

  const cortado = M.cortarTodasEn(m, 13.5);
  assert.strictEqual(clipsDe(cortado, v1).length, 3);
  assert.ok(mismoDibujo(m, cortado, a, 10, 30, layout) >= 590);

  const anterior = clipsDe(cortado, v1)[0];
  const [sinAnterior, informe] = M.borrarConRippleConInforme(cortado, v1, anterior.id);
  assert.ok(!informe.bloqueo, 'el ripple no se freno');
  assert.ok(cerca(clipsDe(sinAnterior, v1)[0].inicio, 0), 'el punch-in quedo al principio');
  assert.ok(mismoDibujo(m, sinAnterior, a, 10, 30, layout) >= 590);
  assert.deepStrictEqual(M.verificarMontaje(sinAnterior), []);

  // El ripple del borde (acortar el clip anterior 2 s) tampoco lo mueve.
  const [acortado] = M.rippleConInforme(cortado, v1, anterior.id, 'out', 8);
  assert.ok(cerca(clipsDe(acortado, v1)[1].inicio, 8));
  assert.ok(mismoDibujo(m, acortado, a, 10, 30, layout) >= 590);
});

// Aca se compara solo el lienzo (`false` en layout): slip y roll cambian que
// contenido queda debajo del encuadre de V2, que no esta atado al clip. Eso
// es lo esperado (el encuadre sigue su propio eje en la linea).
test('recortar por la entrada, slip y roll no mueven la animacion respecto del contenido', () => {
  const { m, a, v1, id } = punchIn();
  const recortado = M.recortar(m, v1, id, 'in', 11);
  assert.ok(mismoDibujo(m, recortado, a, 11, 30, false) >= 500);
  // Estirarlo de vuelta trae las claves que quedaron escondidas.
  const devuelto = M.recortar(recortado, v1, id, 'in', 10);
  assert.ok(mismoDibujo(m, devuelto, a, 10, 30, false) >= 590);
  const conSlip = M.slip(m, v1, id, 2);
  assert.ok(mismoDibujo(m, conSlip, a, 12, 32, false) >= 500, 'el slip corre la animacion con el contenido');
  const conRoll = M.roll(m, v1, id, 11, 'in');
  assert.ok(mismoDibujo(m, conRoll, a, 0, 30, false) >= 800);
  assert.deepStrictEqual(M.verificarMontaje(conRoll), []);
});

test('unir: dos mitades de un corte vuelven a tener exactamente las claves de antes', () => {
  const { m, v1, id } = punchIn();
  const cortado = M.cortarEn(m, v1, 13.5);
  const unido = M.unirConSiguiente(cortado, v1, id);
  assert.strictEqual(clipsDe(unido, v1).length, 2);
  assert.deepStrictEqual(M.clavesDe(clipsDe(unido, v1)[1]), M.clavesDe(clipsDe(m, v1)[1]));
});

test('unir: un pedazo fijo y uno animado se fusionan sin cambiar ningun cuadro', () => {
  const b = base();
  let { m } = b;
  const { v1, a } = b;
  const id = clipsDe(m, v1)[1].id;
  m = M.cortarEn(m, v1, 20);
  const [izq, der] = clipsDe(m, v1).slice(1);
  m = M.transformar(m, v1, izq.id, { escala: 1.3 });
  m = M.ponerClave(m, v1, der.id, 22, { escala: 2 });
  m = M.ponerClave(m, v1, der.id, 25, { escala: 1 });
  const unido = M.unirConSiguiente(m, v1, id);
  assert.strictEqual(clipsDe(unido, v1).length, 2, 'se unio');
  assert.ok(mismoDibujo(m, unido, a, 10, 30) >= 590);
  assert.deepStrictEqual(M.verificarMontaje(unido), []);
});

// ============================================================
// ENCUADRE ANIMADO Y RIPPLE MULTIPISTA (E1)
// ============================================================

function encuadreLargo(curva) {
  let m = M.crearMontaje({ fps: FPS });
  let a, v1, info;
  [m, a] = M.agregarMedia(m, { ruta: 'entrevista.mp4', duracion: 30, ancho: 1920, alto: 1080 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarPista(m, 'audio', 'A1');
  [m] = M.colocarMedia(m, a, 0);
  m = M.cortarEn(m, v1, 10);
  m = M.cortarEn(m, v1, 20);
  [m, info] = M.colocarEncuadre(m, 0, 30, { xPct: 0, wPct: 0.3 });
  m = M.ponerClave(m, info.pistaId, info.clipId, 5, { xPct: 0 }, curva);
  m = M.ponerClave(m, info.pistaId, info.clipId, 25, { xPct: 0.6 });
  const layout = L916.normalizar(L916.layoutVacio(), [info.clipId]);
  return { m, a, v1, enc: info, layout };
}

test('E1: borrar con ripple la frase del medio saca ese pedazo de la animacion del encuadre', () => {
  const { m, a, v1, enc, layout } = encuadreLargo();
  const medio = clipsDe(m, v1)[1];
  const [salida, informe] = M.borrarConRippleConInforme(m, v1, medio.id);
  assert.ok(!informe.bloqueo);
  const e = M.elementosDePista(salida, enc.pistaId).find((x) => x.id === enc.clipId);
  assert.ok(cerca(e.duracion, 20), 'el encuadre se acorto');
  // Fuente 0-10 y 20-30 siguen viendose con el mismo recorte vertical.
  assert.ok(mismoDibujo(m, salida, a, 0, 30, layout) >= 590);
  assert.deepStrictEqual(M.verificarMontaje(salida), []);
  assert.deepStrictEqual(M.encuadresQueCambiaronDeMaterial(m, salida), []);
});

test('E1: insertar en medio abre la animacion del encuadre y lo de despues sigue igual', () => {
  const { m, a, v1, enc, layout } = encuadreLargo();
  let otro, salida;
  [salida, otro] = M.agregarMedia(m, { ruta: 'broll.mp4', duracion: 20, ancho: 1920, alto: 1080 });
  const [conInsert, nuevo, informe] = M.insertarEn(salida, v1, 10, otro, { usadoIn: 0, usadoOut: 5 });
  assert.ok(nuevo && !informe.bloqueo);
  const e = M.elementosDePista(conInsert, enc.pistaId).find((x) => x.id === enc.clipId);
  assert.ok(cerca(e.duracion, 35), 'el encuadre se estiro');
  assert.ok(mismoDibujo(m, conInsert, a, 0, 30, layout) >= 890);
  assert.deepStrictEqual(M.verificarMontaje(conInsert), []);
});

test('E1: cerrar un vacio debajo de un encuadre animado conserva cada cuadro', () => {
  const { m, a, v1, layout } = encuadreLargo();
  const medio = clipsDe(m, v1)[1];
  const conVacio = M.borrar(m, v1, medio.id);
  const hueco = M.elementosDePista(conVacio, v1).find((x) => x.tipo === 'hueco');
  const cerrado = M.cerrarHueco(conVacio, v1, hueco.id);
  assert.ok(mismoDibujo(m, cerrado, a, 0, 30, layout) >= 590);
});

test('ajustarEncuadre con tLinea en un encuadre animado cambia la clave de ese cuadro', () => {
  const { m, enc } = encuadreLargo();
  const x = M.ajustarEncuadre(m, enc.pistaId, enc.clipId, { yPct: 0.1, hPct: 0.8 }, 25);
  const clave = M.claveEn(x, enc.pistaId, enc.clipId, 25);
  assert.ok(cerca(clave.yPct, 0.1) && cerca(clave.hPct, 0.8) && cerca(clave.xPct, 0.6));
  assert.ok(cerca(M.encuadresEn(x, 25)[0].rect.hPct, 0.8));
  assert.ok(cerca(M.encuadresEn(x, 15)[0].rect.xPct, 0.3), 'a mitad de camino entre 0 y 0,6');
  assert.deepStrictEqual(M.clavesEnLinea(x, enc.pistaId, enc.clipId).map((c) => c.tLinea), [5, 25]);
});

// ============================================================
// VERIFICADOR, FPS Y PROYECTO GUARDADO
// ============================================================

function tocarClaves(m, pistaId, elId, claves) {
  return { ...m, pistas: m.pistas.map((p) => (p.id !== pistaId ? p : {
    ...p, elementos: p.elementos.map((e) => (e.id !== elId ? e
      : { ...e, transformacion: { ...M.transformacionDe(e), claves } }))
  })) };
}

test('verificarMontaje: detecta claves fuera de cuadro, desordenadas, rotas y fuera del material', () => {
  const { m, v1, id } = punchIn();
  const tipos = (x) => M.verificarMontaje(x).map((f) => f.tipo);
  const ok = { tFuente: 12, escala: 1, x: 0, y: 0 };
  assert.deepStrictEqual(tipos(tocarClaves(m, v1, id, [{ ...ok, tFuente: 12.01 }])), ['claveFueraDeCuadro']);
  assert.deepStrictEqual(tipos(tocarClaves(m, v1, id, [{ ...ok, tFuente: 13 }, ok])), ['claveInvalida']);
  assert.deepStrictEqual(tipos(tocarClaves(m, v1, id, [{ ...ok, escala: 'mucho' }])), ['claveInvalida']);
  assert.deepStrictEqual(tipos(tocarClaves(m, v1, id, [{ ...ok, curva: 'rebote' }])), ['claveInvalida']);
  assert.deepStrictEqual(tipos(tocarClaves(m, v1, id, [{ ...ok, tFuente: 70 }])), ['claveFueraDeMaterial']);
  // Fuera de la ventana pero dentro del archivo NO es falla (se conserva).
  assert.deepStrictEqual(tipos(tocarClaves(m, v1, id, [{ ...ok, tFuente: 40 }])), []);
});

test('fijarFps: pasar de 30 a 25 lleva las claves a la nueva grilla', () => {
  const { m, v1 } = punchIn();
  const x = M.fijarFps(m, 25);
  assert.deepStrictEqual(M.verificarMontaje(x).filter((f) => f.tipo.startsWith('clave')), []);
  const claves = M.clavesDe(clipsDe(x, v1)[1]);
  assert.strictEqual(claves.length, 2);
  claves.forEach((c) => {
    const n = (c.tFuente - clipsDe(x, v1)[1].usadoIn) * 25;
    assert.ok(cerca(n, Math.round(n), 1e-9));
  });
});

test('proyecto guardado con claves: JSON ida y vuelta, montajeUtilizable y la migracion de cuadro no lo tocan', () => {
  const { m, a, layout } = punchIn();
  const leido = JSON.parse(JSON.stringify(m));
  assert.ok(Guardado.montajeUtilizable(leido));
  assert.strictEqual(Guardado.asegurarBaseDeCuadro(leido, { fps: 30 }), leido);
  assert.ok(mismoDibujo(m, leido, a, 10, 30, layout) >= 590);
  assert.strictEqual(M.VERSION, 1, 'las claves son un campo opcional: VERSION no sube');
});

test('un clip sin claves se sigue dibujando con su transformacion fija (proyectos viejos)', () => {
  const { m, v1 } = base();
  const id = clipsDe(m, v1)[1].id;
  const x = M.transformar(m, v1, id, { escala: 0.5, x: 0.2 });
  const capa = M.composicionEn(x, 15).find((c) => c.clase === 'media');
  assert.deepStrictEqual(capa.transformacion, { escala: 0.5, x: 0.2, y: 0 });
});

// La curva 'suave' partida por el ripple: cada mitad guarda su pedazo de S
// (`tramo`) y los cuadros no cambian (sin eso la prueba aleatoria veia
// diferencias de milesimas en el recorte).
test('E1 con curva suave: sacar e insertar en medio no cambia ningun cuadro del encuadre', () => {
  const { m, a, v1, enc, layout } = encuadreLargo('suave');
  const medio = clipsDe(m, v1)[1];
  const [sinMedio] = M.borrarConRippleConInforme(m, v1, medio.id);
  assert.ok(mismoDibujo(m, sinMedio, a, 0, 30, layout) >= 590);
  assert.ok(M.clavesDe(M.elementosDePista(sinMedio, enc.pistaId)[0]).some((c) => c.tramo), 'quedo una S partida');
  const [conOtro, otro] = M.agregarMedia(m, { ruta: 'broll.mp4', duracion: 20 });
  const [conInsert] = M.insertarEn(conOtro, v1, 10, otro, { usadoIn: 0, usadoOut: 5 });
  assert.ok(mismoDibujo(m, conInsert, a, 0, 30, layout) >= 890);
  assert.deepStrictEqual(M.verificarMontaje(conInsert), []);
});

test('ponerClave en medio de una S no la deforma hasta que se le cambia el valor', () => {
  const { m, enc } = encuadreLargo('suave');
  const x = M.ponerClave(m, enc.pistaId, enc.clipId, 12);
  for (let t = 0; t < 30; t += 0.5) {
    assert.ok(Math.abs(M.encuadresEn(x, t)[0].rect.xPct - M.encuadresEn(m, t)[0].rect.xPct) < 1e-9, `t=${t}`);
  }
});
