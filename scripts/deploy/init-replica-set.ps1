# Initialise MongoDB en replica set mono-noeud (rs0), requis par l'application
# pour les operations transactionnelles (cloture/ouverture d'annee scolaire,
# facturation, etc.). Idempotent - ne fait rien si c'est deja en place.
#
# Depuis l'ajout de replica-set-setup.util.ts, l'exe lance CE SCRIPT tout
# seul (eleve via une invite UAC) la premiere fois qu'il detecte que le
# replica set n'est pas pret - le client n'a plus jamais besoin de l'ouvrir
# lui-meme. Il reste utilisable manuellement pour du depannage sur site :
#
#   powershell -ExecutionPolicy Bypass -File init-replica-set.ps1

$ErrorActionPreference = 'Stop'

function Find-Mongosh {
    $fromPath = Get-Command mongosh.exe -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    $candidates = Get-ChildItem -Path 'C:\Program Files\MongoDB' -Filter 'mongosh.exe' -Recurse -ErrorAction SilentlyContinue
    if ($candidates) { return ($candidates | Select-Object -First 1).FullName }

    return $null
}

Write-Host 'Recherche de mongosh...'
$mongosh = Find-Mongosh
if (-not $mongosh) {
    Write-Host ''
    Write-Host 'ERREUR : mongosh introuvable.' -ForegroundColor Red
    Write-Host 'mongosh est un outil separe du serveur MongoDB depuis la version 5 -'
    Write-Host 'verifiez qu''il a ete installe (case a cocher lors de l''installation'
    Write-Host 'de MongoDB Community Server, ou telechargement separe depuis'
    Write-Host 'mongodb.com/try/download/shell).'
    exit 1
}
Write-Host "mongosh trouve : $mongosh"

Write-Host ''
Write-Host 'Verification du service MongoDB...'
$service = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host 'ERREUR : le service Windows "MongoDB" est introuvable.' -ForegroundColor Red
    Write-Host 'Verifiez que MongoDB Community Server a ete installe avec l''option'
    Write-Host '"Install MongoDB as a Service" cochee.'
    exit 1
}
if ($service.Status -ne 'Running') {
    Write-Host 'Demarrage du service MongoDB...'
    Start-Service -Name 'MongoDB'
    Start-Sleep -Seconds 3
}
Write-Host 'Service MongoDB actif.'

Write-Host ''
Write-Host 'Verification de la configuration replication (mongod.cfg)...'
# L'installeur MSI de MongoDB Community Server n'active jamais la
# replication par defaut (aucune case a cocher pour ca) - sans ce bloc,
# rs.initiate() echoue systematiquement sur un poste fraichement installe
# avec "This node was not started with replication enabled". On retrouve
# le fichier de config via la ligne de commande reelle du service (plus
# fiable qu'un chemin devine) plutot que de supposer son emplacement.
$serviceInfo = Get-CimInstance Win32_Service -Filter "Name='MongoDB'" -ErrorAction SilentlyContinue
$configPath = $null
if ($serviceInfo -and $serviceInfo.PathName -match '--config\s+"?([^"]+\.cfg)"?') {
    $configPath = $matches[1]
}

if ($configPath -and (Test-Path $configPath)) {
    $configContent = Get-Content -Path $configPath -Raw
    if ($configContent -notmatch '(?m)^\s*replication\s*:') {
        Write-Host "Replication absente de $configPath - ajout de replSetName: rs0..."
        Add-Content -Path $configPath -Value "`nreplication:`n  replSetName: rs0`n"
        Write-Host 'Redemarrage du service MongoDB pour appliquer le changement...'
        Restart-Service -Name 'MongoDB' -Force
        Start-Sleep -Seconds 5
        Write-Host 'Service MongoDB redemarre.'
    } else {
        Write-Host 'Replication deja configuree dans mongod.cfg.'
    }
} else {
    Write-Host 'ATTENTION : mongod.cfg introuvable automatiquement.' -ForegroundColor Yellow
    Write-Host 'Si l''etape suivante echoue avec "not started with replication enabled",'
    Write-Host 'ajoutez manuellement ces lignes au fichier de configuration de MongoDB'
    Write-Host '(mongod.cfg, chemin visible dans les proprietes du service Windows "MongoDB") :'
    Write-Host '  replication:'
    Write-Host '    replSetName: rs0'
    Write-Host 'puis redemarrez le service MongoDB et relancez ce script.'
}

Write-Host ''
Write-Host 'Verification/initialisation du replica set rs0...'
$checkScript = @'
try {
  const status = rs.status();
  print("ALREADY_INITIATED");
} catch (e) {
  const result = rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] });
  if (result.ok === 1) {
    print("INITIATED_OK");
  } else {
    print("INITIATE_FAILED: " + JSON.stringify(result));
  }
}
'@

# Ecrit dans un fichier temporaire plutot que de passer le script via
# --eval : PowerShell reconstruit mal la ligne de commande d'un executable
# natif quand l'argument est une chaine multi-lignes avec des guillemets
# imbriques (les guillemets de "127.0.0.1:27017" etc. coupent l'argument
# en plein milieu), ce qui fait planter mongosh avec une erreur "Invalid
# URI". Un chemin de fichier n'a pas ce probleme.
$scriptFile = Join-Path $env:TEMP 'scolar-gestion-init-replica-set.js'
Set-Content -Path $scriptFile -Value $checkScript -Encoding utf8

$output = & $mongosh --quiet $scriptFile 2>&1
Remove-Item -Path $scriptFile -Force -ErrorAction SilentlyContinue
Write-Host $output

if ($output -match 'ALREADY_INITIATED') {
    Write-Host ''
    Write-Host 'Le replica set etait deja initialise - rien a faire.' -ForegroundColor Green
} elseif ($output -match 'INITIATED_OK') {
    Write-Host ''
    Write-Host 'Replica set "rs0" initialise avec succes.' -ForegroundColor Green
    Write-Host 'Patientez quelques secondes que MongoDB elise le noeud primaire avant de lancer l''application.'
} else {
    Write-Host ''
    Write-Host 'ECHEC de l''initialisation - voir le message ci-dessus.' -ForegroundColor Red
    exit 1
}
