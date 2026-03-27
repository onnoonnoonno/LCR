/**
 * Interest Rate Stress Test Service
 *
 * Computes VaR (6 shock scenarios), EaR (multiple rate shocks), and
 * 12M Gap Ratio from the repricing bucket arrays produced by
 * calculateIrrbbFull().
 *
 * This is a pure-function layer that sits on top of the existing IRRBB
 * repricing engine. It does NOT read Excel files or external CSVs at
 * runtime — all data comes from the current app's stored raw_rows via
 * calculateIrrbbFull().
 *
 * Reference: Basel IRRBB standard shock scenarios / APRA APS117
 * Original validation source: IRRBB/app.py InterestRateStressTest()
 */

import { IrrbbFullResult } from './irrbbService';

// ============================================================
// Types
// ============================================================

export interface ShockResult {
  shockType: string;
  total:     number;
}

export interface EarResult {
  rateShock: number;   // e.g. 0.03
  ear:       number;
  earRatio:  number;
}

export interface BucketRow {
  bucketName:  string;
  asset:       number;
  liability:   number;
  netPosition: number;
}

export interface StressTestResult {
  bucketSummary:       BucketRow[];
  nonSensitive:        { asset: number; liability: number };
  totalAsset:          number;
  totalAssetSensitive: number;
  /** Rate-sensitive-only net positions for buckets 0-6 (for frontend EaR recalculation) */
  sensitiveNetPositions: number[];
  shockResults:        ShockResult[];
  var:                 number;
  varRatio:            number;
  gapRatio:            number | null;  // P30 from IRRBB
  earResults:          EarResult[];
}

// ============================================================
// Constants — 6 shock scenarios × 16 buckets
// ============================================================

/**
 * Shock type names (Basel IRRBB standard).
 */
export const SHOCK_TYPES = [
  'Parallel shock up',
  'Parallel shock down',
  'Short rate shock up',
  'Short rate shock down',
  'Steepener shock',
  'Flattener shock',
] as const;

/**
 * Weighting factors per bucket per shock type.
 * Array index = bucket index (0 = O/N, 1 = 0-<1M, ..., 15 = 20+Y).
 * Inner array order matches SHOCK_TYPES.
 *
 * Source: APRA APS117 / Basel IRRBB standard weighting factors.
 * Cross-validated against IRRBB/app.py lines 332-409.
 */
const WEIGHTING_FACTORS: number[][] = [
  // Bucket 0: Overnight (O/N) — all zeros
  [0, 0, 0, 0, 0, 0],
  // Bucket 1: 0 to <1 month (excl O/N)
  [0.0012, -0.0012, 0.001781332, -0.001781332, -0.001150399, 0.001420088],
  // Bucket 2: 1 to <2 months
  [0.0036, -0.0036, 0.005233859, -0.005233859, -0.003335552, 0.004142783],
  // Bucket 3: 2 to <3 months
  [0.006, -0.006, 0.008543319, -0.008543319, -0.005370485, 0.006712874],
  // Bucket 4: 3 to <6 months
  [0.0107, -0.0107, 0.014613691, -0.014613691, -0.008924376, 0.011307937],
  // Bucket 5: 6 to <9 months
  [0.0179, -0.0179, 0.022966022, -0.022966022, -0.013374323, 0.01733709],
  // Bucket 6: 9 to <12 months
  [0.025, -0.025, 0.030132097, -0.030132097, -0.016638701, 0.022140903],
  // Bucket 7: 1 to <2 years
  [0.0415, -0.0415, 0.042783758, -0.042783758, -0.020022945, 0.029036008],
  // Bucket 8: 2 to <3 years
  [0.0674, -0.0674, 0.05411493, -0.05411493, -0.016380677, 0.030762592],
  // Bucket 9: 3 to <4 years
  [0.0921, -0.0921, 0.057589488, -0.057589488, -0.005208962, 0.024588787],
  // Bucket 10: 4 to <5 years
  [0.1156, -0.1156, 0.056294738, -0.056294738, 0.010250525, 0.01380772],
  // Bucket 11: 5 to <7 years
  [0.1523, -0.1523, 0.050974085, -0.050974085, 0.037857211, -0.006547643],
  // Bucket 12: 7 to <10 years
  [0.1989, -0.1989, 0.035632826, -0.035632826, 0.081925533, -0.041551652],
  // Bucket 13: 10 to <15 years
  [0.2675, -0.2675, 0.017629695, -0.017629695, 0.141988821, -0.088194992],
  // Bucket 14: 15 to <20 years
  [0.3364, -0.3364, 0.006351977, -0.006351977, 0.195170425, -0.127784558],
  // Bucket 15: 20+ years
  [0.3904, -0.3904, 0.002112003, -0.002112003, 0.232022396, -0.153907196],
];

/**
 * Time weights for EaR calculation (within-1-year buckets only, indices 0-6).
 * Represents the proportion of the year remaining for earnings impact.
 *
 * Source: IRRBB/app.py lines 434-442.
 */
const TIME_WEIGHTS: number[] = [
  364 / 365,       // Bucket 0: O/N
  (12 - 0.5) / 12, // Bucket 1: 0 to <1 month
  (12 - 1.5) / 12, // Bucket 2: 1 to <2 months
  (12 - 2.5) / 12, // Bucket 3: 2 to <3 months
  (12 - 4.5) / 12, // Bucket 4: 3 to <6 months
  (12 - 7.5) / 12, // Bucket 5: 6 to <9 months
  (12 - 10.5) / 12, // Bucket 6: 9 to <12 months
];

/** Default rate shock scenarios for EaR */
const DEFAULT_RATE_SHOCKS = [0.03, 0.04, 0.05];

// ============================================================
// Main calculation
// ============================================================

/**
 * Calculate the full Interest Rate Stress Test from an IrrbbFullResult.
 *
 * Key design note on non-sensitive amounts:
 *   calculateIrrbbFull() tracks non-sensitive asset/liability separately
 *   (assetNonSens, liabNonSens) and does NOT include them in bucket arrays.
 *   The Python reference (app.py Repricing(), line 291) places non-sensitive
 *   amounts into the O/N bucket as a placeholder. We replicate this by
 *   adding non-sensitive to bucket[0] when computing net positions.
 */
export function calculateStressTest(
  fullResult: IrrbbFullResult,
  rateShocks: number[] = DEFAULT_RATE_SHOCKS,
): StressTestResult {
  const { assetBuckets, liabBuckets, assetNonSens, liabNonSens, buckets, P30 } = fullResult;

  // ------------------------------------------------------------------
  // 1. Build net position per bucket (asset - liability)
  //    Non-sensitive folded into bucket 0 (O/N) per Python reference
  // ------------------------------------------------------------------
  const netPosition = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    const a = assetBuckets[i] + (i === 0 ? assetNonSens : 0);
    const l = liabBuckets[i]  + (i === 0 ? liabNonSens  : 0);
    netPosition[i] = a - l;
  }

  // ------------------------------------------------------------------
  // 1b. Rate-sensitive-only net positions (for EaR — excludes non-sensitive)
  //     Matches app2.py line 461: asset_liability_gap = asset_row_sensitive - liability_row_sensitive
  // ------------------------------------------------------------------
  const sensitiveNetPositions: number[] = [];
  for (let i = 0; i < 16; i++) {
    sensitiveNetPositions.push(assetBuckets[i] - liabBuckets[i]);
  }

  // ------------------------------------------------------------------
  // 2. Total asset figures
  // ------------------------------------------------------------------
  const totalAssetSensitive = assetBuckets.reduce((s, v) => s + v, 0);
  const totalAsset = totalAssetSensitive + assetNonSens;

  // ------------------------------------------------------------------
  // 3. Bucket summary for display
  // ------------------------------------------------------------------
  const bucketSummary: BucketRow[] = buckets.map((b, i) => ({
    bucketName:  b.name,
    asset:       assetBuckets[i] + (i === 0 ? assetNonSens : 0),
    liability:   liabBuckets[i]  + (i === 0 ? liabNonSens  : 0),
    netPosition: netPosition[i],
  }));

  // ------------------------------------------------------------------
  // 4. Shock VaR calculation (6 scenarios × 16 buckets)
  // ------------------------------------------------------------------
  const shockResults: ShockResult[] = [];
  for (let s = 0; s < SHOCK_TYPES.length; s++) {
    let total = 0;
    for (let i = 0; i < 16; i++) {
      total += netPosition[i] * WEIGHTING_FACTORS[i][s];
    }
    shockResults.push({ shockType: SHOCK_TYPES[s], total });
  }

  const varValue = Math.min(...shockResults.map(r => r.total));
  const varRatio = totalAsset !== 0 ? varValue / totalAsset : 0;

  // ------------------------------------------------------------------
  // 5. EaR calculation (within-1-year, rate-sensitive-only net positions)
  //    Uses sensitiveNetPositions (excl. non-sensitive) to match app2.py
  //    calculate_metrics(), where asset_liability_gap is rate-sensitive only.
  // ------------------------------------------------------------------
  const earResults: EarResult[] = rateShocks.map(rateShock => {
    let earTotal = 0;
    for (let i = 0; i < TIME_WEIGHTS.length; i++) {
      earTotal += sensitiveNetPositions[i] * TIME_WEIGHTS[i] * rateShock;
    }
    const earRatio = totalAsset !== 0 ? earTotal / totalAsset : 0;
    return { rateShock, ear: earTotal, earRatio };
  });

  // ------------------------------------------------------------------
  // 6. Assemble result
  // ------------------------------------------------------------------
  return {
    bucketSummary,
    nonSensitive: { asset: assetNonSens, liability: liabNonSens },
    totalAsset,
    totalAssetSensitive,
    sensitiveNetPositions: sensitiveNetPositions.slice(0, TIME_WEIGHTS.length),
    shockResults,
    var: varValue,
    varRatio,
    gapRatio: P30,
    earResults,
  };
}
