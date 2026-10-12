import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { Response } from 'express';
import { Model } from 'mongoose';
import { CreateEcoleDto } from './dto/create-ecole.dto';
import { UpdateEcoleDto } from './dto/update-ecole.dto';
import { Ecole, EcoleDocument } from './schemas/ecole.schema';
import {
  EcoleAccountStatus,
  Role,
  SchoolYearStatus,
  UserStatus,
} from '../common/enums/domain.enums';
import {
  getTenantStore,
  runScopedAsEcole,
} from '../common/tenant/tenant-context';
import { EcoleModulesService } from '../ecole-modules/ecole-modules.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { UsersService } from '../users/users.service';
import {
  UploadedImageFile,
  resolveUploadedImagePath,
  saveUploadedImage,
} from '../common/utils/uploaded-image.util';
import { getReleaseAssetsRoot } from '../common/utils/runtime-paths.util';
import { createLicenseToken } from '../licensing/license-token.util';

export type UploadedLogoFile = UploadedImageFile;

// Unambiguous alphabet (no 0/O/1/I/l) - this password is read off a flash
// message and typed by hand at least once by whoever hands it to the school.
const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword(length = 12): string {
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password +=
      TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return password;
}

// French-system academic year runs September -> June. Whatever year is
// "current" the moment a school onboards becomes their first OPEN school
// year, so the account is immediately usable instead of landing on a
// dashboard with nothing configured (see DashboardController).
function currentAcademicYearBounds(now = new Date()) {
  const startYear =
    now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    label: `${startYear}-${startYear + 1}`,
    startDate: new Date(startYear, 8, 1),
    endDate: new Date(startYear + 1, 5, 30),
  };
}

@Injectable()
export class EcolesService {
  constructor(
    @InjectModel(Ecole.name) private readonly ecoleModel: Model<EcoleDocument>,
    private readonly usersService: UsersService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly ecoleModulesService: EcoleModulesService,
  ) {}

  // Creates the Ecole and its first SUPER_ADMIN login in one step - without
  // this, a newly created ecole has no account able to connect to it (see
  // the comment on User.ecoleId). Returns the generated temporary password
  // so the caller can display it once; it is never stored in clear text.
  // actorId is the PLATFORM_ADMIN performing the creation - recorded as the
  // activator on any module checked at creation time (neither is activated
  // by default, both are optional).
  async onboardNewEcole(dto: CreateEcoleDto, actorId: string) {
    const existingUser = await this.usersService.findByEmail(dto.adminEmail);
    if (existingUser) {
      throw new BadRequestException(
        'Cet email est deja utilise par un autre compte',
      );
    }

    const ecole = await this.ecoleModel.create({
      ...dto,
      // couleurCarte/couleurBulletin only take effect when their "custom
      // color" checkbox was checked - otherwise the card/bulletin keep
      // their default colors, even if the picker itself carries some
      // (unused) value.
      couleurCarte:
        dto.couleurCartePersonnalisee === 'true' ? dto.couleurCarte : null,
      couleurBulletin:
        dto.couleurBulletinPersonnalisee === 'true'
          ? dto.couleurBulletin
          : null,
      statutCompte: EcoleAccountStatus.ESSAI,
      dateInscription: new Date(),
    });

    const tempPassword = generateTempPassword();
    const admin = await this.usersService.create({
      name: dto.adminName,
      email: dto.adminEmail,
      password: tempPassword,
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      ecoleId: String(ecole._id),
    });

    const { label, startDate, endDate } = currentAcademicYearBounds();
    await runScopedAsEcole(String(ecole._id), () =>
      this.schoolYearsService.create({
        label,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        status: SchoolYearStatus.OPEN,
      }),
    );

    if (dto.activateFinance === 'true') {
      await this.ecoleModulesService.activate(
        String(ecole._id),
        'FINANCE',
        actorId,
      );
    }
    if (dto.activateBulletins === 'true') {
      await this.ecoleModulesService.activate(
        String(ecole._id),
        'BULLETINS',
        actorId,
      );
    }

    return { ecole, admin, tempPassword };
  }

  // Lets a PLATFORM_ADMIN unblock a school that can't log in (e.g. the
  // onboarding password was lost before anyone used it) - the school's own
  // self-service password reset (UsersController) requires already being
  // logged in as that ecole, which is exactly what's unavailable here.
  async resetAdminPassword(ecoleId: string, userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || String(user.ecoleId) !== ecoleId) {
      throw new NotFoundException('Compte introuvable pour cette ecole');
    }

    const tempPassword = generateTempPassword();
    await this.usersService.updatePassword(userId, tempPassword);
    return { email: user.email, tempPassword };
  }

  async list() {
    return this.ecoleModel.find().sort({ nom: 1 }).lean().exec();
  }

  // Reads the calling request's own school name, resolved from tenant
  // context - the single source of truth for "nom de l'ecole" used by
  // billing/expenses/reports/payments document headers (see Ecole.nom;
  // the old Settings.school_name duplicate has been removed). Returns ''
  // outside a tenant context (e.g. a PLATFORM_ADMIN request).
  async getCurrentSchoolName(): Promise<string> {
    const ecoleId = getTenantStore()?.ecoleId;
    if (!ecoleId) {
      return '';
    }
    const ecole = await this.ecoleModel
      .findById(ecoleId)
      .select('nom')
      .lean()
      .exec();
    return ecole?.nom ?? '';
  }

  // Full identity block (ministere de tutelle, DRE, inspection, contacts...)
  // for the calling request's own school - used by document headers that
  // need more than just the name (see BulletinsService.renderBulletinPdf).
  async getCurrentEcole() {
    const ecoleId = getTenantStore()?.ecoleId;
    if (!ecoleId) {
      return null;
    }
    return this.ecoleModel.findById(ecoleId).lean().exec();
  }

  async findById(id: string) {
    const ecole = await this.ecoleModel.findById(id).lean().exec();
    if (!ecole) {
      throw new NotFoundException('Ecole introuvable');
    }
    return ecole;
  }

  // Platform-side decision only - see the schema field's own comment on how
  // (and when) this actually reaches a client's own install.
  async setRegistrationPaymentRequired(
    id: string,
    required: boolean,
  ): Promise<void> {
    const result = await this.ecoleModel
      .updateOne({ _id: id }, { registrationPaymentRequired: required })
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException('Ecole introuvable');
    }
  }

  async update(id: string, dto: UpdateEcoleDto) {
    // couleurCarte/couleurBulletin only take effect when their "custom
    // color" checkbox was checked - explicitly nulling them out otherwise
    // (rather than just omitting them) is what lets an ecole revert to the
    // default color by unchecking the box, since findByIdAndUpdate would
    // otherwise leave a previously-saved value untouched.
    const payload = {
      ...dto,
      couleurCarte:
        dto.couleurCartePersonnalisee === 'true' ? dto.couleurCarte : null,
      couleurBulletin:
        dto.couleurBulletinPersonnalisee === 'true'
          ? dto.couleurBulletin
          : null,
    };
    const ecole = await this.ecoleModel
      .findByIdAndUpdate(id, payload, { new: true })
      .lean()
      .exec();
    if (!ecole) {
      throw new NotFoundException('Ecole introuvable');
    }
    return ecole;
  }

  // Stores an uploaded logo on disk under uploads/ecoles/<id>/ (see
  // runtime-paths.util - never inside pkg's read-only bundled assets) and
  // records its path (relative to the uploads root) on the Ecole document.
  // A no-op when no file was submitted - the create/edit form field is
  // optional, and re-submitting the edit form without picking a new file
  // must leave the existing logo untouched.
  async saveLogo(id: string, file: UploadedLogoFile | undefined) {
    const relativePath = saveUploadedImage('ecoles', id, 'logo', file);
    if (!relativePath) {
      return;
    }
    await this.ecoleModel.updateOne({ _id: id }, { logo: relativePath }).exec();
  }

  // Absolute filesystem path to a school's logo file, or null when it has
  // none (or the stored reference no longer resolves to a real file) - see
  // BulletinsService.renderBulletinPage, which draws nothing in that case
  // rather than a placeholder.
  resolveLogoAbsolutePath(ecole: { logo?: string } | null): string | null {
    return resolveUploadedImagePath(ecole?.logo);
  }

  async updateStatus(id: string, statutCompte: EcoleAccountStatus) {
    const ecole = await this.ecoleModel
      .findByIdAndUpdate(id, { statutCompte }, { new: true })
      .lean()
      .exec();
    if (!ecole) {
      throw new NotFoundException('Ecole introuvable');
    }
    return ecole;
  }

  // Checked at every login (see AuthService.validateUser). Blocking is
  // binary (a suspended ecole's non-PLATFORM_ADMIN users can't log in at
  // all) rather than graduated per-feature, matching the product spec's
  // framing of this as a lightweight guard, not a full billing engine.
  // Pre-built exe + views/public/deploy, uploaded by hand by the vendor
  // after `npm run build:exe:native` on their own machine - see
  // getReleaseAssetsRoot's comment for why this is never built on-demand
  // here.
  isReleaseAssetsConfigured(): boolean {
    return fs.existsSync(
      path.join(getReleaseAssetsRoot(), 'Scolar-Gestion.exe'),
    );
  }

  // For display only, on the platform_admin edit screen - the actual
  // LICENSE_SECRET this ecole's exe was shipped with, if a package has
  // already been downloaded for it (see ensureProvisioningSecrets). Never
  // generates one itself: a page view must not have the side effect of
  // minting a secret nobody has shipped yet. Showing it here (rather than
  // making the vendor dig it out of an already-downloaded .env) is what
  // lets `npm run license -- set-secret` register the client's real
  // secret, the one that actually matters - not a freshly invented one
  // that would never verify against what the client's exe was built with.
  async getProvisioningLicenseSecret(id: string): Promise<string | null> {
    const ecole = await this.ecoleModel
      .findById(id)
      .select('+provisioningLicenseSecret')
      .lean()
      .exec();
    return ecole?.provisioningLicenseSecret ?? null;
  }

  // Generated once per ecole, then reused forever - see the schema fields'
  // comment on why re-generating on every download would be actively
  // harmful (silently invalidates an already-deployed license/sessions).
  private async ensureProvisioningSecrets(
    id: string,
  ): Promise<{ sessionSecret: string; licenseSecret: string }> {
    const existing = await this.ecoleModel
      .findById(id)
      .select('+provisioningSessionSecret +provisioningLicenseSecret')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('Ecole introuvable');
    }

    const sessionSecret =
      existing.provisioningSessionSecret ?? randomBytes(32).toString('hex');
    const licenseSecret =
      existing.provisioningLicenseSecret ?? randomBytes(32).toString('hex');

    if (
      !existing.provisioningSessionSecret ||
      !existing.provisioningLicenseSecret
    ) {
      await this.ecoleModel
        .updateOne(
          { _id: id },
          {
            provisioningSessionSecret: sessionSecret,
            provisioningLicenseSecret: licenseSecret,
          },
        )
        .exec();
    }

    return { sessionSecret, licenseSecret };
  }

  // Best-effort only - a missing/unreadable package.json (e.g. inside a pkg
  // snapshot, which doesn't bundle it) must never break the download itself,
  // just leave "Version de la release" blank.
  private resolveAppVersion(): string | undefined {
    try {
      const pkg = fs.readFileSync(
        path.join(process.cwd(), 'package.json'),
        'utf8',
      );
      return (JSON.parse(pkg) as { version?: string })?.version;
    } catch {
      return undefined;
    }
  }

  // Zips the pre-built exe (see isReleaseAssetsConfigured) together with a
  // freshly generated .env for this specific ecole - MONGODB_URI/PORT
  // follow this app's own offline-install convention, ADMIN_NAME/EMAIL come
  // from this ecole's own first account, and the two secrets are this
  // ecole's persistent, never-reused-elsewhere values (see
  // ensureProvisioningSecrets). Streams straight into the response; nothing
  // is written to disk on this server.
  //
  // `expiresAt` is optional, picked on the download screen before the file
  // is built. SEED_ECOLE_ID (the ecole's own _id) is always written, even
  // without a chosen date - it costs nothing on a brand-new install and
  // guarantees that whenever a licence eventually gets issued (now or at a
  // later redownload), its ecoleId already matches what scripts/seed.ts
  // seeds, with no client round-trip needed to report a device code back.
  // When a date IS chosen, it's additionally signed into a
  // LICENSE_BOOTSTRAP_TOKEN and enforcement is switched on, so the install
  // is already licensed on its very first launch and stops working on its
  // own once the date is reached. Leaving the date blank ships the old,
  // unrestricted behaviour (enforcement off, no token) - e.g. for a trial
  // install whose licence will be decided later. The token is also stamped
  // onto this ecole's own bookkeeping (licenseExpiresAt/licenseActivationKey)
  // so a later redownload or a `npm run license -- generate` renewal always
  // has the last-issued expiry to hand.
  async streamInstallationPackage(
    id: string,
    expiresAt: Date | undefined,
    res: Response,
  ): Promise<void> {
    if (!this.isReleaseAssetsConfigured()) {
      throw new BadRequestException(
        "Pack d'installation indisponible sur cette instance (aucun exe pre-construit dans RELEASE_ASSETS_DIR)",
      );
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException("Date d'expiration invalide");
    }
    // A past date would ship an install already in its grace period (or
    // already blocked) on its very first launch - caught here too, not just
    // by the form's own `min`, since this is a platform-admin-only screen
    // where a stale bookmark/retry can still submit an old value.
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        "Date d'expiration invalide - elle doit etre dans le futur",
      );
    }

    const ecole = await this.findById(id);
    const admins = await this.usersService.list(id);
    const primaryAdmin = admins[0];
    const { sessionSecret, licenseSecret } =
      await this.ensureProvisioningSecrets(id);
    const adminPassword = generateTempPassword();
    // The exe runs against its own local database, which knows nothing about
    // the modules activated here on the platform - ship them in the .env so
    // the install's first boot (see scripts/seed.ts) activates the same ones.
    const activeModuleCodes = (
      await runScopedAsEcole(id, () =>
        this.ecoleModulesService.listForEcole(id),
      )
    ).map((m) => m.code);

    const bootstrapToken = expiresAt
      ? createLicenseToken(
          {
            ecoleId: id,
            issuedAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
          licenseSecret,
        )
      : undefined;

    await this.ecoleModel
      .updateOne(
        { _id: id },
        {
          releaseVersion: this.resolveAppVersion(),
          licenseActivatedAt: new Date(),
          ...(bootstrapToken
            ? {
                licenseExpiresAt: expiresAt,
                licenseActivationKey: bootstrapToken,
              }
            : {}),
        },
      )
      .exec();

    // Unique per ecole (name slug + a slice of its own _id, so two schools
    // sharing a name never collide) rather than the old fixed
    // "scolar-gestion" for every single install - a vendor who test-launches
    // several downloaded packages on the SAME machine (their own dev PC, or
    // genuinely two schools on one office computer) used to have them all
    // silently share one database, each overwriting the other's seeded
    // ecole/license state.
    const safeName = ecole.nom.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const dbName = `scolar-gestion-${safeName}-${id.slice(-6)}`;

    const envContent = [
      'PORT=3000',
      `MONGODB_URI=mongodb://127.0.0.1:27017/${dbName}?replicaSet=rs0`,
      `SESSION_SECRET=${sessionSecret}`,
      `ADMIN_NAME=${primaryAdmin?.name ?? 'Super Admin'}`,
      `ADMIN_EMAIL=${primaryAdmin?.email ?? 'admin@scolar-gestion.local'}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      `ACTIVE_MODULES=${activeModuleCodes.join(',')}`,
      `REGISTRATION_PAYMENT_REQUIRED=${ecole.registrationPaymentRequired ? 'true' : 'false'}`,
      `SEED_ECOLE_ID=${id}`,
      `LICENSE_SECRET=${licenseSecret}`,
      bootstrapToken
        ? 'LICENSE_ENFORCEMENT=on'
        : '# Off par defaut - laisser vide ou renseigner "on" une fois la licence decidee',
      bootstrapToken
        ? `LICENSE_BOOTSTRAP_TOKEN=${bootstrapToken}`
        : '# LICENSE_BOOTSTRAP_TOKEN=',
      '',
    ].join('\n');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="scolar-gestion-${safeName}.zip"`,
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const assetsRoot = getReleaseAssetsRoot();
    archive.file(path.join(assetsRoot, 'Scolar-Gestion.exe'), {
      name: 'Scolar-Gestion.exe',
    });
    for (const dir of ['views', 'public', 'deploy']) {
      const dirPath = path.join(assetsRoot, dir);
      if (fs.existsSync(dirPath)) {
        archive.directory(dirPath, dir);
      }
    }
    archive.append(envContent, { name: '.env' });

    await archive.finalize();
  }

  async isSuspended(id: string): Promise<boolean> {
    const ecole = await this.ecoleModel
      .findById(id)
      .select('statutCompte dateFinEssai')
      .lean()
      .exec();
    if (!ecole) {
      return false;
    }

    if (
      ecole.statutCompte === EcoleAccountStatus.ESSAI &&
      ecole.dateFinEssai &&
      ecole.dateFinEssai < new Date()
    ) {
      await this.ecoleModel
        .updateOne({ _id: id }, { statutCompte: EcoleAccountStatus.SUSPENDU })
        .exec();
      return true;
    }

    return ecole.statutCompte === EcoleAccountStatus.SUSPENDU;
  }
}
