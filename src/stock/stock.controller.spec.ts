import { Response } from 'express';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockCategory, StockMovementType } from '../common/enums/domain.enums';

function buildController(overrides: { stockService?: Partial<StockService> }) {
  const stockService = {
    list: jest.fn().mockResolvedValue([]),
    exportRows: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ _id: 'item-1' }),
    update: jest.fn().mockResolvedValue({ _id: 'item-1' }),
    findById: jest.fn().mockResolvedValue({ _id: 'item-1', name: 'Craie' }),
    listMovements: jest.fn().mockResolvedValue([]),
    recordMovement: jest.fn().mockResolvedValue({ _id: 'mov-1' }),
    ...overrides.stockService,
  };
  return new StockController(stockService as unknown as StockService);
}

describe('StockController.index', () => {
  it('transmet les filtres de la requete au service', async () => {
    const stockService = { list: jest.fn().mockResolvedValue([]) };
    const controller = buildController({ stockService });

    const result = await controller.index({
      q: 'craie',
      category: StockCategory.PEDAGOGIQUE,
    });

    expect(stockService.list).toHaveBeenCalledWith({
      q: 'craie',
      category: StockCategory.PEDAGOGIQUE,
    });
    expect(result.filters).toEqual({
      q: 'craie',
      category: StockCategory.PEDAGOGIQUE,
    });
  });
});

describe('StockController.detail', () => {
  it("assemble l'article et son historique de mouvements", async () => {
    const stockService = {
      findById: jest.fn().mockResolvedValue({ _id: 'item-1', name: 'Craie' }),
      listMovements: jest.fn().mockResolvedValue([{ _id: 'mov-1' }]),
    };
    const controller = buildController({ stockService });

    const result = await controller.detail('item-1');

    expect(stockService.findById).toHaveBeenCalledWith('item-1');
    expect(stockService.listMovements).toHaveBeenCalledWith('item-1');
    expect(result.item).toEqual({ _id: 'item-1', name: 'Craie' });
    expect(result.movements).toEqual([{ _id: 'mov-1' }]);
    expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('StockController.recordMovement', () => {
  it("appelle le service avec l'auteur courant et redirige vers la fiche de l'article", async () => {
    const stockService = {
      recordMovement: jest.fn().mockResolvedValue({ _id: 'mov-1' }),
    };
    const controller = buildController({ stockService });
    const redirect = jest.fn();
    const res = { redirect } as unknown as Response;
    const req = { session: {} } as unknown as import('express').Request;
    const dto = {
      type: StockMovementType.SORTIE,
      quantity: 2,
      reason: 'Distribution CP1',
      date: '2026-10-06',
    };

    await controller.recordMovement('item-1', dto, req, res, {
      id: 'user-1',
      name: 'Secretariat',
      email: 's@ecole.local',
      role: 'secretariat' as never,
      ecoleId: 'ecole-1',
    });

    expect(stockService.recordMovement).toHaveBeenCalledWith(
      'item-1',
      dto,
      'user-1',
    );
    expect(redirect).toHaveBeenCalledWith('/stock/item-1');
  });
});
