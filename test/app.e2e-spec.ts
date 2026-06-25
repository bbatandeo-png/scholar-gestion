import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/billing/billing.service';
import { EnrollmentType, PaymentMethod, SchoolYearStatus } from '../src/common/enums/domain.enums';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { Level } from '../src/levels/schemas/level.schema';
import { Payment } from '../src/payments/schemas/payment.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
import { startMongoReplSet } from './mongo-replset';

describe('Scolar Gestion workflows (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: INestApplication;
  let billingService: BillingService;
  let enrollmentsService: EnrollmentsService;
  let studentModel: Model<Student>;
  let schoolYearModel: Model<SchoolYear>;
  let levelModel: Model<Level>;
  let paymentModel: Model<Payment>;

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
  });

  afterAll(async () => {
    await app.close();
    await repl.stop();
  });

  it('empeche la double inscription active', async () => {
    const student = await studentModel.create({
      matricule: 'MAT-002', lastname: 'Konan', firstname: 'Awa', gender: 'F',
      birthDate: new Date('2013-05-15'), birthPlace: 'Bouake', district: 'Belleville', status: 'active',
    });
    const year = await schoolYearModel.create({ label: '2027-2028', startDate: new Date('2027-09-01'), endDate: new Date('2028-06-30'), status: SchoolYearStatus.OPEN });
    const level = await levelModel.create({ code: 'CP2', label: 'CP2', sortOrder: 2 });
    await billingService.upsertFeeSchedule({ schoolYearId: String(year._id), levelId: String(level._id), registrationFee: 10000, tuitionFee: 50000 });

    await enrollmentsService.createEnrollment({ studentId: String(student._id), schoolYearId: String(year._id), levelId: String(level._id), type: EnrollmentType.INITIAL, applyOpenArrears: 'false' });

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
      matricule: 'MAT-003', lastname: 'Kouassi', firstname: 'Marc', gender: 'M',
      birthDate: new Date('2012-08-01'), birthPlace: 'Daloa', district: 'Centre', status: 'active',
    });
    const year1 = await schoolYearModel.create({ label: '2024-2025', startDate: new Date('2024-09-01'), endDate: new Date('2025-06-30'), status: SchoolYearStatus.CLOSED });
    const year2 = await schoolYearModel.create({ label: '2025-2026-B', startDate: new Date('2025-09-01'), endDate: new Date('2026-06-30'), status: SchoolYearStatus.OPEN });
    const level = await levelModel.create({ code: 'CE1', label: 'CE1', sortOrder: 3 });
    await billingService.upsertFeeSchedule({ schoolYearId: String(year1._id), levelId: String(level._id), registrationFee: 10000, tuitionFee: 30000 });
    await billingService.upsertFeeSchedule({ schoolYearId: String(year2._id), levelId: String(level._id), registrationFee: 10000, tuitionFee: 35000 });
    const oldEnrollment = await enrollmentsService.createEnrollment({ studentId: String(student._id), schoolYearId: String(year1._id), levelId: String(level._id), type: EnrollmentType.INITIAL, applyOpenArrears: 'false' });
    await billingService.createOrUpdateInvoice({ enrollmentId: oldEnrollment.enrollmentId, registrationFee: 10000, tuitionFee: 30000, discountAmount: 0, arrearsAmount: 0, paidAmount: 5000 });

    const response = await request(app.getHttpServer())
      .post(`/students/${student._id}/reenroll`)
      .set('x-test-role', 'secretariat')
      .send({
        targetSchoolYearId: String(year2._id),
        targetLevelId: String(level._id),
        carryOverArrears: 'true',
      });

    expect(response.status).toBe(302);
    const enrollments = await enrollmentsService.findStudentHistory(String(student._id));
    const newEnrollment = enrollments.find(
      (item: any) => String(item.schoolYearId?._id ?? item.schoolYearId) === String(year2._id),
    );
    const invoice = await billingService.findInvoiceByEnrollment(String(newEnrollment?._id));
    expect(invoice?.arrearsAmount).toBe(35000);
  });

  it('POST /payments cree un recu unique', async () => {
    const student = await studentModel.create({
      matricule: 'MAT-004', lastname: 'Yao', firstname: 'Lina', gender: 'F',
      birthDate: new Date('2011-03-10'), birthPlace: 'Man', district: 'Nord', status: 'active',
    });
    const year = await schoolYearModel.create({ label: '2028-2029', startDate: new Date('2028-09-01'), endDate: new Date('2029-06-30'), status: SchoolYearStatus.OPEN });
    const level = await levelModel.create({ code: 'CM1', label: 'CM1', sortOrder: 5 });
    await billingService.upsertFeeSchedule({ schoolYearId: String(year._id), levelId: String(level._id), registrationFee: 15000, tuitionFee: 60000 });
    const enrollment = await enrollmentsService.createEnrollment({ studentId: String(student._id), schoolYearId: String(year._id), levelId: String(level._id), type: EnrollmentType.INITIAL, applyOpenArrears: 'false' });
    const invoice = await billingService.findInvoiceByEnrollment(enrollment.enrollmentId);

    const first = await request(app.getHttpServer())
      .post('/payments')
      .set('x-test-role', 'comptabilite')
      .send({ invoiceId: String(invoice?._id), amount: 10000, method: PaymentMethod.CASH });
    const second = await request(app.getHttpServer())
      .post('/payments')
      .set('x-test-role', 'comptabilite')
      .send({ invoiceId: String(invoice?._id), amount: 5000, method: PaymentMethod.CASH });

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    const payments = await paymentModel.find({ invoiceId: String(invoice?._id) }).lean().exec();
    expect(payments).toHaveLength(2);
    expect(payments[0].receiptNumber).not.toBe(payments[1].receiptNumber);
  });
});
