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
}
