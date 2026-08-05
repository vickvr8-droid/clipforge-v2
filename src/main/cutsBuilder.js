// Combina segmentos de transcripcion + silencios detectados en un
// array de "bloques" (estructura sugerida por Gemini en el research
// guardado en CTX_PROYECTO_CLIPFORGE_1D.md seccion 5.4): cada bloque
// tiene {id, start, end, text, type, status}. El editor de aceptar/
// rechazar (renderer) trabaja puramente sobre este array; exportar
// solo relee su estado final, no vuelve a tocar ffmpeg/whisper.

function buildBlocks(segments, silences) {
  const blocks = [];
  let idCounter = 1;

  for (const seg of segments || []) {
    blocks.push({
      id: `b${idCounter++}`,
      start: seg.start,
      end: seg.end,
      text: seg.text || '',
      type: 'speech',
      // Si el motor (faster-whisper) ya la marco como posible alucinacion
      // (repeticion de palabra sospechosa), default a "cut".
      status: seg.posible_alucinacion ? 'cut' : 'keep'
    });
  }

  for (const sil of silences || []) {
    blocks.push({
      id: `b${idCounter++}`,
      start: sil.start,
      end: sil.end,
      text: `[silencio ${sil.duration}s]`,
      type: 'silence',
      status: 'cut' // silencios se proponen cortados por defecto
    });
  }

  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

function summarize(blocks) {
  const totalDuration = blocks.reduce((acc, b) => Math.max(acc, b.end || 0), 0);
  const cutDuration = blocks
    .filter((b) => b.status === 'cut')
    .reduce((acc, b) => acc + Math.max(0, (b.end || 0) - (b.start || 0)), 0);
  const keptDuration = Math.max(0, totalDuration - cutDuration);
  const cutCount = blocks.filter((b) => b.status === 'cut').length;
  return {
    totalBlocks: blocks.length,
    cutCount,
    totalDurationSec: Math.round(totalDuration * 10) / 10,
    keptDurationSec: Math.round(keptDuration * 10) / 10,
    porcentajeEliminado: totalDuration > 0 ? Math.round((cutDuration / totalDuration) * 1000) / 10 : 0
  };
}

function fmtSrtTime(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t - Math.floor(t)) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

function blocksToSrt(blocks) {
  const kept = blocks.filter((b) => b.type === 'speech' && b.status === 'keep' && b.text.trim());
  return kept.map((b, i) => {
    return `${i + 1}\n${fmtSrtTime(b.start)} --> ${fmtSrtTime(b.end)}\n${b.text.trim()}\n`;
  }).join('\n');
}

function blocksToCutsJson(blocks) {
  return {
    generado: new Date().toISOString(),
    resumen: summarize(blocks),
    bloques: blocks
  };
}

module.exports = { buildBlocks, summarize, blocksToSrt, blocksToCutsJson };
