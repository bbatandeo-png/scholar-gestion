import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import {
  AuditAction,
  TeacherContractStatus,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import {
  UploadedImageFile,
  saveUploadedImage,
} from '../common/utils/uploaded-image.util';
import {
  UploadedDocumentFile,
  deleteUploadedDocument,
  saveUploadedDocument,
} from '../common/utils/uploaded-document.util';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { CreateTeacherContractDto } from './dto/create-teacher-contract.dto';
import { CreateTeacherDocumentDto } from './dto/create-teacher-document.dto';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { CreateTeacherTrackingRecordDto } from './dto/create-teacher-tracking-record.dto';
import { SearchTeachersDto } from './dto/search-teachers.dto';
import { TerminateTeacherContractDto } from './dto/terminate-teacher-contract.dto';
import { UpdateTeacherAssignmentDto } from './dto/update-teacher-assignment.dto';
import { UpdateTeacherContractDto } from './dto/update-teacher-contract.dto';
import { UpdateTeacherDocumentDto } from './dto/update-teacher-document.dto';
import { UpdateTeacherTrackingRecordDto } from './dto/update-teacher-tracking-record.dto';
import { Teacher } from './schemas/teacher.schema';
import { TeacherAssignment } from './schemas/teacher-assignment.schema';
import { TeacherContract } from './schemas/teacher-contract.schema';
import { TeacherDocumentFile } from './schemas/teacher-document.schema';
import { TeacherTrackingRecord } from './schemas/teacher-tracking-record.schema';

const CONTRACT_EXPIRY_WARNING_DAYS = 30;

@Injectable()
export class TeachersService {
  constructor(
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(TeacherAssignment.name)
    private readonly assignmentModel: Model<TeacherAssignment>,
    @InjectModel(TeacherContract.name)
    private readonly contractModel: Model<TeacherContract>,
    @InjectModel(TeacherDocumentFile.name)
    private readonly documentModel: Model<TeacherDocumentFile>,
    @InjectModel(TeacherTrackingRecord.name)
    private readonly trackingModel: Model<TeacherTrackingRecord>,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditService: AuditService,
  ) {}

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async list(filters: SearchTeachersDto = {}) {
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.q) {
      const pattern = { $regex: this.escapeRegExp(filters.q), $options: 'i' };
      query.$or = [{ lastname: pattern }, { firstname: pattern }];
    }
    return this.teacherModel
      .find(query)
      .sort({ lastname: 1, firstname: 1 })
      .lean()
      .exec();
  }

  // Same as list(), with each teacher's classes (for schoolYearId) and
  // total volume horaire attached - so the list page shows "intervient dans
  // quelles classes, pour combien d'heures" without a click into the
  // dossier. No-op (empty summary) when there's no open school year yet.
  async listWithAssignmentsSummary(
    filters: SearchTeachersDto = {},
    schoolYearId?: string,
  ) {
    const teachers = await this.list(filters);
    if (!schoolYearId || teachers.length === 0) {
      return teachers.map((teacher) => ({
        ...teacher,
        classes: [],
        totalHours: 0,
      }));
    }

    const teacherIds = teachers.map((teacher) => teacher._id);
    const assignments = await this.assignmentModel
      .find({ schoolYearId, teacherId: { $in: teacherIds } })
      .populate('levelId')
      .lean()
      .exec();

    const byTeacher = new Map<
      string,
      {
        classes: Array<{ label: string; isTitulaire: boolean }>;
        totalHours: number;
      }
    >();
    for (const assignment of assignments) {
      const key = String(assignment.teacherId);
      const entry = byTeacher.get(key) ?? { classes: [], totalHours: 0 };
      const level = assignment.levelId as unknown as { label?: string } | null;
      entry.classes.push({
        label: level?.label ?? '—',
        isTitulaire: Boolean(assignment.isTitulaire),
      });
      entry.totalHours += assignment.hoursPerWeek;
      byTeacher.set(key, entry);
    }

    return teachers.map((teacher) => ({
      ...teacher,
      ...(byTeacher.get(String(teacher._id)) ?? { classes: [], totalHours: 0 }),
    }));
  }

  async findById(id: string) {
    const teacher = await this.teacherModel.findById(id).lean().exec();
    if (!teacher) {
      throw new NotFoundException('Enseignant introuvable');
    }
    return teacher;
  }

  async create(dto: CreateTeacherDto, actorId?: string) {
    const teacher = await this.teacherModel.create({
      lastname: dto.lastname,
      firstname: dto.firstname,
      gender: dto.gender,
      birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      birthPlace: dto.birthPlace,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
      diploma: dto.diploma,
      specialty: dto.specialty,
      hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      status: dto.status,
      notes: dto.notes,
    });
    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_CREATED,
      entityType: 'Teacher',
      entityId: String(teacher._id),
    });
    return teacher;
  }

  async update(id: string, dto: CreateTeacherDto, actorId?: string) {
    const updated = await this.teacherModel
      .findByIdAndUpdate(
        id,
        {
          lastname: dto.lastname,
          firstname: dto.firstname,
          gender: dto.gender,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          birthPlace: dto.birthPlace,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
          diploma: dto.diploma,
          specialty: dto.specialty,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
          status: dto.status,
          notes: dto.notes,
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Enseignant introuvable');
    }
    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_UPDATED,
      entityType: 'Teacher',
      entityId: id,
    });
    return updated;
  }

  async savePhoto(id: string, file: UploadedImageFile | undefined) {
    const relativePath = saveUploadedImage('teachers', id, 'photo', file);
    if (!relativePath) {
      return;
    }
    await this.teacherModel
      .updateOne({ _id: id }, { photo: relativePath })
      .exec();
  }

  // ---- Affectations ----

  async listAssignments(teacherId: string) {
    return this.assignmentModel
      .find({ teacherId })
      .populate('schoolYearId')
      .populate('levelId')
      .populate('subjectId')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  // Une classe a la fois historiquement, mais un enseignant intervient
  // souvent dans plusieurs classes a la fois - une ligne est creee par
  // classe choisie (meme matiere/annee/volume horaire pour chacune). Les
  // doublons (meme matiere/classe/annee deja affectee a cet enseignant)
  // sont ignores silencieusement plutot que de faire echouer tout le lot -
  // le flash message en resume le nombre, voir TeachersController.
  async createAssignments(
    teacherId: string,
    schoolYearId: string,
    dto: CreateTeacherAssignmentDto,
  ) {
    await this.findById(teacherId);
    let created = 0;
    let skipped = 0;
    for (const levelId of dto.levelIds) {
      if (dto.isTitulaire) {
        // Un seul titulaire par classe/annee (index partiel) - reaffecter
        // le role retire automatiquement l'ancien titulaire de CETTE
        // classe, quel que soit l'enseignant qui le detenait.
        await this.assignmentModel
          .updateMany(
            { schoolYearId, levelId, isTitulaire: true },
            { isTitulaire: false },
          )
          .exec();
      }
      try {
        await this.assignmentModel.create({
          teacherId,
          schoolYearId,
          levelId,
          subjectId: dto.subjectId,
          hoursPerWeek: dto.hoursPerWeek,
          isTitulaire: Boolean(dto.isTitulaire),
        });
        created += 1;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: number }).code === 11000
        ) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    if (created === 0) {
      throw new BadRequestException(
        'Cette affectation (matière/classe/année) existe déjà pour cet enseignant',
      );
    }
    return { created, skipped };
  }

  // Jamais une suppression - on corrige l'affectation en place (matiere,
  // volume horaire, titulaire), motif obligatoire, avant/apres journalise.
  // La classe/annee elles-memes ne sont pas modifiables ici : elles
  // identifient l'affectation (voir l'index unique du schema) - en changer
  // reviendrait a en creer une autre.
  async updateAssignment(
    teacherId: string,
    assignmentId: string,
    dto: UpdateTeacherAssignmentDto,
    actorId?: string,
  ) {
    const assignment = await this.assignmentModel
      .findOne({ _id: assignmentId, teacherId })
      .exec();
    if (!assignment) {
      throw new NotFoundException('Affectation introuvable');
    }

    if (dto.isTitulaire) {
      await this.assignmentModel
        .updateMany(
          {
            schoolYearId: assignment.schoolYearId,
            levelId: assignment.levelId,
            isTitulaire: true,
            _id: { $ne: assignmentId },
          },
          { isTitulaire: false },
        )
        .exec();
    }

    const before = {
      subjectId: String(assignment.subjectId),
      hoursPerWeek: assignment.hoursPerWeek,
      isTitulaire: assignment.isTitulaire,
    };

    assignment.subjectId = dto.subjectId;
    assignment.hoursPerWeek = dto.hoursPerWeek;
    assignment.isTitulaire = Boolean(dto.isTitulaire);
    assignment.lastModificationReason = dto.modificationReason.trim();
    assignment.modifiedAt = new Date();
    await assignment.save();

    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_ASSIGNMENT_UPDATED,
      entityType: 'TeacherAssignment',
      entityId: assignmentId,
      details: {
        teacherId,
        before,
        after: {
          subjectId: dto.subjectId,
          hoursPerWeek: dto.hoursPerWeek,
          isTitulaire: Boolean(dto.isTitulaire),
        },
        reason: dto.modificationReason.trim(),
      },
    });

    return assignment;
  }

  // ---- Contrats ----

  async listContracts(teacherId: string) {
    return this.contractModel
      .find({ teacherId })
      .sort({ startDate: -1 })
      .lean()
      .exec();
  }

  // Un contrat ACTIF existant est automatiquement cloture (EXPIRE) et lie au
  // nouveau via renewedFromContractId - jamais reecrit en place, pour garder
  // l'historique complet (voir le commentaire du schema).
  async createContract(
    teacherId: string,
    dto: CreateTeacherContractDto,
    actorId?: string,
  ) {
    await this.findById(teacherId);
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const existing = await this.contractModel
        .findOne({ teacherId, status: TeacherContractStatus.ACTIF })
        .session(session ?? null)
        .exec();

      if (existing) {
        existing.status = TeacherContractStatus.EXPIRE;
        await existing.save({ session: session ?? undefined });
      }

      const [contract] = await this.contractModel.create(
        [
          {
            teacherId,
            type: dto.type,
            startDate: new Date(dto.startDate),
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            status: TeacherContractStatus.ACTIF,
            renewedFromContractId: existing ? existing._id : null,
            notes: dto.notes,
          },
        ],
        { session: session ?? undefined },
      );

      await this.auditService.log(
        {
          actorId,
          action: AuditAction.TEACHER_CONTRACT_CREATED,
          entityType: 'TeacherContract',
          entityId: String(contract._id),
          details: { teacherId, renewal: Boolean(existing) },
        },
        session ?? undefined,
      );

      return contract;
    });
  }

  async terminateContract(
    teacherId: string,
    contractId: string,
    dto: TerminateTeacherContractDto,
    actorId?: string,
  ) {
    const contract = await this.contractModel
      .findOne({ _id: contractId, teacherId })
      .exec();
    if (!contract) {
      throw new NotFoundException('Contrat introuvable');
    }
    if (contract.status !== TeacherContractStatus.ACTIF) {
      throw new BadRequestException("Ce contrat n'est pas actif");
    }
    contract.status = TeacherContractStatus.RESILIE;
    contract.terminatedAt = new Date();
    contract.terminatedReason = dto.reason;
    await contract.save();

    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_CONTRACT_TERMINATED,
      entityType: 'TeacherContract',
      entityId: contractId,
      details: { teacherId, reason: dto.reason },
    });

    return contract;
  }

  // Correction en place (type, dates, notes) - motif obligatoire, distincte
  // de la resiliation (terminateContract, qui a son propre statut et sa
  // propre raison). Le statut (actif/expire/resilie) n'est pas modifiable
  // ici, pour ne jamais contourner le cycle de vie gere par
  // createContract/terminateContract.
  async updateContract(
    teacherId: string,
    contractId: string,
    dto: UpdateTeacherContractDto,
    actorId?: string,
  ) {
    const contract = await this.contractModel
      .findOne({ _id: contractId, teacherId })
      .exec();
    if (!contract) {
      throw new NotFoundException('Contrat introuvable');
    }

    const before = {
      type: contract.type,
      startDate: contract.startDate,
      endDate: contract.endDate,
      notes: contract.notes,
    };

    contract.type = dto.type;
    contract.startDate = new Date(dto.startDate);
    contract.endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    contract.notes = dto.notes;
    contract.lastModificationReason = dto.modificationReason.trim();
    contract.modifiedAt = new Date();
    await contract.save();

    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_CONTRACT_UPDATED,
      entityType: 'TeacherContract',
      entityId: contractId,
      details: {
        teacherId,
        before,
        after: {
          type: dto.type,
          startDate: contract.startDate,
          endDate: contract.endDate,
          notes: dto.notes,
        },
        reason: dto.modificationReason.trim(),
      },
    });

    return contract;
  }

  // ---- Suivi ----

  async listTracking(teacherId: string) {
    return this.trackingModel
      .find({ teacherId })
      .populate('schoolYearId')
      .sort({ date: -1 })
      .lean()
      .exec();
  }

  async createTrackingRecord(
    teacherId: string,
    schoolYearId: string,
    dto: CreateTeacherTrackingRecordDto,
    actorId?: string,
  ) {
    await this.findById(teacherId);
    const record = await this.trackingModel.create({
      teacherId,
      schoolYearId,
      type: dto.type,
      date: new Date(dto.date),
      note: dto.note,
      recordedBy: actorId,
    });
    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_TRACKING_RECORD_CREATED,
      entityType: 'TeacherTrackingRecord',
      entityId: String(record._id),
      details: { teacherId },
    });
    return record;
  }

  // Correction en place - motif obligatoire, avant/apres journalise (voir
  // le commentaire du schema : la correction directe remplace maintenant
  // l'ajout d'une nouvelle entree, a condition d'etre tracee).
  async updateTrackingRecord(
    teacherId: string,
    recordId: string,
    dto: UpdateTeacherTrackingRecordDto,
    actorId?: string,
  ) {
    const record = await this.trackingModel
      .findOne({ _id: recordId, teacherId })
      .exec();
    if (!record) {
      throw new NotFoundException('Entrée de suivi introuvable');
    }

    const before = {
      type: record.type,
      date: record.date,
      note: record.note,
    };

    record.type = dto.type;
    record.date = new Date(dto.date);
    record.note = dto.note;
    record.lastModificationReason = dto.modificationReason.trim();
    record.modifiedAt = new Date();
    await record.save();

    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_TRACKING_RECORD_UPDATED,
      entityType: 'TeacherTrackingRecord',
      entityId: recordId,
      details: {
        teacherId,
        before,
        after: { type: dto.type, date: record.date, note: dto.note },
        reason: dto.modificationReason.trim(),
      },
    });

    return record;
  }

  // ---- Documents ----

  async listDocuments(teacherId: string) {
    return this.documentModel
      .find({ teacherId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async addDocument(
    teacherId: string,
    dto: CreateTeacherDocumentDto,
    file: UploadedDocumentFile | undefined,
    actorId?: string,
  ) {
    await this.findById(teacherId);
    const relativePath = saveUploadedDocument(
      'teachers-documents',
      teacherId,
      file,
    );
    return this.documentModel.create({
      teacherId,
      label: dto.label,
      originalName: file?.originalname ?? '',
      relativePath,
      uploadedBy: actorId,
    });
  }

  // Jamais une suppression - on corrige le libelle et, si un nouveau
  // fichier est fourni, on le remplace (l'ancien est efface du disque)
  // plutot que d'ajouter une piece jointe en plus. Motif obligatoire.
  async updateDocument(
    teacherId: string,
    documentId: string,
    dto: UpdateTeacherDocumentDto,
    file: UploadedDocumentFile | undefined,
    actorId?: string,
  ) {
    const doc = await this.documentModel
      .findOne({ _id: documentId, teacherId })
      .exec();
    if (!doc) {
      throw new NotFoundException('Document introuvable');
    }

    const before = { label: doc.label, originalName: doc.originalName };

    if (file?.buffer) {
      const previousPath = doc.relativePath;
      doc.relativePath = saveUploadedDocument(
        'teachers-documents',
        teacherId,
        file,
      );
      doc.originalName = file.originalname;
      deleteUploadedDocument(previousPath);
    }
    doc.label = dto.label;
    doc.lastModificationReason = dto.modificationReason.trim();
    doc.modifiedAt = new Date();
    await doc.save();

    await this.auditService.log({
      actorId,
      action: AuditAction.TEACHER_DOCUMENT_UPDATED,
      entityType: 'TeacherDocumentFile',
      entityId: documentId,
      details: {
        teacherId,
        before,
        after: { label: dto.label, originalName: doc.originalName },
        reason: dto.modificationReason.trim(),
      },
    });

    return doc;
  }

  // ---- Tableaux de bord et exports ----

  async getStats(schoolYearId?: string) {
    const [total, active, inactive, departed] = await Promise.all([
      this.teacherModel.countDocuments().exec(),
      this.teacherModel.countDocuments({ status: 'actif' }).exec(),
      this.teacherModel.countDocuments({ status: 'inactif' }).exec(),
      this.teacherModel.countDocuments({ status: 'depart' }).exec(),
    ]);

    const expiryThreshold = new Date();
    expiryThreshold.setDate(
      expiryThreshold.getDate() + CONTRACT_EXPIRY_WARNING_DAYS,
    );
    const expiringContracts = await this.contractModel
      .find({
        status: TeacherContractStatus.ACTIF,
        endDate: { $exists: true, $lte: expiryThreshold },
      })
      .populate('teacherId')
      .sort({ endDate: 1 })
      .lean()
      .exec();

    const hoursByTeacher = schoolYearId
      ? await this.assignmentModel
          .aggregate<{
            _id: string;
            totalHours: number;
          }>([
            { $match: { schoolYearId: new Types.ObjectId(schoolYearId) } },
            {
              $group: {
                _id: '$teacherId',
                totalHours: { $sum: '$hoursPerWeek' },
              },
            },
          ])
          .exec()
      : [];

    return {
      effectifs: { total, active, inactive, departed },
      expiringContracts,
      hoursByTeacher,
    };
  }

  async exportRows() {
    const teachers = await this.list();
    return teachers.map((teacher) => ({
      nom: teacher.lastname,
      prenoms: teacher.firstname,
      sexe: teacher.gender ?? '',
      telephone: teacher.phone ?? '',
      email: teacher.email ?? '',
      diplome: teacher.diploma ?? '',
      specialite: teacher.specialty ?? '',
      statut: teacher.status,
    }));
  }
}
