// ============================================================
// GEOMETRIA COMPARTIDA DEL VISOR/EXPORT 9:16
// ============================================================
// POR QUE EXISTE ESTE ARCHIVO (creado 05/08/2026):
// Hasta hoy, la matematica que decide COMO se recorta y se acomoda el
// 16:9 dentro del 9:16 estaba escrita TRES veces, copiada a mano:
//   1. src/main/cropLayoutsBuilder.js  -> version "oficial" del main
//   2. src/renderer/renderer.js        -> copias "...Local", lo que se VE
//                                         en el preview del canvas 9:16
//   3. src/main/exportPlan.js          -> recorteCover(), lo que SE EXPORTA
// Las tres eran identicas al momento de unificarlas (verificado linea por
// linea), pero nada obligaba a que siguieran siendolo: tocar una sola y
// olvidarse de las otras hacia que el preview mostrara una cosa y el mp4
// exportado saliera distinta - un error que no da ningun mensaje de falla
// y que recien se nota despues de esperar un render de varios minutos.
//
// Ahora las tres leen de aca. Si esta matematica cambia, cambia para
// todos a la vez, y el preview no puede desincronizarse del export.
//
// REGLA AL EDITAR: este archivo tiene que seguir siendo PURO - solo
// matematica sobre numeros y objetos planos. Nada de Electron, nada de
// `require` de otros modulos, nada de tocar el DOM ni el filesystem. Esa
// es justamente la condicion que le permite correr en los dos lados
// (proceso principal de Node Y ventana del navegador) sin cambios.
//
// RECORTADO AL RECUPERARLO (06/08/2026): este archivo volvio de la copia
// de E:\Clipforge2 despues de la reconstruccion, pero SIN el "arbol de
// cortes" ni las celdas "libres" que tenia al final. Los reemplaza
// layout916.js (rectangulo explicito por recuadro), y dejarlos habria
// sido repetir el error que ya costo caro una vez: dos caminos para lo
// mismo, con los tests protegiendo el viejo. Lo que queda es el recorte
// "cover" - que no lo reemplazo nada y lo siguen necesitando el visor y
// la exportacion - y quien esta activo en cada instante.
//
// COMO SE CARGA EN CADA LADO:
//   - main / tests: const G = require('../shared/geometria916');
//   - renderer:     <script src="../shared/geometria916.js"> en index.html
//                   (antes de renderer.js), queda como window.Geometria916
// El envoltorio de abajo detecta solo en cual de los dos esta corriendo.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;              // Node (main process, tests)
  } else {
    root.Geometria916 = api;           // navegador (renderer de Electron)
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Tamaño minimo de una celda "libre", como fraccion del panel 9:16.
  // Evita que se pueda achicar una celda a la nada arrastrando de mas.
  const MIN_LIBRE = 0.08;

  // Limites del ratio de un corte del arbol (10%-90%): mismo motivo,
  // que ninguna de las 2 mitades de un corte desaparezca del todo.
  const RATIO_MIN = 0.1;
  const RATIO_MAX = 0.9;

  // ----------------------------------------------------------
  // 1. QUE RECUADROS ESTAN ACTIVOS Y DONDE
  // ----------------------------------------------------------

  // Clips activos en el instante t, ordenados por pista (track 0 primero
  // = arriba en el visor 9:16 y en el overlay del video 16:9).
  function clipsEnInstante(clips, t) {
    return clips
      .filter((c) => t >= c.start && t < c.end)
      .sort((a, b) => a.track - b.track);
  }

  // Segmentos [start, end, cubierto] para la franja roja/verde de la
  // timeline: parte el video en los puntos donde algun clip empieza o
  // termina, y marca si ese tramo tiene al menos un recuadro encima.
  function segmentosCobertura(clips, duracionTotal) {
    if (!clips.length) return [{ start: 0, end: duracionTotal, cubierto: false }];
    const puntos = new Set([0, duracionTotal]);
    clips.forEach((c) => {
      puntos.add(Math.max(0, c.start));
      puntos.add(Math.min(duracionTotal, c.end));
    });
    const ordenados = [...puntos].sort((a, b) => a - b);
    const segmentos = [];
    for (let i = 0; i < ordenados.length - 1; i++) {
      const s = ordenados[i], e = ordenados[i + 1];
      if (e - s <= 0.001) continue;
      const cubierto = clips.some((c) => c.start <= s && c.end >= e);
      segmentos.push({ start: s, end: e, cubierto });
    }
    return segmentos;
  }

  // ----------------------------------------------------------
  // 2. RECORTE "COVER" — el calculo que preview y export COMPARTEN
  // ----------------------------------------------------------
  // Esta es la pieza mas critica del archivo: es la que decide que pedazo
  // exacto del frame original entra en cada celda del 9:16.
  //
  // "cover" = llenar la celda destino completa recortando lo que sobra,
  // sin deformar la imagen (mismo comportamiento que object-fit:cover de
  // CSS, hecho a mano porque hay que aplicarlo tanto al canvas del
  // preview como a los filtros de ffmpeg del export).

  // Rectangulo fuente en PIXELES a partir de un clip guardado en
  // porcentajes (0..1) del frame. El piso de 1px evita un ancho/alto 0
  // si el recuadro quedo degenerado.
  function rectFuenteDeClip(clip, anchoFuente, altoFuente) {
    return {
      sx: clip.xPct * anchoFuente,
      sy: clip.yPct * altoFuente,
      sw: Math.max(1, clip.wPct * anchoFuente),
      sh: Math.max(1, clip.hPct * altoFuente)
    };
  }

  // Aplica "cover" a un rectangulo fuente ya en pixeles: recorta el
  // sobrante del lado que le sobra (ancho o alto) y lo centra.
  // Devuelve floats a proposito - cada lado redondea despues segun lo
  // que necesite (el canvas dibuja con decimales sin problema; ffmpeg
  // exige enteros pares, eso lo resuelve exportPlan.js con aPar()).
  function aplicarCover(sx, sy, sw, sh, destAspect) {
    const srcAspect = sw / sh;
    let x = sx, y = sy, w = sw, h = sh;
    if (srcAspect > destAspect) {
      // La fuente es mas ancha que el destino: sobra a los costados.
      w = sh * destAspect;
      x = sx + (sw - w) / 2;
    } else {
      // La fuente es mas alta que el destino: sobra arriba y abajo.
      h = sw / destAspect;
      y = sy + (sh - h) / 2;
    }
    return { x, y, w, h };
  }

  // Atajo que combina los 2 pasos anteriores: de un clip en porcentajes
  // al rectangulo fuente final ya recortado en "cover", en pixeles float.
  // ESTA es la funcion que llaman tanto dibujarCanvas916() (preview) como
  // recorteCover() (export) - el punto unico donde ambos coinciden.
  function recorteCoverDeClip(clip, anchoFuente, altoFuente, destW, destH) {
    const { sx, sy, sw, sh } = rectFuenteDeClip(clip, anchoFuente, altoFuente);
    return aplicarCover(sx, sy, sw, sh, destW / destH);
  }

  return {
    clipsEnInstante, segmentosCobertura,
    rectFuenteDeClip, aplicarCover, recorteCoverDeClip
  };
});
