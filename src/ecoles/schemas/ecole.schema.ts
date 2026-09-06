import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EcoleAccountStatus } from '../../common/enums/domain.enums';

export type EcoleDocument = HydratedDocument<Ecole>;

@Schema({ timestamps: true, collection: 'ecoles' })
export class Ecole {
  @Prop({ required: true, trim: true, index: true })
  nom: string;

  @Prop({ trim: true })
  logo?: string;

  @Prop({ trim: true })
  ministereTutelle?: string;

  @Prop({ trim: true })
  dre?: string;

  @Prop({ trim: true })
  inspection?: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  contact?: string;

  @Prop({ trim: true })
  localite?: string;

  // Hex color (e.g. "#eef2fb"), optional - applied to the header band of
  // the student ID card in place of the default pale blue. Left unset
  // (undefined), never an empty string, so callers can use a plain
  // truthiness check to decide whether to fall back to the default.
  @Prop({ trim: true })
  couleurCarte?: string;

  // Same idea as couleurCarte, but for the notes table's header row on the
  // bulletin PDF (BulletinsService.renderBulletinPage) - a separate field
  // since a school may reasonably want a different color for each
  // document.
  @Prop({ trim: true })
  couleurBulletin?: string;

  @Prop({
    required: true,
    enum: Object.values(EcoleAccountStatus),
    default: EcoleAccountStatus.ESSAI,
  })
  statutCompte: EcoleAccountStatus;

  @Prop({ trim: true })
  planSouscrit?: string;

  @Prop()
  dateFinEssai?: Date;

  @Prop({ required: true, default: Date.now })
  dateInscription: Date;

  // Manual bookkeeping only - never read by the real enforcement mechanism
  // (LicenseState, checked locally by each install itself). This is purely
  // for the vendor's own tracking across every client from /platform/ecoles:
  // there is no live link between an online instance of this screen and any
  // client's offline local database, so these fields have to be filled in
  // by hand (or auto-filled locally right after a local generation - see
  // EcolesController) rather than kept in sync automatically.
  @Prop({ trim: true })
  releaseVersion?: string;

  @Prop()
  licenseActivatedAt?: Date;

  @Prop()
  licenseExpiresAt?: Date;

  @Prop({ trim: true })
  licenseActivationKey?: string;

  // Generated once, on the first "Telecharger le pack d'installation" click
  // (EcolesService.ensureProvisioningSecrets), then reused on every later
  // download for this ecole - never regenerated silently. A fresh
  // SESSION_SECRET/LICENSE_SECRET on every download would mean re-deploying
  // the exe (e.g. for a version update) silently invalidates that client's
  // logged-in sessions and, worse, its already-active license (a license
  // token only verifies against the LICENSE_SECRET it was signed with).
  @Prop({ trim: true, select: false })
  provisioningSessionSecret?: string;

  @Prop({ trim: true, select: false })
  provisioningLicenseSecret?: string;
}

export const EcoleSchema = SchemaFactory.createForClass(Ecole);
