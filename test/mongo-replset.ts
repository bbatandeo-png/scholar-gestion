import { MongoMemoryReplSet } from 'mongodb-memory-server';

export async function startMongoReplSet() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  return {
    replSet,
    uri: replSet.getUri(),
    async stop() {
      await replSet.stop();
    },
  };
}