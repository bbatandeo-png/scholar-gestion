import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type LicenseStateDocument = HydratedDocument<LicenseState>;

// One row per ecole - overwritten in place on renewal (unlike EcoleModule,
// there's no need to keep a full history of past license periods here; the
// audit log already records every renewal via AuditAction.LICENSE_RENEWED).
@Schema({ timestamps: true, collection: 'license_states' })
export class LicenseState {
  // The full signed token last applied, kept verbatim for traceability -
  // expiresAt below is only ever derived from a token that passed
  // verifyLicenseToken().
  @Prop({ required: true })
  token: string;

  @Prop({ required: true })
  expiresAt: Date;

  // Anti-clock-rollback ratchet: the latest "effective now" this ecole's
  // install has ever computed, mirrored to a local file outside MongoDB (see
  // LicensingService) so that restoring an old mongodump backup - a normal,
  // documented maintenance operation for this app - can't quietly rewind the
  // license state along with the data.
  @Prop({ required: true })
  maxSeenDate: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  lastRenewedBy: Types.ObjectId | null;
}

export const LicenseStateSchema = SchemaFactory.createForClass(LicenseState);
LicenseStateSchema.plugin(ecoleScopePlugin, { skipPlainIndex: true });
LicenseStateSchema.index({ ecoleId: 1 }, { unique: true });
