import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { GuardiansService } from '../guardians/guardians.service';
import { GuardianType, StudentStatus } from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { SettingsService } from '../settings/settings.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Student, StudentDocument } from './schemas/student.schema';
import { Enrollment, EnrollmentDocument } from '../enrollments/schemas/enrollment.schema';
import { Level, LevelDocument } from '../levels/schemas/level.schema';

@Injectable()
export class StudentsService {
  constructor(
    @InjectModel(Student.name)
    private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Level.name)
    private readonly levelModel: Model<LevelDocument>,
    private readonly guardiansService: GuardiansService,
    private readonly settingsService: SettingsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async generateMatriculeCandidate() {
    const rule = await this.settingsService.getStudentMatriculeRule();
    const basePrefix = `${rule.prefix}${rule.separator}`;
    const prefixPattern = `^${this.escapeRegExp(basePrefix)}(\\d+)$`;
    const existing = await this.studentModel
      .find({ matricule: { $regex: prefixPattern, $options: 'i' } })
      .select('matricule')
      .lean()
      .exec();

    let nextNumber = rule.startAt;
    for (const student of existing) {
      const match = String(student.matricule).match(new RegExp(prefixPattern, 'i'));
      if (!match) {
        continue;
      }

      nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
    }

    return `${basePrefix}${String(nextNumber).padStart(rule.padding, '0')}`;
  }

  private normalizeGuardians(guardians: CreateStudentDto['guardians'] | UpdateStudentDto['guardians']) {
    const allowedTypes = new Set(Object.values(GuardianType));

    return (guardians ?? [])
      .map((item) => {
        const rawLastname = item.lastname?.trim() ?? '';
        const rawFirstname = item.firstname?.trim() ?? '';
        const full = item.fullname?.trim().replace(/\s+/g, ' ') ?? '';

        let lastname = rawLastname;
        let firstname = rawFirstname;

        if ((!lastname || !firstname) && full) {
          const parts = full.split(' ');
          if (parts.length === 1) {
            lastname = parts[0];
            firstname = parts[0];
          } else {
            lastname = parts[0];
            firstname = parts.slice(1).join(' ');
          }
        }

        return {
          type: item.type,
          lastname,
          firstname,
          phone: item.phone?.trim() || undefined,
          address: item.address?.trim() || undefined,
        };
      })
      .filter((item) =>
        allowedTypes.has(item.type as GuardianType)
        && item.lastname.length > 0
        && item.firstname.length > 0,
      );
  }

  async generateUniqueMatricule() {
    let candidate = await this.generateMatriculeCandidate();

    while (await this.studentModel.exists({ matricule: candidate })) {
      const rule = await this.settingsService.getStudentMatriculeRule();
      const numericPart = Number(candidate.replace(/\D+/g, '')) || rule.startAt;
      candidate = `${rule.prefix}${rule.separator}${String(numericPart + 1).padStart(rule.padding, '0')}`;
    }

    return candidate;
  }

  async list() {
    return this.studentModel
      .find()
      .select('matricule lastname firstname status')
      .sort({ lastname: 1, firstname: 1 })
      .lean()
      .exec();
  }

  async search(query?: string) {
    if (!query) {
      return this.studentModel
        .find()
        .select('matricule lastname firstname gender birthDate birthPlace district status')
        .sort({ lastname: 1, firstname: 1 })
        .lean()
        .exec();
    }

    const regex = new RegExp(query.trim(), 'i');
    return this.studentModel
      .find({
        $or: [
          { matricule: regex },
          { lastname: regex },
          { firstname: regex },
          { district: regex },
        ],
      })
      .select('matricule lastname firstname gender birthDate birthPlace district status')
      .sort({ lastname: 1, firstname: 1 })
      .lean()
      .exec();
  }

  async searchPaginated(query: string | undefined, page: number, pageSize: number) {
    const criteria = query
      ? {
          $or: [
            { matricule: new RegExp(query.trim(), 'i') },
            { lastname: new RegExp(query.trim(), 'i') },
            { firstname: new RegExp(query.trim(), 'i') },
            { district: new RegExp(query.trim(), 'i') },
          ],
        }
      : {};

    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.studentModel
        .find(criteria)
        .select('matricule lastname firstname gender birthDate birthPlace district status')
        .sort({ lastname: 1, firstname: 1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
      this.studentModel.countDocuments(criteria),
    ]);

    // Lookup current level for each student
    const studentsWithLevel = await Promise.all(
      items.map(async (student: any) => {
        const enrollment: any = await this.enrollmentModel
          .findOne({ studentId: student._id })
          .populate('levelId')
          .lean()
          .exec();

        return {
          ...student,
          currentLevel: enrollment?.levelId?.label || '-',
        };
      }),
    );

    return {
      items: studentsWithLevel,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findById(id: string) {
    const student = await this.studentModel.findById(id).lean().exec();
    if (!student) {
      throw new NotFoundException('Eleve introuvable');
    }

    return student;
  }

  async create(dto: CreateStudentDto) {
    const normalizedGuardians = this.normalizeGuardians(dto.guardians);
    const hasGuardianContact = normalizedGuardians.some((guardian) => Boolean(guardian.phone));
    if (!hasGuardianContact) {
      throw new BadRequestException('Au moins un contact parent ou tuteur est obligatoire');
    }

    const matricule = dto.matricule?.trim() || (await this.generateUniqueMatricule());

    const duplicate = await this.studentModel.findOne({
      $or: [
        { matricule },
        {
          lastname: dto.lastname,
          firstname: dto.firstname,
          birthDate: new Date(dto.birthDate),
        },
      ],
    });

    if (duplicate) {
      throw new ConflictException('Un dossier eleve existe deja');
    }

    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const student = await this.studentModel.create(
        [
          {
            ...dto,
            matricule,
            birthDate: new Date(dto.birthDate),
            status: StudentStatus.ACTIVE,
          },
        ],
        { session },
      );

      await this.guardiansService.replaceForStudent(
        String(student[0]._id),
        normalizedGuardians,
        session,
      );

      return {
        ...student[0].toObject(),
        guardiansCount: normalizedGuardians.length,
      };
    });
  }

  async update(id: string, dto: UpdateStudentDto) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const updatePayload = {
        ...dto,
        ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
      };
      const student = await this.studentModel
        .findByIdAndUpdate(id, updatePayload, { new: true, session })
        .exec();
      if (!student) {
        throw new NotFoundException('Eleve introuvable');
      }

      if (dto.guardians) {
        const normalizedGuardians = this.normalizeGuardians(dto.guardians);
        await this.guardiansService.replaceForStudent(id, normalizedGuardians, session);
      }

      return student;
    });
  }

  async detail(id: string) {
    const [student, guardians] = await Promise.all([
      this.findById(id),
      this.guardiansService.findByStudentId(id),
    ]);

    return { student, guardians };
  }
}