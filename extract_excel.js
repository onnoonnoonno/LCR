const XLSX = require('c:/Users/Jay Yoon/Desktop/LCR/lcr-web/backend/node_modules/xlsx');

const filePath = 'c:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/template/LCR_Backdata_Template.xlsx';

const workbook = XLSX.readFile(filePath, {
  cellFormula: true,
  cellNF: true,
  cellStyles: true,
  raw: true,
});

console.log('=== Available Sheets ===');
console.log(workbook.SheetNames);

// ─── Account Mapping sheet ───────────────────────────────────────────────────
const amSheet = workbook.Sheets['Account Mapping'];
if (!amSheet) {
  console.error('Sheet "Account Mapping" not found!');
  process.exit(1);
}

function cellVal(sheet, addr) {
  const cell = sheet[addr];
  if (!cell) return '(empty)';
  return { v: cell.v, t: cell.t, f: cell.f ?? null };
}

console.log('\n=== Account Mapping: H4, H5, H6 (Ref No NonCashFlow overrides) ===');
['H4', 'H5', 'H6'].forEach(addr => {
  console.log(`  ${addr}:`, cellVal(amSheet, addr));
});

console.log('\n=== Account Mapping: I4 (NonCashFlow label) ===');
console.log('  I4:', cellVal(amSheet, 'I4'));

console.log('\n=== Account Mapping: H12:H45 (liability account codes for COUNTIF negation) ===');
for (let row = 12; row <= 45; row++) {
  const addr = `H${row}`;
  const cell = amSheet[addr];
  if (cell) {
    console.log(`  ${addr}:`, cell.v);
  } else {
    console.log(`  ${addr}: (empty)`);
  }
}

// ─── Account Mapping columns A-E rows 2-216 ──────────────────────────────────
console.log('\n=== Account Mapping: Columns A-E, Rows 2-216 ===');
console.log('Row | A | B | C | D | E');
console.log('----+---+---+---+---+---');
let nonEmptyCount = 0;
for (let row = 2; row <= 216; row++) {
  const a = amSheet[`A${row}`];
  const b = amSheet[`B${row}`];
  const c = amSheet[`C${row}`];
  const d = amSheet[`D${row}`];
  const e = amSheet[`E${row}`];

  // Only print rows that have at least one value
  if (a || b || c || d || e) {
    nonEmptyCount++;
    const av = a ? a.v : '';
    const bv = b ? b.v : '';
    const cv = c ? c.v : '';
    const dv = d ? d.v : '';
    const ev = e ? e.v : '';
    console.log(`  ${String(row).padStart(3)} | ${String(av).substring(0,30).padEnd(30)} | ${String(bv).substring(0,30).padEnd(30)} | ${String(cv).substring(0,20).padEnd(20)} | ${String(dv).substring(0,20).padEnd(20)} | ${String(ev).substring(0,20)}`);
  }
}
console.log(`\nTotal non-empty rows in A-E (rows 2-216): ${nonEmptyCount}`);

// ─── 30 days CF Table(ALL) sheet ─────────────────────────────────────────────
const cfSheetName = workbook.SheetNames.find(n => n.includes('30 days CF Table'));
if (!cfSheetName) {
  console.error('\nSheet containing "30 days CF Table" not found!');
  console.log('Available sheets:', workbook.SheetNames);
} else {
  console.log(`\n=== Sheet: "${cfSheetName}" ===`);
  const cfSheet = workbook.Sheets[cfSheetName];

  const targetCells = ['D97', 'D103', 'D106', 'D108', 'D110', 'D112', 'D115', 'D117', 'D119'];
  console.log('\nCell formulas/values:');
  targetCells.forEach(addr => {
    const cell = cfSheet[addr];
    if (!cell) {
      console.log(`  ${addr}: (empty)`);
    } else {
      console.log(`  ${addr}: value=${JSON.stringify(cell.v)}  formula=${cell.f ? '=' + cell.f : '(none)'}  type=${cell.t}`);
    }
  });

  // Also print surrounding context for D97 area to understand structure
  console.log('\n=== Context around D95-D125 in CF Table ===');
  for (let row = 95; row <= 125; row++) {
    const cCell = cfSheet[`C${row}`];
    const dCell = cfSheet[`D${row}`];
    const eCell = cfSheet[`E${row}`];
    if (cCell || dCell || eCell) {
      const cv = cCell ? String(cCell.v).substring(0, 40) : '';
      const df = dCell ? (dCell.f ? '=' + dCell.f : String(dCell.v)) : '';
      const ev = eCell ? String(eCell.v).substring(0, 20) : '';
      console.log(`  Row ${String(row).padStart(3)} | C: ${cv.padEnd(40)} | D: ${df.substring(0, 80)} | E: ${ev}`);
    }
  }
}
