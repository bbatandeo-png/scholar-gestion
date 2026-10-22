import { ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { urlencoded } from 'express';
import session from 'express-session';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { applyViewLocals, configureViewEngine } from '../src/app-setup';
import { FeeScheduleNotFoundFilter } from '../src/common/filters/fee-schedule-not-found.filter';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { BulletinsService } from '../src/bulletins/bulletins.service';
import { SchoolYearStatus } from '../src/common/enums/domain.enums';
import { applyTenantMiddleware } from '../src/common/tenant/apply-tenant-middleware';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import { TEST_DEFAULT_USER_ID } from '../src/common/tenant/ensure-test-session-user.util';
import { Ecole } from '../src/ecoles/schemas/ecole.schema';
import { ExpenseCategory } from '../src/expenses/schemas/expense-category.schema';
import { Level } from '../src/levels/schemas/level.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
import { seedSchoolConfiguration } from '../src/scripts/seed-school-configuration';
import { startMongoReplSet } from './mongo-replset';

// Parcours de TOUTES les pages, role par role, comme un utilisateur qui
// clique sur chaque lien qu'il voit, puis scenarios metier (Etant donne /
// Quand / Alors) joues a travers les formulaires de l'application.
//
// L'application est montee comme en production (main.ts) : meme moteur de
// vues, memes informations de page (menu, annee, modules), session reelle.
// Aucun filtre d'exception global : une erreur reste un vrai 4xx/5xx au lieu
// d'etre transformee en redirection, pour qu'aucune ne passe inapercue.

const ROLES = [
  'super_admin',
  'direction',
  'secretariat',
  'comptabilite',
  'auditeur',
] as const;
type RoleCode = (typeof ROLES)[number];

// Textes visibles qui trahissent une erreur technique dans une page.
const TECHNICAL_ERRORS =
  /\b(CastError|TypeError|ReferenceError|ValidationError|Template render error|undefined|NaN)\b|\[object Object\]/;
// Codes internes affiches tels quels au lieu de leur libelle francais.
const RAW_CODES =
  /(^|\s)(pending|paid|unpaid|partially_paid|partial|draft|closed|archived|promoted|repeated|transferred|cancelled|super_admin|trimestre_1|semestre_1|re_enrollment)(\s|$)/;
// Mots francais courants ecrits sans leurs accents.
const MISSING_ACCENTS =
  /\b(Eleves?|eleves?|Annees?|annees?|Creer|creer|Periode|periode|Categorie|categorie|Matieres?|matieres?|Telephone|Prenoms|Reinitialiser|Precedent|Libelle|Reference|Numero|Quantite|Echec|Etat|Selectionne[sz]?|Parametres|Depenses?|depenses?|Recu|Decision|Reinscription|deja|Cloturee|Impayee?s?|Payee|Generer|Telecharger|Modele|Synthese|Donnees|donnees|Resultats?|Enregistre|enregistree?s?|creee?s?|Detail)\b/;

const SKIPPED_LINKS = [
  /^\/logout/,
  /^\/login/,
  /^\/vitrine/,
  /^\/uploads/,
  /^\/platform/,
  /\.(css|js|png|jpe?g|svg|ico|woff2?)$/,
];

// Texte reellement visible : sans scripts, styles, commentaires ni balises.
function visibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"');
}

function linksOf(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href="(\/[^"#]*)"/g)) {
    const href = match[1].replace(/&amp;/g, '&');
    if (href.includes('{{') || SKIPPED_LINKS.some((re) => re.test(href))) {
      continue;
    }
    links.add(href);
  }
  return [...links];
}

// Une page par "forme" d'URL : /students/<id> une seule fois, et un lien de
// filtre/pagination par jeu de parametres (pas par valeur).
function pageKey(url: string) {
  const [pathname, query = ''] = url.split('?');
  const keys = new URLSearchParams(query);
  const queryKeys = [...new Set([...keys.keys()])].sort().join(',');
  return `${pathname.replace(/[a-f0-9]{24}/g, ':id')}?${queryKeys}`;
}

const binaryParser = (
  res: NodeJS.ReadableStream,
  done: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Parcours de toutes les pages et scenarios metier (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: NestExpressApplication;
  let ecoleId: string;
  const ids: Record<string, string> = {};

  const agentFor = (role: RoleCode) => {
    const agent = request.agent(app.getHttpServer());
    return {
      get: (url: string) =>
        agent
          .get(url)
          .set('x-test-role', role)
          .set('x-test-ecole-id', ecoleId)
          .set('accept', 'text/html,application/xhtml+xml,*/*')
          .buffer(true)
          .parse(
            binaryParser as unknown as Parameters<request.Test['parse']>[0],
          ),
      post: (url: string, body: Record<string, unknown>) =>
        agent
          .post(url)
          .set('x-test-role', role)
          .set('x-test-ecole-id', ecoleId)
          .set('accept', 'text/html,application/xhtml+xml,*/*')
          .type('form')
          .send(body),
    };
  };
  const html = (res: request.Response) => (res.body as Buffer).toString('utf8');

  // Envoie un formulaire comme le navigateur, suit la redirection et lit le
  // message affiche a l'utilisateur (flash).
  const submit = async (
    agent: ReturnType<typeof agentFor>,
    url: string,
    body: Record<string, unknown>,
  ) => {
    const res = await agent.post(url, body);
    const location = String(res.headers.location ?? '');
    let flash: { type: string; message: string } | null = null;
    if (res.status === 302 && location.startsWith('/')) {
      const next = html(await agent.get(location));
      const match =
        /<div class="flash (\w+)"[^>]*>\s*<span class="flash-message">([^<]*)</.exec(
          next,
        );
      if (match) {
        flash = { type: match[1], message: visibleText(match[2]).trim() };
      }
    }
    return { status: res.status, location, flash };
  };

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;
    // La licence a ses propres tests ; ici elle ne doit pas bloquer les saisies.
    process.env.LICENSE_ENFORCEMENT = 'off';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureViewEngine(app, path.join(__dirname, '..', 'src', 'views'));
    app.use(urlencoded({ extended: true }));
    app.use(
      session({
        secret: 'pages-e2e',
        resave: false,
        saveUninitialized: false,
      }),
    );
    applyTenantMiddleware(app);
    // Avant init() : un middleware ajoute apres le montage des routes ne
    // s'executerait jamais pour elles.
    applyViewLocals(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: false,
      }),
    );
    // Memes filtres d'erreur qu'en production (main.ts).
    app.useGlobalFilters(
      new FeeScheduleNotFoundFilter(),
      new HttpExceptionFilter(),
    );
    await app.init();

    // Une ecole de demonstration complete (niveaux, frais, matieres,
    // categories de depenses, tous les modules actifs, annee ouverte).
    const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
    const ecole = await ecoleModel.create({
      nom: `Ecole Parcours ${Date.now()}`,
      statutCompte: 'actif',
      dateInscription: new Date(),
    });
    ecoleId = String(ecole._id);
    await seedSchoolConfiguration(app, {
      ecoleId,
      actorId: TEST_DEFAULT_USER_ID,
      activateAllModules: true,
    });
    Object.assign(
      ids,
      await runWithTenant({ ecoleId }, async () => {
        const year = await app
          .get<Model<SchoolYear>>(getModelToken(SchoolYear.name))
          .findOne({ status: SchoolYearStatus.OPEN })
          .lean();
        const levels = app.get<Model<Level>>(getModelToken(Level.name));
        const cm1 = await levels.findOne({ code: 'CM1' }).lean();
        const sixieme = await levels.findOne({ code: '6EME' }).lean();
        const category = await app
          .get<Model<ExpenseCategory>>(getModelToken(ExpenseCategory.name))
          .findOne()
          .lean();
        return {
          schoolYearId: String(year!._id),
          cm1Id: String(cm1!._id),
          sixiemeId: String(sixieme!._id),
          expenseCategoryId: String(category!._id),
        };
      }),
    );
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await repl?.stop();
  });

  describe('Fonctionnalite : inscrire un eleve au guichet', () => {
    it('Scenario : nouvel eleve en CM1 avec un premier paiement', async () => {
      const secretariat = agentFor('secretariat');

      // Etant donne la secretaire sur le formulaire de creation d'eleve
      const form = await secretariat.get('/students');
      expect(form.status).toBe(200);
      expect(html(form)).toContain('Créer un élève');

      // Quand elle cree le dossier en CM1 en encaissant 25 000 FCFA
      const created = await submit(secretariat, '/students', {
        lastname: 'KOFFI',
        firstname: 'Ama',
        gender: 'F',
        levelId: ids.cm1Id,
        paymentAmount: '25000',
        paymentMethod: 'cash',
        paymentReference: 'GUICHET-PARCOURS',
      });

      // Alors un message de confirmation s'affiche
      expect(created.flash?.type === 'success' ? 'ok' : created.flash).toBe(
        'ok',
      );
      // Et l'eleve existe, inscrite en CM1, avec son paiement formate
      const student = await runWithTenant({ ecoleId }, () =>
        app
          .get<Model<Student>>(getModelToken(Student.name))
          .findOne({ lastname: 'KOFFI', firstname: 'Ama' })
          .lean(),
      );
      expect(student).toBeTruthy();
      ids.studentId = String(student!._id);
      const fiche = await secretariat.get(`/students/${ids.studentId}`);
      expect(fiche.status).toBe(200);
      expect(html(fiche)).toContain('CM1');
      expect(visibleText(html(fiche))).toMatch(/25\s000\sFCFA/);
    });
  });

  describe('Fonctionnalite : ne jamais perdre une saisie refusee', () => {
    it('Scenario : matricule deja utilise, le formulaire garde ce qui a ete saisi', async () => {
      const secretariat = agentFor('secretariat');
      const existing = await runWithTenant({ ecoleId }, () =>
        app
          .get<Model<Student>>(getModelToken(Student.name))
          .findById(ids.studentId)
          .lean(),
      );

      // Quand la secretaire cree un eleve avec un matricule deja pris
      const refused = await secretariat.post('/students', {
        matricule: existing!.matricule,
        lastname: 'AGBODJAN',
        firstname: 'Yao',
        gender: 'M',
        levelId: ids.cm1Id,
        'guardians[0][fullname]': 'AGBODJAN Kossi',
      });
      expect(refused.status).toBe(302);
      const page = html(
        await secretariat.get(refused.headers.location as string),
      );

      // Alors l'erreur s'affiche
      expect(page).toMatch(/<div class="flash error"/);
      // Et la saisie est conservee pour re-remplir le formulaire
      const oldInput = /data-old-input="([^"]*)"/.exec(page)?.[1] ?? '';
      const values = JSON.parse(oldInput.replace(/&quot;/g, '"')) as {
        action: string;
        values: Record<string, string>;
      };
      expect(values.action).toBe('/students');
      expect(values.values).toMatchObject({
        lastname: 'AGBODJAN',
        firstname: 'Yao',
        'guardians[0][fullname]': 'AGBODJAN Kossi',
      });
      expect(values.values).not.toHaveProperty('_csrf');

      // Et la page suivante n'est plus pre-remplie
      expect(html(await secretariat.get('/students'))).not.toContain(
        'data-old-input',
      );
    });
  });

  describe('Fonctionnalite : saisir les notes et produire les bulletins', () => {
    it('Scenario : session de CM1, notes saisies a l ecran, validation puis PDF', async () => {
      const direction = agentFor('direction');

      // Etant donne une session du 1er trimestre pour le CM1
      const createdSession = await submit(direction, '/bulletins', {
        schoolYearId: ids.schoolYearId,
        levelId: ids.cm1Id,
        periode: 'trimestre_1',
      });
      expect(
        createdSession.flash?.type === 'error' ? createdSession.flash : 'ok',
      ).toBe('ok');
      ids.sessionId = /\/bulletins\/([a-f0-9]{24})/.exec(
        createdSession.location,
      )![1];

      // Quand la direction saisit les notes de chaque matiere de la classe
      const subjects = await runWithTenant({ ecoleId }, () =>
        app
          .get(BulletinsService)
          .listClassSubjects(ids.schoolYearId, ids.cm1Id),
      );
      expect(subjects.length).toBeGreaterThan(0);
      for (const cs of subjects) {
        const subjectId = String(
          (cs.subjectId as unknown as { _id: string })._id,
        );
        const saved = await submit(
          direction,
          `/bulletins/${ids.sessionId}/saisie`,
          {
            subjectId,
            [`notes[${ids.studentId}][i1]`]: '12',
            [`notes[${ids.studentId}][devoir]`]: '13,5',
            [`notes[${ids.studentId}][compo]`]: '14',
          },
        );
        expect(saved.flash?.type === 'success' ? 'ok' : saved.flash).toBe('ok');
        // Rapport A28 : seuls les eleves ayant une note sont comptes.
        expect(saved.flash?.message).toContain('enregistrées pour 1 élève(s)');
      }
      // L'ecran de saisie reprend les notes deja enregistrees
      const entry = await direction.get(`/bulletins/${ids.sessionId}/saisie`);
      expect(html(entry)).toContain('value="13.5"');

      // Et qu'elle valide la session
      const validated = await submit(
        direction,
        `/bulletins/${ids.sessionId}/validate`,
        {},
      );
      expect(validated.flash?.type === 'success' ? 'ok' : validated.flash).toBe(
        'ok',
      );

      // Alors les bulletins se telechargent en PDF
      const pdf = await direction.get(`/bulletins/${ids.sessionId}/pdf`);
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('Fonctionnalite : refuser les saisies incoherentes (rapport de test)', () => {
    const nextYear = `${new Date().getFullYear() + 1}`;

    it('Scenario : naissance dans le futur, contrat aux dates inversees, matiere hors programme', async () => {
      const superAdmin = agentFor('super_admin');

      // A07 : un eleve ne nait pas dans le futur
      const futureBirth = await submit(superAdmin, '/students', {
        lastname: 'FUTUR',
        firstname: 'Bebe',
        gender: 'M',
        levelId: ids.cm1Id,
        birthDate: `${nextYear}-03-01`,
      });
      expect(futureBirth.flash).toEqual({
        type: 'error',
        message: 'La date de naissance ne peut pas être dans le futur.',
      });

      // A03 : un contrat ne finit pas avant d'avoir commence
      const teacher = await submit(superAdmin, '/teachers', {
        lastname: 'DATES',
        firstname: 'Kossi',
      });
      const teacherId = /\/teachers\/([a-f0-9]{24})/.exec(teacher.location)![1];
      const inverted = await submit(
        superAdmin,
        `/teachers/${teacherId}/contracts`,
        { type: 'cdd', startDate: '2026-10-21', endDate: '2026-01-01' },
      );
      expect(inverted.flash).toEqual({
        type: 'error',
        message: 'La date de fin doit être postérieure à la date de début.',
      });

      // A10 : on n'affecte pas une matiere absente du programme de la classe
      const philosophie = await runWithTenant({ ecoleId }, () =>
        app
          .get(BulletinsService)
          .listSubjects()
          .then((subjects) => subjects.find((s) => s.label === 'Philosophie')),
      );
      const outOfProgram = await submit(
        superAdmin,
        `/teachers/${teacherId}/assignments`,
        {
          levelIds: ids.cm1Id,
          subjectId: String(philosophie!._id),
          hoursPerWeek: '2',
        },
      );
      expect(outOfProgram.flash?.type).toBe('error');
      expect(outOfProgram.flash?.message).toContain(
        "n'est pas au programme de la classe",
      );
    });

    it('Scenario : recherche sans accents et historique complet d une depense', async () => {
      const superAdmin = agentFor('super_admin');

      // A09 : « eleonore », sans majuscules ni accents, retrouve « ÉLÉONORE »
      await submit(superAdmin, '/students', {
        lastname: 'ÉLÉONORE',
        firstname: 'Adjoa',
        gender: 'F',
        levelId: ids.cm1Id,
      });
      const found = visibleText(
        html(await superAdmin.get('/students?q=eleonore')),
      );
      expect(found).toContain('ÉLÉONORE');

      // A13 : chaque modification d'une depense garde avant/apres et motif
      await submit(superAdmin, '/expenses', {
        expenseDate: new Date().toISOString().slice(0, 10),
        label: 'Ramettes de papier',
        amount: '8000',
        beneficiary: 'Papeterie',
        categoryId: ids.expenseCategoryId,
      });
      const list = html(await superAdmin.get('/expenses'));
      const expenseId =
        /Ramettes de papier[\s\S]*?href="\/expenses\/([a-f0-9]{24})"/.exec(
          list,
        )?.[1];
      expect(expenseId).toBeDefined();
      const edited = await submit(superAdmin, `/expenses/${expenseId}`, {
        expenseDate: new Date().toISOString().slice(0, 10),
        label: 'Ramettes de papier',
        amount: '9500',
        beneficiary: 'Papeterie',
        categoryId: ids.expenseCategoryId,
        modificationReason: 'Erreur de montant',
      });
      expect(edited.flash?.type).toBe('success');
      const detail = visibleText(
        html(await superAdmin.get(`/expenses/${expenseId}`)),
      );
      expect(detail).toContain('Historique des modifications');
      expect(detail).toContain('Erreur de montant');
      expect(detail).toMatch(/Montant\s*:\s*8\s000\sFCFA\s*→\s*9\s500\sFCFA/);
    });
  });

  describe('Fonctionnalite : tenir les registres de l ecole', () => {
    it('Scenario : une depense, une entree de discipline, un article de stock et un enseignant', async () => {
      const superAdmin = agentFor('super_admin');
      const today = new Date().toISOString().slice(0, 10);

      // Quand on enregistre une depense
      const expense = await submit(superAdmin, '/expenses', {
        expenseDate: today,
        label: 'Achat de craies',
        amount: '15000',
        beneficiary: 'Librairie du Centre',
        categoryId: ids.expenseCategoryId,
      });
      // Alors elle est confirmee et listee avec son montant formate
      expect(expense.flash?.type === 'success' ? 'ok' : expense.flash).toBe(
        'ok',
      );
      expect(visibleText(html(await superAdmin.get('/expenses')))).toMatch(
        /Achat de craies[\s\S]*15\s000/,
      );

      // Quand on ajoute une entree au journal de discipline
      const discipline = await submit(superAdmin, '/discipline', {
        studentId: ids.studentId,
        type: 'avertissement',
        date: today,
        motif: 'Bavardages répétés',
      });
      // Alors elle est confirmee et visible dans le journal
      expect(
        discipline.flash?.type === 'success' ? 'ok' : discipline.flash,
      ).toBe('ok');
      expect(html(await superAdmin.get('/discipline'))).toContain(
        'Bavardages répétés',
      );

      // Quand on cree un article de stock puis une entree de 40 unites
      const item = await submit(superAdmin, '/stock', {
        name: 'Cahiers 96 pages',
        category: 'pedagogique',
        unit: 'pièce',
        alertThreshold: '10',
      });
      expect(item.flash?.type === 'success' ? 'ok' : item.flash).toBe('ok');
      // Et l'article apparait dans la liste, avec son lien « Voir »
      const stockList = html(await superAdmin.get('/stock'));
      expect(stockList).toContain('Cahiers 96 pages');
      const itemId =
        /Cahiers 96 pages[\s\S]*?href="\/stock\/([a-f0-9]{24})"/.exec(
          stockList,
        )?.[1];
      expect(itemId).toBeDefined();
      const movement = await submit(superAdmin, `/stock/${itemId}/movements`, {
        type: 'entree',
        quantity: '40',
        reason: 'Livraison de rentrée',
        date: today,
      });
      // Alors le stock de l'article est de 40
      expect(movement.flash?.type === 'success' ? 'ok' : movement.flash).toBe(
        'ok',
      );
      expect(
        visibleText(html(await superAdmin.get(`/stock/${itemId}`))),
      ).toMatch(/\b40\b/);

      // Quand on cree un enseignant, alors sa fiche s'ouvre
      const teacher = await submit(superAdmin, '/teachers', {
        lastname: 'MENSAH',
        firstname: 'Kodjo',
        specialty: 'Mathématiques',
      });
      expect(teacher.flash?.type === 'success' ? 'ok' : teacher.flash).toBe(
        'ok',
      );
      const fiche = await superAdmin.get(teacher.location);
      expect(fiche.status).toBe(200);
      expect(html(fiche)).toContain('MENSAH');
    });
  });

  // Le parcours : depuis le tableau de bord, chaque role suit tous les liens
  // qu'il voit. Execute apres les scenarios pour que les pages de detail
  // (eleve, inscription, recu, session, depense, stock, enseignant) existent.
  describe.each(ROLES)('Parcours complet des pages : role %s', (role) => {
    it('chaque lien visible s ouvre sans erreur, en francais', async () => {
      const agent = agentFor(role);
      // Pages atteintes par un formulaire GET (pas un lien) ou sans lien du
      // menu : visitees aussi ; un refus (403) y est normal selon le role.
      const direct = [
        `/reports/grade-sheet/pdf?levelId=${ids.cm1Id}`,
        `/reports/grade-sheet/excel?levelId=${ids.cm1Id}`,
        `/reports/grade-sheet/docx?levelId=${ids.cm1Id}`,
        `/reports/exam-statistics?levelId=${ids.cm1Id}&periode=trimestre_1`,
        `/reports/exam-statistics/pdf?levelId=${ids.cm1Id}&periode=trimestre_1`,
        `/reports/exam-statistics/excel?levelId=${ids.cm1Id}&periode=trimestre_1`,
        `/reports/exam-statistics/docx?levelId=${ids.cm1Id}&periode=trimestre_1`,
        `/reports/nominal-roll/pdf?levelId=${ids.cm1Id}`,
        '/reports/paid-students',
        '/reports/unpaid-students',
        '/reports/class-financial-situation',
        '/reports/class-financial-situation/pdf',
        '/licence',
      ];
      const queue = ['/dashboard', ...direct];
      const seen = new Set<string>();
      const problems: string[] = [];
      let htmlPages = 0;
      let downloads = 0;

      while (queue.length > 0 && seen.size < 400) {
        const url = queue.shift()!;
        const key = pageKey(url);
        if (seen.has(key)) continue;
        seen.add(key);

        const res = await agent.get(url);
        if (res.status === 302) {
          const location = String(res.headers.location ?? '');
          if (location.startsWith('/login')) {
            problems.push(`${url} -> renvoie vers la connexion`);
          } else if (location.startsWith('/')) {
            // En production, un refus (droit, donnee absente...) devient un
            // retour en arriere avec un message d'erreur : on le lit.
            const landing = html(await agent.get(location));
            const refused =
              /<div class="flash error"[^>]*>\s*<span class="flash-message">([^<]*)</.exec(
                landing,
              );
            if (refused && !direct.includes(url)) {
              problems.push(`${url} -> refus « ${refused[1]} »`);
            }
            queue.push(location);
          }
          continue;
        }
        if (res.status === 403 && direct.includes(url)) {
          continue;
        }
        if (res.status !== 200) {
          problems.push(`${url} -> HTTP ${res.status}`);
          continue;
        }

        const type = String(res.headers['content-type'] ?? '');
        if (!type.includes('text/html')) {
          downloads += 1;
          if ((res.body as Buffer).length === 0) {
            problems.push(`${url} -> fichier vide (${type})`);
          }
          continue;
        }

        htmlPages += 1;
        const page = html(res);
        // PAGES_DUMP_DIR=<dossier> : copie des pages rendues, pour les
        // verifier a l'oeil (captures mobile, etc.).
        if (process.env.PAGES_DUMP_DIR) {
          fs.mkdirSync(path.join(process.env.PAGES_DUMP_DIR, role), {
            recursive: true,
          });
          fs.writeFileSync(
            path.join(
              process.env.PAGES_DUMP_DIR,
              role,
              `${key.replace(/[^a-z0-9]+/gi, '_') || 'index'}.html`,
            ),
            page,
          );
        }
        const text = visibleText(page);
        const technical = TECHNICAL_ERRORS.exec(text);
        if (technical) {
          problems.push(
            `${url} -> erreur technique visible « ${technical[0]} »`,
          );
        }
        const raw = RAW_CODES.exec(text);
        if (raw) {
          problems.push(`${url} -> code interne affiché « ${raw[2]} »`);
        }
        const accents = MISSING_ACCENTS.exec(text);
        if (accents) {
          problems.push(`${url} -> mot sans accent « ${accents[0]} »`);
        }
        if (!/<title>[^<]+<\/title>/.test(page)) {
          problems.push(`${url} -> page sans titre`);
        }
        queue.push(...linksOf(page));
      }

      // Le parcours a bien couvert l'application, pas seulement l'accueil.
      expect(htmlPages).toBeGreaterThan(8);
      expect(problems).toEqual([]);
      // PAGES_REPORT=1 npm run test:pages : liste des pages parcourues.
      if (process.env.PAGES_REPORT) {
        console.log(
          `${role} : ${htmlPages} pages, ${downloads} telechargements\n` +
            [...seen].sort().join('\n'),
        );
      }
    }, 300000);
  });
});
