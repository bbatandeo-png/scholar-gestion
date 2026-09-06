import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEcoleDto } from './create-ecole.dto';
import { UpdateEcoleDto } from './update-ecole.dto';

describe('CreateEcoleDto / UpdateEcoleDto - optional email/date left blank', () => {
  it('accepte un champ email vide (formulaire HTML sans valeur) sur la creation', async () => {
    const dto = plainToInstance(CreateEcoleDto, {
      nom: 'Ecole Test',
      adminName: 'Admin',
      adminEmail: 'admin@example.com',
      email: '',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepte un champ email vide sur la mise a jour', async () => {
    const dto = plainToInstance(UpdateEcoleDto, { email: '' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepte un champ dateFinEssai vide sur la mise a jour', async () => {
    const dto = plainToInstance(UpdateEcoleDto, { dateFinEssai: '' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejette toujours un email reellement invalide', async () => {
    const dto = plainToInstance(CreateEcoleDto, {
      nom: 'Ecole Test',
      adminName: 'Admin',
      adminEmail: 'admin@example.com',
      email: 'not-an-email',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
