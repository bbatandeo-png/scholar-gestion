import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import {
  EnrollmentStatus,
  EnrollmentType,
  LevelCycle,
} from '../common/enums/domain.enums';
import { runWithTenant } from '../common/tenant/tenant-context';
import {
  Enrollment,
  EnrollmentSchema,
} from '../enrollments/schemas/enrollment.schema';
import { LevelsService } from './levels.service';
import { Level, LevelSchema } from './schemas/level.schema';
import {
  SchoolYearLevel,
  SchoolYearLevelSchema,
} from './schemas/school-year-level.schema';

describe('LevelsService - activation des niveaux par annee', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: LevelsService;
  let levelModel: Model<Level>;
  let enrollmentModel: Model<Enrollment>;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([
          { name: Level.name, schema: LevelSchema },
          { name: SchoolYearLevel.name, schema: SchoolYearLevelSchema },
          // Enregistre sur la meme connexion, comme dans l'application :
          // le controle "eleves inscrits" s'appuie dessus.
          { name: Enrollment.name, schema: EnrollmentSchema },
        ]),
      ],
      providers: [LevelsService],
    }).compile();
    service = moduleRef.get(LevelsService);
    levelModel = moduleRef.get(getModelToken(Level.name));
    enrollmentModel = moduleRef.get(getModelToken(Enrollment.name));
    await levelModel.init();
  }, 60000);

  afterAll(async () => {
    await repl.stop();
  });

  it('liste tous les niveaux avec leur etat, desactive puis reactive sans rien supprimer', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const yearId = new Types.ObjectId().toHexString();

    await runWithTenant({ ecoleId }, async () => {
      const cp1 = await levelModel.create({
        code: 'CP1',
        label: 'CP1',
        sortOrder: 1,
        cycle: LevelCycle.PRIMAIRE,
      });
      const tle = await levelModel.create({
        code: 'TERMINALE',
        label: 'Terminale',
        sortOrder: 2,
        cycle: LevelCycle.LYCEE,
      });
      await service.enableForSchoolYear(yearId, String(cp1._id));
      await service.enableForSchoolYear(yearId, String(tle._id));

      await service.setEnabledForSchoolYear(yearId, String(tle._id), false);

      const all = await service.listAllForSchoolYear(yearId);
      expect(all.map((l) => [l.code, l.isEnabled])).toEqual([
        ['CP1', true],
        ['TERMINALE', false],
      ]);
      // Le reste de l'application ne voit plus que les niveaux actifs.
      const enabled = await service.listForSchoolYear(yearId);
      expect(enabled.map((l) => l.code)).toEqual(['CP1']);

      await service.setEnabledForSchoolYear(yearId, String(tle._id), true);
      expect(
        (await service.listForSchoolYear(yearId)).map((l) => l.code),
      ).toEqual(['CP1', 'TERMINALE']);
      expect(await levelModel.countDocuments({})).toBe(2);
    });
  });

  it('un niveau jamais configure pour l annee apparait desactive', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    await runWithTenant({ ecoleId }, async () => {
      await levelModel.create({ code: '6EME', label: '6ème', sortOrder: 1 });
      const all = await service.listAllForSchoolYear(
        new Types.ObjectId().toHexString(),
      );
      expect(all).toHaveLength(1);
      expect(all[0].isEnabled).toBe(false);
    });
  });

  it('refuse de desactiver un niveau qui a des eleves inscrits cette annee', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const yearId = new Types.ObjectId().toHexString();

    await runWithTenant({ ecoleId }, async () => {
      const level = await levelModel.create({
        code: '5EME',
        label: '5ème',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      });
      await service.enableForSchoolYear(yearId, String(level._id));
      await enrollmentModel.create({
        studentId: new Types.ObjectId(),
        schoolYearId: yearId,
        levelId: level._id,
        type: EnrollmentType.INITIAL,
        status: EnrollmentStatus.ACTIVE,
      });

      await expect(
        service.setEnabledForSchoolYear(yearId, String(level._id), false),
      ).rejects.toThrow('1 élève(s) y sont inscrits');
      expect(
        (await service.listForSchoolYear(yearId)).map((l) => l.code),
      ).toEqual(['5EME']);
    });
  });
});
