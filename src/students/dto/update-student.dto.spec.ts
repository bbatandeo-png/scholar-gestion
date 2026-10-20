// Voir create-student.dto.spec.ts : le DTO est importe seul, le polyfill
// des metadonnees doit donc etre charge en premier.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStudentDto } from './update-student.dto';

// Meme chemin que la requete reelle (ValidationPipe({ transform: true }) sur
// le corps brut du formulaire de la fiche eleve).
async function validateBody(body: Record<string, unknown>) {
  return validate(plainToInstance(UpdateStudentDto, body));
}

describe('UpdateStudentDto', () => {
  it('accepte l enregistrement d un eleve sans date de naissance (champ date laisse vide)', async () => {
    // Regression : "birthDate must be a valid ISO 8601 date string" sur la
    // fiche d'un eleve cree sans date de naissance.
    const errors = await validateBody({
      lastname: 'BAT',
      firstname: 'Baour',
      gender: 'M',
      birthDate: '',
      birthPlace: '',
      district: '',
      levelId: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepte une date de naissance valide et refuse toujours une date mal formee', async () => {
    expect(await validateBody({ birthDate: '2015-03-20' })).toHaveLength(0);
    const errors = await validateBody({ birthDate: 'pas-une-date' });
    expect(errors.some((e) => e.property === 'birthDate')).toBe(true);
  });
});
