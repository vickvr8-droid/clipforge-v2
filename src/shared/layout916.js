// ============================================================
// DISPOSICION DE CELDAS DEL VISOR 9:16 — MODELO NUEVO (06/08/2026)
// ============================================================
// REEMPLAZA por completo al "arbol de cortes" de geometria916.js.
//
// POR QUE SE REHIZO DE CERO (bugs reales reportados por el user):
//   1. Los presets (vertical/horizontal/grid) se bugeaban entre si.
//   2. "Distribuir parejo" rompia los encuadres.
//   3. No habia forma comoda de decir "el recuadro 1 va a la izquierda":
//      la unica manera era mover el clip en la linea de tiempo, porque la
//      posicion salia del ORDEN de los clips activos, no de una decision
//      del user.
//   4. Con 3 recuadros no se podia pedir "1 horizontal arriba y 2
//      verticales abajo": el arbol solo sabia partir en 2 cada vez, y los
//      presets imponian una forma unica para todas las celdas.
//
// LA CAUSA RAIZ ERA EL MODELO, NO LOS BOTONES. El arbol binario ataba
// tres cosas que tienen que estar sueltas: QUE recuadro va en cada celda,
// DONDE esta esa celda, y QUE FORMA tiene. Cambiar una arrastraba a las
// otras, y por eso "arreglar" un boton rompia otro.
//
// MODELO NUEVO — un rectangulo explicito por recuadro:
//     layout = { version: 2, celdas: { [clipId]: { x, y, w, h } } }
// Coordenadas 0..1 relativas al panel 9:16. Nada mas.
//
// Las 3 cosas quedan independientes:
//   - QUE recuadro: la CLAVE es el id del clip, no su posicion en una
//     lista. Mover el clip en la linea de tiempo ya NO cambia su celda.
//   - DONDE: x/y, editables directo, siempre (no solo en modo "libre").
//   - QUE FORMA: w/h, cada celda la suya. Una ancha y dos angostas
//     conviven sin problema - era imposible con el arbol.
//
// A CAMBIO SE PIERDE la garantia estructural del arbol ("nunca quedan
// huecos ni superposiciones"). Es un cambio DELIBERADO: el user pidio
// justamente poder acomodar libre. Para el que quiera la grilla prolija
// estan los presets y acomodarParejo(), que la reconstruyen cuando se
// piden - en vez de imponerla todo el tiempo.
//
// Modulo PURO: se carga con require() en el main y con <script> en el
// renderer (mismo envoltorio que geometria916.js).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Layout916 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 2;
  const MIN_CELDA = 0.06;   // 6% del panel: piso para que una celda no desaparezca
  const EPS = 1e-6;

  function limitar(v, min, max) { return Math.max(min, Math.min(max, v)); }
  // Redondeo a 9 decimales, NO a 6 (bug encontrado por los tests al
  // escribirlos): con 6 decimales, tres celdas de 1/3 quedaban en
  // 0.333333 y sumaban 0.999999 - un hueco real de casi 1 pixel en un
  // panel de 1080px, justo el tipo de franja negra fina que despues
  // aparece en el video exportado y no se sabe de donde salio.
  function redondear(v) { return Math.round(v * 1e9) / 1e9; }

  function rect(x, y, w, h) {
    return { x: redondear(x), y: redondear(y), w: redondear(w), h: redondear(h) };
  }

  function layoutVacio() {
    return { version: VERSION, celdas: {} };
  }

  // ----------------------------------------------------------
  // PRESETS
  // ----------------------------------------------------------
  // Un preset es solo "calculame rectangulos para estos ids, en este
  // orden". No deja ningun estado escondido: el resultado son celdas
  // normales, editables una por una despues. Por eso ya no puede pasar
  // que aplicar un preset y despues mover algo a mano se peleen entre si.

  const MODOS = ['vertical', 'horizontal', 'grid', 'destacado'];

  function rectsPreset(cantidad, modo) {
    if (cantidad <= 0) return [];
    if (cantidad === 1) return [rect(0, 0, 1, 1)];

    // Las celdas se derivan de BORDES compartidos (borde[i] .. borde[i+1])
    // en vez de multiplicar un ancho fijo: asi el borde donde termina una
    // es exactamente donde arranca la siguiente, y la ultima cierra justo
    // en 1. Calcular "i*w" acumula error y deja rendijas entre celdas.
    const bordes = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);

    if (modo === 'horizontal') {
      const bx = bordes(cantidad);
      return Array.from({ length: cantidad }, (_, i) => rect(bx[i], 0, bx[i + 1] - bx[i], 1));
    }

    if (modo === 'grid') {
      // Cuadricula lo mas cuadrada posible; si sobran lugares en la ultima
      // fila, sus celdas se ensanchan para no dejar un hueco.
      const cols = Math.ceil(Math.sqrt(cantidad));
      const filas = Math.ceil(cantidad / cols);
      const by = bordes(filas);
      const out = [];
      for (let f = 0; f < filas; f++) {
        const enEstaFila = Math.min(cols, cantidad - f * cols);
        const bx = bordes(enEstaFila);
        for (let c = 0; c < enEstaFila; c++) {
          out.push(rect(bx[c], by[f], bx[c + 1] - bx[c], by[f + 1] - by[f]));
        }
      }
      return out;
    }

    if (modo === 'destacado') {
      // NUEVO (06/08/2026) - resuelve el pedido concreto del user: "si hay
      // 3 clips y quiero que uno sea horizontal y 2 verticales". El
      // primero ocupa una franja ancha arriba; el resto se reparte abajo,
      // en vertical. Es el layout tipico de un short con cara + gameplay.
      const altoArriba = 0.5;
      const resto = cantidad - 1;
      const bx = bordes(resto);
      const out = [rect(0, 0, 1, altoArriba)];
      for (let i = 0; i < resto; i++) {
        out.push(rect(bx[i], altoArriba, bx[i + 1] - bx[i], 1 - altoArriba));
      }
      return out;
    }

    // 'vertical' (por defecto): apilados de arriba a abajo, ancho completo.
    const by = bordes(cantidad);
    return Array.from({ length: cantidad }, (_, i) => rect(0, by[i], 1, by[i + 1] - by[i]));
  }

  // Arma un layout nuevo para estos ids con el preset pedido.
  function crearLayout(clipIds, modo = 'vertical') {
    const rects = rectsPreset(clipIds.length, modo);
    const celdas = {};
    clipIds.forEach((id, i) => { celdas[id] = rects[i] || rect(0, 0, 1, 1); });
    return { version: VERSION, celdas };
  }

  // Reaplica un preset SOBRE un layout existente, respetando el orden de
  // clipIds. Es lo que hacen tanto el selector de modo como el boton
  // "Acomodar parejo" - misma operacion, sin caminos separados que puedan
  // divergir (era una de las fuentes de bugs del sistema viejo).
  function aplicarPreset(layout, clipIds, modo = 'vertical') {
    return crearLayout(clipIds, modo);
  }

  // ----------------------------------------------------------
  // MANTENIMIENTO
  // ----------------------------------------------------------

  // Garantiza que haya una celda por cada clip activo y ninguna de mas.
  // Un clip nuevo entra con el hueco mas grande que quede libre, para que
  // aparezca en algun lado visible en vez de encimado sobre otro.
  function normalizar(layout, clipIds, modo = 'vertical') {
    const base = (layout && layout.celdas) ? layout : layoutVacio();
    const faltan = clipIds.filter((id) => !base.celdas[id]);
    const sobran = Object.keys(base.celdas).filter((id) => !clipIds.includes(id));
    if (!faltan.length && !sobran.length) return base;

    // Si no habia nada util, se arma de cero con el preset.
    const quedan = clipIds.filter((id) => base.celdas[id]);
    if (!quedan.length) return crearLayout(clipIds, modo);

    const celdas = {};
    quedan.forEach((id) => { celdas[id] = base.celdas[id]; });
    faltan.forEach((id, i) => { celdas[id] = huecoLibre(celdas, i); });
    const salida = { version: VERSION, celdas };

    // SI NO HABIA LUGAR DE VERDAD, REACOMODAR TODO.
    // huecoLibre() elige el candidato que MENOS pisa, pero cuando el panel
    // ya esta lleno el menos malo pisa igual. Pasaba siempre en el caso
    // mas comun: el primer recuadro entra solo y se queda con el panel
    // entero, asi que el segundo no tenia donde caer y el user veia
    // "1 encimada" con un recuadro tapando al otro (reportado 06/08/2026).
    // Solo se reacomoda si de verdad quedo un solape - una disposicion
    // armada a mano con lugar libre se respeta tal cual.
    if (faltan.length && diagnostico(salida, clipIds).solapes > 0) {
      return crearLayout(clipIds, modo);
    }
    return salida;
  }

  // Busca un lugar razonable para una celda nueva: prueba la mitad de
  // abajo, la mitad de arriba y el centro, y se queda con la que menos
  // pisa a las que ya estan.
  function huecoLibre(celdas, indice) {
    const candidatos = [
      rect(0, 0.5, 1, 0.5),
      rect(0, 0, 1, 0.5),
      rect(0.25, 0.25, 0.5, 0.5),
      rect(0, 0.66, 1, 0.34)
    ];
    const existentes = Object.values(celdas);
    let mejor = candidatos[indice % candidatos.length];
    let mejorSolape = Infinity;
    for (const c of candidatos) {
      const solape = existentes.reduce((acc, e) => acc + areaSolape(c, e), 0);
      if (solape < mejorSolape) { mejorSolape = solape; mejor = c; }
    }
    return mejor;
  }

  function areaSolape(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (w > 0 && h > 0) ? w * h : 0;
  }

  // ----------------------------------------------------------
  // EDICION DIRECTA (siempre disponible, en cualquier modo)
  // ----------------------------------------------------------
  // El sistema viejo solo dejaba mover/redimensionar en modo "Libre".
  // Aca no hay modos que bloqueen: un preset es un punto de partida, no
  // una jaula.

  function moverCelda(layout, clipId, x, y) {
    const c = layout.celdas[clipId];
    if (!c) return layout;
    const nuevo = rect(limitar(x, 0, 1 - c.w), limitar(y, 0, 1 - c.h), c.w, c.h);
    return { ...layout, celdas: { ...layout.celdas, [clipId]: nuevo } };
  }

  // Redimensiona desde una esquina ('tl'/'tr'/'bl'/'br'), anclando la
  // opuesta. (x,y) es donde esta el mouse ahora, en 0..1.
  function redimensionarCelda(layout, clipId, esquina, x, y) {
    const c = layout.celdas[clipId];
    if (!c) return layout;
    const anclaX = esquina.includes('l') ? c.x + c.w : c.x;
    const anclaY = esquina.includes('t') ? c.y + c.h : c.y;
    const mx = limitar(x, 0, 1);
    const my = limitar(y, 0, 1);

    let nx = Math.min(anclaX, mx);
    let ny = Math.min(anclaY, my);
    let nw = Math.max(MIN_CELDA, Math.abs(mx - anclaX));
    let nh = Math.max(MIN_CELDA, Math.abs(my - anclaY));
    if (nx + nw > 1) nx = 1 - nw;
    if (ny + nh > 1) ny = 1 - nh;
    return { ...layout, celdas: { ...layout.celdas, [clipId]: rect(nx, ny, nw, nh) } };
  }

  // Intercambia los lugares de 2 recuadros. ESTA es la operacion que el
  // sistema viejo no tenia y que obligaba a mover clips en la linea de
  // tiempo para reordenar el 9:16.
  function intercambiarCeldas(layout, idA, idB) {
    const a = layout.celdas[idA];
    const b = layout.celdas[idB];
    if (!a || !b) return layout;
    return { ...layout, celdas: { ...layout.celdas, [idA]: b, [idB]: a } };
  }

  // Lleva una celda a ocupar toda una mitad/franja del panel de una.
  // Atajos de un clic para las formas que mas se usan en un short.
  const ENCAJES = {
    completo: rect(0, 0, 1, 1),
    superior: rect(0, 0, 1, 0.5),
    inferior: rect(0, 0.5, 1, 0.5),
    izquierda: rect(0, 0, 0.5, 1),
    derecha: rect(0.5, 0, 0.5, 1),
    tercioSuperior: rect(0, 0, 1, 1 / 3),
    tercioMedio: rect(0, 1 / 3, 1, 1 / 3),
    tercioInferior: rect(0, 2 / 3, 1, 1 / 3)
  };

  function encajarCelda(layout, clipId, encaje) {
    const r = ENCAJES[encaje];
    if (!r || !layout.celdas[clipId]) return layout;
    return { ...layout, celdas: { ...layout.celdas, [clipId]: { ...r } } };
  }

  // ----------------------------------------------------------
  // LECTURA PARA DIBUJAR
  // ----------------------------------------------------------

  // Devuelve las celdas en el orden de clipIds (que el llamador ordena
  // por pista), cada una con su indice para poder numerarlas en pantalla
  // igual que en el visor 16:9.
  function celdasParaDibujar(layout, clipIds) {
    const base = (layout && layout.celdas) ? layout.celdas : {};
    return clipIds
      .map((id, i) => {
        const c = base[id];
        return c ? { clipId: id, pos: i, x: c.x, y: c.y, w: c.w, h: c.h } : null;
      })
      .filter(Boolean);
  }

  // Diagnostico honesto para la interfaz: cuanto del panel queda sin
  // cubrir y si hay celdas encimadas. El sistema viejo escondia esto
  // detras de la garantia del arbol; ahora que se puede acomodar libre,
  // conviene DECIRLO en vez de que el user se entere al exportar.
  function diagnostico(layout, clipIds) {
    const celdas = celdasParaDibujar(layout, clipIds);
    let solapes = 0;
    for (let i = 0; i < celdas.length; i++) {
      for (let j = i + 1; j < celdas.length; j++) {
        if (areaSolape(celdas[i], celdas[j]) > EPS) solapes++;
      }
    }
    // Cobertura por muestreo en una grilla de 40x40: exacto no hace falta
    // y evita tener que calcular la union de rectangulos arbitrarios.
    const N = 40;
    let dentro = 0;
    for (let fy = 0; fy < N; fy++) {
      for (let fx = 0; fx < N; fx++) {
        const px = (fx + 0.5) / N, py = (fy + 0.5) / N;
        if (celdas.some((c) => px >= c.x && px < c.x + c.w && py >= c.y && py < c.y + c.h)) dentro++;
      }
    }
    return {
      cobertura: dentro / (N * N),
      solapes,
      celdas: celdas.length
    };
  }

  // ----------------------------------------------------------
  // COMPATIBILIDAD CON EL MODELO VIEJO (arbol de cortes)
  // ----------------------------------------------------------
  // Los proyectos guardados antes de hoy tienen arboles. Se convierten
  // solos la primera vez que se abren - no se pierde el trabajo hecho.
  function migrarDesdeArbol(arbol, clipIds) {
    if (!arbol || typeof arbol !== 'object') return crearLayout(clipIds, 'vertical');
    if (arbol.version === VERSION && arbol.celdas) return arbol;

    const encontrados = [];
    (function recorrer(nodo, x, y, w, h) {
      if (!nodo) return;
      if (nodo.tipo === 'hoja') {
        const r = nodo.libre ? nodo.libre : { x, y, w, h };
        encontrados.push({ pos: nodo.pos, rect: rect(r.x, r.y, r.w, r.h) });
        return;
      }
      const ratio = typeof nodo.ratio === 'number' ? nodo.ratio : 0.5;
      if (nodo.dir === 'fila') {
        const hA = h * ratio;
        recorrer(nodo.a, x, y, w, hA);
        recorrer(nodo.b, x, y + hA, w, h - hA);
      } else {
        const wA = w * ratio;
        recorrer(nodo.a, x, y, wA, h);
        recorrer(nodo.b, x + wA, y, w - wA, h);
      }
    })(arbol, 0, 0, 1, 1);

    if (!encontrados.length) return crearLayout(clipIds, 'vertical');
    encontrados.sort((a, b) => a.pos - b.pos);
    const celdas = {};
    clipIds.forEach((id, i) => {
      celdas[id] = encontrados[i] ? encontrados[i].rect : rect(0, 0, 1, 1);
    });
    return { version: VERSION, celdas };
  }

  return {
    VERSION, MIN_CELDA, MODOS, ENCAJES,
    layoutVacio, crearLayout, aplicarPreset, rectsPreset,
    normalizar, moverCelda, redimensionarCelda, intercambiarCeldas, encajarCelda,
    celdasParaDibujar, diagnostico, migrarDesdeArbol,
    areaSolape
  };
});
