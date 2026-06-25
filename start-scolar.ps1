$ErrorActionPreference = 'Stop'

Set-Location -Path $PSScriptRoot

function Ensure-DockerAvailable {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker n'est pas installe ou non disponible dans le PATH. Installe Docker Desktop."
    }
}

function Wait-AppReady {
    param(
        [string]$Url = 'http://localhost:3000',
        [int]$TimeoutSeconds = 90
    )

    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    return $false
}

try {
    Ensure-DockerAvailable

    Write-Host "[Scolar-Gestion] Demarrage des conteneurs..."
    docker compose up -d --build | Out-Host

    Write-Host "[Scolar-Gestion] Verification de disponibilite de l'application..."
    $ready = Wait-AppReady

    if (-not $ready) {
        Write-Warning "Application non joignable apres delai d'attente. Verifie: docker compose logs -f app"
    }

    Start-Process "http://localhost:3000"
    Write-Host "[Scolar-Gestion] Application ouverte dans le navigateur."
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
