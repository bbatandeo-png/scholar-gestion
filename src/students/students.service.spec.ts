import { Connection, Model } from 'mongoose';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { StudentDocument } from './schemas/student.schema';
import { EnrollmentDocument } from '../enrollments/schemas/enrollment.schema';
import { LevelDocument } from '../levels/schemas/level.schema';
import { GuardiansService } from '../guardians/guardians.service';
import { SettingsService } from '../settings/settings.service';

describe('StudentsService autocomplete', () => {
  const exec = jest.fn();
  const aggregate = jest.fn((pipeline: unknown[]) => {
    void pipeline;
    return { exec };
  });
  const service = new StudentsService(
    { aggregate } as unknown as Model<StudentDocument>,
    {} as unknown as Model<EnrollmentDocument>,
    {} as unknown as Model<LevelDocument>,
    {} as unknown as GuardiansService,
    {} as unknown as SettingsService,
    {} as unknown as Connection,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockResolvedValue([]);
  });

  it('ne lance pas de requete avant trois caracteres', async () => {
    await expect(service.autocomplete('Al')).resolves.toEqual([]);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('limite les resultats et recherche sans tenir compte des accents', async () => {
    await service.autocomplete('Jerome', 100);

    const pipeline = aggregate.mock.calls[0][0];
    const matchStage = pipeline[0] as {
      $match: { $or: Array<{ lastname?: RegExp }> };
    };
    const sortStage = pipeline[2] as {
      $sort: Record<string, number>;
    };
    expect(pipeline).toContainEqual({ $limit: 30 });
    expect(String(matchStage.$match.$or[1].lastname)).toContain('[eèéêë]');
    expect(sortStage.$sort).toEqual({
      searchRank: 1,
      lastname: 1,
      firstname: 1,
      matricule: 1,
    });
  });
});

describe('StudentsService.create', () => {
  // Explicit matricule on every dto below so generateUniqueMatricule() (its
  // own findOne/settingsService round-trip) never runs - out of scope here.
  function buildService(existingDuplicate: unknown = null) {
    const findOne = jest
      .fn<Promise<unknown>, [Record<string, unknown>]>()
      .mockResolvedValue(existingDuplicate);
    const createdDoc = {
      _id: 'new-student-id',
      toObject: () => ({ _id: 'new-student-id' }),
    };
    const create = jest
      .fn<
        Promise<unknown[]>,
        [Array<Record<string, unknown>>, Record<string, unknown>]
      >()
      .mockResolvedValue([createdDoc]);
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection;
    const guardiansService = {
      replaceForStudent: jest.fn().mockResolvedValue(undefined),
    } as unknown as GuardiansService;
    const service = new StudentsService(
      { findOne, create } as unknown as Model<StudentDocument>,
      {} as unknown as Model<EnrollmentDocument>,
      {} as unknown as Model<LevelDocument>,
      guardiansService,
      {} as unknown as SettingsService,
      connection,
    );
    return { service, findOne, create };
  }

  it('cree un eleve sans date de naissance, lieu de naissance ni quartier', async () => {
    const { service, create } = buildService();
    const dto: CreateStudentDto = {
      matricule: 'MAT-100',
      lastname: 'Sans-Info',
      firstname: 'Eleve',
      gender: 'M',
    };

    await service.create(dto);

    expect(create).toHaveBeenCalledTimes(1);
    const [rows] = create.mock.calls[0];
    expect(rows[0]).not.toHaveProperty('birthDate');
  });

  it('ne verifie pas de doublon nom+date de naissance quand la date est absente', async () => {
    const { service, findOne } = buildService();
    const dto: CreateStudentDto = {
      matricule: 'MAT-101',
      lastname: 'Sans-Date',
      firstname: 'Eleve',
      gender: 'F',
    };

    await service.create(dto);

    const query = findOne.mock.calls[0][0] as { $or: unknown[] };
    expect(query.$or).toHaveLength(1);
    expect(query.$or[0]).toEqual({ matricule: 'MAT-101' });
  });

  it('verifie le doublon nom+date de naissance quand la date est fournie', async () => {
    const { service, findOne } = buildService();
    const dto: CreateStudentDto = {
      matricule: 'MAT-102',
      lastname: 'Avec-Date',
      firstname: 'Eleve',
      gender: 'M',
      birthDate: '2015-01-01',
    };

    await service.create(dto);

    const query = findOne.mock.calls[0][0] as { $or: unknown[] };
    expect(query.$or).toHaveLength(2);
    expect(query.$or[1]).toMatchObject({
      lastname: 'Avec-Date',
      firstname: 'Eleve',
      birthDate: new Date('2015-01-01'),
    });
  });

  it('refuse la creation quand un dossier eleve correspondant existe deja', async () => {
    const { service } = buildService({ _id: 'existing' });
    const dto: CreateStudentDto = {
      matricule: 'MAT-103',
      lastname: 'Doublon',
      firstname: 'Eleve',
      gender: 'M',
    };

    await expect(service.create(dto)).rejects.toThrow(
      'Un dossier eleve existe deja',
    );
  });
});
