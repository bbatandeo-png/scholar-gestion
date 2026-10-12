import { Connection, Model } from 'mongoose';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { StudentDocument } from './schemas/student.schema';
import { EnrollmentDocument } from '../enrollments/schemas/enrollment.schema';
import { LevelDocument } from '../levels/schemas/level.schema';
import { DisciplineRecord } from '../discipline/schemas/discipline-record.schema';
import { InvoiceDocument } from '../billing/schemas/invoice.schema';
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
    {} as unknown as Model<DisciplineRecord>,
    {} as unknown as Model<InvoiceDocument>,
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

describe('StudentsService.checkDuplicateName', () => {
  it('recherche un nom/prenoms exact sans tenir compte de la casse ou des accents', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        matricule: 'MAT-0001',
        lastname: 'Kokou',
        firstname: 'Ama',
        status: 'active',
      },
    ]);
    const lean = jest.fn().mockReturnValue({ exec });
    const select = jest.fn().mockReturnValue({ lean });
    const find = jest.fn((query: { lastname: RegExp; firstname: RegExp }) => {
      void query;
      return { select };
    });
    const service = new StudentsService(
      { find } as unknown as Model<StudentDocument>,
      {} as unknown as Model<EnrollmentDocument>,
      {} as unknown as Model<LevelDocument>,
      {} as unknown as Model<DisciplineRecord>,
      {} as unknown as Model<InvoiceDocument>,
      {} as unknown as GuardiansService,
      {} as unknown as SettingsService,
      {} as unknown as Connection,
    );

    const result = await service.checkDuplicateName('kokou', 'AMA');

    expect(result).toHaveLength(1);
    const query = find.mock.calls[0][0];
    expect(query.lastname.test('Kokou')).toBe(true);
    expect(query.lastname.test('KokouX')).toBe(false);
    expect(query.firstname.test('ama')).toBe(true);
  });
});

describe('StudentsService.findDuplicateGroups', () => {
  it('groupe par nom/prenoms normalises et ne garde que les groupes de 2 ou plus', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: { lastname: 'kokou', firstname: 'ama' },
        count: 2,
        students: [],
      },
    ]);
    const aggregate = jest.fn((pipeline: Array<Record<string, unknown>>) => {
      void pipeline;
      return { exec };
    });
    const service = new StudentsService(
      { aggregate } as unknown as Model<StudentDocument>,
      {} as unknown as Model<EnrollmentDocument>,
      {} as unknown as Model<LevelDocument>,
      {} as unknown as Model<DisciplineRecord>,
      {} as unknown as Model<InvoiceDocument>,
      {} as unknown as GuardiansService,
      {} as unknown as SettingsService,
      {} as unknown as Connection,
    );

    const result = await service.findDuplicateGroups();

    expect(result).toHaveLength(1);
    const pipeline = aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((stage) => '$match' in stage) as {
      $match: { count: { $gt: number } };
    };
    expect(matchStage.$match.count.$gt).toBe(1);
  });
});

describe('StudentsService.searchPaginated', () => {
  function buildService() {
    const execFind = jest.fn().mockResolvedValue([]);
    const find = jest.fn((criteria: Record<string, unknown>) => {
      void criteria;
      return {
        select: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockReturnValue({ exec: execFind }),
              }),
            }),
          }),
        }),
      };
    });
    const countDocuments = jest.fn().mockResolvedValue(0);
    const distinct = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    const service = new StudentsService(
      { find, countDocuments } as unknown as Model<StudentDocument>,
      { distinct } as unknown as Model<EnrollmentDocument>,
      {} as unknown as Model<LevelDocument>,
      {} as unknown as Model<DisciplineRecord>,
      {} as unknown as Model<InvoiceDocument>,
      {} as unknown as GuardiansService,
      {} as unknown as SettingsService,
      {} as unknown as Connection,
    );
    return { service, find, distinct };
  }

  it("une recherche par statut seul (ex: archives) ne restreint jamais aux inscrits de l'annee ouverte - un eleve archive n'a typiquement pas d'inscription cette annee", async () => {
    const { service, find, distinct } = buildService();

    await service.searchPaginated(undefined, 1, 20, 'year-open', {
      status: 'archived',
    });

    expect(distinct).not.toHaveBeenCalled();
    const criteria = find.mock.calls[0][0] as { status?: string };
    expect(criteria.status).toBe('archived');
  });

  it('un statut combine a une classe reste scope via les inscriptions pour la classe (une classe se verifie par inscription), le statut filtrant en plus', async () => {
    const { service, find, distinct } = buildService();

    await service.searchPaginated(undefined, 1, 20, 'year-open', {
      status: 'archived',
      levelId: 'level-1',
    });

    expect(distinct).toHaveBeenCalledWith('studentId', {
      schoolYearId: 'year-open',
      levelId: 'level-1',
    });
    const criteria = find.mock.calls[0][0] as {
      status?: string;
      levelId?: string;
    };
    expect(criteria.status).toBe('archived');
    expect(criteria.levelId).toBeUndefined();
  });

  it('sans statut ni matricule, un filtre de classe reste scope a l annee (comportement historique)', async () => {
    const { service, distinct } = buildService();

    await service.searchPaginated(undefined, 1, 20, 'year-open', {
      levelId: 'level-1',
    });

    expect(distinct).toHaveBeenCalledWith('studentId', {
      schoolYearId: 'year-open',
      levelId: 'level-1',
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
      {} as unknown as Model<DisciplineRecord>,
      {} as unknown as Model<InvoiceDocument>,
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

describe('StudentsService.update', () => {
  function buildUpdateService(updatedStudent: Record<string, unknown> | null) {
    const findByIdAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(updatedStudent),
    });
    const updateMany = jest
      .fn<
        { exec: () => Promise<unknown> },
        [Record<string, unknown>, Record<string, unknown>, unknown]
      >()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      startSession: jest.fn().mockResolvedValue(session),
    } as unknown as Connection;
    const service = new StudentsService(
      { findByIdAndUpdate } as unknown as Model<StudentDocument>,
      { updateMany } as unknown as Model<EnrollmentDocument>,
      {} as unknown as Model<LevelDocument>,
      {} as unknown as Model<DisciplineRecord>,
      {} as unknown as Model<InvoiceDocument>,
      {
        replaceForStudent: jest.fn(),
      } as unknown as GuardiansService,
      {} as unknown as SettingsService,
      connection,
    );
    return { service, updateMany };
  }

  it("rafraichit la copie d'identite des inscriptions de l'eleve apres modification", async () => {
    const { service, updateMany } = buildUpdateService({
      matricule: 'MAT-1',
      lastname: 'NOUVEAU',
      firstname: 'Nom',
      gender: 'F',
      birthDate: undefined,
      birthPlace: undefined,
      district: undefined,
    });

    await service.update('student-1', { lastname: 'NOUVEAU' });

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toEqual({ studentId: 'student-1' });
    expect(update).toMatchObject({
      studentSnapshot: {
        matricule: 'MAT-1',
        lastname: 'NOUVEAU',
        firstname: 'Nom',
        gender: 'F',
      },
    });
  });

  it("ne touche a aucune inscription quand l'eleve est introuvable", async () => {
    const { service, updateMany } = buildUpdateService(null);

    await expect(service.update('missing', {})).rejects.toThrow(
      'Eleve introuvable',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
