# Baja el modelo de diarizacion de pyannote a D:\hf-cache.
#
# POR QUE EXISTE ESTE SCRIPT:
# El repo es "gated": hace falta un token de HuggingFace. Pero el prompt
# de `hf auth login` es de entrada oculta y en varias terminales de
# Windows el clic derecho no pega ahi. Asi que el token se pide en una
# ventana de Windows, donde pegar anda como en cualquier lado.
#
# Y ademas es lo mas seguro de las tres opciones:
#   - NO queda en el historial de PowerShell (no se escribe en la linea)
#   - NO queda en un archivo de texto que despues haya que acordarse de borrar
#   - Vive solo en esta ventana; al cerrarla se va
#
# Uso:  powershell -ExecutionPolicy Bypass -File D:\Clipforge2\bajar-pyannote.ps1

$ErrorActionPreference = 'Stop'

$hf      = 'C:\Users\vicente\remotion-projects\whisperx-tool\.venv\Scripts\hf.exe'
$destino = 'D:\hf-cache\pyannote-community-1'
$repo    = 'pyannote/speaker-diarization-community-1'

if (-not (Test-Path $hf)) { throw "No encuentro hf.exe en: $hf" }

Add-Type -AssemblyName Microsoft.VisualBasic
$token = [Microsoft.VisualBasic.Interaction]::InputBox(
  "Pega tu token de HuggingFace (Ctrl+V funciona aca).`n`nTiene que empezar con hf_",
  'ClipForge - descargar pyannote', '')

if ([string]::IsNullOrWhiteSpace($token)) { Write-Host 'Cancelado.'; exit 1 }
$token = $token.Trim()
if (-not $token.StartsWith('hf_')) { throw 'Ese no parece un token de HuggingFace (deberia empezar con hf_).' }

# huggingface_hub lee HF_TOKEN directo, asi que no hace falta `auth login`.
$env:HF_TOKEN = $token

Write-Host ''
Write-Host "Bajando $repo" -ForegroundColor Cyan
Write-Host "  hacia $destino"
Write-Host ''

& $hf download $repo --local-dir $destino

# El token se borra de la sesion apenas termina: no tiene por que seguir
# vivo en el entorno mientras la ventana quede abierta.
$env:HF_TOKEN = $null

if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'FALLO la descarga.' -ForegroundColor Red
  Write-Host '  401 = el token no sirve o esta revocado.'
  Write-Host '  403 = el token esta bien, pero falta ACEPTAR LAS CONDICIONES del modelo:'
  Write-Host "        https://huggingface.co/$repo"
  exit 1
}

# Comprobacion real: que los PESOS esten, no solo la estructura de
# carpetas. La descarga anterior habia dejado los directorios creados y
# vacios, y a simple vista parecia que habia funcionado.
$pesos = Get-ChildItem $destino -Recurse -File |
         Where-Object { $_.Name -like '*.bin' -or $_.Name -like '*.npz' }
$total = ($pesos | Measure-Object -Property Length -Sum).Sum

Write-Host ''
if ($pesos.Count -ge 3 -and $total -gt 10MB) {
  Write-Host ("LISTO - {0} archivos de pesos, {1:N1} MB" -f $pesos.Count, ($total / 1MB)) -ForegroundColor Green
  Write-Host ''
  Write-Host 'Ahora REVOCA el token en https://hf.co/settings/tokens' -ForegroundColor Yellow
  Write-Host 'ClipForge no lo necesita mas: lee el modelo del disco.'
} else {
  Write-Host 'INCOMPLETO: bajaron las carpetas pero no los pesos.' -ForegroundColor Red
  Write-Host 'Suele ser falta de aceptar las condiciones del modelo.'
  exit 1
}
