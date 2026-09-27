// RED DE INVARIANTES (13/09/2026, tanda B, paso 2 de la hoja de ruta de
// D:\investigacion-clipforge\linea-de-tiempo\INFORME.md).
//
// Los demas tests de la linea de tiempo fijan casos armados a mano. Este
// corre miles de operaciones al azar (con semilla, asi se repite igual) y
// despues de CADA una llama a Montaje.verificarMontaje(). Una operacion
// que rompe el vinculo imagen-sonido falla aca aunque nadie haya escrito
// su caso.
//
// Las clases que se sabe que todavia fallan van como `todo` CON NOMBRE y
// con el paso de la hoja de ruta que las arregla, para que `npm test`
// siga verde y sirva de red mientras tanto. Cuando se arregle una, se le
// saca el `todo` y queda cubierta para siempre.
//
// Para ver el informe completo de una semilla (con corrida y paso de cada
// falla, para reproducirla):   node test/propiedades.generador.js 7

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const G = require('./propiedades.generador');

// ============================================================
// EL VERIFICADOR DETECTA LO QUE DICE
// ============================================================
// Antes de confiar en que "no encontro nada", hay que ver que encuentra.

function montajeSano() {
  let m = M.crearMontaje();
  let mediaId, v1, a1;
  [m, mediaId] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 100 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));
  m = M.sobrescribirEn(m, v1, 10, M.clip(mediaId, 20, 30));
  m = M.espejarEnAudio(m, v1, a1);
  return { m, mediaId, v1, a1 };
}

// Cambia a mano un elemento guardado (el verificador tiene que ver
// montajes rotos que ninguna operacion deberia producir).
function tocar(m, pistaId, indice, cambios) {
  return {
    ...m,
    pistas: m.pistas.map((p) => (p.id !== pistaId ? p : {
      ...p, elementos: p.elementos.map((el, i) => (i === indice ? { ...el, ...cambios } : el))
    }))
  };
}

const tipos = (m) => M.verificarMontaje(m).map((f) => f.tipo);

test('verificarMontaje: un montaje sano no tiene violaciones', () => {
  const { m } = montajeSano();
  assert.deepStrictEqual(M.verificarMontaje(m), []);
  assert.deepStrictEqual(M.verificarMontaje(M.crearMontaje()), []);
});

test('verificarMontaje: detecta la pareja desalineada (en la linea y en la fuente)', () => {
  const { m, a1 } = montajeSano();
  const corrido = { ...m, pistas: m.pistas.map((p) => (p.id !== a1 ? p
    : { ...p, elementos: [M.hueco(2)].concat(p.elementos) })) };
  assert.ok(tipos(corrido).includes('vinculoDesalineado'), 'audio 2 s tarde');
  const otraFuente = tocar(m, a1, 0, { usadoIn: 1, usadoOut: 11 });
  assert.ok(tipos(otraFuente).includes('vinculoDesalineado'), 'mismo tramo, otra parte del material');
});

test('verificarMontaje: detecta el vinculo huerfano y el repetido en una pista', () => {
  const { m, v1, a1 } = montajeSano();
  const sinAudio = { ...m, pistas: m.pistas.map((p) => (p.id === a1 ? { ...p, elementos: [] } : p)) };
  assert.ok(tipos(sinAudio).includes('vinculoHuerfano'));
  const k = M.elementosDePista(m, v1)[0].vinculo;
  assert.ok(tipos(tocar(m, v1, 1, { vinculo: k })).includes('vinculoRepetido'));
});

test('verificarMontaje: detecta material faltante, usado fuera del archivo e ids repetidos', () => {
  const { m, v1, a1 } = montajeSano();
  assert.ok(tipos(tocar(m, v1, 0, { mediaId: 'no-existe' })).includes('materialFaltante'));
  const fuera = tocar(tocar(m, v1, 1, { usadoIn: 95, usadoOut: 105 }), a1, 1, { usadoIn: 95, usadoOut: 105 });
  assert.deepStrictEqual([...new Set(tipos(fuera))], ['fueraDeMaterial'], 'imagen y sonido, los dos fuera y todavia alineados');
  const idV = M.elementosDePista(m, v1)[0].id;
  assert.ok(tipos(tocar(m, a1, 0, { id: idV })).includes('idRepetido'));
});

test('verificarMontaje: detecta estructura rota y pedazos menores a MIN_DUR', () => {
  const { m, v1, mediaId } = montajeSano();
  const conHuecoFinal = { ...m, pistas: m.pistas.map((p) => (p.id === v1
    ? { ...p, elementos: p.elementos.concat([M.hueco(3)]) } : p)) };
  assert.ok(tipos(conHuecoFinal).includes('estructura'));
  const corto = M.sobrescribirEn(m, v1, 30, M.clip(mediaId, 50, 50.01));
  assert.ok(tipos(corto).includes('clipCorto'));
  // Un encuadre no tiene material: no puede ser "faltante".
  const conEncuadre = M.colocarEncuadre(m, 0, 10)[0];
  assert.deepStrictEqual(M.verificarMontaje(conEncuadre), []);
});

// ============================================================
// PROPIEDADES: NINGUNA OPERACION ROMPE EL MONTAJE
// ============================================================

// Tres semillas y 400 montajes cada una: ~40.000 operaciones, poco mas de
// un segundo. La 7 es la del INFORME (fuzz2.js).
//
// TANDA D (13/09/2026): las tres corren CON BASE DE CUADRO (un fps al azar
// por montaje, como en la app, donde todo montaje tiene fps). Ademas se
// sigue corriendo una exploracion en tiempo CONTINUO, solo para el vinculo:
// es el modo de los montajes armados a mano y no tiene que romper parejas.
const SEMILLAS = [7, 1, 2];
const exploraciones = SEMILLAS.map((semilla) => G.explorar({ semilla, corridas: 400, pasos: 40, fps: 'azar' }));
const continua = G.explorar({ semilla: 7, corridas: 200, pasos: 40 });

function fallasDe(op, clases, lista) {
  const out = [];
  (lista || exploraciones).forEach((r) => {
    Object.entries(r.hallazgos[op] || {}).forEach(([tipo, reg]) => {
      if (clases.includes(tipo)) {
        const e = reg.ejemplo;
        out.push(`${op} -> ${tipo} x${reg.veces} (semilla ${e.semilla}, corrida ${e.corrida}, paso ${e.paso}: ${e.detalle})`);
      }
    });
  });
  return out;
}

// LO QUE TODAVIA FALLA, con nombre y con el paso que lo arregla.
// Vinculo: ya no hay `todo` (tanda E, paso 7). Antes ripple y borrar con
// ripple corrian solo las pistas del clip y su pareja, y cualquier otra
// pista con clips vinculados detras quedaba quieta. Con el ripple
// multipista se corren todas las no bloqueadas, o no se hace nada si eso
// separaria un vinculo.
const TODO_VINCULO = {};
// Pedazos menores a un cuadro: ya no hay `todo` (tanda D, paso 6). Con base
// de cuadro ninguna operacion deja restos de milisegundos ni fronteras
// entre cuadros, aunque los tiempos lleguen al azar (iman apagado). Antes
// fallaban borrar, colocar, mover, moverV y recortar.
const TODO_CUADRO = {};

test('propiedades: el generador aplica operaciones de verdad y ninguna tira', () => {
  exploraciones.forEach((r, i) => {
    assert.deepStrictEqual(r.errores.map((e) => `${e.op} corrida ${e.corrida} paso ${e.paso}: ${e.error.split('\n')[0]}`), [],
      `semilla ${SEMILLAS[i]}`);
    assert.ok(r.aplicadas > 5000, `semilla ${SEMILLAS[i]}: solo ${r.aplicadas} operaciones`);
  });
});

G.OPERACIONES.forEach((op) => {
  test(`propiedades: ${op} no rompe vinculos ni estructura`, { todo: TODO_VINCULO[op] }, () => {
    const fallas = fallasDe(op, G.CLASES_VINCULO);
    assert.deepStrictEqual(fallas, []);
  });
  test(`propiedades: ${op} no deja clips ni vacios menores a un cuadro ni fronteras fuera de cuadro`, { todo: TODO_CUADRO[op] }, () => {
    const fallas = fallasDe(op, G.CLASES_CUADRO);
    assert.deepStrictEqual(fallas, []);
  });
  test(`propiedades: ${op} en tiempo continuo (sin fps) no rompe vinculos`, { todo: TODO_VINCULO[op] }, () => {
    assert.deepStrictEqual(fallasDe(op, G.CLASES_VINCULO, [continua]), []);
  });
});

// TANDA E (paso 7): las operaciones que corren lo de atras dejan cada
// encuadre sobre la misma frase. Antes de este paso, borrar con ripple o
// cerrar un vacio en V1 dejaba los encuadres de V2 quietos, recortando otro
// material (hallazgo 33).
// TANDA F (paso 8, keyframes): toda operacion deja las claves bien formadas,
// en cuadro y dentro del material, y la animacion de cada clip pegada a su
// contenido (el mismo cuadro de la fuente vale lo mismo antes y despues).
// Las de ripple ademas dejan igual la animacion de cada encuadre sobre su
// frase. Todo con las tres curvas, 'suave' partida incluida.
G.OPERACIONES.forEach((op) => {
  test(`propiedades: ${op} deja las claves en cuadro y la animacion pegada al contenido`, () => {
    assert.deepStrictEqual(fallasDe(op, G.CLASES_CLAVE.concat(G.CLASES_ANIMACION)), []);
    assert.deepStrictEqual(fallasDe(op, G.CLASES_CLAVE.concat(G.CLASES_ANIMACION), [continua]), []);
  });
});

test('propiedades: el generador pone claves de verdad (si no, la red de arriba no mira nada)', () => {
  const azar = G.crearAzar(3);
  let animados = 0;
  for (let i = 0; i < 40; i++) {
    const m = G.montajeBase(azar, 30);
    if (m.pistas.some((p) => p.elementos.some((e) => M.clavesDe(e).length))) animados++;
  }
  assert.ok(animados >= 10, `solo ${animados} de 40 montajes con claves`);
});

G.OPERACIONES_RIPPLE.forEach((op) => {
  test(`propiedades: ${op} deja cada encuadre sobre el mismo material`, () => {
    assert.deepStrictEqual(fallasDe(op, G.CLASES_ENCUADRE), []);
    assert.deepStrictEqual(fallasDe(op, G.CLASES_ENCUADRE, [continua]), []);
  });
});
