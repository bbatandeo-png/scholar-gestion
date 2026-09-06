import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Ecole, EcoleDocument } from '../src/ecoles/schemas/ecole.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import { Student } from '../src/students/schemas/student.schema';
import { Level } from '../src/levels/schemas/level.schema';
import { Enrollment } from '../src/enrollments/schemas/enrollment.schema';
import { Invoice } from '../src/billing/schemas/invoice.schema';
import { Expense } from '../src/expenses/schemas/expense.schema';
import { ExpenseCategory } from '../src/expenses/schemas/expense-category.schema';
import {
  EnrollmentType,
  SchoolYearStatus,
} from '../src/common/enums/domain.enums';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import { applyTenantMiddleware } from '../src/common/tenant/apply-tenant-middleware';
import { startMongoReplSet } from './mongo-replset';
import { ReportsService } from '../src/reports/reports.service';
import { ExpensesService } from '../src/expenses/expenses.service';

describe('Isolation multi-ecole (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: INestApplication;
  let ecoleModel: Model<EcoleDocument>;
  let studentModel: Model<Student>;
  let schoolYearModel: Model<SchoolYear>;
  let ecoleAId: string;
  let ecoleBId: string;
  let studentAId: string;
  let studentBId: string;
  let schoolYearBId: string;
  let reportsService: ReportsService;
  let expensesService: ExpensesService;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    applyTenantMiddleware(app);
    await app.init();

    ecoleModel = app.get(getModelToken(Ecole.name));
    studentModel = app.get(getModelToken(Student.name));
    schoolYearModel = app.get(getModelToken(SchoolYear.name));
    await studentModel.init();

    const ecoleA = await ecoleModel.create({
      nom: 'Ecole Alpha',
      statutCompte: 'actif',
      dateInscription: new Date(),
    });
    const ecoleB = await ecoleModel.create({
      nom: 'Ecole Beta',
      statutCompte: 'actif',
      dateInscription: new Date(),
    });
    ecoleAId = String(ecoleA._id);
    ecoleBId = String(ecoleB._id);

    const studentA = await runWithTenant({ ecoleId: ecoleAId }, () =>
      studentModel.create({
        matricule: 'ISOL-A-001',
        lastname: 'Isolation',
        firstname: 'AlphaEleve',
        gender: 'F',
        birthDate: new Date('2013-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      }),
    );
    const studentB = await runWithTenant({ ecoleId: ecoleBId }, () =>
      studentModel.create({
        matricule: 'ISOL-B-001',
        lastname: 'Isolation',
        firstname: 'BetaEleve',
        gender: 'M',
        birthDate: new Date('2013-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      }),
    );
    studentAId = String(studentA._id);
    studentBId = String(studentB._id);

    await runWithTenant({ ecoleId: ecoleAId }, () =>
      schoolYearModel.create({
        label: 'ISOL-2040-2041',
        startDate: new Date('2040-09-01'),
        endDate: new Date('2041-06-30'),
        status: SchoolYearStatus.OPEN,
      }),
    );

    // Fixtures for ecole B's own school year/level/enrollment/invoice/expense
    // - used below to prove the two aggregate-pipeline call sites the
    // multi-tenant plan flagged as the highest-risk area (reports.service.ts
    // studentsByLevel/revenue, expenses.service.ts getTotals) never leak
    // another ecole's rows, even when explicitly given that ecole's own
    // schoolYearId.
    reportsService = app.get(ReportsService);
    expensesService = app.get(ExpensesService);
    const levelModel: Model<Level> = app.get(getModelToken(Level.name));
    const enrollmentModel: Model<Enrollment> = app.get(
      getModelToken(Enrollment.name),
    );
    const invoiceModel: Model<Invoice> = app.get(getModelToken(Invoice.name));
    const expenseModel: Model<Expense> = app.get(getModelToken(Expense.name));
    const expenseCategoryModel: Model<ExpenseCategory> = app.get(
      getModelToken(ExpenseCategory.name),
    );

    await runWithTenant({ ecoleId: ecoleBId }, async () => {
      const schoolYearB = await schoolYearModel.create({
        label: 'ISOL-B-2040-2041',
        startDate: new Date('2040-09-01'),
        endDate: new Date('2041-06-30'),
        status: SchoolYearStatus.OPEN,
      });
      schoolYearBId = String(schoolYearB._id);
      const levelB = await levelModel.create({
        code: 'ISOL-B-LVL',
        label: 'Isolation Beta Level',
        sortOrder: 1,
      });
      const enrollmentB = await enrollmentModel.create({
        studentId: studentBId,
        schoolYearId: schoolYearBId,
        levelId: String(levelB._id),
        type: EnrollmentType.INITIAL,
        status: 'active',
      });
      await invoiceModel.create({
        schoolYearId: schoolYearBId,
        enrollmentId: String(enrollmentB._id),
        registrationFee: 5000,
        tuitionFee: 50000,
        discountAmount: 0,
        arrearsAmount: 0,
        totalDue: 55000,
        paidAmount: 0,
        balanceDue: 55000,
        status: 'unpaid',
      });
      const categoryB = await expenseCategoryModel.create({
        name: 'Isolation Beta Category',
      });
      await expenseModel.create({
        schoolYearId: schoolYearBId,
        orderNumber: 'ISOL-B-EXP-001',
        expenseDate: new Date('2040-10-01'),
        label: 'Depense Beta',
        amount: 12345,
        beneficiary: 'Fournisseur Beta',
        categoryId: String(categoryB._id),
      });
    });
  });

  afterAll(async () => {
    await app.close();
    await repl.stop();
  });

  it("l'autocomplete (endpoint aggregate) ne retourne que les eleves de l'ecole de la session", async () => {
    const response = await request(app.getHttpServer())
      .get('/students/autocomplete')
      .query({ q: 'Isolation' })
      .set('x-test-role', 'secretariat')
      .set('x-test-ecole-id', ecoleAId);

    expect(response.status).toBe(200);
    const body = response.body as { items: Array<{ matricule: string }> };
    const matricules = body.items.map((item) => item.matricule);
    expect(matricules).toContain('ISOL-A-001');
    expect(matricules).not.toContain('ISOL-B-001');
  });

  it("un eleve d'une autre ecole n'est jamais accessible par id (404, pas de fuite)", async () => {
    // Uses the JSON financial-status endpoint (not the HTML detail page) so
    // this stays a pure API-level check independent of view rendering.
    const crossTenant = await request(app.getHttpServer())
      .get(`/students/${studentBId}/financial-status`)
      .set('x-test-role', 'secretariat')
      .set('x-test-ecole-id', ecoleAId);
    expect(crossTenant.status).toBe(404);

    const sameTenant = await request(app.getHttpServer())
      .get(`/students/${studentAId}/financial-status`)
      .set('x-test-role', 'secretariat')
      .set('x-test-ecole-id', ecoleAId);
    expect(sameTenant.status).toBe(200);
  });

  it('les aggregations (studentsByLevel, revenue, getTotals) ne fuient jamais les donnees d une autre ecole', async () => {
    // Same tenant (B) sees its own data.
    const ownStudentsByLevel = await runWithTenant({ ecoleId: ecoleBId }, () =>
      reportsService.studentsByLevel(schoolYearBId),
    );
    expect(ownStudentsByLevel.some((row: any) => row.total > 0)).toBe(true);

    const ownRevenue = await runWithTenant({ ecoleId: ecoleBId }, () =>
      reportsService.revenue(schoolYearBId),
    );
    expect(ownRevenue.totalDue).toBe(55000);

    const ownExpenseTotals = await runWithTenant({ ecoleId: ecoleBId }, () =>
      expensesService.getTotals(schoolYearBId),
    );
    expect(ownExpenseTotals.totalExpenses).toBe(12345);

    // Ecole A's tenant context, given ecole B's own schoolYearId explicitly -
    // the plugin's aggregate $match on ecoleId must still block every row.
    const crossStudentsByLevel = await runWithTenant(
      { ecoleId: ecoleAId },
      () => reportsService.studentsByLevel(schoolYearBId),
    );
    expect(crossStudentsByLevel).toEqual([]);

    const crossRevenue = await runWithTenant({ ecoleId: ecoleAId }, () =>
      reportsService.revenue(schoolYearBId),
    );
    expect(crossRevenue.totalDue).toBe(0);
    expect(crossRevenue.outstanding).toBe(0);

    const crossExpenseTotals = await runWithTenant({ ecoleId: ecoleAId }, () =>
      expensesService.getTotals(schoolYearBId),
    );
    expect(crossExpenseTotals.totalExpenses).toBe(0);
  });
});
