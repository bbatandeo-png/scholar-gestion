import { ClientSession, Connection } from 'mongoose';

function isTransactionUnsupportedError(error: unknown): boolean {
  const candidate = error as { code?: number; message?: string } | undefined;
  return (
    candidate?.code === 20 ||
    candidate?.message?.includes(
      'Transaction numbers are only allowed on a replica set member or mongos',
    ) === true
  );
}

export async function runWithMongoTransactionFallback<T>(
  connection: Connection,
  work: (session?: ClientSession) => Promise<T>,
  options: { allowFallback?: boolean } = {},
): Promise<T> {
  const session = await connection.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch {
      // Nothing to do if abort itself fails.
    }

    if (isTransactionUnsupportedError(error)) {
      if (options.allowFallback === false) {
        throw new Error(
          'Cette operation exige MongoDB en mode replica set pour garantir une transaction atomique',
        );
      }
      return work();
    }

    throw error;
  } finally {
    await session.endSession();
  }
}
