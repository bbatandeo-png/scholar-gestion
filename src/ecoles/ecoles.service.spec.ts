import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { Role } from '../common/enums/domain.enums';
import { AuditService } from '../audit/audit.service';
import { AuditLog, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import { EcoleModulesService } from '../ecole-modules/ecole-modules.service';
import {
  EcoleModule,
  EcoleModuleSchema,
} from '../ecole-modules/schemas/ecole-module.schema';
import {
  SchoolYear,
  SchoolYearSchema,
} from '../school-years/schemas/school-year.schema';
import { SchoolYearsService } from '../school-years/school-years.service';
import {
  runAsPlatformAdmin,
  runWithTenant,
} from '../common/tenant/tenant-context';
import { User, UserDocument, UserSchema } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { EcolesService } from './ecoles.service';
import { Ecole, EcoleDocument, EcoleSchema } from './schemas/ecole.schema';

const actorId = () => new Types.ObjectId().toHexString();

describe('EcolesService.onboardNewEcole', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: EcolesService;
  let ecoleModel: Model<EcoleDocument>;
  let userModel: Model<UserDocument>;
  let schoolYearModel: Model<any>;
  let ecoleModulesService: EcoleModulesService;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([
          { name: Ecole.name, schema: EcoleSchema },
          { name: User.name, schema: UserSchema },
          { name: SchoolYear.name, schema: SchoolYearSchema },
          { name: EcoleModule.name, schema: EcoleModuleSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [
        EcolesService,
        UsersService,
        SchoolYearsService,
        EcoleModulesService,
        AuditService,
      ],
    }).compile();

    service = moduleRef.get(EcolesService);
    ecoleModel = moduleRef.get(getModelToken(Ecole.name));
    userModel = moduleRef.get(getModelToken(User.name));
    schoolYearModel = moduleRef.get(getModelToken(SchoolYear.name));
    ecoleModulesService = moduleRef.get(EcoleModulesService);

    // MongoDB can't implicitly create a brand-new collection as the first
    // write inside a transaction - pre-create the collections written to by
    // EcoleModulesService.activate() (called from onboardNewEcole when a
    // module checkbox is ticked at creation time).
    await Promise.all([
      moduleRef.get(getModelToken(EcoleModule.name)).createCollection(),
      moduleRef.get(getModelToken(AuditLog.name)).createCollection(),
    ]);
  });

  afterAll(async () => {
    await repl.stop();
  });

  it("cree l'ecole et son premier compte SUPER_ADMIN avec un mot de passe temporaire utilisable", async () => {
    const { ecole, admin, tempPassword } = await service.onboardNewEcole(
      {
        nom: 'Complexe Scolaire Test',
        adminName: 'Directrice Test',
        adminEmail: 'directrice@complexe-test.example',
      },
      actorId(),
    );

    expect(ecole.nom).toBe('Complexe Scolaire Test');
    expect(admin.role).toBe(Role.SUPER_ADMIN);
    expect(String(admin.ecoleId)).toBe(String(ecole._id));
    expect(admin.email).toBe('directrice@complexe-test.example');
    expect(tempPassword).toHaveLength(12);

    const stored = await userModel
      .findOne({ email: 'directrice@complexe-test.example' })
      .exec();
    expect(stored).toBeDefined();
    const matches = await bcrypt.compare(tempPassword, stored!.passwordHash);
    expect(matches).toBe(true);

    // Without an OPEN school year, the very first page a fresh admin
    // lands on (the dashboard) fails with "Aucune annee scolaire ouverte" -
    // onboarding must provision one so the account is usable immediately.
    const schoolYears = await runWithTenant(
      { ecoleId: String(ecole._id) },
      () => schoolYearModel.find().lean().exec(),
    );
    expect(schoolYears).toHaveLength(1);
    expect(schoolYears[0].status).toBe('open');
  });

  it("refuse la creation si l'email administrateur est deja utilise, sans laisser d'ecole orpheline", async () => {
    await service.onboardNewEcole(
      {
        nom: 'Premiere Ecole',
        adminName: 'Admin Un',
        adminEmail: 'deja-utilise@example.com',
      },
      actorId(),
    );

    const countBefore = await ecoleModel.countDocuments().exec();

    await expect(
      service.onboardNewEcole(
        {
          nom: 'Deuxieme Ecole',
          adminName: 'Admin Deux',
          adminEmail: 'deja-utilise@example.com',
        } as any,
        actorId(),
      ),
    ).rejects.toThrow('deja utilise');

    const countAfter = await ecoleModel.countDocuments().exec();
    expect(countAfter).toBe(countBefore);
  });

  it('active les modules coches a la creation, aucun par defaut si rien n est coche', async () => {
    const actor = actorId();

    const { ecole: ecoleNone } = await service.onboardNewEcole(
      {
        nom: 'Ecole Sans Module',
        adminName: 'Admin Sans Module',
        adminEmail: 'sans-module@example.com',
      },
      actor,
    );
    const { ecole: ecoleBoth } = await runAsPlatformAdmin(() =>
      service.onboardNewEcole(
        {
          nom: 'Ecole Avec Modules',
          adminName: 'Admin Avec Modules',
          adminEmail: 'avec-modules@example.com',
          activateFinance: 'true',
          activateBulletins: 'true',
        } as any,
        actor,
      ),
    );

    await runAsPlatformAdmin(async () => {
      expect(
        await ecoleModulesService.isActive(String(ecoleNone._id), 'FINANCE'),
      ).toBe(false);
      expect(
        await ecoleModulesService.isActive(String(ecoleNone._id), 'BULLETINS'),
      ).toBe(false);
      expect(
        await ecoleModulesService.isActive(String(ecoleBoth._id), 'FINANCE'),
      ).toBe(true);
      expect(
        await ecoleModulesService.isActive(String(ecoleBoth._id), 'BULLETINS'),
      ).toBe(true);
    });
  });
});

describe('EcolesService.resetAdminPassword', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: EcolesService;
  let userModel: Model<UserDocument>;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([
          { name: Ecole.name, schema: EcoleSchema },
          { name: User.name, schema: UserSchema },
          { name: SchoolYear.name, schema: SchoolYearSchema },
          { name: EcoleModule.name, schema: EcoleModuleSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [
        EcolesService,
        UsersService,
        SchoolYearsService,
        EcoleModulesService,
        AuditService,
      ],
    }).compile();

    service = moduleRef.get(EcolesService);
    userModel = moduleRef.get(getModelToken(User.name));

    await Promise.all([
      moduleRef.get(getModelToken(EcoleModule.name)).createCollection(),
      moduleRef.get(getModelToken(AuditLog.name)).createCollection(),
    ]);
  });

  afterAll(async () => {
    await repl.stop();
  });

  it("genere un nouveau mot de passe utilisable pour le compte d'une ecole", async () => {
    const {
      ecole,
      admin,
      tempPassword: firstPassword,
    } = await service.onboardNewEcole(
      {
        nom: 'Ecole Reset',
        adminName: 'Admin Reset',
        adminEmail: 'reset@example.com',
      },
      actorId(),
    );

    const { email, tempPassword: secondPassword } =
      await service.resetAdminPassword(String(ecole._id), String(admin._id));
    expect(email).toBe('reset@example.com');
    expect(secondPassword).not.toBe(firstPassword);

    const refreshed = await userModel
      .findOne({ email: 'reset@example.com' })
      .exec();
    const matchesNew = await bcrypt.compare(
      secondPassword,
      refreshed!.passwordHash,
    );
    const matchesOld = await bcrypt.compare(
      firstPassword,
      refreshed!.passwordHash,
    );
    expect(matchesNew).toBe(true);
    expect(matchesOld).toBe(false);
  });

  it("refuse de reinitialiser un compte qui n'appartient pas a l'ecole indiquee", async () => {
    const { ecole: ecoleA } = await service.onboardNewEcole(
      {
        nom: 'Ecole A Reset',
        adminName: 'Admin A',
        adminEmail: 'admin-a-reset@example.com',
      },
      actorId(),
    );
    const { ecole: ecoleB, admin: adminB } = await service.onboardNewEcole(
      {
        nom: 'Ecole B Reset',
        adminName: 'Admin B',
        adminEmail: 'admin-b-reset@example.com',
      },
      actorId(),
    );

    await expect(
      service.resetAdminPassword(String(ecoleA._id), String(adminB._id)),
    ).rejects.toThrow('introuvable');

    // Sanity: the same reset succeeds against the correct ecole.
    await expect(
      service.resetAdminPassword(String(ecoleB._id), String(adminB._id)),
    ).resolves.toBeDefined();
  });
});
