$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker n'est pas installe ou non disponible dans le PATH."
    exit 1
}

Write-Host "[Scolar-Gestion] Arret des conteneurs..."
docker compose down | Out-Host
Write-Host "[Scolar-Gestion] Arret termine."
