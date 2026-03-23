/**
 * Converts reportController.ts from better-sqlite3 to pg.
 * Run with: node convert_controller.js
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'controllers', 'reportController.ts');
let c = fs.readFileSync(filePath, 'utf-8');

// Helper: replace ? with $1, $2, ... in a SQL string
function pg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

// ============================================================
// canAccessRun — fix the body (previous script may have missed)
// ============================================================
if (c.includes("const run = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);")) {
  c = c.replace(
    "  const run = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);\n" +
    "  return run != null; // run exists → any authenticated user may read it",
    "  const { rows } = await pool.query('SELECT id FROM report_runs WHERE id = $1', [runId]);\n" +
    "  return rows.length > 0;"
  );
  console.log('Fixed canAccessRun body');
}

// ============================================================
// handleGetLatestRun
// ============================================================
c = c.replace(
  `    type LatestRunRow = { run_id: string; report_date: string; source_filename: string; uploaded_at: string; row_count: number };
    const row = pool.prepare(\`
      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at,
             (SELECT COUNT(*) FROM raw_rows WHERE report_run_id = rr.id) AS row_count
      FROM report_runs rr
      WHERE rr.id = (
        SELECT sub.id FROM report_runs sub
        WHERE sub.report_date = rr.report_date
        ORDER BY sub.uploaded_at DESC LIMIT 1
      )
      ORDER BY rr.uploaded_at DESC LIMIT 1
    \`).get() as LatestRunRow | undefined;`,
  `    type LatestRunRow = { run_id: string; report_date: string; source_filename: string; uploaded_at: string; row_count: number };
    const { rows: _lrRows } = await pool.query(\`
      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at,
             (SELECT COUNT(*) FROM raw_rows WHERE report_run_id = rr.id) AS row_count
      FROM report_runs rr
      WHERE rr.id = (
        SELECT sub.id FROM report_runs sub
        WHERE sub.report_date = rr.report_date
        ORDER BY sub.uploaded_at DESC LIMIT 1
      )
      ORDER BY rr.uploaded_at DESC LIMIT 1
    \`);
    const row = _lrRows[0] as LatestRunRow | undefined;`
);

// ============================================================
// handleListHistory — the big dedup query
// ============================================================
c = c.replace(
  `    const rows = pool.prepare(\`
      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at, rr.status,
             rs.eligible_hqla, rs.gross_outflows, rs.net_cash_outflows, rs.lcr_ratio, rs.ratio_3m_lr
      FROM report_runs rr
      LEFT JOIN report_summaries rs ON rs.report_run_id = rr.id
      WHERE rr.id = (
        SELECT id FROM report_runs
        WHERE report_date = rr.report_date
        ORDER BY uploaded_at DESC LIMIT 1
      )
      ORDER BY rr.report_date DESC
    \`).all() as Array<{`,
  `    const { rows } = await pool.query(\`
      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at, rr.status,
             rs.eligible_hqla, rs.gross_outflows, rs.net_cash_outflows, rs.lcr_ratio, rs.ratio_3m_lr
      FROM report_runs rr
      LEFT JOIN report_summaries rs ON rs.report_run_id = rr.id
      WHERE rr.id = (
        SELECT id FROM report_runs
        WHERE report_date = rr.report_date
        ORDER BY uploaded_at DESC LIMIT 1
      )
      ORDER BY rr.report_date DESC
    \`);
    const _listRows = rows as Array<{`
);
// Fix the variable reference
c = c.replace(
  "    const items = rows.map((r: any) => ({",
  "    const items = _listRows.map((r: any) => ({"
);

// ============================================================
// handleDeleteRun
// ============================================================
c = c.replace(
  "    const exists = pool.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);\n" +
  "    if (!exists) {",
  "    const { rows: _existRows } = await pool.query('SELECT id FROM report_runs WHERE id = $1', [runId]);\n" +
  "    if (_existRows.length === 0) {"
);
c = c.replace(
  "    pool.prepare('DELETE FROM report_summaries WHERE report_run_id = ?').run(runId);\n" +
  "    pool.prepare('DELETE FROM processed_rows WHERE report_run_id = ?').run(runId);\n" +
  "    pool.prepare('DELETE FROM raw_rows WHERE report_run_id = ?').run(runId);\n" +
  "    pool.prepare('DELETE FROM report_runs WHERE id = ?').run(runId);",
  "    await pool.query('DELETE FROM report_summaries WHERE report_run_id = $1', [runId]);\n" +
  "    await pool.query('DELETE FROM processed_rows WHERE report_run_id = $1', [runId]);\n" +
  "    await pool.query('DELETE FROM raw_rows WHERE report_run_id = $1', [runId]);\n" +
  "    await pool.query('DELETE FROM report_runs WHERE id = $1', [runId]);"
);

// ============================================================
// handleResetHistory — db.exec
// ============================================================
c = c.replace(
  "    pool.exec(`\n" +
  "      DELETE FROM report_summaries;\n" +
  "      DELETE FROM processed_rows;\n" +
  "      DELETE FROM raw_rows;\n" +
  "      DELETE FROM report_runs;\n" +
  "    `);",
  "    await pool.query('DELETE FROM report_summaries');\n" +
  "    await pool.query('DELETE FROM processed_rows');\n" +
  "    await pool.query('DELETE FROM raw_rows');\n" +
  "    await pool.query('DELETE FROM report_runs');"
);

// ============================================================
// handleVerifyColumnL — COUNT
// ============================================================
c = c.replace(
  "    // Total count\n" +
  "    const total = (pool.prepare(\n" +
  "      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = ?'\n" +
  "    ).get(runId) as { cnt: number }).cnt;",
  "    // Total count\n" +
  "    const { rows: _clCountRows } = await pool.query(\n" +
  "      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = $1', [runId]\n" +
  "    );\n" +
  "    const total = parseInt(_clCountRows[0].cnt, 10);"
);
// Fetch report date for run
c = c.replace(
  "    // Fetch report date for this run\n" +
  "    const runMeta = pool.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n" +
  "      { report_date: string } | undefined;\n" +
  "    const reportDate = runMeta?.report_date ?? '';",
  "    // Fetch report date for this run\n" +
  "    const { rows: _clMeta } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n" +
  "    const runMeta = _clMeta[0] as { report_date: string } | undefined;\n" +
  "    const reportDate = runMeta?.report_date ?? '';"
);
// Fetch raw rows page
c = c.replace(
  "    // Fetch raw rows for this page\n" +
  "    const rawDbRows = pool.prepare(`\n" +
  "      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,\n" +
  "             base_ccy_amt, maturity_date\n" +
  "      FROM raw_rows\n" +
  "      WHERE report_run_id = ?\n" +
  "      ORDER BY row_number\n" +
  "      LIMIT ? OFFSET ?\n" +
  "    `).all(runId, ps, offset) as Array<{",
  "    // Fetch raw rows for this page\n" +
  "    const { rows: rawDbRows } = await pool.query(`\n" +
  "      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,\n" +
  "             base_ccy_amt, maturity_date\n" +
  "      FROM raw_rows\n" +
  "      WHERE report_run_id = $1\n" +
  "      ORDER BY row_number\n" +
  "      LIMIT $2 OFFSET $3\n" +
  "    `, [runId, ps, offset]);\n" +
  "    const _clRawTyped = rawDbRows as Array<{"
);
// Fix the variable references after the type assertion block
// The type assertion block ends with }> so we just need to make rawDbRows usable
// Actually we renamed rawDbRows to _clRawTyped above, but the variable rawDbRows is used in the rest of the handler.
// Let me add a reassignment
c = c.replace(
  "    const _clRawTyped = rawDbRows as Array<{\n" +
  "      id: number; row_number: number; ac_code: string | null;\n" +
  "      ac_name: string | null; ref_no: string | null;\n" +
  "      counterparty_no: string | null; base_ccy_amt: number | null;\n" +
  "      maturity_date: string | null;\n" +
  "    }>;",
  "    const _clRawTyped = rawDbRows as Array<{\n" +
  "      id: number; row_number: number; ac_code: string | null;\n" +
  "      ac_name: string | null; ref_no: string | null;\n" +
  "      counterparty_no: string | null; base_ccy_amt: number | null;\n" +
  "      maturity_date: string | null;\n" +
  "    }>;\n" +
  "    const rawDbRowsTyped = _clRawTyped;"
);

// customer type query in handleVerifyColumnL
c = c.replace(
  "    // Build customer type lookup map from DB (raw Excel values)\n" +
  "    const ctRows = pool.prepare(\n" +
  "      'SELECT counterparty_no, customer_type FROM customer_types'\n" +
  "    ).all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    // Build customer type lookup map from DB (raw Excel values)\n" +
  "    const { rows: ctRows } = await pool.query(\n" +
  "      'SELECT counterparty_no, customer_type FROM customer_types'\n" +
  "    );"
);
// assumption rules in handleVerifyColumnL
c = c.replace(
  "    const arRows = pool.prepare(\n" +
  "      'SELECT p_key, assumption_rate FROM assumption_rules'\n" +
  "    ).all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows } = await pool.query(\n" +
  "      'SELECT p_key, assumption_rate FROM assumption_rules'\n" +
  "    );"
);
// maturity overrides in handleVerifyColumnL
c = c.replace(
  "    const moRows = pool.prepare(\n" +
  "      'SELECT ac_code, formula_type, formula_params FROM maturity_overrides'\n" +
  "    ).all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows } = await pool.query(\n" +
  "      'SELECT ac_code, formula_type, formula_params FROM maturity_overrides'\n" +
  "    );"
);

// allRows stats query in handleVerifyColumnL
c = c.replace(
  "    const allRows = pool.prepare(\n" +
  "      'SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = ?'\n" +
  "    ).all(runId) as Array<{ ac_code: string | null; ref_no: string | null; counterparty_no: string | null }>;",
  "    const { rows: allRows } = await pool.query(\n" +
  "      'SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = $1', [runId]\n" +
  "    );"
);

// Fix rawDbRows.map → rawDbRowsTyped.map in handleVerifyColumnL
// The rows variable is called rawDbRows but typed by a cast; we need to use the typed version
// (This is handled by the rawDbRowsTyped variable we added above)
// Now update the .map call:
c = c.replace(
  "    const rows = rawDbRows.map((r) => {",
  "    const rows = rawDbRowsTyped.map((r) => {"
);

console.log('handleVerifyColumnL done');
fs.writeFileSync(filePath, c);
process.exit(0);
