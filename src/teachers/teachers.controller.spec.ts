import { Request, Response } from 'express';
import { BulletinsService } from '../bulletins/bulletins.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import {
  TeacherContractType,
  TeacherTrackingType,
} from '../common/enums/domain.enums';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';

function buildController(overrides: {
  teachersService?: Partial<TeachersService>;
  schoolYearsService?: Partial<SchoolYearsService>;
  levelsService?: Partial<LevelsService>;
  bulletinsService?: Partial<BulletinsService>;
}) {
  const teachersService = {
    listWithAssignmentsSummary: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({
      effectifs: { total: 0, active: 0, inactive: 0, departed: 0 },
      expiringContracts: [],
      hoursByTeacher: [],
    }),
    create: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
    savePhoto: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue({
      _id: 'teacher-1',
      firstname: 'Ama',
      lastname: 'Kokou',
    }),
    listAssignments: jest.fn().mockResolvedValue([]),
    listContracts: jest.fn().mockResolvedValue([]),
    listTracking: jest.fn().mockResolvedValue([]),
    listDocuments: jest.fn().mockResolvedValue([]),
    createAssignments: jest.fn().mockResolvedValue({ created: 1, skipped: 0 }),
    createContract: jest.fn().mockResolvedValue({ _id: 'contract-1' }),
    terminateContract: jest.fn().mockResolvedValue({ _id: 'contract-1' }),
    createTrackingRecord: jest.fn().mockResolvedValue({ _id: 'tracking-1' }),
    addDocument: jest.fn().mockResolvedValue({ _id: 'doc-1' }),
    ...overrides.teachersService,
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
  const bulletinsService = {
    listSubjects: jest.fn().mockResolvedValue([]),
    ...overrides.bulletinsService,
  };

  return new TeachersController(
    teachersService as unknown as TeachersService,
    levelsService as unknown as LevelsService,
    schoolYearsService as unknown as SchoolYearsService,
    bulletinsService as unknown as BulletinsService,
  );
}

const fakeUser = {
  id: 'user-1',
  name: 'Direction',
  email: 'd@ecole.local',
  role: 'direction' as never,
  ecoleId: 'ecole-1',
};

describe('TeachersController.index', () => {
  it('transmet les filtres et agrege les stats du tableau de bord', async () => {
    const teachersService = {
      listWithAssignmentsSummary: jest
        .fn()
        .mockResolvedValue([{ _id: 'teacher-1' }]),
    };
    const controller = buildController({ teachersService });

    const result = await controller.index({
      q: 'Kokou',
      status: undefined,
    });

    expect(teachersService.listWithAssignmentsSummary).toHaveBeenCalledWith(
      { q: 'Kokou', status: undefined },
      'year-1',
    );
    expect(result.teachers).toEqual([{ _id: 'teacher-1' }]);
    expect(result.filters).toEqual({ q: 'Kokou', status: '' });
  });
});

describe('TeachersController.create', () => {
  it('cree le dossier, enregistre la photo si fournie, et redirige vers la fiche', async () => {
    const teachersService = {
      create: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
      savePhoto: jest.fn().mockResolvedValue(undefined),
    };
    const controller = buildController({ teachersService });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {}, files: [] } as unknown as Request;
    const dto = { lastname: 'Kokou', firstname: 'Ama' };

    await controller.create(dto, req, res, fakeUser);

    expect(teachersService.create).toHaveBeenCalledWith(dto, 'user-1');
    expect(redirect).toHaveBeenCalledWith('/teachers/teacher-1');
  });
});

describe('TeachersController.detail', () => {
  it('agrege affectations, contrats, suivi et documents pour le dossier', async () => {
    const teachersService = {
      findById: jest.fn().mockResolvedValue({
        _id: 'teacher-1',
        firstname: 'Ama',
        lastname: 'Kokou',
      }),
      listAssignments: jest.fn().mockResolvedValue([{ _id: 'assignment-1' }]),
      listContracts: jest.fn().mockResolvedValue([{ _id: 'contract-1' }]),
      listTracking: jest.fn().mockResolvedValue([{ _id: 'tracking-1' }]),
      listDocuments: jest.fn().mockResolvedValue([{ _id: 'doc-1' }]),
    };
    const controller = buildController({ teachersService });

    const result = await controller.detail('teacher-1');

    expect(result.teacher).toEqual({
      _id: 'teacher-1',
      firstname: 'Ama',
      lastname: 'Kokou',
    });
    expect(result.assignments).toEqual([{ _id: 'assignment-1' }]);
    expect(result.contracts).toEqual([{ _id: 'contract-1' }]);
    expect(result.tracking).toEqual([{ _id: 'tracking-1' }]);
    expect(result.documents).toEqual([{ _id: 'doc-1' }]);
  });
});

describe('TeachersController.createAssignment', () => {
  it('appelle le service pour chaque classe choisie et redirige vers la fiche enseignant', async () => {
    const teachersService = {
      createAssignments: jest
        .fn()
        .mockResolvedValue({ created: 2, skipped: 0 }),
    };
    const controller = buildController({ teachersService });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {} } as unknown as Request;
    const dto = {
      levelIds: ['level-1', 'level-2'],
      subjectId: 'subject-1',
      hoursPerWeek: 4,
    };

    await controller.createAssignment('teacher-1', dto, req, res);

    expect(teachersService.createAssignments).toHaveBeenCalledWith(
      'teacher-1',
      'year-1',
      dto,
    );
    expect(redirect).toHaveBeenCalledWith('/teachers/teacher-1');
  });
});

describe('TeachersController.createContract', () => {
  it("transmet l'auteur courant et redirige vers la fiche enseignant", async () => {
    const teachersService = {
      createContract: jest.fn().mockResolvedValue({ _id: 'contract-1' }),
    };
    const controller = buildController({ teachersService });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {} } as unknown as Request;
    const dto = { type: TeacherContractType.CDI, startDate: '2026-09-01' };

    await controller.createContract('teacher-1', dto, req, res, fakeUser);

    expect(teachersService.createContract).toHaveBeenCalledWith(
      'teacher-1',
      dto,
      'user-1',
    );
    expect(redirect).toHaveBeenCalledWith('/teachers/teacher-1');
  });
});

describe('TeachersController.terminateContract', () => {
  it('resilie le contrat et redirige vers la fiche enseignant', async () => {
    const teachersService = {
      terminateContract: jest.fn().mockResolvedValue({ _id: 'contract-1' }),
    };
    const controller = buildController({ teachersService });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {} } as unknown as Request;

    await controller.terminateContract(
      'teacher-1',
      'contract-1',
      { reason: 'Depart' },
      req,
      res,
      fakeUser,
    );

    expect(teachersService.terminateContract).toHaveBeenCalledWith(
      'teacher-1',
      'contract-1',
      { reason: 'Depart' },
      'user-1',
    );
    expect(redirect).toHaveBeenCalledWith('/teachers/teacher-1');
  });
});

describe('TeachersController.createTrackingRecord', () => {
  it("enregistre l'entree de suivi et redirige vers la fiche enseignant", async () => {
    const teachersService = {
      createTrackingRecord: jest.fn().mockResolvedValue({ _id: 'tracking-1' }),
    };
    const controller = buildController({ teachersService });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {} } as unknown as Request;
    const dto = {
      type: TeacherTrackingType.OBSERVATION,
      date: '2026-10-08',
      note: 'RAS',
    };

    await controller.createTrackingRecord('teacher-1', dto, req, res, fakeUser);

    expect(teachersService.createTrackingRecord).toHaveBeenCalledWith(
      'teacher-1',
      'year-1',
      dto,
      'user-1',
    );
    expect(redirect).toHaveBeenCalledWith('/teachers/teacher-1');
  });
});
