# Directorio bloque 0 — rulings tomados durante la ejecución (ledger SDD, 12/10)

Complementa las rulings R1-R16 del plan. Copia literal de las líneas `Ruling`, decisiones del usuario y menores diferidos del ledger.

- Branch: dev (Ruling: work on dev as the project does — cost if wrong: commits to revert)
- User decisions: Cierre go-live = first signed day (min closure_signatures.business_date); ONBOARDING->ACTIVE stays directory.edit; execution subagent-driven.
- ## Pre-flight scan (preflight.md). Rulings:
- Ruling Q1: T1 tests insert the app.closure_periods row before closure_lines (FK) — cost: none.
- Ruling Q2 (user decision 1): go-live filter lives in SQL: `AND (ar.driver_id IS NOT NULL OR dds.business_date >= (SELECT min(business_date) FROM app.closure_signatures))` in _DETAIL_SQL and _REPORT_SQL; T1 test day moved to a future date with its period; extra test: a day before go-live still hides the line. T5 expected value recomputed with the same filter (scan says 2 lines / 1 day today). T13 local walkthrough needs a local signature for the group to show — cost if wrong: one subquery.
- Ruling Q3 (user decision 2): T6 maps operational_status → directory.edit in the field map, and patch_carrier enforces directory.delete unless the transition is ONBOARDING→ACTIVE (after reading current status, before writing); route tests ONBOARDING→ACTIVE 200, ACTIVE→INACTIVE 403, INACTIVE→ACTIVE 403 for an ops supervisor — cost: one condition.
- Ruling Q4: _SQL_ONBOARDING (pre-cierre) returns c.operational_status; T7 shows "Activar empresa" with directory.edit for ONBOARDING rows and directory.delete otherwise; drop the text "La activación de una empresa la hace Certificación" and rewrite that test.
- Ruling Q5: T9 record-page test scopes to the dialog "Detalle de Juan Pérez"; T10 confirm test queries the dialog by name ("Quitar a … del roster de …").
- Ruling Q6: T7 also updates DriverDetailPanel.test.tsx:167,:314 props (canAdmin → canChangeFleetStatus / canDeleteContacts).
- Ruling Q7: T8 makes DirectoryEntity an alias of EntityKind (lib/api/entitySummary.ts:6) — no second definition.
- Ruling Q8 (minors): T11 picker test uses the real fixture (SUGGESTED) and the file's wrapper; ResultadosDelDirectorio reuses ChipDeBaja; lower ratchet caps in the same commit when a raw color is removed; T1 updates test_daily_closures.py:116,123 to check the new string.
- Task 1: review Needs fixes — tests depend on production closure_signatures. Ruling Q9: make self-contained by reading min() and inserting a signature only if none exists; NO DELETE on live tables even in rolled-back tx; empty-table case documented, not tested — cost: one untested SQL-null path.
- Task 1: minor (deferred): universe test duplicates the signature predicate instead of calling cerrar
- Task 1: minor (deferred): go-live seed branch never executed (prod has signatures); post-go-live tests assume 2099-01-05 has no prod rows
- Task 2: minor (deferred): test 2 name says 22:30 Chile but stubs hoy_chile(); apply migration at a quiet moment (ACCESS EXCLUSIVE lock)
- Task 6: review Needs fixes — TOCTOU on carrier status (no FOR UPDATE). Ruling Q10: same-value status re-send is not a status change (no delete needed, no audit no-op) — cost: none. Fix round 1 sent.
- Task 7: minor (deferred): handleChangeOperationalStatus in carriers/[id]/page.tsx is dead code (D5)
- Task 7: minor (deferred): monitor/page.tsx page-level directory.edit gate untested (popover-level only); 'Activar' vs 'Activar empresa' wording
- Task 8: minor (deferred): mutation check is per file not per handler; carriers/page.test.tsx first test times out under full-suite load (flaky, pre-existing)
- Task 9: minor (deferred): import order in FlotaDelDiaSection.tsx:3
- Task 10: minor (deferred): panels' Escape closes ficha+confirm together and focus trap ignores the confirm; no equipment-transfer page test
- Task 11: minor (deferred): ChipDeBaja labels vehicles with statusLabel('driver', ...) — same wording ('Dado de baja') so harmless
- Task 12: minor (deferred): Sidebar inbox badge gives no signal when the queue count fails (absent, not 0); queue error hides cached rows
