import PDFDocument from 'pdfkit';
import { ENUM_META } from '../common/view-helpers/enum-meta';
import { formatDay } from '../common/view-helpers/format-day';

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;

// Shape of a journal entry once populated by DisciplineService.listAll().
export type DisciplinePdfRecord = {
  date?: Date | string;
  type?: string;
  motif?: string;
  mesure?: string;
  studentId?: { lastname?: string; firstname?: string; matricule?: string };
  schoolYearId?: { label?: string };
  recordedBy?: { name?: string };
};

const HEADERS = [
  'N°',
  'Date',
  'Élève',
  'Matricule',
  'Année',
  'Type',
  'Motif',
  'Mesure',
  'Enregistré par',
];
// A4 paysage (842 pt) moins 2 x 40 pt de marge = 762 pt.
const WIDTHS = [30, 62, 130, 70, 65, 75, 150, 100, 80];
const PADDING = 4;
const MIN_ROW_HEIGHT = 18;

function typeLabel(type?: string) {
  return (type && ENUM_META.disciplineRecordType[type]?.label) ?? type ?? '';
}

function renderHeader(
  doc: PdfDocumentInstance,
  schoolName: string,
  filters: string[],
) {
  if (schoolName.trim()) {
    doc
      .font('Times-Bold')
      .fontSize(16)
      .text(schoolName.trim().toUpperCase(), { align: 'center' });
  }
  doc
    .font('Times-Bold')
    .fontSize(14)
    .text('Journal de discipline', { align: 'center' });
  doc.moveDown(0.3);
  doc
    .font('Times-Roman')
    .fontSize(9)
    .text(
      filters.length
        ? `Filtres : ${filters.join(' · ')}`
        : 'Toutes les entrées',
      {
        align: 'left',
      },
    );
  doc.text(`Édité le ${formatDay(new Date())}`, { align: 'right' });
  doc.moveDown(0.5);
}

// Liste imprimable du journal : les lignes s'agrandissent pour un motif
// long au lieu de le tronquer, et l'en-tete est repete sur chaque page.
export function renderDisciplinePdf(options: {
  schoolName: string;
  filters: string[];
  records: DisciplinePdfRecord[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  return new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const startX = doc.page.margins.left;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

    const drawCells = (values: string[], bold: boolean) => {
      doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(9);
      const height = Math.max(
        MIN_ROW_HEIGHT,
        ...values.map(
          (value, index) =>
            doc.heightOfString(value, { width: WIDTHS[index] - PADDING * 2 }) +
            PADDING * 2,
        ),
      );
      if (doc.y + height > bottomLimit()) {
        doc.addPage();
        renderHeader(doc, options.schoolName, options.filters);
        if (!bold) {
          drawCells(HEADERS, true);
        }
      }
      const y = doc.y;
      let x = startX;
      values.forEach((value, index) => {
        if (bold) {
          doc
            .rect(x, y, WIDTHS[index], height)
            .fillAndStroke('#F0F0F0', '#000');
        } else {
          doc.rect(x, y, WIDTHS[index], height).stroke('#000');
        }
        doc.fillColor('#000').text(value, x + PADDING, y + PADDING, {
          width: WIDTHS[index] - PADDING * 2,
        });
        x += WIDTHS[index];
      });
      doc.y = y + height;
      doc.x = startX;
    };

    renderHeader(doc, options.schoolName, options.filters);
    drawCells(HEADERS, true);
    options.records.forEach((record, index) => {
      const student = record.studentId;
      drawCells(
        [
          String(index + 1),
          formatDay(record.date),
          student
            ? `${student.lastname ?? ''} ${student.firstname ?? ''}`.trim()
            : '',
          student?.matricule ?? '',
          record.schoolYearId?.label ?? '',
          typeLabel(record.type),
          record.motif ?? '',
          record.mesure || '—',
          record.recordedBy?.name ?? '—',
        ],
        false,
      );
    });
    if (!options.records.length) {
      doc.moveDown(0.5);
      doc
        .font('Times-Italic')
        .fontSize(10)
        .text('Aucune entrée au journal de discipline.');
    }
    doc.moveDown(0.5);
    doc
      .font('Times-Bold')
      .fontSize(10)
      .text(`Total : ${options.records.length} entrée(s)`, startX, doc.y, {
        align: 'right',
      });
    doc.end();
  });
}
