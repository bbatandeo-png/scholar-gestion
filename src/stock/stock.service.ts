import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { StockMovementType } from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { RecordStockMovementDto } from './dto/record-stock-movement.dto';
import { SearchStockItemsDto } from './dto/search-stock-items.dto';
import { StockItem } from './schemas/stock-item.schema';
import { StockMovement } from './schemas/stock-movement.schema';

@Injectable()
export class StockService {
  constructor(
    @InjectModel(StockItem.name) private readonly itemModel: Model<StockItem>,
    @InjectModel(StockMovement.name)
    private readonly movementModel: Model<StockMovement>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async list(filters: SearchStockItemsDto = {}) {
    const query: Record<string, unknown> = {};
    if (filters.category) query.category = filters.category;
    if (filters.q) {
      query.name = { $regex: this.escapeRegExp(filters.q), $options: 'i' };
    }
    const items = await this.itemModel
      .find(query)
      .sort({ name: 1 })
      .lean()
      .exec();
    return items.map((item) => ({
      ...item,
      isLow:
        typeof item.alertThreshold === 'number' &&
        item.quantity <= item.alertThreshold,
    }));
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async findById(id: string) {
    const item = await this.itemModel.findById(id).lean().exec();
    if (!item) {
      throw new NotFoundException('Article introuvable');
    }
    return item;
  }

  async create(dto: CreateStockItemDto) {
    try {
      return await this.itemModel.create({
        name: dto.name,
        category: dto.category,
        unit: dto.unit,
        alertThreshold: dto.alertThreshold,
        location: dto.location,
        notes: dto.notes,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: number }).code === 11000
      ) {
        throw new ConflictException('Un article avec ce nom existe déjà');
      }
      throw error;
    }
  }

  async update(id: string, dto: CreateStockItemDto) {
    const updated = await this.itemModel
      .findByIdAndUpdate(
        id,
        {
          name: dto.name,
          category: dto.category,
          unit: dto.unit,
          alertThreshold: dto.alertThreshold,
          location: dto.location,
          notes: dto.notes,
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Article introuvable');
    }
    return updated;
  }

  async listMovements(itemId: string) {
    return this.movementModel
      .find({ itemId })
      .populate('recordedBy')
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec();
  }

  // Creates the ledger entry and updates the item's running quantity in the
  // same transaction (falls back to sequential writes outside a replica set
  // - see runWithMongoTransactionFallback) so the two never drift apart. A
  // SORTIE that would take the item negative is refused outright rather
  // than clamped, the same way a payment can't exceed what's owed.
  async recordMovement(
    itemId: string,
    dto: RecordStockMovementDto,
    actorId?: string,
  ) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const item = await this.itemModel
        .findById(itemId)
        .session(session ?? null)
        .exec();
      if (!item) {
        throw new NotFoundException('Article introuvable');
      }

      const delta =
        dto.type === StockMovementType.ENTREE ? dto.quantity : -dto.quantity;
      const nextQuantity = item.quantity + delta;
      if (nextQuantity < 0) {
        throw new BadRequestException(
          `Stock insuffisant : ${item.quantity} ${item.unit} disponible(s)`,
        );
      }

      item.quantity = nextQuantity;
      await item.save({ session: session ?? undefined });

      const [movement] = await this.movementModel.create(
        [
          {
            itemId,
            type: dto.type,
            quantity: dto.quantity,
            reason: dto.reason,
            date: new Date(dto.date),
            recordedBy: actorId,
          },
        ],
        { session: session ?? undefined },
      );

      return movement;
    });
  }

  async exportRows() {
    const items = await this.list();
    return items.map((item) => ({
      nom: item.name,
      categorie: item.category,
      quantite: item.quantity,
      unite: item.unit,
      seuil_alerte: item.alertThreshold ?? '',
      emplacement: item.location ?? '',
    }));
  }
}
