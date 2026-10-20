import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import { Model, Types } from 'mongoose';
import type { Response } from 'express';
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
import { verifyLicenseToken } from '../licensing/license-token.util';
import { EcolesService } from './ecoles.service';
import { Ecole, EcoleDocument, EcoleSchema } from './schemas/ecole.schema';

// A fake, in-memory Response that just drains whatever archiver writes to
// it - streamInstallationPackage's own correctness (the bootstrap token,
// SEED_ECOLE_ID, what gets persisted) never depends on actually parsing the
// resulting zip bytes.
function createDrainingResponse(): Response {
  const sink = new Writable({
    write(_chunk, _enc, callback) {
      callback();
    },
  });
  (sink as unknown as { setHeader: () => void }).setHeader = () => undefined;
  return sink as unknown as Response;
}

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
      moduleRef
        .get<Model<unknown>>(getModelToken(EcoleModule.name))
        .createCollection(),
      moduleRef
        .get<Model<unknown>>(getModelToken(AuditLog.name))
        .createCollection(),
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
        },
        actorId(),
      ),
    ).rejects.toThrow('déjà utilisé');

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
        },
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
      moduleRef
        .get<Model<unknown>>(getModelToken(EcoleModule.name))
        .createCollection(),
      moduleRef
        .get<Model<unknown>>(getModelToken(AuditLog.name))
        .createCollection(),
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

describe('EcolesService.streamInstallationPackage', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: EcolesService;
  let ecoleModel: Model<EcoleDocument>;
  let releaseAssetsDir: string;
  let previousReleaseAssetsDir: string | undefined;

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

    await Promise.all([
      moduleRef
        .get<Model<unknown>>(getModelToken(EcoleModule.name))
        .createCollection(),
      moduleRef
        .get<Model<unknown>>(getModelToken(AuditLog.name))
        .createCollection(),
    ]);

    // isReleaseAssetsConfigured() only checks that a real
    // Scolar-Gestion.exe sits in RELEASE_ASSETS_DIR - a placeholder file
    // is enough to exercise the licence-provisioning logic without a real
    // build.
    releaseAssetsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'scolar-release-assets-'),
    );
    fs.writeFileSync(
      path.join(releaseAssetsDir, 'Scolar-Gestion.exe'),
      'placeholder',
    );
    previousReleaseAssetsDir = process.env.RELEASE_ASSETS_DIR;
    process.env.RELEASE_ASSETS_DIR = releaseAssetsDir;
  });

  afterAll(async () => {
    if (previousReleaseAssetsDir === undefined) {
      delete process.env.RELEASE_ASSETS_DIR;
    } else {
      process.env.RELEASE_ASSETS_DIR = previousReleaseAssetsDir;
    }
    fs.rmSync(releaseAssetsDir, { recursive: true, force: true });
    await repl.stop();
  });

  // Each of these onboards a fresh ecole AND streams a real (dummy) zip
  // through archiver against the replica set - slower than the simple CRUD
  // tests above, past jest's 5s default under load.
  it("refuse si aucun exe pre-construit n'est configure", async () => {
    const current = process.env.RELEASE_ASSETS_DIR;
    // Deleting the env var entirely would fall back to this repo's own
    // release-assets/ folder (getReleaseAssetsRoot's default) - which, in
    // this working copy, really does hold a built Scolar-Gestion.exe from
    // earlier in this session, silently defeating the test. Point at an
    // empty dir instead to reliably simulate "nothing configured".
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'scolar-no-release-assets-'),
    );
    process.env.RELEASE_ASSETS_DIR = emptyDir;
    try {
      const { ecole } = await service.onboardNewEcole(
        {
          nom: 'Ecole Sans Exe',
          adminName: 'Admin Sans Exe',
          adminEmail: 'sans-exe@example.com',
        },
        actorId(),
      );
      await expect(
        service.streamInstallationPackage(
          String(ecole._id),
          undefined,
          createDrainingResponse(),
        ),
      ).rejects.toThrow('indisponible');
    } finally {
      process.env.RELEASE_ASSETS_DIR = current;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it("refuse une date d'expiration invalide", async () => {
    const { ecole } = await service.onboardNewEcole(
      {
        nom: 'Ecole Date Invalide',
        adminName: 'Admin Date Invalide',
        adminEmail: 'date-invalide@example.com',
      },
      actorId(),
    );

    await expect(
      service.streamInstallationPackage(
        String(ecole._id),
        new Date('n-importe-quoi'),
        createDrainingResponse(),
      ),
    ).rejects.toThrow("Date d'expiration invalide");
  }, 20000);

  it("refuse une date d'expiration deja passee - un pack livre deja en periode de grace est une erreur, pas une fonctionnalite", async () => {
    const { ecole } = await service.onboardNewEcole(
      {
        nom: 'Ecole Date Passee',
        adminName: 'Admin Date Passee',
        adminEmail: 'date-passee@example.com',
      },
      actorId(),
    );

    await expect(
      service.streamInstallationPackage(
        String(ecole._id),
        new Date('2020-01-01'),
        createDrainingResponse(),
      ),
    ).rejects.toThrow('doit être dans le futur');
  }, 20000);

  it('sans date choisie, ne bootstrap aucune licence (comportement historique)', async () => {
    const { ecole } = await service.onboardNewEcole(
      {
        nom: 'Ecole Sans Date',
        adminName: 'Admin Sans Date',
        adminEmail: 'sans-date@example.com',
      },
      actorId(),
    );

    await service.streamInstallationPackage(
      String(ecole._id),
      undefined,
      createDrainingResponse(),
    );

    const reloaded = await ecoleModel
      .findById(ecole._id)
      .select('+provisioningLicenseSecret')
      .lean()
      .exec();
    expect(reloaded?.licenseActivationKey).toBeUndefined();
    expect(reloaded?.licenseExpiresAt).toBeUndefined();
    // The secret is still generated (needed for any future licence), but no
    // token is signed with it yet.
    expect(reloaded?.provisioningLicenseSecret).toBeDefined();
  }, 20000);

  it('avec une date choisie, bootstrap une licence valide pour cette ecole precise', async () => {
    const { ecole } = await service.onboardNewEcole(
      {
        nom: 'Ecole Avec Date',
        adminName: 'Admin Avec Date',
        adminEmail: 'avec-date@example.com',
      },
      actorId(),
    );
    const ecoleId = String(ecole._id);
    const expiresAt = new Date('2027-06-30');

    await service.streamInstallationPackage(
      ecoleId,
      expiresAt,
      createDrainingResponse(),
    );

    const reloaded = await ecoleModel
      .findById(ecoleId)
      .select('+provisioningLicenseSecret')
      .lean()
      .exec();
    expect(reloaded?.licenseExpiresAt?.toISOString()).toBe(
      expiresAt.toISOString(),
    );
    expect(reloaded?.licenseActivationKey).toBeDefined();

    // The token persisted as bookkeeping must be the exact one a client's
    // scripts/seed.ts would apply via LICENSE_BOOTSTRAP_TOKEN - it has to
    // verify against this same ecole's own provisioningLicenseSecret and
    // decode back to this ecole's own id and the chosen expiry.
    const payload = verifyLicenseToken(
      reloaded!.licenseActivationKey!,
      reloaded!.provisioningLicenseSecret,
    );
    expect(payload?.ecoleId).toBe(ecoleId);
    expect(payload?.expiresAt).toBe(expiresAt.toISOString());

    // A different ecole's secret must never verify this token - each
    // install only trusts its own.
    expect(
      verifyLicenseToken(reloaded!.licenseActivationKey!, 'un-autre-secret'),
    ).toBeNull();
  }, 20000);
});
