// Tests del modelo NUEVO de disposicion del visor 9:16
// (src/shared/layout916.js, 06/08/2026).
//
// Cada bloque de abajo corresponde a un bug concreto que el user reporto
// del sistema viejo (arbol de cortes). Estan escritos como "esto que
// antes se rompia, ahora tiene que aguantar".

const test = require('node:test');
const assert = require('node:assert');

const L = require('../src/shared/layout916');

const casi = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} (esperaba ${b}, dio ${a})`);

function areaTotal(layout, ids) {
  return L.celdasParaDibujar(layout, ids).reduce((acc, c) => acc + c.w * c.h, 0);
}

// ============================================================
// 1. PRESETS — antes se bugeaban entre si
// ============================================================

test('vertical apila a lo alto y cubre el panel entero', () => {
  const lay = L.crearLayout(['a', 'b', 'c'], 'vertical');
  const celdas = L.celdasParaDibujar(lay, ['a', 'b', 'c']);
  assert.strictEqual(celdas.length, 3);
  celdas.forEach((c) => casi(c.w, 1, 'cada celda ocupa todo el ancho'));
  casi(areaTotal(lay, ['a', 'b', 'c']), 1, 'sin huecos');
  [0, 1 / 3, 2 / 3].forEach((esperado, i) => casi(celdas[i].y, esperado, `arranque de la celda ${i + 1}`));
  // Los bordes tienen que CALZAR: donde termina una arranca la siguiente,
  // sin rendijas (era el bug de redondeo que encontraron estos tests).
  for (let i = 0; i < celdas.length - 1; i++) {
    casi(celdas[i].y + celdas[i].h, celdas[i + 1].y, `borde entre celda ${i + 1} y ${i + 2}`);
  }
  casi(celdas[celdas.length - 1].y + celdas[celdas.length - 1].h, 1, 'la ultima cierra en el borde');
});

test('horizontal reparte a lo ancho y cubre el panel entero', () => {
  const ids = ['a', 'b'];
  const lay = L.crearLayout(ids, 'horizontal');
  L.celdasParaDibujar(lay, ids).forEach((c) => casi(c.h, 1, 'cada celda ocupa todo el alto'));
  casi(areaTotal(lay, ids), 1, 'sin huecos');
});

test('grid con 4 arma 2x2 exacto', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const lay = L.crearLayout(ids, 'grid');
  const celdas = L.celdasParaDibujar(lay, ids);
  celdas.forEach((c) => { casi(c.w, 0.5, 'ancho'); casi(c.h, 0.5, 'alto'); });
  casi(areaTotal(lay, ids), 1, 'sin huecos');
});

test('grid con 3 no deja hueco: la ultima fila se ensancha', () => {
  const ids = ['a', 'b', 'c'];
  casi(areaTotal(L.crearLayout(ids, 'grid'), ids), 1, 'cobertura total');
});

test('cambiar de preset una y otra vez siempre deja el panel cubierto', () => {
  // El bug viejo: alternar presets iba dejando el layout cada vez peor.
  const ids = ['a', 'b', 'c'];
  let lay = L.crearLayout(ids, 'vertical');
  for (const modo of ['horizontal', 'grid', 'vertical', 'destacado', 'grid', 'horizontal']) {
    lay = L.aplicarPreset(lay, ids, modo);
    casi(areaTotal(lay, ids), 1, `cobertura despues de ${modo}`);
    assert.strictEqual(L.diagnostico(lay, ids).solapes, 0, `sin encimados despues de ${modo}`);
  }
});

test('todos los presets cubren el panel para 1..6 recuadros', () => {
  for (const modo of L.MODOS) {
    for (let n = 1; n <= 6; n++) {
      const ids = Array.from({ length: n }, (_, i) => 'c' + i);
      const lay = L.crearLayout(ids, modo);
      casi(areaTotal(lay, ids), 1, `${modo} con ${n} recuadros`);
      assert.strictEqual(L.diagnostico(lay, ids).solapes, 0, `${modo} con ${n}: sin encimados`);
    }
  }
});

// ============================================================
// 2. EL PEDIDO QUE ANTES ERA IMPOSIBLE
// ============================================================

test('"destacado": 1 ancho arriba y 2 angostos abajo (3 recuadros)', () => {
  // Pedido textual del user: "si hay 3 clip y quiero que uno sea
  // horizontal y 2 verticales no me deja".
  const ids = ['cara', 'juego1', 'juego2'];
  const lay = L.crearLayout(ids, 'destacado');
  const [arriba, izq, der] = L.celdasParaDibujar(lay, ids);
  casi(arriba.w, 1, 'el destacado ocupa todo el ancho');
  casi(izq.w, 0.5, 'los de abajo se reparten la mitad');
  casi(der.x, 0.5, 'el segundo arranca a la mitad');
  assert.ok(izq.h < arriba.h + 1e-9 && izq.y > 0, 'los angostos van abajo');
  casi(areaTotal(lay, ids), 1, 'sin huecos');
});

test('se pueden mezclar formas distintas a mano, sin que el modelo se queje', () => {
  // Se arma "1 ancho arriba + 2 angostos abajo" a pulso, sin usar el
  // preset. OJO con el orden: una celda de ancho completo NO se puede
  // correr al costado (quedaria fuera del panel, y moverCelda lo impide
  // con razon), asi que primero se le da la forma y despues se la ubica.
  const ids = ['a', 'b', 'c'];
  let lay = L.crearLayout(ids, 'vertical');
  lay = L.encajarCelda(lay, 'a', 'superior');            // (0,0,1,0.5)
  lay = L.encajarCelda(lay, 'b', 'izquierda');           // (0,0,0.5,1)
  lay = L.redimensionarCelda(lay, 'b', 'tl', 0, 0.5);    // -> (0,0.5,0.5,0.5)
  lay = L.encajarCelda(lay, 'c', 'derecha');             // (0.5,0,0.5,1)
  lay = L.redimensionarCelda(lay, 'c', 'tl', 0.5, 0.5);  // -> (0.5,0.5,0.5,0.5)
  casi(areaTotal(lay, ids), 1, 'el armado a mano tambien puede cubrir todo');
  assert.strictEqual(L.diagnostico(lay, ids).solapes, 0);
});

test('una celda de ancho completo no se puede correr al costado', () => {
  // Comportamiento correcto, verificado a proposito: si ocupa todo el
  // ancho no hay lugar hacia donde correrla sin salirse. Primero se
  // achica, despues se mueve.
  let lay = L.crearLayout(['a'], 'vertical');            // ancho 1
  lay = L.moverCelda(lay, 'a', 0.3, 0);
  casi(lay.celdas.a.x, 0, 'queda pegada a la izquierda');
  lay = L.redimensionarCelda(lay, 'a', 'br', 0.5, 1);    // ahora mide medio
  lay = L.moverCelda(lay, 'a', 0.3, 0);
  casi(lay.celdas.a.x, 0.3, 'ya achicada, si se puede mover');
});

// ============================================================
// 3. LA IDENTIDAD DEL RECUADRO — el bug de fondo
// ============================================================

test('la celda va atada al ID del recuadro, no a su posicion en la lista', () => {
  // Bug viejo: la unica forma de cambiar que recuadro iba donde era mover
  // el clip en la linea de tiempo, porque la celda salia del ORDEN.
  const lay = L.crearLayout(['a', 'b'], 'vertical');
  const arriba = lay.celdas.a;

  // Se reordena la lista (equivale a cambiar de pista en la timeline).
  const celdas = L.celdasParaDibujar(lay, ['b', 'a']);
  const deA = celdas.find((c) => c.clipId === 'a');
  assert.deepStrictEqual(
    { x: deA.x, y: deA.y, w: deA.w, h: deA.h }, arriba,
    'el recuadro "a" conserva SU celda aunque cambie el orden'
  );
});

test('intercambiar dos recuadros cambia solo sus lugares', () => {
  const ids = ['a', 'b', 'c'];
  const lay = L.crearLayout(ids, 'vertical');
  const antesA = { ...lay.celdas.a }, antesC = { ...lay.celdas.c }, antesB = { ...lay.celdas.b };
  const out = L.intercambiarCeldas(lay, 'a', 'c');
  assert.deepStrictEqual(out.celdas.a, antesC);
  assert.deepStrictEqual(out.celdas.c, antesA);
  assert.deepStrictEqual(out.celdas.b, antesB, 'el del medio no se toca');
});

// ============================================================
// 4. EDICION DIRECTA — antes solo funcionaba en modo "Libre"
// ============================================================

test('mover y redimensionar funcionan venga de donde venga el layout', () => {
  // El sistema viejo solo permitia esto en modo "Libre"; aca tiene que
  // andar salga de donde salga el layout. Se achica primero para que
  // quede lugar donde moverla (ver el test de ancho completo de arriba).
  for (const modo of L.MODOS) {
    let lay = L.crearLayout(['a', 'b'], modo);
    lay = L.redimensionarCelda(lay, 'a', 'br', 0.4, 0.4);
    assert.ok(lay.celdas.a.w <= 0.45, `redimensionar en modo ${modo}`);
    lay = L.moverCelda(lay, 'a', 0.2, 0.3);
    casi(lay.celdas.a.x, 0.2, `mover en x, modo ${modo}`);
    casi(lay.celdas.a.y, 0.3, `mover en y, modo ${modo}`);
  }
});

test('una celda nunca se sale del panel', () => {
  let lay = L.crearLayout(['a'], 'vertical');
  lay = L.moverCelda(lay, 'a', 5, -5);
  const c = lay.celdas.a;
  assert.ok(c.x >= 0 && c.y >= 0, 'sin coordenadas negativas');
  assert.ok(c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9, 'no se pasa del borde');
});

test('una celda no se puede achicar hasta desaparecer', () => {
  let lay = L.crearLayout(['a', 'b'], 'vertical');
  lay = L.redimensionarCelda(lay, 'a', 'br', 0, 0);
  assert.ok(lay.celdas.a.w >= L.MIN_CELDA - 1e-9, 'ancho minimo');
  assert.ok(lay.celdas.a.h >= L.MIN_CELDA - 1e-9, 'alto minimo');
});

test('los encajes de un clic dejan la celda donde dicen', () => {
  let lay = L.crearLayout(['a'], 'vertical');
  lay = L.encajarCelda(lay, 'a', 'derecha');
  assert.deepStrictEqual(lay.celdas.a, { x: 0.5, y: 0, w: 0.5, h: 1 });
  lay = L.encajarCelda(lay, 'a', 'tercioMedio');
  casi(lay.celdas.a.y, 1 / 3, 'tercio del medio');
});

// ============================================================
// 5. ALTA Y BAJA DE RECUADROS
// ============================================================

// CORREGIDO 06/08/2026. Este test pedia que la celda que ya estaba NO se
// moviera NUNCA, ni siquiera cuando ocupaba el panel entero. Esa regla era
// la que producia el bug que reporto el user con captura: dibujaba el
// segundo recuadro y el panel avisaba "1 encimada", con uno tapando al
// otro, porque no quedaba un solo lugar libre donde ponerlo.
// La regla correcta depende de si hay lugar, y son los dos tests de abajo:
// con espacio libre no se toca nada; sin espacio se reacomoda, porque dos
// celdas encimadas no le sirven a nadie.
test('un recuadro nuevo entra y, si no hay lugar, se reacomoda todo', () => {
  const lay = L.crearLayout(['a'], 'vertical');           // 'a' ocupa TODO
  const out = L.normalizar(lay, ['a', 'b']);
  assert.ok(out.celdas.b, 'la celda nueva existe');
  assert.strictEqual(L.diagnostico(out, ['a', 'b']).solapes, 0, 'y ninguna queda encimada');
  assert.notDeepStrictEqual(out.celdas.a, lay.celdas.a,
    'con el panel lleno, la que estaba TIENE que hacer lugar');
});

test('sacar un recuadro no deja su celda colgada', () => {
  const lay = L.crearLayout(['a', 'b', 'c'], 'vertical');
  const out = L.normalizar(lay, ['a', 'c']);
  assert.deepStrictEqual(Object.keys(out.celdas).sort(), ['a', 'c']);
});

test('normalizar sin cambios devuelve el mismo objeto (no rehace nada)', () => {
  const lay = L.crearLayout(['a', 'b'], 'vertical');
  assert.strictEqual(L.normalizar(lay, ['a', 'b']), lay);
});

test('normalizar sobre un layout vacio arma uno completo', () => {
  const out = L.normalizar(L.layoutVacio(), ['a', 'b'], 'horizontal');
  assert.strictEqual(L.celdasParaDibujar(out, ['a', 'b']).length, 2);
  casi(areaTotal(out, ['a', 'b']), 1, 'cubre el panel');
});

// ============================================================
// 6. DIAGNOSTICO — decir la verdad en vez de esconderla
// ============================================================

test('el diagnostico avisa cuando quedan huecos', () => {
  let lay = L.crearLayout(['a'], 'vertical');
  lay = L.encajarCelda(lay, 'a', 'superior');   // deja media pantalla vacia
  const d = L.diagnostico(lay, ['a']);
  assert.ok(d.cobertura > 0.45 && d.cobertura < 0.55, `cobertura ~50% (dio ${d.cobertura})`);
  assert.strictEqual(d.solapes, 0);
});

test('el diagnostico avisa cuando hay celdas encimadas', () => {
  let lay = L.crearLayout(['a', 'b'], 'vertical');
  lay = L.encajarCelda(lay, 'a', 'completo');
  lay = L.encajarCelda(lay, 'b', 'completo');
  assert.strictEqual(L.diagnostico(lay, ['a', 'b']).solapes, 1);
});

// ============================================================
// 7. PROYECTOS VIEJOS
// ============================================================

test('un arbol viejo se convierte sin perder la disposicion', () => {
  const arbolViejo = {
    tipo: 'corte', dir: 'fila', ratio: 0.25,
    a: { tipo: 'hoja', pos: 0 },
    b: { tipo: 'hoja', pos: 1 }
  };
  const lay = L.migrarDesdeArbol(arbolViejo, ['a', 'b']);
  casi(lay.celdas.a.h, 0.25, 'la proporcion vieja se respeta');
  casi(lay.celdas.b.y, 0.25, 'el segundo arranca donde termina el primero');
  casi(areaTotal(lay, ['a', 'b']), 1, 'sigue cubriendo todo');
});

test('un arbol viejo con celdas "libres" conserva sus rectangulos', () => {
  const arbolViejo = {
    tipo: 'corte', dir: 'fila', ratio: 0.5,
    a: { tipo: 'hoja', pos: 0, libre: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } },
    b: { tipo: 'hoja', pos: 1 }
  };
  const lay = L.migrarDesdeArbol(arbolViejo, ['a', 'b']);
  assert.deepStrictEqual(lay.celdas.a, { x: 0.1, y: 0.1, w: 0.3, h: 0.2 });
});

test('migrar algo que ya es del modelo nuevo lo deja igual', () => {
  const nuevo = L.crearLayout(['a'], 'vertical');
  assert.strictEqual(L.migrarDesdeArbol(nuevo, ['a']), nuevo);
});

test('migrar basura no rompe: devuelve un layout usable', () => {
  for (const basura of [null, undefined, 42, 'hola', {}]) {
    const lay = L.migrarDesdeArbol(basura, ['a', 'b']);
    assert.strictEqual(L.celdasParaDibujar(lay, ['a', 'b']).length, 2, `entrada: ${JSON.stringify(basura)}`);
  }
});

// ============================================================
// 8. ACUERDO ARRASTRE <-> GUARDADO (regresion 06/08/2026)
// ============================================================
// Bug reportado 2 VECES por el user: al estirar desde la esquina superior
// izquierda, la celda se achicaba al minimo y no se dejaba agrandar.
//
// La primera vez se corrigio en el sistema viejo... y al reescribir el
// modulo se volvio a colar el mismo error, porque aquel test protegia el
// camino viejo y no este. La causa es siempre la misma: el renderer
// mandaba al main SIEMPRE las coordenadas de la esquina inferior-derecha,
// sin importar cual se habia arrastrado. Como el main ancla la esquina
// OPUESTA a la que recibe, al mandarle "tl" con la posicion de la
// inferior-derecha movia esa esquina encima de su propia ancla.
//
// Este test recorre el camino completo (arrastre -> lo que se persiste ->
// lo que el main reconstruye) para las 4 esquinas.

// Lo que hace el renderer al soltar el mouse: manda la esquina real con
// LAS COORDENADAS DE ESA ESQUINA.
function argsAlSoltar(celda, esquina) {
  return {
    esquina,
    x: esquina.includes('l') ? celda.x : celda.x + celda.w,
    y: esquina.includes('t') ? celda.y : celda.y + celda.h
  };
}

test('ACUERDO: lo que se guarda es lo que se estiro, desde las 4 esquinas', () => {
  // Se arranca de una celda CHICA Y CENTRADA para que las 4 esquinas
  // tengan lugar hacia donde crecer. (Con un preset, la celda ya toca los
  // bordes y arrastrar hacia "afuera" seria en realidad hacia adentro.)
  const base = () => ({
    version: L.VERSION,
    celdas: { a: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, b: { x: 0, y: 0, w: 0.2, h: 0.2 } }
  });
  const destinos = {
    tl: [0.1, 0.1],   // cada esquina se lleva hacia su propio rincon
    tr: [0.9, 0.1],
    bl: [0.1, 0.9],
    br: [0.9, 0.9]
  };
  for (const [esquina, [mx, my]] of Object.entries(destinos)) {
    const inicial = base();
    const antes = inicial.celdas.a;

    // 1. Arrastre en vivo dentro de la ventana.
    const enVivo = L.redimensionarCelda(inicial, 'a', esquina, mx, my).celdas.a;
    assert.ok(enVivo.w > L.MIN_CELDA + 1e-9 && enVivo.h > L.MIN_CELDA + 1e-9,
      `arrastrar "${esquina}" no puede colapsar la celda (dio ${JSON.stringify(enVivo)})`);
    assert.ok(enVivo.w * enVivo.h > antes.w * antes.h,
      `arrastrar "${esquina}" hacia afuera tiene que AGRANDAR`);

    // 2. Lo que se persiste, y 3. lo que el main reconstruye sobre su copia.
    const args = argsAlSoltar(enVivo, esquina);
    const guardado = L.redimensionarCelda(inicial, 'a', args.esquina, args.x, args.y).celdas.a;

    assert.deepStrictEqual(guardado, enVivo,
      `desde "${esquina}", lo guardado tiene que calzar con lo que se vio`);
  }
});

test('ACUERDO: mandar siempre la esquina inferior-derecha (el bug) colapsa la celda', () => {
  // Deja constancia de que la correccion arregla algo real.
  const inicial = { version: L.VERSION, celdas: { a: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } } };
  const enVivo = L.redimensionarCelda(inicial, 'a', 'tl', 0.1, 0.1).celdas.a;
  const comoAntes = L.redimensionarCelda(inicial, 'a', 'tl', enVivo.x + enVivo.w, enVivo.y + enVivo.h).celdas.a;
  casi(comoAntes.w, L.MIN_CELDA, 'con el bug, el ancho colapsaba al minimo');
  casi(comoAntes.h, L.MIN_CELDA, 'y el alto tambien');
});

// ============================================================
// AGREGADO 06/08/2026 — RECUADROS QUE ENTRAN DE A UNO
// ============================================================
// BUG REAL REPORTADO (con captura): el user dibujo dos recuadros y el
// panel aviso "1 encimada", con uno tapando al otro.
// CAUSA: los recuadros se crean de a uno. El primero entra solo, asi que
// crearLayout le da el panel ENTERO; cuando entra el segundo,
// huecoLibre() busca el candidato que menos pise... pero como no queda
// nada libre, el "mejor" pisa igual. Con la panorama lleno hay que
// REACOMODAR, no encajar a la fuerza.

test('el segundo recuadro no se encima sobre el primero', () => {
  const uno = L.crearLayout(['a'], 'vertical');
  assert.deepStrictEqual(uno.celdas.a, { x: 0, y: 0, w: 1, h: 1 }, 'el primero ocupa todo');

  const dos = L.normalizar(uno, ['a', 'b']);
  assert.strictEqual(L.diagnostico(dos, ['a', 'b']).solapes, 0,
    `quedaron encimadas: ${JSON.stringify(dos.celdas)}`);
});

test('agregando de a uno hasta cuatro, nunca se encima ninguno', () => {
  let layout = L.layoutVacio();
  const ids = [];
  for (const id of ['a', 'b', 'c', 'd']) {
    ids.push(id);
    layout = L.normalizar(layout, ids);
    assert.strictEqual(L.diagnostico(layout, ids).solapes, 0,
      `con ${ids.length} recuadros: ${JSON.stringify(layout.celdas)}`);
  }
});

test('reacomodar no pisa una disposicion que el user ya habia armado', () => {
  // Dos celdas puestas a mano, con lugar libre abajo.
  const aMano = { version: L.VERSION, celdas: {
    a: { x: 0, y: 0, w: 0.5, h: 0.5 },
    b: { x: 0.5, y: 0, w: 0.5, h: 0.5 }
  } };
  const conTercero = L.normalizar(aMano, ['a', 'b', 'c']);
  assert.deepStrictEqual(conTercero.celdas.a, aMano.celdas.a, 'no deberia mover lo que ya estaba');
  assert.deepStrictEqual(conTercero.celdas.b, aMano.celdas.b);
  assert.strictEqual(L.diagnostico(conTercero, ['a', 'b', 'c']).solapes, 0);
});
