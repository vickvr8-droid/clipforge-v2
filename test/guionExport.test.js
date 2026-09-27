// Tests del GUION DE EXPORTACION (08/08/2026).
//
// Lo que estos tests protegen no es "que la cuenta de un numero lindo",
// sino la restriccion de rendimiento que obliga a que este modulo exista:
//
//   pedirle cuadros a un archivo POR LOTE ORDENADO cuesta 2,5 ms cada uno;
//   pedirselos DE A UNO cuesta 72,7 ms  (medido en Chromium, 1080p h264).
//
// O sea que si alguien "simplifica" esto y hace que el export pida el
// cuadro que necesita en el momento, la exportacion se vuelve 29 veces
// mas lenta sin que se rompa ni un test... salvo estos.
//
// Por eso el test que mas importa es el de que los tiempos de cada clip
// salgan ORDENADOS. Es la condicion que hace rapido al decodificador.

const test = require('node:test');
const assert = require('node:assert');

const M = require('../src/shared/montaje');
const G = require('../src/shared/guionExport');

// Montaje con un video de 1920x1080 en V1, 0..60.
function base() {
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, {
    ruta: '/x/a.mp4', nombre: 'a.mp4', duracion: 60, ancho: 1920, alto: 1080
  });
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 60));
  return { m, mediaId, v1 };
}

const LIENZO = { ancho: 1920, alto: 1080 };

// ---------- instantes ----------

test('los instantes salen a paso fijo y sin arrastrar error', () => {
  const ts = G.instantes(30, 0, 10);
  assert.equal(ts.length, 300);
  assert.equal(ts[0], 0);
  // Si se hubiera ido sumando 1/30 en vez de calcular i/30, para el
  // cuadro 299 el error ya seria visible. Con i/fps es exacto hasta el
  // ultimo decimal que importa.
  assert.ok(Math.abs(ts[299] - 299 / 30) < 1e-12);
});

test('un tramo que no arranca en cero conserva el paso', () => {
  const ts = G.instantes(25, 4, 6);
  assert.equal(ts.length, 50);
  assert.equal(ts[0], 4);
  assert.ok(Math.abs(ts[1] - (4 + 1 / 25)) < 1e-12);
});

test('un tramo vacio no produce cuadros', () => {
  assert.equal(G.instantes(30, 5, 5).length, 0);
  assert.equal(G.instantes(30, 8, 3).length, 0);
});

// ---------- el guion ----------

test('cada clip pide sus instantes ORDENADOS (es lo que hace rapido al decodificador)', () => {
  const { m, mediaId } = base();
  const g = G.guionDeExport(m, {
    fps: 30, desde: 0, hasta: 5, lienzo: LIENZO,
    fuentes: { [mediaId]: { ancho: 1920, alto: 1080 } }
  });

  assert.equal(g.clips.length, 1);
  const c = g.clips[0];
  assert.equal(c.tiempos.length, 150);
  for (let i = 1; i < c.tiempos.length; i++) {
    assert.ok(c.tiempos[i] >= c.tiempos[i - 1],
      `el instante ${i} (${c.tiempos[i]}) viene antes que el anterior (${c.tiempos[i - 1]})`);
  }
});

test('cada instante pedido sabe en que cuadro de salida va', () => {
  const { m, mediaId } = base();
  const g = G.guionDeExport(m, {
    fps: 10, desde: 0, hasta: 3, lienzo: LIENZO,
    fuentes: { [mediaId]: { ancho: 1920, alto: 1080 } }
  });
  const c = g.clips[0];
  assert.equal(c.tiempos.length, c.indices.length);
  assert.deepEqual(c.indices.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.equal(g.totalCuadros, 30);
});

test('dos clips del mismo material son DOS lectores, no uno', () => {
  // Es la razon por la que se agrupa por clipId y no por mediaId: dos
  // pedazos del mismo archivo pueden estar visibles a la vez yendo por
  // partes distintas, y un solo decodificador tendria que saltar de una
  // a la otra en cada cuadro.
  let { m, mediaId, v1 } = base();
  let v2;
  [m, v2] = M.agregarPista(m, 'video', 'V2');
  m = M.sobrescribirEn(m, v2, 0, M.clip(mediaId, 30, 40));

  const g = G.guionDeExport(m, {
    fps: 10, desde: 0, hasta: 2, lienzo: LIENZO,
    fuentes: { [mediaId]: { ancho: 1920, alto: 1080 } }
  });

  assert.equal(g.clips.length, 2, 'tienen que ser dos lectores distintos');
  assert.equal(new Set(g.clips.map((c) => c.mediaId)).size, 1, 'del mismo archivo');
  // Y cada uno mira otra parte del material.
  const inicios = g.clips.map((c) => c.tiempos[0]).sort((a, b) => a - b);
  assert.ok(Math.abs(inicios[0] - 0) < 1e-9);
  assert.ok(Math.abs(inicios[1] - 30) < 1e-9);
});

test('un hueco del montaje no genera pedidos (queda el fondo)', () => {
  let { m, mediaId, v1 } = base();
  // Dejar solo 0..2 con material: se corta en 2 y se borra la segunda
  // mitad, que queda como hueco.
  m = M.cortarEn(m, v1, 2);
  const segundo = M.elementosDePista(m, v1).find((el) => el.tipo === 'clip' && el.inicio >= 2);
  m = M.borrar(m, v1, segundo.id);

  const g = G.guionDeExport(m, {
    fps: 10, desde: 0, hasta: 5, lienzo: LIENZO,
    fuentes: { [mediaId]: { ancho: 1920, alto: 1080 } }
  });

  assert.equal(g.totalCuadros, 50);
  const c = g.clips[0];
  // Solo los 20 primeros cuadros tienen material.
  assert.equal(c.tiempos.length, 20);
  assert.equal(Math.max(...c.indices), 19);
});

test('un material que NADIE pudo medir se REPORTA, no se dibuja en silencio', () => {
  // Ojo: no alcanza con no pasar `fuentes`. `composicion` cae a las
  // medidas que dejo ffprobe al importar, y eso es correcto — es lo que
  // permite planificar antes de abrir el decodificador. El caso de
  // verdad es un material del que NO se saben las medidas por ningun
  // lado (un archivo que ffprobe no pudo leer).
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, { ruta: '/x/roto.mp4', nombre: 'roto.mp4', duracion: 10 });
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));

  const g = G.guionDeExport(m, { fps: 10, desde: 0, hasta: 1, lienzo: LIENZO, fuentes: {} });

  assert.equal(g.clips.length, 0, 'no se puede pedir cuadros de algo que no se sabe como encaja');
  assert.equal(g.sinMedidas.length, 1, 'tiene que avisar que no pudo medir el material');
  assert.equal(g.sinMedidas[0].mediaId, mediaId);
});

test('las medidas del decodificador GANAN sobre las de ffprobe', () => {
  // Importa para la rotacion: un video grabado vertical con rotacion en
  // los metadatos puede venir de ffprobe como 1920x1080, mientras que el
  // decodificador ya lo entrega 1080x1920. Si mandara ffprobe, el export
  // encajaria la imagen al reves que el visor.
  let m = M.crearMontaje();
  let mediaId;
  [m, mediaId] = M.agregarMedia(m, {
    ruta: '/x/v.mp4', nombre: 'v.mp4', duracion: 10, ancho: 1920, alto: 1080
  });
  let v1;
  [m, v1] = M.agregarPista(m, 'video', 'V1');
  m = M.sobrescribirEn(m, v1, 0, M.clip(mediaId, 0, 10));

  const g = G.guionDeExport(m, {
    fps: 1, desde: 0, hasta: 1, lienzo: LIENZO,
    fuentes: { [mediaId]: { ancho: 1080, alto: 1920 } }
  });

  assert.equal(g.sinMedidas.length, 0);
  assert.equal(g.clips.length, 1);
});

test('mediasUsadas dice que archivos hay que medir antes de planificar', () => {
  const { m, mediaId } = base();
  const usados = G.mediasUsadas(m, G.instantes(2, 0, 3));
  assert.deepEqual(usados, [mediaId]);
});

test('el guion no depende de la resolucion: los instantes son los mismos', () => {
  // El plan escala, pero QUE cuadro se pide no cambia con el tamaño del
  // lienzo. Si esto se rompiera, exportar en 720p y en 1080p mostraria
  // momentos distintos del video.
  const { m, mediaId } = base();
  const opciones = (lienzo) => ({
    fps: 12, desde: 1, hasta: 4, lienzo,
    fuentes: { [mediaId]: { ancho: 1920, alto: 1080 } }
  });
  const chico = G.guionDeExport(m, opciones({ ancho: 640, alto: 360 }));
  const grande = G.guionDeExport(m, opciones({ ancho: 1920, alto: 1080 }));

  assert.deepEqual(chico.clips[0].tiempos, grande.clips[0].tiempos);
  assert.deepEqual(chico.clips[0].indices, grande.clips[0].indices);
});
