// intervalos.js
//
// Aritmetica de intervalos [inicio, fin] compartida por cutsBuilder.js
// (resumen de cortes) y exportPlan.js (rangos que van al render).
//
// POR QUE ESTA APARTE: buildBlocks() crea bloques de SILENCIO que se
// SOLAPAN con los de habla (son dos analisis distintos del mismo audio,
// no una particion). Cualquier calculo que sume duraciones sueltas de
// bloques cortados cuenta ese solape dos veces. Eso hacia que el resumen
// mostrara porcentajes eliminados inflados (y en videos con muchos
// silencios cortos, incluso "mas del 100% eliminado").
//
// La unica forma correcta es fusionar los intervalos cortados y despues
// restarlos del rango total. Al vivir en un modulo propio, el resumen de
// la interfaz y el plan de exportacion usan exactamente la misma cuenta,
// asi que lo que dice la UI coincide con lo que sale exportado.

const EPS = 0.001;

function fusionar(intervalos) {
  const ordenados = (intervalos || [])
    .filter((iv) => iv && iv[1] - iv[0] > EPS)
    .map((iv) => [iv[0], iv[1]])
    .sort((a, b) => a[0] - b[0]);
  const fusionados = [];
  for (const [s, e] of ordenados) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && s <= ultimo[1] + EPS) {
      ultimo[1] = Math.max(ultimo[1], e);
    } else {
      fusionados.push([s, e]);
    }
  }
  return fusionados;
}

function restar(base, aQuitar) {
  const quitar = fusionar(aQuitar);
  let resultado = fusionar(base);
  for (const [qs, qe] of quitar) {
    const siguiente = [];
    for (const [s, e] of resultado) {
      if (qe <= s + EPS || qs >= e - EPS) { siguiente.push([s, e]); continue; }
      if (qs > s + EPS) siguiente.push([s, qs]);
      if (qe < e - EPS) siguiente.push([qe, e]);
    }
    resultado = siguiente;
  }
  return resultado.filter(([s, e]) => e - s > EPS);
}

function duracion(intervalos) {
  return (intervalos || []).reduce((acc, [s, e]) => acc + (e - s), 0);
}

module.exports = { EPS, fusionar, restar, duracion };
