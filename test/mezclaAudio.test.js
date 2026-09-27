// AUDIO: capas del modelo y mezcla del export (13/09/2026, tanda D, paso 5
// de la hoja de ruta; hallazgos 5 y 38 del INFORME).
//
// Lo que se prueba sin navegador: que el modelo diga TODO lo que suena, con
// su ganancia y respetando el silencio de cada pista, y que el mezclador
// sume bien, en el lugar justo, abra y cierre los lectores de a poco y no
// se pase de rango. Decodificar y codificar (mediabunny) queda del otro
// lado, en src/renderer/exportVideo.js.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const A = require('../src/shared/mezclaAudio');

const viejo = require('./fixtures/proyecto-viejo-sin-fps.json');

const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// Voz (video con sonido) en V1/A1 y musica en A2, las dos desde 0: el caso
// del hallazgo 5.
function vozYMusica() {
  let m = M.crearMontaje({ fps: 30 });
  let voz, musica;
  [m, voz] = M.agregarMedia(m, { ruta: 'voz.mp4', duracion: 20 });
  [m, musica] = M.agregarMedia(m, { ruta: 'musica.mp3', tipo: 'audio', duracion: 60 });
  let infoVoz, infoMusica;
  [m, infoVoz] = M.colocarMedia(m, voz, 0);
  [m, infoMusica] = M.colocarMedia(m, musica, 0);
  return { m, voz, musica, a1: infoVoz.pistaAudio, a2: infoMusica.pistaId, v1: infoVoz.pistaId, clipVoz: infoVoz.clipId };
}

// ------------------------------------------------------------
// El modelo
// ------------------------------------------------------------

test('capasDeAudioEn(5) con voz en A1 y musica en A2 devuelve LAS DOS', () => {
  const { m, voz, musica, a1, a2 } = vozYMusica();
  assert.notEqual(a1, a2);
  const capas = M.capasDeAudioEn(m, 5);
  assert.deepStrictEqual(capas.map((c) => c.mediaId).sort(), [voz, musica].sort());
  assert.ok(capas.every((c) => c.clase === 'audio' && c.ganancia === 1 && cerca(c.tFuente, 5)));
  // capaDeAudioEn (el visor, un solo <video>) sigue dando una: la primera.
  assert.equal(M.capaDeAudioEn(m, 5).clipId, capas[0].clipId);
  // Pasado el final de la voz solo queda la musica.
  assert.deepStrictEqual(M.capasDeAudioEn(m, 30).map((c) => c.mediaId), [musica]);
});

test('una pista silenciada no suena; `visible` ya no es el mute, salvo en audio viejo', () => {
  const { m, a2, voz } = vozYMusica();
  const sinMusica = M.actualizarPista(m, a2, { silenciada: true });
  assert.deepStrictEqual(M.capasDeAudioEn(sinMusica, 5).map((c) => c.mediaId), [voz]);
  // Un proyecto guardado con la pista de audio "oculta" la tenia muda: se
  // sigue leyendo asi para no hacerla sonar de golpe.
  const oculta = M.actualizarPista(m, a2, { visible: false });
  assert.ok(M.pistaSilenciada(M.pistaPorId(oculta, a2)));
  assert.deepStrictEqual(M.capasDeAudioEn(oculta, 5).map((c) => c.mediaId), [voz]);
  // Una pista de VIDEO oculta no silencia nada: su sonido esta en A1.
  const v1 = m.pistas.find((p) => p.tipo === 'video').id;
  assert.equal(M.capasDeAudioEn(M.actualizarPista(m, v1, { visible: false }), 5).length, 2);
  assert.ok(!M.pistaSilenciada(M.pistaPorId(m, v1)));
});

test('ganancia de pista por volumen de clip; 0 no suena; valores raros se acotan', () => {
  const { m, a1, a2, v1, clipVoz } = vozYMusica();
  let x = M.actualizarPista(m, a2, { ganancia: 0.25 });
  x = M.ajustarVolumen(x, v1, clipVoz, 2);   // desde la IMAGEN: cambia su sonido
  const porPista = Object.fromEntries(M.capasDeAudioEn(x, 5).map((c) => [c.pistaId, c.ganancia]));
  assert.equal(porPista[a2], 0.25);
  assert.equal(porPista[a1], 2);
  assert.equal(M.capasDeAudioEn(M.actualizarPista(m, a2, { ganancia: 0 }), 5).length, 1);
  assert.equal(M.gananciaDe(M.pistaPorId(M.actualizarPista(m, a2, { ganancia: 50 }), a2)), M.GANANCIA_MAX);
  assert.equal(M.gananciaDe(M.pistaPorId(M.actualizarPista(m, a2, { ganancia: -3 }), a2)), 0);
  assert.equal(M.gananciaDe(M.pistaPorId(M.actualizarPista(m, a2, { ganancia: 'hola' }), a2)), 1);
});

test('el volumen viaja con el clip al cortarlo, y volver a 1 saca el campo', () => {
  const { m, a1, v1, clipVoz } = vozYMusica();
  let x = M.ajustarVolumen(m, v1, clipVoz, 0.5);
  x = M.cortarEn(x, v1, 10);
  assert.ok(M.elementosDePista(x, a1).every((e) => e.volumen === 0.5));
  const vuelta = M.ajustarVolumen(x, v1, M.elementosDePista(x, v1)[0].id, 1);
  assert.ok(!('volumen' in M.elementosDePista(vuelta, a1)[0]));
  assert.deepStrictEqual(M.verificarMontaje(vuelta), []);
});

test('un proyecto viejo (sin ganancia ni silenciada) suena con los valores por defecto', () => {
  const m = JSON.parse(JSON.stringify(viejo.montaje));
  const capas = M.capasDeAudioEn(m, 100);
  assert.equal(capas.length, 1);
  assert.equal(capas[0].ganancia, 1);
  // Y el hueco de 190,37..192,51 no suena.
  assert.equal(M.capasDeAudioEn(m, 191).length, 0);
  const tramos = A.tramosDeAudio(m, 0, M.duracionMontaje(m));
  assert.equal(tramos.length, 6);
});

// ------------------------------------------------------------
// Los tramos
// ------------------------------------------------------------

test('tramosDeAudio recorta a [desde, hasta) y calcula la fuente del recorte', () => {
  const { m, a1, v1 } = vozYMusica();
  let x = M.cortarEn(m, v1, 8);
  x = M.borrar(x, v1, M.elementosDePista(x, v1)[0].id);   // se va 0..8 de imagen y sonido
  const tramos = A.tramosDeAudio(x, 10, 30);
  const deVoz = tramos.filter((t) => t.pistaId === a1);
  assert.equal(deVoz.length, 1);
  assert.ok(cerca(deVoz[0].lineaIn, 10) && cerca(deVoz[0].lineaOut, 20) && cerca(deVoz[0].fuenteIn, 10));
  assert.equal(A.tramosDeAudio(M.actualizarPista(x, a1, { silenciada: true }), 0, 30).filter((t) => t.pistaId === a1).length, 0);
});

// ------------------------------------------------------------
// La mezcla
// ------------------------------------------------------------

// Un lector falso: el archivo vale `nivel` constante (o una rampa si se
// pasa `fn(t)`), entregado en pedazos de 1024 muestras a `frecuencia`.
function lectorFalso(tramo, { nivel = 0.5, frecuencia = 48000, canales = 1, fn = null, fin = Infinity, registro } = {}) {
  let t = Math.floor(tramo.fuenteIn * frecuencia) / frecuencia;
  const hasta = Math.min(fin, tramo.fuenteIn + (tramo.lineaOut - tramo.lineaIn) + 0.1);
  const r = { abierto: true, pedidos: 0 };
  if (registro) registro.push(r);
  return {
    async siguiente() {
      if (t >= hasta) return null;
      r.pedidos++;
      const n = 1024;
      const planos = [];
      for (let c = 0; c < canales; c++) {
        const p = new Float32Array(n);
        for (let i = 0; i < n; i++) p[i] = fn ? fn(t + i / frecuencia, c) : nivel;
        planos.push(p);
      }
      const pedazo = { timestamp: t, frecuencia, planos };
      t += n / frecuencia;
      return pedazo;
    },
    cerrar() { r.abierto = false; }
  };
}

async function mezclarTodo(tramos, duracion, opcionesLector, extra) {
  const bloques = [];
  const registro = [];
  const mez = A.crearMezclador({
    tramos, duracion, frecuencia: 48000, canales: 2, muestrasPorBloque: 4800,
    abrirFuente: (tramo) => lectorFalso(tramo, { registro, ...(typeof opcionesLector === 'function' ? opcionesLector(tramo) : opcionesLector) }),
    agregarBloque: async (b) => { bloques.push(b); if (extra && extra.alBloque) extra.alBloque(mez, registro); },
    ...(extra || {})
  });
  return { mez, bloques, registro };
}

const muestraEn = (bloques, t, canal = 0) => {
  const j = Math.round(t * 48000);
  for (const b of bloques) {
    const i0 = Math.round(b.timestamp * 48000);
    if (j >= i0 && j < i0 + b.muestras) return b.planos[canal][j - i0];
  }
  return undefined;
};

test('voz + musica: el mp4 suena con las dos, sumadas con su ganancia', async () => {
  const { m, a1, a2 } = vozYMusica();
  const x = M.actualizarPista(m, a2, { ganancia: 0.5 });
  const tramos = A.tramosDeAudio(x, 0, 25);
  const { mez, bloques } = await mezclarTodo(tramos, 25, (tr) => ({ nivel: tr.pistaId === a1 ? 0.4 : 0.2 }));
  await mez.terminar();
  assert.ok(cerca(muestraEn(bloques, 5), 0.4 + 0.5 * 0.2, 1e-6), `t=5 voz+musica: ${muestraEn(bloques, 5)}`);
  assert.ok(cerca(muestraEn(bloques, 5, 1), 0.4 + 0.5 * 0.2, 1e-6), 'mono va a los dos canales');
  assert.ok(cerca(muestraEn(bloques, 22), 0.1, 1e-6), `t=22 solo musica: ${muestraEn(bloques, 22)}`);
  const total = bloques.reduce((a, b) => a + b.muestras, 0);
  assert.equal(total, 25 * 48000, 'dura lo mismo que el video, en muestras enteras');
  assert.ok(bloques.every((b, i) => i === 0 || cerca(b.timestamp, bloques[i - 1].timestamp + bloques[i - 1].muestras / 48000, 1e-9)));
});

test('silencio donde no suena nada (un vacio) y recorte a [-1, 1] si la suma se pasa', async () => {
  let m = M.crearMontaje({ fps: 30 });
  let a;
  [m, a] = M.agregarMedia(m, { ruta: 'a.wav', tipo: 'audio', duracion: 10 });
  const [m1, i1] = M.colocarMedia(m, a, 0);
  const [m2] = M.colocarMedia(m1, a, 0);   // otra pista, encima
  let x = M.cortarEn(m2, i1.pistaId, 2);
  x = M.cortarEn(x, i1.pistaId, 3);
  x = M.borrar(x, i1.pistaId, M.elementosDePista(x, i1.pistaId)[1].id);
  const otra = x.pistas.find((p) => p.tipo === 'audio' && p.id !== i1.pistaId).id;
  x = M.actualizarPista(x, otra, { silenciada: true });
  const { mez, bloques } = await mezclarTodo(A.tramosDeAudio(x), 10, { nivel: 0.8 });
  await mez.terminar();
  assert.equal(muestraEn(bloques, 2.5), 0, 'el vacio de 2 a 3 es silencio');
  assert.ok(cerca(muestraEn(bloques, 1), 0.8, 1e-6));

  const fuerte = M.actualizarPista(x, otra, { silenciada: false });
  const r = await mezclarTodo(A.tramosDeAudio(fuerte), 10, { nivel: 0.8 });
  await r.mez.terminar();
  assert.equal(muestraEn(r.bloques, 1), 1, '0,8 + 0,8 se recorta a 1');
  assert.ok(cerca(muestraEn(r.bloques, 2.5), 0.8, 1e-6), 'en el vacio de una suena la otra');
});

test('cada muestra sale de su instante del archivo (tras un corte y a otra frecuencia)', async () => {
  // El archivo es una rampa: vale t/100 en el segundo t. Si la mezcla lee
  // el instante correcto, en la linea se ve el valor de la FUENTE.
  let m = M.crearMontaje({ fps: 25 });
  let a;
  [m, a] = M.agregarMedia(m, { ruta: 'rampa.wav', tipo: 'audio', duracion: 60 });
  let pista;
  [m, pista] = M.agregarPista(m, 'audio');
  m = M.sobrescribirEn(m, pista, 0, M.clip(a, 30, 32));
  m = M.sobrescribirEn(m, pista, 2, M.clip(a, 10, 12));
  const rampa = (t) => t / 100;
  for (const frecuencia of [48000, 44100]) {
    const { mez, bloques } = await mezclarTodo(A.tramosDeAudio(m), 4, { fn: rampa, frecuencia });
    await mez.terminar();
    assert.ok(cerca(muestraEn(bloques, 1), 0.31, 1e-4), `${frecuencia}: linea 1 = fuente 31 (${muestraEn(bloques, 1)})`);
    assert.ok(cerca(muestraEn(bloques, 2.5), 0.105, 1e-4), `${frecuencia}: linea 2,5 = fuente 10,5 (${muestraEn(bloques, 2.5)})`);
    assert.ok(cerca(muestraEn(bloques, 1.999), 0.31999, 1e-4), `${frecuencia}: justo antes del corte, el primer clip`);
  }
});

test('los lectores se abren cuando su tramo empieza y se cierran cuando termina: 40 cortes, pocos abiertos', async () => {
  let m = M.crearMontaje({ fps: 30 });
  let a;
  [m, a] = M.agregarMedia(m, { ruta: 'voz.wav', tipo: 'audio', duracion: 120 });
  let pista;
  [m, pista] = M.agregarPista(m, 'audio');
  for (let i = 0; i < 40; i++) m = M.sobrescribirEn(m, pista, i, M.clip(a, i * 2, i * 2 + 1));
  let maxAbiertas = 0;
  const { mez, registro } = await mezclarTodo(A.tramosDeAudio(m), 40, { nivel: 0.1 }, {
    alBloque: (mz) => { maxAbiertas = Math.max(maxAbiertas, mz.abiertas()); }
  });
  await mez.avanzarHasta(10);
  assert.ok(registro.length <= 11, `a los 10 s se abrieron ${registro.length}, no los 40`);
  await mez.terminar();
  assert.equal(registro.length, 40);
  assert.ok(maxAbiertas <= 2, `abiertas a la vez: ${maxAbiertas}`);
  assert.ok(registro.every((r) => !r.abierto), 'terminar cierra todo');
});

test('avanzarHasta entrega solo hasta ese instante (para intercalar con el video) y cerrar suelta todo', async () => {
  const { m } = vozYMusica();
  const { mez, bloques, registro } = await mezclarTodo(A.tramosDeAudio(m, 0, 25), 25, { nivel: 0.1 });
  await mez.avanzarHasta(1 / 30);
  assert.equal(bloques.length, 1, 'el primer cuadro de video necesita un bloque');
  await mez.avanzarHasta(1.05);
  assert.equal(bloques.reduce((s, b) => s + b.muestras, 0), 52800, 'hasta 1,1 s en bloques de 100 ms');
  assert.ok(registro.some((r) => r.abierto));
  mez.cerrar();
  assert.ok(registro.every((r) => !r.abierto), 'cancelar cierra los lectores');
  await mez.avanzarHasta(5);
  assert.equal(bloques.length, 11, 'cerrado no entrega mas');
});

test('un archivo que se acaba antes (o sin sonido) deja silencio, no se traba', async () => {
  const { m } = vozYMusica();
  const { mez, bloques } = await mezclarTodo(A.tramosDeAudio(m, 0, 25), 25, (tr) => ({ nivel: 0.3, fin: tr.fuenteIn + 1 }));
  await mez.terminar();
  assert.equal(muestraEn(bloques, 10), 0);
  assert.ok(cerca(muestraEn(bloques, 0.5), 0.6, 1e-6));
});

test('aPlanar pone todo el canal 0 y despues todo el canal 1', () => {
  const p = A.aPlanar([new Float32Array([1, 2]), new Float32Array([3, 4])]);
  assert.deepStrictEqual([...p], [1, 2, 3, 4]);
});
