// Tests del BUCLE DE EXPORTACION (13/09/2026, 1.3.b).
//
// El bucle real corre en la ventana con WebCodecs, que en node no existe.
// Pero lo que puede salir mal SIN que se note al mirar el mp4 de un clip
// de prueba es aritmetica y orden, y eso vive en GuionExport:
//
//   - a cuantos fps sale (el material lo dice; antes se tiraba el dato);
//   - que cuadro del archivo se pide (el centro del cuadro, para que el
//     redondeo a milisegundo de un mkv no repita ni saltee cuadros);
//   - cuantos decodificadores quedan vivos a la vez (40 cortes no pueden
//     ser 40 VideoDecoder abiertos);
//   - que cada cuadro decodificado se cierre (si no, la GPU se llena y el
//     export se traba a los pocos cientos de cuadros).
//
// Los lectores y el codificador de estos tests son falsos a proposito.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const G = require('../src/shared/guionExport');

const LIENZO = { ancho: 1920, alto: 1080 };

function conMedia(datos) {
  let m = M.crearMontaje();
  let id;
  [m, id] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 60, ancho: 1920, alto: 1080, ...datos });
  return [m, id];
}

// ---------- fps de salida ----------

test('los fps de un celular (cuadro variable) se llevan al estandar mas cercano', () => {
  const NTSC30 = 30000 / 1001, NTSC60 = 60000 / 1001;
  assert.equal(G.normalizarFps(29.87), NTSC30);
  assert.equal(G.normalizarFps(29.97), NTSC30);
  assert.equal(G.normalizarFps(30.02), 30);
  assert.equal(G.normalizarFps(30000 / 1001), NTSC30);
  assert.equal(G.normalizarFps(59.7), NTSC60);
  assert.equal(G.normalizarFps(25), 25);
  // Uno raro de verdad se respeta: no es un celular con jitter.
  assert.equal(G.normalizarFps(15), 15);
  assert.equal(G.normalizarFps(12.5), 12.5);
  assert.equal(G.normalizarFps(0), 0);
  assert.equal(G.normalizarFps(NaN), 0);
  assert.equal(G.normalizarFps(1000), 120);
});

test('el fps sale del material (el dato que ffprobe media y se tiraba)', () => {
  let [m, id] = conMedia({ fps: 25 });
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(id, 0, 10));
  assert.equal(G.fpsDeMontaje(m), 25);
});

test('lo que elige el user le gana al material; 0 significa "el del original"', () => {
  let [m, id] = conMedia({ fps: 25 });
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(id, 0, 10));
  assert.equal(G.fpsDeMontaje(m, { preferido: 60 }), 60);
  assert.equal(G.fpsDeMontaje(m, { preferido: 0 }), 25);
});

test('con material mezclado manda el PRIMER clip de la linea, no el primero importado', () => {
  let m = M.crearMontaje();
  let a, b, v1, v2;
  [m, a] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 60, ancho: 1920, alto: 1080, fps: 25 });
  [m, b] = M.agregarMedia(m, { ruta: '/x/b.mp4', duracion: 60, ancho: 1920, alto: 1080, fps: 29.97 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  // `a` se importo primero pero entra en la linea a los 5 s; `b` arranca en 0.
  m = M.sobrescribirEn(m, v1, 5, M.clip(a, 0, 10));
  m = M.sobrescribirEn(m, v2, 0, M.clip(b, 0, 10));
  assert.equal(G.fpsDeMontaje(m), 30000 / 1001);
});

test('empate en el inicio: manda la pista de abajo (la base del lienzo)', () => {
  let m = M.crearMontaje();
  let a, b, v1, v2;
  [m, a] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 60, ancho: 1920, alto: 1080, fps: 25 });
  [m, b] = M.agregarMedia(m, { ruta: '/x/b.mp4', duracion: 60, ancho: 1920, alto: 1080, fps: 60 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v2, 0, M.clip(b, 0, 10));
  m = M.sobrescribirEn(m, v1, 0, M.clip(a, 0, 10));
  assert.equal(G.fpsDeMontaje(m), 25);
});

test('un encuadre o un material sin fps no deciden: se sigue buscando', () => {
  let m = M.crearMontaje();
  let a, b, v1, v2;
  [m, a] = M.agregarMedia(m, { ruta: '/x/a.mp4', duracion: 60, ancho: 1920, alto: 1080 });
  [m, b] = M.agregarMedia(m, { ruta: '/x/b.mp4', duracion: 60, ancho: 1920, alto: 1080, fps: 50 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v1, 0, M.clip(a, 0, 5));
  m = M.sobrescribirEn(m, v1, 5, M.clip(b, 0, 5));
  m = M.sobrescribirEn(m, v2, 0, M.encuadre(0, 10));
  assert.equal(G.fpsDeMontaje(m), 50);
});

// ---------- que instante se le pide al decodificador ----------

// Simula lo que hace el decodificador: el ultimo cuadro con timestamp <= t.
function cuadroEn(timestamps, t) {
  let k = -1;
  for (let i = 0; i < timestamps.length; i++) if (timestamps[i] - t <= 1e-10) k = i;
  return k;
}

const NTSC = 30000 / 1001;
// Como guarda los tiempos un mkv: redondeados al milisegundo.
const archivoMkv = Array.from({ length: 900 }, (_, i) => Math.round((i / NTSC) * 1000) / 1000);

// Un clip que usa el material desde `usadoIn`: que cuadro del archivo sale
// en cada cuadro de salida.
function cuadrosDelClip(usadoIn, fpsFuente) {
  const pedidos = G.instantes(NTSC, 0, 5).map((t) => usadoIn + t);
  return G.tiemposParaLector(pedidos, NTSC, fpsFuente).map((t) => cuadroEn(archivoMkv, t));
}

function sinRepetidosNiSalteados(cuadros) {
  for (let i = 1; i < cuadros.length; i++) {
    if (cuadros[i] !== cuadros[i - 1] + 1) return `cuadro ${i}: ${cuadros[i - 1]} -> ${cuadros[i]}`;
  }
  return null;
}

test('mkv redondeado a milisegundo: ni el clip que arranca en 0 ni uno cortado en 2,000 s repiten cuadros', () => {
  // Arrancar en 0 es el caso donde pedir el instante "crudo" falla: cada
  // pedido cae justo en un borde y el redondeo del archivo lo corre.
  const crudo = G.instantes(NTSC, 0, 5).map((t) => cuadroEn(archivoMkv, t));
  assert.ok(sinRepetidosNiSalteados(crudo), 'sin correccion tendria que fallar (si no, el test no prueba nada)');

  // Cortado en 2,000 s es el caso que rompio el primer arreglo (+2 ms),
  // visto exportando de verdad: los pedidos quedaban 2 ms antes de cada
  // borde y el sesgo los dejaba encima.
  const sesgoViejo = G.tiemposParaLector(G.instantes(NTSC, 0, 5).map((t) => 2 + t), NTSC, 0)
    .map((t) => cuadroEn(archivoMkv, t));
  assert.ok(sinRepetidosNiSalteados(sesgoViejo), 'el sesgo solo tendria que fallar en este corte');

  for (const usadoIn of [0, 2, 2.002, 12, 7.3337, 0.0166]) {
    assert.equal(sinRepetidosNiSalteados(cuadrosDelClip(usadoIn, NTSC)), null, `usadoIn=${usadoIn}`);
  }
});

test('pedir el centro del cuadro corre la imagen como mucho medio cuadro, aunque el fps no sea exacto', () => {
  const fpsFuente = 29.87;   // promedio de un celular
  const ts = Array.from({ length: 2000 }, (_, i) => i * 0.0137);
  const pedidos = G.tiemposParaLector(ts, 30, fpsFuente);
  pedidos.forEach((p, i) => assert.ok(Math.abs(p - ts[i]) <= 0.5 / fpsFuente + 1e-9));
  // Y siguen ordenados: es la condicion que hace rapido al decodificador.
  for (let i = 1; i < pedidos.length; i++) assert.ok(pedidos[i] >= pedidos[i - 1]);
});

test('sin fps del material queda un sesgo chico, que nunca alcanza al cuadro siguiente', () => {
  assert.ok(G.sesgoDeLectura(30) <= 0.002);
  assert.ok(G.sesgoDeLectura(120) < 1 / 120 / 2);
  assert.ok(G.sesgoDeLectura(240) <= 0.25 / 240);
  assert.equal(G.tiemposParaLector([1], 30, 0)[0], 1.002);
});

// ---------- lo que impide exportar ----------

test('un montaje sin encuadres no se exporta en vertical, pero si en horizontal', () => {
  let [m, id] = conMedia({});
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(id, 0, 2));
  const g = G.guionDeExport(m, { fps: 10, hasta: 2, lienzo: LIENZO });
  assert.equal(G.problemasDeExport(m, g, 'vertical').length, 1);
  assert.match(G.problemasDeExport(m, g, 'vertical')[0], /encuadre/);
  assert.deepEqual(G.problemasDeExport(m, g, 'horizontal'), []);
});

test('un montaje vacio o con material ilegible dice POR QUE no se exporta', () => {
  const vacio = M.crearMontaje();
  assert.match(G.problemasDeExport(vacio, G.guionDeExport(vacio, { hasta: 0 }), 'horizontal')[0], /vacio/);

  let m = M.crearMontaje();
  let id, v1;
  [m, id] = M.agregarMedia(m, { ruta: '/x/roto.mp4', nombre: 'roto.mp4', duracion: 5 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(id, 0, 5));
  const g = G.guionDeExport(m, { fps: 10, hasta: 5, lienzo: LIENZO });
  const p = G.problemasDeExport(m, g, 'horizontal');
  assert.equal(p.length, 1);
  assert.match(p[0], /roto\.mp4/);
});

// ---------- que dibujar ----------

test('se dibuja en el orden del PLAN (de abajo hacia arriba), no en el de las muestras', () => {
  const plan = { capas: [{ clipId: 'abajo', dest: { x: 0 } }, { clipId: 'medio', dest: { x: 1 } }, { clipId: 'arriba', dest: { x: 2 } }] };
  // El Map viene en otro orden y una capa sin cuadro (null).
  const muestras = new Map([['arriba', 'A'], ['medio', null], ['abajo', 'B']]);
  const pasos = G.pasosDeDibujo(plan, muestras);
  assert.deepEqual(pasos.map((p) => p.clipId), ['abajo', 'arriba']);
  assert.equal(pasos[1].muestra, 'A');
  assert.deepEqual(pasos[1].dest, { x: 2 });
});

// ---------- el bucle ----------

// Un montaje con N cortes seguidos en V1 (N clips que nunca se superponen)
// y un clip largo en V2 encima de todo.
function montajeConCortes(n) {
  let [m, id] = conMedia({ duracion: 600 });
  let v1, v2;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  for (let i = 0; i < n; i++) m = M.sobrescribirEn(m, v1, i, M.clip(id, i * 10, i * 10 + 1));
  m = M.sobrescribirEn(m, v2, 0, M.clip(id, 500, 500 + n));
  return m;
}

function falsos(opciones) {
  const o = opciones || {};
  const reg = { abiertosMax: 0, abiertos: 0, aperturas: 0, cierres: 0, muestrasVivas: new Set(), cuadros: [], pedidos: new Map(), dibujos: [] };
  let serie = 0;
  const deps = {
    abrirLector: async (clip) => {
      reg.aperturas++;
      reg.abiertos++;
      reg.abiertosMax = Math.max(reg.abiertosMax, reg.abiertos);
      let k = 0;
      reg.pedidos.set(clip.clipId, []);
      let cerrado = false;
      return {
        siguiente: async () => {
          const t = clip.tiempos[k++];
          reg.pedidos.get(clip.clipId).push(t);
          const muestra = { id: serie++, t, close() { reg.muestrasVivas.delete(this); } };
          reg.muestrasVivas.add(muestra);
          return muestra;
        },
        cerrar: () => {
          if (cerrado) return;
          cerrado = true;
          reg.abiertos--;
          reg.cierres++;
        }
      };
    },
    componer: async (i, tLinea, muestras) => {
      if (o.fallarEn === i) throw new Error('fallo al dibujar');
      reg.dibujos.push([...muestras.keys()]);
    },
    agregarCuadro: async (t, dur) => { reg.cuadros.push([t, dur]); },
    cancelado: () => o.cancelarEn != null && reg.cuadros.length >= o.cancelarEn
  };
  return { reg, deps };
}

test('los decodificadores se abren cuando el clip entra y se cierran cuando sale', async () => {
  const m = montajeConCortes(40);
  const g = G.guionDeExport(m, { fps: 10, hasta: 40, lienzo: LIENZO });
  assert.equal(g.clips.length, 41);

  const { reg, deps } = falsos();
  const r = await G.ejecutarGuion(g, deps);

  assert.deepEqual(r, { cuadros: 400, cancelado: false });
  assert.equal(reg.aperturas, 41);
  assert.equal(reg.cierres, 41);
  // 40 cortes seguidos + el clip de arriba: nunca mas de DOS vivos a la
  // vez. Abrirlos todos al principio serian 41 VideoDecoder.
  assert.equal(reg.abiertosMax, 2);
});

test('cada cuadro decodificado se cierra, y a cada lector se le piden SUS tiempos en orden', async () => {
  const m = montajeConCortes(3);
  const g = G.guionDeExport(m, { fps: 10, hasta: 3, lienzo: LIENZO });
  const { reg, deps } = falsos();
  await G.ejecutarGuion(g, deps);

  assert.equal(reg.muestrasVivas.size, 0, 'quedaron VideoFrame sin cerrar');
  for (const clip of g.clips) assert.deepEqual(reg.pedidos.get(clip.clipId), clip.tiempos);
  // En cada cuadro se compone con los dos clips visibles (V1 y V2).
  assert.ok(reg.dibujos.every((ids) => ids.length === 2));
});

test('los timestamps del mp4 son i/fps, sin acumular error', async () => {
  let [m, id] = conMedia({});
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(id, 0, 20));
  const fps = 30000 / 1001;
  const g = G.guionDeExport(m, { fps, hasta: 20, lienzo: LIENZO });
  const { reg, deps } = falsos();
  await G.ejecutarGuion(g, deps);

  const ultimo = reg.cuadros.length - 1;
  assert.equal(reg.cuadros[ultimo][0], ultimo / fps);
  assert.equal(reg.cuadros[0][1], 1 / fps);
});

test('cancelar corta limpio: sin lectores abiertos ni cuadros sin cerrar', async () => {
  const m = montajeConCortes(5);
  const g = G.guionDeExport(m, { fps: 10, hasta: 5, lienzo: LIENZO });
  const { reg, deps } = falsos({ cancelarEn: 15 });
  const r = await G.ejecutarGuion(g, deps);

  assert.deepEqual(r, { cuadros: 15, cancelado: true });
  assert.equal(reg.abiertos, 0);
  assert.equal(reg.muestrasVivas.size, 0);
});

test('si dibujar falla, el error sube y no quedan decodificadores vivos', async () => {
  const m = montajeConCortes(5);
  const g = G.guionDeExport(m, { fps: 10, hasta: 5, lienzo: LIENZO });
  const { reg, deps } = falsos({ fallarEn: 12 });
  await assert.rejects(G.ejecutarGuion(g, deps), /fallo al dibujar/);
  assert.equal(reg.abiertos, 0);
  assert.equal(reg.muestrasVivas.size, 0);
});

test('un hueco en todas las pistas igual produce su cuadro (negro), no se saltea', async () => {
  let [m, id] = conMedia({});
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(id, 0, 1));
  m = M.sobrescribirEn(m, v1, 2, M.clip(id, 5, 6));
  const g = G.guionDeExport(m, { fps: 10, hasta: 3, lienzo: LIENZO });
  const { reg, deps } = falsos();
  await G.ejecutarGuion(g, deps);
  assert.equal(reg.cuadros.length, 30, 'si faltaran cuadros el video se acortaria y el audio (cuando exista) se correria');
  assert.deepEqual(reg.dibujos[15], []);
});
