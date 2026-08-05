// Almacenamiento local de API keys + deteccion automatica de proveedor
// por prefijo/formato (item 3 del alcance MVP, CTX_PROYECTO_CLIPFORGE_1D.md).
// Se guardan en texto plano en userData (mismo criterio que el user ya
// acepta para sus otras keys, ver CTX_MAESTRO seccion 6 - no es peor
// que lo que ya tiene en claude_desktop_config.json).

const fs = require('fs');
const path = require('path');

function getKeysPath(app) {
  return path.join(app.getPath('userData'), 'keys.json');
}

function detectarProveedor(valor) {
  const v = valor.trim();
  if (v.startsWith('sk-ant-')) return 'Anthropic';
  if (v.startsWith('sk-or-')) return 'OpenRouter';
  if (v.startsWith('sk-')) return 'OpenAI';
  if (v.startsWith('AIzaSy')) return 'Google / Gemini';
  if (v.startsWith('dx_bearer_') || v.startsWith('dx_secret_')) return 'Descript';
  if (v.startsWith('nvapi-')) return 'NVIDIA';
  if (v.startsWith('hf_')) return 'HuggingFace';
  if (v.startsWith('sk_')) return 'ElevenLabs';
  return 'Desconocido (revisar manual)';
}

function leerKeys(app) {
  const p = getKeysPath(app);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function guardarKey(app, { nombre, valor }) {
  const keys = leerKeys(app);
  const proveedor = detectarProveedor(valor);
  const nueva = {
    id: Date.now().toString(36),
    nombre: nombre || proveedor,
    proveedor,
    valor,
    ultimos4: valor.slice(-4),
    creada: new Date().toISOString()
  };
  keys.push(nueva);
  fs.writeFileSync(getKeysPath(app), JSON.stringify(keys, null, 2), 'utf-8');
  // Nunca devolver el valor completo de vuelta al renderer (regla 22 CTX_MAESTRO,
  // no repetir keys en texto/UI innecesariamente mas de lo justo).
  return { id: nueva.id, nombre: nueva.nombre, proveedor: nueva.proveedor, ultimos4: nueva.ultimos4, creada: nueva.creada };
}

function listarKeysSeguras(app) {
  // Para la UI: nunca exponer el valor completo, solo metadatos + ultimos 4.
  return leerKeys(app).map(({ id, nombre, proveedor, ultimos4, creada }) => ({
    id, nombre, proveedor, ultimos4, creada
  }));
}

function eliminarKey(app, id) {
  const keys = leerKeys(app).filter((k) => k.id !== id);
  fs.writeFileSync(getKeysPath(app), JSON.stringify(keys, null, 2), 'utf-8');
  return true;
}

function obtenerValorKey(app, id) {
  // Uso INTERNO del proceso principal (ej. para llamar a Descript),
  // nunca se expone directo al renderer via IPC.
  const k = leerKeys(app).find((k) => k.id === id);
  return k ? k.valor : null;
}

module.exports = { detectarProveedor, guardarKey, listarKeysSeguras, eliminarKey, obtenerValorKey };
