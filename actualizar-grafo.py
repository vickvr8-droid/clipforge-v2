# -*- coding: utf-8 -*-
"""
Actualiza el grafo de graphify en UN SOLO COMANDO.

    python actualizar-grafo.py

POR QUE EXISTE
--------------
Actualizar el grafo a mano eran cuatro pasos que se olvidan facil, y dos de
ellos ROMPIAN cosas si se corrian en el orden equivocado:

 1. `graphify --update`, que sin clave de LLM no puede nombrar comunidades.
 2. `graphify cluster-only`, que RE-AGRUPA y de paso pisa todas las etiquetas
    curadas con nombres derivados del nodo central ("settingsStore.js").
 3. `graphify-umd.py`, que hay que volver a correr porque el merge incremental
    descarta los enlaces de los archivos que re-extrae.
 4. `graphify export html`.

Este script hace lo mismo pero bien, y sobre todo NO RE-AGRUPA. Esa es la
decision de diseño importante: los identificadores de comunidad cambian en
cada re-agrupado (38 comunidades pasaron a 42 y graphify renombro las 38), asi
que re-agrupar en cada actualizacion significa perder los nombres cada vez. Un
mapa que se renombra solo cada vez que agregas un archivo no sirve como mapa.

Los nodos nuevos heredan la comunidad de sus vecinos, que para un archivo
agregado a un modulo existente es la respuesta correcta casi siempre.

CUANDO NO ALCANZA
-----------------
Si cambiaron archivos .md o .html, este script actualiza igual lo estructural
pero AVISA: los conceptos y el "por que" de esos documentos los tiene que
extraer un modelo, y eso pide `/graphify . --update` en Claude Code.

Para re-agrupar de verdad (vale la pena cuando la forma del proyecto cambio
mucho) hay que correrlo a mano y volver a etiquetar:
    graphify cluster-only .
"""

import collections
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).parent
SALIDA = RAIZ / 'graphify-out'
GRAFO = SALIDA / 'graph.json'

CODIGO = {'.py', '.ts', '.js', '.go', '.rs', '.java', '.cpp', '.c', '.rb', '.swift',
          '.kt', '.cs', '.scala', '.php', '.cc', '.cxx', '.hpp', '.h', '.kts', '.lua'}


def interprete():
    """El python que tiene graphify instalado, que no es necesariamente este."""
    p = SALIDA / '.graphify_python'
    return p.read_text(encoding='utf-8').strip() if p.exists() else sys.executable


def main():
    if not GRAFO.exists():
        print('No hay graph.json. Corre /graphify en Claude Code primero.')
        return 1

    # Este script tiene que correr CON el python de graphify. Si lo llamaron
    # con otro, se re-lanza solo en vez de fallar con un ImportError críptico.
    try:
        from graphify.detect import detect_incremental, save_manifest  # noqa
    except ImportError:
        py = interprete()
        if Path(py).resolve() == Path(sys.executable).resolve():
            print('graphify no esta instalado en', py)
            return 1
        return subprocess.call([py, __file__] + sys.argv[1:])

    from graphify.detect import detect_incremental, save_manifest
    from graphify.extract import collect_files, extract
    from graphify.build import build_merge
    from graphify.cli import _stamped_manifest_files

    incremental = detect_incremental(RAIZ)
    cambiados = incremental.get('new_files', {}) or {}
    borrados = list(incremental.get('deleted_files', []))
    total = incremental.get('new_total', 0)

    if not total and not borrados:
        print('Nada cambio desde la ultima corrida.')
        return 0

    todos = [f for fl in cambiados.values() for f in fl]
    semanticos = [f for f in todos if Path(f).suffix.lower() not in CODIGO]
    archivos_codigo = [f for f in todos if Path(f).suffix.lower() in CODIGO]

    print(f'{total} archivo(s) cambiado(s), {len(borrados)} borrado(s).')

    # --- 1. Extraccion estructural (deterministica, sin LLM) ---
    rutas = []
    for f in archivos_codigo:
        p = Path(f)
        rutas.extend(collect_files(p) if p.is_dir() else [p])

    extraccion = (extract(rutas, cache_root=RAIZ) if rutas
                  else {'nodes': [], 'edges': [], 'input_tokens': 0, 'output_tokens': 0})
    extraccion.setdefault('hyperedges', [])
    print(f'  AST: {len(extraccion["nodes"])} nodos, {len(extraccion["edges"])} enlaces')

    # --- 2. Merge contra el grafo existente ---
    previo = json.loads(GRAFO.read_text(encoding='utf-8'))
    comunidad_previa = {n['id']: (n.get('community'), n.get('community_name'))
                        for n in previo['nodes']}
    metadatos = {k: v for k, v in previo.items()
                 if k not in ('nodes', 'links')}

    G = build_merge([extraccion], graph_path=str(GRAFO),
                    prune_sources=borrados or None, root=str(RAIZ), directed=False)

    # --- 3. Comunidades: se CONSERVAN, no se recalculan ---
    # Los ids de comunidad cambian en cada re-agrupado, asi que recalcular en
    # cada actualizacion tira a la basura los nombres curados. Los nodos
    # nuevos heredan la comunidad mas frecuente entre sus vecinos.
    nodos = {n: dict(d) for n, d in G.nodes(data=True)}
    for nid, datos in nodos.items():
        cid, nombre = comunidad_previa.get(nid, (None, None))
        if cid is not None:
            datos['community'], datos['community_name'] = cid, nombre

    huerfanos = [n for n, d in nodos.items() if d.get('community') is None]
    # Dos pasadas: la primera resuelve los que tocan nodos ya ubicados, la
    # segunda alcanza a los que solo tocaban a otros huerfanos.
    for _ in range(2):
        for nid in list(huerfanos):
            vecinos = [nodos[v] for v in G.neighbors(nid) if nodos[v].get('community') is not None]
            if not vecinos:
                continue
            c = collections.Counter((v['community'], v.get('community_name')) for v in vecinos)
            (cid, nombre), _n = c.most_common(1)[0]
            nodos[nid]['community'], nodos[nid]['community_name'] = cid, nombre
            huerfanos.remove(nid)

    # Un archivo NUEVO y suelto (un script que todavia no llama a nada del
    # proyecto) no tiene ningun vecino ya ubicado, asi que la herencia no lo
    # alcanza. Sin esto quedaba sin comunidad y salia gris en el HTML, que es
    # justo donde uno lo buscaria. Cada archivo asi se vuelve su propia
    # comunidad, nombrada por el archivo.
    if huerfanos:
        siguiente = max((d.get('community', -1) for d in nodos.values()
                         if isinstance(d.get('community'), int)), default=-1) + 1
        por_archivo = collections.defaultdict(list)
        for nid in huerfanos:
            por_archivo[nodos[nid].get('source_file') or '(suelto)'].append(nid)
        for archivo, ids in sorted(por_archivo.items()):
            nombre = Path(archivo).name
            for nid in ids:
                nodos[nid]['community'] = siguiente
                nodos[nid]['community_name'] = nombre
            print(f'  comunidad nueva {siguiente}: {nombre} ({len(ids)} nodos)')
            siguiente += 1

    # --- 4. Escribir el grafo conservando el formato de graphify ---
    salida = dict(metadatos)
    salida['nodes'] = [{'id': n, **d} for n, d in nodos.items()]
    salida['links'] = [
        {**{k: v for k, v in d.items() if k not in ('_src', '_tgt', 'source', 'target')},
         'source': d.get('_src', u), 'target': d.get('_tgt', v)}
        for u, v, d in G.edges(data=True)
    ]
    salida['graph'] = {'hyperedges': list(G.graph.get('hyperedges', []))} or metadatos.get('graph', {})
    GRAFO.write_text(json.dumps(salida, ensure_ascii=False), encoding='utf-8')
    print(f'  Grafo: {len(salida["nodes"])} nodos, {len(salida["links"])} enlaces')

    # El exportador de HTML NO lee el community_name de cada nodo: lee este
    # archivo. Sin actualizarlo, una comunidad nueva sale sin nombre en el
    # panel de filtros aunque el nodo la tenga bien puesta.
    etiquetas_path = SALIDA / '.graphify_labels.json'
    etiquetas = {}
    if etiquetas_path.exists():
        try:
            etiquetas = json.loads(etiquetas_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            etiquetas = {}
    for datos in nodos.values():
        cid, nombre = datos.get('community'), datos.get('community_name')
        if cid is not None and nombre:
            etiquetas[str(cid)] = nombre
    etiquetas_path.write_text(json.dumps(etiquetas, ensure_ascii=False), encoding='utf-8')

    # Y el sidecar de analisis, que es la fuente CANONICA de comunidades para
    # `graphify export html`: solo cae al atributo de cada nodo si este
    # archivo no existe. Si queda con la particion vieja, los nodos nuevos
    # aparecen en la comunidad 0 y las comunidades nuevas salen con 0 nodos,
    # aunque graph.json las tenga bien puestas. (Verificado leyendo
    # graphify/cli.py el 08/08/2026.)
    analisis_path = SALIDA / '.graphify_analysis.json'
    analisis = {}
    if analisis_path.exists():
        try:
            analisis = json.loads(analisis_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            analisis = {}
    porcomunidad = collections.defaultdict(list)
    for nid, datos in nodos.items():
        cid = datos.get('community')
        if cid is not None:
            porcomunidad[str(cid)].append(nid)
    analisis['communities'] = dict(porcomunidad)
    analisis.setdefault('cohesion', {})
    analisis.setdefault('gods', [])
    analisis.setdefault('surprises', [])
    analisis.setdefault('questions', [])
    analisis_path.write_text(json.dumps(analisis, ensure_ascii=False), encoding='utf-8')

    # --- 5. Manifiesto (para que el proximo diff arranque de hoy) ---
    manifiesto = _stamped_manifest_files(incremental['files'], extraccion, RAIZ)
    dispatched = {f for f in semanticos}
    stamped = {f for fl in manifiesto.values() for f in fl}
    save_manifest(manifiesto, root=str(RAIZ),
                  scan_corpus={f for fl in incremental['files'].values() for f in fl},
                  clear_semantic=(dispatched - stamped) or None)

    # --- 6. Las llamadas entre modulos UMD, que el AST no ve ---
    # flush antes de cada subproceso: sin esto la salida de los hijos sale
    # ANTES que la nuestra (buffers distintos) y el log queda al reves.
    print('\n[llamadas entre modulos]', flush=True)
    subprocess.call([sys.executable, str(RAIZ / 'graphify-umd.py')])

    # --- 7. El HTML ---
    print('\n[html]', flush=True)
    subprocess.call(['graphify', 'export', 'html'], cwd=str(RAIZ), shell=(sys.platform == 'win32'))

    if semanticos:
        print('\nOJO: cambiaron documentos, y sus CONCEPTOS los tiene que leer un modelo:')
        for f in semanticos:
            print('   -', Path(f).name)
        print('  Lo estructural ya quedo actualizado. Para el "por que" de esos')
        print('  documentos, corre  /graphify . --update  en Claude Code.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
