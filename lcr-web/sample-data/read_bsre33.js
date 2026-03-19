const XLSX = require('C:/Users/Jay Yoon/Desktop/LCR/lcr-web/backend/node_modules/xlsx');

const filePath = 'C:/Users/Jay Yoon/Desktop/LCR/lcr-web/sample-data/template/LCR_Backdata_Template.xlsx';

const wb = XLSX.readFile(filePath, { cellFormula: true, cellNF: true, cellStyles: true });

console.log('All sheet names:');
wb.SheetNames.forEach((s, i) => console.log(`  ${i}: ${s}`));

// Find sheets with BS_RE or similar
console.log('\nSheets matching BS_RE:');
wb.SheetNames.filter(s => s.includes('BS_RE') || s.includes('bs_re')).forEach(s => console.log(' ', s));

// Try to read BS_RE33 sheet
const bsSheet = wb.Sheets['BS_RE33'];
if (bsSheet) {
  console.log('\n=== BS_RE33 sheet — rows 1-15, columns A-M ===');
  for (let row = 1; row <= 15; row++) {
    const rowData = [];
    for (const col of ['A','B','C','D','E','F','G','H','I','J','K','L','M']) {
      const cell = bsSheet[`${col}${row}`];
      if (cell) {
        const val = cell.f ? `=[${cell.f}]=${cell.v}` : String(cell.v ?? '');
        rowData.push(`${col}${row}: ${val}`);
      }
    }
    if (rowData.length) console.log(`Row ${row}: ${rowData.join(' | ')}`);
  }

  // K column specifically
  console.log('\n=== BS_RE33 K column rows 1-20 ===');
  for (let row = 1; row <= 20; row++) {
    const cell = bsSheet[`K${row}`];
    if (cell) {
      console.log(`K${row}: type=${cell.t} value=${cell.v} formula=${cell.f ? '='+cell.f : '(none)'}`);
    } else {
      console.log(`K${row}: (empty)`);
    }
  }
} else {
  console.log('\nBS_RE33 sheet not found!');
}
