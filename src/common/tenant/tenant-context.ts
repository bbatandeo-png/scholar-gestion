import { AsyncLocalStorage } from 'async_hooks';
import { Role } from '../enums/domain.enums';

export type TenantStore = {
  userId?: string;
  role?: Role;
  ecoleId?: string | null;
  bypass?: boolean;
};

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenantStore(): TenantStore | undefined {
  return tenantStorage.getStore();
}

/**
 * Runs `fn` inside the given tenant context. `fn`'s return value is awaited
 * *inside* the AsyncLocalStorage callback (not by the caller after run()
 * returns), because Mongoose queries are lazy thenables - if we let the
 * caller await the query after run() has already returned synchronously,
 * the actual query execution (and the ecole-scope plugin hooks it triggers)
 * would happen outside the tenant context and lose it.
 */
export function runWithTenant<T>(
  store: TenantStore,
  fn: () => T | Promise<T>,
): Promise<T> {
  return tenantStorage.run(store, async () => fn());
}

export function runAsPlatformAdmin<T>(fn: () => T | Promise<T>): Promise<T> {
  return tenantStorage.run({ bypass: true }, async () => fn());
}

export function runScopedAsEcole<T>(
  ecoleId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const parent = getTenantStore();
  return tenantStorage.run({ ...parent, ecoleId, bypass: false }, async () =>
    fn(),
  );
}
