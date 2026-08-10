# Limpia Auricular

App Android que expulsa agua y polvo del **altavoz del auricular** — el de
arriba, el que suena cuando te pegas el celular a la oreja en una llamada sin
altavoz. Reproduce tonos graves y pulsos que hacen vibrar la membrana y empujan
el agua hacia afuera.

## Por qué es una app nativa y no una web

Una página web no puede elegir por dónde sale el audio en Android: siempre va al
altavoz principal (o a los audífonos). Forzar el auricular requiere poner el
sistema en modo llamada desde código nativo:

- `AudioManager.mode = MODE_IN_COMMUNICATION` — habilita la ruta de voz.
- `setCommunicationDevice(TYPE_BUILTIN_EARPIECE)` en Android 12+, o
  `isSpeakerphoneOn = false` en versiones anteriores.
- `AudioTrack` con `USAGE_VOICE_COMMUNICATION`, que es el camino de audio de las
  llamadas.

Al terminar (o al salir de la app) se restauran el modo, la ruta y el volumen
previos.

## Programas

| Programa | Duración | Qué hace |
| --- | --- | --- |
| Limpieza rápida | 30 s | Barridos de 400 Hz a 60 Hz + tono pulsado de 165 Hz |
| Limpieza profunda | 60 s | Barridos, pulsos y tono grave sostenido |
| Expulsar agua | 30 s | 165 Hz fijo, el tono clásico de expulsión de agua |
| Sacudir polvo | 20 s | Pulsos cortos a 220 Hz + barridos rápidos |

El volumen es ajustable (20–100 % del volumen de llamada) y se guarda junto con
el programa y la ruta elegidos.

## Compilar

Requiere JDK 17 y el SDK de Android (plataforma 34, build-tools 34.0.0).

```bash
cd android-earpiece-cleaner
echo "sdk.dir=/ruta/a/android-sdk" > local.properties
./gradlew assembleRelease
```

El APK queda en `app/build/outputs/apk/release/app-release.apk`. Va firmado con
la clave de debug para poder instalarlo directamente desde el celular.

También se compila en CI: el workflow `.github/workflows/android-earpiece-cleaner.yml`
sube el APK como artefacto en cada push que toque esta carpeta.

## Uso

1. Quita la funda y desconecta los audífonos.
2. Elige **Auricular** y un programa.
3. Sostén el celular vertical, inclinado hacia abajo, sin tapar la rejilla.
4. Empieza y deja que termine. No te lo pongas en la oreja mientras suena.

Si el celular se mojó de verdad, déjalo secar varias horas antes de cargarlo.
Esta app mueve el agua con sonido, no reemplaza el secado.
