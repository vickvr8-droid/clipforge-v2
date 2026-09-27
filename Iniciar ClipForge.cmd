@echo off
rem ============================================================
rem  Lanzador de ClipForge
rem ============================================================
rem  Reemplaza al lanzador .vbs anterior. El .vbs arrancaba bien
rem  desde una terminal pero no al doble clic, y eso NO se puede
rem  arreglar desde el script: depende de que Windows Script Host
rem  este habilitado, de que .vbs siga asociado a WScript.exe y de
rem  que el antivirus no lo trate como sospechoso (un .vbs suelto
rem  es un patron clasico de malware, asi que muchos los bloquean
rem  en silencio: no aparece ningun error, simplemente no pasa
rem  nada, que es exactamente lo que se vio).
rem
rem  Un .cmd no depende de nada de eso: lo ejecuta el propio
rem  interprete de comandos de Windows, que siempre esta. Ademas,
rem  si algo falla se puede LEER el error en vez de quedarse sin
rem  saber por que no abrio.
rem ============================================================

rem %~dp0 es la carpeta de este archivo, con la barra final. Se usa
rem en vez de una ruta fija para que el lanzador siga sirviendo si
rem el proyecto se mueve o se copia a otro disco.
cd /d "%~dp0"

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" goto faltan

rem start "" ... suelta el proceso y devuelve el control enseguida:
rem la ventana negra aparece un instante y se cierra sola, en vez de
rem quedarse abierta todo el tiempo que dure la app.
start "" "%ELECTRON%" "%~dp0."
exit /b 0

:faltan
echo.
echo   No estan instaladas las dependencias de ClipForge.
echo   (falta node_modules\electron)
echo.
echo   Se van a instalar ahora. Tarda varios minutos la primera
echo   vez porque descarga Electron, que pesa bastante.
echo.
pause
call npm install
if not exist "%ELECTRON%" goto error
echo.
echo   Listo. Abriendo ClipForge...
start "" "%ELECTRON%" "%~dp0."
exit /b 0

:error
echo.
echo   La instalacion no termino bien.
echo   Revisa los mensajes de arriba: ahi dice que fallo.
echo.
pause
exit /b 1
