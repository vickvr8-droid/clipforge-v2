package com.vick.earpiececleaner

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

enum class Route { EARPIECE, SPEAKER }

/**
 * Genera los tonos de limpieza y los fuerza a salir por el altavoz del
 * auricular (el de arriba, el que suena cuando te pegas el celular a la oreja)
 * o por el altavoz principal.
 *
 * El truco para el auricular es poner el sistema en modo llamada
 * (MODE_IN_COMMUNICATION) y reproducir con USAGE_VOICE_COMMUNICATION, que es
 * el camino de audio de las llamadas sin altavoz.
 */
class ToneEngine(context: Context) {

    companion object {
        private const val TAG = "ToneEngine"
        private const val SAMPLE_RATE = 44100
        private const val FADE_SECONDS = 0.06
        private const val CHUNK_FRAMES = 1024
    }

    private val appContext = context.applicationContext
    private val audioManager =
        appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val main = Handler(Looper.getMainLooper())

    private var thread: Thread? = null
    @Volatile private var stopRequested = false
    @Volatile private var running = false

    private var focusRequest: AudioFocusRequest? = null
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var previousVolume: Int = -1

    val isRunning: Boolean get() = running

    /** True si hay una llamada de verdad en curso: no debemos interferir. */
    fun isPhoneCallActive(): Boolean {
        val mode = audioManager.mode
        return mode == AudioManager.MODE_IN_CALL ||
            mode == AudioManager.MODE_IN_COMMUNICATION && !running
    }

    /**
     * @param volumePercent 0..100, aplicado sobre el volumen de llamada.
     * @param onProgress recibe (segundos transcurridos, segundos totales).
     */
    fun start(
        program: CleanProgram,
        route: Route,
        volumePercent: Int,
        onProgress: (Double, Double) -> Unit,
        onFinished: (completed: Boolean) -> Unit
    ) {
        if (running) return
        stopRequested = false
        running = true

        val segments = expand(program)
        val totalFrames = segments.sumOf { it.frames.toLong() }

        thread = Thread {
            var completed = false
            try {
                acquireAudio(route, volumePercent)
                completed = render(segments, totalFrames, onProgress)
            } catch (t: Throwable) {
                Log.e(TAG, "Fallo reproduciendo el tono", t)
            } finally {
                releaseAudio()
                running = false
                val done = completed
                main.post { onFinished(done) }
            }
        }.also { it.start() }
    }

    fun stop() {
        stopRequested = true
    }

    // ---------------------------------------------------------------- audio

    private fun acquireAudio(route: Route, volumePercent: Int) {
        previousMode = audioManager.mode

        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest
                .Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(attrs)
                .build()
            audioManager.requestAudioFocus(request)
            focusRequest = request
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
            )
        }

        // Modo llamada: es lo que habilita la ruta del auricular.
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val wanted = if (route == Route.EARPIECE) {
                AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            } else {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            }
            audioManager.availableCommunicationDevices
                .firstOrNull { it.type == wanted }
                ?.let { audioManager.setCommunicationDevice(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = route == Route.SPEAKER
        }

        // Subimos el volumen de llamada al nivel pedido y lo devolvemos luego.
        try {
            val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            previousVolume = audioManager.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
            val target = (max * volumePercent / 100.0).roundToInt().coerceIn(1, max)
            audioManager.setStreamVolume(AudioManager.STREAM_VOICE_CALL, target, 0)
        } catch (e: SecurityException) {
            Log.w(TAG, "No se pudo ajustar el volumen de llamada", e)
            previousVolume = -1
        }
    }

    private fun releaseAudio() {
        if (previousVolume >= 0) {
            try {
                audioManager.setStreamVolume(
                    AudioManager.STREAM_VOICE_CALL, previousVolume, 0
                )
            } catch (e: SecurityException) {
                Log.w(TAG, "No se pudo restaurar el volumen", e)
            }
            previousVolume = -1
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }

        audioManager.mode = previousMode

        focusRequest?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioManager.abandonAudioFocusRequest(it)
            }
        }
        focusRequest = null
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
    }

    // --------------------------------------------------------------- render

    private class Segment(
        val startHz: Double,
        val endHz: Double,
        val frames: Int,
        val pulseHz: Double
    )

    private fun expand(program: CleanProgram): List<Segment> {
        val out = ArrayList<Segment>()
        for (phase in program.phases) {
            val frames = (phase.seconds * SAMPLE_RATE).toInt()
            repeat(phase.repeat) {
                out.add(Segment(phase.startHz, phase.endHz, frames, phase.pulseHz))
            }
        }
        return out
    }

    /** @return true si el programa terminó completo, false si se detuvo antes. */
    private fun render(
        segments: List<Segment>,
        totalFrames: Long,
        onProgress: (Double, Double) -> Unit
    ): Boolean {
        val minBuffer = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(CHUNK_FRAMES * 2 * 4)

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(minBuffer)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        val fadeFrames = (FADE_SECONDS * SAMPLE_RATE).toLong()
        val totalSeconds = totalFrames.toDouble() / SAMPLE_RATE
        val buffer = ShortArray(CHUNK_FRAMES)

        var phaseAcc = 0.0          // fase de la sinusoide, continua entre fases
        var globalFrame = 0L
        var lastReported = -1L
        var completed = true

        track.play()
        try {
            outer@ for (segment in segments) {
                var frame = 0
                while (frame < segment.frames) {
                    if (stopRequested) {
                        completed = false
                        break@outer
                    }
                    val n = min(CHUNK_FRAMES, segment.frames - frame)
                    for (i in 0 until n) {
                        val pos = (frame + i).toDouble()
                        val progress = pos / segment.frames
                        val hz = segment.startHz +
                            (segment.endHz - segment.startHz) * progress
                        phaseAcc += 2.0 * PI * hz / SAMPLE_RATE

                        var amp = 1.0
                        if (segment.pulseHz > 0.0) {
                            val tSec = pos / SAMPLE_RATE
                            // 0..1 suave, sin clics al abrir y cerrar el pulso
                            amp = 0.5 * (1.0 - cos(2.0 * PI * segment.pulseHz * tSec))
                        }

                        val g = globalFrame + i
                        val fadeIn = if (g < fadeFrames) g.toDouble() / fadeFrames else 1.0
                        val remaining = totalFrames - g
                        val fadeOut =
                            if (remaining < fadeFrames) remaining.toDouble() / fadeFrames
                            else 1.0

                        val value = sin(phaseAcc) * amp * fadeIn * fadeOut * 0.92
                        buffer[i] = (value * Short.MAX_VALUE).toInt()
                            .coerceIn(-32768, 32767).toShort()
                    }

                    track.write(buffer, 0, n)
                    frame += n
                    globalFrame += n

                    val elapsedSec = globalFrame / SAMPLE_RATE
                    if (elapsedSec != lastReported) {
                        lastReported = elapsedSec
                        val done = globalFrame.toDouble() / SAMPLE_RATE
                        main.post { onProgress(done, totalSeconds) }
                    }
                }
            }

            if (!completed) {
                writeFadeOut(track, buffer, phaseAcc)
            }
        } finally {
            try {
                track.stop()
            } catch (e: IllegalStateException) {
                Log.w(TAG, "AudioTrack ya estaba detenido", e)
            }
            track.release()
        }
        return completed
    }

    /** Rampa corta al cortar a mano, para que no suene un chasquido. */
    private fun writeFadeOut(track: AudioTrack, buffer: ShortArray, startPhase: Double) {
        val frames = (0.04 * SAMPLE_RATE).toInt()
        var phaseAcc = startPhase
        var written = 0
        while (written < frames) {
            val n = min(CHUNK_FRAMES, frames - written)
            for (i in 0 until n) {
                phaseAcc += 2.0 * PI * 165.0 / SAMPLE_RATE
                val gain = 1.0 - (written + i).toDouble() / frames
                buffer[i] = (sin(phaseAcc) * gain * 0.92 * Short.MAX_VALUE)
                    .toInt().coerceIn(-32768, 32767).toShort()
            }
            track.write(buffer, 0, n)
            written += n
        }
    }
}
