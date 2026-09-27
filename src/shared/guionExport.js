// ============================================================
// GUION DE EXPORTACION (08/08/2026)
// ============================================================
// Traduce un montaje a la lista de pedidos que hay que hacerle a los
// decodificadores: para cada clip, QUE instantes de SU archivo hacen
// falta y en que cuadro de salida va cada uno.
//
// POR QUE EXISTE ESTE ARCHIVO Y NO ESTA METIDO EN EL BUCLE DEL EXPORT:
//
// La medicion del 08/08/2026 (ver src/renderer/cuadros.js) mostro que
// pedir cuadros de a uno cuesta 29 veces mas que pedirlos por lote
// ordenado. O sea que el export NO puede ir preguntando "dame el cuadro
// de este instante" mientras dibuja: tiene que saber de ANTEMANO todos
// los instantes que le va a pedir a cada archivo, en orden.
//
// Eso obliga a una pasada previa sobre toda la linea de tiempo. Esa
// pasada es pura aritmetica sobre el montaje — no toca archivos, no
// decodifica nada — asi que vive aca, en shared/, y se puede probar con
// node:test. El bucle que dibuja, que si depende de WebCodecs, queda del
// otro lado y no se puede probar igual.
//
// LA OTRA RAZON, mas importante: la exportacion vuelve a usar
// `Composicion.planLienzo`, el MISMO plan que dibuja el visor. Aca no se
// recalcula donde va cada capa; solo se agrupa lo que el plan ya dijo.
// Si esta cuenta se hiciera aparte, volveriamos al problema que
// composicion.js cerro (que lo que se ve y lo que se exporta se separen).
//
// Modulo PURO: require() en el main y en los tests, <script> en el
// renderer (queda como window.GuionExport).

(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./montaje') : root.Montaje,
    typeof require === 'function' ? require('./composicion') : root.Composicion
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GuionExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Montaje, Composicion) {
  'use strict';

  // Los instantes de salida. Se calcula i/fps y NO se va sumando 1/fps a
  // un acumulador: a 30 fps y 10 minutos, el error de ir sumando se
  // acumula hasta correr el final casi un cuadro entero.
  function instantes(fps, desde, hasta) {
    const f = Math.max(1, fps);
    const ini = Math.max(0, desde || 0);
    const fin = Math.max(ini, hasta);
    const total = Math.max(0, Math.round((fin - ini) * f));
    const salida = new Array(total);
    for (let i = 0; i < total; i++) salida[i] = ini + i / f;
    return salida;
  }

  // Que materiales aparecen en el tramo. Sirve para medirlos ANTES de
  // planificar: `planLienzo` necesita las medidas reales para calcular el
  // encaje, y las medidas solo las sabe el decodificador.
  function mediasUsadas(m, listaInstantes) {
    const vistos = new Set();
    for (const t of listaInstantes) {
      for (const capa of Montaje.composicionEn(m, t)) {
        if (capa.clase === 'media' && capa.mediaId) vistos.add(capa.mediaId);
      }
    }
    return [...vistos];
  }

  // El guion propiamente dicho.
  //
  // Devuelve, por CLIP (no por archivo): los instantes de su fuente y en
  // que indice de cuadro de salida va cada uno. Es por clip porque dos
  // clips del mismo material pueden estar visibles a la vez yendo por
  // partes distintas del archivo — con un solo lector se pelearian por el
  // cabezal, que es exactamente la limitacion del <video> que este camino
  // viene a sacarse de encima.
  //
  // `sinMedidas` junta las capas que habria que dibujar pero cuyo material
  // no se pudo medir. No se ignoran: exportar un mp4 con un hueco negro y
  // no avisar es peor que fallar.
  function guionDeExport(m, opciones) {
    const o = opciones || {};
    const fps = Math.max(1, o.fps || 30);
    const lienzo = o.lienzo || { ancho: 1920, alto: 1080 };
    const fuentes = o.fuentes || {};
    const ts = instantes(fps, o.desde || 0, o.hasta || 0);

    const porClip = new Map();
    const sinMedidas = new Map();

    for (let i = 0; i < ts.length; i++) {
      const plan = Composicion.planLienzo(m, ts[i], lienzo, fuentes);

      for (const falta of plan.sinMedidas) {
        if (!sinMedidas.has(falta.clipId)) sinMedidas.set(falta.clipId, falta.mediaId);
      }

      for (const capa of plan.capas) {
        let e = porClip.get(capa.clipId);
        if (!e) {
          e = { clipId: capa.clipId, mediaId: capa.mediaId, media: capa.media, tiempos: [], indices: [] };
          porClip.set(capa.clipId, e);
        }
        e.tiempos.push(capa.tFuente);
        e.indices.push(i);
      }
    }

    return {
      fps,
      lienzo,
      desde: ts.length ? ts[0] : 0,
      totalCuadros: ts.length,
      instantes: ts,
      clips: [...porClip.values()],
      sinMedidas: [...sinMedidas.entries()].map(([clipId, mediaId]) => ({ clipId, mediaId }))
    };
  }

  // ----------------------------------------------------------
  // FPS DE SALIDA (13/09/2026)
  // ----------------------------------------------------------
  // A cuantos cuadros por segundo sale el mp4. Orden de prioridad:
  //   1. lo que el user eligio (`preferido` > 0; en ajustes 0 = "el del
  //      original", que es el valor por defecto de settingsStore);
  //   1b. el fps del MONTAJE (`m.fps`, base de cuadro, tanda D): es la
  //      grilla donde estan los cortes, asi que exportar a otro fps
  //      volveria a poner cortes entre cuadros;
  //   2. el fps del PRIMER material que aparece en la linea de imagen
  //      (el clip que arranca antes; empate: la pista de abajo). Se lee
  //      de `media.fps` (ffprobe al importar) o, si el proyecto es de
  //      antes de guardar ese campo, de `medidos[mediaId].fps` (lo que
  //      midio el decodificador en el momento de exportar);
  //   3. 30, si nadie sabe nada.
  //
  // CON MATERIAL MEZCLADO (29,97 con 25) manda el primero. Es la decision
  // anotada en DECISIONES.md: no se inventa un fps que no tiene ningun
  // archivo, y el caso normal de un short es una sola grabacion.
  const FPS_POR_DEFECTO = 30;
  // Los NTSC van como fraccion exacta (30000/1001) y no como 29.97: un mp4
  // a 29,97 redondo contra material a 30000/1001 se corre un cuadro cada
  // ~9 horas, no importa; pero no hay motivo para no ser exacto.
  const FPS_ESTANDAR = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 90, 100, 120000 / 1001, 120];

  // Los celulares graban con cuadro VARIABLE y ffprobe devuelve el
  // promedio (29,87; 30,02...). Exportar a 29,87 no le sirve a nadie y
  // hace que cada cuadro caiga un poco corrido respecto del material, asi
  // que un valor a menos del 2% de un fps estandar se lleva a ese
  // estandar. Uno raro de verdad (15, 12) se respeta.
  function normalizarFps(fps) {
    if (!(fps > 0) || !isFinite(fps)) return 0;
    let mejor = null;
    for (const f of FPS_ESTANDAR) {
      const dif = Math.abs(fps - f) / f;
      if (dif <= 0.02 && (!mejor || dif < mejor.dif)) mejor = { f, dif };
    }
    const v = mejor ? mejor.f : Math.round(fps * 1000) / 1000;
    return Math.min(120, Math.max(1, v));
  }

  function fpsDeMontaje(m, opciones) {
    const o = opciones || {};
    if (o.preferido > 0) return normalizarFps(o.preferido);
    const base = Montaje.fpsDe(m);
    if (base) return base.num / base.den;
    const medidos = o.medidos || {};
    const candidatos = [];
    (m && m.pistas || []).forEach((p, indicePista) => {
      if (p.tipo === 'audio') return;
      for (const el of Montaje.elementosDePista(m, p.id)) {
        if (el.tipo !== 'clip' || Montaje.esAjuste(el) || !el.mediaId) continue;
        candidatos.push({ inicio: el.inicio, indicePista, mediaId: el.mediaId });
      }
    });
    candidatos.sort((a, b) => (a.inicio - b.inicio) || (a.indicePista - b.indicePista));
    for (const c of candidatos) {
      const media = (m.media || []).find((x) => x.id === c.mediaId);
      const fps = normalizarFps((media && media.fps) || (medidos[c.mediaId] && medidos[c.mediaId].fps));
      if (fps > 0) return fps;
    }
    return FPS_POR_DEFECTO;
  }

  // ----------------------------------------------------------
  // QUE INSTANTE SE LE PIDE AL DECODIFICADOR
  // ----------------------------------------------------------
  // El decodificador entrega, para cada instante pedido, el ultimo cuadro
  // cuyo timestamp es <= ese instante. Si el pedido cae JUSTO sobre el
  // borde entre dos cuadros, cualquier redondeo decide cual sale. Y los
  // contenedores con base de tiempo en milisegundos (mkv, webm) redondean
  // siempre: guardan 0,033 / 0,067 / 0,100. El cuadro 2 a 30 fps se pide
  // en 0,06667, el archivo dice 0,067, y el decodificador devuelve el
  // cuadro 1 OTRA VEZ y se saltea el 2. En el mp4 se ve como un temblor.
  //
  // PRIMER INTENTO, DESCARTADO (13/09/2026): correr el pedido 2 ms hacia
  // adelante. Arreglaba el caso de arriba pero lo movia a otro lado: un
  // clip cortado en el segundo 2,000 de un material a 29,97 queda con los
  // pedidos a 2 ms ANTES de cada borde, el sesgo los deja encima del borde
  // y el redondeo del mkv hacia repetir un cuadro si y otro no. Se vio
  // exportando de verdad (banco de prueba de impl-A.md), no en un test.
  //
  // LO QUE SE HACE: si se sabe el fps del MATERIAL, se pide el CENTRO del
  // cuadro que corresponde a ese instante. El centro esta a medio cuadro
  // de los dos bordes (16 ms a 30 fps), asi que ningun redondeo lo cambia.
  // El corrimiento maximo es medio cuadro del material, y si el fps es el
  // real del archivo, cero. Sin fps del material queda el sesgo chico, que
  // es mejor que nada.
  const SESGO_MAX = 0.002;

  function sesgoDeLectura(fps) {
    return Math.min(SESGO_MAX, 0.25 / Math.max(1, fps));
  }

  // `fpsFuente` es el del ARCHIVO (sin normalizar: 30000/1001 y no 29,97,
  // para que la grilla no se corra en un material largo).
  function tiemposParaLector(tiempos, fpsSalida, fpsFuente) {
    if (fpsFuente > 0 && isFinite(fpsFuente)) {
      // El 1e-6 absorbe el error de coma flotante de un pedido que cae
      // exacto en un borde (3 * (1/30) * 30 = 2,9999999).
      return tiempos.map((t) => (Math.floor(t * fpsFuente + 1e-6) + 0.5) / fpsFuente);
    }
    const s = sesgoDeLectura(fpsSalida);
    return tiempos.map((t) => t + s);
  }

  // ----------------------------------------------------------
  // ANTES DE EMPEZAR: lo que impide exportar
  // ----------------------------------------------------------
  // Mensajes para el user, no codigos. Una lista vacia = se puede.
  // `modo` es 'vertical' (9:16 por los encuadres) u 'horizontal' (el
  // lienzo del proyecto tal cual).
  function problemasDeExport(m, guion, modo) {
    const out = [];
    if (!guion || !guion.totalCuadros) {
      out.push('El montaje esta vacio: no hay nada que exportar.');
      return out;
    }
    for (const falta of guion.sinMedidas || []) {
      const media = (m.media || []).find((x) => x.id === falta.mediaId);
      out.push(`No se pudo leer el material "${(media && media.nombre) || falta.mediaId}": el video saldria con un hueco negro.`);
    }
    if (!guion.clips.length && !(guion.sinMedidas || []).length) {
      out.push('No hay ningun clip con imagen en la linea de tiempo.');
    }
    if (modo === 'vertical') {
      const hayEncuadre = m.pistas.some((p) => p.elementos.some((el) => Montaje.esAjuste(el)));
      if (!hayEncuadre) out.push('No hay ningun encuadre 9:16: agregá uno o exportá en horizontal.');
    }
    return out;
  }

  // ----------------------------------------------------------
  // QUE DIBUJAR EN UN CUADRO, con las muestras que ya se leyeron
  // ----------------------------------------------------------
  // Sigue el ORDEN del plan (de abajo hacia arriba), no el de las
  // muestras: el Map de muestras se arma en el orden en que se abrieron
  // los lectores, que no tiene nada que ver con que pista tapa a cual.
  // Una capa sin muestra (null: antes del primer cuadro o pasado el final
  // del archivo) se saltea y deja ver lo de abajo.
  function pasosDeDibujo(plan, muestras) {
    const pasos = [];
    for (const capa of (plan && plan.capas) || []) {
      const muestra = muestras.get(capa.clipId);
      if (!muestra) continue;
      pasos.push({ clipId: capa.clipId, muestra, dest: capa.dest });
    }
    return pasos;
  }

  // ----------------------------------------------------------
  // EL BUCLE DEL EXPORT
  // ----------------------------------------------------------
  // Recorre el guion cuadro por cuadro. No sabe nada de WebCodecs ni de
  // canvas: todo lo que toca el navegador entra por `deps`, y por eso se
  // puede probar en node con lectores y codificador falsos.
  //
  //   abrirLector(clip)          -> { siguiente(): muestra|null, cerrar() }
  //   componer(i, tLinea, muestras) dibuja el cuadro i (muestras: Map clipId->muestra)
  //   agregarCuadro(t, dur)      lo manda al codificador (t desde 0)
  //   alProgreso(hechos, total)  opcional
  //   cancelado()                opcional; true corta limpio
  //
  // TRES COSAS QUE ESTE BUCLE GARANTIZA, y cada una tiene test:
  //
  // 1. Los lectores se abren RECIEN cuando su clip entra en cuadro y se
  //    cierran apenas sale. Abrirlos todos al principio era lo obvio, pero
  //    un montaje con 40 cortes son 40 clips = 40 VideoDecoder vivos a la
  //    vez, y Chromium deja de dar decodificadores bastante antes. Asi, los
  //    abiertos son solo los que se superponen en un instante.
  // 2. Cada muestra se cierra despues de dibujarla, pase lo que pase. Un
  //    VideoFrame sin cerrar retiene memoria de GPU y a los pocos cientos
  //    de cuadros el decodificador se traba.
  // 3. Si algo falla o se cancela, se cierran todos los lectores abiertos.
  async function ejecutarGuion(guion, deps) {
    const { abrirLector, componer, agregarCuadro } = deps;
    const alProgreso = deps.alProgreso || (() => {});
    const cancelado = deps.cancelado || (() => false);
    const fps = guion.fps;
    const total = guion.totalCuadros;

    // Un estado por clip, ordenados por el primer cuadro en que aparecen.
    const pendientes = guion.clips
      .filter((c) => c.indices.length)
      .map((clip) => ({ clip, cursor: 0, lector: null }))
      .sort((a, b) => a.clip.indices[0] - b.clip.indices[0]);
    const abiertos = new Set();

    try {
      for (let i = 0; i < total; i++) {
        if (cancelado()) return { cuadros: i, cancelado: true };

        const muestras = new Map();
        try {
          for (const e of pendientes) {
            if (e.clip.indices[0] > i) break;               // todavia no entra
            if (e.cursor >= e.clip.indices.length) continue; // ya termino
            if (e.clip.indices[e.cursor] !== i) continue;
            if (!e.lector) {
              e.lector = await abrirLector(e.clip);
              abiertos.add(e);
            }
            muestras.set(e.clip.clipId, await e.lector.siguiente());
            e.cursor++;
            if (e.cursor >= e.clip.indices.length) {
              e.lector.cerrar();
              abiertos.delete(e);
              e.lector = null;
            }
          }
          await componer(i, guion.instantes[i], muestras);
        } finally {
          for (const s of muestras.values()) {
            if (s && typeof s.close === 'function') {
              try { s.close(); } catch (err) { /* ya estaba cerrada */ }
            }
          }
        }

        // El timestamp se calcula i/fps, igual que los instantes: sumar
        // 1/fps en un acumulador corre el final del video.
        await agregarCuadro(i / fps, 1 / fps);
        alProgreso(i + 1, total);
      }
      return { cuadros: total, cancelado: false };
    } finally {
      for (const e of abiertos) {
        try { e.lector.cerrar(); } catch (err) { /* idem */ }
      }
    }
  }

  return {
    instantes, mediasUsadas, guionDeExport,
    FPS_POR_DEFECTO, normalizarFps, fpsDeMontaje,
    sesgoDeLectura, tiemposParaLector,
    problemasDeExport, pasosDeDibujo, ejecutarGuion
  };
});
