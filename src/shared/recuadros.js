// ############################################################
// ## MODULO MUERTO (07/08/2026) — NADIE LO CARGA             ##
// ############################################################
// Absorbido por `montaje.js`: un encuadre dejo de ser una lista paralela
// y paso a ser un CLIP DE AJUSTE dentro de una pista normal (ver el
// bloque "EL ENCUADRE 9:16 ES UN CLIP DE AJUSTE"). Ya no lo requiere ni
// el main, ni el renderer, ni el index.html.
//
// Se deja EN DISCO y no se borra porque no hay commit desde el 05/08 ni
// copia de este archivo en `E:\Clipforge2`: borrarlo hoy seria borrarlo
// del unico lugar donde existe. Se puede borrar junto con
// `test/recuadros.test.js` en cuanto haya un commit.
//
// Lo que se conservo textual al migrarlo, y por que:
//   - la FORMA del dato (xPct/yPct/wPct/hPct), para que geometria916.js
//     siguiera leyendola sin traducir nada;
//   - acotarRect() y MIN_PCT, que ahora viven en montaje.js.
// Lo que se tiro: `start`/`end`/`track` (ahora los dice el lugar del clip
// en su pista) y normalizar() (la lista secuencial no puede solaparse).
//
// ============================================================
// RECUADROS 16:9 -> 9:16 (06/08/2026)
// ============================================================
// Un RECUADRO es un pedazo del frame original que se quiere mostrar en el
// video vertical. Se dibuja encima del visor 16:9 y aparece en el visor
// 9:16, que es como se arma un short a partir de una grabacion horizontal
// sin perder lo que importa (la cara, el marcador, el chat).
//
//     recuadro = { id, start, end, track, xPct, yPct, wPct, hPct }
//
//   xPct/yPct/wPct/hPct : posicion y tamaño DENTRO DEL FRAME, en 0..1.
//                         Van en porcentaje y no en pixeles a proposito:
//                         el mismo recuadro sirve para el preview (que
//                         dibuja al tamaño de la ventana) y para el
//                         export (que necesita pixeles del archivo real),
//                         sin recalcular nada al cambiar de resolucion.
//   start/end           : cuando esta activo, en tiempo de la LINEA.
//   track               : el orden en el panel vertical (0 = primero).
//
// POR QUE ES UN MODULO APARTE Y NUEVO:
// La version anterior vivia dentro de cropLayoutsBuilder.js, mezclada con
// el arbol de cortes del panel y atada al modelo de timeline de entonces,
// que ya no existe. Lo que se conserva de aquella es la FORMA del dato
// (nombres de campo incluidos), porque geometria916.js sabe leerla tal
// cual y esa matematica no cambio.
//
// Las otras dos piezas del sistema, cada una en su archivo:
//   geometria916.js : que pedazo del frame entra en cada celda ("cover")
//   layout916.js    : donde va cada recuadro dentro del panel 9:16
//
// Modulo PURO: require() en el main y en los tests, <script> en el
// renderer (queda como window.Recuadros). Todo devuelve listas nuevas.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Recuadros = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Un recuadro mas chico que esto no se puede ni agarrar con el mouse.
  const MIN_PCT = 0.02;
  // Duracion minima en la linea, para que no quede uno de 0 segundos que
  // existe en los datos pero no se ve nunca.
  const MIN_DUR = 0.05;

  let contador = 0;
  const nuevoId = () => `r${Date.now().toString(36)}${(contador++).toString(36)}`;

  const acotar = (v, min, max) => Math.max(min, Math.min(max, v));

  // Deja un rectangulo dentro del frame sin deformarlo: primero se acota
  // el tamaño, despues la posicion contra ese tamaño. Al reves, un
  // recuadro pegado al borde derecho se encogeria en vez de correrse.
  function acotarRect(r) {
    const wPct = acotar(r.wPct, MIN_PCT, 1);
    const hPct = acotar(r.hPct, MIN_PCT, 1);
    return {
      xPct: acotar(r.xPct, 0, 1 - wPct),
      yPct: acotar(r.yPct, 0, 1 - hPct),
      wPct, hPct
    };
  }

  const porId = (recuadros, id) => (recuadros || []).find((r) => r.id === id) || null;

  // Activos en un instante, ordenados por pista. El final es EXCLUSIVO:
  // en t = end el recuadro ya no esta (si no, dos recuadros pegados se
  // pisarian un instante en el borde).
  function activosEn(recuadros, t) {
    return (recuadros || [])
      .filter((r) => t >= r.start && t < r.end)
      .sort((a, b) => a.track - b.track);
  }

  // Crea un recuadro. Por defecto dura TODO el video: al dibujar uno se
  // espera verlo en el visor vertical enseguida, no tener que buscar en
  // que segundo quedo. Para acotarlo en el tiempo esta actualizar().
  function crear(recuadros, { xPct, yPct, wPct, hPct, start, end, duracionTotal }) {
    const lista = recuadros || [];
    const dur = duracionTotal > 0 ? duracionTotal : 0;
    const s = Math.max(0, start != null ? start : 0);
    const e = Math.max(s + MIN_DUR, end != null ? end : (dur || s + MIN_DUR));

    // Primera pista libre en ese tramo: dos recuadros que conviven en el
    // tiempo no pueden compartir pista, o no se sabria cual va primero.
    const ocupadas = lista.filter((r) => s < r.end && e > r.start).map((r) => r.track);
    let track = 0;
    while (ocupadas.includes(track)) track++;

    return [...lista, { id: nuevoId(), start: s, end: e, track, ...acotarRect({ xPct, yPct, wPct, hPct }) }];
  }

  // Cambia cualquier subconjunto de campos. Lo usan tanto el arrastre
  // sobre el video (xPct/yPct/wPct/hPct) como el de la linea de tiempo
  // (start/end/track).
  function actualizar(recuadros, id, cambios) {
    return (recuadros || []).map((r) => {
      if (r.id !== id) return r;
      const mezcla = { ...r, ...cambios };
      const rect = acotarRect(mezcla);
      const start = Math.max(0, mezcla.start);
      return { ...mezcla, ...rect, start, end: Math.max(start + MIN_DUR, mezcla.end) };
    });
  }

  const eliminar = (recuadros, id) => (recuadros || []).filter((r) => r.id !== id);

  // Recorta contra la duracion real y renumera las pistas sin huecos.
  // Hace falta porque la duracion se conoce recien cuando ffprobe midio
  // el archivo, y porque borrar el recuadro de la pista 1 dejaba a la 2
  // suelta (se veia un lugar vacio en el panel vertical).
  function normalizar(recuadros, duracionTotal) {
    const dur = duracionTotal > 0 ? duracionTotal : 0;
    const vivos = (recuadros || [])
      .map((r) => {
        const start = acotar(r.start, 0, Math.max(0, dur - MIN_DUR));
        const end = dur > 0 ? acotar(r.end, start + MIN_DUR, dur) : Math.max(r.end, start + MIN_DUR);
        return { ...r, start, end, ...acotarRect(r) };
      })
      .filter((r) => r.end - r.start > MIN_DUR / 2)
      .sort((a, b) => (a.track - b.track) || (a.start - b.start));

    // Renumerar por tramos: dos recuadros que NO se solapan en el tiempo
    // pueden compartir pista sin problema, asi que se les da el numero
    // mas chico que quede libre mientras estan vivos.
    const salida = [];
    for (const r of vivos) {
      const ocupadas = salida.filter((o) => r.start < o.end && r.end > o.start).map((o) => o.track);
      let track = 0;
      while (ocupadas.includes(track)) track++;
      salida.push({ ...r, track });
    }
    return salida;
  }

  return { MIN_PCT, MIN_DUR, porId, activosEn, crear, actualizar, eliminar, normalizar };
});
