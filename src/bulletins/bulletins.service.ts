import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { EcolesService } from '../ecoles/ecoles.service';
import { SettingsService } from '../settings/settings.service';
import {
  AuditAction,
  BulletinImportMode,
  BulletinSessionStatus,
  BulletinStudentMatchingMode,
  EnrollmentStatus,
  EnrollmentType,
  ImportRowMatchStatus,
  Periode,
  SubjectCategory,
} from '../common/enums/domain.enums';
import { AuditService } from '../audit/audit.service';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import {
  Enrollment,
  EnrollmentDocument,
} from '../enrollments/schemas/enrollment.schema';
import { Level, LevelDocument } from '../levels/schemas/level.schema';
import {
  SchoolYear,
  SchoolYearDocument,
} from '../school-years/schemas/school-year.schema';
import { Student, StudentDocument } from '../students/schemas/student.schema';
import { StudentsService } from '../students/students.service';
import {
  diceCoefficient,
  normalizeLabel,
  DISCIPLINE_HEADERS,
  parseBulletinWorkbook,
  splitNameForMatching,
  type ParsedIdentityRow,
} from './bulletins-import.util';
import {
  appreciationFor,
  averageOfPresent,
  computeGroupAverage,
  computeStudentPeriodTotals,
  computeSubjectAverages,
  rankBy,
} from './bulletin-calculation.util';
import { PERIODES_BY_CYCLE, PERIODE_LABELS } from './bulletins.constants';
import { ApproveSubjectDto } from './dto/approve-subject.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { SaveDisciplineDto } from './dto/save-discipline.dto';
import { UpsertClassSubjectDto } from './dto/upsert-class-subject.dto';
import {
  BulletinImportRow,
  BulletinImportRowDocument,
  ImportRowNote,
} from './schemas/bulletin-import-row.schema';
import {
  BulletinResult,
  BulletinResultDocument,
} from './schemas/bulletin-result.schema';
import {
  BulletinSession,
  BulletinSessionDocument,
} from './schemas/bulletin-session.schema';
import {
  ClassSubject,
  ClassSubjectDocument,
} from './schemas/class-subject.schema';
import { Note, NoteDocument } from './schemas/note.schema';
import { Subject, SubjectDocument } from './schemas/subject.schema';

// Date sans heure ecrite dans un fichier Excel : a midi UTC. Excel ne garde
// pas de fuseau, et une date a minuit peut basculer la veille a la relecture
// selon le fuseau de la machine (date du conseil decalee d'un jour).
function middayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );
}

type RosterEntry = {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  lastname: string;
  firstname: string;
  gender?: string;
};

type RowMatch = {
  matchStatus: ImportRowMatchStatus;
  studentId: string | null;
  matchCandidates: string[];
};

// listRows()'s actual shape once .populate('studentId')/.populate(
// 'matchCandidates') + .lean() have run - the schema's own studentId:
// string/matchCandidates: string[] describe the unpopulated document, not
// what callers (controller view, tests) actually get back here.
type PopulatedStudentLean = Student & { _id: Types.ObjectId };
export type PopulatedImportRow = Omit<
  BulletinImportRow,
  'studentId' | 'matchCandidates'
> & {
  _id: Types.ObjectId;
  studentId: PopulatedStudentLean | null;
  matchCandidates: PopulatedStudentLean[];
};

const SUGGESTION_THRESHOLD = 0.5;

@Injectable()
export class BulletinsService {
  constructor(
    @InjectModel(BulletinSession.name)
    private readonly sessionModel: Model<BulletinSessionDocument>,
    @InjectModel(BulletinImportRow.name)
    private readonly rowModel: Model<BulletinImportRowDocument>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(ClassSubject.name)
    private readonly classSubjectModel: Model<ClassSubjectDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(BulletinResult.name)
    private readonly bulletinResultModel: Model<BulletinResultDocument>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Level.name) private readonly levelModel: Model<LevelDocument>,
    @InjectModel(SchoolYear.name)
    private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<StudentDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
    private readonly ecolesService: EcolesService,
    private readonly settingsService: SettingsService,
  ) {}

  async listSessions() {
    return this.sessionModel
      .find()
      .sort({ createdAt: -1 })
      .populate('schoolYearId')
      .populate('levelId')
      .lean()
      .exec();
  }

  async getSession(id: string) {
    const session = await this.sessionModel
      .findById(id)
      .populate('schoolYearId')
      .populate('levelId')
      .lean()
      .exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    return session;
  }

  async createSession(dto: CreateSessionDto, createdBy: string) {
    const level = await this.levelModel.findById(dto.levelId).lean().exec();
    if (!level) {
      throw new NotFoundException('Classe introuvable');
    }
    if (!level.cycle) {
      throw new BadRequestException(
        'Le cycle de cette classe (collège ou lycée) doit être configuré dans les paramètres avant de créer une session de bulletins',
      );
    }
    const allowedPeriodes = PERIODES_BY_CYCLE[level.cycle];
    if (!allowedPeriodes.includes(dto.periode)) {
      throw new BadRequestException(
        'Période invalide pour le cycle de cette classe',
      );
    }

    const existing = await this.sessionModel
      .findOne({
        schoolYearId: dto.schoolYearId,
        levelId: dto.levelId,
        periode: dto.periode,
      })
      .exec();
    if (existing) {
      return existing;
    }

    return this.sessionModel.create({
      schoolYearId: dto.schoolYearId,
      levelId: dto.levelId,
      periode: dto.periode,
      studentMatchingMode:
        dto.studentMatchingMode ?? BulletinStudentMatchingMode.RECONCILE,
      createdBy,
    });
  }

  private async getRoster(
    schoolYearId: string,
    levelId: string,
  ): Promise<RosterEntry[]> {
    const enrollments = await this.enrollmentModel
      .find({ schoolYearId, levelId, status: EnrollmentStatus.ACTIVE })
      .populate('studentId')
      .lean()
      .exec();

    return enrollments
      .filter((e) => e.studentId && typeof e.studentId === 'object')
      .map((e) => {
        const student = e.studentId as unknown as {
          _id: unknown;
          matricule: string;
          lastname: string;
          firstname: string;
          gender?: string;
        };
        return {
          enrollmentId: String(e._id),
          studentId: String(student._id),
          matricule: student.matricule,
          lastname: student.lastname,
          firstname: student.firstname,
          gender: student.gender,
        };
      });
  }

  private matchRow(
    nameRaw: string,
    matriculeRaw: string,
    roster: RosterEntry[],
  ): RowMatch {
    if (matriculeRaw) {
      const exact = roster.filter(
        (r) =>
          r.matricule &&
          r.matricule.toLowerCase() === matriculeRaw.toLowerCase(),
      );
      if (exact.length === 1) {
        return {
          matchStatus: ImportRowMatchStatus.MATCHED,
          studentId: exact[0].studentId,
          matchCandidates: [],
        };
      }
      if (exact.length > 1) {
        return {
          matchStatus: ImportRowMatchStatus.AMBIGUOUS,
          studentId: null,
          matchCandidates: exact.map((r) => r.studentId),
        };
      }
    }

    const nameVariants = splitNameForMatching(nameRaw);
    const nameExact = roster.filter((r) => {
      const full1 = normalizeLabel(`${r.lastname} ${r.firstname}`);
      const full2 = normalizeLabel(`${r.firstname} ${r.lastname}`);
      return nameVariants.includes(full1) || nameVariants.includes(full2);
    });
    if (nameExact.length === 1) {
      return {
        matchStatus: ImportRowMatchStatus.MATCHED,
        studentId: nameExact[0].studentId,
        matchCandidates: [],
      };
    }
    if (nameExact.length > 1) {
      return {
        matchStatus: ImportRowMatchStatus.AMBIGUOUS,
        studentId: null,
        matchCandidates: nameExact.map((r) => r.studentId),
      };
    }

    const rowNameNormalized = normalizeLabel(nameRaw);
    const scored = roster
      .map((r) => ({
        studentId: r.studentId,
        score: diceCoefficient(
          normalizeLabel(`${r.lastname} ${r.firstname}`),
          rowNameNormalized,
        ),
      }))
      .filter((s) => s.score >= SUGGESTION_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (scored.length > 0) {
      return {
        matchStatus: ImportRowMatchStatus.SUGGESTED,
        studentId: null,
        matchCandidates: scored.map((s) => s.studentId),
      };
    }

    return {
      matchStatus: ImportRowMatchStatus.UNRESOLVED,
      studentId: null,
      matchCandidates: [],
    };
  }

  // Auto-create path for schools using this platform solely for bulletin
  // generation, with no pre-existing students to reconcile against (see
  // BulletinStudentMatchingMode). Deliberately does NOT check the roster
  // for an accidental existing-student match first: the operator explicitly
  // chose "sans rapprochement" when creating the session, so silently
  // falling back to reconciliation for some rows but not others (depending
  // on unpredictable per-row roster overlap) would be surprising and
  // inconsistent with that choice.
  //
  // Creates Student/Enrollment directly via the injected models rather than
  // through StudentsService.create() (requires a guardian with a phone
  // contact - never present in a bulletins file) or
  // EnrollmentsService.createEnrollment() (always creates an Invoice via
  // BillingService - inappropriate for a school that may not have Finance
  // active at all).
  private async createStudentAndEnrollmentForRow(
    row: ParsedIdentityRow,
    session: BulletinSessionDocument,
    levelSnapshot?: { code: string; label: string; sortOrder: number },
  ): Promise<RowMatch> {
    const spaceIndex = row.nameRaw.indexOf(' ');
    const lastname =
      spaceIndex === -1 ? row.nameRaw : row.nameRaw.slice(0, spaceIndex);
    const firstname =
      spaceIndex === -1 ? '' : row.nameRaw.slice(spaceIndex + 1);
    const matricule =
      row.matriculeRaw.trim() ||
      (await this.studentsService.generateUniqueMatricule());
    const gender = row.sexeRaw.trim().toUpperCase();

    const student = await this.studentModel.create({
      matricule,
      lastname,
      firstname,
      gender,
    });

    await this.enrollmentModel.create({
      studentId: student._id,
      schoolYearId: session.schoolYearId,
      levelId: session.levelId,
      type: EnrollmentType.INITIAL,
      studentSnapshot: {
        matricule: student.matricule,
        lastname: student.lastname,
        firstname: student.firstname,
        gender: student.gender,
      },
      levelSnapshot,
    });

    return {
      matchStatus: ImportRowMatchStatus.MATCHED,
      studentId: String(student._id),
      matchCandidates: [],
    };
  }

  async importFile(
    sessionId: string,
    buffer: Buffer,
    mode: BulletinImportMode,
    fileName?: string,
  ) {
    const session = await this.sessionModel.findById(sessionId).exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status === BulletinSessionStatus.VALIDATED) {
      throw new BadRequestException('Cette session est déjà validée');
    }
    if (
      mode === BulletinImportMode.PREMIER_IMPORT &&
      session.status !== BulletinSessionStatus.DRAFT
    ) {
      throw new BadRequestException(
        'Cette session a déjà été importée - utilisez le mode "écraser" ou "fusionner"',
      );
    }
    if (
      mode !== BulletinImportMode.PREMIER_IMPORT &&
      session.status === BulletinSessionStatus.DRAFT
    ) {
      throw new BadRequestException(
        'Aucun import existant pour cette session - utilisez "premier import"',
      );
    }

    const parsed = parseBulletinWorkbook(buffer);
    const roster = await this.getRoster(session.schoolYearId, session.levelId);

    const uniqueSubjectNames = [
      ...new Set(
        parsed.rows.flatMap((r) => r.notes.map((n) => n.subjectNameRaw)),
      ),
    ];
    const subjectIdByNormalized = new Map<string, string>();
    for (const nameRaw of uniqueSubjectNames) {
      const normalized = normalizeLabel(nameRaw);
      const subject = await this.subjectModel
        .findOne({ labelNormalized: normalized })
        .lean()
        .exec();
      if (!subject) {
        continue;
      }
      const classSubject = await this.classSubjectModel
        .findOne({
          schoolYearId: session.schoolYearId,
          levelId: session.levelId,
          subjectId: subject._id,
        })
        .lean()
        .exec();
      if (classSubject) {
        subjectIdByNormalized.set(normalized, String(subject._id));
      }
    }

    const existingRows =
      mode !== BulletinImportMode.PREMIER_IMPORT
        ? await this.rowModel.find({ sessionId }).exec()
        : [];
    const existingByNameKey = new Map(
      existingRows.map((r) => [normalizeLabel(r.rawIdentity.nameRaw), r]),
    );

    let levelSnapshot:
      | { code: string; label: string; sortOrder: number }
      | undefined;
    if (
      session.studentMatchingMode === BulletinStudentMatchingMode.AUTO_CREATE
    ) {
      // Pre-flight over the whole file, before any write (including the
      // ECRASER delete below) - importFile() isn't transactional (imports
      // are deliberately re-runnable), so a failure discovered mid-loop
      // would otherwise leave earlier rows' auto-created Student documents
      // permanently persisted with no rollback.
      const errors: string[] = [];
      const seenMatricules = new Map<string, number>();
      parsed.rows.forEach((row, index) => {
        const rowNumber = index + 1;
        if (existingByNameKey.has(normalizeLabel(row.nameRaw))) {
          return;
        }
        const gender = row.sexeRaw.trim().toUpperCase();
        if (!['M', 'F'].includes(gender)) {
          errors.push(
            `Ligne ${rowNumber} (${row.nameRaw || 'nom vide'}) : sexe invalide ou manquant ("${row.sexeRaw}")`,
          );
        }
        const matricule = row.matriculeRaw.trim().toLowerCase();
        if (matricule) {
          const firstSeenAt = seenMatricules.get(matricule);
          if (firstSeenAt) {
            errors.push(
              `Ligne ${rowNumber} (${row.nameRaw}) : matricule "${row.matriculeRaw}" déjà utilisé à la ligne ${firstSeenAt} du même fichier`,
            );
          } else {
            seenMatricules.set(matricule, rowNumber);
          }
        }
      });
      if (errors.length > 0) {
        throw new BadRequestException(
          `Import impossible : ${errors.length} ligne(s) invalide(s) pour la création automatique. ${errors.join(' | ')}`,
        );
      }

      const level = await this.levelModel
        .findById(session.levelId)
        .lean()
        .exec();
      if (level) {
        levelSnapshot = {
          code: level.code,
          label: level.label,
          sortOrder: level.sortOrder,
        };
      }
    }

    if (mode === BulletinImportMode.ECRASER) {
      await this.rowModel.deleteMany({ sessionId }).exec();
    }

    for (const row of parsed.rows) {
      const notesWithSubjectId: ImportRowNote[] = row.notes.map((n) => ({
        ...n,
        subjectId: subjectIdByNormalized.get(normalizeLabel(n.subjectNameRaw)),
      }));

      const nameKey = normalizeLabel(row.nameRaw);
      const existing = existingByNameKey.get(nameKey);

      if (mode === BulletinImportMode.FUSIONNER && existing) {
        const mergedNotes: ImportRowNote[] = existing.notes.map(
          (existingNote) => {
            const incoming = notesWithSubjectId.find(
              (n) =>
                normalizeLabel(n.subjectNameRaw) ===
                normalizeLabel(existingNote.subjectNameRaw),
            );
            if (!incoming) {
              return existingNote;
            }
            return {
              subjectNameRaw: incoming.subjectNameRaw,
              subjectId: incoming.subjectId ?? existingNote.subjectId,
              i1: incoming.i1 ?? existingNote.i1,
              i2: incoming.i2 ?? existingNote.i2,
              devoir: incoming.devoir ?? existingNote.devoir,
              compo: incoming.compo ?? existingNote.compo,
              coef: incoming.coef ?? existingNote.coef,
              profRaw: incoming.profRaw || existingNote.profRaw,
            };
          },
        );
        for (const incoming of notesWithSubjectId) {
          const already = mergedNotes.some(
            (m) =>
              normalizeLabel(m.subjectNameRaw) ===
              normalizeLabel(incoming.subjectNameRaw),
          );
          if (!already) {
            mergedNotes.push(incoming);
          }
        }
        await this.rowModel
          .updateOne(
            { _id: existing._id },
            {
              notes: mergedNotes,
              ...(row.discipline
                ? {
                    retards: row.discipline.retards ?? existing.retards,
                    absences: row.discipline.absences ?? existing.absences,
                    exclusion: row.discipline.exclusion || existing.exclusion,
                    decisionConseil:
                      row.discipline.decisionConseil ||
                      existing.decisionConseil,
                  }
                : {}),
            },
          )
          .exec();
        continue;
      }

      const match: RowMatch = existing
        ? {
            matchStatus: existing.matchStatus,
            studentId: existing.studentId,
            matchCandidates: existing.matchCandidates,
          }
        : session.studentMatchingMode ===
            BulletinStudentMatchingMode.AUTO_CREATE
          ? await this.createStudentAndEnrollmentForRow(
              row,
              session,
              levelSnapshot,
            )
          : this.matchRow(row.nameRaw, row.matriculeRaw, roster);

      const rowPayload = {
        sessionId,
        rawIdentity: {
          nameRaw: row.nameRaw,
          matriculeRaw: row.matriculeRaw,
          sexeRaw: row.sexeRaw,
        },
        studentId: match.studentId,
        matchStatus: match.matchStatus,
        matchCandidates: match.matchCandidates,
        notes: notesWithSubjectId,
        ...(row.discipline
          ? {
              retards: row.discipline.retards,
              absences: row.discipline.absences,
              exclusion: row.discipline.exclusion || undefined,
              decisionConseil: row.discipline.decisionConseil || undefined,
            }
          : {}),
      };

      // In ECRASER mode the rows fetched into existingByNameKey were already
      // deleted above (bulk deleteMany) - their _id no longer exists, so an
      // updateOne against it would silently match nothing and drop the row.
      // Reuse existing's match data (studentId/matchStatus) but always
      // create fresh documents in that mode.
      if (existing && mode !== BulletinImportMode.ECRASER) {
        await this.rowModel.updateOne({ _id: existing._id }, rowPayload).exec();
      } else {
        await this.rowModel.create(rowPayload);
      }
    }

    session.status = BulletinSessionStatus.IMPORTED;
    session.sourceFileName = fileName ?? session.sourceFileName;
    session.importedAt = new Date();
    session.meta = {
      titulaire: parsed.meta.titulaire || session.meta?.titulaire,
      chefEtablissement:
        parsed.meta.chefEtablissement || session.meta?.chefEtablissement,
      anneeScolaire: parsed.meta.anneeScolaire || session.meta?.anneeScolaire,
      dateDuConseil: parsed.meta.dateDuConseil ?? session.meta?.dateDuConseil,
    };
    await session.save();
    await this.recomputeSessionStatus(sessionId);

    return this.getSession(sessionId);
  }

  private async recomputeSessionStatus(sessionId: string) {
    const session = await this.sessionModel.findById(sessionId).exec();
    if (!session || session.status === BulletinSessionStatus.VALIDATED) {
      return;
    }
    const rows = await this.rowModel.find({ sessionId }).lean().exec();
    const allMatched =
      rows.length > 0 &&
      rows.every((r) => r.matchStatus === ImportRowMatchStatus.MATCHED);
    const hasUnapprovedSubject = rows.some((r) =>
      r.notes.some((n) => !n.subjectId),
    );
    session.status =
      allMatched && !hasUnapprovedSubject
        ? BulletinSessionStatus.READY
        : BulletinSessionStatus.PENDING_REVIEW;
    await session.save();
  }

  async resolveRow(rowId: string, studentId: string) {
    const existing = await this.rowModel.findById(rowId).exec();
    if (!existing) {
      throw new NotFoundException('Ligne introuvable');
    }
    await this.assertSessionNotValidated(String(existing.sessionId));

    const row = await this.rowModel
      .findByIdAndUpdate(
        rowId,
        {
          studentId,
          matchStatus: ImportRowMatchStatus.MATCHED,
          matchCandidates: [],
        },
        { new: true },
      )
      .exec();
    if (!row) {
      throw new NotFoundException('Ligne introuvable');
    }
    await this.recomputeSessionStatus(String(row.sessionId));
    return row;
  }

  async approveSubject(sessionId: string, dto: ApproveSubjectDto) {
    const session = await this.sessionModel.findById(sessionId).exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status === BulletinSessionStatus.VALIDATED) {
      throw new BadRequestException('Cette session est déjà validée');
    }

    let subjectId = dto.existingSubjectId;
    if (!subjectId) {
      if (!dto.label || !dto.category) {
        throw new BadRequestException(
          'Nom et catégorie requis pour créer une nouvelle matière',
        );
      }
      const labelNormalized = normalizeLabel(dto.label);
      const existingSubject = await this.subjectModel
        .findOne({ labelNormalized })
        .exec();
      const subject =
        existingSubject ??
        (await this.subjectModel.create({
          label: dto.label,
          labelNormalized,
          category: dto.category,
        }));
      subjectId = String(subject._id);
    }

    await this.classSubjectModel
      .findOneAndUpdate(
        {
          schoolYearId: session.schoolYearId,
          levelId: session.levelId,
          subjectId,
        },
        {
          $setOnInsert: {
            coefficient: dto.coefficient,
            teacherName: dto.teacherName,
            displayOrder: 0,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    const normalized = normalizeLabel(dto.subjectNameRaw);
    const rows = await this.rowModel.find({ sessionId }).exec();
    for (const row of rows) {
      let changed = false;
      const notes = row.notes.map((n) => {
        if (normalizeLabel(n.subjectNameRaw) === normalized && !n.subjectId) {
          changed = true;
          return { ...n, subjectId };
        }
        return n;
      });
      if (changed) {
        row.notes = notes;
        await row.save();
      }
    }

    await this.recomputeSessionStatus(sessionId);
    return { subjectId };
  }

  // Also surfaces the file's own "Prof" value for each unapproved subject
  // (consistent across rows in practice - the file lists one teacher per
  // subject, not per student) so the approval form can pre-fill it instead
  // of asking the operator to retype data already present in the file.
  async getUnapprovedSubjects(sessionId: string): Promise<
    {
      subjectNameRaw: string;
      profRaw: string;
      // Pre-remplissage du formulaire d'approbation avec ce que le fichier
      // et le catalogue disent deja (au lieu de tout faire retaper).
      coefficient: number | null;
      category: SubjectCategory | null;
      label: string;
    }[]
  > {
    const rows = await this.rowModel.find({ sessionId }).lean().exec();
    const bySubject = new Map<
      string,
      { profRaw: string; coefCounts: Map<number, number> }
    >();
    for (const row of rows) {
      for (const note of row.notes) {
        if (note.subjectId) {
          continue;
        }
        const entry = bySubject.get(note.subjectNameRaw) ?? {
          profRaw: '',
          coefCounts: new Map<number, number>(),
        };
        if (!entry.profRaw && note.profRaw) {
          entry.profRaw = note.profRaw;
        }
        if (typeof note.coef === 'number' && Number.isFinite(note.coef)) {
          entry.coefCounts.set(
            note.coef,
            (entry.coefCounts.get(note.coef) ?? 0) + 1,
          );
        }
        bySubject.set(note.subjectNameRaw, entry);
      }
    }

    // Matiere deja connue au catalogue (autre classe) : reprendre son nom
    // exact et sa categorie.
    const catalog = await this.subjectModel
      .find({
        labelNormalized: {
          $in: [...bySubject.keys()].map((name) => normalizeLabel(name)),
        },
      })
      .lean()
      .exec();
    const catalogByNormalized = new Map(
      catalog.map((subject) => [subject.labelNormalized, subject]),
    );

    return [...bySubject.entries()].map(([subjectNameRaw, entry]) => {
      // Coefficient le plus frequent dans le fichier pour cette matiere.
      const coefficient =
        [...entry.coefCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        null;
      const known = catalogByNormalized.get(normalizeLabel(subjectNameRaw));
      return {
        subjectNameRaw,
        profRaw: entry.profRaw,
        coefficient,
        category: known?.category ?? null,
        label: known?.label ?? subjectNameRaw,
      };
    });
  }

  async getRosterForSession(sessionId: string) {
    const session = await this.sessionModel.findById(sessionId).lean().exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    return this.getRoster(session.schoolYearId, session.levelId);
  }

  async listRows(sessionId: string): Promise<PopulatedImportRow[]> {
    return this.rowModel
      .find({ sessionId })
      .populate('studentId')
      .populate('matchCandidates')
      .lean()
      .exec() as unknown as Promise<PopulatedImportRow[]>;
  }

  // Retards/absences/exclusion/decision du conseil: not calculable, entered
  // manually per matched student before validation (see
  // BulletinResult.retards/absences/exclusion/decisionConseil, copied from
  // BulletinImportRow at validateSession()). Only matched rows are shown -
  // an unresolved row has no bulletin to attach this information to yet.
  async getDisciplineRows(sessionId: string) {
    return this.rowModel
      .find({ sessionId, matchStatus: ImportRowMatchStatus.MATCHED })
      .populate('studentId')
      .sort({ 'rawIdentity.nameRaw': 1 })
      .lean()
      .exec();
  }

  async saveDiscipline(rowId: string, dto: SaveDisciplineDto) {
    const existing = await this.rowModel.findById(rowId).exec();
    if (!existing) {
      throw new NotFoundException('Ligne introuvable');
    }
    await this.assertSessionNotValidated(String(existing.sessionId));

    const row = await this.rowModel
      .findByIdAndUpdate(
        rowId,
        {
          retards: dto.retards ?? null,
          absences: dto.absences ?? null,
          exclusion: dto.exclusion,
          decisionConseil: dto.decisionConseil,
        },
        { new: true },
      )
      .exec();
    if (!row) {
      throw new NotFoundException('Ligne introuvable');
    }
    return row;
  }

  // Once a session is validated, Note/BulletinResult are snapshotted once
  // and never recomputed (see validateSession) - editing the underlying
  // import row's match/discipline data afterward would silently diverge
  // from the already-generated bulletin PDF, so every mutation route on a
  // row must reject once the parent session is validated.
  private async assertSessionNotValidated(sessionId: string): Promise<void> {
    const session = await this.sessionModel
      .findById(sessionId)
      .select('status')
      .lean()
      .exec();
    if (session?.status === BulletinSessionStatus.VALIDATED) {
      throw new BadRequestException('Cette session est déjà validée');
    }
  }

  // "What did I actually import" grid: one row per student, one column per
  // subject (i1/i2/devoir/compo), always reflecting the current state of
  // BulletinImportRow.notes regardless of session status (review-in-progress
  // or already validated) - so it's the live import data, not a snapshot.
  async getImportGrid(sessionId: string) {
    const session = await this.getSession(sessionId);
    const rows = await this.rowModel
      .find({ sessionId })
      .populate('studentId')
      .sort({ 'rawIdentity.nameRaw': 1 })
      .lean()
      .exec();

    // Column order follows first-seen order across rows (matches the
    // original Excel column order), not an alphabetical re-sort.
    const subjectOrder: string[] = [];
    const seenSubjects = new Set<string>();
    for (const row of rows) {
      for (const note of row.notes) {
        const key = normalizeLabel(note.subjectNameRaw);
        if (!seenSubjects.has(key)) {
          seenSubjects.add(key);
          subjectOrder.push(note.subjectNameRaw);
        }
      }
    }

    const gridRows = rows.map((row) => {
      const student =
        row.studentId && typeof row.studentId === 'object'
          ? (row.studentId as unknown as {
              _id: unknown;
              lastname: string;
              firstname: string;
              matricule: string;
            })
          : null;
      const notesBySubject = new Map(
        row.notes.map((n) => [normalizeLabel(n.subjectNameRaw), n]),
      );
      return {
        studentId: student ? String(student._id) : null,
        displayName: student
          ? `${student.lastname} ${student.firstname}`
          : row.rawIdentity.nameRaw,
        matricule: student?.matricule ?? row.rawIdentity.matriculeRaw,
        sexeRaw: row.rawIdentity.sexeRaw,
        matchStatus: row.matchStatus,
        cells: subjectOrder.map(
          (subjectNameRaw) =>
            notesBySubject.get(normalizeLabel(subjectNameRaw)) ?? null,
        ),
      };
    });

    // File's "Prof" cell per subject, for display next to the subject name
    // in the header (informational only - see ClassSubject.teacherName for
    // the authoritative, editable value).
    const subjectTeachers = subjectOrder.map((subjectNameRaw) => {
      const key = normalizeLabel(subjectNameRaw);
      const withProf = rows.find((row) =>
        row.notes.some(
          (n) => normalizeLabel(n.subjectNameRaw) === key && n.profRaw,
        ),
      );
      const note = withProf?.notes.find(
        (n) => normalizeLabel(n.subjectNameRaw) === key,
      );
      return note?.profRaw ?? '';
    });

    return {
      session,
      subjects: subjectOrder,
      subjectTeachers,
      rows: gridRows,
    };
  }

  async listSubjectsForSession(sessionId: string) {
    const session = await this.sessionModel.findById(sessionId).lean().exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    const classSubjects = await this.classSubjectModel
      .find({ schoolYearId: session.schoolYearId, levelId: session.levelId })
      .populate('subjectId')
      .lean()
      .exec();
    return classSubjects;
  }

  // --- Standalone "Matieres" management screen (proactive, outside the
  // reactive approve-subject-during-import flow) ---

  async listSubjects() {
    return this.subjectModel.find().sort({ label: 1 }).lean().exec();
  }

  async createSubject(dto: CreateSubjectDto) {
    const labelNormalized = normalizeLabel(dto.label);
    const existing = await this.subjectModel
      .findOne({ labelNormalized })
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException('Cette matière existe déjà');
    }
    return this.subjectModel.create({
      label: dto.label,
      labelNormalized,
      category: dto.category,
    });
  }

  // Saisie des notes dans l'application, une matiere a la fois (comme sur
  // la fiche papier d'un enseignant). Ecrit dans les memes lignes
  // BulletinImportRow que l'import Excel : revue, discipline, validation et
  // PDF restent identiques, et import Excel / saisie peuvent se completer.
  async getGradeEntry(sessionId: string, subjectId?: string) {
    const session = await this.getSession(sessionId);
    const yearId = String(
      (session.schoolYearId as unknown as { _id: Types.ObjectId })._id,
    );
    const levelId = String(
      (session.levelId as unknown as { _id: Types.ObjectId })._id,
    );
    const [classSubjects, roster, rows] = await Promise.all([
      this.listClassSubjects(yearId, levelId),
      this.getRoster(yearId, levelId),
      this.rowModel.find({ sessionId }).lean().exec(),
    ]);

    const subjects = classSubjects.map((cs) => {
      const subject = cs.subjectId as unknown as {
        _id: Types.ObjectId;
        label: string;
      };
      return {
        subjectId: String(subject._id),
        label: subject.label,
        coefficient: cs.coefficient,
        teacherName: cs.teacherName ?? '',
      };
    });
    const rowByStudent = new Map(
      rows
        .filter((row) => row.studentId)
        .map((row) => [String(row.studentId), row]),
    );
    const noteFor = (
      studentId: string,
      subject: { subjectId: string; label: string },
    ) =>
      rowByStudent
        .get(studentId)
        ?.notes.find(
          (note) =>
            String(note.subjectId) === subject.subjectId ||
            normalizeLabel(note.subjectNameRaw) ===
              normalizeLabel(subject.label),
        );
    const hasValue = (note?: ImportRowNote) =>
      Boolean(
        note &&
        [note.i1, note.i2, note.devoir, note.compo].some(
          (value) => value !== null && value !== undefined,
        ),
      );

    const sortedRoster = [...roster].sort((a, b) =>
      `${a.lastname} ${a.firstname}`.localeCompare(
        `${b.lastname} ${b.firstname}`,
        'fr',
        { sensitivity: 'base' },
      ),
    );
    const selected =
      subjects.find((subject) => subject.subjectId === subjectId) ??
      subjects[0] ??
      null;
    const students = sortedRoster.map((entry) => {
      const note = selected ? noteFor(entry.studentId, selected) : undefined;
      return {
        studentId: entry.studentId,
        name: `${entry.lastname} ${entry.firstname}`.trim(),
        matricule: entry.matricule,
        i1: note?.i1 ?? null,
        i2: note?.i2 ?? null,
        devoir: note?.devoir ?? null,
        compo: note?.compo ?? null,
      };
    });
    // Avancement par matiere : nombre d'eleves ayant au moins une note.
    const progress = subjects.map((subject) => ({
      ...subject,
      filled: sortedRoster.filter((entry) =>
        hasValue(noteFor(entry.studentId, subject)),
      ).length,
    }));

    return {
      session,
      subjects: progress,
      selected,
      students,
      readOnly: session.status === BulletinSessionStatus.VALIDATED,
    };
  }

  async saveGradeEntry(
    sessionId: string,
    subjectId: string,
    values: Record<
      string,
      {
        i1: number | null;
        i2: number | null;
        devoir: number | null;
        compo: number | null;
      }
    >,
  ): Promise<{
    subjectLabel: string;
    studentCount: number;
    withoutNotes: number;
  }> {
    const session = await this.sessionModel.findById(sessionId).exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status === BulletinSessionStatus.VALIDATED) {
      throw new BadRequestException(
        'Cette session est déjà validée : les notes ne peuvent plus être modifiées.',
      );
    }
    const classSubject = await this.classSubjectModel
      .findOne({
        schoolYearId: session.schoolYearId,
        levelId: session.levelId,
        subjectId,
      })
      .populate('subjectId')
      .lean()
      .exec();
    if (!classSubject) {
      throw new BadRequestException(
        "Cette matière n'est pas configurée pour la classe de la session.",
      );
    }
    const subjectLabel = (
      classSubject.subjectId as unknown as { label: string }
    ).label;
    const roster = await this.getRoster(
      String(session.schoolYearId),
      String(session.levelId),
    );

    const FIELD_LABELS = {
      i1: 'I1',
      i2: 'I2',
      devoir: 'Devoir',
      compo: 'Compo',
    } as const;
    const errors: string[] = [];
    for (const entry of roster) {
      const studentValues = values[entry.studentId];
      if (!studentValues) {
        continue;
      }
      for (const field of Object.keys(FIELD_LABELS) as Array<
        keyof typeof FIELD_LABELS
      >) {
        const value = studentValues[field];
        if (
          value !== null &&
          (!Number.isFinite(value) || value < 0 || value > 20)
        ) {
          errors.push(
            `${entry.lastname} ${entry.firstname} — ${FIELD_LABELS[field]} : saisissez une note entre 0 et 20`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new BadRequestException(
        `Notes non enregistrées. ${errors.slice(0, 5).join(' ; ')}${errors.length > 5 ? ` (et ${errors.length - 5} autre(s))` : ''}.`,
      );
    }

    const rows = await this.rowModel.find({ sessionId }).exec();
    const rowByStudent = new Map(
      rows
        .filter((row) => row.studentId)
        .map((row) => [String(row.studentId), row]),
    );
    const isSameSubject = (note: ImportRowNote) =>
      String(note.subjectId) === subjectId ||
      normalizeLabel(note.subjectNameRaw) === normalizeLabel(subjectLabel);

    for (const entry of roster) {
      const studentValues = values[entry.studentId] ?? {
        i1: null,
        i2: null,
        devoir: null,
        compo: null,
      };
      const note: ImportRowNote = {
        subjectNameRaw: subjectLabel,
        subjectId,
        i1: studentValues.i1,
        i2: studentValues.i2,
        devoir: studentValues.devoir,
        compo: studentValues.compo,
        coef: classSubject.coefficient,
        profRaw: classSubject.teacherName ?? '',
      };
      const existing = rowByStudent.get(entry.studentId);
      if (existing) {
        await this.rowModel
          .updateOne(
            { _id: existing._id },
            {
              notes: [...existing.notes.filter((n) => !isSameSubject(n)), note],
            },
          )
          .exec();
      } else {
        await this.rowModel.create({
          sessionId,
          rawIdentity: {
            nameRaw: `${entry.lastname} ${entry.firstname}`.trim(),
            matriculeRaw: entry.matricule ?? '',
            sexeRaw: entry.gender ?? '',
          },
          studentId: entry.studentId,
          matchStatus: ImportRowMatchStatus.MATCHED,
          matchCandidates: [],
          notes: [note],
        });
      }
    }

    if (session.status === BulletinSessionStatus.DRAFT) {
      session.status = BulletinSessionStatus.IMPORTED;
      session.importedAt = new Date();
      session.sourceFileName = "Saisie dans l'application";
    }
    if (!session.meta?.anneeScolaire || !session.meta?.chefEtablissement) {
      const year = await this.schoolYearModel
        .findById(session.schoolYearId)
        .lean()
        .exec();
      session.meta = {
        ...session.meta,
        anneeScolaire: session.meta?.anneeScolaire || year?.label,
        chefEtablissement:
          session.meta?.chefEtablissement ||
          (await this.settingsService.getChefEtablissementNom()) ||
          undefined,
      };
    }
    await session.save();
    await this.recomputeSessionStatus(sessionId);

    // Rapport A28 : on compte les eleves qui ont reellement au moins une note,
    // pas toute la classe.
    const studentCount = roster.filter((entry) => {
      const v = values[entry.studentId];
      return Boolean(
        v && [v.i1, v.i2, v.devoir, v.compo].some((note) => note !== null),
      );
    }).length;
    return {
      subjectLabel,
      studentCount,
      withoutNotes: roster.length - studentCount,
    };
  }

  // Modele Excel d'import pre-rempli pour une session : exactement le format
  // que parseBulletinWorkbook() attend (une seule ligne d'en-tete : 5
  // colonnes d'identite, puis par matiere un bloc nom + I1/I2/Devoir/Compo/
  // Coef/Prof, puis les 5 colonnes d'informations de la classe). Eleves
  // inscrits, matieres, coefficients et enseignants viennent de la
  // configuration (ecran Matieres) : il ne reste qu'a saisir les notes.
  async buildImportTemplate(
    sessionId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const session = await this.getSession(sessionId);
    const level = session.levelId as unknown as {
      _id: Types.ObjectId;
      label: string;
    };
    const year = session.schoolYearId as unknown as {
      _id: Types.ObjectId;
      label: string;
    };

    const [classSubjects, enrollments, chefEtablissementNom, savedRows] =
      await Promise.all([
        this.listClassSubjects(String(year._id), String(level._id)),
        this.enrollmentModel
          .find({
            schoolYearId: year._id,
            levelId: level._id,
            status: EnrollmentStatus.ACTIVE,
          })
          .populate('studentId')
          .lean()
          .exec(),
        this.settingsService.getChefEtablissementNom(),
        this.rowModel.find({ sessionId }).lean().exec(),
      ]);
    if (classSubjects.length === 0) {
      throw new BadRequestException(
        `Aucune matière n'est configurée pour ${level.label} : ajoutez les matières et leurs coefficients dans « Matières » avant de télécharger le modèle.`,
      );
    }

    const subjects = classSubjects.map((cs) => {
      const subject = cs.subjectId as unknown as {
        _id: Types.ObjectId;
        label: string;
      };
      return {
        subjectId: String(subject._id),
        label: subject.label,
        coefficient: cs.coefficient,
        teacherName: cs.teacherName ?? '',
      };
    });
    const students = enrollments
      .map((enrollment) => {
        const student = enrollment.studentId as unknown as {
          _id?: Types.ObjectId;
          lastname?: string;
          firstname?: string;
          matricule?: string;
          gender?: string;
        } | null;
        const snapshot = (enrollment.studentSnapshot ?? {}) as {
          lastname?: string;
          firstname?: string;
        };
        const lastname = student?.lastname ?? snapshot.lastname ?? '';
        const firstname = student?.firstname ?? snapshot.firstname ?? '';
        return {
          studentId: student?._id ? String(student._id) : '',
          name: `${lastname} ${firstname}`.trim(),
          matricule: student?.matricule ?? '',
          gender: student?.gender ?? '',
          nr: enrollment.type === EnrollmentType.REPEAT ? 'R' : 'N',
        };
      })
      .filter((student) => student.name !== '')
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
      );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Notes', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
    });

    const NOTE_LABELS = ['I1', 'I2', 'Devoir', 'Compo'];
    const header = ['N°', 'Nom et prénoms', 'Matricule', 'Sexe', 'N/R'];
    for (const subject of subjects) {
      header.push(subject.label, ...NOTE_LABELS, 'Coef', 'Prof');
    }
    const metaStart = header.length + 1;
    header.push(
      'Classe',
      'Titulaire',
      "Chef d'établissement",
      'Année scolaire',
      'Date du conseil',
      ...DISCIPLINE_HEADERS,
    );
    sheet.addRow(header);

    // Ce que l'application connait deja pour la session : une ligne par
    // eleve inscrit dans la classe, avec ses notes et sa discipline deja
    // enregistrees. Uniquement les eleves de la classe, comme l'ecran de
    // saisie : les lignes d'un import precedent jamais rattachees a un eleve
    // restent dans "Revoir les correspondances" (les reprendre ici melangeait
    // de faux eleves sans matricule a la vraie liste de la classe).
    const rowByStudent = new Map(
      savedRows
        .filter((row) => row.studentId)
        .map((row) => [String(row.studentId), row]),
    );
    const entries = students.map((student) => ({
      ...student,
      saved: rowByStudent.get(student.studentId),
    }));
    const savedNote = (
      saved: (typeof savedRows)[number] | undefined,
      subjectId: string,
      label: string,
    ) =>
      saved?.notes.find(
        (note) =>
          String(note.subjectId) === subjectId ||
          normalizeLabel(note.subjectNameRaw) === normalizeLabel(label),
      );

    entries.forEach((entry, index) => {
      const values: (string | number | Date | null)[] = [
        index + 1,
        entry.name,
        entry.matricule,
        entry.gender,
        entry.nr,
      ];
      for (const subject of subjects) {
        const note = savedNote(entry.saved, subject.subjectId, subject.label);
        values.push(
          '',
          note?.i1 ?? null,
          note?.i2 ?? null,
          note?.devoir ?? null,
          note?.compo ?? null,
          subject.coefficient,
          subject.teacherName,
        );
      }
      // Informations de la classe : lues par l'import sur la premiere ligne
      // d'eleve uniquement (vides sur les suivantes).
      values.push(
        ...(index === 0
          ? [
              level.label,
              session.meta?.titulaire ?? '',
              session.meta?.chefEtablissement || chefEtablissementNom,
              year.label,
              session.meta?.dateDuConseil
                ? middayUtc(new Date(session.meta.dateDuConseil))
                : null,
            ]
          : ['', '', '', '', null]),
        entry.saved?.retards ?? null,
        entry.saved?.absences ?? null,
        entry.saved?.exclusion ?? '',
        entry.saved?.decisionConseil ?? '',
      );
      sheet.addRow(values);
    });
    const entryCount = entries.length;

    // Mise en forme : en-tete lisible, un bloc de couleur par matiere,
    // colonnes de notes limitees a 0-20 avec message d'erreur explicite.
    const BLOCK_FILLS = ['FFE8F3EF', 'FFF3EFE8'];
    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFB8BEC6' } },
      bottom: { style: 'thin', color: { argb: 'FFB8BEC6' } },
      left: { style: 'thin', color: { argb: 'FFB8BEC6' } },
      right: { style: 'thin', color: { argb: 'FFB8BEC6' } },
    };
    const headerRow = sheet.getRow(1);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      };
      cell.border = border;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDDE3EA' },
      };
    });
    [6, 32, 16, 7, 6].forEach((width, i) => {
      sheet.getColumn(i + 1).width = width;
    });

    const lastRow = entryCount + 1;
    subjects.forEach((subject, s) => {
      const start = 6 + s * 7;
      const fill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: BLOCK_FILLS[s % BLOCK_FILLS.length] },
      };
      sheet.getColumn(start).width = Math.min(
        28,
        Math.max(14, subject.label.length + 2),
      );
      [1, 2, 3, 4].forEach((offset) => {
        sheet.getColumn(start + offset).width = 8;
      });
      sheet.getColumn(start + 5).width = 6;
      sheet.getColumn(start + 6).width = 18;
      for (let col = start; col < start + 7; col += 1) {
        headerRow.getCell(col).fill = fill;
      }
      for (let row = 2; row <= lastRow; row += 1) {
        sheet.getCell(row, start).fill = fill;
        for (let offset = 1; offset <= 4; offset += 1) {
          const cell = sheet.getCell(row, start + offset);
          cell.border = border;
          cell.alignment = { horizontal: 'center' };
          cell.dataValidation = {
            type: 'decimal',
            operator: 'between',
            allowBlank: true,
            formulae: [0, 20],
            showErrorMessage: true,
            errorTitle: 'Note invalide',
            error:
              'Saisissez une note entre 0 et 20 (laisser vide si absente).',
          };
        }
      }
    });
    for (let col = metaStart; col < metaStart + 5; col += 1) {
      sheet.getColumn(col).width = 18;
    }
    // Discipline (pre-remplie si deja saisie) : retards / absences entiers >= 0.
    const disciplineStart = metaStart + 5;
    [10, 10, 18, 24].forEach((width, offset) => {
      sheet.getColumn(disciplineStart + offset).width = width;
    });
    for (let row = 2; row <= lastRow; row += 1) {
      for (const offset of [0, 1]) {
        sheet.getCell(row, disciplineStart + offset).dataValidation = {
          type: 'whole',
          operator: 'greaterThanOrEqual',
          allowBlank: true,
          formulae: [0],
          showErrorMessage: true,
          errorTitle: 'Valeur invalide',
          error: 'Saisissez un nombre entier (0 ou plus).',
        };
      }
    }
    sheet.getCell(2, metaStart + 4).numFmt = 'dd/mm/yyyy';

    // Feuille "Exemple" entierement remplie (eleves fictifs) pour montrer
    // le resultat attendu. Volontairement separee de "Notes" : des notes
    // d'exemple melangees aux vrais eleves finiraient sur de vrais
    // bulletins si on oubliait de les effacer. L'import ne lit que la
    // premiere feuille ("Notes"), celle-ci n'est donc jamais importee.
    const example = workbook.addWorksheet('Exemple', {
      properties: { tabColor: { argb: 'FFDB6C3F' } },
      views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    });
    const banner = example.getCell(1, 1);
    banner.value =
      'EXEMPLE (élèves fictifs) — cette feuille n’est pas importée. Saisissez vos notes dans la feuille « Notes ».';
    banner.font = { bold: true, color: { argb: 'FF9A3412' } };
    example.addRow(header);
    const exampleStudents = [
      { name: 'KOUASSI Aya', matricule: 'EX-0001', gender: 'F', nr: 'N' },
      { name: 'MENSAH Kodjo', matricule: 'EX-0002', gender: 'M', nr: 'N' },
      { name: 'DIALLO Fatou', matricule: 'EX-0003', gender: 'F', nr: 'R' },
      { name: 'TRAORE Ibrahim', matricule: 'EX-0004', gender: 'M', nr: 'N' },
    ];
    // Notes plausibles et reproductibles (pas de hasard) ; une case vide
    // montre qu'une note absente est simplement ignoree.
    const sampleNote = (
      studentIndex: number,
      subjectIndex: number,
      k: number,
    ) =>
      8 + ((studentIndex * 5 + subjectIndex * 3 + k * 4) % 12) + (k % 2) * 0.5;
    exampleStudents.forEach((student, i) => {
      const values: (string | number | Date | null)[] = [
        i + 1,
        student.name,
        student.matricule,
        student.gender,
        student.nr,
      ];
      subjects.forEach((subject, s) => {
        const notes = [0, 1, 2, 3].map((k) =>
          i === 2 && s === 0 && k === 1 ? null : sampleNote(i, s, k),
        );
        values.push('', ...notes, subject.coefficient, subject.teacherName);
      });
      if (i === 0) {
        values.push(
          level.label,
          'M. le Titulaire',
          chefEtablissementNom || "M. le Chef d'établissement",
          year.label,
          new Date(),
        );
      }
      example.addRow(values);
    });
    const exampleHeader = example.getRow(2);
    exampleHeader.height = 30;
    exampleHeader.eachCell((cell, col) => {
      cell.font = { bold: true };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      };
      cell.border = border;
      cell.fill = headerRow.getCell(col).fill;
    });
    for (let col = 1; col <= header.length; col += 1) {
      example.getColumn(col).width = sheet.getColumn(col).width;
    }
    example.getCell(3, metaStart + 4).numFmt = 'dd/mm/yyyy';

    // Detail du calcul pour le premier eleve et la premiere matiere.
    if (subjects.length > 0) {
      const notes = [0, 1, 2, 3].map((k) => sampleNote(0, 0, k));
      const round2 = (value: number) => Math.round(value * 100) / 100;
      const moyClasse = round2((notes[0] + notes[1] + notes[2]) / 3);
      const moyPeriode = round2((moyClasse + notes[3]) / 2);
      const explanationRow = exampleStudents.length + 4;
      [
        `Calcul pour KOUASSI Aya en ${subjects[0].label} :`,
        `• Moyenne de classe = (I1 ${notes[0]} + I2 ${notes[1]} + Devoir ${notes[2]}) ÷ 3 = ${moyClasse}`,
        `• Moyenne de la période = (moyenne de classe ${moyClasse} + Compo ${notes[3]}) ÷ 2 = ${moyPeriode}`,
        `• Note pondérée = ${moyPeriode} × coefficient ${subjects[0].coefficient} = ${round2(moyPeriode * subjects[0].coefficient)}`,
        'DIALLO Fatou n’a pas de note I2 : la moyenne de classe est alors calculée sur I1 et Devoir uniquement.',
      ].forEach((line, i) => {
        const cell = example.getCell(explanationRow + i, 2);
        cell.value = line;
        if (i === 0) {
          cell.font = { bold: true };
        }
      });
    }

    // Mode d'emploi en derniere feuille : l'import ne lit que la premiere.
    const help = workbook.addWorksheet("Mode d'emploi");
    help.getColumn(1).width = 110;
    [
      `Modèle d'import des bulletins — ${level.label} — ${PERIODE_LABELS[session.periode]} (${year.label})`,
      '',
      'Un exemple entièrement rempli (élèves fictifs) figure dans la feuille « Exemple ». Les notes peuvent aussi être saisies directement dans l’application (bouton « Saisir les notes » de la session).',
      '',
      '1. Saisissez les notes (de 0 à 20) dans les colonnes I1, I2, Devoir et Compo de chaque matière, feuille « Notes ». Les notes déjà enregistrées dans l’application (saisies à l’écran ou importées) sont déjà remplies : complétez seulement les cases vides.',
      '2. Laissez une case vide si la note n’existe pas : elle est simplement ignorée dans le calcul.',
      '3. Ne modifiez pas la ligne d’en-tête ni l’ordre des colonnes : l’import s’appuie dessus.',
      '4. Les colonnes Coef et Prof sont indicatives : les coefficients utilisés sont ceux de l’écran « Matières ».',
      '5. Renseignez si besoin le titulaire et la date du conseil sur la première ligne d’élève, ainsi que les retards, absences, exclusions et décisions du conseil de chaque élève (colonnes de droite, déjà remplies si connues).',
      '6. Enregistrez puis importez ce fichier depuis la session de bulletins, bouton « Importer », en mode « Fusionner » (proposé par défaut) pour compléter sans rien effacer.',
      '',
      'Calculs effectués à la validation : moyenne de classe = moyenne(I1, I2, Devoir) ; moyenne de la période = moyenne(moyenne de classe, Compo) ; note pondérée = moyenne de la période × coefficient.',
    ].forEach((line, i) => {
      const cell = help.getCell(i + 1, 1);
      cell.value = line;
      cell.alignment = { wrapText: true, vertical: 'top' };
      if (i === 0) {
        cell.font = { bold: true, size: 13 };
      }
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const safe = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_');
    return {
      buffer,
      fileName: `modele-notes-${safe(level.label)}-${safe(PERIODE_LABELS[session.periode])}.xlsx`,
    };
  }

  async listClassSubjects(schoolYearId: string, levelId: string) {
    return this.classSubjectModel
      .find({ schoolYearId, levelId })
      .populate('subjectId')
      .sort({ displayOrder: 1 })
      .lean()
      .exec();
  }

  // Deliberately overwrites an existing coefficient/teacher (unlike
  // approveSubject's $setOnInsert, which never touches an already-approved
  // subject) - this screen exists precisely so an admin can adjust a
  // previously-set value.
  async upsertClassSubject(dto: UpsertClassSubjectDto) {
    return this.classSubjectModel
      .findOneAndUpdate(
        {
          schoolYearId: dto.schoolYearId,
          levelId: dto.levelId,
          subjectId: dto.subjectId,
        },
        { coefficient: dto.coefficient, teacherName: dto.teacherName },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  // Number of classes using each subject in a school year, to show on the
  // catalog how widely a matiere is configured.
  async countClassSubjectsBySubject(
    schoolYearId: string,
  ): Promise<Record<string, number>> {
    const classSubjects = await this.classSubjectModel
      .find({ schoolYearId })
      .select('subjectId')
      .lean()
      .exec();
    const counts: Record<string, number> = {};
    for (const cs of classSubjects) {
      const key = String(cs.subjectId);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  // Removing a matiere from a class is only allowed while no notes reference
  // it in that class's sessions: otherwise the bulletins already entered
  // would silently lose a subject. Changing the coefficient stays possible.
  async removeClassSubject(classSubjectId: string) {
    const classSubject = await this.classSubjectModel
      .findById(classSubjectId)
      .lean()
      .exec();
    if (!classSubject) {
      throw new NotFoundException('Matière de classe introuvable');
    }
    const sessionIds = await this.sessionModel
      .find({
        schoolYearId: classSubject.schoolYearId,
        levelId: classSubject.levelId,
      })
      .distinct('_id')
      .exec();
    const used =
      sessionIds.length > 0
        ? await this.rowModel
            .exists({
              sessionId: { $in: sessionIds },
              // Notes are plain objects: the id may be a string or an ObjectId.
              'notes.subjectId': {
                $in: [
                  String(classSubject.subjectId),
                  new Types.ObjectId(String(classSubject.subjectId)),
                ],
              },
            })
            .exec()
        : null;
    if (used) {
      throw new BadRequestException(
        'Des notes ont déjà été saisies pour cette matière dans cette classe : elle ne peut plus être retirée. Vous pouvez toujours modifier son coefficient.',
      );
    }
    await this.classSubjectModel.deleteOne({ _id: classSubjectId }).exec();
    return classSubject;
  }

  async validateSession(sessionId: string, actorId: string) {
    return runWithMongoTransactionFallback(
      this.connection,
      async (dbSession) => {
        const session = await this.sessionModel
          .findById(sessionId)
          .session(dbSession ?? null)
          .exec();
        if (!session) {
          throw new NotFoundException('Session introuvable');
        }
        if (session.status === BulletinSessionStatus.VALIDATED) {
          throw new BadRequestException('Cette session est déjà validée');
        }

        const roster = await this.enrollmentModel
          .find({
            schoolYearId: session.schoolYearId,
            levelId: session.levelId,
            status: EnrollmentStatus.ACTIVE,
          })
          .session(dbSession ?? null)
          .lean()
          .exec();
        const rosterStudentIds = new Set(
          roster.map((e) => String(e.studentId)),
        );
        // Full enrollment doc (not just its id) - .type is needed below to
        // derive statutNR (Nouveau/Redoublant).
        const enrollmentByStudentId = new Map(
          roster.map((e) => [String(e.studentId), e]),
        );

        const rows = await this.rowModel
          .find({ sessionId })
          .session(dbSession ?? null)
          .lean()
          .exec();
        const unresolved = rows.filter(
          (r) => r.matchStatus !== ImportRowMatchStatus.MATCHED || !r.studentId,
        );
        if (unresolved.length > 0) {
          throw new BadRequestException(
            `${unresolved.length} ligne(s) non resolue(s) - la validation est impossible`,
          );
        }
        const hasUnapprovedSubject = rows.some((r) =>
          r.notes.some((n) => !n.subjectId),
        );
        if (hasUnapprovedSubject) {
          throw new BadRequestException(
            'Des matières ne sont pas encore approuvées',
          );
        }
        const matchedStudentIds = new Set(rows.map((r) => String(r.studentId)));
        const missing = [...rosterStudentIds].filter(
          (id) => !matchedStudentIds.has(id),
        );
        if (missing.length > 0) {
          // Nommer les eleves concernes et dire quoi faire, plutot qu'un
          // simple nombre : un eleve inscrit sans aucune note serait sinon
          // oublie du bulletin et du classement.
          const snapshotName = (id: string) => {
            const snapshot = enrollmentByStudentId.get(id)?.studentSnapshot as
              | { lastname?: string; firstname?: string }
              | undefined;
            return snapshot?.lastname
              ? `${snapshot.lastname} ${snapshot.firstname ?? ''}`.trim()
              : null;
          };
          const withoutSnapshot = missing.filter((id) => !snapshotName(id));
          const fetched = withoutSnapshot.length
            ? await this.studentModel
                .find({ _id: { $in: withoutSnapshot } })
                .session(dbSession ?? null)
                .lean()
                .exec()
            : [];
          const fetchedName = new Map(
            fetched.map((s) => [
              String(s._id),
              `${s.lastname} ${s.firstname ?? ''}`.trim(),
            ]),
          );
          const names = missing.map(
            (id) => snapshotName(id) ?? fetchedName.get(id) ?? 'élève inconnu',
          );
          const shown = names.slice(0, 10).join(', ');
          const more =
            names.length > 10 ? ` (et ${names.length - 10} autre(s))` : '';
          throw new BadRequestException(
            `${missing.length} élève(s) inscrit(s) dans la classe n'ont aucune note : ${shown}${more}. ` +
              'Saisissez leurs notes avec « Saisir les notes », ou téléchargez le modèle Excel (ils y figurent) et réimportez-le en mode « Fusionner ».',
          );
        }

        // Notes hors [0,20] et eleves sans aucune note du tout (cf cahier
        // des charges bulletin: "les notes doivent etre comprises entre 0
        // et 20 inclus") - verifie avant toute ecriture, comme les controles
        // ci-dessus.
        const validationErrors: string[] = [];
        for (const row of rows) {
          let hasAnyGrade = false;
          for (const note of row.notes) {
            for (const [label, value] of [
              ['i1', note.i1],
              ['i2', note.i2],
              ['devoir', note.devoir],
              ['compo', note.compo],
            ] as const) {
              if (value !== null) {
                hasAnyGrade = true;
                if (value < 0 || value > 20) {
                  validationErrors.push(
                    `${row.rawIdentity.nameRaw} - ${note.subjectNameRaw} (${label}) : note hors bornes [0,20] (${value})`,
                  );
                }
              }
            }
          }
          if (!hasAnyGrade) {
            validationErrors.push(
              `${row.rawIdentity.nameRaw} : aucune note renseignée pour cette période`,
            );
          }
        }
        if (validationErrors.length > 0) {
          throw new BadRequestException(
            `Validation impossible : ${validationErrors.length} erreur(s). ${validationErrors.join(' | ')}`,
          );
        }

        const classSubjects = await this.classSubjectModel
          .find({
            schoolYearId: session.schoolYearId,
            levelId: session.levelId,
          })
          .session(dbSession ?? null)
          .lean()
          .exec();
        const classSubjectBySubjectId = new Map(
          classSubjects.map((cs) => [String(cs.subjectId), cs]),
        );
        const subjects = await this.subjectModel
          .find({ _id: { $in: classSubjects.map((cs) => cs.subjectId) } })
          .session(dbSession ?? null)
          .lean()
          .exec();
        const subjectById = new Map(subjects.map((s) => [String(s._id), s]));

        type SubjectComputed = {
          subjectId: string;
          category: SubjectCategory;
          i1: number | null;
          i2: number | null;
          devoir: number | null;
          compo: number | null;
          coefficient: number;
          teacherName?: string;
          moyenneClasse: number | null;
          moyennePeriode: number | null;
          moyenneDefinitive: number | null;
        };

        // Pass 1: per-subject averages for every student, in memory - needed
        // before any per-subject rank can be computed (a rank depends on
        // every other student's grade in that same subject).
        const perStudentSubjects = new Map<string, SubjectComputed[]>();
        for (const row of rows) {
          const computed: SubjectComputed[] = [];
          for (const note of row.notes) {
            const classSubject = classSubjectBySubjectId.get(
              String(note.subjectId),
            );
            if (!classSubject) {
              continue;
            }
            const subject = subjectById.get(String(note.subjectId));
            const averages = computeSubjectAverages({
              i1: note.i1,
              i2: note.i2,
              devoir: note.devoir,
              compo: note.compo,
              coefficient: classSubject.coefficient,
            });
            computed.push({
              subjectId: String(note.subjectId),
              category: subject?.category ?? SubjectCategory.AUTRE,
              i1: note.i1,
              i2: note.i2,
              devoir: note.devoir,
              compo: note.compo,
              coefficient: classSubject.coefficient,
              teacherName: classSubject.teacherName,
              ...averages,
            });
          }
          perStudentSubjects.set(String(row.studentId), computed);
        }

        // Pass 2: rank every student on their Moy. Periode, one ranking per
        // subject across the whole class.
        const subjectIds = [...subjectById.keys()];
        const subjectRanks = new Map<string, Map<string, string | null>>();
        for (const subjectId of subjectIds) {
          const items = rows.map((row) => {
            const studentId = String(row.studentId);
            const subjectResult = perStudentSubjects
              .get(studentId)
              ?.find((s) => s.subjectId === subjectId);
            return {
              studentId,
              value: subjectResult?.moyennePeriode ?? null,
              gender: row.rawIdentity.sexeRaw,
            };
          });
          subjectRanks.set(
            subjectId,
            rankBy(
              items,
              (i) => i.studentId,
              (i) => i.value,
              (i) => i.gender,
            ),
          );
        }

        // Pass 3: per-student group averages (litteraire/scientifique/autre)
        // and period totals (Total points/coef, MGP).
        type StudentSummary = {
          moyenneLitteraire: number | null;
          moyenneScientifique: number | null;
          moyenneAutres: number | null;
          totalPoints: number;
          totalCoef: number;
          moyenneGenerale: number;
        };
        const studentSummaries = new Map<string, StudentSummary>();
        for (const row of rows) {
          const studentId = String(row.studentId);
          const subjectsForStudent = perStudentSubjects.get(studentId) ?? [];
          const moyenneLitteraire = computeGroupAverage(
            subjectsForStudent,
            SubjectCategory.LITTERAIRE,
          );
          const moyenneScientifique = computeGroupAverage(
            subjectsForStudent,
            SubjectCategory.SCIENTIFIQUE,
          );
          const moyenneAutres = computeGroupAverage(
            subjectsForStudent,
            SubjectCategory.AUTRE,
          );
          const totals = computeStudentPeriodTotals(subjectsForStudent);
          studentSummaries.set(studentId, {
            moyenneLitteraire,
            moyenneScientifique,
            moyenneAutres,
            ...totals,
          });
        }

        const rankGroup = (getValue: (s: StudentSummary) => number | null) =>
          rankBy(
            rows,
            (row) => String(row.studentId),
            (row) =>
              getValue(studentSummaries.get(String(row.studentId))!) ?? null,
            (row) => row.rawIdentity.sexeRaw,
          );
        const litteraireRanks = rankGroup((s) => s.moyenneLitteraire);
        const scientifiqueRanks = rankGroup((s) => s.moyenneScientifique);
        const autresRanks = rankGroup((s) => s.moyenneAutres);
        const mgpRanks = rankGroup((s) => s.moyenneGenerale);

        const mgpValues = [...studentSummaries.values()].map(
          (s) => s.moyenneGenerale,
        );
        const classStats = {
          moyenneMin: Math.min(...mgpValues),
          moyenneMax: Math.max(...mgpValues),
          moyenneClasse: averageOfPresent(mgpValues) as number,
        };

        // Pass 4: cumulative annual average - the mean of this student's MGP
        // across every already-validated period of the same school year
        // (earlier periods of the same cycle), including the current one.
        const level = await this.levelModel
          .findById(session.levelId)
          .session(dbSession ?? null)
          .lean()
          .exec();
        const periodesInCycle = level?.cycle
          ? PERIODES_BY_CYCLE[level.cycle]
          : [];
        const currentIndex = periodesInCycle.indexOf(session.periode);
        const priorPeriodes =
          currentIndex > 0 ? periodesInCycle.slice(0, currentIndex) : [];
        const priorResultsByStudent = new Map<string, number[]>();
        if (priorPeriodes.length > 0) {
          const priorResults = await this.bulletinResultModel
            .find({
              studentId: { $in: rows.map((r) => r.studentId) },
              schoolYearId: session.schoolYearId,
              periode: { $in: priorPeriodes },
            })
            .session(dbSession ?? null)
            .lean()
            .exec();
          for (const priorResult of priorResults) {
            const key = String(priorResult.studentId);
            const list = priorResultsByStudent.get(key) ?? [];
            list.push(priorResult.moyenneGenerale);
            priorResultsByStudent.set(key, list);
          }
        }
        const annualValues = new Map<string, number | null>();
        for (const row of rows) {
          const studentId = String(row.studentId);
          const priorMgps = priorResultsByStudent.get(studentId) ?? [];
          const currentMgp = studentSummaries.get(studentId)!.moyenneGenerale;
          annualValues.set(
            studentId,
            averageOfPresent([...priorMgps, currentMgp]),
          );
        }
        const annualRanks = rankBy(
          rows,
          (row) => String(row.studentId),
          (row) => annualValues.get(String(row.studentId)) ?? null,
          (row) => row.rawIdentity.sexeRaw,
        );

        // Write phase: Note (per subject) then BulletinResult (per student).
        for (const row of rows) {
          const studentId = String(row.studentId);
          const enrollment = enrollmentByStudentId.get(studentId);
          const enrollmentId = enrollment ? String(enrollment._id) : undefined;
          const subjectsForStudent = perStudentSubjects.get(studentId) ?? [];

          for (const s of subjectsForStudent) {
            const rank = subjectRanks.get(s.subjectId)?.get(studentId) ?? null;
            await this.noteModel
              .findOneAndUpdate(
                {
                  studentId: row.studentId,
                  subjectId: s.subjectId,
                  periode: session.periode,
                  schoolYearId: session.schoolYearId,
                },
                {
                  enrollmentId,
                  levelId: session.levelId,
                  i1: s.i1,
                  i2: s.i2,
                  devoir: s.devoir,
                  compo: s.compo,
                  coefficient: s.coefficient,
                  teacherName: s.teacherName,
                  moyenneClasse: s.moyenneClasse,
                  moyennePeriode: s.moyennePeriode,
                  moyenneDefinitive: s.moyenneDefinitive,
                  rang: rank,
                  appreciation:
                    s.moyennePeriode !== null
                      ? appreciationFor(s.moyennePeriode, 'matiere')
                      : null,
                },
                {
                  upsert: true,
                  session: dbSession,
                  setDefaultsOnInsert: true,
                  runValidators: true,
                },
              )
              .exec();
          }

          const summary = studentSummaries.get(studentId)!;
          const statutNR =
            enrollment?.type === EnrollmentType.REPEAT ? 'R' : 'N';
          await this.bulletinResultModel
            .findOneAndUpdate(
              {
                studentId: row.studentId,
                periode: session.periode,
                schoolYearId: session.schoolYearId,
              },
              {
                enrollmentId,
                levelId: session.levelId,
                statutNR,
                moyenneLitteraire: summary.moyenneLitteraire,
                rangLitteraire: litteraireRanks.get(studentId) ?? null,
                moyenneScientifique: summary.moyenneScientifique,
                rangScientifique: scientifiqueRanks.get(studentId) ?? null,
                moyenneAutres: summary.moyenneAutres,
                rangAutres: autresRanks.get(studentId) ?? null,
                totalPoints: summary.totalPoints,
                totalCoef: summary.totalCoef,
                moyenneGenerale: summary.moyenneGenerale,
                rangGeneral: mgpRanks.get(studentId) ?? null,
                appreciationGenerale: appreciationFor(
                  summary.moyenneGenerale,
                  'generale',
                ),
                moyenneAnnuelle: annualValues.get(studentId) ?? null,
                rangAnnuel: annualRanks.get(studentId) ?? null,
                retards: row.retards ?? null,
                absences: row.absences ?? null,
                exclusion: row.exclusion,
                decisionConseil: row.decisionConseil,
              },
              {
                upsert: true,
                session: dbSession,
                setDefaultsOnInsert: true,
                runValidators: true,
              },
            )
            .exec();
        }

        session.status = BulletinSessionStatus.VALIDATED;
        session.classStats = classStats;
        await session.save({ session: dbSession });

        await this.auditService.log(
          {
            schoolYearId: String(session.schoolYearId),
            actorId,
            action: AuditAction.BULLETIN_SESSION_VALIDATED,
            entityType: 'BulletinSession',
            entityId: String(session._id),
            details: {
              levelId: String(session.levelId),
              periode: session.periode,
              studentCount: rows.length,
            },
          },
          dbSession,
        );

        return session;
      },
    );
  }

  // Same multi-candidate resolution strategy as main.ts's
  // resolveExistingPath(), needed because __dirname points at different
  // places depending on how the app is run (ts-node dev, compiled dist/,
  // or a pkg-packaged exe's virtual snapshot filesystem).
  private resolveBulletinAssetPath(fileName: string): string | null {
    const candidates = [
      path.join(__dirname, '..', 'public', 'bulletin', fileName),
      path.join(process.cwd(), 'dist', 'public', 'bulletin', fileName),
      path.join(process.cwd(), 'public', 'bulletin', fileName),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  private formatBulletinNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }
    return value.toFixed(2).replace('.', ',');
  }

  private formatBulletinDate(date: unknown): string {
    if (!date) {
      return '-';
    }
    const parsed = new Date(date as string | number | Date);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }
    return `${String(parsed.getDate()).padStart(2, '0')}/${String(
      parsed.getMonth() + 1,
    ).padStart(2, '0')}/${parsed.getFullYear()}`;
  }

  // Assembles everything renderBulletinPage() needs to draw one student's
  // bulletin - shared by the single-student and whole-class PDF endpoints
  // so both always show identical data.
  private async buildBulletinPageData(sessionId: string, studentId: string) {
    // Deliberately not populated: session.schoolYearId/levelId are needed
    // below as plain ids for query filters (getRoster, BulletinResult
    // lookups) - populating them here would replace the ids with the
    // referenced documents and silently break every one of those queries.
    // Level/SchoolYear are fetched separately, purely for display.
    const session = await this.sessionModel.findById(sessionId).lean().exec();
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status !== BulletinSessionStatus.VALIDATED) {
      throw new BadRequestException(
        'Le bulletin ne peut être généré qu’après validation de la session',
      );
    }

    const student = await this.studentModel.findById(studentId).lean().exec();
    if (!student) {
      throw new NotFoundException('Élève introuvable');
    }

    const schoolYearId = String(session.schoolYearId);
    const levelId = String(session.levelId);
    const [level, schoolYear] = await Promise.all([
      this.levelModel.findById(levelId).lean().exec(),
      this.schoolYearModel.findById(schoolYearId).lean().exec(),
    ]);

    const result = await this.bulletinResultModel
      .findOne({
        studentId,
        periode: session.periode,
        schoolYearId,
      })
      .lean()
      .exec();
    if (!result) {
      throw new NotFoundException(
        'Bulletin non trouvé pour cet élève sur cette période',
      );
    }

    const notes = await this.noteModel
      .find({
        studentId,
        periode: session.periode,
        schoolYearId,
      })
      .populate('subjectId')
      .lean()
      .exec();

    const roster = await this.getRoster(schoolYearId, levelId);

    const periodesInCycle = level?.cycle ? PERIODES_BY_CYCLE[level.cycle] : [];
    const currentIndex = periodesInCycle.indexOf(session.periode);
    const priorPeriodes =
      currentIndex > 0 ? periodesInCycle.slice(0, currentIndex) : [];
    const priorResults =
      priorPeriodes.length > 0
        ? await this.bulletinResultModel
            .find({
              studentId,
              schoolYearId,
              periode: { $in: priorPeriodes },
            })
            .lean()
            .exec()
        : [];
    const priorByPeriode = new Map(
      priorResults.map((r) => [r.periode, r.moyenneGenerale]),
    );

    const [schoolName, ecole] = await Promise.all([
      this.ecolesService.getCurrentSchoolName(),
      this.ecolesService.getCurrentEcole(),
    ]);
    const logoPath = this.ecolesService.resolveLogoAbsolutePath(ecole);

    return {
      periodeLabel: PERIODE_LABELS[session.periode],
      schoolYearLabel: schoolYear?.label ?? '-',
      levelLabel: level?.label ?? '-',
      effectif: roster.length,
      schoolName,
      ecole,
      logoPath,
      titulaire: session.meta?.titulaire ?? '-',
      chefEtablissement: session.meta?.chefEtablissement ?? '-',
      dateDuConseil: session.meta?.dateDuConseil ?? null,
      student: {
        lastname: student.lastname,
        firstname: student.firstname,
        matricule: student.matricule,
        gender: student.gender,
      },
      statutNR: result.statutNR,
      subjects: notes
        .map((note) => {
          const subject = note.subjectId as unknown as {
            label: string;
            category: SubjectCategory;
          };
          return {
            category: subject?.category ?? SubjectCategory.AUTRE,
            label: subject?.label ?? '-',
            i1: note.i1,
            i2: note.i2,
            devoir: note.devoir,
            moyenneClasse: note.moyenneClasse,
            compo: note.compo,
            moyennePeriode: note.moyennePeriode,
            coefficient: note.coefficient,
            moyenneDefinitive: note.moyenneDefinitive,
            rang: note.rang,
            appreciation: note.appreciation,
            teacherName: note.teacherName ?? '-',
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
      groupSummaries: {
        [SubjectCategory.LITTERAIRE]: {
          moyenne: result.moyenneLitteraire,
          rang: result.rangLitteraire,
        },
        [SubjectCategory.SCIENTIFIQUE]: {
          moyenne: result.moyenneScientifique,
          rang: result.rangScientifique,
        },
        [SubjectCategory.AUTRE]: {
          moyenne: result.moyenneAutres,
          rang: result.rangAutres,
        },
      },
      totalPoints: result.totalPoints,
      totalCoef: result.totalCoef,
      moyenneGenerale: result.moyenneGenerale,
      rangGeneral: result.rangGeneral,
      appreciationGenerale: result.appreciationGenerale,
      classStats: session.classStats,
      priorPeriodeAverages: priorPeriodes.map((p) => ({
        label: PERIODE_LABELS[p],
        shortLabel: this.periodeShortLabel(p),
        value: priorByPeriode.get(p) ?? null,
      })),
      moyenneAnnuelle: result.moyenneAnnuelle,
      rangAnnuel: result.rangAnnuel,
      retards: result.retards,
      absences: result.absences,
      exclusion: result.exclusion,
      decisionConseil: result.decisionConseil,
    };
  }

  private readonly SUBJECT_CATEGORY_LABELS: Record<SubjectCategory, string> = {
    [SubjectCategory.LITTERAIRE]: 'Matières littéraires',
    [SubjectCategory.SCIENTIFIQUE]: 'Matières scientifiques',
    [SubjectCategory.AUTRE]: 'Autres matières',
  };

  // Short column label for the bottom summary box ("Moy. Trim1", "Moy. Sem1"
  // ...) - derived from the Periode enum value itself rather than
  // PERIODE_LABELS ("1er Trimestre"), which is too long for that box.
  private periodeShortLabel(periode: Periode): string {
    const match = /^(trimestre|semestre)_(\d)$/.exec(periode);
    if (!match) {
      return periode;
    }
    return `${match[1] === 'trimestre' ? 'Trim' : 'Sem'}${match[2]}`;
  }

  // A small unchecked/checked square with its label to its left, matching
  // the printed checkboxes on the source template (Sexe, Statut, Exclusion,
  // mentions). Returns the x just past the box, for chaining several
  // checkboxes on the same line.
  private drawCheckbox(
    doc: InstanceType<typeof PDFDocument>,
    x: number,
    y: number,
    label: string,
    checked: boolean,
    fontSize = 7,
  ): number {
    const boxSize = fontSize;
    doc.font('Helvetica').fontSize(fontSize);
    let boxX = x;
    if (label) {
      doc.text(label, x, y, { continued: false, lineBreak: false });
      boxX = x + doc.widthOfString(label) + 3;
    }
    doc.rect(boxX, y - 1, boxSize, boxSize).stroke('#000000');
    if (checked) {
      doc
        .moveTo(boxX, y - 1)
        .lineTo(boxX + boxSize, y - 1 + boxSize)
        .stroke('#000000');
      doc
        .moveTo(boxX + boxSize, y - 1)
        .lineTo(boxX, y - 1 + boxSize)
        .stroke('#000000');
    }
    return boxX + boxSize;
  }

  // Draws a left-to-right run of text segments, each in its own font, as a
  // single logical line - lets a label/value pair mix regular and bold
  // weight ("Classe : " regular, "1ereD" bold) while still supporting
  // center alignment, which PDFKit's own {continued:true} text chaining
  // cannot do (it has no notion of the combined run's total width upfront).
  private drawMixedText(
    doc: InstanceType<typeof PDFDocument>,
    runs: Array<{ text: string; font: string }>,
    x: number,
    y: number,
    width: number,
    fontSize: number,
    align: 'left' | 'center' = 'left',
  ): void {
    doc.fontSize(fontSize);
    let totalWidth = 0;
    for (const r of runs) {
      doc.font(r.font);
      totalWidth += doc.widthOfString(r.text);
    }
    let cx = align === 'center' ? x + (width - totalWidth) / 2 : x;
    for (const r of runs) {
      doc.font(r.font);
      doc.text(r.text, cx, y, { lineBreak: false });
      cx += doc.widthOfString(r.text);
    }
  }

  // A large "{" glyph approximating the curly brace grouping "Trav."/"Disc."
  // under "Avert."/"Blames" on the source template - PDFKit has no native
  // brace-drawing primitive, and the built-in "{" character scaled up is a
  // close enough visual match for a printed form.
  private drawBrace(
    doc: InstanceType<typeof PDFDocument>,
    x: number,
    rowTopY: number,
    rowHeight: number,
  ): void {
    const size = rowHeight * 2.6;
    doc.font('Helvetica').fontSize(size);
    doc.text('{', x, rowTopY - rowHeight * 0.55, { lineBreak: false });
  }

  // Draws one full bulletin page onto doc's current page (caller is
  // responsible for doc.addPage() between students in a batch run). Layout
  // follows the exact model provided by the client (portrait A4) - see
  // "Cahier charge bulletin.docx" at the project root.
  private renderBulletinPage(
    doc: InstanceType<typeof PDFDocument>,
    data: Awaited<ReturnType<BulletinsService['buildBulletinPageData']>>,
  ): void {
    const fmt = (v: number | null | undefined) => this.formatBulletinNumber(v);
    const startX = doc.page.margins.left;
    const usableWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const topY = doc.page.margins.top;

    // Ecole logo watermark, centered on the full page behind everything
    // else - very faint (6%, fainter than the student ID card's since it
    // sits behind a dense table of numbers here) so it never interferes
    // with legibility. Re-drawn on every page this bulletin spans (the
    // table can overflow onto extra pages - see the addPage() call sites
    // below), skipped entirely when the ecole has no logo.
    // The ecole's chosen color (Ecole.couleurBulletin) is what actually
    // identifies it at a glance across every bulletin - painted as a very
    // faint full-page wash (8% opacity) so it reads as "this school's
    // paper color" without ever competing with the black text on top of
    // it. No contrast-color logic is needed here (unlike the ID card's
    // solid header band) precisely because the tint stays this light.
    const bulletinTint = (data.ecole as { couleurBulletin?: string } | null)
      ?.couleurBulletin;
    const drawWatermark = () => {
      if (bulletinTint) {
        try {
          doc.save();
          doc.opacity(0.08);
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(bulletinTint);
          doc.restore();
        } catch {
          // Invalid stored color (shouldn't happen, form validates it) -
          // page still renders without the tint.
        }
      }
      if (!data.logoPath) {
        return;
      }
      try {
        const size = Math.min(doc.page.width, doc.page.height) * 0.42;
        doc.save();
        doc.opacity(0.06);
        doc.image(
          data.logoPath,
          (doc.page.width - size) / 2,
          (doc.page.height - size) / 2,
          { fit: [size, size], align: 'center', valign: 'center' },
        );
        doc.restore();
      } catch {
        // Missing/unreadable asset - page still renders without the watermark.
      }
    };
    drawWatermark();

    // --- Header: ecole identity (left, centered lines) / name + logo
    // (center) / Togo emblem + republic motto + sexe/statut/matricule
    // (right, client-specific - see the "logo not embedded" note in
    // buildBulletinPageData's plan) - column layout and typography match
    // the client-provided mockup exactly (sans-serif, not the previous
    // Times family). ---
    const leftColW = 185;
    const rightColW = 155;
    const centerColW = usableWidth - leftColW - rightColW;
    const centerX = startX + leftColW;
    const rightX = startX + leftColW + centerColW;
    const leftLineH = 10.5;

    let ly = topY;
    doc.font('Helvetica-Bold').fontSize(8.5);
    doc.text('MINISTERE DE', startX, ly, { width: leftColW, align: 'center' });
    ly += leftLineH;
    doc.text("L'EDUCATION NATIONALE", startX, ly, {
      width: leftColW,
      align: 'center',
    });
    ly += leftLineH + 6;
    if (data.ecole?.dre) {
      doc.text(data.ecole.dre, startX, ly, {
        width: leftColW,
        align: 'center',
      });
      ly += leftLineH;
    }
    if (data.ecole?.inspection) {
      doc.text(data.ecole.inspection, startX, ly, {
        width: leftColW,
        align: 'center',
      });
      ly += leftLineH + 6;
    }
    doc.font('Helvetica').fontSize(8.5);
    if (data.ecole?.email) {
      doc.text(`Email : ${data.ecole.email}`, startX, ly, {
        width: leftColW,
        align: 'center',
      });
      ly += leftLineH;
    }
    if (data.ecole?.contact) {
      doc.text(`Contact : ${data.ecole.contact}`, startX, ly, {
        width: leftColW,
        align: 'center',
      });
      ly += leftLineH;
    }
    if (data.ecole?.localite) {
      doc.text(data.ecole.localite, startX, ly, {
        width: leftColW,
        align: 'center',
      });
      ly += leftLineH;
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(21)
      .text(
        (data.schoolName || "Nom de l'école").toUpperCase(),
        centerX,
        topY,
        { width: centerColW, align: 'center' },
      );
    // The school's own logo, uploaded when the ecole is created/edited (see
    // EcolesService.saveLogo) and resolved to a local file by
    // buildBulletinPageData - never fetched over the network (offline
    // deployment). Nothing is drawn at all when no logo was uploaded.
    const logoW = Math.min(centerColW - 20, 150);
    const logoH = 78;
    const logoX = centerX + (centerColW - logoW) / 2;
    const logoY = topY + 34;
    let centerColBottom = logoY;
    if (data.logoPath) {
      doc.image(data.logoPath, logoX, logoY, {
        fit: [logoW, logoH],
        align: 'center',
        valign: 'center',
      });
      centerColBottom = logoY + logoH;
    }

    const emblemPath = this.resolveBulletinAssetPath('togo-emblem.png');
    let ry = topY;
    if (emblemPath) {
      const emblemSize = 55;
      doc.image(emblemPath, rightX + (rightColW - emblemSize) / 2, ry, {
        width: emblemSize,
        height: emblemSize,
      });
      ry += emblemSize + 4;
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('REPUBLIQUE TOGOLAISE', rightX, ry, {
        width: rightColW,
        align: 'center',
      });
    ry += 11;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .text('Travail - Liberte - Patrie', rightX, ry, {
        width: rightColW,
        align: 'center',
      });
    ry += 15;

    // Sexe / Statut checkbox grid + matricule, directly under the emblem
    // block - positioned here (not next to the student's name) to match
    // the mockup exactly.
    doc.font('Helvetica-Bold').fontSize(7.5);
    doc.text('Sexe', rightX + 4, ry, { width: 60, lineBreak: false });
    doc.text('Statut', rightX + 82, ry, { width: 60, lineBreak: false });
    ry += 11;
    let cbX = rightX + 4;
    cbX =
      this.drawCheckbox(doc, cbX, ry, 'M', data.student.gender === 'M', 7.5) +
      8;
    this.drawCheckbox(doc, cbX, ry, 'F', data.student.gender === 'F', 7.5);
    cbX = rightX + 82;
    cbX = this.drawCheckbox(doc, cbX, ry, 'N', data.statutNR === 'N', 7.5) + 8;
    this.drawCheckbox(doc, cbX, ry, 'R', data.statutNR === 'R', 7.5);
    ry += 13;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .text(`N°Mle : ${data.student.matricule ?? '-'}`, rightX, ry, {
        width: rightColW,
      });
    ry += 12;

    // Header/title separator rule, matching the horizontal line under the
    // header block in the mockup.
    const headerBottom = Math.max(ly, centerColBottom + 8, ry) + 4;
    doc
      .moveTo(startX, headerBottom)
      .lineTo(startX + usableWidth, headerBottom)
      .lineWidth(1)
      .stroke('#000000');
    doc.y = headerBottom + 8;
    doc.x = startX;

    // --- Title ---
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(`BULLETIN DE NOTES DU ${data.periodeLabel.toUpperCase()}`, {
        align: 'center',
      });
    doc.moveDown(0.4);

    // --- Annee scolaire / Classe / Effectif (centered, label regular +
    // value bold), then Nom & Prenoms (left-aligned, same weight rule) ---
    this.drawMixedText(
      doc,
      [
        { text: 'Année scolaire : ', font: 'Helvetica' },
        { text: data.schoolYearLabel, font: 'Helvetica-Bold' },
        { text: '      Classe : ', font: 'Helvetica' },
        { text: data.levelLabel, font: 'Helvetica-Bold' },
        { text: '      Effectif : ', font: 'Helvetica' },
        { text: String(data.effectif), font: 'Helvetica-Bold' },
      ],
      startX,
      doc.y,
      usableWidth,
      10,
      'center',
    );
    doc.y += 15;
    doc.x = startX;

    this.drawMixedText(
      doc,
      [
        { text: 'Nom & Prénoms : ', font: 'Helvetica' },
        {
          text: `${data.student.lastname} ${data.student.firstname}`,
          font: 'Helvetica-Bold',
        },
      ],
      startX,
      doc.y,
      usableWidth,
      10,
      'left',
    );
    doc.y += 16;
    doc.x = startX;
    const tableStartY = doc.y;

    // Reserved height for everything below the table (summary box,
    // mentions, decision line, signature footer) at their normal/minimum
    // spacing - used both to size the table rows below and, later, to
    // compute any leftover slack once the table is actually drawn.
    const G1 = 14; // table -> summary box (kept tight, closely related)
    const G3 = 14; // mentions -> decision line (kept tight, closely related)
    const G2_MIN = 16; // summary box -> mentions block
    const G4_MIN = 30; // decision line -> signature footer
    const SUMMARY_H = 32;
    const MENTIONS_H = 48;
    const DECISION_H = 13;
    const FOOTER_H = 40;
    const bottomBlockMin =
      G1 +
      SUMMARY_H +
      G2_MIN +
      MENTIONS_H +
      G3 +
      DECISION_H +
      G4_MIN +
      FOOTER_H;

    // --- Notes table (13 columns, matching the source template exactly) ---
    const columns: Array<{ label: string; width: number }> = [
      { label: 'Matieres', width: 95 },
      { label: 'Note 1\nInterro', width: 32 },
      { label: 'Note 2\nInterro', width: 32 },
      { label: 'Note de\nDevoir', width: 32 },
      { label: 'Moyenne\nde Classe', width: 38 },
      { label: 'Compo', width: 32 },
      { label: 'Moyenne\nPeriode', width: 38 },
      { label: 'Coef.', width: 26 },
      { label: 'Moyenne\nDefinitive', width: 38 },
      { label: 'Rang', width: 32 },
      { label: 'Appreciations', width: 55 },
      { label: 'Professeurs', width: 55 },
      { label: 'Signatures', width: 42 },
    ];
    const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const scale = usableWidth / tableWidth;
    for (const c of columns) {
      c.width *= scale;
    }
    const columnX: number[] = [];
    {
      let x = startX;
      for (const c of columns) {
        columnX.push(x);
        x += c.width;
      }
    }

    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    // Index of the first value column in a subtotal row (Moyenne Periode) -
    // subtotal labels span columns 0..labelSpanEnd-1, matching how far the
    // "Moyenne Matieres XXX" text runs in the source template.
    const labelSpanEnd = 6;

    // Row heights scale up to fill the page when a class has few subjects,
    // instead of leaving the table short and dumping the difference as
    // blank space at the end - the extra room a short bulletin has is
    // spread across every row (more breathing room per cell), the same
    // way a real printed report card would size its rows to the sheet
    // rather than leaving a dangling empty area under a small table.
    // Clamped at the low end to the original fixed sizes (so a long class
    // list renders exactly as before) and at the high end so a class with
    // only one or two subjects doesn't get absurdly tall rows.
    const BASE_DATA_ROW_H = 14;
    const BASE_HEADER_ROW_H = 22;
    const BASE_SMALL_ROW_H = 13;
    const categoriesPresent = [
      SubjectCategory.LITTERAIRE,
      SubjectCategory.SCIENTIFIQUE,
      SubjectCategory.AUTRE,
    ].filter((cat) => data.subjects.some((s) => s.category === cat)).length;
    const totalRowUnits =
      BASE_HEADER_ROW_H / BASE_DATA_ROW_H +
      data.subjects.length +
      (categoriesPresent * 2 * BASE_SMALL_ROW_H) / BASE_DATA_ROW_H;
    const availableForTable = bottomLimit - bottomBlockMin - tableStartY;
    const dataRowH = Math.min(
      30,
      Math.max(BASE_DATA_ROW_H, availableForTable / totalRowUnits),
    );
    const headerRowH = dataRowH * (BASE_HEADER_ROW_H / BASE_DATA_ROW_H);
    const smallRowH = dataRowH * (BASE_SMALL_ROW_H / BASE_DATA_ROW_H);

    // Unshaded bold section header ("Matieres litteraires"...) - the
    // mockup only shades the subtotal row below it, not this one.
    // Vertically centers a cell's text within a rowHeight-tall row - doc's
    // own text() only ever top-anchors, so every cell (single or multi-line
    // header labels alike) needs its actual wrapped height measured first.
    const drawCellText = (
      text: string,
      x: number,
      y: number,
      width: number,
      rowHeight: number,
      options: { align?: 'left' | 'center'; underline?: boolean } = {},
    ) => {
      const textHeight = doc.heightOfString(text, { width, ...options });
      doc.text(text, x, y + Math.max(0, (rowHeight - textHeight) / 2), {
        width,
        ...options,
      });
    };

    const drawCategoryHeaderRow = (label: string) => {
      const rowHeight = smallRowH;
      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        drawWatermark();
        doc.y = doc.page.margins.top;
      }
      const y = doc.y;
      doc.rect(startX, y, usableWidth, rowHeight).stroke('#000000');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000');
      drawCellText(label, startX + 3, y, usableWidth - 6, rowHeight);
      doc.y = y + rowHeight;
      doc.x = startX;
    };

    // Shaded subtotal row ("Moyenne Matieres XXX ...") - label spans
    // columns 0..labelSpanEnd-1, values land in the remaining columns.
    const drawShadedRow = (
      label: string,
      cellsByIndex: Map<number, string>,
    ) => {
      const rowHeight = smallRowH;
      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        drawWatermark();
        doc.y = doc.page.margins.top;
      }
      const y = doc.y;
      doc.rect(startX, y, usableWidth, rowHeight).fill('#D9D9D9');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(7.5);
      const labelWidth = columnX[labelSpanEnd] - startX - 4;
      drawCellText(label, startX + 3, y, labelWidth, rowHeight);
      for (const [index, text] of cellsByIndex) {
        drawCellText(
          text,
          columnX[index] + 2,
          y,
          columns[index].width - 4,
          rowHeight,
          { align: 'center' },
        );
      }
      doc.rect(startX, y, usableWidth, rowHeight).stroke('#000000');
      doc.y = y + rowHeight;
      doc.x = startX;
    };

    const drawRow = (
      cells: string[],
      options: { header?: boolean; italicIndex?: number } = {},
    ) => {
      const rowHeight = options.header ? headerRowH : dataRowH;
      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        drawWatermark();
        doc.y = doc.page.margins.top;
      }
      let x = startX;
      const y = doc.y;
      cells.forEach((text, index) => {
        const width = columns[index].width;
        doc.rect(x, y, width, rowHeight).stroke('#000000');
        doc.font(
          options.header
            ? 'Helvetica-Bold'
            : index === options.italicIndex
              ? 'Helvetica-Oblique'
              : 'Helvetica',
        );
        doc.fontSize(6.5);
        drawCellText(text, x + 2, y, width - 4, rowHeight, {
          align: index === 0 ? 'left' : 'center',
        });
        x += width;
      });
      doc.y = y + rowHeight;
      doc.x = startX;
    };

    drawRow(
      columns.map((c) => c.label),
      { header: true },
    );

    const APPRECIATION_COLUMN_INDEX = 10;

    for (const category of [
      SubjectCategory.LITTERAIRE,
      SubjectCategory.SCIENTIFIQUE,
      SubjectCategory.AUTRE,
    ]) {
      const subjectsInCategory = data.subjects.filter(
        (s) => s.category === category,
      );
      if (subjectsInCategory.length === 0) {
        continue;
      }
      drawCategoryHeaderRow(this.SUBJECT_CATEGORY_LABELS[category]);
      for (const s of subjectsInCategory) {
        drawRow(
          [
            s.label,
            fmt(s.i1),
            fmt(s.i2),
            fmt(s.devoir),
            fmt(s.moyenneClasse),
            fmt(s.compo),
            fmt(s.moyennePeriode),
            String(s.coefficient),
            fmt(s.moyenneDefinitive),
            s.rang ?? '-',
            s.appreciation ?? '-',
            s.teacherName,
            '',
          ],
          { italicIndex: APPRECIATION_COLUMN_INDEX },
        );
      }
      const summary = data.groupSummaries[category];
      const graded = subjectsInCategory.filter(
        (s) => s.moyenneDefinitive !== null,
      );
      const sumDefinitive = graded.reduce(
        (sum, s) => sum + (s.moyenneDefinitive as number),
        0,
      );
      const sumCoef = graded.reduce((sum, s) => sum + s.coefficient, 0);
      drawShadedRow(
        `Moyenne ${this.SUBJECT_CATEGORY_LABELS[category]}`,
        new Map([
          [6, this.formatBulletinNumber(sumDefinitive)],
          [7, String(sumCoef)],
          [8, fmt(summary.moyenne)],
          [9, summary.rang ?? '-'],
        ]),
      );
    }
    // Row heights above were already sized to make the table fill the
    // page, so there's normally little to no slack left here - this is
    // now just a safety margin for rounding and for the dataRowH clamp
    // (a class with only one or two subjects can't stretch rows far
    // enough on its own to fill the page). Any leftover is spread the
    // same way as before: G2 stays modest (a big gap right under the
    // summary box reads as a mistake), G4 absorbs the rest since it's
    // already conventionally blank space reserved for the council's
    // remarks before the signatures.
    if (doc.y + bottomBlockMin > bottomLimit) {
      doc.addPage();
      drawWatermark();
      doc.y = doc.page.margins.top;
    }
    const G2_EXTRA_CAP = 20;
    const slack = Math.max(0, bottomLimit - doc.y - bottomBlockMin);
    const G2 = G2_MIN + Math.min(slack, G2_EXTRA_CAP);
    const G4 = G4_MIN + Math.max(0, slack - G2_EXTRA_CAP);

    doc.y += G1;
    doc.x = startX;

    // --- Bottom summary box (Total points / Total coef / MGP / Rang /
    // Faible-Forte-Moy.classe / one column per prior period / Moy. annuelle
    // + rang) - a compact two-row table (headers then values), all plain
    // bold black per the mockup (no color accents). ---
    const summaryCells: Array<{ label: string; value: string }> = [
      { label: 'Total points', value: fmt(data.totalPoints) },
      { label: 'Total coef.', value: String(data.totalCoef) },
      { label: 'Moyenne(MGP)', value: fmt(data.moyenneGenerale) },
      { label: 'Rang', value: data.rangGeneral },
      { label: 'Faible moy.', value: fmt(data.classStats?.moyenneMin) },
      { label: 'Forte moy.', value: fmt(data.classStats?.moyenneMax) },
      { label: 'Moy.classe', value: fmt(data.classStats?.moyenneClasse) },
      ...data.priorPeriodeAverages.map((p) => ({
        label: `Moy. ${p.shortLabel}`,
        value: fmt(p.value),
      })),
      { label: 'Moy. Ann.', value: fmt(data.moyenneAnnuelle) },
      { label: 'Rang', value: data.rangAnnuel ?? '-' },
    ];
    const summaryColW = usableWidth / summaryCells.length;
    const summaryRowH = 16;
    if (doc.y + summaryRowH * 2 > bottomLimit) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
    let sy = doc.y;
    doc.font('Helvetica-Bold').fontSize(6);
    summaryCells.forEach((cell, index) => {
      const x = startX + index * summaryColW;
      doc.rect(x, sy, summaryColW, summaryRowH).stroke('#000000');
      drawCellText(cell.label, x + 1, sy, summaryColW - 2, summaryRowH, {
        align: 'center',
        underline: cell.label === 'Moyenne(MGP)',
      });
    });
    sy += summaryRowH;
    doc.font('Helvetica-Bold').fontSize(7);
    summaryCells.forEach((cell, index) => {
      const x = startX + index * summaryColW;
      doc.rect(x, sy, summaryColW, summaryRowH).stroke('#000000');
      drawCellText(cell.value, x + 1, sy, summaryColW - 2, summaryRowH, {
        align: 'center',
      });
    });
    doc.y = sy + summaryRowH + G2;
    doc.x = startX;

    // --- Mentions / Retards-Absences-Exclusion / Appreciation generale /
    // date+chef - five loose columns side by side (no grid here, matching
    // the mockup), each spanning 4 text-line rows. ---
    const bY = doc.y;
    const lineH = 12;
    const rowY = (n: number) => bY + n * lineH;
    const col1X = startX;
    const col1W = 78;
    const col2X = col1X + col1W;
    const col2W = 100;
    const col3X = col2X + col2W;
    const col3W = 130;
    const col5W = 130;
    const col4X = col3X + col3W;
    const col5X = startX + usableWidth - col5W;
    const col4W = col5X - col4X - 6;

    // Avert./Blames, each grouped over two rows (Trav./Disc.) by a brace.
    doc.font('Helvetica').fontSize(7.5);
    doc.text('Avert.', col1X, rowY(0), { width: 34, lineBreak: false });
    doc.text('Blames', col1X, rowY(2), { width: 34, lineBreak: false });
    this.drawBrace(doc, col1X + 32, rowY(0), lineH);
    this.drawBrace(doc, col1X + 32, rowY(2), lineH);
    const travDiscX = col1X + 44;
    doc.font('Helvetica').fontSize(7.5);
    doc.text('Trav.', travDiscX, rowY(0), { lineBreak: false });
    this.drawCheckbox(doc, travDiscX + 24, rowY(0), '', false, 7.5);
    doc.text('Disc.', travDiscX, rowY(1), { lineBreak: false });
    this.drawCheckbox(doc, travDiscX + 24, rowY(1), '', false, 7.5);
    doc.text('Trav.', travDiscX, rowY(2), { lineBreak: false });
    this.drawCheckbox(doc, travDiscX + 24, rowY(2), '', false, 7.5);
    doc.text('Disc.', travDiscX, rowY(3), { lineBreak: false });
    this.drawCheckbox(doc, travDiscX + 24, rowY(3), '', false, 7.5);

    // Felicitations / Encouragements / Tableau d'honneur.
    this.drawCheckbox(doc, col2X, rowY(0), 'Felicitations', false, 7.5);
    this.drawCheckbox(doc, col2X, rowY(1), 'Encouragements', false, 7.5);
    this.drawCheckbox(doc, col2X, rowY(2), "Tableau d'honneur", false, 7.5);

    // Retards / Absences / Exclusion.
    doc.font('Helvetica').fontSize(7.5);
    doc.text(`Retards : ${data.retards ?? '_______'} fois`, col3X, rowY(0), {
      width: col3W,
      lineBreak: false,
    });
    doc.text(
      `Absences : ${data.absences ?? '_______'} heure(s)`,
      col3X,
      rowY(1),
      { width: col3W, lineBreak: false },
    );
    this.drawCheckbox(
      doc,
      col3X,
      rowY(2),
      'Exclusion :',
      Boolean(data.exclusion),
      7.5,
    );

    // Appreciation generale (label bold, value bold-italic below it).
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('Appréciation générale :', col4X, rowY(0), { width: col4W });
    doc
      .font('Helvetica-BoldOblique')
      .fontSize(9)
      .text(data.appreciationGenerale, col4X, rowY(2), { width: col4W });

    // Fait a .../Le Chef d'Etablissement, right-aligned.
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(
        `${data.ecole?.localite ?? '-'}, le ${this.formatBulletinDate(data.dateDuConseil)}`,
        col5X,
        rowY(0),
        { width: col5W, align: 'right' },
      );
    doc.text("Le Chef d'Établissement", col5X, rowY(1), {
      width: col5W,
      align: 'right',
    });

    // Gap before the decision line, matching the gaps used between the
    // other bottom blocks.
    doc.y = rowY(4) + G3;
    doc.x = startX;

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`Décision du conseil des profs : ${data.decisionConseil ?? ''}`, {
        width: usableWidth,
      });
    // Gap before the signature footer - also doubles as blank space to
    // physically sign, so it absorbs most of any leftover slack (see G4
    // above).
    doc.y += G4;
    doc.x = startX;

    const footerY = doc.y;
    doc.rect(startX, footerY, usableWidth * 0.4, 40).stroke('#000000');
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .text('Nom et signature du titulaire', startX + 5, footerY + 5, {
        width: usableWidth * 0.4 - 10,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(data.titulaire, startX + 5, footerY + 22);

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(data.chefEtablissement, startX + usableWidth * 0.6, footerY + 24, {
        width: usableWidth * 0.4,
        align: 'right',
      });
  }

  async renderBulletinPdf(
    sessionId: string,
    studentId: string,
  ): Promise<Buffer> {
    const data = await this.buildBulletinPageData(sessionId, studentId);
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 24,
      size: 'A4',
      layout: 'portrait',
    });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.renderBulletinPage(doc, data);
      doc.end();
    });
  }

  // All matched students of the session in one PDF, one page (or more, if a
  // student's subject table overflows) per student - the real-world usage
  // is printing every bulletin of a class in a single batch.
  async renderClassBulletinsPdf(sessionId: string): Promise<Buffer> {
    const rows = await this.rowModel
      .find({ sessionId, matchStatus: ImportRowMatchStatus.MATCHED })
      .sort({ 'rawIdentity.nameRaw': 1 })
      .lean()
      .exec();
    if (rows.length === 0) {
      throw new BadRequestException('Aucun élève rapproché dans cette session');
    }
    return this.renderBulletinsForRows(sessionId, rows);
  }

  // Same as renderClassBulletinsPdf but restricted to the given students -
  // lets the front-office print/download a batch (e.g. just one class
  // section) without pulling every matched student in the session.
  async renderSelectedBulletinsPdf(
    sessionId: string,
    studentIds: string[],
  ): Promise<Buffer> {
    if (studentIds.length === 0) {
      throw new BadRequestException('Aucun élève sélectionné');
    }
    const rows = await this.rowModel
      .find({
        sessionId,
        matchStatus: ImportRowMatchStatus.MATCHED,
        studentId: { $in: studentIds },
      })
      .sort({ 'rawIdentity.nameRaw': 1 })
      .lean()
      .exec();
    if (rows.length === 0) {
      throw new BadRequestException('Aucun élève rapproché dans cette session');
    }
    return this.renderBulletinsForRows(sessionId, rows);
  }

  private renderBulletinsForRows(
    sessionId: string,
    rows: Array<{ studentId: unknown }>,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 24,
      size: 'A4',
      layout: 'portrait',
    });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      void (async () => {
        try {
          for (let i = 0; i < rows.length; i += 1) {
            const data = await this.buildBulletinPageData(
              sessionId,
              String(rows[i].studentId),
            );
            if (i > 0) {
              doc.addPage();
            }
            this.renderBulletinPage(doc, data);
          }
          doc.end();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }
}
