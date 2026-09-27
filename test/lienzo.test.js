// Tests del LIENZO: donde cae cada capa sobre la base (06/08/2026).
//
// PEDIDO DEL USER: "quiero que el visor 1 sea una base en donde las pistas
// de video se ponen sobre ella, asi me dejara agrandar o achicar la imagen
// del video, y tambien si agrego clips, fotos u otros".
//
// Lo que estos tests cuidan es lo que NO da error si se rompe:
//   - que "escala 1" signifique lo mismo con cualquier material (si se
//     midiera en pixeles del archivo, un 4K y un 1080p se verian
//     distintos con el mismo numero);
//   - que agrandar abra desde el CENTRO y no corra el encuadre;
//   - que la ida y la vuelta (transformacion -> rect -> transformacion)
//     coincidan, porque el arrastre usa las dos y separarlas hace que la
//     imagen "salte" al soltar el mouse.

const test = require('node:test');
const assert = require('node:assert');

const L = require('../src/shared/lienzo');

const LIENZO = { ancho: 1920, alto: 1080 };
const HD = { ancho: 1920, alto: 1080 };
const CUATROK = { ancho: 3840, alto: 2160 };
const VERTICAL = { ancho: 1080, alto: 1920 };
const CUADRADO = { ancho: 1000, alto: 1000 };

const casi = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// ============================================================
// ENCAJE: EL PUNTO DE PARTIDA
// ============================================================

test('un material con la forma del lienzo lo llena justo', () => {
  const r = L.encajar(HD.ancho, HD.alto, LIENZO.ancho, LIENZO.alto);
  assert.ok(casi(r.x, 0) && casi(r.y, 0));
  assert.ok(casi(r.w, 1920) && casi(r.h, 1080));
});

test('un vertical entra entero y deja franjas a los costados', () => {
  const r = L.encajar(VERTICAL.ancho, VERTICAL.alto, LIENZO.ancho, LIENZO.alto);
  assert.ok(casi(r.h, 1080), 'toca arriba y abajo');
  assert.ok(r.w < LIENZO.ancho, 'y sobra a los costados');
  assert.ok(casi(r.x, (1920 - r.w) / 2), 'centrado');
  assert.ok(casi(r.w / r.h, VERTICAL.ancho / VERTICAL.alto), 'sin deformarse');
});

test('escala 1 significa lo mismo en 1080p que en 4K', () => {
  const a = L.rectDeCapa(HD, { escala: 1 }, LIENZO);
  const b = L.rectDeCapa(CUATROK, { escala: 1 }, LIENZO);
  assert.ok(casi(a.w, b.w) && casi(a.h, b.h),
    `deberian dar igual: ${a.w}x${a.h} vs ${b.w}x${b.h}`);
});

// ============================================================
// TRANSFORMACION
// ============================================================

test('sin transformacion, la capa es el encaje', () => {
  const r = L.rectDeCapa(HD, null, LIENZO);
  assert.ok(casi(r.x, 0) && casi(r.y, 0) && casi(r.w, 1920) && casi(r.h, 1080));
});

test('agrandar crece desde el centro, no desde la esquina', () => {
  const r = L.rectDeCapa(HD, { escala: 2 }, LIENZO);
  assert.ok(casi(r.w, 3840) && casi(r.h, 2160));
  // El centro tiene que seguir siendo el centro del lienzo.
  assert.ok(casi(r.x + r.w / 2, LIENZO.ancho / 2), `centro corrido en x: ${r.x + r.w / 2}`);
  assert.ok(casi(r.y + r.h / 2, LIENZO.alto / 2), `centro corrido en y: ${r.y + r.h / 2}`);
});

test('achicar tambien mantiene el centro', () => {
  const r = L.rectDeCapa(HD, { escala: 0.5 }, LIENZO);
  assert.ok(casi(r.w, 960) && casi(r.h, 540));
  assert.ok(casi(r.x + r.w / 2, 960) && casi(r.y + r.h / 2, 540));
});

test('el corrimiento se mide en fracciones del LIENZO', () => {
  const r = L.rectDeCapa(HD, { escala: 1, x: 0.25, y: -0.5 }, LIENZO);
  assert.ok(casi(r.x, 0.25 * 1920), `esperaba 480, dio ${r.x}`);
  assert.ok(casi(r.y, -0.5 * 1080), `esperaba -540, dio ${r.y}`);
});

test('correr un vertical lo mueve lo mismo que a un horizontal', () => {
  const a = L.rectDeCapa(HD, { x: 0.1 }, LIENZO);
  const b = L.rectDeCapa(VERTICAL, { x: 0.1 }, LIENZO);
  const sinCorrer = { a: L.rectDeCapa(HD, {}, LIENZO), b: L.rectDeCapa(VERTICAL, {}, LIENZO) };
  assert.ok(casi(a.x - sinCorrer.a.x, b.x - sinCorrer.b.x),
    'el corrimiento no puede depender de la forma del material');
});

// ============================================================
// IDA Y VUELTA (lo que usa el arrastre)
// ============================================================

test('rect -> transformacion -> rect vuelve al mismo lugar', () => {
  for (const fuente of [HD, CUATROK, VERTICAL, CUADRADO]) {
    for (const t of [{ escala: 1 }, { escala: 0.4, x: 0.2, y: -0.1 }, { escala: 3, x: -0.35, y: 0.15 }]) {
      const rect = L.rectDeCapa(fuente, t, LIENZO);
      const vuelta = L.transformacionDesdeRect(rect, fuente, LIENZO);
      const otra = L.rectDeCapa(fuente, vuelta, LIENZO);
      assert.ok(casi(rect.x, otra.x, 1e-6) && casi(rect.y, otra.y, 1e-6) &&
                casi(rect.w, otra.w, 1e-6) && casi(rect.h, otra.h, 1e-6),
        `no cerro con ${JSON.stringify(t)} en ${fuente.ancho}x${fuente.alto}`);
      assert.ok(casi(vuelta.escala, t.escala || 1, 1e-9), 'la escala tiene que volver igual');
    }
  }
});

test('la vuelta recupera el corrimiento exacto', () => {
  const t = { escala: 1.5, x: 0.2, y: -0.3 };
  const vuelta = L.transformacionDesdeRect(L.rectDeCapa(HD, t, LIENZO), HD, LIENZO);
  assert.ok(casi(vuelta.x, t.x) && casi(vuelta.y, t.y),
    `esperaba ${t.x},${t.y} y dio ${vuelta.x},${vuelta.y}`);
});

// ============================================================
// EL LIENZO DEL PROYECTO
// ============================================================

test('el lienzo toma la forma del primer material con medidas', () => {
  const l = L.lienzoDeMontaje([{ ancho: 0, alto: 0 }, { ancho: 1080, alto: 1920 }], 1080);
  assert.strictEqual(l.ancho, 1080);
  assert.strictEqual(l.alto, 1920, 'un proyecto vertical da un lienzo vertical');
});

test('sin material con medidas, el lienzo es 16:9', () => {
  const l = L.lienzoDeMontaje([], 1920);
  assert.strictEqual(l.ancho, 1920);
  assert.strictEqual(l.alto, 1080);
});

test('el lienzo no depende del ancho de la ventana', () => {
  const chico = L.lienzoDeMontaje([HD], 640);
  const grande = L.lienzoDeMontaje([HD], 1920);
  assert.ok(casi(chico.ancho / chico.alto, grande.ancho / grande.alto),
    'la forma es la misma, solo cambia la resolucion');
});
