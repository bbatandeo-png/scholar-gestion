import { Connection, Model } from 'mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StockService } from './stock.service';
import { StockItem } from './schemas/stock-item.schema';
import { StockMovement } from './schemas/stock-movement.schema';
import { StockCategory, StockMovementType } from '../common/enums/domain.enums';

function buildConnection() {
  const session = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    startSession: jest.fn().mockResolvedValue(session),
  } as unknown as Connection;
  return { connection, session };
}

describe('StockService.create / update', () => {
  it('cree un article', async () => {
    const create = jest.fn().mockResolvedValue({ _id: 'item-1' });
    const { connection } = buildConnection();
    const service = new StockService(
      { create } as unknown as Model<StockItem>,
      {} as unknown as Model<StockMovement>,
      connection,
    );

    await service.create({
      name: 'Craie',
      category: StockCategory.PEDAGOGIQUE,
      unit: 'boîte',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Craie', unit: 'boîte' }),
    );
  });

  it('refuse un nom deja utilise avec un message clair (ConflictException)', async () => {
    const create = jest.fn().mockRejectedValue({ code: 11000 });
    const { connection } = buildConnection();
    const service = new StockService(
      { create } as unknown as Model<StockItem>,
      {} as unknown as Model<StockMovement>,
      connection,
    );

    await expect(
      service.create({
        name: 'Craie',
        category: StockCategory.PEDAGOGIQUE,
        unit: 'boîte',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse la mise a jour d'un article introuvable", async () => {
    const findByIdAndUpdate = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const { connection } = buildConnection();
    const service = new StockService(
      { findByIdAndUpdate } as unknown as Model<StockItem>,
      {} as unknown as Model<StockMovement>,
      connection,
    );

    await expect(
      service.update('missing', {
        name: 'Craie',
        category: StockCategory.PEDAGOGIQUE,
        unit: 'boîte',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('StockService.list', () => {
  it('filtre par categorie et recherche, et calcule isLow a partir du seuil', async () => {
    const items = [
      { name: 'Craie', quantity: 2, alertThreshold: 5 },
      { name: 'Ramette A4', quantity: 50, alertThreshold: 10 },
      { name: 'Stylo', quantity: 3 },
    ];
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(items),
        }),
      }),
    });
    const { connection } = buildConnection();
    const service = new StockService(
      { find } as unknown as Model<StockItem>,
      {} as unknown as Model<StockMovement>,
      connection,
    );

    const result = await service.list({
      category: StockCategory.PEDAGOGIQUE,
      q: 'cr',
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ category: StockCategory.PEDAGOGIQUE }),
    );
    expect(result.map((r) => [r.name, r.isLow])).toEqual([
      ['Craie', true],
      ['Ramette A4', false],
      ['Stylo', false],
    ]);
  });
});

describe('StockService.recordMovement', () => {
  function buildService(item: { quantity: number; unit: string }) {
    const save = jest.fn().mockResolvedValue(undefined);
    const itemDoc = { ...item, _id: 'item-1', save };
    const findById = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(itemDoc),
      }),
    });
    const create = jest.fn().mockResolvedValue([{ _id: 'mov-1' }]);
    const { connection } = buildConnection();
    const service = new StockService(
      { findById } as unknown as Model<StockItem>,
      { create } as unknown as Model<StockMovement>,
      connection,
    );
    return { service, itemDoc, save, create };
  }

  it('une ENTREE augmente la quantite et cree le mouvement', async () => {
    const { service, itemDoc, save, create } = buildService({
      quantity: 10,
      unit: 'boîte',
    });

    const result = await service.recordMovement(
      'item-1',
      {
        type: StockMovementType.ENTREE,
        quantity: 5,
        reason: 'Achat',
        date: '2026-10-06',
      },
      'user-1',
    );

    expect(itemDoc.quantity).toBe(15);
    expect(save).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          itemId: 'item-1',
          type: StockMovementType.ENTREE,
          quantity: 5,
          reason: 'Achat',
          recordedBy: 'user-1',
        }),
      ],
      expect.anything(),
    );
    expect(result).toEqual({ _id: 'mov-1' });
  });

  it('une SORTIE diminue la quantite quand le stock est suffisant', async () => {
    const { service, itemDoc } = buildService({ quantity: 10, unit: 'unité' });

    await service.recordMovement('item-1', {
      type: StockMovementType.SORTIE,
      quantity: 4,
      reason: 'Distribution CP1',
      date: '2026-10-06',
    });

    expect(itemDoc.quantity).toBe(6);
  });

  it('refuse une SORTIE qui ferait passer le stock sous zero, sans creer de mouvement', async () => {
    const { service, itemDoc, save, create } = buildService({
      quantity: 3,
      unit: 'unité',
    });

    await expect(
      service.recordMovement('item-1', {
        type: StockMovementType.SORTIE,
        quantity: 10,
        reason: 'Distribution CP1',
        date: '2026-10-06',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(itemDoc.quantity).toBe(3);
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuse un mouvement sur un article introuvable', async () => {
    const findById = jest.fn().mockReturnValue({
      session: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });
    const { connection } = buildConnection();
    const service = new StockService(
      { findById } as unknown as Model<StockItem>,
      {} as unknown as Model<StockMovement>,
      connection,
    );

    await expect(
      service.recordMovement('missing', {
        type: StockMovementType.ENTREE,
        quantity: 1,
        reason: 'Achat',
        date: '2026-10-06',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
