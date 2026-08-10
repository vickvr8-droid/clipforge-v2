package com.vick.earpiececleaner

import android.os.Bundle
import android.view.WindowManager
import android.widget.RadioButton
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.vick.earpiececleaner.databinding.ActivityMainBinding
import kotlin.math.ceil
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var engine: ToneEngine

    private var selected: CleanProgram = CleanProgram.QUICK

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        engine = ToneEngine(this)

        buildProgramList()
        restorePreferences()

        binding.volumeSlider.addOnChangeListener { _, value, _ ->
            binding.volumeValue.text = getString(R.string.volume_value, value.roundToInt())
        }

        binding.actionButton.setOnClickListener {
            if (engine.isRunning) stopCleaning() else startCleaning()
        }

        binding.helpButton.setOnClickListener { showHelp() }

        resetIdleUi()
    }

    override fun onStop() {
        super.onStop()
        // Salir de la app corta el tono: nada de audio sonando de fondo.
        if (engine.isRunning) stopCleaning()
    }

    // ------------------------------------------------------------------ ui

    private fun buildProgramList() {
        CleanProgram.entries.forEach { program ->
            val button = RadioButton(this).apply {
                id = program.ordinal + 1000
                text = getString(
                    R.string.program_row,
                    program.label,
                    formatDuration(program.totalSeconds),
                    program.description
                )
                setPadding(paddingLeft + 24, 28, 24, 28)
            }
            binding.programGroup.addView(button)
        }
        binding.programGroup.setOnCheckedChangeListener { _, checkedId ->
            selected = CleanProgram.entries[checkedId - 1000]
            savePreferences()
            if (!engine.isRunning) resetIdleUi()
        }
    }

    private fun restorePreferences() {
        val prefs = getSharedPreferences("settings", MODE_PRIVATE)
        val programName = prefs.getString("program", CleanProgram.QUICK.name)!!
        selected = runCatching { CleanProgram.valueOf(programName) }
            .getOrDefault(CleanProgram.QUICK)
        binding.programGroup.check(selected.ordinal + 1000)

        val volume = prefs.getInt("volume", 85).toFloat()
        binding.volumeSlider.value = volume
        binding.volumeValue.text = getString(R.string.volume_value, volume.roundToInt())

        val speaker = prefs.getBoolean("speaker", false)
        binding.routeGroup.check(if (speaker) R.id.routeSpeaker else R.id.routeEarpiece)
    }

    private fun savePreferences() {
        getSharedPreferences("settings", MODE_PRIVATE).edit {
            putString("program", selected.name)
            putInt("volume", binding.volumeSlider.value.roundToInt())
            putBoolean("speaker", binding.routeGroup.checkedButtonId == R.id.routeSpeaker)
        }
    }

    private fun resetIdleUi() {
        binding.actionButton.text = getString(R.string.start)
        binding.progress.progress = 0
        binding.statusText.text = getString(
            R.string.idle_status,
            selected.label,
            formatDuration(selected.totalSeconds)
        )
        setControlsEnabled(true)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun setControlsEnabled(enabled: Boolean) {
        binding.volumeSlider.isEnabled = enabled
        binding.routeEarpiece.isEnabled = enabled
        binding.routeSpeaker.isEnabled = enabled
        for (i in 0 until binding.programGroup.childCount) {
            binding.programGroup.getChildAt(i).isEnabled = enabled
        }
    }

    // ------------------------------------------------------------- acciones

    private fun startCleaning() {
        if (engine.isPhoneCallActive()) {
            Snackbar.make(binding.root, R.string.call_in_progress, Snackbar.LENGTH_LONG).show()
            return
        }

        savePreferences()

        val route = if (binding.routeGroup.checkedButtonId == R.id.routeSpeaker) {
            Route.SPEAKER
        } else {
            Route.EARPIECE
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding.actionButton.text = getString(R.string.stop)
        setControlsEnabled(false)
        binding.progress.progress = 0

        engine.start(
            program = selected,
            route = route,
            volumePercent = binding.volumeSlider.value.roundToInt(),
            onProgress = { elapsed, total ->
                val remaining = ceil(total - elapsed).toInt().coerceAtLeast(0)
                binding.progress.progress = ((elapsed / total) * 100).roundToInt()
                binding.statusText.text = getString(
                    R.string.running_status,
                    if (route == Route.EARPIECE) {
                        getString(R.string.route_earpiece)
                    } else {
                        getString(R.string.route_speaker)
                    },
                    formatDuration(remaining.toDouble())
                )
            },
            onFinished = { completed ->
                resetIdleUi()
                val message = if (completed) R.string.finished else R.string.stopped
                Snackbar.make(binding.root, message, Snackbar.LENGTH_LONG).show()
            }
        )
    }

    private fun stopCleaning() {
        engine.stop()
    }

    private fun showHelp() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.help_title)
            .setMessage(R.string.help_body)
            .setPositiveButton(R.string.ok, null)
            .show()
    }

    private fun formatDuration(seconds: Double): String {
        val total = seconds.roundToInt()
        return if (total < 60) {
            getString(R.string.seconds_short, total)
        } else {
            val minutes = total / 60
            val rest = total % 60
            if (rest == 0) {
                getString(R.string.minutes_short, minutes)
            } else {
                getString(R.string.minutes_seconds_short, minutes, rest)
            }
        }
    }
}
