// ============================================================
// MEZCLA DE AUDIO PARA LA EXPORTACION (13/09/2026, tanda D, paso 5)
// ============================================================
// El mp4 salia mudo a proposito (decision A2): el modelo solo sabia "una
// capa que suena" y un short con musica de fondo necesita VOZ + MUSICA.
// Ahora Montaje.capasDeAudioEn dice todo lo que suena, y este modulo arma
// el sonido del export a partir de eso.
//
// POR QUE ESTA PARTIDO ASI (igual que guionExport + exportVideo):
// todo lo que es cuenta (que tramos de que archivo suenan, con que
// ganancia, como se suman, cuando abrir y cerrar cada lector) es PURO y
// vive aca, con tests en node. Lo que depende del navegador (decodificar
// con mediabunny, codificar AAC/Opus) entra por parametro desde
// src/renderer/exportVideo.js.
//
// TRES DECISIONES DE FONDO:
//
// 1. SE MEZCLA POR BLOQUES CHICOS, intercalados con el video. mediabunny
//    tiene que esperar a tener datos de todas las pistas para escribir el
//    mp4 (writing-media-files.md, "packet buffering"): si se mandara todo
//    el video primero y el audio despues, retendria el video entero en
//    memoria. Por eso el export le pide al mezclador "llega hasta t" antes
//    de cada cuadro.
// 2. LOS LECTORES SE ABREN RECIEN CUANDO SU TRAMO EMPIEZA A SONAR y se
//    cierran cuando termina, como los de video en ejecutarGuion: un
//    montaje con 40 cortes no puede tener 40 decodificadores de audio
//    vivos.
// 3. LOS BLOQUES SE CUENTAN EN MUESTRAS ENTERAS, no en segundos: bloque k
//    = muestras [k*N, (k+1)*N). Sumar segundos corre el final (mismo motivo
//    que `instantes` en guionExport).
//
// Modulo PURO: require() en node, <script> en el renderer (queda como
// window.MezclaAudio).

(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./montaje') : root.Montaje);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MezclaAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Montaje) {
  'use strict';

  const FRECUENCIA = 48000;   // la de cualquier video; AAC y Opus la aceptan
  const CANALES = 2;
  const MUESTRAS_POR_BLOQUE = 4800;   // 100 ms: poca memoria, pocos viajes

  // ----------------------------------------------------------
  // QUE SUENA: los tramos de la linea con sonido
  // ----------------------------------------------------------
  // Un tramo por clip de audio audible, recortado a [desde, hasta). Es la
  // version "por clip" de capasDeAudioEn (que es "por instante"), con las
  // mismas reglas: fuera las pistas silenciadas y la ganancia 0.
  //   lineaIn/lineaOut  donde suena en el montaje
  //   fuenteIn          que instante del archivo suena en lineaIn
  //   ganancia          la de la pista por el volumen del clip
  function tramosDeAudio(m, desde, hasta) {
    const a = Math.max(0, desde || 0);
    const b = hasta != null ? hasta : Montaje.duracionMontaje(m);
    const out = [];
    for (const p of (m && m.pistas) || []) {
      if (p.tipo !== 'audio' || Montaje.pistaSilenciada(p)) continue;
      for (const el of Montaje.elementosDePista(m, p.id)) {
        if (el.tipo !== 'clip' || Montaje.esAjuste(el) || !el.mediaId) continue;
        const ganancia = Montaje.gananciaDe(p) * Montaje.volumenDe(el);
        if (!(ganancia > 0)) continue;
        const ini = Math.max(a, el.inicio);
        const fin = Math.min(b, el.fin);
        if (!(fin > ini)) continue;
        out.push({
          clipId: el.id, pistaId: p.id, mediaId: el.mediaId,
          media: Montaje.mediaPorId(m, el.mediaId),
          lineaIn: ini, lineaOut: fin,
          fuenteIn: el.usadoIn + (ini - el.inicio),
          ganancia
        });
      }
    }
    return out.sort((x, y) => x.lineaIn - y.lineaIn);
  }

  // ----------------------------------------------------------
  // ACUMULADOR: el audio decodificado de UN tramo
  // ----------------------------------------------------------
  // El decodificador entrega pedazos del tamaño que quiere (1024 muestras
  // en AAC, 960 en Opus), a la frecuencia del archivo (44,1 kHz, 48 kHz).
  // El acumulador los guarda en orden y responde "cuanto vale el canal c en
  // el instante t del archivo", interpolando entre muestras. Asi la mezcla
  // no tiene que saber donde empieza cada pedazo ni a que frecuencia vino.
  //
  // La interpolacion es LINEAL. Para pasar de 44,1 a 48 kHz filtra un poco
  // los agudos; es inaudible en voz y aceptable en musica para un short.
  // Si algun dia molesta, se cambia aca sin tocar nada mas.
  function crearAcumulador() {
    const pedazos = [];   // { t0, fin, frecuencia, planos, n }
    let cursor = 0;       // ultimo pedazo usado: los pedidos vienen en orden

    function agregar(p) {
      if (!p || !p.planos || !p.planos.length) return;
      const n = p.planos[0].length;
      if (!n) return;
      pedazos.push({ t0: p.timestamp, fin: p.timestamp + n / p.frecuencia, frecuencia: p.frecuencia, planos: p.planos, n });
    }

    // Hasta que instante del archivo hay datos.
    const hasta = () => (pedazos.length ? pedazos[pedazos.length - 1].fin : -Infinity);

    function valor(canal, t) {
      if (!pedazos.length) return 0;
      if (cursor >= pedazos.length) cursor = pedazos.length - 1;
      // Retroceder solo si hace falta (un pedido anterior al cursor).
      while (cursor > 0 && t < pedazos[cursor].t0) cursor--;
      while (cursor < pedazos.length - 1 && t >= pedazos[cursor].fin) cursor++;
      const p = pedazos[cursor];
      if (t < p.t0 || t >= p.fin) return 0;   // un agujero en el archivo: silencio
      const plano = p.planos[canal < p.planos.length ? canal : 0];
      const pos = (t - p.t0) * p.frecuencia;
      const i = Math.min(p.n - 1, Math.floor(pos));
      const a = plano[i];
      let b = i + 1 < p.n ? plano[i + 1] : a;
      if (i + 1 >= p.n && cursor + 1 < pedazos.length) {
        const sig = pedazos[cursor + 1];
        if (Math.abs(sig.t0 - p.fin) < 1 / p.frecuencia) b = sig.planos[canal < sig.planos.length ? canal : 0][0];
      }
      return a + (b - a) * (pos - i);
    }

    // Libera lo que ya no se va a pedir.
    function descartarAntesDe(t) {
      let k = 0;
      while (k < pedazos.length - 1 && pedazos[k].fin <= t) k++;
      if (k) { pedazos.splice(0, k); cursor = Math.max(0, cursor - k); }
    }

    return { agregar, hasta, valor, descartarAntesDe, get cantidad() { return pedazos.length; } };
  }

  // ----------------------------------------------------------
  // MEZCLAR UN BLOQUE
  // ----------------------------------------------------------
  // `bloque` = { inicio (muestra), muestras, frecuencia, canales }.
  // `fuentes` = [{ tramo, acumulador }] ya cargados hasta el final del
  // bloque. Suma cada tramo con su ganancia en los instantes en que suena y
  // recorta a [-1, 1]: dos pistas fuertes sumadas se pasan, y un valor fuera
  // de rango el codificador lo convierte en un chasquido peor que el recorte.
  function mezclarBloque(bloque, fuentes) {
    const { inicio, muestras, frecuencia, canales } = bloque;
    const planos = [];
    for (let c = 0; c < canales; c++) planos.push(new Float32Array(muestras));
    for (const { tramo, acumulador } of fuentes) {
      // Solo las muestras del bloque en que este tramo suena. Se decide por
      // indice entero para que dos tramos pegados no se pisen ni dejen una
      // muestra sin nadie en el corte.
      const j0 = Math.max(0, Math.ceil(tramo.lineaIn * frecuencia - 1e-6) - inicio);
      const j1 = Math.min(muestras, Math.ceil(tramo.lineaOut * frecuencia - 1e-6) - inicio);
      if (j1 <= j0) continue;
      for (let c = 0; c < canales; c++) {
        const salida = planos[c];
        for (let j = j0; j < j1; j++) {
          const tLinea = (inicio + j) / frecuencia;
          salida[j] += tramo.ganancia * acumulador.valor(c, tramo.fuenteIn + (tLinea - tramo.lineaIn));
        }
      }
    }
    for (const plano of planos) {
      for (let j = 0; j < plano.length; j++) {
        if (plano[j] > 1) plano[j] = 1;
        else if (plano[j] < -1) plano[j] = -1;
      }
    }
    return planos;
  }

  // ----------------------------------------------------------
  // EL MEZCLADOR DEL EXPORT
  // ----------------------------------------------------------
  // o = {
  //   tramos            tramosDeAudio(m, 0, duracion)
  //   duracion          segundos de salida (los del video: totalCuadros/fps)
  //   frecuencia, canales, muestrasPorBloque   opcionales
  //   abrirFuente(tramo) -> { siguiente(): {timestamp, frecuencia, planos}|null, cerrar() }
  //   agregarBloque({ planos, frecuencia, canales, timestamp, muestras })
  // }
  // Devuelve { avanzarHasta(t), terminar(), cerrar(), abiertas() }.
  //   avanzarHasta(t)  mezcla y entrega todos los bloques que empiezan antes de t
  //   terminar()       entrega lo que falta hasta `duracion` y cierra todo
  //   cerrar()         cierra los lectores sin entregar nada (cancelar / error)
  function crearMezclador(o) {
    const frecuencia = o.frecuencia || FRECUENCIA;
    const canales = o.canales || CANALES;
    const porBloque = o.muestrasPorBloque || MUESTRAS_POR_BLOQUE;
    const total = Math.max(0, Math.round((o.duracion || 0) * frecuencia));
    const pendientes = (o.tramos || []).slice().sort((a, b) => a.lineaIn - b.lineaIn);
    const activas = [];   // { tramo, lector, acumulador, agotado }
    let hechas = 0;       // muestras ya entregadas
    let cerrado = false;

    async function llenar(f, tFuenteHasta) {
      while (!f.agotado && f.acumulador.hasta() < tFuenteHasta) {
        const p = await f.lector.siguiente();
        if (!p) { f.agotado = true; break; }
        f.acumulador.agregar(p);
      }
    }

    function soltar(f) {
      try { f.lector.cerrar(); } catch (e) { /* ya estaba cerrado */ }
    }

    async function unBloque() {
      const inicio = hechas;
      const muestras = Math.min(porBloque, total - inicio);
      const t0 = inicio / frecuencia;
      const t1 = (inicio + muestras) / frecuencia;

      // Abrir los tramos que empiezan a sonar en este bloque.
      while (pendientes.length && pendientes[0].lineaIn < t1) {
        const tramo = pendientes.shift();
        if (tramo.lineaOut <= t0) continue;
        const lector = await o.abrirFuente(tramo);
        activas.push({ tramo, lector, acumulador: crearAcumulador(), agotado: false });
      }

      // Cargar cada uno hasta el final del bloque (en tiempo de SU archivo).
      for (const f of activas) {
        const hastaLinea = Math.min(t1, f.tramo.lineaOut);
        await llenar(f, f.tramo.fuenteIn + (hastaLinea - f.tramo.lineaIn) + 2 / frecuencia);
      }

      const planos = mezclarBloque({ inicio, muestras, frecuencia, canales }, activas);
      await o.agregarBloque({ planos, frecuencia, canales, timestamp: t0, muestras });
      hechas += muestras;

      // Cerrar lo que ya no suena y soltar memoria de lo que ya paso.
      for (let i = activas.length - 1; i >= 0; i--) {
        const f = activas[i];
        if (f.tramo.lineaOut <= t1 + 1e-9) {
          soltar(f);
          activas.splice(i, 1);
        } else {
          f.acumulador.descartarAntesDe(f.tramo.fuenteIn + (t1 - f.tramo.lineaIn) - 2 / frecuencia);
        }
      }
    }

    async function avanzarHasta(t) {
      if (cerrado) return;
      const objetivo = Math.min(total, Math.ceil(t * frecuencia - 1e-6));
      while (hechas < objetivo) await unBloque();
    }

    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      activas.forEach(soltar);
      activas.length = 0;
    }

    async function terminar() {
      try {
        while (!cerrado && hechas < total) await unBloque();
      } finally {
        cerrar();
      }
      return { muestras: hechas };
    }

    return { avanzarHasta, terminar, cerrar, abiertas: () => activas.length, get hechas() { return hechas; }, total };
  }

  // Concatena planos en el formato 'f32-planar' que pide AudioSample: todo
  // el canal 0, despues todo el canal 1.
  function aPlanar(planos) {
    const n = planos.length ? planos[0].length : 0;
    const salida = new Float32Array(n * planos.length);
    planos.forEach((p, c) => salida.set(p, c * n));
    return salida;
  }

  return {
    FRECUENCIA, CANALES, MUESTRAS_POR_BLOQUE,
    tramosDeAudio, crearAcumulador, mezclarBloque, crearMezclador, aPlanar
  };
});
