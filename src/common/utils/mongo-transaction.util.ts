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
      return work();
    }

    throw error;
  } finally {
    await session.endSession();
  }
}