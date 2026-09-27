# Motor de transcripcion EN LA NUBE (NVIDIA Riva / NVCF).
#
# POR QUE EXISTE: los otros dos motores (WhisperX y faster-whisper) corren
# en la GPU de esta maquina. En una GTX 1060 una grabacion larga ocupa la
# placa varios minutos y no se puede hacer otra cosa mientras tanto. Este
# motor manda el audio a los servidores de NVIDIA y devuelve el texto: la
# PC solo hace la conversion de audio con ffmpeg (segundos) y espera.
#
# El modelo por defecto es parakeet-ctc-0.6b-es: 600M de parametros
# entrenados con 28.000+ horas de espanol de LATINOAMERICA/EE.UU. e
# ingles, bilingue (entiende cuando se mezclan los dos idiomas en la misma
# frase), y devuelve puntuacion y mayusculas ya puestas.
#
# Uso: python transcribe_nvidia.py <archivo_entrada> <json_salida>
#
# Todo lo configurable viaja por ENTORNO, nunca por argumentos: los
# argumentos de un proceso los puede leer cualquier otro proceso de la
# maquina y aca viaja la API key.
#
#   CLIPFORGE_NVIDIA_KEY       la key (nvapi-...). OBLIGATORIA.
#   CLIPFORGE_NVCF_FUNCTION_ID el id de la funcion de NVCF. Ya viene con el
#                              de parakeet-ctc-0.6b-es puesto; solo hay que
#                              tocarlo para usar OTRO modelo.
#   CLIPFORGE_NVIDIA_SERVER    default grpc.nvcf.nvidia.com:443
#   CLIPFORGE_NVIDIA_MODELO    default vacio (el endpoint ya sirve uno solo)
#   CLIPFORGE_NVIDIA_LANG      default es-US
#   CLIPFORGE_FFMPEG           default "ffmpeg" (se resuelve por PATH)
#   CLIPFORGE_PALABRAS_CLAVE   palabras separadas por coma (ver abajo)
#   CLIPFORGE_BOOST_SCORE      default 4.0
#
# SOBRE LAS PALABRAS CLAVE (word boosting): es la unica palanca que queda
# del lado del cliente para los modismos y los nombres propios. El consejo
# de acoplar un modelo de lenguaje N-gram (KenLM) solo aplica corriendo el
# modelo LOCAL en NeMo; contra la API el decodificador es de NVIDIA y no se
# le puede enchufar un LM propio. El boosting si viaja en la peticion y
# sube la probabilidad de las palabras que uno le pasa, que para jerga
# chilena y nombres propios es justo lo que hace falta.

import sys, os, time, json, wave, subprocess, tempfile

# El endpoint de NVCF identifica QUE modelo se quiere por este id, no por
# la URL: todos los modelos de voz viven detras del mismo host. Sin este dato
# el servidor contesta INVALID_ARGUMENT "no function-id was passed in the
# metadata", que no dice nada de por que.
#
# CAMBIO DEL 09/08/2026 — por que ya NO es parakeet-ctc-0.6b-es
# -------------------------------------------------------------
# Al probarlo por primera vez con una key real, parakeet-ctc-0.6b-es
# (a9eeee8f-b509-4712-b19d-194361fa5f31) fallo SIEMPRE con
# DEADLINE_EXCEEDED "failed to establish link to worker", a los ~30 s, tanto
# en streaming como en offline. La funcion figura ACTIVE en
# /v2/nvcf/functions, pero NVCF no consigue un worker que la atienda: esta
# caida del lado de NVIDIA, no es un problema de la key ni de este codigo.
#
# Medido el mismo dia con la misma key, sobre 30 s de audio:
#   parakeet-ctc-0.6b-es              30.9 s  sin worker
#   parakeet-ctc-riva                 30.8 s  sin worker
#   canary-1b-asr                      1.8 s  transcribe pero 0 tiempos por palabra
#   parakeet-ctc-1.1b-asr              1.5 s  INVALID_ARGUMENT con es-US (solo ingles)
#   parakeet-1.1b-rnnt-multilingual    2.3 s  español + 11 palabras CON tiempos  <-- este
#
# El criterio duro es el de los TIEMPOS POR PALABRA: cutsBuilder arma los
# bloques de corte y el SRT desde words[].start/end, asi que una funcion que
# transcriba sin tiempos no sirve por buena que sea. Eso deja a canary afuera
# y con el a la unica alternativa que quedaba.
#
# Si algun dia vuelve parakeet-ctc-0.6b-es, es cuestion de poner su id en
# CLIPFORGE_NVCF_FUNCTION_ID sin tocar codigo.
FUNCTION_ID_PARAKEET_MULTI = "71203149-d3b7-4460-8231-1be2543a1fca"
FUNCTION_ID_PARAKEET_ES = "a9eeee8f-b509-4712-b19d-194361fa5f31"  # caido, ver arriba

BYTES_POR_MUESTRA = 2      # s16le
FRECUENCIA = 16000         # Riva espera 16 kHz mono
BYTES_POR_SEG = FRECUENCIA * BYTES_POR_MUESTRA
CHUNK_SEG = 4              # tamano de cada envio


def write_progress(progress_path, status, extra=None):
    data = {"status": status, "updated": time.time()}
    if extra:
        data.update(extra)
    with open(progress_path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def salir_con_error(mensaje):
    # El mensaje llega tal cual a la interfaz de ClipForge, asi que tiene
    # que decir QUE hacer, no solo que fallo.
    print(json.dumps({"ok": False, "error": mensaje}), file=sys.stderr)
    sys.exit(1)


def a_pcm16k(entrada, salida_raw, ffmpeg):
    # -vn descarta el video: mandar los frames a un servicio de voz seria
    # subir cientos de MB al pedo.
    cmd = [ffmpeg, "-nostdin", "-y", "-i", entrada,
           "-vn", "-ac", "1", "-ar", str(FRECUENCIA),
           "-f", "s16le", "-acodec", "pcm_s16le", salida_raw]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        cola = r.stderr.decode("utf-8", "replace")[-800:]
        salir_con_error(f"ffmpeg no pudo extraer el audio de {entrada}:\n{cola}")
    if not os.path.exists(salida_raw) or os.path.getsize(salida_raw) == 0:
        salir_con_error("ffmpeg termino bien pero no genero audio (¿el archivo tiene pista de audio?)")


def trozos(ruta_raw, progress_path, total_bytes):
    # Generador: lee el PCM de a pedazos y de paso reporta avance. Se hace
    # por streaming y no con offline_recognize porque la version offline
    # tiene tope de duracion y una grabacion de una hora no entra.
    enviados = 0
    with open(ruta_raw, "rb") as f:
        while True:
            datos = f.read(BYTES_POR_SEG * CHUNK_SEG)
            if not datos:
                return
            enviados += len(datos)
            write_progress(progress_path, "transcribiendo en la nube (NVIDIA)", {
                "pct": round(100.0 * enviados / max(1, total_bytes), 1),
                "segundos_enviados": round(enviados / BYTES_POR_SEG, 1)
            })
            yield datos


def main():
    if len(sys.argv) < 3:
        print("Uso: python transcribe_nvidia.py <entrada> <json_salida>")
        sys.exit(1)

    input_path = sys.argv[1]
    out_json = sys.argv[2]
    progress_path = out_json + ".progress.json"

    key = os.environ.get("CLIPFORGE_NVIDIA_KEY", "").strip()
    if not key:
        salir_con_error(
            "No hay ninguna API key de NVIDIA guardada. Pegala en el panel "
            "API Keys de ClipForge (empieza con nvapi-) y volve a intentar."
        )

    servidor = os.environ.get("CLIPFORGE_NVIDIA_SERVER", "").strip() or "grpc.nvcf.nvidia.com:443"
    function_id = os.environ.get("CLIPFORGE_NVCF_FUNCTION_ID", "").strip() or FUNCTION_ID_PARAKEET_MULTI
    modelo = os.environ.get("CLIPFORGE_NVIDIA_MODELO", "").strip()
    idioma = os.environ.get("CLIPFORGE_NVIDIA_LANG", "").strip() or "es-US"
    ffmpeg = os.environ.get("CLIPFORGE_FFMPEG", "").strip() or "ffmpeg"

    palabras = [p.strip() for p in os.environ.get("CLIPFORGE_PALABRAS_CLAVE", "").split(",") if p.strip()]
    try:
        boost = float(os.environ.get("CLIPFORGE_BOOST_SCORE", "4.0"))
    except ValueError:
        boost = 4.0

    try:
        import riva.client as rc
    except ImportError:
        salir_con_error(
            "Falta el cliente de NVIDIA Riva en el Python de ClipForge. "
            "Instalalo con:  pip install nvidia-riva-client"
        )

    t0 = time.time()
    write_progress(progress_path, "preparando audio (ffmpeg)")

    tmp_dir = tempfile.mkdtemp(prefix="clipforge-nvidia-")
    raw = os.path.join(tmp_dir, "audio.raw")
    try:
        a_pcm16k(input_path, raw, ffmpeg)
        total_bytes = os.path.getsize(raw)
        duracion = total_bytes / BYTES_POR_SEG

        write_progress(progress_path, "conectando con NVIDIA", {"duracion": round(duracion, 1)})

        # La key va en metadata gRPC, que viaja cifrado por TLS (use_ssl).
        metadata = [["authorization", f"Bearer {key}"]]
        if function_id:
            metadata.append(["function-id", function_id])

        auth = rc.Auth(uri=servidor, use_ssl=True, metadata_args=metadata)
        service = rc.ASRService(auth)

        config = rc.RecognitionConfig(
            encoding=rc.AudioEncoding.LINEAR_PCM,
            sample_rate_hertz=FRECUENCIA,
            audio_channel_count=1,
            language_code=idioma,
            max_alternatives=1,
            enable_automatic_punctuation=True,
            enable_word_time_offsets=True,   # sin esto no hay subtitulos por palabra
            verbatim_transcripts=False,
        )
        if modelo:
            config.model = modelo

        streaming_config = rc.StreamingRecognitionConfig(config=config, interim_results=False)
        if palabras:
            rc.add_word_boosting_to_config(streaming_config, palabras, boost)

        segments = []
        try:
            respuestas = service.streaming_response_generator(
                audio_chunks=trozos(raw, progress_path, total_bytes),
                streaming_config=streaming_config
            )
            for resp in respuestas:
                for res in resp.results:
                    if not res.is_final or not res.alternatives:
                        continue
                    alt = res.alternatives[0]
                    texto = (alt.transcript or "").strip()
                    if not texto:
                        continue
                    # Riva entrega los tiempos en MILISEGUNDOS; el resto de
                    # ClipForge (bloques, SRT, linea de tiempo) trabaja en
                    # segundos, igual que WhisperX.
                    words = [{
                        "word": w.word,
                        "start": w.start_time / 1000.0,
                        "end": w.end_time / 1000.0,
                        "score": getattr(w, "confidence", 0.0)
                    } for w in alt.words]
                    if words:
                        ini, fin = words[0]["start"], words[-1]["end"]
                    else:
                        # Sin timestamps no se puede ubicar el texto en la
                        # linea de tiempo: se descarta en vez de inventar
                        # tiempos que despues cortarian el video mal.
                        continue
                    segments.append({"start": ini, "end": fin, "text": texto, "words": words})
        except Exception as e:
            detalle = str(e)
            pista = ""
            # PERMISSION_DENIED es el que devuelve NVCF con una key invalida
            # o vencida (no UNAUTHENTICATED, que seria lo esperable),
            # verificado contra el servidor real el 08/08/2026.
            if any(s in detalle for s in ("PERMISSION_DENIED", "UNAUTHENTICATED", "Authorization failed", "401")):
                pista = ("\nLa key de NVIDIA fue rechazada. Revisa que este bien copiada "
                         "(empieza con nvapi-), que no este vencida, y que la cuenta tenga "
                         "creditos disponibles en build.nvidia.com.")
            elif "function-id" in detalle or "NOT_FOUND" in detalle:
                pista = ("\nEl endpoint no reconocio la funcion. Copia el 'function-id' del "
                         "ejemplo de codigo en build.nvidia.com y pegalo en Ajustes.")
            elif "RESOURCE_EXHAUSTED" in detalle or "429" in detalle:
                pista = "\nSe agoto la cuota de la key (creditos de NVIDIA)."
            # Este es el que aparecio al probar por primera vez con una key
            # real (09/08/2026) y no lo decia ningun mensaje: el modelo esta
            # publicado pero NVIDIA no tiene una instancia atendiendolo. No
            # hay nada que arreglar del lado de ClipForge, y sobre todo NO es
            # la key —conviene decirlo, porque el reflejo es ir a revisarla—.
            elif "failed to establish link to worker" in detalle:
                pista = ("\nEl modelo esta publicado pero NVIDIA no tiene ninguna instancia "
                         "atendiendolo ahora mismo. NO es un problema de tu key ni de "
                         "ClipForge. Probá de nuevo mas tarde, o elegí otro modelo poniendo "
                         "su 'function-id' en Ajustes.")
            salir_con_error(f"Fallo la transcripcion en la nube: {detalle}{pista}")

        if not segments:
            salir_con_error(
                "NVIDIA no devolvio texto. Suele pasar si el audio esta en silencio "
                "o si el idioma configurado no coincide con el hablado."
            )

        resultado = {"segments": segments, "language": idioma.split("-")[0], "motor": "nvidia"}
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=2)

        total_sec = round(time.time() - t0, 1)
        write_progress(progress_path, "listo", {"total_sec": total_sec, "segmentos": len(segments)})
        print(json.dumps({
            "ok": True,
            "total_sec": total_sec,
            "segmentos": len(segments),
            "duracion_audio": round(duracion, 1),
            "palabras_reforzadas": len(palabras),
            # La diarizacion NO la hace este motor: parakeet-ctc devuelve
            # texto y tiempos, no quien habla. Eso sigue siendo pyannote
            # local (motor WhisperX).
            "diarizacion": "no disponible en la nube"
        }))
    finally:
        try:
            if os.path.exists(raw):
                os.remove(raw)
            os.rmdir(tmp_dir)
        except OSError:
            pass  # dejar un temp huerfano no justifica perder la transcripcion


if __name__ == "__main__":
    main()
