import express from 'express';
import session from 'express-session';
import csurf from 'csurf';
import request from 'supertest';
import { csrfErrorHandler } from './csrf-error-handler';

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use(csurf());
  app.use(csrfErrorHandler);

  app.get('/token', (req, res) => {
    res.json({ csrfToken: req.csrfToken!() });
  });

  app.post('/logout', (req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe('csrfErrorHandler', () => {
  it('redirects to /login instead of crashing when the csrf token is stale/invalid', async () => {
    const app = buildApp();
    const agent = request.agent(app);

    // Establish a session, but then submit a bogus token - simulates a
    // stale page whose embedded token no longer matches the server secret.
    await agent.get('/token');

    const res = await agent
      .post('/logout')
      .type('form')
      .send({ _csrf: 'this-token-is-not-valid' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('lets a request with a valid csrf token through normally', async () => {
    const app = buildApp();
    const agent = request.agent(app);

    const tokenRes = await agent.get('/token');
    const csrfToken = (tokenRes.body as { csrfToken: string }).csrfToken;

    const res = await agent
      .post('/logout')
      .type('form')
      .send({ _csrf: csrfToken });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
