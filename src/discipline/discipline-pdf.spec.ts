import { DisciplineRecordType } from '../common/enums/domain.enums';
import { renderDisciplinePdf } from './discipline-pdf';

function pageCount(pdf: Buffer) {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

describe('renderDisciplinePdf', () => {
  it('produit un PDF meme sans entree', async () => {
    const pdf = await renderDisciplinePdf({
      schoolName: 'Ecole Test',
      filters: [],
      records: [],
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
  });

  it('passe sur plusieurs pages quand le journal est long, motifs longs compris', async () => {
    const records = Array.from({ length: 60 }, (_, index) => ({
      date: new Date('2026-10-06'),
      type: DisciplineRecordType.SANCTION,
      motif: `Motif detaille numero ${index} `.repeat(4),
      mesure: 'Retenue',
      studentId: { lastname: 'ADJO', firstname: 'Koffi', matricule: 'M001' },
      schoolYearId: { label: '2026-2027' },
      recordedBy: { name: 'Direction' },
    }));
    const pdf = await renderDisciplinePdf({
      schoolName: 'Ecole Test',
      filters: ['Type : Sanction'],
      records,
    });
    expect(pageCount(pdf)).toBeGreaterThan(1);
  });
});
