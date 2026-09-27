# Graph Report - .  (2026-08-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 681 nodes · 1210 edges · 42 communities (37 shown, 5 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 80 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `512c054e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- montaje.js
- settingsStore.js
- renderer.js
- cuadros.js
- cutsBuilder.js
- main.js
- encuadreAjuste.test.js
- trimActual (estado de recorte en el renderer)
- package.json
- layout916.js
- fmtTiempo
- composicion.test.js
- pintar916
- keysStore.js
- ClipForge (app Electron)
- lienzo.test.js
- visorTick
- durVista
- montaje.test.js
- audioVinculado.test.js
- llmAnalyzer.js
- moverClip.test.js
- pistasUniversales.test.js
- vinculoAV.test.js
- visorEjes.test.js
- transcribe_nvidia.py
- durTl
- ponerMaterial.test.js
- recorteNormal.test.js
- transcribe_fasterwhisper.py
- cutsBuilder.js (bloques aceptar/rechazar)
- transcribe_whisperx.py
- preload.js
- Deteccion de muletillas por LLM (pendiente)
- Log de instalacion npm (install_debug2.txt)
- install_debug.txt (vacio)
- planLienzo
- protocoloMedia.js
- dibujarLienzo
- guionExport.test.js

## God Nodes (most connected - your core abstractions)
1. `operarMontaje()` - 33 edges
2. `pintar916()` - 19 edges
3. `conElementos()` - 19 edges
4. `elementosDePista()` - 17 edges
5. `Montaje` - 14 edges
6. `visorTick()` - 13 edges
7. `hueco()` - 12 edges
8. `fmtTiempo()` - 11 edges
9. `planLienzo()` - 11 edges
10. `transcribir()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Multi-capa real (pendiente)` --conceptually_related_to--> `planLienzo()`  [EXTRACTED]
  PENDIENTE.md → src/shared/composicion.js
- `Keyframes sobre la transformacion` --rationale_for--> `transformar()`  [INFERRED]
  PENDIENTE.md → src/shared/montaje.js
- `Desincronizacion silenciosa imagen-sonido` --conceptually_related_to--> `clipsVinculados()`  [INFERRED]
  PENDIENTE.md → src/shared/montaje.js
- `Word boosting: la unica palanca contra el decodificador de la nube` --rationale_for--> `transcribeNube()`  [INFERRED]
  PENDIENTE.md → src/main/nubeBridge.js
- `Pedir cuadros por lote ordenado` --rationale_for--> `abrirLector()`  [INFERRED]
  PENDIENTE.md → src/renderer/cuadros.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **La cadena de exportacion: plan, guion, cuadros y protocolo** — src_shared_composicion_planlienzo, src_shared_guionexport_guiondeexport, src_renderer_cuadros_abrirlector, src_main_protocolomedia, pendiente_medicion_lote_vs_suelto [EXTRACTED 0.95]
- **Las cinco operaciones que respetan el vinculo imagen-sonido** — src_shared_montaje_ripple, src_shared_montaje_roll, src_shared_montaje_slip, src_shared_montaje_slide, src_shared_montaje_recortar, src_shared_montaje_deltacomun [EXTRACTED 1.00]
- **Los tres motores de transcripcion y su compromiso** — src_main_nubebridge_transcribenube, src_main_whisperxbridge_transcribewhisperx, src_main_fasterwhisperbridge_transcribefasterwhisper, src_renderer_index_selector_de_motor [EXTRACTED 0.95]
- **Flujo de persistencia del recorte (renderer -> preload -> main -> proyecto.json)** — ctx_proyecto_clipforge_1d_trimactual, ctx_proyecto_clipforge_1d_trimactualizar_preload, ctx_proyecto_clipforge_1d_trim_actualizar_handler, ctx_proyecto_clipforge_1d_trimstate, ctx_proyecto_clipforge_1d_proyecto_json [EXTRACTED 1.00]
- **Aritmetica de crop del export (pares, offsets, planificacion de rangos)** — ctx_proyecto_clipforge_1d_apar, ctx_proyecto_clipforge_1d_aparoffset, ctx_proyecto_clipforge_1d_recortecover, ctx_proyecto_clipforge_1d_recortecentrado, ctx_proyecto_clipforge_1d_rangosconservados, ctx_proyecto_clipforge_1d_exportplan [EXTRACTED 1.00]

## Communities (42 total, 5 thin omitted)

### Community 0 - "montaje.js"
Cohesion: 0.09
Nodes (70): Desincronizacion silenciosa imagen-sonido, Regla del movimiento mas restrictivo, operarMontaje(), acotarRect(), actualizarPista(), agregarAlFinal(), agregarMedia(), agregarPista() (+62 more)

### Community 1 - "settingsStore.js"
Cohesion: 0.05
Nodes (64): Diarizacion con pyannote (quien habla), Transcripcion en la nube (NVIDIA Parakeet), Word boosting: la unica palanca contra el decodificador de la nube, correrFfmpeg(), crearCarpetaTemporal(), crypto, ejecutar(), { ffmpegPath, binarioDisponible, errorBinarioFaltante } (+56 more)

### Community 2 - "renderer.js"
Cohesion: 0.03
Nodes (60): app, archivoElegido, ATAJOS, aviso916, bloquesActuales, btnAceptarSugerencias, btnAnalizarIA, btnDescartarSugerencias (+52 more)

### Community 3 - "cuadros.js"
Cohesion: 0.18
Nodes (15): Aviso de metodo: verificar antes de declarar leido, Dos motores de export segun el largo (APARTE), Licencia de ffmpeg: LGPL vs GPL, Pedir cuadros por lote ordenado, Multi-capa real (pendiente), Proxy mp4 para el bug del .mkv, El <video> queda para el preview, el decodificador para exportar, abrirLector() (+7 more)

### Community 4 - "cutsBuilder.js"
Cohesion: 0.10
Nodes (29): aplicarSugerencias(), blocksToCutsJson(), blocksToSrt(), blocksToTranscriptText(), buildBlocks(), contarSugerencias(), cortarRango(), crearGeneradorId() (+21 more)

### Community 5 - "main.js"
Cohesion: 0.09
Nodes (33): actualizarProyecto(), { analizarMuletillas }, { app, BrowserWindow, ipcMain, dialog }, {
  buildBlocks, summarize, blocksToSrt, blocksToCutsJson, blocksToTranscriptText, blocksToPlainText,
  cortarRango, restaurarRango,
  contarSugerencias, aplicarSugerencias, descartarSugerencias, silenciosASugerencias
}, cargarProyecto(), crypto, cutsState, { detectSilences } (+25 more)

### Community 6 - "encuadreAjuste.test.js"
Cohesion: 0.07
Nodes (22): aplicarCover(), recorteCoverDeClip(), rectFuenteDeClip(), acotarRect(), actualizar(), crear(), normalizar(), assert (+14 more)

### Community 7 - "trimActual (estado de recorte en el renderer)"
Cohesion: 0.08
Nodes (22): actualizarProyecto() (writer generico), aPar() (redondeo a par hacia abajo), aParOffset() (offsets pares con piso 0), localStorage clipforge_panel_layout_v1, Alineacion de croma yuv420 en crops, dropPanel() (reordenado por eje X/Y), exportPlan.js (aritmetica de exportacion), inicializarPanelesGUI() (+14 more)

### Community 8 - "package.json"
Cohesion: 0.07
Nodes (25): electron, mediabunny, build, appId, files, productName, win, dependencies (+17 more)

### Community 9 - "layout916.js"
Cohesion: 0.14
Nodes (20): aplicarPreset(), areaSolape(), celdasParaDibujar(), crearLayout(), diagnostico(), encajarCelda(), huecoLibre(), intercambiarCeldas() (+12 more)

### Community 10 - "fmtTiempo"
Cohesion: 0.14
Nodes (24): abrirProyecto(), accionSugerencias(), aplicarTl(), cargarListaProyectos(), cargarMontaje(), conSigno(), dibujarElemento(), escapeHtml() (+16 more)

### Community 11 - "composicion.test.js"
Cohesion: 0.17
Nodes (8): assert, C, L916, LIENZO_EXPORT, LIENZO_PREVIEW, M, SALIDA_916, test

### Community 12 - "pintar916"
Cohesion: 0.24
Nodes (14): activosAhora(), dibujar916(), fuenteDelVideo(), pintar916(), rect916(), rectImagen(), renderCeldas916(), renderMarcoCapa() (+6 more)

### Community 13 - "keysStore.js"
Cohesion: 0.26
Nodes (16): cifradoDisponible(), cifrar(), descifrar(), detectarProveedor(), eliminarKey(), escribirKeys(), fs, getKeysPath() (+8 more)

### Community 14 - "ClipForge (app Electron)"
Cohesion: 0.13
Nodes (14): ClipForge.lnk (acceso directo de Escritorio), elegir-archivo (filtro Video/Audio), Iniciar ClipForge.vbs (lanzador silencioso), Regla: escribir scripts PS a .ps1 y usar -File, #timelineScrollWrap (wrapper con overflow-x), transcribeWhisperX / transcribe_whisperx.py, Transcribir audio puro (.wav/.mp3) sin tocar codigo, Zoom de la linea de tiempo maestra (+6 more)

### Community 15 - "lienzo.test.js"
Cohesion: 0.20
Nodes (8): assert, CUADRADO, CUATROK, HD, L, LIENZO, test, VERTICAL

### Community 16 - "visorTick"
Cohesion: 0.29
Nodes (13): renderCabezal(), saltarVacios(), visorActualizarTiempo(), visorAlternar(), visorEstadoEn(), visorIrA(), visorMostrar(), visorPausar() (+5 more)

### Community 17 - "durVista"
Cohesion: 0.25
Nodes (9): durVista(), imantar(), limpiarArrastre(), marcarTapados(), marcarZona(), mostrarDesfase(), puntosIman(), tiempoDesdeX() (+1 more)

### Community 18 - "montaje.test.js"
Cohesion: 0.33
Nodes (7): assert, base(), clips(), els(), huecos(), M, test

### Community 19 - "audioVinculado.test.js"
Cohesion: 0.29
Nodes (5): assert, base(), conPar(), M, test

### Community 20 - "llmAnalyzer.js"
Cohesion: 0.38
Nodes (6): analizarMuletillas(), buildPrompt(), http, https, llamarChatCompletions(), MODELOS_LOCAL

### Community 21 - "moverClip.test.js"
Cohesion: 0.29
Nodes (3): assert, M, test

### Community 22 - "pistasUniversales.test.js"
Cohesion: 0.29
Nodes (3): assert, M, test

### Community 23 - "vinculoAV.test.js"
Cohesion: 0.33
Nodes (5): assert, assertSincronizados(), M, pareja(), test

### Community 24 - "visorEjes.test.js"
Cohesion: 0.29
Nodes (3): assert, M, test

### Community 25 - "transcribe_nvidia.py"
Cohesion: 0.73
Nodes (5): a_pcm16k(), main(), salir_con_error(), trozos(), write_progress()

### Community 26 - "durTl"
Cohesion: 0.53
Nodes (6): borrarSeleccionado(), crearEncuadre(), deshacerTl(), durTl(), opTl(), rehacerTl()

### Community 27 - "ponerMaterial.test.js"
Cohesion: 0.33
Nodes (3): assert, M, test

### Community 28 - "recorteNormal.test.js"
Cohesion: 0.33
Nodes (3): assert, M, test

### Community 29 - "transcribe_fasterwhisper.py"
Cohesion: 0.60
Nodes (3): is_hallucination(), main(), write_progress()

### Community 30 - "cutsBuilder.js (bloques aceptar/rechazar)"
Cohesion: 0.40
Nodes (5): cutsBuilder.js (bloques aceptar/rechazar), Export de cortes JSON + SRT (solo bloques keep), Nekodificador (herramienta de referencia), renderer.js (UI del editor), silenceBridge.js (deteccion de silencios via ffmpeg)

### Community 38 - "planLienzo"
Cohesion: 0.18
Nodes (13): Clip de ajuste (el encuadre), Keyframes sobre la transformacion, El orden de trabajo esta FORZADO, Una sola cuenta de dibujo, dos ejecutores, Nada commiteado desde el 05/08, El canvas 9:16 esta fijo en 1080x1920, medidasDe(), planLienzo() (+5 more)

### Community 39 - "protocoloMedia.js"
Cohesion: 0.18
Nodes (12): Protocolo cf-media:// con soporte de Range, Trampa del esquema standard: la ruta no puede ir en el host, fs, manejar(), path, { pathToFileURL }, { protocol, net }, { Readable } (+4 more)

### Community 40 - "dibujarLienzo"
Cohesion: 0.31
Nodes (9): ajustarLienzo(), dibujarLienzo(), lienzoDelProyecto(), transformDelArrastre(), encajar(), lienzoDeMontaje(), rectDeCapa(), transformacionDesdeRect() (+1 more)

### Community 41 - "guionExport.test.js"
Cohesion: 0.33
Nodes (4): assert, G, M, test

## Knowledge Gaps
- **224 isolated node(s):** `{ fusionar: fusionarIntervalos, restar: restarIntervalos, duracion: duracionIntervalos }`, `path`, `{ transcribir }`, `{ pythonFasterWhisperPath, ENV_MAP }`, `TRANSCRIBE_SCRIPT` (+219 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `elementosDePista()` connect `montaje.js` to `visorTick`, `renderer.js`, `main.js`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Why does `Montaje` connect `main.js` to `montaje.js`, `visorTick`, `pintar916`, `planLienzo`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `celdasParaDibujar()` connect `layout916.js` to `renderer.js`, `planLienzo`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **What connects `{ fusionar: fusionarIntervalos, restar: restarIntervalos, duracion: duracionIntervalos }`, `path`, `{ transcribir }` to the rest of the system?**
  _224 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `montaje.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08637747336377473 - nodes in this community are weakly interconnected._
- **Should `settingsStore.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05257312106627175 - nodes in this community are weakly interconnected._
- **Should `renderer.js` be split into smaller, more focused modules?**
  _Cohesion score 0.027777777777777776 - nodes in this community are weakly interconnected._