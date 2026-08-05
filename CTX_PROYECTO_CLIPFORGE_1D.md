

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
