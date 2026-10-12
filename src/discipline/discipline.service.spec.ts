import { Model } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { DisciplineService } from './discipline.service';
import { DisciplineRecord } from './schemas/discipline-record.schema';
import { Student } from '../students/schemas/student.schema';
import { AuditService } from '../audit/audit.service';
import {
  AuditAction,
  DisciplineRecordType,
} from '../common/enums/domain.enums';

describe('DisciplineService.create', () => {
  function buildService(opts: { student: unknown; created: { _id: string } }) {
    const findById = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(opts.student),
      }),
    });
    const create = jest.fn().mockResolvedValue(opts.created);
    const log = jest.fn().mockResolvedValue(undefined);
    const service = new DisciplineService(
      { create } as unknown as Model<DisciplineRecord>,
      { findById } as unknown as Model<Student>,
      { log } as unknown as AuditService,
    );
    return { service, create, log, findById };
  }

  const dto = {
    studentId: 'student-1',
    type: DisciplineRecordType.SANCTION,
    date: '2026-10-06',
    motif: 'Bagarre dans la cour',
    mesure: '3 jours d exclusion',
  };

  it("refuse d'enregistrer une entree pour un eleve introuvable", async () => {
    const { service, create } = buildService({
      student: null,
      created: { _id: 'rec-1' },
    });

    await expect(service.create(dto, 'year-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('cree la fiche et journalise une entree audit DISCIPLINE_RECORD_CREATED', async () => {
    const { service, create, log } = buildService({
      student: { _id: 'student-1' },
      created: { _id: 'rec-1' },
    });

    const result = await service.create(dto, 'year-1', 'user-1');

    expect(result).toEqual({ _id: 'rec-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        schoolYearId: 'year-1',
        type: DisciplineRecordType.SANCTION,
        motif: 'Bagarre dans la cour',
        mesure: '3 jours d exclusion',
        recordedBy: 'user-1',
        date: new Date('2026-10-06'),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolYearId: 'year-1',
        actorId: 'user-1',
        action: AuditAction.DISCIPLINE_RECORD_CREATED,
        entityType: 'DisciplineRecord',
        entityId: 'rec-1',
        details: {
          studentId: 'student-1',
          type: DisciplineRecordType.SANCTION,
        },
      }),
    );
  });
});

describe('DisciplineService.search', () => {
  function buildService(opts: {
    studentIdsForLevel: string[];
    records: unknown[];
    total: number;
  }) {
    const distinct = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(opts.studentIdsForLevel),
    });
    const studentFind = jest.fn().mockReturnValue({ distinct });

    const execFind = jest.fn().mockResolvedValue(opts.records);
    const recordFindChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: execFind,
    };
    const recordFind = jest.fn().mockReturnValue(recordFindChain);
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(opts.total),
    });

    const service = new DisciplineService(
      {
        find: recordFind,
        countDocuments,
      } as unknown as Model<DisciplineRecord>,
      { find: studentFind } as unknown as Model<Student>,
      {} as unknown as AuditService,
    );
    return { service, recordFind, studentFind, countDocuments };
  }

  it('filtre par classe en resolvant d abord les eleves de cette classe', async () => {
    const { service, recordFind, studentFind } = buildService({
      studentIdsForLevel: ['s1', 's2'],
      records: [{ _id: 'rec-1' }],
      total: 1,
    });

    const result = await service.search({ levelId: 'level-1' });

    expect(studentFind).toHaveBeenCalledWith({ levelId: 'level-1' });
    expect(recordFind).toHaveBeenCalledWith({
      studentId: { $in: ['s1', 's2'] },
    });
    expect(result).toEqual({
      items: [{ _id: 'rec-1' }],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it('combine le filtre eleve et le filtre type sans toucher aux eleves de la classe', async () => {
    const { service, recordFind, studentFind } = buildService({
      studentIdsForLevel: ['s1', 's2'],
      records: [],
      total: 0,
    });

    await service.search({
      studentId: 'student-9',
      type: DisciplineRecordType.AVERTISSEMENT,
    });

    expect(studentFind).not.toHaveBeenCalled();
    expect(recordFind).toHaveBeenCalledWith({
      studentId: 'student-9',
      type: DisciplineRecordType.AVERTISSEMENT,
    });
  });

  it('plafonne pageSize a 100 et le remonte a 5 au minimum', async () => {
    const { service, recordFind } = buildService({
      studentIdsForLevel: [],
      records: [],
      total: 0,
    });

    const result = await service.search({ pageSize: 1000 });
    expect(result.pageSize).toBe(100);

    const result2 = await service.search({ pageSize: 1 });
    expect(result2.pageSize).toBe(5);
    expect(recordFind).toHaveBeenCalled();
  });
});
