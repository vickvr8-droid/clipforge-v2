# Motor alternativo: faster-whisper local (GPU int8, GTX 1060 Pascal).
# Adaptado de C:\Users\vicente\audio-ai-tools\transcribe_large.py para
# seguir la convencion de ClipForge (ruta de salida explicita por
# argumento, mismo formato de progreso que whisperxBridge.js espera).
# NO se modifico el script original (regla 13 CTX_MAESTRO: duplicar
# antes de tocar el original) - usa el mismo venv, script separado.
#
# Uso: python transcribe_fasterwhisper.py <entrada> <json_salida>

import sys, json, time, os

AUDIO_AI_TOOLS = r"C:\Users\vicente\audio-ai-tools"
site_packages = os.path.join(AUDIO_AI_TOOLS, "venv", "Lib", "site-packages")
for pkg in ["nvidia\\cublas\\bin", "nvidia\\cudnn\\bin", "nvidia\\cuda_nvrtc\\bin"]:
    dll_dir = os.path.join(site_packages, pkg)
    if os.path.isdir(dll_dir):
        os.add_dll_directory(dll_dir)
        os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel, BatchedInferencePipeline

def write_progress(progress_path, status, extra=None):
    data = {"status": status, "updated": time.time()}
    if extra:
        data.update(extra)
    with open(progress_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

def is_hallucination(text, min_repeats=5):
    words = text.strip().split()
    if len(words) < min_repeats:
        return False
    counts = {}
    for w in words:
        wl = w.lower().strip(".,!?")
        counts[wl] = counts.get(wl, 0) + 1
        if counts[wl] >= min_repeats:
            return True
    return False

def fmt_ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def main():
    if len(sys.argv) < 3:
        print("Uso: python transcribe_fasterwhisper.py <entrada> <json_salida>")
        sys.exit(1)

    input_path = sys.argv[1]
    out_json = sys.argv[2]
    progress_path = out_json + ".progress.json"

    t0 = time.time()
    write_progress(progress_path, "cargando modelo large-v3 (faster-whisper)")
    try:
        model = WhisperModel("large-v3", device="cuda", compute_type="int8")
        pipeline = BatchedInferencePipeline(model=model)
        used = "cuda/int8/batched4/large-v3"
    except Exception as e:
        write_progress(progress_path, f"GPU fallo ({e}), uso CPU")
        model = WhisperModel("large-v3", device="cpu", compute_type="int8")
        pipeline = model
        used = "cpu/int8/large-v3"

    write_progress(progress_path, f"modelo listo ({used}), transcribiendo", {"device": used})
    transcribe_kwargs = dict(
        language="es", vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=True,
        condition_on_previous_text=False,
    )
    if pipeline is not model:
        segments, info = pipeline.transcribe(input_path, batch_size=4, **transcribe_kwargs)
    else:
        segments, info = pipeline.transcribe(input_path, **transcribe_kwargs)

    out = {"device": used, "duration_sec": info.duration, "segments": [], "hallucinations_descartadas": 0}
    idx = 1
    for seg in segments:
        text = seg.text.strip()
        words = [{"word": w.word, "start": round(w.start, 2), "end": round(w.end, 2),
                  "prob": round(w.probability, 3)} for w in (seg.words or [])]
        flagged = is_hallucination(text)
        out["segments"].append({
            "start": round(seg.start, 2), "end": round(seg.end, 2),
            "text": text, "words": words, "posible_alucinacion": flagged
        })
        if flagged:
            out["hallucinations_descartadas"] += 1
        pct = 5 + min(seg.end / info.duration, 1.0) * 94
        write_progress(progress_path, "transcribiendo", {"pct": round(pct, 1), "device": used})

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    total_sec = round(time.time() - t0, 1)
    write_progress(progress_path, "listo", {
        "total_sec": total_sec, "device": used,
        "segmentos": len(out["segments"]),
        "descartados": out["hallucinations_descartadas"]
    })
    print(json.dumps({"ok": True, "total_sec": total_sec}))

if __name__ == "__main__":
    main()
