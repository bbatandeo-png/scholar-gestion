import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { runWithTenant } from '../common/tenant/tenant-context';
import { FacturationMode } from '../common/enums/domain.enums';
import { FacturationService } from './facturation.service';
import {
  Consommation,
  ConsommationSchema,
} from './schemas/consommation.schema';
import { Facture, FactureSchema } from './schemas/facture.schema';
import {
  ParametreFacturation,
  ParametreFacturationSchema,
} from './schemas/parametre-facturation.schema';

describe('FacturationService', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: FacturationService;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([
          {
            name: ParametreFacturation.name,
            schema: ParametreFacturationSchema,
          },
          { name: Consommation.name, schema: ConsommationSchema },
          { name: Facture.name, schema: FactureSchema },
        ]),
      ],
      providers: [FacturationService],
    }).compile();

    service = moduleRef.get(FacturationService);

    // MongoDB can't implicitly create a brand-new collection as the first
    // write inside a transaction (causes catalog races under concurrent
    // test runs) - pre-create them here so changeParametre()/genererFacture()
    // (both transactional) never hit that as their first write.
    await Promise.all([
      moduleRef
        .get<Model<unknown>>(getModelToken(ParametreFacturation.name))
        .createCollection(),
      moduleRef
        .get<Model<unknown>>(getModelToken(Consommation.name))
        .createCollection(),
      moduleRef
        .get<Model<unknown>>(getModelToken(Facture.name))
        .createCollection(),
    ]);
  });

  afterAll(async () => {
    await repl.stop();
  });

  const ecoleId = () => new Types.ObjectId().toHexString();

  it('historise le parametre de facturation au lieu de le modifier en place', async () => {
    const tenant = { ecoleId: ecoleId() };
    const first = await runWithTenant(tenant, () =>
      service.changeParametre({
        mode: FacturationMode.USAGE_BULLETIN,
        montantUnitaire: 100,
      }),
    );
    const second = await runWithTenant(tenant, () =>
      service.changeParametre({
        mode: FacturationMode.FORFAIT,
        montantUnitaire: 5000,
      }),
    );

    expect(String(first._id)).not.toBe(String(second._id));

    const actif = await runWithTenant(tenant, () =>
      service.getParametreActif(),
    );
    expect(String(actif?._id)).toBe(String(second._id));
    expect(actif?.mode).toBe('forfait');
  });

  it('ne cree jamais deux consommations facturables pour la meme regeneration de bulletin', async () => {
    const tenant = { ecoleId: ecoleId() };
    const eleveId = ecoleId();
    const classeId = ecoleId();
    const anneeScolaireId = ecoleId();

    const first = await runWithTenant(tenant, () =>
      service.recordBulletinGeneration({
        eleveId,
        classeId,
        periode: 'T1',
        anneeScolaireId,
      }),
    );
    const second = await runWithTenant(tenant, () =>
      service.recordBulletinGeneration({
        eleveId,
        classeId,
        periode: 'T1',
        anneeScolaireId,
      }),
    );

    expect(String(first._id)).toBe(String(second._id));
  });

  it("ne facture un eleve qu'une seule fois par annee scolaire en mode usage_eleve", async () => {
    const tenant = { ecoleId: ecoleId() };
    const eleveId = ecoleId();
    const classeId = ecoleId();
    const anneeScolaireId = ecoleId();

    const first = await runWithTenant(tenant, () =>
      service.recordEleveUsage({
        eleveId,
        classeId,
        anneeScolaireId,
        periode: 'T1',
      }),
    );
    const second = await runWithTenant(tenant, () =>
      service.recordEleveUsage({
        eleveId,
        classeId,
        anneeScolaireId,
        periode: 'T2',
      }),
    );

    expect(String(first._id)).toBe(String(second._id));
  });

  it('genere une facture usage_bulletin dont le montant est proportionnel au nombre de bulletins, et marque les consommations facturees', async () => {
    const tenant = { ecoleId: ecoleId() };
    const classeId = ecoleId();
    const anneeScolaireId = ecoleId();

    await runWithTenant(tenant, () =>
      service.changeParametre({
        mode: FacturationMode.USAGE_BULLETIN,
        montantUnitaire: 250,
      }),
    );
    for (let i = 0; i < 3; i += 1) {
      await runWithTenant(tenant, () =>
        service.recordBulletinGeneration({
          eleveId: ecoleId(),
          classeId,
          periode: 'T1',
          anneeScolaireId,
        }),
      );
    }

    const facture = await runWithTenant(tenant, () =>
      service.genererFacture({ periode: 'T1' }),
    );
    expect(facture.montantTotal).toBe(750);

    await expect(
      runWithTenant(tenant, () => service.genererFacture({ periode: 'T1' })),
    ).rejects.toThrow('Aucune consommation facturable');
  });

  it('empeche une double facturation forfait pour la meme periode', async () => {
    const tenant = { ecoleId: ecoleId() };
    await runWithTenant(tenant, () =>
      service.changeParametre({
        mode: FacturationMode.FORFAIT,
        montantUnitaire: 30000,
      }),
    );

    const facture = await runWithTenant(tenant, () =>
      service.genererFacture({ periode: '2026-T1' }),
    );
    expect(facture.montantTotal).toBe(30000);

    await expect(
      runWithTenant(tenant, () =>
        service.genererFacture({ periode: '2026-T1' }),
      ),
    ).rejects.toThrow('Une facture forfait existe deja');
  });

  it('isole les parametres de facturation entre deux ecoles', async () => {
    const tenantA = { ecoleId: ecoleId() };
    const tenantB = { ecoleId: ecoleId() };

    await runWithTenant(tenantA, () =>
      service.changeParametre({
        mode: FacturationMode.FORFAIT,
        montantUnitaire: 1000,
      }),
    );
    await runWithTenant(tenantB, () =>
      service.changeParametre({
        mode: FacturationMode.USAGE_ELEVE,
        montantUnitaire: 2000,
      }),
    );

    const actifA = await runWithTenant(tenantA, () =>
      service.getParametreActif(),
    );
    const actifB = await runWithTenant(tenantB, () =>
      service.getParametreActif(),
    );

    expect(actifA?.mode).toBe('forfait');
    expect(actifB?.mode).toBe('usage_eleve');
  });
});
