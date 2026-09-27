// Tests del ESCRITOR DEL EXPORT (13/09/2026).
//
// El muxer de mp4 NO escribe solo hacia adelante: al cerrar vuelve atras a
// completar tamaños de cajas. Si el escritor hiciera "append", el archivo
// saldria corrupto y ningun otro test lo notaria. Por eso el primer test
// escribe pedazos fuera de orden.
//
// Escribe en la carpeta temporal del sistema y la borra al terminar.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const E = require('../src/main/escritorExport');

function carpeta() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cf-escritor-'));
}

test('cada pedazo va a SU posicion, aunque lleguen fuera de orden', (t) => {
  const dir = carpeta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ruta = path.join(dir, 'salida.mp4');

  const { id } = E.abrir(ruta);
  E.escribir(id, 4, new Uint8Array([5, 6, 7, 8]));
  E.escribir(id, 0, new Uint8Array([1, 2, 3, 4]));
  // Reescribir el principio, como hace el muxer con el tamaño de 'mdat'.
  E.escribir(id, 1, new Uint8Array([9]));
  const r = E.cerrar(id, true);

  assert.equal(r.ok, true);
  assert.equal(r.bytes, 8);
  assert.deepEqual([...fs.readFileSync(ruta)], [1, 9, 3, 4, 5, 6, 7, 8]);
});

test('mientras se escribe el mp4 no existe con el nombre elegido', (t) => {
  const dir = carpeta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ruta = path.join(dir, 'salida.mp4');

  const { id } = E.abrir(ruta);
  E.escribir(id, 0, new Uint8Array([1]));
  assert.ok(!fs.existsSync(ruta), 'un export a medias no puede parecer terminado');
  assert.ok(fs.existsSync(ruta + '.parcial'));
  E.cerrar(id, true);
  assert.ok(fs.existsSync(ruta));
  assert.ok(!fs.existsSync(ruta + '.parcial'));
});

test('cancelar borra el .parcial y NO toca un archivo previo con ese nombre', (t) => {
  const dir = carpeta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ruta = path.join(dir, 'salida.mp4');
  fs.writeFileSync(ruta, 'video anterior del user');

  const { id } = E.abrir(ruta);
  E.escribir(id, 0, new Uint8Array([1, 2, 3]));
  const r = E.cerrar(id, false);

  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(ruta + '.parcial'));
  assert.equal(fs.readFileSync(ruta, 'utf-8'), 'video anterior del user');
});

test('escribir despues de cerrar falla con un mensaje, no escribe en otro lado', (t) => {
  const dir = carpeta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { id } = E.abrir(path.join(dir, 'a.mp4'));
  E.cerrar(id, false);
  assert.throws(() => E.escribir(id, 0, new Uint8Array([1])), /cerrada/);
  assert.equal(E.cerrar(id, true).ok, false);
});

test('cerrarTodos no deja .parcial sueltos (ventana cerrada a mitad de un export)', (t) => {
  const dir = carpeta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = E.abrir(path.join(dir, 'a.mp4'));
  const b = E.abrir(path.join(dir, 'b.mp4'));
  E.escribir(a.id, 0, Buffer.from([1]));
  E.escribir(b.id, 0, Buffer.from([2]));
  E.cerrarTodos();
  assert.deepEqual(fs.readdirSync(dir), []);
});
