import { MongoMemoryReplSet } from 'mongodb-memory-server';

export async function startMongoReplSet() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
      // MongoDB's default 5ms transaction lock wait is tuned for production
      // fail-fast behavior, not test suites that run several transactional
      // operations back-to-back against a single-node replset - bump it so
      // sequential (not actually concurrent) transactions don't flake.
      args: ['--setParameter', 'maxTransactionLockRequestTimeoutMillis=5000'],
    },
  });

  return {
    replSet,
    uri: replSet.getUri(),
    async stop() {
      await replSet.stop();
    },
  };
}