$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "Installation du module ps2exe..."
    Install-Module -Name ps2exe -Scope CurrentUser -Force
}

Import-Module ps2exe

Write-Host "Generation de l'executable..."
Invoke-ps2exe `
    -inputFile "$PSScriptRoot\start-scolar.ps1" `
    -outputFile "$PSScriptRoot\Scolar-Gestion-Launcher.exe" `
    -title "Scolar-Gestion Launcher" `
    -description "Demarre Scolar-Gestion via Docker et ouvre l'application" `
    -company "Scolar-Gestion" `
    -product "Scolar-Gestion" `
    -version "1.0.0.0"

Write-Host "Executable genere: $PSScriptRoot\Scolar-Gestion-Launcher.exe"
