import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../common/enums/domain.enums';
import { Student } from '../students/schemas/student.schema';
import { CreateDisciplineRecordDto } from './dto/create-discipline-record.dto';
import { SearchDisciplineRecordsDto } from './dto/search-discipline-records.dto';
import { DisciplineRecord } from './schemas/discipline-record.schema';

@Injectable()
export class DisciplineService {
  constructor(
    @InjectModel(DisciplineRecord.name)
    private readonly recordModel: Model<DisciplineRecord>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    private readonly auditService: AuditService,
  ) {}

  // schoolYearId is the caller's responsibility, not the DTO's - see
  // CreateDisciplineRecordDto's comment. DisciplineController.create()
  // always passes the school's current open year.
  async create(
    dto: CreateDisciplineRecordDto,
    schoolYearId: string,
    actorId?: string,
  ) {
    const student = await this.studentModel
      .findById(dto.studentId)
      .lean()
      .exec();
    if (!student) {
      throw new NotFoundException('Eleve introuvable');
    }

    const created = await this.recordModel.create({
      studentId: dto.studentId,
      schoolYearId,
      type: dto.type,
      date: new Date(dto.date),
      motif: dto.motif,
      mesure: dto.mesure,
      recordedBy: actorId,
    });

    await this.auditService.log({
      schoolYearId,
      actorId,
      action: AuditAction.DISCIPLINE_RECORD_CREATED,
      entityType: 'DisciplineRecord',
      entityId: String(created._id),
      details: { studentId: dto.studentId, type: dto.type },
    });

    return created;
  }

  // Full cross-year timeline for one student (the "Discipline" panel on
  // their own fiche) - every record ever entered, oldest school year
  // concerns aside, newest first.
  async findForStudent(studentId: string) {
    return this.recordModel
      .find({ studentId })
      .populate('schoolYearId')
      .populate('recordedBy')
      .sort({ date: -1 })
      .lean()
      .exec();
  }

  // The school-wide journal (direction's overview), filterable by class,
  // annee, type and/or a single student.
  async search(filters: SearchDisciplineRecordsDto) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, filters.pageSize ?? 20));

    const query: Record<string, unknown> = {};
    if (filters.studentId) query.studentId = filters.studentId;
    if (filters.schoolYearId) query.schoolYearId = filters.schoolYearId;
    if (filters.type) query.type = filters.type;
    // DisciplineRecord doesn't store a level - it's filtered through the
    // student's CURRENT declared class, same simplification the nominal
    // roll/reports already make elsewhere, rather than snapshotting the
    // class the student was in on the day of the incident.
    if (filters.levelId) {
      const studentIds = await this.studentModel
        .find({ levelId: filters.levelId })
        .distinct('_id')
        .exec();
      query.studentId = filters.studentId
        ? filters.studentId
        : { $in: studentIds };
    }

    const [items, total] = await Promise.all([
      this.recordModel
        .find(query)
        .populate('studentId')
        .populate('schoolYearId')
        .populate('recordedBy')
        .sort({ date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      this.recordModel.countDocuments(query).exec(),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
