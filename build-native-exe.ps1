$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js / npm n'est pas installe sur cette machine de build."
}

Write-Host "Installation des dependances..."
npm install | Out-Host

Write-Host "Build EXE native en cours..."
npm run build:exe:native | Out-Host

Write-Host "EXE genere dans: $PSScriptRoot\release\Scolar-Gestion.exe"
Write-Host "IMPORTANT: definir MONGODB_URI vers une base distante sur la machine utilisateur."
