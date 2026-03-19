/**
 * Frontend – Phase 2 type definitions.
 * Mirror of backend/src/types/bs-re33.ts (API contract).
 */

export type AssetLiabilityType = 'asset' | 'liability' | 'off-balance-sheet';
export type CustomerType =
  | 'Retail' | 'SME' | 'NonFinancialCorporate' | 'FinancialInstitution'
  | 'CentralBank' | 'Sovereign' | 'PublicSectorEntity' | 'Interbank' | 'Unknown';

export type MaturityBucket =
  | 'overdue' | '1D' | '2_7D' | '8_30D' | '31_90D'
  | '91_180D' | '181_365D' | 'over365D' | 'open_maturity';

export type MaturitySource =
  | 'maturityAdjustment' | 'maturityDate' | 'nextInterestResetDate' | 'none';

export interface LcrBuckets {
  overdue: number; b1D: number; b2_7D: number; b8_30D: number;
  b31_90D: number; b91_180D: number; b181_365D: number; bOver365D: number; bOpenMaturity: number;
}

export interface BS_RE33Row {
  rowNumber: number;
  acCode: string | null; acName: string | null; refNo: string | null;
  counterpartyNo: string | null; counterpartyName: string | null;
  ccy: string | null; balanceAmt: number | null; baseCcyAmt: number | null;
  approvalContractDate: string | null; maturityDate: string | null; nextInterestResetDate: string | null;
  category: string | null; middleCategory: string | null;
  hqlaOrCashflowType: string | null; assetLiabilityType: AssetLiabilityType | null;
  signMultiplier: number; isHqla: boolean; hqlaLevel: string | null;
  customerType: CustomerType | null;
  adjustedBaseCcyAmt: number; assumptionRate: number; weightedAmount: number;
  lcrMaturityDate: string | null; maturitySource: MaturitySource;
  daysToMaturity: number | null; maturityBucket: MaturityBucket | null;
  buckets: LcrBuckets;
  isCashInflow: boolean; isCashOutflow: boolean;
  notes: string[]; warnings: string[];
}

export interface HqlaSummary {
  level1Raw: number; level2aRaw: number; level2bRaw: number;
  level1Weighted: number; level2aWeighted: number; level2bWeighted: number;
  adjustedTotal: number; eligibleTotal: number;
}

export interface LcrBucketSummary { total: number; byBucket: LcrBuckets; }

export interface LcrSummary {
  reportDate: string;
  hqla: HqlaSummary;
  cashOutflows: LcrBucketSummary;
  cashInflows: LcrBucketSummary;
  cappedInflowsTotal: number;
  netCashOutflows: number;
  lcrRatio: number | null;
  meetsMinimum: boolean | null;
  rowCount: number; mappedRows: number; unmappedRows: number; rowsWithWarnings: number;
}

export interface CalculateSuccessResponse {
  success: true;
  calculationId: string;
  reportDate: string;
  rowCount: number;
  calculatedRows: number;
  summary: LcrSummary;
  warnings: number;
  errors: number;
}

export interface CalculateErrorResponse { success: false; error: string; }
export type CalculateResponse = CalculateSuccessResponse | CalculateErrorResponse;

export interface BS_RE33PageResponse {
  calculationId: string; reportDate: string;
  page: number; pageSize: number; totalRows: number; totalPages: number;
  rows: BS_RE33Row[];
}

export interface SummaryResponse {
  calculationId: string;
  summary: LcrSummary;
}
