# Deteccion de silencios via ffmpeg (filtro silencedetect), sin IA -
# rapido y confiable, mismo criterio que CTX_MAESTRO seccion 9
# ("Silencios/picos baratos y rapidos" -> ffmpeg propio).
#
# Uso: python detect_silences.py <archivo_entrada> <json_salida> [noise_db] [min_dur]
#   noise_db: umbral de ruido en dB (default -30, mas negativo = mas estricto)
#   min_dur: duracion minima de silencio en segundos para contar (default 0.35)
#
# Salida JSON: {"silences": [{"start": s, "end": s, "duration": s}, ...]}

import sys, json, re, subprocess

def main():
    if len(sys.argv) < 3:
        print("Uso: python detect_silences.py <entrada> <json_salida> [noise_db] [min_dur]")
        sys.exit(1)

    input_path = sys.argv[1]
    out_json = sys.argv[2]
    noise_db = sys.argv[3] if len(sys.argv) > 3 else "-30"
    min_dur = sys.argv[4] if len(sys.argv) > 4 else "0.35"

    cmd = [
        "ffmpeg", "-i", input_path,
        "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}",
        "-f", "null", "-"
    ]
    # ffmpeg escribe el análisis de silencedetect a stderr, no a stdout.
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    stderr = proc.stderr

    starts = [float(m) for m in re.findall(r"silence_start:\s*([-\d.]+)", stderr)]
    # silence_end viene como "silence_end: X | silence_duration: Y"
    ends = re.findall(r"silence_end:\s*([-\d.]+)\s*\|\s*silence_duration:\s*([-\d.]+)", stderr)

    silences = []
    for i, start in enumerate(starts):
        if i < len(ends):
            end_val, dur_val = ends[i]
            silences.append({
                "start": round(start, 2),
                "end": round(float(end_val), 2),
                "duration": round(float(dur_val), 2)
            })

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"silences": silences, "count": len(silences)}, f, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "count": len(silences)}))

if __name__ == "__main__":
    main()
