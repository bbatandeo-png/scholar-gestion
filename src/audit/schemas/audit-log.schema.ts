import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

// Deliberately NOT scoped by ecoleScopePlugin: some events (e.g. a
// PLATFORM_ADMIN login, or platform-level Ecole management) have no ecoleId
// at all, so the field can't be `required: true`. AuditService stamps
// ecoleId from the tenant context when one is active (see audit.service.ts)
// and filters reads by it manually instead of relying on the plugin.
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'audit_logs',
})
export class AuditLog {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Ecole', index: true })
  ecoleId?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', index: true })
  schoolYearId?: string;

  @Prop({ type: SchemaTypes.ObjectId, required: false })
  actorId?: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  entityType: string;

  @Prop({ required: true })
  entityId: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  details: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
