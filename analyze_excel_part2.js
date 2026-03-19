const XLSX = require('C:/Users/Jay Yoon/Desktop/LCR/lcr-web/backend/node_modules/xlsx');

const templatePath = 'C:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/template/LCR_Backdata_Template.xlsx';
const dataPath = 'C:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/raw/default - 2026-02-05T092024.784.xlsx';

function getRow(addr) {
  const m = addr.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

const templateWb = XLSX.readFile(templatePath, { cellFormula: true, cellDates: true });
const dataWb = XLSX.readFile(dataPath, { cellFormula: true, cellDates: true });

// ============================================================
// 30 days CF Table(ALL) - focus on D119 and rows 100-120
// ============================================================
console.log('='.repeat(80));
console.log('TEMPLATE - "30 days CF Table(ALL)" - rows 90-120 (LCR calculation rows)');
console.log('='.repeat(80));

const cfAllWs = templateWb.Sheets['30 days CF Table(ALL)'];
if (cfAllWs) {
  const ref = cfAllWs['!ref'];
  console.log('Sheet ref:', ref);
  // Print rows 90-120
  const entries = Object.entries(cfAllWs).filter(([addr]) => {
    if (addr.startsWith('!')) return false;
    const row = getRow(addr);
    return row >= 90 && row <= 120;
  });
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
  console.log('NOT FOUND. Available:', templateWb.SheetNames.join(', '));
}

// ============================================================
// 30 days CF Table(ALL) - show first 20 rows too (structure)
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - "30 days CF Table(ALL)" - rows 1-20 (structure/headers)');
console.log('='.repeat(80));

if (cfAllWs) {
  const entries = Object.entries(cfAllWs).filter(([addr]) => {
    if (addr.startsWith('!')) return false;
    const row = getRow(addr);
    return row >= 1 && row <= 20;
  });
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
}

// ============================================================
// Liquidity Maturity Gap - rows 1-20
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - "Liquidity Maturity Gap" - rows 1-20');
console.log('='.repeat(80));

const lmgWs = templateWb.Sheets['Liquidity Maturity Gap'];
if (lmgWs) {
  const ref = lmgWs['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(lmgWs).filter(([addr]) => {
    if (addr.startsWith('!')) return false;
    const row = getRow(addr);
    return row >= 1 && row <= 20;
  });
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
  console.log('NOT FOUND');
}

// ============================================================
// Liquidity Maturity Gap - rows 65-80 (where J73, Q73 are)
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE - "Liquidity Maturity Gap" - rows 65-80 (LCR key cells)');
console.log('='.repeat(80));

if (lmgWs) {
  const entries = Object.entries(lmgWs).filter(([addr]) => {
    if (addr.startsWith('!')) return false;
    const row = getRow(addr);
    return row >= 65 && row <= 80;
  });
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
}

// ============================================================
// DATA FILE - Sheet1 - first 10 rows
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('DATA FILE - Sheet1 (first 10 rows)');
console.log('='.repeat(80));

const sheet1Ws = dataWb.Sheets['Sheet1'];
if (sheet1Ws) {
  const ref = sheet1Ws['!ref'];
  console.log('Sheet ref:', ref);
  const entries = Object.entries(sheet1Ws).filter(([addr]) => {
    if (addr.startsWith('!')) return false;
    return getRow(addr) <= 10;
  });
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
  console.log('NOT FOUND');
}

console.log('\n' + '='.repeat(80));
console.log('DONE');
console.log('='.repeat(80));
