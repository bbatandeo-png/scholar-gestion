import { Model } from 'mongoose';
import ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { Invoice } from '../billing/schemas/invoice.schema';
import { BulletinResult } from '../bulletins/schemas/bulletin-result.schema';
import { Note } from '../bulletins/schemas/note.schema';
import { Subject } from '../bulletins/schemas/subject.schema';
import { Student } from '../students/schemas/student.schema';
import { Level } from '../levels/schemas/level.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { EcolesService } from '../ecoles/ecoles.service';
import { SettingsService } from '../settings/settings.service';

// Every test below only exercises one or two of ReportsService's 11
// constructor dependencies - this builds a fully-stubbed instance and lets
// each test override just the mocks it actually cares about, instead of
// repeating 11 "{} as any" placeholders (and the associated lint noise) at
// every call site.
function createService(
  overrides: {
    enrollmentModel?: unknown;
    invoiceModel?: unknown;
    studentModel?: unknown;
    levelModel?: unknown;
    schoolYearModel?: unknown;
    paymentModel?: unknown;
    noteModel?: unknown;
    bulletinResultModel?: unknown;
    subjectModel?: unknown;
    ecolesService?: unknown;
    settingsService?: unknown;
  } = {},
): ReportsService {
  return new ReportsService(
    (overrides.enrollmentModel ?? {}) as unknown as Model<Enrollment>,
    (overrides.invoiceModel ?? {}) as unknown as Model<Invoice>,
    (overrides.studentModel ?? {}) as unknown as Model<Student>,
    (overrides.levelModel ?? {}) as unknown as Model<Level>,
    (overrides.schoolYearModel ?? {}) as unknown as Model<SchoolYear>,
    (overrides.paymentModel ?? {}) as unknown as Model<Payment>,
    (overrides.noteModel ?? {}) as unknown as Model<Note>,
    (overrides.bulletinResultModel ?? {}) as unknown as Model<BulletinResult>,
    (overrides.subjectModel ?? {}) as unknown as Model<Subject>,
    (overrides.ecolesService ?? {}) as unknown as EcolesService,
    (overrides.settingsService ?? {}) as unknown as SettingsService,
  );
}

describe('ReportsService', () => {
  it('filters registration-paid invoices by level and school year', async () => {
    const invoices = [
      {
        paidAmount: 1000,
        registrationFee: 1000,
        tuitionFee: 2000,
        balanceDue: 0,
        enrollmentId: {
          _id: 'enr-1',
          studentId: { lastname: 'A', firstname: 'Alice', matricule: 'M1' },
          schoolYearId: { _id: 'year-1', label: '2025-2026' },
          levelId: { _id: 'level-1', label: 'CP' },
        },
      },
      {
        paidAmount: 1000,
        registrationFee: 1000,
        tuitionFee: 2000,
        balanceDue: 0,
        enrollmentId: {
          _id: 'enr-2',
          studentId: { lastname: 'B', firstname: 'Bob', matricule: 'M2' },
          schoolYearId: { _id: 'year-2', label: '2026-2027' },
          levelId: { _id: 'level-2', label: 'CE1' },
        },
      },
    ];

    const invoiceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(invoices),
          }),
        }),
      }),
    };

    const service = createService({ invoiceModel });

    const result = await service.registrationPaidStudents(
      'registration',
      'level-1',
      'year-1',
    );

    expect(result).toHaveLength(1);
    expect(result[0].enrollmentId?.studentId?.lastname).toBe('A');
    expect(result[0]).toMatchObject({
      amountDue: 1000,
      amountPaid: 1000,
      balanceDue: 0,
    });
  });

  it('separates registration payments from tuition payments', async () => {
    const invoices = [
      {
        paidAmount: 1600,
        registrationFee: 1000,
        tuitionFee: 2200,
        discountAmount: 200,
        enrollmentId: {
          studentId: { lastname: 'Abalo', firstname: 'Koffi' },
          schoolYearId: { _id: 'year-1' },
          levelId: { _id: 'level-1' },
        },
      },
    ];
    const invoiceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(invoices),
          }),
        }),
      }),
    };
    const service = createService({ invoiceModel });

    const registration = await service.registrationPaidStudents('registration');
    const tuition = await service.registrationPaidStudents('tuition');

    expect(registration[0]).toMatchObject({
      amountDue: 1000,
      amountPaid: 1000,
      balanceDue: 0,
    });
    expect(tuition[0]).toMatchObject({
      amountDue: 2000,
      amountPaid: 600,
      balanceDue: 1400,
    });
  });

  it('keeps partial-payment and no-payment filters', async () => {
    const invoices = [
      {
        paidAmount: 500,
        registrationFee: 1000,
        tuitionFee: 2000,
        enrollmentId: { studentId: { lastname: 'Partiel' } },
      },
      {
        paidAmount: 0,
        registrationFee: 1000,
        tuitionFee: 2000,
        enrollmentId: { studentId: { lastname: 'Impayé' } },
      },
    ];
    const invoiceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(invoices),
          }),
        }),
      }),
    };
    const service = createService({ invoiceModel });

    const partial = await service.registrationPaidStudents('partial');
    const none = await service.registrationPaidStudents('none');

    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({
      amountDue: 3000,
      amountPaid: 500,
      balanceDue: 2500,
    });
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({
      amountDue: 3000,
      amountPaid: 0,
      balanceDue: 3000,
    });
  });

  it('renders the payment situation PDF in A4 landscape', async () => {
    const service = createService({
      ecolesService: {
        getCurrentSchoolName: jest
          .fn()
          .mockResolvedValue('Complexe scolaire Dunya'),
      },
    });

    const pdf = await service.renderRegistrationPaidPdf(
      [],
      'registration',
      '2026 – 2027',
    );
    const pdfSource = pdf.toString('latin1');

    expect(pdfSource).toContain('/MediaBox [0 0 841.89 595.28]');
  });

  it('builds the open-year nominal roll ordered by most recent registration first, with gender totals', async () => {
    const enrollmentModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                createdAt: new Date('2026-01-01T00:00:00Z'),
                studentId: {
                  lastname: 'Zongo',
                  firstname: 'Ali',
                  matricule: 'M2',
                  gender: 'M',
                },
              },
              {
                createdAt: new Date('2026-03-01T00:00:00Z'),
                studentId: {
                  lastname: 'Afidégnon',
                  firstname: 'Yawa',
                  matricule: 'M1',
                  gender: 'F',
                },
              },
              {
                createdAt: new Date('2026-02-01T00:00:00Z'),
                studentId: {
                  lastname: 'Zongo',
                  firstname: 'Abla',
                  matricule: 'M3',
                  gender: 'F',
                },
              },
            ]),
          }),
        }),
      }),
    };
    const levelModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ _id: 'level-1', label: 'CP1' }),
        }),
      }),
    };
    const schoolYearModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue({ _id: 'year-1', label: '2026 – 2027' }),
        }),
      }),
    };
    const ecolesService = {
      getCurrentSchoolName: jest
        .fn()
        .mockResolvedValue('Complexe scolaire Dunya'),
    };
    const service = createService({
      enrollmentModel,
      levelModel,
      schoolYearModel,
      ecolesService,
    });

    const result = await service.getNominalRoll('level-1');

    expect(result.students.map((student) => student.firstname)).toEqual([
      'Yawa',
      'Abla',
      'Ali',
    ]);
    expect(result).toMatchObject({
      levelName: 'CP1',
      boys: 1,
      girls: 2,
      total: 3,
    });
    expect(enrollmentModel.find).toHaveBeenCalledWith({
      levelId: 'level-1',
      schoolYearId: 'year-1',
      status: 'active',
    });
  });

  it('paginates a long nominal roll PDF without losing the A4 table', async () => {
    const service = createService();
    const pdf = await service.renderStudentListPdf({
      schoolName: 'Complexe scolaire Dunya',
      schoolYearLabel: '2026 – 2027',
      levelName: 'CP1',
      students: Array.from({ length: 60 }, (_, index) => ({
        lastname: `NOM ${String(index + 1).padStart(2, '0')}`,
        firstname: 'Prénom',
        matricule: `MAT-${String(index + 1).padStart(3, '0')}`,
        gender: index % 2 ? 'F' : 'M',
      })),
      boys: 30,
      girls: 30,
      total: 60,
    });

    expect(
      pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length,
    ).toBeGreaterThan(1);
    expect(pdf.length).toBeGreaterThan(5000);
  });

  describe('fiche de notes vierge (per-level grade sheet)', () => {
    const roll = {
      schoolName: 'Complexe scolaire Dunya',
      schoolYearLabel: '2026 – 2027',
      levelName: 'CP1',
      students: [
        {
          lastname: 'DIALLO',
          firstname: 'Awa',
          matricule: 'MAT-001',
          gender: 'F',
        },
        {
          lastname: 'TOURE',
          firstname: 'Ali',
          matricule: 'MAT-002',
          gender: 'M',
        },
      ],
      boys: 1,
      girls: 1,
      total: 2,
    };

    it('paginates a long grade sheet PDF, with every note column left blank', async () => {
      const service = createService();
      const longRoll = {
        ...roll,
        students: Array.from({ length: 60 }, (_, index) => ({
          lastname: `NOM ${String(index + 1).padStart(2, '0')}`,
          firstname: 'Prénom',
          matricule: `MAT-${String(index + 1).padStart(3, '0')}`,
          gender: index % 2 ? 'F' : 'M',
        })),
        boys: 30,
        girls: 30,
        total: 60,
      };

      const pdf = await service.renderGradeSheetPdf(longRoll);

      expect(
        pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length,
      ).toBeGreaterThan(1);
      expect(pdf.length).toBeGreaterThan(5000);
    });

    it('numbers every page without the footer itself silently appending blank extra pages', async () => {
      const service = createService();

      // The actual regression this guards against: writing "Page 1 / 1"
      // inside the bottom margin used to make pdfkit auto-paginate, so a
      // roster that fits on a single page ended up as 2 real PDF pages
      // (and a longer one gained one extra blank page per numbered page).
      const onePagePdf = await service.renderGradeSheetPdf(roll);
      expect(
        onePagePdf.toString('latin1').match(/\/Type \/Page\b/g)?.length,
      ).toBe(1);
    });

    it('le nombre de colonnes Note et Devoir est parametrable (Compo reste fixe)', async () => {
      const service = createService();

      // 0 notes, 3 devoirs (numbered, since there's more than one).
      const noNotesBuffer = await service.renderGradeSheetExcel(roll, {
        noteCount: 0,
        devoirCount: 3,
      });
      const noNotesWorkbook = new ExcelJS.Workbook();
      await noNotesWorkbook.xlsx.load(
        noNotesBuffer as unknown as ExcelJS.Buffer,
      );
      const noNotesSheet = noNotesWorkbook.worksheets[0];
      const noNotesHeader1 = (noNotesSheet.getRow(8).values as unknown[]).slice(
        1,
      );
      const noNotesHeader2 = (noNotesSheet.getRow(9).values as unknown[]).slice(
        1,
      );
      // No "Note *" column at all: straight from Sexe to the group header.
      // (ExcelJS repeats a merged cell's value across its whole span when
      // read back, hence only checking up to the first "Notes à saisir".)
      expect(noNotesHeader1.slice(0, 5)).toEqual([
        'N°',
        'Nom et prénoms',
        'Matricule',
        'Sexe',
        'Notes à saisir',
      ]);
      expect(noNotesHeader2.slice(4)).toEqual([
        'Interro 1',
        'Interro 2',
        'Devoir 1',
        'Devoir 2',
        'Devoir 3',
        'Compo',
      ]);

      // A single devoir stays the bare "Devoir" label (matches the
      // reference model), only numbered once there's more than one - and 3
      // notes are all present.
      const oneDevoirBuffer = await service.renderGradeSheetExcel(roll, {
        noteCount: 3,
        devoirCount: 1,
      });
      const oneDevoirWorkbook = new ExcelJS.Workbook();
      await oneDevoirWorkbook.xlsx.load(
        oneDevoirBuffer as unknown as ExcelJS.Buffer,
      );
      const oneDevoirSheet = oneDevoirWorkbook.worksheets[0];
      const header1 = (oneDevoirSheet.getRow(8).values as unknown[]).slice(1);
      const header2 = (oneDevoirSheet.getRow(9).values as unknown[]).slice(1);
      expect(header1.slice(0, 7)).toEqual([
        'N°',
        'Nom et prénoms',
        'Matricule',
        'Sexe',
        'Note 1',
        'Note 2',
        'Note 3',
      ]);
      expect(header2.slice(7)).toEqual([
        'Interro 1',
        'Interro 2',
        'Devoir',
        'Compo',
      ]);

      // Whatever the counts, every roster row still carries only real data
      // for its first four cells - the rest stay blank for hand-filling.
      const dataRow = oneDevoirSheet.getRow(10).values as unknown[];
      expect(dataRow.slice(1, 5)).toEqual([1, 'DIALLO Awa', 'MAT-001', 'F']);
    });

    it('le nombre de colonnes Interro est aussi parametrable', async () => {
      const service = createService();

      // 0 interros: straight from the default 2 notes to the default 1
      // devoir, no "Interro *" column between them at all.
      const zeroBuffer = await service.renderGradeSheetExcel(roll, {
        interroCount: 0,
      });
      const zeroWorkbook = new ExcelJS.Workbook();
      await zeroWorkbook.xlsx.load(zeroBuffer as unknown as ExcelJS.Buffer);
      const zeroSheet = zeroWorkbook.worksheets[0];
      const zeroHeader2 = (zeroSheet.getRow(9).values as unknown[]).slice(7);
      expect(zeroHeader2).toEqual(['Devoir', 'Compo']);

      // A single interro stays the bare "Interro" label (same rule as
      // "Devoir"), only numbered once there's more than one.
      const oneBuffer = await service.renderGradeSheetExcel(roll, {
        interroCount: 1,
      });
      const oneWorkbook = new ExcelJS.Workbook();
      await oneWorkbook.xlsx.load(oneBuffer as unknown as ExcelJS.Buffer);
      const oneSheet = oneWorkbook.worksheets[0];
      const oneHeader2 = (oneSheet.getRow(9).values as unknown[]).slice(7);
      expect(oneHeader2).toEqual(['Interro', 'Devoir', 'Compo']);

      // 4 interros, numbered.
      const fourBuffer = await service.renderGradeSheetExcel(roll, {
        interroCount: 4,
      });
      const fourWorkbook = new ExcelJS.Workbook();
      await fourWorkbook.xlsx.load(fourBuffer as unknown as ExcelJS.Buffer);
      const fourSheet = fourWorkbook.worksheets[0];
      const fourHeader2 = (fourSheet.getRow(9).values as unknown[]).slice(7);
      expect(fourHeader2).toEqual([
        'Interro 1',
        'Interro 2',
        'Interro 3',
        'Interro 4',
        'Devoir',
        'Compo',
      ]);
    });

    it('applique le meme nombre de colonnes Note/Devoir au PDF et au Word', async () => {
      const service = createService();

      const pdf = await service.renderGradeSheetPdf(roll, {
        noteCount: 4,
        devoirCount: 2,
      });
      // 4 notes + 2 devoirs (numbered) instead of the default 2 + 1 makes
      // for a wider table - just check it still renders a well-formed,
      // single-page PDF rather than something pdfkit choked on.
      expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1);

      const docx = await service.renderGradeSheetDocx(roll, {
        noteCount: 4,
        devoirCount: 2,
      });
      expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');
      expect(docx.length).toBeGreaterThan(1000);
    });

    it('builds the .xlsx sheet with real cell borders and the merged two-row "Notes à saisir" header', async () => {
      const service = createService();
      const buffer = await service.renderGradeSheetExcel(roll);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const sheet = workbook.worksheets[0];

      // Row 8 = "N° / Nom et prénoms / .../ Notes à saisir", row 9 = the
      // "Interro 1/2, Devoir, Compo" sub-header, row 10 = the first student.
      const headerRow1 = sheet.getRow(8).values as unknown[];
      const headerRow2 = sheet.getRow(9).values as unknown[];
      expect(headerRow1.slice(1, 8)).toEqual([
        'N°',
        'Nom et prénoms',
        'Matricule',
        'Sexe',
        'Note 1',
        'Note 2',
        'Notes à saisir',
      ]);
      expect(headerRow2.slice(7, 11)).toEqual([
        'Interro 1',
        'Interro 2',
        'Devoir',
        'Compo',
      ]);

      // The roster is real data; the note columns stay blank.
      const dataRow1 = sheet.getRow(10).values as unknown[];
      expect(dataRow1.slice(1, 5)).toEqual([1, 'DIALLO Awa', 'MAT-001', 'F']);
      expect(dataRow1[5]).toBeUndefined();

      // The whole reason this renderer uses exceljs instead of xlsx: real
      // borders on every table cell, header and data alike.
      expect(sheet.getCell(8, 1).border?.top?.style).toBe('thin');
      expect(sheet.getCell(10, 1).border?.top?.style).toBe('thin');

      // Merges: the six lone headers span both header rows, and "Notes à
      // saisir" spans its four sub-columns.
      expect(sheet.getCell(8, 2).isMerged).toBe(true);
      expect(sheet.getCell(9, 2).isMerged).toBe(true);
      expect(sheet.getCell(8, 10).isMerged).toBe(true);
    });

    it('produces a real .docx (zip) file for the same grade sheet', async () => {
      const service = createService();
      const buffer = await service.renderGradeSheetDocx(roll);

      // "PK\x03\x04" - every .docx is a zip archive.
      expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
      expect(buffer.length).toBeGreaterThan(1000);
    });
  });

  describe('ReportsService.getExamStatistics', () => {
    function buildModels() {
      const schoolYearModel = {
        findById: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ label: '2025-2026' }),
          }),
        }),
      };
      const levelModel = {
        findById: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ label: 'CM2' }),
          }),
        }),
      };
      const noteModel = {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'subject-1',
              total: 4,
              lt5: 0,
              lt8: 1,
              lt10: 1,
              lt12: 2,
              lt14: 3,
              lt16: 3,
              lt18: 4,
              lte20: 4,
              passCount: 3,
            },
          ]),
        }),
      };
      const subjectModel = {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest
              .fn()
              .mockResolvedValue([{ _id: 'subject-1', label: 'Français' }]),
          }),
        }),
      };
      const enrollmentModel = {
        find: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest
                .fn()
                .mockResolvedValue([
                  { studentId: { gender: 'M' } },
                  { studentId: { gender: 'M' } },
                  { studentId: { gender: 'F' } },
                ]),
            }),
          }),
        }),
      };
      const bulletinResultModel = {
        find: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                { studentId: { gender: 'M' }, moyenneGenerale: 12 },
                { studentId: { gender: 'M' }, moyenneGenerale: 8 },
                { studentId: { gender: 'F' }, moyenneGenerale: 14 },
              ]),
            }),
          }),
        }),
      };
      const ecolesService = {
        getCurrentSchoolName: jest.fn().mockResolvedValue('Ecole Test'),
      };
      return {
        schoolYearModel,
        levelModel,
        noteModel,
        subjectModel,
        enrollmentModel,
        bulletinResultModel,
        ecolesService,
      };
    }

    const YEAR_ID = '507f1f77bcf86cd799439011';
    const LEVEL_ID = '507f1f77bcf86cd799439012';

    it('calcule la repartition des moyennes par matiere et les effectifs par sexe pour une classe precise', async () => {
      const models = buildModels();
      const service = createService(models);

      const result = await service.getExamStatistics(
        YEAR_ID,
        'trimestre_1' as never,
        LEVEL_ID,
      );

      expect(models.noteModel.aggregate).toHaveBeenCalled();
      expect(models.levelModel.findById).toHaveBeenCalledWith(LEVEL_ID);
      expect(result.levelName).toBe('CM2');
      expect(result.subjects).toEqual([
        expect.objectContaining({
          label: 'Français',
          lt5: 0,
          lt8: 1,
          lt10: 1,
          passCount: 3,
          total: 4,
          successRate: 75,
        }),
      ]);
      // 3 eleves inscrits (2 G, 1 F) ; 3 presents (2 G, 1 F) ; admis (>=10) :
      // le garcon a 12 passe, celui a 8 echoue, la fille a 14 passe.
      expect(result.inscrits).toEqual({ g: 2, f: 1, t: 3 });
      expect(result.presents).toEqual({ g: 2, f: 1, t: 3 });
      expect(result.admis).toEqual({ g: 1, f: 1, t: 2 });
      expect(result.successRate).toEqual({ g: 50, f: 100, t: 66.7 });
    });

    it('ne filtre par aucun niveau quand levelId est omis (statistiques toutes classes confondues)', async () => {
      const models = buildModels();
      const service = createService(models);

      const result = await service.getExamStatistics(
        YEAR_ID,
        'trimestre_1' as never,
      );

      expect(models.levelModel.findById).not.toHaveBeenCalled();
      expect(result.levelName).toBe('Toutes les classes');
      const aggregateCalls = models.noteModel.aggregate.mock.calls as Array<
        [Array<{ $match: Record<string, unknown> }>]
      >;
      expect(aggregateCalls[0][0][0].$match.levelId).toBeUndefined();
    });

    it("leve une BadRequestException si l'annee scolaire est introuvable", async () => {
      const models = buildModels();
      models.schoolYearModel.findById = jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });
      const service = createService(models);

      await expect(
        service.getExamStatistics('missing-year', 'trimestre_1' as never),
      ).rejects.toThrow('Annee scolaire introuvable');
    });
  });
});
