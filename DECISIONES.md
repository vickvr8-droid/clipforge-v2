# DECISIONES

Decisiones que eran del usuario y se tomaron siguiendo la recomendación del plan del crítico (`D:\investigacion-clipforge\linea-de-tiempo\INFORME.md`, "Plan del crítico"). Se agregan abajo; no se borra lo anterior.

---

## Tanda A (13/09/2026): export de video, paso 1 de la hoja de ruta

### A1. Con material mezclado, el fps del mp4 lo pone el primer clip de la línea

- **Decisión:** el mp4 sale a los fps del material del clip que arranca antes en las pistas de imagen (si empatan, el de la pista de abajo). Si el usuario eligió un fps en los ajustes (`exportacion.fps` > 0), manda ese. Si no se sabe nada, 30. Los valores a menos del 2 % de un fps estándar se llevan al estándar exacto (29,87 de un celular pasa a 30000/1001).
- **Alternativa descartada:** usar el fps más alto del proyecto; fijar 30 siempre; preguntar en cada export.
- **Por qué:** el plan del crítico propone "valor por defecto tomado del primer material y editable". No se inventa un fps que no tiene ningún archivo, y el caso normal de un short es una sola grabación. El más alto duplicaría cuadros del material lento sin ganar nada. Preguntar cada vez es una traba para alguien que no sabe qué es un fps.
- **Cómo revertir:** `GuionExport.fpsDeMontaje` en `src/shared/guionExport.js`. Para "el más alto", cambiar el `for` sobre `candidatos` por un `Math.max`. Los tests que fijan la regla están en `test/bucleExport.test.js` ("con material mezclado manda el PRIMER clip…", "empate en el inicio…").

### A2. El mp4 sale sin sonido hasta que exista la mezcla

- **Decisión:** el export de video no escribe audio. El panel lo dice antes de exportar ("Por ahora el video sale sin sonido") y el mensaje final repite "sin sonido".
- **Alternativa descartada:** escribir el audio ya, con la capa única de `capaDeAudioEn`.
- **Por qué:** el plan del crítico (paso 1) lo pide explícitamente: el audio del mp4 va en el paso 5, junto con la mezcla de varias pistas. Con voz en A1 y música en A2 hoy suena una sola; construir el audio del export sobre eso sería construir sobre lo que hay que cambiar.
- **Cómo revertir:** no hay nada que revertir. El audio se agrega en `src/renderer/exportVideo.js` con un `AudioBufferSource` en el mismo `Output`, y se sacan los avisos de `index.html` (`#exportEstado`) y de `renderer.js` (`exportarVideo`).

### A3. `fps` se guarda como campo opcional del material, sin subir `Montaje.VERSION`

- **Decisión:** `agregarMedia` guarda `fps` solo si se sabe (> 0). Los proyectos viejos no lo tienen y se exportan igual: el decodificador mide el fps en el momento de exportar.
- **Alternativa descartada:** subir `VERSION` a 2.
- **Por qué:** `montajeUtilizable` descarta cualquier montaje con otra versión y `montajeInicial` arma uno nuevo: se perdería en silencio la edición de todos los proyectos guardados.
- **Cómo revertir:** borrar la línea de `fps` en `agregarMedia` (`src/shared/montaje.js`) y en `montajeInicial` (`src/main/montajeGuardado.js`) y `montaje:agregar-media` (`src/main/main.js`). `test/montajeGuardado.test.js` protege que un proyecto viejo abra intacto.

---

## Tanda B (13/09/2026): red de invariantes y vínculo imagen-sonido, pasos 2 y 3 de la hoja de ruta

### B1. Al mover o tapar, la pareja de sonido va a su pista solo si ahí tapa "lo mismo"; si no, a una pista libre

- **Decisión:** cuando se mueve un clip con sonido vinculado (a otro instante, a otra pista o a una pista nueva), el sonido va a SU pista únicamente si lo que taparía ahí es justamente el sonido de los clips que la imagen tapa arriba (o nada). Si en su pista taparía otra cosa (la voz de un clip cuya imagen queda intacta, música suelta), va a la primera pista de audio libre en ese tramo, y si no hay, a una nueva, igual que `colocarMedia`. Los restos de lo tapado conservan el vínculo (el pedazo izquierdo el original, el derecho uno nuevo compartido entre imagen y sonido); si solo se tapó una de las dos partes, se desvinculan y la interfaz avisa ("quedó separado de su sonido"). Si el sonido se corrió de pista, también lo avisa.
- **Alternativa descartada:** (1) la de antes: la pareja siempre en su pista, tapando lo que haya; (2) "si solo se tapó la imagen, recortar la pareja en el mismo tramo".
- **Por qué:** es la propuesta del plan del crítico (paso 3f). La (1) borraba 20 s de la voz de la entrevista al subir un B-roll a V2 (hallazgo 2). La (2) destruye audio que nadie tapó, y el crítico marca que las dos ideas se contradicen: hacía falta UNA regla. Con esta, mover nunca borra sonido cuya imagen sigue en la línea.
- **Cómo revertir:** en `moverConInforme` (`src/shared/montaje.js`), poner `espejo = true` para todas las parejas vuelve a la regla vieja (la pareja siempre en su pista). Los tests que fijan la regla son "B-roll con sonido a V2 en t=25…" y "mover un clip con sonido encima de musica suelta…" en `test/vinculoB.test.js`.

### B2. Cerrar un vacío corre solo las pistas atadas por vínculo, y cierra lo que puedan todas

- **Decisión:** `cerrarHueco` corre la pista del vacío y, transitivamente, toda pista que tenga detrás del punto un clip vinculado con algo de las que se corren. Cada una cede el vacío que tenga justo antes del punto; se cierra el mínimo común, y si alguna no tiene vacío ahí, no se cierra nada.
- **Alternativa descartada:** correr todas las pistas (ripple multipista completo) o rechazar el cierre si no se puede cerrar entero.
- **Por qué:** el plan del crítico (paso 3a) pide aplicar la regla de `deltaComun` y deja el ripple multipista (música, encuadres, B-roll sin vínculo) para el paso 7, porque necesita reglas del usuario. Cerrar parcialmente es lo mismo que ya hacían los recortes vinculados: moverse lo que puedan todas juntas.
- **Cómo revertir:** `cerrarHueco`, `pistasQueSeCorrenDesde` y `libreAntesDe` en `src/shared/montaje.js`. Para "todo o nada", devolver `m` si `delta < el.duracion`.

### B3. Roll y unir se niegan antes que desincronizar

- **Decisión:** `unirConSiguiente` une en todas las pistas del vínculo o en ninguna. `roll` no hace nada si el vecino de alguna pista está vinculado con algo que no participa del roll (su pareja no es el vecino de la pareja). En ambos casos la interfaz no cambia nada; en el roll dice "el corte no se pudo mover".
- **Alternativa descartada:** unir/rollear solo en la pista donde se hizo el gesto, o desvincular automáticamente para poder hacerlo.
- **Por qué:** plan del crítico, pasos 3c y 3e. Hacerlo en una sola pista es exactamente el defecto (hallazgo 7). Desvincular en silencio para "poder" hacer la operación es romper la sincronía de otra forma.
- **Cómo revertir:** `unirConSiguiente` y `vecinosCoherentes` en `src/shared/montaje.js`.

---

## Tanda C (13/09/2026): gestos que editan sin querer, paso 4 de la hoja de ruta

### C1. Un clic en un vacío lo elige; se cierra con Supr

- **Decisión:** el clic (con cualquier herramienta menos la cuchilla, y también el doble clic) elige el vacío y lo pinta rayado en naranja aunque el mouse se vaya. Supr o Shift+Supr con el vacío elegido lo cierra (`cerrarHueco`, que desde la tanda B corre juntas las pistas vinculadas). Un clic en el fondo de la pista, después del último elemento, deselecciona.
- **Alternativa descartada:** cerrar con doble clic; seguir cerrando con un clic; pintar todos los vacíos siempre.
- **Por qué:** es el paso 4a del plan del crítico. El clic en "lo gris" es el gesto de deseleccionar en cualquier editor y cerraba un vacío invisible. El crítico pide que la marca del vacío elegido vaya en el mismo paso, para no elegir algo que no se ve. Pintar todos los vacíos siempre contradice la decisión escrita en el CSS (competían con los clips), así que solo se pinta el elegido.
- **Cómo revertir:** en `GestosTl.accionDeMousedown` (`src/renderer/gestosTl.js`) devolver `{ accion: 'cerrar-hueco' }` para `tipo === 'hueco'` y atenderlo en el mousedown de `renderer.js` con `montajeCerrarHueco`. Los tests que lo fijan son "clic en un VACIO lo elige…" y "cableado: el mousedown de un vacio ya no lo cierra…" en `test/gestosTl.test.js`.

### C2. Tope de zoom como densidad (300 px por segundo), sin bajar del 40x de antes

- **Decisión:** el zoom máximo es el mayor entre 40 veces "todo entra" y 300 px/s (10 px por cuadro a 30 fps).
- **Alternativa descartada:** dejar el 40x relativo; atar el tope al fps del material.
- **Por qué:** el hallazgo 29 muestra que con 824 s el 40x no llega a 3 px por cuadro. El paso 6 (base de cuadro) va a traer el fps del montaje; hasta entonces 30 fps es una referencia fija. Quedarse con el mayor evita quitarle zoom a los montajes cortos.
- **Cómo revertir:** `GestosTl.zoomMaximo`: devolver `ZOOM_MAX_RELATIVO`. Cuando exista el fps del montaje (paso 6), cambiar `PX_POR_SEG_MAX` por `10 * fps`.

### C3. Al reproducir con zoom, la vista se pagina (Premiere) en lugar de centrar el cabezal (DaVinci)

- **Decisión:** si el cabezal pasa a 40 px del borde derecho, o queda a la izquierda de la vista, la vista salta y lo deja a 40 px del borde izquierdo. Solo mientras se reproduce.
- **Alternativa descartada:** centrar siempre el cabezal (la vista se desliza en cada cuadro).
- **Por qué:** el hallazgo 26 deja las dos opciones abiertas. Paginar mueve la vista una vez cada tanto y no pelea con alguien que está scrolleando; tampoco toca scrollLeft en cada cuadro.
- **Cómo revertir:** `GestosTl.scrollParaSeguir`: devolver `x - anchoVista / 2` acotado cada vez que cambie.

### C4. Elegir un clip sigue llevando el cabezal a su inicio

- **Decisión:** no se cambió. El hallazgo 52 lo marca como fricción, pero el crítico dice que es una decisión comentada en el código ("seleccionar un clip lo muestra en el visor") y que se consulta. No está en el paso 4.
- **Alternativa descartada:** mover el cabezal solo con un clic sin arrastre, o no moverlo nunca.
- **Por qué:** es una preferencia del usuario sin decidir; cambiarla sin preguntar sería imponer una.
- **Cómo revertir / cambiar:** la línea `visorIrA(el.inicio, true)` del mousedown de `tlPistas` en `renderer.js`. Para "solo con clic", moverla al `mouseup` cuando `!a.activo`.

---

## Tanda D (13/09/2026): audio en el export y base de cuadro, pasos 5 y 6 de la hoja de ruta

### D1. Con material mezclado manda el fps del MONTAJE, que sale del material con que se abrió el proyecto

- **Decisión:** el montaje tiene su propio `fps: {num, den}`. Un proyecto nuevo lo toma del video que se abre (ffprobe, llevado al estándar exacto: 29,97 pasa a 30000/1001). Un proyecto guardado sin fps lo toma, en orden, del archivo abierto (se mide si hace falta), del `fps` guardado del primer material con imagen, o 30. Todo corte cae en esa grilla, y el material de otro fps (un B-roll a 25 en un montaje a 29,97) se muestrea en ella. El export sale a ese fps salvo que el usuario haya elegido otro en los ajustes. Para montajes con base de cuadro esto reemplaza la regla A1 ("el primer clip de la línea"), que queda para los montajes sin fps.
- **Alternativa descartada:** el fps más alto del proyecto; recalcular el fps cada vez según el primer clip de la línea (la grilla cambiaría al mover un clip); preguntarle al usuario al importar.
- **Por qué:** es lo que pide el plan del crítico ("fps del montaje como {num, den}, con valor por defecto tomado del primer material y editable"). La grilla tiene que ser estable: si dependiera de qué clip está primero, mover un clip movería todos los cortes. Preguntar es una traba para alguien que no sabe qué es un fps.
- **Cómo revertir / cambiar:** `fpsParaMigrar` en `src/main/montajeGuardado.js` (proyectos guardados), `montajeInicial` (nuevos) y `Montaje.fijarFps` para cambiarlo después (canal `montaje:fps`, todavía sin control en la interfaz). Para que el export vuelva a la regla A1, sacar el bloque `Montaje.fpsDe(m)` de `GuionExport.fpsDeMontaje`. Tests en `test/baseCuadro.test.js`.

### D2. La migración a cuadros redondea las fronteras, conserva `usadoIn` y no sube VERSION

- **Decisión:** al abrir un proyecto sin `fps`, cada frontera de cada pista (inicio y fin de cada elemento) se lleva al cuadro más cercano. Cada clip conserva su `usadoIn`, y su `usadoOut` pasa a `usadoIn + duración en cuadros`. Si eso pidiera material que el archivo no tiene, el clip pierde ese cuadro y queda un vacío de un cuadro detrás. Un resto de menos de medio cuadro desaparece. La migración entra como estado inicial del historial (no se deshace) y corre una sola vez.
- **Alternativa descartada:** subir `Montaje.VERSION` (montajeUtilizable borraría la edición); redondear duraciones en vez de fronteras (el error se acumula: con 200 cortes el final se corre varios cuadros); no migrar y dejar esos proyectos en tiempo continuo.
- **Por qué:** es la "migración EXPLÍCITA en montajeInicial (redondear al cargar)" del plan del crítico. Redondear fronteras mueve cada corte como mucho medio cuadro. Imagen y sonido de una pareja tienen las mismas fronteras y el mismo `usadoIn`, así que salen idénticos: la migración no puede desincronizarlos. Está probado con el proyecto real TEST 1.
- **Cómo revertir:** en `obtenerHistorialMontaje` (`src/main/main.js`), sacar la línea `m = asegurarBaseDeCuadro(m, fuente)`. Un proyecto ya migrado y guardado conserva su `fps`; para volver a tiempo continuo hay que borrar ese campo de `proyecto.json` (el modelo lo tolera). Test: "MIGRACION: el proyecto viejo real queda en cuadro y conserva su edicion".

### D3. Un montaje sin `fps` sigue en tiempo continuo

- **Decisión:** la base de cuadro solo se aplica si el montaje tiene `fps`. Sin ese campo, todas las operaciones se comportan exactamente como antes (MIN_DUR de 40 ms, sin redondeo).
- **Alternativa descartada:** que todo montaje sin fps asuma 30.
- **Por qué:** la app nunca trabaja sin fps, porque montajeInicial y la migración lo ponen. Pero cientos de tests arman montajes a mano con tiempos como 12,345. Obligar a 30 los habría roto sin ganar nada. Los proyectos viejos se migran de forma explícita (D2), no con un valor por defecto escondido.
- **Cómo revertir:** en `crearMontaje` (`src/shared/montaje.js`), poner 30 fps por defecto y actualizar los tests que usan tiempos fuera de la grilla.

### D4. Silenciar es un campo propio; una pista de audio vieja "oculta" se sigue leyendo muda

- **Decisión:** `pista.silenciada` (por defecto false), `pista.ganancia` y `clip.volumen` (por defecto 1, acotados a 0..4) son campos opcionales. En las pistas de audio, el botón del ojo pasa a ser un botón de silencio, con un control de volumen de 0 a 200 %. Una pista de audio guardada con `visible: false` se lee como silenciada; tocar el botón pone `visible: true` y cambia `silenciada`. El volumen de un clip se aplica a todo su grupo vinculado.
- **Alternativa descartada:** seguir usando `visible` como mute; migrar `visible` → `silenciada` al cargar; aplicar el volumen solo al clip tocado.
- **Por qué:** el hallazgo 5 y el plan del crítico piden separar `silenciada` de `visible`. Leer la pista vieja como muda evita que un proyecto guardado empiece a sonar de golpe. El volumen de la imagen sola no significa nada: si alguien lo cambia desde el clip de video, lo que quiere es cambiar su sonido.
- **Cómo revertir:** `pistaSilenciada` y `ajustarVolumen` en `src/shared/montaje.js`; el encabezado en `renderTl` y el listener `change` de `.tlGanancia` en `src/renderer/renderer.js`.

### D5. La mezcla suma con ganancia y recorta a [-1, 1], a 48 kHz estéreo, con AAC o Opus

- **Decisión:** el export suma todas las capas audibles con su ganancia, recorta a [-1, 1] y sale a 48 kHz estéreo. Si un archivo viene a otra frecuencia, se interpola linealmente. Se mezcla por bloques de 100 ms intercalados con el video, y cada tramo abre su lector de audio recién cuando empieza a sonar. Codec: AAC; si el equipo no lo codifica, Opus; si tampoco, el video sale sin sonido y la interfaz lo dice.
- **Alternativa descartada:** `OfflineAudioContext` con `decodeAudioData` de cada archivo entero (una grabación de una hora ocuparía gigas de memoria); un limitador o una normalización automática; mezclar todo el audio al final (mediabunny retendría todo el video en memoria).
- **Por qué:** el plan del crítico no fija la forma de mezclar, y esta es la más simple que no rompe con archivos largos. El recorte duro solo se oye si la voz y la música juntas pasan el máximo, y eso se corrige bajando el volumen de la pista de música. Un limitador cambiaría el sonido sin que nadie lo pida.
- **Cómo revertir / cambiar:** `mezclarBloque` en `src/shared/mezclaAudio.js` (recorte e interpolación) y `CODECS_AUDIO` en `src/renderer/exportVideo.js`. Tests en `test/mezclaAudio.test.js`.

### D6. El visor no mezcla: solo respeta el silencio y el volumen del sonido del clip visible

- **Decisión:** el visor sigue con un solo `<video>`. Se calla si el sonido de la capa visible está silenciado, en 0 o borrado, y toma su volumen (hasta 100 %). La música de otra pista no suena en el visor, y el panel de export lo avisa.
- **Alternativa descartada:** mezclar en el visor con Web Audio (varios `<video>` o `AudioBufferSourceNode` sincronizados).
- **Por qué:** el plan del crítico lo deja afuera ("La preview sigue con un solo <video> hasta la multi-capa real, y la interfaz avisa que el visor no mezcla"). Cuesta mucho y no depende del modelo.
- **Cómo revertir:** borrar `visorAjustarSonido` y su llamada en `visorMostrar` (`src/renderer/renderer.js`).

### D7. Flechas: un cuadro; con Shift, un segundo

- **Decisión:** ← y → mueven el cabezal un cuadro y pausan la reproducción. Con Shift, un segundo (en cuadros enteros). Antes de moverse, el cabezal se lleva a su cuadro.
- **Alternativa descartada:** Shift = 5 cuadros (como Premiere) o 10.
- **Por qué:** el plan del crítico solo fija "flechas izquierda/derecha avanzan un cuadro". Para alguien que no sabe editar, un segundo es una unidad que se entiende.
- **Cómo revertir:** cambiar `paso` en `GestosTl.cabezalConFlecha` (`src/renderer/gestosTl.js`).

---

## Tanda E (13/09/2026): ripple multipista, paso 7 de la hoja de ruta

El plan del crítico pedía cerrar cuatro reglas con el usuario antes de escribir código. No hubo consulta: se siguió la recomendación del plan y de la corrección del crítico a las dos propuestas. Las cuatro quedan acá para revisarlas.

### E1. Un encuadre que cruza el tramo se acorta (o se estira); no frena la operación

- **Decisión:** al borrar con ripple, hacer ripple, cerrar un vacío o insertar, un clip de ajuste (encuadre 9:16) de otra pista que cruza el tramo pierde la parte que cae adentro. Si está entero adentro, se va con el tramo. Cuando el ripple alarga un clip, el encuadre que cruza el punto se estira; también el que termina justo en el corte (ripple del final) o el que empieza justo ahí (ripple del inicio), porque cubre al clip que crece. Un encuadre que no cruza el punto se corre entero.
- **Alternativa descartada:** rechazar la operación si el punto cae dentro de un clip de otra pista (lo que proponían las dos propuestas); partir el encuadre en dos y meter un vacío en el medio.
- **Por qué:** es la corrección explícita del crítico: el encuadre existe para abarcar varios clips (PENDIENTE.md, decisión 1.1), y con la regla de rechazar, borrar con ripple un clip debajo de un encuadre largo, el caso normal de un short 9:16, se rechazaría siempre. Partirlo dejaría dos encuadres donde el usuario puso uno.
- **Cómo revertir:** `sacarTramo` y `abrirTramo` en `src/shared/montaje.js` (la rama de `esAjuste`). Para que un encuadre frene como el material, cambiar `esMaterial` para que devuelva true también en los ajustes. Tests en `test/rippleMultipista.test.js` ("E1: …", "ripple que ALARGA…").

### E2. Material de otra pista en el tramo frena: todo o nada al borrar e insertar, lo que se pueda al hacer ripple y cerrar

- **Decisión:** un clip con material (B-roll, música, otra voz) en una pista no bloqueada que cae en el tramo, o que cruza el punto donde se abre lugar, frena la operación. Borrar con ripple e insertar no hacen nada. El ripple y cerrar un vacío llegan hasta donde pueden todas las pistas (el delta mínimo común, la misma regla de `deltaComun`). Si el tramo se puede sacar pero eso dejaría un clip vinculado separado de su pareja (una en una pista que se corre y otra en una bloqueada), no se hace nada. En todos los casos la operación devuelve un informe con la pista que la frenó, y la interfaz lo dice ("A2 tiene un clip en ese tramo y se partiría. Si esa pista no tiene que correrse, bloqueala con el candado").
- **Alternativa descartada:** partir el B-roll o la música en el punto (Kdenlive, extracción de zona); borrar el material de otras pistas que cae en el tramo; dejar ese material quieto y correr solo lo de atrás.
- **Por qué:** el plan pone "se rechaza nombrando la pista, o se parte" y la corrección del crítico dice que el rechazo "solo puede aplicarse a clips con material". Partir o borrar material que el usuario no tocó es destruir sin avisar. Dejarlo quieto es el defecto de antes (lo que queda encima pasa a estar sobre otra frase). Frenar a medias en ripple y cerrar sigue la regla ya tomada para el vínculo: moverse lo que puedan todas juntas.
- **Cómo revertir / cambiar:** `planDeCorrer` en `src/shared/montaje.js`. Para partir en vez de frenar: en las pistas con material que cruza, llamar a `cortarUno` en los bordes antes de `sacarTramo` y permitir material en `sacarTramo`. Tests: "E2/E3: música sin candado…", "ripple que ACHICA se frena…", "un vínculo que quedaría partido por el candado…".

### E3. `pista.bloqueada` con candado, sin bloquear nada por defecto

- **Decisión:** cada pista tiene un campo opcional `bloqueada` y un candado en el encabezado. Una pista bloqueada no se corre con los ripples que nacen en otra pista. Las pistas del clip editado y su pareja se corren siempre, aunque estén bloqueadas. Ninguna pista nace bloqueada, tampoco la música. El candado solo significa "no se corre": cortar con la cuchilla, mover y recortar siguen editando esa pista. Destrabar saca el campo. `Montaje.VERSION` sigue en 1.
- **Alternativa descartada:** bloquear por defecto la pista de audio a la que entra la música (A2+); un bloqueo total al estilo del "lock" de Premiere (no se puede editar nada de la pista).
- **Por qué:** el crítico marca como error bloquear por defecto la música que entra en A2+: `colocarMedia` también manda ahí el sonido de un segundo video superpuesto, que sí tiene que seguir a su imagen, y "hay que consultarlo y no suponerlo". Sin bloqueo por defecto, el caso de la música se resuelve con el mensaje de E2, que dice qué pista trabar. El bloqueo total es otra función (hallazgo 16) y nadie la pidió.
- **Cómo revertir / cambiar:** para bloquear la música al entrar, en `colocarMedia` (`src/shared/montaje.js`), agregar `actualizarPista(salida, destino, { bloqueada: true })` cuando `esAudioPuro`. El candado está en `renderTl` y en el listener de clic de `tlEncabezados` (`src/renderer/renderer.js`). Un proyecto guardado sin el campo abre igual: test "un proyecto guardado sin el campo bloqueada…".

### E4. Un ripple que nace en V2 o más arriba sigue las mismas reglas que uno de V1

- **Decisión:** no hay regla aparte según la pista de origen. Borrar con ripple un B-roll o un encuadre de V2 con la entrevista de V1 debajo, en el mismo tramo, se frena por E2 y el mensaje nombra V1. Si V1 está vacía en ese tramo, o bloqueada, se hace.
- **Alternativa descartada:** que un ripple de V2+ arrastre solo las pistas de arriba del origen y sus vínculos (propuesta de experiencia); rechazarlo siempre.
- **Por qué:** es lo que sostiene la propuesta de cimientos, la base que eligió el crítico ("encuadreAjuste.test.js:380-390 sigue pasando porque el ripple en V2 con material en V1 se rechaza"). Arrastrar solo las de arriba correría los encuadres de V3 sobre otro material de V1, que es el defecto que este paso arregla. Una sola regla es más fácil de explicar a alguien que no sabe editar.
- **Cómo revertir:** en `planDeCorrer`, filtrar `otras` a las pistas del mismo grupo con índice mayor que la de origen. `test/encuadreAjuste.test.js` ("borrar el último clip de una pista…") cambió por esta regla: ahora borra con Supr común y comprueba que el ripple de V2 no se come V1.

---

## Tanda F (13/09/2026): keyframes (1.4), paso 8 de la hoja de ruta

Se siguió la recomendación del plan del crítico y sus correcciones a los hallazgos 10 y 47. No hubo consulta: las decisiones quedan acá para revisarlas.

### F1. Las claves se guardan en tiempo de FUENTE, dentro del campo que animan

- **Decisión:** `transformacion.claves = [{ tFuente, escala, x, y, curva }]` en los clips con material y `ajuste.claves = [{ tFuente, xPct, yPct, wPct, hPct, curva }]` en los encuadres. `tFuente` está en el eje de `usadoIn`/`usadoOut`; en un encuadre, en su eje propio. Nacen en el cuadro del cabezal contado desde el inicio del clip (`tFuente - usadoIn` es un número entero de cuadros). Son campos opcionales: sin claves todo es fijo como antes y `Montaje.VERSION` sigue en 1. La evaluación vive en un solo lugar (`composicionEn`), así el visor y el export no pueden verla distinta.
- **Alternativa descartada:** claves relativas al inicio del clip en la línea; un formato propio separado del campo (una lista de "animaciones" aparte).
- **Por qué:** con claves en fuente, cortar, recortar, roll, slip, ripple y mover conservan la animación pegada al contenido sin tocar esas operaciones, porque `derivar()` ya copia todo (hallazgos 10 y 47; GES hace lo mismo). Con claves relativas, la mitad derecha de un corte arrancaría la animación de cero. La forma lista tiempo-valor-curva es la que coinciden FCPXML y MLT (PENDIENTE 1.4).
- **Consecuencia a saber:** un slip corre la animación junto con el contenido (el punch-in sigue a la persona, no al lugar en la línea).
- **Cómo revertir:** las funciones de la sección KEYFRAMES de `src/shared/montaje.js` (`ponerClave`, `valorAnimadoEn`, …). Sacar el campo `claves` de un proyecto lo deja fijo en su transformación base.

### F2. Las claves que quedan fuera de la ventana se conservan

- **Decisión:** recortar un clip no borra las claves de la parte escondida; volver a estirarlo trae la animación. Se evalúa con clamp a `[usadoIn, usadoOut]`. El verificador solo marca `claveFueraDeMaterial` (fuera de lo que tiene el archivo), `claveFueraDeCuadro` e `claveInvalida`.
- **Alternativa descartada:** podar las claves fuera de la ventana en cada operación (lo que sugería "claves dentro de la ventana" en el plan).
- **Por qué:** podar obligaría a tocar cortar, recortar, roll y slip, que es justo lo que el eje de fuente evita, y un recorte de ida y vuelta perdería la animación sin avisar.
- **Cómo revertir:** filtrar por ventana en `verificarClaves` y podar en `derivar` o en cada operación.

### F3. El encuadre animado que E1 acorta o estira conserva cada cuadro sobre su frase

- **Decisión:** cuando el ripple multipista le saca un tramo del medio a un encuadre animado, las claves de después se corren hacia atrás, y la clave del último cuadro antes del tramo pasa a "mantener". Cuando le abre lugar, el tramo nuevo mantiene el valor del punto donde se abrió y lo de después se corre. Si hay que partir una curva "suave", cada pedazo guarda qué parte de la S recorre (`tramo: [u0, u1]`) para que ningún cuadro cambie. Unir dos pedazos fusiona las claves con el mismo criterio.
- **Alternativa descartada:** dejar las claves del encuadre quietas (la animación quedaría corrida respecto de la frase) o rehacer la S entre los puntos nuevos (la prueba aleatoria medía diferencias de milésimas en el recorte).
- **Por qué:** el plan pedía definir qué pasa con las claves cuando el paso 7 acorta un encuadre. La regla que sostiene la tanda E es que cada encuadre siga sobre su frase, y eso tiene que valer también para su animación.
- **Cómo revertir:** `sacarDeClaves`, `abrirEnClaves`, `fusionarClaves` y `partirClaves` en `src/shared/montaje.js`.

### F4. La cámara lenta queda FUERA de 1.4

- **Decisión:** 1.4 anima transformación y encuadre. No hay retiming ni velocidad por clip.
- **Alternativa descartada:** meter la velocidad como una clave más, que es lo que PENDIENTE.md:186-188 daba por desbloqueado con 1.4.
- **Por qué:** el crítico lo marca como cambio de decisión que hay que consultar. La velocidad rompe la cuenta lineal `tFuente = usadoIn + (tLinea - inicio)` en todo el modelo, cambia `duracionDe` y el orden de pedidos del guion de export, sin que falle ningún test. Va como un eje aparte.
- **Cómo revertir:** no hay nada que revertir. Si el usuario la quiere dentro de 1.4, hay que diseñar el tercer eje antes (hallazgo 47).

### F5. Qué se anima: el clip ELEGIDO, en el cuadro del cabezal

- **Decisión:** en la barra del visor hay "◆ Clave" (pone o quita la clave del cuadro), "◂◆"/"◆▸" (clave anterior y siguiente) y un selector de curva (Lineal, Suave, Salto). Actúan sobre el clip elegido en la línea (de video o un encuadre) si el cabezal está encima. Poner una clave no cambia lo que se ve. Con el clip animado, mover o escalar la imagen en el visor, o el recuadro 9:16, cambia o crea la clave del cuadro del cabezal. Sin claves, esos gestos cambian el valor fijo como siempre. Las claves se ven como rombos amarillos en el clip.
- **Alternativa descartada:** crear claves solas al mover con el cabezal en otro lado (auto-keyframe siempre prendido); un editor de curvas.
- **Por qué:** para alguien que no sabe editar, que un gesto de siempre empiece a animar sin pedirlo sería una sorpresa. La animación se prende a propósito con el botón, y desde ahí los gestos conocidos hacen lo esperable.
- **Cómo revertir:** `objetivoDeClave` y `actualizarControlesClave` en `src/renderer/renderer.js`, `#grupoClaves` en `index.html`, y el `tLinea` que pasan `montaje:transformar` y `montaje:encuadre`.

### F6. Slip frena en cuadros enteros

- **Decisión:** `deltaSlip` redondea hacia abajo a cuadros enteros el tope contra los bordes del material.
- **Alternativa descartada:** dejarlo como estaba (frenaba justo en el final del archivo, a 45,3 s).
- **Por qué:** la prueba aleatoria con claves lo encontró: frenar a mitad de cuadro corría `usadoIn` un pedazo de cuadro, y las claves (y los cuadros de la fuente) dejaban de caer en la grilla del clip. Era un resto de la tanda D. Sin base de cuadro, el comportamiento no cambia.
- **Cómo revertir:** volver a `Math.max(med.disponibleIn - el.usadoIn, Math.min(deltaFuente, med.disponibleOut - el.usadoOut))` en `deltaSlip`.

## Tanda G (19/09/2026): vista previa real, selección múltiple y onda

### G1. La vista previa aplica la operación real, en una capa encima

- **Decisión:** mientras se arrastra, `PreviewTl.simular` (en `src/renderer/previewTl.js`) aplica sobre la copia local del montaje la misma operación que el main aplica al soltar, poda incluida. Las filas que cambian se atenúan y encima se dibuja cómo van a quedar (`.tlPrevCapa`). El clip agarrado ya no se corre con `style.left`. El cartel suma lo que el main va a contar: si el ripple frena y qué pista lo frena, si el roll no puede moverse, si el sonido se va a otra pista, y el in/out nuevo en slip y slide.
- **Alternativa descartada:** calcular a mano la geometría de cada modo (lo que proponía el hallazgo 31) o rehacer `tlPistas.innerHTML` en cada mousemove.
- **Por qué:** es el plan del crítico (paso 9a). Con una segunda aritmética, la vista previa podría mostrar algo distinto de lo que queda. Rehacer el HTML saca del documento el nodo agarrado y rompe `elementFromPoint`. Medido: con 165 clips y fps 30, simular y comparar cuesta menos de 1 ms por cuadro.
- **Cómo revertir:** sacar `programarPreview()` del mousemove en `renderer.js` y volver a poner `fantasmaTl.style.left = ...` en la rama `mover`.

### G2. El grupo se mueve en el tiempo; cada clip se queda en su pista

- **Decisión:** con varios clips elegidos (Ctrl, Cmd o Shift + clic), arrastrar el cuerpo de uno con la herramienta de selección los corre a todos lo mismo con `Montaje.moverGrupo`. Cada clip queda en su pista. Primero salen todos y después tapan todos, en un solo paso de deshacer. El corrimiento cae en cuadro una sola vez y se frena en 0 para todo el grupo. Supr quita a todos y deja sus vacíos. Shift+Supr con varios elegidos no hace nada y avisa. Recorte, ripple, roll, slip y slide siguen siendo de un solo clip.
- **Alternativa descartada:** permitir el cambio de pista del grupo, o hacer el ripple de varios clips a la vez.
- **Por qué:** con clips de pistas distintas, "llevar el grupo a otra pista" no tiene un significado único. El ripple de varios clips corre lo de atrás, y el segundo ripple ya no encontraría el clip donde se eligió. El plan pide solo un `moverGrupo` atómico.
- **Cómo revertir:** `moverGrupo`, `moverGrupoConInforme` y `borrarGrupo` en `montaje.js`, el canal `montaje:grupo` y `grupoSel` en `renderer.js`. Sin `grupoSel`, todo vuelve a ser de un clip.

### G3. Imán por los bordes del clip; Shift lo invierte

- **Decisión:** al mover, se imanta el inicio o el fin del clip (el que quede más cerca) a los bordes de los demás clips y al cabezal. Quedan afuera los bordes del propio clip, de su pareja y del grupo. Una línea punteada marca dónde se pegó. En todos los modos, Shift invierte la casilla Imán mientras se arrastra.
- **Alternativa descartada:** imantar el puntero, como antes, o agregar un parámetro de exclusión a `Montaje.puntosDeImantado`.
- **Por qué:** con el imán en el puntero, el clip se pegaba a sus propios bordes (hallazgos 19 y 37). La exclusión vive en `PreviewTl.puntosSinPropios` para no tocar la firma que ya usa el modelo.
- **Cómo revertir:** en el mousemove, volver a `arrastreTl.ultimo = imantar(tiempoDesdeX(ev.clientX))` para todos los modos.

### G4. De dónde sale la onda

- **Decisión:** los picos salen del archivo de cada material (`media.ruta`), de su primera pista de audio, mezclada a mono y a 16 kHz. Se calculan una vez por mediaId y se guardan en `proyectos/<slug>/picos/<mediaId>.json`. El dibujo usa el tiempo de fuente (usadoIn/usadoOut), así que cortar, recortar o hacer slip no recalcula nada. Hay un canvas por clip de audio, del tamaño de la parte visible y escalado por devicePixelRatio. La onda se dibuja solo en los clips de audio.
- **Alternativa descartada:** usar el audio de 16 kHz extraído para transcribir, que existe solo para el archivo principal, o un canvas del ancho entero del clip, que pasa el límite de unos 32.767 px y sale en blanco.
- **Por qué:** la línea tiene material de cualquier archivo. El plan dice que la onda va antes que las miniaturas porque, en este producto, importa más el silencio que el cuadro.
- **Cómo revertir:** quitar el canvas `tlOnda` de `dibujarElemento` y la llamada a `pintarOndas()`. Los archivos de `picos/` son derivados y se pueden borrar.

## Tanda H (paso 11): aplicar los cortes de la transcripción a la línea

### H1. Un rango que aparece en varios clips, o en ninguno
- **Decisión:** el rango de fuente se corta en TODOS los lugares de la línea donde aparece ese material (la toma repetida, el mismo archivo en V2). Si no aparece en ningún lado (ya se sacó a mano, o ese pedazo no se usa), no se hace nada y el resumen lo cuenta ("ya no estaba en la línea"). Aplicar dos veces no corta de nuevo.
- **Alternativa descartada:** cortar solo la primera aparición, o solo en V1/A1.
- **Por qué:** el plan del crítico pide resolver los dos casos sin fallar; si el usuario marcó una muletilla como cortada, no quiere oírla en ningún lado. Cortar solo V1 dejaría el mismo pedazo en un B-roll con el mismo archivo.
- **Cómo revertir:** en `Montaje.aplicarCortesDeFuente` quedarse con el primer lugar de `rangoFuenteALinea` en vez de recorrerlos todos.

### H2. Explícito, en un paso, con resumen
- **Decisión:** marcar un bloque sigue sin tocar el montaje. Hay un botón "Aplicar cortes a la línea" que saca todos los bloques `cut` (no las `propuesta`) en una sola operación y un solo paso de deshacer, y muestra un resumen.
- **Alternativa descartada:** sincronizar en vivo cada clic en un bloque con la línea.
- **Por qué:** 192 cortes aplicados solos ya resultaron ilegibles (CTX 7.11) y el usuario pidió que los cortes automáticos sean opcionales (cutsBuilder, 05/08). Un Ctrl+Z devuelve todo junto.
- **Cómo revertir:** quitar el botón `btnAplicarCortes` y el canal `montaje:aplicar-cortes`.

### H3. Qué pasa cuando otra pista frena
- **Decisión:** se usa el ripple multipista de la tanda E (E1–E4): encuadres se acortan, pistas con candado no se mueven, material de otra pista en el tramo frena. Es todo o nada POR TRAMO: el tramo frenado no se corta en absoluto y los demás se aplican. El resumen nombra la pista que frenó.
- **Alternativa descartada:** abortar todos los cortes si uno frena, o cortar igual partiendo la música.
- **Por qué:** es la misma regla que borrar con ripple; abortar todo por una sola canción castiga los otros 50 cortes, y partir la música es lo que el candado existe para evitar.
- **Cómo revertir:** en `aplicarCortesDeFuente`, ante `plan.bloqueo` devolver `[m, informe]` enseguida.

### H4. Bordes a cuadro
- **Decisión:** los bordes de cada tramo se llevan a la grilla con `aCuadro` antes de cortar; si el tramo queda más corto que un cuadro, se omite (se cuenta en `cortos`).
- **Alternativa descartada:** cortar en los segundos exactos de whisper.
- **Por qué:** con base de cuadro un corte fuera de grilla deja restos de milisegundos (hallazgo 4 del INFORME).
- **Cómo revertir:** usar `l.inicio`/`l.fin` sin `aCuadro`.
