import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../common/enums/domain.enums';
import { getRuntimeRoot } from '../common/utils/runtime-paths.util';
import {
  LICENSE_GRACE_PERIOD_DAYS,
  LICENSE_HMAC_SECRET,
  LICENSE_WARNING_THRESHOLDS_DAYS,
} from './licensing.constants';
import { createLicenseToken, verifyLicenseToken } from './license-token.util';
import {
  LicenseState,
  LicenseStateDocument,
} from './schemas/license-state.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenseStateLabel = 'ok' | 'grace' | 'blocked';

export interface LicenseStatus {
  state: LicenseStateLabel;
  expiresAt: Date | null;
  graceEndsAt: Date | null;
  daysRemaining: number | null;
  showWarning: boolean;
  deviceCode: string;
}

@Injectable()
export class LicensingService {
  constructor(
    @InjectModel(LicenseState.name)
    private readonly licenseStateModel: Model<LicenseStateDocument>,
    private readonly auditService: AuditService,
  ) {}

  private ratchetFilePath(): string {
    return path.join(getRuntimeRoot(), 'license-ratchet.json');
  }

  private readRatchetFile(): Date | null {
    try {
      const raw = fs.readFileSync(this.ratchetFilePath(), 'utf8');
      const date = new Date(JSON.parse(raw)?.maxSeenIso);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  private writeRatchetFile(date: Date): void {
    try {
      fs.writeFileSync(
        this.ratchetFilePath(),
        JSON.stringify({ maxSeenIso: date.toISOString() }),
      );
    } catch {
      // Best-effort secondary store only - the MongoDB copy still governs.
    }
  }

  // Effective "now" can only move forward: it's the max of the system clock,
  // the local ratchet file, and (in getStatus/applyRenewalCode) the ratchet
  // already persisted in MongoDB. Rolling back the OS clock, or restoring an
  // older mongodump, moves at most one of those three backwards at a time -
  // never all three at once - so this never regresses.
  private advanceRatchetFile(): Date {
    const now = new Date();
    const fileMax = this.readRatchetFile();
    const effective = fileMax && fileMax > now ? fileMax : now;
    this.writeRatchetFile(effective);
    return effective;
  }

  async getStatus(ecoleId: string): Promise<LicenseStatus> {
    const doc = await this.licenseStateModel.findOne({ ecoleId }).exec();

    let effectiveNow = this.advanceRatchetFile();
    if (doc && doc.maxSeenDate > effectiveNow) {
      effectiveNow = doc.maxSeenDate;
      this.writeRatchetFile(effectiveNow);
    }
    if (doc && doc.maxSeenDate < effectiveNow) {
      await this.licenseStateModel
        .updateOne({ _id: doc._id }, { maxSeenDate: effectiveNow })
        .exec();
    }

    if (!doc) {
      // No license ever provisioned for this ecole - fail closed rather than
      // silently allowing unlimited use. Provisioning an initial license is
      // a required step of enabling this feature on an existing install.
      return {
        state: 'blocked',
        expiresAt: null,
        graceEndsAt: null,
        daysRemaining: null,
        showWarning: false,
        deviceCode: ecoleId,
      };
    }

    const graceEndsAt = new Date(
      doc.expiresAt.getTime() + LICENSE_GRACE_PERIOD_DAYS * DAY_MS,
    );
    const daysRemaining = Math.ceil(
      (doc.expiresAt.getTime() - effectiveNow.getTime()) / DAY_MS,
    );

    let state: LicenseStateLabel;
    if (effectiveNow < doc.expiresAt) {
      state = 'ok';
    } else if (effectiveNow < graceEndsAt) {
      state = 'grace';
    } else {
      state = 'blocked';
    }

    const showWarning =
      state === 'ok' &&
      LICENSE_WARNING_THRESHOLDS_DAYS.some(
        (threshold) => daysRemaining <= threshold,
      );

    return {
      state,
      expiresAt: doc.expiresAt,
      graceEndsAt: state === 'grace' ? graceEndsAt : null,
      daysRemaining,
      showWarning,
      deviceCode: ecoleId,
    };
  }

  async applyRenewalCode(
    ecoleId: string,
    rawCode: string,
    actorId: string,
  ): Promise<void> {
    const payload = verifyLicenseToken(rawCode);
    if (!payload) {
      throw new BadRequestException('Code de renouvellement invalide');
    }
    if (payload.ecoleId !== ecoleId) {
      throw new BadRequestException(
        "Ce code ne correspond pas a cette ecole - verifiez qu'il a bien ete genere pour ce poste",
      );
    }

    const expiresAt = new Date(payload.expiresAt);
    const existing = await this.licenseStateModel.findOne({ ecoleId }).exec();
    if (existing && expiresAt.getTime() <= existing.expiresAt.getTime()) {
      throw new BadRequestException(
        'Ce code ne prolonge pas la licence actuelle - un nouveau code est necessaire',
      );
    }

    const effectiveNow = this.advanceRatchetFile();
    const maxSeenDate =
      existing && existing.maxSeenDate > effectiveNow
        ? existing.maxSeenDate
        : effectiveNow;

    if (existing) {
      await this.licenseStateModel
        .updateOne(
          { _id: existing._id },
          {
            token: rawCode,
            expiresAt,
            maxSeenDate,
            lastRenewedBy: actorId,
          },
        )
        .exec();
    } else {
      await this.licenseStateModel.create({
        ecoleId,
        token: rawCode,
        expiresAt,
        maxSeenDate,
        lastRenewedBy: actorId,
      });
    }
    this.writeRatchetFile(maxSeenDate);

    await this.auditService.log({
      actorId,
      action: AuditAction.LICENSE_RENEWED,
      entityType: 'LicenseState',
      entityId: ecoleId,
      details: { expiresAt: expiresAt.toISOString() },
    });
  }

  // True only when this install has its own LICENSE_SECRET configured -
  // deliberately absent on an online /platform/ecoles deployment, so
  // generation there stays unavailable without needing a separate flag (see
  // licensing.constants.ts).
  isGenerationAvailable(): boolean {
    return LICENSE_HMAC_SECRET.length > 0;
  }

  // Platform-admin-only, local generation (EcolesController): signs a token
  // with THIS install's own secret for its own ecoleId and applies it
  // immediately - no code to relay by phone since it's produced and
  // consumed on the same machine. Unlike applyRenewalCode (the client-facing
  // /licence screen), this is intentionally permissive about the target
  // date - a vendor correcting a mistake needs to be able to shorten a
  // period too - and doesn't require a prior LicenseState to exist. Returns
  // the generated token so the caller can also record it as this ecole's
  // bookkeeping "activation key" field.
  async generateAndApply(
    ecoleId: string,
    expiresAt: Date,
    actorId: string,
  ): Promise<string> {
    if (!this.isGenerationAvailable()) {
      throw new BadRequestException(
        'Generation de licence indisponible sur cette instance (LICENSE_SECRET non configure dans le .env)',
      );
    }

    const token = createLicenseToken({
      ecoleId,
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    const effectiveNow = this.advanceRatchetFile();
    const existing = await this.licenseStateModel.findOne({ ecoleId }).exec();
    const maxSeenDate =
      existing && existing.maxSeenDate > effectiveNow
        ? existing.maxSeenDate
        : effectiveNow;

    if (existing) {
      await this.licenseStateModel
        .updateOne(
          { _id: existing._id },
          { token, expiresAt, maxSeenDate, lastRenewedBy: actorId },
        )
        .exec();
    } else {
      await this.licenseStateModel.create({
        ecoleId,
        token,
        expiresAt,
        maxSeenDate,
        lastRenewedBy: actorId,
      });
    }
    this.writeRatchetFile(maxSeenDate);

    await this.auditService.log({
      actorId,
      action: AuditAction.LICENSE_RENEWED,
      entityType: 'LicenseState',
      entityId: ecoleId,
      details: { expiresAt: expiresAt.toISOString(), generatedLocally: true },
    });

    return token;
  }
}
