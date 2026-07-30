import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';

import analysisRouter from './routes/analysis.js';
import authRouter from './routes/auth.js';
import { authenticateToken } from './middleware/authMiddleware.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  app.use('/api/auth', authRouter);
  app.use('/api/analysis', analysisRouter);

  app.get('/api/users/me', authenticateToken, (req, res) => {
    res.status(200).json({ userId: req.userId });
  });

  return app;
}
