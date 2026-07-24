import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

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
    const created = await this.auditLogModel.create(
      [
        {
          ...payload,
          details: payload.details ?? {},
        },
      ],
      { session },
    );
    return created[0];
  }

  async findByEntityTypes(entityTypes: string[], entityId: string) {
    return this.auditLogModel
      .find({ entityType: { $in: entityTypes }, entityId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }
}
