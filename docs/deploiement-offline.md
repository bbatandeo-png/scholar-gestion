# Déploiement offline — poste d'école sans connexion internet

Ce guide décrit comment installer Scolar-Gestion sur le poste d'une école qui n'a **aucun accès internet**, en s'appuyant sur l'exécutable autonome (`Scolar-Gestion.exe`) déjà généré par `npm run build:exe:native`.

Principe : tout se prépare **une fois, chez vous, avec internet**, sur une clé USB. L'installation sur le poste de l'école se fait ensuite entièrement hors-ligne.

---

## Étape 1 — Préparer la clé USB (avec internet, une seule fois)

### 1.1 Télécharger MongoDB Community Server

- Aller sur [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community).
- Choisir **Windows x64**, package **MSI**.
- **Cocher l'option "Install MongoDB as a Service"** durant le téléchargement/l'installation (elle est activée par défaut).
- Télécharger aussi **MongoDB Shell (mongosh)** séparément si le MSI ne le propose pas déjà en option — il est nécessaire pour le script `init-replica-set.ps1`. Lien : [mongodb.com/try/download/shell](https://www.mongodb.com/try/download/shell).
- (Optionnel mais recommandé pour les sauvegardes) **MongoDB Database Tools** (contient `mongodump`/`mongorestore`) : [mongodb.com/try/download/database-tools](https://www.mongodb.com/try/download/database-tools).

### 1.2 Builder l'exécutable

Depuis ce projet :

```bash
npm run build:exe:native
```

Le fichier produit est `release/Scolar-Gestion.exe`.

### 1.3 Copier sur la clé USB

Créer sur la clé USB un dossier `ScolarGestion-Installation` contenant :

```
ScolarGestion-Installation/
├── mongodb-installer.msi          (téléchargé à l'étape 1.1)
├── mongosh-installer.msi          (idem, si séparé)
├── Scolar-Gestion.exe             (release/Scolar-Gestion.exe)
├── views/                         (release/views - OBLIGATOIRE, voir note ci-dessous)
├── public/                        (release/public - idem)
├── .env                           (copie de scripts/deploy/.env.offline.example,
│                                    avec un SESSION_SECRET propre à cette école)
└── deploy/
    ├── init-replica-set.ps1
    └── sauvegarder-donnees.ps1
```

**Important** : éditez le `.env` copié pour donner à `SESSION_SECRET` une valeur unique par école (une chaîne aléatoire quelconque) — ne gardez pas la valeur d'exemple.

**Important** : les dossiers `views/` et `public/` doivent être copiés **à côté** de `Scolar-Gestion.exe`, pas juste laissés dans le zip/dépôt — `npm run build:exe:native` les régénère automatiquement dans `release/` à chaque build (via `scripts/copy-release-assets.cjs`), mais il faut penser à les recopier vers `ScolarGestion-Installation/` à chaque mise à jour de l'exe. Sans eux, l'application démarre mais renvoie une erreur 500 "template not found" sur chaque page (le moteur de rendu nunjucks ne peut pas lire les vues depuis l'intérieur de l'exécutable packagé, seulement depuis de vrais fichiers sur disque).

---

## Étape 2 — Installer sur le poste de l'école (sans internet)

### 2.1 Installer MongoDB

1. Lancer `mongodb-installer.msi`, suivre l'assistant.
2. Vérifier que **"Install MongoDB as a Service"** est bien coché.
3. Installer aussi `mongosh-installer.msi` si séparé.
4. Terminer l'installation — le service Windows **MongoDB** démarre automatiquement.

### 2.2 Initialiser le replica set

Ouvrir PowerShell **en tant qu'administrateur**, se placer dans le dossier `deploy` de la clé USB, puis :

```powershell
powershell -ExecutionPolicy Bypass -File init-replica-set.ps1
```

Ce script est idempotent : le relancer par erreur ne casse rien (il détecte que le replica set est déjà initialisé).

### 2.3 Installer l'application

1. Créer un dossier permanent sur le poste, par exemple `C:\ScolarGestion\`.
2. Copier dedans `Scolar-Gestion.exe`, les dossiers `views/` et `public/`, et le fichier `.env` préparé à l'étape 1.3 — les quatre doivent rester dans le même dossier.
3. Copier aussi le dossier `deploy/` (pour la sauvegarde future).

### 2.4 Premier lancement

Double-cliquer sur `Scolar-Gestion.exe`. Une fenêtre de console s'ouvre et reste ouverte (c'est normal — c'est le serveur qui tourne). Au premier démarrage, l'application crée automatiquement :

- le compte super-administrateur (email/mot de passe définis dans `.env`) ;
- deux années scolaires, les niveaux CP1 à Terminale, quelques frais de test.

Ouvrir un navigateur sur ce même poste et aller sur **http://localhost:3000**. Se connecter avec les identifiants du `.env`, puis **changer immédiatement le mot de passe** depuis l'écran Utilisateurs.

---

## Étape 3 — Démarrage automatique au démarrage de Windows

Pour éviter de devoir relancer l'exe manuellement à chaque redémarrage du poste :

1. Ouvrir le dossier de démarrage : appuyer sur `Win+R`, taper `shell:startup`, Entrée.
2. Créer un raccourci vers `C:\ScolarGestion\Scolar-Gestion.exe` dans ce dossier.

Le service MongoDB démarre déjà automatiquement avec Windows (configuré comme tel à l'installation) — seul le raccourci ci-dessus est nécessaire pour l'application elle-même.

---

## Étape 4 — Sauvegardes régulières

Exécuter périodiquement (idéalement via une tâche planifiée quotidienne) :

```powershell
powershell -ExecutionPolicy Bypass -File C:\ScolarGestion\deploy\sauvegarder-donnees.ps1
```

Chaque exécution crée un sous-dossier horodaté dans `deploy\backups\`. **Copier régulièrement ce dossier sur une clé USB externe** — il n'y a aucune sauvegarde cloud dans ce mode offline.

Pour planifier automatiquement (Planificateur de tâches Windows) :

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File "C:\ScolarGestion\deploy\sauvegarder-donnees.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At '20:00'
Register-ScheduledTask -TaskName 'Sauvegarde Scolar-Gestion' -Action $action -Trigger $trigger -RunLevel Highest
```

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| L'exe se ferme instantanément | MongoDB n'est pas démarré, ou pas en replica set | Vérifier `Get-Service MongoDB` (doit être `Running`), relancer `init-replica-set.ps1` |
| `EADDRINUSE :::3000` au démarrage | Une autre instance de l'exe tourne déjà | Fermer l'ancienne fenêtre console, ou redémarrer le poste |
| Page blanche / erreur 500 | Le replica set n'a pas fini son élection | Attendre 10-15 secondes après `init-replica-set.ps1` avant de lancer l'exe |
| Mot de passe admin oublié | — | Relancer le seed n'est pas possible sans perdre les données ; utiliser `npm run create:platform-admin` depuis un poste de développement connecté à une copie de la base, ou contacter le support |
| `mongosh introuvable` dans le script | mongosh non installé | Réinstaller depuis `mongosh-installer.msi` (étape 2.1) |
| Erreur 500 "template not found" sur toutes les pages | Les dossiers `views/` et `public/` ne sont pas à côté de `Scolar-Gestion.exe` | Copier `views/` et `public/` (générés dans `release/` par `npm run build:exe:native`) dans le même dossier que l'exe |
| `This node was not started with replication enabled` pendant `init-replica-set.ps1` | L'installeur MSI de MongoDB n'active jamais la réplication par défaut | Normalement corrigé automatiquement par le script (il édite `mongod.cfg` et redémarre le service) ; si `mongod.cfg` n'est pas trouvé automatiquement, l'ajouter à la main : section `replication:` / `replSetName: rs0`, puis redémarrer le service MongoDB et relancer le script |

---

## Ce qui n'est PAS encore automatisé (pistes futures)

- Un vrai installeur « tout-en-un » (.msi ou .exe) qui embarquerait MongoDB + l'application en une seule installation cliquable, sans étapes manuelles séparées.
- La mise à jour de l'application sur un poste déjà installé (aujourd'hui : remplacer manuellement `Scolar-Gestion.exe`, les données restent dans MongoDB donc ne sont pas affectées).

**Note de vérification** : ce parcours (installation MongoDB, `init-replica-set.ps1`, lancement de l'exe) a été validé de bout en bout sur un vrai poste Windows client, avec les correctifs listés dans le tableau de dépannage ci-dessus déjà appliqués.
