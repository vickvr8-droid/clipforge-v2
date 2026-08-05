// Almacenamiento local de API keys + deteccion automatica de proveedor
// por prefijo/formato (item 3 del alcance MVP, CTX_PROYECTO_CLIPFORGE_1D.md).
//
// CIFRADO 04/08/2026: antes las keys se guardaban en TEXTO PLANO en
// userData/keys.json. Cualquier programa corriendo con el usuario (o
// cualquiera que abriera esa carpeta) las leia enteras. Ahora se cifran
// con safeStorage de Electron, que usa el llavero del sistema operativo
// (DPAPI en Windows, Keychain en macOS, libsecret en Linux): el archivo
// solo se puede descifrar desde la misma cuenta de usuario de esta
// maquina.
//
// Compatibilidad: las keys ya guardadas en plano se siguen leyendo (campo
// "valor") y se re-guardan cifradas la primera vez que se toca la lista,
// asi no hay que pedirle al user que las vuelva a pegar.

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

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

function cifradoDisponible() {
  try {
    return safeStorage && safeStorage.isEncryptionAvailable();
  } catch (e) {
    return false; // safeStorage no esta listo (antes de app.whenReady) o el SO no lo soporta
  }
}

// Cifra a base64. Si el SO no ofrece cifrado, cae a texto plano igual que
// antes en vez de dejar al user sin poder guardar nada.
function cifrar(valor) {
  if (!cifradoDisponible()) return { valor };
  try {
    return { valorCifrado: safeStorage.encryptString(valor).toString('base64') };
  } catch (e) {
    return { valor };
  }
}

function descifrar(k) {
  if (k.valorCifrado) {
    try {
      return safeStorage.decryptString(Buffer.from(k.valorCifrado, 'base64'));
    } catch (e) {
      // Perfil de usuario/maquina distinto al que cifro: la key es
      // irrecuperable, hay que volver a pegarla.
      return null;
    }
  }
  return k.valor || null;
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

function escribirKeys(app, keys) {
  const p = getKeysPath(app);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(keys, null, 2), 'utf-8');
}

// Migra al vuelo las keys que quedaron en texto plano de versiones
// anteriores. Se llama al listar, que es lo primero que hace la UI.
function migrarACifrado(app) {
  if (!cifradoDisponible()) return leerKeys(app);
  const keys = leerKeys(app);
  let cambio = false;
  const migradas = keys.map((k) => {
    if (!k.valorCifrado && k.valor) {
      cambio = true;
      const { valor, ...resto } = k;
      return { ...resto, ...cifrar(valor) };
    }
    return k;
  });
  if (cambio) escribirKeys(app, migradas);
  return migradas;
}

function guardarKey(app, { nombre, valor }) {
  const keys = migrarACifrado(app);
  const proveedor = detectarProveedor(valor);
  const nueva = {
    id: Date.now().toString(36),
    nombre: nombre || proveedor,
    proveedor,
    ...cifrar(valor),
    ultimos4: valor.slice(-4),
    creada: new Date().toISOString()
  };
  keys.push(nueva);
  escribirKeys(app, keys);
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
