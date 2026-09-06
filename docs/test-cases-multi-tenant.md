# Cas de test — Isolation multi-école (Phase 1)

**Fichier source des tests automatisés** : [`test/multi-tenant.e2e-spec.ts`](../test/multi-tenant.e2e-spec.ts)
**Commande d'exécution** : `npx jest --config test/jest-e2e.json test/multi-tenant.e2e-spec.ts`
**Objectif général** : prouver qu'aucune école ne peut jamais lire, ni directement ni via une agrégation, les données d'une autre école — le risque central identifié dans le plan de la Phase 1 (fondation multi-tenant).

---

## Données de test communes (`beforeAll`)

Deux écoles indépendantes sont créées avec des données facilement distinguables :

| Élément | École A (« Ecole Alpha ») | École B (« Ecole Beta ») |
|---|---|---|
| Élève | matricule `ISOL-A-001`, nom `Isolation AlphaEleve` | matricule `ISOL-B-001`, nom `Isolation BetaEleve` |
| Année scolaire | `ISOL-2040-2041` | `ISOL-B-2040-2041` |
| Niveau | — | `ISOL-B-LVL` |
| Inscription | — | 1 inscription active sur le niveau ci-dessus |
| Facture | — | frais d'inscription 5000, écolage 50000, total dû 55000 |
| Dépense | — | 1 dépense de 12345 (catégorie « Isolation Beta Category ») |

Chaque document est créé via `runWithTenant({ ecoleId })`, exactement comme une requête HTTP réelle établirait le contexte tenant.

---

## TC-01 — L'autocomplétion élèves (endpoint d'agrégation) ne retourne que les élèves de l'école de la session

**Risque couvert** : `StudentsService.autocomplete()` utilise un pipeline `.aggregate()` — un des points d'entrée où le scoping par école pourrait être contourné si le plugin `ecoleScopePlugin` ne couvrait pas correctement les agrégations.

**Préconditions** : données communes ci-dessus créées.

**Étapes** :
1. `GET /students/autocomplete?q=Isolation` avec l'en-tête `x-test-ecole-id` positionné sur l'école A.
2. Récupérer la liste des matricules dans la réponse.

**Résultat attendu** :
- Code HTTP `200`.
- La liste contient `ISOL-A-001`.
- La liste ne contient **pas** `ISOL-B-001`.

**Statut** : ✅ Validé.

---

## TC-02 — Un élève d'une autre école n'est jamais accessible par son identifiant (404, pas de fuite)

**Risque couvert** : un accès direct par `_id` (`findById`-style) doit être bloqué par le plugin même si l'appelant connaît l'identifiant exact d'un document appartenant à une autre école — pas seulement les listes, qui pourraient être filtrées côté vue sans que la requête elle-même soit protégée.

**Préconditions** : données communes ci-dessus créées.

**Étapes** :
1. `GET /students/:studentBId/financial-status` avec `x-test-ecole-id` = école A (accès croisé).
2. `GET /students/:studentAId/financial-status` avec `x-test-ecole-id` = école A (accès légitime), à titre de contrôle.

**Résultat attendu** :
- Étape 1 : code HTTP `404` (l'élève de l'école B est traité comme inexistant du point de vue de l'école A — pas un `403`, pour ne pas confirmer son existence).
- Étape 2 : code HTTP `200` (l'accès à son propre élève fonctionne normalement).

**Statut** : ✅ Validé.

---

## TC-03 — Les agrégations financières ne fuient jamais les données d'une autre école

**Risque couvert** : les deux points d'entrée d'agrégation explicitement désignés comme zone à risque dans le plan de la Phase 1 — `ReportsService.studentsByLevel()` / `ReportsService.revenue()` et `ExpensesService.getTotals()` — n'étaient couverts par **aucun** test avant cette session. Le test appelle ces services directement (plutôt que via HTTP) pour isoler précisément le mécanisme de scoping du rendu de vue.

**Préconditions** : données communes ci-dessus créées (facture et dépense de l'école B).

**Étapes** :
1. Avec le contexte tenant de l'école B, appeler `studentsByLevel`, `revenue` et `getTotals` sur l'année scolaire de l'école B → doivent renvoyer les vraies données (contrôle positif).
2. Avec le contexte tenant de l'école **A**, appeler ces trois mêmes méthodes en passant explicitement l'`schoolYearId` de l'école **B** → doit renvoyer un résultat vide/nul malgré l'identifiant valide fourni.

**Résultat attendu** :
- Étape 1 :
  - `studentsByLevel` : au moins une ligne avec `total > 0`.
  - `revenue().totalDue` : `55000`.
  - `getTotals().totalExpenses` : `12345`.
- Étape 2 :
  - `studentsByLevel` : tableau vide (`[]`).
  - `revenue().totalDue` et `.outstanding` : `0`.
  - `getTotals().totalExpenses` : `0`.

**Statut** : ✅ Validé — ajouté lors de cette session pour combler l'absence de couverture signalée dans l'audit de la Phase 1.

---

## Récapitulatif

| ID | Cas de test | Endpoint / méthode | Statut |
|---|---|---|---|
| TC-01 | Autocomplétion élèves (agrégation) | `GET /students/autocomplete` | ✅ |
| TC-02 | Accès par ID à un élève d'une autre école | `GET /students/:id/financial-status` | ✅ |
| TC-03 | Agrégations financières (rapports + dépenses) | `ReportsService`, `ExpensesService` | ✅ |

**Exécuter l'ensemble** :
```bash
npx jest --config test/jest-e2e.json test/multi-tenant.e2e-spec.ts
```
