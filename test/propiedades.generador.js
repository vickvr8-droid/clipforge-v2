// Generador de montajes y operaciones al azar para test/propiedades.test.js
// (13/09/2026, tanda B, paso 2 de la hoja de ruta).
//
// No termina en .test.js a proposito: `node --test "test/*.test.js"` no lo
// corre solo, lo usa el test. Tambien se puede correr a mano para ver el
// informe completo de una semilla:
//
//   node test/propiedades.generador.js 7
//
// POR QUE CON SEMILLA: un test aleatorio que falla una vez y la siguiente
// no, no sirve para arreglar nada. Con la misma semilla se repite la misma
// secuencia de operaciones, y cada falla trae la corrida y el paso donde
// aparecio para reproducirla.

const M = require('../src/shared/montaje');

// Las clases que tiene que respetar TODA operacion (vinculo y estructura) y
// las que dependen de la base de cuadro (paso 6), que se reportan aparte
// porque hoy la sobrescritura y el recorte todavia las producen.
const CLASES_VINCULO = ['vinculoHuerfano', 'vinculoRepetido', 'vinculoDesalineado',
  'materialFaltante', 'fueraDeMaterial', 'idRepetido', 'estructura'];
const CLASES_CUADRO = ['clipCorto', 'huecoCorto', 'fueraDeCuadro'];
// Tanda E (paso 7): las operaciones que corren lo de atras tienen que dejar
// cada encuadre sobre la misma frase (Montaje.encuadresQueCambiaronDeMaterial).
const CLASES_ENCUADRE = ['encuadreCambioDeMaterial'];
const OPERACIONES_RIPPLE = ['ripple', 'rippleDel', 'cerrar', 'insertar'];
// Tanda F (paso 8, keyframes): claves bien formadas, en cuadro y dentro del
// material, y la animacion pegada al contenido despues de CUALQUIER
// operacion (animacionCorrida para clips con material; para encuadres, en
// las operaciones de ripple, encuadreCambioDeAnimacion).
const CLASES_CLAVE = ['claveInvalida', 'claveFueraDeCuadro', 'claveFueraDeMaterial'];
const CLASES_ANIMACION = ['animacionCorrida', 'encuadreCambioDeAnimacion'];

const OPERACIONES = ['cortar', 'cortarTodas', 'mover', 'moverV', 'recortar', 'ripple', 'roll',
  'slip', 'slide', 'borrar', 'rippleDel', 'colocar', 'cerrar', 'unir', 'insertar', 'bloquear', 'clave'];

// Park-Miller: chico, sin dependencias y el mismo en cualquier Node.
function crearAzar(semilla) {
  let s = (Math.floor(semilla) % 2147483647) || 1;
  if (s <= 0) s += 2147483646;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const elegir = (lista) => lista[Math.floor(rnd() * lista.length)];
  return { rnd, elegir };
}

// Congelar la entrada de cada operacion prueba de paso que el modulo sea
// puro: si alguna operacion tocara el montaje que recibe, 'use strict'
// hace que tire en vez de romper el historial de deshacer en silencio.
function congelar(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(congelar);
  }
  return o;
}

// Montaje de partida: una entrevista cortada en V1/A1 como en un short
// real, y a veces musica en otra pista de audio, un video mudo y un
// encuadre 9:16 arriba. Todo lo que el modelo tiene que tolerar junto.
// `fps` (tanda D): con base de cuadro, como en la app. Sin fps, el montaje
// continuo de antes (se sigue explorando para el vinculo).
function montajeBase(azar, fps) {
  let m = M.crearMontaje(fps ? { fps } : undefined);
  let a, b, mudo, musica;
  [m, a] = M.agregarMedia(m, { ruta: 'entrevista.mp4', duracion: 60 });
  [m, b] = M.agregarMedia(m, { ruta: 'broll.mp4', duracion: 45.3 });
  [m] = M.agregarPista(m, 'video', 'V1');
  [m] = M.agregarPista(m, 'audio', 'A1');
  [m] = M.colocarMedia(m, a, 0);
  [m] = M.colocarMedia(m, b, 60);
  if (azar.rnd() < 0.5) {
    [m, musica] = M.agregarMedia(m, { ruta: 'musica.mp3', tipo: 'audio', duracion: 90 });
    let info;
    [m, info] = M.colocarMedia(m, musica, azar.rnd() * 20);
    // Tanda E: la mitad de las veces la musica va con candado, como la
    // pondria el usuario para que el ripple no la corra.
    if (azar.rnd() < 0.5) m = M.actualizarPista(m, info.pistaId, { bloqueada: true });
  }
  if (azar.rnd() < 0.5) {
    [m, mudo] = M.agregarMedia(m, { ruta: 'mudo.mp4', duracion: 12, tieneAudio: false });
    [m] = M.colocarMedia(m, mudo, azar.rnd() * 80);
  }
  if (azar.rnd() < 0.5) [m] = M.colocarEncuadre(m, azar.rnd() * 60, 5 + azar.rnd() * 30);
  // Tanda E: el encuadre LARGO que abarca varios clips, el caso normal del
  // 9:16 y el que un ripple multipista mal hecho rechazaria siempre.
  if (azar.rnd() < 0.5) [m] = M.colocarEncuadre(m, 0, 40 + azar.rnd() * 60);
  // Tanda F: la mitad de las veces la entrevista y los encuadres vienen
  // animados (un punch-in con hasta tres claves de curvas al azar).
  if (azar.rnd() < 0.5) {
    m.pistas.filter((p) => p.tipo !== 'audio').forEach((p) => {
      M.elementosDePista(m, p.id).filter((e) => e.tipo === 'clip').forEach((e) => {
        for (let i = 0; i < 3; i++) m = ponerClaveAlAzar(m, p.id, e, azar);
      });
    });
  }
  if (azar.rnd() < 0.5) {
    const v1 = m.pistas.find((p) => p.tipo === 'video');
    const t = 5 + azar.rnd() * 40;
    m = M.cortarEn(m, v1.id, t);
    m = M.cortarEn(m, v1.id, t + 3 + azar.rnd() * 10);
  }
  return m;
}

function ponerClaveAlAzar(m, pistaId, e, azar) {
  const { rnd, elegir } = azar;
  const t = e.inicio + rnd() * e.duracion;
  const valores = M.esAjuste(e)
    ? { xPct: rnd() * 0.7, yPct: rnd() * 0.2, wPct: 0.2 + rnd() * 0.3, hPct: 0.6 + rnd() * 0.4 }
    : { escala: 0.5 + rnd() * 2, x: rnd() - 0.5, y: rnd() - 0.5 };
  return M.ponerClave(m, pistaId, e.id, t, valores, elegir(CURVAS_AZAR));
}

// Las curvas que se sortean. Se pueden achicar para aislar una falla.
let CURVAS_AZAR = M.CURVAS;
const fijarCurvasAzar = (lista) => { CURVAS_AZAR = lista; };

// Aplica UNA operacion al azar sobre un clip al azar. Los parametros
// imitan lo que manda la interfaz: tiempos cualquiera (imán apagado),
// bordes de los dos lados y destinos de pista existentes o nuevos.
// El clip que puso la ultima operacion 'insertar': no es material que se
// corrio, asi que no cuenta para encuadresQueCambiaronDeMaterial.
let clipsNuevos = [];

function operar(m, k, azar) {
  clipsNuevos = [];
  const { rnd, elegir } = azar;
  const p = elegir(m.pistas);
  const els = M.elementosDePista(m, p.id);
  const clips = els.filter((e) => e.tipo === 'clip');
  if (!clips.length) return null;
  const e = elegir(clips);
  const t = rnd() * (M.duracionMontaje(m) + 5);
  switch (k) {
    case 'cortar': return M.cortarEn(m, p.id, t);
    case 'cortarTodas': return M.cortarTodasEn(m, t);
    case 'mover': return M.moverElemento(m, p.id, e.id, Math.max(0, e.inicio + (rnd() - 0.5) * 10), null);
    case 'moverV': {
      const grupo = m.pistas.filter((x) => (x.tipo === 'audio') === (p.tipo === 'audio'));
      return rnd() < 0.5 ? M.moverAPistaNueva(m, p.id, e.id, t)
        : M.moverElemento(m, p.id, e.id, t, elegir(grupo).id);
    }
    case 'recortar': return M.recortar(m, p.id, e.id, elegir(['in', 'out']), t);
    case 'ripple': return M.ripple(m, p.id, e.id, elegir(['in', 'out']), e.inicio + (rnd() - 0.2) * 6);
    case 'roll': {
      const borde = elegir(['in', 'out']);
      const cerca = borde === 'in' ? e.inicio : e.fin;
      return M.roll(m, p.id, e.id, cerca + (rnd() - 0.5) * 4, borde);
    }
    case 'slip': return M.slip(m, p.id, e.id, (rnd() - 0.5) * 8);
    case 'slide': return M.slide(m, p.id, e.id, (rnd() - 0.5) * 4);
    case 'borrar': return M.borrar(m, p.id, e.id);
    case 'rippleDel': return M.borrarConRipple(m, p.id, e.id);
    case 'colocar': return M.colocarMedia(m, elegir(m.media).id, t)[0];
    case 'cerrar': {
      const huecos = els.filter((x) => x.tipo === 'hueco');
      return huecos.length ? M.cerrarHueco(m, p.id, elegir(huecos).id) : null;
    }
    case 'unir': return M.unirConSiguiente(m, p.id, e.id);
    case 'insertar': {
      const med = elegir(m.media);
      const desde = med.disponibleIn + rnd() * (med.disponibleOut - med.disponibleIn - 1);
      const [salida, nuevo] = M.insertarEn(m, p.id, t, med.id, { usadoIn: desde, usadoOut: desde + 0.5 + rnd() * 6 });
      clipsNuevos = nuevo ? [nuevo] : [];
      return salida;
    }
    case 'bloquear': return M.actualizarPista(m, p.id, { bloqueada: !p.bloqueada });
    case 'clave': {
      if (p.tipo === 'audio') return null;
      const r = rnd();
      if (r < 0.6) return ponerClaveAlAzar(m, p.id, e, azar);
      const claves = M.clavesEnLinea(m, p.id, e.id);
      if (!claves.length) return null;
      const c = elegir(claves);
      return r < 0.8 ? M.quitarClave(m, p.id, e.id, c.tLinea) : M.curvaDeClave(m, p.id, e.id, c.tLinea, elegir(M.CURVAS));
    }
    default: throw new Error(`operacion desconocida ${k}`);
  }
}

const firma = (f) => `${f.tipo}:${f.elId}`;

const cerca = (a, b) => Math.abs(a - b) <= 1e-6;
const igualValor = (a, b) => Object.keys(a).every((k) => cerca(a[k], b[k]));

// ¿Cada cuadro animado sigue valiendo lo mismo sobre su contenido? Para
// cada clip con material y claves de `despues`, en su primer cuadro, el del
// medio y el ultimo, busca en `antes` un clip del mismo material que
// mostrara ese cuadro de la fuente con el mismo valor. Si ese cuadro no se
// veia antes (el clip se alargo), no cuenta.
function animacionesCorridas(antes, despues) {
  const fallas = [];
  const cuadro = M.duracionCuadro(despues) || M.MIN_DUR;
  const clipsDe = (m) => m.pistas.filter((p) => p.tipo !== 'audio')
    .flatMap((p) => M.elementosDePista(m, p.id).filter((e) => e.tipo === 'clip' && !M.esAjuste(e)));
  const previos = clipsDe(antes);
  clipsDe(despues).forEach((e) => {
    if (!M.clavesDe(e).length) return;
    const n = Math.max(1, Math.round(e.duracion / cuadro));
    [0, Math.floor(n / 2), n - 1].forEach((k) => {
      const s = e.usadoIn + k * cuadro;
      const valor = M.valorAnimadoEn(e, s);
      // Si el MISMO clip estaba antes, se compara solo con el: un slip o un
      // recorte le muestra cuadros que antes mostraba otro pedazo del mismo
      // material, con otra animacion, y eso no es "correr" nada.
      const mismo = previos.find((x) => x.id === e.id);
      const dentro = (x) => x.mediaId === e.mediaId && s >= x.usadoIn - 1e-6 && s < x.usadoOut - 1e-6;
      const candidatos = mismo ? [mismo].filter(dentro) : previos.filter(dentro);
      if (!candidatos.length) return;
      if (!candidatos.some((x) => igualValor(M.valorAnimadoEn(x, s), valor))) {
        fallas.push({ tipo: 'animacionCorrida', elId: e.id,
          detalle: `clip ${e.id} fuente ${s}: ${JSON.stringify(valor)} no coincide con antes` });
      }
    });
  });
  return fallas;
}

// Lo mismo para los encuadres en las operaciones de ripple: en cuadros del
// encuadre, el material de debajo se busca en `antes` y el rectangulo que
// tenia el MISMO encuadre sobre ese mismo cuadro tiene que ser igual. Solo
// cuenta donde el material de debajo es el mismo que antes.
function encuadresQueCambiaronDeAnimacion(antes, despues, ignorar) {
  const fallas = [];
  const cuadro = M.duracionCuadro(despues) || M.MIN_DUR;
  const encuadres = (m) => {
    const r = {};
    let trabada = false;
    m.pistas.forEach((p) => {
      if (p.tipo === 'audio') return;
      if (p.bloqueada) { trabada = true; return; }
      if (trabada) return;
      M.elementosDePista(m, p.id).forEach((e) => { if (M.esAjuste(e)) r[e.id] = e; });
    });
    return r;
  };
  const debajo = (m, t, id) => {
    const capas = M.composicionEn(m, t);
    const i = capas.findIndex((c) => c.clase === 'ajuste' && c.clipId === id);
    for (let j = i - 1; j >= 0; j--) if (capas[j].clase === 'media') return { capa: capas[j], rect: capas[i].rect };
    return null;
  };
  const previos = encuadres(antes);
  Object.entries(encuadres(despues)).forEach(([id, e]) => {
    const viejo = previos[id];
    if (!viejo || !M.clavesDe(e).length) return;
    const n = Math.max(1, Math.round(e.duracion / cuadro));
    [0, Math.floor(n / 2), n - 1].forEach((k) => {
      const t = e.inicio + k * cuadro;
      const ahora = debajo(despues, t, id);
      if (!ahora || (ignorar || []).includes(ahora.capa.clipId)) return;
      // El mismo cuadro de la fuente puede haber estado DOS veces bajo el
      // mismo encuadre (material repetido): alcanza con que una coincida.
      const vistos = [];
      antes.pistas.forEach((p) => {
        if (p.tipo === 'audio') return;
        M.elementosDePista(antes, p.id).forEach((c) => {
          if (c.tipo !== 'clip' || c.mediaId !== ahora.capa.mediaId) return;
          const s = ahora.capa.tFuente;
          if (s < c.usadoIn - 1e-6 || s >= c.usadoOut - 1e-6) return;
          const pos = c.inicio + (s - c.usadoIn);
          if (pos < viejo.inicio - 1e-6 || pos >= viejo.fin - 1e-6) return;
          const entonces = debajo(antes, pos, id);
          if (!entonces || entonces.capa.clipId !== c.id) return;
          vistos.push({ pos, rect: entonces.rect });
        });
      });
      if (vistos.length && !vistos.some((v) => igualValor(v.rect, ahora.rect))) {
        fallas.push({ tipo: 'encuadreCambioDeAnimacion', elId: id,
          detalle: `encuadre ${id} en ${t} (antes ${vistos[0].pos}): ${JSON.stringify(ahora.rect)} contra ${JSON.stringify(vistos[0].rect)}` });
      }
    });
  });
  return fallas;
}

// Corre `corridas` montajes con hasta `pasos` operaciones cada uno y
// ANOTA que operacion introdujo cada violacion nueva. Una violacion de
// vinculo corta la corrida: lo que venga despues se apoyaria en un
// montaje ya roto y se le echaria la culpa a la operacion equivocada. Las
// de cuadro (clipCorto/huecoCorto) no la cortan, para no esconder detras
// de ellas las de vinculo, que son las que importan hoy.
// Los fps que se sortean por corrida cuando `fps` es 'azar': los que da una
// camara o un celular, NTSC incluidos (la grilla de 30000/1001 es la que
// mas se presta a errores de redondeo).
const FPS_AZAR = [24, 25, 30000 / 1001, 30, 50, 60];

function explorar({ semilla = 7, corridas = 400, pasos = 40, operaciones = OPERACIONES, fps = null } = {}) {
  const azar = crearAzar(semilla);
  const hallazgos = {};   // op -> tipo -> { veces, ejemplo }
  const errores = [];
  let aplicadas = 0;
  for (let corrida = 0; corrida < corridas; corrida++) {
    const fpsCorrida = fps === 'azar' ? azar.elegir(FPS_AZAR) : fps;
    let m = M.podarPistas(montajeBase(azar, fpsCorrida));
    // El montaje de partida ya puede traer pedazos cortos (cortes al azar):
    // eso es del paso 6. Lo que no puede traer es un vinculo roto.
    const inicial = M.verificarMontaje(m).filter((f) => CLASES_VINCULO.includes(f.tipo));
    if (inicial.length) {
      errores.push({ corrida, paso: -1, op: 'base', error: inicial.map(firma).join(', ') });
      continue;
    }
    for (let paso = 0; paso < pasos; paso++) {
      const k = azar.elegir(operaciones);
      const antes = new Set(M.verificarMontaje(m).map(firma));
      let salida;
      try {
        salida = operar(congelar(m), k, azar);
      } catch (err) {
        errores.push({ corrida, paso, op: k, error: String(err && err.stack || err) });
        break;
      }
      if (salida === null) continue;
      aplicadas++;
      // Igual que operarMontaje en el main: toda operacion pasa por la poda.
      const previo = m;
      m = M.podarPistas(salida);
      const nuevas = M.verificarMontaje(m).filter((f) => !antes.has(firma(f)));
      if (OPERACIONES_RIPPLE.includes(k)) {
        nuevas.push(...M.encuadresQueCambiaronDeMaterial(previo, m, { ignorarClips: clipsNuevos }));
        nuevas.push(...encuadresQueCambiaronDeAnimacion(previo, m, clipsNuevos));
      }
      if (k !== 'clave') nuevas.push(...animacionesCorridas(previo, m));
      let cortar = false;
      nuevas.forEach((f) => {
        const porOp = hallazgos[k] = hallazgos[k] || {};
        const reg = porOp[f.tipo] = porOp[f.tipo] || { veces: 0, ejemplo: { semilla, corrida, paso, detalle: f.detalle } };
        reg.veces++;
        if (CLASES_VINCULO.includes(f.tipo)) cortar = true;
      });
      if (cortar) break;
    }
  }
  return { hallazgos, errores, aplicadas };
}

module.exports = { explorar, operar, montajeBase, crearAzar, OPERACIONES, OPERACIONES_RIPPLE,
  CLASES_VINCULO, CLASES_CUADRO, CLASES_ENCUADRE, CLASES_CLAVE, CLASES_ANIMACION, FPS_AZAR,
  animacionesCorridas, encuadresQueCambiaronDeAnimacion, fijarCurvasAzar };

if (require.main === module) {
  const semilla = +process.argv[2] || 7;
  const r = explorar({ semilla, corridas: +process.argv[3] || 400, fps: process.argv[4] === 'continuo' ? null : 'azar' });
  console.log(`semilla ${semilla}: ${r.aplicadas} operaciones aplicadas`);
  Object.keys(r.hallazgos).sort().forEach((op) => {
    Object.entries(r.hallazgos[op]).forEach(([tipo, reg]) => {
      console.log(`${op} -> ${tipo}: ${reg.veces}  (corrida ${reg.ejemplo.corrida}, paso ${reg.ejemplo.paso}: ${reg.ejemplo.detalle})`);
    });
  });
  r.errores.slice(0, 5).forEach((e) => console.log('ERROR', e.op, e.corrida, e.paso, e.error.split('\n')[0]));
}
