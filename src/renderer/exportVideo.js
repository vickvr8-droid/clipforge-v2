// ============================================================
// EXPORTAR VIDEO — el bucle de 1.3.b (13/09/2026)
// ============================================================
// Une las piezas que ya estaban hechas y verificadas por separado:
//
//   GuionExport.guionDeExport  que instantes pedirle a cada clip (pura)
//   Cuadros.abrirLector        los cuadros decodificados, por lote ordenado
//   Composicion.planLienzo     donde va cada capa (el MISMO plan del visor)
//   Composicion.planVertical   el recorte 9:16 sobre el lienzo compuesto
//   mediabunny CanvasSource    el canvas de salida -> mp4
//
// El recorrido cuadro por cuadro NO esta aca: es GuionExport.ejecutarGuion,
// que no sabe de canvas ni de WebCodecs y por eso tiene tests en node
// (abrir lectores de a poco, cerrar cada muestra, cancelar limpio). Este
// archivo solo le da las piezas del navegador. Lo que queda aca no se
// puede probar con node:test: hay checklist manual en
// D:\investigacion-clipforge\flujo-clipforge3\impl-A.md.
//
// AUDIO (13/09/2026, tanda D, paso 5): el mp4 lleva la MEZCLA de todas las
// pistas de audio que suenan (voz + musica), con la ganancia de cada pista
// y cada clip y sin las pistas silenciadas. Las cuentas estan en
// shared/mezclaAudio.js (con tests); aca se decodifica con
// Cuadros.abrirLectorAudio y se codifica con AudioSampleSource. El audio se
// entrega INTERCALADO con el video (antes de cada cuadro, lo que falta
// hasta el final de ese cuadro): mediabunny retiene los paquetes de una
// pista hasta tener los de la otra, y mandar todo el video primero lo
// dejaria entero en memoria.
// Si el equipo no codifica ni AAC ni Opus, sale sin sonido y lo dice.
//
// Los cortes estan en cuadros desde la tanda D (paso 6): el export sale al
// fps del montaje (GuionExport.fpsDeMontaje).
//
// POR QUE EL LIENZO VA EN UN CANVAS PROPIO y no en el `canvas169` del
// visor: el visor se sigue redibujando mientras se exporta (el cabezal,
// los recuadros), y cualquier repintado a mitad de un cuadro se colaria
// en el mp4. El plan es el mismo; el canvas es otro. Eso no reabre el
// problema de "dos caminos": la cuenta sigue siendo una sola
// (composicion.js), cambia solo el tamaño, que es justo lo que cubre el
// test de escalado de composicion.test.js.

(function (root) {
  'use strict';

  // Pedazos de 8 MB hacia el main. Mas chicos = mas viajes de IPC; mas
  // grandes = mas memoria retenida en el renderer esperando completarse.
  const TAM_PEDAZO = 8 * 1024 * 1024;
  // Limite de ancho del lienzo horizontal. Un material 8K exportaria un
  // mp4 que ni el encoder por hardware ni un celular abren.
  const ANCHO_MAXIMO = 3840;
  // Orden de preferencia: H.264 lo abre cualquier cosa. Los demas son por
  // si el build de Chromium que trae Electron no lo codifica.
  const CODECS = ['avc', 'hevc', 'vp9', 'av1'];
  // AAC es lo que abre cualquier reproductor y red social; Opus en mp4 es
  // el plan B si el Chromium de Electron no trae el codificador de AAC.
  const CODECS_AUDIO = ['aac', 'opus'];

  function destinoPorIpc(id) {
    return new WritableStream({
      async write(pedazo) {
        await root.clipForge.exportVideoEscribir(id, pedazo.position, pedazo.data);
      }
    });
  }

  // Los materiales que se VEN (no los de audio ni los encuadres).
  function mediosConImagen(m) {
    const ids = new Set();
    for (const p of m.pistas) {
      if (p.tipo === 'audio' || !p.visible) continue;
      for (const el of p.elementos) {
        if (el.tipo === 'clip' && !Montaje.esAjuste(el) && el.mediaId) ids.add(el.mediaId);
      }
    }
    return [...ids];
  }

  // Medidas reales (y fps) de cada material, por el decodificador. Un
  // material que no se puede abrir NO corta aca: composicion cae a las
  // medidas de ffprobe, y si tampoco hay, guionDeExport lo reporta en
  // `sinMedidas` con el nombre del archivo.
  async function medirMateriales(m, alEstado) {
    const fuentes = {};
    for (const id of mediosConImagen(m)) {
      const media = Montaje.mediaPorId(m, id);
      if (!media) continue;
      alEstado(`Midiendo ${media.nombre}…`);
      try {
        const med = await Cuadros.medidasDe(media.ruta);
        if (med && med.ancho > 0 && med.alto > 0) fuentes[id] = med;
      } catch (e) { /* lo reporta el guion o el lector, con el nombre */ }
    }
    return fuentes;
  }

  // El lienzo del proyecto a resolucion de exportacion: la forma del
  // primer material con medidas (la misma regla que usa el visor, en
  // Lienzo.lienzoDeMontaje) y el ancho de ese material, sin agrandar.
  function lienzoDeExport(m, fuentes) {
    const media = m.media.map((x) => (fuentes[x.id] ? { ...x, ...fuentes[x.id] } : x));
    const primero = media.find((x) => x.ancho > 0 && x.alto > 0);
    const ancho = Math.min(ANCHO_MAXIMO, (primero && primero.ancho) || 1920);
    const l = Lienzo.lienzoDeMontaje(media, ancho);
    return Composicion.resolucionSalida(l.ancho, l.alto);
  }

  function nuevoCanvas(ancho, alto) {
    const c = document.createElement('canvas');
    c.width = ancho;
    c.height = alto;
    return c;
  }

  function calidad(M) {
    return M.Quality ? new M.Quality('high') : M.QUALITY_HIGH;
  }

  // o = { inputPath, montaje, layout, modo: 'vertical'|'horizontal',
  //       ajustes (settingsStore.exportacion), senal: { cancelado },
  //       alEstado(texto), alProgreso(hechos, total) }
  // Devuelve { ok, ruta, cuadros, fps, codec, segundos } | { cancelado: true }.
  // Tira Error con un mensaje para el user si no se puede.
  async function exportar(o) {
    const M = root.Mediabunny;
    if (!M) throw new Error('El codificador (mediabunny) no esta cargado.');
    const m = o.montaje;
    if (!m) throw new Error('No hay montaje cargado.');
    const modo = o.modo === 'horizontal' ? 'horizontal' : 'vertical';
    const ajustes = o.ajustes || {};
    const senal = o.senal || { cancelado: false };
    const alEstado = o.alEstado || (() => {});
    const alProgreso = o.alProgreso || (() => {});

    const fuentes = await medirMateriales(m, alEstado);
    const fps = GuionExport.fpsDeMontaje(m, { preferido: ajustes.fps, medidos: fuentes });
    const lienzo = lienzoDeExport(m, fuentes);
    const salida = modo === 'vertical'
      ? Composicion.resolucionSalida(ajustes.ancho || 1080, ajustes.alto || 1920)
      : lienzo;

    alEstado('Preparando…');
    const guion = GuionExport.guionDeExport(m, {
      fps, lienzo, fuentes, desde: 0, hasta: Montaje.duracionMontaje(m)
    });
    const problemas = GuionExport.problemasDeExport(m, guion, modo);
    if (problemas.length) throw new Error(problemas.join(' '));

    const codec = M.getFirstEncodableVideoCodec
      ? await M.getFirstEncodableVideoCodec(CODECS, { width: salida.ancho, height: salida.alto })
      : ((await M.canEncodeVideo('avc', { width: salida.ancho, height: salida.alto })) ? 'avc' : null);
    if (!codec) {
      throw new Error(`Este equipo no puede codificar video de ${salida.ancho}x${salida.alto} (probé ${CODECS.join(', ')}).`);
    }

    // Recien ahora se pregunta donde guardar: si algo de lo anterior
    // fallaba, el user no tenia que elegir un archivo para nada.
    const destino = await root.clipForge.exportVideoAbrir(o.inputPath, modo === 'vertical' ? '9x16' : 'horizontal');
    if (!destino) return { cancelado: true };

    const canvasLienzo = nuevoCanvas(lienzo.ancho, lienzo.alto);
    const ctxLienzo = canvasLienzo.getContext('2d', { alpha: false });
    const canvasSalida = modo === 'vertical' ? nuevoCanvas(salida.ancho, salida.alto) : canvasLienzo;
    const ctxSalida = modo === 'vertical' ? canvasSalida.getContext('2d', { alpha: false }) : ctxLienzo;

    // AUDIO: que suena, y con que se codifica. Se decide ANTES de start():
    // despues no se pueden agregar pistas al Output.
    const duracionSalida = guion.totalCuadros / fps;
    const tramos = root.MezclaAudio ? MezclaAudio.tramosDeAudio(m, 0, duracionSalida) : [];
    let codecAudio = null;
    if (tramos.length && M.getFirstEncodableAudioCodec) {
      try {
        codecAudio = await M.getFirstEncodableAudioCodec(CODECS_AUDIO,
          { numberOfChannels: MezclaAudio.CANALES, sampleRate: MezclaAudio.FRECUENCIA });
      } catch (e) { codecAudio = null; }
    }
    const avisos = [];
    if (tramos.length && !codecAudio) avisos.push('sin sonido: este equipo no puede codificar AAC ni Opus');

    const output = new M.Output({
      format: new M.Mp4OutputFormat(),
      target: new M.StreamTarget(destinoPorIpc(destino.id), { chunked: true, chunkSize: TAM_PEDAZO })
    });
    const fuenteVideo = new M.CanvasSource(canvasSalida, { codec, quality: calidad(M) });
    output.addVideoTrack(fuenteVideo, { frameRate: fps });
    let fuenteAudio = null;
    let mezclador = null;
    const sinSonido = new Set();
    if (codecAudio) {
      fuenteAudio = new M.AudioSampleSource({ codec: codecAudio, quality: calidad(M) });
      output.addAudioTrack(fuenteAudio);
      mezclador = MezclaAudio.crearMezclador({
        tramos,
        duracion: duracionSalida,
        abrirFuente: async (tramo) => {
          const media = tramo.media;
          if (!media) return { async siguiente() { return null; }, cerrar() {} };
          const lector = await Cuadros.abrirLectorAudio(media.ruta, tramo.fuenteIn,
            tramo.fuenteIn + (tramo.lineaOut - tramo.lineaIn) + 0.1);
          if (lector.sinSonido) sinSonido.add(media.nombre);
          return lector;
        },
        agregarBloque: async (b) => {
          const muestra = new M.AudioSample({
            data: MezclaAudio.aPlanar(b.planos), format: 'f32-planar',
            numberOfChannels: b.canales, sampleRate: b.frecuencia, timestamp: b.timestamp
          });
          try { await fuenteAudio.add(muestra); } finally { muestra.close(); }
        }
      });
    }

    const inicio = performance.now();
    let resultado;
    try {
      await output.start();
      alEstado(`Exportando a ${+fps.toFixed(3)} fps…`);
      resultado = await GuionExport.ejecutarGuion(guion, {
        // Se pide el CENTRO de cada cuadro del material (ver tiemposParaLector):
        // con el fps del archivo, que no es el de salida si el material es mezclado.
        abrirLector: (clip) => Cuadros.abrirLector(clip.media.ruta, GuionExport.tiemposParaLector(
          clip.tiempos, fps,
          (clip.media && clip.media.fps) || (fuentes[clip.mediaId] && fuentes[clip.mediaId].fps) || 0)),
        componer: (i, tLinea, muestras) => {
          ctxLienzo.fillStyle = Composicion.NEGRO;
          ctxLienzo.fillRect(0, 0, lienzo.ancho, lienzo.alto);
          const plan = Composicion.planLienzo(m, tLinea, lienzo, fuentes);
          for (const paso of GuionExport.pasosDeDibujo(plan, muestras)) {
            const d = paso.dest;
            paso.muestra.draw(ctxLienzo, d.x, d.y, d.w, d.h);
          }
          if (modo !== 'vertical') return;
          // El 9:16 recorta del lienzo YA COMPUESTO, igual que dibujar916().
          ctxSalida.fillStyle = Composicion.NEGRO;
          ctxSalida.fillRect(0, 0, salida.ancho, salida.alto);
          const pv = Composicion.planVertical(m, tLinea, lienzo, salida, o.layout);
          for (const { src, dest } of pv.celdas) {
            ctxSalida.drawImage(canvasLienzo, src.x, src.y, src.w, src.h, dest.x, dest.y, dest.w, dest.h);
          }
        },
        // Primero el sonido hasta el final de este cuadro, despues el cuadro.
        agregarCuadro: async (t, dur) => {
          if (mezclador) await mezclador.avanzarHasta(t + dur);
          await fuenteVideo.add(t, dur);
        },
        alProgreso,
        cancelado: () => senal.cancelado
      });

      if (resultado.cancelado) {
        if (mezclador) mezclador.cerrar();
        await output.cancel();
        await root.clipForge.exportVideoCerrar(destino.id, false);
        return { cancelado: true };
      }
      if (mezclador) {
        alEstado('Terminando el sonido…');
        await mezclador.terminar();
      }
      alEstado('Cerrando el archivo…');
      await output.finalize();
    } catch (e) {
      if (mezclador) mezclador.cerrar();
      try { await output.cancel(); } catch (e2) { /* ya estaba roto */ }
      try { await root.clipForge.exportVideoCerrar(destino.id, false); } catch (e3) { /* idem */ }
      throw e;
    }

    const cierre = await root.clipForge.exportVideoCerrar(destino.id, true);
    return {
      ok: true,
      ruta: (cierre && cierre.ruta) || destino.ruta,
      cuadros: resultado.cuadros,
      fps,
      codec,
      codecAudio,
      // Tramos que suenan: 0 = el montaje no tiene sonido (no es un error).
      tramosDeAudio: tramos.length,
      avisos: avisos.concat([...sinSonido].map((n) => `"${n}" no tiene sonido que se pueda leer`)),
      segundos: (performance.now() - inicio) / 1000
    };
  }

  root.ExportVideo = { exportar, lienzoDeExport, mediosConImagen };
})(typeof globalThis !== 'undefined' ? globalThis : this);
