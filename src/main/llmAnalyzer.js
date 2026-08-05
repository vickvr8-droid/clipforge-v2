// Analisis de cortes adicionales via LLM (muletillas, repeticiones,
// tangentes) - pendiente #2 seccion 6.4 de CTX_PROYECTO_CLIPFORGE_1D.md.
// Dos backends soportados (mismo patron que las capturas de referencia
// de Nekodificador, seccion 5.1 del MD): LM Studio local (server
// OpenAI-compatible en localhost, sin key) u OpenRouter (nube, con key
// guardada en keysStore).

const http = require('http');
const https = require('https');

const MODELOS_LOCAL = [
  'qwen/qwen3.6-27b',
  'google/gemma-4-31b',
  'nvidia/nemotron-3-nano',
  'nvidia/nemotron-3-nano-4b',
  'nvidia/nemotron-3-nano-omni'
];

function buildPrompt(blocks, instrucciones) {
  const speechBlocks = blocks.filter((b) => b.type === 'speech' && b.status !== 'cut');
  const listado = speechBlocks.map((b) => `[${b.id}] ${b.text.trim()}`).join('\n');

  const systemPrompt = `Sos un editor de video que limpia transcripciones de gameplay/podcast en español chileno.
Proponé qué bloques cortar por ser: muletillas o repeticiones (misma idea 2+ veces
seguidas), tropiezos/frases a medio terminar que se retoman despues, o tangentes
irrelevantes. NO marques contenido que sea parte real del chiste/historia.
Respondé SOLO JSON valido, sin texto adicional, formato exacto:
{"cortes": [{"id": "b12", "motivo": "repeticion de la misma frase en b13"}]}
Si no hay nada que cortar: {"cortes": []}.`;

  const userPrompt = `Transcripción (formato [id] texto):\n${listado}\n${
    instrucciones ? `\nInstrucciones adicionales del usuario: ${instrucciones}\n` : ''
  }`;

  return { systemPrompt, userPrompt };
}

function llamarChatCompletions({ url, headers, body }) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Respuesta no es JSON valido: ' + raw.slice(0, 300)));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`No se pudo conectar (${url}): ${e.message}`)));
    req.write(data);
    req.end();
  });
}

async function analizarMuletillas({ blocks, backend, modelo, apiKey, instrucciones, systemPromptOverride }) {
  const { systemPrompt, userPrompt } = buildPrompt(blocks, instrucciones);
  const finalSystemPrompt = (systemPromptOverride && systemPromptOverride.trim()) ? systemPromptOverride : systemPrompt;

  let url, headers;
  if (backend === 'openrouter') {
    if (!apiKey) throw new Error('Falta la API key de OpenRouter.');
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { Authorization: `Bearer ${apiKey}` };
  } else {
    // LM Studio local: servidor OpenAI-compatible en localhost, sin key.
    url = 'http://localhost:1234/v1/chat/completions';
    headers = {};
  }

  const body = {
    model: modelo,
    messages: [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2
  };

  const respuesta = await llamarChatCompletions({ url, headers, body });
  const texto = respuesta.choices?.[0]?.message?.content || '{}';
  const usage = respuesta.usage || {};

  let parsed;
  try {
    // Por si el modelo mete texto extra pese a la instruccion, tomar
    // solo el primer bloque {...} que aparezca en la respuesta.
    const match = texto.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : texto);
  } catch (e) {
    throw new Error('El modelo no devolvio JSON valido: ' + texto.slice(0, 200));
  }

  const cortes = Array.isArray(parsed.cortes) ? parsed.cortes : [];
  const idsValidos = new Set(blocks.map((b) => b.id));
  const aplicados = [];

  for (const corte of cortes) {
    if (idsValidos.has(corte.id)) {
      const block = blocks.find((b) => b.id === corte.id);
      if (block && block.status === 'keep') {
        block.status = 'propuesta';
        block.motivoIA = corte.motivo || '';
        aplicados.push(corte.id);
      }
    }
  }

  return {
    blocks,
    stats: {
      sugerencias: cortes.length,
      aplicadas: aplicados.length,
      tokensIn: usage.prompt_tokens || 0,
      tokensOut: usage.completion_tokens || 0
    }
  };
}

module.exports = { analizarMuletillas, MODELOS_LOCAL };
