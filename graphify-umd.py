# -*- coding: utf-8 -*-
"""
Agrega al grafo de graphify las llamadas ENTRE MODULOS COMPARTIDOS.

POR QUE HACE FALTA
------------------
Los modulos de src/shared/ usan el patron UMD: se cargan con require() en el
main y con <script> en el renderer, y quedan expuestos como un objeto global
(window.Montaje, window.Composicion...). Las llamadas se escriben entonces
`Composicion.planLienzo(...)`, no `planLienzo(...)` sobre un simbolo
importado.

El extractor AST de graphify sigue los require() con destructuring
(`const { transcribir } = require('./pythonBridge')`) y esos si los ve —hay 19
enlaces asi—, pero una llamada sobre un objeto global no tiene de donde
resolverse, y se pierden las 14 llamadas UMD del proyecto.

Consecuencia medida el 08/08/2026: la ruta mas corta entre `guionDeExport()` y
`planLienzo()` daba CUATRO saltos pasando por nodos de concepto, cuando en el
codigo uno llama al otro directo. O sea que el grafo no representaba la
dependencia central del proyecto (montaje -> composicion -> guionExport).

QUE HACE
--------
Recorre los archivos, busca las llamadas `Modulo.funcion(`, ubica la funcion
que las contiene, y agrega el enlace `calls` correspondiente. Es DETERMINISTA:
sale del texto del codigo, no de un modelo. Y es idempotente: si el enlace ya
esta, no lo duplica.

Solo emite enlaces cuyos DOS extremos existan ya en el grafo. Un enlace a un
nodo inexistente ensuciaria el chequeo de integridad de graphify, que es
justamente lo que avisa cuando el grafo se corrompe.

CUANDO CORRERLO
---------------
Despues de cada `/graphify --update`. El merge incremental descarta los nodos
y enlaces de los archivos que re-extrae, asi que estos enlaces se pierden en
cada actualizacion y hay que volver a ponerlos.

    python graphify-umd.py
"""

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).parent
GRAFO = RAIZ / 'graphify-out' / 'graph.json'

# El nombre global que expone cada modulo UMD -> el archivo donde vive.
MODULOS = {
    'Montaje': 'src/shared/montaje.js',
    'Composicion': 'src/shared/composicion.js',
    'Lienzo': 'src/shared/lienzo.js',
    'Geometria916': 'src/shared/geometria916.js',
    'Layout916': 'src/shared/layout916.js',
    'GuionExport': 'src/shared/guionExport.js',
    'Cuadros': 'src/renderer/cuadros.js',
}

# Donde buscar llamadas.
FUENTES = ['src/shared', 'src/renderer', 'src/main']

LLAMADA = re.compile(r'\b(' + '|'.join(MODULOS) + r')\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(')
# Las dos formas de declarar funcion que usa este proyecto.
DECLARACION = re.compile(r'^\s*(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(')
ASIGNACION = re.compile(r'^\s*(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s*)?\(?[^=]*=>')


def id_de(ruta_rel, simbolo=None):
    """Mismo formato de id que genera el extractor de graphify: la ruta
    relativa completa sin extension, en minusculas, con todo lo que no sea
    alfanumerico convertido en guion bajo."""
    tallo = re.sub(r'[^a-z0-9]+', '_', ruta_rel.rsplit('.', 1)[0].lower()).strip('_')
    if simbolo is None:
        return tallo
    return f"{tallo}_{re.sub(r'[^a-z0-9]+', '_', simbolo.lower()).strip('_')}"


def funcion_que_contiene(lineas, i):
    """La funcion que envuelve a la linea i, buscando hacia arriba. Si la
    llamada esta suelta en el cuerpo del modulo, devuelve None y el enlace
    sale del archivo entero."""
    for j in range(i, -1, -1):
        m = DECLARACION.match(lineas[j]) or ASIGNACION.match(lineas[j])
        if m:
            return m.group(1)
    return None


def main():
    if not GRAFO.exists():
        print(f'No encuentro {GRAFO}. Corre /graphify primero.')
        return 1

    grafo = json.loads(GRAFO.read_text(encoding='utf-8'))
    ids_existentes = {n['id'] for n in grafo['nodes']}
    ya_estan = {(l['source'], l['target'], l.get('relation')) for l in grafo['links']}

    nuevos = []
    sin_anclar = []

    for carpeta in FUENTES:
        for archivo in sorted((RAIZ / carpeta).glob('*.js')):
            rel = archivo.relative_to(RAIZ).as_posix()
            lineas = archivo.read_text(encoding='utf-8').splitlines()

            for i, linea in enumerate(lineas):
                # Saltear comentarios: el codigo de este proyecto los usa
                # mucho y nombra funciones dentro de ellos.
                despojada = linea.strip()
                if despojada.startswith('//') or despojada.startswith('*'):
                    continue

                for modulo, funcion in LLAMADA.findall(linea):
                    destino_archivo = MODULOS[modulo]
                    # No contar las llamadas de un modulo a si mismo.
                    if destino_archivo == rel:
                        continue

                    destino = id_de(destino_archivo, funcion)
                    if destino not in ids_existentes:
                        sin_anclar.append(f'{rel}:{i+1} -> {modulo}.{funcion} (no existe {destino})')
                        continue

                    envolvente = funcion_que_contiene(lineas, i)
                    origen = id_de(rel, envolvente) if envolvente else id_de(rel)
                    if origen not in ids_existentes:
                        origen = id_de(rel)
                    if origen not in ids_existentes:
                        sin_anclar.append(f'{rel}:{i+1} -> {modulo}.{funcion} (no existe el origen)')
                        continue
                    if origen == destino:
                        continue

                    clave = (origen, destino, 'calls')
                    if clave in ya_estan:
                        continue
                    ya_estan.add(clave)
                    nuevos.append({
                        'source': origen,
                        'target': destino,
                        'relation': 'calls',
                        'confidence': 'EXTRACTED',
                        'confidence_score': 1.0,
                        'source_file': rel,
                        'source_location': f'L{i+1}',
                        'weight': 1.0,
                    })

    if not nuevos:
        print('Sin enlaces nuevos: el grafo ya tiene las llamadas entre modulos.')
        return 0

    grafo['links'].extend(nuevos)
    GRAFO.write_text(json.dumps(grafo, ensure_ascii=False), encoding='utf-8')

    print(f'Agregados {len(nuevos)} enlaces `calls` entre modulos compartidos:')
    etiquetas = {n['id']: n.get('label', n['id']) for n in grafo['nodes']}
    for e in nuevos:
        print(f"  {etiquetas.get(e['source'])} -> {etiquetas.get(e['target'])}  ({e['source_file']}:{e['source_location']})")
    if sin_anclar:
        print(f'\nNo se pudieron anclar {len(sin_anclar)} (el simbolo no esta en el grafo):')
        for s in sin_anclar[:10]:
            print('  ' + s)
    return 0


if __name__ == '__main__':
    sys.exit(main())
