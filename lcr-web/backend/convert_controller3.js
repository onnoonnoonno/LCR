/**
 * Convert remaining db.prepare() calls in reportController.ts to pg.
 * All patterns verified by reading the actual file content.
 */
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'src', 'controllers', 'reportController.ts');
let c = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');

let applied = 0;

function rep(old, neu, label) {
  if (!c.includes(old)) {
    console.log('NOT FOUND:', label || old.substring(0, 80));
    return;
  }
  c = c.split(old).join(neu);
  applied++;
  console.log('OK:', label);
}

// 1. canAccessRun body
rep(
  "  const run = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);\n  return run != null; // run exists \u2192 any authenticated user may read it",
  "  const { rows: _carRows } = await pool.query('SELECT id FROM report_runs WHERE id = $1', [runId]);\n  return _carRows.length > 0;",
  'canAccessRun body'
);

// 2. handleListHistory dedup query (also fix _listRows.map -> rows.map)
rep(
  "    const rows = db.prepare(`\n      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at, rr.status,\n             rs.eligible_hqla, rs.gross_outflows, rs.net_cash_outflows, rs.lcr_ratio, rs.ratio_3m_lr\n      FROM report_runs rr\n      LEFT JOIN report_summaries rs ON rs.report_run_id = rr.id\n      WHERE rr.id = (\n        SELECT id FROM report_runs\n        WHERE report_date = rr.report_date\n        ORDER BY uploaded_at DESC LIMIT 1\n      )\n      ORDER BY rr.report_date DESC\n    `).all() as Array<{\n      run_id: string; report_date: string; source_filename: string; uploaded_at: string; status: string;\n      eligible_hqla: number | null; gross_outflows: number | null;\n      net_cash_outflows: number | null; lcr_ratio: number | null; ratio_3m_lr: number | null;\n    }>;\n\n    const items = _listRows.map((r: any) => ({",
  "    const { rows } = await pool.query(`\n      SELECT rr.id AS run_id, rr.report_date, rr.source_filename, rr.uploaded_at, rr.status,\n             rs.eligible_hqla, rs.gross_outflows, rs.net_cash_outflows, rs.lcr_ratio, rs.ratio_3m_lr\n      FROM report_runs rr\n      LEFT JOIN report_summaries rs ON rs.report_run_id = rr.id\n      WHERE rr.id = (\n        SELECT id FROM report_runs\n        WHERE report_date = rr.report_date\n        ORDER BY uploaded_at DESC LIMIT 1\n      )\n      ORDER BY rr.report_date DESC\n    `);\n\n    const items = rows.map((r: any) => ({",
  'handleListHistory dedup query'
);

// 3. handleDeleteRun exists check
rep(
  "    const exists = db.prepare('SELECT id FROM report_runs WHERE id = ?').get(runId);\n    if (!exists) {",
  "    const { rows: _existRows } = await pool.query('SELECT id FROM report_runs WHERE id = $1', [runId]);\n    if (_existRows.length === 0) {",
  'handleDeleteRun exists check'
);

// 4. handleDeleteRun four deletes
rep(
  "    db.prepare('DELETE FROM report_summaries WHERE report_run_id = ?').run(runId);\n    db.prepare('DELETE FROM processed_rows WHERE report_run_id = ?').run(runId);\n    db.prepare('DELETE FROM raw_rows WHERE report_run_id = ?').run(runId);\n    db.prepare('DELETE FROM report_runs WHERE id = ?').run(runId);",
  "    await pool.query('DELETE FROM report_summaries WHERE report_run_id = $1', [runId]);\n    await pool.query('DELETE FROM processed_rows WHERE report_run_id = $1', [runId]);\n    await pool.query('DELETE FROM raw_rows WHERE report_run_id = $1', [runId]);\n    await pool.query('DELETE FROM report_runs WHERE id = $1', [runId]);",
  'handleDeleteRun four deletes'
);

// 5. handleResetHistory db.exec
rep(
  "    db.exec(`\n      DELETE FROM report_summaries;\n      DELETE FROM processed_rows;\n      DELETE FROM raw_rows;\n      DELETE FROM report_runs;\n    `);",
  "    await pool.query('DELETE FROM report_summaries');\n    await pool.query('DELETE FROM processed_rows');\n    await pool.query('DELETE FROM raw_rows');\n    await pool.query('DELETE FROM report_runs');",
  'handleResetHistory db.exec'
);

// 6. runMeta queries (5 occurrences, replace_all)
rep(
  "    const runMeta = db.prepare('SELECT report_date FROM report_runs WHERE id = ?').get(runId) as\n      { report_date: string } | undefined;",
  "    const { rows: _rmRows } = await pool.query('SELECT report_date FROM report_runs WHERE id = $1', [runId]);\n    const runMeta = _rmRows[0] as { report_date: string } | undefined;",
  'runMeta x5'
);

// 7. COUNT queries (2 occurrences, replace_all)
rep(
  "    const total = (db.prepare(\n      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = ?'\n    ).get(runId) as { cnt: number }).cnt;",
  "    const { rows: _cntRows } = await pool.query(\n      'SELECT COUNT(*) AS cnt FROM raw_rows WHERE report_run_id = $1', [runId]\n    );\n    const total = parseInt(_cntRows[0].cnt, 10);",
  'COUNT x2'
);

// 8. handleVerifyColumnL rawDbRows (SELECT id, row_number + LIMIT/OFFSET)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = ?\n      ORDER BY row_number\n      LIMIT ? OFFSET ?\n    `).all(runId, ps, offset) as Array<{\n      id: number; row_number: number; ac_code: string | null;\n      ac_name: string | null; ref_no: string | null;\n      counterparty_no: string | null; base_ccy_amt: number | null;\n      maturity_date: string | null;\n    }>;",
  "    const { rows: rawDbRows } = await pool.query(`\n      SELECT id, row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = $1\n      ORDER BY row_number\n      LIMIT $2 OFFSET $3\n    `, [runId, ps, offset]);",
  'handleVerifyColumnL rawDbRows'
);

// 9. handleVerifyColumnL ctRows (multi-line format, unique)
rep(
  "    const ctRows = db.prepare(\n      'SELECT counterparty_no, customer_type FROM customer_types'\n    ).all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    const { rows: ctRows } = await pool.query(\n      'SELECT counterparty_no, customer_type FROM customer_types'\n    );",
  'handleVerifyColumnL ctRows multi-line'
);

// 10. handleVerifyColumnL ctMap cast (unique context: R-column comment)
rep(
  "    const ctMap = new Map(ctRows.map((r) => [r.counterparty_no.trim(), r.customer_type]));\n\n    // ---------------------------------------------------------------\n    // R-column",
  "    const ctMap = new Map((ctRows as Array<{ counterparty_no: string; customer_type: string }>).map((r) => [r.counterparty_no.trim(), r.customer_type]));\n\n    // ---------------------------------------------------------------\n    // R-column",
  'handleVerifyColumnL ctMap cast'
);

// 11. handleVerifyColumnL arRows (multi-line format, unique)
rep(
  "    const arRows = db.prepare(\n      'SELECT p_key, assumption_rate FROM assumption_rules'\n    ).all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows } = await pool.query(\n      'SELECT p_key, assumption_rate FROM assumption_rules'\n    );",
  'handleVerifyColumnL arRows multi-line'
);

// 12. handleVerifyColumnL arMap cast (unique context: S-column comment)
rep(
  "    const arMap = new Map(arRows.map((r) => [r.p_key.trim(), r.assumption_rate]));\n\n    // ---------------------------------------------------------------\n    // S-column",
  "    const arMap = new Map((arRows as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));\n\n    // ---------------------------------------------------------------\n    // S-column",
  'handleVerifyColumnL arMap cast'
);

// 13. handleVerifyColumnL moRows (multi-line format, unique)
rep(
  "    const moRows = db.prepare(\n      'SELECT ac_code, formula_type, formula_params FROM maturity_overrides'\n    ).all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows } = await pool.query(\n      'SELECT ac_code, formula_type, formula_params FROM maturity_overrides'\n    );",
  'handleVerifyColumnL moRows multi-line'
);

// 14. handleVerifyColumnL moMap cast (unique context: Resolve a maturity override formula)
rep(
  "    const moMap = new Map(moRows.map((r) => [(r.ac_code ?? '').trim(), r]));\n\n    /** Resolve a maturity override formula",
  "    const moMap = new Map((moRows as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>).map((r) => [(r.ac_code ?? '').trim(), r]));\n\n    /** Resolve a maturity override formula",
  'handleVerifyColumnL moMap cast'
);

// 15. handleVerifyColumnL allRows
rep(
  "    const allRows = db.prepare(\n      'SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = ?'\n    ).all(runId) as Array<{ ac_code: string | null; ref_no: string | null; counterparty_no: string | null }>;",
  "    const { rows: allRows } = await pool.query(\n      'SELECT ac_code, ref_no, counterparty_no FROM raw_rows WHERE report_run_id = $1', [runId]\n    );",
  'handleVerifyColumnL allRows'
);

// 16. handleVerify7DayForecast amRows (unique SQL)
rep(
  "    const amRows = db.prepare('SELECT ac_code, asset_liability_type FROM account_mappings')\n      .all() as Array<{ ac_code: string; asset_liability_type: string }>;",
  "    const { rows: amRows } = await pool.query('SELECT ac_code, asset_liability_type FROM account_mappings');",
  'handleVerify7DayForecast amRows'
);

// 17. handleVerify7DayForecast amMap cast
rep(
  "    const amMap = new Map(amRows.map((r) => [r.ac_code, r.asset_liability_type]));",
  "    const amMap = new Map((amRows as Array<{ ac_code: string; asset_liability_type: string }>).map((r) => [r.ac_code, r.asset_liability_type]));",
  'handleVerify7DayForecast amMap cast'
);

// 18. handleVerify7DayForecast rawRows (unique SQL: ac_code, base_ccy_amt, maturity_date)
rep(
  "    const rawRows = db.prepare(\n      'SELECT ac_code, base_ccy_amt, maturity_date FROM raw_rows WHERE report_run_id = ?'\n    ).all(runId) as Array<{\n      ac_code: string | null; base_ccy_amt: number | null; maturity_date: string | null;\n    }>;",
  "    const { rows: rawRows } = await pool.query(\n      'SELECT ac_code, base_ccy_amt, maturity_date FROM raw_rows WHERE report_run_id = $1', [runId]\n    );",
  'handleVerify7DayForecast rawRows'
);

// 19. handleVerifyLmgSummary rawDbRows (unique context: --- Reuse the same reference data)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = ?\n    `).all(runId) as Array<{\n      ac_code: string | null; ref_no: string | null;\n      counterparty_no: string | null; base_ccy_amt: number | null;\n      maturity_date: string | null;\n    }>;\n\n    // --- Reuse the same reference data as column-l endpoint ---",
  "    const { rows: rawDbRows } = await pool.query(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = $1\n    `, [runId]);\n\n    // --- Reuse the same reference data as column-l endpoint ---",
  'handleVerifyLmgSummary rawDbRows'
);

// 20. handleVerifyLmgSummary ctRows2 (unique context: ctMap2)
rep(
  "    const ctRows2 = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;\n    const ctMap2 = new Map(ctRows2.map",
  "    const { rows: ctRows2 } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');\n    const ctMap2 = new Map((ctRows2 as Array<{ counterparty_no: string; customer_type: string }>).map",
  'handleVerifyLmgSummary ctRows2'
);

// 21. handleVerifyLmgSummary moRows2 (unique context: Bucket boundaries)
rep(
  "    const moRows2 = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;\n    const moMap2 = new Map(moRows2.map((r) => [(r.ac_code ?? '').trim(), r]));\n\n    // Bucket boundaries (same as column-l endpoint)",
  "    const { rows: moRows2 } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');\n    const moMap2 = new Map((moRows2 as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>).map((r) => [(r.ac_code ?? '').trim(), r]));\n\n    // Bucket boundaries (same as column-l endpoint)",
  'handleVerifyLmgSummary moRows2'
);

// 22. arRows3 (2 occurrences, same replacement, replace_all)
rep(
  "        const arRows3 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n          .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "        const { rows: arRows3 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');",
  'arRows3 x2'
);

// 23. arRows3 map cast (2 occurrences)
rep(
  "        const arMap3 = new Map(arRows3.map((r) => [r.p_key.trim(), r.assumption_rate]));",
  "        const arMap3 = new Map((arRows3 as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));",
  'arRows3 map cast x2'
);

// 24. handleVerifyLmgSummary: inline require + existing/update/insert
rep(
  "      const { v4: uuidv4 } = require('uuid') as { v4: () => string };\n      const existing = db.prepare('SELECT id FROM report_summaries WHERE report_run_id = ?').get(runId) as { id: string } | undefined;\n      if (existing) {\n        db.prepare('UPDATE report_summaries SET lcr_ratio = ?, ratio_7d = ?, ratio_1m = ?, ratio_3m = ?, ratio_3m_lr = ? WHERE report_run_id = ?')\n          .run(lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, runId);\n      } else {\n        db.prepare(`INSERT INTO report_summaries (id, report_run_id, report_date, eligible_hqla, gross_outflows, gross_inflows, capped_inflows, net_cash_outflows, lcr_ratio, ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, datetime('now'))`)\n          .run(uuidv4(), runId, reportDate, lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR);\n      }",
  "      const { rows: _lmgExist } = await pool.query('SELECT id FROM report_summaries WHERE report_run_id = $1', [runId]);\n      if (_lmgExist.length > 0) {\n        await pool.query('UPDATE report_summaries SET lcr_ratio = $1, ratio_7d = $2, ratio_1m = $3, ratio_3m = $4, ratio_3m_lr = $5 WHERE report_run_id = $6',\n          [lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, runId]);\n      } else {\n        await pool.query(`INSERT INTO report_summaries (id, report_run_id, report_date, eligible_hqla, gross_outflows, gross_inflows, capped_inflows, net_cash_outflows, lcr_ratio, ratio_7d, ratio_1m, ratio_3m, ratio_3m_lr, created_at) VALUES ($1, $2, $3, 0, 0, 0, 0, 0, $4, $5, $6, $7, $8, $9)`,\n          [uuidv4(), runId, reportDate, lcrPercentForDb, ratio7D, ratio1M, ratio3M, ratio3MLR, new Date().toISOString()]);\n      }",
  'handleVerifyLmgSummary upsert'
);

// 25. handleDebugBsRe33 rawDbRows (unique: row_number + ac_name + LIMIT/OFFSET)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = ?\n      ORDER BY row_number\n      LIMIT ? OFFSET ?\n    `).all(runId, ps, offset) as Array<{\n      row_number: number; ac_code: string | null; ac_name: string | null;\n      ref_no: string | null; counterparty_no: string | null;\n      base_ccy_amt: number | null; maturity_date: string | null;\n    }>;",
  "    const { rows: rawDbRows } = await pool.query(`\n      SELECT row_number, ac_code, ac_name, ref_no, counterparty_no,\n             base_ccy_amt, maturity_date\n      FROM raw_rows\n      WHERE report_run_id = $1\n      ORDER BY row_number\n      LIMIT $2 OFFSET $3\n    `, [runId, ps, offset]);",
  'handleDebugBsRe33 rawDbRows'
);

// 26. handleDebugBsRe33 ctRows2 (unique context: ctMap without 2)
rep(
  "    const ctRows2 = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;\n    const ctMap = new Map(ctRows2.map",
  "    const { rows: ctRows2 } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');\n    const ctMap = new Map((ctRows2 as Array<{ counterparty_no: string; customer_type: string }>).map",
  'handleDebugBsRe33 ctRows2'
);

// 27. handleDebugBsRe33 arRows2 (unique variable name)
rep(
  "    const arRows2 = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n      .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows2 } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');",
  'handleDebugBsRe33 arRows2'
);

// 28. handleDebugBsRe33 arMap cast
rep(
  "    const arMap = new Map(arRows2.map((r) => [r.p_key.trim(), r.assumption_rate]));",
  "    const arMap = new Map((arRows2 as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));",
  'handleDebugBsRe33 arMap cast'
);

// 29. handleDebugBsRe33 moRows2 (unique context: moMap without 2)
rep(
  "    const moRows2 = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;\n    const moMap = new Map(moRows2.map((r) => [(r.ac_code ?? '').trim(), r]));",
  "    const { rows: moRows2 } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');\n    const moMap = new Map((moRows2 as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>).map((r) => [(r.ac_code ?? '').trim(), r]));",
  'handleDebugBsRe33 moRows2'
);

// 30. ctRows single-line (handleVerifyCfTable + handleLcrForecast, replace_all = 2 occurrences)
// Also covers handleVerify7DayForecast if that had ctRows (it doesn't, so only 2)
rep(
  "    const ctRows = db.prepare('SELECT counterparty_no, customer_type FROM customer_types')\n      .all() as Array<{ counterparty_no: string; customer_type: string }>;",
  "    const { rows: ctRows } = await pool.query('SELECT counterparty_no, customer_type FROM customer_types');",
  'ctRows single-line x2'
);

// 31. ctMap cast for single-line ctRows (2 occurrences)
rep(
  "    const ctMap = new Map(ctRows.map((r) => [r.counterparty_no.trim(), r.customer_type]));",
  "    const ctMap = new Map((ctRows as Array<{ counterparty_no: string; customer_type: string }>).map((r) => [r.counterparty_no.trim(), r.customer_type]));",
  'ctMap cast x2'
);

// 32. arRows single-line (handleVerifyCfTable + handleLcrForecast, replace_all = 2)
rep(
  "    const arRows = db.prepare('SELECT p_key, assumption_rate FROM assumption_rules')\n      .all() as Array<{ p_key: string; assumption_rate: number }>;",
  "    const { rows: arRows } = await pool.query('SELECT p_key, assumption_rate FROM assumption_rules');",
  'arRows single-line x2'
);

// 33. arMap cast for single-line arRows (2 occurrences)
rep(
  "    const arMap = new Map(arRows.map((r) => [r.p_key.trim(), r.assumption_rate]));",
  "    const arMap = new Map((arRows as Array<{ p_key: string; assumption_rate: number }>).map((r) => [r.p_key.trim(), r.assumption_rate]));",
  'arMap cast x2'
);

// 34. moRows single-line (handleVerify7DayForecast + handleVerifyCfTable + handleLcrForecast = 3)
rep(
  "    const moRows = db.prepare('SELECT ac_code, formula_type, formula_params FROM maturity_overrides')\n      .all() as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>;",
  "    const { rows: moRows } = await pool.query('SELECT ac_code, formula_type, formula_params FROM maturity_overrides');",
  'moRows single-line x3'
);

// 35. moMap cast for single-line moRows (3 occurrences)
rep(
  "    const moMap = new Map(moRows.map((r) => [(r.ac_code ?? '').trim(), r]));",
  "    const moMap = new Map((moRows as Array<{ ac_code: string; formula_type: string; formula_params: string | null }>).map((r) => [(r.ac_code ?? '').trim(), r]));",
  'moMap cast x3'
);

// 36. handleVerifyCfTable rawDbRows (context: Per-pKey accumulation)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = ?\n    `).all(runId) as Array<{\n      ac_code: string | null; ref_no: string | null;\n      counterparty_no: string | null; base_ccy_amt: number | null;\n      maturity_date: string | null;\n    }>;\n\n    // Per-pKey accumulation",
  "    const { rows: rawDbRows } = await pool.query(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = $1\n    `, [runId]);\n\n    // Per-pKey accumulation",
  'handleVerifyCfTable rawDbRows'
);

// 37. handleLcrForecast rawDbRows (context: const enriched = rawDbRows.map)
rep(
  "    const rawDbRows = db.prepare(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = ?\n    `).all(runId) as Array<{\n      ac_code: string | null; ref_no: string | null;\n      counterparty_no: string | null; base_ccy_amt: number | null;\n      maturity_date: string | null;\n    }>;\n\n    const enriched = rawDbRows.map",
  "    const { rows: rawDbRows } = await pool.query(`\n      SELECT ac_code, ref_no, counterparty_no, base_ccy_amt, maturity_date\n      FROM raw_rows WHERE report_run_id = $1\n    `, [runId]);\n\n    const enriched = rawDbRows.map",
  'handleLcrForecast rawDbRows'
);

// 38. handleGetAccountMappings: fix whereClause to use $N params
rep(
  "    const whereClause = hasSearch\n      ? 'WHERE ac_code LIKE ? OR ac_name LIKE ?'\n      : '';\n    const whereParams = hasSearch ? [searchPattern, searchPattern] : [];",
  "    const whereParams = hasSearch ? [searchPattern, searchPattern] : [];\n    const whereClause = hasSearch ? 'WHERE ac_code LIKE $1 OR ac_name LIKE $2' : '';",
  'handleGetAccountMappings whereClause fix'
);

// 39. handleGetAccountMappings total
rep(
  "    const total = (db.prepare(\n      `SELECT COUNT(*) AS cnt FROM account_mappings ${whereClause}`\n    ).get(...whereParams) as { cnt: number }).cnt;",
  "    const { rows: _amcntRows } = await pool.query(\n      `SELECT COUNT(*) AS cnt FROM account_mappings ${whereClause}`,\n      whereParams\n    );\n    const total = parseInt(_amcntRows[0].cnt, 10);",
  'handleGetAccountMappings total'
);

// 40. handleGetAccountMappings rows (with dynamic WHERE + LIMIT/OFFSET)
rep(
  "    const rows = db.prepare(`\n      SELECT id, ac_code, ac_name, category, middle_category,\n             hqla_or_cashflow_type, asset_liability_type\n      FROM account_mappings\n      ${whereClause}\n      ORDER BY ac_code\n      LIMIT ? OFFSET ?\n    `).all(...whereParams, ps, offset) as Array<{\n      id: number; ac_code: string; ac_name: string | null; category: string | null;\n      middle_category: string | null; hqla_or_cashflow_type: string | null;\n      asset_liability_type: string | null;\n    }>;\n\n    res.json({\n      success:    true,\n      page:       p,\n      pageSize:   ps,\n      total,\n      totalPages: Math.ceil(total / ps),\n      rows: _amrows.map",
  "    const { rows: _amRows } = await pool.query(`\n      SELECT id, ac_code, ac_name, category, middle_category,\n             hqla_or_cashflow_type, asset_liability_type\n      FROM account_mappings\n      ${whereClause}\n      ORDER BY ac_code\n      LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}\n    `, [...whereParams, ps, offset]);\n\n    res.json({\n      success:    true,\n      page:       p,\n      pageSize:   ps,\n      total,\n      totalPages: Math.ceil(total / ps),\n      rows: _amRows.map",
  'handleGetAccountMappings rows'
);

// 41. handleGetAccountMappingDistinct queryDistinct (async)
rep(
  "    const queryDistinct = (col: string): string[] =>\n      (db.prepare(`SELECT DISTINCT ${col} AS v FROM account_mappings WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`).all() as Array<{ v: string }>).map((r) => r.v);\n\n    res.json({\n      success: true,\n      category:           queryDistinct('category'),\n      middleCategory:     queryDistinct('middle_category'),\n      hqlaOrCashflowType: queryDistinct('hqla_or_cashflow_type'),\n      assetLiabilityType: queryDistinct('asset_liability_type'),\n    });",
  "    async function queryDistinct(col: string): Promise<string[]> {\n      const { rows } = await pool.query(\n        `SELECT DISTINCT ${col} AS v FROM account_mappings WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`\n      );\n      return (rows as Array<{ v: string }>).map((r) => r.v);\n    }\n\n    res.json({\n      success: true,\n      category:           await queryDistinct('category'),\n      middleCategory:     await queryDistinct('middle_category'),\n      hqlaOrCashflowType: await queryDistinct('hqla_or_cashflow_type'),\n      assetLiabilityType: await queryDistinct('asset_liability_type'),\n    });",
  'handleGetAccountMappingDistinct queryDistinct'
);

// 42. handleCreateAccountMapping result
rep(
  "    const result = db.prepare(`\n      INSERT INTO account_mappings (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type, asset_liability_type)\n      VALUES (?, ?, ?, ?, ?, ?)\n    `).run(\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n    );\n\n    res.json({\n      success: true,\n      id: result.lastInsertRowid,\n    });",
  "    const { rows: _insRows } = await pool.query(`\n      INSERT INTO account_mappings (ac_code, ac_name, category, middle_category, hqla_or_cashflow_type, asset_liability_type)\n      VALUES ($1, $2, $3, $4, $5, $6)\n      RETURNING id\n    `, [\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n    ]);\n\n    res.json({\n      success: true,\n      id: _insRows[0].id,\n    });",
  'handleCreateAccountMapping result'
);

// 43. handleUpdateAccountMapping result
rep(
  "    const result = db.prepare(`\n      UPDATE account_mappings\n      SET ac_code = ?, ac_name = ?, category = ?, middle_category = ?,\n          hqla_or_cashflow_type = ?, asset_liability_type = ?\n      WHERE id = ?\n    `).run(\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n      id,\n    );\n\n    if (result.changes === 0) {",
  "    const { rowCount: _updCount } = await pool.query(`\n      UPDATE account_mappings\n      SET ac_code = $1, ac_name = $2, category = $3, middle_category = $4,\n          hqla_or_cashflow_type = $5, asset_liability_type = $6\n      WHERE id = $7\n    `, [\n      acCode.trim(),\n      acName ?? null,\n      category ?? null,\n      middleCategory ?? null,\n      hqlaOrCashflowType ?? null,\n      assetLiabilityType ?? null,\n      id,\n    ]);\n\n    if (_updCount === 0) {",
  'handleUpdateAccountMapping result'
);

// 44. handleDeleteAccountMapping result
rep(
  "    const result = db.prepare('DELETE FROM account_mappings WHERE id = ?').run(id);\n\n    if (result.changes === 0) {",
  "    const { rowCount: _delCount } = await pool.query('DELETE FROM account_mappings WHERE id = $1', [id]);\n\n    if (_delCount === 0) {",
  'handleDeleteAccountMapping result'
);

// 45. handleIrrbb row
rep(
  "    const row = db.prepare('SELECT irrbb_data FROM report_runs WHERE id = ?').get(runId) as\n      { irrbb_data: string | null } | undefined;",
  "    const { rows: _irrRows } = await pool.query('SELECT irrbb_data FROM report_runs WHERE id = $1', [runId]);\n    const row = _irrRows[0] as { irrbb_data: string | null } | undefined;",
  'handleIrrbb row'
);

// ============================================================
// Report remaining
// ============================================================
const remaining = (c.match(/db\.prepare\(/g) || []).length;
console.log('\nTotal applied:', applied);
console.log('Remaining db.prepare calls:', remaining);

fs.writeFileSync(filePath, c);

if (remaining > 0) {
  console.log('Still remaining:');
  c.split('\n').forEach((line, i) => {
    if (line.includes('db.prepare(')) console.log('  Line ' + (i + 1) + ': ' + line.trim());
  });
}
