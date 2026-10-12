import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { getTenantStore } from '../common/tenant/tenant-context';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async log(
    payload: {
      schoolYearId?: string;
      actorId?: string;
      action: string;
      entityType: string;
      entityId: string;
      details?: Record<string, unknown>;
    },
    session?: ClientSession,
  ) {
    const store = getTenantStore();
    const created = await this.auditLogModel.create(
      [
        {
          ...payload,
          ecoleId: store?.bypass ? null : (store?.ecoleId ?? null),
          details: payload.details ?? {},
        },
      ],
      { session },
    );
    return created[0];
  }

  async findByEntityTypes(entityTypes: string[], entityId: string) {
    const store = getTenantStore();
    const filter: Record<string, unknown> = {
      entityType: { $in: entityTypes },
      entityId,
    };
    if (!store?.bypass && store?.ecoleId) {
      filter.ecoleId = store.ecoleId;
    }

    return this.auditLogModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  private buildActionFilter(
    actions: string[],
    filters: {
      schoolYearId?: string;
      entityIds?: string[];
      dateFrom?: Date;
      dateTo?: Date;
    } = {},
  ) {
    const store = getTenantStore();
    const filter: Record<string, unknown> = { action: { $in: actions } };
    if (!store?.bypass && store?.ecoleId) {
      filter.ecoleId = store.ecoleId;
    }
    if (filters.schoolYearId) {
      filter.schoolYearId = filters.schoolYearId;
    }
    if (filters.entityIds) {
      filter.entityId = { $in: filters.entityIds };
    }
    if (filters.dateFrom || filters.dateTo) {
      filter.createdAt = {
        ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { $lte: filters.dateTo } : {}),
      };
    }
    return filter;
  }

  // Powers the global "historique des modifications de paiement" page: every
  // entry there is, deliberately, an audit log written only when a payment is
  // actually corrected (see EnrollmentsService.updateFinancialDetails and
  // PaymentsService.applyLedgerCorrections) - never one written just for
  // viewing or creating a fresh payment.
  async listByAction(
    actions: string[],
    filters: {
      schoolYearId?: string;
      entityIds?: string[];
      dateFrom?: Date;
      dateTo?: Date;
    } = {},
    options: { page?: number; pageSize?: number } = {},
  ) {
    const filter = this.buildActionFilter(actions, filters);
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 20));

    const [total, logs] = await Promise.all([
      this.auditLogModel.countDocuments(filter).exec(),
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return { logs, total, page, pageSize };
  }

  async countByAction(
    actions: string[],
    filters: {
      schoolYearId?: string;
      entityIds?: string[];
      dateFrom?: Date;
      dateTo?: Date;
    } = {},
  ) {
    return this.auditLogModel
      .countDocuments(this.buildActionFilter(actions, filters))
      .exec();
  }
}
