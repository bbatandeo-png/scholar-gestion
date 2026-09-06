# Sauvegarde locale de la base de donnees Scolar-Gestion (mongodump).
# A executer regulierement (ex: tache planifiee quotidienne) sur le poste
# de l'ecole. Les sauvegardes s'accumulent dans un sous-dossier "backups"
# a cote de ce script - copiez-les periodiquement sur une cle USB externe.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File sauvegarder-donnees.ps1

$ErrorActionPreference = 'Stop'

function Find-Mongodump {
    $fromPath = Get-Command mongodump.exe -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    $candidates = Get-ChildItem -Path 'C:\Program Files\MongoDB' -Filter 'mongodump.exe' -Recurse -ErrorAction SilentlyContinue
    if ($candidates) { return ($candidates | Select-Object -First 1).FullName }

    return $null
}

$mongodump = Find-Mongodump
if (-not $mongodump) {
    Write-Host 'ERREUR : mongodump introuvable.' -ForegroundColor Red
    Write-Host 'Il fait partie de MongoDB Database Tools - a telecharger separement depuis'
    Write-Host 'mongodb.com/try/download/database-tools si absent.'
    exit 1
}

$backupRoot = Join-Path $PSScriptRoot 'backups'
$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$destination = Join-Path $backupRoot $timestamp

Write-Host "Sauvegarde en cours vers : $destination"
& $mongodump --uri "mongodb://127.0.0.1:27017/scolar-gestion?replicaSet=rs0" --out $destination

if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host "Sauvegarde terminee avec succes : $destination" -ForegroundColor Green
    Write-Host 'Pensez a copier ce dossier sur une cle USB ou un support externe.'
} else {
    Write-Host 'ECHEC de la sauvegarde.' -ForegroundColor Red
    exit 1
}
