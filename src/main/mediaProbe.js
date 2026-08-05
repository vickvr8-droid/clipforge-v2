// mediaProbe.js
//
// Datos reales del archivo de entrada via ffprobe: ancho/alto en pixeles,
// fps, duracion y si trae pista de audio.
//
// POR QUE HACE FALTA: los recuadros se guardan en PORCENTAJES (xPct/yPct/
// wPct/hPct, 0..1) respecto del frame - eso es correcto para dibujar en
// pantalla, pero ffmpeg necesita el crop en PIXELES enteros. Hasta ahora
// esa conversion solo existia en el renderer (usando videoPreview.
// videoWidth), o sea que el proceso principal no tenia forma de exportar
// nada. Esto cierra ese hueco sin depender del <video> de la interfaz.

const { spawn } = require('child_process');
const fs = require('fs');
const { ffprobePath, binarioDisponible, errorBinarioFaltante } = require('./settingsStore');

// "30000/1001" -> 29.97. ffprobe devuelve los fps como fraccion exacta;
// convertir a decimal aca y no en el llamador evita repetir el parseo.
function fraccionANumero(txt) {
  if (!txt) return 0;
  const [a, b] = String(txt).split('/');
  const num = parseFloat(a);
  const den = b != null ? parseFloat(b) : 1;
  if (!isFinite(num) || !isFinite(den) || den === 0) return 0;
  return num / den;
}

function ejecutarFfprobe(args) {
  return new Promise((resolve, reject) => {
    const bin = ffprobePath();
    if (!binarioDisponible(bin)) {
      reject(errorBinarioFaltante('ffprobe', bin, 'CLIPFORGE_FFPROBE'));
      return;
    }
    const proc = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe fallo (codigo ${code}): ${stderr.slice(-800)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function probe(inputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`El archivo de entrada no existe: ${inputPath}`);
  }
  const salida = await ejecutarFfprobe([
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    inputPath
  ]);

  let data;
  try {
    data = JSON.parse(salida);
  } catch (e) {
    throw new Error('No se pudo interpretar la salida de ffprobe.');
  }

  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === 'video') || null;
  const audio = streams.find((s) => s.codec_type === 'audio') || null;

  // avg_frame_rate puede venir en "0/0" para algunos contenedores; en ese
  // caso r_frame_rate suele ser confiable.
  const fps = video
    ? (fraccionANumero(video.avg_frame_rate) || fraccionANumero(video.r_frame_rate) || 0)
    : 0;

  // La duracion del stream de video puede faltar; el format siempre la
  // trae para archivos normales.
  const duracion = parseFloat(
    (video && video.duration) || (data.format && data.format.duration) || 0
  ) || 0;

  return {
    inputPath,
    ancho: video ? Number(video.width) || 0 : 0,
    alto: video ? Number(video.height) || 0 : 0,
    fps,
    duracion,
    tieneVideo: !!video,
    tieneAudio: !!audio,
    codecVideo: video ? video.codec_name : null,
    codecAudio: audio ? audio.codec_name : null
  };
}

module.exports = { probe, fraccionANumero };
