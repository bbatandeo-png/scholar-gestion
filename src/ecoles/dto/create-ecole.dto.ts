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
// @IsEmail() (see the same fix on CreateLevelDto.cycle).
function emptyToUndefined({ value }: { value: unknown }) {
  return value === '' ? undefined : value;
}

export class CreateEcoleDto {
  @IsString()
  nom: string;

  // Identifiants du premier compte SUPER_ADMIN de l'ecole, cree en meme
  // temps que l'ecole elle-meme (voir EcolesService.onboardNewEcole) -
  // sans ca personne ne peut se connecter a la nouvelle ecole.
  @IsString()
  adminName: string;

  @IsEmail()
  adminEmail: string;

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
  // EcolesService.onboardNewEcole when couleurCartePersonnalisee is
  // checked - see that field's comment.
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^#[0-9a-fA-F]{6}$/)
  couleurCarte?: string;

  // Checkbox gating couleurCarte - lets the form always submit a color
  // value (from the <input type="color">, which can never be blank)
  // while still distinguishing "use this custom color" from "use the
  // default", including reverting back to the default later by simply
  // unchecking it.
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

  // Optional at creation - a checkbox only submits when checked, so these
  // are simply absent (undefined) when left unchecked. Neither module is
  // activated by default: an ecole can validly start with none active
  // (see EcolesService.onboardNewEcole).
  @IsOptional()
  @IsString()
  activateFinance?: string;

  @IsOptional()
  @IsString()
  activateBulletins?: string;
}
