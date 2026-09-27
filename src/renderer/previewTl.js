// ============================================================
// VISTA PREVIA DE LA LINEA DE TIEMPO — la parte que se puede probar (19/09/2026)
// ============================================================
// Tanda G, pasos 9 y 10 de la hoja de ruta del INFORME de la linea de tiempo.
//
// Paso 9: mientras se arrastra, antes solo el modo 'mover' corria el
// rectangulo (y encima en su fila de origen); recorte, roll, slip, slide y
// ripple iban a ciegas con un cartel de numeros (hallazgos 22, 31 y 44).
// Aca la vista previa aplica la MISMA operacion exportada del modelo que el
// main va a aplicar al soltar (moverConInforme, recortar, roll, slip, slide,
// rippleConInforme, mas podarPistas), sobre la copia del montaje que el
// renderer ya tiene. Lo que se ve es lo que va a quedar, con pareja,
// vecinos que absorben, pistas nuevas y pistas que se van, sin inventar
// una segunda aritmetica que pueda divergir de la verdadera.
//
// Paso 10: las cuentas de la onda (que columna de la piramide va en cada
// pixel) y del recorte del canvas a la vista.
//
// Mismo envoltorio que gestosTl.js: require en los tests, window.PreviewTl
// en la ventana. El modelo se recibe como parametro (window.Montaje en la
// ventana, require en los tests) para no depender de un global.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PreviewTl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ---------- La operacion del arrastre ----------
  // Espejo EXACTO de los handlers 'montaje:mover', 'montaje:recortar' y
  // 'montaje:grupo' de main.js, incluida la poda de operarMontaje. Si uno
  // cambia, el otro tiene que cambiar; el test "simular = lo que aplica el
  // main" lo fija comparando contra las mismas llamadas.
  //   g.modo    'mover' | 'moverGrupo' | 'recorte' | 'ripple' | 'roll' | 'slip' | 'slide'
  //   g.ultimo  instante de la linea bajo el mouse (ya imantado)
  //   g.delta   ultimo - t0 (slip, slide y grupo)
  //   g.inicioDestino  donde cae el inicio del clip al mover
  //   g.destino pista destino al mover (id, null o PISTA_NUEVA)
  //   g.grupo   [{ pistaId, elId }] al mover un grupo
  // Devuelve { montaje, informe }. `informe` es lo que el main devuelve en
  // la misma respuesta (movido, ripple, sinCambio), para el cartel.
  function simular(M, m, g) {
    if (!M || !m || !g) return { montaje: m, informe: null };
    let salida = m;
    let informe = null;
    switch (g.modo) {
      case 'mover': {
        const destino = g.destino && g.destino !== g.pistaId ? g.destino : null;
        const [s, inf] = M.moverConInforme(m, g.pistaId, g.elId, Math.max(0, g.inicioDestino), destino);
        salida = s; informe = { movido: inf };
        break;
      }
      case 'moverGrupo': {
        const [s, inf] = M.moverGrupoConInforme(m, g.grupo || [], g.delta);
        salida = s; informe = { grupo: inf };
        break;
      }
      case 'roll': {
        const s = M.roll(m, g.pistaId, g.elId, g.ultimo, g.borde);
        salida = s; informe = s === m ? { sinCambio: true } : {};
        break;
      }
      case 'slip': salida = M.slip(m, g.pistaId, g.elId, g.delta); break;
      case 'slide': salida = M.slide(m, g.pistaId, g.elId, g.delta); break;
      case 'recorte': salida = M.recortar(m, g.pistaId, g.elId, g.borde, g.ultimo); break;
      case 'ripple': {
        const [s, inf] = M.rippleConInforme(m, g.pistaId, g.elId, g.borde, g.ultimo);
        salida = s; informe = { ripple: inf };
        break;
      }
      default: return { montaje: m, informe: null };
    }
    return { montaje: salida === m ? m : M.podarPistas(salida), informe };
  }

  // ---------- Que filas cambian ----------
  // La vista previa se dibuja en una CAPA encima de cada fila que cambia, no
  // rehaciendo tlPistas.innerHTML: rehacerlo en cada mousemove sacaria del
  // documento el nodo agarrado y rompe elementFromPoint, que es con lo que
  // pistaBajoElMouse sabe a que fila apunta el mouse (INFORME, hallazgo 21).
  const firma = (lista) => lista
    .filter((e) => e.tipo === 'clip')
    .map((e) => [e.id, e.inicio.toFixed(4), e.fin.toFixed(4), e.usadoIn.toFixed(4), e.vinculo || ''].join(':'))
    .join('|');

  // Devuelve { filas, quitadas, nuevas, perdidos }:
  //   filas    [{ pistaId, tipo, clips }] de las pistas que YA existen y
  //            cambian (clips = como quedan, con inicio/fin/usadoIn/usadoOut)
  //   nuevas   lo mismo para pistas que se crean al soltar
  //   quitadas ids de pistas que la poda saca
  //   perdidos ids de clips que desaparecen enteros
  function cambiosDeFilas(M, antes, despues) {
    const vacio = { filas: [], nuevas: [], quitadas: [], perdidos: [] };
    if (!M || !antes || !despues || antes === despues) return vacio;
    const idsAntes = new Set(antes.pistas.map((p) => p.id));
    const idsDespues = new Set(despues.pistas.map((p) => p.id));
    const out = { filas: [], nuevas: [], quitadas: [], perdidos: [] };
    despues.pistas.forEach((p) => {
      const clips = M.elementosDePista(despues, p.id).filter((e) => e.tipo === 'clip');
      const fila = { pistaId: p.id, tipo: p.tipo, clips };
      if (!idsAntes.has(p.id)) { out.nuevas.push(fila); return; }
      if (firma(M.elementosDePista(antes, p.id)) !== firma(clips)) out.filas.push(fila);
    });
    antes.pistas.forEach((p) => { if (!idsDespues.has(p.id)) out.quitadas.push(p.id); });
    const quedan = new Set();
    despues.pistas.forEach((p) => p.elementos.forEach((e) => { if (e.tipo === 'clip') quedan.add(e.id); }));
    antes.pistas.forEach((p) => p.elementos.forEach((e) => {
      if (e.tipo === 'clip' && !quedan.has(e.id)) out.perdidos.push(e.id);
    }));
    return out;
  }

  // ---------- Iman por los bordes del clip ----------
  // Antes se imantaba el PUNTERO, y el punto mas cercano solia ser el borde
  // del propio clip: al mover, el clip se pegaba a si mismo y "no se
  // soltaba" (hallazgos 19 y 37). Ahora al mover se imantan el inicio Y el
  // fin del clip, contra todos los bordes MENOS los del propio clip y su
  // pareja (o del grupo que se mueve).
  function puntosSinPropios(M, m, excluir, extra) {
    const fuera = new Set((excluir || []).map((r) => r.pistaId + '|' + r.elId));
    // La pareja se mueve con el clip: sus bordes tampoco sirven de iman.
    (excluir || []).forEach((r) => {
      const el = M.elementosDePista(m, r.pistaId).find((x) => x.id === r.elId);
      if (el && el.vinculo) M.clipsVinculados(m, el.vinculo).forEach((o) => fuera.add(o.pistaId + '|' + o.el.id));
    });
    const puntos = new Set([0]);
    m.pistas.forEach((p) => M.elementosDePista(m, p.id).forEach((el) => {
      if (el.tipo !== 'clip' || fuera.has(p.id + '|' + el.id)) return;
      puntos.add(el.inicio);
      puntos.add(el.fin);
    }));
    (extra || []).forEach((t) => { if (typeof t === 'number' && Number.isFinite(t)) puntos.add(t); });
    return [...puntos].sort((a, b) => a - b);
  }

  // El bloque [inicio, inicio+dur) se pega por la punta que quede mas cerca
  // de un punto, si esta dentro de la tolerancia. Devuelve { inicio, punto }
  // con `punto` = el instante donde se pego (para dibujar la linea) o null.
  function imantarBloque(inicio, dur, puntos, tol) {
    if (!(tol > 0)) return { inicio, punto: null };
    let mejor = { inicio, punto: null };
    let dist = tol;
    for (const p of puntos || []) {
      const dIni = Math.abs(p - inicio);
      if (dIni <= dist) { dist = dIni; mejor = { inicio: p, punto: p }; }
      const dFin = Math.abs(p - (inicio + dur));
      if (dFin < dist) { dist = dFin; mejor = { inicio: p - dur, punto: p }; }
    }
    if (mejor.inicio < 0) return { inicio: 0, punto: mejor.punto === 0 ? 0 : null };
    return mejor;
  }

  // Shift invierte el iman mientras se arrastra (Premiere/Resolve: tecla
  // para soltarse sin ir a apagar la casilla).
  const imanActivo = (casilla, shift) => (shift ? !casilla : !!casilla);

  // ---------- Autoscroll ----------
  // Con zoom, llevar un clip mas alla de lo que se ve era imposible: habia
  // que soltarlo, scrollear y volver a agarrarlo. A menos de `margen` px
  // del borde de la vista, la vista se corre; mas cerca del borde, mas
  // rapido. Devuelve cuantos px correr (negativo = a la izquierda).
  function pasoDeAutoscroll(x, izq, der, margen = 30, maximo = 24) {
    if (!(der > izq)) return 0;
    if (x < izq + margen) return -Math.ceil(maximo * Math.min(1, (izq + margen - x) / margen));
    if (x > der - margen) return Math.ceil(maximo * Math.min(1, (x - (der - margen)) / margen));
    return 0;
  }

  // ---------- Seleccion multiple ----------
  // Ctrl (o Cmd) + clic suma o saca un clip; Shift + clic tambien suma (no
  // hay un orden de clips para "rango" que se entienda entre pistas). Un
  // clic comun elige solo ese clip. Devuelve la lista nueva.
  function alternarEnSeleccion(lista, ref, sumar) {
    const actual = (lista || []).filter((r) => r && r.elId);
    const esta = actual.some((r) => r.elId === ref.elId);
    if (!sumar) return [{ pistaId: ref.pistaId, elId: ref.elId }];
    if (esta) return actual.filter((r) => r.elId !== ref.elId);
    return actual.concat([{ pistaId: ref.pistaId, elId: ref.elId }]);
  }

  // De que se parte al sumar con Ctrl: el grupo, o el elegido suelto solo si
  // es un clip (un vacio elegido no entra al grupo: borrar lo ignoraria y el
  // cartel contaria de mas).
  function baseParaSumar(grupo, elegido, esClip) {
    if (grupo && grupo.length) return grupo;
    return elegido && esClip(elegido) ? [elegido] : [];
  }

  // Descarta de la seleccion lo que ya no existe (un deshacer, un borrado) y
  // actualiza la pista de lo que se movio de fila.
  function sanearSeleccion(M, m, lista) {
    if (!M || !m) return [];
    const donde = {};
    m.pistas.forEach((p) => p.elementos.forEach((e) => { donde[e.id] = p.id; }));
    return (lista || []).filter((r) => donde[r.elId]).map((r) => ({ pistaId: donde[r.elId], elId: r.elId }));
  }

  // ---------- Onda: canvas recortado a la vista ----------
  // Un canvas del ancho entero del clip revienta: un clip de 824 s a zoom
  // alto mide decenas de miles de px, y pasado el limite (~32.767 px) el
  // lienzo sale en BLANCO sin error (INFORME, hallazgo 27). El canvas mide
  // solo la parte del clip que se ve, con un tope por las dudas.
  const CANVAS_MAX_PX = 16384;

  // clipIzq/clipDer: bordes del clip en px del lienzo. vistaIzq/vistaDer:
  // lo visible, en la misma escala. Devuelve { desde, hasta } en px
  // relativos al clip, o null si no se ve nada.
  function tramoVisible(clipIzq, clipDer, vistaIzq, vistaDer) {
    const a = Math.max(clipIzq, vistaIzq);
    const b = Math.min(clipDer, vistaDer);
    if (!(b - a >= 1)) return null;
    const desde = Math.floor(a - clipIzq);
    const hasta = Math.min(Math.ceil(b - clipIzq), desde + CANVAS_MAX_PX);
    return { desde, hasta };
  }

  // Elige el nivel de la piramide: el mas grueso que todavia tenga al
  // menos una columna por pixel. Mas fino no se ve y cuesta recorrerlo.
  function nivelParaEscala(picos, segPorPx) {
    const niveles = (picos && picos.niveles) || [];
    let elegido = niveles[0] || null;
    for (const n of niveles) {
      if (n.msPorCubo / 1000 <= segPorPx) elegido = n;
    }
    return elegido;
  }

  // n columnas de onda para el tramo [fuenteIni, fuenteFin) del ARCHIVO.
  // Se indexa por tiempo de FUENTE (usadoIn/usadoOut del clip), asi que un
  // slip o un recorte mueven la onda sin recalcular nada (sin ffmpeg).
  // Cada columna junta (min de mins, max de maxs) de los cubos que cubre,
  // no un muestreo: muestrear hace parpadear los picos al hacer scroll.
  // Devuelve { min, max } (Uint8, cero en 128) de largo n; 128 = silencio.
  function columnasDeOnda(picos, fuenteIni, fuenteFin, n) {
    const min = new Uint8Array(Math.max(0, n)).fill(128);
    const max = new Uint8Array(Math.max(0, n)).fill(128);
    if (!picos || !(n > 0) || !(fuenteFin > fuenteIni)) return { min, max };
    const segPorCol = (fuenteFin - fuenteIni) / n;
    const nivel = nivelParaEscala(picos, segPorCol);
    if (!nivel || !nivel.min || !nivel.min.length) return { min, max };
    const segPorCubo = nivel.msPorCubo / 1000;
    const total = nivel.min.length;
    for (let i = 0; i < n; i++) {
      const t0 = fuenteIni + i * segPorCol;
      let c0 = Math.floor(t0 / segPorCubo);
      let c1 = Math.max(c0 + 1, Math.floor((t0 + segPorCol) / segPorCubo));
      if (c0 >= total || c1 <= 0) continue;
      c0 = Math.max(0, c0); c1 = Math.min(total, c1);
      let lo = 255, hi = 0;
      for (let c = c0; c < c1; c++) {
        if (nivel.min[c] < lo) lo = nivel.min[c];
        if (nivel.max[c] > hi) hi = nivel.max[c];
      }
      min[i] = lo; max[i] = hi;
    }
    return { min, max };
  }

  // Instantes de FUENTE donde poner una miniatura dentro de un clip: una
  // cada `anchoMini` px de lo visible, al medio de su casilla.
  function instantesDeMiniaturas(usadoIn, usadoOut, anchoClipPx, tramo, anchoMini) {
    if (!tramo || !(anchoClipPx > 0) || !(anchoMini > 0)) return [];
    const segPorPx = (usadoOut - usadoIn) / anchoClipPx;
    const out = [];
    const primera = Math.floor(tramo.desde / anchoMini) * anchoMini;
    for (let x = primera; x < tramo.hasta; x += anchoMini) {
      out.push({ x, t: usadoIn + (x + anchoMini / 2) * segPorPx });
    }
    return out;
  }

  return {
    simular, cambiosDeFilas,
    puntosSinPropios, imantarBloque, imanActivo,
    pasoDeAutoscroll,
    alternarEnSeleccion, baseParaSumar, sanearSeleccion,
    CANVAS_MAX_PX, tramoVisible, nivelParaEscala, columnasDeOnda, instantesDeMiniaturas
  };
});
