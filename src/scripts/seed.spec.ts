import { shouldRunSeed } from './seed';

describe('shouldRunSeed', () => {
  it('ne lance pas le seed en environnement de test', () => {
    expect(shouldRunSeed({ NODE_ENV: 'test' })).toBe(false);
  });

  it('lance le seed par défaut hors test', () => {
    expect(shouldRunSeed({ NODE_ENV: 'development' })).toBe(true);
  });

  it('permet de désactiver le seed via variable d’environnement', () => {
    expect(
      shouldRunSeed({
        NODE_ENV: 'development',
        SEED_ON_START: 'false',
      }),
    ).toBe(false);
  });
});
