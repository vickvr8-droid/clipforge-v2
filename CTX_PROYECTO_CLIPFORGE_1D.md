

# ============================================================
# 28. IMPLEMENTADO 31/07/2026 (sesion claude.ai nueva, posterior a la 27) —
# zoom de la linea de tiempo + recorte (rango de trabajo) del video
# ============================================================

## 28.1 Pedido del user
Poner el video "tambien" en la linea de tiempo para poder recortarlo y
editar solo un pedazo, y poder hacer zoom en la linea de tiempo.

## 28.2 Verificacion de MCP al inicio (regla 1/9 CTX_MAESTRO)
`desktop-commander:get_config()` sano (`DESKTOP-T99L5EE`,
`allowedDirectories: []`, cliente `claude-ai`, version `0.2.46`).
`git status --short` confirmo que el estado real en disco coincide
exactamente con lo ya registrado en la seccion 27 (mismos 5 archivos
modificados sin commitear: `cropLayoutsBuilder.js`, `main.js`,
`preload.js`, `index.html`, `renderer.js`) antes de tocar nada.

## 28.3 HALLAZGO sin registrar hasta ahora — sistema de "paneles GUI"
## fechado 30/07/2026 (viola regla 15/16, se corrige con esta entrada)
Al leer el codigo real se encontraron funciones (`crearHeaderPanel`,
`inicializarPanelesGUI`, `dragStartPanel`, `dropPanel`,
`mousedownResizePanel`, `renderMenuVer`, etc.) y CSS de un sistema de
paneles arrastrables/redimensionables (boton "Ver", clase
`body.modoGUI`, `#panelesContainer`, `#panelVerLista`) con comentarios
fechados 30/07/2026 - una fecha POSTERIOR a la ultima entrada de este
MD (seccion 27, 29/07/2026). Esto confirma que hubo al menos una sesion
de trabajo real el 30/07/2026 que nunca quedo registrada aca.
**No se investigo en detalle en esta sesion** (no era el pedido del
user) - queda pendiente, primera tarea de auditoria si se retoma:
releer `crearHeaderPanel`/`inicializarPanelesGUI` completos y probar la
feature en pantalla para documentarla como corresponde.

## 28.4 Que se implemento — ZOOM de la linea de tiempo maestra
Botones "－"/"＋"/"Ajustar" en `#timelineControlesRow` (arriba de la
timeline) + Ctrl+rueda del mouse sobre la timeline (anclado a la
posicion del cursor, patron estandar de editores de audio/video).
`#timelineMaestraWrap` (bloques de habla + cobertura + pistas +
playhead + recorte) quedo envuelto en un `#timelineScrollWrap` nuevo
con `overflow-x:auto`. Como TODO lo que ya se dibuja adentro usa %
relativo al ancho del wrapper, agrandar ese ancho real
(`style.width = zoomTimeline*100 + '%'`) alcanza para que todo escale
solo - no hizo falta tocar ninguna funcion de render existente
(`renderTimeline`, `renderLayoutTimeline`, `renderClipsTracks`,
`actualizarPlayhead`, `tiempoDesdeClickMaestro` siguen igual). Rango de
zoom 100%-4000% (`ZOOM_MIN=1, ZOOM_MAX=40`). `centrarScrollEnPlayhead()`
mantiene el playhead visible al cambiar de zoom con los botones.

## 28.5 Que se implemento — RECORTE (rango de trabajo) del video
2 manijas arrastrables (`#trimHandleIn`/`#trimHandleOut`, amarillas)
sobre la timeline maestra + overlay oscuro (`#trimOverlayIzq`/`Der`)
fuera del rango marcado. Controles: "Marcar inicio"/"Marcar fin" (toman
`videoPreview.currentTime`), "Restablecer recorte" (vuelve a
[0, duracion]), y un checkbox "Reproducir solo el recorte"
(`trimActual.activo`): si esta marcado, tanto el clic/arrastre manual en
la timeline (`clampSiRecorteActivo`) como la reproduccion normal
(`actualizarPlayhead`, hace loop: al pasar `fin` vuelve a `inicio`)
quedan limitados a `[inicio, fin]` - asi se puede enfocar
edicion/revision en un solo pedazo del video sin tener que rebobinar a
mano cada vez. El recorte NO borra ni afecta bloques/recuadros/clips
existentes, es solo un rango de trabajo/preview.

## 28.6 Cambios de backend (main.js/preload.js) — persistencia por proyecto
Nuevo `trimState` (Map, mismo patron que `layoutsState`/`cutsState`) +
handler `ipcMain.handle('trim:actualizar', ...)` que clampea
`[inicio,fin]` contra la duracion real y persiste `{ trim }` en
`proyecto.json` via `actualizarProyecto` (ya generico, no hizo falta
tocar su firma). Restaurado en los 2 lugares donde ya se restauraba
`layouts`: `proyectos:abrir` (si `data.trim` existe) y la rama
"ya existia" de `transcribir` (agrega `trim` a la respuesta). `preload.js`
expone `trimActualizar(inputPath, inicio, fin, duracionTotal, activo)`.


# ============================================================
# NUEVO 04/08/2026 (sesion claude.ai, retomando windows-mcp) — acceso
# directo real en el Escritorio para que el user abra ClipForge solo,
# sin pedirle a Claude que corra "npm start" via MCP cada vez
# ============================================================

## Pedido del user
El user pidio 2 cosas: (a) un acceso para poder "ingresar" el mismo a
ClipForge, y (b) usar ClipForge para transcribir SOLO audios via
Whisper. Se aclaro (a) via `ask_user_input_v0`: el user queria
especificamente un icono/acceso directo para abrir la app el mismo,
NO un sistema de login multi-usuario ni acceso remoto desde otro
dispositivo.

## Punto (b) — YA FUNCIONABA SIN TOCAR CODIGO, solo se confirmo
Se leyo el codigo real antes de prometer cambios (regla del proyecto):
- `elegir-archivo` (`main.js` linea 192) ya acepta `.wav`/`.mp3` en el
  filtro (`{ name: 'Video/Audio', extensions: ['mov','mp4','mkv','wav','mp3'] }`),
  no esta limitado a video.
- `transcribeWhisperX` -> `python-backend/transcribe_whisperx.py` usa
  `whisperx.load_audio(input_path)`, que decodifica con ffmpeg por
  debajo sin importar si el archivo es video o audio puro.
- El resto del pipeline (deteccion de silencios, armado de bloques)
  tambien opera sobre el audio extraido, sin depender de que haya
  imagen.
**Conclusion**: transcribir un `.wav`/`.mp3` con el motor `whisperx`
(o `fasterwhisper`) ya funciona hoy tal cual esta el codigo - el
visor de video simplemente queda en su estado vacio/negro (ya
contemplado), pero la transcripcion sale igual. No se toco nada de
codigo para esto.

## Punto (a) — acceso directo creado (SI se toco el sistema real)
2 archivos nuevos creados en `D:\ClipForge`:
1. **`Iniciar ClipForge.vbs`**: lanzador silencioso -
   `WshShell.Run "cmd /c npm start", 0, False` con
   `CurrentDirectory = "D:\ClipForge"` - corre `npm start` SIN mostrar
   ninguna ventana de consola (parametro `0` = oculto).
2. **`C:\Users\vicente\Desktop\ClipForge.lnk`**: acceso directo real en
   el Escritorio, creado via un script `.ps1` temporal (ejecutado con
   `desktop-commander:start_process`, borrado despues de usarlo) que
   uso el COM object `WScript.Shell` -> `CreateShortcut`. Apunta a
   `wscript.exe "D:\ClipForge\Iniciar ClipForge.vbs"`, con
   `WorkingDirectory = D:\ClipForge` e icono real tomado de
   `D:\ClipForge\node_modules\electron\dist\electron.exe,0` (no un
   icono generico de vbs).

## Gotcha real durante la creacion (no bloqueante, ya resuelto)
El primer intento de crear el shortcut fallo: se paso el script de
PowerShell como string dentro de `-Command "..."` desde
`desktop-commander:start_process` (que ya corre sobre powershell.exe
por defecto) - las comillas DOBLES anidadas causaron que `$s` se
interpolara como variable vacia en el shell exterior antes de llegar
al interior (error real: `.Description` aparecio sin el `$s` adelante
en el mensaje de error). **Solucion que funciono**: escribir el
script completo a un archivo `.ps1` aparte (`write_file`) y ejecutarlo
con `powershell -ExecutionPolicy Bypass -File "ruta.ps1"` en vez de
pasarlo inline con `-Command`. **Regla practica para el resto del
proyecto**: evitar pasar scripts de PowerShell con comillas anidadas
complejas directo en `-Command` desde `start_process` - preferir
escribir a `.ps1` temporal y ejecutar con `-File` cuando el script
tenga mas de 1-2 lineas o use comillas simples Y dobles mezcladas.

## Verificacion real hecha
- `list_directory` sobre `C:\Users\vicente\Desktop` confirmo
  `ClipForge.lnk` presente.
- Script temporal `_crear_acceso_directo.ps1` borrado despues de
  confirmar que el shortcut se creo bien (no se dejo basura).
- **NO CONFIRMADO todavia**: que el doble-clic real del user sobre el
  icono abra la app correctamente end-to-end (el user no lo probo
  todavia en esta sesion) - pendiente de confirmacion.

## Limitacion avisada al user
Como el lanzador oculta la consola a proposito (para que no se vea
una ventana de CMD parpadeando), si la app alguna vez no abre (ej. por
un `electron.exe` huerfano de una sesion anterior, gotcha ya conocido
de este proyecto) el user NO va a ver ningun mensaje de error en
pantalla - en ese caso hay que pedir ayuda por MCP como siempre en vez
de esperar ver un error visible.

## Pendiente
Confirmar con el user que el doble-clic en `ClipForge.lnk` abre la
app bien de punta a punta.


# ============================================================
# 30. IMPLEMENTADO 04/08/2026 (sesion v0, posterior a la anterior del
# mismo dia) — la suite de tests estaba ROTA y tapando 3 bugs reales de
# exportacion + auditoria del sistema de paneles GUI (deuda de la 28.3)
# ============================================================

## 30.1 Punto de partida
No hubo pedido de feature nueva ("segui avanzando"). Se arranco
corriendo lo que ya existia antes de escribir nada, y el estado real
era peor de lo que decia el MD: `npm test` no corria NINGUN test y
habia 3 bugs de aritmetica de exportacion sin detectar.

## 30.2 `npm test` estaba roto de entrada (Node 24)
El script era `node --test test/`. Node 24 ya no acepta un DIRECTORIO
como argumento de `--test`: intenta importarlo como modulo ESM y tira
`ERR_UNSUPPORTED_DIR_IMPORT`. Resultado: `npm test` terminaba en rojo
con `tests 1 / fail 1` sin haber ejecutado ni uno de los 28 tests
reales del archivo. Fix: `node --test "test/*.test.js"` (con las
comillas, para que el glob lo expanda Node y no el shell - si no, en
Windows/cmd no expande y falla).
**Leccion**: los 28 tests de la seccion 29 nunca se vieron correr en
verde; se dieron por buenos porque el comando "existia".

## 30.3 BUG 1 (grave, rompia el export) — `aPar()` redondeaba PARA ARRIBA
`aPar()` hacia `Math.round()` al par mas cercano, asi que `aPar(1081)`
daba **1082**: UN PIXEL MAS que lo recibido. Se usa siempre sobre
valores ya limitados al tamano de la fuente
(`aPar(Math.min(csw, fuente.ancho))`), asi que en un video de 1920x1080
podia pedirle a ffmpeg un crop de 1082px de alto sobre 1080 reales ->
`Invalid too big or non positive size for width/height`, es decir el
export se cae. Fix: redondeo hacia ABAJO (`Math.floor` + bajar al par),
con piso 2. Perder 1px de recorte no se ve; un crop fuera de rango
aborta el render.

## 30.4 BUG 2 (silencioso, el peor de los tres) — el recorte se
## aplicaba al export aunque estuviera DESACTIVADO
`rangosConservados()` preguntaba `if (trim && trim.fin > trim.inicio)`
sin mirar **`trim.activo`**. O sea: el checkbox "Reproducir solo el
recorte" de la seccion 28.5 solo controlaba la REPRODUCCION; para el
export el recorte estaba siempre activo. Con el checkbox apagado y las
manijas movidas (algo normal, quedan marcadas como referencia visual),
el user exportaba y le salia un mp4 mucho mas corto de lo pedido, sin
ningun mensaje. Fix: `if (trim && trim.activo && ...)`. Nota de diseno
confirmada: el flag `activo` YA se persistia bien end-to-end
(`renderer.js` -> `preload.trimActualizar` -> `trim:actualizar` en
`main.js` -> `proyecto.json`); el unico que lo ignoraba era el
planificador.

## 30.5 BUG 3 (calidad de imagen) — offsets de crop impares
`x`/`y` del crop salian de `Math.round()`, asi que podian quedar
impares. La salida es yuv420 (croma submuestreado 2x2): cortar en un
pixel impar desalinea el plano de color respecto al de luma y se ve un
leve corrimiento de tinte en el borde del recuadro. Fix: funcion nueva
`aParOffset()` - igual que `aPar()` pero con piso **0** en vez de 2,
porque para un offset 0 SI es valido (`aPar()` no servia: habria
forzado x=2 en un recuadro pegado al borde izquierdo). Aplicada en
`recorteCover()` y `recorteCentrado()`.

## 30.6 Tests agregados (3 nuevos, total 31 en verde)
- `aPar nunca devuelve mas de lo que recibio`: loop 2..400, bloquea la
  regresion del BUG 1 en TODOS los valores, no en un caso puntual.
- `los offsets del crop son pares y no se salen de la fuente`.
- `un trim inactivo no acorta la duracion exportada`: compara
  `duracionSalida` con `activo:false` (30s) vs `activo:true` (10s)
  sobre el mismo plan - es el test que faltaba para el BUG 2.

## 30.7 Auditoria del sistema de paneles GUI (la deuda de la 28.3)
Se leyo completo el bloque (`renderer.js` ~1640-1900 + CSS de
`index.html`). **Que es**: cada seccion grande (Visor, Resumen,
Transcripcion, Exportar, Analisis IA, API Keys) lleva
`data-panel-id`/`data-panel-titulo`; al arrancar,
`inicializarPanelesGUI()` mueve los hijos de cada una a un `.panelBody`
y le inyecta una cabecera (drag handle + horizontal/vertical/contraer/
ocultar) + manija de resize. La cabecera solo se ve con
`body.modoGUI` (boton "GUI"), el boton "Ver" da los checkboxes de
visibilidad + "Restablecer disposicion", y todo se persiste en
localStorage (`clipforge_panel_layout_v1`, NO en `proyecto.json`: es
preferencia de la ventana, no del proyecto).

**4 defectos encontrados y arreglados**:
1. `.panelGUI.arrastrando` (sombra + z-index) estaba en el CSS pero el
   JS nunca la ponia: arrastrar no daba NINGUN feedback visual. Se
   agrega en `setTimeout(0)` (si se cambia el estilo dentro del
   `dragstart`, Chromium ya capturo el drag image y la sombra sale
   congelada pegada al cursor) y se limpia en `dragend` - no en `drop`,
   porque `drop` no dispara si el arrastre se cancela con Escape o se
   suelta afuera, y el panel quedaba con la sombra puesta para siempre.
2. `dropPanel()` decidia antes/despues SIEMPRE con `ev.clientY`. Con
   paneles en modo `horizontal` (quedan lado a lado, `width:48%`) el
   eje correcto es el X: reordenar dos paneles horizontales daba un
   resultado al azar segun la altura del cursor. Ahora el eje se elige
   segun `destino.classList.contains('horizontal')`.
3. `.panelAccion.activo` (fondo azul) tambien estaba en el CSS sin
   usarse: los 4 botones se veian identicos y no habia forma de saber
   si un panel estaba en horizontal o vertical sin medir el ancho a
   ojo. Se agrego `sincronizarBotonesPanel()`, llamada al restaurar el
   layout, en cada accion y en el reset. De paso el caret de "contraer"
   ahora apunta segun la accion que hace (no segun el estado).
4. "Restablecer disposicion" borraba localStorage y limpiaba las clases
   pero NO devolvia el ORDEN original: los nodos quedaban movidos en el
   DOM, asi que el orden viejo seguia en pantalla hasta reiniciar la
   app - y peor, la siguiente accion cualquiera lo volvia a persistir
   con `guardarLayoutGUI()`. Se agrego `ordenOriginalPaneles` (capturado
   del HTML ANTES de aplicar el orden guardado) y el reset reordena el
   DOM con eso.

Ademas, dos consistencias menores: un panel sin nada guardado ahora
arranca con la clase `vertical` EXPLICITA (antes se hacia `return` y
quedaba sin ninguna de las dos - funcionaba de casualidad porque un div
ya es block, pero el estado inicial y el "restablecido" no eran el
mismo), y `.alturaFija .panelBody` ya no resta 40px de cabecera fuera
del modo GUI (donde la cabecera es `display:none`), que dejaba una
franja muerta al pie del panel.

## 30.8 Verificacion — que se probo y que NO
**Probado de verdad**: `npm test` 31/31 en verde, y `node --check` sobre
`renderer.js`, `exportPlan.js` y `main.js`.
**NO probado en pantalla**: los 4 arreglos de paneles (30.7) son de
DOM/CSS y no hay test automatico que los cubra. Se intento levantar el
renderer en un browser con un stub de `window.clipForge`, pero el
navegador del entorno v0 no puede alcanzar un puerto arbitrario del
sandbox y esto es una app Electron, no una web. **Pendiente para el
user**: abrir ClipForge, activar "GUI" y confirmar (a) que al arrastrar
se ve la sombra y desaparece al soltar/cancelar, (b) que reordenar dos
paneles puestos en horizontal respeta el lado donde se sueltan, (c) que
el boton horizontal/vertical activo se ve resaltado, (d) que
"Restablecer disposicion" devuelve el orden del HTML sin reiniciar.

## 30.9 Leccion transversable al resto del proyecto
Los 3 bugs vivian en el modulo con MAS comentarios explicativos del
repo y con 28 tests escritos, pero el comando que los corria estaba
roto - nadie los habia visto pasar. Antes de dar por bueno cualquier
modulo "ya testeado", correr la suite y mirar el conteo real de
`pass`/`fail`, no que el script exista.
