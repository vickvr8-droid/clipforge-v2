// ============================================================
// MONTAJE GUARDADO — abrir un proyecto.json sin perder la edicion
// ============================================================
// Salio de main.js el 13/09/2026, SIN cambiar lo que hace, por una sola
// razon: poder probarlo. main.js hace require('electron') en la primera
// linea, asi que nada de lo que vive ahi se puede cargar desde node:test.
// Y esta es justamente la parte donde un error no se ve: si
// montajeUtilizable() rechaza un montaje guardado, montajeInicial() arma
// uno NUEVO desde cero y la edicion del user desaparece sin ningun aviso.
//
// REGLA QUE ESTE ARCHIVO PROTEGE: Montaje.VERSION no se sube sin escribir
// antes una migracion explicita (con test que abra un proyecto viejo).
// Campos nuevos del modelo van como OPCIONALES con valor por defecto,
// como `fps` en el material (test/montajeGuardado.test.js).

const path = require('path');
const Montaje = require('../shared/montaje');

// Arma el montaje inicial de un video: el archivo entra al panel de
// material y se pone entero en una pista V1, mas una A1 vacia para audio.
// Un montaje guardado se reusa SOLO si es utilizable. Bug real
// (06/08/2026): la primera version guardaba el montaje aunque hubiera
// salido con duracion 0 (cuando la duracion todavia venia del visor, que
// ya no existe). Ese estado degenerado -material [0..0] y pistas vacias-
// quedaba en proyecto.json y despues cortaba el paso ANTES de medir el
// archivo, asi que se reusaba para siempre y no aparecia nada nunca.
// Ahora se exige que tenga material con duracion real; si no, se rearma.
function montajeUtilizable(g) {
  if (!g || g.version !== Montaje.VERSION || !Array.isArray(g.pistas) || !Array.isArray(g.media)) return false;
  return g.media.some((x) => (x.disponibleOut - x.disponibleIn) > 0);
}

function montajeInicial(inputPath, fuente, guardado) {
  if (montajeUtilizable(guardado)) return guardado;
  const duracion = (fuente && fuente.duracion) || 0;
  // BASE DE CUADRO (13/09/2026, tanda D): un montaje nuevo nace con el fps
  // de su material, o 30 si ffprobe no lo sabe (un .wav). Ver
  // asegurarBaseDeCuadro para los que ya estaban guardados.
  let m = Montaje.crearMontaje({ fps: (fuente && fuente.fps) || Montaje.FPS_POR_DEFECTO });
  let mediaId, v1;
  [m, mediaId] = Montaje.agregarMedia(m, {
    ruta: inputPath,
    nombre: path.basename(inputPath),
    // El tipo sale de lo que ffprobe encontro de verdad, no fijo en
    // 'video': ClipForge acepta .wav/.mp3, y marcarlos como video hacia
    // que el visor buscara imagen donde no hay ninguna.
    tipo: (fuente && fuente.tieneVideo === false) ? 'audio' : 'video',
    duracion,
    ancho: (fuente && fuente.ancho) || 0,
    alto: (fuente && fuente.alto) || 0,
    // ffprobe ya lo mide; antes se tiraba aca. Lo usa la exportacion.
    fps: (fuente && fuente.fps) || 0,
    // Se guarda para no tener que volver a medir el archivo cada vez que
    // haga falta saber si lleva sonido.
    tieneAudio: !fuente || fuente.tieneAudio !== false
  });
  [m, v1] = Montaje.agregarPista(m, 'video', 'V1');
  let a1;
  [m, a1] = Montaje.agregarPista(m, 'audio', 'A1');

  // La imagen y su sonido entran JUNTOS y vinculados: un archivo de video
  // no es "video" y aparte "audio", es un clip con las dos cosas. Sin
  // esto la pista de audio quedaba vacia y no habia forma de llenarla.
  if (duracion > 0) {
    const conAudio = !fuente || fuente.tieneAudio !== false;
    const vinculo = conAudio ? Montaje.nuevoVinculo() : undefined;
    [m] = Montaje.agregarAlFinal(m, v1, mediaId, { vinculo });
    if (conAudio) [m] = Montaje.agregarAlFinal(m, a1, mediaId, { vinculo });
  }
  return m;
}

// Migracion para los proyectos hechos antes del vinculo: tenian la pista
// de audio vacia y no habia manera de poblarla. espejarEnAudio() solo
// actua si el audio esta vacio y ningun clip tiene vinculo, asi que corre
// una vez y despues no toca nada.
function migrarAudioVinculado(m) {
  const video = m.pistas.find((p) => p.tipo === 'video');
  const audio = m.pistas.find((p) => p.tipo === 'audio');
  if (!video || !audio) return m;
  const llevaAudio = m.media.some((x) => x.tieneAudio !== false);
  if (!llevaAudio) return m;
  return Montaje.espejarEnAudio(m, video.id, audio.id);
}

// ------------------------------------------------------------
// MIGRACION A BASE DE CUADRO (13/09/2026, tanda D, paso 6)
// ------------------------------------------------------------
// Los proyectos guardados antes no tienen `fps` y sus cortes estan en
// cualquier lado (10.013, restos de 6 ms). Al abrirlos se les pone el fps
// y se lleva la edicion a la grilla con Montaje.alinearACuadro: cada corte
// se corre como mucho medio cuadro, las parejas imagen-sonido quedan
// iguales entre si y ningun clip cambia de material ni de orden.
//
// Es una migracion EXPLICITA y no un cambio de VERSION (que haria que
// montajeUtilizable tirara la edicion entera). Corre una sola vez: despues
// el montaje ya tiene `fps` y esta funcion lo devuelve tal cual.
//
// De donde sale el fps, en orden (decision D3 en DECISIONES.md):
//   1. el que ya tenga el montaje;
//   2. el del material que se abrio (`fuente.fps`, ffprobe);
//   3. el `fps` guardado del primer material con imagen;
//   4. 30.
function fpsParaMigrar(m, fuente) {
  if (fuente && fuente.fps > 0) return fuente.fps;
  const conFps = (m.media || []).find((x) => x.tipo !== 'audio' && x.fps > 0);
  return conFps ? conFps.fps : Montaje.FPS_POR_DEFECTO;
}

function asegurarBaseDeCuadro(m, fuente) {
  if (!m || Montaje.fpsDe(m)) return m;
  return Montaje.fijarFps(m, fpsParaMigrar(m, fuente));
}

// Si hace falta medir el archivo para migrar (no hay fps en ningun lado).
const necesitaMedirFps = (m) => !!m && !Montaje.fpsDe(m) &&
  !(m.media || []).some((x) => x.tipo !== 'audio' && x.fps > 0);

module.exports = { montajeUtilizable, montajeInicial, migrarAudioVinculado, asegurarBaseDeCuadro, necesitaMedirFps };
