import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AuditAction } from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { runScopedAsEcole } from '../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import {
  EcoleModule,
  EcoleModuleDocument,
} from './schemas/ecole-module.schema';

@Injectable()
export class EcoleModulesService {
  constructor(
    @InjectModel(EcoleModule.name)
    private readonly ecoleModuleModel: Model<EcoleModuleDocument>,
    private readonly auditService: AuditService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // Called both from a normal school-tenant request (ModuleGuard) and from
  // a PLATFORM_ADMIN bypass-mode request (EcolesController) - ecoleId is
  // always passed explicitly rather than relying on tenant-context
  // auto-scoping, since bypass mode doesn't auto-scope queries at all (see
  // ecole-scope.plugin.ts's resolveScopedEcoleId: bypass -> no where clause
  // added). The plugin stays on the schema as defense-in-depth only.
  async isActive(ecoleId: string, code: string): Promise<boolean> {
    const open = await this.ecoleModuleModel
      .findOne({ ecoleId, code, dateDesactivation: null })
      .lean()
      .exec();
    return Boolean(open);
  }

  async listForEcole(ecoleId: string) {
    return this.ecoleModuleModel
      .find({ ecoleId, dateDesactivation: null })
      .lean()
      .exec();
  }

  async activate(ecoleId: string, code: string, actorId: string) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const existing = await this.ecoleModuleModel
        .findOne({ ecoleId, code, dateDesactivation: null })
        .session(session ?? null)
        .exec();
      if (existing) {
        return existing;
      }

      const now = new Date();
      const [created] = await this.ecoleModuleModel.create(
        [
          {
            ecoleId,
            code,
            actif: true,
            dateActivation: now,
            dateDesactivation: null,
            activePar: actorId,
          },
        ],
        { session },
      );

      await runScopedAsEcole(ecoleId, () =>
        this.auditService.log(
          {
            actorId,
            action: AuditAction.MODULE_ACTIVATED,
            entityType: 'EcoleModule',
            entityId: ecoleId,
            details: { code },
          },
          session,
        ),
      );

      return created;
    });
  }

  async deactivate(ecoleId: string, code: string, actorId: string) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const open = await this.ecoleModuleModel
        .findOne({ ecoleId, code, dateDesactivation: null })
        .session(session ?? null)
        .exec();
      if (!open) {
        return;
      }

      const now = new Date();
      // Single permitted mutation of an open row - closes it in place,
      // exactly mirroring ParametreFacturation's dateFin rotation. The row
      // keeps its own dateActivation permanently; nothing is overwritten.
      await this.ecoleModuleModel
        .updateOne(
          { _id: open._id },
          { dateDesactivation: now, actif: false, desactivePar: actorId },
          { session },
        )
        .exec();

      await runScopedAsEcole(ecoleId, () =>
        this.auditService.log(
          {
            actorId,
            action: AuditAction.MODULE_DEACTIVATED,
            entityType: 'EcoleModule',
            entityId: ecoleId,
            details: { code },
          },
          session,
        ),
      );
    });
  }
}
