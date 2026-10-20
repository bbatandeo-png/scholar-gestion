import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { DisciplineRecord } from '../discipline/schemas/discipline-record.schema';
import { GuardiansService } from '../guardians/guardians.service';
import { Guardian } from '../guardians/schemas/guardian.schema';
import { GuardianType, StudentStatus } from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import {
  UploadedImageFile,
  resolveUploadedImagePath,
  saveUploadedImage,
} from '../common/utils/uploaded-image.util';
import { SettingsService } from '../settings/settings.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { toDisplayString } from '../common/utils/safe-string.util';
import { Student, StudentDocument } from './schemas/student.schema';
import {
  Enrollment,
  EnrollmentDocument,
} from '../enrollments/schemas/enrollment.schema';
import { Level, LevelDocument } from '../levels/schemas/level.schema';
import { Invoice, InvoiceDocument } from '../billing/schemas/invoice.schema';
import {
  PopulatedEnrollmentLean,
  PopulatedStudentLean,
} from '../common/types/populated-refs.types';

// Fields selected by search()/searchPaginated() beyond the base
// PopulatedStudentLean shape - kept separate since most other populated-ref
// call sites don't select (or need) these.
export type StudentSearchRow = PopulatedStudentLean & {
  birthDate?: Date;
  birthPlace?: string;
  district?: string;
  status?: string;
};

export type StudentAutocompleteResult = {
  _id: unknown;
  matricule: string;
  lastname: string;
  firstname: string;
};

@Injectable()
export class StudentsService {
  constructor(
    @InjectModel(Student.name)
    private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Level.name)
    private readonly levelModel: Model<LevelDocument>,
    @InjectModel(DisciplineRecord.name)
    private readonly disciplineRecordModel: Model<DisciplineRecord>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    private readonly guardiansService: GuardiansService,
    private readonly settingsService: SettingsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildAccentInsensitivePattern(value: string) {
    const accentGroups: Record<string, string> = {
      a: 'aàáâãäå',
      c: 'cç',
      e: 'eèéêë',
      i: 'iìíîï',
      n: 'nñ',
      o: 'oòóôõö',
      u: 'uùúûü',
      y: 'yýÿ',
    };
    const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return Array.from(normalized)
      .map((character) => {
        const group = accentGroups[character.toLowerCase()];
        return group ? `[${group}]` : this.escapeRegExp(character);
      })
      .join('');
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
      const match = String(student.matricule).match(
        new RegExp(prefixPattern, 'i'),
      );
      if (!match) {
        continue;
      }

      nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
    }

    return `${basePrefix}${String(nextNumber).padStart(rule.padding, '0')}`;
  }

  private normalizeGuardians(guardians: CreateStudentDto['guardians']) {
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
      .filter(
        (item) =>
          allowedTypes.has(item.type) &&
          item.lastname.length > 0 &&
          item.firstname.length > 0,
      )
      .filter((item, index, all) => {
        // The form only ever sends one slot per type (father/mother/tutor),
        // but nothing at the schema level enforces that - guard here too
        // so a direct API call with duplicate types can't insert two
        // "father" rows for the same student.
        return all.findIndex((other) => other.type === item.type) === index;
      });
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

  async list(schoolYearId?: string) {
    const enrollmentCriteria = schoolYearId ? { schoolYearId } : {};
    const studentIds = schoolYearId
      ? await this.enrollmentModel
          .distinct('studentId', enrollmentCriteria)
          .exec()
      : undefined;
    return this.studentModel
      .find(studentIds ? { _id: { $in: studentIds } } : {})
      .select('matricule lastname firstname status')
      .sort({ lastname: 1, firstname: 1 })
      .lean()
      .exec();
  }

  // Ids of the students whose matricule, lastname or firstname contains the
  // text (accents and case ignored), optionally only among those enrolled in
  // the given school year. Used to search lists that show a student.
  async findIdsMatching(term: string, schoolYearId?: string) {
    const trimmed = term.trim();
    if (!trimmed) {
      return [];
    }
    const pattern = new RegExp(
      this.buildAccentInsensitivePattern(trimmed),
      'i',
    );
    const enrolledIds = schoolYearId
      ? await this.enrollmentModel
          .distinct('studentId', { schoolYearId })
          .exec()
      : undefined;
    const students = await this.studentModel
      .find({
        ...(enrolledIds ? { _id: { $in: enrolledIds } } : {}),
        $or: [
          { matricule: pattern },
          { lastname: pattern },
          { firstname: pattern },
        ],
      })
      .select('_id')
      .lean()
      .exec();
    return students.map((student) => String(student._id));
  }

  async autocomplete(query: string, limit = 25) {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    if (normalizedQuery.length < 3) {
      return [];
    }

    const safeLimit = Math.min(30, Math.max(1, Number(limit) || 25));
    const searchPattern = this.buildAccentInsensitivePattern(normalizedQuery);
    const containsPattern = new RegExp(searchPattern, 'i');
    const startsWithPattern = new RegExp(`^${searchPattern}`, 'i');

    return this.studentModel
      .aggregate<StudentAutocompleteResult>([
        {
          $match: {
            $or: [
              { matricule: containsPattern },
              { lastname: containsPattern },
              { firstname: containsPattern },
            ],
          },
        },
        {
          $addFields: {
            searchRank: {
              $switch: {
                branches: [
                  {
                    case: {
                      $regexMatch: {
                        input: '$matricule',
                        regex: startsWithPattern,
                      },
                    },
                    then: 0,
                  },
                  {
                    case: {
                      $regexMatch: {
                        input: '$lastname',
                        regex: startsWithPattern,
                      },
                    },
                    then: 1,
                  },
                  {
                    case: {
                      $regexMatch: {
                        input: '$firstname',
                        regex: startsWithPattern,
                      },
                    },
                    then: 2,
                  },
                ],
                default: 3,
              },
            },
          },
        },
        { $sort: { searchRank: 1, lastname: 1, firstname: 1, matricule: 1 } },
        { $limit: safeLimit },
        { $project: { matricule: 1, lastname: 1, firstname: 1 } },
      ])
      .exec();
  }

  // Backs the "Creer un eleve" form's confirmation popup (see
  // StudentsController.checkDuplicateName) - exact, case/accent-insensitive
  // name match, never blocking on its own (two real students can share a
  // name, e.g. twins) - just lets the form ask "are you sure?" before
  // creating a second record with the exact same identity.
  async checkDuplicateName(lastname: string, firstname: string) {
    const lastnamePattern = new RegExp(
      `^${this.buildAccentInsensitivePattern(lastname.trim())}$`,
      'i',
    );
    const firstnamePattern = new RegExp(
      `^${this.buildAccentInsensitivePattern(firstname.trim())}$`,
      'i',
    );
    return this.studentModel
      .find({ lastname: lastnamePattern, firstname: firstnamePattern })
      .select('matricule lastname firstname status')
      .lean()
      .exec();
  }

  // Tous les groupes d'eleves partageant le meme nom+prenoms (sans egard a
  // la casse/accents) avec au moins 2 occurrences - pour la page de revue
  // /students/duplicates. Un nom partage n'est pas forcement une erreur
  // (homonymes reels), mais merite d'etre visible pour verification.
  async findDuplicateGroups() {
    return this.studentModel
      .aggregate<{
        _id: { lastname: string; firstname: string };
        count: number;
        students: Array<{
          _id: unknown;
          matricule: string;
          lastname: string;
          firstname: string;
          status: string;
          createdAt: Date;
        }>;
      }>([
        {
          $addFields: {
            lastnameNormalized: { $toLower: '$lastname' },
            firstnameNormalized: { $toLower: '$firstname' },
          },
        },
        {
          $group: {
            _id: {
              lastname: '$lastnameNormalized',
              firstname: '$firstnameNormalized',
            },
            count: { $sum: 1 },
            students: {
              $push: {
                _id: '$_id',
                matricule: '$matricule',
                lastname: '$lastname',
                firstname: '$firstname',
                status: '$status',
                createdAt: '$createdAt',
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { '_id.lastname': 1, '_id.firstname': 1 } },
      ])
      .exec();
  }

  // Lifetime (toutes annees confondues) total paye / solde du par eleve,
  // pour aider a decider lequel des dossiers en double garder actif avant
  // d'archiver l'autre (voir /students/duplicates). Batch (2 requetes, pas
  // N+1) via le meme pattern $in que EnrollmentsService - jamais un
  // findInvoiceByEnrollment() par eleve.
  async getFinancialSummaries(
    studentIds: string[],
  ): Promise<Map<string, { totalPaid: number; balanceDue: number }>> {
    const summaries = new Map<
      string,
      { totalPaid: number; balanceDue: number }
    >();
    if (studentIds.length === 0) {
      return summaries;
    }

    const enrollments = await this.enrollmentModel
      .find({ studentId: { $in: studentIds } })
      .select('_id studentId')
      .lean()
      .exec();
    if (enrollments.length === 0) {
      return summaries;
    }

    const enrollmentIdToStudentId = new Map<string, string>();
    for (const enrollment of enrollments) {
      enrollmentIdToStudentId.set(
        String(enrollment._id),
        String(enrollment.studentId),
      );
    }

    const invoices = await this.invoiceModel
      .find({ enrollmentId: { $in: [...enrollmentIdToStudentId.keys()] } })
      .select('enrollmentId paidAmount balanceDue')
      .lean()
      .exec();

    for (const invoice of invoices) {
      const studentId = enrollmentIdToStudentId.get(
        String(invoice.enrollmentId),
      );
      if (!studentId) continue;
      const entry = summaries.get(studentId) ?? {
        totalPaid: 0,
        balanceDue: 0,
      };
      entry.totalPaid += invoice.paidAmount ?? 0;
      entry.balanceDue += invoice.balanceDue ?? 0;
      summaries.set(studentId, entry);
    }

    return summaries;
  }

  async search(
    query?: string,
    schoolYearId?: string,
    filters: { levelId?: string; status?: string; matricule?: string } = {},
  ) {
    const enrollmentCriteria: Record<string, unknown> = {};
    if (schoolYearId) {
      enrollmentCriteria.schoolYearId = schoolYearId;
    }
    if (filters.levelId) {
      enrollmentCriteria.levelId = filters.levelId;
    }
    const studentIds = Object.keys(enrollmentCriteria).length
      ? await this.enrollmentModel
          .distinct('studentId', enrollmentCriteria)
          .exec()
      : undefined;
    const extraCriteria = {
      ...(studentIds ? { _id: { $in: studentIds } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.matricule
        ? {
            matricule: new RegExp(
              `^${this.escapeRegExp(filters.matricule.trim())}$`,
              'i',
            ),
          }
        : {}),
    };
    if (!query) {
      const students = (await this.studentModel
        .find(extraCriteria)
        .select(
          'matricule lastname firstname gender birthDate birthPlace district status',
        )
        .sort({ lastname: 1, firstname: 1 })
        .lean()
        .exec()) as StudentSearchRow[];
      return this.applyYearSnapshots(students, schoolYearId);
    }

    const regex = new RegExp(this.escapeRegExp(query.trim()), 'i');
    const students = (await this.studentModel
      .find({
        ...extraCriteria,
        $or: [
          { matricule: regex },
          { lastname: regex },
          { firstname: regex },
          { district: regex },
        ],
      })
      .select(
        'matricule lastname firstname gender birthDate birthPlace district status',
      )
      .sort({ lastname: 1, firstname: 1 })
      .lean()
      .exec()) as StudentSearchRow[];
    return this.applyYearSnapshots(students, schoolYearId);
  }

  private async applyYearSnapshots<T extends PopulatedStudentLean>(
    students: T[],
    schoolYearId?: string,
  ) {
    if (!schoolYearId || !students.length) {
      return students;
    }
    const enrollments = await this.enrollmentModel
      .find({
        schoolYearId,
        studentId: { $in: students.map((student) => student._id) },
      })
      .select('studentId studentSnapshot')
      .lean()
      .exec();
    const snapshots = new Map(
      enrollments.map((enrollment) => [
        String(enrollment.studentId),
        enrollment.studentSnapshot,
      ]),
    );
    return students.map((student) => ({
      ...student,
      ...(snapshots.get(String(student._id)) ?? {}),
    }));
  }

  async searchPaginated(
    query: string | undefined,
    page: number,
    pageSize: number,
    schoolYearId?: string,
    filters: {
      levelId?: string;
      status?: string;
      matricule?: string;
    } = {},
  ) {
    // A level filter only makes sense scoped to a school year (the same
    // student can be in a different class each year), so it forces the
    // enrollment lookup below even when the page itself has no year filter.
    //
    // Skipped entirely when an exact matricule is given, or when a status
    // is given WITHOUT a level: both are precise identifiers read directly
    // off the Student record, not the enrollment - a student can end up
    // with no Enrollment at all for the selected year through no fault of
    // their own (e.g. the fee schedule for their class wasn't configured
    // yet when they were created - see StudentsController.create()'s own
    // "l'inscription n'a pas ete effectuee" flash), and an ARCHIVED student
    // in particular almost never has one for the currently OPEN year by
    // definition (they left before/without re-enrolling) - restricting a
    // plain status search by enrollment made "/students?status=archived"
    // (see /students/duplicates' "Voir les eleves archives" link) silently
    // return nothing even when archived students exist.
    //
    // When a level IS also given alongside status, the enrollment lookup
    // stays - a level filter is inherently about "was this student placed
    // in this class", which only the Enrollment records answer; status is
    // then applied as an independent extra constraint on top (unchanged).
    const skipEnrollmentScoping = Boolean(
      filters.matricule || (filters.status && !filters.levelId),
    );
    const enrollmentCriteria: Record<string, unknown> = {};
    if (!skipEnrollmentScoping) {
      if (schoolYearId) {
        enrollmentCriteria.schoolYearId = schoolYearId;
      }
      if (filters.levelId) {
        enrollmentCriteria.levelId = filters.levelId;
      }
    }
    const studentIds = Object.keys(enrollmentCriteria).length
      ? await this.enrollmentModel
          .distinct('studentId', enrollmentCriteria)
          .exec()
      : undefined;
    const searchCriteria = query
      ? {
          $or: [
            { matricule: new RegExp(this.escapeRegExp(query.trim()), 'i') },
            { lastname: new RegExp(this.escapeRegExp(query.trim()), 'i') },
            { firstname: new RegExp(this.escapeRegExp(query.trim()), 'i') },
            { district: new RegExp(this.escapeRegExp(query.trim()), 'i') },
          ],
        }
      : {};
    const criteria = {
      ...searchCriteria,
      ...(studentIds ? { _id: { $in: studentIds } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      // levelId applies directly against the Student record (its declared
      // class) whenever enrollment-scoping was skipped above - this only
      // happens for an exact matricule search combined with a class filter
      // (status+levelId keeps the enrollment-based lookup above instead).
      ...(skipEnrollmentScoping && filters.levelId
        ? { levelId: filters.levelId }
        : {}),
      ...(filters.matricule
        ? {
            matricule: new RegExp(
              `^${this.escapeRegExp(filters.matricule.trim())}$`,
              'i',
            ),
          }
        : {}),
    };

    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.studentModel
        .find(criteria)
        .select(
          'matricule lastname firstname gender birthDate birthPlace district status createdAt levelId',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec() as Promise<
        Array<StudentSearchRow & { createdAt?: Date; levelId?: string }>
      >,
      this.studentModel.countDocuments(criteria),
    ]);

    // Lookup current level for each student
    const studentsWithLevel = await Promise.all(
      items.map(async (student) => {
        const enrollment = (await this.enrollmentModel
          .findOne({
            studentId: student._id,
            ...(schoolYearId ? { schoolYearId } : {}),
          })
          .populate('levelId')
          .lean()
          .exec()) as PopulatedEnrollmentLean | null;

        // No Enrollment this year (e.g. creation-time enrollment failed -
        // see this method's matricule comment above) - fall back to the
        // class declared directly on the Student record rather than
        // showing a bare "-" for a student who very much has one.
        const declaredLevel =
          !enrollment && student.levelId
            ? await this.levelModel
                .findById(student.levelId)
                .select('label')
                .lean()
                .exec()
            : null;

        return {
          ...student,
          ...(schoolYearId && enrollment?.studentSnapshot
            ? enrollment.studentSnapshot
            : {}),
          currentLevel:
            (enrollment?.levelSnapshot?.label as string | undefined) ||
            enrollment?.levelId?.label ||
            declaredLevel?.label ||
            '-',
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

  async findById(id: string): Promise<Student & { _id: unknown }> {
    const student = (await this.studentModel.findById(id).lean().exec()) as
      | (Student & { _id: unknown })
      | null;
    if (!student) {
      throw new NotFoundException('Élève introuvable');
    }

    return student;
  }

  // What is known about the student's class, to show it next to the student
  // when enrolling: the class noted on the file when it was created (if any)
  // and the class of the most recent enrollment (if any). Display only.
  async getClassInfo(studentId: string): Promise<{
    declared: string | null;
    declaredId: string | null;
    last: { label: string; schoolYear: string; levelId: string } | null;
  }> {
    const student = await this.studentModel
      .findById(studentId)
      .select('levelId')
      .lean()
      .exec();
    const declaredLevel = student?.levelId
      ? await this.levelModel
          .findById(student.levelId)
          .select('label')
          .lean()
          .exec()
      : null;

    const lastEnrollment = (await this.enrollmentModel
      .findOne({ studentId })
      .sort({ createdAt: -1 })
      .populate('levelId', 'label')
      .populate('schoolYearId', 'label')
      .lean()
      .exec()) as PopulatedEnrollmentLean | null;
    const lastLabel =
      (lastEnrollment?.levelSnapshot?.label as string | undefined) ||
      lastEnrollment?.levelId?.label;

    // levelSnapshot never carries an _id (see enrollment.schema.ts) - only
    // the live levelId reference does, and only while that Level still
    // exists (populate() nulls the field out otherwise).
    const lastLevelId = lastEnrollment?.levelId?._id
      ? toDisplayString(lastEnrollment.levelId._id)
      : undefined;

    return {
      declared: declaredLevel?.label ?? null,
      declaredId: student?.levelId ? String(student.levelId) : null,
      last: lastLabel
        ? {
            label: lastLabel,
            schoolYear: lastEnrollment?.schoolYearId?.label ?? '',
            levelId: lastLevelId ?? '',
          }
        : null,
    };
  }

  async create(
    dto: CreateStudentDto,
  ): Promise<Student & { _id: unknown; guardiansCount: number }> {
    const normalizedGuardians = this.normalizeGuardians(dto.guardians);

    const matricule =
      dto.matricule?.trim() || (await this.generateUniqueMatricule());

    const duplicate = await this.studentModel.findOne({
      $or: [
        { matricule },
        // Only a meaningful duplicate signal when birthDate is actually
        // given - without it, this would match on name alone and could
        // flag unrelated same-named students as duplicates.
        ...(dto.birthDate
          ? [
              {
                lastname: dto.lastname,
                firstname: dto.firstname,
                birthDate: new Date(dto.birthDate),
              },
            ]
          : []),
      ],
    });

    if (duplicate) {
      throw new ConflictException('Un dossier élève existe déjà');
    }

    const normalizedGender = dto.gender?.trim().toUpperCase();
    // A blank "Classe" select means none - never write '' into an ObjectId.
    const { levelId, ...studentFields } = dto;
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const student = await this.studentModel.create(
        [
          {
            ...studentFields,
            ...(levelId ? { levelId } : {}),
            gender: normalizedGender,
            matricule,
            ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
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
      const { levelId, ...dtoFields } = dto;
      const updatePayload = {
        ...dtoFields,
        ...(levelId ? { levelId } : {}),
        ...(dto.gender ? { gender: dto.gender.trim().toUpperCase() } : {}),
        ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
      };
      const student = await this.studentModel
        .findByIdAndUpdate(id, updatePayload, { new: true, session })
        .exec();
      if (!student) {
        throw new NotFoundException('Élève introuvable');
      }

      // Enrollments keep a denormalized copy of the student's identity (the
      // enrollments list reads it) - refresh it, otherwise the list keeps
      // showing the old name/matricule after this edit.
      await this.enrollmentModel
        .updateMany(
          { studentId: id },
          {
            studentSnapshot: {
              matricule: student.matricule,
              lastname: student.lastname,
              firstname: student.firstname,
              gender: student.gender,
              birthDate: student.birthDate,
              birthPlace: student.birthPlace,
              district: student.district,
            },
          },
          { session },
        )
        .exec();

      if (dto.guardians) {
        const normalizedGuardians = this.normalizeGuardians(dto.guardians);
        await this.guardiansService.replaceForStudent(
          id,
          normalizedGuardians,
          session,
        );
      }

      return student;
    });
  }

  // Stores an uploaded photo for the student ID card (see
  // ReportsService.renderStudentIdCardPdf) - a no-op when no file was
  // submitted, matching EcolesService.saveLogo's contract exactly.
  async savePhoto(id: string, file: UploadedImageFile | undefined) {
    const relativePath = saveUploadedImage('students', id, 'photo', file);
    if (!relativePath) {
      return;
    }
    await this.studentModel
      .updateOne({ _id: id }, { photo: relativePath })
      .exec();
  }

  resolvePhotoAbsolutePath(student: { photo?: string } | null): string | null {
    return resolveUploadedImagePath(student?.photo);
  }

  async detail(id: string): Promise<{
    student: Student & { _id: unknown };
    guardians: Array<Guardian & { _id: unknown }>;
    disciplineRecords: unknown[];
  }> {
    const [student, guardians, disciplineRecords] = await Promise.all([
      this.findById(id),
      this.guardiansService.findByStudentId(id) as Promise<
        Array<Guardian & { _id: unknown }>
      >,
      this.getRecentDisciplineRecords(id),
    ]);

    return { student, guardians, disciplineRecords };
  }

  // Last few entries of the student's transversal discipline journal (see
  // DisciplineModule), shown on their own fiche - the full cross-year
  // history lives at /discipline?studentId=... (DisciplineController.index).
  async getRecentDisciplineRecords(studentId: string, limit = 5) {
    return this.disciplineRecordModel
      .find({ studentId })
      .populate('schoolYearId')
      .sort({ date: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
