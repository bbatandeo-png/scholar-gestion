SCOLAR-GESTION - DEPLOIEMENT DOCKER (MACHINE UTILISATEUR)

Prerequis:
- Docker Desktop installe et demarre
- Port 3000 libre sur la machine

1) Ouvrir un terminal dans le dossier du projet:
cd c:\Users\USER\Documents\SCOLAR_GESTION\scholar-gestion

2) Construire et lancer les conteneurs:
docker compose up -d --build

3) Verifier que les conteneurs sont en marche:
docker compose ps

4) Initialiser les donnees (seed: admin + niveaux + annees + frais):
docker compose run --rm app npm run seed

5) Acceder a l'application:
http://localhost:3000

Compte admin par defaut:
- Email: admin@scolar-gestion.local
- Mot de passe: Admin123!

Commandes utiles:
- Voir les logs:
  docker compose logs -f app
  docker compose logs -f mongo

- Redemarrer les services:
  docker compose restart

- Arreter les services:
  docker compose down

- Arreter et supprimer aussi les donnees Mongo:
  docker compose down -v

Mise a jour de l'application (apres changement de code):
1) docker compose down
2) docker compose up -d --build

Variables importantes (compose actuel):
- PORT=3000
- MONGODB_URI=mongodb://mongo:27017/scolar-gestion
- SESSION_SECRET=change-me
- ADMIN_NAME=Super Admin
- ADMIN_EMAIL=admin@scolar-gestion.local
- ADMIN_PASSWORD=Admin123!

IMPORTANT PRODUCTION:
- Changer SESSION_SECRET et ADMIN_PASSWORD avant livraison finale.

------------------------------------------------------------
LANCEUR EXE (DOUBLE-CLIC UTILISATEUR)
------------------------------------------------------------

Objectif:
- Generer un fichier EXE qui demarre Scolar-Gestion via Docker puis ouvre http://localhost:3000

Scripts fournis a la racine du projet:
- start-scolar.ps1         -> demarre l'application via Docker
- stop-scolar.ps1          -> arrete l'application
- build-launcher-exe.ps1   -> genere Scolar-Gestion-Launcher.exe

Generation de l'EXE (sur machine technique):
1) Ouvrir PowerShell dans le dossier du projet
2) Lancer:
  powershell -ExecutionPolicy Bypass -File .\build-launcher-exe.ps1

Resultat:
- Un fichier Scolar-Gestion-Launcher.exe est cree a la racine.

Utilisation chez l'utilisateur final:
1) Installer Docker Desktop (obligatoire)
2) Ouvrir Docker Desktop
3) Double-cliquer sur Scolar-Gestion-Launcher.exe
4) Attendre le demarrage puis connexion automatique via navigateur sur:
  http://localhost:3000

Arreter l'application:
- powershell -ExecutionPolicy Bypass -File .\stop-scolar.ps1

Notes:
- L'EXE est un lanceur: il n'embarque pas Docker ni MongoDB.
- Pour une machine utilisateur, Docker Desktop doit etre installe et actif.

------------------------------------------------------------
OPTION SANS DOCKER (EXE NATIVE)
------------------------------------------------------------

Cas d'usage:
- Machine utilisateur peu performante pour Docker.
- On fournit un seul exe applicatif qui se connecte a une base Mongo distante.

Prerequis pour cette option:
- Une base MongoDB distante disponible (ex: MongoDB Atlas, serveur central)
- Une machine technique pour generer l'exe (Node.js + npm)

Generation de l'exe (machine technique):
1) Ouvrir PowerShell dans le dossier du projet
2) Lancer:
  powershell -ExecutionPolicy Bypass -File .\build-native-exe.ps1

Resultat:
- EXE genere dans:
  .\release\Scolar-Gestion.exe

Execution chez l'utilisateur final (sans Docker):
1) Copier Scolar-Gestion.exe sur la machine utilisateur
2) Definir les variables d'environnement Windows (au minimum):
  - MONGODB_URI (obligatoire, base distante)
  - SESSION_SECRET (recommande)
  - PORT (optionnel, defaut 3000)
3) Lancer Scolar-Gestion.exe
4) Ouvrir le navigateur:
  http://localhost:3000

Exemple de definition de variable (PowerShell utilisateur):
  setx MONGODB_URI "mongodb+srv://USER:PASS@cluster.mongodb.net/scolar-gestion"
  setx SESSION_SECRET "change-me-strong-secret"

Important:
- Cette option elimine Docker sur poste utilisateur.
- Elle necessite une connectivite reseau vers la base Mongo distante.
