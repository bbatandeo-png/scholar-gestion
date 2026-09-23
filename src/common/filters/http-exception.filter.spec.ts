import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

interface FakeFlash {
  type: 'success' | 'error';
  message: string;
}

function buildHost(overrides: {
  accept?: string;
  referer?: string;
  session?: { flash?: FakeFlash };
}) {
  const session: { flash?: FakeFlash } = overrides.session ?? {};
  const render = jest.fn();
  const json = jest.fn();
  const redirect = jest.fn();
  const status = jest.fn(() => ({ render, json }));
  const req = {
    headers: { accept: overrides.accept ?? 'text/html' },
    session,
    get: jest.fn((name: string) =>
      name.toLowerCase() === 'referer' ? overrides.referer : undefined,
    ),
  };
  const res = { status, redirect };
  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, req, res, status, render, json, redirect };
}

describe('HttpExceptionFilter', () => {
  // Silence the Logger.error call the filter makes for genuine (non-Http)
  // exceptions - asserted on directly in the "vrai plantage" test below,
  // not something every other test needs to see in its own output.
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("redirige avec un flash pour une erreur metier (4xx) en HTML, sans afficher la page d'erreur generique", () => {
    const filter = new HttpExceptionFilter();
    const { host, req, redirect, status } = buildHost({
      referer: '/settings/fees/abc/edit',
    });

    filter.catch(
      new BadRequestException('Aucune annee scolaire ouverte'),
      host,
    );

    expect(req.session.flash).toEqual({
      type: 'error',
      message: 'Aucune annee scolaire ouverte',
    });
    expect(redirect).toHaveBeenCalledWith('/settings/fees/abc/edit');
    expect(status).not.toHaveBeenCalled();
  });

  it("retombe sur /dashboard quand la requete n'a pas de referer", () => {
    const filter = new HttpExceptionFilter();
    const { host, redirect } = buildHost({});

    filter.catch(new BadRequestException('Refuse'), host);

    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('rejoint les messages de validation multiples (class-validator) en une seule phrase', () => {
    const filter = new HttpExceptionFilter();
    const { host, req } = buildHost({ referer: '/students' });

    filter.catch(
      new BadRequestException({
        message: ['le nom est requis', 'le prenom est requis'],
      }),
      host,
    );

    expect(req.session.flash).toEqual({
      type: 'error',
      message: 'le nom est requis le prenom est requis',
    });
  });

  it('un 404 HTML redirige aussi avec un flash au lieu de la page generique', () => {
    const filter = new HttpExceptionFilter();
    const { host, req, redirect, status } = buildHost({
      referer: '/students/does-not-exist',
    });

    filter.catch(new NotFoundException('Eleve introuvable'), host);

    expect(req.session.flash?.message).toBe('Eleve introuvable');
    expect(redirect).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("affiche la page d'erreur generique pour un vrai plantage (non-HttpException) en HTML, et journalise l'erreur", () => {
    const filter = new HttpExceptionFilter();
    const { host, render, redirect, status } = buildHost({});

    filter.catch(new Error('boom'), host);

    expect(redirect).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
    expect(render).toHaveBeenCalledWith(
      'error/generic',
      expect.objectContaining({ statusCode: 500, isNotFound: false }),
    );
    expect(errorSpy).toHaveBeenCalledWith('boom', expect.anything());
  });

  it('laisse le JSON habituel de Nest intact pour un client non-HTML (Accept absent)', () => {
    const filter = new HttpExceptionFilter();
    const { host, json, status, redirect } = buildHost({
      accept: 'application/json',
    });

    filter.catch(new BadRequestException('Refuse'), host);

    expect(redirect).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, error: 'Bad Request' }),
    );
  });
});
