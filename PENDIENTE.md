# PENDIENTE — ClipForge2

Lista viva de lo que falta arreglar y construir. Sale de cruzar las
investigaciones de industria contra el codigo REAL (verificado, no
copiado de los MD):

- **`D:\investigacion-clipforge\INVESTIGACION.md`** ← FxPlug, MLT, OTIO, GES,
  WebCodecs y mediabunny. Salio de este archivo el 08/08/2026 (era el 64%).
- `D:\developer.apple\FCPXML_Investigacion_07-08-2026.md`
- `D:\mltframework\MLT_Framework_Investigacion_07-08-2026.md`
- `D:\plugins-edicion\PLUGINS_EDICION_Investigacion_07-08-2026.md`
- `C:\Users\vicente\Desktop\Contexto\CTX_PROYECTO_CLIPFORGE2_1D.md`
- `C:\Users\vicente\Desktop\Contexto\CTX_PROYECTO_CLIPFORGE_1D.md`

Ultima revision: 08/08/2026. **264/264 tests pasando** (verificado con
`npm test`, no copiado: eran 245 el 07/08 y sumaron 8 de `vinculoAV.test.js`
mas 11 de `guionExport.test.js`).

Regla al tocar esta lista: no borrar un item por "ya deberia estar" —
borrarlo solo cuando se verifico contra el codigo que quedo hecho.

---

# ============================================================
# EMPEZAR ACA (handoff, 07/08/2026)
# ============================================================

## Estado en una linea
La linea de tiempo esta REHECHA y probada (264 tests): el encuadre es un
clip de ajuste en una pista normal y las pistas vacias se podan solas.
~~**La app sigue sin poder producir ningun mp4** — ese es ahora el unico
bloqueador.~~ ~~**13/09/2026: ya produce mp4 de video, todavia MUDO**~~
**13/09/2026 (tanda D): el mp4 sale CON SONIDO (mezcla de todas las pistas
de audio) y la linea de tiempo trabaja en cuadros** (ver "tanda D"). Nada commiteado desde el 05/08 (ver
[[clipforge-sin-commitear]] y la seccion 2).

## Lo que se hizo el 07/08/2026
**1.1 y 1.2 estan HECHAS.** El encuadre dejo de ser un sistema paralelo
(`recuadros.js` + canales `recuadros:*` + banda propia en la linea de
tiempo) y paso a ser un **adjustment clip**: un elemento de una pista
normal. Con eso salieron los cuatro pedidos del user de una sola vez —
se mezcla con las pistas de video, se arrastra libre, se corta y recorta
como cualquier clip, y la pista que queda vacia desaparece. Detalle
completo en 1.1.

Dos bugs que aparecieron haciendolo y NO eran del encuadre:
- cortar/mover/sobrescribir perdian `transformacion` en silencio (un clip
  con escala cortado en dos volvia a escala 1);
- el visor explotaba en cualquier tramo con sonido pero sin imagen.

## Lo que se hizo el 08/08/2026
Cuatro cosas, cada una documentada en su seccion (esto es solo el indice):

| que | donde | estado |
|---|---|---|
| Transcripcion en la NUBE (NVIDIA Parakeet) | "Transcripcion en la NUBE", mas abajo | hecho, **falta probar con una key `nvapi-` real** |
| Fuente de cuadros del export: `protocoloMedia.js` + `cuadros.js` + `guionExport.js` | 1.3.b | hecho y verificado; falta el BUCLE |
| Vinculo A/V en `ripple`/`roll`/`slip`/`slide` **y `recortar`** | seccion 2 | arreglado a medias, 8 tests: cerrar vacio, unir, slide sin material, roll desde el borde izquierdo y mover/tapar lo seguian rompiendo. **Completado 13/09/2026 (tanda B)** salvo ripple multipista |
| Mantenimiento del grafo (`actualizar-grafo.py`, `graphify-umd.py`) | "Como actualizar el grafo" | hecho |

Lo que NO cambio: sigue sin poder producir un mp4, y sigue sin commits.

## Lo que se hizo el 13/09/2026 (tanda A, copia de prueba Clipforge3-test)
**El bucle de export de VIDEO de 1.3.b esta hecho y la app ya produce un
mp4** (vertical 9:16 u horizontal). **Sale SIN SONIDO**, a proposito: el
audio va con la mezcla de pistas (orden 5 de la hoja de ruta de
`D:\investigacion-clipforge\linea-de-tiempo\INFORME.md`). 293 tests.

| que | donde |
|---|---|
| Bucle cuadro por cuadro (abre decodificadores de a poco, cierra cada cuadro, cancela limpio) | `GuionExport.ejecutarGuion`, con tests en `test/bucleExport.test.js` |
| Piezas del navegador (canvas, mediabunny, StreamTarget) | `src/renderer/exportVideo.js` |
| El mp4 va a disco por pedazos con posicion, a `.parcial` hasta terminar | `src/main/escritorExport.js` + canales `export-video:*` |
| fps del material: ffprobe ya lo media y se tiraba; ahora se guarda (campo opcional, VERSION sigue en 1) | `montaje.js agregarMedia`, `montajeGuardado.js`, `main.js montaje:agregar-media` |
| Se pide el CENTRO de cada cuadro del material (un mkv redondeado a ms repetia cuadros) | `GuionExport.tiemposParaLector` |
| `montajeUtilizable`/`montajeInicial` salieron de main.js para poder testear que un proyecto viejo abre intacto | `src/main/montajeGuardado.js`, `test/montajeGuardado.test.js` |

Verificado en Electron 33 con un banco que usa los modulos reales: dos
clips cortados, mp4/mkv, con y sin fps guardado, cuadro por cuadro sin
repetidos ni salteados; 1080p60 a ~4 ms por cuadro. **Sin verificar**: el
flujo con los botones de la app y el dialogo de guardar (checklist en
`D:\investigacion-clipforge\flujo-clipforge3\impl-A.md`). Decisiones en
`DECISIONES.md`.

## Lo que se hizo el 13/09/2026 (tanda B, pasos 2 y 3 de la hoja de ruta)
**El vinculo imagen-sonido ya no se rompe** en cerrar vacio, unir, slide,
roll, tapar y mover (el ripple multipista quedo hecho en la tanda E, paso 7).

| que | donde |
|---|---|
| Red de invariantes: `Montaje.verificarMontaje(m)` devuelve la lista de violaciones (vinculo huerfano/repetido/desalineado, material faltante o usado fuera, ids repetidos, estructura, pedazos < MIN_DUR) | `montaje.js`, `test/propiedades.test.js` |
| Prueba aleatoria con semilla (3 semillas, ~37.000 operaciones por corrida de tests). Lo que todavia falla va como `todo` con nombre y paso | `test/propiedades.generador.js` (`node test/propiedades.generador.js 7` da el informe) |
| `cerrarHueco` corre juntas las pistas con vinculados detras, lo que puedan todas | `montaje.js` |
| `unirConSiguiente` une en todas las pistas del vinculo o en ninguna | `montaje.js` |
| `slide` se acota por el material de los vecinos; `roll` recibe el borde, recorta contra un vacio y no toca vecinos cuya pareja no acompana | `montaje.js`, `main.js montaje:recortar`, `renderer.js` |
| Mover: la pareja va a su pista solo si ahi tapa el sonido de lo que tapa arriba; si no, a una pista libre (decision B1). Los restos de lo tapado conservan el vinculo o se desvinculan si ya no coinciden | `montaje.js moverConInforme`, `sobrescribirEn`, `repararVinculos`; aviso en `renderer.js avisoDePareja` |

Casos fijos en `test/vinculoB.test.js`. Informe:
`D:\investigacion-clipforge\flujo-clipforge3\impl-B.md`.

## Lo que se hizo el 13/09/2026 (tanda C, paso 4 de la hoja de ruta)
**Los gestos de la linea de tiempo ya no editan sin querer.** Solo renderer;
no toca el modelo ni proyecto.json.

| que | donde |
|---|---|
| Clic en un VACIO lo elige y lo marca; Supr lo cierra (antes el clic lo cerraba) | `renderer.js` mousedown y `borrarSeleccionado`, CSS `.tlEl.hueco.sel` |
| Umbral de arrastre de 4 px en todos los modos: un clic no recorta ni mueve cortes | `GestosTl.superoUmbral`, `arrastreTl.activo` |
| Doble clic une: se lee `ev.detail === 2` en el mousedown y ya no se rehace el HTML al elegir | `GestosTl.accionDeMousedown`, `marcarSeleccionEnDom` |
| El teclado ya no muere despues de tocar 'Imán': el filtro solo cede en campos de texto, las casillas sueltan el foco | `GestosTl.esCampoDeTexto`, `soltarFoco` |
| Escape, perder el foco o un mousemove sin boton cancelan el arrastre | `cancelarArrastreTl` |
| Manijas proporcionales (ninguna bajo 20 px) y nombre segun el ancho en pantalla | `GestosTl.geometriaClip`, `dibujarElemento` |
| Encabezados y filas con un solo scroll vertical; regla sticky | `alinearEncabezados`, CSS `#tlRegla` |
| Zoom anclado al puntero (rueda) o al cabezal (botones); tope 300 px/s; el cabezal se pagina al reproducir; cambiar el tamaño conserva la vista | `fijarZoom`, `seguirCabezal`, `alCambiarTamanoTl` |

Reglas puras en `src/renderer/gestosTl.js` con `test/gestosTl.test.js`.
Verificado en Electron 33 con eventos de entrada nativos (banco en
`D:\investigacion-clipforge\flujo-clipforge3\banco-gestos`). Informe:
`D:\investigacion-clipforge\flujo-clipforge3\impl-C.md`.

## Lo que se hizo el 13/09/2026 (tanda D, pasos 5 y 6 de la hoja de ruta)
**El mp4 sale con la mezcla de audio y todo corte cae en un cuadro.**
`Montaje.VERSION` sigue en 1: los campos nuevos son opcionales y la base de
cuadro entra con una migracion explicita al abrir.

| que | donde |
|---|---|
| `capasDeAudioEn(m,t)`: TODO lo que suena (voz en A1 + musica en A2), con ganancia de pista por volumen de clip | `montaje.js` |
| `pista.silenciada` separada de `visible` (una pista de audio vieja "oculta" se sigue leyendo muda); `pista.ganancia` y `clip.volumen` (0..4) | `montaje.js` `actualizarPista`, `ajustarVolumen` |
| Mezcla del export: por bloques de 100 ms intercalados con el video, lectores de audio que se abren y cierran por tramo, AAC (Opus de plan B) | `src/shared/mezclaAudio.js`, `cuadros.js` `abrirLectorAudio`, `exportVideo.js` |
| Encabezado de audio: boton de silencio y control de volumen (0-200 %); el visor respeta el silencio y el volumen del sonido del clip visible, pero NO mezcla (lo dice el panel de export) | `renderer.js`, `index.html` |
| `m.fps = {num, den}` y `aCuadro` en la puerta de cada operacion; lo que limita el material se redondea hacia abajo; minimo = 1 cuadro; el verificador suma `fueraDeCuadro` | `montaje.js` |
| Migracion: al abrir un proyecto sin fps se lleva la edicion a la grilla (cada corte se mueve como mucho medio cuadro) | `montajeGuardado.js` `asegurarBaseDeCuadro`, `Montaje.alinearACuadro` |
| Interfaz: `tiempoDesdeX` redondea al cuadro, flechas = 1 cuadro (Shift = 1 s), tope de zoom 10 px por cuadro, export al fps del montaje | `renderer.js`, `gestosTl.js`, `guionExport.js` |

Tests: `test/baseCuadro.test.js`, `test/mezclaAudio.test.js`, y la prueba
aleatoria ya corre con fps (los 5 `todo` de pedazos menores a un cuadro se
fueron). Verificado en Electron 33 (bancos `banco-audio` y `banco-cuadro` en
`D:\investigacion-clipforge\flujo-clipforge3`). Informe: `impl-D.md` ahi.
Sin control en la interfaz todavia: volumen por CLIP y cambiar el fps del
montaje (el modelo y los canales `montaje:volumen` / `montaje:fps` estan).

## Lo que se hizo el 13/09/2026 (tanda E, paso 7 de la hoja de ruta)
**Ripple multipista: sacar una frase deja cada encuadre sobre su frase.**
`Montaje.VERSION` sigue en 1 (`pista.bloqueada` es opcional).

| que | donde |
|---|---|
| Una primitiva para borrar con ripple, ripple, cerrar un vacio e insertar: saca o abre el MISMO tramo en todas las pistas no bloqueadas (`planDeCorrer`, `sacarTramo`, `abrirTramo`) | `montaje.js` |
| Un encuadre que cruza el tramo se acorta o se estira, no frena (decision E1, la correccion del critico). Material de otra pista en el tramo frena: borrar con ripple e insertar no hacen nada, ripple y cerrar llegan hasta donde puedan todas (E2). Un ripple que nace en V2 sigue las mismas reglas (E4) | `montaje.js` |
| `pista.bloqueada` con candado en el encabezado; ninguna nace bloqueada (E3). Si el candado separaria a un clip de su pareja, no se hace nada | `montaje.js actualizarPista`, `renderer.js`, `index.html` (columna a 168 px) |
| Las operaciones devuelven un informe (`...ConInforme`) y la interfaz dice que pista freno y que hacer | `main.js`, `renderer.js textoDeRipple` |
| `Montaje.encuadresQueCambiaronDeMaterial(antes, despues)`: la prueba aleatoria la corre para las cuatro | `montaje.js`, `test/propiedades.*` |

Tests: `test/rippleMultipista.test.js`; la prueba aleatoria suma `insertar` y
`bloquear` y ya no tiene ningun `todo`. Verificado en Electron 33 (banco
`banco-ripple` en `D:\investigacion-clipforge\flujo-clipforge3`). Informe:
`impl-E.md` ahi. NO toca el candado: cortar con la cuchilla, mover y
recortar siguen editando pistas bloqueadas (el candado es solo "no se
corre").

## Lo que se hizo el 19/09/2026 (tanda G, pasos 9 y 10 de la hoja de ruta)
**Se ve lo que va a quedar antes de soltar; varios clips se mueven juntos; los clips de audio muestran la onda.**
`Montaje.VERSION` sigue en 1.

| que | donde |
|---|---|
| Vista previa real: la misma operacion que el main (con pareja, vecinos, pista nueva y ripple frenado) en una capa encima de cada fila que cambia (G1) | `src/renderer/previewTl.js`, `renderer.js programarPreview` |
| Iman por el inicio y el fin del clip, sin sus propios bordes; Shift lo invierte; linea donde pega (G3) | `PreviewTl.puntosSinPropios`, `imantarBloque` |
| Autoscroll al llegar al borde con zoom | `PreviewTl.pasoDeAutoscroll` |
| Seleccion multiple: Ctrl/Shift+clic; arrastre y Supr en un paso (G2) | `Montaje.moverGrupo`, `borrarGrupo`, canal `montaje:grupo` |
| Onda en clips de audio: picos del archivo del material, cache en `proyectos/<slug>/picos`, canvas recortado a la vista (G4) | `src/main/picosBridge.js`, canal `media:picos` |

Tests: `test/tandaG.test.js`. Verificado en Electron 33 con el banco
`banco-preview` en `D:\investigacion-clipforge\flujo-clipforge3`. Informe:
`impl-G.md` ahi. FALTAN las miniaturas en clips de video (ver abajo).

## Lo que sigue pendiente de decidir
**El planificador de exportacion con ffmpeg-por-linea-de-comandos ya no
corresponde escribirlo.** Ver 3.g. Con `mediabunny` + `@mediabunny/server`
la exportacion es `CanvasSource.add(t, dur)` sobre el MISMO canvas que se
ve. Se sigue usando FFmpeg, pero como libreria (NodeAV), no por CLI.

## Orden de trabajo (forzado, no es preferencia)
1. ~~**1.1** encuadre → adjustment clip~~ ✅ 07/08/2026
2. ~~**1.2** poda de pistas vacias~~ ✅ 07/08/2026
3. ~~**1.3.a** el plan de dibujo compartido (`composicion.js`)~~ ✅ 07/08/2026
4. **1.3.b** el encoder con mediabunny. ← EMPEZAR ACA
   **13/09/2026: el bucle de VIDEO esta hecho** y desde la tanda D el mp4
   lleva la mezcla de audio. Quedan 1.3.c/1.3.d y los controles de fps y
   calidad en la interfaz.
   **La fuente de cuadros ya esta hecha y verificada (08/08/2026):**
   `protocoloMedia.js` + `cuadros.js` + `guionExport.js`. Falta el BUCLE
   que las une con el encoder. Leer la tabla de medicion en 1.3.b antes
   de tocar nada: define la forma del bucle.
   **La libreria ya esta instalada y enganchada**, y se probo que produce
   un mp4 valido. Falta el bucle real. Corre en el RENDERER, no en el main
   (el motivo importa, esta en 1.3.b).
   **1.3.c** (dos motores segun el largo) y **1.3.d** (empaquetar ffmpeg)
   quedaron APARTE por pedido del user — leerlos antes de tocarlos, los
   dos tienen trampas anotadas.
5. **1.4** keyframes sobre `transformacion` — desbloquea CUATRO cosas de
   una: encuadre animado, presets/titulos animados, camara lenta y
   transiciones. Es la pieza que mas rinde.
6. Recien despues, features (seccion 3).

**Antes de 1.3, hacer un commit.** Van ~8 sesiones sin uno, y ahora hay
dos archivos muertos (`src/shared/recuadros.js` y `test/recuadros.test.js`)
que no se borraron justamente porque no hay red: no existen en
`E:\Clipforge2` ni en git.

## Transcripcion en la NUBE — hecho 08/08/2026 (fuera del orden forzado)

Pedido del user: "que clipforge acepte keys de IAs, sobre todo una que
transcriba audio a texto y asi no usar el ordenador en el proceso".

**Tercer motor de transcripcion: `nvidia`** (NVIDIA Parakeet via Riva/NVCF).
No toca la GPU: lo unico local es ffmpeg extrayendo el audio.

- `python-backend/transcribe_nvidia.py` — streaming gRPC, devuelve el
  MISMO shape que WhisperX (`segments[].words[]` en segundos), asi que
  `cutsBuilder`, el SRT y la linea de tiempo no se enteran del cambio.
- `src/main/nubeBridge.js` — reusa `pythonBridge` como los otros dos.
- La key sale de `keysStore` por PROVEEDOR (`nvapi-` ya se detectaba
  solo). Viaja por ENTORNO al proceso hijo, nunca por argumentos.
- Config no-secreta en `settingsStore.leer().nube` + panel propio en la UI.

**Datos verificados contra el servidor real de NVIDIA (no de la doc):**
- El `function-id` de `parakeet-ctc-0.6b-es` es
  `a9eeee8f-b509-4712-b19d-194361fa5f31`. Sin el, el server contesta
  `INVALID_ARGUMENT: no function-id was passed in the metadata`. Esta
  hardcodeado como default en el script.
- Con key invalida NVCF devuelve **PERMISSION_DENIED**, no UNAUTHENTICATED.
  El mapeo de errores esta hecho contra lo que devuelve de verdad.
- El modelo existe y es real: 600M params, 28.000+ h de es-US + en-US,
  bilingue con code-switch, puntuacion nativa. La critica anterior
  ("el español de Parakeet es peninsular") era sobre `parakeet-tdt-0.6b-v3`
  y NO aplica a este.

**Lo que NO da este motor, y por que:**
- **Diarizacion.** parakeet-ctc devuelve texto y tiempos, no quien habla.
  Para eso sigue siendo WhisperX + pyannote local. Se complementan.
- **Modelo N-gram propio (KenLM).** Solo se puede acoplar corriendo el
  modelo LOCAL en NeMo; contra la API el decodificador es de NVIDIA. Y
  local no es opcion aca: NIM pide Volta/Turing en adelante y la GTX 1060
  es Pascal (cc 6.1). Lo que SI viaja en la peticion es **word boosting**
  (`add_word_boosting_to_config`), que es la palanca real para modismos
  chilenos y nombres propios — expuesta en la UI como "palabras a reforzar".
- **VAD externo.** Sobra: Riva ya trae el suyo.

**PROBADO CON KEY REAL — 09/08/2026. ✅ ANDA**, pero hubo que cambiar el
modelo. 30 s de audio en 4.3 s, salida con la forma exacta de WhisperX
(`segments[].words[].{word,start,end,score}` en segundos, 0 tiempos
invalidos), asi que `cutsBuilder` y el SRT no se enteran.

**`parakeet-ctc-0.6b-es` ESTA CAIDO del lado de NVIDIA.** Falla siempre con
`DEADLINE_EXCEEDED: "failed to establish link to worker"` a los ~30 s, en
streaming Y en offline. Figura `ACTIVE` en `/v2/nvcf/functions`, pero NVCF no
consigue worker que lo atienda. **No es la key ni es nuestro codigo** — eso
costo un rato de diagnostico porque el reflejo es ir a revisar la key.

Medido el mismo dia, misma key, mismos 30 s:

| funcion | resultado |
|---|---|
| `parakeet-ctc-0.6b-es` | 30.9 s, sin worker |
| `parakeet-ctc-riva` | 30.8 s, sin worker |
| `canary-1b-asr` | 1.8 s, transcribe pero **0 tiempos por palabra** |
| `parakeet-ctc-1.1b-asr` | `INVALID_ARGUMENT` con es-US (solo ingles) |
| **`parakeet-1.1b-rnnt-multilingual`** | **2.3 s, español + palabras con tiempos** ← el que quedo |

El criterio que decide es **tiempos por palabra**, no calidad: `cutsBuilder`
arma los bloques y el SRT desde `words[].start/end`, asi que una funcion sin
tiempos no sirve por buena que transcriba. Eso saca a canary y deja una sola.

Id nuevo por defecto: `71203149-d3b7-4460-8231-1be2543a1fca`. Si algun dia
vuelve el de español, se pone su id en `CLIPFORGE_NVCF_FUNCTION_ID` sin tocar
codigo.

**Lo que queda por evaluar:** la CALIDAD en español. Sobre un fragmento con
ruido devolvio "Tenia una espada entera bepa ni lateral valio", que puede ser
el audio o puede ser el modelo — con una sola muestra no se sabe. Probar con
audio limpio antes de darlo por bueno para produccion.

`nvidia-riva-client` 2.26.0 quedo instalado en el venv de WhisperX — bajo
protobuf de 7.35.1 a 6.33.5 y se comprobo que WhisperX, torch/CUDA y la
diarizacion siguen funcionando.

## Como actualizar el grafo de graphify (08/08/2026)

```bash
python actualizar-grafo.py
```

Eso es todo cuando cambio CODIGO. Si cambiaron `.md` o `.html`, el script
actualiza igual lo estructural y avisa cuales necesitan que un modelo les lea
los conceptos: para eso, `/graphify . --update` en Claude Code.

### Que hace, y por que no es solo llamar a graphify

`actualizar-grafo.py` encadena cuatro cosas que a mano se olvidan o se corren
en el orden equivocado. Las tres primeras son arreglos a problemas REALES, no
comodidad:

**1. NO RE-AGRUPA.** Los ids de comunidad cambian en cada re-agrupado (38
comunidades pasaron a 42 y graphify renombro las 38 por su nodo central). Un
mapa que se renombra solo cada vez que agregas un archivo no sirve como mapa.
Los nodos nuevos heredan la comunidad de sus vecinos; un archivo suelto que
todavia no llama a nada se vuelve su propia comunidad, nombrada por el archivo.

**2. Repone las llamadas entre modulos UMD** (`graphify-umd.py`, que el script
llama solo). Los modulos de `src/shared/` se llaman como
`Composicion.planLienzo(...)`, o sea metodos sobre un objeto global. El
extractor AST sigue los `require()` con destructuring —esos si, hay 19
enlaces— pero una llamada sobre un global no tiene de donde resolverse.
Medido: sin esto, la ruta mas corta entre `guionDeExport()` y `planLienzo()`
daba **cuatro saltos por nodos de concepto** cuando en el codigo uno llama al
otro directo. Son 60 enlaces y hay que reponerlos en CADA actualizacion,
porque el merge incremental descarta los de los archivos que re-extrae.

**3. Sincroniza `.graphify_analysis.json`.** Es la fuente CANONICA de
comunidades para `graphify export html`; el atributo de cada nodo solo se usa
si ese archivo no existe (verificado leyendo `graphify/cli.py`). Si queda con
la particion vieja, los nodos nuevos aparecen en la comunidad 0 y las
comunidades nuevas salen con 0 nodos en el panel — aunque `graph.json` las
tenga perfectas. Tambien actualiza `.graphify_labels.json`, que es de donde
salen los NOMBRES.

**4. Regenera el HTML.**

### Dos trampas mas

- **Sin `GEMINI_API_KEY` graphify no puede nombrar comunidades**: las deja como
  `Community N`. `graphify cluster-only` y `graphify label` PISAN las etiquetas
  curadas cada vez que corren. Si hay que re-agrupar de verdad (vale la pena
  cuando la forma del proyecto cambio mucho), despues hay que volver a
  etiquetar a mano en `graph.json`, `.graphify_labels.json`,
  `.graphify_analysis.json` y el texto del reporte.
- **`graphify path` busca DIRIGIDO por defecto** y este grafo es no-dirigido:
  sin `--undirected` contesta "No directed path found" aunque el camino exista.

## Bugs abiertos que NO son de arquitectura (seccion 2)
~~`ripple`/`roll`/`slip`/`slide` ignoran el `vinculo` de audio~~ (arreglado
08/08 y completado 13/09, tanda B; el ripple multipista quedo hecho el 13/09,
tanda E); multi-capa;
fotos sin loader; panel Ajustes sin UI; miniaturas; el `.mkv` "corrompido"
(que 3.f/3.g probablemente resuelvan solos).

## Documentacion bajada a disco (no volver a bajarla)
| Carpeta | Contenido |
|---|---|
| `D:\gstreamer-docs\ges\` | GES completo, 68 paginas |
| `D:\gstreamer-docs\deploy\` | deploying (windows/mac/index) |
| `D:\webcodecs-docs\` | WebCodecs, 18 paginas (3 guias + 15 interfaces) |
| `D:\mediabunny-docs\` | Mediabunny, 21 archivos — **incluye `llms-full.txt`, la doc ENTERA (307 KB) en un archivo** |

**Herramienta**: `D:\uv-tools-bin\scrapling.exe`
Uso: `scrapling extract get "<url>" salida.md --ai-targeted`
Baja la pagina ya convertida a Markdown limpio; despues se lee con
grep/sed. Cuesta una fraccion de traerla por el navegador.
**Truco aprendido**: buscar SIEMPRE `/llms.txt` y `/llms-full.txt` en el
sitio antes de bajar pagina por pagina — muchas docs modernas publican todo
en un solo archivo pensado para esto.

## Lo que ya NO hace falta investigar
Cuatro modelos de timeline leidos completos y convergentes (OTIO, MLT,
FCPXML, GES) + WebCodecs + Mediabunny + plugins. **El modelado esta
agotado**: un quinto modelo no va a cambiar ninguna decision. Lo unico que
podria sumar es implementacion puntual (un filtro de ffmpeg, la API de
Remotion) y eso se consulta en el momento, no se investiga antes.

## Aviso de metodo (paso 3 veces en esta sesion)
Se declaro "leido completo" tres veces sin serlo: primero faltaban 13
paginas, despues 7 leidas a medias, despues la referencia de API. **Antes
de decir que algo esta cubierto, cruzar la lista real de paginas contra lo
que se leyo de verdad.**

---

## 0. YA CORREGIDO (07/08/2026) — no volver a "arreglar"

- [x] **Los campos de un clip se perdian al derivarlo** (`montaje.js`).
      Cortar, mover, recortar y sobrescribir armaban el elemento nuevo
      llamando a `clip()` con los cuatro campos que esa funcion conocia,
      asi que cualquier campo agregado despues desaparecia sin dar error.
      Sintoma real: **cortar en dos un clip al que se le habia cambiado la
      escala devolvia las dos mitades en escala 1.** Ahora todo pasa por
      `derivar()`, que copia el elemento entero y pisa solo lo que cambia.
- [x] **El visor explotaba en un tramo con sonido pero sin imagen**
      (`montaje.js` + `renderer.js`). `capaDeAudioEn()` no devolvia
      `transformacion`, y el visor la leia sin preguntar: "Cannot read
      properties of undefined (reading 'escala')". No es un caso borde —
      las pistas de imagen y sonido son independientes, asi que basta con
      que el video termine antes que el audio. Ahora la capa de audio
      tiene la MISMA forma que una de imagen.
- [x] **`armarPlanExportacion()` muerta y rota** (`main.js`). Referenciaba
      cuatro cosas inexistentes en el archivo: `planificarExportacion` (nunca
      importada), `cellLayoutsState`, `clips`, `trim`. Nadie la llamaba, asi
      que el ReferenceError estaba latente. **Borrada.**
- [x] **`exportRunner.js` pedia `require('./exportPlan')`** (borrado el
      06/08). Nadie carga ese modulo hoy, por eso la app arrancaba igual,
      pero era una mina para quien conectara la exportacion. Ahora se
      resuelve DENTRO de `ejecutar()` y falla con un mensaje que dice que
      falta. **Ojo: el user habia pedido a los chats de investigacion NO
      tocarlo. Si lo queria intacto como señal, revertir.**
- [x] **`detectSilences()` sin `duracionTotal`** (GAP registrado el
      05/08). `ffmpeg -silencedetect` no emite `silence_end` si el archivo
      termina en silencio; el arreglo existia en `silenceBridge.js` pero
      nunca corria. Ahora se mide con `probe()` y se pasa.
- [x] **`tieneAudio` se perdia en `agregarMedia()`** (`montaje.js`). El main
      lo mandaba y el modelo lo descartaba, asi que TODO material bajaba un
      clip a la pista de audio — incluso una foto o un video mudo.
- [x] **Encabezados de pista corridos 1px** respecto de sus pistas.
- [x] **El visor no repintaba tras un seek.** Al pasar el visor a canvas,
      el cuadro se dibujaba en el mismo instante en que se pedia el salto,
      cuando todavia no estaba decodificado. Ahora escucha `seeked` /
      `loadeddata` / `requestVideoFrameCallback`.

---

## 1. ARQUITECTURA — en este orden, el orden esta FORZADO

Los tres items baratos de la tabla de plugins (LUTs, denoise, subtitulos
quemados) son un flag de ffmpeg sobre un comando **que hoy no existe**. Y
el planificador lee del modelo. Si se escribe antes de la migracion, se
escribe dos veces.

### 1.1 El ENCUADRE pasa a ser un CLIP DE AJUSTE  ← ✅ HECHO 07/08/2026
### 1.2 Poda de pistas vacias  ← ✅ HECHO 07/08/2026

**Las dos estan implementadas y verificadas.** Lo de abajo queda como el
razonamiento que llevo al diseño (sirve para entender POR QUE quedo asi),
pero el trabajo esta hecho. Lo que quedo:

| Donde | Que |
|---|---|
| `montaje.js` | `encuadre()`, `esAjuste()`, `colocarEncuadre()`, `ajustarEncuadre()`, `encuadresEn()`, `migrarRecuadros()`, `podarPistas()`, `derivar()` |
| `main.js` | canal `montaje:encuadre` (solo crear/ajustar); poda dentro de `operarMontaje`; el layout 9:16 viaja en `respuestaMontaje` |
| `renderer.js` | se fue la banda de encuadres entera y su arrastre propio; un encuadre se dibuja como `.tlEl.clip.ajuste` |
| tests | `test/encuadreAjuste.test.js`, 28 casos. **230/230 pasando.** |

Verificado ademas en el navegador (no solo con tests): crear desde el
cabezal, ajustar el rect desde el visor, recortar el borde, cortarlo en
dos, moverlo a una pista de video, y que la pista que queda vacia
desaparezca — todo con UN solo paso de deshacer por gesto.

**Tres cosas que aparecieron haciendolo y conviene saber:**

1. **`derivar()` arreglo un bug que ya existia y no daba error.** Cortar,
   mover, recortar y sobrescribir armaban el elemento nuevo llamando a
   `clip()` con los cuatro campos que conocian, asi que **cualquier campo
   agregado despues se perdia en silencio**. Concreto: cortar en dos un
   clip al que se le habia cambiado la escala devolvia las dos mitades en
   escala 1. Ahora se copia todo y se pisa solo lo que cambia.
2. **La capa de audio no traia `transformacion`.** El visor tiraba
   "Cannot read properties of undefined (reading 'escala')" en cualquier
   tramo con sonido pero sin imagen — un caso normal, no un borde.
   Encontrado MIRANDO el visor, no con un test.
3. **Los botones "+V" y "+A" se fueron.** Con la poda, una pista creada a
   mano se borraba en el mismo paso. Las pistas aparecen solas.

**`src/shared/recuadros.js` y `test/recuadros.test.js` quedaron muertos**
pero SIN BORRAR: no hay commit desde el 05/08 y ese archivo no esta en
`E:\Clipforge2`, asi que borrarlo hoy seria borrarlo del unico lugar
donde existe. Los dos tienen un banner arriba que lo dice. **Borrarlos en
cuanto haya un commit.**

Falta todavia, y NO es de este item: el 9:16 recorta del lienzo 16:9 ya
compuesto, asi que la regla real del adjustment clip ("aplica solo a lo
que tiene DEBAJO") recien se va a poder respetar de verdad cuando el
lienzo componga varias capas (ver seccion 2, "multi-capa real").

<details>
<summary>Razonamiento original (07/08/2026) — por que quedo asi</summary>

#### El planteo que se descarto: el encuadre como propiedad del clip
Hoy `recuadros.js` es un sistema PARALELO al montaje: por eso "la pista de
los encuadres no se puede mezclar con las de video" (reporte del user).

Las dos fuentes coinciden en que eso esta mal:
- **FCPXML**: `adjust-crop mode="crop"` es un parametro INTRINSECO del clip
  (`%intrinsic-params-video;`), al mismo nivel que `adjust-transform`.
- **MLT**: "attached filters" — pegados a un producer individual, viajan
  con el clip si se reordena.

Dos encuadres simultaneos (cara + gameplay apilados en el 9:16) = **el
mismo clip fuente en dos pistas, cada copia con su propio recorte**, que
es como se hace en un editor real.

#### CORRECCION 07/08/2026 (tarde) — hay un TERCER lugar donde puede vivir
#### un efecto, y es el que le faltaba a este diseño
Leyendo `mltframework.org/docs/fxcut/` (pagina que la investigacion
anterior no cubrio) aparece el **FX Cut / adjustment clip**, y resuelve el
agujero que dejaba el modelo de "crop pegado al clip": un recuadro de
ClipForge **abarca varios clips**, y un ajuste intrinseco del clip no
puede expresar eso sin duplicar el recuadro en cada uno.

Los tres lugares posibles, los tres reales y usados:
1. **Pegado al clip** (attached filter de MLT / parametro intrinseco de
   FCPXML) — viaja con el clip si se reordena.
2. **En la pista** (`track="N"`) — aplica a la pista entera.
3. **FX Cut / adjustment clip** — un clip que vive en una PISTA NORMAL,
   cuya imagen propia se descarta, y cuyos filtros se aplican a **todo lo
   compuesto de las pistas de abajo, solo durante el tramo que ocupa**. Lo
   que esta ARRIBA se compone encima del resultado ya filtrado, sin ser
   procesado.

**El 3 es exactamente lo que pidio el user**: un encuadre pasa a ser un
clip como cualquier otro, en una pista como cualquier otra — se mezcla con
las de video, se arrastra libre, y la pista se poda si queda vacia. No
hace falta ningun tipo de pista especial, que era justo el reclamo.

Detalle de implementacion que MLT marca como obligatorio: la marca
(`meta.fx_cut`) va **en el productor Y en la entrada de la playlist**, no
en uno solo. En el modelo de ClipForge eso se traduce a marcar el elemento
en la pista, no el media.

**Decision para 1.1**: el encuadre se modela como adjustment clip (opcion
3), no como propiedad del clip (opcion 1). La opcion 1 se queda para
`transformacion`, que SI es por clip y ya funciona asi.

Consecuencia: `recuadros.js` + `layout916.js` + `geometria916.js` se
absorben en `montaje.js` + `lienzo.js`. Cambia la forma de `proyecto.json`.

Con esto salen solos los 4 pedidos del user del 07/08:
- no hay pista de encuadres que no se mezcle, porque **no hay pista de
  encuadres**;
- las pistas vacias se podan (ver 1.2);
- un encuadre se arrastra libre porque ES un clip.

**NO copiar el modelo de *lanes* de FCPXML** (sin pistas, todo anclado
relativo). Es mas generico pero la propia investigacion dice que es mas
dificil de implementar, y ClipForge ya es un editor de pistas como
Kdenlive/Shotcut.

Poda de pistas vacias: una pista sin elementos se elimina (menos la
ultima de cada grupo). MLT confirma que esto NO lo resuelve ningun motor:
es responsabilidad de la app. Va en `operarMontaje` y no dentro de cada
operacion — borrar, mover y cerrar un hueco dejan una pista vacia por
caminos distintos y ninguno de los tres tiene por que saberlo.

</details>

### 1.3 Exportacion — EL BLOQUEADOR REAL
**Hoy NO se puede producir ningun mp4.** La exportacion de datos
(JSON/SRT/transcripcion) si anda.

#### 1.3.a El plan de dibujo compartido ← ✅ HECHO 07/08/2026
`src/shared/composicion.js`. Dado un montaje y un instante, devuelve
QUE dibujar y DONDE, sin dibujar nada:

- `planLienzo(m, t, lienzo, fuentes)` → capas del proyecto, cada una con
  su rectangulo destino ya resuelto (`Lienzo.rectDeCapa`), su `tFuente`
  (de que segundo del ARCHIVO sale el cuadro) y los ajustes aparte;
- `planVertical(m, t, origen, salida, layout)` → una celda por encuadre
  activo, con el recorte "cover" sobre el lienzo YA COMPUESTO;
- `resolucionSalida()` / `aPar()` → medidas pares (yuv420 aborta con un
  lado impar).

`renderer.js` ya no calcula nada: `dibujarLienzo()` y `dibujar916()`
ejecutan el plan. **La exportacion tiene que ejecutar el mismo.**

**Como cambio el "ACUERDO PREVIEW ↔ EXPORT"** (la nota vieja decia
restaurarlo desde `E:\Clipforge2`, y eso ya no aplica): esos tests
comparaban DOS cuentas —el canvas contra los filtros que armaba
`exportPlan.js`— y avisaban *despues* de que divergieran. Ahora hay una
sola cuenta, asi que el acuerdo se testea distinto: el mismo plan a
cualquier resolucion tiene que describir las MISMAS FRACCIONES. Esta en
`test/composicion.test.js` (15 casos).

> **Restriccion que salio de ahi y no era obvia**: el recorte "cover"
> depende de la FORMA del destino, asi que **el buffer del preview tiene
> que ser proporcional a la salida** o lo que se ve no es lo que se
> exporta. Hoy se cumple porque `#canvas916` esta fijo en 1080x1920 y el
> CSS solo lo escala. Hay un test que se cae si alguien lo "optimiza"
> ajustando el buffer al tamaño del panel en pantalla.

#### 1.3.b El encoder ← LO QUE SIGUE
**Decision de arquitectura: la exportacion corre en el RENDERER, no en el
main.** Es lo contrario de la version vieja (main + spawn de ffmpeg), y
sale de como funciona mediabunny: `CanvasSource` toma un `<canvas>` del
DOM y el bucle es literalmente

```js
const output = new Output({ format: new Mp4OutputFormat(), target: ... });
const videoSource = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') });
output.addVideoTrack(videoSource);
await output.start();
for (...) await videoSource.add(t, 1 / fps);
await output.finalize();
```

O sea: el canvas que YA se esta viendo es la fuente del mp4. Poner eso en
el main obligaria a recrear un canvas alla y volveria a haber dos caminos,
que es el problema que 1.3.a acaba de cerrar.

**`mediabunny` YA ESTA INSTALADA** (08/08/2026, v1.52.3, en
`dependencies`). Lo que se verifico al instalarla, para no volver a
averiguarlo:

- **Se carga con un `<script>` normal, sin bundler.** El bundle
  `dist/bundles/mediabunny.min.cjs` (635 KB) termina en
  `var Mediabunny = (() => {...})()`, o sea que deja el global igual que
  los modulos propios, y **no tiene ni un `require` externo**. Por eso la
  ventana sigue con `contextIsolation: true` y `nodeIntegration: false`.
  Ya esta enganchada en `index.html`.
- **Licencia MPL-2.0**, no GPL. Copyleft por archivo: si se modifican
  archivos de mediabunny hay que publicar esos archivos; la app queda
  como esta. Es el caso comodo (comparar con la discusion de ffmpeg en
  1.3.c).
- **Codecs medidos en Chromium el 08/08/2026**: codifican `avc`, `hevc`,
  `vp8`, `vp9`, `av1`, `aac` y `opus`. NO codifican `mp3` ni `flac`.
  **El AAC anda**, que era el riesgo anotado — no hace falta el polyfill
  `@mediabunny/aac-encoder`. Igual hay que preguntar con `canEncode()`
  antes de exportar: depende del build de Chromium que traiga Electron, no
  de mediabunny.
- **Probado de punta a punta**: canvas → `CanvasSource` →
  `Mp4OutputFormat` → `BufferTarget` produce un mp4 valido (firma `ftyp`).
  La cadena entera funciona.

⚠ **`build.files` de `package.json` no menciona `node_modules`.** Se le
agrego `node_modules/**/*` para que el instalador no salga sin el
codificador. **Sin verificar con un build real** — comprobarlo la primera
vez que se corra `npm run dist`.

Pasos, en orden:
1. ~~Alimentar el lienzo desde un decodificador y no desde el `<video>`~~
   ✅ **LA FUENTE DE CUADROS ESTA HECHA Y VERIFICADA (08/08/2026)**, ver
   el bloque de abajo. Lo que queda del paso 1 es usarla en el bucle.
   **Probablemente arregle solo el bug del `.mkv`**: mediabunny parsea
   Matroska el mismo y le pasa los paquetes a WebCodecs, mientras que el
   `<video>` de Chromium solo entiende el subconjunto WebM.

##### La medicion que define el diseño del encoder (Chromium, 1080p h264)

|  como se piden los cuadros            | costo por cuadro | |
|---------------------------------------|------------------|--------------------|
| `samplesAtTimestamps` (lote ordenado) | **2,5 ms**       | 13,6x tiempo real  |
| `getSample()` de a uno                | **72,7 ms**      | **29,6x mas lento**|
| salto arbitrario                      | ~134 ms          |                    |

**Consecuencias, y no son negociables:**

- El export **tiene que** pedir los cuadros por LOTE ORDENADO. La version
  "simple" (que cada capa pida el cuadro que necesita cuando le toca)
  convierte un export de 45 segundos en uno de 20 minutos, y no rompe
  ningun test — por eso hay tests especificos en `test/guionExport.test.js`
  que fijan que los tiempos salgan ordenados.
- Como hay que saber TODOS los instantes de antemano, hace falta una
  pasada previa sobre la linea de tiempo. Eso es `src/shared/guionExport.js`.
- **El `<video>` del visor NO se reemplaza.** A 134 ms por salto, mover el
  cabezal con el decodificador se sentiria pegajoso. El decodificador es
  para exportar; el `<video>` sigue siendo el del preview. (Esto contradice
  lo que decia el paso 1 original, que daba por hecho que se reemplazaba.)

##### Lo que quedo construido y verificado

- **`src/main/protocoloMedia.js`** — esquema `cf-media://` con soporte de
  Range. Existe porque mediabunny pide el archivo con `fetch`, y `fetch`
  sobre `file://` esta bloqueado con webSecurity activo; leer el archivo
  entero a un Blob eran varios GB en RAM. **Trampa ya pagada:** el esquema
  se registra como `standard`, asi que la ruta NO puede ir en el host
  (`fetch` tira "Failed to parse URL" antes de llegar al main). Va host
  fijo `archivo` y la ruta percent-encoded en el path.
- **`src/renderer/cuadros.js`** — el lector por CLIP (no por archivo: dos
  clips del mismo material pueden estar visibles a la vez yendo por
  partes distintas). API de iterador, por la medicion de arriba.
- **`src/shared/guionExport.js`** + 11 tests — la pasada previa: que
  instantes pedirle a cada clip y en que cuadro de salida va cada uno.
  Reusa `Composicion.planLienzo`, no recalcula nada.

Verificado **dentro de Electron** (no en un Chromium suelto): el protocolo
devuelve 206 con el Content-Range correcto, mediabunny mide el archivo a
traves de el, y decodifica cuadros reales.
2. Audio: `AudioBufferSource`. El montaje ya sabe que suena en cada
   instante (`capaDeAudioEn`).
3. Horizontal Y vertical con el mismo motor: son `planLienzo` y
   `planVertical`, ya escritos. El `exportPlan.js` viejo **nunca** supo
   exportar horizontal (traia `1080x1920` hardcodeado).
4. Para archivos largos, `BufferTarget` arma el mp4 entero en RAM. Usar
   `StreamTarget` — o directamente el motor de 1.3.c.

**`exportRunner.js` queda para borrar.** No es "solo un runner": necesita
tres funciones que arman argumentos de ffmpeg (`argsSegmento`,
`argsConcat`, `srtDeSalida`) que no existen. Con mediabunny no hay spawn,
ni concat, ni argumentos — no sobrevive nada de el salvo la idea de
reportar progreso y poder cancelar.

#### 1.3.c DOS MOTORES: WebCodecs para corto, ffmpeg para largo ← APARTE
**Pedido del user, 08/08/2026**: *"me gustaria tener ambos para que si un
video es largo se pase a elegir ffmpeg y si es corto webcodecs, pero
quiero que lo dejes como un aparte"*.

**Esto NO se construye ahora.** Queda anotado para despues de 1.3.b, y
solo tiene sentido cuando el motor WebCodecs este andando y se pueda medir
en que punto se vuelve incomodo.

Por que la idea es buena: cada motor gana en un extremo distinto.

| | WebCodecs (mediabunny) | ffmpeg |
|---|---|---|
| Fuente de la imagen | el canvas que ya se ve | hay que rearmarlo |
| Costo por cuadro | dibujar + codificar | pipeline optimizado |
| Memoria | el archivo en RAM (`BufferTarget`) | escribe a disco |
| Keyframes / animacion | evaluar el plan por cuadro | `sendcmd` y expresiones |
| Dependencia externa | ninguna, va en Electron | binario aparte |

Lo que hay que resolver ANTES de escribirlo, y por eso no se hace ahora:

1. **El criterio no puede ser la duracion sola.** Lo que pesa es cuadros ×
   resolucion × capas: un 4K de 3 minutos con tres capas cuesta mas que un
   1080p de 15 minutos con una. **Medir primero, elegir el umbral despues**
   — un numero inventado hoy va a estar mal.
2. **El problema del SEGUNDO EJECUTOR vuelve.** Es exactamente lo que
   cerro 1.3.a: si el camino de ffmpeg traduce `composicion.js` a
   `filter_complex`, hay otra vez dos cuentas que se pueden separar, y el
   user veria un resultado distinto segun el largo del video — que es
   **peor** que tener un solo motor imperfecto.
   **La salida limpia**: que ffmpeg NO componga. Que ClipForge dibuje cada
   cuadro en el canvas (mismo plan, mismo ejecutor) y le pase a ffmpeg los
   cuadros crudos por stdin (`-f rawvideo`), dejandole solo codificar y
   muxear. Ahi ffmpeg deja de ser un segundo ejecutor y pasa a ser un
   codificador alternativo, que es lo unico que se le esta pidiendo.
   El costo es mover ~8 MB por cuadro del renderer al main; hay que medir
   si conviene frente a lo que se ahorra.
3. **Los dos tienen que dar el mismo archivo.** Mismo contenedor, mismos
   codecs, misma calidad — o cambiar de motor se vuelve visible.
4. **Depende de 1.3.d** (empaquetar ffmpeg): hoy es un binario que el user
   puede no tener, asi que el motor "largo" no siempre existiria.

#### 1.3.d Empaquetar ffmpeg ← APARTE, pero arregla un bug abierto
Hoy `settingsStore.js` resuelve ffmpeg con `config > env > default`, y el
default es el string `'ffmpeg'` (o sea: buscalo en el PATH). Si no esta,
el error manda a un panel de Ajustes **que no existe** (ver seccion 2).

Empaquetarlo es agregar un nivel a esa cadena: binario incluido primero,
PATH al final. En `electron-builder` va como `extraResources` y se
resuelve con `process.resourcesPath`. Son ~20 lineas — la cadena ya esta
escrita.

Hace falta igual **aunque la exportacion vaya por WebCodecs**: `ffprobe`
mide los archivos al importar y `ffmpeg -silencedetect` detecta los
silencios. Esas dos cosas no las reemplaza mediabunny.

**Lo que hay que decidir a proposito: que build.** La que tiene el user
(Gyan "full") pesa **242 MB solo `ffmpeg.exe`** e incluye `libx264`, o sea
que es **GPL**. Distribuirla obliga a acompañarla con su fuente. Una build
**LGPL** (sin x264 ni filtros GPL) tiene obligaciones mucho mas livianas y
alcanza de sobra para probe + silencedetect, que es todo lo que ClipForge
necesita si el encoder es WebCodecs. Una build a medida ademas pesaria una
fraccion.

Ojo con el orden: **si se empaqueta una build LGPL chica, 1.3.c cambia** —
esa build no puede codificar H.264 por software, asi que el "motor largo"
tendria que salir por encoders de hardware o por openh264.

Nada de esto es asesoramiento legal; para distribuir en serio, consultar a
alguien que sepa.

### 1.4 Keyframes sobre `transformacion`

> **HECHO en Clipforge3-test (13/09/2026, tanda F)**: claves en tiempo de
> FUENTE en `transformacion.claves` y `ajuste.claves`, en cuadros, con curvas
> lineal / suave / salto. Cortar, recortar, roll, slip, ripple y unir las
> conservan pegadas al contenido (tests en `test/keyframes.test.js` y en la
> prueba aleatoria). Controles en la barra del visor (◆ Clave, ◂◆ ◆▸,
> curva). Ver DECISIONES F1-F6 y
> `D:\investigacion-clipforge\flujo-clipforge3\impl-F.md`.
> **Queda afuera a proposito**: camara lenta (F4, eje aparte, consultar),
> presets/titulos animados y transiciones (usan esta pieza, no estan hechos).
Hoy `transformacion = {escala,x,y}` y los recuadros son valores FIJOS por
rango. FCPXML (`<keyframe time value interp curve>`) y MLT
(`"0=v; 50~=v"`, con `=` lineal / `|=` discreto / `~=` spline) llegan por
separado al MISMO formato: **una lista de pares (tiempo, valor) sobre ese
mismo campo**, con interpolacion. Dos fuentes independientes coincidiendo
es la señal mas fuerte que hay — no inventar un formato propio.

Habilita DOS cosas con la misma pieza:
1. el recuadro que se mueve DENTRO de su propio tramo (punch-in sobre un
   hablante) en vez de solo saltar entre tramos;
2. titulos y transiciones animadas tipo Mister Horse — un preset seria una
   curva de keyframes ya armada.

---

## 2. BUGS Y HUECOS CONOCIDOS, TODAVIA ABIERTOS

- [x] ~~**Ripple, roll, slip y slide ignoran el `vinculo` de audio.**~~
      ✅ **ARREGLADO 08/08/2026** (estaba marcado 3 veces sin resolverse).
      Medido antes del arreglo: un `ripple` dejaba la imagen terminando en
      6 y el sonido en 10. Tests en `test/vinculoAV.test.js`.

      **Y `recortar` tambien estaba roto**, aunque esta lista lo daba por
      sano. Era cierto a medias: tocaba las dos pistas, pero cada una se
      frenaba donde se le acababa SU material. Con un video de 100s y un
      wav de 12s vinculados, estirar a 20 dejaba **ocho segundos de
      desfase**. `cortarEn` si estaba bien.

      **La regla que quedo, y vale para cualquier operacion nueva sobre
      clips vinculados:** no alcanza con aplicarle la misma operacion a
      cada pista. Cada una se frena por su cuenta y con materiales de
      distinto largo terminan en puntos distintos — el bug que aparece
      "a veces" y no se puede reproducir. Hay que preguntarle a CADA pista
      cuanto puede moverse y aplicarle a todas el movimiento MAS CHICO.
      Se mueven juntas o no se mueve ninguna. Los helpers son
      `deltaComun()` y `aplicarAVinculados()` en `montaje.js`.
- [ ] **Multi-capa real**: la arquitectura del lienzo esta lista pero un
      solo `<video>` lo alimenta. Tambien el SONIDO del visor: desde la
      tanda D el export mezcla todas las pistas, pero el visor sigue sonando
      solo con el <video> de la capa visible (respeta su silencio y volumen,
      no suma la musica de otra pista). Apilar dos videos simultaneos necesita
      varios elementos sincronizados en `#reservaVideos`.
- [ ] **Imagenes/fotos**: `tipo` existe en el modelo y `colocarMedia` ya las
      pone en cualquier pista visual, pero no hay loader que las dibuje.
      Son mas simples que el video (no necesitan sincronia) — el paso
      natural antes del multi-video.
- [ ] **Panel "Ajustes"** (rutas de binarios): hay soporte en main+preload,
      no hay UI. Los mensajes de error mandan al user a un panel que no
      existe.
- [ ] (la ONDA ya esta, tanda G; faltan las miniaturas de video) **Miniaturas dentro de los clips**: `thumbsBridge.js` esta en
      `E:\Clipforge2` y funcionaba (160 miniaturas en 25.6s la primera vez,
      0.06s cacheadas). Recuperar en vez de reescribir.
- [ ] **Video "corrompido" en el visor 16:9** (reporte del user, sin
      diagnosticar). Hipotesis NO confirmada: el archivo es `.mkv` y
      Chromium soporta solo el subconjunto WebM, asi que puede mostrar
      artefactos al buscar en fotogramas no-clave. Si se confirma, la
      solucion es generar un **proxy mp4** de baja resolucion al importar.
- [ ] **NADA COMMITEADO EN GIT.** Ultimo commit `512c054` (05/08), que
      todavia habla de `exportPlan.js`. Todo `src/shared/` vive solo en el
      working tree. Van ~7 sesiones. La copia de respaldo es `E:\Clipforge2`,
      no git.

---

## 3. FEATURES — DESPUES del planificador (tabla de la investigacion de plugins)

Ordenadas por costo real, de mas barato a mas caro:

- [ ] **LUTs `.cube`** (`-vf lut3d`). Formato universal de la industria, ya
      en el binario de ffmpeg que se usa. **Gotcha real**: las rutas con
      `C:\` rompen el parseo de filtros de ffmpeg por los dos puntos — hay
      que escapar (`C\:/ruta/x.cube`, barras normales) o usar nombres
      relativos, mismo patron que ya usa `exportRunner.js` para el SRT.
- [ ] **Denoise** (`hqdn3d` rapido / `nlmeans` mejor). No iguala a Neat
      Video (que usa perfiles por camara) pero resuelve el caso comun de
      poca luz / ISO alto, gratis.
- [ ] **Subtitulos animados palabra por palabra.** El dato dificil YA esta
      calculado: WhisperX da timestamps POR PALABRA y se guardan. Falta
      solo el render. **Es la feature de OpusClip que esta mas cerca.**
- [ ] **Plantillas tipo CapCut**: serializar el montaje SIN los `mediaId`
      reales + reemplazar material al importar. El modelo ya separa
      `media[]` de `clip`, no hace falta ningun cambio de arquitectura.
- [ ] **Camara lenta de calidad** (RIFE u otro modelo IA). `minterpolate`
      de ffmpeg da un piso gratis pero genera artefactos en movimiento
      complejo. Mejorar requiere proceso Python aparte (mismo patron que
      WhisperX) y pesa en GPU.
- [ ] **Quitar fondo sin pantalla verde**: segmentacion (MediaPipe), mismo
      patron de proceso Python.

---

## 3.b-3.g INVESTIGACION DE HERRAMIENTAS → movida a otro archivo

Las 1291 lineas de investigacion sobre FxPlug, MLT, OpenTimelineIO,
GES, WebCodecs y mediabunny se movieron TAL CUAL a:

    D:\investigacion-clipforge\INVESTIGACION.md

No se resumio ni se borro nada. Se separo porque eran el 64% de este archivo
y son investigacion CERRADA sobre herramientas externas, mientras que lo que
queda aca es la lista viva de trabajo sobre ClipForge2.

Las decisiones que salieron de esa investigacion ya estan aplicadas en las
secciones 1 y 2 de este archivo; el detalle de respaldo esta en el otro.

---

## 4. PRODUCTO

- [ ] **Instalador de doble clic** — sigue siendo el bloqueador real: hoy
      ClipForge2 no lo puede instalar una persona no tecnica (necesita venv
      de Python, WhisperX y ffmpeg en el PATH). `electron-builder` ya esta
      configurado en `package.json` y nunca se uso.
- [ ] Barra de menus real (hoy es la de Electron por defecto) e inspector.
- [ ] **Brecha con OpusClip** (el rumbo del producto, seccion 8.9 del CTX):
      seleccion automatica de momentos, auto-encuadre siguiendo la cara, y
      subtitulos animados quemados.
- [ ] **Auto-encuadre, cuando se haga**: usar el patron de DOS PASADAS que
      FCPXML y MLT confirman por separado — (1) un analisis que corre UNA
      vez y guarda el resultado como curva de keyframes, (2) una aplicacion
      que solo LEE esa curva. NO correr deteccion de cara en cada frame de
      reproduccion/exportacion.

---

## 4.b LO QUE TODAVIA NO SE LEYO (para no creer que esta cubierto)
Estado real al 07/08/2026 de
`developer.apple.com/documentation/professional_video_applications`.
El indice tiene 5 areas:

| Area | Estado |
|---|---|
| **FCPXML Reference** | CUBIERTO a fondo (Partes 1-6 de la investigacion, DTD 1.10 incluido) |
| **Content and Metadata Exchanges** | Leido y descartado: es integracion de macOS (drag&drop, Apple Events, Share Sheet), no formato de datos |
| **Workflow Extensions** | Leido y descartado: UI embebida dentro de Final Cut, macOS-only |
| **FxPlug** | CUBIERTO — ver 3.b.1 y 3.b.7 a 3.b.9 |
| **Compressor Encoder Extensions** | Revisado y descartado: SDK de una app macOS para agregar formatos de salida, mismo caso que Workflow Extensions |

**Ya no queda nada de valor sin leer en esa seccion** (cierre 07/08/2026,
ver 3.b.9 para el detalle de que se descarto y por que).

---

## 5. TRAMPAS CONOCIDAS — leer antes de tocar

1. **No unificar `--lat-*` con `--w-*`** en el CSS de la grilla
   (`index.html`). El arrastre de un divisor guarda el ancho como estilo EN
   LINEA sobre `<body>`, y eso le gana a cualquier regla de clase. Si las
   clases de plegado pisan `--lat-*` en vez de `--w-*`, vuelve el bug de
   que el panel deja de esconderse *despues* de arrastrar su divisor —
   parece intermitente y cuesta encontrarlo.
2. **Al reemplazar un modulo, MIGRAR SUS TESTS.** Ya paso: el bug de "la
   misma esquina dos veces" se arreglo el 05/08 y se volvio a colar al
   reescribir, porque el test protegia el camino viejo.
3. **Si un estado malo puede llegar a disco, validarlo AL LEERLO.** Un
   montaje degenerado guardado en `proyecto.json` se reusaba para siempre y
   cortaba el paso antes de medir el archivo (de ahi `montajeUtilizable()`).
4. **`limpiar()` fusiona huecos consecutivos**, asi que `cortarEn` no puede
   partir dentro de un vacio: se deshace solo. Por eso `sobrescribirEn()`
   recorta los pedazos a mano en una sola pasada.
