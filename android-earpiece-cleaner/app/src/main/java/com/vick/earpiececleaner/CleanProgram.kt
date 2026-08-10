package com.vick.earpiececleaner

/**
 * Un programa de limpieza es una lista de fases. Cada fase describe qué señal
 * generar y durante cuánto tiempo.
 */
data class Phase(
    /** Frecuencia inicial en Hz. */
    val startHz: Double,
    /** Frecuencia final en Hz (igual a [startHz] para un tono fijo). */
    val endHz: Double,
    /** Duración de la fase en segundos. */
    val seconds: Double,
    /**
     * Si es > 0, la amplitud se modula (pulsos) a esta frecuencia en Hz.
     * Los pulsos ayudan a despegar polvo y a mover el agua atrapada.
     */
    val pulseHz: Double = 0.0,
    /** Cuántas veces se repite la fase de forma consecutiva. */
    val repeat: Int = 1
) {
    val totalSeconds: Double get() = seconds * repeat
}

enum class CleanProgram(
    val label: String,
    val description: String,
    val phases: List<Phase>
) {
    QUICK(
        label = "Limpieza rápida",
        description = "Barridos graves de 30 s para el uso diario",
        phases = listOf(
            Phase(startHz = 400.0, endHz = 60.0, seconds = 3.0, repeat = 6),
            Phase(startHz = 165.0, endHz = 165.0, seconds = 12.0, pulseHz = 8.0)
        )
    ),

    DEEP(
        label = "Limpieza profunda",
        description = "60 s combinando barridos, pulsos y tono de expulsión",
        phases = listOf(
            Phase(startHz = 600.0, endHz = 120.0, seconds = 4.0, repeat = 4),
            Phase(startHz = 165.0, endHz = 165.0, seconds = 14.0, pulseHz = 10.0),
            Phase(startHz = 300.0, endHz = 40.0, seconds = 3.0, repeat = 6),
            Phase(startHz = 80.0, endHz = 80.0, seconds = 12.0, pulseHz = 4.0)
        )
    ),

    WATER(
        label = "Expulsar agua",
        description = "Tono fijo de 165 Hz durante 30 s",
        phases = listOf(
            Phase(startHz = 165.0, endHz = 165.0, seconds = 30.0)
        )
    ),

    DUST(
        label = "Sacudir polvo",
        description = "Pulsos cortos de 20 s contra el polvo y la pelusa",
        phases = listOf(
            Phase(startHz = 220.0, endHz = 220.0, seconds = 10.0, pulseHz = 18.0),
            Phase(startHz = 500.0, endHz = 90.0, seconds = 2.0, repeat = 5)
        )
    );

    val totalSeconds: Double get() = phases.sumOf { it.totalSeconds }
}
