// ============================================================
// EL LIENZO — LA BASE DONDE SE COMPONE LA IMAGEN (06/08/2026)
// ============================================================
// El visor dejo de ser "un reproductor que muestra el archivo" para ser
// un LIENZO sobre el que se apoyan las capas. El cambio no es cosmetico:
//
//   - Antes solo se veia la pista de MAS ARRIBA. Ahora se dibujan todas,
//     de abajo hacia arriba, que es lo que el modelo venia diciendo desde
//     el principio con composicionEn() y nadie usaba.
//   - Cada material se puede AGRANDAR, ACHICAR Y CORRER sobre esa base,
//     sin tocar el archivo. Es lo que hace falta para poner una foto, un
//     recorte o un video chico encima de otro.
//
// COMO ENTRA UN MATERIAL EN EL LIENZO, en dos pasos separados a proposito:
//
//   1. ENCAJE "contain": el material entra ENTERO, centrado, sin
//      deformarse. Un 16:9 en un lienzo 16:9 lo llena justo; un vertical
//      deja franjas a los costados. Esto es lo que se ve con escala 1, y
//      es el punto de partida razonable.
//   2. TRANSFORMACION: sobre ese encaje se aplica la escala y el
//      corrimiento que eligio el user.
//
// Separarlos importa: si la escala se midiera contra el tamaño en pixeles
// del archivo, el mismo proyecto se veria distinto al cambiar de material
// (un 4K y un 1080p con "escala 1" darian tamaños diferentes). Contra el
// encaje, escala 1 significa siempre lo mismo: "entra entero".
//
// LAS FRACCIONES SON DEL LIENZO, no de la pantalla. Por eso el preview a
// 600px de ancho y la exportacion a 1920 dan exactamente la misma imagen.
//
// Modulo PURO: require() en el main y en los tests, <script> en el
// renderer (queda como window.Lienzo).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Lienzo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Un lienzo 16:9 por defecto. La resolucion concreta la decide quien
  // dibuja (el preview usa el tamaño del panel, la exportacion la real).
  const RELACION_BASE = 16 / 9;

  const BASE = { escala: 1, x: 0, y: 0 };

  // Encaje "contain": el rectangulo mas grande con la forma del material
  // que entra entero en el lienzo, centrado.
  function encajar(anchoFuente, altoFuente, anchoLienzo, altoLienzo) {
    const af = anchoFuente > 0 ? anchoFuente : 1;
    const hf = altoFuente > 0 ? altoFuente : 1;
    const escala = Math.min(anchoLienzo / af, altoLienzo / hf);
    const w = af * escala;
    const h = hf * escala;
    return { x: (anchoLienzo - w) / 2, y: (altoLienzo - h) / 2, w, h };
  }

  // Donde se dibuja una capa: el encaje, agrandado o achicado por la
  // escala y corrido por x/y. El corrimiento se mide en fracciones del
  // LIENZO (no del material) para que mover "un 10% a la derecha"
  // signifique lo mismo con cualquier archivo.
  function rectDeCapa(fuente, transformacion, lienzo) {
    const t = { ...BASE, ...(transformacion || {}) };
    const base = encajar(fuente.ancho, fuente.alto, lienzo.ancho, lienzo.alto);
    const w = base.w * t.escala;
    const h = base.h * t.escala;
    return {
      // Se crece desde el CENTRO, no desde la esquina: al agrandar, la
      // imagen se abre para los dos lados y el encuadre no se corre solo.
      x: base.x + (base.w - w) / 2 + t.x * lienzo.ancho,
      y: base.y + (base.h - h) / 2 + t.y * lienzo.alto,
      w, h
    };
  }

  // La cuenta inversa: de un rectangulo dibujado a la transformacion que
  // lo produce. La usa el arrastre sobre el visor - se mueve un
  // rectangulo en pantalla y hay que guardar que transformacion es.
  // Sin esta funcion habria que repetir la formula al reves en la
  // interfaz, y las dos se irian separando con cada cambio.
  function transformacionDesdeRect(rect, fuente, lienzo) {
    const base = encajar(fuente.ancho, fuente.alto, lienzo.ancho, lienzo.alto);
    const escala = base.w > 0 ? rect.w / base.w : 1;
    const w = base.w * escala;
    const h = base.h * escala;
    return {
      escala,
      x: (rect.x - base.x - (base.w - w) / 2) / lienzo.ancho,
      y: (rect.y - base.y - (base.h - h) / 2) / lienzo.alto
    };
  }

  // Un lienzo con la forma del primer material que tenga medidas, o 16:9
  // si no hay ninguno. Es el tamaño del proyecto: lo que se exporta.
  function lienzoDeMontaje(media, anchoPreferido) {
    const ancho = anchoPreferido || 1920;
    const conMedidas = (media || []).find((x) => x.ancho > 0 && x.alto > 0);
    const relacion = conMedidas ? conMedidas.ancho / conMedidas.alto : RELACION_BASE;
    return { ancho, alto: Math.round(ancho / relacion) };
  }

  return { BASE, RELACION_BASE, encajar, rectDeCapa, transformacionDesdeRect, lienzoDeMontaje };
});
