import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuditAction, TeacherTrackingType } from '../common/enums/domain.enums';
import { TeachersService } from './teachers.service';
import { Teacher } from './schemas/teacher.schema';
import { TeacherAssignment } from './schemas/teacher-assignment.schema';
import { TeacherContract } from './schemas/teacher-contract.schema';
import { TeacherDocumentFile } from './schemas/teacher-document.schema';
import { TeacherTrackingRecord } from './schemas/teacher-tracking-record.schema';

type ModelStub = Record<string, jest.Mock>;

function buildService(
  overrides: {
    teacherModel?: ModelStub;
    assignmentModel?: ModelStub;
    contractModel?: ModelStub;
    documentModel?: ModelStub;
    trackingModel?: ModelStub;
    log?: jest.Mock;
  } = {},
) {
  const log = overrides.log ?? jest.fn().mockResolvedValue(undefined);
  const service = new TeachersService(
    (overrides.teacherModel ?? {}) as unknown as Model<Teacher>,
    (overrides.assignmentModel ?? {}) as unknown as Model<TeacherAssignment>,
    (overrides.contractModel ?? {}) as unknown as Model<TeacherContract>,
    (overrides.documentModel ?? {}) as unknown as Model<TeacherDocumentFile>,
    (overrides.trackingModel ?? {}) as unknown as Model<TeacherTrackingRecord>,
    {} as never,
    { log } as unknown as AuditService,
  );
  return { service, log };
}

describe('TeachersService.create', () => {
  it('cree le dossier et journalise une entree audit TEACHER_CREATED', async () => {
    const create = jest.fn().mockResolvedValue({ _id: 'teacher-1' });
    const { service, log } = buildService({ teacherModel: { create } });

    const result = await service.create(
      {
        lastname: 'Kokou',
        firstname: 'Ama',
        birthDate: '1990-01-01',
        hireDate: '2020-09-01',
      },
      'user-1',
    );

    expect(result).toEqual({ _id: 'teacher-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        lastname: 'Kokou',
        firstname: 'Ama',
        birthDate: new Date('1990-01-01'),
        hireDate: new Date('2020-09-01'),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: AuditAction.TEACHER_CREATED,
        entityType: 'Teacher',
        entityId: 'teacher-1',
      }),
    );
  });
});

describe('TeachersService.findById', () => {
  it("leve une NotFoundException si l'enseignant n'existe pas", async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    });
    const { service } = buildService({ teacherModel: { findById } });

    await expect(service.findById('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('TeachersService.createAssignments', () => {
  it('leve une BadRequestException quand toutes les classes choisies sont des doublons', async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
      }),
    });
    const duplicateError = Object.assign(new Error('duplicate'), {
      code: 11000,
    });
    const create = jest.fn().mockRejectedValue(duplicateError);
    const { service } = buildService({
      teacherModel: { findById },
      assignmentModel: { create },
    });

    await expect(
      service.createAssignments('teacher-1', 'year-1', {
        levelIds: ['level-1'],
        subjectId: 'subject-1',
        hoursPerWeek: 4,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('cree une affectation par classe choisie, en ignorant les doublons sans faire echouer le lot', async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
      }),
    });
    const duplicateError = Object.assign(new Error('duplicate'), {
      code: 11000,
    });
    const create = jest
      .fn()
      .mockResolvedValueOnce({ _id: 'assignment-1' })
      .mockRejectedValueOnce(duplicateError);
    const { service } = buildService({
      teacherModel: { findById },
      assignmentModel: { create },
    });

    const result = await service.createAssignments('teacher-1', 'year-1', {
      levelIds: ['level-1', 'level-2'],
      subjectId: 'subject-1',
      hoursPerWeek: 4,
    });

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        teacherId: 'teacher-1',
        schoolYearId: 'year-1',
        levelId: 'level-1',
        subjectId: 'subject-1',
        hoursPerWeek: 4,
        isTitulaire: false,
      }),
    );
  });

  it('retire le titulaire actuel de chaque classe choisie avant de creer la nouvelle affectation titulaire', async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
      }),
    });
    const create = jest.fn().mockResolvedValue({ _id: 'assignment-1' });
    const updateMany = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });
    const { service } = buildService({
      teacherModel: { findById },
      assignmentModel: { create, updateMany },
    });

    await service.createAssignments('teacher-1', 'year-1', {
      levelIds: ['level-1'],
      subjectId: 'subject-1',
      hoursPerWeek: 4,
      isTitulaire: true,
    });

    expect(updateMany).toHaveBeenCalledWith(
      { schoolYearId: 'year-1', levelId: 'level-1', isTitulaire: true },
      { isTitulaire: false },
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ isTitulaire: true }),
    );
  });
});

describe('TeachersService.updateAssignment', () => {
  it("leve une NotFoundException si l'affectation n'existe pas pour cet enseignant", async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const { service } = buildService({ assignmentModel: { findOne } });

    await expect(
      service.updateAssignment('teacher-1', 'assignment-missing', {
        subjectId: 'subject-1',
        hoursPerWeek: 4,
        modificationReason: 'Correction du volume horaire',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('met a jour la matiere/le volume horaire, journalise le motif et retire le titulaire actuel si demande', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const assignment: Record<string, unknown> = {
      _id: 'assignment-1',
      schoolYearId: 'year-1',
      levelId: 'level-1',
      subjectId: 'subject-old',
      hoursPerWeek: 4,
      isTitulaire: false,
      save,
    };
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(assignment),
    });
    const updateMany = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });
    const { service, log } = buildService({
      assignmentModel: { findOne, updateMany },
    });

    const result = await service.updateAssignment(
      'teacher-1',
      'assignment-1',
      {
        subjectId: 'subject-new',
        hoursPerWeek: 6,
        isTitulaire: true,
        modificationReason: 'Changement de matiere',
      },
      'user-1',
    );

    expect(updateMany).toHaveBeenCalledWith(
      {
        schoolYearId: 'year-1',
        levelId: 'level-1',
        isTitulaire: true,
        _id: { $ne: 'assignment-1' },
      },
      { isTitulaire: false },
    );
    expect(result.subjectId).toBe('subject-new');
    expect(result.hoursPerWeek).toBe(6);
    expect(result.lastModificationReason).toBe('Changement de matiere');
    expect(save).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: AuditAction.TEACHER_ASSIGNMENT_UPDATED,
        entityType: 'TeacherAssignment',
        entityId: 'assignment-1',
      }),
    );
  });
});

describe('TeachersService.terminateContract', () => {
  it("refuse de resilier un contrat qui n'est pas actif", async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ status: 'expire' }),
    });
    const { service } = buildService({ contractModel: { findOne } });

    await expect(
      service.terminateContract('teacher-1', 'contract-1', {}, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it("leve une NotFoundException si le contrat n'existe pas pour cet enseignant", async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const { service } = buildService({ contractModel: { findOne } });

    await expect(
      service.terminateContract('teacher-1', 'missing', {}, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('resilie le contrat actif et journalise', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const contract: Record<string, unknown> = { status: 'actif', save };
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(contract),
    });
    const { service, log } = buildService({
      contractModel: { findOne },
    });

    const result = await service.terminateContract(
      'teacher-1',
      'contract-1',
      { reason: 'Depart volontaire' },
      'user-1',
    );

    expect(result.status).toBe('resilie');
    expect(result.terminatedReason).toBe('Depart volontaire');
    expect(save).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TEACHER_CONTRACT_TERMINATED,
        entityType: 'TeacherContract',
        entityId: 'contract-1',
      }),
    );
  });
});

describe('TeachersService.updateContract', () => {
  it("leve une NotFoundException si le contrat n'existe pas pour cet enseignant", async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const { service } = buildService({ contractModel: { findOne } });

    await expect(
      service.updateContract('teacher-1', 'missing', {
        type: 'cdi' as never,
        startDate: '2026-01-01',
        modificationReason: 'Correction de date',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('met a jour le contrat et journalise le motif', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const contract: Record<string, unknown> = {
      type: 'cdd',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-06-30'),
      notes: 'Ancienne note',
      save,
    };
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(contract),
    });
    const { service, log } = buildService({ contractModel: { findOne } });

    const result = await service.updateContract(
      'teacher-1',
      'contract-1',
      {
        type: 'cdi' as never,
        startDate: '2026-02-01',
        notes: 'Nouvelle note',
        modificationReason: 'Erreur de saisie corrigee',
      },
      'user-1',
    );

    expect(result.type).toBe('cdi');
    expect(result.endDate).toBeUndefined();
    expect(result.notes).toBe('Nouvelle note');
    expect(result.lastModificationReason).toBe('Erreur de saisie corrigee');
    expect(save).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: AuditAction.TEACHER_CONTRACT_UPDATED,
        entityType: 'TeacherContract',
        entityId: 'contract-1',
      }),
    );
  });
});

describe('TeachersService.createTrackingRecord', () => {
  it("leve une NotFoundException si l'enseignant n'existe pas", async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    });
    const { service } = buildService({ teacherModel: { findById } });

    await expect(
      service.createTrackingRecord(
        'missing',
        'year-1',
        {
          type: TeacherTrackingType.OBSERVATION,
          date: '2026-10-08',
          note: 'RAS',
        },
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('enregistre une entree de suivi et journalise', async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
      }),
    });
    const create = jest.fn().mockResolvedValue({ _id: 'tracking-1' });
    const { service, log } = buildService({
      teacherModel: { findById },
      trackingModel: { create },
    });

    const result = await service.createTrackingRecord(
      'teacher-1',
      'year-1',
      {
        type: TeacherTrackingType.ABSENCE,
        date: '2026-10-08',
        note: 'Absence non justifiee',
      },
      'user-1',
    );

    expect(result).toEqual({ _id: 'tracking-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherId: 'teacher-1',
        schoolYearId: 'year-1',
        type: TeacherTrackingType.ABSENCE,
        date: new Date('2026-10-08'),
        note: 'Absence non justifiee',
        recordedBy: 'user-1',
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TEACHER_TRACKING_RECORD_CREATED,
        entityType: 'TeacherTrackingRecord',
        entityId: 'tracking-1',
      }),
    );
  });

  it('accepte une entree de suivi sans note (facultative)', async () => {
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'teacher-1' }),
      }),
    });
    const create = jest.fn().mockResolvedValue({ _id: 'tracking-1' });
    const { service } = buildService({
      teacherModel: { findById },
      trackingModel: { create },
    });

    await service.createTrackingRecord(
      'teacher-1',
      'year-1',
      { type: TeacherTrackingType.OBSERVATION, date: '2026-10-08' },
      'user-1',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ note: undefined }),
    );
  });
});

describe('TeachersService.updateTrackingRecord', () => {
  it("leve une NotFoundException si l'entree n'existe pas pour cet enseignant", async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const { service } = buildService({ trackingModel: { findOne } });

    await expect(
      service.updateTrackingRecord('teacher-1', 'missing', {
        type: TeacherTrackingType.OBSERVATION,
        date: '2026-10-08',
        modificationReason: 'Correction de la date',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("met a jour l'entree de suivi et journalise le motif", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const record: Record<string, unknown> = {
      type: TeacherTrackingType.ABSENCE,
      date: new Date('2026-10-08'),
      note: 'Ancienne note',
      save,
    };
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(record),
    });
    const { service, log } = buildService({ trackingModel: { findOne } });

    const result = await service.updateTrackingRecord(
      'teacher-1',
      'tracking-1',
      {
        type: TeacherTrackingType.OBSERVATION,
        date: '2026-10-09',
        note: 'Note corrigee',
        modificationReason: 'Mauvais type saisi',
      },
      'user-1',
    );

    expect(result.type).toBe(TeacherTrackingType.OBSERVATION);
    expect(result.note).toBe('Note corrigee');
    expect(result.lastModificationReason).toBe('Mauvais type saisi');
    expect(save).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: AuditAction.TEACHER_TRACKING_RECORD_UPDATED,
        entityType: 'TeacherTrackingRecord',
        entityId: 'tracking-1',
      }),
    );
  });
});

describe('TeachersService.updateDocument', () => {
  it("leve une NotFoundException si le document n'existe pas pour cet enseignant", async () => {
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const { service } = buildService({ documentModel: { findOne } });

    await expect(
      service.updateDocument(
        'teacher-1',
        'missing',
        { label: 'CNI', modificationReason: 'Correction du libelle' },
        undefined,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('met a jour le libelle sans toucher au fichier quand aucun nouveau fichier est fourni', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: Record<string, unknown> = {
      label: 'Ancien libelle',
      originalName: 'diplome.pdf',
      relativePath: 'teachers-documents/teacher-1/old.pdf',
      save,
    };
    const findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const { service, log } = buildService({ documentModel: { findOne } });

    const result = await service.updateDocument(
      'teacher-1',
      'doc-1',
      { label: 'Nouveau libelle', modificationReason: 'Faute de frappe' },
      undefined,
      'user-1',
    );

    expect(result.label).toBe('Nouveau libelle');
    expect(result.relativePath).toBe('teachers-documents/teacher-1/old.pdf');
    expect(result.lastModificationReason).toBe('Faute de frappe');
    expect(save).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: AuditAction.TEACHER_DOCUMENT_UPDATED,
        entityType: 'TeacherDocumentFile',
        entityId: 'doc-1',
      }),
    );
  });
});
