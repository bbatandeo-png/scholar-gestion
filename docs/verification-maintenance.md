# Vérification et maintenance — poste déjà installé

Ce guide suit `deploiement-offline.md` : il part du principe que Scolar-Gestion tourne déjà sur le poste. Il couvre : rendre le poste fiable sans intervention manuelle, consulter les données avec MongoDB Compass, faire/restaurer une sauvegarde, et diagnostiquer les pannes courantes une fois l'app en service depuis un moment.

---

## 0. Rendre le poste fiable (à faire une fois, juste après l'installation)

Un poste d'école tourne sans supervision technique — ces deux réglages évitent qu'un redémarrage, une longue inactivité ou un plantage du service MongoDB oblige quelqu'un de non technique à intervenir manuellement.

### 0.1 Empêcher le poste de se mettre en veille

Windows met par défaut l'ordinateur en veille après un moment d'inactivité — à la reprise, le service MongoDB peut mettre du temps à redevenir joignable, ou plus rarement ne pas redémarrer correctement. Sur un poste dédié à l'application, désactiver la veille :

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
```

### 0.2 Faire redémarrer MongoDB automatiquement s'il plante

Par défaut, si le service Windows "MongoDB" s'arrête de façon inattendue, il ne redémarre pas tout seul. À corriger une fois, en PowerShell administrateur :

```powershell
sc.exe failure MongoDB reset= 86400 actions= restart/5000/restart/5000/restart/5000
```

Ceci dit à Windows de relancer le service 5 secondes après chaque plantage (jusqu'à 3 fois, le compteur se réinitialisant après 24h sans nouveau plantage).

### 0.3 Ce que fait déjà l'application de son côté

Depuis la version courante, l'exécutable patiente indéfiniment si MongoDB n'est pas encore prêt au démarrage (au lieu d'abandonner après ~5 minutes et de fermer sa fenêtre) — un redémarrage lent de MongoDB après le boot du poste ne devrait donc plus jamais nécessiter de relancer quoi que ce soit manuellement, script ou exécutable.

---

## 1. Consulter les données avec MongoDB Compass

Compass est un outil séparé (pas installé par défaut avec le service MongoDB) — s'il n'est pas présent sur le poste, le télécharger depuis [mongodb.com/try/download/compass](https://www.mongodb.com/try/download/compass) sur une machine connectée et l'apporter par clé USB.

### 1.1 Se connecter

- URI de connexion à utiliser : `mongodb://127.0.0.1:27017/?replicaSet=rs0`
- **Important** : se connecter *depuis le poste où l'app tourne*. Chaque poste d'école a sa propre base locale, indépendante des autres — Compass sur votre PC de dev ne verra jamais les données d'un poste client.

### 1.2 Trouver la bonne base

Compass affiche par défaut les bases système (`admin`, `config`, `local`) — la base de l'application est nommée **`scolar-gestion`** (voir la valeur de `MONGODB_URI` dans le `.env` du poste). Cliquer dessus dans la liste de gauche pour dérouler ses collections.

Collections principales à connaître :

| Collection | Contenu |
|---|---|
| `users` | Comptes utilisateurs (super-admin, direction, secrétariat...) |
| `students` | Fiches élèves |
| `guardians` | Tuteurs/parents |
| `enrollments` | Inscriptions (élève + année scolaire + niveau) |
| `schoolyears` | Années scolaires |
| `levels` | Niveaux (CP1 à Terminale) |
| `invoices` / `payments` | Facturation et paiements |
| `notes` / `bulletinresults` | Notes et bulletins |
| `ecoles` | Fiche de l'établissement (nom, logo, contacts...) |

Si la base `scolar-gestion` est là mais qu'une collection attendue est vide, ce n'est pas forcément une anomalie — elle se remplit au fur et à mesure de l'usage (ex. `invoices` reste vide tant qu'aucune inscription n'a généré de facture).

Si la base `scolar-gestion` elle-même n'apparaît pas du tout, voir la section Dépannage plus bas.

---

## 2. Sauvegardes

### 2.1 Lancer une sauvegarde manuelle

Depuis le dossier `deploy` de l'installation, en PowerShell administrateur :

```powershell
.\sauvegarder-donnees.ps1
```

Chaque exécution crée un sous-dossier horodaté dans `deploy\backups\` (ex. `2026-08-19_14-30-00\`) contenant un export complet de la base. **Copier ce dossier sur une clé USB externe régulièrement** — aucune sauvegarde cloud n'existe en mode offline, la seule copie de sécurité est celle que vous faites vous-même.

### 2.2 Planifier une sauvegarde automatique quotidienne

Voir `docs/deploiement-offline.md`, étape 4 — commande `Register-ScheduledTask` à exécuter une fois.

Pour vérifier qu'une tâche planifiée existe déjà et qu'elle s'est bien exécutée récemment :

```powershell
Get-ScheduledTask -TaskName 'Sauvegarde Scolar-Gestion' | Get-ScheduledTaskInfo
```

Le champ `LastRunTime` doit correspondre à la dernière exécution attendue, et `LastTaskResult` doit être `0` (succès).

### 2.3 Restaurer une sauvegarde

À utiliser en cas de perte de données ou avant une opération risquée (ex. avant un test). **Écrase les données actuelles** — à ne faire qu'en connaissance de cause.

```powershell
mongorestore --uri "mongodb://127.0.0.1:27017/scolar-gestion?replicaSet=rs0" --drop "chemin\vers\deploy\backups\2026-08-19_14-30-00\scolar-gestion"
```

`--drop` supprime les collections existantes avant de restaurer celles de la sauvegarde — sans cette option, les données actuelles et celles restaurées se mélangent.

---

## 3. Vérifier que tout fonctionne

### 3.1 Contrôle rapide de santé

- L'application répond : ouvrir `http://localhost:3000` sur le poste, la page de connexion doit s'afficher.
- Le service MongoDB tourne : `Get-Service MongoDB` doit afficher `Running`.
- Le replica set est actif :
  ```powershell
  mongosh --quiet --eval "rs.status().members[0].stateStr"
  ```
  doit répondre `PRIMARY`.

### 3.2 Après un redémarrage du poste

Le service MongoDB démarre automatiquement avec Windows. L'application, elle, ne se relance toute seule que si le raccourci a été placé dans le dossier de démarrage (`docs/deploiement-offline.md`, étape 3) — sinon il faut redoubler-cliquer sur `Scolar-Gestion.exe` manuellement.

---

## 4. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| La base `scolar-gestion` n'apparaît pas dans Compass | L'app n'a jamais démarré avec succès sur ce poste (donc jamais créé la base), ou Compass est connecté à la mauvaise machine | Vérifier que l'app tourne (`http://localhost:3000` répond) sur **ce** poste avant de chercher la base |
| Une collection attendue (`users`, `schoolyears`, `levels`) est vide alors que l'app a déjà démarré | Le seed automatique du premier lancement a peut-être échoué silencieusement | Regarder la fenêtre console de l'exe au démarrage pour une erreur ; en dernier recours, contacter le support avec une capture des logs |
| `sauvegarder-donnees.ps1` échoue avec `mongodump introuvable` | MongoDB Database Tools non installé | Installer depuis `mongodb.com/try/download/database-tools` (à télécharger sur une machine connectée puis apporter par clé USB) |
| Après restauration, l'app affiche une erreur ou des données incohérentes | Restauration interrompue en cours de route, ou faite pendant que l'app tournait encore | Fermer `Scolar-Gestion.exe` avant de restaurer, refaire `mongorestore --drop` proprement, puis relancer l'exe |
| Le mot de passe admin est oublié | — | Voir `docs/deploiement-offline.md`, tableau de dépannage |

---

Pour tout ce qui concerne l'installation initiale (MongoDB, replica set, premier lancement), voir `docs/deploiement-offline.md`.
