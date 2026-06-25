import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { ArrearsService } from './arrears.service';
import { Arrear, ArrearSchema } from './schemas/arrear.schema';

describe('ArrearsService', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let service: ArrearsService;
  let model: Model<Arrear>;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.uri),
        MongooseModule.forFeature([{ name: Arrear.name, schema: ArrearSchema }]),
      ],
      providers: [ArrearsService],
    }).compile();

    service = moduleRef.get(ArrearsService);
    model = moduleRef.get(getModelToken(Arrear.name));
  });

  afterAll(async () => {
    await model.db.close();
    await repl.stop();
  });

  it('ne duplique pas un impaye materialise depuis la meme inscription source', async () => {
    const first = await service.createFromOutstanding({
      studentId: '507f1f77bcf86cd799439011',
      sourceEnrollmentId: '507f1f77bcf86cd799439012',
      sourceSchoolYearId: '507f1f77bcf86cd799439013',
      amount: 30000,
    });

    const second = await service.createFromOutstanding({
      studentId: '507f1f77bcf86cd799439011',
      sourceEnrollmentId: '507f1f77bcf86cd799439012',
      sourceSchoolYearId: '507f1f77bcf86cd799439013',
      amount: 30000,
    });

    expect(String(first?._id)).toBe(String(second?._id));
    expect(await model.countDocuments()).toBe(1);
  });
});