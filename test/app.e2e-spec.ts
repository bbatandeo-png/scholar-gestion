import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { ENUM_META } from '../src/common/view-helpers/enum-meta';
import { BillingService } from '../src/billing/billing.service';
import { SettingsService } from '../src/settings/settings.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { PaymentsService } from '../src/payments/payments.service';
import {
  EnrollmentType,
  PaymentMethod,
  SchoolYearStatus,
} from '../src/common/enums/domain.enums';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { LevelsService } from '../src/levels/levels.service';
import { Level } from '../src/levels/schemas/level.schema';
import { Subject } from '../src/bulletins/schemas/subject.schema';
import { TeacherAssignment } from '../src/teachers/schemas/teacher-assignment.schema';
import { Payment } from '../src/payments/schemas/payment.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
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

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    applyTenantMiddleware(app);

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
      ).rejects.toThrow('Double inscription active interdite pour cette annee');
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
        /autocomplete="off"\s+required\s+placeholder="Rechercher un eleve/,
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
        expect(afterRenewal.text).toContain('Expire');

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
});
