// Tests del PLAN DE DIBUJO — el reemplazo del bloque
// "ACUERDO PREVIEW <-> EXPORT" (07/08/2026).
//
// De donde viene esto: la version anterior tenia dos cuentas separadas
// (el canvas del preview por un lado, `exportPlan.js` armando filtros de
// ffmpeg por el otro) y un bloque de tests que las comparaba para avisar
// cuando divergieran. `exportPlan.js` se borro el 06/08 y no se va a
// reescribir: la exportacion va a dibujar sobre el MISMO canvas.
//
// Asi que el acuerdo cambia de forma. Ya no es "que dos cuentas den lo
// mismo" sino "que haya una sola cuenta y que escale bien":
//
//   - el plan tiene que describir las MISMAS FRACCIONES a cualquier
//     resolucion. Componer a 640 y componer a 1920 son el mismo cuadro
//     con distinto tamaño, y si no lo son, el mp4 no va a mostrar lo que
//     se veia en pantalla;
//   - la resolucion de salida tiene que ser PAR, o el encode aborta.
//
// Estos son los tests que se caen si alguien vuelve a copiar la
// matematica de composicion a un segundo lugar y la toca.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const C = require('../src/shared/composicion');
const L916 = require('../src/shared/layout916');

// Montaje con un video de 1920x1080 puesto en V1, 0..60.
function base() {
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, {
    ruta: '/x/a.mp4', nombre: 'a.mp4', duracion: 60, ancho: 1920, alto: 1080
  });
  let v1, a1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  [m, a1] = M.agregarPista(m, 'audio', 'A1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 60));
  return { m, mediaId, v1, a1 };
}

const LIENZO_PREVIEW = { ancho: 640, alto: 360 };
const LIENZO_EXPORT = { ancho: 1920, alto: 1080 };
const SALIDA_916 = { ancho: 1080, alto: 1920 };

// Un plan llevado a fracciones del lienzo. Es la forma de comparar dos
// resoluciones sin que el tamaño moleste.
const enFracciones = (plan, capas) => (capas || plan.capas).map((c) => ({
  clipId: c.clipId,
  x: c.dest.x / plan.ancho, y: c.dest.y / plan.alto,
  w: c.dest.w / plan.ancho, h: c.dest.h / plan.alto
}));

const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ============================================================
// EL LIENZO
// ============================================================

test('un video que llena el lienzo se dibuja entero', () => {
  const { m } = base();

  const plan = C.planLienzo(m, 10, LIENZO_EXPORT);

  assert.strictEqual(plan.capas.length, 1);
  const d = plan.capas[0].dest;
  assert.ok(cerca(d.x, 0) && cerca(d.y, 0));
  assert.ok(cerca(d.w, 1920) && cerca(d.h, 1080));
});

test('la capa lleva de que instante del ARCHIVO sacar el cuadro', () => {
  const { m, v1 } = base();
  // Se corta y se corre, para que el tiempo de la linea deje de coincidir
  // con el del archivo — que es donde se rompe si alguien los confunde.
  const conCorte = M.cortarEn(m, v1, 20);
  const segundo = M.elementosDePista(conCorte, v1)[1];
  const movido = M.moverElemento(conCorte, v1, segundo.id, 50);

  const plan = C.planLienzo(movido, 55, LIENZO_EXPORT);

  assert.strictEqual(plan.capas.length, 1);
  // En t=55 de la linea, el clip empieza en 50 y su material arranca en
  // 20: el cuadro que va es el segundo 25 del archivo, no el 55.
  assert.ok(cerca(plan.capas[0].tFuente, 25),
    `esperaba 25 del archivo, dio ${plan.capas[0].tFuente}`);
});

test('un vacio no dibuja nada: el lienzo queda negro', () => {
  const { m, v1 } = base();
  const c = M.elementosDePista(m, v1)[0];
  const vacio = M.borrar(m, v1, c.id);

  const plan = C.planLienzo(vacio, 10, LIENZO_EXPORT);

  assert.strictEqual(plan.capas.length, 0);
  assert.strictEqual(plan.fondo, '#000');
});

test('las capas salen de ABAJO hacia ARRIBA (la ultima tapa)', () => {
  let { m, mediaId } = base();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v2, 0, M.clip(mediaId, 0, 60));

  const plan = C.planLienzo(m, 10, LIENZO_EXPORT);

  const pistas = m.pistas.filter(M.esVisual).map((p) => p.id);
  assert.deepStrictEqual(plan.capas.map((c) => c.pistaId), pistas);
});

test('un encuadre no entra como capa de imagen: va aparte', () => {
  let { m } = base();
  [m] = M.colocarEncuadre(m, 0, 30, { xPct: 0.2, yPct: 0, wPct: 0.5, hPct: 1 });

  const plan = C.planLienzo(m, 10, LIENZO_EXPORT);

  assert.strictEqual(plan.capas.length, 1, 'solo el video se dibuja');
  assert.strictEqual(plan.ajustes.length, 1);
  assert.ok(cerca(plan.ajustes[0].rect.wPct, 0.5));
});

test('un material sin medir se avisa, no se descarta en silencio', () => {
  let m = M.crearMontaje();
  let mediaId, v1;
  // Sin ancho/alto: es lo que pasa si ffprobe fallo al importar.
  [m, mediaId] = M.agregarMedia(m, { ruta: '/x/b.mp4', nombre: 'b.mp4', duracion: 30 });
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 30));

  const plan = C.planLienzo(m, 5, LIENZO_EXPORT);

  assert.strictEqual(plan.capas.length, 0);
  assert.strictEqual(plan.sinMedidas.length, 1,
    'la exportacion tiene que poder fallar con un motivo');
  assert.strictEqual(plan.sinMedidas[0].mediaId, mediaId);
});

test('las medidas reales del decodificador le ganan a las de ffprobe', () => {
  const { m, mediaId } = base();

  // El archivo decia 1920x1080; el decodificador dice que en realidad es
  // vertical. Manda el decodificador: es lo que se va a dibujar.
  const plan = C.planLienzo(m, 10, LIENZO_EXPORT, { [mediaId]: { ancho: 1080, alto: 1920 } });

  const d = plan.capas[0].dest;
  assert.ok(cerca(d.h, 1080), 'entra entero de alto');
  assert.ok(cerca(d.w, 607.5), `y deja franjas al costado, dio ${d.w}`);
});

// ============================================================
// EL ACUERDO: EL MISMO PLAN A CUALQUIER RESOLUCION
// ============================================================

test('ACUERDO: el lienzo a 640 y a 1920 describe las mismas fracciones', () => {
  let { m, mediaId, v1 } = base();
  // Un caso con transformacion, que es donde hay cuentas de verdad.
  const c = M.elementosDePista(m, v1)[0];
  m = M.transformar(m, v1, c.id, { escala: 1.37, x: -0.11, y: 0.07 });
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v2, 0, M.clip(mediaId, 0, 60));
  const c2 = M.elementosDePista(m, v2)[0];
  m = M.transformar(m, v2, c2.id, { escala: 0.41, x: 0.29, y: -0.33 });

  const chico = C.planLienzo(m, 10, LIENZO_PREVIEW);
  const grande = C.planLienzo(m, 10, LIENZO_EXPORT);

  assert.strictEqual(chico.capas.length, 2);
  const a = enFracciones(chico), b = enFracciones(grande);
  a.forEach((f, i) => {
    assert.strictEqual(f.clipId, b[i].clipId);
    ['x', 'y', 'w', 'h'].forEach((k) => {
      assert.ok(cerca(f[k], b[i][k], 1e-12),
        `${k} difiere: preview ${f[k]} vs export ${b[i][k]}`);
    });
  });
});

test('ACUERDO: el panel vertical a 400 y a 1080 describe las mismas fracciones', () => {
  let { m } = base();
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 60, { xPct: 0.333, yPct: 0.111, wPct: 0.407, hPct: 0.29 });
  const layout = L916.normalizar(L916.layoutVacio(), [info.clipId]);

  // 540x960 es EXACTAMENTE la mitad de 1080x1920. Que sea proporcional no
  // es un detalle del test: ver el test siguiente.
  const chico = C.planVertical(m, 10, LIENZO_PREVIEW, { ancho: 540, alto: 960 }, layout);
  const grande = C.planVertical(m, 10, LIENZO_EXPORT, SALIDA_916, layout);

  assert.strictEqual(chico.celdas.length, 1);
  assert.strictEqual(grande.celdas.length, 1);

  // El DESTINO, en fracciones de la salida.
  const fd = (p) => ({
    x: p.celdas[0].dest.x / p.ancho, y: p.celdas[0].dest.y / p.alto,
    w: p.celdas[0].dest.w / p.ancho, h: p.celdas[0].dest.h / p.alto
  });
  const dChico = fd(chico), dGrande = fd(grande);
  ['x', 'y', 'w', 'h'].forEach((k) => assert.ok(cerca(dChico[k], dGrande[k], 1e-9), `destino ${k}`));

  // Y el ORIGEN, en fracciones del lienzo del que se recorta.
  const fs = (p, o) => ({
    x: p.celdas[0].src.x / o.ancho, y: p.celdas[0].src.y / o.alto,
    w: p.celdas[0].src.w / o.ancho, h: p.celdas[0].src.h / o.alto
  });
  const sChico = fs(chico, LIENZO_PREVIEW), sGrande = fs(grande, LIENZO_EXPORT);
  ['x', 'y', 'w', 'h'].forEach((k) => assert.ok(cerca(sChico[k], sGrande[k], 1e-9),
    `origen ${k}: preview ${sChico[k]} vs export ${sGrande[k]}`));
});

// ESTE TEST EXISTE POR ALGO QUE FALLO AL ESCRIBIRLO. La primera version
// comparaba el preview a 400x711 contra la salida a 1080x1920 y no daba:
// los origenes diferian en la sexta cifra. No era un error de redondeo -
// era el recorte "cover", que depende de la FORMA del destino, y 400x711
// no es exactamente 9:16.
//
// O sea: si el buffer del preview no tiene la misma proporcion que la
// salida, lo que se ve NO es lo que se exporta. Hoy no pasa porque
// `#canvas916` esta fijo en 1080x1920 (index.html) y el CSS solo lo
// escala para mostrarlo. Este test es para que nadie lo "optimice" mas
// adelante ajustando el buffer al tamaño del panel en pantalla, que
// parece una mejora y rompe el WYSIWYG en silencio.
test('si el buffer del preview no es proporcional a la salida, el recorte cambia', () => {
  let { m } = base();
  let info;
  [m, info] = M.colocarEncuadre(m, 0, 60, { xPct: 0.333, yPct: 0.111, wPct: 0.407, hPct: 0.29 });
  const layout = L916.normalizar(L916.layoutVacio(), [info.clipId]);

  const bueno = C.planVertical(m, 10, LIENZO_EXPORT, { ancho: 540, alto: 960 }, layout);
  const torcido = C.planVertical(m, 10, LIENZO_EXPORT, { ancho: 400, alto: 711 }, layout);
  const salida = C.planVertical(m, 10, LIENZO_EXPORT, SALIDA_916, layout);

  assert.ok(cerca(bueno.celdas[0].src.x, salida.celdas[0].src.x, 1e-9),
    'proporcional: recorta lo mismo que la salida');
  assert.ok(!cerca(torcido.celdas[0].src.x, salida.celdas[0].src.x, 1e-9),
    'no proporcional: recorta OTRA cosa — por eso el buffer va fijo en 9:16');
});

test('ACUERDO: el recorte nunca pide pixeles fuera del lienzo', () => {
  const casos = [
    { xPct: 0, yPct: 0, wPct: 1, hPct: 1 },
    { xPct: 0.1, yPct: 0.2, wPct: 0.5, hPct: 0.5 },
    { xPct: 0.333, yPct: 0.111, wPct: 0.407, hPct: 0.29 },
    { xPct: 0.6, yPct: 0.05, wPct: 0.39, hPct: 0.9 }
  ];

  for (const rect of casos) {
    let { m } = base();
    let info;
    [m, info] = M.colocarEncuadre(m, 0, 60, rect);
    const layout = L916.normalizar(L916.layoutVacio(), [info.clipId]);

    const plan = C.planVertical(m, 10, LIENZO_EXPORT, SALIDA_916, layout);
    const s = plan.celdas[0].src;

    assert.ok(s.x >= -1e-9 && s.y >= -1e-9, `origen negativo con ${JSON.stringify(rect)}`);
    assert.ok(s.x + s.w <= LIENZO_EXPORT.ancho + 1e-6, 'no se sale por la derecha');
    assert.ok(s.y + s.h <= LIENZO_EXPORT.alto + 1e-6, 'no se sale por abajo');
    assert.ok(s.w > 0 && s.h > 0, 'el recorte tiene que ser usable');
  }
});

test('sin encuadres el panel vertical queda negro, no a medias', () => {
  const { m } = base();

  const plan = C.planVertical(m, 10, LIENZO_EXPORT, SALIDA_916, L916.layoutVacio());

  assert.strictEqual(plan.celdas.length, 0);
  assert.strictEqual(plan.ancho, 1080);
});

test('dos encuadres a la vez dan dos celdas que no se pisan', () => {
  let { m } = base();
  let a, b;
  [m, a] = M.colocarEncuadre(m, 0, 60, { xPct: 0, yPct: 0, wPct: 0.5, hPct: 1 });
  [m, b] = M.colocarEncuadre(m, 0, 60, { xPct: 0.5, yPct: 0, wPct: 0.5, hPct: 1 });
  const layout = L916.normalizar(L916.layoutVacio(), [a.clipId, b.clipId]);

  const plan = C.planVertical(m, 10, LIENZO_EXPORT, SALIDA_916, layout);

  assert.strictEqual(plan.celdas.length, 2);
  const [p, q] = plan.celdas.map((c) => c.dest);
  const seSuperponen = p.x < q.x + q.w && q.x < p.x + p.w &&
                       p.y < q.y + q.h && q.y < p.y + p.h;
  assert.ok(!seSuperponen, 'el layout por defecto no puede encimarlas');
});

// ============================================================
// RESOLUCION DE SALIDA
// ============================================================

test('la resolucion de salida siempre es par', () => {
  // Un ancho impar no da un video apenas distinto: aborta el encode.
  assert.deepStrictEqual(C.resolucionSalida(1081, 1921), { ancho: 1080, alto: 1920 });
  assert.deepStrictEqual(C.resolucionSalida(1920, 1080), { ancho: 1920, alto: 1080 });
});

test('redondea hacia ABAJO: nunca pide pixeles que no existen', () => {
  assert.strictEqual(C.aPar(101), 100);
  assert.strictEqual(C.aPar(1), 2, 'pero no baja de 2: un lado de 0 no es un video');
  assert.strictEqual(C.aPar(0), 2);
});
