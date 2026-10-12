import express from 'express';
import request from 'supertest';
import { noStore } from './no-store';

describe('noStore', () => {
  it('marks dynamic responses as non-cacheable', async () => {
    const app = express();
    app.use(noStore);
    app.get('/enrollments', (_req, res) => {
      res.send('list');
    });

    const response = await request(app).get('/enrollments');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not touch responses served before it (static assets)', async () => {
    const app = express();
    app.get('/styles.css', (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send('body{}');
    });
    app.use(noStore);

    const response = await request(app).get('/styles.css');

    expect(response.headers['cache-control']).toBe('public, max-age=3600');
  });
});
