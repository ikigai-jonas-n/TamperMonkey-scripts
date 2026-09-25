import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@work-rules:start"), source.indexOf("// @@work-rules:end"));
const R = new Function(`${block}\nreturn IkgWorkRules;`)();

const DAY = R.shiftFromLabel("09:00 ~ 18:00");
const DAY_930 = R.shiftFromLabel("09:30 ~ 18:30");
const DAY_10 = R.shiftFromLabel("10:00 ~ 19:00");
const NIGHT = R.shiftFromLabel("13:00 ~ 22:00");

const win = (start, end) => ({ start, end });
const parse = (text, shift = DAY) => R.disambiguateWindows(R.parsePtoWindows(text), shift).map(({ start, end }) => [start, end]);
const schedule = (shift, windows, ptoHrs) =>
  R.computeDaySchedule({ shift, ptoWindows: windows, ptoHrs: ptoHrs ?? windows.reduce((s, w) => s + w.end - w.start, 0), isFullPTO: false });

describe("shifts", () => {
  test("day shifts share the 11:45-13:00 meal break", () => {
    for (const s of [DAY, DAY_930, DAY_10]) assert.deepEqual([s.mealStart, s.mealEnd], [11.75, 13]);
  });

  test("night shift 13:00-22:00 has its meal break at 17:45-19:00", () => {
    assert.deepEqual([NIGHT.start, NIGHT.end, NIGHT.mealStart, NIGHT.mealEnd], [13, 22, 17.75, 19]);
  });

  test("manual shift wins over detected check-ins", () => {
    assert.equal(R.resolveShift([9, 9, 9], "13:00 ~ 22:00").label, "13:00 ~ 22:00");
  });

  test("auto shift is the most frequent check-in bucket", () => {
    assert.equal(R.resolveShift([9.6, 9.7, 8.9], "auto").label, "09:30 ~ 18:30");
    assert.equal(R.resolveShift([10.2, 13.1, 13.4], "auto").label, "13:00 ~ 22:00");
  });

  test("a 09:29 check-in still belongs to the 09:00 shift", () => {
    assert.equal(R.resolveShift([9 + 29 / 60], "auto").label, "09:00 ~ 18:00");
  });

  test("no check-ins falls back to the 09:00 shift marked as default", () => {
    const s = R.resolveShift([], "auto");
    assert.equal(s.label, "09:00 ~ 18:00");
    assert.equal(s.source, "default");
  });
});

describe("parsePtoWindows", () => {
  const cases = [
    ["Urgent matter at home, 17:00-18:00, Leave coverage: Kyle", [[17, 18]]],
    ["Feeling not well, 9:00-10:00, Leave coverage: Kobe", [[9, 10]]],
    ["Rest after morning flight, 9:00 - 12:00, Leave coverage: Kyle", [[9, 12]]],
    ["1700-1800", [[17, 18]]],
    ["1700 -1800", [[17, 18]]],
    ["930-1030", [[9.5, 10.5]]],
    ["17:00~18:30", [[17, 18.5]]],
    ["17.00-18.00", [[17, 18]]],
    ["5pm-6pm", [[17, 18]]],
    ["5-6pm", [[17, 18]]],
    ["11-1pm", [[11, 13]]],
    ["9am - 1pm", [[9, 13]]],
    ["9 a.m. to 1 p.m.", [[9, 13]]],
    ["12pm-1pm", [[12, 13]]],
    ["13:00~17:00", [[13, 17]]],
    ["13:00 – 17:00", [[13, 17]]],
    ["１７：００～１８：００", [[17, 18]]],
    ["下午5點到6點", [[17, 18]]],
    ["上午9點半至11點", [[9.5, 11]]],
    ["on 2026-05-19, 17:00-18:00", [[17, 18]]],
    ["05/19 17:00-18:00", [[17, 18]]],
    ["9-10 and 17-18", [[9, 10], [17, 18]]],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" parses to ${JSON.stringify(expected)}`, () => assert.deepEqual(parse(text), expected));
  }

  test("bare 5-6 on a day shift means the evening", () => assert.deepEqual(parse("5-6"), [[17, 18]]));
  test("bare 7-8 on the night shift means 19:00-20:00", () => assert.deepEqual(parse("7-8", NIGHT), [[19, 20]]));
  test("zero-padded 08:00-09:00 is never shifted to the evening", () => assert.deepEqual(parse("08:00-09:00"), [[8, 9]]));
  test("cross-midnight 22:00-02:00 is rejected", () => assert.deepEqual(parse("22:00-02:00"), []));
  test("minutes above 59 are rejected", () => assert.deepEqual(parse("1790-1800"), []));
  test("text without a time range yields nothing", () => assert.deepEqual(parse("早上的班機, 想多休息一會"), []));
  test("empty and non-string input yield nothing", () => {
    assert.deepEqual(R.parsePtoWindows(""), []);
    assert.deepEqual(R.parsePtoWindows(null), []);
  });
});

describe("computeDaySchedule span (required punch-in to punch-out)", () => {
  const rows = [
    ["evening PTO 17-18 on day shift", DAY, [win(17, 18)], 8],
    ["morning PTO 9-10 on day shift", DAY, [win(9, 10)], 8],
    ["PTO 9-12 ends inside meal so work starts 13:00", DAY, [win(9, 12)], 5],
    ["PTO 9-11:45 ends at meal start so work starts 13:00", DAY, [win(9, 11.75)], 5],
    ["PTO 9-13 leaves 13-18", DAY, [win(9, 13)], 5],
    ["afternoon PTO 13-18 leaves 09:00-11:45", DAY, [win(13, 18)], 2.75],
    ["PTO 12-18 starts inside meal and leaves 09:00-11:45", DAY, [win(12, 18)], 2.75],
    ["PTO inside the meal break changes nothing", DAY, [win(12, 13)], 9],
    ["mid-shift PTO 14-15 still needs the full punch span", DAY, [win(14, 15)], 9],
    ["two windows 9-10 and 17-18 leave 10-17", DAY, [win(9, 10), win(17, 18)], 7],
    ["PTO 8-10 is clipped to the shift start", DAY, [win(8, 10)], 8],
    ["09:30 shift afternoon PTO 13:00-18:30 leaves 09:30-11:45", DAY_930, [win(13, 18.5)], 2.25],
    ["09:30 shift PTO 13:30-18:30 still owes 13:00-13:30 after the meal", DAY_930, [win(13.5, 18.5)], 4],
    ["10:00 shift PTO 10-12 leaves 13-19", DAY_10, [win(10, 12)], 6],
    ["10:00 shift evening PTO 18-19", DAY_10, [win(18, 19)], 8],
    ["night PTO 13-15 leaves 15-22", NIGHT, [win(13, 15)], 7],
    ["night PTO 13-18 ends inside meal so work starts 19:00", NIGHT, [win(13, 18)], 3],
    ["night PTO 18-22 starts inside meal and leaves 13:00-17:45", NIGHT, [win(18, 22)], 4.75],
    ["night PTO 21-22", NIGHT, [win(21, 22)], 8],
  ];
  for (const [title, shift, windows, span] of rows) {
    test(`${title} → span ${span}, credit ${9 - span}`, () => {
      const s = schedule(shift, windows);
      assert.equal(s.span, span);
      assert.equal(s.ptoCredit, 9 - span);
      assert.equal(s.mode, "window");
    });
  }

  test("evening PTO allows checkout at 17:00", () => assert.equal(schedule(DAY, [win(17, 18)]).earliestCheckout, 17));
  test("afternoon PTO allows checkout at 11:45", () => assert.equal(schedule(DAY, [win(13, 18)]).earliestCheckout, 11.75));
  test("morning PTO 9-12 lets work start at 13:00", () => assert.equal(schedule(DAY, [win(9, 12)]).earliestCheckin, 13));

  test("a window covering the whole shift is a full PTO day", () => {
    const s = schedule(DAY, [win(9, 18)], 8);
    assert.deepEqual([s.span, s.ptoCredit, s.mode], [0, 9, "full"]);
  });

  test("a window entirely outside the shift is ignored and flagged", () => {
    const s = schedule(DAY, [win(18, 19)], 1);
    assert.deepEqual([s.span, s.ptoCredit, s.mode], [9, 0, "window-outside"]);
  });

  test("full PTO flag wins over any window", () => {
    const s = R.computeDaySchedule({ shift: DAY, ptoWindows: [win(17, 18)], ptoHrs: 1, isFullPTO: true });
    assert.deepEqual([s.span, s.ptoCredit, s.mode], [0, 9, "full"]);
  });

  test("8h or more of PTO is a full PTO day", () => {
    assert.equal(R.computeDaySchedule({ shift: DAY, ptoWindows: [], ptoHrs: 8, isFullPTO: false }).mode, "full");
  });

  test("partial PTO with no parsed window falls back to 9 minus PTO hours", () => {
    const s = R.computeDaySchedule({ shift: DAY, ptoWindows: [], ptoHrs: 3, isFullPTO: false });
    assert.deepEqual([s.span, s.ptoCredit, s.mode, s.earliestCheckout], [6, 3, "legacy", 15]);
  });

  test("no PTO is a standard 9h punch span ending at shift end", () => {
    const s = R.computeDaySchedule({ shift: NIGHT, ptoWindows: [], ptoHrs: 0, isFullPTO: false });
    assert.deepEqual([s.span, s.ptoCredit, s.mode, s.earliestCheckout], [9, 0, "standard", 22]);
  });

  test("window hours matching Deel hours are not flagged", () => {
    assert.equal(schedule(DAY, [win(17, 18)], 1).hoursMismatch, false);
  });

  test("Deel hours that exclude the meal break still match the window", () => {
    assert.equal(schedule(DAY, [win(9, 13)], 2.75).hoursMismatch, false);
  });

  test("window hours far from Deel hours are flagged as a mismatch", () => {
    assert.equal(schedule(DAY, [win(17, 18)], 3).hoursMismatch, true);
  });
});

describe("gradeDay", () => {
  const grade = (effectiveHrs, extra = {}) => R.gradeDay({ effectiveHrs, baselineHrs: 9, isToday: false, isYesterdayGrace: false, ...extra }).label;
  const rows = [[8.49, "deficit"], [8.5, "acceptable"], [8.99, "acceptable"], [9, "surplus"], [9.99, "surplus"], [10, "overachiever"]];
  for (const [hrs, label] of rows) test(`${hrs}h grades as ${label}`, () => assert.equal(grade(hrs), label));

  test("an unfinished today grades as today-active", () => assert.equal(grade(5, { isToday: true }), "today-active"));
  test("a finished today grades normally", () => assert.equal(grade(9, { isToday: true }), "surplus"));
  test("yesterday before its checkout sync grades as yesterday-grace", () => assert.equal(grade(5, { isYesterdayGrace: true }), "yesterday-grace"));
  test("no baseline and no hours grades as none", () => assert.equal(grade(0, { baselineHrs: 0 }), "none"));
  test("the goal is met at exactly 9h", () => {
    assert.equal(R.isGoalMet(9), true);
    assert.equal(R.isGoalMet(8.99), false);
  });
});

describe("formatWindow", () => {
  test("decimal hours format as HH:MM–HH:MM", () => assert.equal(R.formatWindow(win(9.5, 17.75)), "09:30–17:45"));
});
