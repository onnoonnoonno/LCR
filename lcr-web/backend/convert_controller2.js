/**
 * Convert all remaining db.prepare() calls in reportController.ts to pg syntax.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'controllers', 'reportController.ts');
let c = fs.readFileSync(filePath, 'utf-8');

let count = 0;
function rep(from, to) {
  if (c.includes(from)) {
    c = c.replace(from, to);
    count++;
  } else {
    console.warn('NOT FOUND:', from.substring(0, 80));
  }
}

// ===========================================================================
// canAccessRun body (last attempt)
// ===========================================================================
rep(
  "  const run = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);\n  return run != null; // run exists → any authenticated user may read it",
  "  const { rows: _car } = await pool.query('SELECT id FROM report_runs WHERE id = $1', [runId]);\n  return _car.length > 0;"
);

// ===========================================================================
// handleGetLatestRun
// ===========================================================================
rep(
  "    const row = db.prepare(`",
  "    const { rows: _lrr } = await pool.query(`"
);
// Find and fix the .get() at the end of the handleGetLatestRun query
rep(
  "    `).get() as LatestRunRow | undefined;",
  "    `);\n    const row = _lrr[0] as LatestRunRow | undefined;"
);

// ===========================================================================
// handleListHistory (already done by earlier script, verify)
// ===========================================================================

// ===========================================================================
// handleDeleteRun
// ===========================================================================
rep(
  "    const exists = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);\n    if (!exists) {",
  "    const { rows: _dr } = await pool.query('SELECT id FROM report_runs WHERE id = $1', [runId]);\n    if (_dr.length === 0) {"
);
rep(
  "    db.prepare('DELETE FROM report_summaries WHERE report_run_id = ?').run(runId);\n    db.prepare('DELETE FROM processed_rows WHERE report_run_id = ?').run(runId);\n    db.prepare('DELETE FROM raw_rows WHERE report_run_id = ?').run(runId);\n    db.prepare('DELETE FROM report_runs WHERE id = ?').run(runId);",
  "    await pool.query('DELETE FROM report_summaries WHERE report_run_id = $1', [runId]);\n    await pool.query('DELETE FROM processed_rows WHERE report_run_id = $1', [runId]);\n    await pool.query('DELETE FROM raw_rows WHERE report_run_id = $1', [runId]);\n    await pool.query('DELETE FROM report_runs WHERE id = $1', [runId]);"
);

// ===========================================================================
// handleResetHistory
// ===========================================================================
rep(
  "    pool.exec(`\n      DELETE FROM report_summaries;\n      DELETE FROM processed_rows;\n      DELETE FROM raw_rows;\n      DELETE FROM report_runs;\n    `);",
  "    await pool.query('DELETE FROM report_summaries');\n    await pool.query('DELETE FROM processed_rows');\n    await pool.query('DELETE FROM raw_rows');\n    await pool.query('DELETE FROM report_runs');"
);

// ===========================================================================
// handleVerifyColumnL - COUNT
// ===========================================================================
rep(
  "    const total = (db.prepare(\n      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = ?'\n    ).get(runId) as { cnt: number }).cnt;",
  "    const { rows: _cnt1 } = await pool.query('SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = $1', [runId]);\n    const total = parseInt(_cnt1[0].cnt, 10);"
);
// run meta
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;\n    const reportDate = runMeta?.report_date ?? '';",
  "    const { rows: _rm1 } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rm1[0] as { report_date: string } | undefined;\n    const reportDate = runMeta?.report_date ?? '';"
);
// raw rows page
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = ?\n      ORDER BY row_number\n      LIMIT ? OFFSET ?\n    `).all(runId, ps, offset) as Array<{\n      id: number; row_number: number; ac_code: string | null;\n      ac_name: string | null; ref_no: string | null;\n      counterparty_no: string | null; base_ccy_amt: number | null;\n      maturity_date: string | null;\n    }>;",
  "    const { rows: _rdr } = await pool.query(`\n      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = $1\n      ORDER BY row_number\n      LIMIT $2 OFFSET $3\n    `, [runId, ps, offset]);\n    const rawDbRows = _rdr as Array<{\n      id: number; row_number: number; ac_code: string | null;\n      ac_name: string | null; ref_no: string | null;\n      counterparty_no: string | null; base_ccy_amt: number | null;\n      maturity_date: string | null;\n    }>;"
);
// customer types
rep(
  "    const ctRows = db.prepare(\n      'SELECT counterparty_no, customer_type FROM customer_types'\n    ).all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    const { rows: ctRows } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');"
);
// assumption rules
rep(
  "    const arRows = db.prepare(\n      'SELECT p_key, assumption_rate FROM assumption_rules'\n    ).all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');"
);
// maturity overrides
rep(
  "    const moRows = db.prepare(\n      'SELECT ac_code, formula_type, formula_params FROM maturity_overrides'\n    ).all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');"
);
// allRows stats
rep(
  "    const allRows = db.prepare(\n      'SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = ?'\n    ).all(runId) as Array<{ ac_code: string | null; ref_no: string | null; counterparty_no: string | null }>;",
  "    const { rows: allRows } = await pool.query('SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = $1', [runId]);"
);

// ===========================================================================
// handleVerify7DayForecast
// ===========================================================================
// run meta
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;",
  "    const { rows: _rm2 } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rm2[0] as { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;"
);
// amRows
rep(
  "    const amRows = db.prepare('SELECT ac_code, asset_liability_type FROM account_mappings')\n      .all() as Array<{ ac_code: string; asset_liability_type: string }>;",
  "    const { rows: amRows } = await pool.query('SELECT ac_code, asset_liability_type FROM account_mappings');"
);
// moRows (handleVerify7DayForecast)
rep(
  "    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');"
);
// rawRows (handleVerify7DayForecast)
rep(
  "    const rawRows = db.prepare(\n      'SELECT ac_code, base_ccy_amt, maturity_date FROM raw_rows WHERE report_run_id = ?'\n    ).all(runId) as Array<{\n      ac_code: string | null; base_ccy_amt: number | null; maturity_date: string | null;\n    }>;",
  "    const { rows: rawRows } = await pool.query('SELECT ac_code, base_ccy_amt, maturity_date FROM raw_rows WHERE report_run_id = $1', [runId]);"
);

// ===========================================================================
// handleVerifyLmgSummary
// ===========================================================================
// run meta (3rd occurrence - there are 3 similar patterns with different variable names in different handlers)
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n\n    // Fetch ALL raw rows for this run",
  "    const { rows: _rm3 } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rm3[0] as { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n\n    // Fetch ALL raw rows for this run"
);
// rawDbRows (handleVerifyLmgSummary)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = ?\n    `).all(runId) as Array<{",
  "    const { rows: _rdblmg } = await pool.query(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = $1\n    `, [runId]);\n    const rawDbRows = _rdblmg as Array<{"
);
// ctRows2 (handleVerifyLmgSummary)
rep(
  "    const ctRows2 = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    const { rows: ctRows2 } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');"
);
// moRows2 (handleVerifyLmgSummary)
rep(
  "    const moRows2 = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows2 } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');"
);
// arRows3 (first occurrence - inline IIFE for lcrPercent response)
rep(
  "        const arRows3 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n          .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "        const { rows: arRows3 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');"
);
// arRows3 (second occurrence - lcrPercentForDb IIFE)
rep(
  "      const arRows3 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n        .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "      const { rows: arRows3 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');"
);
// The persist block: existing check
rep(
  "      const { v4: uuidv4 } = require('uuid') as { v4: () => string };\n      const existing = db.prepare('SELECT id FROM report_summaries WHERE report_run_id = ?').get(runId) as { id: string } | undefined;\n      if (existing) {\n        db.prepare('UPDATE report_summaries SET lcr_ratio = ?, ratio_7d = ?, ratio_1m = ?, ratio_3m = ?, ratio_3m_lr = ? WHERE report_run_id = ?')\n          .run(lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, runId);\n      } else {\n        db.prepare(`INSERT INTO report_summaries (id, report_run_id, report_date, eligible_hqla, gross_outflows, gross_inflows, capped_inflows, net_cash_outflows, lcr_ratio, ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, datetime('now'))`)\n          .run(uuidv4(), runId, reportDate, lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR);\n      }",
  "      const { rows: _ex } = await pool.query(\n        'SELECT id FROM report_summaries WHERE report_run_id = $1', [runId]\n      );\n      if (_ex.length > 0) {\n        await pool.query(\n          'UPDATE report_summaries SET lcr_ratio = $1, ratio_7d = $2, ratio_1m = $3, ratio_3m = $4, ratio_3m_lr = $5 WHERE report_run_id = $6',\n          [lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, runId]\n        );\n      } else {\n        const _createdAt = new Date().toISOString();\n        await pool.query(\n          `INSERT INTO report_summaries (id, report_run_id, report_date, eligible_hqla, gross_outflows, gross_inflows, capped_inflows, net_cash_outflows, lcr_ratio, ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at) VALUES ($1, $2, $3, 0, 0, 0, 0, 0, $4, $5, $6, $7, $8, $9)`,\n          [uuidv4(), runId, reportDate, lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, _createdAt]\n        );\n      }"
);

// ===========================================================================
// handleDebugBsRe33
// ===========================================================================
// run meta
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n    const p  = parseInt(page",
  "    const { rows: _rm4 } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rm4[0] as { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n    const p  = parseInt(page"
);
// count
rep(
  "    const total = (db.prepare(\n      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = ?'\n    ).get(runId) as { cnt: number }).cnt;\n    const offset = (p - 1) * ps;\n\n    const rawDbRows = db.prepare(`\n      SELECT row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = ?\n      ORDER BY row_number\n      LIMIT ? OFFSET ?\n    `).all(runId, ps, offset) as Array<{",
  "    const { rows: _cnt2 } = await pool.query('SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = $1', [runId]);\n    const total = parseInt(_cnt2[0].cnt, 10);\n    const offset = (p - 1) * ps;\n\n    const { rows: _rdbsre } = await pool.query(`\n      SELECT row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = $1\n      ORDER BY row_number\n      LIMIT $2 OFFSET $3\n    `, [runId, ps, offset]);\n    const rawDbRows = _rdbsre as Array<{"
);
// ctRows2 (handleDebugBsRe33)
rep(
  "    const ctRows2 = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    const { rows: ctRows2 } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');"
);
// arRows2 (handleDebugBsRe33)
rep(
  "    const arRows2 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n      .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows2 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');"
);
// moRows2 (handleDebugBsRe33)
rep(
  "    const moRows2 = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows2 } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');"
);

// ===========================================================================
// handleVerifyCfTable
// ===========================================================================
// run meta
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n\n    // 30-day window end date",
  "    const { rows: _rm5 } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rm5[0] as { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n\n    // 30-day window end date"
);
// ctRows (handleVerifyCfTable)
rep(
  "    const ctRows = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    const { rows: ctRows } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');"
);
// arRows (handleVerifyCfTable)
rep(
  "    const arRows = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n      .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');"
);
// moRows (handleVerifyCfTable)
rep(
  "    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');"
);
// rawDbRows (handleVerifyCfTable)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = ?\n    `).all(runId) as Array<{",
  "    const { rows: _rdcft } = await pool.query(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = $1\n    `, [runId]);\n    const rawDbRows = _rdcft as Array<{"
);

// ===========================================================================
// handleGetAccountMappings
// ===========================================================================
rep(
  "    const total = (db.prepare(\n      `SELECT COUNT(*) AS cnt FROM account_mappings ${whereClause}`\n    ).get(...whereParams) as { cnt: number }).cnt;",
  "    const { rows: _cnt3 } = await pool.query(\n      `SELECT COUNT(*) AS cnt FROM account_mappings ${whereClause}`, whereParams\n    );\n    const total = parseInt(_cnt3[0].cnt, 10);"
);
rep(
  "    const rows = db.prepare(`\n      SELECT id, ac_code, ac_name, category, middle_category,\n             hqla_or_cashflow_type, asset_liability_type\n      FROM account_mappings\n      ${whereClause}\n      ORDER BY ac_code\n      LIMIT ? OFFSET ?\n    `).all(...whereParams, ps, offset) as Array<{",
  "    const { rows } = await pool.query(`\n      SELECT id, ac_code, ac_name, category, middle_category,\n             hqla_or_cashflow_type, asset_liability_type\n      FROM account_mappings\n      ${whereClause}\n      ORDER BY ac_code\n      LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}\n    `, [...whereParams, ps, offset]);\n    const _amrows = rows as Array<{"
);
// Fix variable reference
rep(
  "    rows: rows.map((r) => ({",
  "    rows: _amrows.map((r) => ({"
);

// ===========================================================================
// handleGetAccountMappingDistinct
// ===========================================================================
rep(
  "    const queryDistinct = (col: string): string[] =>\n      (db.prepare(`SELECT DISTINCT ${col} AS v FROM account_mappings WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`).all() as Array<{ v: string }>).map((r) => r.v);",
  "    const queryDistinct = async (col: string): Promise<string[]> => {\n      const { rows: _drows } = await pool.query(`SELECT DISTINCT ${col} AS v FROM account_mappings WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`);\n      return (_drows as Array<{ v: string }>).map((r) => r.v);\n    };"
);
rep(
  "      category:           queryDistinct('category'),\n      middleCategory:     queryDistinct('middle_category'),\n      hqlaOrCashflowType: queryDistinct('hqla_or_cashflow_type'),\n      assetLiabilityType: queryDistinct('asset_liability_type'),",
  "      category:           await queryDistinct('category'),\n      middleCategory:     await queryDistinct('middle_category'),\n      hqlaOrCashflowType: await queryDistinct('hqla_or_cashflow_type'),\n      assetLiabilityType: await queryDistinct('asset_liability_type'),"
);

// ===========================================================================
// handleCreateAccountMapping
// ===========================================================================
rep(
  "    const result = db.prepare(`\n      INSERT INTO account_mappings (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type, asset_liability_type)\n      VALUES (?, ?, ?, ?, ?, ?)\n    `).run(\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n    );\n\n    res.json({\n      success: true,\n      id: result.lastInsertRowid,\n    });",
  "    const _ins = await pool.query(`\n      INSERT INTO account_mappings (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type, asset_liability_type)\n      VALUES ($1, $2, $3, $4, $5, $6)\n      RETURNING id\n    `, [\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n    ]);\n\n    res.json({\n      success: true,\n      id: _ins.rows[0].id,\n    });"
);

// ===========================================================================
// handleUpdateAccountMapping
// ===========================================================================
rep(
  "    const result = db.prepare(`\n\n      UPDATE account_mappings\n      SET ac_code = ?, ac_name = ?, category = ?, middle_category = ?,\n          hqla_or_cashflow_type = ?, asset_liability_type = ?\n      WHERE id = ?\n    `).run(\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n      id,\n    );\n\n    if (result.changes === 0) {",
  "    const _upd = await pool.query(`\n      UPDATE account_mappings\n      SET ac_code = $1, ac_name = $2, category = $3, middle_category = $4,\n          hqla_or_cashflow_type = $5, asset_liability_type = $6\n      WHERE id = $7\n    `, [\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n      id,\n    ]);\n\n    if (_upd.rowCount === 0) {"
);

// ===========================================================================
// handleDeleteAccountMapping
// ===========================================================================
rep(
  "    const result = db.prepare('DELETE FROM account_mappings WHERE id = ?').run(id);\n\n    if (result.changes === 0) {",
  "    const _del = await pool.query('DELETE FROM account_mappings WHERE id = $1', [id]);\n\n    if (_del.rowCount === 0) {"
);

// ===========================================================================
// handleLcrForecast
// ===========================================================================
// run meta
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n\n    // Reference data (same as CF Table)",
  "    const { rows: _rm6 } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rm6[0] as { report_date: string } | undefined;\n    if (!runMeta) {\n      res.status(404).json({ success: false, error: 'Run not found' });\n      return;\n    }\n    const reportDate = runMeta.report_date;\n\n    // Reference data (same as CF Table)"
);
// ctRows (handleLcrForecast)
rep(
  "    const ctRows = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;\n    const ctMap = new Map(ctRows.map((r) => [r.counterparty_no.trim(), r.customer_type]));\n\n    const arRows = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n      .all() as Array<{ p_key: string; assumption_rate: number }>;\n    const arMap = new Map(arRows.map((r) => [r.p_key.trim(), r.assumption_rate]));\n\n    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: ctRows } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');\n    const ctMap = new Map((ctRows as Array<{ counterparty_no: string; customer_type: string }>).map((r) => [r.counterparty_no.trim(), r.customer_type]));\n\n    const { rows: arRows } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');\n    const arMap = new Map((arRows as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));\n\n    const { rows: moRows } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');"
);
// rawDbRows (handleLcrForecast)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = ?\n    `).all(runId) as Array<{",
  "    const { rows: _rdlcr } = await pool.query(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = $1\n    `, [runId]);\n    const rawDbRows = _rdlcr as Array<{"
);

// ===========================================================================
// handleIrrbb
// ===========================================================================
rep(
  "    const row = db.prepare('SELECT irrbb_data FROM report_runs WHERE id = ?').get(runId) as\n      { irrbb_data: string | null } | undefined;",
  "    const { rows: _irrbb } = await pool.query('SELECT irrbb_data FROM report_runs WHERE id = $1', [runId]);\n    const row = _irrbb[0] as { irrbb_data: string | null } | undefined;"
);

// ===========================================================================
// Fix remaining .all() type cast endings after rawDbRows conversions
// The pattern: }).all(runId) as Array<{ or }).all() as Array<{
// These should already be fixed above but verify
// ===========================================================================

// Fix the moMap variable references (they use .trim() on ac_code which may be null)
// This was already fixed in reportController's original code with (r.ac_code ?? '').trim()
// No change needed here

console.log(`Applied ${count} replacements`);

// Check remaining db.prepare calls
const remaining = (c.match(/db\.prepare\(/g) || []).length;
console.log(`Remaining db.prepare calls: ${remaining}`);

fs.writeFileSync(filePath, c);
