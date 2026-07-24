import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/billing/billing.service';
import {
  EnrollmentType,
  PaymentMethod,
  SchoolYearStatus,
} from '../src/common/enums/domain.enums';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { Level } from '../src/levels/schemas/level.schema';
import { Payment } from '../src/payments/schemas/payment.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
import { startMongoReplSet } from './mongo-replset';
import { PromotionsService } from '../src/promotions/promotions.service';
import { Enrollment } from '../src/enrollments/schemas/enrollment.schema';
import { FinalDecision } from '../src/common/enums/domain.enums';

describe('Scolar Gestion workflows (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: INestApplication;
  let billingService: BillingService;
  let enrollmentsService: EnrollmentsService;
  let studentModel: Model<Student>;
  let schoolYearModel: Model<SchoolYear>;
  let levelModel: Model<Level>;
  let paymentModel: Model<Payment>;
  let enrollmentModel: Model<Enrollment>;
  let promotionsService: PromotionsService;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    billingService = app.get(BillingService);
    enrollmentsService = app.get(EnrollmentsService);
    studentModel = app.get(getModelToken(Student.name));
    schoolYearModel = app.get(getModelToken(SchoolYear.name));
    levelModel = app.get(getModelToken(Level.name));
    paymentModel = app.get(getModelToken(Payment.name));
    enrollmentModel = app.get(getModelToken(Enrollment.name));
    promotionsService = app.get(PromotionsService);
    await Promise.all([
      studentModel.init(),
      schoolYearModel.init(),
      levelModel.init(),
      paymentModel.init(),
      enrollmentModel.init(),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await repl.stop();
  });

  beforeEach(async () => {
    await schoolYearModel.updateMany(
      { status: SchoolYearStatus.OPEN },
      { status: SchoolYearStatus.CLOSED },
    );
  });

  it('exige une cloture manuelle avant d activer l annee suivante', async () => {
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
  });

  it('empeche la double inscription active', async () => {
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
  });

  it('POST /students/:id/reenroll ajoute les impayes passes a la nouvelle facture', async () => {
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
  });

  it('POST /payments cree un recu unique', async () => {
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
  });

  it('active une nouvelle annee en promouvant sans modifier l historique source', async () => {
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
      years.find((year) => String(year._id) === String(sourceYear._id))?.status,
    ).toBe('closed');
    expect(
      years.find((year) => String(year._id) === String(targetYear._id))?.status,
    ).toBe('open');
  });
});
