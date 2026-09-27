// protocoloMedia.js
//
// Sirve los archivos de video/audio del disco al RENDERER por un esquema
// propio (`cf-media://`) con soporte de Range.
//
// POR QUE EXISTE: mediabunny necesita ACCESO ALEATORIO al archivo. Para
// sacar el cuadro del minuto 40 lee el indice (que en un mp4 puede estar
// al final), salta al keyframe anterior y decodifica desde ahi. Eso son
// varias lecturas de pedazos sueltos, no una descarga de principio a fin.
//
// Las alternativas no sirven:
//   - `file://` + fetch: el renderer corre con webSecurity activo, y
//     fetch sobre file:// esta bloqueado. Bajarle la seguridad a la
//     ventana por esto seria pagar carisimo.
//   - Leer el archivo entero a un Blob por IPC: una grabacion de una hora
//     son varios GB en RAM. Es exactamente lo que este camino evita.
//
// El `<video>` del visor sigue usando file:// y no se toca: Chromium si
// sabe hacer Range sobre file:// internamente; lo que no puede es
// exponerlo a fetch.

const { protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

const ESQUEMA = 'cf-media';

const TIPOS = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg'
};

// Tiene que llamarse ANTES de app.whenReady(): Electron congela la tabla
// de esquemas al arrancar. `stream` habilita respuestas por streaming (si
// no, Electron junta todo en memoria y volvemos al problema del Blob) y
// `supportFetchAPI` es lo que permite que mediabunny lo pida con fetch.
function registrarEsquema() {
  protocol.registerSchemesAsPrivileged([{
    scheme: ESQUEMA,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }]);
}

// El esquema esta registrado como `standard`, o sea que Electron y el
// parser de URL del navegador le exigen la forma esquema://host/path. Una
// ruta de Windows NO puede ir en el host (los dos puntos de "C:" y el
// largo lo hacen invalido: `fetch` tira "Failed to parse URL" antes de
// que el manejador llegue a correr). Por eso va un host fijo y la ruta
// entera percent-encoded en el path.
//
//   D:\videos\a.mp4  ->  cf-media://archivo/D%3A%5Cvideos%5Ca.mp4
const HOST = 'archivo';
const PREFIJO = `${ESQUEMA}://${HOST}/`;

function rutaDesdeUrl(url) {
  const sinQuery = url.split('?')[0].split('#')[0];
  if (!sinQuery.startsWith(PREFIJO)) throw new Error('URL de media mal formada');
  return path.normalize(decodeURIComponent(sinQuery.slice(PREFIJO.length)));
}

function respuestaError(codigo, mensaje) {
  return new Response(mensaje, { status: codigo, headers: { 'Content-Type': 'text/plain' } });
}

async function manejar(request) {
  let ruta;
  try {
    ruta = rutaDesdeUrl(request.url);
  } catch (e) {
    return respuestaError(400, 'URL invalida');
  }

  // Solo archivos que existan de verdad. No se sirve nada que no sea un
  // archivo comun: un proyecto guardado es un JSON que el user podria
  // haber recibido de otro lado, y no tiene por que poder apuntar a un
  // dispositivo o a un directorio.
  let stat;
  try {
    stat = await fs.promises.stat(ruta);
  } catch (e) {
    return respuestaError(404, `No existe: ${ruta}`);
  }
  if (!stat.isFile()) return respuestaError(403, 'No es un archivo');

  const tipo = TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream';
  const rango = request.headers.get('Range');

  if (!rango) {
    return new Response(Readable.toWeb(fs.createReadStream(ruta)), {
      status: 200,
      headers: {
        'Content-Length': String(stat.size),
        'Content-Type': tipo,
        // Sin esto mediabunny asume que no puede pedir pedazos y se
        // baja el archivo entero.
        'Accept-Ranges': 'bytes'
      }
    });
  }

  const m = /bytes=(\d*)-(\d*)/.exec(rango);
  if (!m) return respuestaError(416, 'Range mal formado');

  let ini = m[1] ? parseInt(m[1], 10) : 0;
  let fin = m[2] ? parseInt(m[2], 10) : stat.size - 1;
  // Un pedido que se pasa del final no es un error del que haya que
  // morirse: se recorta. Los demuxers piden de mas seguido, tanteando
  // donde termina el indice.
  if (Number.isNaN(ini) || ini < 0) ini = 0;
  if (Number.isNaN(fin) || fin >= stat.size) fin = stat.size - 1;
  if (ini > fin) return respuestaError(416, 'Range fuera de rango');

  return new Response(Readable.toWeb(fs.createReadStream(ruta, { start: ini, end: fin })), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${ini}-${fin}/${stat.size}`,
      'Content-Length': String(fin - ini + 1),
      'Content-Type': tipo,
      'Accept-Ranges': 'bytes'
    }
  });
}

// Se llama DESPUES de app.whenReady().
function registrarManejador() {
  protocol.handle(ESQUEMA, manejar);
}

// La contraparte de rutaDesdeUrl, para que el renderer arme la URL igual
// que el main la lee. Vive aca para que las dos mitades no se separen.
function urlDeRuta(rutaLocal) {
  return PREFIJO + encodeURIComponent(rutaLocal);
}

module.exports = { ESQUEMA, registrarEsquema, registrarManejador, urlDeRuta, rutaDesdeUrl };
