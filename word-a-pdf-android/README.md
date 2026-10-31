# Word a PDF (Android)

App Android que convierte un documento Word (`.docx`) a PDF, en el propio teléfono y sin internet.

El PDF se genera **sin contraseña ni restricciones de permisos**: se puede editar, anotar,
copiar texto e imprimir con cualquier editor de PDF. El texto es real (no una imagen).

## Uso
1. "Elegir archivo Word" → selecciona el `.docx`.
2. Elige dónde guardar el PDF.
3. "Abrir / editar PDF" o "Compartir PDF".

También aparece en "Abrir con" / "Compartir" al tocar un `.docx` en otras apps.

## Qué conserva
Estilos y títulos, negrita/cursiva/subrayado/tachado, tamaños, colores, resaltado,
alineación (incl. justificado), sangrías, interlineado, listas numeradas y viñetas,
tablas, imágenes (PNG/JPG), saltos de página y tamaño/márgenes de página.

No soporta: `.doc` antiguo, encabezados/pies de página, cuadros de texto, imágenes EMF/WMF.

## Compilar
Requiere Android SDK (o Android Studio).
```
./gradlew assembleDebug      # APK en app/build/outputs/apk/debug/
./gradlew testDebugUnitTest  # pruebas del lector .docx
```
