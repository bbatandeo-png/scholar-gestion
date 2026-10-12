import { Request, Response } from 'express';
import { DisciplineController } from './discipline.controller';
import { DisciplineService } from './discipline.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { StudentsService } from '../students/students.service';
import { DisciplineRecordType } from '../common/enums/domain.enums';

function buildController(overrides: {
  disciplineService?: Partial<DisciplineService>;
  schoolYearsService?: Partial<SchoolYearsService>;
  levelsService?: Partial<LevelsService>;
  studentsService?: Partial<StudentsService>;
}) {
  const disciplineService = {
    search: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    }),
    create: jest.fn().mockResolvedValue({ _id: 'rec-1' }),
    ...overrides.disciplineService,
  };
  const schoolYearsService = {
    resolveSelected: jest.fn().mockResolvedValue({ _id: 'year-1' }),
    list: jest.fn().mockResolvedValue([{ _id: 'year-1', label: '2026-2027' }]),
    requireOpen: jest
      .fn()
      .mockResolvedValue({ _id: 'year-1', label: '2026-2027' }),
    ...overrides.schoolYearsService,
  };
  const levelsService = {
    listForSchoolYear: jest.fn().mockResolvedValue([]),
    ...overrides.levelsService,
  };
  const studentsService = {
    detail: jest.fn().mockResolvedValue(null),
    ...overrides.studentsService,
  };

  return new DisciplineController(
    disciplineService as unknown as DisciplineService,
    levelsService as unknown as LevelsService,
    schoolYearsService as unknown as SchoolYearsService,
    studentsService as unknown as StudentsService,
  );
}

const fakeRequest = { session: {} } as unknown as Request;

describe('DisciplineController.index', () => {
  it('transmet les filtres de la requete au service et retombe sur une liste vide de niveaux sans annee', async () => {
    const disciplineService = {
      search: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      }),
    };
    const schoolYearsService = {
      resolveSelected: jest.fn().mockRejectedValue(new Error('aucune annee')),
      list: jest.fn().mockResolvedValue([]),
    };
    const controller = buildController({
      disciplineService,
      schoolYearsService,
    });

    const result = await controller.index(fakeRequest, {
      levelId: 'level-1',
      type: DisciplineRecordType.SANCTION,
    });

    expect(disciplineService.search).toHaveBeenCalledWith({
      levelId: 'level-1',
      type: DisciplineRecordType.SANCTION,
    });
    expect(result.levels).toEqual([]);
    expect(result.filters).toEqual({
      studentId: '',
      levelId: 'level-1',
      schoolYearId: '',
      type: DisciplineRecordType.SANCTION,
    });
  });

  it("resout l'eleve filtre quand studentId est fourni, pour l'afficher en en-tete", async () => {
    const studentsService = {
      detail: jest.fn().mockResolvedValue({
        student: { _id: 'student-1', lastname: 'Mensah', firstname: 'Komi' },
        guardians: [],
        disciplineRecords: [],
      }),
    };
    const controller = buildController({ studentsService });

    const result = await controller.index(fakeRequest, {
      studentId: 'student-1',
    });

    expect(studentsService.detail).toHaveBeenCalledWith('student-1');
    expect(result.student).toEqual({
      _id: 'student-1',
      lastname: 'Mensah',
      firstname: 'Komi',
    });
  });
});

describe('DisciplineController.newRecord', () => {
  it("pre-remplit la date du jour, l'annee ouverte et deplie le detail eleve passe en query", async () => {
    const studentsService = {
      detail: jest.fn().mockResolvedValue({
        student: { _id: 'student-1', matricule: 'MAT-1' },
        guardians: [],
        disciplineRecords: [],
      }),
    };
    const controller = buildController({ studentsService });

    const result = await controller.newRecord('student-1');

    expect(result.student).toEqual({ _id: 'student-1', matricule: 'MAT-1' });
    expect(result.activeYear).toEqual({ _id: 'year-1', label: '2026-2027' });
    expect(typeof result.today).toBe('string');
    expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('renvoie un eleve nul quand aucun studentId n est fourni', async () => {
    const studentsService = { detail: jest.fn() };
    const controller = buildController({ studentsService });

    const result = await controller.newRecord(undefined);

    expect(result.student).toBeNull();
    expect(studentsService.detail).not.toHaveBeenCalled();
  });
});

describe('DisciplineController.create', () => {
  it("resout l'annee ouverte cote serveur (jamais celle du client), appelle le service avec l'auteur courant et redirige vers la fiche de l'eleve", async () => {
    const disciplineService = {
      create: jest.fn().mockResolvedValue({ _id: 'rec-1' }),
    };
    const schoolYearsService = {
      requireOpen: jest
        .fn()
        .mockResolvedValue({ _id: 'year-open', label: '2026-2027' }),
    };
    const controller = buildController({
      disciplineService,
      schoolYearsService,
    });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {} } as unknown as Request;
    const dto = {
      studentId: 'student-1',
      type: DisciplineRecordType.AVERTISSEMENT,
      date: '2026-10-06',
      motif: 'Retard repete',
    };

    await controller.create(req, res, dto, {
      id: 'user-1',
      name: 'Direction',
      email: 'd@ecole.local',
      role: 'direction' as never,
      ecoleId: 'ecole-1',
    });

    expect(schoolYearsService.requireOpen).toHaveBeenCalled();
    expect(disciplineService.create).toHaveBeenCalledWith(
      dto,
      'year-open',
      'user-1',
    );
    expect(redirect).toHaveBeenCalledWith('/students/student-1');
  });
});
