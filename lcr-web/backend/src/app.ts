import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api';
import { getDb } from './db/client';
import { seedReferenceData } from './db/seed';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// ---------------------------------------------------------------------------
// CORS — OPEN FOR TEST (temporary)
// ---------------------------------------------------------------------------
app.use(cors());
app.options('*', cors());

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl} Origin=${req.headers.origin ?? 'none'}`);
  next();
});

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Trust proxy – required when deployed behind nginx / load balancer
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// DB init + reference data seed (runs synchronously at startup)
// ---------------------------------------------------------------------------
const db = getDb();
seedReferenceData(db);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api', apiRouter);

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[lcr-web] Backend listening on http://0.0.0.0:${PORT}`);
  console.log(`[lcr-web] CORS: OPEN FOR TEST`);
  console.log(`[lcr-web] NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
