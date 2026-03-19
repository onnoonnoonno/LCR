import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api';
import { getDb } from './db/client';
import { seedReferenceData } from './db/seed';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// ---------------------------------------------------------------------------
// CORS — allow all Render subdomains + localhost for dev
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: (origin, cb) => {
      console.log('[CORS] Origin:', origin);

      // Allow requests with no origin (server-to-server, curl, Postman, etc.)
      if (!origin) return cb(null, true);

      try {
        const url = new URL(origin);
        const hostname = url.hostname;

        // Allow Render frontend domains
        if (hostname.endsWith('.onrender.com')) {
          return cb(null, true);
        }

        // Allow localhost for dev
        if (url.protocol === 'http:' && hostname === 'localhost') {
          return cb(null, true);
        }

        return cb(new Error(`CORS: origin '${origin}' not allowed`));
      } catch {
        return cb(new Error(`CORS: invalid origin '${origin}'`));
      }
    },
    credentials: true,
  })
);

// Handle preflight requests
app.options('*', cors());

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
  console.log(`[lcr-web] CORS: *.onrender.com + http://localhost:*`);
  console.log(`[lcr-web] NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
