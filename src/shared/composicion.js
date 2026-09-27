// ============================================================
// COMPOSICION — EL PLAN DE DIBUJO DE UN INSTANTE (07/08/2026)
// ============================================================
// Dado un montaje y un instante, dice EXACTAMENTE que hay que dibujar y
// donde. No dibuja: devuelve una lista de operaciones. Quien la ejecuta
// puede ser el canvas del visor o el encoder de la exportacion.
//
// POR QUE EXISTE, que es lo unico importante de este archivo:
//
// El problema original de ClipForge (y de casi todo editor casero) es que
// LO QUE SE VE y LO QUE SE EXPORTA se calculan por caminos distintos, y se
// separan sin que nadie se entere hasta abrir el mp4. La version anterior
// lo atacaba con tests que comparaban las dos cuentas (el bloque "ACUERDO
// PREVIEW <-> EXPORT" de geometria916.test.js): servia, pero seguian
// siendo dos cuentas, y el test solo avisaba DESPUES de que divergieran.
//
// Aca no hay dos cuentas. Hay UNA funcion y dos ejecutores. La unica
// diferencia entre preview y export es el TAMAÑO del lienzo que se le
// pasa, y eso esta cubierto por el test de escalado: el mismo plan a
// 640px y a 1920px tiene que describir las mismas fracciones.
//
// LAS DOS ETAPAS, en este orden y no en otro:
//
//   1. planLienzo()   compone el lienzo del proyecto (16:9 normalmente):
//                     cada capa de material se dibuja con su escala y su
//                     posicion, de abajo hacia arriba.
//   2. planVertical() recorta ESE lienzo ya compuesto hacia el panel 9:16,
//                     una celda por encuadre activo.
//
// Que el vertical recorte del lienzo COMPUESTO y no del archivo crudo no
// es un atajo: es lo correcto. Si el user agranda o corre la imagen en el
// 16:9, el encuadre tiene que tomar lo que se ve, no lo que habia en el
// archivo. Antes las dos cosas podian no coincidir.
//
// Modulo PURO: require() en el main y en los tests, <script> en el
// renderer (queda como window.Composicion).

(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./montaje') : root.Montaje,
    typeof require === 'function' ? require('./lienzo') : root.Lienzo,
    typeof require === 'function' ? require('./geometria916') : root.Geometria916,
    typeof require === 'function' ? require('./layout916') : root.Layout916
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Composicion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Montaje, Lienzo, Geometria916, Layout916) {
  'use strict';

  const NEGRO = '#000';

  // Las medidas REALES del material. El preview las saca del <video> ya
  // decodificado y la exportacion del decodificador; si todavia no se
  // saben, se cae a lo que midio ffprobe al importar.
  //
  // Va por parametro y no se lee de ningun lado: es lo unico que el plan
  // no puede deducir del montaje, y dejarlo implicito seria justamente el
  // agujero por donde el preview y el export se separan.
  function medidasDe(capa, fuentes) {
    const f = fuentes && (fuentes[capa.mediaId] || fuentes.get && fuentes.get(capa.mediaId));
    if (f && f.ancho > 0 && f.alto > 0) return { ancho: f.ancho, alto: f.alto };
    const med = capa.media;
    if (med && med.ancho > 0 && med.alto > 0) return { ancho: med.ancho, alto: med.alto };
    return null;
  }

  // ----------------------------------------------------------
  // 1. EL LIENZO DEL PROYECTO
  // ----------------------------------------------------------
  // Devuelve { fondo, ancho, alto, capas: [...] }, cada capa con el
  // rectangulo DESTINO en pixeles del lienzo. La fuente se dibuja entera
  // (el recorte del material, si lo hubiera, es otra cosa): lo que decide
  // el tamaño es la transformacion del clip.
  //
  // `sinMedidas` lista las capas que hay que dibujar pero cuyo material
  // todavia no se pudo medir. No se descartan en silencio: el preview
  // puede esperar al proximo cuadro, pero la exportacion tiene que poder
  // fallar con un motivo en vez de escribir un mp4 con un hueco negro.
  function planLienzo(m, tLinea, lienzo, fuentes) {
    const L = { ancho: Math.max(1, lienzo.ancho), alto: Math.max(1, lienzo.alto) };
    const plan = { fondo: NEGRO, ancho: L.ancho, alto: L.alto, capas: [], ajustes: [], sinMedidas: [] };
    if (!m) return plan;

    for (const capa of Montaje.composicionEn(m, tLinea)) {
      // Un AJUSTE no aporta imagen: recorta la de abajo. En el lienzo
      // base no dibuja nada; su efecto se aplica en la etapa 2.
      if (capa.clase === 'ajuste') {
        plan.ajustes.push({ clipId: capa.clipId, pistaId: capa.pistaId, rect: capa.rect });
        continue;
      }
      const fuente = medidasDe(capa, fuentes);
      if (!fuente) {
        plan.sinMedidas.push({ clipId: capa.clipId, mediaId: capa.mediaId });
        continue;
      }
      plan.capas.push({
        clipId: capa.clipId, pistaId: capa.pistaId,
        mediaId: capa.mediaId, media: capa.media,
        // Donde hay que buscar el cuadro DENTRO del archivo.
        tFuente: capa.tFuente,
        fuente,
        dest: Lienzo.rectDeCapa(fuente, capa.transformacion, L)
      });
    }
    return plan;
  }

  // ----------------------------------------------------------
  // 2. EL PANEL VERTICAL
  // ----------------------------------------------------------
  // Recorta el lienzo YA COMPUESTO hacia la salida 9:16. Una celda por
  // encuadre activo; donde va cada una lo dice el layout.
  //
  // `origen` son las medidas del lienzo compuesto (el canvas de la etapa
  // 1). Se pasa aparte de `salida` porque no tienen por que coincidir:
  // el preview compone a 1280 y muestra a 400, la exportacion compone a
  // 1920 y saca 1080. El recorte se calcula sobre el origen y se dibuja
  // sobre la salida.
  function planVertical(m, tLinea, origen, salida, layout) {
    const O = { ancho: Math.max(1, origen.ancho), alto: Math.max(1, origen.alto) };
    const S = { ancho: Math.max(1, salida.ancho), alto: Math.max(1, salida.alto) };
    const plan = { fondo: NEGRO, ancho: S.ancho, alto: S.alto, celdas: [] };
    if (!m) return plan;

    const activos = Montaje.encuadresEn(m, tLinea);
    if (!activos.length) return plan;

    const celdas = Layout916.celdasParaDibujar(layout, activos.map((x) => x.clipId));
    for (const celda of celdas) {
      const enc = activos.find((x) => x.clipId === celda.clipId);
      if (!enc) continue;
      const dw = celda.w * S.ancho, dh = celda.h * S.alto;
      // Una celda de menos de un pixel no se dibuja: drawImage con 0 tira.
      if (dw < 1 || dh < 1) continue;
      plan.celdas.push({
        clipId: celda.clipId,
        // El recorte "cover" se pide para el tamaño de ESTA celda: una
        // celda ancha y una angosta necesitan pedazos distintos del
        // mismo encuadre.
        src: Geometria916.recorteCoverDeClip(enc.rect, O.ancho, O.alto, dw, dh),
        dest: { x: celda.x * S.ancho, y: celda.y * S.alto, w: dw, h: dh }
      });
    }
    return plan;
  }

  // ----------------------------------------------------------
  // RESOLUCION DE SALIDA
  // ----------------------------------------------------------
  // El submuestreo de croma (yuv420, que es lo que entiende cualquier
  // reproductor) necesita medidas PARES. Un ancho impar no da un video
  // apenas distinto: hace abortar el encode entero.
  //
  // Se redondea HACIA ABAJO para no pedir nunca pixeles que no existen en
  // el material.
  const aPar = (v) => Math.max(2, Math.floor(v / 2) * 2);

  function resolucionSalida(ancho, alto) {
    return { ancho: aPar(ancho), alto: aPar(alto) };
  }

  return { NEGRO, planLienzo, planVertical, aPar, resolucionSalida, medidasDe };
});
