import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStockItemDto } from './create-stock-item.dto';
import { StockCategory } from '../../common/enums/domain.enums';

// Mirrors what the real request pipeline does (main.ts's global
// ValidationPipe({ transform: true })) on a plain form body.
function transformBody(body: Record<string, unknown>) {
  return plainToInstance(CreateStockItemDto, body);
}
async function validateBody(body: Record<string, unknown>) {
  return validate(transformBody(body));
}

describe('CreateStockItemDto', () => {
  const minimalRequired = {
    name: 'Craie blanche',
    category: StockCategory.PEDAGOGIQUE,
    unit: 'boîte',
  };

  it('accepte un article sans seuil, emplacement ni notes (champs absents)', async () => {
    const errors = await validateBody(minimalRequired);
    expect(errors).toHaveLength(0);
  });

  // Regression test: a blank <input type="number" name="alertThreshold">
  // submits '' - this must become "no threshold" (undefined), not a
  // stored alertThreshold of 0, which would make every brand new item
  // (quantity 0) immediately show as "en alerte". See the DTO's own
  // comment on why @Type(() => Number) + a separate emptyToUndefined
  // transform silently produced exactly that bug (Number('') === 0).
  it("convertit un seuil d'alerte vide ('') en absence de seuil, pas en 0", async () => {
    const dto = transformBody({ ...minimalRequired, alertThreshold: '' });
    expect(dto.alertThreshold).toBeUndefined();

    const errors = await validateBody({
      ...minimalRequired,
      alertThreshold: '',
    });
    expect(errors).toHaveLength(0);
  });

  it("convertit un seuil d'alerte renseigne ('5') en nombre", async () => {
    const dto = transformBody({ ...minimalRequired, alertThreshold: '5' });
    expect(dto.alertThreshold).toBe(5);

    const errors = await validateBody({
      ...minimalRequired,
      alertThreshold: '5',
    });
    expect(errors).toHaveLength(0);
  });

  it('refuse un seuil negatif', async () => {
    const errors = await validateBody({
      ...minimalRequired,
      alertThreshold: '-1',
    });
    expect(errors).not.toHaveLength(0);
  });

  it('refuse un nom vide', async () => {
    const errors = await validateBody({ ...minimalRequired, name: '' });
    expect(errors).not.toHaveLength(0);
  });
});
