import { StudentsService } from './students.service';

describe('StudentsService autocomplete', () => {
  const exec = jest.fn();
  const aggregate = jest.fn((pipeline: unknown[]) => {
    void pipeline;
    return { exec };
  });
  const service = new StudentsService(
    { aggregate } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockResolvedValue([]);
  });

  it('ne lance pas de requete avant trois caracteres', async () => {
    await expect(service.autocomplete('Al')).resolves.toEqual([]);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('limite les resultats et recherche sans tenir compte des accents', async () => {
    await service.autocomplete('Jerome', 100);

    const pipeline = aggregate.mock.calls[0][0];
    const matchStage = pipeline[0] as {
      $match: { $or: Array<{ lastname?: RegExp }> };
    };
    const sortStage = pipeline[2] as {
      $sort: Record<string, number>;
    };
    expect(pipeline).toContainEqual({ $limit: 30 });
    expect(String(matchStage.$match.$or[1].lastname)).toContain('[eèéêë]');
    expect(sortStage.$sort).toEqual({
      searchRank: 1,
      lastname: 1,
      firstname: 1,
      matricule: 1,
    });
  });
});
