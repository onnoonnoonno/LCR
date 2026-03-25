/**
 * API service layer — DB-backed architecture.
 */

function base(): string {
  return import.meta.env.VITE_API_URL ?? '';
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
// Auth token helpers (localStorage)
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'lcr_auth_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export interface LoginResponse {
  success: boolean;
  token: string;
  mustChangePassword: boolean;
  user: { id: number; employeeId: string; role: string };
}

export async function login(employeeId: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${base()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, password }),
  });
  return handleResponse<LoginResponse>(res);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean }> {
  const res = await fetch(`${base()}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await handleResponse<{ success: boolean; token?: string }>(res);
  // Replace the stored token so mustChangePassword=false is reflected immediately.
  // Without this, all subsequent API calls carry the old JWT and are blocked.
  if (data.token) setToken(data.token);
  return { success: data.success };
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
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    if (body.unmappedCodes?.length || body.unmappedNames?.length) {
      const err = new Error((body.error as string) || 'Unmapped accounts found in uploaded file.');
      (err as any).unmappedCodes = body.unmappedCodes;
      (err as any).unmappedNames = body.unmappedNames;
      throw err;
    }
    throw new Error((body.error as string) || `HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<UploadRawResponse>;
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
  const res = await fetch(`${base()}/api/raw-rows?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<RawRowsResponse>(res);
}

export interface ColumnLRow {
  rowNumber:      number;
  acCode:         string;
  acName:         string;
  refNo:          string;
  mapped:         boolean;
  category:       string;
  middleCategory: string;
  n:              string;
  nSource:        'override' | 'lookup';
  customerType:   string;
  oSource:        'lookup' | 'blank';
  pKey:           string;
  baseCcyAmt:     number;
  q:              number;
  signFlip:       boolean;
  rRate:          number | null;
  rSource:        'found' | 'not_found';
  u:              number;
  s:              string;
  sSource:        'override' | 'fallback';
  t:              number | null;
  v:              string;
  vSource:        'override' | 'fallback';
  w:              string;
  buckets:        number[];
  ah:             boolean;
  hitBucket:      string;
  nonZeroCount:   number;
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
  id:                 number;
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
  const res = await fetch(`${base()}/api/verify/column-l?${params}`, {
    headers: authHeaders(),
  });
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
  const res = await fetch(`${base()}/api/verify/lmg-summary?${params}`, {
    headers: authHeaders(),
  });
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
  const res = await fetch(`${base()}/api/verify/gap-forecast?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<ForecastResponse>(res);
}

export interface CfTableResponse {
  success:         boolean;
  runId:           string;
  reportDate:      string;
  day30End:        string;
  baseOutflow:     number;
  buybackOutflow:  number;
  otherOutflow:    number;
  grossOutflow:    number;
  baseInflow:      number;
  hoFacility:      number;
  sumInflow:       number;
  cappedInflow:    number;
  netCashOutflow:  number;
  hqla:            number;
  lcr:             number | null;
  outflowRows:     Array<{ pKey: string; amount: number; rate: number }>;
  inflowRows:      Array<{ pKey: string; amount: number; rate: number }>;
  totalRows:       number;
}

/** Fetch 30-day CF Table for a given report run. */
export async function fetchCfTable(runId: string): Promise<CfTableResponse> {
  const params = new URLSearchParams({ runId });
  const res = await fetch(`${base()}/api/verify/cf-table?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<CfTableResponse>(res);
}

// LCR Forecast (8-month projection)
export interface LcrForecastMonth {
  date:            string;
  label:           string;
  hqla:            number;
  totalOutflow:    number;
  totalInflow:     number;
  netCashOutflow:  number;
  lcr:             number | null;
}

export interface LcrForecastResponse {
  success:    boolean;
  runId:      string;
  reportDate: string;
  forecast:   LcrForecastMonth[];
}

export async function fetchLcrForecast(runId: string): Promise<LcrForecastResponse> {
  const params = new URLSearchParams({ runId });
  const res = await fetch(`${base()}/api/verify/lcr-forecast?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<LcrForecastResponse>(res);
}

export interface IrrbbTableRow {
  label: string;
  value: number | null;
  isPercent: boolean;
}

export interface IrrbbData {
  ratio: number | null;
  table: IrrbbTableRow[];
}

export interface IrrbbResponse {
  success: boolean;
  runId: string;
  irrbb: IrrbbData | null;
}

export async function fetchIrrbb(runId: string): Promise<IrrbbResponse> {
  const params = new URLSearchParams({ runId });
  const res = await fetch(`${base()}/api/verify/irrbb?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<IrrbbResponse>(res);
}

// ---------------------------------------------------------------------------
// Monthly Average LCR
// ---------------------------------------------------------------------------

export interface MonthlyAverageLcrResponse {
  success:           boolean;
  reportDate:        string;
  monthStart:        string;
  daysIncluded:      number;
  totalOutflow:      number;
  totalInflow:       number;
  totalHqla:         number;
  monthlyAverageLcr: number | null;
}

export async function fetchMonthlyAverageLcr(reportDate: string): Promise<MonthlyAverageLcrResponse> {
  const params = new URLSearchParams({ reportDate });
  const res = await fetch(`${base()}/api/monthly-average-lcr?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<MonthlyAverageLcrResponse>(res);
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
  const res = await fetch(`${base()}/api/debug/bs-re33?${params}`, {
    headers: authHeaders(),
  });
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
    headers: authHeaders(),
    body: formData,
  });
  return handleResponse<RawCellsResponse>(res);
}

/** Fetch paginated Account Mapping reference data from DB. */
export async function fetchAccountMappings(
  page = 1,
  pageSize = 50,
  search = '',
): Promise<AccountMappingResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) params.set('search', search.trim());
  const res = await fetch(`${base()}/api/account-mappings?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<AccountMappingResponse>(res);
}

export interface AccountMappingDistinct {
  success:            boolean;
  category:           string[];
  middleCategory:     string[];
  hqlaOrCashflowType: string[];
  assetLiabilityType: string[];
}

/** Fetch distinct dropdown values for account mapping fields. */
export async function fetchAccountMappingDistinct(): Promise<AccountMappingDistinct> {
  const res = await fetch(`${base()}/api/account-mappings/distinct`, {
    headers: authHeaders(),
  });
  return handleResponse<AccountMappingDistinct>(res);
}

export type AccountMappingInput = Omit<AccountMappingRow, 'id'>;

/** Create a new account mapping. Requires admin JWT. */
export async function createAccountMapping(data: AccountMappingInput): Promise<{ success: boolean; id: number }> {
  const res = await fetch(`${base()}/api/account-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse<{ success: boolean; id: number }>(res);
}

/** Update an existing account mapping. Requires admin JWT. */
export async function updateAccountMapping(id: number, data: AccountMappingInput): Promise<{ success: boolean }> {
  const res = await fetch(`${base()}/api/account-mappings/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse<{ success: boolean }>(res);
}

/** Delete an account mapping. Requires admin JWT. */
export async function deleteAccountMapping(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`${base()}/api/account-mappings/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse<{ success: boolean }>(res);
}

/** Upload Excel file and run the full pipeline. Returns the summary immediately. */
export async function uploadAndProcess(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${base()}/api/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return handleResponse<UploadResponse>(res);
}

/** List all available report dates with summary snapshots. */
export async function listHistory(): Promise<{ items: HistoryItem[] }> {
  const res = await fetch(`${base()}/api/history`, {
    headers: authHeaders(),
  });
  return handleResponse<{ items: HistoryItem[] }>(res);
}

/** Get the full summary for a specific report date. */
export async function getSummaryByDate(date: string): Promise<{ summary: SummaryRecord }> {
  const params = new URLSearchParams({ date });
  const res = await fetch(`${base()}/api/summary?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse<{ summary: SummaryRecord }>(res);
}

/** Fetch the most recently uploaded run. */
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
  const res = await fetch(`${base()}/api/latest-run`, {
    headers: authHeaders(),
  });
  return handleResponse<LatestRunResponse>(res);
}

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${base()}/api/health`, {
    headers: authHeaders(),
  });
  return handleResponse<{ status: string }>(res);
}

/** Delete a specific report run and all its associated data. Requires auth. */
export async function deleteHistoryRun(runId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${base()}/api/history/run/${runId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse<{ success: boolean }>(res);
}
