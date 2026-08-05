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
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(result_aligned, f, ensure_ascii=False, indent=2)

    total_sec = round(time.time() - t0, 1)
    write_progress(progress_path, "listo", {
        "total_sec": total_sec,
        "segmentos": len(result_aligned["segments"])
    })
    print(json.dumps({"ok": True, "total_sec": total_sec}))

if __name__ == "__main__":
    main()
