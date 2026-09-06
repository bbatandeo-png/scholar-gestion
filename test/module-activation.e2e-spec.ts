import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Ecole, EcoleDocument } from '../src/ecoles/schemas/ecole.schema';
import { EcoleModule as EcoleModuleModel } from '../src/ecole-modules/schemas/ecole-module.schema';
import { SchoolYear } from '../src/school-years/schemas/school-year.schema';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from '../src/expenses/schemas/expense-category.schema';
import { SchoolYearStatus } from '../src/common/enums/domain.enums';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import { applyTenantMiddleware } from '../src/common/tenant/apply-tenant-middleware';
import { startMongoReplSet } from './mongo-replset';

describe('Activation des modules par ecole (e2e)', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: INestApplication;
  let ecoleModel: Model<EcoleDocument>;
  let ecoleModuleModel: Model<any>;
  let schoolYearModel: Model<SchoolYear>;
  let expenseCategoryModel: Model<ExpenseCategoryDocument>;
  let ecoleId: string;

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
    ecoleModuleModel = app.get(getModelToken(EcoleModuleModel.name));
    schoolYearModel = app.get(getModelToken(SchoolYear.name));
    expenseCategoryModel = app.get(getModelToken(ExpenseCategory.name));

    const ecole = await ecoleModel.create({
      nom: 'Ecole Modules Test',
      statutCompte: 'actif',
      dateInscription: new Date(),
    });
    ecoleId = String(ecole._id);

    await runWithTenant({ ecoleId }, () =>
      schoolYearModel.create({
        label: 'MODULES-2040-2041',
        startDate: new Date('2040-09-01'),
        endDate: new Date('2041-06-30'),
        status: SchoolYearStatus.OPEN,
      }),
    );
    await runWithTenant({ ecoleId }, () =>
      expenseCategoryModel.create({ name: 'Fournitures' }),
    );
  });

  afterAll(async () => {
    await app.close();
    await repl.stop();
  });

  it('bloque une ecriture Finance quand aucun module EcoleModule n est actif pour cette ecole', async () => {
    const response = await request(app.getHttpServer())
      .post('/expenses')
      .set('x-test-role', 'super_admin')
      .set('x-test-ecole-id', ecoleId)
      .send({});

    expect(response.status).toBe(403);
  });

  it('laisse toujours passer une lecture Finance, module inactif ou non', async () => {
    const response = await request(app.getHttpServer())
      .get('/expenses/categories')
      .set('x-test-role', 'super_admin')
      .set('x-test-ecole-id', ecoleId);

    expect(response.status).not.toBe(403);
  });

  it('autorise une ecriture Finance une fois FINANCE active pour cette ecole', async () => {
    const category = await runWithTenant({ ecoleId }, () =>
      expenseCategoryModel.findOne({ name: 'Fournitures' }).exec(),
    );

    await ecoleModuleModel.create({
      ecoleId,
      code: 'FINANCE',
      actif: true,
      dateActivation: new Date(),
      dateDesactivation: null,
      activePar: new Types.ObjectId(),
    });

    const response = await request(app.getHttpServer())
      .post('/expenses')
      .set('x-test-role', 'super_admin')
      .set('x-test-ecole-id', ecoleId)
      .send({
        expenseDate: '2040-10-01',
        label: 'Craies',
        amount: 5000,
        beneficiary: 'Fournisseur X',
        categoryId: String(category!._id),
      });

    expect(response.status).not.toBe(403);
  });

  it('bloque entierement /promotions/validate quand Finance est inactif pour cette ecole', async () => {
    const otherEcole = await ecoleModel.create({
      nom: 'Ecole Sans Finance',
      statutCompte: 'actif',
      dateInscription: new Date(),
    });
    const otherEcoleId = String(otherEcole._id);

    const response = await request(app.getHttpServer())
      .post('/promotions/validate')
      .set('x-test-role', 'super_admin')
      .set('x-test-ecole-id', otherEcoleId)
      .send({
        sourceSchoolYearId: new Types.ObjectId().toHexString(),
        targetSchoolYearId: new Types.ObjectId().toHexString(),
        carryOverArrears: false,
        decisions: [],
      });

    expect(response.status).toBe(403);
  });
});
