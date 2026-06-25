# Scolar-Gestion

Application web de gestion administrative et financiere pour un complexe scolaire du CP1 a la Terminale. Le projet est base sur NestJS, MongoDB, Mongoose, vues Nunjucks, sessions, RBAC, CSRF, PDFKit et Jest/Supertest.

## Regles metier critiques

- Un eleve ne peut avoir qu'une seule inscription active par annee scolaire.
- Toute creation d'eleve doit etre precedee d'une recherche anti-doublon.
- La reinscription d'un ancien eleve doit reutiliser le dossier existant.
- Tout solde ouvert d'une ancienne facture doit etre materialise en impaye puis reporte sur la nouvelle inscription cible.
- Les impayes reportes doivent rester visibles separement des frais courants.
- Aucun enregistrement financier n'est supprime physiquement.
- Les paiements sont fractionnables, traces et associes a un recu unique.
- Les operations sensibles sont journalisees dans `audit_logs`.

## Modules principaux

- `AuthModule`
- `UsersModule`
- `SchoolYearsModule`
- `LevelsModule`
- `StudentsModule`
- `GuardiansModule`
- `EnrollmentsModule`
- `BillingModule`
- `PaymentsModule`
- `ArrearsModule`
- `PromotionsModule`
- `DashboardModule`
- `ReportsModule`
- `AuditModule`
- `SettingsModule`

## Installation

```bash
npm install
copy .env.example .env
```

Variables utiles :

- `PORT`
- `MONGODB_URI`
- `SESSION_SECRET`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Lancement MongoDB

Option locale :

```bash
mongod --dbpath ./data/db
```

Option Docker :

```bash
docker compose up -d mongo
```

## Seed initial

Le seed cree :

- un super administrateur ;
- deux annees scolaires ;
- les niveaux CP1 a Terminale ;
- quelques frais de test ;
- la regle d'imputation `arrears_first`.

Commande :

```bash
npm run seed
```

Compte de demonstration par defaut :

- email : `admin@scolar-gestion.local`
- mot de passe : `Admin123!`

## Lancement application

Mode developpement :

```bash
npm run start:dev
```

Mode production :

```bash
npm run build
npm run start:prod
```

## Tests

Tests unitaires :

```bash
npm run test
```

Tests d'integration / e2e :

```bash
npm run test:e2e
```

Couverture :

```bash
npm run test:cov
```

Les tests couvrent notamment :

- calcul de facture ;
- non duplication d'un impaye materialise ;
- reinscription d'un ancien eleve avec reprise du solde ouvert ;
- prevention de la double inscription active ;
- unicite du recu de paiement.

## Docker

Lancer toute la pile :

```bash
docker compose up --build
```

Services :

- application NestJS sur `http://localhost:3000`
- MongoDB sur `mongodb://localhost:27017`

## Workflows metier implementes

### Inscription initiale

- recherche ou creation du dossier eleve ;
- creation de l'inscription annuelle ;
- lecture des frais par niveau et annee ;
- creation de facture ;
- paiement immediat ou differe.

### Reinscription ancien eleve

- recherche du dossier existant ;
- affichage de l'historique ;
- verification d'absence d'inscription active sur l'annee cible ;
- materialisation des soldes ouverts anterieurs ;
- report total des impayes ouverts ;
- creation de nouvelle facture avec separation frais courants / impayes reportes.

### Promotion annuelle

- preparation des inscriptions actives de l'annee source ;
- decisions `promoted`, `repeated`, `transferred`, `left`, `archived` ;
- creation des inscriptions cibles quand applicable ;
- report automatique des impayes ouverts ;
- cloture de l'inscription source ;
- journalisation.

### Paiements

- montant positif obligatoire ;
- regle d'imputation configurable ;
- mise a jour facture ;
- mise a jour des impayes lies ;
- generation d'un recu HTML/PDF.

## Structure utile

- `src/views/` : pages Nunjucks
- `src/scripts/seed.ts` : seed initial
- `public/` : feuilles de style
- `test/` : tests e2e et outillage Mongo en memoire

## Commandes resumees

```bash
npm install
npm run seed
npm run start:dev
npm run build
npm run test
npm run test:e2e
docker compose up --build
```
