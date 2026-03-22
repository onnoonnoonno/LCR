import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api';
import { authRouter } from './routes/authRoutes';
import { getDb } from './db/client';
import { seedReferenceData } from './db/seed';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// ---------------------------------------------------------------------------
// DEPLOYMENT MARKER
// ---------------------------------------------------------------------------
console.log('=== BACKEND FROM LCR_REPO / TEST 001 ===');

// ---------------------------------------------------------------------------
// CORS — restricted to configured origins
// ---------------------------------------------------------------------------
const allowedOrigins = [
  'http://localhost:5173',
  'https://lcr-frontend.onrender.com',
  ...(process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Reject silently — do NOT throw, which would cause a 500 on preflight
    callback(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
// Handle OPTIONS preflight explicitly before any other middleware
app.options('*', cors(corsOptions));

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------
app.use((req, _res, next) => {
  console.log(
    `[REQ] ${req.method} ${req.originalUrl} Origin=${req.headers.origin ?? 'none'}`
  );
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
// Test route
// ---------------------------------------------------------------------------
app.get('/api/cors-test', (_req, res) => {
  res.json({
    ok: true,
    message: 'cors test route from LCR_repo',
  });
});

// ---------------------------------------------------------------------------
// Auth routes (public — no auth middleware here)
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);

// ---------------------------------------------------------------------------
// Business API routes
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
