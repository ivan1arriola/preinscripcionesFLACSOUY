import express, { type Express } from 'express';
import { healthResponse } from './presentation/http/health.js';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const health = healthResponse({ database: 'up' });
    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  return app;
}

const PORT = Number(process.env.PORT) || 3000;

export const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
  });
}
