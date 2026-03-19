const XLSX = require('C:/Users/Jay Yoon/Desktop/LCR/lcr-web/backend/node_modules/xlsx');

const templatePath = 'C:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/template/LCR_Backdata_Template.xlsx';
const dataPath = 'C:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/raw/default - 2026-02-05T092024.784.xlsx';

console.log('='.repeat(80));
console.log('READING TEMPLATE FILE');
console.log('='.repeat(80));

const templateWb = XLSX.readFile(templatePath, { cellFormula: true, cellDates: true });
console.log('\nTEMPLATE SHEET NAMES:');
templateWb.SheetNames.forEach((name, i) => console.log(`  [${i}] ${name}`));

console.log('\n' + '='.repeat(80));
console.log('READING DATA FILE');
console.log('='.repeat(80));

const dataWb = XLSX.readFile(dataPath, { cellFormula: true, cellDates: true });
console.log('\nDATA SHEET NAMES:');
dataWb.SheetNames.forEach((name, i) => console.log(`  [${i}] ${name}`));

// Helper: get row number from address
function getRow(addr) {
  const m = addr.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

// Helper: get col letters from address
function getCol(addr) {
  const m = addr.match(/^([A-Z]+)/);
  return m ? m[1] : '';
}

// ============================================================
// TASK 2: Summary sheet - ALL cells
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - Summary Sheet (ALL CELLS)');
console.log('='.repeat(80));

const summaryWs = templateWb.Sheets['Summary'];
if (summaryWs) {
  const ref = summaryWs['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(summaryWs).filter(([addr]) => !addr.startsWith('!'));
  entries.sort((a, b) => {
    const ra = getRow(a[0]), rb = getRow(b[0]);
    if (ra !== rb) return ra - rb;
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([addr, cell]) => {
    const info = { v: cell.v, t: cell.t };
    if (cell.f) info.f = cell.f;
    if (cell.w) info.w = cell.w;
    console.log(`  ${addr}: ${JSON.stringify(info)}`);
  });
} else {
  console.log('  Sheet "Summary" NOT FOUND');
  console.log('  Available:', templateWb.SheetNames.join(', '));
}

// ============================================================
// TASK 3: BS_RE33 sheet - first 30 rows
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - BS_RE33 Sheet (first 30 rows)');
console.log('='.repeat(80));

const bsRe33Ws = templateWb.Sheets['BS_RE33'];
if (bsRe33Ws) {
  const ref = bsRe33Ws['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(bsRe33Ws).filter(([addr]) => !addr.startsWith('!') && getRow(addr) <= 30);
  entries.sort((a, b) => {
    const ra = getRow(a[0]), rb = getRow(b[0]);
    if (ra !== rb) return ra - rb;
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([addr, cell]) => {
    const info = { v: cell.v, t: cell.t };
    if (cell.f) info.f = cell.f;
    if (cell.w) info.w = cell.w;
    console.log(`  ${addr}: ${JSON.stringify(info)}`);
  });
} else {
  console.log('  Sheet "BS_RE33" NOT FOUND in template');
}

// ============================================================
// TASK 4: 30 days CF Table(ALL) - first 20 rows
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - "30 days CF Table(ALL)" Sheet (first 20 rows)');
console.log('='.repeat(80));

// Try various name variants
const cfSheetName = templateWb.SheetNames.find(n => n.includes('30') && n.includes('CF'))
  || templateWb.SheetNames.find(n => n.toLowerCase().includes('cf table'))
  || templateWb.SheetNames.find(n => n.includes('30 days'));

console.log('Found CF Table sheet name:', cfSheetName);

if (cfSheetName) {
  const cfWs = templateWb.Sheets[cfSheetName];
  const ref = cfWs['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(cfWs).filter(([addr]) => !addr.startsWith('!') && getRow(addr) <= 20);
  entries.sort((a, b) => {
    const ra = getRow(a[0]), rb = getRow(b[0]);
    if (ra !== rb) return ra - rb;
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([addr, cell]) => {
    const info = { v: cell.v, t: cell.t };
    if (cell.f) info.f = cell.f;
    if (cell.w) info.w = cell.w;
    console.log(`  ${addr}: ${JSON.stringify(info)}`);
  });
} else {
  console.log('  CF Table sheet NOT FOUND');
  console.log('  Available sheets:', templateWb.SheetNames.join(', '));
}

// ============================================================
// TASK 5: Liquidity Maturity Gap - first 20 rows
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - "Liquidity Maturity Gap" Sheet (first 20 rows)');
console.log('='.repeat(80));

const lmgSheetName = templateWb.SheetNames.find(n => n.toLowerCase().includes('liquidity') && n.toLowerCase().includes('gap'))
  || templateWb.SheetNames.find(n => n.toLowerCase().includes('maturity'));

console.log('Found LMG sheet name:', lmgSheetName);

if (lmgSheetName) {
  const lmgWs = templateWb.Sheets[lmgSheetName];
  const ref = lmgWs['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(lmgWs).filter(([addr]) => !addr.startsWith('!') && getRow(addr) <= 20);
  entries.sort((a, b) => {
    const ra = getRow(a[0]), rb = getRow(b[0]);
    if (ra !== rb) return ra - rb;
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([addr, cell]) => {
    const info = { v: cell.v, t: cell.t };
    if (cell.f) info.f = cell.f;
    if (cell.w) info.w = cell.w;
    console.log(`  ${addr}: ${JSON.stringify(info)}`);
  });
} else {
  console.log('  Liquidity Maturity Gap sheet NOT FOUND');
  console.log('  Available sheets:', templateWb.SheetNames.join(', '));
}

// ============================================================
// TASK 6: DATA FILE - BS_RE33 sheet - first 10 rows
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('DATA FILE - BS_RE33 Sheet (first 10 rows)');
console.log('='.repeat(80));

const dataBsRe33Ws = dataWb.Sheets['BS_RE33'];
if (dataBsRe33Ws) {
  const ref = dataBsRe33Ws['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(dataBsRe33Ws).filter(([addr]) => !addr.startsWith('!') && getRow(addr) <= 10);
  entries.sort((a, b) => {
    const ra = getRow(a[0]), rb = getRow(b[0]);
    if (ra !== rb) return ra - rb;
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([addr, cell]) => {
    const info = { v: cell.v, t: cell.t };
    if (cell.f) info.f = cell.f;
    if (cell.w) info.w = cell.w;
    console.log(`  ${addr}: ${JSON.stringify(info)}`);
  });
} else {
  console.log('  Sheet "BS_RE33" NOT FOUND in data file');
  console.log('  Available:', dataWb.SheetNames.join(', '));
}

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(80));
