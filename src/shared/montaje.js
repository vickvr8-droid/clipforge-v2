// ============================================================
// MONTAJE — MODELO DE LINEA DE TIEMPO (06/08/2026)
// ============================================================
// Escrito DESPUES de investigar como lo hacen los editores reales, en vez
// de inventar un modelo propio. Fuentes:
//   - OpenTimelineIO (estandar abierto de Pixar para intercambio de
//     montajes): Timeline > Stack > Track > [Clip | Gap | Transition]
//   - MLT/Kdenlive: cada pista es un Playlist con entradas "blank"
//
// DECISION CENTRAL — PISTA SECUENCIAL, NO POSICIONAL:
// Los intentos anteriores le daban a cada clip una posicion absoluta
// (`inicio`) y calculaban los huecos. Los dos referentes hacen lo
// contrario: la pista es una LISTA de elementos empalmados punta con
// punta, y el vacio es un elemento HUECO de verdad dentro de la lista.
// Que dos implementaciones serias coincidan pesa. Lo que se gana:
//   - Los solapamientos son IMPOSIBLES por construccion. No hay que
//     validarlos ni corregirlos: no se pueden expresar.
//   - Ripple, insertar y borrar salen naturales (splice sobre la lista).
//   - La posicion de un clip es la suma de lo que tiene delante, y no
//     puede quedar desincronizada de sus vecinos.
// Lo que se paga: mover un clip a un punto arbitrario es "sacar de aca e
// insertar alla", no "cambiarle una coordenada". Es el intercambio que
// hicieron los dos referentes, y evita toda una familia de bugs.
//
// TRES RANGOS, como OTIO (yo antes tenia uno solo):
//   disponible : que existe en el archivo (con INICIO propio, no solo
//                duracion - importa en material con timecode que no
//                arranca en cero)
//   usado      : que pedazo de ese material usa el clip (source_range)
//   visible    : se estira si hay una transicion pegada
//
// EJES DE TIEMPO (confundirlos no da error, solo corre el video):
//   LINEA  : posicion en el montaje
//   FUENTE : posicion dentro del archivo
//
// Modulo PURO. Todo devuelve un montaje NUEVO.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Montaje = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const MIN_DUR = 0.04;     // ~1 fotograma a 24fps (solo en montajes SIN base de cuadro)
  const EPS = 1e-6;

  // ----------------------------------------------------------
  // BASE DE CUADRO (13/09/2026, tanda D, paso 6 de la hoja de ruta)
  // ----------------------------------------------------------
  // ANTES el tiempo eran segundos en coma flotante sin unidad: soltar un
  // clip en t=0.01 con el iman apagado dejaba un clip de 10 ms invisible,
  // un corte en 10.013 caia entre dos cuadros y el export lo resolvia por
  // su cuenta (hallazgo 4 del INFORME). La prueba aleatoria encontraba
  // pedazos de 6 ms en borrar, colocar, mover y recortar.
  //
  // AHORA el montaje puede llevar `fps: { num, den }` (30000/1001 y no
  // 29.97: la fraccion exacta no se corre en un montaje largo). Con fps:
  //   - todo instante que ENTRA a una operacion pasa por aCuadro() (la
  //     "puerta"), asi que los cortes nacen en cuadro;
  //   - lo que limita el MATERIAL (cuanto le queda a un archivo) se redondea
  //     hacia abajo a cuadros enteros (pisoCuadro): 45.3 s de un archivo a
  //     30 fps son 1359 cuadros, no 1359,0 y pico;
  //   - el minimo de un clip o de un vacio es UN cuadro (minDur).
  // Resultado: la duracion de todo elemento es un numero entero de cuadros,
  // y como la posicion es la suma de lo que hay delante, toda frontera cae
  // en cuadro. verificarMontaje lo controla (`fueraDeCuadro`).
  //
  // SIN fps (un montaje armado a mano en un test, o uno viejo que todavia
  // no paso por la migracion) todo sigue como antes, en tiempo continuo.
  // La app nunca trabaja asi: montajeInicial le pone fps a los nuevos y
  // asegurarBaseDeCuadro (montajeGuardado.js) a los guardados, al abrirlos.
  // Es un campo OPCIONAL a proposito: no sube VERSION (montajeUtilizable
  // descarta cualquier otra version y borraria la edicion en silencio).
  const FPS_ESTANDAR = [
    [24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1],
    [60000, 1001], [60, 1], [90, 1], [100, 1], [120000, 1001], [120, 1]
  ];
  const FPS_POR_DEFECTO = { num: 30, den: 1 };

  // El fps del montaje, o null si no tiene base de cuadro.
  function fpsDe(m) {
    const f = m && m.fps;
    return (f && f.num > 0 && f.den > 0 && isFinite(f.num) && isFinite(f.den)) ? f : null;
  }

  // Un fps cualquiera (29.87 de ffprobe, 25, {num,den}) como fraccion. Lo
  // que esta a menos del 2 % de un estandar se lleva al estandar exacto,
  // igual que GuionExport.normalizarFps: los celulares graban con cuadro
  // variable y ffprobe da el promedio. Devuelve null si no hay dato.
  function fpsComoFraccion(valor) {
    const v = valor && typeof valor === 'object' ? valor.num / valor.den : +valor;
    if (!(v > 0) || !isFinite(v)) return null;
    let mejor = null;
    for (const [num, den] of FPS_ESTANDAR) {
      const dif = Math.abs(v - num / den) / (num / den);
      if (dif <= 0.02 && (!mejor || dif < mejor.dif)) mejor = { num, den, dif };
    }
    if (mejor) return { num: mejor.num, den: mejor.den };
    const acotado = Math.min(120, Math.max(1, v));
    return { num: Math.round(acotado * 1000), den: 1000 };
  }

  // Lo que dura un cuadro, en segundos (0 sin base de cuadro).
  function duracionCuadro(m) {
    const f = fpsDe(m);
    return f ? f.den / f.num : 0;
  }

  // El cuadro mas cercano. El +1e-6 (en CUADROS) decide igual a las dos
  // pistas de una pareja cuando el instante cae justo en medio cuadro: sus
  // posiciones salen de sumar duraciones y pueden diferir en 1e-15, y sin
  // el empujon una redondearia para arriba y la otra para abajo.
  function aCuadro(m, t) {
    const f = fpsDe(m);
    if (!f || !isFinite(t)) return t;
    return Math.floor(t * f.num / f.den + 0.5 + 1e-6) * f.den / f.num;
  }

  // Cuadros enteros HACIA ABAJO de una cantidad (lo que le queda a un
  // material): redondear para arriba usaria un pedazo de cuadro que el
  // archivo no tiene.
  function pisoCuadro(m, x) {
    const f = fpsDe(m);
    if (!f || !isFinite(x)) return x;
    return Math.floor(x * f.num / f.den + 1e-6) * f.den / f.num;
  }

  // Lo minimo que puede durar un clip o un vacio.
  const minDur = (m) => (fpsDe(m) ? duracionCuadro(m) : MIN_DUR);

  // Margen para "queda algo de verdad". Con base de cuadro un cuadro ya es
  // algo (los instantes estan en la grilla, asi que alcanza con EPS); sin
  // ella se mantiene el MIN_DUR de antes.
  const margen = (m) => (fpsDe(m) ? EPS : MIN_DUR);

  // El final de un pedazo de material que arranca en `desde` y puede llegar
  // hasta `tope`, en cuadros enteros. Sin base de cuadro devuelve `tope`
  // TAL CUAL: desde + (tope - desde) no siempre da exacto en coma flotante,
  // y un montaje continuo tiene que quedar identico a como era antes.
  function hastaEnCuadros(m, desde, tope) {
    return fpsDe(m) ? desde + pisoCuadro(m, tope - desde) : tope;
  }

  let contador = 0;
  const nuevoId = (p) => `${p}${Date.now().toString(36)}${(contador++).toString(36)}`;

  // ----------------------------------------------------------
  // CONSTRUCTORES
  // ----------------------------------------------------------

  // Un elemento de pista es un CLIP o un HUECO. Ambos tienen duracion;
  // solo el clip tiene material.
  // VINCULO: dos clips con el mismo `vinculo` son la imagen y el sonido
  // del mismo material y se tratan como una unidad (cortar, borrar y
  // mover afectan a los dos). Es lo que en un editor se ve como el clip
  // de video "pegado" a su audio. Va como campo suelto y no como una
  // estructura aparte para que un montaje viejo, sin vinculos, siga
  // siendo valido: sin el campo, cada clip es independiente como antes.
  // TRANSFORMACION: donde y de que tamaño se dibuja este material sobre
  // el lienzo. Es lo que permite agrandar, achicar y correr la imagen sin
  // tocar el archivo.
  //   escala 1  = el material entra entero en el lienzo (encaje "contain")
  //   x / y     = corrimiento en FRACCIONES del lienzo, 0 es centrado
  // Va en fracciones y no en pixeles por lo mismo que los recuadros: el
  // mismo valor sirve para el preview (al tamaño de la ventana) y para la
  // exportacion (a la resolucion real), sin recalcular nada.
  const TRANSFORMACION_BASE = { escala: 1, x: 0, y: 0 };

  function clip(mediaId, usadoIn, usadoOut, id, vinculo, transformacion) {
    const c = { tipo: 'clip', id: id || nuevoId('c'), mediaId, usadoIn, usadoOut };
    if (vinculo) c.vinculo = vinculo;
    if (transformacion) c.transformacion = { ...TRANSFORMACION_BASE, ...transformacion };
    return c;
  }

  // ----------------------------------------------------------
  // EL ENCUADRE 9:16 ES UN CLIP DE AJUSTE (07/08/2026)
  // ----------------------------------------------------------
  // Antes vivia en `recuadros.js`, un sistema PARALELO al montaje con su
  // propio `track` y su propia banda en la linea de tiempo. Por eso el
  // user reportaba que "la pista de los encuadres no se puede mezclar con
  // las de video": literalmente no era una pista del montaje.
  //
  // Ahora es lo que MLT llama FX CUT y los editores llaman ADJUSTMENT
  // CLIP: un elemento que ocupa un tramo de una pista NORMAL, cuya imagen
  // propia no se dibuja, y cuyo recorte se aplica a todo lo que quedo
  // compuesto DEBAJO durante ese tramo. Lo que esta ARRIBA se compone
  // encima del resultado ya recortado, sin ser tocado.
  //
  // POR QUE ESTE LUGAR Y NO "PEGADO AL CLIP":
  // FCPXML tiene el recorte como parametro intrinseco del clip y MLT como
  // filtro pegado al producer; las dos formas son reales, pero ninguna
  // sabe expresar UN encuadre que abarca VARIOS clips - habria que
  // copiarlo en cada uno y mantenerlos iguales a mano. El adjustment clip
  // lo dice de una: dura lo que dura, y abajo pasa lo que pase.
  //
  // Se modela como un elemento `tipo: 'clip'` SIN material (`mediaId`
  // null) y con el campo `ajuste`. No es un tipo nuevo a proposito: asi
  // mover, cortar, recortar, ripple, roll y sobrescribir funcionan sin
  // tocarlos, que es exactamente lo que el user pidio (que se arrastre
  // libre como cualquier clip).
  const RECT_BASE = { xPct: 0.25, yPct: 0, wPct: 0.5, hPct: 1 };
  const MIN_PCT = 0.02;   // mas chico que esto no se agarra con el mouse

  const acotar = (v, min, max) => Math.max(min, Math.min(max, v));

  // Deja el rectangulo dentro del frame sin deformarlo: primero se acota
  // el tamaño, despues la posicion contra ese tamaño. Al reves, un
  // recuadro pegado al borde derecho se encogeria en vez de correrse.
  function acotarRect(r) {
    const mezcla = { ...RECT_BASE, ...(r || {}) };
    const wPct = acotar(mezcla.wPct, MIN_PCT, 1);
    const hPct = acotar(mezcla.hPct, MIN_PCT, 1);
    return {
      xPct: acotar(mezcla.xPct, 0, 1 - wPct),
      yPct: acotar(mezcla.yPct, 0, 1 - hPct),
      wPct, hPct
    };
  }

  function encuadre(duracion, rect, id) {
    return {
      tipo: 'clip', id: id || nuevoId('e'),
      mediaId: null, usadoIn: 0, usadoOut: Math.max(MIN_DUR, duracion),
      ajuste: { rect: acotarRect(rect) }
    };
  }

  const esAjuste = (el) => !!(el && el.tipo === 'clip' && el.ajuste);

  // ----------------------------------------------------------
  // DERIVAR UN ELEMENTO DE OTRO
  // ----------------------------------------------------------
  // Cortar, recortar, mover y sobrescribir producen elementos NUEVOS a
  // partir de uno viejo. Todos lo hacian llamando a clip() con los cuatro
  // campos que conocian, asi que CUALQUIER campo agregado despues se
  // perdia en silencio.
  //
  // Eso ya estaba rompiendo cosas antes del encuadre: partir en dos un
  // clip al que se le habia cambiado la escala devolvia las dos mitades
  // en escala 1, porque `transformacion` no estaba en esa lista. Con el
  // ajuste el problema seria peor todavia (un encuadre cortado dejaria de
  // ser un encuadre).
  //
  // `derivar` copia TODO y pisa solo lo que cambia, asi el proximo campo
  // que se agregue viaja solo.
  function derivar(el, cambios) {
    const salida = { ...el, ...cambios };
    if (!salida.id) salida.id = nuevoId('c');
    // `undefined` explicito significa "sacalo", no "dejalo como estaba".
    Object.keys(cambios).forEach((k) => { if (cambios[k] === undefined) delete salida[k]; });
    return salida;
  }

  // El elemento tal como esta GUARDADO. elementosDePista() agrega campos
  // calculados (inicio, fin, indice, nombre) que no deben volver al
  // modelo: derivar de ahi los grabaria dentro del proyecto y quedarian
  // congelados, mintiendo apenas se mueva algo.
  function elementoCrudo(m, pistaId, elId) {
    const p = pistaPorId(m, pistaId);
    return p ? (p.elementos.find((x) => x.id === elId) || null) : null;
  }

  // La transformacion de un clip, siempre completa: un clip sin el campo
  // (los de antes de esta funcion, o los que nunca se tocaron) se lee como
  // la base, asi nadie tiene que preguntar si existe.
  const transformacionDe = (el) => ({ ...TRANSFORMACION_BASE, ...((el && el.transformacion) || {}) });

  // Un limite generoso pero no infinito: al 0.05 la imagen es un punto y al
  // 20 no se ve mas que un pixel gigante; pasado eso solo se pierde el
  // material de vista sin querer.
  const acotarEscala = (v) => Math.max(0.05, Math.min(20, v));

  // `tLinea` (tanda F, keyframes): si el clip esta ANIMADO, cambiar la
  // transformacion sin decir en que instante no significa nada (la base
  // fija no se ve: mandan las claves). Con tLinea el cambio va a la clave
  // de ese cuadro, que se crea si no existe. Sin claves, igual que siempre.
  function transformar(m, pistaId, elId, cambios, tLinea) {
    const crudo = elementoCrudo(m, pistaId, elId);
    if (crudo && crudo.tipo === 'clip' && !esAjuste(crudo) && clavesDe(crudo).length && typeof tLinea === 'number') {
      return ponerClave(m, pistaId, elId, tLinea, cambios);
    }
    return conElementos(m, pistaId, (els) => els.map((el) => {
      if (el.id !== elId || el.tipo !== 'clip') return el;
      const t = { ...transformacionDe(el), ...cambios };
      t.escala = acotarEscala(t.escala);
      return { ...el, transformacion: t };
    }));
  }

  // ----------------------------------------------------------
  // KEYFRAMES — CLAVES DE ANIMACION (13/09/2026, tanda F, 1.4 de PENDIENTE)
  // ----------------------------------------------------------
  // FORMA (la de FCPXML y MLT, que coinciden: lista de pares tiempo-valor
  // con interpolacion; PENDIENTE 1.4 pide no inventar otra):
  //   clip con material:  transformacion.claves = [{ tFuente, escala, x, y, curva }]
  //   encuadre 9:16:      ajuste.claves = [{ tFuente, xPct, yPct, wPct, hPct, curva }]
  // Campos OPCIONALES: sin claves el clip es fijo como siempre, y un
  // proyecto viejo abre igual. No sube VERSION.
  //
  // POR QUE EN TIEMPO DE FUENTE (hallazgos 10 y 47 del INFORME): es el
  // mismo eje que usadoIn/usadoOut, y derivar() ya copia todo a cada
  // pedazo. Asi cortar, recortar, roll, slip, ripple y mover conservan la
  // animacion pegada al CONTENIDO sin tocar ninguna de esas operaciones:
  // la mitad derecha de un corte sigue la animacion donde iba, no la
  // arranca de cero. GES hace lo mismo (curva en coordenadas de fuente,
  // evaluada con clamp entre in-point y out-point). Consecuencia a saber:
  // un slip corre la animacion junto con el contenido.
  //
  // El ENCUADRE no tiene material: su eje es el propio (usadoIn arranca en
  // 0). Con el ripple multipista de la tanda E eso sigue a la frase, salvo
  // cuando E1 lo acorta o lo estira por el medio: ahi sacarTramo/abrirTramo
  // reescriben sus claves (ver sacarDeClaves/abrirEnClaves).
  //
  // EN CUADROS: una clave nace en el cuadro del instante pedido, contado
  // desde el inicio del clip (tFuente - usadoIn es un numero entero de
  // cuadros). Cortar, recortar y slip mueven usadoIn de a cuadros enteros,
  // asi que eso se conserva. verificarMontaje lo controla.
  //
  // LAS CLAVES FUERA DE LA VENTANA SE CONSERVAN: recortar un clip no borra
  // la animacion de la parte que se escondio, y volver a estirarlo la trae
  // de vuelta. La evaluacion es con clamp a [usadoIn, usadoOut].
  //
  // CURVA de una clave = como se va desde ELLA hasta la siguiente (como el
  // operador de MLT): 'lineal' (por defecto, el campo se omite), 'suave'
  // (arranca y frena despacio) o 'mantener' (salto seco en la siguiente).
  //
  // FUERA DE 1.4 A PROPOSITO: la camara lenta. Cambia duracionDe y el orden
  // de pedidos del guion de export; va como eje aparte (DECISIONES F4).
  const CURVAS = ['lineal', 'suave', 'mantener'];
  const CAMPOS_TRANSFORMACION = ['escala', 'x', 'y'];
  const CAMPOS_RECT = ['xPct', 'yPct', 'wPct', 'hPct'];

  const camposDe = (el) => (esAjuste(el) ? CAMPOS_RECT : CAMPOS_TRANSFORMACION);

  function clavesDe(el) {
    if (!el || el.tipo !== 'clip') return [];
    const lista = esAjuste(el) ? el.ajuste.claves : (el.transformacion && el.transformacion.claves);
    return Array.isArray(lista) ? lista : [];
  }

  // El valor FIJO de un elemento (lo que se ve sin claves).
  function valorFijo(el) {
    if (esAjuste(el)) return acotarRect(el.ajuste.rect);
    const t = transformacionDe(el);
    return { escala: t.escala, x: t.x, y: t.y };
  }

  const tomarCampos = (o, campos) => campos.reduce((acc, c) => { acc[c] = o[c]; return acc; }, {});

  // Evalua una lista de claves ordenada en el instante t. Antes de la
  // primera vale la primera; despues de la ultima, la ultima. La tolerancia
  // EPS importa: un instante que sale de sumar duraciones puede quedar
  // 1e-15 antes de su clave, y con 'mantener' eso tomaria el valor viejo.
  function interpolarClaves(claves, t, campos) {
    const n = claves.length;
    if (t <= claves[0].tFuente + EPS) return tomarCampos(claves[0], campos);
    if (t >= claves[n - 1].tFuente - EPS) return tomarCampos(claves[n - 1], campos);
    const i = indiceDeTramo(claves, t);
    const a = claves[i], b = claves[i + 1];
    const u = fraccionDeCurva(a, (t - a.tFuente) / (b.tFuente - a.tFuente));
    return campos.reduce((acc, c) => { acc[c] = a[c] + (b[c] - a[c]) * u; return acc; }, {});
  }

  // El indice de la clave que abre el tramo donde cae t (entre la primera y
  // la ultima).
  function indiceDeTramo(claves, t) {
    let i = 0;
    while (i < claves.length - 2 && t >= claves[i + 1].tFuente - EPS) i++;
    return i;
  }

  // LA S DE 'suave' Y SU `tramo`. La curva suave es smoothstep entre 0 y 1.
  // Cuando una operacion tiene que PARTIR un tramo suave (el ripple le saca
  // un pedazo a un encuadre animado, o unir fusiona dos mitades), rehacer
  // la S entre los puntos nuevos cambiaria los cuadros. Para que quede
  // exacto, cada mitad guarda que pedazo de la S original recorre:
  // `tramo: [u0, u1]` (se omite si es [0, 1], el caso normal).
  const smooth = (u) => u * u * (3 - 2 * u);
  const tramoDe = (c) => (Array.isArray(c.tramo) ? c.tramo : [0, 1]);

  function fraccionDeCurva(a, u) {
    if (a.curva === 'mantener') return 0;
    if (a.curva !== 'suave') return u;
    const [u0, u1] = tramoDe(a);
    const s0 = smooth(u0), s1 = smooth(u1);
    if (!(s1 - s0 > 1e-12)) return u;
    return (smooth(u0 + (u1 - u0) * u) - s0) / (s1 - s0);
  }

  const sinTramo = (c) => { const x = { ...c }; delete x.tramo; return x; };

  function conTramo(c, u0, u1) {
    const x = sinTramo(c);
    if (u0 > EPS || u1 < 1 - EPS) x.tramo = [u0, u1];
    return x;
  }

  // Devuelve la lista con una clave EXACTAMENTE en t que no cambia ningun
  // valor: en un tramo lineal va el valor interpolado; en uno 'mantener',
  // el de la clave de antes; en uno 'suave', las dos mitades se reparten la
  // S con `tramo`. Antes de la primera o despues de la ultima, una copia
  // del valor de la punta. Si ya habia una clave en t, la lista tal cual.
  function partirClaves(claves, t, campos) {
    if (!claves.length || claves.some((c) => Math.abs(c.tFuente - t) <= EPS)) return claves;
    const n = claves.length;
    if (t < claves[0].tFuente) return [{ ...tomarCampos(claves[0], campos), tFuente: t }].concat(claves);
    if (t > claves[n - 1].tFuente) return claves.concat([{ ...tomarCampos(claves[n - 1], campos), tFuente: t }]);
    const i = indiceDeTramo(claves, t);
    const a = claves[i];
    const valor = interpolarClaves(claves, t, campos);
    let izq = a;
    let nueva = { tFuente: t, ...valor };
    if (a.curva === 'mantener') nueva.curva = 'mantener';
    if (a.curva === 'suave') {
      const [u0, u1] = tramoDe(a);
      const w = u0 + (u1 - u0) * (t - a.tFuente) / (claves[i + 1].tFuente - a.tFuente);
      izq = conTramo(a, u0, w);
      nueva = conTramo({ ...nueva, curva: 'suave' }, w, u1);
    }
    return claves.slice(0, i).concat([izq, nueva], claves.slice(i + 1));
  }

  // Lo que vale un elemento en un instante de SU eje de fuente, con clamp a
  // su ventana. Sin claves, el valor fijo.
  function valorAnimadoEn(el, tFuente) {
    const claves = clavesDe(el);
    if (!claves.length) return valorFijo(el);
    const t = Math.max(el.usadoIn, Math.min(el.usadoOut, tFuente));
    const v = interpolarClaves(claves, t, camposDe(el));
    if (esAjuste(el)) return acotarRect(v);
    return { ...v, escala: acotarEscala(v.escala) };
  }

  // La transformacion de un clip en un instante de su fuente, completa.
  const transformacionEn = (el, tFuente) => ({ ...TRANSFORMACION_BASE, ...valorAnimadoEn(el, tFuente) });

  // Una clave con sus valores acotados y la curva solo si no es la lineal.
  function normalizarClave(el, datos) {
    const campos = camposDe(el);
    let valores = tomarCampos(datos, campos);
    valores = esAjuste(el) ? acotarRect(valores) : { ...valores, escala: acotarEscala(valores.escala) };
    const clave = { tFuente: datos.tFuente, ...valores };
    if (datos.curva && datos.curva !== 'lineal' && CURVAS.includes(datos.curva)) clave.curva = datos.curva;
    return clave;
  }

  // El elemento con otra lista de claves. Vacia saca el campo: un clip que
  // se animo y se desanimo queda igual que uno que nunca se toco.
  function conClaves(el, claves, fijo) {
    const ordenadas = claves.slice().sort((a, b) => a.tFuente - b.tFuente);
    if (esAjuste(el)) {
      const ajuste = { ...el.ajuste };
      if (fijo) ajuste.rect = acotarRect(fijo);
      if (ordenadas.length) ajuste.claves = ordenadas; else delete ajuste.claves;
      return { ...el, ajuste };
    }
    const t = { ...transformacionDe(el), ...(fijo || {}) };
    if (ordenadas.length) t.claves = ordenadas; else delete t.claves;
    return { ...el, transformacion: t };
  }

  // El tFuente del cuadro de un instante de la linea, dentro del clip. El
  // ultimo cuadro que se ve es fin - 1 cuadro: una clave en `fin` justo no
  // se veria nunca.
  function tFuenteDeClave(m, el, tLinea) {
    const cuadro = duracionCuadro(m);
    const hasta = Math.max(0, el.duracion - cuadro);
    const off = Math.max(0, Math.min(hasta, aCuadro(m, tLinea - el.inicio)));
    return el.usadoIn + off;
  }

  // El elemento posicionado (con inicio/fin) de un clip que acepta claves.
  function clipAnimable(m, pistaId, elId) {
    const el = elementosDePista(m, pistaId).find((x) => x.id === elId);
    return el && el.tipo === 'clip' && (esAjuste(el) || el.mediaId) ? el : null;
  }

  function reemplazarCrudo(m, pistaId, elId, fn) {
    return conElementos(m, pistaId, (els) => els.map((x) => (x.id === elId ? fn(x) : x)));
  }

  // PONE (o actualiza) la clave del cuadro de tLinea. `valores` es un
  // subconjunto de los campos; lo que falta sale de lo que el clip vale en
  // ese instante, asi poner una clave nunca cambia lo que se ve (hasta que
  // se cambie su valor). La primera clave de un clip fijo es justamente
  // "empezar a animar desde lo que hay".
  function ponerClave(m, pistaId, elId, tLinea, valores, curva) {
    const el = clipAnimable(m, pistaId, elId);
    if (!el || typeof tLinea !== 'number' || !isFinite(tLinea)) return m;
    const t = tFuenteDeClave(m, el, tLinea);
    const campos = camposDe(el);
    const claves = clavesDe(el);
    // Primero una clave en t que no cambia nada (partirClaves), despues los
    // valores nuevos encima.
    const lista = claves.length
      ? partirClaves(claves, t, campos).slice()
      : [{ tFuente: t, ...valorFijo(el) }];
    const i = lista.findIndex((c) => Math.abs(c.tFuente - t) <= EPS);
    const actual = lista[i];
    const cambia = !!valores && campos.some((k) => typeof valores[k] === 'number' && Math.abs(valores[k] - actual[k]) > EPS);
    const nueva = normalizarClave(el, { ...actual, ...(valores || {}), tFuente: t, curva: curva || actual.curva });
    // Un pedazo de S partida (`tramo`) sigue valiendo mientras no se toquen
    // sus puntas. Si cambia el valor, se rehacen las dos S que tocan esta
    // clave; si cambia la curva, la que sale de ella.
    if (actual.tramo && !cambia && !curva) nueva.tramo = actual.tramo;
    lista[i] = nueva;
    if (cambia && i > 0) lista[i - 1] = sinTramo(lista[i - 1]);
    return reemplazarCrudo(m, pistaId, elId, (x) => conClaves(x, lista));
  }

  // Saca la clave del cuadro de tLinea. Si era la ultima, el clip queda
  // FIJO en el valor que tenia esa clave: que desaparezca la animacion no
  // tiene por que hacer saltar la imagen a otro lado.
  function quitarClave(m, pistaId, elId, tLinea) {
    const el = clipAnimable(m, pistaId, elId);
    if (!el || typeof tLinea !== 'number') return m;
    const t = tFuenteDeClave(m, el, tLinea);
    const claves = clavesDe(el);
    const previa = claves.find((c) => Math.abs(c.tFuente - t) <= EPS);
    if (!previa) return m;
    // La clave de antes pasa a ir hasta la siguiente: su pedazo de S (si lo
    // tenia) ya no corresponde.
    const resto = claves.filter((c) => c !== previa)
      .map((c, i, l) => (l[i + 1] && l[i + 1].tFuente > t && c.tFuente < t ? sinTramo(c) : c));
    const fijo = resto.length ? null : tomarCampos(previa, camposDe(el));
    return reemplazarCrudo(m, pistaId, elId, (x) => conClaves(x, resto, fijo));
  }

  // Cambia la curva de la clave del cuadro de tLinea (si hay una).
  function curvaDeClave(m, pistaId, elId, tLinea, curva) {
    const el = clipAnimable(m, pistaId, elId);
    if (!el || !CURVAS.includes(curva)) return m;
    const t = tFuenteDeClave(m, el, tLinea);
    const previa = clavesDe(el).find((c) => Math.abs(c.tFuente - t) <= EPS);
    if (!previa || (previa.curva || 'lineal') === curva) return m;
    return ponerClave(m, pistaId, elId, tLinea, null, curva);
  }

  // Las claves de un clip ubicadas en la LINEA (para dibujarlas y saltar
  // entre ellas). Solo las que caen dentro de lo que se ve.
  function clavesEnLinea(m, pistaId, elId) {
    const el = clipAnimable(m, pistaId, elId);
    if (!el) return [];
    return clavesDe(el)
      .filter((c) => c.tFuente >= el.usadoIn - EPS && c.tFuente < el.usadoOut - EPS)
      .map((c) => ({ tLinea: el.inicio + (c.tFuente - el.usadoIn), curva: c.curva || 'lineal', clave: c }));
  }

  // La clave del cuadro de tLinea, o null.
  function claveEn(m, pistaId, elId, tLinea) {
    const el = clipAnimable(m, pistaId, elId);
    if (!el || typeof tLinea !== 'number') return null;
    const t = tFuenteDeClave(m, el, tLinea);
    return clavesDe(el).find((c) => Math.abs(c.tFuente - t) <= EPS) || null;
  }

  // Una clave que desde ella MANTIENE su valor hasta la siguiente.
  const quieta = (c) => ({ ...sinTramo(c), curva: 'mantener' });

  // SACAR un tramo [desde, hasta) del eje propio de un encuadre (E1, tanda
  // E: el ripple le saca la parte que cruza lo borrado). Lo de despues
  // queda `hasta - desde` antes. Para que cada cuadro que queda valga lo
  // mismo que antes, se parte la lista en el ULTIMO cuadro antes del tramo
  // y en `hasta` (partirClaves no cambia ningun valor), se tira lo del
  // medio y la clave del ultimo cuadro pasa a 'mantener': sin eso el lado
  // izquierdo interpolaria hacia la clave de `hasta`, que ahora esta un
  // cuadro despues. Si no hay claves despues de ese ultimo cuadro, lo que
  // queda ya valia la ultima clave y sigue valiendola: no se toca nada.
  function sacarDeClaves(claves, desde, hasta, cuadro, campos) {
    if (!claves.length || !(hasta - desde > EPS)) return claves;
    const largo = hasta - desde;
    const ultimo = desde - cuadro;
    if (!claves.some((c) => c.tFuente > ultimo + EPS)) return claves;
    const lista = partirClaves(partirClaves(claves, ultimo, campos), hasta, campos);
    const izq = lista.filter((c) => c.tFuente <= ultimo + EPS)
      .map((c) => (Math.abs(c.tFuente - ultimo) <= EPS ? quieta(c) : c));
    const der = lista.filter((c) => c.tFuente >= hasta - EPS).map((c) => ({ ...c, tFuente: c.tFuente - largo }));
    return izq.concat(der);
  }

  // ABRIR `largo` segundos en el instante `en` del eje propio de un
  // encuadre (E1: el ripple lo estira por el medio o por el principio).
  // Lo de despues se corre y el tramo nuevo MANTIENE el valor de `en`: es
  // material que se corrio, no una animacion nueva. Se parte la lista en
  // `en`; esa clave queda quieta y una copia suya retoma la curva en
  // `en + largo`.
  function abrirEnClaves(claves, en, largo, campos) {
    if (!claves.length || !(largo > EPS)) return claves;
    if (!claves.some((c) => c.tFuente >= en - EPS)) return claves;
    const lista = partirClaves(claves, en, campos);
    const antes = lista.filter((c) => c.tFuente < en - EPS);
    const enEn = lista.find((c) => Math.abs(c.tFuente - en) <= EPS);
    const despues = lista.filter((c) => c.tFuente > en + EPS).map((c) => ({ ...c, tFuente: c.tFuente + largo }));
    return antes.concat([quieta(enEn), { ...enEn, tFuente: en + largo }], despues);
  }

  // UNIR (deshacer un corte): las claves de los dos pedazos en una lista.
  // Hasta el ultimo cuadro del izquierdo manda el izquierdo (y ahi queda
  // quieto); desde la frontera, el derecho. Si los dos traen las mismas
  // claves (lo normal: son las dos mitades de un corte) queda esa lista tal
  // cual. Un pedazo sin claves aporta su valor fijo. null si ninguno esta
  // animado.
  function fusionarClaves(a, b, cuadro) {
    const ca = clavesDe(a), cb = clavesDe(b);
    if (!ca.length && !cb.length) return null;
    if (JSON.stringify(ca) === JSON.stringify(cb)) return ca;
    const campos = camposDe(a);
    const frontera = a.usadoOut;
    const ultimo = Math.max(a.usadoIn, frontera - cuadro);
    const la = partirClaves(ca.length ? ca : [{ tFuente: a.usadoIn, ...valorFijo(a) }], ultimo, campos);
    const lb = partirClaves(cb.length ? cb : [{ tFuente: frontera, ...valorFijo(b) }], frontera, campos);
    const izq = la.filter((c) => c.tFuente <= ultimo + EPS)
      .map((c) => (Math.abs(c.tFuente - ultimo) <= EPS ? quieta(c) : c));
    const der = lb.filter((c) => c.tFuente >= frontera - EPS);
    return izq.concat(der);
  }

  // Lleva las claves de un elemento a la grilla de cuadros de su clip (la
  // migracion y el cambio de fps). Si dos caen en el mismo cuadro, queda la
  // ultima. Devuelve el mismo elemento si no cambia nada.
  function alinearClaves(m, el) {
    const claves = clavesDe(el);
    const f = fpsDe(m);
    if (!claves.length || !f) return el;
    const porCuadro = new Map();
    let cambio = false;
    claves.forEach((c) => {
      const n = Math.floor((c.tFuente - el.usadoIn) * f.num / f.den + 0.5 + 1e-6);
      const t = el.usadoIn + n * f.den / f.num;
      if (Math.abs(t - c.tFuente) > 0) cambio = true;
      if (porCuadro.has(n)) cambio = true;
      porCuadro.set(n, { ...c, tFuente: t });
    });
    return cambio ? conClaves(el, [...porCuadro.values()]) : el;
  }

  const nuevoVinculo = () => nuevoId('k');

  // Todos los clips que comparten un vinculo, con la pista donde estan.
  function clipsVinculados(m, vinculo) {
    if (!vinculo) return [];
    const out = [];
    m.pistas.forEach((p) => p.elementos.forEach((el) => {
      if (el.tipo === 'clip' && el.vinculo === vinculo) out.push({ pistaId: p.id, el });
    }));
    return out;
  }

  // El vinculo de un clip puntual, si tiene.
  function vinculoDe(m, pistaId, elId) {
    const p = pistaPorId(m, pistaId);
    if (!p) return null;
    const el = p.elementos.find((x) => x.id === elId);
    return (el && el.vinculo) || null;
  }

  function hueco(duracion, id) {
    return { tipo: 'hueco', id: id || nuevoId('h'), duracion };
  }

  function duracionDe(el) {
    return el.tipo === 'hueco' ? el.duracion : el.usadoOut - el.usadoIn;
  }

  // `opciones.fps` (numero o {num,den}) le da base de cuadro desde el
  // principio. Sin el, el montaje es continuo como antes (ver BASE DE
  // CUADRO arriba).
  function crearMontaje(opciones) {
    const m = { version: VERSION, media: [], pistas: [] };
    const f = opciones && opciones.fps != null ? fpsComoFraccion(opciones.fps) : null;
    if (f) m.fps = f;
    return m;
  }

  // ----------------------------------------------------------
  // MATERIAL (panel multimedia)
  // ----------------------------------------------------------
  // `disponible` lleva INICIO y FIN, no solo duracion: un archivo puede
  // arrancar en un timecode distinto de cero, y sin eso todo el material
  // con timecode real queda corrido.

  function agregarMedia(m, datos) {
    const id = nuevoId('m');
    const inicio = datos.disponibleIn || 0;
    const tipo = datos.tipo || 'video';
    const media = {
      id,
      ruta: datos.ruta,
      nombre: datos.nombre || String(datos.ruta || '').split(/[\\/]/).pop() || 'sin nombre',
      tipo,
      disponibleIn: inicio,
      disponibleOut: datos.disponibleOut != null ? datos.disponibleOut : inicio + (datos.duracion || 0),
      ancho: datos.ancho || 0,
      alto: datos.alto || 0,
      // SE GUARDA (07/08/2026): antes este campo se perdia aca aunque el
      // main lo mandara, asi que "tiene sonido" era siempre `undefined` y
      // todo material terminaba bajando un clip a la pista de audio,
      // incluso una foto o un video mudo.
      // Sin dato explicito se asume por el tipo: solo un video puede
      // traer sonido; una foto no, y el audio ya ES el sonido.
      tieneAudio: datos.tieneAudio != null ? datos.tieneAudio !== false : tipo === 'video',
      // FPS DEL MATERIAL (13/09/2026, export de video). ffprobe ya lo media
      // al importar y se tiraba aca; la exportacion lo necesita para
      // decidir a cuantos cuadros por segundo sale el mp4.
      // Es un campo OPCIONAL a proposito y solo se escribe si se sabe:
      // los proyectos guardados antes no lo tienen, y agregarlo NO sube
      // VERSION (montajeUtilizable descarta cualquier otra version y eso
      // borraria la edicion en silencio). Quien lo lea tiene que tolerar
      // que falte — ver GuionExport.fpsDeMontaje.
      ...(datos.fps > 0 && isFinite(datos.fps) ? { fps: datos.fps } : {})
    };
    return [{ ...m, media: m.media.concat([media]) }, id];
  }

  const mediaPorId = (m, id) => m.media.find((x) => x.id === id) || null;

  // Sacar material se lleva sus clips: dejarlos apuntando a algo que ya
  // no existe seria un montaje con agujeros invisibles hasta exportar.
  // Se reemplazan por huecos de la misma duracion para no correr el resto.
  function quitarMedia(m, mediaId) {
    return {
      ...m,
      media: m.media.filter((x) => x.id !== mediaId),
      // Pasa por limpiar() como cualquier otra operacion: si al sacar el
      // material la pista queda solo con huecos, se colapsa sola en vez
      // de dejar una pista "larga" pero sin nada adentro.
      pistas: m.pistas.map((p) => ({
        ...p,
        elementos: limpiar(p.elementos.map((el) =>
          (el.tipo === 'clip' && el.mediaId === mediaId) ? hueco(duracionDe(el)) : el))
      }))
    };
  }

  // ----------------------------------------------------------
  // PISTAS (el orden del array es el orden de apilado: la ultima tapa)
  // ----------------------------------------------------------
  // LAS PISTAS SON UNIVERSALES (07/08/2026, pedido del user). Solo hay
  // DOS grupos: audio y todo lo demas. Una pista "de video" no es una
  // pista de video: es una pista VISUAL, y acepta cualquier material que
  // se vea - video, foto, y lo que se agregue despues (titulos, efectos,
  // generadores). El campo `tipo` de la pista NO filtra el material; solo
  // dice de que lado de la linea vive.
  //
  // Es como funcionan DaVinci, Premiere y Kdenlive: una foto y un video
  // van en la misma V1, y lo unico que no se mezcla es el audio (que se
  // dibuja distinto porque se escucha, no se ve). Reservar una pista por
  // tipo de material obligaria a saltar de pista todo el tiempo.
  //
  // `tipo` se dejo como 'video' | 'audio' en vez de renombrarlo a
  // 'visual': los proyectos ya guardados en proyecto.json lo tienen
  // escrito asi, y cambiar la palabra los volveria ilegibles a cambio de
  // nada. La regla real es la de esVisual().
  const esVisual = (p) => !!p && p.tipo !== 'audio';

  // Destino "todavia no existe": soltar un clip por ENCIMA de la pista
  // mas alta (o por debajo de la mas baja) crea la pista y lo pone ahi,
  // como en DaVinci. Va como constante y no como string suelto para que
  // el main, el renderer y los tests digan todos lo mismo.
  const PISTA_NUEVA = '__nueva__';

  // Mueve un clip a una pista RECIEN CREADA del mismo grupo, en un solo
  // paso. Tiene que ser una sola operacion: crear la pista por un lado y
  // mover por el otro deja dos pasos de historial, y el primer Ctrl+Z
  // devolveria el clip pero no sacaria la pista vacia.
  function moverAPistaNueva(m, pistaId, elId, tLinea) {
    const origen = pistaPorId(m, pistaId);
    if (!origen) return m;
    return moverConInforme(m, pistaId, elId, tLinea, PISTA_NUEVA)[0];
  }

  // EL AUDIO VA SIEMPRE ABAJO Y LA IMAGEN ARRIBA, como en cualquier
  // editor: los dos grupos no se entreveran nunca. Sin esta regla se
  // podia terminar con V1, A1, V2, A2 mezclados, que es incomodo de leer
  // y no significa nada (el apilado solo importa entre pistas de video).
  //
  // El array guarda de ABAJO hacia ARRIBA (la ultima tapa), asi que
  // "audio primero" en el array es "audio abajo" en pantalla. Dentro de
  // cada grupo se conserva el orden que traian.
  function ordenarPistas(m) {
    const audio = m.pistas.filter((p) => p.tipo === 'audio');
    const video = m.pistas.filter((p) => p.tipo !== 'audio');
    return { ...m, pistas: audio.concat(video) };
  }

  function agregarPista(m, tipo, nombre) {
    const id = nuevoId('p');
    const t = tipo || 'video';
    const n = m.pistas.filter((p) => p.tipo === t).length + 1;
    const pista = { id, tipo: t, nombre: nombre || `${t === 'audio' ? 'A' : 'V'}${n}`, visible: true, elementos: [] };
    return [ordenarPistas({ ...m, pistas: m.pistas.concat([pista]) }), id];
  }

  const pistaPorId = (m, id) => m.pistas.find((p) => p.id === id) || null;

  function actualizarPista(m, pistaId, cambios) {
    const c = { ...(cambios || {}) };
    // La ganancia llega de un control de la interfaz: se acota aca para que
    // un valor raro (negativo, NaN, 50) no llegue nunca al export.
    if ('ganancia' in c) c.ganancia = acotarGanancia(c.ganancia);
    if ('silenciada' in c) c.silenciada = !!c.silenciada;
    // El candado del ripple multipista (tanda E). Destrabar SACA el campo:
    // una pista que se trabo y se destrabo queda igual que una que nunca
    // se toco.
    const destrabar = 'bloqueada' in c && !c.bloqueada;
    if ('bloqueada' in c) c.bloqueada = true;
    if (destrabar) delete c.bloqueada;
    return { ...m, pistas: m.pistas.map((p) => {
      if (p.id !== pistaId) return p;
      const salida = { ...p, ...c };
      if (destrabar) delete salida.bloqueada;
      return salida;
    }) };
  }

  // ----------------------------------------------------------
  // SONIDO DE LAS PISTAS (13/09/2026, tanda D, paso 5 de la hoja de ruta)
  // ----------------------------------------------------------
  // Tres campos OPCIONALES, sin subir VERSION; un proyecto viejo no los
  // tiene y se lee con los valores por defecto:
  //   pista.silenciada  true = no suena (default false)
  //   pista.ganancia    multiplicador de toda la pista, 0..4 (default 1)
  //   clip.volumen      multiplicador del clip, 0..4 (default 1)
  //
  // `visible` y `silenciada` son cosas distintas. Hasta ahora la pista de
  // audio solo tenia `visible`, y "ocultarla" era la unica forma de que no
  // sonara (hallazgo 5). Se separan, pero una pista de AUDIO guardada con
  // visible:false se sigue leyendo como silenciada: era lo que significaba
  // para el user que la oculto, y leerla distinto la haria sonar de golpe.
  const GANANCIA_MAX = 4;   // +12 dB: mas que eso es distorsion segura

  function acotarGanancia(v) {
    const n = +v;
    return isFinite(n) ? Math.max(0, Math.min(GANANCIA_MAX, n)) : 1;
  }

  const gananciaDe = (x) => (x && x.ganancia != null ? acotarGanancia(x.ganancia) : 1);
  const volumenDe = (el) => (el && el.volumen != null ? acotarGanancia(el.volumen) : 1);

  function pistaSilenciada(p) {
    return !!p && (p.silenciada === true || (p.tipo === 'audio' && p.visible === false));
  }

  // Volumen de un clip. Se aplica a todo el grupo vinculado: el volumen de
  // la imagen no significa nada por si solo, y si alguien lo cambia desde
  // el clip de video lo que quiere es que cambie SU sonido. Volver a 1
  // saca el campo, asi un clip que se toco y se dejo como estaba no queda
  // distinto en el proyecto.
  function ajustarVolumen(m, pistaId, elId, volumen) {
    const v = acotarGanancia(volumen);
    return objetivosVinculados(m, pistaId, elId).reduce((acc, o) =>
      conElementos(acc, o.pistaId, (els) => els.map((el) =>
        (el.id === o.elId && el.tipo === 'clip' && !esAjuste(el)
          ? derivar(el, { volumen: Math.abs(v - 1) <= EPS ? undefined : v }) : el))), m);
  }

  // Reordenar SOLO dentro del propio grupo: una pista de audio no puede
  // subir por encima del video ni al reves. El indice que llega es global
  // (asi lo manda la interfaz), y aca se traduce a una posicion dentro
  // del grupo; si el movimiento se saldria del grupo, no pasa nada, que
  // es mas claro que reacomodar en un lugar que el user no pidio.
  function moverPista(m, pistaId, nuevoIndice) {
    const p = pistaPorId(m, pistaId);
    if (!p) return m;
    const grupo = m.pistas.filter((x) => (x.tipo === 'audio') === (p.tipo === 'audio'));
    const otros = m.pistas.filter((x) => (x.tipo === 'audio') !== (p.tipo === 'audio'));
    const desde = grupo.findIndex((x) => x.id === pistaId);
    // El indice global se mide sobre el array completo; dentro del grupo
    // hay que descontar las pistas del otro grupo que quedan antes.
    const base = p.tipo === 'audio' ? 0 : m.pistas.filter((x) => x.tipo === 'audio').length;
    const destino = nuevoIndice - base;
    if (destino < 0 || destino > grupo.length - 1 || destino === desde) return m;
    const copia = grupo.slice();
    const [movida] = copia.splice(desde, 1);
    copia.splice(destino, 0, movida);
    return ordenarPistas({ ...m, pistas: otros.concat(copia) });
  }

  function conElementos(m, pistaId, fn) {
    return { ...m, pistas: m.pistas.map((p) => (p.id === pistaId ? { ...p, elementos: limpiar(fn(p.elementos)) } : p)) };
  }

  // Normaliza una lista de elementos: saca los de duracion cero y fusiona
  // huecos consecutivos. Se corre despues de CADA operacion, asi ninguna
  // tiene que acordarse de limpiar - y no quedan restos que solo se ven
  // al dibujar.
  function limpiar(elementos) {
    const out = [];
    for (const el of elementos) {
      if (duracionDe(el) <= EPS) continue;
      const ult = out[out.length - 1];
      if (el.tipo === 'hueco' && ult && ult.tipo === 'hueco') {
        out[out.length - 1] = hueco(ult.duracion + el.duracion, ult.id);
      } else {
        out.push(el);
      }
    }
    // Un hueco al final no se sostiene: no hay nada detras que lo empuje.
    while (out.length && out[out.length - 1].tipo === 'hueco') out.pop();
    return out;
  }

  // ----------------------------------------------------------
  // LECTURA
  // ----------------------------------------------------------

  // Elementos con su ubicacion en la LINEA ya calculada. La posicion sale
  // de sumar lo que viene antes: por eso no puede quedar desincronizada.
  function elementosDePista(m, pistaId) {
    const p = pistaPorId(m, pistaId);
    if (!p) return [];
    let cursor = 0;
    return p.elementos.map((el, i) => {
      const d = duracionDe(el);
      const info = {
        ...el, indice: i, inicio: cursor, fin: cursor + d, duracion: d,
        nombre: el.tipo !== 'clip' ? ''
          : esAjuste(el) ? 'Encuadre 9:16'
          : (mediaPorId(m, el.mediaId) || {}).nombre || '(material faltante)'
      };
      cursor += d;
      return info;
    });
  }

  const duracionPista = (m, pistaId) =>
    (pistaPorId(m, pistaId) || { elementos: [] }).elementos.reduce((a, el) => a + duracionDe(el), 0);

  const duracionMontaje = (m) => m.pistas.reduce((a, p) => Math.max(a, duracionPista(m, p.id)), 0);

  function elementoEn(m, pistaId, tLinea) {
    return elementosDePista(m, pistaId).find((el) => tLinea >= el.inicio - EPS && tLinea < el.fin - EPS) || null;
  }

  // QUE SE VE en un instante: capas de ABAJO hacia ARRIBA (orden de
  // dibujo; la ultima tapa). Los huecos son transparentes, asi que dejan
  // ver la pista de abajo - igual que en OTIO.
  // QUE SE VE en un instante: capas de ABAJO hacia ARRIBA (orden de
  // dibujo; la ultima tapa). Los huecos son transparentes, asi que dejan
  // ver la pista de abajo - igual que en OTIO.
  //
  // Cada capa dice de que CLASE es:
  //   'media'  : material que se dibuja (video, foto)
  //   'ajuste' : un encuadre. NO se dibuja: recorta lo que quedo compuesto
  //              hasta ahi. Quien dibuja tiene que respetar el orden - un
  //              ajuste no toca lo que venga DESPUES en la lista, que es
  //              lo que lo distingue de un efecto de pista.
  function composicionEn(m, tLinea) {
    const capas = [];
    m.pistas.forEach((p, indice) => {
      if (!p.visible || p.tipo === 'audio') return;
      const el = elementoEn(m, p.id, tLinea);
      if (!el || el.tipo !== 'clip') return;
      const base = { pistaId: p.id, pistaNombre: p.nombre, indice, clipId: el.id };
      if (esAjuste(el)) {
        // Con claves (tanda F) el rectangulo es el de ESE instante, en el eje
        // propio del encuadre.
        capas.push({ ...base, clase: 'ajuste', rect: valorAnimadoEn(el, el.usadoIn + (tLinea - el.inicio)) });
        return;
      }
      capas.push({
        ...base, clase: 'media',
        mediaId: el.mediaId, media: mediaPorId(m, el.mediaId),
        tFuente: el.usadoIn + (tLinea - el.inicio),
        // Cada capa lleva SU transformacion: el lienzo es la base y cada
        // material se dibuja encima con su propio tamaño y posicion.
        // Tanda F: la de ESE instante si el clip tiene claves. Es el unico
        // lugar donde se evalua la animacion, asi el visor y el export (los
        // dos pasan por Composicion) no pueden verla distinta.
        transformacion: transformacionEn(el, el.usadoIn + (tLinea - el.inicio))
      });
    });
    return capas;
  }

  // Los ENCUADRES activos en un instante, de abajo hacia arriba. Ese orden
  // es el que manda en el panel 9:16: el de la pista mas baja va primero.
  // Reemplaza a `Recuadros.activosEn`, que ordenaba por un campo `track`
  // propio - ahora el orden ES el de las pistas, que es el que el user ve.
  function encuadresEn(m, tLinea) {
    return composicionEn(m, tLinea).filter((c) => c.clase === 'ajuste');
  }

  // Lo que efectivamente se ve, o null si en ese instante no hay material
  // en ninguna pista (ahi va negro). Un ajuste NO cuenta: no tiene imagen
  // propia, asi que un encuadre solo arriba de todo deja ver el video de
  // abajo, no lo tapa.
  function capaVisibleEn(m, tLinea) {
    const c = composicionEn(m, tLinea).filter((x) => x.clase === 'media');
    return c.length ? c[c.length - 1] : null;
  }

  // QUE SUENA en un instante. Es el equivalente de capaVisibleEn() para
  // el sonido, y hace falta porque la imagen y el audio no tienen por que
  // coincidir: una pista de video puede tener un vacio justo donde la de
  // audio sigue teniendo material. Sin esto "no hay imagen" se confundia
  // con "no hay nada" y se perdia el sonido que si estaba ahi.
  //
  // 13/09/2026 (tanda D): devuelve la PRIMERA de capasDeAudioEn(). La usa
  // el visor, que tiene un solo <video> y no puede mezclar; el export usa
  // todas.
  function capaDeAudioEn(m, tLinea) {
    const capas = capasDeAudioEn(m, tLinea);
    return capas.length ? capas[0] : null;
  }

  // TODO LO QUE SUENA en un instante, una capa por pista de audio (13/09/2026,
  // tanda D). Antes solo existia capaDeAudioEn y con voz en A1 y musica en
  // A2 el modelo no tenia forma de decir que sonaban las dos (hallazgos 5
  // y 38). Quedan afuera las pistas silenciadas y las capas con ganancia 0.
  // `ganancia` ya es la final: la de la pista por el volumen del clip.
  function capasDeAudioEn(m, tLinea) {
    const out = [];
    for (const p of m.pistas) {
      if (p.tipo !== 'audio' || pistaSilenciada(p)) continue;
      const el = elementoEn(m, p.id, tLinea);
      if (!el || el.tipo !== 'clip' || esAjuste(el)) continue;
      const ganancia = gananciaDe(p) * volumenDe(el);
      if (!(ganancia > 0)) continue;
      out.push({
        // MISMA FORMA que una capa de composicionEn(), a proposito. Antes
        // esta faltaba `transformacion`, y quien recibia la capa no tenia
        // como saber si le habia tocado una de imagen o una de sonido:
        // leerla explotaba con "Cannot read properties of undefined".
        // Pasaba en cualquier tramo con sonido pero sin imagen, que es un
        // caso NORMAL - las dos pistas son independientes.
        clase: 'audio',
        pistaId: p.id, pistaNombre: p.nombre,
        clipId: el.id, mediaId: el.mediaId, media: mediaPorId(m, el.mediaId),
        tFuente: el.usadoIn + (tLinea - el.inicio),
        transformacion: transformacionDe(el),
        ganancia
      });
    }
    return out;
  }

  // Donde vuelve a haber material despues de t, para saltar un vacio en
  // vez de quedarse en negro.
  function proximoMaterialDesde(m, tLinea) {
    let mejor = null;
    for (const p of m.pistas) {
      if (!p.visible) continue;
      for (const el of elementosDePista(m, p.id)) {
        if (el.tipo === 'clip' && el.inicio > tLinea + EPS && (mejor === null || el.inicio < mejor)) mejor = el.inicio;
      }
    }
    return mejor;
  }

  // ----------------------------------------------------------
  // INSERTAR
  // ----------------------------------------------------------

  // Pone material al final de la pista.
  function agregarAlFinal(m, pistaId, mediaId, opciones) {
    const med = mediaPorId(m, mediaId);
    if (!med || !pistaPorId(m, pistaId)) return [m, null];
    const o = opciones || {};
    const usadoIn = Math.max(med.disponibleIn, o.usadoIn != null ? o.usadoIn : med.disponibleIn);
    const usadoOut = hastaEnCuadros(m, usadoIn,
      Math.min(med.disponibleOut, o.usadoOut != null ? o.usadoOut : med.disponibleOut));
    if (!(usadoOut - usadoIn > margen(m))) return [m, null];
    const c = clip(mediaId, usadoIn, usadoOut, undefined, o.vinculo);
    return [conElementos(m, pistaId, (els) => els.concat([c])), c.id];
  }

  // Copia una pista de video sobre una de audio, emparejando cada clip
  // con su sonido. Es como entra el material: la imagen y el audio del
  // mismo archivo son una unidad.
  //
  // Tambien sirve de MIGRACION para los montajes hechos antes de que
  // existiera el vinculo (tenian la pista de audio vacia). Por eso solo
  // corre si el audio esta vacio Y ningun clip de video tiene vinculo
  // todavia: asi se aplica una sola vez y no repone un audio que el user
  // borro a proposito.
  function espejarEnAudio(m, pistaVideoId, pistaAudioId) {
    const v = pistaPorId(m, pistaVideoId);
    const a = pistaPorId(m, pistaAudioId);
    if (!v || !a || a.elementos.length) return m;
    if (!v.elementos.some((el) => el.tipo === 'clip')) return m;
    if (v.elementos.some((el) => el.tipo === 'clip' && el.vinculo)) return m;

    const video = [];
    const audio = [];
    v.elementos.forEach((el) => {
      if (el.tipo === 'hueco') {
        video.push(el);
        audio.push(hueco(duracionDe(el)));
        return;
      }
      const k = nuevoVinculo();
      video.push({ ...el, vinculo: k });
      audio.push(clip(el.mediaId, el.usadoIn, el.usadoOut, undefined, k));
    });

    const conVideo = conElementos(m, pistaVideoId, () => video);
    return conElementos(conVideo, pistaAudioId, () => audio);
  }

  // ----------------------------------------------------------
  // DONDE ATERRIZA EL MATERIAL NUEVO (07/08/2026)
  // ----------------------------------------------------------
  // PEDIDO DEL USER: "cuando uno sube un clip se deberia crear una nueva
  // linea a la cual interactuar, para que asi no tenga que hacer click a
  // añadir una nueva pista cada vez".
  //
  // La regla es la de cualquier editor: material nuevo NO TAPA lo que ya
  // estaba. Se busca la primera pista donde el tramo entre limpio y, si
  // no hay ninguna, se crea. Antes esto sobrescribia siempre en la
  // primera pista, asi que poner un segundo clip en el mismo instante se
  // comia el primero sin avisar.
  //
  // Ojo con la diferencia: TAPAR sigue siendo lo correcto cuando el user
  // arrastra un clip a un lugar concreto (moverElemento), porque ahi
  // eligio el destino. Aca no eligio nada, asi que tapar seria destruir
  // material que no pidio tocar.

  // ¿Entra algo en [a,b) de esta pista sin pisar un clip? Los huecos no
  // cuentan: un vacio esta justamente para llenarse.
  function tramoLibre(m, pistaId, a, b) {
    return !elementosDePista(m, pistaId).some((el) =>
      el.tipo === 'clip' && el.inicio < b - EPS && el.fin > a + EPS);
  }

  // Primera pista del grupo (visual o audio) con lugar en ese tramo.
  function pistaLibreEn(m, tipo, a, b) {
    const quieroAudio = tipo === 'audio';
    const p = m.pistas.find((x) => (x.tipo === 'audio') === quieroAudio && tramoLibre(m, x.id, a, b));
    return p ? p.id : null;
  }

  // Pone un material en la linea buscandole lugar. Devuelve el montaje y
  // un informe de donde quedo, para que la interfaz pueda decirlo.
  //   opciones.pistaId : forzar una pista concreta (ahi SI tapa, porque
  //                      es un destino elegido a mano)
  function colocarMedia(m, mediaId, tLinea, opciones) {
    const med = mediaPorId(m, mediaId);
    if (!med) return [m, null];
    const o = opciones || {};
    // Con base de cuadro entra el material en cuadros enteros: el pedazo de
    // cuadro que sobra al final del archivo no se puede mostrar entero.
    const dur = pisoCuadro(m, med.disponibleOut - med.disponibleIn);
    if (!(dur > margen(m))) return [m, null];
    const a = Math.max(0, aCuadro(m, tLinea || 0));
    const b = a + dur;

    // El material se clasifica en los mismos dos grupos que las pistas:
    // o suena, o se ve. Una foto, un video y cualquier cosa futura caen
    // del mismo lado y comparten pista.
    const esAudioPuro = med.tipo === 'audio';
    const conAudio = !esAudioPuro && med.tieneAudio !== false;
    const vinculo = conAudio ? nuevoVinculo() : undefined;

    let salida = m;
    const pistasNuevas = [];

    let destino = o.pistaId || null;
    if (!destino) {
      destino = pistaLibreEn(salida, esAudioPuro ? 'audio' : 'video', a, b);
      if (!destino) {
        [salida, destino] = agregarPista(salida, esAudioPuro ? 'audio' : 'video');
        pistasNuevas.push(destino);
      }
    }

    let pistaAudio = null;
    if (conAudio) {
      pistaAudio = pistaLibreEn(salida, 'audio', a, b);
      if (!pistaAudio) {
        [salida, pistaAudio] = agregarPista(salida, 'audio');
        pistasNuevas.push(pistaAudio);
      }
    }

    const c = clip(mediaId, med.disponibleIn, hastaEnCuadros(m, med.disponibleIn, med.disponibleOut), undefined, vinculo);
    salida = sobrescribirEn(salida, destino, a, c);
    if (conAudio) {
      salida = sobrescribirEn(salida, pistaAudio, a,
        clip(mediaId, med.disponibleIn, hastaEnCuadros(m, med.disponibleIn, med.disponibleOut), undefined, vinculo));
    }
    return [salida, { pistaId: destino, clipId: c.id, pistaAudio, pistasNuevas }];
  }

  // ----------------------------------------------------------
  // PONER UN ENCUADRE (07/08/2026)
  // ----------------------------------------------------------
  // Un ajuste solo significa algo ARRIBA de lo que recorta, asi que no
  // vale la primera pista libre: hay que buscar la primera que este libre
  // Y quede por encima de todo lo que hay material en ese tramo. Si no
  // existe, se crea una - que en un editor es lo que uno haria a mano.
  function colocarEncuadre(m, tLinea, duracion, rect, opciones) {
    const o = opciones || {};
    const a = Math.max(0, aCuadro(m, tLinea || 0));
    // Con base de cuadro, la duracion tambien en cuadros y nunca menos que
    // lo que acepta encuadre() (MIN_DUR), para que el constructor no la
    // vuelva a sacar de la grilla.
    const b = a + (fpsDe(m)
      ? Math.max(Math.ceil(MIN_DUR / duracionCuadro(m) - 1e-6) * duracionCuadro(m), aCuadro(m, duracion || 0))
      : Math.max(MIN_DUR, duracion || 0));
    const e = encuadre(b - a, rect);

    let salida = m;
    const pistasNuevas = [];
    let destino = o.pistaId || null;

    if (!destino) {
      const visuales = m.pistas.filter(esVisual);
      // Indice de la primera pista que ya esta por encima de todo lo
      // ocupado en [a,b).
      let desde = 0;
      visuales.forEach((p, i) => { if (!tramoLibre(m, p.id, a, b)) desde = i + 1; });
      const libre = visuales.slice(desde).find((p) => tramoLibre(m, p.id, a, b));
      if (libre) {
        destino = libre.id;
      } else {
        [salida, destino] = agregarPista(salida, 'video');
        pistasNuevas.push(destino);
      }
    }

    salida = sobrescribirEn(salida, destino, a, e);
    return [salida, { pistaId: destino, clipId: e.id, pistasNuevas }];
  }

  // Cambia el rectangulo de un encuadre. Es el equivalente de transformar()
  // para los ajustes: llega un subconjunto de campos y el resto se conserva.
  // `tLinea` (tanda F): en un encuadre animado el cambio va a la clave de
  // ese cuadro, igual que en transformar().
  function ajustarEncuadre(m, pistaId, elId, rect, tLinea) {
    const crudo = elementoCrudo(m, pistaId, elId);
    if (esAjuste(crudo) && clavesDe(crudo).length && typeof tLinea === 'number') {
      return ponerClave(m, pistaId, elId, tLinea, rect);
    }
    return conElementos(m, pistaId, (els) => els.map((el) => {
      if (el.id !== elId || !esAjuste(el)) return el;
      return { ...el, ajuste: { ...el.ajuste, rect: acotarRect({ ...el.ajuste.rect, ...rect }) } };
    }));
  }

  // Los encuadres guardados por la version vieja (`recuadros.js`, lista
  // aparte con su propio campo `track`) pasados a elementos del montaje.
  // Corre una sola vez: si el montaje ya tiene algun ajuste, no toca nada,
  // asi abrir dos veces el mismo proyecto no duplica los encuadres.
  //
  // Cada `track` de la lista vieja se vuelve UNA pista nueva arriba de
  // todo, en el mismo orden: el campo decia justamente el apilado dentro
  // del panel 9:16, que es lo que ahora dice el orden de las pistas.
  function migrarRecuadros(m, recuadros) {
    const lista = (recuadros || []).filter((r) => r && r.end > r.start);
    if (!lista.length) return m;
    if (m.pistas.some((p) => p.elementos.some(esAjuste))) return m;

    const niveles = [...new Set(lista.map((r) => Math.max(0, Math.round(r.track) || 0)))].sort((a, b) => a - b);
    let salida = m;
    niveles.forEach((nivel) => {
      let pistaId;
      [salida, pistaId] = agregarPista(salida, 'video', 'Encuadre 9:16');
      lista
        .filter((r) => (Math.max(0, Math.round(r.track) || 0)) === nivel)
        .sort((a, b) => a.start - b.start)
        .forEach((r) => {
          salida = sobrescribirEn(salida, pistaId, r.start,
            encuadre(r.end - r.start, r, r.id));
        });
    });
    return salida;
  }

  // ----------------------------------------------------------
  // PODA DE PISTAS VACIAS (07/08/2026, pedido del user)
  // ----------------------------------------------------------
  // "si una pista se queda vacia se elimina". Ningun motor lo hace por
  // uno (MLT lo dice explicito: es responsabilidad de la aplicacion), asi
  // que va aca y se corre despues de cada operacion.
  //
  // Se conserva SIEMPRE la ultima de cada grupo aunque este vacia: si no,
  // borrar el unico clip dejaria una linea de tiempo sin ninguna pista, o
  // sea sin ningun lugar donde soltar el siguiente.
  function podarPistas(m) {
    const conAlgo = (p) => p.elementos.length > 0;
    const salida = [];
    // El audio va primero, igual que en ordenarPistas(): podar no es
    // motivo para reordenar.
    [true, false].forEach((esAudio) => {
      const grupo = m.pistas.filter((p) => (p.tipo === 'audio') === esAudio);
      if (!grupo.length) return;
      const vivas = grupo.filter(conAlgo);
      salida.push(...(vivas.length ? vivas : [grupo[0]]));
    });
    // Mismo objeto si no cambio nada: el historial compara por identidad y
    // si no, cada operacion inocente dejaria un paso de deshacer vacio.
    return salida.length === m.pistas.length ? m : { ...m, pistas: salida };
  }

  // Inserta en un instante de la linea. Si cae dentro de un elemento, lo
  // parte; si cae despues del final, rellena con un hueco.
  //
  // RIPPLE MULTIPISTA (13/09/2026, tanda E): insertar empuja lo de atras,
  // asi que es un ripple. Antes corria solo SU pista: insertar en medio de
  // la entrevista partia la imagen, corria V1 y dejaba A1 y los encuadres
  // quietos (probe1.js caso 4 del INFORME). Ahora abre el mismo lugar en
  // todas las pistas no bloqueadas (ver RIPPLE MULTIPISTA mas abajo), y si
  // alguna tiene material cruzando ese instante, no inserta nada.
  // Devuelve [montaje, clipId, informe]; clipId es null si no inserto.
  function insertarEn(m, pistaId, tLinea, mediaId, opciones) {
    const med = mediaPorId(m, mediaId);
    if (!med || !pistaPorId(m, pistaId)) return [m, null, {}];
    const o = opciones || {};
    const usadoIn = Math.max(med.disponibleIn, o.usadoIn != null ? o.usadoIn : med.disponibleIn);
    const usadoOut = hastaEnCuadros(m, usadoIn,
      Math.min(med.disponibleOut, o.usadoOut != null ? o.usadoOut : med.disponibleOut));
    if (!(usadoOut - usadoIn > margen(m))) return [m, null, {}];
    tLinea = Math.max(0, aCuadro(m, tLinea));

    // BUG ENCONTRADO POR LOS TESTS: antes esto agregaba el hueco de
    // relleno en UNA operacion y el clip en OTRA. Como limpiar() saca los
    // huecos que quedan al final (no hay nada detras que los sostenga),
    // el relleno se borraba en el paso intermedio y el clip terminaba
    // pegado al principio en vez de donde se lo habia pedido.
    // Se inserta relleno + clip DE UNA, asi el hueco nunca queda ultimo.
    const largo = duracionPista(m, pistaId);
    // cortarEn parte tambien a la pareja vinculada del clip que cruza el
    // instante: asi en su pista queda un borde donde abrir el lugar.
    const base = tLinea < largo - margen(m) ? cortarEn(m, pistaId, tLinea) : m;
    const c = clip(mediaId, usadoIn, usadoOut);
    const dur = usadoOut - usadoIn;

    // Donde entra de verdad. Dentro de un vacio, en tLinea (el vacio se
    // parte a mano: cortarEn no puede, limpiar() lo vuelve a fusionar).
    // Dentro de un clip que no se pudo partir (a menos de MIN_DUR de un
    // borde, solo sin base de cuadro), antes de ese clip.
    const pos = elementosDePista(base, pistaId);
    const i = pos.findIndex((x) => tLinea < x.fin - EPS);
    let punto = tLinea;
    let partirVacio = false;
    if (i >= 0) {
      if (pos[i].tipo === 'hueco' && tLinea > pos[i].inicio + EPS) partirVacio = true;
      else punto = pos[i].inicio;
    }

    let salida = base;
    const informe = {};
    if (i >= 0) {
      const plan = planDeCorrer(base, [pistaId], { abrir: punto });
      if (plan.bloqueo) return [m, null, { bloqueo: plan.bloqueo }];
      plan.otras.forEach((q) => { salida = abrirTramo(salida, q, punto, dur, null); });
      informe.corridas = plan.otras;
    }
    const relleno = tLinea > largo + margen(m) ? [hueco(tLinea - largo)] : [];
    salida = conElementos(salida, pistaId, (els) => {
      const copia = els.slice();
      if (i < 0) copia.push(...relleno, c);
      else if (partirVacio) {
        const h = els[i];
        copia.splice(i, 1, hueco(tLinea - pos[i].inicio, h.id), c, hueco(pos[i].fin - tLinea));
      } else copia.splice(i, 0, c);
      return copia;
    });
    return [salida, c.id, informe];
  }

  // Indice en la lista donde arranca (o arrancaria) el instante tLinea.
  function indiceEn(m, pistaId, tLinea) {
    const els = elementosDePista(m, pistaId);
    for (let i = 0; i < els.length; i++) if (tLinea < els[i].fin - EPS) return i;
    return els.length;
  }

  // ----------------------------------------------------------
  // CORTAR
  // ----------------------------------------------------------

  // Corte literal en UNA pista: donde habia un elemento quedan dos.
  //
  // `mapa` traduce el vinculo viejo al nuevo que le toca a la SEGUNDA
  // mitad. Va por parametro y compartido entre pistas a proposito: si
  // cada corte inventara su propio vinculo, la mitad derecha del video y
  // la del audio quedarian con vinculos distintos, o sea sueltas, y a
  // partir del primer corte dejarian de moverse juntas.
  function cortarUno(m, pistaId, tLinea, mapa) {
    const el = elementoEn(m, pistaId, tLinea);
    if (!el) return m;
    if (tLinea <= el.inicio + margen(m) || tLinea >= el.fin - margen(m)) return m;
    const off = tLinea - el.inicio;

    let a, b;
    if (el.tipo === 'hueco') {
      a = hueco(off, el.id);
      b = hueco(el.duracion - off);
    } else {
      let vinculoB;
      if (el.vinculo) {
        if (!mapa[el.vinculo]) mapa[el.vinculo] = nuevoVinculo();
        vinculoB = mapa[el.vinculo];
      }
      const crudo = elementoCrudo(m, pistaId, el.id) || el;
      a = derivar(crudo, { id: el.id, usadoOut: el.usadoIn + off });
      b = derivar(crudo, { id: nuevoId('c'), usadoIn: el.usadoIn + off, vinculo: vinculoB });
    }

    return conElementos(m, pistaId, (els) => {
      const copia = els.slice();
      copia.splice(el.indice, 1, a, b);
      return copia;
    });
  }

  // Cortar un clip vinculado corta tambien a su pareja: la imagen y su
  // sonido son una unidad, y partir solo una las desincroniza sin aviso.
  function cortarEn(m, pistaId, tLinea) {
    tLinea = aCuadro(m, tLinea);
    const el = elementoEn(m, pistaId, tLinea);
    const mapa = {};
    let salida = cortarUno(m, pistaId, tLinea, mapa);
    if (el && el.tipo === 'clip' && el.vinculo) {
      for (const o of clipsVinculados(m, el.vinculo)) {
        if (o.pistaId === pistaId) continue;
        salida = cortarUno(salida, o.pistaId, tLinea, mapa);
      }
    }
    return salida;
  }

  // La cuchilla sin modificador de DaVinci: corta todas las pistas. El
  // mapa es uno solo para todas, por lo mismo de arriba.
  function cortarTodasEn(m, tLinea) {
    tLinea = aCuadro(m, tLinea);
    const mapa = {};
    return m.pistas.reduce((acc, p) => cortarUno(acc, p.id, tLinea, mapa), m);
  }

  // ----------------------------------------------------------
  // BORRAR
  // ----------------------------------------------------------

  // Suprimir: el clip se va y queda un HUECO del mismo largo, asi lo de
  // atras no se mueve.
  // Borrar arrastra a la pareja vinculada: sacar la imagen y dejar el
  // sonido sonando sobre un vacio es siempre un error, nunca una
  // intencion.
  function objetivosVinculados(m, pistaId, elId) {
    const v = vinculoDe(m, pistaId, elId);
    return v ? clipsVinculados(m, v).map((o) => ({ pistaId: o.pistaId, elId: o.el.id }))
             : [{ pistaId, elId }];
  }

  function borrar(m, pistaId, elId) {
    return objetivosVinculados(m, pistaId, elId).reduce((acc, o) =>
      conElementos(acc, o.pistaId, (els) =>
        els.map((el) => (el.id === o.elId && el.tipo === 'clip' ? hueco(duracionDe(el), el.id) : el))), m);
  }

  // Ripple delete: el clip se va y todo lo de atras se corre hacia
  // adelante. En las pistas del clip y su pareja es sacarlo del array.
  //
  // RIPPLE MULTIPISTA (13/09/2026, tanda E): antes eso era TODO. Los
  // encuadres, el B-roll y la musica de otras pistas se quedaban quietos
  // y cada encuadre posterior pasaba a recortar otra frase (hallazgo 33).
  // Ahora el mismo tramo sale de todas las pistas no bloqueadas; si en
  // alguna hay material en ese tramo, no se borra nada y el informe dice
  // cual (ver RIPPLE MULTIPISTA mas abajo). Es todo o nada: borrar la
  // mitad de un clip no es lo que se pidio.
  // Devuelve [montaje, informe].
  function borrarConRippleConInforme(m, pistaId, elId) {
    const el = elementosDePista(m, pistaId).find((x) => x.id === elId);
    if (!el) return [m, {}];
    if (el.tipo === 'hueco') return cerrarHuecoConInforme(m, pistaId, elId);
    const objetivos = objetivosVinculados(m, pistaId, elId);
    const unidad = [...new Set(objetivos.map((o) => o.pistaId))];
    const plan = planDeCorrer(m, unidad, { sacar: [el.inicio, el.fin] });
    if (plan.bloqueo) return [m, { bloqueo: plan.bloqueo }];
    let salida = objetivos.reduce((acc, o) =>
      conElementos(acc, o.pistaId, (els) => els.filter((x) => x.id !== o.elId)), m);
    plan.otras.forEach((q) => { salida = sacarTramo(salida, q, el.inicio, el.fin); });
    return [salida, { corridas: plan.otras }];
  }

  function borrarConRipple(m, pistaId, elId) {
    return borrarConRippleConInforme(m, pistaId, elId)[0];
  }

  // ----------------------------------------------------------
  // LOS CUATRO MODOS DE RECORTE
  // ----------------------------------------------------------
  // Tal como los define cualquier editor. Cada uno cambia una cosa
  // distinta, y la diferencia entre ellos es EXACTAMENTE lo que se
  // conserva:

  // ----------------------------------------------------------
  // EL VINCULO IMAGEN-SONIDO EN LOS CUATRO MODOS (08/08/2026)
  // ----------------------------------------------------------
  // ANTES: los cuatro operaban sobre UN clip. Si tenia pareja de audio
  // vinculada, la pareja se quedaba quieta y la imagen se corria respecto
  // del sonido. Medido con los tests de test/vinculoAV.test.js: un ripple
  // dejaba la imagen terminando en 6 y el sonido en 10.
  //
  // Es el peor bug que puede tener un editor porque NO SE VE: no tira
  // error, la linea de tiempo se sigue dibujando bien, y te enteras al
  // exportar cuando los labios no coinciden con la voz. Para entonces ya
  // no sabes cual de los veinte recortes que hiciste lo causo.
  //
  // POR QUE NO ALCANZA CON "aplicar la misma operacion a cada pista":
  // cada pista se frena donde se le termina SU material. Si el .wav dura
  // 12s y el .mp4 100s, estirar a 20 deja la imagen en 20 y el sonido en
  // 12: desincronizados igual, pero solo con ciertos archivos, o sea el
  // bug que aparece "a veces" y es imposible de reproducir.
  //
  // LA REGLA, entonces: cada pista calcula CUANTO PUEDE moverse, y se
  // aplica a todas el movimiento MAS CHICO. Se mueven juntas o no se
  // mueve ninguna. Preferir quedarse corto antes que romper la sincronia
  // es la decision correcta: un recorte que llega hasta donde puede se ve
  // y se corrige; uno desincronizado no se ve.

  // El delta que TODAS las pistas vinculadas pueden hacer. `calcular`
  // devuelve, para una pista, cuanto puede moverse (ya acotado por su
  // material y sus vecinos).
  function deltaComun(m, pistaId, elId, calcular) {
    // Una pista que no puede operar (null) frena a todas. Si una pista
    // solo puede ir para un lado y otra para el otro, lo unico que pueden
    // hacer JUNTAS es quedarse quietas (13/09/2026: antes se elegia el de
    // menor valor absoluto, que podia tener el signo de una sola).
    return menorComun(objetivosVinculados(m, pistaId, elId).map((o) => calcular(m, o.pistaId, o.elId)));
  }

  // Aplica `aplicar` a cada clip vinculado con el MISMO delta.
  function aplicarAVinculados(m, pistaId, elId, delta, aplicar) {
    if (delta === null || delta === 0) return m;
    return objetivosVinculados(m, pistaId, elId)
      .reduce((acc, o) => aplicar(acc, o.pistaId, o.elId, delta), m);
  }

  function clipDe(m, pistaId, elId) {
    const el = elementosDePista(m, pistaId).find((x) => x.id === elId);
    return el && el.tipo === 'clip' ? el : null;
  }

  const materialDe = (m, el) =>
    mediaPorId(m, el.mediaId) || { disponibleIn: -Infinity, disponibleOut: Infinity };

  // RIPPLE — cambia la duracion del clip y corre todo lo de atras.
  // Es el unico que cambia el largo total del montaje.
  function deltaRipple(m, pistaId, elId, borde, tLinea) {
    const el = clipDe(m, pistaId, elId);
    if (!el) return null;
    const med = materialDe(m, el);
    if (borde === 'in') {
      // Hasta donde puede retroceder el borde de entrada: lo limita el
      // material que queda por delante y el minimo de duracion.
      const minT = el.inicio - pisoCuadro(m, el.usadoIn - med.disponibleIn);
      const t = Math.max(minT, Math.min(tLinea, el.fin - minDur(m)));
      return t - el.inicio;
    }
    const nuevoFin = Math.max(el.inicio + minDur(m), tLinea);
    const nuevoOut = Math.min(hastaEnCuadros(m, el.usadoIn, med.disponibleOut), el.usadoIn + (nuevoFin - el.inicio));
    return nuevoOut - el.usadoOut;
  }

  // RIPPLE MULTIPISTA (13/09/2026, tanda E): el clip y su pareja cambian
  // de duracion como antes (deltaComun), y en las demas pistas no
  // bloqueadas se saca o se abre el MISMO tramo, para que lo de atras se
  // corra igual en todas:
  //   borde 'out': el tramo esta en el final del clip. Achicar saca
  //                [fin-d, fin); alargar abre d en `fin`.
  //   borde 'in' : el clip queda en su lugar y muestra otra parte del
  //                material, asi que lo que se corre es lo de atras de su
  //                inicio. Achicar saca [inicio, inicio+d); alargar abre d
  //                en `inicio`. Asi un encuadre sobre la mitad del clip
  //                sigue sobre el mismo cuadro de la fuente.
  // Si otra pista tiene material en el tramo, el ripple llega hasta donde
  // puede (el delta minimo comun, igual que con la pareja) y el informe
  // nombra la pista que lo freno. Alargar no se puede frenar a medias: si
  // un clip de otra pista cruza el punto, no se alarga nada.
  // Devuelve [montaje, informe].
  function rippleConInforme(m, pistaId, elId, borde, tLinea) {
    const el = clipDe(m, pistaId, elId);
    if (!el) return [m, {}];
    tLinea = aCuadro(m, tLinea);
    const delta = deltaComun(m, pistaId, elId, (mm, p, e) => deltaRipple(mm, p, e, borde, tLinea));
    if (delta === null || Math.abs(delta) <= EPS) return [m, {}];
    const unidad = [...new Set(objetivosVinculados(m, pistaId, elId).map((o) => o.pistaId))];

    // `saca` > 0: tramo que sale de la linea; < 0: tramo que se abre.
    let saca = borde === 'in' ? delta : -delta;
    const plan = saca > 0
      ? planDeCorrer(m, unidad, borde === 'in'
        ? { sacar: [el.inicio, el.inicio + saca], desde: 'inicio' }
        : { sacar: [el.fin - saca, el.fin], desde: 'fin' })
      : planDeCorrer(m, unidad, { abrir: borde === 'in' ? el.inicio : el.fin });
    if (plan.bloqueo && !(plan.permitido > EPS)) return [m, { bloqueo: plan.bloqueo }];
    if (saca > 0) saca = Math.min(saca, plan.permitido);
    const d = borde === 'in' ? saca : -saca;

    let salida = aplicarAVinculados(m, pistaId, elId, d, (mm, p, e, dd) =>
      conElementos(mm, p, (l) => l.map((x) => {
        if (x.id !== e) return x;
        const med = materialDe(mm, x);
        return borde === 'in'
          ? { ...x, usadoIn: Math.max(med.disponibleIn, x.usadoIn + dd) }
          : { ...x, usadoOut: Math.min(med.disponibleOut, x.usadoOut + dd) };
      })));
    plan.otras.forEach((q) => {
      if (saca > 0) {
        salida = borde === 'in'
          ? sacarTramo(salida, q, el.inicio, el.inicio + saca)
          : sacarTramo(salida, q, el.fin - saca, el.fin);
      } else {
        // Un encuadre que termina (out) o empieza (in) justo en el borde
        // cubre a este clip: se estira con el. Uno del otro lado no.
        salida = abrirTramo(salida, q, borde === 'in' ? el.inicio : el.fin, -saca,
          borde === 'in' ? 'despues' : 'antes');
      }
    });
    const informe = { corridas: plan.otras };
    if (plan.bloqueo) informe.bloqueo = plan.bloqueo;   // se freno a medias
    return [salida, informe];
  }

  function ripple(m, pistaId, elId, borde, tLinea) {
    return rippleConInforme(m, pistaId, elId, borde, tLinea)[0];
  }

  // RECORTE NORMAL — cambia la duracion del clip SIN mover a nadie: lo
  // que deja de usarse queda como VACIO en su lugar.
  //
  // Es lo que hace arrastrar el borde de un clip en cualquier editor, y
  // es distinto de ripple: ripple corre todo lo de atras para tapar el
  // agujero, y por eso cambia el largo del montaje. Aca el montaje no se
  // mueve; solo aparece (o se agranda) un vacio.
  // BUG REPORTADO 06/08/2026: la interfaz mandaba SIEMPRE ripple al
  // arrastrar una manija, asi que achicar un clip corria todos los demas.
  //
  // Agrandar solo se puede hasta donde haya lugar: se come el vacio
  // vecino y se frena contra el clip de al lado. Pasarse por encima
  // seria una sobrescritura, que es otro gesto.
  // Cuanto se puede mover el borde en ESTA pista: lo limita el material
  // que le queda al clip y el lugar libre que tenga al lado.
  function deltaRecorte(m, pistaId, elId, borde, tLinea) {
    const els = elementosDePista(m, pistaId);
    const i = els.findIndex((x) => x.id === elId);
    if (i < 0 || els[i].tipo !== 'clip') return null;
    const el = els[i];
    const med = materialDe(m, el);

    if (borde === 'in') {
      const anterior = els[i - 1];
      const libreAntes = anterior && anterior.tipo === 'hueco' ? anterior.duracion : 0;
      const minInicio = Math.max(
        el.inicio - pisoCuadro(m, el.usadoIn - med.disponibleIn),   // hasta donde da el material
        el.inicio - libreAntes                          // hasta donde hay lugar
      );
      return Math.min(el.fin - minDur(m), Math.max(tLinea, minInicio)) - el.inicio;
    }

    const siguiente = els[i + 1];
    const libreDespues = siguiente && siguiente.tipo === 'hueco' ? siguiente.duracion : 0;
    const maxFin = Math.min(
      el.inicio + pisoCuadro(m, med.disponibleOut - el.usadoIn),
      el.fin + libreDespues
    );
    return Math.max(el.inicio + minDur(m), Math.min(tLinea, maxFin)) - el.fin;
  }

  // La parte que TOCA el montaje, ya con el delta decidido. Separada del
  // calculo para que el recorte vinculado pueda imponerle a las dos
  // pistas el mismo movimiento en vez de dejar que cada una se frene por
  // su cuenta (ver el bloque del vinculo mas arriba).
  function aplicarRecorte(m, pistaId, elId, borde, delta) {
    if (delta === null || Math.abs(delta) <= EPS) return m;
    const els = elementosDePista(m, pistaId);
    const i = els.findIndex((x) => x.id === elId);
    if (i < 0 || els[i].tipo !== 'clip') return m;

    return conElementos(m, pistaId, (lista) => {
      const copia = lista.slice();
      const c = lista[i];
      if (borde === 'in') {
        copia[i] = derivar(c, { usadoIn: c.usadoIn + delta });
        if (delta > 0) {
          copia.splice(i, 0, hueco(delta));            // se achico: queda vacio
        } else if (copia[i - 1] && copia[i - 1].tipo === 'hueco') {
          const h = copia[i - 1];
          copia[i - 1] = hueco(h.duracion + delta, h.id);  // se comio el vacio
        }
        return copia;
      }
      // usadoOut + delta es lo mismo que la cuenta larga de antes
      // (usadoIn + (nuevoFin - inicio)), porque usadoOut - usadoIn es
      // exactamente la duracion, o sea fin - inicio.
      copia[i] = derivar(c, { usadoOut: c.usadoOut + delta });
      if (delta < 0) {
        copia.splice(i + 1, 0, hueco(-delta));
      } else if (copia[i + 1] && copia[i + 1].tipo === 'hueco') {
        const h = copia[i + 1];
        copia[i + 1] = hueco(h.duracion - delta, h.id);
      }
      return copia;
    });
  }

  function recortarConHueco(m, pistaId, elId, borde, tLinea) {
    tLinea = aCuadro(m, tLinea);
    return aplicarRecorte(m, pistaId, elId, borde, deltaRecorte(m, pistaId, elId, borde, tLinea));
  }

  // Recortar un clip vinculado recorta igual a su pareja.
  //
  // CORREGIDO 08/08/2026: antes esto llamaba a recortarConHueco una vez
  // por pista, y cada una se frenaba donde se le acababa SU material. Con
  // un video de 100s y un wav de 12s vinculados, estirar a 20 dejaba la
  // imagen en 20 y el sonido en 12 — ocho segundos de desfase. Se veia
  // sincronizado en pantalla y solo aparecia al exportar.
  // PENDIENTE decia que esta operacion "si respetaba el vinculo": era
  // cierto a medias, tocaba las dos pistas pero no las mantenia juntas.
  function recortar(m, pistaId, elId, borde, tLinea) {
    if (!clipDe(m, pistaId, elId)) return m;
    tLinea = aCuadro(m, tLinea);
    const delta = deltaComun(m, pistaId, elId, (mm, p, e) => deltaRecorte(mm, p, e, borde, tLinea));
    return aplicarAVinculados(m, pistaId, elId, delta, (mm, p, e, d) =>
      aplicarRecorte(mm, p, e, borde, d));
  }

  // ROLL — mueve el punto de corte entre dos clips vecinos: uno crece lo
  // que el otro se achica. El largo total NO cambia.
  //
  // CORREGIDO 13/09/2026 (tanda B), tres cosas:
  //   1. BORDE. Antes el roll operaba siempre con el vecino de ATRAS,
  //      aunque se agarrara el borde izquierdo: se movia el corte que no
  //      era. Ahora `borde` 'in' opera con el vecino de adelante.
  //   2. CONTRA UN VACIO. parDeRoll pedia clip de los dos lados y, si no,
  //      no hacia nada (y la interfaz decia "se movio el corte"). Del lado
  //      de un vacio, un roll es un recorte: el vacio absorbe. Es lo que
  //      define GES_EDIT_MODE_ROLL (ges-enums.md:458-475): recorta el
  //      elemento y, si hay vecino, tambien al vecino.
  //   3. LA PAREJA DEL VECINO. En la pista del audio se tomaba el vecino
  //      que estuviera ahi, que podia no ser la pareja del vecino de la
  //      imagen: se estiraba un audio cuyo video no se tocaba. Ahora los
  //      vecinos tienen que ser COHERENTES (ver vecinosCoherentes).
  //
  // El delta sale del limite de roll en las pistas con clip al lado y del
  // de recorte en las que tienen vacio, y se aplica el menor a todas.

  // El vecino de cada objetivo hacia `lado` (-1 adelante, +1 atras), o
  // null si mover ese borde desincronizaria a alguien que no participa: un
  // vecino vinculado cuya pareja no es, en SU pista, el vecino de la pareja
  // del clip. Pasa con restos de sobrescrituras viejas o cuando la imagen y
  // el sonido del vecino quedaron en lugares distintos.
  function vecinosCoherentes(m, objetivos, lado) {
    const vecinos = objetivos.map((o) => {
      const els = elementosDePista(m, o.pistaId);
      const i = els.findIndex((x) => x.id === o.elId);
      return { pistaId: o.pistaId, el: (i < 0 ? null : els[i + lado]) || null };
    });
    for (const v of vecinos) {
      if (!v.el || v.el.tipo !== 'clip' || !v.el.vinculo) continue;
      for (const o of clipsVinculados(m, v.el.vinculo)) {
        if (!vecinos.some((w) => w.pistaId === o.pistaId && w.el && w.el.id === o.el.id)) return null;
      }
    }
    return vecinos;
  }

  // El delta mas chico que pueden hacer todas, con la regla de deltaComun.
  function menorComun(deltas) {
    let elegido = null;
    for (const d of deltas) {
      if (d === null) return null;
      if (elegido !== null && d * elegido < 0) return 0;
      if (elegido === null || Math.abs(d) < Math.abs(elegido)) elegido = d;
    }
    return elegido;
  }

  // Cuanto se puede correr el corte entre `a` y `b` (b empieza donde
  // termina a) hacia tLinea.
  function deltaRollPar(m, a, b, tLinea) {
    const medA = mediaPorId(m, a.mediaId) || { disponibleOut: Infinity };
    const medB = mediaPorId(m, b.mediaId) || { disponibleIn: -Infinity };
    // El punto se puede mover mientras a los dos les quede material y
    // ninguno baje del minimo. Los topes incluyen el corte actual, asi un
    // clip ya mas corto que el minimo no invierte el sentido.
    const min = Math.min(a.fin, Math.max(a.inicio + minDur(m), b.fin - pisoCuadro(m, b.usadoOut - medB.disponibleIn)));
    const max = Math.max(a.fin, Math.min(b.fin - minDur(m), a.inicio + pisoCuadro(m, medA.disponibleOut - a.usadoIn)));
    return Math.max(min, Math.min(tLinea, max)) - a.fin;
  }

  function roll(m, pistaId, elId, tLinea, borde) {
    if (!clipDe(m, pistaId, elId)) return m;
    tLinea = aCuadro(m, tLinea);
    const lado = borde === 'in' ? -1 : 1;
    const bordeRecorte = lado < 0 ? 'in' : 'out';
    const objetivos = objetivosVinculados(m, pistaId, elId);
    const vecinos = vecinosCoherentes(m, objetivos, lado);
    if (!vecinos) return m;

    const planes = objetivos.map((o, i) => {
      const el = clipDe(m, o.pistaId, o.elId);
      const v = vecinos[i].el;
      if (el && v && v.tipo === 'clip') {
        const [a, b] = lado > 0 ? [el, v] : [v, el];
        return { pistaId: o.pistaId, a, b, delta: deltaRollPar(m, a, b, tLinea) };
      }
      return { pistaId: o.pistaId, elId: o.elId, delta: el ? deltaRecorte(m, o.pistaId, o.elId, bordeRecorte, tLinea) : null };
    });
    const delta = menorComun(planes.map((p) => p.delta));
    if (delta === null || Math.abs(delta) <= EPS) return m;

    return planes.reduce((acc, p) => {
      if (!p.a) return aplicarRecorte(acc, p.pistaId, p.elId, bordeRecorte, delta);
      return conElementos(acc, p.pistaId, (l) => l.map((x) => {
        if (x.id === p.a.id) return { ...x, usadoOut: x.usadoOut + delta };
        if (x.id === p.b.id) return { ...x, usadoIn: x.usadoIn + delta };
        return x;
      }));
    }, m);
  }

  // SLIP — cambia QUE PARTE del material se ve. El clip no se mueve ni
  // cambia de duracion: solo corre su ventana sobre el archivo.
  function deltaSlip(m, pistaId, elId, deltaFuente) {
    const el = clipDe(m, pistaId, elId);
    if (!el) return null;
    const med = materialDe(m, el);
    // El desplazamiento se frena cuando la ventana toca un borde del
    // material: no hay de donde sacar mas.
    // En cuadros enteros (tanda F): frenar justo en el borde de un archivo
    // de 45,3 s corria usadoIn un pedazo de cuadro, y la grilla del clip
    // dejaba de coincidir con la de sus claves (y con la de su fuente).
    // Sin base de cuadro pisoCuadro devuelve lo mismo: nada cambia.
    return Math.max(-pisoCuadro(m, el.usadoIn - med.disponibleIn),
      Math.min(deltaFuente, pisoCuadro(m, med.disponibleOut - el.usadoOut)));
  }

  function slip(m, pistaId, elId, deltaFuente) {
    if (!clipDe(m, pistaId, elId)) return m;
    // El slip no cambia la linea, pero se corre de a cuadros enteros igual:
    // es lo que se ve avanzar en el visor y lo que se puede repetir.
    deltaFuente = aCuadro(m, deltaFuente);
    const delta = deltaComun(m, pistaId, elId, (mm, p, e) => deltaSlip(mm, p, e, deltaFuente));
    return aplicarAVinculados(m, pistaId, elId, delta, (mm, p, e, d) =>
      conElementos(mm, p, (l) => l.map((x) => {
        if (x.id !== e) return x;
        const dur = duracionDe(x);
        return { ...x, usadoIn: x.usadoIn + d, usadoOut: x.usadoIn + d + dur };
      })));
  }

  // SLIDE — mueve el clip en la linea; los vecinos absorben el cambio
  // (el de antes se achica lo que el de despues crece). El clip conserva
  // su material y su duracion; el largo total tampoco cambia.
  // Los vecinos que absorben el movimiento de un slide en UNA pista.
  function vecinosDeSlide(m, pistaId, elId) {
    const els = elementosDePista(m, pistaId);
    const i = els.findIndex((x) => x.id === elId);
    if (i <= 0 || i >= els.length - 1) return null;
    return { antes: els[i - 1], desp: els[i + 1] };
  }

  function deltaSlide(m, pistaId, elId, deltaLinea) {
    const v = vecinosDeSlide(m, pistaId, elId);
    if (!v) return null;
    // CORREGIDO 13/09/2026 (tanda B): el limite miraba solo la DURACION de
    // los vecinos, no el material que les queda. Con un vecino anterior que
    // ya usaba hasta el final de su archivo, un slide de +3 no lo podia
    // estirar (estirar() lo frenaba en silencio) pero el siguiente si se
    // achicaba: el clip no se movia y el montaje perdia 3 s. Con la pareja
    // de audio entre otros vecinos, desincronizaba.
    // Ahora cada vecino dice cuanto puede CRECER, como en deltaRollPar: el de
    // antes crece por su final y el de despues por su principio. Un hueco
    // no tiene material, crece lo que haga falta.
    const puedeCrecerAntes = v.antes.tipo === 'hueco' ? Infinity
      : pisoCuadro(m, materialDe(m, v.antes).disponibleOut - v.antes.usadoOut);
    const puedeCrecerDesp = v.desp.tipo === 'hueco' ? Infinity
      : pisoCuadro(m, v.desp.usadoIn - materialDe(m, v.desp).disponibleIn);
    // Los dos topes incluyen el 0: un vecino ya mas corto que MIN_DUR no
    // puede dar vuelta el signo del movimiento.
    const minimo = Math.min(0, -Math.min(v.antes.duracion - minDur(m), puedeCrecerDesp));
    const maximo = Math.max(0, Math.min(v.desp.duracion - minDur(m), puedeCrecerAntes));
    return Math.max(minimo, Math.min(deltaLinea, maximo));
  }

  function slide(m, pistaId, elId, deltaLinea) {
    if (!vecinosDeSlide(m, pistaId, elId)) return m;
    deltaLinea = aCuadro(m, deltaLinea);
    // Los vecinos absorben el movimiento, asi que tambien tienen que ir con
    // su pareja: un clip suelto entre dos vinculados estiraba la imagen del
    // vecino y dejaba su sonido quieto (13/09/2026, prueba aleatoria).
    const objetivos = objetivosVinculados(m, pistaId, elId);
    if (!vecinosCoherentes(m, objetivos, -1) || !vecinosCoherentes(m, objetivos, 1)) return m;
    const delta = deltaComun(m, pistaId, elId, (mm, p, e) => deltaSlide(mm, p, e, deltaLinea));
    return aplicarAVinculados(m, pistaId, elId, delta, (mm, p, e, d) => {
      const v = vecinosDeSlide(mm, p, e);
      if (!v) return mm;
      return conElementos(mm, p, (l) => l.map((x) => {
        if (x.id === v.antes.id) return estirar(x, v.antes.duracion + d, mm);
        if (x.id === v.desp.id) return estirar(x, v.desp.duracion - d, mm, true);
        return x;
      }));
    });
  }

  // Cambia la duracion de un elemento. En un hueco es directo; en un clip
  // se mueve el borde correspondiente sin pasarse del material.
  function estirar(el, nuevaDur, m, desdeElInicio) {
    if (el.tipo === 'hueco') return hueco(Math.max(minDur(m), nuevaDur), el.id);
    const med = mediaPorId(m, el.mediaId) || { disponibleIn: -Infinity, disponibleOut: Infinity };
    const d = Math.max(minDur(m), nuevaDur);
    if (desdeElInicio) {
      return { ...el, usadoIn: Math.max(med.disponibleIn, el.usadoOut - d) };
    }
    return { ...el, usadoOut: Math.min(med.disponibleOut, el.usadoIn + d) };
  }

  // ----------------------------------------------------------
  // MOVER UN CLIP DE LUGAR
  // ----------------------------------------------------------
  // SOBRESCRIBIR: pone un elemento en tLinea TAPANDO lo que haya ahi, sin
  // correr nada de lugar. Es la operacion que usan los editores cuando se
  // arrastra un clip (DaVinci, Premiere, Kdenlive la llaman "overwrite").
  //
  // BUG REAL QUE ARREGLA (reportado en video el 06/08/2026): antes el
  // destino INSERTABA con splice, empujando a la derecha todo lo que
  // hubiera. Como el origen queda como hueco de la duracion completa,
  // cada arrastre sumaba la duracion del clip al total: el user movio 4
  // clips y su montaje paso de 11:25 a 45:00, lleno de vacios enormes.
  // Sacar N segundos y poner N segundos en otro lado deja el total igual
  // solo si el destino TAPA. Insertar empujando es otra operacion, y en
  // los editores va con otro gesto.
  // El pedazo de un elemento que cae en el tramo [a,b] de la LINEA. En un
  // hueco alcanza con la duracion; en un clip hay que correr tambien su
  // ventana sobre el material, o el pedazo mostraria otro cuadro.
  //
  // EL VINCULO DE LOS RESTOS (13/09/2026, tanda B). Antes ningun pedazo
  // conservaba el vinculo, ni siquiera el izquierdo, que se queda con el id
  // original. Como la pareja de audio se tapaba igual en su pista, imagen y
  // sonido seguian alineados pero sueltos: desde ahi borrar o mover uno no
  // tocaba al otro. Ahora se hace lo mismo que en cortarUno: el pedazo
  // izquierdo conserva el vinculo y el derecho recibe `mapa[vinculo]`, que
  // se comparte entre la sobrescritura de la imagen y la del sonido para
  // que las dos mitades derechas terminen con el MISMO vinculo nuevo.
  // (Dos pedazos del mismo clip nunca comparten vinculo: el derecho
  // siempre recibe uno nuevo.)
  // Si la pareja no se tapo igual, los restos quedan desalineados y los
  // desvincula repararVinculos(): ahi si corresponde, porque ya no son la
  // imagen y el sonido del mismo tramo.
  function recorte(el, p, a, b, id, mapa) {
    const d = b - a;
    if (d <= EPS) return null;
    if (el.tipo === 'hueco') return hueco(d, id);
    const desfase = a - p.inicio;
    let vinculo;
    if (el.vinculo && mapa) {
      if (id === el.id) vinculo = el.vinculo;
      else vinculo = mapa[el.vinculo] = mapa[el.vinculo] || nuevoVinculo();
    }
    // La transformacion y el ajuste viajan solos con derivar(): son del pedazo.
    return derivar(el, {
      id: id || nuevoId('c'), vinculo,
      usadoIn: el.usadoIn + desfase, usadoOut: el.usadoIn + desfase + d
    });
  }

  // Los vinculos que una sobrescritura toco: si sus clips ya no son la
  // imagen y el sonido del mismo tramo (se tapo solo uno de los dos) o
  // quedo uno solo, se les saca el vinculo a todos. Un vinculo que miente
  // es peor que ninguno: cortar o borrar arrastraria un clip que ya no
  // tiene nada que ver. Devuelve [montaje, clips desvinculados].
  function repararVinculos(m, vinculos) {
    let salida = m;
    let desvinculados = 0;
    [...new Set(vinculos)].forEach((k) => {
      const miembros = clipsVinculados(salida, k).map((o) => ({
        pistaId: o.pistaId,
        el: elementosDePista(salida, o.pistaId).find((x) => x.id === o.el.id)
      }));
      if (!miembros.length) return;
      const [base] = miembros;
      const sano = miembros.length >= 2 &&
        new Set(miembros.map((o) => o.pistaId)).size === miembros.length &&
        miembros.every((o) => o.el.mediaId === base.el.mediaId &&
          Math.abs(o.el.inicio - base.el.inicio) <= EPS &&
          Math.abs(o.el.usadoIn - base.el.usadoIn) <= EPS &&
          Math.abs(o.el.usadoOut - base.el.usadoOut) <= EPS);
      if (sano) return;
      miembros.forEach((o) => {
        desvinculados++;
        salida = conElementos(salida, o.pistaId, (l) => l.map((x) =>
          (x.id === o.el.id ? derivar(x, { vinculo: undefined }) : x)));
      });
    });
    return [salida, desvinculados];
  }

  // Los vinculos de los clips que el tramo [a,b) de una pista tapa entero o
  // en parte.
  function vinculosEnTramo(m, pistaId, a, b) {
    return elementosDePista(m, pistaId)
      .filter((x) => x.tipo === 'clip' && x.vinculo && x.inicio < b - EPS && x.fin > a + EPS)
      .map((x) => x.vinculo);
  }

  // `mapa`: lo pasa quien tapa VARIAS pistas en una misma operacion
  // (moverConInforme) y se encarga de reparar los vinculos al final. Sin
  // mapa, la sobrescritura es suelta y repara sola lo que toco, salvo el
  // vinculo del elemento nuevo: su pareja la pone el que llama despues
  // (colocarMedia pone la imagen y recien despues el sonido).
  function sobrescribirEn(m, pistaId, tLinea, nuevo, mapa) {
    // PUERTA DE CUADRO: el instante y la duracion de lo que entra. Lo que
    // se tapa ya esta en cuadros, asi que los restos de los dos lados salen
    // en cuadros enteros y no quedan pedazos de milisegundos (la prueba
    // aleatoria los encontraba con el iman apagado). La duracion de un clip
    // se lleva hacia ABAJO: hacia arriba usaria material que no tiene.
    tLinea = aCuadro(m, tLinea);
    if (fpsDe(m) && nuevo.tipo === 'clip') {
      const d = pisoCuadro(m, duracionDe(nuevo));
      if (!(d > EPS)) return m;
      if (d !== duracionDe(nuevo)) nuevo = { ...nuevo, usadoOut: nuevo.usadoIn + d };
    } else if (fpsDe(m) && nuevo.tipo === 'hueco') {
      nuevo = hueco(aCuadro(m, nuevo.duracion), nuevo.id);
    }
    const dur = duracionDe(nuevo);
    const inicio = Math.max(0, tLinea);
    const fin = inicio + dur;
    if (!mapa) {
      const propio = {};
      const tocados = vinculosEnTramo(m, pistaId, inicio, fin);
      const tapado = sobrescribirEn(m, pistaId, tLinea, nuevo, propio);
      const aReparar = tocados.concat(Object.values(propio)).filter((k) => k !== nuevo.vinculo);
      return aReparar.length ? repararVinculos(tapado, aReparar)[0] : tapado;
    }
    const largo = duracionPista(m, pistaId);

    // Posiciones en el MISMO orden que la lista cruda (elementosDePista
    // mapea 1 a 1), para decidir por indice sin recalcular nada.
    const posicion = elementosDePista(m, pistaId);

    // Relleno + elemento en UNA sola operacion, mismo motivo que en
    // insertarEn(): si el hueco de relleno se agrega aparte, limpiar() lo
    // borra por quedar ultimo y el elemento aterriza donde no va.
    // CORREGIDO 13/09/2026 (tanda B): el relleno se salteaba si faltaba
    // menos de MIN_DUR, y el elemento aterrizaba al final de la pista y no
    // donde se pidio. Con la imagen en una pista y el sonido en otra de
    // distinto largo, quedaban hasta 40 ms corridos entre si (lo encontro
    // la prueba aleatoria con colocarMedia). Un vacio de menos de un cuadro
    // es feo pero se ve y se cierra; un desfase no se ve. Los pedazos
    // menores a un cuadro se resuelven con la base de cuadro (paso 6).
    const relleno = inicio > largo + EPS ? [hueco(inicio - largo)] : [];

    // OJO: aca NO se puede usar cortarEn() para partir en los bordes de la
    // zona. limpiar() vuelve a fusionar dos huecos consecutivos, asi que
    // cortar DENTRO de un vacio se deshace solo, y el elemento terminaba
    // insertado despues del vacio en vez de encima (bug encontrado por el
    // test "cuatro movimientos seguidos"). Por eso los pedazos se recortan
    // a mano en la misma pasada.
    return conElementos(m, pistaId, (lista) => {
      const salida = [];
      let puesto = false;
      const poner = () => { if (!puesto) { salida.push(...relleno, nuevo); puesto = true; } };

      lista.forEach((el, i) => {
        const p = posicion[i];
        if (!p) { salida.push(el); return; }
        if (p.fin <= inicio + EPS) { salida.push(el); return; }   // entero antes
        if (p.inicio >= fin - EPS) { poner(); salida.push(el); return; }   // entero despues

        // Se solapa con la zona de aterrizaje: sobrevive lo que asome de
        // cada lado, y el medio queda tapado.
        const izq = recorte(el, p, p.inicio, Math.min(p.fin, inicio), el.id, mapa);
        if (izq) salida.push(izq);
        poner();
        const der = recorte(el, p, Math.max(p.inicio, fin), p.fin, null, mapa);
        if (der) salida.push(der);
      });

      poner();   // cae al final, o la pista estaba vacia
      return salida;
    });
  }

  // Mover es SACAR DE ACA y TAPAR ALLA. En el origen queda un hueco del
  // tamaño del clip (igual que en cualquier editor: lo de atras no se
  // corre solo; para cerrarlo esta cerrarHueco).
  //
  // Un clip puede cambiar de pista, pero NO de grupo: la imagen no baja
  // al audio ni el audio sube a la imagen. Pedirlo no es un error del
  // user, es un destino que no significa nada, asi que se ignora el
  // cambio de pista y el clip se mueve dentro de la suya.
  function destinoDeMover(m, pistaId, pistaDestino) {
    const origen = pistaPorId(m, pistaId);
    const propuesta = pistaDestino ? pistaPorId(m, pistaDestino) : null;
    const mismoGrupo = propuesta && origen && (propuesta.tipo === 'audio') === (origen.tipo === 'audio');
    return mismoGrupo ? pistaDestino : pistaId;
  }

  // ----------------------------------------------------------
  // MOVER CON LA PAREJA (13/09/2026, tanda B)
  // ----------------------------------------------------------
  // ANTES la pareja iba al mismo instante pero SIEMPRE en su pista, y
  // tapaba lo que hubiera. Subir un B-roll con sonido a V2 en t=25, encima
  // de una entrevista, dejaba V1 intacto pero borraba 20 s de la voz de A1
  // (hallazgo 2 del INFORME). Y los restos de lo tapado perdian el vinculo
  // aunque imagen y sonido se hubieran tapado igual (hallazgo 3).
  //
  // LA REGLA (decision B1 en DECISIONES.md): la pareja va a su pista si
  // ahi lo que tapa es JUSTAMENTE el sonido de lo que el clip tapa arriba
  // (o nada). Si en su pista taparia otra cosa (la voz de un clip que en
  // la imagen queda intacto, musica suelta), va a la primera pista libre
  // de su grupo, y si no hay, a una nueva: igual que colocarMedia. Asi
  // mover nunca destruye sonido cuya imagen nadie toco.
  // Los restos de lo tapado conservan el vinculo si su pareja se tapo
  // igual; si no, se desvinculan y el informe lo cuenta para avisar.
  //
  // Devuelve [montaje, informe]:
  //   informe.pistaId        donde quedo el clip agarrado
  //   informe.parejas        [{ desde, hacia }] pista de origen y destino
  //                          de cada pareja (distintas = se corrio de pista)
  //   informe.pistasNuevas   pistas creadas (destino nuevo o lugar para la pareja)
  //   informe.desvinculados  clips que quedaron separados de su pareja
  function moverConInforme(m, pistaId, elId, tLinea, pistaDestino) {
    tLinea = aCuadro(m, tLinea);
    const informe = { pistaId, parejas: [], pistasNuevas: [], desvinculados: 0 };
    const agarrado = clipDe(m, pistaId, elId);
    if (!agarrado) return [m, informe];

    let salida = m;
    let destino = pistaDestino;
    if (pistaDestino === PISTA_NUEVA) {
      [salida, destino] = agregarPista(salida, pistaPorId(m, pistaId).tipo);
      informe.pistasNuevas.push(destino);
    }
    destino = destinoDeMover(salida, pistaId, destino);
    if (!pistaPorId(salida, destino)) return [m, informe];
    informe.pistaId = destino;

    const otros = agarrado.vinculo
      ? clipsVinculados(m, agarrado.vinculo).filter((o) => o.el.id !== elId) : [];
    const a = Math.max(0, tLinea);
    const b = a + agarrado.duracion;

    // 1. SACAR a todos antes de tapar nada: la pareja tiene que ver su
    //    propio lugar viejo como vacio, no como algo que tapar.
    [{ pistaId, el: agarrado }].concat(otros).forEach((o) => {
      salida = conElementos(salida, o.pistaId, (l) =>
        l.map((x) => (x.id === o.el.id ? hueco(duracionDe(x)) : x)));
    });

    // 2. Lo que el clip tapa en su destino, antes de taparlo.
    const tapadosArriba = new Set(vinculosEnTramo(salida, destino, a, b));
    const tocados = [...tapadosArriba];
    const mapa = {};

    // 3. Donde va cada pareja. Se decide ANTES de tapar el destino, porque
    //    despues los tapados ya no existen para compararlos.
    const planes = otros.map((o) => {
      const propios = elementosDePista(salida, o.pistaId)
        .filter((x) => x.tipo === 'clip' && x.inicio < b - EPS && x.fin > a + EPS);
      const espejo = propios.every((x) => x.vinculo && tapadosArriba.has(x.vinculo));
      return { o, espejo };
    });

    salida = sobrescribirEn(salida, destino, a, derivar(elementoCrudo(m, pistaId, elId), {}), mapa);

    planes.forEach(({ o, espejo }) => {
      const tipo = pistaPorId(salida, o.pistaId).tipo;
      let hacia = o.pistaId;
      if (!espejo) {
        hacia = pistaLibreEn(salida, tipo, a, b);
        if (!hacia) {
          [salida, hacia] = agregarPista(salida, tipo);
          informe.pistasNuevas.push(hacia);
        }
      }
      tocados.push(...vinculosEnTramo(salida, hacia, a, b));
      salida = sobrescribirEn(salida, hacia, a, derivar(elementoCrudo(m, o.pistaId, o.el.id), {}), mapa);
      informe.parejas.push({ desde: o.pistaId, hacia });
    });

    // 4. Los vinculos que la operacion toco y ya no describen imagen y
    //    sonido del mismo tramo se sueltan. El del clip movido tambien se
    //    revisa: si alguna pareja no pudo aterrizar, no queda mintiendo.
    const [reparado, desvinculados] = repararVinculos(salida,
      tocados.concat(Object.values(mapa), agarrado.vinculo ? [agarrado.vinculo] : []));
    informe.desvinculados = desvinculados;
    return [reparado, informe];
  }

  function moverElemento(m, pistaId, elId, tLinea, pistaDestino) {
    return moverConInforme(m, pistaId, elId, tLinea, pistaDestino)[0];
  }

  // ----------------------------------------------------------
  // SELECCION MULTIPLE (19/09/2026, tanda G, paso 9)
  // ----------------------------------------------------------
  // Mover tres clips de a uno eran tres arrastres y tres pasos de deshacer,
  // y el segundo podia tapar al tercero antes de que se moviera (hallazgos
  // 9 y 16). moverGrupo es UNA operacion: primero SACA a todos (y a sus
  // parejas) y despues TAPA con todos, igual que moverConInforme hace con
  // el clip y su pareja. Asi ningun miembro del grupo se come a otro.
  //
  // El grupo se corre en el TIEMPO y cada clip se queda en su pista: mover
  // un grupo de pistas distintas a "otra pista" no tiene un significado
  // unico (decision G2 en DECISIONES.md). Si el corrimiento dejaria a alguno
  // antes del 0, se frena en el 0 el grupo entero, para no deformarlo.
  // refs: [{ pistaId, elId }]. Devuelve [montaje, informe]:
  //   informe.movidos       cuantos clips se movieron (parejas incluidas)
  //   informe.delta         el corrimiento aplicado (ya en cuadros)
  //   informe.desvinculados clips que quedaron separados de su pareja
  function miembrosDeGrupo(m, refs) {
    const vistos = new Set();
    const out = [];
    const sumar = (pistaId, el) => {
      const k = pistaId + '|' + el.id;
      if (vistos.has(k) || el.tipo !== 'clip') return;
      vistos.add(k);
      out.push({ pistaId, el });
    };
    (refs || []).forEach((r) => {
      const el = elementosDePista(m, r.pistaId).find((x) => x.id === r.elId);
      if (!el || el.tipo !== 'clip') return;
      sumar(r.pistaId, el);
      // clipsVinculados da el elemento GUARDADO (sin inicio): se busca con
      // su posicion en la linea.
      if (el.vinculo) clipsVinculados(m, el.vinculo).forEach((o) => {
        const conPos = elementosDePista(m, o.pistaId).find((x) => x.id === o.el.id);
        if (conPos) sumar(o.pistaId, conPos);
      });
    });
    return out;
  }

  function moverGrupoConInforme(m, refs, delta) {
    const informe = { movidos: 0, delta: 0, desvinculados: 0 };
    const miembros = miembrosDeGrupo(m, refs);
    if (!miembros.length || !Number.isFinite(delta)) return [m, informe];
    const minInicio = Math.min(...miembros.map((o) => o.el.inicio));
    // El corrimiento se lleva a cuadros UNA vez: todos se corren lo mismo y
    // el grupo no se deforma por redondear cada inicio por separado.
    const d = aCuadro(m, Math.max(delta, -minInicio));
    if (Math.abs(d) <= EPS) return [m, informe];

    const crudos = miembros.map((o) => ({ ...o, crudo: elementoCrudo(m, o.pistaId, o.el.id) }));
    let salida = m;
    // 1. Sacar a todos antes de tapar nada.
    crudos.forEach((o) => {
      salida = conElementos(salida, o.pistaId, (l) =>
        l.map((x) => (x.id === o.el.id ? hueco(duracionDe(x)) : x)));
    });
    // 2. Tapar con todos. Los miembros no se pisan entre si: estaban sin
    //    solaparse en su pista y se corren todos lo mismo.
    const tocados = [];
    const mapa = {};
    crudos.forEach((o) => {
      const a = Math.max(0, o.el.inicio + d);
      tocados.push(...vinculosEnTramo(salida, o.pistaId, a, a + o.el.duracion));
      salida = sobrescribirEn(salida, o.pistaId, a, derivar(o.crudo, {}), mapa);
      if (o.el.vinculo) tocados.push(o.el.vinculo);
    });
    const [reparado, desvinculados] = repararVinculos(salida, tocados.concat(Object.values(mapa)));
    informe.movidos = miembros.length;
    informe.delta = d;
    informe.desvinculados = desvinculados;
    return [reparado, informe];
  }

  function moverGrupo(m, refs, delta) {
    return moverGrupoConInforme(m, refs, delta)[0];
  }

  // Supr con varios elegidos: cada uno deja su vacio, en un solo paso.
  function borrarGrupo(m, refs) {
    return (refs || []).reduce((acc, r) => borrar(acc, r.pistaId, r.elId), m);
  }

  // ----------------------------------------------------------
  // RIPPLE MULTIPISTA (13/09/2026, tanda E, paso 7 de la hoja de ruta)
  // ----------------------------------------------------------
  // ANTES cada operacion que corre lo de atras (borrar con ripple, ripple,
  // cerrar un vacio, insertar) movia solo la pista del clip y su pareja.
  // Sacar una frase de la entrevista dejaba cada encuadre 9:16 posterior
  // sobre otra frase, y el B-roll y los rotulos fuera de lugar (hallazgos
  // 1 y 33 del INFORME). Es lo que en GES se llama GES_EDIT_MODE_RIPPLE:
  // corre "any toplevel element in the same timeline (including different
  // layers)" (D:\gstreamer-docs\ges\ges-enums.md:441-457).
  //
  // AHORA las cuatro pasan por la misma primitiva: se saca un tramo [a,b)
  // o se abre un lugar en t en TODAS las pistas no bloqueadas. Las reglas
  // (decisiones E1-E4 en DECISIONES.md):
  //   1. Un ENCUADRE (clip de ajuste) que cruza el tramo se ACORTA (o se
  //      estira al abrir); si esta entero adentro del tramo, se va con el.
  //      NO frena la operacion: un encuadre existe justamente para abarcar
  //      varios clips, y rechazar borraria el caso normal del 9:16 (la
  //      correccion del critico a las dos propuestas).
  //   2. MATERIAL de otra pista (B-roll, musica, otro audio) en el tramo, o
  //      cruzando el punto donde se abre: frena. Borrar con ripple e
  //      insertar no hacen nada; ripple y cerrar un vacio llegan hasta
  //      donde puedan todas (delta minimo comun, la regla de deltaComun).
  //      El informe nombra la pista, para que la interfaz lo diga.
  //   3. `pista.bloqueada` (el candado): esa pista no se corre. Campo
  //      OPCIONAL, sin subir VERSION; ninguna pista nace bloqueada.
  //   4. Un ripple que nace en V2 o mas arriba sigue las mismas reglas: si
  //      V1 tiene material en el tramo, frena. No hay una regla aparte por
  //      pista de origen.
  //   Ademas: las pistas del clip y su pareja se corren SIEMPRE, aunque
  //   esten bloqueadas (son la unidad que se edita). Y si correr dejaria a
  //   un clip vinculado separado de su pareja (una en una pista que se
  //   corre y la otra en una bloqueada), no se hace nada: el candado es la
  //   promesa de que esa pista no se mueve, y el vinculo la de que imagen y
  //   sonido no se separan; cuando chocan, gana quedarse quieto.

  const pistaBloqueada = (p) => !!(p && p.bloqueada === true);

  // Material propio (imagen o sonido): lo que un ripple no puede partir ni
  // borrar sin que se lo pidan. Un encuadre no lo es.
  const esMaterial = (el) => el.tipo === 'clip' && !esAjuste(el);

  // Cuanto se puede sacar hacia ATRAS desde `b` sin tocar material: 0 si
  // un clip cruza b, hasta el final del ultimo clip antes de b si no.
  function libreAtras(m, pistaId, b) {
    let limite = 0;
    for (const el of elementosDePista(m, pistaId)) {
      if (!esMaterial(el) || el.inicio >= b - EPS) continue;
      if (el.fin > b + EPS) return 0;
      limite = Math.max(limite, el.fin);
    }
    return b - limite;
  }

  // Lo mismo hacia ADELANTE desde `a` (ripple del borde de entrada).
  function libreAdelante(m, pistaId, a) {
    let limite = Infinity;
    for (const el of elementosDePista(m, pistaId)) {
      if (!esMaterial(el) || el.fin <= a + EPS) continue;
      if (el.inicio < a - EPS) return 0;
      limite = Math.min(limite, el.inicio);
    }
    return limite - a;
  }

  const cruzaMaterial = (m, pistaId, t) => elementosDePista(m, pistaId)
    .some((el) => esMaterial(el) && el.inicio < t - EPS && el.fin > t + EPS);

  // La pista (bloqueada) donde quedaria quieta la pareja de un clip que se
  // corre, o null. `desde`: los elementos que arrancan ahi o despues son
  // los que se corren.
  function pistaQueParteUnVinculo(m, corren, desde) {
    const grupos = {};
    m.pistas.forEach((p) => elementosDePista(m, p.id).forEach((el) => {
      if (el.tipo !== 'clip' || !el.vinculo || el.inicio < desde - EPS) return;
      (grupos[el.vinculo] = grupos[el.vinculo] || []).push({ pistaId: p.id, corre: corren.includes(p.id) });
    }));
    for (const lista of Object.values(grupos)) {
      const quieta = lista.find((o) => !o.corre);
      if (quieta && lista.some((o) => o.corre)) return quieta.pistaId;
    }
    return null;
  }

  const bloqueoEn = (m, pistaId, motivo) =>
    ({ pistaId, pistaNombre: (pistaPorId(m, pistaId) || {}).nombre || '', motivo });

  // EL PLAN de un ripple: que pistas se corren y cuanto se puede.
  //   unidad : pistas que la operacion edita ella misma (clip y pareja)
  //   op     : { sacar: [a, b], desde: 'fin' | 'inicio' }  o  { abrir: t }
  //            `desde` dice que punta del tramo queda fija si hay que
  //            achicarlo (cerrar un vacio y el ripple del final: b; el del
  //            inicio: a).
  // Devuelve { corren, otras, permitido, bloqueo }:
  //   corren    todas las pistas que se corren (unidad incluida)
  //   otras     las que tiene que correr quien llama (corren - unidad)
  //   permitido cuanto del tramo se puede sacar (Infinity al abrir, 0 si
  //             no se puede nada)
  //   bloqueo   { pistaId, pistaNombre, motivo: 'material' | 'vinculo' }
  //             si algo freno, del todo o en parte
  function planDeCorrer(m, unidad, op) {
    const corren = m.pistas.filter((p) => unidad.includes(p.id) || !pistaBloqueada(p)).map((p) => p.id);
    const otras = corren.filter((q) => !unidad.includes(q));
    // Se revisan de ARRIBA hacia ABAJO, como se ven: si dos pistas frenan
    // igual, el informe nombra la primera que el usuario ve (V1 antes que A1).
    const revisar = otras.slice().reverse();
    let permitido;
    let bloqueo = null;
    let desde;
    if (op.sacar) {
      const [a, b] = op.sacar;
      permitido = b - a;
      for (const q of revisar) {
        const libre = op.desde === 'inicio' ? libreAdelante(m, q, a) : libreAtras(m, q, b);
        if (libre < permitido - EPS) { permitido = Math.max(0, libre); bloqueo = bloqueoEn(m, q, 'material'); }
      }
      desde = op.desde === 'inicio' ? a + permitido : b;
    } else {
      permitido = Infinity;
      const q = revisar.find((x) => cruzaMaterial(m, x, op.abrir));
      if (q) { permitido = 0; bloqueo = bloqueoEn(m, q, 'material'); }
      desde = op.abrir;
    }
    if (permitido > EPS) {
      const partida = pistaQueParteUnVinculo(m, corren, desde);
      if (partida) { permitido = 0; bloqueo = bloqueoEn(m, partida, 'vinculo'); }
    }
    return { corren, otras, permitido, bloqueo };
  }

  // Saca [a,b) de UNA pista: lo de atras se corre b-a hacia adelante. Los
  // vacios y encuadres que cruzan el tramo pierden la parte de adentro (y
  // desaparecen si estaban enteros adentro). Material no deberia haber:
  // planDeCorrer ya freno la operacion.
  function sacarTramo(m, pistaId, a, b) {
    if (!(b - a > EPS) || a >= duracionPista(m, pistaId) - EPS) return m;
    const pos = elementosDePista(m, pistaId);
    return conElementos(m, pistaId, (lista) => lista.map((el, i) => {
      const p = pos[i];
      const solape = Math.min(p.fin, b) - Math.max(p.inicio, a);
      if (solape <= EPS) return el;
      // En cuadros enteros: los dos numeros ya lo son, aCuadro solo limpia
      // el error de coma flotante de la resta.
      const resto = Math.max(0, aCuadro(m, p.duracion - solape));
      if (el.tipo === 'hueco') return hueco(resto, el.id);
      const salida = derivar(el, { usadoOut: el.usadoIn + resto });
      // Tanda F: un encuadre animado pierde el pedazo de SU eje que cruzaba
      // el tramo, y las claves de despues se corren con lo que queda.
      if (!esAjuste(el) || !clavesDe(el).length) return salida;
      const desde = el.usadoIn + Math.max(0, a - p.inicio);
      return conClaves(salida, sacarDeClaves(clavesDe(el), desde, desde + solape,
        duracionCuadro(m) || MIN_DUR, CAMPOS_RECT));
    }));
  }

  // Abre `largo` segundos en el instante t de UNA pista: lo de atras se
  // corre. Dentro de un vacio o de un encuadre, lo estira; en un borde,
  // mete un vacio. `lado` 'antes' estira tambien al encuadre que TERMINA en
  // t, y 'despues' al que EMPIEZA en t (el que cubre al clip que se alarga).
  function abrirTramo(m, pistaId, t, largo, lado) {
    if (!(largo > EPS) || t >= duracionPista(m, pistaId) - EPS) return m;
    const pos = elementosDePista(m, pistaId);
    // Un encuadre animado se abre en `t` de su eje: las claves de despues se
    // corren con el contenido (tanda F).
    const crecer = (el, p) => {
      if (el.tipo === 'hueco') return hueco(el.duracion + largo, el.id);
      const salida = derivar(el, { usadoOut: el.usadoOut + largo });
      if (!esAjuste(el) || !clavesDe(el).length) return salida;
      const en = el.usadoIn + Math.max(0, Math.min(p.duracion, t - p.inicio));
      return conClaves(salida, abrirEnClaves(clavesDe(el), en, largo, CAMPOS_RECT));
    };
    let hecho = false;
    return conElementos(m, pistaId, (lista) => {
      const salida = [];
      lista.forEach((el, i) => {
        const p = pos[i];
        if (!hecho) {
          const adentro = p.inicio < t - EPS && p.fin > t + EPS;
          const terminaAca = lado === 'antes' && esAjuste(el) && Math.abs(p.fin - t) <= EPS;
          const empiezaAca = Math.abs(p.inicio - t) <= EPS;
          if (adentro || terminaAca) { salida.push(crecer(el, p)); hecho = true; return; }
          if (empiezaAca || p.inicio > t) {
            hecho = true;
            if (empiezaAca && lado === 'despues' && esAjuste(el)) { salida.push(crecer(el, p)); return; }
            salida.push(hueco(largo));
          }
        }
        salida.push(el);
      });
      return salida;
    });
  }

  // Cierra un hueco: todo lo de atras se corre hacia adelante.
  //
  // HISTORIA: hasta la tanda B sacaba el hueco de UNA lista y desincronizaba
  // la imagen de su sonido (146 de 400 corridas de la prueba aleatoria). La
  // tanda B lo hizo correr las pistas atadas por vinculo (decision B2). La
  // tanda E lo pasa al ripple multipista: se corren TODAS las pistas no
  // bloqueadas, y se cierra lo que puedan todas (un clip de otra pista en
  // ese tramo lo frena ahi; si cruza el final del vacio, no se cierra nada).
  // Un encuadre sobre el vacio se acorta, no frena.
  // Devuelve [montaje, informe].
  function cerrarHuecoConInforme(m, pistaId, elId) {
    const el = elementosDePista(m, pistaId).find((x) => x.id === elId);
    if (!el || el.tipo !== 'hueco') return [m, {}];
    const b = el.fin;
    const plan = planDeCorrer(m, [pistaId], { sacar: [el.inicio, b], desde: 'fin' });
    if (!(plan.permitido > EPS)) return [m, { bloqueo: plan.bloqueo }];
    const salida = plan.corren.reduce((acc, q) => sacarTramo(acc, q, b - plan.permitido, b), m);
    const informe = { corridas: plan.otras, cerrado: plan.permitido };
    if (plan.bloqueo) informe.bloqueo = plan.bloqueo;
    return [salida, informe];
  }

  function cerrarHueco(m, pistaId, elId) {
    return cerrarHuecoConInforme(m, pistaId, elId)[0];
  }

  // ¿Que encuadres pasaron a recortar OTRO material? (13/09/2026, tanda E)
  // No es una invariante de un montaje solo sino de una operacion: compara
  // el antes y el despues. Sirve para las que tienen que dejar cada encuadre
  // sobre su frase (ripple, borrar con ripple, cerrar un vacio, insertar).
  // Para cada encuadre que sigue existiendo (mismo id) mira, en su primer
  // cuadro, en el del medio y en el ultimo, que material se ve DEBAJO; ese
  // mismo cuadro de ese material tenia que verse debajo del mismo encuadre
  // antes. Si ese cuadro de la fuente no estaba en la linea, o es la parte
  // nueva de un clip que se alargo, no cuenta; tampoco los clips recien
  // puestos (`opciones.ignorarClips`, lo que inserto insertarEn). Quedan
  // afuera los encuadres que tienen una pista bloqueada abajo (o estan en
  // una): no correrse es lo que se le pidio a esa pista, y un encuadre que
  // se corre sobre ella cambia de material a proposito.
  function encuadresQueCambiaronDeMaterial(antes, despues, opciones) {
    const fallas = [];
    const ignorar = new Set((opciones && opciones.ignorarClips) || []);
    // Los encuadres sin ninguna pista visual bloqueada debajo.
    const encuadres = (m) => {
      const r = {};
      let trabadaDebajo = false;
      m.pistas.forEach((p) => {
        if (!esVisual(p)) return;
        if (pistaBloqueada(p)) { trabadaDebajo = true; return; }
        if (trabadaDebajo) return;
        elementosDePista(m, p.id).forEach((el) => { if (esAjuste(el)) r[el.id] = el; });
      });
      return r;
    };
    const debajo = (m, t, encuadreId) => {
      const capas = composicionEn(m, t);
      const i = capas.findIndex((c) => c.clase === 'ajuste' && c.clipId === encuadreId);
      for (let j = i - 1; j >= 0; j--) if (capas[j].clase === 'media') return capas[j];
      return null;
    };
    const previos = encuadres(antes);
    const actuales = encuadres(despues);
    const medio = (duracionCuadro(despues) || MIN_DUR) / 2;
    Object.keys(actuales).forEach((id) => {
      const viejo = previos[id];
      if (!viejo) return;
      const e = actuales[id];
      if (!(e.duracion > 2 * medio)) return;
      [e.inicio + medio, (e.inicio + e.fin) / 2, e.fin - medio].forEach((t) => {
        const capa = debajo(despues, t, id);
        if (!capa || ignorar.has(capa.clipId)) return;
        // Un clip que se alargo (ripple) muestra material que antes no usaba:
        // es nuevo, no "otro".
        let propio = null;
        antes.pistas.forEach((p) => { const x = elementoCrudo(antes, p.id, capa.clipId); if (x) propio = x; });
        if (propio && (capa.tFuente < propio.usadoIn - EPS || capa.tFuente >= propio.usadoOut - EPS)) return;
        let enLaLinea = false;
        let bajoElMismo = false;
        antes.pistas.forEach((p) => {
          if (!esVisual(p)) return;
          elementosDePista(antes, p.id).forEach((c) => {
            if (c.tipo !== 'clip' || c.mediaId !== capa.mediaId) return;
            if (capa.tFuente < c.usadoIn - EPS || capa.tFuente >= c.usadoOut - EPS) return;
            enLaLinea = true;
            const pos = c.inicio + (capa.tFuente - c.usadoIn);
            if (pos < viejo.inicio - EPS || pos >= viejo.fin - EPS) return;
            const eraEse = debajo(antes, pos, id);
            if (eraEse && eraEse.clipId === c.id) bajoElMismo = true;
          });
        });
        if (enLaLinea && !bajoElMismo) {
          fallas.push({ tipo: 'encuadreCambioDeMaterial', elId: id,
            detalle: `encuadre ${id} en ${t}: ahora recorta ${capa.mediaId}@${capa.tFuente}, que antes no tenia debajo` });
        }
      });
    });
    return fallas;
  }

  // Une dos clips contiguos del mismo material (deshace una cuchillada).
  // El par (clip, siguiente) que se uniria en UNA pista, o null.
  function parUnible(m, pistaId, elId) {
    const els = elementosDePista(m, pistaId);
    const i = els.findIndex((x) => x.id === elId);
    if (i < 0 || i >= els.length - 1) return null;
    const a = els[i], b = els[i + 1];
    if (a.tipo !== 'clip' || b.tipo !== 'clip') return null;
    // Dos encuadres pegados NO se unen: no son dos mitades de un material
    // (los dos tienen mediaId null, que es lo que los haria pasar por
    // iguales aca), cada uno tiene su propio recorte, y unirlos se comeria
    // el del segundo sin avisar.
    if (esAjuste(a) || esAjuste(b)) return null;
    if (a.mediaId !== b.mediaId || Math.abs(a.usadoOut - b.usadoIn) > EPS) return null;
    return { i, a, b };
  }

  // CORREGIDO 13/09/2026 (tanda B): antes unia solo en la pista del doble
  // clic. Con la entrevista cortada en 20 y 40, V1 quedaba [0-40] y A1
  // seguia [0-20][20-40]; el pedazo derecho del audio quedaba con un
  // vinculo sin imagen y, al borrar el clip unido, sonaba sobre negro.
  //
  // Ahora se une en TODAS las pistas del vinculo o en ninguna: cada
  // pareja del clip tiene que tener al lado, en su pista, justamente la
  // pareja del siguiente. Si en alguna no se puede (el audio del siguiente
  // se movio, o hay un vacio en el medio), no se une nada: unir solo la
  // imagen es el mismo defecto de antes.
  function unirConSiguiente(m, pistaId, elId) {
    const par = parUnible(m, pistaId, elId);
    if (!par) return m;
    const grupoA = objetivosVinculados(m, pistaId, par.a.id);
    const grupoB = objetivosVinculados(m, pistaId, par.b.id);
    if (!!par.a.vinculo !== !!par.b.vinculo || grupoA.length !== grupoB.length) return m;
    if (new Set(grupoA.map((o) => o.pistaId)).size !== grupoA.length) return m;

    const uniones = [];
    for (const o of grupoA) {
      const pq = parUnible(m, o.pistaId, o.elId);
      if (!pq) return m;
      if (!grupoB.some((x) => x.pistaId === o.pistaId && x.elId === pq.b.id)) return m;
      uniones.push({ pistaId: o.pistaId, i: pq.i, b: pq.b });
    }
    // Cada union toca una pista distinta (el grupo no repite pista si el
    // montaje esta sano), asi que los indices calculados siguen valiendo.
    return uniones.reduce((acc, u) => conElementos(acc, u.pistaId, (l) => {
      const copia = l.slice();
      // Tanda F: si alguno de los dos esta animado, las claves se fusionan
      // (antes quedaba solo la transformacion del izquierdo).
      let unido = derivar(l[u.i], { usadoOut: u.b.usadoOut });
      const claves = fusionarClaves(l[u.i], l[u.i + 1], duracionCuadro(acc) || MIN_DUR);
      if (claves) unido = conClaves(unido, claves);
      copia.splice(u.i, 2, unido);
      return copia;
    }), m);
  }

  // ----------------------------------------------------------
  // RED DE INVARIANTES (13/09/2026, tanda B)
  // ----------------------------------------------------------
  // Los tests de este modulo fijaban CASOS armados a mano, y cada defecto
  // del vinculo estaba justo al lado de un caso probado: cerrar un vacio,
  // unir, mover a otra pista y tapar a medias desincronizaban imagen y
  // sonido con todos los tests en verde. Una prueba aleatoria con este
  // verificador los encontro en menos de un segundo (INFORME de la linea
  // de tiempo, hallazgo 6).
  //
  // Devuelve la LISTA de violaciones, vacia si el montaje esta sano. No
  // tira: sirve para tests y para diagnosticar un proyecto real sin
  // romper nada. Cada violacion lleva un `tipo` estable, que es lo que
  // agrupan los tests de propiedades:
  //   vinculoHuerfano     un vinculo con un solo clip (su pareja se perdio)
  //   vinculoRepetido     dos pedazos con el mismo vinculo en UNA pista:
  //                       se moverian juntos como si fueran imagen y sonido
  //   vinculoDesalineado  la pareja no ocupa el mismo tramo de la linea o
  //                       no mira la misma parte del mismo material
  //   materialFaltante    clip (no encuadre) cuyo material no existe
  //   fueraDeMaterial     clip que usa mas de lo que el archivo tiene
  //   idRepetido          dos elementos con el mismo id (las operaciones
  //                       buscan por id: tocarian el que no es)
  //   estructura          lo que limpiar() tendria que haber evitado:
  //                       duracion cero, huecos seguidos o hueco al final
  //   clipCorto/huecoCorto  menos de un cuadro (minDur: MIN_DUR en un
  //                       montaje sin base de cuadro)
  //   fueraDeCuadro       con base de cuadro, un elemento que no dura un
  //                       numero entero de cuadros (13/09/2026, tanda D)
  //   claveInvalida       claves que no son una lista ordenada de valores
  //                       numericos con una curva conocida (tanda F)
  //   claveFueraDeCuadro  con base de cuadro, una clave que no cae en un
  //                       cuadro de su clip (tFuente - usadoIn no entero)
  //   claveFueraDeMaterial una clave de un clip con material fuera de lo
  //                       que el archivo tiene: nunca se podria ver
  //
  // La tolerancia es EPS y no cero: las posiciones salen de SUMAR
  // duraciones, y dos pistas con los mismos cortes en otro orden dan
  // diferencias de 1e-15 que no son desfase de nada.
  // Las claves de un elemento (tanda F). Ver la lista de tipos abajo.
  // Las claves FUERA de la ventana [usadoIn, usadoOut] no son falla: se
  // conservan a proposito para que recortar y volver a estirar no pierda la
  // animacion (DECISIONES F2). El limite duro es el material.
  function verificarClaves(m, p, el, anotar) {
    if (el.tipo !== 'clip') return;
    const lista = esAjuste(el) ? el.ajuste.claves : (el.transformacion && el.transformacion.claves);
    if (lista === undefined) return;
    if (!Array.isArray(lista)) { anotar('claveInvalida', p.id, el.id, 'claves no es una lista'); return; }
    const campos = camposDe(el);
    const f = fpsDe(m);
    const med = esAjuste(el) ? null : mediaPorId(m, el.mediaId);
    lista.forEach((c, i) => {
      const donde = `clave ${i} de ${el.id}`;
      if (!c || !isFinite(c.tFuente) || campos.some((k) => typeof c[k] !== 'number' || !isFinite(c[k]))) {
        anotar('claveInvalida', p.id, el.id, `${donde}: valores no numericos`);
        return;
      }
      if (c.curva !== undefined && !CURVAS.includes(c.curva)) anotar('claveInvalida', p.id, el.id, `${donde}: curva ${c.curva}`);
      if (c.tramo !== undefined && !(Array.isArray(c.tramo) && c.tramo.length === 2 &&
          c.tramo[0] >= 0 && c.tramo[1] <= 1 && c.tramo[0] < c.tramo[1])) {
        anotar('claveInvalida', p.id, el.id, `${donde}: tramo ${JSON.stringify(c.tramo)}`);
      }
      if (i > 0 && lista[i - 1] && !(c.tFuente > lista[i - 1].tFuente + EPS)) {
        anotar('claveInvalida', p.id, el.id, `${donde}: fuera de orden o repetida en ${c.tFuente}`);
      }
      if (f) {
        const n = (c.tFuente - el.usadoIn) * f.num / f.den;
        if (Math.abs(n - Math.round(n)) > 1e-4) anotar('claveFueraDeCuadro', p.id, el.id, `${donde} en ${c.tFuente} (cuadro ${n})`);
      }
      if (med && (c.tFuente < med.disponibleIn - EPS || c.tFuente > med.disponibleOut + EPS)) {
        anotar('claveFueraDeMaterial', p.id, el.id, `${donde} en ${c.tFuente} de ${med.disponibleIn}-${med.disponibleOut}`);
      }
    });
  }

  function verificarMontaje(m) {
    const fallas = [];
    const anotar = (tipo, pistaId, elId, detalle) => fallas.push({ tipo, pistaId, elId, detalle });
    const grupos = {};
    const ids = new Set();
    // Con base de cuadro, toda duracion es un numero ENTERO de cuadros (y
    // entonces toda frontera cae en cuadro, porque la posicion es la suma).
    // La tolerancia va en cuadros: sumar miles de duraciones da errores de
    // 1e-12, no de milesimas de cuadro.
    const f = fpsDe(m);
    const fueraDeCuadro = (d) => {
      if (!f) return false;
      const c = d * f.num / f.den;
      return Math.abs(c - Math.round(c)) > 1e-4;
    };

    (m.pistas || []).forEach((p) => {
      const els = elementosDePista(m, p.id);
      els.forEach((el, i) => {
        if (ids.has(el.id)) anotar('idRepetido', p.id, el.id, `id ${el.id} repetido`);
        ids.add(el.id);
        if (!(el.duracion > EPS)) {
          anotar('estructura', p.id, el.id, `duracion ${el.duracion}`);
          return;
        }
        if (el.tipo === 'hueco') {
          if (i === els.length - 1) anotar('estructura', p.id, el.id, 'hueco al final de la pista');
          if (i > 0 && els[i - 1].tipo === 'hueco') anotar('estructura', p.id, el.id, 'dos huecos seguidos');
          if (el.duracion < minDur(m) - EPS) anotar('huecoCorto', p.id, el.id, `hueco de ${el.duracion}s en ${el.inicio}`);
          if (fueraDeCuadro(el.duracion)) anotar('fueraDeCuadro', p.id, el.id, `hueco de ${el.duracion}s en ${el.inicio}`);
          return;
        }
        if (el.duracion < minDur(m) - EPS) anotar('clipCorto', p.id, el.id, `clip de ${el.duracion}s en ${el.inicio}`);
        if (fueraDeCuadro(el.duracion)) anotar('fueraDeCuadro', p.id, el.id, `clip de ${el.duracion}s en ${el.inicio}`);
        if (!esAjuste(el)) {
          const med = mediaPorId(m, el.mediaId);
          if (!med) anotar('materialFaltante', p.id, el.id, `material ${el.mediaId}`);
          else if (el.usadoIn < med.disponibleIn - EPS || el.usadoOut > med.disponibleOut + EPS) {
            anotar('fueraDeMaterial', p.id, el.id,
              `usa ${el.usadoIn}-${el.usadoOut} de ${med.disponibleIn}-${med.disponibleOut}`);
          }
        }
        if (el.vinculo) (grupos[el.vinculo] = grupos[el.vinculo] || []).push({ pistaId: p.id, el });
        verificarClaves(m, p, el, anotar);
      });
    });

    Object.keys(grupos).forEach((k) => {
      const lista = grupos[k];
      const [base] = lista;
      if (lista.length < 2) {
        anotar('vinculoHuerfano', base.pistaId, base.el.id, `vinculo ${k} sin pareja`);
        return;
      }
      if (new Set(lista.map((o) => o.pistaId)).size < lista.length) {
        anotar('vinculoRepetido', base.pistaId, base.el.id, `vinculo ${k} con dos pedazos en la misma pista`);
      }
      lista.slice(1).forEach((o) => {
        const a = base.el, b = o.el;
        if (a.mediaId !== b.mediaId || Math.abs(a.inicio - b.inicio) > EPS ||
            Math.abs(a.usadoIn - b.usadoIn) > EPS || Math.abs(a.usadoOut - b.usadoOut) > EPS) {
          anotar('vinculoDesalineado', o.pistaId, b.id,
            `vinculo ${k}: ${a.inicio}+[${a.usadoIn}-${a.usadoOut}] contra ${b.inicio}+[${b.usadoIn}-${b.usadoOut}]`);
        }
      });
    });
    return fallas;
  }

  // ----------------------------------------------------------
  // LLEVAR UN MONTAJE A LA GRILLA DE CUADROS (13/09/2026, tanda D)
  // ----------------------------------------------------------
  // La MIGRACION de los proyectos guardados sin base de cuadro, y lo que
  // corre al cambiar el fps. Es explicita y no un cambio de VERSION: subir
  // la version haria que montajeUtilizable descartara la edicion entera.
  //
  // COMO: en cada pista se redondea al cuadro mas cercano cada FRONTERA
  // (inicio y fin de cada elemento, medidos como estaban) y cada elemento
  // pasa a durar la distancia entre sus dos fronteras redondeadas. Se
  // redondean las fronteras y no las duraciones porque asi el error no se
  // acumula: con 200 cortes, redondear duraciones podia correr el final
  // varios cuadros; asi, cada corte se mueve como mucho medio cuadro.
  //
  // El clip conserva su usadoIn y cambia usadoOut. Imagen y sonido de una
  // pareja tienen las mismas fronteras y el mismo usadoIn, asi que salen
  // identicos: la migracion no puede desincronizarlos.
  //
  // Si redondear para arriba haria usar material que el archivo no tiene,
  // el clip pierde ese cuadro y queda un vacio de un cuadro detras, para
  // que lo que sigue no se corra. Un elemento que queda en 0 cuadros
  // (media vez un resto de milisegundos) desaparece: un clip de 10 ms no
  // se ve en ningun cuadro, asi que no se pierde nada que se viera.
  function alinearACuadro(m) {
    const f = fpsDe(m);
    if (!f) return m;
    const k = (t) => Math.floor(t * f.num / f.den + 0.5 + 1e-6);
    const seg = (n) => n * f.den / f.num;
    let cambio = false;
    const pistas = m.pistas.map((p) => {
      const nuevos = [];
      let cursor = 0;
      p.elementos.forEach((el) => {
        const d = duracionDe(el);
        const a = k(cursor);
        const b = k(cursor + d);
        cursor += d;
        const n = b - a;
        if (el.tipo === 'hueco') {
          if (n > 0) nuevos.push(Math.abs(seg(n) - d) > 0 ? hueco(seg(n), el.id) : el);
          if (n <= 0 || Math.abs(seg(n) - d) > 0) cambio = true;
          return;
        }
        const med = esAjuste(el) ? null : mediaPorId(m, el.mediaId);
        let usar = n;
        // Los cuadros que el material alcanza a dar desde usadoIn.
        if (med) usar = Math.min(n, Math.floor((med.disponibleOut - el.usadoIn) * f.num / f.den + 1e-6));
        if (usar <= 0) {
          if (n > 0) nuevos.push(hueco(seg(n)));
          cambio = true;
          return;
        }
        const usadoOut = el.usadoIn + seg(usar);
        if (Math.abs(usadoOut - el.usadoOut) > 0) cambio = true;
        const ajustado = Math.abs(usadoOut - el.usadoOut) > 0 ? derivar(el, { usadoOut }) : el;
        // Tanda F: las claves tambien a la grilla (cambiar de 60 a 30 fps
        // deja la mitad entre dos cuadros).
        const conGrilla = alinearClaves({ ...m, fps: f }, ajustado);
        if (conGrilla !== ajustado) cambio = true;
        nuevos.push(conGrilla);
        if (usar < n) nuevos.push(hueco(seg(n - usar)));
      });
      const limpios = limpiar(nuevos);
      if (limpios.length !== p.elementos.length) cambio = true;
      return { ...p, elementos: limpios };
    });
    if (!cambio) return m;
    // Un clip que desaparecio puede dejar a su pareja sola si la pareja,
    // por un redondeo distinto, sobrevivio (solo pasa si ya estaban
    // desalineadas antes). Mejor suelta que mintiendo.
    const salida = { ...m, pistas };
    const vinculos = [];
    pistas.forEach((p) => p.elementos.forEach((el) => { if (el.vinculo) vinculos.push(el.vinculo); }));
    return repararHuerfanos(salida, vinculos);
  }

  // Saca el vinculo a los clips que quedaron sin pareja. A diferencia de
  // repararVinculos no toca parejas desalineadas que ya venian asi: la
  // migracion no tiene que "arreglar" un proyecto por su cuenta.
  function repararHuerfanos(m, vinculos) {
    let salida = m;
    [...new Set(vinculos)].forEach((v) => {
      const miembros = clipsVinculados(salida, v);
      if (miembros.length !== 1) return;
      const o = miembros[0];
      salida = conElementos(salida, o.pistaId, (l) => l.map((x) =>
        (x.id === o.el.id ? derivar(x, { vinculo: undefined }) : x)));
    });
    return salida;
  }

  // Cambia (o pone) el fps del montaje y lleva todo a la nueva grilla.
  // Devuelve el mismo objeto si no cambia nada, para no dejar un paso de
  // deshacer vacio.
  function fijarFps(m, fps) {
    const f = fpsComoFraccion(fps);
    if (!f) return m;
    const actual = fpsDe(m);
    if (actual && actual.num === f.num && actual.den === f.den) return m;
    return alinearACuadro({ ...m, fps: f });
  }

  // ----------------------------------------------------------
  // IMANTADO
  // ----------------------------------------------------------
  // Los editores pegan los bordes a puntos "importantes": bordes de otros
  // clips, el cabezal y los marcadores. La tolerancia va en SEGUNDOS y la
  // calcula el llamador desde el zoom - asi el iman se siente igual de
  // fuerte con la linea de tiempo chica o agrandada, que es la parte que
  // se suele hacer mal.
  function puntosDeImantado(m, extra) {
    const puntos = new Set([0]);
    m.pistas.forEach((p) => elementosDePista(m, p.id).forEach((el) => {
      puntos.add(el.inicio);
      puntos.add(el.fin);
    }));
    (extra || []).forEach((t) => { if (typeof t === 'number') puntos.add(t); });
    return [...puntos].sort((a, b) => a - b);
  }

  function imantar(t, puntos, tolerancia) {
    let mejor = t, dist = tolerancia;
    for (const p of puntos) {
      const d = Math.abs(p - t);
      if (d <= dist) { dist = d; mejor = p; }
    }
    return mejor;
  }

  // ----------------------------------------------------------
  // PUENTE CON LA EXPORTACION
  // ----------------------------------------------------------
  function rangosDeMedia(m, mediaId) {
    const out = [];
    m.pistas.forEach((p) => p.elementos.forEach((el) => {
      if (el.tipo === 'clip' && el.mediaId === mediaId) out.push([el.usadoIn, el.usadoOut]);
    }));
    return out.sort((a, b) => a[0] - b[0]);
  }

  // ----------------------------------------------------------
  // PUENTE TRANSCRIPCION -> MONTAJE (tanda H, paso 11 de la hoja de ruta)
  // ----------------------------------------------------------
  // ANTES marcar un bloque como 'cut' en la transcripcion cambiaba
  // `blocks` y nada mas: la linea seguia entera y el export (que lee el
  // montaje) no iba a cortar nada (hallazgos 35 y 45 del INFORME).
  // Los bloques estan en tiempo de FUENTE (segundos del archivo) y el
  // montaje en tiempo de LINEA. rangosDeMedia hace la mitad inversa; esta
  // es la ida: donde cae en la linea un pedazo del archivo.
  //
  // Un mismo rango puede aparecer en VARIOS clips (la toma repetida, el
  // mismo material en V2) o en NINGUNO (ya se saco a mano). La regla
  // (DECISIONES H1): se corta en cada lugar donde aparezca, y lo que no
  // aparece se cuenta en el informe en vez de fallar.
  //
  // Devuelve un tramo por clip: { pistaId, elId, inicio, fin, fuenteIn,
  // fuenteOut }, ordenados por inicio en la linea. Los encuadres no cuentan
  // (no tienen material).
  // mediaId puede ser un id o una lista: el mismo archivo agregado dos veces
  // como material son dos media con la misma ruta, y los cortes valen para
  // los clips de todos.
  function rangoFuenteALinea(m, mediaId, rango) {
    const ids = [].concat(mediaId);
    const [a, b] = rango || [];
    if (!(b - a > EPS)) return [];
    const out = [];
    m.pistas.forEach((p) => elementosDePista(m, p.id).forEach((el) => {
      if (el.tipo !== 'clip' || esAjuste(el) || !ids.includes(el.mediaId)) return;
      const fIn = Math.max(a, el.usadoIn), fOut = Math.min(b, el.usadoOut);
      if (fOut - fIn <= EPS) return;
      out.push({
        pistaId: p.id, elId: el.id,
        inicio: el.inicio + (fIn - el.usadoIn), fin: el.inicio + (fOut - el.usadoIn),
        fuenteIn: fIn, fuenteOut: fOut
      });
    }));
    return out.sort((x, y) => x.inicio - y.inicio);
  }

  // Rangos ordenados y fusionados (los bloques de silencio se solapan con
  // los de habla: son dos analisis del mismo audio, no una particion).
  function fusionarRangos(rangos) {
    const lista = (rangos || [])
      .filter((r) => Array.isArray(r) && isFinite(r[0]) && isFinite(r[1]) && r[1] - r[0] > EPS)
      .map((r) => [r[0], r[1]]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of lista) {
      const u = out[out.length - 1];
      if (u && r[0] <= u[1] + EPS) u[1] = Math.max(u[1], r[1]);
      else out.push(r);
    }
    return out;
  }

  // Aplica los cortes de la transcripcion: cada rango de fuente se saca de
  // la linea con el RIPPLE MULTIPISTA de la tanda E (encuadres que se
  // acortan, candados que se respetan, material de otra pista que frena).
  // Es UNA operacion pura: quien la llama la registra como un solo paso de
  // historial, y el informe es el resumen que la interfaz muestra (192
  // cortes sueltos ya resultaron ilegibles, CTX 7.11).
  //
  // Por que asi:
  //  - Se procesa de ATRAS hacia ADELANTE en la linea: sacar un tramo solo
  //    corre lo de atras, asi las posiciones de los tramos de adelante,
  //    calculadas al principio, siguen valiendo.
  //  - Los bordes van a CUADRO (aCuadro) antes de cortar: con base de
  //    cuadro un corte fuera de la grilla deja restos de milisegundos
  //    (hallazgo 4). Lo que queda mas corto que un cuadro se omite.
  //  - El VINCULO: el tramo se corta con cortarEn, que parte tambien a la
  //    pareja con un vinculo compartido, y el pedazo se saca de todas las
  //    pistas de la unidad (el clip, su pareja, y otro clip del mismo
  //    material en el mismo tramo). Imagen y sonido nunca quedan corridos.
  //  - Si otra pista frena (material en ese tramo), ESE tramo no se toca y
  //    se sigue con el resto: todo o nada por tramo, igual que borrar con
  //    ripple. El informe dice cuales y que pista.
  //
  // Devuelve [montaje, informe] con informe = { pedidos, aplicados,
  // segundos, sinLugar, varios, cortos, frenados: [{inicio, fin, bloqueo}] }.
  function aplicarCortesDeFuente(m, mediaId, rangos) {
    const pedidos = fusionarRangos(rangos);
    const informe = { pedidos: pedidos.length, aplicados: 0, segundos: 0, sinLugar: 0, varios: 0, cortos: 0, frenados: [] };
    // Tramos de linea, agrupados: la imagen y su sonido dan el mismo tramo
    // y son UNA unidad.
    const tramos = [];
    for (const r of pedidos) {
      const lugares = rangoFuenteALinea(m, mediaId, r);
      if (!lugares.length) { informe.sinLugar++; continue; }
      const antes = tramos.length;
      for (const l of lugares) {
        const a = aCuadro(m, l.inicio), b = aCuadro(m, l.fin);
        if (b - a < minDur(m) - EPS) { informe.cortos++; continue; }
        const igual = tramos.find((t) => Math.abs(t.a - a) <= EPS && Math.abs(t.b - b) <= EPS);
        if (igual) { if (!igual.pistas.includes(l.pistaId)) igual.pistas.push(l.pistaId); continue; }
        tramos.push({ a, b, pistas: [l.pistaId] });
      }
      if (tramos.length - antes > 1) informe.varios++;
    }
    tramos.sort((x, y) => y.a - x.a);

    let salida = m;
    for (const t of tramos) {
      let paso = salida;
      // Cortar en los dos bordes, en cada pista del tramo (cortarEn arrastra
      // a la pareja). Si el borde ya coincide con uno del clip no hace nada.
      for (const pid of t.pistas) {
        paso = cortarEn(paso, pid, t.a);
        paso = cortarEn(paso, pid, t.b);
      }
      // La unidad: las pistas del tramo y las de sus parejas vinculadas.
      const unidad = new Set(t.pistas);
      for (const pid of t.pistas) {
        const el = elementosDePista(paso, pid).find((x) => x.inicio >= t.a - EPS && x.fin <= t.b + EPS && x.tipo === 'clip');
        if (el && el.vinculo) clipsVinculados(paso, el.vinculo).forEach((o) => unidad.add(o.pistaId));
      }
      const ids = [...unidad];
      const plan = planDeCorrer(paso, ids, { sacar: [t.a, t.b] });
      if (plan.bloqueo) {
        informe.frenados.push({ inicio: t.a, fin: t.b, bloqueo: plan.bloqueo });
        continue;   // `salida` queda como estaba: ni siquiera los cortes
      }
      for (const pid of ids) {
        const pos = elementosDePista(paso, pid);
        paso = conElementos(paso, pid, (els) =>
          els.filter((_, i) => !(pos[i].inicio >= t.a - EPS && pos[i].fin <= t.b + EPS)));
      }
      plan.otras.forEach((q) => { paso = sacarTramo(paso, q, t.a, t.b); });
      salida = paso;
      informe.aplicados++;
      informe.segundos += t.b - t.a;
    }
    return [salida, informe];
  }

  // ----------------------------------------------------------
  // DESHACER / REHACER
  // ----------------------------------------------------------
  function crearHistorial(inicial, limite = 100) {
    return { pasado: [], presente: inicial, futuro: [], limite };
  }
  function registrar(h, nuevo) {
    if (nuevo === h.presente) return h;
    const pasado = h.pasado.concat([h.presente]);
    if (pasado.length > h.limite) pasado.shift();
    return { ...h, pasado, presente: nuevo, futuro: [] };
  }
  function deshacer(h) {
    if (!h.pasado.length) return h;
    const pasado = h.pasado.slice();
    const ant = pasado.pop();
    return { ...h, pasado, presente: ant, futuro: [h.presente].concat(h.futuro) };
  }
  function rehacer(h) {
    if (!h.futuro.length) return h;
    const futuro = h.futuro.slice();
    const sig = futuro.shift();
    return { ...h, pasado: h.pasado.concat([h.presente]), presente: sig, futuro };
  }
  const puedeDeshacer = (h) => h.pasado.length > 0;
  const puedeRehacer = (h) => h.futuro.length > 0;

  return {
    VERSION, MIN_DUR, TRANSFORMACION_BASE, RECT_BASE, MIN_PCT,
    FPS_POR_DEFECTO, fpsDe, fpsComoFraccion, duracionCuadro, aCuadro, pisoCuadro, minDur,
    alinearACuadro, fijarFps,
    GANANCIA_MAX, pistaSilenciada, gananciaDe, volumenDe, ajustarVolumen, capasDeAudioEn,
    crearMontaje, clip, hueco, duracionDe, transformacionDe, transformar,
    CURVAS, clavesDe, valorAnimadoEn, transformacionEn, ponerClave, quitarClave, curvaDeClave,
    clavesEnLinea, claveEn, interpolarClaves,
    encuadre, esAjuste, acotarRect, colocarEncuadre, ajustarEncuadre,
    encuadresEn, migrarRecuadros, podarPistas, derivar, elementoCrudo,
    agregarMedia, mediaPorId, quitarMedia,
    agregarPista, pistaPorId, actualizarPista, moverPista, ordenarPistas, esVisual,
    PISTA_NUEVA, moverAPistaNueva,
    tramoLibre, pistaLibreEn, colocarMedia,
    nuevoVinculo, clipsVinculados, vinculoDe,
    elementosDePista, duracionPista, duracionMontaje, elementoEn, indiceEn,
    composicionEn, capaVisibleEn, capaDeAudioEn, proximoMaterialDesde,
    agregarAlFinal, insertarEn, sobrescribirEn, espejarEnAudio, cortarEn, cortarTodasEn,
    borrar, borrarConRipple, borrarConRippleConInforme, cerrarHueco, cerrarHuecoConInforme,
    unirConSiguiente, moverElemento, moverConInforme,
    moverGrupo, moverGrupoConInforme, borrarGrupo,
    pistaBloqueada, planDeCorrer, encuadresQueCambiaronDeMaterial,
    ripple, rippleConInforme, roll, slip, slide, recortar, recortarConHueco,
    puntosDeImantado, imantar,
    verificarMontaje,
    rangosDeMedia, rangoFuenteALinea, fusionarRangos, aplicarCortesDeFuente,
    crearHistorial, registrar, deshacer, rehacer, puedeDeshacer, puedeRehacer
  };
});
