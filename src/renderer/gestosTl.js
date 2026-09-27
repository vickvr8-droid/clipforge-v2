// ============================================================
// GESTOS DE LA LINEA DE TIEMPO — la parte que se puede probar (13/09/2026)
// ============================================================
// Tanda C, paso 4 de la hoja de ruta del INFORME de la linea de tiempo:
// "gestos que editan sin querer". Todos los defectos de ese paso vivian en
// renderer.js mezclados con el DOM, y por eso ningun test los veia: un clic
// quieto que recortaba, un clic en un vacio invisible que lo cerraba, un
// doble clic que nunca llegaba, un zoom que perdia lo que se estaba mirando.
//
// Aca van SOLO las decisiones (numeros y reglas), sin tocar el documento.
// renderer.js mide, llama a esto y aplica el resultado. Asi la regla queda
// escrita en un lugar que node --test puede cargar, y el renderer se queda
// con lo que de verdad necesita un navegador.
//
// Mismo envoltorio que los modulos de src/shared: con require en los tests,
// como global (window.GestosTl) en la ventana.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GestosTl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ---------- Umbral de arrastre ----------
  // Un clic nunca es exactamente quieto: la mano se corre uno o dos
  // pixeles. Antes el mouseup mandaba la operacion aunque el mouse no se
  // hubiera movido, y como roll y recorte reciben un tiempo ABSOLUTO (el del
  // mouse), el clic mismo era la edicion: con N, un clic en el cuerpo movia
  // un corte; con el iman apagado, agarrar una manija recortaba hasta el
  // pixel del clic (hallazgo 20). 4 px es lo que usan los sistemas
  // operativos para distinguir clic de arrastre.
  const UMBRAL_ARRASTRE_PX = 4;

  function superoUmbral(x0, y0, x, y, umbral) {
    const u = umbral == null ? UMBRAL_ARRASTRE_PX : umbral;
    return Math.abs(x - x0) >= u || Math.abs(y - y0) >= u;
  }

  // El boton izquierdo ya no esta apretado. Pasa cuando el mouseup no
  // llega: Alt+Tab o un dialogo del sistema a mitad del arrastre. Sin esta
  // guarda el clip seguia pegado al puntero y el proximo clic en cualquier
  // lado lo soltaba ahi (hallazgo 24).
  const botonSuelto = (buttons) => !((buttons | 0) & 1);

  // ---------- Foco del teclado ----------
  // El filtro viejo salia si el foco estaba en CUALQUIER input, y las
  // casillas 'Imán' y 'Saltar vacíos' son inputs: despues de tocarlas se
  // morian todos los atajos, y Espacio cambiaba la casilla en vez de
  // reproducir (hallazgo 18). Solo hay que ceder el teclado cuando se esta
  // ESCRIBIENDO.
  const TIPOS_SIN_TEXTO = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

  function esCampoDeTexto(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return !TIPOS_SIN_TEXTO.has(String(el.type || 'text').toLowerCase());
  }

  // ---------- Manijas y etiqueta segun el ancho EN PANTALLA ----------
  // Las manijas median 7 px fijos cada una: un clip de 14 px o menos era
  // todo manija y no habia forma de agarrarlo para moverlo, solo de
  // recortarlo (hallazgos 21 y 30). Y la etiqueta se decidia por segundos,
  // asi que a zoom alto un clip de 130 px quedaba sin nombre.
  const MANIJA_MAX_PX = 7;
  const CLIP_SIN_MANIJAS_PX = 20;   // por debajo, todo el clip es cuerpo
  const ETIQUETA_MIN_PX = 40;       // menos que esto no entra ni "9:16" legible

  function geometriaClip(anchoPx) {
    const w = Number(anchoPx) || 0;
    // Un cuarto del ancho por manija: siempre queda al menos la mitad del
    // clip como cuerpo, que es lo que se agarra para mover.
    const manija = w < CLIP_SIN_MANIJAS_PX ? 0 : Math.min(MANIJA_MAX_PX, Math.floor(w / 4));
    return { manija, etiqueta: w >= ETIQUETA_MIN_PX };
  }

  // Borde mas cercano al punto del clic, para cuando el clip no tiene
  // manijas y la herramienta necesita un borde (ripple).
  const bordeMasCercano = (xDentro, anchoPx) => (xDentro < anchoPx / 2 ? 'in' : 'out');

  // ---------- Que hace un mousedown sobre un elemento ----------
  // La tabla entera en un lugar, para que se pueda leer y probar:
  //   cuchilla            -> cortar (como antes)
  //   vacio               -> SELECCIONARLO. Antes lo cerraba al instante, y
  //                          el vacio es invisible: el gesto de "clic en lo
  //                          gris para deseleccionar" editaba (hallazgos 14,
  //                          25, 34). Cerrar pasa a Supr con el vacio elegido.
  //   doble clic (detail 2) con Seleccion -> unir con el siguiente. Se lee
  //                          en el mousedown porque el evento dblclick no
  //                          llegaba (hallazgo 28).
  //   el resto            -> seleccionar y, segun herramienta, preparar un
  //                          arrastre que recien edita si supera el umbral.
  function accionDeMousedown({ herramienta, tipo, detail, borde, sinManijas, bordeCercano }) {
    if (herramienta === 'cuchilla') return { accion: 'cortar' };
    if (tipo === 'hueco') return { accion: 'seleccionar-hueco' };
    if (detail === 2 && herramienta === 'seleccion') return { accion: 'unir' };

    let b = borde || null;
    let modo = null;
    if (herramienta === 'slip') modo = 'slip';
    else if (herramienta === 'slide') modo = 'slide';
    else if (herramienta === 'roll') modo = 'roll';
    else if (b) modo = herramienta === 'ripple' ? 'ripple' : 'recorte';
    else if (herramienta === 'ripple' && sinManijas && bordeCercano) {
      // Un clip angosto no tiene manijas; con Ripple el unico gesto posible
      // es sobre un borde, asi que se toma el mas cercano al mouse.
      b = bordeCercano;
      modo = 'ripple';
    } else if (herramienta === 'seleccion') modo = 'mover';

    return modo ? { accion: 'arrastrar', modo, borde: b } : { accion: 'seleccionar' };
  }

  // ---------- Zoom anclado ----------
  // El lienzo se estira en % y scrollLeft queda en px: sin corregirlo, lo
  // que estaba bajo el mouse se escapaba de la vista en cada paso de zoom
  // (hallazgos 23, 26, 50). La cuenta: el instante `t` tiene que quedar en
  // el mismo pixel de la vista (`xEnVista`) con el lienzo nuevo.
  function scrollParaAncla({ t, xEnVista, dur, anchoLienzo, anchoVista }) {
    if (!(dur > 0) || !(anchoLienzo > 0)) return 0;
    const ideal = (t / dur) * anchoLienzo - xEnVista;
    return Math.max(0, Math.min(Math.max(0, anchoLienzo - (anchoVista || 0)), ideal));
  }

  // Con los botones no hay mouse: el ancla es el cabezal si esta a la
  // vista (queda donde esta) y, si no, el cabezal va al centro.
  function xDeCabezalEnVista({ cabezal, dur, anchoLienzo, scrollLeft, anchoVista }) {
    if (!(dur > 0)) return 0;
    const x = (cabezal / dur) * anchoLienzo - scrollLeft;
    return x >= 0 && x <= anchoVista ? x : anchoVista / 2;
  }

  // Reproduciendo con zoom, el cabezal se iba de la pantalla. Se pagina
  // como en Premiere: cuando llega cerca del borde derecho (o quedo a la
  // izquierda de la vista), la vista salta para dejarlo cerca del borde
  // izquierdo. Devuelve null si no hay que mover nada: tocar scrollLeft en
  // cada cuadro sin necesidad pelearia con el usuario que scrollea.
  function scrollParaSeguir({ x, scrollLeft, anchoVista, anchoLienzo, margen }) {
    const mg = margen == null ? 40 : margen;
    if (!(anchoVista > 0)) return null;
    if (x <= scrollLeft + anchoVista - mg && x >= scrollLeft) return null;
    const max = Math.max(0, anchoLienzo - anchoVista);
    const nuevo = Math.max(0, Math.min(max, x - mg));
    return Math.abs(nuevo - scrollLeft) < 1 ? null : nuevo;
  }

  // Tope de zoom. Era 40 veces "todo entra": un montaje de 824 s no
  // llegaba ni a 3 px por cuadro (hallazgo 29). El tope pasa a ser una
  // densidad: 300 px por segundo son 10 px por cuadro a 30 fps. Nunca por
  // debajo del 40x de antes, para no quitarle zoom a los montajes cortos.
  //
  // TANDA D (13/09/2026): con base de cuadro el tope es 10 px POR CUADRO del
  // fps del montaje (600 px/s a 60 fps, 250 a 25). Sin fps, los 300 px/s
  // de antes (decision C2).
  const PX_POR_SEG_MAX = 300;
  const PX_POR_CUADRO_MAX = 10;
  const ZOOM_MAX_RELATIVO = 40;

  function zoomMaximo(dur, anchoVista, fps) {
    if (!(dur > 0) || !(anchoVista > 0)) return ZOOM_MAX_RELATIVO;
    const pxPorSeg = fps > 0 ? PX_POR_CUADRO_MAX * fps : PX_POR_SEG_MAX;
    return Math.max(ZOOM_MAX_RELATIVO, (pxPorSeg * dur) / anchoVista);
  }

  // ---------- Flechas: de a un cuadro (tanda D, paso 6) ----------
  // Izquierda/derecha mueven el cabezal UN cuadro; con Shift, un segundo
  // (en cuadros enteros, para no salir de la grilla). El cabezal primero se
  // lleva a su cuadro: si quedo entre dos (un clic en la regla sin base de
  // cuadro, el reloj de la reproduccion), la flecha no tiene que dar un
  // paso de medio cuadro.
  // `fps` es un numero (30000/1001, no 29.97). Sin fps, 30.
  function cabezalConFlecha({ cabezal, fps, sentido, grande, duracion }) {
    const f = fps > 0 ? fps : 30;
    const k = Math.floor((cabezal || 0) * f + 0.5 + 1e-6);
    const paso = grande ? Math.max(1, Math.round(f)) : 1;
    const nuevo = (k + (sentido < 0 ? -paso : paso)) / f;
    const max = duracion > 0 ? Math.floor(duracion * f + 1e-6) / f : Infinity;
    return Math.max(0, Math.min(max, nuevo));
  }

  const limitarZoom = (z, max) => Math.max(1, Math.min(max, Number.isFinite(z) ? z : 1));

  // ---------- Encabezados alineados con las filas ----------
  // Los encabezados no tienen barra horizontal y las filas si: al fondo del
  // scroll vertical quedaban corridos justo lo que mide esa barra. Se le
  // suma al encabezado ese mismo relleno abajo.
  const rellenoParaBarra = (offsetHeight, clientHeight) =>
    Math.max(0, (offsetHeight | 0) - (clientHeight | 0));

  return {
    UMBRAL_ARRASTRE_PX, superoUmbral, botonSuelto,
    esCampoDeTexto,
    MANIJA_MAX_PX, CLIP_SIN_MANIJAS_PX, ETIQUETA_MIN_PX, geometriaClip, bordeMasCercano,
    accionDeMousedown,
    scrollParaAncla, xDeCabezalEnVista, scrollParaSeguir,
    PX_POR_SEG_MAX, PX_POR_CUADRO_MAX, ZOOM_MAX_RELATIVO, zoomMaximo, limitarZoom,
    cabezalConFlecha,
    rellenoParaBarra
  };
});
