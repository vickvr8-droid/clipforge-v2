// ============================================================
// CUADROS — LA FUENTE DE IMAGENES PARA LA EXPORTACION (08/08/2026)
// ============================================================
// Entrega los cuadros decodificados que el export dibuja en el lienzo.
// No sabe nada de montaje ni de geometria: recibe "de este archivo,
// estos instantes" y devuelve las imagenes en ese orden.
//
// POR QUE NO SE USA EL <video> DEL VISOR, que ya decodifica:
// un <video> tiene UN solo cabezal. El visor puede vivir con eso porque
// dibuja una capa por vez, pero la exportacion tiene que componer varias
// capas EN EL MISMO INSTANTE, y ademas avanzar a paso fijo sin depender
// de la velocidad de reproduccion. Son dos cosas que un <video> no da.
//
// ----------------------------------------------------------------
// LA MEDICION QUE DEFINE ESTE ARCHIVO (Chromium, 08/08/2026, 1080p h264)
// ----------------------------------------------------------------
//   samplesAtTimestamps (iterador) ->  2,5 ms por cuadro
//   getSample() uno por uno        -> 72,7 ms por cuadro  (29,6x mas)
//   salto arbitrario               -> ~134 ms
//
// Por eso la API de aca es un ITERADOR y no un `cuadroEn(t)`. La version
// simple existe y es tentadora, pero convierte un export de 45 segundos
// en uno de 20 minutos: el decodificador tiene que volver al keyframe
// anterior y re-decodificar en cada pedido suelto, mientras que el
// iterador aprovecha que los instantes vienen ordenados.
//
// Consecuencia de diseño, y hay que respetarla: **los tiempos que se le
// pasan a un lector tienen que venir ORDENADOS de menor a mayor.** Si se
// desordenan, sigue funcionando pero se cae al costo del salto.
//
// Vive en renderer/ y no en shared/ a proposito: depende de WebCodecs, que
// en Node no existe. No se puede probar con node:test; se verifico en un
// banco de pruebas sobre Chromium.

(function (root) {
  'use strict';

  // Un lector por CLIP y no por archivo: dos clips del mismo material
  // pueden estar visibles a la vez (una imagen dentro de otra) y cada uno
  // va por un instante distinto. Compartir el decodificador los haria
  // pelearse por el cabezal, que es justo el problema del <video>.
  function urlDe(ruta) {
    return (root.clipForge && root.clipForge.rutaAMediaUrl)
      ? root.clipForge.rutaAMediaUrl(ruta)
      : ruta;
  }

  function nuevaEntrada(ruta) {
    const M = root.Mediabunny;
    if (!M) throw new Error('mediabunny no esta cargada en la ventana');
    return new M.Input({ source: new M.UrlSource(urlDe(ruta)), formats: M.ALL_FORMATS });
  }

  // Medidas REALES del material, las que el plan de composicion necesita
  // para calcular el encaje. Se piden al decodificador y no a ffprobe
  // porque son las que de verdad van a salir dibujadas: si el archivo
  // trae rotacion, `displayWidth/Height` ya vienen con eso aplicado y
  // ffprobe no siempre coincide.
  async function medidasDe(ruta) {
    const input = nuevaEntrada(ruta);
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) return null;
      // FPS medido por el decodificador (13/09/2026). Solo lo usa la
      // exportacion cuando el material es de un proyecto viejo y no trae
      // `fps` de ffprobe. Se cuentan 120 paquetes y no todos: recorrer un
      // archivo de una hora entero para un promedio no vale la espera.
      let fps = 0;
      try {
        const stats = await track.computePacketStats(120);
        fps = (stats && stats.averagePacketRate) || 0;
      } catch (e) { fps = 0; }
      return {
        fps,
        ancho: track.displayWidth,
        alto: track.displayHeight,
        rotacion: track.rotation,
        codec: await track.getCodec(),
        decodificable: await track.canDecode(),
        duracion: await input.computeDuration()
      };
    } finally {
      input.dispose();
    }
  }

  // Un LECTOR: la fuente de cuadros de un clip durante una exportacion.
  //
  // Uso:
  //   const lector = await Cuadros.abrirLector(ruta, tiempos);
  //   const sample = await lector.siguiente();   // hay que cerrarlo
  //   ...
  //   lector.cerrar();
  //
  // `siguiente()` devuelve los cuadros en el mismo orden que los tiempos
  // pedidos. Puede devolver null para un instante sin imagen (antes del
  // primer cuadro o pasado el final del archivo): eso NO es un error, y
  // el que dibuja tiene que poder saltearlo dejando el fondo.
  async function abrirLector(ruta, tiempos) {
    const M = root.Mediabunny;
    const input = nuevaEntrada(ruta);
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      input.dispose();
      throw new Error(`El archivo no tiene pista de video: ${ruta}`);
    }
    if (!(await track.canDecode())) {
      const codec = await track.getCodec();
      input.dispose();
      // Mensaje accionable: el user no puede hacer nada con
      // "canDecode() === false", pero si con el nombre del codec.
      throw new Error(`No se puede decodificar el video de ${ruta} (codec ${codec}).`);
    }

    const sink = new M.VideoSampleSink(track);
    const iterador = sink.samplesAtTimestamps(tiempos)[Symbol.asyncIterator]();
    let cerrado = false;

    return {
      medidas: { ancho: track.displayWidth, alto: track.displayHeight },
      async siguiente() {
        if (cerrado) return null;
        const r = await iterador.next();
        return r.done ? null : r.value;
      },
      cerrar() {
        if (cerrado) return;
        cerrado = true;
        // return() le avisa al iterador que no se va a consumir mas, para
        // que suelte el decodificador. Sin esto quedan VideoDecoder vivos
        // y despues de unas cuantas exportaciones Chromium deja de dar
        // decodificadores nuevos.
        try { if (iterador.return) iterador.return(); } catch (e) { /* ya estaba cerrado */ }
        try { input.dispose(); } catch (e) { /* idem */ }
      }
    };
  }

  // ----------------------------------------------------------
  // LECTOR DE AUDIO (13/09/2026, tanda D, paso 5)
  // ----------------------------------------------------------
  // El sonido de UN tramo de un archivo, para MezclaAudio.crearMezclador.
  // Mismo patron que abrirLector: uno por tramo, se abre cuando el tramo
  // empieza a sonar y se cierra cuando termina.
  //
  // `samples(desde, hasta)` es la iteracion por rango de mediabunny: entrega
  // los pedazos decodificados en orden desde el que contiene `desde`
  // (media-sinks.md, "Range iteration"). Cada pedazo se copia a Float32 por
  // canal y se cierra enseguida: el AudioData retiene memoria del
  // decodificador, igual que un VideoFrame.
  //
  // Un archivo sin pista de sonido, o con un codec que no se puede
  // decodificar, NO corta el export: ese tramo queda en silencio y
  // `sinSonido` lo dice para poder avisar con el nombre del archivo.
  async function abrirLectorAudio(ruta, desde, hasta) {
    const M = root.Mediabunny;
    const input = nuevaEntrada(ruta);
    let track = null;
    try {
      track = await input.getPrimaryAudioTrack();
      if (track && !(await track.canDecode())) track = null;
    } catch (e) {
      track = null;
    }
    if (!track) {
      input.dispose();
      return { sinSonido: true, async siguiente() { return null; }, cerrar() {} };
    }
    const sink = new M.AudioSampleSink(track);
    const iterador = sink.samples(Math.max(0, desde), hasta)[Symbol.asyncIterator]();
    let cerrado = false;
    return {
      sinSonido: false,
      async siguiente() {
        if (cerrado) return null;
        const r = await iterador.next();
        if (r.done) return null;
        const s = r.value;
        try {
          const planos = [];
          for (let c = 0; c < s.numberOfChannels; c++) {
            const p = new Float32Array(s.allocationSize({ format: 'f32-planar', planeIndex: c }) / 4);
            s.copyTo(p, { format: 'f32-planar', planeIndex: c });
            planos.push(p);
          }
          return { timestamp: s.timestamp, frecuencia: s.sampleRate, planos };
        } finally {
          s.close();
        }
      },
      cerrar() {
        if (cerrado) return;
        cerrado = true;
        try { if (iterador.return) iterador.return(); } catch (e) { /* ya estaba cerrado */ }
        try { input.dispose(); } catch (e) { /* idem */ }
      }
    };
  }

  root.Cuadros = { medidasDe, abrirLector, abrirLectorAudio };
})(typeof globalThis !== 'undefined' ? globalThis : this);
