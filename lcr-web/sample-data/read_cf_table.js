const XLSX = require('C:/Users/Jay Yoon/Desktop/LCR/lcr-web/backend/node_modules/xlsx');

const filePath = 'C:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/template/LCR_Backdata_Template.xlsx';

// Read with cellFormula option enabled
const wb = XLSX.readFile(filePath, { cellFormula: true, cellNF: true, cellStyles: true });

// ── 1. CF Table sheet ──────────────────────────────────────────────────────────
const cfSheet = wb.Sheets['30 days CF Table(ALL)'];
if (!cfSheet) {
  console.error('Sheet "30 days CF Table(ALL)" not found.');
  console.log('Available sheets:', wb.SheetNames);
  process.exit(1);
}

console.log('=== 30 days CF Table(ALL) — Rows 4-64 ===');
console.log('Row | H (description)                                        | I (direction)   | K (30-day amount / formula)');
console.log('----+--------------------------------------------------------+-----------------+--------------------------------------------');

for (let row = 4; row <= 64; row++) {
  const hCell = cfSheet[`H${row}`];
  const iCell = cfSheet[`I${row}`];
  const kCell = cfSheet[`K${row}`];

  const hVal = hCell ? (hCell.v !== undefined ? String(hCell.v) : '') : '';
  const iVal = iCell ? (iCell.v !== undefined ? String(iCell.v) : '') : '';

  let kDisplay = '';
  if (kCell) {
    if (kCell.f) {
      kDisplay = `FORMULA: =${kCell.f}  |  VALUE: ${kCell.v}`;
    } else {
      kDisplay = `VALUE: ${kCell.v}`;
    }
  }

  console.log(`${String(row).padStart(3)} | ${hVal.substring(0, 54).padEnd(54)} | ${iVal.padEnd(15)} | ${kDisplay}`);
}

// ── 2. K4 formula specifically ─────────────────────────────────────────────────
console.log('\n=== K4 cell detail ===');
const k4 = cfSheet['K4'];
if (k4) {
  console.log('Type:', k4.t);
  console.log('Value:', k4.v);
  console.log('Formula:', k4.f ? `=${k4.f}` : '(no formula / static value)');
} else {
  console.log('K4 is empty or undefined');
}

// ── 3. BS_RE33 sheet — K7 ─────────────────────────────────────────────────────
console.log('\n=== BS_RE33!K7 ===');
const bsSheet = wb.Sheets['BS_RE33'];
if (!bsSheet) {
  console.error('Sheet "BS_RE33" not found.');
  console.log('Available sheets:', wb.SheetNames);
} else {
  const k7 = bsSheet['K7'];
  if (k7) {
    console.log('Type:', k7.t);
    console.log('Value:', k7.v);
    console.log('Formula:', k7.f ? `=${k7.f}` : '(no formula / static value)');
  } else {
    console.log('K7 is empty or undefined');
  }
}
