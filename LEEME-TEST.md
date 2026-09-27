# Clipforge3-test

Copia de prueba de `D:\Clipforge2`, hecha el 13/09/2026, para aplicar los cambios
de la investigación de la línea de tiempo sin tocar el original.

- **El original queda como respaldo:** `D:\Clipforge2`, sin cambios.
- **La investigación:** `D:\investigacion-clipforge\linea-de-tiempo\INFORME.md`
  (hay copia en `E:\investigacion-clipforge-linea-de-tiempo`).
- **Diferencias con el original:** en `package.json`, `name` es `clipforge3-test`.
  Así Electron usa otra carpeta de datos (`%APPDATA%\clipforge3-test`) y no
  comparte el almacenamiento con el original. Además, `graphify-out\.graphify_root`
  apunta acá.
- **Lo que se comparte con el original:** los archivos que la app escribe al lado
  de los videos (`.cortes.json`, `.srt`, textos) y las cachés de modelos
  (`D:\hf-cache`, `D:\torch-cache`, `D:\nltk-data`).

En el momento de la copia, los tests daban 264 pasados y 0 fallidos (`npm test`).
