# ClipForge

App de escritorio (Electron) para transcripcion + deteccion automatica
de cortes (silencios, muletillas, repeticiones), pensada originalmente
para edicion estilo Rubius pero como **proyecto propio, separado de
DaVinci** (renombrado 27/07/2026, antes "Rubius Editor", para no
confundirlo con el proyecto de DaVinci/Ghidra).

Contexto completo y actualizado: `CTX_PROYECTO_CLIPFORGE_1D.md` en
`C:\Users\vicente\Desktop\Contexto` (fuente de verdad real, no este
README).

## Alcance MVP
1. Transcripcion con motor seleccionable: faster-whisper local,
   WhisperX local, o Descript (API).
2. Pantalla de keys con deteccion automatica de proveedor.
3. Deteccion automatica de silencios + muletillas/repeticiones (LLM).
4. Editor de transcripcion: aceptar/rechazar cortes.
5. Exporta JSON de cortes + SRT. No aplica cortes en DaVinci directo.
6. Panel de chat con Claude integrado (acceso al codigo de la app,
   muestra diff, pide confirmacion antes de aplicar, commit de git
   por cada cambio aplicado).

## Estado (actualizado 28/07/2026)
- [x] 1. Transcripcion (WhisperX y faster-whisper, motor seleccionable
      en la UI). Descript queda deshabilitado en el selector, pendiente
      de integrar.
- [x] 2. Pantalla de keys con deteccion automatica de proveedor por
      prefijo (`keysStore.js`).
- [x] 3. Deteccion de silencios via ffmpeg (`silenceBridge.js`, corre
      automatico despues de cada transcripcion). Muletillas/repeticiones:
      SOLO el flag `posible_alucinacion` que ya traia faster-whisper
      (repeticion de palabra en float); NO hay todavia analisis por LLM
      de muletillas/tangentes reales (eso sigue pendiente, ver Gemini
      en seccion 5.3-5.4 de CTX_PROYECTO_CLIPFORGE_1D.md).
- [x] 4. Editor de aceptar/rechazar: bloques clickeables (`cutsBuilder.js`
      + UI en `renderer.js`), con resumen en vivo (total, cortados,
      metraje resultante, % eliminado). Todavia NO tiene: busqueda de
      palabra, shift+clic para rango, ni modo "Eliminar" vs "Mantener"
      como en la herramienta de referencia (Nekodificador) - por ahora
      es un clic = toggle por bloque individual.
- [x] 5. Exporta JSON de cortes (`<archivo>.cortes.json`) y SRT
      (`<archivo>.srt`), ambos solo con los bloques marcados "keep".
- [ ] 6. Panel de chat con Claude: NO empezado.

## Pendiente inmediato (siguiente sesion)
- Verificar que la app arranca sin errores (`npm start`) - el codigo
  se escribio en una sesion sin poder correr `node --check` por una
  falla intermitente de herramientas, revisar con cuidado antes de dar
  por bueno.
- Detectar muletillas/repeticiones reales via LLM (no solo el flag de
  faster-whisper) - implementar el backend elegible
  OpenRouter/LM Studio que describe la seccion 5.1 de
  CTX_PROYECTO_CLIPFORGE_1D.md.
- Multi-view/split layout 9:16 (deteccion de rostros + ffmpeg crop/vstack,
  seccion 5.3) - NO es parte del MVP original, evaluar si se agrega.
- Panel de chat con Claude embebido (item 6).
