import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

// A blank <input type="email"> submits '' (not absent) - @IsOptional() only
// skips null/undefined, so without this an empty optional email field fails
// @IsEmail() (see the same fix on CreateEcoleDto).
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class UpdateEcoleDto {
  @IsOptional()
  @IsString()
  nom?: string;

  @IsOptional()
  @IsString()
  ministereTutelle?: string;

  @IsOptional()
  @IsString()
  dre?: string;

  @IsOptional()
  @IsString()
  inspection?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  localite?: string;

  // From an <input type="color"> - the browser always submits a well-formed
  // "#rrggbb" value, but validating here too guards against a hand-crafted
  // request bypassing the form. Only actually applied by
  // EcolesService.update when couleurCartePersonnalisee is checked - see
  // that field's comment (this is also how an ecole reverts to the
  // default color, by simply unchecking it).
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^#[0-9a-fA-F]{6}$/)
  couleurCarte?: string;

  @IsOptional()
  @IsString()
  couleurCartePersonnalisee?: string;

  // Same pattern as couleurCarte/couleurCartePersonnalisee, for the
  // bulletin PDF's table header row instead of the ID card.
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^#[0-9a-fA-F]{6}$/)
  couleurBulletin?: string;

  @IsOptional()
  @IsString()
  couleurBulletinPersonnalisee?: string;

  @IsOptional()
  @IsString()
  planSouscrit?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  dateFinEssai?: string;

  // Bookkeeping fields only - see Ecole.releaseVersion's comment.
  @IsOptional()
  @IsString()
  releaseVersion?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  licenseActivatedAt?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  licenseExpiresAt?: string;

  @IsOptional()
  @IsString()
  licenseActivationKey?: string;
}
