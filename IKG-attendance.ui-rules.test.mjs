import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@work-rules:start"), source.indexOf("// @@work-rules:end"));
const R = new Function(`${block}\nreturn IkgWorkRules;`)();

const LATE = R.shiftFromLabel("10:00 ~ 19:00");
const DAY = R.shiftFromLabel("09:00 ~ 18:00");
const r6 = (n) => Math.round(n * 1e6) / 1e6;

describe("heatmapLayout", () => {
  test("few weeks stretch to fill the width, but never wider than the cell height", () => {
    assert.deepEqual(R.heatmapLayout({ weeks: 3, availablePx: 1200, minWidthPx: 24, maxWidthPx: 70 }), { cellPx: 70, scrolls: false });
  });
  test("weeks that fit at the chosen width stretch to fill the pane", () => {
    const l = R.heatmapLayout({ weeks: 25, availablePx: 1200, minWidthPx: 24, maxWidthPx: 96 });
    assert.equal(l.scrolls, false);
    assert.ok(l.cellPx > 24 && l.cellPx < 96);
  });
  test("too many weeks keep the chosen width and scroll", () => {
    assert.deepEqual(R.heatmapLayout({ weeks: 60, availablePx: 1200, minWidthPx: 24, maxWidthPx: 70 }), { cellPx: 24, scrolls: true });
  });
  test("the default width packs 60 weeks into 1700px without scrolling", () => {
    assert.equal(R.heatmapLayout({ weeks: 60, availablePx: 1700, maxWidthPx: 70 }).scrolls, false);
  });
  test("a chosen width outside the slider range is clamped", () => {
    assert.equal(R.heatmapLayout({ weeks: 200, availablePx: 100, minWidthPx: 2 }).cellPx, R.HEATMAP_WIDTH_MIN);
    assert.equal(R.heatmapLayout({ weeks: 200, availablePx: 100, minWidthPx: 500 }).cellPx, R.HEATMAP_WIDTH_MAX);
  });
  test("0 weeks or a hidden pane never divides by zero", () => {
    assert.equal(R.heatmapLayout({ weeks: 0, availablePx: 1200 }).scrolls, false);
    assert.equal(R.heatmapLayout({ weeks: 10, availablePx: 0 }).cellPx, R.HEATMAP_WIDTH_DEFAULT);
  });
});

describe("ptoShareOf", () => {
  test("1h of leave on a 9h day still shows a quarter of the cell", () => assert.equal(R.ptoShareOf({ ptoCredit: 1, effectiveHrs: 9 }), 0.25));
  test("a mostly-leave day shows at most three quarters", () => assert.equal(R.ptoShareOf({ ptoCredit: 8, effectiveHrs: 9 }), 0.75));
  test("half leave shows half", () => assert.equal(R.ptoShareOf({ ptoCredit: 4.5, effectiveHrs: 9 }), 0.5));
  test("no leave or no hours shows none", () => assert.deepEqual([R.ptoShareOf({ ptoCredit: 0, effectiveHrs: 9 }), R.ptoShareOf({ ptoCredit: 3, effectiveHrs: 0 })], [0, 0]));
});

describe("weekColumns", () => {
  test("columns run Sunday to Saturday and cover both ends", () => {
    const cols = R.weekColumns("2026-10-07", "2026-10-13");
    assert.deepEqual([cols.length, cols[0][0], cols[1][6]], [2, "2026-10-04", "2026-10-17"]);
  });
  test("a span over a DST change still has 7 distinct days per column", () => {
    const cols = R.weekColumns("2026-03-01", "2026-04-30");
    assert.ok(cols.every((c) => new Set(c).size === 7));
  });
  test("more than ten years is capped", () => assert.equal(R.weekColumns("2010-01-01", "2026-01-01").length, R.MAX_HISTORY_WEEKS));
  test("an invalid or reversed range gives no columns", () => {
    assert.deepEqual([R.weekColumns("nope", "2026-01-01").length, R.weekColumns("2026-02-01", "2026-01-01").length], [0, 0]);
  });
});

describe("bucketByPeriod", () => {
  const row = (dateStr, effectiveHrs, baselineHrs = 9) => ({ dateStr, effectiveHrs, baselineHrs, actualHrs: effectiveHrs });
  test("days group into Monday-start weeks across a month boundary", () => {
    const weeks = R.bucketByPeriod([row("2026-09-30", 9.5), row("2026-10-02", 8), row("2026-10-05", 9)], "week");
    assert.deepEqual(weeks.map((w) => [w.periodStart, w.effectiveHrs, w.baselineHrs, w.days]), [["2026-09-28", 17.5, 18, 2], ["2026-10-05", 9, 9, 1]]);
  });
  test("days group into calendar months across a year boundary", () => {
    const months = R.bucketByPeriod([row("2026-12-31", 9), row("2027-01-04", 8), row("2027-01-29", 10)], "month");
    assert.deepEqual(months.map((m) => [m.periodStart, m.effectiveHrs, m.days]), [["2026-12-01", 9, 1], ["2027-01-01", 18, 2]]);
  });
  test("an empty list gives no periods", () => assert.deepEqual(R.bucketByPeriod([], "month"), []));
});

describe("mapPool", () => {
  test("never runs more than the limit at once and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await R.mapPool([5, 1, 4, 2, 3, 0, 6, 1, 2, 3], 4, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i;
    });
    assert.equal(peak, 4);
    assert.deepEqual(results.map((r) => r.value), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  test("failing tasks resolve their slot and the rest still finish", async () => {
    const results = await R.mapPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      if (n % 3 === 0) throw new Error(`boom ${n}`);
      return n;
    });
    assert.deepEqual(results.map((r) => r.ok), [true, true, false, true, true, false, true, true, false, true]);
  });
  test("an empty list finishes immediately", async () => assert.deepEqual(await R.mapPool([], 4, async () => 1), []));
});

describe("countedReason and explainMonth", () => {
  const row = (dateStr, extra = {}) => ({
    dateStr, isWorkingDay: true, isFullPTO: false, isPartialPTO: false, isWFH: false, isToday: false, isFuture: false,
    isYesterdayGrace: false, isIgnored: false, isWfhExcluded: false, isEventDay: false, isPublicHoliday: false, isWeekend: false,
    actualHrs: 9, ptoCredit: 0, eventCredit: 0, baselineHrs: 9, effectiveHrs: 9, ...extra,
  });
  const withCounted = (rows) => rows.map((r) => {
    const reason = R.countedReason(r);
    return { ...r, countedReason: reason, isCounted: R.isCountedReason(reason) };
  });
  const month = withCounted([
    row("2026-10-01", { actualHrs: 9.2, effectiveHrs: 9.2 }),
    row("2026-10-02", { isWFH: true, actualHrs: 8.5, effectiveHrs: 8.5 }),
    row("2026-10-03", { isWeekend: true, isWorkingDay: false, actualHrs: 0, effectiveHrs: 0, baselineHrs: 0 }),
    row("2026-10-05", { isPartialPTO: true, actualHrs: 4.53, ptoCredit: 5, effectiveHrs: 9.53 }),
    row("2026-10-06", { isFullPTO: true, actualHrs: 0, ptoCredit: 9, effectiveHrs: 9 }),
    row("2026-10-07", { isEventDay: true, actualHrs: 6, effectiveHrs: 6 }),
    row("2026-10-08", { isIgnored: true, actualHrs: 2, effectiveHrs: 2 }),
    row("2026-10-09", { isWFH: true, isWfhExcluded: true, isWorkingDay: false, actualHrs: 0, effectiveHrs: 0 }),
    row("2026-10-12", { isYesterdayGrace: true, actualHrs: 3, effectiveHrs: 3 }),
    row("2026-10-13", { isToday: true, actualHrs: 1, effectiveHrs: 1 }),
    row("2026-10-14", { isFuture: true, isWorkingDay: false, actualHrs: 0, effectiveHrs: 0 }),
    row("2026-10-15", { isWorkingDay: false, actualHrs: 0, effectiveHrs: 0, baselineHrs: 0 }),
  ]);

  test("each excluded day carries its own reason", () => {
    assert.deepEqual(month.map((r) => r.countedReason), [
      "counted", "counted", "weekend", "counted", "full-pto", "event", "ignored", "wfh-excluded", "yesterday-lag", "today", "future", "no-punches",
    ]);
  });
  test("a holiday without punches is a holiday, not a missing day", () => {
    assert.equal(R.countedReason(row("2026-10-10", { isPublicHoliday: true, isWorkingDay: false })), "holiday");
  });
  test("explainMonth totals equal summarizeMonth for the same rows", () => {
    const { totals } = R.explainMonth(month);
    const summary = R.summarizeMonth(month);
    for (const key of Object.keys(summary)) assert.equal(totals[key], summary[key], key);
  });
  test("the running net on the last counted line equals the month net", () => {
    const { lines, totals } = R.explainMonth(month);
    assert.equal(lines.filter((l) => l.included).at(-1).runningNetHrs, totals.netHrs);
  });
  test("every line's effective hours split into office + WFH + PTO credit + event credit", () => {
    for (const l of R.explainMonth(month).lines.filter((x) => x.included)) {
      assert.equal(r6(l.officeHrs + l.wfhHrs + l.ptoCreditHrs + l.eventCreditHrs), l.effectiveHrs, l.dateStr);
    }
  });
  test("a full-PTO day is listed as counted but moves nothing", () => {
    const line = R.explainMonth(month).lines.find((l) => l.dateStr === "2026-10-06");
    assert.deepEqual([line.included, line.flexHrs], [false, 0]);
  });
  test("excluded days are counted per reason", () => assert.equal(R.explainMonth(month).totals.excluded.weekend, 1));
  test("a month with nothing counted has a zero net", () => assert.equal(R.explainMonth(withCounted([row("2026-10-13", { isToday: true })])).totals.netHrs, 0));
});

describe("explainDayTarget", () => {
  const schedule = (extra) => R.computeDaySchedule({ shift: LATE, ...extra });
  const explain = (extra, dayExtra = {}) => R.explainDayTarget({ shift: LATE, schedule: schedule(extra), ...dayExtra });

  test("a normal day requires the full 9h span", () => {
    const e = explain({});
    assert.deepEqual([e.requiredHrs, e.creditHrs], [9, 0]);
    assert.match(e.steps.join("\n"), /10:00–19:00/);
  });
  test("a morning PTO window that swallows lunch moves the punch window to 13:00 → 19:00", () => {
    const e = explain({ ptoWindows: [{ start: 10, end: 12 }], ptoHrs: 2 }, { ptoHrs: 2, ptoType: "Annual Leave" });
    assert.deepEqual([e.requiredHrs, e.creditHrs], [6, 3]);
    const text = e.steps.join("\n");
    assert.match(text, /lunch 11:45–13:00 also inside your leave/);
    assert.match(text, /13:00 → 19:00/);
  });
  test("PTO hours without a time window subtract from 9h", () => {
    const e = explain({ ptoHrs: 4 }, { ptoHrs: 4 });
    assert.deepEqual([e.requiredHrs, e.creditHrs], [5, 4]);
    assert.match(e.steps.join("\n"), /no time window/);
  });
  test("full PTO requires nothing", () => assert.equal(explain({ isFullPTO: true }, { isFullPTO: true }).requiredHrs, 0));
  test("an all-day event requires nothing", () => {
    assert.equal(R.explainDayTarget({ shift: DAY, schedule: R.computeDaySchedule({ shift: DAY, eventWindows: [{ start: 9, end: 18 }] }), events: [{ name: "Trip", allDay: true }] }).requiredHrs, 0);
  });
  test("an early-release event day says only attendance is checked", () => {
    const events = [{ name: "Party", clockOutFrom: 17.5, clockInFrom: null, allDay: false }];
    const e = R.explainDayTarget({ shift: LATE, schedule: schedule({ eventWindows: R.eventWindowsFor(events, LATE) }), events, isEventDay: true });
    assert.match(e.steps.join("\n"), /only your clock-in is checked/);
  });
  test("the required hours always match computeDaySchedule", () => {
    for (const extra of [{}, { ptoHrs: 3 }, { ptoWindows: [{ start: 15, end: 19 }], ptoHrs: 4 }]) {
      assert.equal(explain(extra, { ptoHrs: extra.ptoHrs || 0 }).requiredHrs, schedule(extra).span);
    }
  });
});

describe("alarmTriggerAction", () => {
  const target = Date.UTC(2026, 9, 19, 11, 0);
  const at = (deltaMs, val = 0) => R.alarmTriggerAction({ triggerTimeMs: target, nowMs: target + deltaMs, val });
  test("the ring fires on time", () => assert.equal(at(0), "ring"));
  test("a ring up to 15 minutes late still fires once", () => assert.equal(at(14 * 60e3), "ring"));
  test("a ring woken up more than 15 minutes late is skipped", () => assert.equal(at(16 * 60e3), "skip"));
  test("a heads-up notification fires on time", () => assert.equal(at(1000, -0.5), "notify"));
  test("a heads-up notification more than 2 minutes late is skipped", () => assert.equal(at(3 * 60e3, -0.5), "skip"));
  test("a timer that fires early never rings", () => assert.equal(at(-60e3), "skip"));
});

describe("planAlarmSoundMigration", () => {
  const plan = (stored, soundType = "pro_fkj", targetVersion = 1) =>
    R.planAlarmSoundMigration({ stored, soundType, targetVersion, defaultSound: "pro_wendy" });
  test("a first run switches to the new default and remembers the old sound", () => {
    assert.deepEqual(plan(null), { apply: true, next: { version: 1, previous: "pro_fkj", decided: false } });
  });
  test("a switched but unanswered prompt keeps asking without switching again", () => {
    const stored = JSON.stringify({ version: 1, previous: "pro_fkj", decided: false });
    assert.deepEqual(plan(stored, "pro_wendy"), { apply: false, next: JSON.parse(stored) });
  });
  test("an answered prompt changes nothing, even after the user picks another sound", () => {
    const stored = JSON.stringify({ version: 1, previous: "pro_fkj", decided: true });
    assert.deepEqual([plan(stored, "custom").apply, plan(stored, "custom").next.decided], [false, true]);
  });
  test("a newer default version runs the switch again", () => {
    const stored = JSON.stringify({ version: 1, previous: "pro_fkj", decided: true });
    assert.deepEqual(plan(stored, "custom", 2), { apply: true, next: { version: 2, previous: "custom", decided: false } });
  });
  test("someone already on the new default is never prompted", () => assert.equal(plan(null, "pro_wendy").next.decided, true));
  test("a brand-new install without a saved sound counts as the default", () => assert.equal(plan(null, "").next.decided, true));
  test("unreadable stored state is treated as a first run", () => assert.equal(plan("{oops").apply, true));
});

describe("gasRequestMonths", () => {
  test("a date in the current month fetches only its month, since next month has not started", () => {
    assert.deepEqual(R.gasRequestMonths("2026-10-14", "2026-10-19"), ["2026-10"]);
  });
  test("a date in a past month also fetches the next month, where a late fix may be filed", () => {
    assert.deepEqual(R.gasRequestMonths("2026-10-31", "2026-11-03"), ["2026-10", "2026-11"]);
  });
  test("December fetches January once January has started", () => {
    assert.deepEqual(R.gasRequestMonths("2026-12-31", "2027-01-02"), ["2026-12", "2027-01"]);
  });
  test("a future date fetches nothing", () => assert.deepEqual(R.gasRequestMonths("2026-10-20", "2026-10-19"), []));
  test("an invalid date fetches nothing", () => assert.deepEqual(R.gasRequestMonths("nope", "2026-10-19"), []));
});

describe("withDeadline", () => {
  test("an on-time promise resolves with its value", async () => assert.equal(await R.withDeadline(Promise.resolve(7), 50, () => "late"), 7));
  test("a promise that never settles resolves with the fallback after the deadline", async () => {
    assert.equal(await R.withDeadline(new Promise(() => {}), 20, () => "late"), "late");
  });
  test("a rejected promise resolves instead of throwing", async () => assert.equal(await R.withDeadline(Promise.reject(new Error("x")), 50, () => "late"), undefined));
  test("a value that arrives after the deadline is ignored", async () => {
    const slow = new Promise((r) => setTimeout(() => r("slow"), 40));
    assert.equal(await R.withDeadline(slow, 10, () => "late"), "late");
  });
});
