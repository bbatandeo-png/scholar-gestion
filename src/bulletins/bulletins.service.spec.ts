import * as fs from 'fs';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { startMongoReplSet } from '../../test/mongo-replset';
import { runWithTenant } from '../common/tenant/tenant-context';
import {
  BulletinImportMode,
  BulletinSessionStatus,
  BulletinStudentMatchingMode,
  EnrollmentStatus,
  EnrollmentType,
  ImportRowMatchStatus,
  LevelCycle,
  Periode,
  SubjectCategory,
} from '../common/enums/domain.enums';
import { parseBulletinWorkbook } from './bulletins-import.util';
import { AuditService } from '../audit/audit.service';
import { AuditLog, AuditLogSchema } from '../audit/schemas/audit-log.schema';
import {
  Enrollment,
  EnrollmentDocument,
  EnrollmentSchema,
} from '../enrollments/schemas/enrollment.schema';
import {
  Level,
  LevelDocument,
  LevelSchema,
} from '../levels/schemas/level.schema';
import {
  SchoolYear,
  SchoolYearSchema,
} from '../school-years/schemas/school-year.schema';
import {
  Student,
  StudentDocument,
  StudentSchema,
} from '../students/schemas/student.schema';
import { StudentsModule } from '../students/students.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { BulletinsService } from './bulletins.service';
import {
  BulletinImportRow,
  BulletinImportRowSchema,
} from './schemas/bulletin-import-row.schema';
import {
  BulletinResult,
  BulletinResultDocument,
  BulletinResultSchema,
} from './schemas/bulletin-result.schema';
import {
  BulletinSession,
  BulletinSessionSchema,
} from './schemas/bulletin-session.schema';
import {
  ClassSubject,
  ClassSubjectSchema,
} from './schemas/class-subject.schema';
import { Note, NoteDocument, NoteSchema } from './schemas/note.schema';
import { Subject, SubjectSchema } from './schemas/subject.schema';

const IDENTITY_HEADERS = [' ', 'Nom et Prénoms', 'Matricule', 'Sexe', 'N/R'];
const SUBJECT_SUB_HEADERS = ['i1', 'i2', 'Devoir', 'Compo', 'Coef', 'Prof'];
const TRAILING_HEADERS = [
  'Classe',
  'Titulaire de la classe',
  "Nom du Chef d'établissement",
  'Année scolaire',
  'Date du conseil',
  'Moyenne Générale de la période',
  'Rang',
  'Appréciation',
];

function buildHeaderRow(subjectNames: string[]): unknown[] {
  const row: unknown[] = [...IDENTITY_HEADERS];
  for (const name of subjectNames) {
    row.push(name, ...SUBJECT_SUB_HEADERS);
  }
  row.push(...TRAILING_HEADERS);
  return row;
}

function buildWorkbookBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Feuille 1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('BulletinsService', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: BulletinsService;
  let studentModel: Model<StudentDocument>;
  let enrollmentModel: Model<EnrollmentDocument>;
  let levelModel: Model<LevelDocument>;
  let noteModel: Model<NoteDocument>;
  let bulletinResultModel: Model<BulletinResultDocument>;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([
          { name: BulletinSession.name, schema: BulletinSessionSchema },
          { name: BulletinImportRow.name, schema: BulletinImportRowSchema },
          { name: Subject.name, schema: SubjectSchema },
          { name: ClassSubject.name, schema: ClassSubjectSchema },
          { name: Note.name, schema: NoteSchema },
          { name: BulletinResult.name, schema: BulletinResultSchema },
          { name: Enrollment.name, schema: EnrollmentSchema },
          { name: Level.name, schema: LevelSchema },
          { name: Student.name, schema: StudentSchema },
          { name: SchoolYear.name, schema: SchoolYearSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
        ]),
        StudentsModule,
        EcolesModule,
      ],
      providers: [BulletinsService, AuditService],
    }).compile();

    service = moduleRef.get(BulletinsService);
    studentModel = moduleRef.get(getModelToken(Student.name));
    enrollmentModel = moduleRef.get(getModelToken(Enrollment.name));
    levelModel = moduleRef.get(getModelToken(Level.name));
    noteModel = moduleRef.get(getModelToken(Note.name));
    bulletinResultModel = moduleRef.get(getModelToken(BulletinResult.name));

    // Pre-create every collection written to inside validateSession()'s
    // transaction (Note, BulletinResult, and AuditLog via AuditService.log)
    // - MongoDB can't implicitly create a brand-new collection as a
    // transaction's first write without risking catalog conflicts (same
    // issue found and fixed in facturation.service.spec.ts).
    await Promise.all(
      [
        BulletinSession.name,
        BulletinImportRow.name,
        Subject.name,
        ClassSubject.name,
        Note.name,
        BulletinResult.name,
        Enrollment.name,
        Level.name,
        Student.name,
        AuditLog.name,
      ].map((name) =>
        moduleRef.get<Model<unknown>>(getModelToken(name)).createCollection(),
      ),
    );
  });

  afterAll(async () => {
    await repl.stop();
  });

  async function seedRoster(
    ecoleId: string,
    levelId: string,
    schoolYearId: string,
  ) {
    return runWithTenant({ ecoleId }, async () => {
      const s1 = await studentModel.create({
        matricule: 'MAT-001',
        lastname: 'ADOKPE',
        firstname: 'Gildas',
        gender: 'M',
        birthDate: new Date('2012-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });
      const s2 = await studentModel.create({
        matricule: 'MAT-002',
        lastname: 'AFANOU',
        firstname: 'Kepler',
        gender: 'M',
        birthDate: new Date('2012-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });
      const s3 = await studentModel.create({
        matricule: 'MAT-003',
        lastname: 'ZANDOH',
        firstname: 'Komlan',
        gender: 'M',
        birthDate: new Date('2012-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });

      for (const student of [s1, s2, s3]) {
        await enrollmentModel.create({
          studentId: student._id,
          schoolYearId,
          levelId,
          type: EnrollmentType.INITIAL,
          status: EnrollmentStatus.ACTIVE,
        });
      }

      return { s1, s2, s3 };
    });
  }

  it('rejette la creation de session si le cycle de la classe n est pas configure', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({ code: 'NOCYCLE', label: 'NoCycle', sortOrder: 1 }),
    );

    await expect(
      runWithTenant({ ecoleId }, () =>
        service.createSession(
          {
            schoolYearId,
            levelId: String(level._id),
            periode: Periode.TRIMESTRE_1,
          },
          new Types.ObjectId().toHexString(),
        ),
      ),
    ).rejects.toThrow('cycle');
  });

  it('import + revue + validation: notes nullables preservees, rapprochement par matricule et par nom, matieres a approuver bloquent la validation', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: '5EME-T',
        label: '5eme',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    const { s1, s2 } = await seedRoster(ecoleId, levelId, schoolYearId);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );
    expect(session.status).toBe(BulletinSessionStatus.DRAFT);

    // Row 1: matches by matricule. Row 2: matches by exact name (no matricule).
    // Row 3: no student in roster resembles this name closely -> UNRESOLVED.
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français', 'Maths']),
      [
        1,
        'Quelqu Un',
        'MAT-001',
        'M',
        '',
        'Français',
        null,
        8,
        0,
        0,
        2,
        'PROF1',
        'Maths',
        null,
        12,
        10,
        14,
        1,
        'PROF2',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        'AFANOU Kepler',
        '',
        'M',
        '',
        'Français',
        null,
        14,
        14,
        10,
        2,
        'PROF1',
        'Maths',
        null,
        13,
        11,
        12,
        1,
        'PROF2',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        3,
        'INCONNU Personne Zzz',
        '',
        'M',
        '',
        'Français',
        null,
        10,
        10,
        10,
        2,
        'PROF1',
        'Maths',
        null,
        10,
        10,
        10,
        1,
        'PROF2',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'test.xlsx',
      ),
    );

    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows).toHaveLength(3);

    const rowByName = new Map(rows.map((r) => [r.rawIdentity.nameRaw, r]));
    expect(rowByName.get('Quelqu Un')!.matchStatus).toBe(
      ImportRowMatchStatus.MATCHED,
    );
    expect(String(rowByName.get('Quelqu Un')!.studentId!._id)).toBe(
      String(s1._id),
    );
    expect(rowByName.get('AFANOU Kepler')!.matchStatus).toBe(
      ImportRowMatchStatus.MATCHED,
    );
    expect(String(rowByName.get('AFANOU Kepler')!.studentId!._id)).toBe(
      String(s2._id),
    );
    expect(rowByName.get('INCONNU Personne Zzz')!.matchStatus).toBe(
      ImportRowMatchStatus.UNRESOLVED,
    );

    // Subjects not yet configured for this class -> session stays pending review
    // even before the unresolved row is fixed.
    const afterImport = await runWithTenant({ ecoleId }, () =>
      service.getSession(String(session._id)),
    );
    expect(afterImport.status).toBe(BulletinSessionStatus.PENDING_REVIEW);
    const unapproved = await runWithTenant({ ecoleId }, () =>
      service.getUnapprovedSubjects(String(session._id)),
    );
    expect(unapproved.map((u) => u.subjectNameRaw).sort()).toEqual([
      'Français',
      'Maths',
    ]);
    expect(
      unapproved.find((u) => u.subjectNameRaw === 'Français')?.profRaw,
    ).toBe('PROF1');

    // Validation must be refused while rows are unresolved / subjects unapproved.
    await expect(
      runWithTenant({ ecoleId }, () =>
        service.validateSession(String(session._id), createdBy),
      ),
    ).rejects.toThrow();

    // Resolve the unresolved row manually against the roster's third student.
    const unresolvedRow = rowByName.get('INCONNU Personne Zzz');
    const roster = await runWithTenant({ ecoleId }, () =>
      service.getRosterForSession(String(session._id)),
    );
    const zandoh = roster.find((r) => r.lastname === 'ZANDOH');
    expect(zandoh).toBeDefined();
    await runWithTenant({ ecoleId }, () =>
      service.resolveRow(String(unresolvedRow!._id), zandoh!.studentId),
    );

    // Approve both subjects.
    await runWithTenant({ ecoleId }, () =>
      service.approveSubject(String(session._id), {
        subjectNameRaw: 'Français',
        label: 'Français',
        category: SubjectCategory.LITTERAIRE,
        coefficient: 3,
        teacherName: 'PROF1',
      }),
    );
    await runWithTenant({ ecoleId }, () =>
      service.approveSubject(String(session._id), {
        subjectNameRaw: 'Maths',
        label: 'Maths',
        category: SubjectCategory.SCIENTIFIQUE,
        coefficient: 4,
        teacherName: 'PROF2',
      }),
    );

    const readySession = await runWithTenant({ ecoleId }, () =>
      service.getSession(String(session._id)),
    );
    expect(readySession.status).toBe(BulletinSessionStatus.READY);

    const validated = await runWithTenant({ ecoleId }, () =>
      service.validateSession(String(session._id), createdBy),
    );
    expect(validated.status).toBe(BulletinSessionStatus.VALIDATED);

    // The core correctness guarantee: i1 (unused in this file, like the real
    // sample) must persist as null, never coerced to 0, while a real 0 (the
    // Devoir on the first row) must persist as 0, not be dropped/nulled.
    const notesForStudent1 = await runWithTenant({ ecoleId }, () =>
      noteModel
        .find({ studentId: s1._id, periode: Periode.TRIMESTRE_1 })
        .lean()
        .exec(),
    );
    expect(notesForStudent1).toHaveLength(2);
    const francaisNote = notesForStudent1.find((n) => n.i2 === 8);
    expect(francaisNote).toBeDefined();
    expect(francaisNote!.i1).toBeNull();
    expect(francaisNote!.devoir).toBe(0);
    expect(francaisNote!.compo).toBe(0);
    expect(francaisNote!.coefficient).toBe(3);
    expect(francaisNote!.teacherName).toBe('PROF1');

    // Re-validation of an already-validated session must be rejected.
    await expect(
      runWithTenant({ ecoleId }, () =>
        service.validateSession(String(session._id), createdBy),
      ),
    ).rejects.toThrow('deja validee');
  });

  it('mode ECRASER: remplace les notes existantes sans perdre les lignes deja rapprochees (regression)', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'ECRASER-T',
        label: 'EcraserTest',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    const { s1, s2 } = await seedRoster(ecoleId, levelId, schoolYearId);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );

    const firstBuffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'Quelqu Un',
        'MAT-001',
        'M',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        'AFANOU Kepler',
        '',
        'M',
        '',
        'Français',
        null,
        11,
        9,
        13,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        firstBuffer,
        BulletinImportMode.PREMIER_IMPORT,
        'v1.xlsx',
      ),
    );

    const rowsAfterFirst = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rowsAfterFirst).toHaveLength(2);

    const secondBuffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'Quelqu Un',
        'MAT-001',
        'M',
        '',
        'Français',
        null,
        15,
        9,
        16,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        'AFANOU Kepler',
        '',
        'M',
        '',
        'Français',
        null,
        17,
        10,
        18,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        secondBuffer,
        BulletinImportMode.ECRASER,
        'v2.xlsx',
      ),
    );

    // The core regression: rows already matched before the re-import must
    // still exist afterwards (previously they silently vanished, because
    // the old - now bulk-deleted - row _id was targeted by updateOne
    // instead of the row being recreated).
    const rowsAfterEcraser = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rowsAfterEcraser).toHaveLength(2);

    const rowByName = new Map(
      rowsAfterEcraser.map((r) => [r.rawIdentity.nameRaw, r]),
    );
    const row1 = rowByName.get('Quelqu Un')!;
    expect(row1.matchStatus).toBe(ImportRowMatchStatus.MATCHED);
    expect(String(row1.studentId!._id)).toBe(String(s1._id));
    expect(row1.notes[0].i2).toBe(15);
    expect(row1.notes[0].compo).toBe(16);

    const row2 = rowByName.get('AFANOU Kepler')!;
    expect(row2.matchStatus).toBe(ImportRowMatchStatus.MATCHED);
    expect(String(row2.studentId!._id)).toBe(String(s2._id));
    expect(row2.notes[0].i2).toBe(17);
  });

  it('mode FUSIONNER: ne remplace que les champs non vides du fichier, conserve les valeurs deja saisies', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'FUSIONNER-T',
        label: 'FusionnerTest',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    await seedRoster(ecoleId, levelId, schoolYearId);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );

    const firstBuffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'Quelqu Un',
        'MAT-001',
        'M',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);
    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        firstBuffer,
        BulletinImportMode.PREMIER_IMPORT,
        'v1.xlsx',
      ),
    );

    // Second file: i1 newly filled in for Français, i2/devoir/compo blank
    // (should NOT erase the values already captured), plus a brand new
    // Maths column that didn't exist in the first file.
    const secondBuffer = buildWorkbookBuffer([
      buildHeaderRow(['Français', 'Maths']),
      [
        1,
        'Quelqu Un',
        'MAT-001',
        'M',
        '',
        'Français',
        14,
        null,
        null,
        null,
        2,
        'PROF1',
        'Maths',
        null,
        16,
        null,
        null,
        1,
        'PROF3',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);
    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        secondBuffer,
        BulletinImportMode.FUSIONNER,
        'v2.xlsx',
      ),
    );

    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows).toHaveLength(1);
    const notesByName = new Map(
      rows[0].notes.map((n) => [n.subjectNameRaw, n]),
    );

    const francais = notesByName.get('Français')!;
    expect(francais.i1).toBe(14);
    expect(francais.i2).toBe(10);
    expect(francais.devoir).toBe(8);
    expect(francais.compo).toBe(12);

    const maths = notesByName.get('Maths');
    expect(maths).toBeDefined();
    expect(maths!.i2).toBe(16);
  });

  it('bout en bout avec le vrai fichier fourni (BASE DE DONNEES NOTES ELEVES 5EME.xlsx) : 32 eleves, matricules vides, i1 jamais renseigne, rapprochement par nom, validation complete', async () => {
    const realFilePath = path.join(
      __dirname,
      '..',
      '..',
      'BASE DE DONNEES NOTES ELEVES 5EME.xlsx',
    );
    const buffer = fs.readFileSync(realFilePath);
    const parsed = parseBulletinWorkbook(buffer);
    expect(parsed.rows.length).toBeGreaterThan(0);

    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'REAL-5EME',
        label: '5eme',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);

    // Build a roster straight from the file's own names (lastname = first
    // word, firstname = the rest) so every row is guaranteed an exact-name
    // match, regardless of how many name parts a given student has.
    const students = await runWithTenant({ ecoleId }, async () => {
      const created: StudentDocument[] = [];
      let i = 1;
      for (const row of parsed.rows) {
        const spaceIndex = row.nameRaw.indexOf(' ');
        const lastname =
          spaceIndex === -1 ? row.nameRaw : row.nameRaw.slice(0, spaceIndex);
        const firstname =
          spaceIndex === -1 ? '' : row.nameRaw.slice(spaceIndex + 1);
        const student = await studentModel.create({
          matricule: `REAL-${String(i).padStart(3, '0')}`,
          lastname,
          firstname,
          gender: 'M',
          birthDate: new Date('2012-01-01'),
          birthPlace: 'Lome',
          district: 'Centre',
          status: 'active',
        });
        await enrollmentModel.create({
          studentId: student._id,
          schoolYearId,
          levelId,
          type: EnrollmentType.INITIAL,
          status: EnrollmentStatus.ACTIVE,
        });
        created.push(student);
        i += 1;
      }
      return created;
    });
    expect(students).toHaveLength(parsed.rows.length);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'BASE DE DONNEES NOTES ELEVES 5EME.xlsx',
      ),
    );

    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows).toHaveLength(parsed.rows.length);

    // The file's own trailing metadata (titulaire/chef d'etablissement/
    // annee scolaire/date du conseil) must be captured on the session, not
    // silently dropped - see bulletins.service.ts's session.meta assignment.
    const sessionAfterImport = await runWithTenant({ ecoleId }, () =>
      service.getSession(String(session._id)),
    );
    expect(sessionAfterImport.meta.titulaire).toBe(parsed.meta.titulaire);
    expect(sessionAfterImport.meta.chefEtablissement).toBe(
      parsed.meta.chefEtablissement,
    );
    expect(sessionAfterImport.meta.anneeScolaire).toBe(
      parsed.meta.anneeScolaire,
    );
    expect(sessionAfterImport.meta.dateDuConseil).toBeTruthy();

    // Known real-file quirk: matricule is blank on every row - matching
    // must succeed purely by name, never via a matricule shortcut.
    expect(rows.every((r) => !r.rawIdentity.matriculeRaw)).toBe(true);
    // Sexe is populated on every row and must be captured verbatim, even
    // though it isn't cross-checked against the roster's existing gender.
    expect(rows.every((r) => r.rawIdentity.sexeRaw)).toBe(true);
    expect(
      rows.every((r) => r.matchStatus === ImportRowMatchStatus.MATCHED),
    ).toBe(true);

    // Known real-file quirk: the i1 column is entirely empty in this sample
    // - every cell must stay null, never coerced to 0.
    const allNotes = rows.flatMap((r) => r.notes);
    expect(allNotes.length).toBe(
      parsed.rows.length * parsed.rows[0].notes.length,
    );
    expect(allNotes.every((n) => n.i1 === null)).toBe(true);

    const expectedSubjects = parsed.rows[0].notes.map((n) => n.subjectNameRaw);
    const unapproved = await runWithTenant({ ecoleId }, () =>
      service.getUnapprovedSubjects(String(session._id)),
    );
    expect(unapproved.map((u) => u.subjectNameRaw).sort()).toEqual(
      [...expectedSubjects].sort(),
    );

    for (const { subjectNameRaw } of unapproved) {
      await runWithTenant({ ecoleId }, () =>
        service.approveSubject(String(session._id), {
          subjectNameRaw,
          label: subjectNameRaw,
          category: SubjectCategory.AUTRE,
          coefficient: 1,
        }),
      );
    }

    const readySession = await runWithTenant({ ecoleId }, () =>
      service.getSession(String(session._id)),
    );
    expect(readySession.status).toBe(BulletinSessionStatus.READY);

    const validated = await runWithTenant({ ecoleId }, () =>
      service.validateSession(String(session._id), createdBy),
    );
    expect(validated.status).toBe(BulletinSessionStatus.VALIDATED);

    // Spot-check the durable Note for the first real student/subject: i1
    // stayed null and a real 0 (Devoir/Compo on this row) was preserved as
    // 0, not dropped or confused with the null/unset case.
    const firstStudent = students[0];
    const notesForFirstStudent = await runWithTenant({ ecoleId }, () =>
      noteModel
        .find({ studentId: firstStudent._id, periode: Periode.TRIMESTRE_1 })
        .lean()
        .exec(),
    );
    expect(notesForFirstStudent).toHaveLength(expectedSubjects.length);
    const firstNoteExpected = parsed.rows[0].notes[0];
    const firstNoteActual = notesForFirstStudent.find(
      (n) => n.i2 === firstNoteExpected.i2,
    );
    expect(firstNoteActual).toBeDefined();
    expect(firstNoteActual!.i1).toBeNull();
    expect(firstNoteActual!.devoir).toBe(firstNoteExpected.devoir);
    expect(firstNoteActual!.compo).toBe(firstNoteExpected.compo);

    // Every note gets its computed fields at validation, even with i1
    // entirely missing (this real file's known quirk).
    expect(firstNoteActual!.moyenneClasse).not.toBeNull();
    expect(firstNoteActual!.moyennePeriode).not.toBeNull();
    expect(firstNoteActual!.moyenneDefinitive).not.toBeNull();
    expect(firstNoteActual!.rang).toMatch(/^\d+(er|ère|ème)$/);
    expect(typeof firstNoteActual!.appreciation).toBe('string');

    const bulletinResult = await runWithTenant({ ecoleId }, () =>
      bulletinResultModel
        .findOne({ studentId: firstStudent._id, periode: Periode.TRIMESTRE_1 })
        .lean()
        .exec(),
    );
    expect(bulletinResult).toBeTruthy();
    expect(bulletinResult!.statutNR).toBe('N');
    expect(bulletinResult!.totalCoef).toBe(expectedSubjects.length);
    expect(bulletinResult!.moyenneGenerale).toBeGreaterThanOrEqual(0);
    expect(bulletinResult!.rangGeneral).toMatch(/^\d+(er|ère|ème)$/);
    expect(typeof bulletinResult!.appreciationGenerale).toBe('string');
    // First validated period of the year for this student -> nothing to
    // cumulate with yet, annual average equals this period's own MGP.
    expect(bulletinResult!.moyenneAnnuelle).toBeCloseTo(
      bulletinResult!.moyenneGenerale,
      2,
    );

    const validatedSessionForStats = await runWithTenant({ ecoleId }, () =>
      service.getSession(String(session._id)),
    );
    expect(validatedSessionForStats.classStats).toBeTruthy();
    expect(validatedSessionForStats.classStats!.moyenneMin).toBeLessThanOrEqual(
      validatedSessionForStats.classStats!.moyenneMax,
    );

    // The individual bulletin PDF renders without error for a real student
    // and produces an actual PDF (starts with the %PDF magic bytes).
    const pdf = await runWithTenant({ ecoleId }, () =>
      service.renderBulletinPdf(String(session._id), String(firstStudent._id)),
    );
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);

    // The whole-class PDF (32 real students, several subjects each) forces
    // the per-student table to overflow onto extra pages for at least some
    // students - exercises the watermark-on-every-page wiring added
    // alongside the bottom-block layout fix, not just the single-page case.
    const classPdf = await runWithTenant({ ecoleId }, () =>
      service.renderClassBulletinsPdf(String(session._id)),
    );
    expect(Buffer.isBuffer(classPdf)).toBe(true);
    expect(classPdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(classPdf.length).toBeGreaterThan(pdf.length);

    // Selection download: only the chosen students end up in the PDF, not
    // the whole class.
    const secondStudent = students[1];
    const selectionPdf = await runWithTenant({ ecoleId }, () =>
      service.renderSelectedBulletinsPdf(String(session._id), [
        String(firstStudent._id),
        String(secondStudent._id),
      ]),
    );
    expect(Buffer.isBuffer(selectionPdf)).toBe(true);
    expect(selectionPdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(selectionPdf.length).toBeGreaterThan(pdf.length);
    expect(selectionPdf.length).toBeLessThan(classPdf.length);
  });

  it('validation refuse une note hors des bornes [0,20] et n ecrit rien (echec atomique)', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'BOUNDS-T',
        label: 'BoundsTest',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    // Deliberately a single-student roster (not seedRoster's 3) - the
    // imported file below has exactly one row, so every roster student
    // must have a matching row or the "eleve(s) sans ligne" check would
    // fire first and mask the bounds check this test actually targets.
    const s1 = await runWithTenant({ ecoleId }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-001',
        lastname: 'ADOKPE',
        firstname: 'Gildas',
        gender: 'M',
        birthDate: new Date('2012-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });
      await enrollmentModel.create({
        studentId: student._id,
        schoolYearId,
        levelId,
        type: EnrollmentType.INITIAL,
        status: EnrollmentStatus.ACTIVE,
      });
      return student;
    });

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );

    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'ADOKPE Gildas',
        'MAT-001',
        'M',
        '',
        'Français',
        10,
        10,
        10,
        25,
        1,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'test.xlsx',
      ),
    );

    const unapproved = await runWithTenant({ ecoleId }, () =>
      service.getUnapprovedSubjects(String(session._id)),
    );
    for (const { subjectNameRaw } of unapproved) {
      await runWithTenant({ ecoleId }, () =>
        service.approveSubject(String(session._id), {
          subjectNameRaw,
          label: subjectNameRaw,
          category: SubjectCategory.AUTRE,
          coefficient: 1,
        }),
      );
    }

    await expect(
      runWithTenant({ ecoleId }, () =>
        service.validateSession(String(session._id), createdBy),
      ),
    ).rejects.toThrow(/hors bornes/);

    const notesAfter = await runWithTenant({ ecoleId }, () =>
      noteModel.find({ studentId: s1._id }).lean().exec(),
    );
    expect(notesAfter).toHaveLength(0);

    const sessionAfter = await runWithTenant({ ecoleId }, () =>
      service.getSession(String(session._id)),
    );
    expect(sessionAfter.status).not.toBe(BulletinSessionStatus.VALIDATED);
  });

  it('validation refuse si un eleve n a strictement aucune note renseignee pour la periode', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'EMPTY-T',
        label: 'EmptyTest',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    // Deliberately a single-student roster (not seedRoster's 3) - the
    // imported file below has exactly one row, so every roster student
    // must have a matching row or the earlier "eleve(s) sans ligne" check
    // would fire first and mask the check this test actually targets.
    await runWithTenant({ ecoleId }, async () => {
      const student = await studentModel.create({
        matricule: 'MAT-001',
        lastname: 'ADOKPE',
        firstname: 'Gildas',
        gender: 'M',
        birthDate: new Date('2012-01-01'),
        birthPlace: 'Lome',
        district: 'Centre',
        status: 'active',
      });
      await enrollmentModel.create({
        studentId: student._id,
        schoolYearId,
        levelId,
        type: EnrollmentType.INITIAL,
        status: EnrollmentStatus.ACTIVE,
      });
    });

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );

    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'ADOKPE Gildas',
        'MAT-001',
        'M',
        '',
        'Français',
        null,
        null,
        null,
        null,
        1,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'test.xlsx',
      ),
    );

    const unapproved = await runWithTenant({ ecoleId }, () =>
      service.getUnapprovedSubjects(String(session._id)),
    );
    for (const { subjectNameRaw } of unapproved) {
      await runWithTenant({ ecoleId }, () =>
        service.approveSubject(String(session._id), {
          subjectNameRaw,
          label: subjectNameRaw,
          category: SubjectCategory.AUTRE,
          coefficient: 1,
        }),
      );
    }

    await expect(
      runWithTenant({ ecoleId }, () =>
        service.validateSession(String(session._id), createdBy),
      ),
    ).rejects.toThrow(/aucune note/);
  });

  it('mode AUTO_CREATE: cree Student+Enrollment sans rapprochement, sans date/lieu naissance/district, et valide correctement', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'AUTOCREATE-T',
        label: 'AutoCreateTest',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    // Deliberately no roster seeded - AUTO_CREATE mode targets an ecole with
    // zero pre-existing students.

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId,
          periode: Periode.TRIMESTRE_1,
          studentMatchingMode: BulletinStudentMatchingMode.AUTO_CREATE,
        },
        createdBy,
      ),
    );
    expect(session.studentMatchingMode).toBe(
      BulletinStudentMatchingMode.AUTO_CREATE,
    );

    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'KOFFI Ama',
        '',
        'F',
        '',
        'Français',
        null,
        12,
        10,
        14,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        'MENSAH Yao',
        '',
        'M',
        '',
        'Français',
        null,
        15,
        13,
        16,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'v1.xlsx',
      ),
    );

    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => r.matchStatus === ImportRowMatchStatus.MATCHED),
    ).toBe(true);

    const ama = rows.find((r) => r.rawIdentity.nameRaw === 'KOFFI Ama');
    expect(ama).toBeDefined();
    expect(ama!.studentId!.lastname).toBe('KOFFI');
    expect(ama!.studentId!.firstname).toBe('Ama');
    expect(ama!.studentId!.gender).toBe('F');
    expect(ama!.studentId!.matricule).toBeTruthy();
    expect(ama!.studentId!.birthDate).toBeUndefined();
    expect(ama!.studentId!.birthPlace).toBeUndefined();
    expect(ama!.studentId!.district).toBeUndefined();

    const enrollments = await runWithTenant({ ecoleId }, () =>
      enrollmentModel.find({ schoolYearId, levelId }).lean().exec(),
    );
    expect(enrollments).toHaveLength(2);
    expect(enrollments.every((e) => e.type === EnrollmentType.INITIAL)).toBe(
      true,
    );
    expect(enrollments.every((e) => e.status === EnrollmentStatus.ACTIVE)).toBe(
      true,
    );

    await runWithTenant({ ecoleId }, () =>
      service.approveSubject(String(session._id), {
        subjectNameRaw: 'Français',
        label: 'Français',
        category: SubjectCategory.LITTERAIRE,
        coefficient: 2,
      }),
    );
    const validated = await runWithTenant({ ecoleId }, () =>
      service.validateSession(String(session._id), createdBy),
    );
    expect(validated.status).toBe(BulletinSessionStatus.VALIDATED);
  });

  it('mode AUTO_CREATE: un re-import (ECRASER) ne duplique jamais les eleves deja crees', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'AUTOCREATE-ECRASER',
        label: 'AutoCreateEcraser',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId,
          periode: Periode.TRIMESTRE_1,
          studentMatchingMode: BulletinStudentMatchingMode.AUTO_CREATE,
        },
        createdBy,
      ),
    );

    const firstBuffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'ATTIOGBE Kossi',
        '',
        'M',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);
    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        firstBuffer,
        BulletinImportMode.PREMIER_IMPORT,
        'v1.xlsx',
      ),
    );
    const rowsAfterFirst = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rowsAfterFirst).toHaveLength(1);
    const firstStudentId = String(rowsAfterFirst[0].studentId!._id);

    const secondBuffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'ATTIOGBE Kossi',
        '',
        'M',
        '',
        'Français',
        null,
        18,
        17,
        19,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);
    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        secondBuffer,
        BulletinImportMode.ECRASER,
        'v2.xlsx',
      ),
    );

    const rowsAfterSecond = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rowsAfterSecond).toHaveLength(1);
    expect(String(rowsAfterSecond[0].studentId!._id)).toBe(firstStudentId);

    const allStudents = await runWithTenant({ ecoleId }, () =>
      studentModel.find({}).lean().exec(),
    );
    expect(allStudents).toHaveLength(1);
  });

  it('mode AUTO_CREATE: refuse tout le fichier si une ligne a un sexe invalide, aucun eleve cree (echec atomique)', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'AUTOCREATE-SEXE',
        label: 'AutoCreateSexe',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId,
          periode: Periode.TRIMESTRE_1,
          studentMatchingMode: BulletinStudentMatchingMode.AUTO_CREATE,
        },
        createdBy,
      ),
    );

    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'VALIDE Eleve',
        '',
        'M',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        'INVALIDE Eleve',
        '',
        '',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await expect(
      runWithTenant({ ecoleId }, () =>
        service.importFile(
          String(session._id),
          buffer,
          BulletinImportMode.PREMIER_IMPORT,
          'v1.xlsx',
        ),
      ),
    ).rejects.toThrow('sexe invalide');

    const students = await runWithTenant({ ecoleId }, () =>
      studentModel.find({}).lean().exec(),
    );
    expect(students).toHaveLength(0);
    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows).toHaveLength(0);
  });

  it('mode AUTO_CREATE: refuse tout le fichier si un matricule est duplique dans le meme fichier (echec atomique)', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'AUTOCREATE-DUPMAT',
        label: 'AutoCreateDupMat',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId,
          periode: Periode.TRIMESTRE_1,
          studentMatchingMode: BulletinStudentMatchingMode.AUTO_CREATE,
        },
        createdBy,
      ),
    );

    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'PREMIER Eleve',
        'DUP-001',
        'M',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
      [
        2,
        'SECOND Eleve',
        'DUP-001',
        'F',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await expect(
      runWithTenant({ ecoleId }, () =>
        service.importFile(
          String(session._id),
          buffer,
          BulletinImportMode.PREMIER_IMPORT,
          'v1.xlsx',
        ),
      ),
    ).rejects.toThrow('deja utilise');

    const students = await runWithTenant({ ecoleId }, () =>
      studentModel.find({}).lean().exec(),
    );
    expect(students).toHaveLength(0);
  });

  it('sans studentMatchingMode precise, la session reste en mode RECONCILE (comportement inchange)', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'DEFAULT-MODE',
        label: 'DefaultMode',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );
    expect(session.studentMatchingMode).toBe(
      BulletinStudentMatchingMode.RECONCILE,
    );

    // No roster seeded, no reconciliation possible -> the row must stay
    // UNRESOLVED (proving the default really is RECONCILE - an AUTO_CREATE
    // session would instead have created a Student for this row).
    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français']),
      [
        1,
        'INCONNU Eleve',
        '',
        'M',
        '',
        'Français',
        null,
        10,
        8,
        12,
        2,
        'PROF1',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);
    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'v1.xlsx',
      ),
    );
    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows[0].matchStatus).toBe(ImportRowMatchStatus.UNRESOLVED);
    const students = await runWithTenant({ ecoleId }, () =>
      studentModel.find({}).lean().exec(),
    );
    expect(students).toHaveLength(0);
  });

  it('mode AUTO_CREATE avec le vrai fichier fourni : 32 eleves crees avec matricules generes uniques, validation complete', async () => {
    const realFilePath = path.join(
      __dirname,
      '..',
      '..',
      'BASE DE DONNEES NOTES ELEVES 5EME.xlsx',
    );
    const buffer = fs.readFileSync(realFilePath);
    const parsed = parseBulletinWorkbook(buffer);
    expect(parsed.rows.length).toBeGreaterThan(0);

    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'REAL-5EME-AUTO',
        label: '5eme',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    // No roster seeded at all - this is the whole point of AUTO_CREATE.

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId,
          periode: Periode.TRIMESTRE_1,
          studentMatchingMode: BulletinStudentMatchingMode.AUTO_CREATE,
        },
        createdBy,
      ),
    );

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'BASE DE DONNEES NOTES ELEVES 5EME.xlsx',
      ),
    );

    const rows = await runWithTenant({ ecoleId }, () =>
      service.listRows(String(session._id)),
    );
    expect(rows).toHaveLength(parsed.rows.length);
    expect(
      rows.every((r) => r.matchStatus === ImportRowMatchStatus.MATCHED),
    ).toBe(true);

    const createdStudents = await runWithTenant({ ecoleId }, () =>
      studentModel.find({}).lean().exec(),
    );
    expect(createdStudents).toHaveLength(parsed.rows.length);
    // Real-file quirk: matricule is blank on every row, so every Student
    // must have gotten a freshly generated one, all unique, matching the
    // default MAT-#### rule.
    const matricules = new Set(createdStudents.map((s) => s.matricule));
    expect(matricules.size).toBe(parsed.rows.length);
    expect(createdStudents.every((s) => /^MAT-\d{4}$/.test(s.matricule))).toBe(
      true,
    );
    expect(createdStudents.every((s) => s.birthDate === undefined)).toBe(true);

    const expectedSubjects = parsed.rows[0].notes.map((n) => n.subjectNameRaw);
    for (const subjectNameRaw of expectedSubjects) {
      await runWithTenant({ ecoleId }, () =>
        service.approveSubject(String(session._id), {
          subjectNameRaw,
          label: subjectNameRaw,
          category: SubjectCategory.AUTRE,
          coefficient: 1,
        }),
      );
    }

    const validated = await runWithTenant({ ecoleId }, () =>
      service.validateSession(String(session._id), createdBy),
    );
    expect(validated.status).toBe(BulletinSessionStatus.VALIDATED);

    const firstStudent = createdStudents.find(
      (s) => `${s.lastname} ${s.firstname}`.trim() === parsed.rows[0].nameRaw,
    );
    expect(firstStudent).toBeDefined();
    const notesForFirstStudent = await runWithTenant({ ecoleId }, () =>
      noteModel
        .find({ studentId: firstStudent!._id, periode: Periode.TRIMESTRE_1 })
        .lean()
        .exec(),
    );
    expect(notesForFirstStudent).toHaveLength(expectedSubjects.length);
    expect(notesForFirstStudent.every((n) => n.i1 === null)).toBe(true);
  });

  it("ecran Matieres autonome: creation d'une matiere, rejet des doublons, coefficients par classe modifiables", async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'STANDALONE',
        label: 'Standalone',
        sortOrder: 1,
      }),
    );
    const levelId = String(level._id);

    const subject = await runWithTenant({ ecoleId }, () =>
      service.createSubject({
        label: 'Philosophie',
        category: SubjectCategory.LITTERAIRE,
      }),
    );
    expect(subject.label).toBe('Philosophie');

    await expect(
      runWithTenant({ ecoleId }, () =>
        service.createSubject({
          label: 'philosophie',
          category: SubjectCategory.LITTERAIRE,
        }),
      ),
    ).rejects.toThrow('existe deja');

    const subjects = await runWithTenant({ ecoleId }, () =>
      service.listSubjects(),
    );
    expect(subjects.map((s) => s.label)).toContain('Philosophie');

    await runWithTenant({ ecoleId }, () =>
      service.upsertClassSubject({
        schoolYearId,
        levelId,
        subjectId: String(subject._id),
        coefficient: 2,
        teacherName: 'M. Dupont',
      }),
    );
    // Deliberately overwrites the coefficient on a second call - this screen
    // exists precisely so an admin can adjust a previously-set value.
    await runWithTenant({ ecoleId }, () =>
      service.upsertClassSubject({
        schoolYearId,
        levelId,
        subjectId: String(subject._id),
        coefficient: 4,
        teacherName: 'M. Dupont',
      }),
    );

    const classSubjects = await runWithTenant({ ecoleId }, () =>
      service.listClassSubjects(schoolYearId, levelId),
    );
    expect(classSubjects).toHaveLength(1);
    expect(classSubjects[0].coefficient).toBe(4);
  });

  it('grille "donnees importees": colonnes dans l ordre du fichier, valeurs alignees par matiere', async () => {
    const ecoleId = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const level = await runWithTenant({ ecoleId }, () =>
      levelModel.create({
        code: 'GRID-T',
        label: 'GridTest',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelId = String(level._id);
    await seedRoster(ecoleId, levelId, schoolYearId);

    const session = await runWithTenant({ ecoleId }, () =>
      service.createSession(
        { schoolYearId, levelId, periode: Periode.TRIMESTRE_1 },
        createdBy,
      ),
    );

    const buffer = buildWorkbookBuffer([
      buildHeaderRow(['Français', 'Maths']),
      [
        1,
        'Quelqu Un',
        'MAT-001',
        'M',
        '',
        'Français',
        null,
        8,
        0,
        0,
        2,
        'PROF1',
        'Maths',
        null,
        12,
        10,
        14,
        1,
        'PROF2',
        '5eme',
        'TITULAIRE',
        'CHEF',
        '2025-2026',
        null,
        null,
        null,
        null,
      ],
    ]);

    await runWithTenant({ ecoleId }, () =>
      service.importFile(
        String(session._id),
        buffer,
        BulletinImportMode.PREMIER_IMPORT,
        'test.xlsx',
      ),
    );

    const grid = await runWithTenant({ ecoleId }, () =>
      service.getImportGrid(String(session._id)),
    );
    expect(grid.subjects).toEqual(['Français', 'Maths']);
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0].displayName).toContain('ADOKPE');
    expect(grid.rows[0].cells[0]).toMatchObject({
      i1: null,
      i2: 8,
      devoir: 0,
      compo: 0,
    });
    expect(grid.rows[0].cells[1]).toMatchObject({
      i1: null,
      i2: 12,
      devoir: 10,
      compo: 14,
    });
  });

  it('isolation multi-ecole : deux ecoles avec des sessions/matieres/notes distinctes ne se voient jamais entre elles', async () => {
    const ecoleA = new Types.ObjectId().toHexString();
    const ecoleB = new Types.ObjectId().toHexString();
    const schoolYearId = new Types.ObjectId().toHexString();
    const createdBy = new Types.ObjectId().toHexString();

    const levelA = await runWithTenant({ ecoleId: ecoleA }, () =>
      levelModel.create({
        code: 'ISOL-A',
        label: 'Isolation A',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );
    const levelB = await runWithTenant({ ecoleId: ecoleB }, () =>
      levelModel.create({
        code: 'ISOL-B',
        label: 'Isolation B',
        sortOrder: 1,
        cycle: LevelCycle.COLLEGE,
      }),
    );

    const sessionA = await runWithTenant({ ecoleId: ecoleA }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId: String(levelA._id),
          periode: Periode.TRIMESTRE_1,
        },
        createdBy,
      ),
    );
    const sessionB = await runWithTenant({ ecoleId: ecoleB }, () =>
      service.createSession(
        {
          schoolYearId,
          levelId: String(levelB._id),
          periode: Periode.TRIMESTRE_1,
        },
        createdBy,
      ),
    );

    const subjectA = await runWithTenant({ ecoleId: ecoleA }, () =>
      service.createSubject({
        label: 'Matiere Ecole A',
        category: SubjectCategory.LITTERAIRE,
      }),
    );
    const subjectB = await runWithTenant({ ecoleId: ecoleB }, () =>
      service.createSubject({
        label: 'Matiere Ecole B',
        category: SubjectCategory.SCIENTIFIQUE,
      }),
    );

    // Same natural-key (label) is allowed to exist independently per ecole -
    // it must NOT collide across tenants even though the underlying
    // labelNormalized value could theoretically match.
    const duplicateInB = await runWithTenant({ ecoleId: ecoleB }, () =>
      service.createSubject({
        label: 'Matiere Ecole A',
        category: SubjectCategory.AUTRE,
      }),
    );
    expect(duplicateInB.label).toBe('Matiere Ecole A');

    // Sessions: ecole A never sees ecole B's sessions, and vice versa.
    const sessionsAsA = await runWithTenant({ ecoleId: ecoleA }, () =>
      service.listSessions(),
    );
    const sessionsAsB = await runWithTenant({ ecoleId: ecoleB }, () =>
      service.listSessions(),
    );
    expect(sessionsAsA.map((s) => String(s._id))).toContain(
      String(sessionA._id),
    );
    expect(sessionsAsA.map((s) => String(s._id))).not.toContain(
      String(sessionB._id),
    );
    expect(sessionsAsB.map((s) => String(s._id))).toContain(
      String(sessionB._id),
    );
    expect(sessionsAsB.map((s) => String(s._id))).not.toContain(
      String(sessionA._id),
    );

    // A direct-by-id lookup for another ecole's session must fail, not leak it.
    await expect(
      runWithTenant({ ecoleId: ecoleA }, () =>
        service.getSession(String(sessionB._id)),
      ),
    ).rejects.toThrow('introuvable');
    await expect(
      runWithTenant({ ecoleId: ecoleB }, () =>
        service.getSession(String(sessionA._id)),
      ),
    ).rejects.toThrow('introuvable');

    // Subjects: each ecole only ever sees its own catalog.
    const subjectsAsA = await runWithTenant({ ecoleId: ecoleA }, () =>
      service.listSubjects(),
    );
    const subjectsAsB = await runWithTenant({ ecoleId: ecoleB }, () =>
      service.listSubjects(),
    );
    expect(subjectsAsA.map((s) => String(s._id))).toEqual([
      String(subjectA._id),
    ]);
    expect(subjectsAsB.map((s) => String(s._id)).sort()).toEqual(
      [String(subjectB._id), String(duplicateInB._id)].sort(),
    );
  });
});
