// Tests de los GESTOS de la linea de tiempo (13/09/2026, tanda C, paso 4).
//
// Protegen las reglas que evitan editar sin querer. Cada una tuvo su
// accidente: un clic quieto que recortaba o movia un corte, un clic en un
// vacio invisible que lo cerraba y desincronizaba, un doble clic que nunca
// unia, un teclado muerto despues de tocar 'Imán', un clip angosto
// imposible de mover y un zoom que perdia lo que se estaba mirando.
// Lo que depende del navegador de verdad (que el evento llegue, el foco)
// no se puede ver desde aca: esta en el checklist de impl-C.md.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const G = require('../src/renderer/gestosTl');

// ---------- Umbral de arrastre ----------

test('umbral: moverse menos de 4 px es un clic, no un arrastre', () => {
  assert.strictEqual(G.superoUmbral(100, 50, 100, 50), false);
  assert.strictEqual(G.superoUmbral(100, 50, 103, 52), false);
  assert.strictEqual(G.superoUmbral(100, 50, 97, 48), false);
});

test('umbral: 4 px en cualquier eje ya es arrastre (tambien hacia otra pista)', () => {
  assert.strictEqual(G.superoUmbral(100, 50, 104, 50), true);
  assert.strictEqual(G.superoUmbral(100, 50, 96, 50), true);
  assert.strictEqual(G.superoUmbral(100, 50, 100, 54), true);
});

test('boton suelto: sin el izquierdo apretado el arrastre se cancela', () => {
  assert.strictEqual(G.botonSuelto(0), true);
  assert.strictEqual(G.botonSuelto(2), true);          // solo el derecho
  assert.strictEqual(G.botonSuelto(1), false);
  assert.strictEqual(G.botonSuelto(3), false);         // izquierdo + derecho
  assert.strictEqual(G.botonSuelto(undefined), true);
});

// ---------- Foco del teclado ----------

test('teclado: las casillas y botones NO se comen los atajos (hallazgo 18)', () => {
  for (const type of ['checkbox', 'radio', 'button', 'range', 'color']) {
    assert.strictEqual(G.esCampoDeTexto({ tagName: 'INPUT', type }), false, type);
  }
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'BUTTON' }), false);
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'BODY' }), false);
  assert.strictEqual(G.esCampoDeTexto(null), false);
});

test('teclado: escribiendo (renombrar pista, buscar, notas) los atajos se ceden', () => {
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'INPUT', type: 'text' }), true);
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'INPUT', type: 'number' }), true);
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'INPUT' }), true);   // sin type = text
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'TEXTAREA' }), true);
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'SELECT' }), true);
  assert.strictEqual(G.esCampoDeTexto({ tagName: 'DIV', isContentEditable: true }), true);
});

// ---------- Manijas y etiqueta ----------

test('manijas: un clip de menos de 20 px no tiene, todo es cuerpo para moverlo', () => {
  assert.strictEqual(G.geometriaClip(10).manija, 0);
  assert.strictEqual(G.geometriaClip(14).manija, 0);
  assert.strictEqual(G.geometriaClip(19.9).manija, 0);
});

test('manijas: nunca comen mas de la mitad del clip y no pasan de 7 px', () => {
  for (const w of [20, 21, 24, 27, 28, 40, 100, 5000]) {
    const { manija } = G.geometriaClip(w);
    assert.ok(manija > 0, `${w}px deberia tener manijas`);
    assert.ok(manija <= G.MANIJA_MAX_PX);
    assert.ok(w - 2 * manija >= w / 2, `${w}px: cuerpo ${w - 2 * manija}`);
  }
  assert.strictEqual(G.geometriaClip(100).manija, 7);
});

test('etiqueta: se decide por pixeles, no por segundos (hallazgo 30)', () => {
  assert.strictEqual(G.geometriaClip(39).etiqueta, false);
  assert.strictEqual(G.geometriaClip(40).etiqueta, true);
  // un clip de 1,9 s a 69 px/s mide 132 px: antes quedaba sin nombre
  assert.strictEqual(G.geometriaClip(1.9 * 69.4).etiqueta, true);
});

test('borde mas cercano: mitad izquierda es in, mitad derecha es out', () => {
  assert.strictEqual(G.bordeMasCercano(2, 12), 'in');
  assert.strictEqual(G.bordeMasCercano(9, 12), 'out');
});

// ---------- Tabla del mousedown ----------

const md = (o) => G.accionDeMousedown(Object.assign({
  herramienta: 'seleccion', tipo: 'clip', detail: 1, borde: null, sinManijas: false, bordeCercano: 'in'
}, o));

test('clic en un VACIO lo elige, con cualquier herramienta menos la cuchilla (hallazgos 14, 25, 34)', () => {
  for (const herramienta of ['seleccion', 'ripple', 'roll', 'slip', 'slide']) {
    assert.deepStrictEqual(md({ herramienta, tipo: 'hueco' }), { accion: 'seleccionar-hueco' }, herramienta);
    // ni con doble clic se cierra: cerrar es Supr
    assert.deepStrictEqual(md({ herramienta, tipo: 'hueco', detail: 2 }), { accion: 'seleccionar-hueco' });
  }
  assert.deepStrictEqual(md({ herramienta: 'cuchilla', tipo: 'hueco' }), { accion: 'cortar' });
});

test('doble clic con Seleccion une; triple clic no vuelve a unir (hallazgo 28)', () => {
  assert.deepStrictEqual(md({ detail: 2 }), { accion: 'unir' });
  assert.deepStrictEqual(md({ detail: 2, borde: 'out' }), { accion: 'unir' });
  assert.notStrictEqual(md({ detail: 3 }).accion, 'unir');
  // con otras herramientas el segundo clic no es "unir"
  assert.notStrictEqual(md({ herramienta: 'roll', detail: 2 }).accion, 'unir');
  assert.deepStrictEqual(md({ herramienta: 'cuchilla', detail: 2 }), { accion: 'cortar' });
});

test('mousedown: los modos de arrastre son los de siempre', () => {
  assert.deepStrictEqual(md({}), { accion: 'arrastrar', modo: 'mover', borde: null });
  assert.deepStrictEqual(md({ borde: 'in' }), { accion: 'arrastrar', modo: 'recorte', borde: 'in' });
  assert.deepStrictEqual(md({ herramienta: 'ripple', borde: 'out' }), { accion: 'arrastrar', modo: 'ripple', borde: 'out' });
  assert.deepStrictEqual(md({ herramienta: 'roll', borde: 'in' }), { accion: 'arrastrar', modo: 'roll', borde: 'in' });
  assert.deepStrictEqual(md({ herramienta: 'slip' }), { accion: 'arrastrar', modo: 'slip', borde: null });
  assert.deepStrictEqual(md({ herramienta: 'slide', borde: 'out' }).modo, 'slide');
  // Ripple sobre el cuerpo de un clip ancho: solo selecciona
  assert.deepStrictEqual(md({ herramienta: 'ripple' }), { accion: 'seleccionar' });
});

test('clip angosto sin manijas: con Seleccion se MUEVE, con Ripple toma el borde mas cercano (hallazgo 21)', () => {
  assert.deepStrictEqual(md({ sinManijas: true }), { accion: 'arrastrar', modo: 'mover', borde: null });
  assert.deepStrictEqual(md({ herramienta: 'ripple', sinManijas: true, bordeCercano: 'out' }),
    { accion: 'arrastrar', modo: 'ripple', borde: 'out' });
});

// ---------- Zoom anclado ----------

test('zoom con la rueda: el instante bajo el puntero queda en el mismo pixel (hallazgos 23, 50)', () => {
  // Montaje de 10 min (vista 648 s), vista de 1000 px, zoom 5x -> 5000 px.
  const dur = 648;
  const anchoVista = 1000;
  const anchoAntes = 5000;
  const scrollAntes = 3700;               // mirando el minuto 8 mas o menos
  const xEnVista = 300;                   // el puntero sobre un corte
  const t = ((scrollAntes + xEnVista) / anchoAntes) * dur;
  // tres Ctrl+rueda de 1.2x
  const anchoNuevo = anchoAntes * 1.2 * 1.2 * 1.2;
  const sl = G.scrollParaAncla({ t, xEnVista, dur, anchoLienzo: anchoNuevo, anchoVista });
  const tDespues = ((sl + xEnVista) / anchoNuevo) * dur;
  assert.ok(Math.abs(tDespues - t) < 1e-9, `${tDespues} vs ${t}`);
});

test('zoom anclado: el scroll no sale del lienzo en los extremos', () => {
  assert.strictEqual(G.scrollParaAncla({ t: 0, xEnVista: 500, dur: 100, anchoLienzo: 4000, anchoVista: 1000 }), 0);
  assert.strictEqual(G.scrollParaAncla({ t: 100, xEnVista: 0, dur: 100, anchoLienzo: 4000, anchoVista: 1000 }), 3000);
  // "Ajustar" (lienzo igual a la vista): siempre 0
  assert.strictEqual(G.scrollParaAncla({ t: 50, xEnVista: 10, dur: 100, anchoLienzo: 1000, anchoVista: 1000 }), 0);
  assert.strictEqual(G.scrollParaAncla({ t: 50, xEnVista: 10, dur: 0, anchoLienzo: 1000, anchoVista: 1000 }), 0);
});

test('zoom con botones: el cabezal visible se queda donde esta; si no se ve, va al centro', () => {
  const base = { dur: 100, anchoLienzo: 4000, anchoVista: 1000 };
  assert.strictEqual(G.xDeCabezalEnVista(Object.assign({ cabezal: 30, scrollLeft: 1000 }, base)), 200);
  assert.strictEqual(G.xDeCabezalEnVista(Object.assign({ cabezal: 90, scrollLeft: 1000 }, base)), 500);
});

test('seguir al cabezal: no toca nada mientras se ve, pagina al llegar al borde (hallazgo 26)', () => {
  const b = { scrollLeft: 1000, anchoVista: 1000, anchoLienzo: 10000 };
  assert.strictEqual(G.scrollParaSeguir(Object.assign({ x: 1500 }, b)), null);
  assert.strictEqual(G.scrollParaSeguir(Object.assign({ x: 1960 }, b)), null);
  assert.strictEqual(G.scrollParaSeguir(Object.assign({ x: 1970 }, b)), 1930);
  // quedo a la izquierda de la vista (volvio al inicio)
  assert.strictEqual(G.scrollParaSeguir(Object.assign({ x: 10 }, b)), 0);
  // al final del lienzo no se pasa
  assert.strictEqual(G.scrollParaSeguir(Object.assign({ x: 9990 }, b)), 9000);
  // ya esta en el tope: nada que mover
  assert.strictEqual(G.scrollParaSeguir({ x: 9990, scrollLeft: 9000, anchoVista: 1000, anchoLienzo: 10000 }), null);
});

test('tope de zoom: 824 s llegan a 10 px por cuadro a 30 fps; los montajes cortos conservan 40x (hallazgo 29)', () => {
  const dur = 864;          // 824 s + 5 %… lo que da durVista
  const anchoVista = 1500;
  const max = G.zoomMaximo(dur, anchoVista);
  const pxPorSeg = (anchoVista * max) / dur;
  assert.ok(Math.abs(pxPorSeg - 300) < 1e-9);
  assert.ok(pxPorSeg / 30 >= 10);
  assert.strictEqual(G.zoomMaximo(15, 1500), 40);
  assert.strictEqual(G.limitarZoom(0.3, 40), 1);
  assert.strictEqual(G.limitarZoom(99, 40), 40);
  assert.strictEqual(G.limitarZoom(NaN, 40), 1);
});

test('encabezados: relleno igual a la barra horizontal de las filas', () => {
  assert.strictEqual(G.rellenoParaBarra(200, 183), 17);
  assert.strictEqual(G.rellenoParaBarra(200, 200), 0);
});

// ---------- El cableado en renderer.js ----------
// Chequeos sobre el texto: no prueban que ande, pero hacen ruido si
// alguien vuelve a poner lo que causaba los accidentes.

const RAIZ = path.join(__dirname, '..', 'src', 'renderer');
const renderer = fs.readFileSync(path.join(RAIZ, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

test('cableado: gestosTl.js se carga antes que renderer.js', () => {
  const g = html.indexOf('<script src="gestosTl.js">');
  const r = html.indexOf('<script src="renderer.js">');
  assert.ok(g > 0 && r > g);
});

test('cableado: el mousedown de un vacio ya no lo cierra y no hay listener de dblclick en las pistas', () => {
  assert.ok(!/tlPistas\.addEventListener\('dblclick'/.test(renderer));
  const i = renderer.indexOf("tlPistas.addEventListener('mousedown'");
  const j = renderer.indexOf('// ---------- Arrastre en vivo ----------');
  assert.ok(i > 0 && j > i);
  const bloque = renderer.slice(i, j);
  assert.ok(!bloque.includes('montajeCerrarHueco'), 'el mousedown no puede cerrar vacios');
  assert.ok(!bloque.includes('renderTl()'), 'rehacer el HTML en el mousedown mata el doble clic');
});

test('cableado: el keydown usa esCampoDeTexto y Escape cancela el arrastre', () => {
  assert.ok(!renderer.includes("/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)"));
  assert.ok(renderer.includes('GestosTl.esCampoDeTexto(document.activeElement)'));
  assert.ok(/ev\.key === 'Escape' && arrastreTl/.test(renderer));
  assert.ok(/addEventListener\('blur', \(\) => cancelarArrastreTl/.test(renderer));
});

// ---------- Base de cuadro en la interfaz (tanda D, paso 6) ----------

test('tope de zoom con fps: 10 px por cuadro del montaje (60 fps -> 600 px/s)', () => {
  const dur = 864, anchoVista = 1500;
  const a60 = G.zoomMaximo(dur, anchoVista, 60);
  assert.ok(Math.abs((anchoVista * a60) / dur - 600) < 1e-9);
  const a25 = G.zoomMaximo(dur, anchoVista, 25);
  assert.ok(Math.abs((anchoVista * a25) / dur - 250) < 1e-9);
  assert.strictEqual(G.zoomMaximo(15, 1500, 60), 40, 'los cortos conservan 40x');
});

test('flechas: un cuadro, Shift un segundo, siempre sobre la grilla y dentro del montaje', () => {
  const ntsc = 30000 / 1001;
  const uno = G.cabezalConFlecha({ cabezal: 10, fps: ntsc, sentido: 1, duracion: 60 });
  assert.ok(Math.abs(uno * ntsc - Math.round(uno * ntsc)) < 1e-9, 'queda en un cuadro');
  assert.strictEqual(Math.round(uno * ntsc) - Math.round(10 * ntsc), 1);
  // Un cabezal entre dos cuadros primero se lleva al suyo: no da medio paso.
  const desdeMedio = G.cabezalConFlecha({ cabezal: 10.013, fps: 30, sentido: -1, duracion: 60 });
  assert.ok(Math.abs(desdeMedio - 299 / 30) < 1e-9);
  assert.ok(Math.abs(G.cabezalConFlecha({ cabezal: 5, fps: 25, sentido: 1, grande: true, duracion: 60 }) - 6) < 1e-9);
  assert.strictEqual(G.cabezalConFlecha({ cabezal: 0, fps: 30, sentido: -1, duracion: 60 }), 0);
  assert.ok(Math.abs(G.cabezalConFlecha({ cabezal: 60, fps: 30, sentido: 1, duracion: 60 }) - 60) < 1e-9);
  // Sin fps (montaje sin base de cuadro): 30.
  assert.ok(Math.abs(G.cabezalConFlecha({ cabezal: 1, sentido: 1 }) - 31 / 30) < 1e-9);
});

test('cableado: las flechas del teclado usan cabezalConFlecha y tiempoDesdeX redondea al cuadro', () => {
  const r = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(r, /k === 'arrowleft' \|\| k === 'arrowright'/);
  assert.match(r, /GestosTl\.cabezalConFlecha\(/);
  assert.match(r, /Montaje\.aCuadro\(tlDatos\.montaje, t\)/);
  assert.match(r, /GestosTl\.zoomMaximo\(dur, anchoVista, fpsTl\(\)\)/);
});
