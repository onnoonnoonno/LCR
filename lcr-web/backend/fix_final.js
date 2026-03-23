/**
 * Final fixes for reportController.ts after pg migration
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'src', 'controllers', 'reportController.ts');
let c = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');

// 1. Fix return type: async handlers declared as ): void { must be ): Promise<void> {
// Only for export async functions (handlers)
c = c.replace(/export async function (\w+)\((.*?)\): void \{/g,
  (m, name, params) => `export async function ${name}(${params}): Promise<void> {`);
console.log('Fixed async handler return types');

// 2. Fix rawDbRowsTyped → rawDbRows (leftover from convert_controller.js)
c = c.split('rawDbRowsTyped').join('rawDbRows');
console.log('Fixed rawDbRowsTyped');

// 3. Fix lcrPercent IIFE inside res.json — extract before res.json and make async
// The lcrPercent: (() => { ... await ... })() needs to become async and be pre-computed
const oldLcrPercentIife = `      lcrPercent: (() => {
        // Inline D119 computation — same logic as CF Table endpoint
        const { rows: arRows3 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');
        const arMap3 = new Map((arRows3 as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));`;
const newLcrPercentIife = `      lcrPercent: await (async () => {
        // Inline D119 computation — same logic as CF Table endpoint
        const { rows: arRows3 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');
        const arMap3 = new Map((arRows3 as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));`;
if (c.includes(oldLcrPercentIife)) {
  c = c.split(oldLcrPercentIife).join(newLcrPercentIife);
  console.log('Fixed lcrPercent async IIFE');
} else {
  console.log('NOT FOUND: lcrPercent IIFE');
}

// 4. Fix lcrPercentForDb IIFE — make it async
const oldLcrPercentForDb = `      const lcrPercentForDb = (() => {`;
const newLcrPercentForDb = `      const lcrPercentForDb = await (async () => {`;
if (c.includes(oldLcrPercentForDb)) {
  c = c.split(oldLcrPercentForDb).join(newLcrPercentForDb);
  console.log('Fixed lcrPercentForDb async IIFE');
} else {
  console.log('NOT FOUND: lcrPercentForDb IIFE');
}

// 5. Fix implicit 'any' on (r) in map calls that aren't typed
// The rawRows.map in handleVerify7DayForecast
c = c.replace(
  `    const enriched = rawRows.map((r) => {
      const ac = (r.ac_code ?? '').trim();`,
  `    const enriched = (rawRows as Array<{ ac_code: string | null; base_ccy_amt: number | null; maturity_date: string | null }>).map((r) => {
      const ac = (r.ac_code ?? '').trim();`
);

// Fix allRows.map (for any of them)
// The allRows.map in handleVerifyColumnL
c = c.replace(
  `    for (const r of allRows) {
      const m = lookupAccountMapping(r.ac_code);`,
  `    for (const r of (allRows as Array<{ ac_code: string | null; ref_no: string | null; counterparty_no: string | null }>)) {
      const m = lookupAccountMapping(r.ac_code);`
);

// Fix rawDbRows.map in handleDebugBsRe33 (the .map call)
c = c.replace(
  `    const rows = rawDbRows.map((r) => {
      const mapping  = lookupAccountMapping(r.ac_code);`,
  `    const rows = (rawDbRows as Array<{ row_number: number; ac_code: string | null; ac_name: string | null; ref_no: string | null; counterparty_no: string | null; base_ccy_amt: number | null; maturity_date: string | null }>).map((r) => {
      const mapping  = lookupAccountMapping(r.ac_code);`
);

console.log('Applied map type fixes');

// Report remaining async issues
const awaitInSync = c.split('\n').filter((line, i) => {
  // Find await inside non-async arrow functions like (() => { ... await
  return false; // skip for now, handled above
});

const remaining = (c.match(/db\.prepare\(/g) || []).length;
console.log('Remaining db.prepare:', remaining);

fs.writeFileSync(filePath, c);
console.log('Done.');
