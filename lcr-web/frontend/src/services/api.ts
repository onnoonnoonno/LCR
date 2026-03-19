/**
 * API service layer — DB-backed architecture.
 */

function base(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '';
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    try {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}: ${res.statusText}`);
    } catch {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReportSummary {
  reportDate:      string;
  eligibleHqla:    number;
  grossOutflows:   number;
  grossInflows:    number;
  cappedInflows:   number;
  netCashOutflows: number;
  lcrRatio:        number | null;
  ratio7d:         number | null;
  ratio1m:         number | null;
  ratio3m:         number | null;
  ratio3mLr:       number | null;
  meetsMinimum:    boolean | null;
}

export interface UploadResponse {
  success:        boolean;
  runId:          string;
  reportDate:     string;
  sourceFilename: string;
  rawRowCount:    number;
  summary:        ReportSummary;
}

export interface HistoryItem {
  reportDate:      string;
  runId:           string;
  sourceFilename:  string;
  uploadedAt:      string;
  lcrRatio:        number | null;
  eligibleHqla:    number;
  grossOutflows:   number;
  netCashOutflows: number;
  ratio3mLr:       number | null;
  status:          string;
}

export interface SummaryRecord {
  summaryId:       string;
  runId:           string;
  reportDate:      string;
  sourceFilename:  string;
  uploadedAt:      string;
  eligibleHqla:    number;
  grossOutflows:   number;
  grossInflows:    number;
  cappedInflows:   number;
  netCashOutflows: number;
  lcrRatio:        number | null;
  ratio7d:         number | null;
  ratio1m:         number | null;
  ratio3m:         number | null;
  ratio3mLr:       number | null;
  createdAt:       string;
}

// ---------------------------------------------------------------------------
// Verification workflow types
// ---------------------------------------------------------------------------

export interface UploadRawResponse {
  success:        boolean;
  runId:          string;
  reportDate:     string;
  sourceFilename: string;
  rawRowCount:    number;
}

export interface RawRow {
  id:                    number;
  rowNumber:             number;
  acCode:                string | null;
  acName:                string | null;
  refNo:                 string | null;
  counterpartyNo:        string | null;
  counterpartyName:      string | null;
  ccy:                   string | null;
  balanceAmt:            number | null;
  baseCcyAmt:            number | null;
  approvalContractDate:  string | null;
  maturityDate:          string | null;
  nextInterestResetDate: string | null;
}

export interface RawRowsResponse {
  success:    boolean;
  runId:      string;
  page:       number;
  pageSize:   number;
  total:      number;
  totalPages: number;
  rows:       RawRow[];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/** Upload Excel file — raw parse only, no pipeline processing. */
export async function uploadRaw(file: File, reportDate?: string): Promise<UploadRawResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (reportDate) formData.append('reportDate', reportDate);
  const res = await fetch(`${base()}/api/upload-raw`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  return handleResponse<UploadRawResponse>(res);
}

/** Fetch paginated raw rows for a given report run. */
export async function fetchRawRows(
  runId: string,
  page = 1,
  pageSize = 50,
): Promise<RawRowsResponse> {
  const params = new URLSearchParams({
    runId,
    page: String(page),
    pageSize: String(pageSize),
  });
  const res = await fetch(`${base()}/api/raw-rows?${params}`, { credentials: 'include' });
  return handleResponse<RawRowsResponse>(res);
}

export interface ColumnLRow {
  rowNumber:      number;
  acCode:         string;
  acName:         string;
  refNo:          string;
  mapped:         boolean;
  category:       string;   // L
  middleCategory: string;   // M
  n:              string;   // N (LCR Classification, with override)
  nSource:        'override' | 'lookup';
  customerType:   string;   // O (blank when L not in eligible set)
  oSource:        'lookup' | 'blank';
  pKey:           string;   // P = M & "_" & O
  baseCcyAmt:     number;   // H (raw)
  q:              number;   // Q (sign-flipped H)
  signFlip:       boolean;  // true if acCode in sign-flip list
  rRate:          number | null; // R (assumption rate from P-key lookup)
  rSource:        'found' | 'not_found';
  u:              number;   // U = ROUND(Q × R, 1)
  s:              string;   // S (LCR Maturity: date string or "Tomorrow")
  sSource:        'override' | 'fallback';
  t:              number | null; // T (days to maturity)
  v:              string;   // V (Liquidity Maturity: override or S)
  vSource:        'override' | 'fallback';
  w:              string;   // W (Liquidity Gap Asset/Liability from Account Mapping col F)
  buckets:        number[]; // X-AG (10 bucket values)
  ah:             boolean;  // AH check: Q == SUM(X:AG)
  hitBucket:      string;   // label of the bucket that received Q
  nonZeroCount:   number;   // number of non-zero buckets
}

export interface ColumnLResponse {
  success:         boolean;
  runId:           string;
  page:            number;
  pageSize:        number;
  total:           number;
  totalPages:      number;
  totalMapped:     number;
  totalUnmapped:   number;
  totalOverride:   number;
  totalLookup:     number;
  totalOPopulated: number;
  totalOBlank:     number;
  totalSignFlip:   number;
  totalNoFlip:     number;
  totalRFound:     number;
  totalRMissing:   number;
  rows:            ColumnLRow[];
}

export interface AccountMappingRow {
  acCode:             string;
  acName:             string;
  category:           string;
  middleCategory:     string;
  hqlaOrCashflowType: string;
  assetLiabilityType: string;
}

export interface AccountMappingResponse {
  success:    boolean;
  page:       number;
  pageSize:   number;
  total:      number;
  totalPages: number;
  rows:       AccountMappingRow[];
}

/** Fetch column-L verification data for a given report run. */
export async function fetchColumnL(
  runId: string,
  page = 1,
  pageSize = 50,
): Promise<ColumnLResponse> {
  const params = new URLSearchParams({
    runId,
    page: String(page),
    pageSize: String(pageSize),
  });
  const res = await fetch(`${base()}/api/verify/column-l?${params}`, { credentials: 'include' });
  return handleResponse<ColumnLResponse>(res);
}

export interface LmgGapSection {
  cumAsset:       number;
  cumLiab:        number;
  gap:            number;
  totalAsset:     number;
  ratio:          number | null;
  trigger:        number;
  limit:          number;
  triggerReached:  boolean | null;
  limitBreached:   boolean | null;
  shortfall:      number;
}

export interface KriRow {
  ratio:    number | null;
  trigger:  number;
  reached:  'Y' | 'N';
  limit:    number;
  breached: 'Y' | 'N';
}

export interface LmgSummaryResponse {
  success:             boolean;
  runId:               string;
  reportDate:          string;
  bucketLabels:        string[];
  assetBuckets:        number[];
  liabBuckets:         number[];
  totalAssetF24:       number;
  acceptanceBuckets:   number[];
  totalAcceptance:     number;
  acceptanceDeduction: number;
  summary: {
    '7D': LmgGapSection;
    '1M': LmgGapSection;
    '3M': LmgGapSection;
  };
  ratio3MLR:           number | null;
  kri: {
    '7D': KriRow;
    '1M': KriRow;
    '3M': KriRow;
  };
  lcrPercent:           number | null;
  totalRows:           number;
}

/** Fetch LMG summary aggregation for a given report run. */
export async function fetchLmgSummary(runId: string): Promise<LmgSummaryResponse> {
  const params = new URLSearchParams({ runId });
  const res = await fetch(`${base()}/api/verify/lmg-summary?${params}`, { credentials: 'include' });
  return handleResponse<LmgSummaryResponse>(res);
}

export interface ForecastMonth {
  label:      string;
  from:       string;
  to:         string;
  asset:      number;
  liab:       number;
  gap:        number;
  totalAsset: number;
  gapRatio:   number | null;
  trigger:    number;
  shortfall:  number;
}

export interface ForecastResponse {
  success:      boolean;
  runId:        string;
  reportDate:   string;
  forecastType: '7day' | '1month' | '3month';
  totalAsset:   number;
  trigger:      number;
  months:       ForecastMonth[];
}

/** Fetch gap ratio forecast for a given report run. */
export async function fetchGapForecast(
  runId: string,
  type: '7day' | '1month' | '3month' = '7day',
): Promise<ForecastResponse> {
  const params = new URLSearchParams({ runId, type });
  const res = await fetch(`${base()}/api/verify/gap-forecast?${params}`, { credentials: 'include' });
  return handleResponse<ForecastResponse>(res);
}

export interface CfTableResponse {
  success:         boolean;
  runId:           string;
  reportDate:      string;
  day30End:        string;
  baseOutflow:     number;   // D97
  buybackOutflow:  number;   // D99
  otherOutflow:    number;   // D101
  grossOutflow:    number;   // D103
  baseInflow:      number;   // D106
  hoFacility:      number;   // D108
  sumInflow:       number;   // D110
  cappedInflow:    number;   // D112
  netCashOutflow:  number;   // D115
  hqla:            number;   // D117
  lcr:             number | null; // D119
  outflowRows:     Array<{ pKey: string; amount: number; rate: number }>;
  inflowRows:      Array<{ pKey: string; amount: number; rate: number }>;
  totalRows:       number;
}

/** Fetch 30-day CF Table for a given report run. */
export async function fetchCfTable(runId: string): Promise<CfTableResponse> {
  const params = new URLSearchParams({ runId });
  const res = await fetch(`${base()}/api/verify/cf-table?${params}`, { credentials: 'include' });
  return handleResponse<CfTableResponse>(res);
}

export interface BsRe33Row {
  row: number;
  acCode: string;
  acName: string;
  refNo: string;
  cptyNo: string;
  L: string; M: string; N: string; O: string; P: string;
  H: number; Q: number; R: number | null;
  S: string; sSource: string; T: number | null; U: number;
  V: string; W: string;
  buckets: number[];
  AH: boolean;
}

export interface BsRe33Response {
  success: boolean;
  runId: string;
  reportDate: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  bucketNames: string[];
  bucketRanges: Array<{ name: string; start: string; end: string }>;
  rows: BsRe33Row[];
}

/** Fetch BS_RE33-equivalent debug data. */
export async function fetchBsRe33(
  runId: string,
  page = 1,
  pageSize = 100,
): Promise<BsRe33Response> {
  const params = new URLSearchParams({ runId, page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`${base()}/api/debug/bs-re33?${params}`, { credentials: 'include' });
  return handleResponse<BsRe33Response>(res);
}

export interface RawCellRow {
  rowNumber: number;
  [key: string]: unknown;
}

export interface RawCellsResponse {
  success: boolean;
  filename: string;
  sheetName: string;
  total: number;
  rows: RawCellRow[];
}

/** Upload file and get raw cell values without any date transformation. */
export async function fetchRawCells(file: File): Promise<RawCellsResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${base()}/api/debug/raw-cells`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  return handleResponse<RawCellsResponse>(res);
}

/** Fetch paginated Account Mapping reference data from DB. */
export async function fetchAccountMappings(
  page = 1,
  pageSize = 50,
): Promise<AccountMappingResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const res = await fetch(`${base()}/api/account-mappings?${params}`, { credentials: 'include' });
  return handleResponse<AccountMappingResponse>(res);
}

/** Upload Excel file and run the full pipeline. Returns the summary immediately. */
export async function uploadAndProcess(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${base()}/api/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  return handleResponse<UploadResponse>(res);
}

/** List all available report dates with summary snapshots. */
export async function listHistory(): Promise<{ items: HistoryItem[] }> {
  const res = await fetch(`${base()}/api/history`, { credentials: 'include' });
  return handleResponse<{ items: HistoryItem[] }>(res);
}

/** Get the full summary for a specific report date. */
export async function getSummaryByDate(date: string): Promise<{ summary: SummaryRecord }> {
  const params = new URLSearchParams({ date });
  const res = await fetch(`${base()}/api/summary?${params}`, { credentials: 'include' });
  return handleResponse<{ summary: SummaryRecord }>(res);
}

/** Health check. */
/** Fetch the most recently uploaded run (any user). */
export interface LatestRunResponse {
  success: boolean;
  found: boolean;
  runId?: string;
  reportDate?: string;
  sourceFilename?: string;
  uploadedAt?: string;
  rawRowCount?: number;
}

export async function fetchLatestRun(): Promise<LatestRunResponse> {
  const res = await fetch(`${base()}/api/latest-run`, { credentials: 'include' });
  return handleResponse<LatestRunResponse>(res);
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${base()}/api/health`, { credentials: 'include' });
  return handleResponse<{ status: string }>(res);
}
