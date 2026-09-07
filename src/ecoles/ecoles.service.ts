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
  // Also stamps the "Suivi licence (manuel)" bookkeeping fields
  // (releaseVersion, licenseActivatedAt) with what was just shipped - purely
  // a delivery record. licenseExpiresAt/licenseActivationKey are
  // deliberately left untouched here: those represent a commercial decision
  // (how long this period runs), made explicitly via "Generer et appliquer",
  // never as a side effect of re-downloading a package.
  async streamInstallationPackage(id: string, res: Response): Promise<void> {
    if (!this.isReleaseAssetsConfigured()) {
      throw new BadRequestException(
        "Pack d'installation indisponible sur cette instance (aucun exe pre-construit dans RELEASE_ASSETS_DIR)",
      );
    }

    const ecole = await this.findById(id);
    const admins = await this.usersService.list(id);
    const primaryAdmin = admins[0];
    const { sessionSecret, licenseSecret } =
      await this.ensureProvisioningSecrets(id);
    const adminPassword = generateTempPassword();

    await this.ecoleModel
      .updateOne(
        { _id: id },
        {
          releaseVersion: this.resolveAppVersion(),
          licenseActivatedAt: new Date(),
        },
      )
      .exec();

    const envContent = [
      'PORT=3000',
      'MONGODB_URI=mongodb://127.0.0.1:27017/scolar-gestion?replicaSet=rs0',
      `SESSION_SECRET=${sessionSecret}`,
      `ADMIN_NAME=${primaryAdmin?.name ?? 'Super Admin'}`,
      `ADMIN_EMAIL=${primaryAdmin?.email ?? 'admin@scolar-gestion.local'}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      '# Off par defaut - activer une fois la licence generee (voir /platform/ecoles)',
      '# LICENSE_ENFORCEMENT=on',
      `LICENSE_SECRET=${licenseSecret}`,
      '',
    ].join('\n');

    const safeName = ecole.nom.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
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
