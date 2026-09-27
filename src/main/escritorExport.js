// ============================================================
// ESCRITOR DEL EXPORT — el mp4 va a disco por pedazos (13/09/2026)
// ============================================================
// La exportacion corre en el RENDERER (mediabunny necesita el canvas, ver
// PENDIENTE 1.3.b), pero el renderer no puede escribir archivos:
// contextIsolation y sin nodeIntegration. Asi que el muxer le pasa los
// bytes al main y el main los escribe.
//
// POR QUE NO `BufferTarget`, que era lo que se habia probado: arma el mp4
// ENTERO en memoria y recien al final lo entrega. Para un short de 60 s
// no importa, pero un export de 10 minutos a 1080p son cientos de MB en
// RAM del renderer, mas la copia al pasarlo por IPC. Con `StreamTarget`
// en modo `chunked` mediabunny entrega pedazos de tamaño fijo con su
// POSICION en el archivo, y aca se escriben con fs.writeSync(posicion).
//
// POR QUE LA POSICION IMPORTA: un mp4 no se escribe solo hacia adelante.
// Al cerrar, el muxer vuelve atras a completar tamaños de cajas. Si esto
// hiciera "append", el archivo quedaria corrupto sin ningun error.
//
// POR QUE `.parcial`: mientras se escribe, el archivo va a otro nombre y
// recien al terminar bien se renombra. Un export cancelado o que fallo no
// deja un mp4 roto con el nombre que el user eligio (y si ya habia un
// archivo con ese nombre, no se pisa hasta que el nuevo este completo).
//
// No depende de Electron: se prueba con node:test (test/escritorExport.test.js).

const fs = require('fs');

const abiertos = new Map();   // id -> { fd, ruta, parcial, bytes }
let contador = 0;

function abrir(ruta) {
  if (!ruta) throw new Error('Falta la ruta de salida.');
  const parcial = ruta + '.parcial';
  const fd = fs.openSync(parcial, 'w');
  const id = `exp${Date.now().toString(36)}${(contador++).toString(36)}`;
  abiertos.set(id, { fd, ruta, parcial, bytes: 0 });
  return { id, ruta };
}

function escribir(id, posicion, datos) {
  const e = abiertos.get(id);
  if (!e) throw new Error('La exportacion ya estaba cerrada.');
  if (!Number.isInteger(posicion) || posicion < 0) throw new Error(`Posicion invalida: ${posicion}`);
  // Por IPC un Uint8Array llega como Uint8Array (clonado estructurado);
  // Buffer.from sobre su buffer evita otra copia.
  const buf = Buffer.isBuffer(datos)
    ? datos
    : Buffer.from(datos.buffer, datos.byteOffset || 0, datos.byteLength);
  let escritos = 0;
  while (escritos < buf.length) {
    escritos += fs.writeSync(e.fd, buf, escritos, buf.length - escritos, posicion + escritos);
  }
  e.bytes = Math.max(e.bytes, posicion + buf.length);
  return e.bytes;
}

// ok=true: el archivo queda con el nombre elegido. ok=false: se borra el
// .parcial (es un archivo que creo esta misma exportacion, nunca uno del
// user).
function cerrar(id, ok) {
  const e = abiertos.get(id);
  if (!e) return { ok: false, motivo: 'no estaba abierta' };
  abiertos.delete(id);
  try { fs.closeSync(e.fd); } catch (err) { /* ya cerrado */ }
  if (!ok) {
    try { fs.unlinkSync(e.parcial); } catch (err) { /* no llego a existir */ }
    return { ok: false, ruta: e.ruta };
  }
  fs.renameSync(e.parcial, e.ruta);
  return { ok: true, ruta: e.ruta, bytes: e.bytes };
}

// Si la ventana se cierra a mitad de un export, que no queden descriptores
// abiertos ni .parcial sueltos.
function cerrarTodos() {
  for (const id of [...abiertos.keys()]) cerrar(id, false);
}

module.exports = { abrir, escribir, cerrar, cerrarTodos };
