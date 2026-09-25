import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@work-rules:start"), source.indexOf("// @@work-rules:end"));
const R = new Function(`${block}\nreturn IkgWorkRules;`)();

const TODAY = "2026-09-25";
const ent = (policyId, name, unit, start, end, amounts = {}, extra = {}) => ({
  id: `${start}-${policyId}`,
  trackingPeriod: `${start}T00:00:00Z`,
  trackingPeriodEndDate: `${end}T00:00:00Z`,
  totalEntitlements: "0.00", balanceAdjusted: "0.00", used: "0.00", available: "0.00",
  requested: "0.00", approved: "0.00", expired: "0.00", accrualAmount: "0.00", isAwaitingAccrual: false,
  carryoverSummary: [],
  ...amounts,
  ...extra,
  Policy: { id: policyId, name, entitlementUnit: unit, hideBalances: false, ...(extra.Policy || {}) },
});
const annual = ent("p-annual", "Annual Leave - Taiwan", "BUSINESS_DAY", "2025-12-01", "2026-11-30",
  { totalEntitlements: "17.00", balanceAdjusted: "-3.00", used: "7.00", available: "7.00" });
const personal = ent("p-personal", "Personal Leave - Taiwan", "HOUR", "2026-01-01", "2026-12-31",
  { totalEntitlements: "112.00", balanceAdjusted: "-32.00", used: "5.00", available: "75.00" });
const birthday = ent("p-bday", "Paid Birthday Leave - Taiwan", "CALENDAR_DAY", "2026-01-01", "2026-12-31",
  { totalEntitlements: "1.00", used: "1.00", available: "0.00" });
const summarize = (rows, today = TODAY) => R.summarizeEntitlements({ entitlements: rows }, today);

describe("summarizeEntitlements", () => {
  test("the period containing today wins over last year's period", () => {
    const old = ent("p-personal", "Personal Leave - Taiwan", "HOUR", "2025-01-01", "2025-12-31", { totalEntitlements: "112.00", available: "112.00" });
    const [row] = summarize([old, personal]);
    assert.equal(row.available, 75);
    assert.equal(row.periodEnd, "2026-12-31");
  });
  test("an anniversary period Dec-to-Nov is picked in September", () => assert.equal(summarize([annual])[0].periodEnd, "2026-11-30"));
  test("when every period has ended the latest started one is used", () => {
    const [row] = summarize([annual], "2027-02-01");
    assert.equal(row.periodEnd, "2026-11-30");
  });
  test("a period that only starts in the future is ignored", () => {
    assert.deepEqual(summarize([ent("p-x", "Future Leave", "HOUR", "2027-01-01", "2027-12-31", { available: "8.00" })]), []);
  });
  test("hidden balances are skipped", () => {
    assert.deepEqual(summarize([ent("p-h", "Hidden", "HOUR", "2026-01-01", "2026-12-31", {}, { Policy: { hideBalances: true } })]), []);
  });
  test("allowance is total plus adjustment and usedPct is used over allowance", () => {
    const [row] = summarize([annual]);
    assert.deepEqual([row.allowance, row.used, row.usedPct, row.hasBar], [14, 7, 0.5, true]);
  });
  test("the country suffix is dropped from the name", () => assert.equal(summarize([annual])[0].name, "Annual Leave"));
  test("hour balances carry a days equivalent", () => assert.equal(summarize([personal])[0].daysEquivalent, 9.375));
  test("zero balances sort after positive ones and negative last", () => {
    const neg = ent("p-neg", "Overdrawn Leave", "HOUR", "2026-01-01", "2026-12-31", { totalEntitlements: "8.00", used: "10.00", available: "-2.00" });
    assert.deepEqual(summarize([birthday, neg, annual, personal]).map((r) => r.name), ["Personal Leave", "Annual Leave", "Paid Birthday Leave", "Overdrawn Leave"]);
    assert.equal(summarize([neg])[0].isNegative, true);
  });
  test("an allowance of zero or less shows no bar", () => {
    const adjOnly = ent("p-comp", "Comp Leave", "HOUR", "2026-01-01", "2026-12-31", { totalEntitlements: "0.00", available: "3.00" });
    assert.deepEqual([summarize([adjOnly])[0].hasBar, summarize([adjOnly])[0].usedPct], [false, 0]);
  });
  test("unparsable amounts are skipped", () => {
    assert.deepEqual(summarize([ent("p-bad", "Bad", "HOUR", "2026-01-01", "2026-12-31", { available: "n/a" })]), []);
  });
  test("a missing payload yields an empty list", () => {
    assert.deepEqual(R.summarizeEntitlements(null, TODAY), []);
    assert.deepEqual(R.summarizeEntitlements({}, TODAY), []);
  });
  test("accrual policies are flagged", () => {
    const acc = ent("p-acc", "Accrual Leave", "HOUR", "2026-01-01", "2026-12-31", { available: "4.00", accrualAmount: "2.00" });
    assert.equal(summarize([acc])[0].isAccrual, true);
  });
  test("remaining carryover expiring before period end drives the expiry date", () => {
    const withCarry = ent("p-c", "Carry Leave", "BUSINESS_DAY", "2026-01-01", "2026-12-31", { available: "5.00", totalEntitlements: "5.00" }, {
      carryoverSummary: [{ totals: { totalRemaining: 2 }, carryovers: [{ remaining: 2, expirationDate: "2026-10-05T00:00:00Z" }] }],
    });
    const [row] = summarize([withCarry]);
    assert.deepEqual([row.carryoverRemaining, row.expiresOn, row.expiryCue], [2, "2026-10-05", "urgent"]);
  });
});

describe("expiry cue and hero", () => {
  const withEnd = (end, available = "3.00") => ent(`p-${end}`, `Leave ${end}`, "BUSINESS_DAY", "2026-01-01", end, { available, totalEntitlements: "5.00" });
  test("61 days out has no cue, 60 is soon, 14 is urgent", () => {
    assert.equal(summarize([withEnd("2026-11-25")])[0].expiryCue, "none");
    assert.equal(summarize([withEnd("2026-11-24")])[0].expiryCue, "soon");
    assert.equal(summarize([withEnd("2026-10-09")])[0].expiryCue, "urgent");
  });
  test("a used-up balance never gets an expiry cue", () => assert.equal(summarize([withEnd("2026-10-01", "0.00")])[0].expiryCue, "none"));
  test("days until expiry counts calendar days", () => assert.equal(summarize([annual])[0].daysUntilExpiry, 66));
  test("the hero is the soonest-expiring non-zero balance", () => {
    const rows = summarize([annual, personal, withEnd("2026-10-09")]);
    assert.equal(R.pickHeroBalance(rows).name, "Leave 2026-10-09");
  });
  test("without an expiry cue the hero falls back to Annual Leave", () => {
    assert.equal(R.pickHeroBalance(summarize([personal, annual], "2026-01-10")).name, "Annual Leave");
  });
  test("no balances means no hero", () => assert.equal(R.pickHeroBalance([]), null));
});

describe("formatting", () => {
  test("amounts drop trailing zeros and round to one decimal", () => {
    assert.deepEqual([R.formatAmount(7), R.formatAmount(0.5), R.formatAmount(9.375), R.formatAmount(-2)], ["7", "0.5", "9.4", "−2"]);
  });
  test("balances use h for hours and d for day units", () => {
    assert.equal(R.formatBalance(75, "HOUR"), "75 h");
    assert.equal(R.formatBalance(7, "BUSINESS_DAY"), "7 d");
    assert.equal(R.formatBalance(1, "CALENDAR_DAY"), "1 d");
  });
});

describe("groupPtoRequests", () => {
  const request = (id, start, end, extra = {}) => {
    const dates = [];
    for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      dates.push({ dateStr, hours: weekend ? 0 : 8 });
    }
    return { id, type: "Annual Leave - Taiwan", status: "approved", unit: "BUSINESS_DAY", amount: dates.filter((x) => x.hours).length,
      startDate: start, endDate: end, dates, description: "", windows: [], ...extra };
  };
  const group = (reqs, today = TODAY) => R.groupPtoRequests(reqs, today);

  test("ended yesterday is taken, starts tomorrow is upcoming, spans today is ongoing", () => {
    const g = group([request("a", "2026-09-24", "2026-09-24"), request("b", "2026-09-28", "2026-09-28"), request("c", "2026-09-24", "2026-09-29")]);
    assert.deepEqual([g.taken.map((i) => i.id), g.upcoming.map((i) => i.id), g.ongoing.map((i) => i.id)], [["a"], ["b"], ["c"]]);
  });
  test("pending requests get their own group and rejected ones are dropped", () => {
    const g = group([request("p", "2026-10-01", "2026-10-01", { status: "pending" }), request("r", "2026-10-02", "2026-10-02", { status: "rejected" })]);
    assert.deepEqual([g.pending.map((i) => i.id), g.upcoming.length, g.taken.length], [["p"], 0, 0]);
  });
  test("a weekday range shows a compact label, the day total and every charged date", () => {
    const [item] = group([request("a", "2026-07-20", "2026-07-24")]).taken;
    assert.deepEqual([item.rangeLabel, item.totalLabel, item.focusDates.length], ["Jul 20–24", "5 d", 5]);
  });
  test("weekend dailies at zero hours never glow", () => {
    const [item] = group([request("a", "2026-07-20", "2026-07-27")]).taken;
    assert.equal(item.focusDates.includes("2026-07-25"), false);
    assert.equal(item.focusDates.length, 6);
  });
  test("a single day shows its weekday", () => assert.equal(group([request("a", "2026-07-28", "2026-07-28")]).taken[0].rangeLabel, "Jul 28 · Tue"));
  test("a range across months names both months", () => {
    const [item] = group([request("a", "2026-11-30", "2026-12-02")]).upcoming;
    assert.deepEqual([item.rangeLabel, item.continuesInto], ["Nov 30 – Dec 2", ["2026-12"]]);
  });
  test("a range across years is grouped under its start year", () => {
    const [item] = group([request("a", "2026-12-30", "2027-01-04")]).upcoming;
    assert.deepEqual([item.year, item.rangeLabel], [2026, "Dec 30 – Jan 4"]);
  });
  test("hour requests show hours and their time window", () => {
    const [item] = group([request("a", "2026-07-28", "2026-07-28", { unit: "HOUR", amount: 3, dates: [{ dateStr: "2026-07-28", hours: 3 }], windows: [{ start: 9, end: 12 }] })]).taken;
    assert.deepEqual([item.totalLabel, item.windowLabel], ["3 h", "09:00–12:00"]);
  });
  test("day requests without a window read as full days", () => assert.equal(group([request("a", "2026-07-20", "2026-07-24")]).taken[0].windowLabel, "full days"));
  test("upcoming items say tomorrow or in N days", () => {
    const g = group([request("a", "2026-09-26", "2026-09-26"), request("b", "2026-10-14", "2026-10-14")]);
    assert.deepEqual(g.upcoming.map((i) => i.relativeLabel), ["tomorrow", "in 19 days"]);
  });
  test("an ongoing multi-day item says which charged day today is", () => {
    const [item] = group([request("a", "2026-09-24", "2026-09-30")]).ongoing;
    assert.equal(item.relativeLabel, "day 2 of 5");
  });
  test("a single-day item today reads today", () => assert.equal(group([request("a", TODAY, TODAY)]).ongoing[0].relativeLabel, "today"));
  test("upcoming sorts soonest first and taken most recent first", () => {
    const g = group([request("u2", "2026-11-02", "2026-11-02"), request("u1", "2026-10-01", "2026-10-01"), request("t1", "2026-04-01", "2026-04-01"), request("t2", "2026-07-01", "2026-07-01")]);
    assert.deepEqual([g.upcoming.map((i) => i.id), g.taken.map((i) => i.id)], [["u1", "u2"], ["t2", "t1"]]);
  });
  test("a request without dailies glows every date in its range", () => {
    const [item] = group([request("a", "2026-04-01", "2026-04-02", { dates: [] })]).taken;
    assert.deepEqual(item.focusDates, ["2026-04-01", "2026-04-02"]);
  });
});

describe("resolveShiftFromHistory", () => {
  test("a month with no check-ins borrows the most recent month that has them", () => {
    assert.equal(R.resolveShiftFromHistory([[], [], [10.2, 10.4]], "auto").label, "10:00 ~ 19:00");
  });
  test("manual shift wins over history", () => assert.equal(R.resolveShiftFromHistory([[], [10.2]], "13:00 ~ 22:00").label, "13:00 ~ 22:00"));
  test("no history at all falls back to the default shift", () => assert.equal(R.resolveShiftFromHistory([[], []], "auto").source, "default"));
});

describe("Deel day notes", () => {
  const deelBlock = source.slice(source.indexOf("const deelDailyHours"), source.indexOf("const syncDeelBalances"));
  const D = new Function("IkgWorkRules", "IkgLog", "toYMD", `${deelBlock}\nreturn { toDeelPtoList, buildDeelDayNotes };`)(
    R, { info() {}, warn() {} }, (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  );
  const timeOff = (id, status, start, amount = 1) => ({
    id, status, amount, startDate: `${start}T00:00:00Z`, endDate: `${start}T00:00:00Z`,
    timeOffType: { name: "Annual Leave - Taiwan", policy: { entitlementUnit: "BUSINESS_DAY" } },
  });

  test("pending leave is display-only and never becomes PTO credit", () => {
    const notes = D.buildDeelDayNotes(D.toDeelPtoList([timeOff("p", "REQUESTED", "2026-10-23")], {}));
    const note = notes["2026-10-23"];
    assert.deepEqual([note.isPTO, note.deductedHours, note.pendingPTO.length], [undefined, undefined, 1]);
  });
  test("pending and approved leave on one day keep both", () => {
    const list = D.toDeelPtoList([timeOff("p", "PENDING", "2026-10-23", 0.5), timeOff("a", "APPROVED", "2026-10-23", 0.5)], {});
    const note = D.buildDeelDayNotes(list)["2026-10-23"];
    assert.deepEqual([note.deductedHours, note.isPartialPTO, note.pendingPTO[0].hours], [4, true, 4]);
  });
  test("rejected and cancelled leave is not synced", () => {
    assert.deepEqual(D.toDeelPtoList([timeOff("r", "REJECTED", "2026-10-23"), timeOff("c", "CANCELED", "2026-10-24")], {}), []);
  });
});
