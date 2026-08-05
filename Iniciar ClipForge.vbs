' Lanzador silencioso de ClipForge (sin ventana de consola visible).
' Creado 04/08/2026 a pedido del user, para que pueda abrir la app
' el mismo sin depender de Claude corriendo "npm start" via MCP.
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\ClipForge"
WshShell.Run "cmd /c npm start", 0, False
