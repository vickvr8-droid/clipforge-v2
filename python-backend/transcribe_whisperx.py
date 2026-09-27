# Script de transcripcion, reusa el patron real ya probado en
# C:\Users\vicente\remotion-projects\whisperx-tool\whisperx_test1.py
# Se ejecuta con el python del venv de WhisperX, NO con el sistema.
#
# Uso: python transcribe_whisperx.py <archivo_entrada> <json_salida>
#
# Escribe progreso en <json_salida>.progress.json para que la app
# pueda mostrar el avance mientras corre (evita la sensacion de
# "colgado" en procesos largos).

import sys, time, json, os
import torch
import whisperx

def write_progress(progress_path, status, extra=None):
    data = {"status": status, "updated": time.time()}
    if extra:
        data.update(extra)
    with open(progress_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

def fmt_ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
def main():
    if len(sys.argv) < 3:
        print("Uso: python transcribe_whisperx.py <entrada> <json_salida>")
        sys.exit(1)

    input_path = sys.argv[1]
    out_json = sys.argv[2]
    progress_path = out_json + ".progress.json"

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "int8"  # GTX 1060 Pascal no soporta float16, ver CTX_MAESTRO seccion 3
    batch_size = 4

    t0 = time.time()
    write_progress(progress_path, "cargando modelo whisperx large-v3", {"device": device})
    model = whisperx.load_model("large-v3", device, compute_type=compute_type, language="es")

    write_progress(progress_path, "cargando audio")
    audio = whisperx.load_audio(input_path)

    write_progress(progress_path, "transcribiendo (whisperx + VAD interno)")
    result = model.transcribe(audio, batch_size=batch_size, language="es")

    write_progress(progress_path, "cargando modelo de alineacion es (wav2vec2)")
    model_a, metadata = whisperx.load_align_model(language_code="es", device=device)

    write_progress(progress_path, "alineando (wav2vec2 forced alignment)")
    result_aligned = whisperx.align(
        result["segments"], model_a, metadata, audio, device,
        return_char_alignments=False
    )

    # ---- QUIEN HABLA (diarizacion) ----
    # OPCIONAL a proposito: sin token la transcripcion sale igual que
    # antes. WhisperX siempre trajo esto adentro pero nunca se llamaba.
    #
    # El modelo (pyannote/speaker-diarization-community-1) es "gated" en
    # HuggingFace: hay que aceptar sus condiciones con una cuenta y usar un
    # token de lectura. Se baja UNA vez y despues corre local, sin red.
    #
    # POR QUE VA ENVUELTO EN try/except Y DESPUES DE ESCRIBIR NADA:
    # la diarizacion es un agregado, no el trabajo. Si falla -token vencido,
    # sin acceso al modelo, sin red la primera vez- lo que NO puede pasar es
    # perder una transcripcion que ya costo varios minutos de GPU. Asi que
    # se avisa en el resultado y se sigue.
    #
    # DOS MODOS, y el de disco es el bueno:
    #   CLIPFORGE_PYANNOTE_DIR -> el modelo clonado en el disco. No pide
    #                             token ni red. Es el modo "offline use"
    #                             del model card, y el que corresponde a
    #                             una app de escritorio: el token se usa
    #                             UNA vez para clonar y nunca mas.
    #   CLIPFORGE_HF_TOKEN     -> lo baja de HuggingFace y lo cachea.
    # Si estan los dos, gana el disco.
    # CLIPFORGE_PYANNOTE_MODELO acepta LAS DOS COSAS:
    #   una CARPETA  -> el modelo clonado en disco, sin token ni red
    #   un REPO      -> "usuario/modelo" de HuggingFace, con token
    # Sirve para cambiar de modelo sin tocar codigo. Varios competidores de
    # pyannote (Reverb, por ejemplo) estan construidos sobre el mismo
    # framework y se cargan con la misma llamada, asi que probar otro es
    # cambiar esta variable y medir.
    speakers = []
    diarize_error = None
    token = os.environ.get("CLIPFORGE_HF_TOKEN", "").strip()
    modelo = os.environ.get("CLIPFORGE_PYANNOTE_MODELO", "").strip()
    # Si parece una ruta (tiene separador o unidad) tiene que existir de
    # verdad. Un typo no puede pasar por "no hay diarizacion configurada":
    # el sintoma seria identico y se pierde media hora buscando donde no es.
    parece_ruta = bool(modelo) and (os.sep in modelo or "/" in modelo and os.path.splitdrive(modelo)[0])
    if parece_ruta and not os.path.isdir(modelo):
        diarize_error = f"CLIPFORGE_PYANNOTE_MODELO no es una carpeta: {modelo}"
        modelo = ""
    desde_disco = bool(modelo) and os.path.isdir(modelo)

    if modelo or token:
        try:
            from whisperx.diarize import DiarizationPipeline
            write_progress(progress_path, "identificando hablantes (pyannote)",
                           {"modelo": modelo or "pyannote/speaker-diarization-community-1"})
            diarizar = DiarizationPipeline(
                model_name=modelo or None,
                token=None if desde_disco else (token or None),
                device=device
            )
            # Los limites son una ayuda real: sin ellos el modelo tiende a
            # inventar hablantes de mas en audio con ruido o musica.
            min_spk = int(os.environ.get("CLIPFORGE_MIN_HABLANTES", "1"))
            max_spk = int(os.environ.get("CLIPFORGE_MAX_HABLANTES", "6"))
            segmentos = diarizar(audio, min_speakers=min_spk, max_speakers=max_spk)
            result_aligned = whisperx.assign_word_speakers(segmentos, result_aligned)
            speakers = sorted({
                s["speaker"] for s in result_aligned["segments"] if s.get("speaker")
            })
        except Exception as e:
            # El texto del error viaja a la interfaz: "401" significa que
            # falta aceptar las condiciones del modelo o que el token no
            # tiene permiso sobre repos gated, y eso hay que poder leerlo
            # sin abrir la consola.
            diarize_error = f"{type(e).__name__}: {e}"
            write_progress(progress_path, "sin hablantes (la diarizacion fallo)",
                           {"error": diarize_error})

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(result_aligned, f, ensure_ascii=False, indent=2)

    total_sec = round(time.time() - t0, 1)
    write_progress(progress_path, "listo", {
        "total_sec": total_sec,
        "segmentos": len(result_aligned["segments"]),
        "hablantes": len(speakers)
    })
    print(json.dumps({
        "ok": True, "total_sec": total_sec,
        "hablantes": speakers,
        "diarizacion": ("ok" if speakers else ("error" if diarize_error else "apagada")),
        "diarizacion_error": diarize_error
    }))

if __name__ == "__main__":
    main()
