import { Aggregate, Query, Schema, SchemaTypes, Types } from 'mongoose';
import { getTenantStore } from '../tenant/tenant-context';

const UNAMBIGUOUS_QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
  'countDocuments',
  'updateMany',
  'deleteMany',
  'distinct',
] as const;

const AMBIGUOUS_QUERY_OPS = ['updateOne', 'deleteOne'] as const;

function resolveScopedEcoleId(): string | null {
  const store = getTenantStore();
  if (!store) {
    throw new Error(
      "Tenant context manquant : aucune requete scoped ne peut etre executee hors d'une requete HTTP ou d'un bloc runWithTenant/runAsPlatformAdmin/runScopedAsEcole",
    );
  }
  if (store.bypass) {
    return null;
  }
  if (!store.ecoleId) {
    throw new Error('Tenant context incomplet : ecoleId manquant');
  }
  return store.ecoleId;
}

function scopeQuery(
  this: Query<unknown, unknown>,
  next: (err?: Error) => void,
) {
  try {
    const ecoleId = resolveScopedEcoleId();
    if (ecoleId) {
      this.where({ ecoleId });
    }
    next();
  } catch (error) {
    next(error as Error);
  }
}

/**
 * Adds ecoleId to a schema and auto-scopes every read/write path
 * (query, document-save, insertMany, aggregate) to the current request's
 * tenant, resolved from AsyncLocalStorage (see common/tenant/tenant-context.ts).
 * Fails closed: throws if a scoped operation runs with no tenant context.
 *
 * `skipPlainIndex`: set when the schema declares its own index whose key is
 * also exactly `{ ecoleId: 1 }` (e.g. a partial-unique constraint) - Mongoose
 * treats that as a duplicate of this plugin's default index (same key,
 * regardless of differing options) and logs a "Duplicate schema index"
 * warning at boot. The schema's own index already covers ecoleId lookups.
 */
export function ecoleScopePlugin(
  schema: Schema,
  options?: { skipPlainIndex?: boolean },
): void {
  schema.add({
    ecoleId: {
      type: SchemaTypes.ObjectId,
      ref: 'Ecole',
      required: true,
      index: !options?.skipPlainIndex,
    },
  });

  schema.pre([...UNAMBIGUOUS_QUERY_OPS], scopeQuery);
  schema.pre(
    [...AMBIGUOUS_QUERY_OPS],
    { query: true, document: false },
    scopeQuery,
  );

  // estimatedDocumentCount() has no filter and structurally cannot be scoped.
  schema.pre('estimatedDocumentCount', function (next) {
    const store = getTenantStore();
    if (store?.bypass) {
      return next();
    }
    next(
      new Error(
        'estimatedDocumentCount() ne peut pas etre scope par ecoleId - utiliser countDocuments({}) a la place',
      ),
    );
  });

  // Runs on 'validate' rather than 'save': Mongoose runs schema validation
  // (including the required:true check on ecoleId) before 'save' hooks, so
  // stamping ecoleId in a pre('save') hook would always be too late.
  schema.pre('validate', function (next) {
    try {
      const store = getTenantStore();
      const doc = this as unknown as {
        isNew: boolean;
        isModified: (p: string) => boolean;
        get: (p: string) => unknown;
        set: (p: string, v: unknown) => void;
      };

      if (doc.isNew) {
        if (!doc.get('ecoleId')) {
          if (!store) {
            throw new Error(
              'Tenant context manquant pour la creation du document',
            );
          }
          if (store.bypass) {
            throw new Error(
              'ecoleId doit etre fourni explicitement en mode bypass (platform admin)',
            );
          }
          if (!store.ecoleId) {
            throw new Error('Tenant context incomplet : ecoleId manquant');
          }
          doc.set('ecoleId', store.ecoleId);
        }
      } else if (doc.isModified('ecoleId')) {
        throw new Error(
          'ecoleId ne peut pas etre modifie sur un document existant',
        );
      }
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  schema.pre(
    'insertMany',
    function (next, docs: Array<Record<string, unknown>>) {
      try {
        const store = getTenantStore();
        for (const doc of docs) {
          if (!doc.ecoleId) {
            if (!store) {
              throw new Error('Tenant context manquant pour insertMany');
            }
            if (store.bypass) {
              throw new Error(
                'ecoleId doit etre fourni explicitement en mode bypass (platform admin)',
              );
            }
            if (!store.ecoleId) {
              throw new Error('Tenant context incomplet : ecoleId manquant');
            }
            doc.ecoleId = store.ecoleId;
          }
        }
        next();
      } catch (error) {
        next(error as Error);
      }
    },
  );

  schema.pre('aggregate', function (this: Aggregate<unknown>, next) {
    try {
      const ecoleId = resolveScopedEcoleId();
      if (ecoleId) {
        this.pipeline().unshift({
          $match: { ecoleId: new Types.ObjectId(ecoleId) },
        });
      }
      next();
    } catch (error) {
      next(error as Error);
    }
  });
}
