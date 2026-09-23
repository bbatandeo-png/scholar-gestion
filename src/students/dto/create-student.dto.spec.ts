// class-validator's decorators read TypeScript's emitted design-time type
// metadata via Reflect.getMetadata - normally polyfilled as a side effect
// of importing @nestjs/core/common (as every e2e test does via AppModule).
// This spec imports the DTO directly with nothing else pulling Nest in, so
// it has to load the polyfill itself, first.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStudentDto } from './create-student.dto';

// Mirrors what the real request pipeline does (main.ts's global
// ValidationPipe({ transform: true })) on a plain form body - a raw object,
// never a CreateStudentDto instance directly, so the @Transform on
// birthDate only ever runs through this path.
async function validateBody(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateStudentDto, body);
  return validate(dto);
}

describe('CreateStudentDto', () => {
  const minimalRequired = {
    lastname: 'Kodjo',
    firstname: 'Ama',
    gender: 'F',
  };

  it('accepte un eleve sans date de naissance, lieu de naissance ni quartier (champs absents)', async () => {
    const errors = await validateBody(minimalRequired);
    expect(errors).toHaveLength(0);
  });

  it('accepte une date de naissance vide (\'\') envoyee par un <input type="date"> laisse vide', async () => {
    const errors = await validateBody({
      ...minimalRequired,
      birthDate: '',
      birthPlace: '',
      district: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('refuse toujours une date de naissance mal formee quand une valeur est fournie', async () => {
    const errors = await validateBody({
      ...minimalRequired,
      birthDate: 'pas-une-date',
    });
    expect(errors.some((e) => e.property === 'birthDate')).toBe(true);
  });

  it('accepte une date de naissance valide', async () => {
    const errors = await validateBody({
      ...minimalRequired,
      birthDate: '2015-03-20',
    });
    expect(errors).toHaveLength(0);
  });

  it('refuse toujours les champs reellement obligatoires manquants', async () => {
    const errors = await validateBody({});
    const invalidProperties = errors.map((e) => e.property).sort();
    expect(invalidProperties).toEqual(['firstname', 'gender', 'lastname']);
  });

  it('refuse un genre hors M/F', async () => {
    const errors = await validateBody({ ...minimalRequired, gender: 'X' });
    expect(errors.some((e) => e.property === 'gender')).toBe(true);
  });
});
