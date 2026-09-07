import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { runAsPlatformAdmin } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { AuditLog, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import { EcoleModulesService } from './ecole-modules.service';
import {
  EcoleModule,
  EcoleModuleDocument,
  EcoleModuleSchema,
} from './schemas/ecole-module.schema';

describe('EcoleModulesService', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: EcoleModulesService;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([
          { name: EcoleModule.name, schema: EcoleModuleSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
      ],
      providers: [EcoleModulesService, AuditService],
    }).compile();

    service = moduleRef.get(EcoleModulesService);

    // MongoDB can't implicitly create a brand-new collection as the first
    // write inside a transaction - pre-create both collections written to
    // inside activate()/deactivate() (EcoleModule itself, and AuditLog via
    // AuditService.log) before any transactional test runs.
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

  const ecoleId = () => new Types.ObjectId().toHexString();
  const actorId = () => new Types.ObjectId().toHexString();

  // EcoleModulesService is always called from an already-established tenant
  // context in production (a normal school request for isActive(), or a
  // PLATFORM_ADMIN bypass request from EcolesController for activate/
  // deactivate/listForEcole) - runAsPlatformAdmin here mirrors the latter,
  // the context these methods actually run under from EcolesController.
  const withPlatformAdmin = <T>(fn: () => Promise<T>) => runAsPlatformAdmin(fn);

  it('active un module, isActive() le reflete immediatement', async () => {
    const ecole = ecoleId();
    const actor = actorId();

    expect(
      await withPlatformAdmin(() => service.isActive(ecole, 'FINANCE')),
    ).toBe(false);

    await withPlatformAdmin(() => service.activate(ecole, 'FINANCE', actor));

    expect(
      await withPlatformAdmin(() => service.isActive(ecole, 'FINANCE')),
    ).toBe(true);
    const open = await withPlatformAdmin(() => service.listForEcole(ecole));
    expect(open).toHaveLength(1);
    expect(open[0].code).toBe('FINANCE');
    expect(String(open[0].activePar)).toBe(actor);
    expect(open[0].dateDesactivation).toBeNull();
  });

  it('activer un module deja actif est idempotent (pas de nouvelle ligne)', async () => {
    const ecole = ecoleId();
    const actor = actorId();

    const first = await withPlatformAdmin(() =>
      service.activate(ecole, 'FINANCE', actor),
    );
    const second = await withPlatformAdmin(() =>
      service.activate(ecole, 'FINANCE', actor),
    );

    expect(String(first._id)).toBe(String(second._id));
    const open = await withPlatformAdmin(() => service.listForEcole(ecole));
    expect(open).toHaveLength(1);
  });

  it('desactiver ferme la ligne ouverte et conserve son historique, sans la supprimer', async () => {
    const ecole = ecoleId();
    const activator = actorId();
    const deactivator = actorId();

    await withPlatformAdmin(() =>
      service.activate(ecole, 'BULLETINS', activator),
    );
    await withPlatformAdmin(() =>
      service.deactivate(ecole, 'BULLETINS', deactivator),
    );

    expect(
      await withPlatformAdmin(() => service.isActive(ecole, 'BULLETINS')),
    ).toBe(false);
    expect(
      await withPlatformAdmin(() => service.listForEcole(ecole)),
    ).toHaveLength(0);
  });

  it('reactiver apres une desactivation cree une nouvelle ligne distincte (historique complet)', async () => {
    const ecole = ecoleId();
    const actor = actorId();

    const first = await withPlatformAdmin(() =>
      service.activate(ecole, 'FINANCE', actor),
    );
    await withPlatformAdmin(() => service.deactivate(ecole, 'FINANCE', actor));
    const second = await withPlatformAdmin(() =>
      service.activate(ecole, 'FINANCE', actor),
    );

    expect(String(first._id)).not.toBe(String(second._id));
    expect(
      await withPlatformAdmin(() => service.isActive(ecole, 'FINANCE')),
    ).toBe(true);
  });

  it('desactiver un module deja inactif est un no-op silencieux', async () => {
    const ecole = ecoleId();
    const actor = actorId();

    await expect(
      withPlatformAdmin(() => service.deactivate(ecole, 'FINANCE', actor)),
    ).resolves.toBeUndefined();
    expect(
      await withPlatformAdmin(() => service.isActive(ecole, 'FINANCE')),
    ).toBe(false);
  });

  it('deux ecoles distinctes ont un etat de module totalement independant', async () => {
    const ecoleA = ecoleId();
    const ecoleB = ecoleId();
    const actor = actorId();

    await withPlatformAdmin(() => service.activate(ecoleA, 'FINANCE', actor));

    expect(
      await withPlatformAdmin(() => service.isActive(ecoleA, 'FINANCE')),
    ).toBe(true);
    expect(
      await withPlatformAdmin(() => service.isActive(ecoleB, 'FINANCE')),
    ).toBe(false);
  });

  it("l'index partiel unique empeche deux lignes ouvertes pour le meme ecole+code", async () => {
    const ecoleModuleModel = (
      service as unknown as { ecoleModuleModel: Model<EcoleModuleDocument> }
    ).ecoleModuleModel;
    const ecole = ecoleId();
    const actor = actorId();

    await withPlatformAdmin(() =>
      ecoleModuleModel.create({
        ecoleId: ecole,
        code: 'FINANCE',
        actif: true,
        dateActivation: new Date(),
        dateDesactivation: null,
        activePar: actor,
      }),
    );

    await expect(
      withPlatformAdmin(() =>
        ecoleModuleModel.create({
          ecoleId: ecole,
          code: 'FINANCE',
          actif: true,
          dateActivation: new Date(),
          dateDesactivation: null,
          activePar: actor,
        }),
      ),
    ).rejects.toThrow();
  });
});
