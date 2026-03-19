import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api';
import { getDb } from './db/client';
import { seedReferenceData } from './db/seed';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const rawOrigins = process.env.CORS_ORIGINS ?? 'http://localhost:5173';
const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, Postman, etc.)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  })
);

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
// Routes
// ---------------------------------------------------------------------------
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
  console.log(`[lcr-web] CORS allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[lcr-web] NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
