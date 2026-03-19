# LCR Web

A production-ready full-stack web application that converts an Excel-based LCR (Liquidity Coverage Ratio) workflow into a browser-accessible tool.

## Architecture Overview

```
┌──────────────────────────────────────┐
│           Browser / User             │
└───────────────┬──────────────────────┘
                │ HTTP / reverse proxy
┌───────────────▼──────────────────────┐
│         Frontend (React + Vite)      │
│  port 5173 (dev) / 4173 (preview)   │
└───────────────┬──────────────────────┘
                │ /api/*  (proxy in dev, direct in prod)
┌───────────────▼──────────────────────┐
│       Backend (Express + Node.js)    │
│              port 3001               │
│                                      │
│  POST /api/upload                    │
│  GET  /api/health                    │
└──────────────────────────────────────┘
```

### Phase 1 Data Flow

```
Excel Upload (.xlsx)
  → filename → extract reportDate (YYYY-MM-DD)
  → first sheet rows A:K → ExcelParser
  → LcrRawRow[]
  → Zod Validator
  → { validRows, invalidRows, validationErrors }
  → JSON response
  → React UI preview
```

### Phase 2 Extension Points (placeholders ready)

```
LcrRawRow[] (validated)
  → CalculationEngine (src/services/calculationEngine.ts)
  → BS_RE33Output
  → Summary Dashboard
```

---

## Project Structure

```
lcr-web/
├── backend/
│   ├── src/
│   │   ├── app.ts                      # Express app bootstrap
│   │   ├── controllers/
│   │   │   └── uploadController.ts     # Thin orchestration layer
│   │   ├── middleware/
│   │   │   └── upload.ts               # Multer config
│   │   ├── routes/
│   │   │   └── api.ts                  # Route definitions
│   │   ├── services/
│   │   │   ├── excelParser.ts          # Pure Excel → LcrRawRow[]
│   │   │   ├── validator.ts            # Zod row validation
│   │   │   └── calculationEngine.ts    # Phase 2 placeholder
│   │   └── types/
│   │       └── lcr.ts                  # Domain types (shared contract)
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
└── frontend/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── index.css
    │   ├── components/
    │   │   ├── FileUpload.tsx           # Drag-and-drop upload zone
    │   │   ├── ResultPreview.tsx        # Summary bar + data table
    │   │   └── ValidationErrors.tsx    # Grouped error display
    │   ├── services/
    │   │   └── api.ts                  # HTTP client (configurable base URL)
    │   └── types/
    │       └── lcr.ts                  # Frontend-side API types
    ├── .env.example
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── tsconfig.node.json
    └── vite.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+ (or pnpm / yarn)

### 1. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

```bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

Edit the `.env` files as needed (see [Environment Variables](#environment-variables)).

### 3. Run in development

Open two terminals:

```bash
# Terminal 1 – backend
cd backend
npm run dev
# Listening on http://0.0.0.0:3001
```

```bash
# Terminal 2 – frontend
cd frontend
npm run dev
# Listening on http://localhost:5173
```

Visit **http://localhost:5173** in your browser.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable            | Default                     | Description                                       |
|---------------------|-----------------------------|---------------------------------------------------|
| `PORT`              | `3001`                      | Port the Express server listens on                |
| `NODE_ENV`          | `development`               | `development` or `production`                     |
| `CORS_ORIGINS`      | `http://localhost:5173`     | Comma-separated list of allowed origins           |
| `MAX_FILE_SIZE_MB`  | `50`                        | Maximum upload file size in megabytes             |
| `UPLOAD_DIR`        | `./uploads`                 | Directory for temporary file storage (if needed)  |

### Frontend (`frontend/.env`)

| Variable             | Default                  | Description                                         |
|----------------------|--------------------------|-----------------------------------------------------|
| `VITE_API_BASE_URL`  | *(empty – uses proxy)*   | Backend base URL for production builds              |

In **development**, Vite proxies `/api/*` to the backend automatically (configured in `vite.config.ts`). `VITE_API_BASE_URL` is not required.

In **production**, set `VITE_API_BASE_URL` to the public backend URL, e.g. `https://lcr-api.example.com`.

---

## API Reference

### `GET /api/health`

Liveness probe for load balancers and reverse proxies.

**Response 200**
```json
{
  "status": "ok",
  "service": "lcr-web-backend",
  "timestamp": "2024-03-15T09:00:00.000Z"
}
```

---

### `POST /api/upload`

Upload an Excel file for parsing and validation.

**Request**
- Content-Type: `multipart/form-data`
- Field name: `file`
- Accepted: `.xlsx`, `.xls`

**Filename convention** (required for date extraction):
```
YYYY-MM-DDTHHMMSS.mmm.xlsx
Example: 2024-03-15T143022.000.xlsx
```

**Response 200 – Success**
```json
{
  "success": true,
  "reportDate": "2024-03-15",
  "totalRows": 1500,
  "validRows": 1498,
  "invalidRows": 2,
  "rows": [
    {
      "rowNumber": 2,
      "acCode": "10001",
      "acName": "Cash and balances",
      "refNo": "REF-001",
      "counterpartyNo": "CP001",
      "counterpartyName": "Bank A",
      "ccy": "USD",
      "balanceAmt": 1000000,
      "baseCcyAmt": 1000000,
      "approvalContractDate": "2024-01-01",
      "maturityDate": "2024-12-31",
      "nextInterestResetDate": "2024-06-30"
    }
  ],
  "validationErrors": [
    {
      "rowNumber": 50,
      "field": "ccy",
      "message": "Currency must be a 3-letter ISO code"
    }
  ]
}
```

**Response 400 – Bad request**
```json
{
  "success": false,
  "error": "Only Excel files (.xlsx, .xls) are accepted."
}
```

---

## Excel File Format

| Column | Field                  | Type    | Required |
|--------|------------------------|---------|----------|
| A      | `acCode`               | string  | Yes      |
| B      | `acName`               | string  | No       |
| C      | `refNo`                | string  | No       |
| D      | `counterpartyNo`       | string  | No       |
| E      | `counterpartyName`     | string  | No       |
| F      | `ccy`                  | string  | No (3-char ISO if provided) |
| G      | `balanceAmt`           | number  | No       |
| H      | `baseCcyAmt`           | number  | No       |
| I      | `approvalContractDate` | date    | No       |
| J      | `maturityDate`         | date    | No       |
| K      | `nextInterestResetDate`| date    | No       |

- **Row 1** = header (skipped)
- **Row 2+** = data rows
- Completely blank rows are skipped automatically

---

## Production Deployment

### Build

```bash
# Backend
cd backend
npm run build
# Output: backend/dist/

# Frontend
cd frontend
npm run build
# Output: frontend/dist/
```

### Run backend in production

```bash
cd backend
NODE_ENV=production node dist/app.js
```

### Nginx reverse proxy example

```nginx
server {
    listen 80;
    server_name lcr.example.com;

    # Frontend static files
    root /var/www/lcr-web/frontend/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API to backend
    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

With this setup:
- Set `CORS_ORIGINS=https://lcr.example.com` in backend `.env`
- Set `VITE_API_BASE_URL=` (empty, since Nginx handles routing) in frontend `.env` before building

### Process management (systemd example)

```ini
[Unit]
Description=LCR Web Backend
After=network.target

[Service]
Type=simple
User=lcr
WorkingDirectory=/opt/lcr-web/backend
EnvironmentFile=/opt/lcr-web/backend/.env
ExecStart=/usr/bin/node dist/app.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Docker (optional)

If you containerize, the backend binds to `0.0.0.0` and the frontend Vite dev server also binds to `0.0.0.0`, so both are container-accessible without extra configuration.

---

## Security Notes (Enterprise Deployment)

- **CORS**: Locked to `CORS_ORIGINS` env var. Never use `*` in production.
- **Authentication hook**: The `apiRouter` in `src/routes/api.ts` is the right place to add JWT or session middleware before routes.
- **IP allowlist hook**: Add IP-filtering middleware in `src/app.ts` before routes. A `IP_ALLOWLIST` env var is pre-commented in `.env.example`.
- **File uploads**: Multer is configured with `memoryStorage` (no disk persistence). Files are processed in-memory and discarded.
- **Trust proxy**: `app.set('trust proxy', 1)` is enabled for correct IP detection behind Nginx/load balancers.
- **HTTPS**: Terminate TLS at the reverse proxy (Nginx/AWS ALB). The Node.js server runs HTTP internally.

---

## Phase 2 – Extending the Calculation Engine

When implementing BS_RE33:

1. **Edit** `backend/src/services/calculationEngine.ts` — implement `runBS_RE33(input)`
2. **Update** `backend/src/types/lcr.ts` — fill in `BS_RE33Input` and `BS_RE33Output` interfaces
3. **Uncomment** the engine call in `backend/src/controllers/uploadController.ts`
4. **Add** a summary endpoint (e.g. `GET /api/summary/:reportDate`) in `backend/src/routes/api.ts`
5. **Add** a `SummaryDashboard` component in `frontend/src/components/`

The parser and validator do not need modification.

---

## Column Mapping Reference

```
Excel Column A  →  acCode
Excel Column B  →  acName
Excel Column C  →  refNo
Excel Column D  →  counterpartyNo
Excel Column E  →  counterpartyName
Excel Column F  →  ccy
Excel Column G  →  balanceAmt
Excel Column H  →  baseCcyAmt
Excel Column I  →  approvalContractDate
Excel Column J  →  maturityDate
Excel Column K  →  nextInterestResetDate
```
