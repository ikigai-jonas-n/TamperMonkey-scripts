# TamperMonkey-scripts

- Never commit and never bump `@version` / `@name` — the user releases via `deploy.sh` / the pre-commit hook.
- Tests: `node --test` from repo root (auto-discovers root `*.test.mjs`; no build, no deps). Keep every file at the repo root: `origin` also pushes to the gist, and gists reject directories.

## IKG-attendance.user.js — three layers, keep them separate

| Layer | Where | Rule |
|---|---|---|
| Rules | `IkgWorkRules`, between `// @@work-rules:start` / `:end` | Pure: no DOM, storage, `GM_*`, `IkgLog`. Tests slice this block out of the file, so it must stay self-contained. |
| Domain | `IKG_DataStore` (snapshot + per-month `shiftFor`) and `evaluateDay(ctx)` | Only place that turns records/notes into a day DTO. No HTML. |
| UI | renderers, `TONE_COLORS` / `toneColor` / `goalColor`, `ptoTooltip`, `ptoDetailHtml`, `escapeAttr` | Read the DTO only. Never compare hours to thresholds or pick grade colours inline. |

`evaluateDay` DTO: `targetHrs` (required punch span), `ptoCredit`, `baselineHrs`, `effectiveHrs = actual + ptoCredit` (9h scale), `flexHrs = effective − baseline`, `grade.label`, `isGoalMet`, `shift`, `schedule`, `ptoHrs` (raw Deel hours, display only), `ptoWindowLabel`, `ptoDescription`, `isFuture`, `plannedWindow` (work window left on a partial-PTO day), `pendingPTO` (awaiting approval; display only, never credit).

## Time model
- Shifts (9h gross): `09:00~18:00`, `09:30~18:30`, `10:00~19:00` → meal 11:45–13:00; `13:00~22:00` → meal 17:45–19:00. Shift = settings `manualShift`, else most frequent check-in bucket of that month, else of the nearest earlier month with check-ins (6 back), else 09:00.
- Partial PTO with a parsed window: span = first-to-last remaining work minute of (shift − meal − PTO windows). Without a window: legacy `9 − ptoHrs`.
- Edge cases are the test titles in `IKG-attendance.work-rules.test.mjs` / `IKG-attendance.gas-punches.test.mjs` — add a row there before changing a rule.

## Punches: office vs WFH vs forgot-punch corrections
- Cache records keep punches per source: `officeIn/officeOut` (AWS only, `fillCacheGaps`) and `gasPunches` (GAS only, `runWfhSync`). `startTime/endTime/workHours/isWFH/punchSources/corrections` are always derived by `withResolvedPunches` → `IkgWorkRules.resolvePunches`. Never write the derived fields directly or OR `isWFH`.
- GAS `getRecordsByDate [date]` → `[{type:"Clock Out",time:"19:36:00"}]` (no source). `getMyRequests [YYYY-MM]` → `[{date,type,time,reviewStatus,reviewNote,id}]`. A GAS punch matching a request (`classifyGasPunches`) is a correction, else WFH. Requests are fetched for the date's month and the next one.
- Corrections-only day = office. Rejected corrections don't count. Records with `gasSchemaVer !== 2` are legacy and migrate when the WFH sync revisits them.
- GAS needs Google session cookies: curl returns 401, so capture fixtures from DevTools.

## Deel PTO descriptions
`time_offs/me` → `time_offs/profile/{id}/time_off` (no descriptions) + `approvals/requests/requester` (cursor-paged list) → `approvals/requests/requester/{approvalId}` → `details.requestDetails[].id === time_off.id`, carries `description` and `timeOffDailies[].hoursAmount`. Details cached in `GM_setValue("IKG_DEEL_APPROVAL_CACHE")` by `updatedAt`. `DAY_NOTES_KEY` is owned by the Deel sync alone: rebuilt from scratch each sync (same-day leaves merged by `mergeDeelDayNote`), so don't store other per-day data there. Token-only auth (`x-auth-token`) works from curl.

## Deel balances + PTO tab
- `time_offs/profile/{id}/entitlements` → `{entitlements:[…]}`, one row per policy per tracking period (past periods included). Amounts are strings; `available = totalEntitlements + balanceAdjusted − used`. Stored as `DEEL_BALANCES_KEY` `{syncedAt, entitlements}`; read through `IkgWorkRules.summarizeEntitlements` (period containing today wins) and `pickHeroBalance`.
- The normalized request list (`toDeelPtoList`: USED/APPROVED/REQUESTED/PENDING) is stored as `DEEL_PTO_LIST_KEY` and grouped by `IkgWorkRules.groupPtoRequests` into ongoing/upcoming/pending/taken. `focusDates` are charged dates only.
- Clicking a request calls `focusPtoItem` → `ptoFocus` (dates, months, glow/chip deadlines); `renderCalendar` re-applies it on every render via `activePtoFocus` / `applyPtoFocus` and drops it once the viewed month has none of its dates.
- Deel dates are `…T00:00:00Z`: always `substring(0, 10)`, never `new Date()` them.
