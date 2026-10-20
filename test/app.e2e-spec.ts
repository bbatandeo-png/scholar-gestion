import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { ENUM_META } from '../src/common/view-helpers/enum-meta';
import {
  formatAmount,
  formatMoney,
} from '../src/common/view-helpers/format-money';
import { formatDay } from '../src/common/view-helpers/format-day';
import { BillingService } from '../src/billing/billing.service';
import { SettingsService } from '../src/settings/settings.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
  BulletinImportMode,
  EnrollmentType,
  LevelCycle,
  PaymentMethod,
  Periode,
  DisciplineRecordType,
  SchoolYearStatus,
} from '../src/common/enums/domain.enums';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { LevelsService } from '../src/levels/levels.service';
import { Level } from '../src/levels/schemas/level.schema';
import { Subject } from '../src/bulletins/schemas/subject.schema';
import { Note } from '../src/bulletins/schemas/note.schema';
import { BulletinResult } from '../src/bulletins/schemas/bulletin-result.schema';
import { TeacherAssignment } from '../src/teachers/schemas/teacher-assignment.schema';
import { Payment } from '../src/payments/schemas/payment.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
import { DisciplineRecord } from '../src/discipline/schemas/discipline-record.schema';
import { startMongoReplSet } from './mongo-replset';
import { PromotionsService } from '../src/promotions/promotions.service';
import { SchoolYearsService } from '../src/school-years/school-years.service';
import { Enrollment } from '../src/enrollments/schemas/enrollment.schema';
import { Arrear } from '../src/arrears/schemas/arrear.schema';
import { Invoice } from '../src/billing/schemas/invoice.schema';
import { FinalDecision } from '../src/common/enums/domain.enums';
import {
  runAsPlatformAdmin,
  runWithTenant,
} from '../src/common/tenant/tenant-context';
import {
  TEST_DEFAULT_ECOLE_ID,
  TEST_DEFAULT_USER_ID,
} from '../src/common/tenant/ensure-test-session-user.util';
import { applyTenantMiddleware } from '../src/common/tenant/apply-tenant-middleware';
import { EcoleModule as EcoleModuleModel } from '../src/ecole-modules/schemas/ecole-module.schema';
import { AuditLog } from '../src/audit/schemas/audit-log.schema';
import { StockItem } from '../src/stock/schemas/stock-item.schema';
import { Ecole } from '../src/ecoles/schemas/ecole.schema';
import { ExpenseCategory } from '../src/expenses/schemas/expense-category.schema';
import { BulletinsService } from '../src/bulletins/bulletins.service';
import { parseBulletinWorkbook } from '../src/bulletins/bulletins-import.util';
import {
  ALL_MODULE_CODES,
  seedSchoolConfiguration,
} from '../src/scripts/seed-school-configuration';

describe('Scolar Gestion workflows (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: NestExpressApplication;
  let billingService: BillingService;
  let enrollmentsService: EnrollmentsService;
  let studentModel: Model<Student>;
  let schoolYearModel: Model<SchoolYear>;
  let levelModel: Model<Level>;
  let subjectModel: Model<Subject>;
  let assignmentModel: Model<TeacherAssignment>;
  let paymentModel: Model<Payment>;
  let enrollmentModel: Model<Enrollment>;
  let promotionsService: PromotionsService;
  let schoolYearsService: SchoolYearsService;
  let levelsService: LevelsService;
  let dashboardService: DashboardService;
  let paymentsService: PaymentsService;
  let settingsService: SettingsService;
  let arrearModel: Model<Arrear>;
  let invoiceModel: Model<Invoice>;
  let auditLogModel: Model<AuditLog>;
  let noteModel: Model<Note>;
  let bulletinResultModel: Model<BulletinResult>;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyTenantMiddleware(app);
    // Comme main.ts : les vues connaissent l'utilisateur connecte (les
    // boutons reserves a certains roles en dependent).
    app.use(
      (
        req: { session?: { user?: unknown } },
        res: { locals: Record<string, unknown> },
        next: () => void,
      ) => {
        res.locals.currentUser = req.session?.user;
        next();
      },
    );

    // Unlike main.ts's real bootstrap, Test.createTestingModule() never
    // configures the nunjucks view engine - every @Render(...) route used
    // to be untestable for its actual HTML output here (see the long-
    // standing comment further down this file). Wiring it up the same way
    // main.ts does unlocks asserting on real rendered markup, which is the
    // only way to catch a template-only bug (e.g. a Nunjucks `==` comparing
    // two populated ObjectId instances by reference, always false) that no
    // amount of service-level unit testing can see.
    const viewsDir = path.join(__dirname, '..', 'src', 'views');
    app.setBaseViewsDir(viewsDir);
    app.setViewEngine('njk');
    const nunjucksEnv = nunjucks.configure(viewsDir, {
      autoescape: true,
      express: app.getHttpAdapter().getInstance(),
      noCache: true,
    });
    nunjucksEnv.addFilter('formatDate', (value: unknown) => {
      if (!value) {
        return '';
      }
      const date =
        value instanceof Date ? value : new Date(value as string | number);
      return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleString('fr-FR', {
            dateStyle: 'long',
            timeStyle: 'short',
          });
    });
    nunjucksEnv.addFilter('inputDate', (value: unknown) => {
      if (!value) {
        return '';
      }
      const date =
        value instanceof Date ? value : new Date(value as string | number);
      return Number.isNaN(date.getTime())
        ? ''
        : date.toISOString().slice(0, 10);
    });
    nunjucksEnv.addGlobal('ENUM_META', ENUM_META);
    nunjucksEnv.addFilter('money', (value: unknown) => formatMoney(value));
    nunjucksEnv.addFilter('amount', (value: unknown) => formatAmount(value));
    nunjucksEnv.addFilter('formatDay', (value: unknown) => formatDay(value));
    nunjucksEnv.addGlobal('currentYear', () => new Date().getFullYear());
    nunjucksEnv.addGlobal('copyrightHolder', 'Scolar-Gestion');

    // Test.createTestingModule() never runs main.ts's own bootstrap, so
    // without this every DTO's class-validator decorators (required fields,
    // @IsMongoId, etc.) were silently never enforced here - matching
    // main.ts's real config exactly, or an e2e test could assert 400 for a
    // rejection that only a since-removed service-level check produced, and
    // stay green even if the DTO validation itself broke.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: false,
      }),
    );

    await app.init();

    billingService = app.get(BillingService);
    enrollmentsService = app.get(EnrollmentsService);
    settingsService = app.get(SettingsService);
    studentModel = app.get(getModelToken(Student.name));
    schoolYearModel = app.get(getModelToken(SchoolYear.name));
    levelModel = app.get(getModelToken(Level.name));
    subjectModel = app.get(getModelToken(Subject.name));
    noteModel = app.get(getModelToken(Note.name));
    bulletinResultModel = app.get(getModelToken(BulletinResult.name));
    assignmentModel = app.get(getModelToken(TeacherAssignment.name));
    paymentModel = app.get(getModelToken(Payment.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    promotionsService = app.get(PromotionsService);
    schoolYearsService = app.get(SchoolYearsService);
    levelsService = app.get(LevelsService);
    dashboardService = app.get(DashboardService);
    paymentsService = app.get(PaymentsService);
    arrearModel = app.get(getModelToken(Arrear.name));
    invoiceModel = app.get(getModelToken(Invoice.name));
    auditLogModel = app.get(getModelToken(AuditLog.name));
    await Promise.all([
      studentModel.init(),
      schoolYearModel.init(),
      levelModel.init(),
      paymentModel.init(),
      enrollmentModel.init(),
    ]);

    // This whole spec predates the Finance module-activation feature and
    // exercises Finance-gated routes (payments, promotions) throughout, plus
    // Stock/Enseignants routes from before they got their own @RequireModule
    // gate - activate all three once for the shared test ecole rather than
    // touching every individual test. Module-activation itself is covered by
    // test/module-activation.e2e-spec.ts.
    const ecoleModuleModel: Model<any> = app.get(
      getModelToken(EcoleModuleModel.name),
    );
    await runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
      ecoleModuleModel.create([
        {
          ecoleId: TEST_DEFAULT_ECOLE_ID,
          code: 'FINANCE',
          actif: true,
          dateActivation: new Date(),
          dateDesactivation: null,
          activePar: TEST_DEFAULT_USER_ID,
        },
        {
          ecoleId: TEST_DEFAULT_ECOLE_ID,
          code: 'STOCK',
          actif: true,
          dateActivation: new Date(),
          dateDesactivation: null,
          activePar: TEST_DEFAULT_USER_ID,
        },
        {
          ecoleId: TEST_DEFAULT_ECOLE_ID,
          code: 'ENSEIGNANTS',
          actif: true,
          dateActivation: new Date(),
          dateDesactivation: null,
          activePar: TEST_DEFAULT_USER_ID,
        },
      ]),
    );
  });

  afterAll(async () => {
    await app.close();
    await repl.stop();
  });

  beforeEach(async () => {
    await runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
      schoolYearModel.updateMany(
        { status: SchoolYearStatus.OPEN },
        { status: SchoolYearStatus.CLOSED },
      ),
    );
  });

  it('exige une cloture manuelle avant d activer l annee suivante', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const sourceYear = await schoolYearModel.create({
        label: '2035-2036',
        startDate: new Date('2035-09-01'),
        endDate: new Date('2036-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const targetYear = await schoolYearModel.create({
        label: '2036-2037',
        startDate: new Date('2036-09-01'),
        endDate: new Date('2037-06-30'),
        status: SchoolYearStatus.DRAFT,
      });

      const prematureActivation = await request(app.getHttpServer())
        .post(`/settings/school-years/${targetYear._id}/status`)
        .set('x-test-role', 'direction')
        .send({ status: SchoolYearStatus.OPEN });
      expect(prematureActivation.status).toBe(400);

      const manualClosure = await request(app.getHttpServer())
        .post(`/settings/school-years/${sourceYear._id}/status`)
        .set('x-test-role', 'direction')
        .send({ status: SchoolYearStatus.CLOSED });
      expect(manualClosure.status).toBe(302);

      const activation = await request(app.getHttpServer())
        .post(`/settings/school-years/${targetYear._id}/status`)
        .set('x-test-role', 'direction')
        .send({ status: SchoolYearStatus.OPEN });
      expect(activation.status).toBe(302);

      expect(
        (await schoolYearModel.findById(sourceYear._id).lean())?.status,
      ).toBe(SchoolYearStatus.CLOSED);
      expect(
        (await schoolYearModel.findById(targetYear._id).lean())?.status,
      ).toBe(SchoolYearStatus.OPEN);
    }));

  it('empeche la double inscription active', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-002',
        lastname: 'Konan',
        firstname: 'Awa',
        gender: 'F',
        birthDate: new Date('2013-05-15'),
        birthPlace: 'Bouake',
        district: 'Belleville',
        status: 'active',
      });
      const year = await schoolYearModel.create({
        label: '2027-2028',
        startDate: new Date('2027-09-01'),
        endDate: new Date('2028-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: 'CP2',
        label: 'CP2',
        sortOrder: 2,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 50000,
      });

      await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });

      // Resubmitting the create form for a student already actively enrolled
      // this year, with no payment amount, is not a duplicate-enrollment
      // attempt worth a hard error - EnrollmentsController.create() redirects
      // with a flash message instead (see the dedicated describe block
      // below for the case that record another payment instead).
      const response = await request(app.getHttpServer())
        .post('/enrollments')
        .set('x-test-role', 'secretariat')
        .send({
          studentId: String(student._id),
          schoolYearId: String(year._id),
          levelId: String(level._id),
          type: 'initial',
          applyOpenArrears: 'false',
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).not.toContain('/receipts/');
      const enrollmentCount = await enrollmentModel.countDocuments({
        studentId: student._id,
        schoolYearId: year._id,
      });
      expect(enrollmentCount).toBe(1);
    }));

  it('EnrollmentsService.createEnrollment refuse toujours une double inscription active au niveau service', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-002-SVC',
        lastname: 'Konan',
        firstname: 'Service',
        gender: 'F',
        status: 'active',
      });
      const year = await schoolYearModel.create({
        label: '2028-2029-SVC',
        startDate: new Date('2028-09-01'),
        endDate: new Date('2029-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: 'CP2-SVC',
        label: 'CP2-SVC',
        sortOrder: 2029,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 50000,
      });
      await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });

      await expect(
        enrollmentsService.createEnrollment({
          studentId: String(student._id),
          schoolYearId: String(year._id),
          levelId: String(level._id),
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        }),
      ).rejects.toThrow('Double inscription active interdite pour cette année');
    }));

  it("GET /enrollments/:id preselectionne le bon eleve, la bonne annee et le bon niveau dans le formulaire d'edition", () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      // A second student is essential here: with only one in the list,
      // "the first option happens to be selected" and "the right option is
      // selected" render identically, hiding the bug this test exists to
      // catch (see enrollments/detail.njk - a Nunjucks `==` between two
      // populated ObjectId instances is always false, so the intended
      // option was never actually marked selected; the browser then
      // defaulted to whichever option a same-collection Mongo query
      // happened to list first).
      const otherStudent = await studentModel.create({
        matricule: 'MAT-900',
        lastname: 'Autre',
        firstname: 'Eleve',
        gender: 'M',
        status: 'active',
      });
      const student = await studentModel.create({
        matricule: 'MAT-901',
        lastname: 'Zoutome',
        firstname: 'Bakoe',
        gender: 'F',
        status: 'active',
      });
      void otherStudent;
      const year = await schoolYearModel.create({
        label: '2090-2091',
        startDate: new Date('2090-09-01'),
        endDate: new Date('2091-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: 'CP1-DETAIL',
        label: 'CP1',
        sortOrder: 190,
      });
      // The level dropdown on the detail page is populated from
      // listForSchoolYear(), which only lists levels explicitly enabled for
      // that school year (SchoolYearLevel.isEnabled) - not just any Level
      // document that exists. Without this the option this test looks for
      // isn't rendered at all.
      await levelsService.enableForSchoolYear(
        String(year._id),
        String(level._id),
      );
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 40000,
      });
      const { enrollmentId } = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });

      const response = await request(app.getHttpServer())
        .get(`/enrollments/${enrollmentId}`)
        .set('x-test-role', 'secretariat');

      expect(response.status).toBe(200);
      expect(response.text).toContain(
        `value="${String(student._id)}" selected`,
      );
      expect(response.text).not.toContain(
        `value="${String(otherStudent._id)}" selected`,
      );
      expect(response.text).toContain(`value="${String(year._id)}" selected`);
      // Niveau: nothing preselected - the blank placeholder is the selected
      // option and the current level only appears as text.
      expect(response.text).not.toContain(
        `value="${String(level._id)}" selected`,
      );
      expect(response.text).toContain('<option value="" selected>');
      // The four enrollment fields are all mandatory in the edit form.
      for (const field of ['studentId', 'schoolYearId', 'levelId', 'type']) {
        expect(response.text).toContain(`<select name="${field}" required>`);
      }

      // ...and on the creation form (Eleve is the autocomplete input, Annee
      // is fixed to the selected year).
      const createPage = await request(app.getHttpServer())
        .get('/enrollments')
        .set('x-test-role', 'secretariat');
      expect(createPage.status).toBe(200);
      expect(createPage.text).toContain('<select name="levelId" required>');
      expect(createPage.text).toContain('<select name="type" required>');
      expect(createPage.text).toContain('id="studentSearchInput"');
      expect(createPage.text).toMatch(
        /autocomplete="off"\s+required\s+placeholder="Rechercher un élève/,
      );
    }));

  it('PUT /enrollments/:id change uniquement le niveau sans provoquer une double inscription', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-902',
        lastname: 'Niveau',
        firstname: 'Test',
        gender: 'M',
        status: 'active',
      });
      const year = await schoolYearModel.create({
        label: '2091-2092',
        startDate: new Date('2091-09-01'),
        endDate: new Date('2092-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const oldLevel = await levelModel.create({
        code: 'CP1-OLD',
        label: 'CP1',
        sortOrder: 191,
      });
      const newLevel = await levelModel.create({
        code: '3E-NEW',
        label: '3e',
        sortOrder: 192,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(oldLevel._id),
        registrationFee: 10000,
        tuitionFee: 40000,
      });
      const { enrollmentId } = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(oldLevel._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });

      // Body mirrors exactly what the real edit form submits: every field,
      // including the unchanged studentId - not just the one the user
      // actually touched. The real browser form POSTs with ?_method=PUT
      // (method-override, only wired up in main.ts's real bootstrap, not
      // this test harness) - a direct PUT reaches the exact same
      // EnrollmentsController route without needing that middleware here.
      const response = await request(app.getHttpServer())
        .put(`/enrollments/${enrollmentId}`)
        .set('x-test-role', 'secretariat')
        .send({
          studentId: String(student._id),
          schoolYearId: String(year._id),
          levelId: String(newLevel._id),
          type: 'initial',
        });

      expect(response.status).not.toBe(409);
      expect(response.status).toBe(302);
      const updated = await enrollmentModel.findById(enrollmentId).lean();
      expect(String(updated?.levelId)).toBe(String(newLevel._id));

      // Saving again with the Niveau placeholder left blank must keep the
      // current level rather than fail validation.
      const blankLevel = await request(app.getHttpServer())
        .put(`/enrollments/${enrollmentId}`)
        .set('x-test-role', 'secretariat')
        .send({
          studentId: String(student._id),
          schoolYearId: String(year._id),
          levelId: '',
          type: 'initial',
        });
      expect(blankLevel.status).toBe(302);
      const unchanged = await enrollmentModel.findById(enrollmentId).lean();
      expect(String(unchanged?.levelId)).toBe(String(newLevel._id));
    }));

  it('POST /students cree un dossier eleve sans date de naissance, lieu de naissance ni quartier', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const level = await levelModel.create({
        code: 'MIN-903',
        label: 'MIN-903',
        sortOrder: 903,
      });
      const response = await request(app.getHttpServer())
        .post('/students')
        .set('x-test-role', 'secretariat')
        .send({
          matricule: 'MAT-903',
          lastname: 'Minimal',
          firstname: 'Dossier',
          gender: 'M',
          levelId: String(level._id),
        });

      expect(response.status).toBe(302);
      const created = await studentModel
        .findOne({ matricule: 'MAT-903' })
        .lean();
      expect(created).toBeTruthy();
      expect(created?.birthDate).toBeUndefined();
      expect(created?.birthPlace).toBeUndefined();
      expect(created?.district).toBeUndefined();
    }));

  it('POST /students/:id/reenroll ajoute les impayes passes a la nouvelle facture', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-003',
        lastname: 'Kouassi',
        firstname: 'Marc',
        gender: 'M',
        birthDate: new Date('2012-08-01'),
        birthPlace: 'Daloa',
        district: 'Centre',
        status: 'active',
      });
      const year1 = await schoolYearModel.create({
        label: '2024-2025',
        startDate: new Date('2024-09-01'),
        endDate: new Date('2025-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const year2 = await schoolYearModel.create({
        label: '2025-2026-B',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-06-30'),
        status: SchoolYearStatus.DRAFT,
      });
      const level = await levelModel.create({
        code: 'CE1',
        label: 'CE1',
        sortOrder: 3,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year1._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 30000,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year2._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 35000,
      });
      const oldEnrollment = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year1._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });
      await billingService.createOrUpdateInvoice({
        schoolYearId: String(year1._id),
        enrollmentId: oldEnrollment.enrollmentId,
        registrationFee: 10000,
        tuitionFee: 30000,
        discountAmount: 0,
        arrearsAmount: 0,
        paidAmount: 5000,
      });
      await schoolYearModel.updateOne(
        { _id: year1._id },
        { status: SchoolYearStatus.CLOSED },
      );
      await schoolYearModel.updateOne(
        { _id: year2._id },
        { status: SchoolYearStatus.OPEN },
      );

      const response = await request(app.getHttpServer())
        .post(`/students/${student._id}/reenroll`)
        .set('x-test-role', 'secretariat')
        .send({
          targetSchoolYearId: String(year2._id),
          targetLevelId: String(level._id),
          carryOverArrears: 'true',
        });

      expect(response.status).toBe(302);
      const enrollments = await enrollmentsService.findStudentHistory(
        String(student._id),
      );
      const newEnrollment = enrollments.find(
        (item: any) =>
          String(item.schoolYearId?._id ?? item.schoolYearId) ===
          String(year2._id),
      );
      const invoice = await billingService.findInvoiceByEnrollment(
        String(newEnrollment?._id),
      );
      expect(invoice?.arrearsAmount).toBe(35000);
    }));

  it('POST /payments cree un recu unique', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-004',
        lastname: 'Yao',
        firstname: 'Lina',
        gender: 'F',
        birthDate: new Date('2011-03-10'),
        birthPlace: 'Man',
        district: 'Nord',
        status: 'active',
      });
      const year = await schoolYearModel.create({
        label: '2028-2029',
        startDate: new Date('2028-09-01'),
        endDate: new Date('2029-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: 'CM1',
        label: 'CM1',
        sortOrder: 5,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 15000,
        tuitionFee: 60000,
      });
      const enrollment = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });
      const invoice = await billingService.findInvoiceByEnrollment(
        enrollment.enrollmentId,
      );

      const first = await request(app.getHttpServer())
        .post('/payments')
        .set('x-test-role', 'comptabilite')
        .send({
          invoiceId: String(invoice?._id),
          amount: 10000,
          method: PaymentMethod.CASH,
        });
      const second = await request(app.getHttpServer())
        .post('/payments')
        .set('x-test-role', 'comptabilite')
        .send({
          invoiceId: String(invoice?._id),
          amount: 5000,
          method: PaymentMethod.CASH,
        });

      expect(first.status).toBe(302);
      expect(second.status).toBe(302);
      const payments = await paymentModel
        .find({ invoiceId: String(invoice?._id) })
        .lean()
        .exec();
      expect(payments).toHaveLength(2);
      expect(payments[0].receiptNumber).not.toBe(payments[1].receiptNumber);
    }));

  it('GET /enrollments?q= recherche par nom, matricule ou niveau et garde la pagination', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const unique = `${Date.now()}`.slice(-8);
      const year = await schoolYearModel.create({
        label: `SRCH-${unique}`,
        startDate: new Date('2093-09-01'),
        endDate: new Date('2094-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const [cp, ce] = await Promise.all(
        ['CPX', 'CEX'].map((code, index) =>
          levelModel.create({
            code: `${code}${unique}`,
            label: `${code} ${unique}`,
            sortOrder: 200000 + Number(unique) + index,
          }),
        ),
      );
      for (const level of [cp, ce]) {
        await levelsService.enableForSchoolYear(
          String(year._id),
          String(level._id),
        );
        await billingService.upsertFeeSchedule({
          schoolYearId: String(year._id),
          levelId: String(level._id),
          registrationFee: 0,
          tuitionFee: 1000,
        });
      }
      const people = [
        ['Zoumaro', 'Aristide', cp],
        ['Zoumaro', 'Beatrice', ce],
        ['Ébène', 'Carole', cp],
      ] as const;
      for (const [index, [lastname, firstname, level]] of people.entries()) {
        const student = await studentModel.create({
          matricule: `SRCH-${unique}-${index}`,
          lastname,
          firstname,
          gender: 'M',
          status: 'active',
        });
        await enrollmentsService.createEnrollment({
          studentId: String(student._id),
          schoolYearId: String(year._id),
          levelId: String(level._id),
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        });
      }

      const search = async (q: string) => {
        const response = await request(app.getHttpServer())
          .get('/enrollments')
          .query({ q })
          .set('x-test-role', 'secretariat');
        expect(response.status).toBe(200);
        return response.text;
      };
      const rowsOf = (html: string) =>
        (html.match(/href="\/enrollments\/[a-f0-9]{24}">Voir<\/a>/g) ?? [])
          .length;

      // by last name, prefix/contains, accents and case ignored
      expect(rowsOf(await search('zoumaro'))).toBe(2);
      expect(rowsOf(await search('ebene'))).toBe(1);
      // by matricule
      expect(rowsOf(await search(`SRCH-${unique}-1`))).toBe(1);
      // by level, and every word must match (student AND level)
      expect(rowsOf(await search(`CPX${unique}`))).toBe(2);
      expect(rowsOf(await search(`zoumaro CEX${unique}`))).toBe(1);
      // no match, and regex characters are not interpreted
      const none = await search('(((');
      expect(rowsOf(none)).toBe(0);
      expect(none).toContain('Aucune inscription ne correspond');
      // search box keeps the typed text and pagination carries it
      const html = await search('zoumaro');
      expect(html).toContain('name="q" value="zoumaro"');
      expect(html).toContain('2 résultat(s)');
    }));

  describe('recherche et filtres sur la liste des eleves', () => {
    it("filtre par niveau, statut, matricule exact et par annee scolaire independamment de l'annee selectionnee", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        // Only one year can be OPEN at a time - otherYear is created OPEN
        // first so its enrollment can be created normally, then closed
        // before selectedYear opens.
        const selectedYear = await schoolYearModel.create({
          label: `FLT-SEL-${unique}`,
          startDate: new Date('2096-09-01'),
          endDate: new Date('2097-06-30'),
          status: SchoolYearStatus.DRAFT,
        });
        const otherYear = await schoolYearModel.create({
          label: `FLT-OTH-${unique}`,
          startDate: new Date('2095-09-01'),
          endDate: new Date('2096-06-30'),
          status: SchoolYearStatus.OPEN,
        });
        const [levelA, levelB] = await Promise.all(
          ['A', 'B'].map((tag, index) =>
            levelModel.create({
              code: `F${tag}${unique}`,
              label: `F${tag}${unique}`,
              sortOrder: 400000 + Number(unique.slice(-4)) + index,
            }),
          ),
        );
        for (const [year, level] of [
          [selectedYear, levelA],
          [selectedYear, levelB],
          [otherYear, levelA],
        ] as const) {
          await levelsService.enableForSchoolYear(
            String(year._id),
            String(level._id),
          );
          await billingService.upsertFeeSchedule({
            schoolYearId: String(year._id),
            levelId: String(level._id),
            registrationFee: 0,
            tuitionFee: 1000,
          });
        }

        const matricule = `FLT-${unique}`;
        const studentA = await studentModel.create({
          matricule,
          lastname: 'Filtre',
          firstname: 'Alpha',
          gender: 'F',
          status: 'active',
        });
        const studentB = await studentModel.create({
          matricule: `${matricule}-B`,
          lastname: 'Filtre',
          firstname: 'Beta',
          gender: 'M',
          status: 'archived',
        });
        const studentC = await studentModel.create({
          matricule: `${matricule}-C`,
          lastname: 'Filtre',
          firstname: 'Gamma',
          gender: 'M',
          status: 'active',
        });
        // otherYear is OPEN first: seed its enrollment now.
        await enrollmentsService.createEnrollment({
          studentId: String(studentC._id),
          schoolYearId: String(otherYear._id),
          levelId: String(levelA._id),
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        });
        await schoolYearModel.updateOne(
          { _id: otherYear._id },
          { status: SchoolYearStatus.CLOSED },
        );
        await schoolYearModel.updateOne(
          { _id: selectedYear._id },
          { status: SchoolYearStatus.OPEN },
        );
        // selectedYear is OPEN now: seed its enrollments.
        await enrollmentsService.createEnrollment({
          studentId: String(studentA._id),
          schoolYearId: String(selectedYear._id),
          levelId: String(levelA._id),
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        });
        await enrollmentsService.createEnrollment({
          studentId: String(studentB._id),
          schoolYearId: String(selectedYear._id),
          levelId: String(levelB._id),
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        });

        await request(app.getHttpServer())
          .post('/settings/school-years/select')
          .set('x-test-role', 'secretariat')
          .send({ schoolYearId: String(selectedYear._id) })
          .expect(302);

        const namesOf = (html: string) =>
          Array.from(html.matchAll(/Filtre (Alpha|Beta|Gamma)/g)).map(
            (match) => match[1],
          );

        // Niveau: only the selected year's students in levelA
        const byLevel = await request(app.getHttpServer())
          .get('/students')
          .query({ levelId: String(levelA._id) })
          .set('x-test-role', 'secretariat');
        expect(byLevel.status).toBe(200);
        expect(namesOf(byLevel.text).sort()).toEqual(['Alpha']);

        // Statut: archived only
        const byStatus = await request(app.getHttpServer())
          .get('/students')
          .query({ status: 'archived' })
          .set('x-test-role', 'secretariat');
        expect(namesOf(byStatus.text).sort()).toEqual(['Beta']);

        // Matricule: exact match only, not a prefix match on the other two
        const byMatricule = await request(app.getHttpServer())
          .get('/students')
          .query({ matricule })
          .set('x-test-role', 'secretariat');
        expect(namesOf(byMatricule.text).sort()).toEqual(['Alpha']);

        // Annee scolaire: browsing otherYear finds Gamma even though the
        // page's own selected year is still selectedYear.
        const byOtherYear = await request(app.getHttpServer())
          .get('/students')
          .query({ schoolYearId: String(otherYear._id) })
          .set('x-test-role', 'secretariat');
        expect(namesOf(byOtherYear.text).sort()).toEqual(['Gamma']);

        // Combined: level + status together narrow further than either alone
        const combined = await request(app.getHttpServer())
          .get('/students')
          .query({ levelId: String(levelB._id), status: 'archived' })
          .set('x-test-role', 'secretariat');
        expect(namesOf(combined.text).sort()).toEqual(['Beta']);

        // Export honours the same filters
        const exported = await request(app.getHttpServer())
          .get('/students/export')
          .query({ status: 'archived' })
          .set('x-test-role', 'secretariat');
        expect(exported.status).toBe(200);
        expect(exported.headers['content-type']).toContain('spreadsheetml');
      }));

    // Regression: a student can end up with no Enrollment at all for the
    // selected year even though their dossier genuinely exists - e.g. the
    // class's fee schedule wasn't configured yet when they were created,
    // which fails StudentsController.create()'s auto-enrollment step and
    // only shows a flash the user can miss ("l'inscription n'a pas ete
    // effectuee : Parametrage des frais introuvable"). Before this fix,
    // an exact-matricule search for exactly this student returned "Aucun
    // eleve trouve" - the Niveau/annee enrollment join silently excluded
    // them, even though the one identifier being searched on (the
    // matricule) matched precisely.
    it("trouve par matricule exact un eleve sans inscription pour l'annee en cours, meme filtre par niveau", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const selectedYear = await schoolYearModel.create({
          label: `ORPH-SEL-${unique}`,
          startDate: new Date('2098-09-01'),
          endDate: new Date('2099-06-30'),
          status: SchoolYearStatus.OPEN,
        });
        const level = await levelModel.create({
          code: `ORPH${unique}`,
          label: `ORPH${unique}`,
          sortOrder: 500000 + Number(unique.slice(-4)),
        });
        await levelsService.enableForSchoolYear(
          String(selectedYear._id),
          String(level._id),
        );

        const matricule = `ORPH-${unique}`;
        // Declares the class directly on the dossier, same as
        // StudentsController.create() always does regardless of whether
        // the enrollment step that follows succeeds - but no Enrollment
        // document is created here, reproducing that step having failed.
        await studentModel.create({
          matricule,
          lastname: 'SansInscription',
          firstname: 'Eleve',
          gender: 'M',
          status: 'active',
          levelId: level._id,
        });

        await request(app.getHttpServer())
          .post('/settings/school-years/select')
          .set('x-test-role', 'secretariat')
          .send({ schoolYearId: String(selectedYear._id) })
          .expect(302);

        const byMatricule = await request(app.getHttpServer())
          .get('/students')
          .query({ matricule })
          .set('x-test-role', 'secretariat');
        expect(byMatricule.status).toBe(200);
        expect(byMatricule.text).toContain('SansInscription');
        // Falls back to the class declared on the dossier (there is no
        // enrollment to read a current class from).
        expect(byMatricule.text).toContain(`ORPH${unique}`);

        // Still found when the Niveau filter is applied too, matched
        // against the student's own declared class.
        const byMatriculeAndLevel = await request(app.getHttpServer())
          .get('/students')
          .query({ matricule, levelId: String(level._id) })
          .set('x-test-role', 'secretariat');
        expect(byMatriculeAndLevel.text).toContain('SansInscription');

        // A Niveau filter for a DIFFERENT class still excludes them - the
        // fix only stops matricule from being over-restricted, it doesn't
        // make levelId a no-op.
        const otherLevel = await levelModel.create({
          code: `ORPHX${unique}`,
          label: `ORPHX${unique}`,
          sortOrder: 500001 + Number(unique.slice(-4)),
        });
        const byMatriculeWrongLevel = await request(app.getHttpServer())
          .get('/students')
          .query({ matricule, levelId: String(otherLevel._id) })
          .set('x-test-role', 'secretariat');
        expect(byMatriculeWrongLevel.text).not.toContain('SansInscription');
      }));
  });

  describe('creation eleve avec classe et inscription avec paiement immediat', () => {
    async function seedYearAndLevel(fee: {
      registrationFee: number;
      tuitionFee: number;
    }) {
      const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const year = await schoolYearModel.create({
        label: `QUICK-${unique}`,
        startDate: new Date('2094-09-01'),
        endDate: new Date('2095-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: `Q${unique}`,
        label: `Q${unique}`,
        sortOrder: 300000 + Math.floor(Math.random() * 600000),
      });
      await levelsService.enableForSchoolYear(
        String(year._id),
        String(level._id),
      );
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        ...fee,
      });
      return {
        yearId: String(year._id),
        levelId: String(level._id),
        label: level.label,
      };
    }

    async function seedStudent(tag: string) {
      return studentModel.create({
        matricule: `QK-${Date.now()}-${tag}`,
        lastname: `Quick${tag}`,
        firstname: 'Test',
        gender: 'F',
        status: 'active',
      });
    }

    it("enregistre la classe a la creation de l'eleve et l'affiche pour l'inscription", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { levelId, label } = await seedYearAndLevel({
          registrationFee: 0,
          tuitionFee: 1000,
        });
        const matricule = `QK-CLASS-${Date.now()}`;

        const created = await request(app.getHttpServer())
          .post('/students')
          .set('x-test-role', 'secretariat')
          .send({
            matricule,
            lastname: 'Classe',
            firstname: 'Eleve',
            gender: 'M',
            levelId,
          });
        expect(created.status).toBe(302);
        const student = await studentModel.findOne({ matricule }).lean();
        expect(String(student?.levelId)).toBe(levelId);

        const status = await request(app.getHttpServer())
          .get(`/students/${String(student?._id)}/financial-status`)
          .set('x-test-role', 'secretariat');
        expect(status.status).toBe(200);
        const body = status.body as {
          studentClass: { declared: string; declaredId: string };
        };
        expect(body.studentClass.declared).toBe(label);
        expect(body.studentClass.declaredId).toBe(levelId);

        // the enrollment page's own markup carries the same information for
        // its "just show the class" script to read.
        const enrollPage = await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-test-role', 'secretariat');
        expect(enrollPage.text).toContain('id="levelDisplay"');
        expect(enrollPage.text).toContain('<select name="levelId" required>');

        // the classe is mandatory on this form: a blank class (or none at
        // all) is rejected rather than silently creating a classless student.
        const blank = await request(app.getHttpServer())
          .post('/students')
          .set('x-test-role', 'secretariat')
          .send({
            matricule: `${matricule}-B`,
            lastname: 'Sans',
            firstname: 'Classe',
            gender: 'F',
            levelId: '',
          });
        expect(blank.status).toBe(400);
        const missing = await request(app.getHttpServer())
          .post('/students')
          .set('x-test-role', 'secretariat')
          .send({
            matricule: `${matricule}-C`,
            lastname: 'Sans',
            firstname: 'ClasseDuTout',
            gender: 'F',
          });
        expect(missing.status).toBe(400);
        expect(
          await studentModel.findOne({ matricule: `${matricule}-B` }).lean(),
        ).toBeNull();
      }));

    it("inscrit automatiquement l'eleve dans l'annee ouverte a la creation, et peut encaisser le paiement dans la foulee", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel({
          registrationFee: 5000,
          tuitionFee: 20000,
        });
        const matricule = `QK-AUTOENROLL-${Date.now()}`;

        // No payment: the student is still created and enrolled.
        const withoutPayment = await request(app.getHttpServer())
          .post('/students')
          .set('x-test-role', 'secretariat')
          .send({
            matricule,
            lastname: 'AutoEnroll',
            firstname: 'SansPaiement',
            gender: 'M',
            levelId,
          });
        expect(withoutPayment.status).toBe(302);
        expect(withoutPayment.headers.location).not.toContain('/receipts/');
        const studentA = await studentModel.findOne({ matricule }).lean();
        const enrollmentA = await enrollmentModel
          .findOne({ studentId: studentA?._id, schoolYearId: yearId })
          .lean();
        expect(enrollmentA).toBeTruthy();
        expect(enrollmentA?.status).toBe('active');
        const invoiceA = await billingService.findInvoiceByEnrollment(
          String(enrollmentA?._id),
        );
        expect(invoiceA?.paidAmount).toBe(0);

        // With a payment: created, enrolled, and paid - one redirect to the
        // receipt, no separate trip through /enrollments needed.
        const matriculeB = `${matricule}-PAY`;
        const withPayment = await request(app.getHttpServer())
          .post('/students')
          .set('x-test-role', 'secretariat')
          .send({
            matricule: matriculeB,
            lastname: 'AutoEnroll',
            firstname: 'AvecPaiement',
            gender: 'F',
            levelId,
            paymentAmount: '10000',
            paymentMethod: PaymentMethod.CASH,
            paymentReference: 'GUICHET-CREATION',
          });
        expect(withPayment.status).toBe(302);
        expect(withPayment.headers.location).toContain('/receipts/');
        const studentB = await studentModel
          .findOne({ matricule: matriculeB })
          .lean();
        const enrollmentB = await enrollmentModel
          .findOne({ studentId: studentB?._id, schoolYearId: yearId })
          .lean();
        const invoiceB = await billingService.findInvoiceByEnrollment(
          String(enrollmentB?._id),
        );
        expect(invoiceB?.paidAmount).toBe(10000);
        expect(invoiceB?.balanceDue).toBe(15000);
        const payments = await paymentModel
          .find({ invoiceId: invoiceB?._id })
          .lean();
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({
          amount: 10000,
          reference: 'GUICHET-CREATION',
        });
      }));

    it("refuse la creation sans paiement quand l'ecole exige le paiement a l'inscription (Settings.registrationPaymentRequired), l'autorise de nouveau une fois le reglage desactive", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel({
          registrationFee: 5000,
          tuitionFee: 20000,
        });
        const matricule = `QK-PAYREQ-${Date.now()}`;

        await settingsService.setRegistrationPaymentRequired(true);
        try {
          const withoutPayment = await request(app.getHttpServer())
            .post('/students')
            .set('x-test-role', 'secretariat')
            .send({
              matricule,
              lastname: 'PayReq',
              firstname: 'SansPaiement',
              gender: 'M',
              levelId,
            });
          expect(withoutPayment.status).toBe(302);
          expect(withoutPayment.headers.location).toBe('/students');
          expect(await studentModel.findOne({ matricule }).lean()).toBeNull();

          const withPayment = await request(app.getHttpServer())
            .post('/students')
            .set('x-test-role', 'secretariat')
            .send({
              matricule,
              lastname: 'PayReq',
              firstname: 'AvecPaiement',
              gender: 'M',
              levelId,
              paymentAmount: '5000',
              paymentMethod: PaymentMethod.CASH,
            });
          expect(withPayment.status).toBe(302);
          expect(withPayment.headers.location).toContain('/receipts/');
          const created = await studentModel.findOne({ matricule }).lean();
          expect(created).toBeTruthy();
          const enrollment = await enrollmentModel
            .findOne({ studentId: created?._id, schoolYearId: yearId })
            .lean();
          expect(enrollment).toBeTruthy();
        } finally {
          // This ecole is shared across the whole spec file - never leave
          // the requirement on for tests defined after this one.
          await settingsService.setRegistrationPaymentRequired(false);
        }

        // Reglage desactive (comportement par defaut) : le paiement reste
        // facultatif, comme avant l'existence de ce reglage.
        const matriculeOptional = `${matricule}-OPT`;
        const stillOptional = await request(app.getHttpServer())
          .post('/students')
          .set('x-test-role', 'secretariat')
          .send({
            matricule: matriculeOptional,
            lastname: 'PayReq',
            firstname: 'Optionnel',
            gender: 'F',
            levelId,
          });
        expect(stillOptional.status).toBe(302);
        expect(stillOptional.headers.location).not.toContain('/receipts/');
        expect(
          await studentModel.findOne({ matricule: matriculeOptional }).lean(),
        ).toBeTruthy();
      }));

    it('inscrit et enregistre le paiement en une seule etape, puis redirige vers le recu', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel({
          registrationFee: 5000,
          tuitionFee: 20000,
        });
        const student = await seedStudent('A');

        const response = await request(app.getHttpServer())
          .post('/enrollments')
          .set('x-test-role', 'secretariat')
          .send({
            studentId: String(student._id),
            schoolYearId: yearId,
            levelId,
            type: 'initial',
            paymentAmount: '10000',
            paymentMethod: PaymentMethod.CASH,
            paymentReference: 'GUICHET-1',
          });
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('/receipts/');

        const enrollment = await enrollmentModel
          .findOne({ studentId: student._id })
          .lean();
        const invoice = await billingService.findInvoiceByEnrollment(
          String(enrollment?._id),
        );
        expect(invoice?.paidAmount).toBe(10000);
        expect(invoice?.balanceDue).toBe(15000);
        const payments = await paymentModel
          .find({ invoiceId: String(invoice?._id) })
          .lean();
        expect(payments).toHaveLength(1);
        expect(payments[0]).toMatchObject({
          amount: 10000,
          reference: 'GUICHET-1',
          kind: 'payment',
        });
        // the receipt can be opened by the same role that took the payment
        const receipt = await request(app.getHttpServer())
          .get(response.headers.location)
          .set('x-test-role', 'secretariat');
        expect(receipt.status).toBe(200);
      }));

    it('inscrit sans paiement quand le montant est vide ou nul', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel({
          registrationFee: 0,
          tuitionFee: 8000,
        });
        for (const [tag, amount] of [
          ['B', ''],
          ['C', '0'],
        ] as const) {
          const student = await seedStudent(tag);
          const response = await request(app.getHttpServer())
            .post('/enrollments')
            .set('x-test-role', 'secretariat')
            .send({
              studentId: String(student._id),
              schoolYearId: yearId,
              levelId,
              type: 'initial',
              paymentAmount: amount,
              paymentMethod: PaymentMethod.CASH,
            });
          expect(response.status).toBe(302);
          expect(response.headers.location).toContain('/enrollments/');
          const enrollment = await enrollmentModel
            .findOne({ studentId: student._id })
            .lean();
          const invoice = await billingService.findInvoiceByEnrollment(
            String(enrollment?._id),
          );
          expect(invoice?.paidAmount).toBe(0);
        }
      }));

    it("garde l'inscription et signale l'erreur quand le paiement depasse le solde", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel({
          registrationFee: 0,
          tuitionFee: 8000,
        });
        const student = await seedStudent('D');

        const response = await request(app.getHttpServer())
          .post('/enrollments')
          .set('x-test-role', 'secretariat')
          .send({
            studentId: String(student._id),
            schoolYearId: yearId,
            levelId,
            type: 'initial',
            paymentAmount: '999999',
            paymentMethod: PaymentMethod.CASH,
          });
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('/enrollments/');
        const enrollment = await enrollmentModel
          .findOne({ studentId: student._id })
          .lean();
        expect(enrollment).toBeTruthy();
        expect(
          await paymentModel.countDocuments({
            invoiceId: (
              await billingService.findInvoiceByEnrollment(
                String(enrollment?._id),
              )
            )?._id,
          }),
        ).toBe(0);
      }));
  });

  // Client report: a payment entered by mistake was "cancelled" by lowering
  // the invoice's Montant paye, but the dashboard kept the old total (it adds
  // up the payment ledger, not the invoice) and no longer matched the printed
  // lists.
  describe('inscription deja existante : payer au lieu de refuser en double', () => {
    // Client report: paying a second time (installments) for a student
    // already enrolled this year, through the same /enrollments form used to
    // enroll them, failed with "Double inscription active interdite" - a
    // guard meant to stop a genuine duplicate enrollment, not a payment.
    async function seedYearAndLevel() {
      const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const year = await schoolYearModel.create({
        label: `PAYAGAIN-${unique}`,
        startDate: new Date('2097-09-01'),
        endDate: new Date('2098-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: `PA${unique}`,
        label: `PA${unique}`,
        sortOrder: 500000 + Math.floor(Math.random() * 400000),
      });
      await levelsService.enableForSchoolYear(
        String(year._id),
        String(level._id),
      );
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 5000,
        tuitionFee: 40000,
      });
      return { yearId: String(year._id), levelId: String(level._id) };
    }

    it('enregistre un second paiement au lieu de rejeter la resoumission comme une double inscription', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel();
        const student = await studentModel.create({
          matricule: `PA-${Date.now()}`,
          lastname: 'DejaInscrit',
          firstname: 'Eleve',
          gender: 'M',
          status: 'active',
        });
        const enrollment = await enrollmentsService.createEnrollment({
          studentId: String(student._id),
          schoolYearId: yearId,
          levelId,
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        });

        // Resubmitting the same create form (student already enrolled this
        // year) with a payment amount must succeed as a payment, not 409.
        const response = await request(app.getHttpServer())
          .post('/enrollments')
          .set('x-test-role', 'secretariat')
          .send({
            studentId: String(student._id),
            schoolYearId: yearId,
            levelId,
            type: 'initial',
            paymentAmount: '10000',
            paymentMethod: PaymentMethod.CASH,
          });
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('/receipts/');

        const invoice = await billingService.findInvoiceByEnrollment(
          enrollment.enrollmentId,
        );
        expect(invoice?.paidAmount).toBe(10000);
        // Still exactly one enrollment for this student this year - no
        // duplicate was created.
        const enrollmentCount = await enrollmentModel.countDocuments({
          studentId: student._id,
          schoolYearId: yearId,
        });
        expect(enrollmentCount).toBe(1);
      }));

    it('sans montant, redirige avec un message clair plutot que le jargon "Double inscription"', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await seedYearAndLevel();
        const student = await studentModel.create({
          matricule: `PA-${Date.now()}-B`,
          lastname: 'DejaInscritSansPaiement',
          firstname: 'Eleve',
          gender: 'M',
          status: 'active',
        });
        await enrollmentsService.createEnrollment({
          studentId: String(student._id),
          schoolYearId: yearId,
          levelId,
          type: EnrollmentType.INITIAL,
          applyOpenArrears: 'false',
        });

        const response = await request(app.getHttpServer())
          .post('/enrollments')
          .set('x-test-role', 'secretariat')
          .send({
            studentId: String(student._id),
            schoolYearId: yearId,
            levelId,
            type: 'initial',
          });
        expect(response.status).toBe(302);
        expect(response.headers.location).not.toContain('/receipts/');
      }));
  });

  describe('correction du montant paye et registre des paiements', () => {
    async function seedPaidEnrollment(
      tag: string,
      year: string,
      level: string,
    ) {
      const student = await studentModel.create({
        matricule: `MAT-LEDG-${tag}`,
        lastname: `Ledger${tag}`,
        firstname: 'Test',
        gender: 'M',
        status: 'active',
      });
      const enrollment = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: year,
        levelId: level,
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });
      const invoice = await billingService.findInvoiceByEnrollment(
        enrollment.enrollmentId,
      );
      return {
        enrollmentId: enrollment.enrollmentId,
        invoiceId: String(invoice?._id),
      };
    }

    // Unique per call: the test database is shared across runs/tests and
    // years/levels are unique by label/code/sortOrder.
    async function setup() {
      const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const year = await schoolYearModel.create({
        label: `LEDG-${unique}`,
        startDate: new Date('2091-09-01'),
        endDate: new Date('2092-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: `L${unique}`,
        label: `L${unique}`,
        sortOrder: 100000 + Math.floor(Math.random() * 900000),
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 0,
        tuitionFee: 100000,
      });
      return { yearId: String(year._id), levelId: String(level._id) };
    }

    it('annuler un paiement en corrigeant le montant paye met aussi a jour le tableau de bord', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await setup();
        const { enrollmentId, invoiceId } = await seedPaidEnrollment(
          'A',
          yearId,
          levelId,
        );
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({ invoiceId, amount: 20000, method: PaymentMethod.CASH })
          .expect(302);
        expect((await dashboardService.getSummary(yearId)).revenue).toBe(20000);

        // The client cancels 10 000 F entered by mistake.
        const response = await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentId}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ paidAmount: '10000', reason: 'Paiement saisi par erreur' });
        expect(response.status).toBe(302);

        const summary = await dashboardService.getSummary(yearId);
        expect(summary.revenue).toBe(10000);
        expect(summary.tuitionRevenue).toBe(10000);
        expect(summary.ledgerDivergence).toEqual({ count: 0, total: 0 });
        // The dashboard's own "modifications de paiement" indicator - the
        // fresh 20 000 F payment above must not count, only the correction.
        expect(summary.paymentCorrectionsCount).toBe(1);
        const invoice =
          await billingService.findInvoiceByEnrollment(enrollmentId);
        expect(invoice?.paidAmount).toBe(10000);
        expect(invoice?.balanceDue).toBe(90000);
      }));

    it('historique des modifications de paiement : liste uniquement les corrections, jamais une remise seule ni un paiement ordinaire', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await setup();
        const { enrollmentId, invoiceId } = await seedPaidEnrollment(
          'HIST',
          yearId,
          levelId,
        );
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({ invoiceId, amount: 15000, method: PaymentMethod.CASH })
          .expect(302);

        // A discount-only edit (no paidAmount change) must NOT show up as a
        // payment modification.
        await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentId}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ discountAmount: '2000', reason: 'Remise accordee' })
          .expect(302);
        expect(
          (await dashboardService.getSummary(yearId)).paymentCorrectionsCount,
        ).toBe(0);
        const afterDiscountOnly =
          await enrollmentsService.getPaymentModificationsHistory(yearId);
        expect(afterDiscountOnly.total).toBe(0);

        // Correcting the paid amount itself must show up, with the actual
        // before/after amounts, the reason and the student it belongs to.
        await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentId}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ paidAmount: '9000', reason: 'Paiement en trop annule' })
          .expect(302);

        const history =
          await enrollmentsService.getPaymentModificationsHistory(yearId);
        expect(history.total).toBe(1);
        expect(history.rows[0]).toMatchObject({
          enrollmentId,
          studentName: 'LedgerHIST Test',
          paidBefore: 15000,
          paidAfter: 9000,
          delta: -6000,
          reason: 'Paiement en trop annule',
          actorName: 'Utilisateur inconnu',
        });
        expect(
          (await dashboardService.getSummary(yearId)).paymentCorrectionsCount,
        ).toBe(1);
      }));

    it('la page /payments/corrections affiche les corrections et refuse un role sans acces financier', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await setup();
        const { enrollmentId, invoiceId } = await seedPaidEnrollment(
          'PAGE',
          yearId,
          levelId,
        );
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({ invoiceId, amount: 20000, method: PaymentMethod.CASH })
          .expect(302);
        await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentId}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ paidAmount: '5000', reason: 'Erreur de saisie' })
          .expect(302);

        const page = await request(app.getHttpServer())
          .get('/payments/corrections')
          .set('x-test-role', 'comptabilite');
        expect(page.status).toBe(200);
        expect(page.text).toContain('Historique des modifications de paiement');
        expect(page.text).toContain('LedgerPAGE Test');
        expect(page.text).toContain('Erreur de saisie');

        // Secretariat has no financial-oversight role and must not reach it.
        const forbidden = await request(app.getHttpServer())
          .get('/payments/corrections')
          .set('x-test-role', 'secretariat');
        expect(forbidden.status).toBe(403);
      }));

    it('le filtre par classe du tableau de bord ne compte que les eleves, recettes et corrections de cette classe', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId: levelA } = await setup();
        // setup() opens a fresh OPEN school year - only one is allowed per
        // school (unique index), so the second level is created directly
        // instead of via another setup() call, with its own fee schedule
        // added for the same yearId.
        const uniqueB = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const levelBDoc = await levelModel.create({
          code: `LB${uniqueB}`,
          label: `LB${uniqueB}`,
          sortOrder: 100000 + Math.floor(Math.random() * 900000),
        });
        const levelB = String(levelBDoc._id);
        await billingService.upsertFeeSchedule({
          schoolYearId: yearId,
          levelId: levelB,
          registrationFee: 0,
          tuitionFee: 100000,
        });

        const { invoiceId: invoiceA } = await seedPaidEnrollment(
          'FILT-A',
          yearId,
          levelA,
        );
        const { enrollmentId: enrollmentB, invoiceId: invoiceB } =
          await seedPaidEnrollment('FILT-B', yearId, levelB);

        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({
            invoiceId: invoiceA,
            amount: 30000,
            method: PaymentMethod.CASH,
          })
          .expect(302);
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({
            invoiceId: invoiceB,
            amount: 40000,
            method: PaymentMethod.CASH,
          })
          .expect(302);
        await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentB}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ paidAmount: '35000', reason: 'Paiement en trop annule' })
          .expect(302);

        const global = await dashboardService.getSummary(yearId);
        expect(global.totalStudents).toBe(2);
        expect(global.revenue).toBe(65000);
        expect(global.paymentCorrectionsCount).toBe(1);

        const onlyA = await dashboardService.getSummary(yearId, {
          levelId: levelA,
        });
        expect(onlyA.totalStudents).toBe(1);
        expect(onlyA.revenue).toBe(30000);
        expect(onlyA.paymentCorrectionsCount).toBe(0);

        const onlyB = await dashboardService.getSummary(yearId, {
          levelId: levelB,
        });
        expect(onlyB.totalStudents).toBe(1);
        expect(onlyB.revenue).toBe(35000);
        expect(onlyB.paymentCorrectionsCount).toBe(1);
      }));

    it('le filtre par date du tableau de bord ne compte que les recettes et corrections de la periode, jamais les effectifs ni la coherence du registre', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await setup();
        const { enrollmentId, invoiceId } = await seedPaidEnrollment(
          'DATE',
          yearId,
          levelId,
        );

        // One payment backdated to January, one made "today".
        const januaryPayment = await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({ invoiceId, amount: 30000, method: PaymentMethod.CASH })
          .expect(302);
        const januaryPaymentId = januaryPayment.headers.location
          .split('/')
          .pop();
        await paymentModel.updateOne(
          { _id: januaryPaymentId },
          { paidAt: new Date('2026-01-15T10:00:00.000Z') },
        );
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({
            invoiceId,
            amount: 20000,
            method: PaymentMethod.MOBILE_MONEY,
          })
          .expect(302);
        // A correction, also backdated to January.
        await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentId}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ paidAmount: '45000', reason: 'Paiement en trop annule' })
          .expect(302);
        await paymentModel.updateOne(
          { invoiceId, kind: 'correction' },
          { $set: { paidAt: new Date('2026-01-16T10:00:00.000Z') } },
        );
        const correctionLogsBefore = await auditLogModel
          .find({ entityId: enrollmentId, action: 'payment_corrected' })
          .lean()
          .exec();
        expect(correctionLogsBefore).toHaveLength(1);
        // Mongoose marks a schema's `timestamps: true` createdAt path
        // immutable, so a Mongoose-level updateOne silently drops any
        // attempt to change it - go through the native driver collection
        // instead, which has no such restriction.
        await auditLogModel.collection.updateOne(
          { _id: correctionLogsBefore[0]._id },
          { $set: { createdAt: new Date('2026-01-16T10:00:00.000Z') } },
        );

        const global = await dashboardService.getSummary(yearId);
        expect(global.revenue).toBe(45000); // 30000 + 20000 - 5000
        expect(global.paymentCorrectionsCount).toBe(1);
        expect(global.ledgerDivergence).toEqual({ count: 0, total: 0 });

        const januaryOnly = await dashboardService.getSummary(yearId, {
          dateFrom: new Date('2026-01-01T00:00:00.000Z'),
          dateTo: new Date('2026-01-31T23:59:59.999Z'),
        });
        expect(januaryOnly.revenue).toBe(25000); // 30000 - 5000 correction
        expect(januaryOnly.paymentCorrectionsCount).toBe(1);
        // Never date-scoped: state-based figures and the reconciliation
        // check both stay exactly as without any date filter.
        expect(januaryOnly.totalStudents).toBe(global.totalStudents);
        expect(januaryOnly.arrearsOpen).toBe(global.arrearsOpen);
        expect(januaryOnly.ledgerDivergence).toEqual({ count: 0, total: 0 });

        const todayOnly = await dashboardService.getSummary(yearId, {
          dateFrom: new Date(new Date().toDateString()),
          dateTo: new Date(),
        });
        expect(todayOnly.revenue).toBe(20000);
        expect(todayOnly.paymentCorrectionsCount).toBe(0);

        // Chart-ready shapes, built from the very same (date-scoped) figures.
        expect(januaryOnly.charts.revenueByCategory).toEqual([
          { label: "Frais d'inscription", value: 0 },
          { label: 'Frais d’écolage', value: 25000 },
          { label: 'Dépenses', value: 0 },
        ]);
        expect(januaryOnly.charts.recoveryBreakdown[0]).toMatchObject({
          label: 'Encaissé',
          value: 25000,
        });
        const levelLabel = (await levelModel.findById(levelId).lean().exec())
          ?.label;
        expect(
          januaryOnly.charts.studentsByLevel.find(
            (row) => row.label === levelLabel,
          ),
        ).toMatchObject({ count: 1 });

        // The page itself accepts and re-renders the range.
        const page = await request(app.getHttpServer())
          .get('/dashboard')
          .query({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
          .set('x-test-role', 'comptabilite');
        expect(page.status).toBe(200);
        expect(page.text).toContain('value="2026-01-01"');
        expect(page.text).toContain('value="2026-01-31"');
      }));

    it('detecte et corrige un ecart deja existant entre la facture et les paiements', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await setup();
        const { enrollmentId, invoiceId } = await seedPaidEnrollment(
          'B',
          yearId,
          levelId,
        );
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({ invoiceId, amount: 8000, method: PaymentMethod.CASH })
          .expect(302);
        // Data as the old behaviour left it: invoice lowered, ledger untouched.
        const invoice =
          await billingService.findInvoiceByEnrollment(enrollmentId);
        await billingService.createOrUpdateInvoice({
          schoolYearId: yearId,
          enrollmentId,
          registrationFee: Number(invoice?.registrationFee),
          tuitionFee: Number(invoice?.tuitionFee),
          discountAmount: Number(invoice?.discountAmount),
          arrearsAmount: Number(invoice?.arrearsAmount),
          paidAmount: 3000,
        });

        const before = await paymentsService.getLedgerReconciliation(yearId);
        expect(before.rows).toHaveLength(1);
        expect(before.rows[0]).toMatchObject({
          invoicePaid: 3000,
          ledgerPaid: 8000,
          difference: 5000,
          studentName: 'LedgerB Test',
        });
        expect(
          (await dashboardService.getSummary(yearId)).ledgerDivergence.count,
        ).toBe(1);

        const page = await request(app.getHttpServer())
          .get('/payments/reconciliation')
          .set('x-test-role', 'comptabilite');
        expect(page.status).toBe(200);
        expect(page.text).toContain('Coherence des paiements');

        const result = await paymentsService.applyLedgerCorrections(yearId);
        expect(result.corrected).toBe(1);

        const after = await paymentsService.getLedgerReconciliation(yearId);
        expect(after.rows).toHaveLength(0);
        const corrections = await paymentModel
          .find({ invoiceId, kind: 'correction' })
          .lean()
          .exec();
        expect(corrections).toHaveLength(1);
        expect(corrections[0].amount).toBe(-5000);
        // Re-running is a no-op: nothing more to correct.
        expect(
          (await paymentsService.applyLedgerCorrections(yearId)).corrected,
        ).toBe(0);
      }));

    it("corrige le montant paye sur une facture avec impayes reportes sans rendre l'ecolage/inscription negatif", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const { yearId, levelId } = await setup();
        const { enrollmentId, invoiceId } = await seedPaidEnrollment(
          'ARR',
          yearId,
          levelId,
        );
        await arrearModel.create({
          studentId: (await enrollmentModel.findById(enrollmentId).lean())
            ?.studentId,
          sourceEnrollmentId: enrollmentId,
          targetEnrollmentId: enrollmentId,
          sourceSchoolYearId: yearId,
          targetSchoolYearId: yearId,
          amountInitial: 10000,
          amountRemaining: 10000,
          status: 'open',
        });
        await invoiceModel.updateOne({ _id: invoiceId }, [
          {
            $set: {
              arrearsAmount: 10000,
              totalDue: { $add: ['$totalDue', 10000] },
              balanceDue: { $add: ['$balanceDue', 10000] },
            },
          },
        ] as never);

        // 12 000 paid with the default ARREARS_FIRST rule: 10 000 clears the
        // arrear, only 2 000 actually counts as this invoice's current fees.
        await request(app.getHttpServer())
          .post('/payments')
          .set('x-test-role', 'comptabilite')
          .send({ invoiceId, amount: 12000, method: PaymentMethod.CASH })
          .expect(302);
        const beforeSummary = await dashboardService.getSummary(yearId);

        // Correcting the paid amount down by 5 000 must reduce current_fees
        // (2 000) then spill the rest into the arrear bucket - never leaving
        // current_fees negative.
        const response = await request(app.getHttpServer())
          .post(`/enrollments/${enrollmentId}/financial-details`)
          .set('x-test-role', 'super_admin')
          .send({ paidAmount: '7000', reason: 'Paiement en trop annule' });
        expect(response.status).toBe(302);

        // Before the correction: 2 000 of the 12 000 counted as this
        // invoice's current fees (the other 10 000 cleared the arrear) -
        // registrationFee is 0 on this fee schedule, so all of it landed in
        // tuitionRevenue.
        expect(beforeSummary.tuitionRevenue).toBe(2000);

        const afterSummary = await dashboardService.getSummary(yearId);
        expect(afterSummary.revenue).toBe(beforeSummary.revenue - 5000);
        // The old behaviour tagged the whole -5 000 as 'current_fees',
        // driving this invoice's current-fees total to -3 000 and
        // tuitionRevenue to a nonsensical negative-derived value. It must
        // land at exactly 0 instead (current_fees fully spent, never
        // negative), with the remaining -3 000 taken from the arrear.
        expect(afterSummary.tuitionRevenue).toBe(0);
        expect(afterSummary.registrationRevenue).toBe(0);
        expect(afterSummary.ledgerDivergence).toEqual({ count: 0, total: 0 });

        const corrections = await paymentModel
          .find({ invoiceId, kind: 'correction' })
          .lean()
          .exec();
        expect(corrections).toHaveLength(1);
        expect(corrections[0].allocation).toEqual([
          { type: 'current_fees', amount: -2000 },
          { type: 'arrear', amount: -3000 },
        ]);
      }));
  });

  it("le rapport 'situation des paiements scolaires' se telecharge aussi en Excel, pas seulement en PDF", () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const year = await schoolYearModel.create({
        label: `EXP-${unique}`,
        startDate: new Date('2093-09-01'),
        endDate: new Date('2094-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: `EXP${unique}`,
        label: `EXP${unique}`,
        sortOrder: 100000 + Math.floor(Math.random() * 900000),
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 15000,
        tuitionFee: 90000,
      });
      const student = await studentModel.create({
        matricule: `MAT-EXP-${unique}`,
        lastname: 'Exportine',
        firstname: 'Excelia',
        gender: 'F',
        status: 'active',
      });
      const enrollment = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });
      await paymentsService.createPayment({
        invoiceId: enrollment.invoiceId,
        amount: 15000,
        method: PaymentMethod.CASH,
      });

      const exported = await request(app.getHttpServer())
        .get('/reports/registration-paid/export')
        .query({ filter: 'registration', schoolYearId: String(year._id) })
        .set('x-test-role', 'comptabilite');
      expect(exported.status).toBe(200);
      expect(exported.headers['content-type']).toContain('spreadsheetml');
      expect(exported.headers['content-disposition']).toContain(
        'situation-paiements-registration.xlsx',
      );

      // The PDF download keeps working side by side.
      const pdf = await request(app.getHttpServer())
        .get('/reports/registration-paid/pdf')
        .query({ filter: 'registration', schoolYearId: String(year._id) })
        .set('x-test-role', 'comptabilite');
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    }));

  it("la fiche de notes vierge d'une classe se telecharge en PDF, Word et Excel, roster rempli et notes vides", () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      await schoolYearModel.updateMany(
        { status: SchoolYearStatus.OPEN },
        { status: SchoolYearStatus.CLOSED },
      );
      const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const year = await schoolYearModel.create({
        label: `GS-${unique}`,
        startDate: new Date('2095-09-01'),
        endDate: new Date('2096-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: `GS${unique}`,
        label: `GS${unique}`,
        sortOrder: 100000 + Math.floor(Math.random() * 900000),
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 80000,
      });
      const student = await studentModel.create({
        matricule: `MAT-GS-${unique}`,
        lastname: 'Fichenote',
        firstname: 'Vierge',
        gender: 'F',
        status: 'active',
      });
      await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(year._id),
        levelId: String(level._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });

      // Page autonome (le lien du menu Gestion pedagogique y mene
      // directement, sans passer par /bulletins) - juste le formulaire.
      const picker = await request(app.getHttpServer())
        .get('/reports/grade-sheet')
        .set('x-test-role', 'secretariat');
      expect(picker.status).toBe(200);
      expect(picker.text).toContain(`GS${unique}`);

      const pdf = await request(app.getHttpServer())
        .get('/reports/grade-sheet/pdf')
        .query({ levelId: String(level._id) })
        .set('x-test-role', 'secretariat');
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');

      const docxRes = await request(app.getHttpServer())
        .get('/reports/grade-sheet/docx')
        .query({ levelId: String(level._id) })
        .set('x-test-role', 'secretariat')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(docxRes.status).toBe(200);
      expect(docxRes.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect((docxRes.body as Buffer).subarray(0, 2).toString('latin1')).toBe(
        'PK',
      );

      const excelRes = await request(app.getHttpServer())
        .get('/reports/grade-sheet/excel')
        .query({ levelId: String(level._id) })
        .set('x-test-role', 'secretariat')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(excelRes.status).toBe(200);
      expect(excelRes.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- supertest types res.body as `any`
      await workbook.xlsx.load(excelRes.body);
      const sheet = workbook.worksheets[0];
      let studentRow: unknown[] | undefined;
      sheet.eachRow((row) => {
        if (row.getCell(2).value === 'Fichenote Vierge') {
          studentRow = row.values as unknown[];
        }
      });
      expect(studentRow?.[3]).toBe(`MAT-GS-${unique}`);
      expect(studentRow?.[4]).toBe('F');
      // Note columns for that student stay blank on the printed template.
      expect(studentRow?.[5]).toBeFalsy();

      // A role with no pedagogical access (comptabilite) can't reach it.
      const forbidden = await request(app.getHttpServer())
        .get('/reports/grade-sheet/pdf')
        .query({ levelId: String(level._id) })
        .set('x-test-role', 'comptabilite');
      expect(forbidden.status).toBe(403);
    }));

  it('le nombre de colonnes Note et Devoir de la fiche de notes se parametre depuis la requete', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const year = await schoolYearModel.create({
        label: `GSE-${unique}`,
        startDate: new Date('2097-09-01'),
        endDate: new Date('2098-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const level = await levelModel.create({
        code: `GSE${unique}`,
        label: `GSE${unique}`,
        sortOrder: 100000 + Math.floor(Math.random() * 900000),
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(year._id),
        levelId: String(level._id),
        registrationFee: 10000,
        tuitionFee: 80000,
      });

      const excelRes = await request(app.getHttpServer())
        .get('/reports/grade-sheet/excel')
        .query({
          levelId: String(level._id),
          noteCount: '0',
          interroCount: '1',
          devoirCount: '3',
        })
        .set('x-test-role', 'secretariat')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(excelRes.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- supertest types res.body as `any`
      await workbook.xlsx.load(excelRes.body);
      const sheet = workbook.worksheets[0];
      const header1 = (sheet.getRow(8).values as unknown[]).slice(1, 5);
      const header2 = (sheet.getRow(9).values as unknown[]).slice(5, 10);
      // 0 notes: no "Note *" column between Sexe and the group header.
      expect(header1).toEqual(['N°', 'Nom et prénoms', 'Matricule', 'Sexe']);
      // 1 interro: bare "Interro", not "Interro 1". 3 devoirs: numbered
      // "Devoir 1/2/3", not the singular "Devoir".
      expect(header2).toEqual([
        'Interro',
        'Devoir 1',
        'Devoir 2',
        'Devoir 3',
        'Compo',
      ]);
    }));

  it('active une nouvelle annee en promouvant sans modifier l historique source', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-ROLLOVER',
        lastname: 'Mensah',
        firstname: 'Kossi',
        gender: 'M',
        birthDate: new Date('2014-01-10'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });
      const sourceYear = await schoolYearModel.create({
        label: '2030-2031',
        startDate: new Date('2030-09-01'),
        endDate: new Date('2031-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const targetYear = await schoolYearModel.create({
        label: '2031-2032',
        startDate: new Date('2031-09-01'),
        endDate: new Date('2032-06-30'),
        status: SchoolYearStatus.DRAFT,
      });
      const sourceLevel = await levelModel.create({
        code: 'ROLL-1',
        label: 'ROLL-1',
        sortOrder: 101,
      });
      const nextLevel = await levelModel.create({
        code: 'ROLL-2',
        label: 'ROLL-2',
        sortOrder: 102,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(sourceYear._id),
        levelId: String(sourceLevel._id),
        registrationFee: 10000,
        tuitionFee: 40000,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(sourceYear._id),
        levelId: String(nextLevel._id),
        registrationFee: 12000,
        tuitionFee: 45000,
      });
      const sourceEnrollment = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(sourceYear._id),
        levelId: String(sourceLevel._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });
      await schoolYearModel.updateOne(
        { _id: sourceYear._id },
        { status: SchoolYearStatus.CLOSED },
      );

      await promotionsService.validate({
        sourceSchoolYearId: String(sourceYear._id),
        targetSchoolYearId: String(targetYear._id),
        carryOverArrears: true,
        decisions: [
          {
            studentId: String(student._id),
            sourceEnrollmentId: sourceEnrollment.enrollmentId,
            decision: FinalDecision.PROMOTED,
            targetLevelId: String(nextLevel._id),
          },
        ],
      });

      const sourceAfter = await enrollmentModel
        .findById(sourceEnrollment.enrollmentId)
        .lean()
        .exec();
      const targetEnrollment = await enrollmentModel
        .findOne({
          studentId: student._id,
          schoolYearId: targetYear._id,
        })
        .lean()
        .exec();
      const years = await schoolYearModel
        .find({ _id: { $in: [sourceYear._id, targetYear._id] } })
        .lean()
        .exec();
      expect(sourceAfter?.status).toBe('closed');
      expect(sourceAfter?.finalDecision).toBe('promoted');
      expect(String(targetEnrollment?.levelId)).toBe(String(nextLevel._id));
      expect(
        years.find((year) => String(year._id) === String(sourceYear._id))
          ?.status,
      ).toBe('closed');
      expect(
        years.find((year) => String(year._id) === String(targetYear._id))
          ?.status,
      ).toBe('open');
    }));

  it('permet de preparer/promouvoir dans une annee cible deja activee separement (activation et preparation decouplees)', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-DECOUPLE',
        lastname: 'Amegan',
        firstname: 'Edem',
        gender: 'M',
        birthDate: new Date('2014-02-15'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });
      const sourceYear = await schoolYearModel.create({
        label: '2032-2033',
        startDate: new Date('2032-09-01'),
        endDate: new Date('2033-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      const targetYear = await schoolYearModel.create({
        label: '2033-2034',
        startDate: new Date('2033-09-01'),
        endDate: new Date('2034-06-30'),
        status: SchoolYearStatus.DRAFT,
      });
      const sourceLevel = await levelModel.create({
        code: 'DECOUPLE-1',
        label: 'DECOUPLE-1',
        sortOrder: 111,
      });
      const nextLevel = await levelModel.create({
        code: 'DECOUPLE-2',
        label: 'DECOUPLE-2',
        sortOrder: 112,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(sourceYear._id),
        levelId: String(sourceLevel._id),
        registrationFee: 10000,
        tuitionFee: 40000,
      });
      await billingService.upsertFeeSchedule({
        schoolYearId: String(sourceYear._id),
        levelId: String(nextLevel._id),
        registrationFee: 12000,
        tuitionFee: 45000,
      });
      const sourceEnrollment = await enrollmentsService.createEnrollment({
        studentId: String(student._id),
        schoolYearId: String(sourceYear._id),
        levelId: String(sourceLevel._id),
        type: EnrollmentType.INITIAL,
        applyOpenArrears: 'false',
      });

      // Activation happens first, standalone, entirely separate from
      // promotions - this is the decoupled sequence the school actually
      // wants: close the old year, open the new one immediately so
      // day-to-day work isn't blocked, then run the rollover later.
      await schoolYearsService.updateStatus(
        String(sourceYear._id),
        SchoolYearStatus.CLOSED,
      );
      await schoolYearsService.updateStatus(
        String(targetYear._id),
        SchoolYearStatus.OPEN,
      );

      const targetBeforePrepare = await schoolYearModel
        .findById(targetYear._id)
        .lean()
        .exec();
      expect(targetBeforePrepare?.status).toBe('open');
      expect(targetBeforePrepare?.preparedAt).toBeFalsy();

      // Preparing into an already-open target must succeed - it is not a
      // conflicting "other open year", it is the intended target itself.
      await promotionsService.validate({
        sourceSchoolYearId: String(sourceYear._id),
        targetSchoolYearId: String(targetYear._id),
        carryOverArrears: true,
        decisions: [
          {
            studentId: String(student._id),
            sourceEnrollmentId: sourceEnrollment.enrollmentId,
            decision: FinalDecision.PROMOTED,
            targetLevelId: String(nextLevel._id),
          },
        ],
      });

      const targetAfterPrepare = await schoolYearModel
        .findById(targetYear._id)
        .lean()
        .exec();
      expect(targetAfterPrepare?.status).toBe('open');
      expect(targetAfterPrepare?.preparedAt).toBeTruthy();

      const targetEnrollment = await enrollmentModel
        .findOne({ studentId: student._id, schoolYearId: targetYear._id })
        .lean()
        .exec();
      expect(String(targetEnrollment?.levelId)).toBe(String(nextLevel._id));
    }));

  // These two routes are @Render(...) views, and this e2e harness (unlike
  // main.ts's real bootstrap) never configures the nunjucks view engine -
  // see the multi-tenant e2e spec for the same known gap - so a 200 isn't
  // achievable here regardless of routing correctness. What actually matters
  // is that BulletinsController's GET /:id catch-all never intercepts these
  // literal path segments and tries to cast them as an ObjectId.
  it('GET /bulletins/matieres is routed to SubjectsController, not swallowed by /:id as a CastError', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const response = await request(app.getHttpServer())
        .get('/bulletins/matieres')
        .set('x-test-role', 'direction');

      expect(response.text).not.toMatch(/CastError/);
      expect(response.text).not.toMatch(/Session introuvable/);
    }));

  it('GET /bulletins/new is routed to its own handler, not swallowed by /:id as a CastError', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const response = await request(app.getHttpServer())
        .get('/bulletins/new')
        .set('x-test-role', 'direction');

      expect(response.text).not.toMatch(/CastError/);
      expect(response.text).not.toMatch(/Session introuvable/);
    }));

  describe('detection des doublons de noms eleves', () => {
    it('le controle de doublon trouve un eleve du meme nom/prenoms, et la page /students/duplicates liste le groupe', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = Date.now();
        const lastname = `Mensah${unique}`;
        const firstname = 'Komlan';

        // GET /students (plus loin) resout l'annee ouverte meme sans
        // filtre d'annee explicite - il en faut une, le beforeEach global
        // ayant ferme celle des tests precedents.
        const year = await schoolYearModel.create({
          label: `DUP-${unique}`,
          startDate: new Date('2096-09-01'),
          endDate: new Date('2097-06-30'),
          status: SchoolYearStatus.OPEN,
        });

        const first = await studentModel.create({
          matricule: `DUP-A-${unique}`,
          lastname,
          firstname,
          gender: 'M',
          status: 'active',
        });
        const second = await studentModel.create({
          matricule: `DUP-B-${unique}`,
          lastname,
          firstname,
          gender: 'M',
          status: 'active',
        });

        // Avant la creation du doublon, aucun match pour ce nom precis.
        const noMatchYet = await request(app.getHttpServer())
          .get('/students/check-duplicate')
          .query({ lastname: `Autre${unique}`, firstname })
          .set('x-test-role', 'secretariat');
        expect(noMatchYet.status).toBe(200);
        expect((noMatchYet.body as { matches: unknown[] }).matches).toEqual([]);

        // Insensible a la casse/accents, retrouve les deux dossiers deja
        // crees (y compris le premier, matricule inclus).
        const check = await request(app.getHttpServer())
          .get('/students/check-duplicate')
          .query({ lastname: lastname.toUpperCase(), firstname })
          .set('x-test-role', 'secretariat');
        expect(check.status).toBe(200);
        const matches = (
          check.body as { matches: Array<{ matricule: string }> }
        ).matches;
        expect(matches.map((m) => m.matricule).sort()).toEqual(
          [`DUP-A-${unique}`, `DUP-B-${unique}`].sort(),
        );

        const duplicatesPage = await request(app.getHttpServer())
          .get('/students/duplicates')
          .set('x-test-role', 'secretariat');
        expect(duplicatesPage.status).toBe(200);
        expect(duplicatesPage.text).toContain(`DUP-A-${unique}`);
        expect(duplicatesPage.text).toContain(`DUP-B-${unique}`);

        // Un eleve archive (statut pose directement, l'UI n'offre plus de
        // bouton pour ca) n'a typiquement aucune inscription pour l'annee
        // ouverte - ?status=archived doit quand meme le retrouver (voir le
        // correctif de searchPaginated : le filtre par statut ne doit
        // jamais etre restreint aux seuls inscrits de l'annee en cours).
        await studentModel.updateOne(
          { _id: second._id },
          { status: 'archived' },
        );
        const archivedList = await request(app.getHttpServer())
          .get('/students')
          .query({ status: 'archived' })
          .set('x-test-role', 'secretariat');
        expect(archivedList.status).toBe(200);
        expect(archivedList.text).toContain(`DUP-B-${unique}`);

        // Nettoyage : on ne laisse rien derriere pour ne pas fausser
        // d'autres tests partageant cette ecole.
        await studentModel.deleteMany({
          _id: { $in: [first._id, second._id] },
        });
        await schoolYearModel.deleteOne({ _id: year._id });
      }));
  });

  describe('stocks et fournitures (article + mouvements transactionnels)', () => {
    let stockItemModel: Model<StockItem>;

    beforeAll(() => {
      stockItemModel = app.get(getModelToken(StockItem.name));
    });

    it('cree un article, enregistre une entree puis une sortie, et refuse une sortie qui depasserait le stock disponible', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const name = `Craie e2e ${Date.now()}`;

        const create = await request(app.getHttpServer())
          .post('/stock')
          .set('x-test-role', 'secretariat')
          .send({
            name,
            category: 'pedagogique',
            unit: 'boîte',
            alertThreshold: '5',
          });
        expect(create.status).toBe(302);

        const item = await stockItemModel.findOne({ name }).lean().exec();
        expect(item).toBeTruthy();
        expect(item!.quantity).toBe(0);
        // The blank "Seuil d'alerte" bug this DTO is guarding against would
        // have left a filled threshold like this one untouched - this is a
        // smoke check, the dedicated empty-string regression lives in
        // create-stock-item.dto.spec.ts.
        expect(item!.alertThreshold).toBe(5);

        const entree = await request(app.getHttpServer())
          .post(`/stock/${String(item!._id)}/movements`)
          .set('x-test-role', 'secretariat')
          .send({
            type: 'entree',
            quantity: '20',
            reason: 'Achat de rentree',
            date: '2026-10-06',
          });
        expect(entree.status).toBe(302);
        expect(
          (await stockItemModel.findById(item!._id).lean().exec())!.quantity,
        ).toBe(20);

        const sortie = await request(app.getHttpServer())
          .post(`/stock/${String(item!._id)}/movements`)
          .set('x-test-role', 'secretariat')
          .send({
            type: 'sortie',
            quantity: '7',
            reason: 'Distribution a la classe de CP1',
            date: '2026-10-06',
          });
        expect(sortie.status).toBe(302);
        expect(
          (await stockItemModel.findById(item!._id).lean().exec())!.quantity,
        ).toBe(13);

        // A request through this e2e harness carries no "Accept: text/html"
        // header, so HttpExceptionFilter's flash+redirect branch is skipped
        // and the thrown BadRequestException surfaces as a plain 400 here -
        // same pattern as the "annee historique" check earlier in this file.
        const overdraw = await request(app.getHttpServer())
          .post(`/stock/${String(item!._id)}/movements`)
          .set('x-test-role', 'secretariat')
          .send({
            type: 'sortie',
            quantity: '999',
            reason: 'Tentative de depassement',
            date: '2026-10-06',
          });
        expect(overdraw.status).toBe(400);
        const overdrawBody = overdraw.body as { message?: string };
        expect(overdrawBody.message).toMatch(/Stock insuffisant/);

        // Refused atomically: neither the quantity nor the ledger moved.
        expect(
          (await stockItemModel.findById(item!._id).lean().exec())!.quantity,
        ).toBe(13);

        const detail = await request(app.getHttpServer())
          .get(`/stock/${String(item!._id)}`)
          .set('x-test-role', 'secretariat');
        expect(detail.status).toBe(200);
        expect(detail.text).toContain(name);
        expect(detail.text).toContain('Achat de rentree');
        expect(detail.text).toContain('Distribution a la classe de CP1');
        expect(detail.text).not.toContain('Tentative de depassement');
      }));

    it('un auditeur peut consulter le stock mais pas y enregistrer de mouvement (403)', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const name = `Ramette e2e ${Date.now()}`;
        await stockItemModel.create({
          name,
          category: 'administratif',
          unit: 'ramette',
          quantity: 10,
        });
        const item = await stockItemModel.findOne({ name }).lean().exec();

        const list = await request(app.getHttpServer())
          .get('/stock')
          .set('x-test-role', 'auditeur');
        expect(list.status).toBe(200);
        expect(list.text).toContain(name);

        const forbiddenCreate = await request(app.getHttpServer())
          .post('/stock')
          .set('x-test-role', 'auditeur')
          .send({
            name: 'Ne doit pas exister',
            category: 'autre',
            unit: 'unité',
          });
        expect(forbiddenCreate.status).toBe(403);

        const forbiddenMovement = await request(app.getHttpServer())
          .post(`/stock/${String(item!._id)}/movements`)
          .set('x-test-role', 'auditeur')
          .send({
            type: 'entree',
            quantity: '1',
            reason: 'Ne doit pas etre enregistre',
            date: '2026-10-06',
          });
        expect(forbiddenMovement.status).toBe(403);

        expect(
          (await stockItemModel.findById(item!._id).lean().exec())!.quantity,
        ).toBe(10);
      }));

    it('exporte le stock en Excel', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const response = await request(app.getHttpServer())
          .get('/stock/export')
          .set('x-test-role', 'secretariat')
          .buffer(true)
          .parse((res, callback) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
          });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('spreadsheetml');
        expect(
          (response.body as Buffer).subarray(0, 2).toString('latin1'),
        ).toBe('PK');
      }));
  });

  describe("fiche ecole (/platform/ecoles) - secret de licence affiche pour l'outil CLI", () => {
    it("n'affiche aucun secret tant qu'aucun pack d'installation n'a ete genere, puis l'affiche une fois present", () =>
      runAsPlatformAdmin(async () => {
        const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
        const ecole = await ecoleModel.create({
          nom: `Ecole CLI ${Date.now()}`,
        });

        const before = await request(app.getHttpServer())
          .get(`/platform/ecoles/${String(ecole._id)}/edit`)
          .set('x-test-role', 'platform_admin');
        expect(before.status).toBe(200);
        expect(before.text).toContain("Aucun secret généré pour l'instant");
        expect(before.text).not.toContain('provisioning-secret-field');

        await ecoleModel
          .updateOne(
            { _id: ecole._id },
            { provisioningLicenseSecret: 'secret-de-test-e2e-12345' },
          )
          .exec();

        const after = await request(app.getHttpServer())
          .get(`/platform/ecoles/${String(ecole._id)}/edit`)
          .set('x-test-role', 'platform_admin');
        expect(after.status).toBe(200);
        expect(after.text).toContain('secret-de-test-e2e-12345');
        expect(after.text).toContain('npm run license -- set-secret');
      }));

    // Regression guard: the main "Modifier l'ecole" form no longer has
    // inputs for releaseVersion/licenseActivatedAt/licenseExpiresAt/
    // licenseActivationKey (the confusing "Suivi licence (manuel)" section
    // was removed - see EcolesService.streamInstallationPackage's own
    // comment on why these are a delivery record, not something this form
    // should ever silently wipe). Submitting the form without them must
    // never clear what streamInstallationPackage/generateLicense wrote.
    it('ne pas envoyer les champs de suivi licence dans le formulaire ne les efface pas', () =>
      runAsPlatformAdmin(async () => {
        const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
        const ecole = await ecoleModel.create({
          nom: `Ecole Suivi ${Date.now()}`,
          releaseVersion: '0.0.1',
          licenseActivatedAt: new Date('2026-01-01'),
          licenseExpiresAt: new Date('2026-12-31'),
          licenseActivationKey: 'un-token-deja-genere',
        });

        const update = await request(app.getHttpServer())
          .post(`/platform/ecoles/${String(ecole._id)}`)
          .set('x-test-role', 'platform_admin')
          .send({ nom: 'Ecole Suivi renommee' });
        expect(update.status).toBe(302);

        const reloaded = await ecoleModel.findById(ecole._id).lean().exec();
        expect(reloaded?.nom).toBe('Ecole Suivi renommee');
        expect(reloaded?.releaseVersion).toBe('0.0.1');
        expect(reloaded?.licenseActivationKey).toBe('un-token-deja-genere');
        expect(reloaded?.licenseExpiresAt?.toISOString()).toBe(
          new Date('2026-12-31').toISOString(),
        );
      }));
  });

  describe('fiche ecole (/platform/ecoles) - modules Discipline/Stock et paiement a l-inscription', () => {
    it('active/desactive Discipline et Stock independamment de Bulletins, reflete sur la fiche', () =>
      runAsPlatformAdmin(async () => {
        const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
        const ecole = await ecoleModel.create({
          nom: `Ecole Modules ${Date.now()}`,
        });
        const id = String(ecole._id);

        const before = await request(app.getHttpServer())
          .get(`/platform/ecoles/${id}/edit`)
          .set('x-test-role', 'platform_admin');
        expect(before.text).toContain('Journal de discipline');
        expect(before.text).toContain('Stocks &amp; fournitures');

        await request(app.getHttpServer())
          .post(`/platform/ecoles/${id}/modules/toggle`)
          .set('x-test-role', 'platform_admin')
          .send({ code: 'DISCIPLINE', active: 'true' })
          .expect(302);
        await request(app.getHttpServer())
          .post(`/platform/ecoles/${id}/modules/toggle`)
          .set('x-test-role', 'platform_admin')
          .send({ code: 'STOCK', active: 'true' })
          .expect(302);

        const afterActivation = await request(app.getHttpServer())
          .get(`/platform/ecoles/${id}/edit`)
          .set('x-test-role', 'platform_admin');
        // Bulletins must stay untouched - Discipline is its own code now,
        // not piggybacking on it anymore.
        expect(afterActivation.text).toMatch(
          /Bulletins<\/strong>\s*<p class="muted">Inactif/,
        );

        await request(app.getHttpServer())
          .post(`/platform/ecoles/${id}/modules/toggle`)
          .set('x-test-role', 'platform_admin')
          .send({ code: 'DISCIPLINE', active: 'false' })
          .expect(302);

        const afterDeactivation = await request(app.getHttpServer())
          .get(`/platform/ecoles/${id}/edit`)
          .set('x-test-role', 'platform_admin');
        expect(afterDeactivation.text).toMatch(
          /Journal de discipline<\/strong>\s*<p class="muted">Inactif/,
        );
        // Stock was left alone by the Discipline toggle above.
        expect(afterDeactivation.text).toMatch(
          /Stocks &amp; fournitures<\/strong>\s*<p class="muted">Actif/,
        );
      }));

    it("bascule l'obligation de paiement a l'inscription pour cette ecole", () =>
      runAsPlatformAdmin(async () => {
        const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
        const ecole = await ecoleModel.create({
          nom: `Ecole Paiement Oblig ${Date.now()}`,
        });
        const id = String(ecole._id);

        const before = await request(app.getHttpServer())
          .get(`/platform/ecoles/${id}/edit`)
          .set('x-test-role', 'platform_admin');
        expect(before.text).toContain('Non (optionnel)');

        await request(app.getHttpServer())
          .post(`/platform/ecoles/${id}/registration-payment-required/toggle`)
          .set('x-test-role', 'platform_admin')
          .send({ required: 'true' })
          .expect(302);

        const reloaded = await ecoleModel.findById(id).lean().exec();
        expect(reloaded?.registrationPaymentRequired).toBe(true);
      }));
  });

  describe('personnel enseignant (dossier, affectation, contrats, suivi)', () => {
    it("cree un dossier enseignant, l'affecte, lui attribue un contrat, le renouvelle, le resilie et ajoute une entree de suivi", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = Date.now();
        const year = await schoolYearModel.create({
          label: `ENS-${unique}`,
          startDate: new Date('2040-09-01'),
          endDate: new Date('2041-06-30'),
          status: 'open',
        });
        const level = await levelModel.create({
          code: `ENS-L-${unique}`,
          label: `ENS-L-${unique}`,
          sortOrder: 900002,
        });
        const subject = await subjectModel.create({
          label: `Matiere Enseignants ${unique}`,
          labelNormalized: `MATIERE ENSEIGNANTS ${unique}`,
          category: 'scientifique',
          active: true,
        });
        const schoolYearId = String(year._id);
        const levelId = String(level._id);
        const subjectId = String(subject._id);

        const create = await request(app.getHttpServer())
          .post('/teachers')
          .set('x-test-role', 'direction')
          .send({
            lastname: `Mensah${unique}`,
            firstname: 'Komi',
            gender: 'M',
            phone: '90000000',
          });
        expect(create.status).toBe(302);
        expect(create.headers.location).toMatch(/^\/teachers\//);
        const teacherId = create.headers.location.split('/').pop() as string;

        const detail = await request(app.getHttpServer())
          .get(`/teachers/${teacherId}`)
          .set('x-test-role', 'direction');
        expect(detail.status).toBe(200);
        expect(detail.text).toContain(`Mensah${unique}`);

        // schoolYearId n'est plus envoye par le client : toujours l'annee
        // OUVERTE resolue cote serveur (requireOpen()) - `year` ci-dessus
        // est la seule ouverte pour cette ecole a ce stade (beforeEach du
        // fichier cloture toute annee ouverte avant chaque test).
        const assignment = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/assignments`)
          .set('x-test-role', 'direction')
          .send({ levelIds: [levelId], subjectId, hoursPerWeek: 6 });
        expect(assignment.status).toBe(302);
        const createdAssignment = await assignmentModel
          .findOne({ teacherId, levelId })
          .lean()
          .exec();
        expect(String(createdAssignment?.schoolYearId)).toBe(schoolYearId);

        // Un doublon exact (meme matiere/classe/annee pour cet enseignant)
        // est refuse par l'index unique, pas silencieusement duplique.
        const duplicateAssignment = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/assignments`)
          .set('x-test-role', 'direction')
          .send({ levelIds: [levelId], subjectId, hoursPerWeek: 3 });
        expect(duplicateAssignment.status).toBe(400);

        const firstContract = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/contracts`)
          .set('x-test-role', 'direction')
          .send({
            type: 'cdd',
            startDate: '2040-09-01',
            endDate: '2041-06-30',
          });
        expect(firstContract.status).toBe(302);

        const afterFirstContract = await request(app.getHttpServer())
          .get(`/teachers/${teacherId}`)
          .set('x-test-role', 'direction');
        expect(afterFirstContract.text).toContain('CDD');

        // Renouvellement : le contrat precedent passe EXPIRE, le nouveau ACTIF.
        const renewal = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/contracts`)
          .set('x-test-role', 'direction')
          .send({ type: 'cdi', startDate: '2041-07-01' });
        expect(renewal.status).toBe(302);

        const afterRenewal = await request(app.getHttpServer())
          .get(`/teachers/${teacherId}`)
          .set('x-test-role', 'direction');
        expect(afterRenewal.text).toContain('CDI');
        expect(afterRenewal.text).toContain('Expiré');

        const tracking = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/tracking`)
          .set('x-test-role', 'direction')
          .send({
            type: 'observation',
            date: '2040-10-01',
            note: `Ponctuel et serieux ${unique}`,
          });
        expect(tracking.status).toBe(302);

        const afterTracking = await request(app.getHttpServer())
          .get(`/teachers/${teacherId}`)
          .set('x-test-role', 'direction');
        expect(afterTracking.text).toContain(`Ponctuel et serieux ${unique}`);

        // Plus de suppression sur cette page : on corrige en place, motif
        // obligatoire a chaque fois (voir TeachersService.updateAssignment).
        const assignmentId = String(createdAssignment?._id);
        const editAssignmentWithoutReason = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/assignments/${assignmentId}`)
          .set('x-test-role', 'direction')
          .send({ subjectId, hoursPerWeek: 8 });
        expect(editAssignmentWithoutReason.status).toBe(400);

        const editAssignment = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/assignments/${assignmentId}`)
          .set('x-test-role', 'direction')
          .send({
            subjectId,
            hoursPerWeek: 8,
            modificationReason: `Correction du volume horaire ${unique}`,
          });
        expect(editAssignment.status).toBe(302);
        const updatedAssignment = await assignmentModel
          .findById(assignmentId)
          .lean()
          .exec();
        expect(updatedAssignment?.hoursPerWeek).toBe(8);
        expect(updatedAssignment?.lastModificationReason).toBe(
          `Correction du volume horaire ${unique}`,
        );

        // Meme regle pour le suivi : correction en place, motif obligatoire.
        const trackingMatch = afterTracking.text.match(
          /\/teachers\/[^"]+\/tracking\/([^"]+)"[^>]*data-note="Ponctuel/,
        );
        expect(trackingMatch).toBeTruthy();
        const trackingId = trackingMatch![1];

        const editTrackingWithoutReason = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/tracking/${trackingId}`)
          .set('x-test-role', 'direction')
          .send({ type: 'absence', date: '2040-10-02' });
        expect(editTrackingWithoutReason.status).toBe(400);

        const editTracking = await request(app.getHttpServer())
          .post(`/teachers/${teacherId}/tracking/${trackingId}`)
          .set('x-test-role', 'direction')
          .send({
            type: 'absence',
            date: '2040-10-02',
            note: `Finalement absent ${unique}`,
            modificationReason: `Erreur de saisie ${unique}`,
          });
        expect(editTracking.status).toBe(302);

        const afterTrackingEdit = await request(app.getHttpServer())
          .get(`/teachers/${teacherId}`)
          .set('x-test-role', 'direction');
        expect(afterTrackingEdit.text).toContain(`Finalement absent ${unique}`);
      }));

    it("affecte un enseignant a plusieurs classes en une seule soumission, le marque titulaire des deux, puis un autre enseignant qui devient titulaire d'une de ces classes retire automatiquement le premier", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = Date.now();
        // Pas de schoolYearId stocke : seule la presence d'une annee
        // OUVERTE compte, resolue cote serveur (requireOpen()).
        await schoolYearModel.create({
          label: `ENS-MULTI-${unique}`,
          startDate: new Date('2040-09-01'),
          endDate: new Date('2041-06-30'),
          status: 'open',
        });
        const levelA = await levelModel.create({
          code: `ENS-MA-${unique}`,
          label: `ENS-MA-${unique}`,
          sortOrder: 900003,
        });
        const levelB = await levelModel.create({
          code: `ENS-MB-${unique}`,
          label: `ENS-MB-${unique}`,
          sortOrder: 900004,
        });
        const subject = await subjectModel.create({
          label: `Matiere Multi ${unique}`,
          labelNormalized: `MATIERE MULTI ${unique}`,
          category: 'scientifique',
          active: true,
        });
        const levelAId = String(levelA._id);
        const levelBId = String(levelB._id);
        const subjectId = String(subject._id);

        const createFirst = await request(app.getHttpServer())
          .post('/teachers')
          .set('x-test-role', 'direction')
          .send({ lastname: `Premier${unique}`, firstname: 'Un' });
        const firstTeacherId = createFirst.headers.location
          .split('/')
          .pop() as string;

        // Une seule soumission, deux classes choisies a la fois, titulaire
        // des deux.
        const multiAssignment = await request(app.getHttpServer())
          .post(`/teachers/${firstTeacherId}/assignments`)
          .set('x-test-role', 'direction')
          .send({
            levelIds: [levelAId, levelBId],
            subjectId,
            hoursPerWeek: 5,
            isTitulaire: 'true',
          });
        expect(multiAssignment.status).toBe(302);

        const firstDetail = await request(app.getHttpServer())
          .get(`/teachers/${firstTeacherId}`)
          .set('x-test-role', 'direction');
        // Deux lignes d'affectation, toutes deux marquees titulaire.
        expect(
          firstDetail.text.match(/<span class="badge active">Oui<\/span>/g),
        ).toHaveLength(2);

        const list = await request(app.getHttpServer())
          .get('/teachers')
          .set('x-test-role', 'direction');
        // Scoped to this teacher's own row - "10" alone would be too
        // fragile against a shared ecole where many other teachers/rows
        // exist across the whole spec file.
        const rowMatch = list.text.match(
          new RegExp(`Premier${unique}[\\s\\S]*?</tr>`),
        );
        expect(rowMatch).toBeTruthy();
        expect(rowMatch![0]).toContain(levelA.label);
        expect(rowMatch![0]).toContain(levelB.label);
        expect(rowMatch![0]).toContain('10'); // 5h x 2 classes

        const createSecond = await request(app.getHttpServer())
          .post('/teachers')
          .set('x-test-role', 'direction')
          .send({ lastname: `Second${unique}`, firstname: 'Deux' });
        const secondTeacherId = createSecond.headers.location
          .split('/')
          .pop() as string;

        // Devient titulaire de la classe A uniquement - doit retirer le
        // premier enseignant de CETTE classe, sans toucher a la classe B.
        await request(app.getHttpServer())
          .post(`/teachers/${secondTeacherId}/assignments`)
          .set('x-test-role', 'direction')
          .send({
            levelIds: [levelAId],
            subjectId,
            hoursPerWeek: 4,
            isTitulaire: 'true',
          });

        const firstDetailAfter = await request(app.getHttpServer())
          .get(`/teachers/${firstTeacherId}`)
          .set('x-test-role', 'direction');
        // Le premier n'est plus titulaire que d'une seule classe desormais.
        expect(
          firstDetailAfter.text.match(
            /<span class="badge active">Oui<\/span>/g,
          ),
        ).toHaveLength(1);

        const secondDetail = await request(app.getHttpServer())
          .get(`/teachers/${secondTeacherId}`)
          .set('x-test-role', 'direction');
        expect(
          secondDetail.text.match(/<span class="badge active">Oui<\/span>/g),
        ).toHaveLength(1);
      }));
  });

  describe('statistiques de fin de periode (inspection)', () => {
    it('calcule la repartition des moyennes et les effectifs par sexe, pour une classe precise puis toutes classes confondues', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = Date.now();
        const year = await schoolYearModel.create({
          label: `STATS-${unique}`,
          startDate: new Date('2095-09-01'),
          endDate: new Date('2096-06-30'),
          status: SchoolYearStatus.OPEN,
        });
        const level = await levelModel.create({
          code: `STATS-L-${unique}`,
          label: `STATS-L-${unique}`,
          sortOrder: 900005,
        });
        const subject = await subjectModel.create({
          label: `Matiere Stats ${unique}`,
          labelNormalized: `MATIERE STATS ${unique}`,
          category: 'scientifique',
          active: true,
        });

        const boy = await studentModel.create({
          matricule: `STATS-M-${unique}`,
          lastname: 'Boy',
          firstname: 'Stats',
          gender: 'M',
          status: 'active',
        });
        const girl = await studentModel.create({
          matricule: `STATS-F-${unique}`,
          lastname: 'Girl',
          firstname: 'Stats',
          gender: 'F',
          status: 'active',
        });
        const boyEnrollment = await enrollmentModel.create({
          studentId: boy._id,
          schoolYearId: year._id,
          levelId: level._id,
          type: EnrollmentType.INITIAL,
        });
        const girlEnrollment = await enrollmentModel.create({
          studentId: girl._id,
          schoolYearId: year._id,
          levelId: level._id,
          type: EnrollmentType.INITIAL,
        });

        // Garcon admis (12 >= 10), fille non admise (8 < 10) - pour verifier
        // le decompte par sexe (Inscrits/Presents/Admis/% reussite) et la
        // repartition cumulative des moyennes par matiere.
        await noteModel.create({
          studentId: boy._id,
          enrollmentId: boyEnrollment._id,
          subjectId: subject._id,
          schoolYearId: year._id,
          levelId: level._id,
          periode: 'trimestre_1',
          coefficient: 2,
          moyennePeriode: 12,
        });
        await noteModel.create({
          studentId: girl._id,
          enrollmentId: girlEnrollment._id,
          subjectId: subject._id,
          schoolYearId: year._id,
          levelId: level._id,
          periode: 'trimestre_1',
          coefficient: 2,
          moyennePeriode: 8,
        });
        await bulletinResultModel.create({
          studentId: boy._id,
          enrollmentId: boyEnrollment._id,
          schoolYearId: year._id,
          levelId: level._id,
          periode: 'trimestre_1',
          statutNR: 'N',
          totalPoints: 120,
          totalCoef: 10,
          moyenneGenerale: 12,
          rangGeneral: '1',
          appreciationGenerale: 'Bien',
        });
        await bulletinResultModel.create({
          studentId: girl._id,
          enrollmentId: girlEnrollment._id,
          schoolYearId: year._id,
          levelId: level._id,
          periode: 'trimestre_1',
          statutNR: 'N',
          totalPoints: 80,
          totalCoef: 10,
          moyenneGenerale: 8,
          rangGeneral: '2',
          appreciationGenerale: 'Passable',
        });

        const byLevel = await request(app.getHttpServer())
          .get('/reports/exam-statistics')
          .query({ periode: 'trimestre_1', levelId: String(level._id) })
          .set('x-test-role', 'direction');
        expect(byLevel.status).toBe(200);
        expect(byLevel.text).toContain(`Matiere Stats ${unique}`);
        // Garcon 12, fille 8 : les deux tombent sous <14/<16/<18/<=20 (2),
        // seule la fille tombe aussi sous <10/<12 (1), aucun sous <5/<8 (0) -
        // verifie que les seuils cumulatifs sont bien calcules.
        const rowMatch = byLevel.text.match(
          new RegExp(`<tr>\\s*<td>Matiere Stats ${unique}[\\s\\S]*?</tr>`),
        );
        expect(rowMatch).toBeTruthy();
        const cells: string[] = rowMatch![0].match(/<td>([^<]*)<\/td>/g) ?? [];
        expect(cells.map((cell) => cell.replace(/<\/?td>/g, ''))).toEqual([
          `Matiere Stats ${unique}`,
          '0', // Note <5
          '0', // Note <8
          '1', // Note <10
          '1', // Note <12
          '2', // Note <14
          '2', // Note <16
          '2', // Note <18
          '2', // Note <=20
          '1', // Nb moyennes (>=10)
          '50%', // % reussite
        ]);
        // Table "Statistiques generales" : Inscrits/Presents/Admis G,F,T puis
        // % Reussite G,F,T - garcon admis (12), fille non admise (8).
        const generalSection = byLevel.text.slice(
          byLevel.text.indexOf('Statistiques générales'),
        );
        const generalCells = (generalSection.match(/<td>([^<]*)<\/td>/g) ?? [])
          .slice(0, 12)
          .map((cell) => cell.replace(/<\/?td>/g, ''));
        expect(generalCells).toEqual([
          '1',
          '1',
          '2', // Inscrits G,F,T
          '1',
          '1',
          '2', // Presents G,F,T
          '1',
          '0',
          '1', // Admis G,F,T
          '100%',
          '0%',
          '50%', // % Reussite G,F,T
        ]);

        const pdf = await request(app.getHttpServer())
          .get('/reports/exam-statistics/pdf')
          .query({ periode: 'trimestre_1', levelId: String(level._id) })
          .set('x-test-role', 'direction');
        expect(pdf.status).toBe(200);
        expect(pdf.headers['content-type']).toContain('application/pdf');

        const global = await request(app.getHttpServer())
          .get('/reports/exam-statistics')
          .query({ periode: 'trimestre_1' })
          .set('x-test-role', 'direction');
        expect(global.status).toBe(200);
        expect(global.text).toContain('Toutes les classes');
        expect(global.text).toContain(`Matiere Stats ${unique}`);

        // Sans periode choisie, la page s'affiche sans tableau (etat initial).
        const noPeriode = await request(app.getHttpServer())
          .get('/reports/exam-statistics')
          .set('x-test-role', 'direction');
        expect(noPeriode.status).toBe(200);
        expect(noPeriode.text).not.toContain(`Matiere Stats ${unique}`);
      }));
  });

  describe('import des eleves deja payes (parametre par ecole, off par defaut)', () => {
    afterEach(() =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
        settingsService.setImportPaidStudentsEnabled(false),
      ),
    );

    it("masque le panneau et refuse l'import tant que le parametre n'est pas active, puis l'affiche et laisse passer la requete une fois active", () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const unique = Date.now();
        // GET /enrollments resout l'annee ouverte meme sans selection
        // explicite - il en faut une, le beforeEach global ayant ferme
        // celle des tests precedents.
        const year = await schoolYearModel.create({
          label: `IMPORT-PAYES-${unique}`,
          startDate: new Date('2094-09-01'),
          endDate: new Date('2095-06-30'),
          status: SchoolYearStatus.OPEN,
        });

        await settingsService.setImportPaidStudentsEnabled(false);

        const beforeIndex = await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-test-role', 'secretariat');
        expect(beforeIndex.status).toBe(200);
        expect(beforeIndex.text).not.toContain(
          'Importer des élèves déjà payés',
        );

        const beforeImport = await request(app.getHttpServer())
          .post('/enrollments/import')
          .set('x-test-role', 'secretariat')
          .send({});
        expect(beforeImport.status).toBe(403);

        const toggleOn = await request(app.getHttpServer())
          .post('/settings/import-paid-students')
          .set('x-test-role', 'direction')
          .send({ value: 'true' });
        expect(toggleOn.status).toBe(302);
        expect(await settingsService.getImportPaidStudentsEnabled()).toBe(true);

        const afterIndex = await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-test-role', 'secretariat');
        expect(afterIndex.status).toBe(200);
        expect(afterIndex.text).toContain('Importer des élèves déjà payés');

        // Plus de 403 une fois active - la requete atteint maintenant le
        // controle "fichier requis" (pas de multer en e2e, voir le
        // commentaire plus haut sur les routes multipart non testees ici).
        const afterImportNoFile = await request(app.getHttpServer())
          .post('/enrollments/import')
          .set('x-test-role', 'secretariat')
          .send({});
        expect(afterImportNoFile.status).toBe(400);

        await schoolYearModel.deleteOne({ _id: year._id });
      }));
  });

  describe('parametrage complet de demonstration (primaire, college, lycee)', () => {
    it('remplit niveaux, frais, matieres, depenses et active les modules, visibles dans les ecrans de parametrage', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Demo ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);

      const report = await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });
      expect(report.modulesActivated).toEqual(ALL_MODULE_CODES);

      const levelsPage = await request(app.getHttpServer())
        .get('/settings/levels')
        .set('x-test-role', 'super_admin')
        .set('x-test-ecole-id', ecoleId);
      expect(levelsPage.status).toBe(200);
      for (const label of [
        'CP1',
        'CM2',
        '6ème',
        '3ème',
        'Seconde',
        'Terminale',
      ]) {
        expect(levelsPage.text).toContain(label);
      }

      const feesPage = await request(app.getHttpServer())
        .get('/settings/fees')
        .set('x-test-role', 'super_admin')
        .set('x-test-ecole-id', ecoleId);
      expect(feesPage.status).toBe(200);
      expect(feesPage.text).toContain('Salaires du personnel');

      const { levelId, schoolYearId } = await runWithTenant(
        { ecoleId },
        async () => ({
          levelId: String(
            (await levelModel.findOne({ code: 'TERMINALE' }).lean())!._id,
          ),
          schoolYearId: String(
            (await schoolYearModel
              .findOne({ status: SchoolYearStatus.OPEN })
              .lean())!._id,
          ),
        }),
      );
      const subjectsPage = await request(app.getHttpServer())
        .get(
          `/bulletins/matieres?schoolYearId=${schoolYearId}&levelId=${levelId}`,
        )
        .set('x-test-role', 'super_admin')
        .set('x-test-ecole-id', ecoleId);
      expect(subjectsPage.status).toBe(200);
      expect(subjectsPage.text).toContain('Philosophie');

      // Rejouer le seed ne touche a rien.
      const replay = await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });
      expect(replay.levelsCreated).toBe(0);
      expect(replay.classSubjectsCreated).toBe(0);
      expect(replay.modulesActivated).toEqual([]);
      // Deux passages complets du seed (~200 documents chacun) : au-dela des
      // 5 s par defaut de Jest sur une machine chargee.
    }, 30000);
  });

  describe('navigation accessible (regles UI/UX)', () => {
    // Le middleware qui expose currentUser/currentPath/flash aux vues vit
    // dans main.ts (absent ici) - le gabarit commun est donc rendu
    // directement avec l'environnement nunjucks configure en beforeAll.
    const renderLayout = (context: Record<string, unknown>) =>
      nunjucks.renderString('{% extends "layout.njk" %}', {
        title: 'Niveaux',
        currentUser: {
          id: TEST_DEFAULT_USER_ID,
          name: 'Awa Koné',
          role: 'super_admin',
          ecoleId: TEST_DEFAULT_ECOLE_ID,
        },
        currentPath: '/settings/levels',
        activeModules: {
          finance: true,
          bulletins: true,
          discipline: true,
          stock: true,
          enseignants: true,
        },
        ...context,
      });
    const navOf = (html: string) =>
      html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));

    it('rend un lien d evitement, un h1 de page unique, des icones SVG decoratives et un role lisible', () => {
      const html = renderLayout({});

      expect(html).toContain('href="#main-content"');
      expect(html).toContain('id="main-content"');
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toMatch(/<h1>\s*Niveaux\s*<\/h1>/);
      expect(html).toContain('aria-label="Navigation principale"');
      expect(html).toContain('<svg class="icon" aria-hidden="true"');
      // Plus aucun caractere Unicode utilise comme icone de menu.
      for (const glyph of ['☰', '◈', '⚿']) {
        expect(html).not.toContain(glyph);
      }
      expect(html).toContain('Awa Koné');
      expect(html).toContain('Super administrateur');
      expect(html).toContain('Déconnexion');
      expect(html).toContain('s’ouvre dans un nouvel onglet');
    });

    it.each([
      ['/reports/registration-paid', 'Inscriptions payées'],
      ['/reports/grade-sheet', 'Fiche de notes vierge'],
      ['/teachers/new', 'Nouvel enseignant'],
      ['/settings/levels', 'Niveaux'],
    ])(
      'n allume qu un seul lien de menu sur %s (%s)',
      (currentPath, expectedLabel) => {
        const nav = navOf(renderLayout({ currentPath }));
        const active = nav.match(
          /class="(?:nav-link )?is-active"[^>]*>([^<]*)/g,
        );
        expect(active).toHaveLength(1);
        expect(active![0]).toContain(expectedLabel);
      },
    );

    it('annonce les messages : erreur en alerte, succes en statut, tous refermables', () => {
      const error = renderLayout({
        flash: { type: 'error', message: 'Montant invalide' },
      });
      expect(error).toMatch(/class="flash error" role="alert"/);
      expect(error).toContain('aria-label="Fermer le message"');

      const success = renderLayout({
        flash: { type: 'success', message: 'Niveau cree' },
      });
      expect(success).toMatch(/class="flash success" role="status"/);
    });

    it('la page de connexion est compatible avec les gestionnaires de mots de passe', async () => {
      const login = await request(app.getHttpServer()).get('/login');
      expect(login.status).toBe(200);
      expect(login.text).toContain('autocomplete="username"');
      expect(login.text).toContain('autocomplete="current-password"');
    });
  });

  describe('design system (boutons, actions destructives, pied de page)', () => {
    it('affiche le copyright de l editeur avec l annee courante, dans l application et sur la connexion', async () => {
      const year = new Date().getFullYear();
      const expected = `© ${year} Scolar-Gestion. Tous droits réservés.`;

      const login = await request(app.getHttpServer()).get('/login');
      expect(login.text).toContain(expected);

      const page = nunjucks.renderString('{% extends "layout.njk" %}', {
        title: 'Tableau de bord',
        currentPath: '/dashboard',
      });
      expect(page).toContain('<footer class="app-footer">');
      expect(page).toContain(expected);
    });

    it('demande confirmation et marque comme destructive la cloture de l annee ouverte', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const year = await schoolYearModel.create({
          label: `DS-CLOTURE-${Date.now()}`,
          startDate: new Date('2098-09-01'),
          endDate: new Date('2099-06-30'),
          status: SchoolYearStatus.OPEN,
        });

        const page = await request(app.getHttpServer())
          .get('/settings/school-years')
          .set('x-test-role', 'super_admin');
        expect(page.status).toBe(200);
        expect(page.text).toMatch(
          /onsubmit="return confirm\('Clôturer cette année scolaire \?[^"]*"/,
        );
        expect(page.text).toContain(
          '<button type="submit" class="button btn-sm danger">Clôturer</button>',
        );

        await schoolYearModel.deleteOne({ _id: year._id });
      }));

    it('n utilise plus de pseudo-libelles textuels comme icones de bouton et centralise les jetons', () => {
      const css = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'styles.css'),
        'utf8',
      );
      for (const pseudo of ["'XLS'", "'OK'", "'SR'", "'GO'", "'IN'"]) {
        expect(css).not.toContain(`content: ${pseudo}`);
      }
      for (const token of [
        '--control-h:',
        '--control-border:',
        '--space-4:',
        '--z-dialog:',
        '--duration-fast:',
        '--focus-ring:',
      ]) {
        expect(css).toContain(token);
      }
    });
  });

  // public/live-search.js remplace, pendant la frappe, les zones listees dans
  // data-live-search par celles de la page renvoyee pour la meme requete
  // GET : chaque zone doit donc exister dans la page, et le serveur doit y
  // renvoyer les resultats filtres.
  describe('recherche instantanee pendant la saisie', () => {
    let liveYearId: unknown;
    beforeEach(() =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const year = await schoolYearModel.create({
          label: `LIVE-SEARCH-${Date.now()}`,
          startDate: new Date('2100-09-01'),
          endDate: new Date('2101-06-30'),
          status: SchoolYearStatus.OPEN,
        });
        liveYearId = year._id;
      }),
    );
    afterEach(() =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
        schoolYearModel.deleteOne({ _id: liveYearId }),
      ),
    );

    it.each([
      '/enrollments',
      '/students',
      '/students/search',
      '/users',
      '/stock',
      '/teachers',
    ])(
      'branche la recherche instantanee sur %s et chaque zone ciblee existe',
      async (route) => {
        const page = await request(app.getHttpServer())
          .get(route)
          .set('x-test-role', 'super_admin');
        expect(page.status).toBe(200);
        expect(page.text).toContain('src="/live-search.js"');

        const match = page.text.match(/data-live-search="([^"]+)"/);
        expect(match).not.toBeNull();
        const ids = match![1].split(',').map((s) => s.trim().replace('#', ''));
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
          expect(page.text.split(`id="${id}"`)).toHaveLength(2);
        }
      },
    );

    it('renvoie dans la zone de resultats uniquement les lignes correspondant au texte en cours de saisie', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const stockItemModel: Model<StockItem> = app.get(
          getModelToken(StockItem.name),
        );
        const unique = `Craie${Date.now()}`;
        const item = await stockItemModel.create({
          name: `${unique} blanche`,
          category: 'pedagogique',
          unit: 'boite',
          quantity: 12,
        });

        const resultsOf = (html: string) =>
          html.slice(html.indexOf('id="stock-results"'));

        // Saisie partielle (debut du mot), comme pendant la frappe.
        const partial = await request(app.getHttpServer())
          .get(`/stock?q=${encodeURIComponent(unique.slice(0, 8))}`)
          .set('x-test-role', 'super_admin');
        expect(partial.status).toBe(200);
        expect(resultsOf(partial.text)).toContain(`${unique} blanche`);

        const none = await request(app.getHttpServer())
          .get('/stock?q=aucun-article-ne-porte-ce-nom')
          .set('x-test-role', 'super_admin');
        expect(none.status).toBe(200);
        expect(resultsOf(none.text)).not.toContain(unique);

        await stockItemModel.deleteOne({ _id: item._id });
      }));
  });

  describe('bulletins : modele Excel d import pre-rempli', () => {
    it('propose le modele sur la session et le fichier telecharge est directement lisible par l import', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Modele ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      // Niveaux, matieres et coefficients de l'annee ouverte + module
      // Bulletins actif, comme sur une installation de demonstration.
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      const bulletinsService = app.get(BulletinsService);
      const { session, expectedSubjects } = await runWithTenant(
        { ecoleId },
        async () => {
          const year = await schoolYearModel
            .findOne({ status: SchoolYearStatus.OPEN })
            .lean();
          const level = await levelModel.findOne({ code: '6EME' }).lean();
          const created = await bulletinsService.createSession(
            {
              schoolYearId: String(year!._id),
              levelId: String(level!._id),
              periode: Periode.TRIMESTRE_1,
            },
            TEST_DEFAULT_USER_ID,
          );
          const classSubjects = await bulletinsService.listClassSubjects(
            String(year!._id),
            String(level!._id),
          );
          return { session: created, expectedSubjects: classSubjects.length };
        },
      );

      const page = await request(app.getHttpServer())
        .get(`/bulletins/${String(session._id)}`)
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId);
      expect(page.status).toBe(200);
      expect(page.text).toContain(`/bulletins/${String(session._id)}/template`);
      expect(page.text).toContain('Télécharger le modèle Excel');

      const download = await request(app.getHttpServer())
        .get(`/bulletins/${String(session._id)}/template`)
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toContain('spreadsheetml');
      expect(download.headers['content-disposition']).toContain(
        'modele-notes-6eme-1er_Trimestre.xlsx',
      );

      // Accepte par le meme analyseur que l'import (leve une erreur sinon).
      expect(() =>
        parseBulletinWorkbook(download.body as Buffer),
      ).not.toThrow();

      // Un bloc I1/I2/Devoir/Compo/Coef/Prof par matiere configuree en 6eme.
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- supertest types res.body as `any`
      await workbook.xlsx.load(download.body);
      const header = workbook.getWorksheet('Notes')!.getRow(1)
        .values as unknown[];
      expect(expectedSubjects).toBeGreaterThan(0);
      expect(header.filter((cell) => cell === 'Compo')).toHaveLength(
        expectedSubjects,
      );
    });

    it('la fiche de notes vierge renvoie vers le modele de la session de bulletins', async () => {
      const page = await request(app.getHttpServer())
        .get('/reports/grade-sheet')
        .set('x-test-role', 'secretariat');
      expect(page.status).toBe(200);
      expect(page.text).toContain('modèle Excel');
    });

    it('saisie des notes dans l application : grille par matiere, enregistrement puis relecture', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Saisie ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      const bulletinsService = app.get(BulletinsService);
      const { sessionId, studentId, firstSubjectId } = await runWithTenant(
        { ecoleId },
        async () => {
          const year = await schoolYearModel
            .findOne({ status: SchoolYearStatus.OPEN })
            .lean();
          const level = await levelModel.findOne({ code: '5EME' }).lean();
          const student = await studentModel.create({
            matricule: `SAISIE-${Date.now()}`,
            lastname: 'AMEGAN',
            firstname: 'Yao',
            gender: 'M',
            birthDate: new Date('2013-03-03'),
            birthPlace: 'Lome',
            district: 'Be',
            status: 'active',
          });
          await enrollmentModel.create({
            studentId: student._id,
            schoolYearId: year!._id,
            levelId: level!._id,
            type: EnrollmentType.INITIAL,
            status: 'active',
          });
          const session = await bulletinsService.createSession(
            {
              schoolYearId: String(year!._id),
              levelId: String(level!._id),
              periode: Periode.TRIMESTRE_1,
            },
            TEST_DEFAULT_USER_ID,
          );
          const entry = await bulletinsService.getGradeEntry(
            String(session._id),
          );
          return {
            sessionId: String(session._id),
            studentId: String(student._id),
            firstSubjectId: entry.selected.subjectId,
          };
        },
      );

      const sessionPage = await request(app.getHttpServer())
        .get(`/bulletins/${sessionId}`)
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId);
      expect(sessionPage.text).toContain(`/bulletins/${sessionId}/saisie`);

      const grid = await request(app.getHttpServer())
        .get(`/bulletins/${sessionId}/saisie`)
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId);
      expect(grid.status).toBe(200);
      expect(grid.text).toContain('AMEGAN Yao');
      expect(grid.text).toContain(`name="notes[${studentId}][i1]"`);
      expect(grid.text).toContain('Enregistrer et passer à');

      const save = await request(app.getHttpServer())
        .post(`/bulletins/${sessionId}/saisie`)
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId)
        .type('form')
        .send(
          `subjectId=${firstSubjectId}` +
            `&notes[${studentId}][i1]=${encodeURIComponent('12,5')}` +
            `&notes[${studentId}][i2]=` +
            `&notes[${studentId}][devoir]=14` +
            `&notes[${studentId}][compo]=15`,
        );
      expect(save.status).toBe(302);
      expect(save.headers.location).toBe(
        `/bulletins/${sessionId}/saisie?subjectId=${firstSubjectId}`,
      );

      const reread = await runWithTenant({ ecoleId }, () =>
        bulletinsService.getGradeEntry(sessionId, firstSubjectId),
      );
      expect(reread.students[0]).toMatchObject({
        i1: 12.5,
        i2: null,
        devoir: 14,
        compo: 15,
      });

      const invalid = await request(app.getHttpServer())
        .post(`/bulletins/${sessionId}/saisie`)
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId)
        .type('form')
        .send(`subjectId=${firstSubjectId}&notes[${studentId}][compo]=42`);
      expect(invalid.status).toBe(302);
      const unchanged = await runWithTenant({ ecoleId }, () =>
        bulletinsService.getGradeEntry(sessionId, firstSubjectId),
      );
      expect(unchanged.students[0].compo).toBe(15);
    }, 30000);
  });

  describe('parametres : niveaux (cycle Primaire, activation par annee)', () => {
    it('affiche les cycles Primaire / College / Lycee et active ou desactive un niveau pour l annee', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Niveaux ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });
      const as = (req: request.Test) =>
        req.set('x-test-role', 'direction').set('x-test-ecole-id', ecoleId);

      const page = await as(
        request(app.getHttpServer()).get('/settings/levels'),
      );
      expect(page.status).toBe(200);
      expect(page.text).toContain('Primaire (trimestres)');
      expect(page.text).toContain('Collège (trimestres)');
      expect(page.text).toContain('Lycée (semestres)');
      // Niveaux regroupes par cycle, dans l'ordre de la scolarite.
      const sectionOf = (html: string, code: string) => {
        const at = html.indexOf(`<td>${code}</td>`);
        const headings = [...html.matchAll(/<h3 id="cycle-\d+">([^<]+)/g)];
        return headings
          .filter((h) => (h.index ?? 0) < at)
          .pop()?.[1]
          .trim();
      };
      expect(sectionOf(page.text, 'CP1')).toBe('Primaire');
      expect(sectionOf(page.text, '6EME')).toBe('Collège');
      expect(sectionOf(page.text, 'TERMINALE')).toBe('Lycée');
      expect(page.text).toContain('+ Ajouter un niveau');
      expect(page.text).toContain('6 niveau(x) · 6 actif(s)');

      const terminale = await runWithTenant({ ecoleId }, () =>
        levelModel.findOne({ code: 'TERMINALE' }).lean(),
      );
      const disable = await as(
        request(app.getHttpServer()).post(
          `/settings/levels/${String(terminale!._id)}/enabled`,
        ),
      )
        .type('form')
        .send({ enabled: 'false' });
      expect(disable.status).toBe(302);

      const afterDisable = await as(
        request(app.getHttpServer()).get('/settings/levels'),
      );
      expect(afterDisable.text).toMatch(
        /<td>TERMINALE<\/td>[\s\S]*?aria-checked="false"[\s\S]*?>Inactif</,
      );
      expect(afterDisable.text).toContain('3 niveau(x) · 2 actif(s)');
      // Le niveau desactive n'est plus propose ailleurs (ex. grille des frais).
      const fees = await as(request(app.getHttpServer()).get('/settings/fees'));
      expect(fees.status).toBe(200);
      expect(fees.text).not.toContain(
        '<option value="' + String(terminale!._id),
      );

      await as(
        request(app.getHttpServer()).post(
          `/settings/levels/${String(terminale!._id)}/enabled`,
        ),
      )
        .type('form')
        .send({ enabled: 'true' });
      const afterEnable = await as(
        request(app.getHttpServer()).get('/settings/levels'),
      );
      expect(afterEnable.text).toMatch(
        /<td>TERMINALE<\/td>[\s\S]*?aria-checked="true"[\s\S]*?>Actif</,
      );

      // Lien direct de modification : meme page, fenetre deja ouverte.
      const editPage = await as(
        request(app.getHttpServer()).get(
          `/settings/levels/${String(terminale!._id)}/edit`,
        ),
      );
      expect(editPage.status).toBe(200);
      expect(editPage.text).toMatch(/id="levelEditDialog"[^>]*\bopen\b/);
      expect(editPage.text).toContain(
        `action="/settings/levels/${String(terminale!._id)}"`,
      );

      // Un niveau du primaire accepte une session de bulletins par trimestre.
      const bulletinsService = app.get(BulletinsService);
      const session = await runWithTenant({ ecoleId }, async () => {
        const year = await schoolYearModel
          .findOne({ status: SchoolYearStatus.OPEN })
          .lean();
        const cm2 = await levelModel.findOne({ code: 'CM2' }).lean();
        expect(cm2!.cycle).toBe(LevelCycle.PRIMAIRE);
        return bulletinsService.createSession(
          {
            schoolYearId: String(year!._id),
            levelId: String(cm2!._id),
            periode: Periode.TRIMESTRE_2,
          },
          TEST_DEFAULT_USER_ID,
        );
      });
      expect(session.periode).toBe(Periode.TRIMESTRE_2);
    }, 30000);
  });

  describe('utilisateurs : page en une colonne, actions dans des fenetres', () => {
    it('liste les comptes avec libelles lisibles, et cree / modifie / change le mot de passe via les fenetres', async () => {
      const email = `secretaire.${Date.now()}@ecole.test`;
      const as = (req: request.Test) => req.set('x-test-role', 'super_admin');

      const created = await as(request(app.getHttpServer()).post('/users'))
        .type('form')
        .send({
          name: 'Afi Mensah',
          email,
          password: 'MotDePasse123',
          role: 'secretariat',
          status: 'active',
        });
      expect(created.status).toBe(302);

      const page = await as(
        request(app.getHttpServer()).get(
          `/users?q=${encodeURIComponent(email)}`,
        ),
      );
      expect(page.status).toBe(200);
      // Une seule colonne : plus de mise en page en deux colonnes.
      expect(page.text).not.toContain('two-columns');
      expect(page.text).toContain('+ Créer un utilisateur');
      for (const id of [
        'userCreateDialog',
        'userAccessDialog',
        'userPasswordDialog',
      ]) {
        expect(page.text).toContain(`id="${id}"`);
      }
      expect(page.text).toContain('Afi Mensah');
      expect(page.text).toContain(email);
      // Libelles de roles lisibles (plus de codes bruts comme super_admin).
      expect(page.text).toContain(
        'Rôles et accès : que peut faire chaque rôle ?',
      );
      expect(page.text).toContain(
        '<td><strong>Super administrateur</strong></td>',
      );
      expect(page.text).not.toContain('<td>super_admin</td>');
      // Listes de roles remplies : filtre, fenetre de creation, fenetre d'acces.
      expect(
        page.text.match(/<option value="secretariat"/g)?.length,
      ).toBeGreaterThanOrEqual(3);

      const userId =
        /data-user-action="access"\s+data-id="([a-f0-9]{24})"/.exec(
          page.text,
        )?.[1];
      expect(userId).toBeDefined();

      const access = await as(
        request(app.getHttpServer()).post(`/users/${userId}/access`),
      )
        .type('form')
        .send({ role: 'comptabilite', status: 'disabled' });
      expect(access.status).toBe(302);
      const afterAccess = await as(
        request(app.getHttpServer()).get(
          `/users?q=${encodeURIComponent(email)}`,
        ),
      );
      expect(afterAccess.text).toMatch(
        new RegExp(
          `data-id="${userId}"[^>]*data-role="comptabilite"[^>]*data-status="disabled"`,
        ),
      );

      const password = await as(
        request(app.getHttpServer()).post(`/users/${userId}/password`),
      )
        .type('form')
        .send({ password: 'NouveauMotDePasse456' });
      expect(password.status).toBe(302);
    });
  });

  describe('uniformisation : une colonne et une recherche sur chaque page', () => {
    const renderAs = (role: string) =>
      nunjucks.renderString('{% extends "layout.njk" %}', {
        title: 'Tableau de bord',
        currentUser: { id: TEST_DEFAULT_USER_ID, name: 'Test', role },
        currentPath: '/dashboard',
        activeModules: {},
      });

    it('propose la recherche d eleve dans l en-tete de toutes les pages pour les roles qui ont acces aux eleves', () => {
      for (const role of [
        'super_admin',
        'direction',
        'secretariat',
        'auditeur',
      ]) {
        const html = renderAs(role);
        expect(html).toContain('class="global-search" role="search"');
        expect(html).toMatch(
          /<form action="\/students" method="get" class="global-search"/,
        );
        expect(html).toContain('name="q"');
        // Un seul element : le champ (loupe integree), pas de bouton a cote.
        const form = /<form[^>]*class="global-search"[\s\S]*?<\/form>/.exec(
          html,
        )?.[0];
        expect(form).toBeDefined();
        expect(form).not.toContain('<button');
        // Masquee sur les pages qui ont deja leur propre recherche.
        expect(html).toContain('globalSearch.hidden = true');
      }
      // La comptabilite n'a pas acces a la liste des eleves.
      expect(renderAs('comptabilite')).not.toContain('class="global-search"');
    });

    it('met toute l application sur une colonne et active la recherche des listes des la premiere ligne', () => {
      const css = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'styles.css'),
        'utf8',
      );
      expect(css).toMatch(
        /\.grid\.cols-2 \{\s*grid-template-columns: minmax\(0, 1fr\);/,
      );
      expect(css).toMatch(
        /\.enrollment-layout \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/,
      );
      const filterScript = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'table-filter.js'),
        'utf8',
      );
      expect(filterScript).not.toContain('MIN_ROWS');
      expect(filterScript).toContain('data-filter-group');
    });

    it('page Niveaux : une seule recherche pour tous les cycles', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Recherche ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      const page = await request(app.getHttpServer())
        .get('/settings/levels')
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(page.status).toBe(200);
      expect(page.text).toContain('data-filter-anchor');
      expect(page.text.match(/data-filter-group="levels"/g)).toHaveLength(3);
      expect(page.text).not.toMatch(/level-table" data-no-filter/);
    });
  });

  describe('montants formates (FCFA)', () => {
    it('affiche les frais avec separateur de milliers et devise, et garde les champs de saisie en nombres bruts', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Montants ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      const fees = await request(app.getHttpServer())
        .get('/settings/fees')
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(fees.status).toBe(200);
      // Terminale (seeder) : 185 000 d'ecolage, 20 000 d'inscription.
      expect(fees.text).toContain('185 000 FCFA');
      expect(fees.text).toContain('20 000 FCFA');
      expect(fees.text).not.toMatch(/<td>185000<\/td>/);

      const feeId = /href="\/settings\/fees\/([a-f0-9]{24})\/edit"/.exec(
        fees.text,
      )?.[1];
      const edit = await request(app.getHttpServer())
        .get(`/settings/fees/${feeId}/edit`)
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(edit.status).toBe(200);
      expect(edit.text).toMatch(/name="tuitionFee" value="\d+"/);
    });

    it('rend le formateur disponible cote navigateur avant les scripts des pages', () => {
      const html = nunjucks.renderString('{% extends "layout.njk" %}', {
        title: 'Inscriptions',
      });
      const formatterAt = html.indexOf('window.formatMoney = ');
      expect(formatterAt).toBeGreaterThan(-1);
      expect(formatterAt).toBeLessThan(html.indexOf('</head>'));
    });
  });

  describe('fiche de notes vierge : formulaire en 3 etapes', () => {
    it('presente classe, colonnes (compteurs + apercu) et telechargement, avec les memes champs pour les exports', async () => {
      const page = await request(app.getHttpServer())
        .get('/reports/grade-sheet')
        .set('x-test-role', 'secretariat');
      expect(page.status).toBe(200);
      for (const step of ['Classe', 'Colonnes de la fiche', 'Télécharger']) {
        expect(page.text).toContain(step);
      }
      for (const name of [
        'levelId',
        'noteCount',
        'interroCount',
        'devoirCount',
      ]) {
        expect(page.text).toContain(`name="${name}"`);
      }
      expect(page.text.match(/data-step="-1"/g)).toHaveLength(3);
      expect(page.text).toContain('data-column-preview');
      expect(page.text).toContain('Télécharger le PDF');
      expect(page.text).toContain('formaction="/reports/grade-sheet/docx"');
      expect(page.text).toContain('formaction="/reports/grade-sheet/excel"');
      // Plus de largeurs codees en dur dans la page.
      expect(page.text).not.toContain('style="width:64px;"');
    });
  });

  describe('statistiques de fin de periode : en-tete et filtres', () => {
    it('n affiche le titre qu une fois, guide l utilisateur avant le choix de la periode et garde le bouton a sa taille', async () => {
      // La page porte sur l'annee ouverte - le beforeEach global les ferme.
      const year = await runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
        schoolYearModel.create({
          label: `STATS-UI-${Date.now()}`,
          startDate: new Date('2102-09-01'),
          endDate: new Date('2103-06-30'),
          status: SchoolYearStatus.OPEN,
        }),
      );
      const page = await request(app.getHttpServer())
        .get('/reports/exam-statistics')
        .set('x-test-role', 'direction');
      // L'Excel telecharge porte la legende G / F / T.
      const excel = await request(app.getHttpServer())
        .get('/reports/exam-statistics/excel?periode=trimestre_1&levelId=')
        .set('x-test-role', 'direction')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      await runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
        schoolYearModel.deleteOne({ _id: year._id }),
      );
      expect(excel.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- supertest types res.body as `any`
      await workbook.xlsx.load(excel.body);
      const texts: string[] = [];
      workbook.worksheets[0].eachRow((row) =>
        row.eachCell((cell) => texts.push(cell.text)),
      );
      expect(texts.join(' ')).toContain('G = Garçons, F = Filles, T = Total');

      // Telechargements disponibles des la barre de filtres, sans afficher.
      expect(page.text).toContain('formaction="/reports/exam-statistics/pdf"');
      expect(page.text).toContain(
        'formaction="/reports/exam-statistics/excel"',
      );
      expect(page.status).toBe(200);
      expect(page.text.match(/Statistiques de fin de période/g)).toHaveLength(
        2, // <title> et le titre de page (h1), plus de second titre dans le bloc.
      );
      expect(page.text).not.toContain(
        '<h2>Statistiques de fin de période</h2>',
      );
      expect(page.text).toContain('class="filter-bar" role="search"');
      expect(page.text).toContain(
        'Choisissez une période pour afficher les statistiques.',
      );
    });
  });

  describe('pages allegees : journal de discipline et stocks', () => {
    it('journal de discipline : une seule barre (recherche texte + filtres instantanes)', async () => {
      const page = await request(app.getHttpServer())
        .get('/discipline')
        .set('x-test-role', 'direction');
      expect(page.status).toBe(200);
      expect(page.text).toContain(
        'class="filter-bar" role="search" data-live-search="#discipline-results"',
      );
      expect(page.text).toContain('data-table-filter="#disciplineTable"');
      // Le tableau n'a pas de seconde barre de recherche automatique.
      expect(page.text).toMatch(/id="disciplineTable" data-no-filter/);
      expect(page.text).toContain('id="discipline-results"');
      expect(page.text).toContain('+ Ajouter une entrée');
      expect(page.text).not.toContain('<h2>Journal de discipline</h2>');
    });

    it('stocks : juste la liste et un bouton qui ouvre la fenetre d ajout', async () => {
      const page = await request(app.getHttpServer())
        .get('/stock')
        .set('x-test-role', 'direction');
      expect(page.status).toBe(200);
      expect(page.text).not.toContain('<h2>Nouvel article</h2>');
      expect(page.text).not.toContain('grid cols-2');
      expect(page.text).toContain('data-open-dialog="stockCreateDialog"');
      expect(page.text).toMatch(
        /<dialog id="stockCreateDialog"[\s\S]*?action="\/stock"[\s\S]*?name="name"/,
      );
    });
  });

  describe('parametres : page Frais (deux colonnes, sections repliables)', () => {
    it('garde parametres a gauche et grille a droite, resume chaque reglage et totalise la grille', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Frais ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      const page = await request(app.getHttpServer())
        .get('/settings/fees')
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(page.status).toBe(200);
      expect(page.text).toContain('grid cols-2 keep-columns fees-page');
      expect(
        page.text.match(/<details class="settings-section"/g),
      ).toHaveLength(9);
      // Valeurs actuelles lisibles, plus de codes bruts comme libelles.
      expect(page.text).toContain('Impayés reportés d’abord');
      expect(page.text).not.toContain('>arrears_first<');
      expect(page.text).toContain('Écolage + frais d’inscription');
      // Formulaires inchanges (memes routes).
      for (const action of [
        '/settings/fees',
        '/settings/fees/import',
        '/settings/school-name',
        '/settings/chef-etablissement',
        '/settings/receipt-mode',
        '/settings/payment-allocation',
        '/settings/matricule-rule',
        '/settings/import-paid-students',
        '/settings/fees/expense-categories',
      ]) {
        expect(page.text).toContain(`action="${action}"`);
      }
      // Terminale (seeder) : 20 000 + 185 000 = 205 000.
      expect(page.text).toContain('<strong>205 000 FCFA</strong>');
    });
  });

  describe('depenses : formulaire en haut, liste avec total et recherche unique', () => {
    it('totalise les depenses affichees, formate montants et dates, et filtre par recherche', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const year = await schoolYearModel.create({
          label: `DEP-UI-${Date.now()}`,
          startDate: new Date('2104-09-01'),
          endDate: new Date('2105-06-30'),
          status: SchoolYearStatus.OPEN,
        });
        const as = (req: request.Test) =>
          req.set('x-test-role', 'comptabilite');
        const unique = Date.now();

        const categoryModel: Model<ExpenseCategory> = app.get(
          getModelToken(ExpenseCategory.name),
        );
        const category = await categoryModel.create({
          name: `Fournitures ${unique}`,
        });
        const categoryId = String(category._id);

        for (const [label, amount] of [
          [`Craies ${unique}`, '12500'],
          [`Cahiers ${unique}`, '30000'],
        ]) {
          const created = await as(
            request(app.getHttpServer()).post('/expenses'),
          )
            .type('form')
            .send({
              expenseDate: '2104-10-07',
              label,
              amount,
              beneficiary: 'Librairie du Centre',
              categoryId,
            });
          expect(created.status).toBe(302);
        }

        const page = await as(
          request(app.getHttpServer()).get(
            `/expenses?categoryId=${categoryId}`,
          ),
        );
        expect(page.status).toBe(200);
        // Une seule barre de recherche (instantanee), pas de doublon automatique.
        expect(page.text).toContain(
          'class="filter-bar" role="search" data-live-search="#expenses-results"',
        );
        expect(page.text).toMatch(
          /id="expenses-results"[\s\S]*?data-no-filter/,
        );
        expect(page.text).toContain('2 dépense(s)');
        expect(page.text).toContain('Total : <strong>42 500 FCFA</strong>');
        expect(page.text).toContain('<strong>12 500 FCFA</strong>');
        expect(page.text).toContain('<td>07/10/2104</td>');

        const searched = await as(
          request(app.getHttpServer()).get(
            `/expenses?categoryId=${categoryId}&query=${encodeURIComponent(`Craies ${unique}`)}`,
          ),
        );
        expect(searched.text).toContain(
          '1 dépense(s) correspondant à la recherche',
        );
        expect(searched.text).toContain('Total : <strong>12 500 FCFA</strong>');

        await schoolYearModel.deleteOne({ _id: year._id });
      }));
  });

  describe('fiche eleve : enregistrement sans date de naissance', () => {
    it('accepte la modification d un eleve dont la date de naissance est laissee vide', () =>
      runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
        const student = await studentModel.create({
          matricule: `SANS-DATE-${Date.now()}`,
          lastname: 'BAT',
          firstname: 'Baour',
          gender: 'M',
          status: 'active',
        });

        const response = await request(app.getHttpServer())
          .put(`/students/${String(student._id)}`)
          .set('x-test-role', 'secretariat')
          .type('form')
          .send({
            lastname: 'BAT',
            firstname: 'Baour Junior',
            gender: 'M',
            birthDate: '',
            birthPlace: '',
            district: '',
          });
        // Avant : 400 "birthDate must be a valid ISO 8601 date string".
        expect(response.status).not.toBe(400);
        expect(response.text).not.toContain('ISO 8601');

        const updated = await studentModel.findById(student._id).lean();
        expect(updated?.firstname).toBe('Baour Junior');
        expect(updated?.birthDate).toBeUndefined();

        await studentModel.deleteOne({ _id: student._id });
      }));
  });

  describe('bulletins : modele et saisie pre-remplis avec ce que l application connait', () => {
    it('apres une saisie a l ecran, le modele telecharge contient la note et la session propose la fusion', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Prefill ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });
      const bulletinsService = app.get(BulletinsService);

      const { sessionId, studentId, subjectId } = await runWithTenant(
        { ecoleId },
        async () => {
          const year = await schoolYearModel
            .findOne({ status: SchoolYearStatus.OPEN })
            .lean();
          const level = await levelModel.findOne({ code: 'CM1' }).lean();
          const student = await studentModel.create({
            matricule: `PRE-${Date.now()}`,
            lastname: 'AGBO',
            firstname: 'Kafui',
            gender: 'F',
            status: 'active',
          });
          await enrollmentModel.create({
            studentId: student._id,
            schoolYearId: year!._id,
            levelId: level!._id,
            type: EnrollmentType.INITIAL,
            status: 'active',
          });
          const session = await bulletinsService.createSession(
            {
              schoolYearId: String(year!._id),
              levelId: String(level!._id),
              periode: Periode.TRIMESTRE_1,
            },
            TEST_DEFAULT_USER_ID,
          );
          const entry = await bulletinsService.getGradeEntry(
            String(session._id),
          );
          await bulletinsService.saveGradeEntry(
            String(session._id),
            entry.selected.subjectId,
            {
              [String(student._id)]: { i1: 13, i2: 15, devoir: 14, compo: 16 },
            },
          );
          return {
            sessionId: String(session._id),
            studentId: String(student._id),
            subjectId: entry.selected.subjectId,
          };
        },
      );
      const as = (req: request.Test) =>
        req.set('x-test-role', 'secretariat').set('x-test-ecole-id', ecoleId);

      // Session deja alimentee : "Fusionner" propose par defaut.
      const sessionPage = await as(
        request(app.getHttpServer()).get(`/bulletins/${sessionId}`),
      );
      expect(sessionPage.text).toMatch(/value="fusionner"[^>]*selected/);

      // Le modele telecharge reprend la note saisie a l'ecran.
      const download = await as(
        request(app.getHttpServer()).get(`/bulletins/${sessionId}/template`),
      )
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(download.status).toBe(200);
      const parsed = parseBulletinWorkbook(download.body as Buffer);
      const row = parsed.rows.find((r) => r.nameRaw === 'AGBO Kafui')!;
      expect(row.notes[0]).toMatchObject({
        i1: 13,
        i2: 15,
        devoir: 14,
        compo: 16,
      });

      // Et la saisie a l'ecran reaffiche ces memes notes.
      const reread = await runWithTenant({ ecoleId }, () =>
        bulletinsService.getGradeEntry(sessionId, subjectId),
      );
      expect(
        reread.students.find((s) => s.studentId === studentId),
      ).toMatchObject({
        i1: 13,
        compo: 16,
      });
    }, 30000);
  });

  describe('changement de classe apres paiement', () => {
    it('refuse au secretariat, accepte pour la direction avec motif, recalcule la facture en gardant le paiement', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Classe ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      // Eleve inscrit en 6eme (seeder : 15 000 + 120 000) avec 50 000 payes.
      const { enrollmentId, level4eId } = await runWithTenant(
        { ecoleId },
        async () => {
          const year = await schoolYearModel
            .findOne({ status: SchoolYearStatus.OPEN })
            .lean();
          const level6e = await levelModel.findOne({ code: '6EME' }).lean();
          const level4e = await levelModel.findOne({ code: '4EME' }).lean();
          const student = await studentModel.create({
            matricule: `CLS-${Date.now()}`,
            lastname: 'ADJOVI',
            firstname: 'Komi',
            gender: 'M',
            status: 'active',
          });
          const enrollment = await enrollmentsService.createEnrollment({
            studentId: String(student._id),
            schoolYearId: String(year!._id),
            levelId: String(level6e!._id),
            type: EnrollmentType.INITIAL,
            applyOpenArrears: 'false',
          });
          // Paiement reel (meme service que le guichet).
          await paymentsService.createPayment({
            invoiceId: enrollment.invoiceId,
            amount: 50000,
            method: PaymentMethod.CASH,
          });
          return {
            enrollmentId: String(enrollment.enrollmentId),
            level4eId: String(level4e!._id),
          };
        },
      );
      const invoiceOf = () =>
        runWithTenant({ ecoleId }, () =>
          invoiceModel.findOne({ enrollmentId }).lean(),
        );
      expect((await invoiceOf())?.paidAmount).toBe(50000);

      const asRole = (role: string) => (req: request.Test) =>
        req.set('x-test-role', role).set('x-test-ecole-id', ecoleId);

      // Secretariat : refuse, rien ne change.
      await asRole('secretariat')(
        request(app.getHttpServer()).put(`/enrollments/${enrollmentId}`),
      )
        .type('form')
        .send({ levelId: level4eId, levelChangeReason: 'Erreur' });
      const afterRefusal = await runWithTenant({ ecoleId }, () =>
        enrollmentModel.findById(enrollmentId).lean(),
      );
      expect(String(afterRefusal?.levelId)).not.toBe(level4eId);

      // Direction sans motif : refuse.
      await asRole('direction')(
        request(app.getHttpServer()).put(`/enrollments/${enrollmentId}`),
      )
        .type('form')
        .send({ levelId: level4eId });
      expect(
        String(
          (
            await runWithTenant({ ecoleId }, () =>
              enrollmentModel.findById(enrollmentId).lean(),
            )
          )?.levelId,
        ),
      ).not.toBe(level4eId);

      // Direction avec motif : accepte, facture 4eme (15 000 + 130 000), paiement garde.
      await asRole('direction')(
        request(app.getHttpServer()).put(`/enrollments/${enrollmentId}`),
      )
        .type('form')
        .send({
          levelId: level4eId,
          levelChangeReason: "Erreur de classe a l'inscription",
        });
      const changed = await runWithTenant({ ecoleId }, () =>
        enrollmentModel.findById(enrollmentId).lean(),
      );
      expect(String(changed?.levelId)).toBe(level4eId);
      expect(changed?.levelSnapshot?.label).toBe('4ème');
      const invoice = await invoiceOf();
      expect(invoice?.tuitionFee).toBe(130000);
      expect(invoice?.paidAmount).toBe(50000);
      expect(invoice?.balanceDue).toBe(95000);

      const trace = await runWithTenant({ ecoleId }, () =>
        auditLogModel
          .findOne({
            action: 'enrollment_level_changed',
            entityId: enrollmentId,
          })
          .lean(),
      );
      expect(trace).toBeTruthy();
    }, 30000);
  });

  describe('bulletins : revue d import, matieres a approuver pre-remplies', () => {
    it('reprend le coefficient du fichier et approuve toutes les matieres en une fois', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Revue ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });
      const bulletinsService = app.get(BulletinsService);

      const { sessionId, levelId, yearId } = await runWithTenant(
        { ecoleId },
        async () => {
          const year = await schoolYearModel
            .findOne({ status: SchoolYearStatus.OPEN })
            .lean();
          const level = await levelModel.findOne({ code: 'CM2' }).lean();
          const session = await bulletinsService.createSession(
            {
              schoolYearId: String(year!._id),
              levelId: String(level!._id),
              periode: Periode.TRIMESTRE_1,
              studentMatchingMode: 'auto_create',
            } as never,
            TEST_DEFAULT_USER_ID,
          );
          return {
            sessionId: String(session._id),
            levelId: String(level!._id),
            yearId: String(year!._id),
          };
        },
      );

      // Fichier : Calcul (configure en CM2) + Musique (non configuree, coef 2).
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Notes');
      sheet.addRow([
        'N°',
        'Nom et prénoms',
        'Matricule',
        'Sexe',
        'N/R',
        'Calcul',
        'I1',
        'I2',
        'Devoir',
        'Compo',
        'Coef',
        'Prof',
        'Musique',
        'I1',
        'I2',
        'Devoir',
        'Compo',
        'Coef',
        'Prof',
        'Classe',
        'Titulaire',
        "Chef d'établissement",
        'Année scolaire',
        'Date du conseil',
      ]);
      sheet.addRow([
        1,
        'KOFFI Elom',
        `REV-${Date.now()}`,
        'M',
        'N',
        '',
        12,
        13,
        14,
        15,
        1,
        'M. Aklesso',
        '',
        16,
        15,
        17,
        14,
        2,
        'Mme Sika',
        'CM2',
        '',
        '',
        '2026-2027',
        null,
      ]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      await runWithTenant({ ecoleId }, () =>
        bulletinsService.importFile(
          sessionId,
          buffer,
          BulletinImportMode.PREMIER_IMPORT,
          'revue.xlsx',
        ),
      );
      const as = (req: request.Test) =>
        req.set('x-test-role', 'secretariat').set('x-test-ecole-id', ecoleId);

      const review = await as(
        request(app.getHttpServer()).get(`/bulletins/${sessionId}/review`),
      );
      expect(review.status).toBe(200);
      expect(review.text).toContain('Matières à approuver (1)');
      expect(review.text).toMatch(
        /name="subjects\[0\]\[coefficient\]" value="2"/,
      );
      expect(review.text).toContain('value="Mme Sika"');
      expect(review.text).toContain('Matières configurées pour CM2');
      expect(review.text).not.toContain('semble destiné à une autre classe');

      const approve = await as(
        request(app.getHttpServer()).post(
          `/bulletins/${sessionId}/subjects/approve-all`,
        ),
      )
        .type('form')
        .send(
          'subjects[0][subjectNameRaw]=Musique&subjects[0][label]=Musique' +
            '&subjects[0][category]=autre&subjects[0][coefficient]=2' +
            `&subjects[0][teacherName]=${encodeURIComponent('Mme Sika')}`,
        );
      expect(approve.status).toBe(302);

      const after = await runWithTenant({ ecoleId }, async () => ({
        pending: await bulletinsService.getUnapprovedSubjects(sessionId),
        classSubjects: await bulletinsService.listClassSubjects(
          yearId,
          levelId,
        ),
      }));
      expect(after.pending).toHaveLength(0);
      const musique = after.classSubjects.find(
        (cs) =>
          (cs.subjectId as unknown as { label: string }).label === 'Musique',
      );
      expect(musique?.coefficient).toBe(2);
      expect(musique?.teacherName).toBe('Mme Sika');
    }, 30000);
  });

  describe('bulletins : page des sessions recentree', () => {
    it('montre la liste des sessions avec de simples raccourcis vers la fiche de notes et les statistiques', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Sessions ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      const page = await request(app.getHttpServer())
        .get('/bulletins')
        .set('x-test-role', 'secretariat')
        .set('x-test-ecole-id', ecoleId);
      expect(page.status).toBe(200);
      // Plus de grands encadres en doublon avec le menu...
      expect(page.text).not.toContain('<h3>Fiche de notes vierge</h3>');
      expect(page.text).not.toContain(
        '<h3>Statistiques de fin de période</h3>',
      );
      // ...mais des raccourcis discrets et l'action principale.
      expect(page.text).toContain('href="/reports/grade-sheet"');
      expect(page.text).toContain('href="/reports/exam-statistics"');
      expect(page.text).toContain('+ Nouvelle session');
    });
  });

  describe('bulletins : page matieres et coefficients', () => {
    it('ouvre directement sur l annee ouverte et une classe, et permet modifier puis retirer une matiere', async () => {
      const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
      const ecole = await ecoleModel.create({
        nom: `Ecole Matieres ${Date.now()}`,
        statutCompte: 'actif',
        dateInscription: new Date(),
      });
      const ecoleId = String(ecole._id);
      await seedSchoolConfiguration(app, {
        ecoleId,
        actorId: TEST_DEFAULT_USER_ID,
        activateAllModules: true,
      });

      // Sans aucun filtre : annee ouverte et premiere classe active choisies.
      const page = await request(app.getHttpServer())
        .get('/bulletins/matieres')
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(page.status).toBe(200);
      expect(page.text).toContain('Catalogue des matières');
      // Creation dans une fenetre : la colonne ne montre que la liste.
      expect(page.text).toContain('data-open-dialog="subjectCreateDialog"');
      expect(page.text).toContain('Littéraire');
      expect(page.text).toContain('total des coefficients');
      expect(page.text).toContain('(ouverte)');
      expect(page.text).toContain('<optgroup label="Lycée">');
      expect(page.text).toContain('data-edit-class-subject');

      const { schoolYearId, levelId, philoId, physiqueId } =
        await runWithTenant({ ecoleId }, async () => {
          const levelModel = app.get<Model<Level>>(getModelToken(Level.name));
          const subjectModel = app.get<Model<Subject>>(
            getModelToken(Subject.name),
          );
          const schoolYearModel = app.get<Model<SchoolYear>>(
            getModelToken(SchoolYear.name),
          );
          return {
            levelId: String(
              (await levelModel.findOne({ code: 'TERMINALE' }).lean())!._id,
            ),
            schoolYearId: String(
              (await schoolYearModel
                .findOne({ status: SchoolYearStatus.OPEN })
                .lean())!._id,
            ),
            philoId: String(
              (await subjectModel.findOne({ label: 'Philosophie' }).lean())!
                ._id,
            ),
            physiqueId: String(
              (await subjectModel.findOne({ label: /^Physique/ }).lean())!._id,
            ),
          };
        });
      const url = `/bulletins/matieres?schoolYearId=${schoolYearId}&levelId=${levelId}`;

      // Modifier : nouveau coefficient (demi-points acceptes) et professeur.
      const saved = await request(app.getHttpServer())
        .post('/bulletins/matieres/class-subject')
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId)
        .type('form')
        .send({
          schoolYearId,
          levelId,
          subjectId: philoId,
          coefficient: '4.5',
          teacherName: 'M. Agbeko',
        });
      expect(saved.status).toBe(302);
      expect(saved.headers.location).toBe(url);

      const terminale = await request(app.getHttpServer())
        .get(url)
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(terminale.text).toContain('M. Agbeko');
      expect(terminale.text).toContain('data-coefficient="4.5"');
      // La liste d'ajout ne propose pas les matieres deja dans la classe.
      const addForm = terminale.text.split('Ajouter une matière à')[1] ?? '';
      expect(addForm).not.toContain(`value="${philoId}"`);

      // Retirer une matiere sans notes.
      const classSubjectId = /class-subject\/([a-f0-9]{24})\/delete/.exec(
        terminale.text.split(physiqueId)[1] ?? '',
      )?.[1];
      expect(classSubjectId).toBeDefined();
      const removed = await request(app.getHttpServer())
        .post(`/bulletins/matieres/class-subject/${classSubjectId}/delete`)
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId)
        .type('form')
        .send({ schoolYearId, levelId });
      expect(removed.status).toBe(302);
      expect(removed.headers.location).toBe(url);
      const after = await request(app.getHttpServer())
        .get(url)
        .set('x-test-role', 'direction')
        .set('x-test-ecole-id', ecoleId);
      expect(after.text).not.toContain(`/class-subject/${classSubjectId}/`);
      // ...et elle redevient proposable a l'ajout.
      expect(after.text.split('Ajouter une matière à')[1]).toContain(
        `value="${physiqueId}"`,
      );
    }, 30000);
  });

  describe('journal de discipline : export PDF', () => {
    it('propose le PDF avec les filtres affiches et renvoie toutes les entrees en PDF', async () => {
      const recordModel = app.get<Model<DisciplineRecord>>(
        getModelToken(DisciplineRecord.name),
      );
      const schoolYearId = new Types.ObjectId().toHexString();
      await runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
        recordModel.create({
          studentId: new Types.ObjectId().toHexString(),
          schoolYearId,
          type: DisciplineRecordType.SANCTION,
          date: new Date('2026-10-06'),
          motif: 'Bagarre dans la cour',
        }),
      );

      const page = await request(app.getHttpServer())
        .get(`/discipline?schoolYearId=${schoolYearId}&type=sanction`)
        .set('x-test-role', 'direction');
      expect(page.status).toBe(200);
      // Le bouton est en haut de page, a cote de « + Ajouter une entree »,
      // et non sous la liste ; son lien reprend les filtres affiches.
      const heading = page.text.split('id="discipline-results"')[0] ?? '';
      expect(heading).toMatch(
        /id="disciplinePdfLink" href="\/discipline\/pdf\?studentId=&amp;levelId=&amp;schoolYearId=[a-f0-9]{24}&amp;type=sanction"[^>]*>Télécharger en PDF<\/a>\s*<a class="button" href="\/discipline\/new/,
      );
      expect(page.text.split('id="discipline-results"')[1]).not.toContain(
        'Télécharger en PDF',
      );

      const pdf = await request(app.getHttpServer())
        .get(`/discipline/pdf?schoolYearId=${schoolYearId}&type=sanction`)
        .set('x-test-role', 'auditeur')
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toContain(
        'journal-discipline.pdf',
      );
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('menu Facturation masque et passage annuel en francais', () => {
    const userContext = {
      currentUser: {
        id: TEST_DEFAULT_USER_ID,
        name: 'Awa Koné',
        role: 'super_admin',
        ecoleId: TEST_DEFAULT_ECOLE_ID,
      },
      activeModules: {
        finance: true,
        bulletins: true,
        discipline: true,
        stock: true,
        enseignants: true,
      },
    };

    it('ne montre plus Facturation dans le menu', () => {
      const html = nunjucks.renderString('{% extends "layout.njk" %}', {
        title: 'Dépenses',
        currentPath: '/expenses',
        ...userContext,
      });
      const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
      expect(nav).toContain('href="/expenses"');
      expect(nav).not.toContain('href="/facturation"');
    });

    it('propose les decisions en francais avec une legende', () => {
      const html = nunjucks.renderString(
        '{% include "promotions/prepare.njk" %}',
        {
          title: 'Preparation promotion',
          currentPath: '/promotions/prepare',
          ...userContext,
          schoolYears: [],
          levels: [{ _id: 'lvl-1', label: '5ème' }],
          candidates: [
            {
              _id: 'enr-1',
              studentId: { _id: 'stu-1', lastname: 'ADJO', firstname: 'Koffi' },
              levelId: { label: '6ème' },
              importedDecision: 'repeated',
            },
          ],
        },
      );
      for (const label of [
        'Admis',
        'Redouble',
        'Transféré',
        'Quitte l’école',
        'Archivé',
      ]) {
        expect(html).toContain(label);
      }
      expect(html).toMatch(
        /<option value="repeated"[^>]*selected[^>]*>Redouble<\/option>/,
      );
      expect(html).not.toMatch(/>promoted<\/option>/);
      expect(html).toContain('Légende des décisions');
      expect(html).toContain('Valider les décisions');
    });
  });

  describe('application entierement en francais', () => {
    it('ne propose plus la page technique Eleves par niveau', async () => {
      const page = await request(app.getHttpServer())
        .get('/reports/students-by-level')
        .set('x-test-role', 'direction');
      expect(page.status).toBe(404);
      const html = nunjucks.renderString('{% extends "layout.njk" %}', {
        title: 'Tableau de bord',
        currentPath: '/dashboard',
        currentUser: {
          id: TEST_DEFAULT_USER_ID,
          name: 'Awa Koné',
          role: 'direction',
          ecoleId: TEST_DEFAULT_ECOLE_ID,
        },
        activeModules: { finance: true },
      });
      expect(html).not.toContain('/reports/students-by-level');
    });

    it('affiche statuts et legendes en francais accentue', () => {
      const labels = Object.values(ENUM_META).flatMap((group) =>
        Object.values(group).map((meta) => meta.label),
      );
      for (const expected of [
        'Clôturée',
        'Payée',
        'Impayée',
        'Soldé',
        'Annulé',
        'Désactivé',
        'Validée',
        'À vérifier',
        'Rapproché',
        'Père',
        'Mère',
        'Espèces',
        'Secrétariat',
        'Comptabilité',
        'Expiré',
        'Résilié',
      ]) {
        expect(labels).toContain(expected);
      }
      // Plus aucun mot courant sans accent ni code anglais comme libelle.
      for (const label of labels) {
        expect(label).not.toMatch(
          /\b(Cloturee|Payee|Impayee|Annule|Desactive|Validee|Pere|Mere|Especes|Secretariat|Comptabilite|Expire|Resilie|promoted|repeated|pending|paid|draft)\b/,
        );
      }
      const legend = nunjucks.renderString(
        '{% import "partials/legend.njk" as legend %}{{ legend.render(["invoiceStatus"]) }}',
        {},
      );
      expect(legend).toContain('Légende des statuts');
      expect(legend).toContain('Partiellement payée');
    });
  });
});
