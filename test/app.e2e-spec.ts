import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ENUM_META } from '../src/common/view-helpers/enum-meta';
import { BillingService } from '../src/billing/billing.service';
import {
  EnrollmentType,
  PaymentMethod,
  SchoolYearStatus,
} from '../src/common/enums/domain.enums';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { LevelsService } from '../src/levels/levels.service';
import { Level } from '../src/levels/schemas/level.schema';
import { Payment } from '../src/payments/schemas/payment.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
import { startMongoReplSet } from './mongo-replset';
import { PromotionsService } from '../src/promotions/promotions.service';
import { SchoolYearsService } from '../src/school-years/school-years.service';
import { Enrollment } from '../src/enrollments/schemas/enrollment.schema';
import { FinalDecision } from '../src/common/enums/domain.enums';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import {
  TEST_DEFAULT_ECOLE_ID,
  TEST_DEFAULT_USER_ID,
} from '../src/common/tenant/ensure-test-session-user.util';
import { applyTenantMiddleware } from '../src/common/tenant/apply-tenant-middleware';
import { EcoleModule as EcoleModuleModel } from '../src/ecole-modules/schemas/ecole-module.schema';

describe('Scolar Gestion workflows (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: NestExpressApplication;
  let billingService: BillingService;
  let enrollmentsService: EnrollmentsService;
  let studentModel: Model<Student>;
  let schoolYearModel: Model<SchoolYear>;
  let levelModel: Model<Level>;
  let paymentModel: Model<Payment>;
  let enrollmentModel: Model<Enrollment>;
  let promotionsService: PromotionsService;
  let schoolYearsService: SchoolYearsService;
  let levelsService: LevelsService;

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

    await app.init();

    billingService = app.get(BillingService);
    enrollmentsService = app.get(EnrollmentsService);
    studentModel = app.get(getModelToken(Student.name));
    schoolYearModel = app.get(getModelToken(SchoolYear.name));
    levelModel = app.get(getModelToken(Level.name));
    paymentModel = app.get(getModelToken(Payment.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    promotionsService = app.get(PromotionsService);
    schoolYearsService = app.get(SchoolYearsService);
    levelsService = app.get(LevelsService);
    await Promise.all([
      studentModel.init(),
      schoolYearModel.init(),
      levelModel.init(),
      paymentModel.init(),
      enrollmentModel.init(),
    ]);

    // This whole spec predates the Finance module-activation feature and
    // exercises Finance-gated routes (payments, promotions) throughout -
    // activate FINANCE once for the shared test ecole rather than touching
    // every individual test. Module-activation itself is covered by
    // test/module-activation.e2e-spec.ts.
    const ecoleModuleModel: Model<any> = app.get(
      getModelToken(EcoleModuleModel.name),
    );
    await runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, () =>
      ecoleModuleModel.create({
        ecoleId: TEST_DEFAULT_ECOLE_ID,
        code: 'FINANCE',
        actif: true,
        dateActivation: new Date(),
        dateDesactivation: null,
        activePar: TEST_DEFAULT_USER_ID,
      }),
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

      expect(response.status).toBe(409);
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
      expect(response.text).toContain(`value="${String(level._id)}" selected`);
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
    }));

  it('POST /students cree un dossier eleve sans date de naissance, lieu de naissance ni quartier', () =>
    runWithTenant({ ecoleId: TEST_DEFAULT_ECOLE_ID }, async () => {
      const response = await request(app.getHttpServer())
        .post('/students')
        .set('x-test-role', 'secretariat')
        .send({
          matricule: 'MAT-903',
          lastname: 'Minimal',
          firstname: 'Dossier',
          gender: 'M',
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
});
