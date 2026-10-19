import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@work-rules:start"), source.indexOf("// @@work-rules:end"));
const R = new Function(`${block}\nreturn IkgWorkRules;`)();

const DAY = R.shiftFromLabel("09:00 ~ 18:00");
const LATE = R.shiftFromLabel("10:00 ~ 19:00");
const NIGHT = R.shiftFromLabel("13:00 ~ 22:00");
const file = (events, version = 1) => JSON.stringify({ version, events });
const event = (extra) => ({ date: "2026-09-04", name: "Mid-Autumn Gathering", ...extra });
const eventsOf = (...raw) => R.parseSpecialDays(file(raw)).events;
const scheduleFor = (shift, events, extra = {}) => R.computeDaySchedule({ shift, eventWindows: R.eventWindowsFor(events, shift), ...extra });

describe("parseSpecialDays", () => {
  test("a valid clockOutFrom event is kept with decimal hours", () => {
    const [e] = eventsOf(event({ clockOutFrom: "17:30", time: "17:30–21:30" }));
    assert.deepEqual([e.date, e.clockOutFrom, e.clockInFrom, e.allDay, e.time], ["2026-09-04", 17.5, null, false, "17:30–21:30"]);
  });
  test("one bad entry is rejected while the others are kept", () => {
    const parsed = R.parseSpecialDays(file([event({ clockOutFrom: "17:30" }), event({ date: "2026-02-30", clockOutFrom: "15:00" })]));
    assert.equal(parsed.events.length, 1);
    assert.deepEqual(parsed.rejected.map((r) => r.index), [1]);
  });
  test("an event must say what it changes", () => {
    assert.match(R.parseSpecialDays(file([event({})])).rejected[0].reason, /clockOutFrom, clockInFrom or allDay/);
  });
  test("malformed times are rejected", () => {
    assert.equal(R.parseSpecialDays(file([event({ clockOutFrom: "5pm" })])).events.length, 0);
    assert.equal(R.parseSpecialDays(file([event({ clockOutFrom: "24:30" })])).events.length, 0);
  });
  test("names are trimmed to 60 characters", () => assert.equal(eventsOf(event({ name: "x".repeat(80), allDay: true }))[0].name.length, 60));
  test("a nameless event is rejected", () => assert.equal(eventsOf(event({ name: " ", allDay: true })).length, 0));
  test("invalid JSON, a version below 1 or an oversized file is ignored entirely", () => {
    assert.equal(R.parseSpecialDays("{nope"), null);
    assert.equal(R.parseSpecialDays(file([event({ allDay: true })], 0)), null);
    assert.equal(R.parseSpecialDays(file([event({ allDay: true })], "2")), null);
    assert.equal(R.parseSpecialDays(" ".repeat(600 * 1024)), null);
  });
  test("a file from a newer format version still loads every event this reader understands", () => {
    const future = JSON.stringify({
      version: 7, publishedBy: "hr", shifts: { night: {} },
      events: [event({ clockOutFrom: "17:30", onlyForTeams: ["qa"], color: "gold" }), event({ date: "2026-10-01", name: "Future rule", teleportAt: "15:00" })],
    });
    const parsed = R.parseSpecialDays(future);
    assert.deepEqual([parsed.events.length, parsed.events[0].clockOutFrom, parsed.rejected.length], [1, 17.5, 1]);
  });
  test("a file without a version is read as version 1", () => assert.equal(R.parseSpecialDays(JSON.stringify({ events: [event({ allDay: true })] })).events.length, 1));
  test("a year of events fits well within the size limit", () => {
    const year = Array.from({ length: 365 }, (_, i) => event({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), name: "Company event with a long descriptive name", time: "17:30–21:30", clockOutFrom: "17:30" }));
    assert.equal(R.parseSpecialDays(file(year)).events.length, 365);
  });
  test("a leading BOM is tolerated", () => assert.equal(R.parseSpecialDays(`﻿${file([event({ allDay: true })])}`).events.length, 1));
});

describe("event schedule", () => {
  const release = (t) => eventsOf(event({ clockOutFrom: t }));
  const cases = [
    ["clockOutFrom 17:30 on 10:00~19:00", LATE, release("17:30"), 7.5, 1.5],
    ["clockOutFrom 17:30 on 09:00~18:00", DAY, release("17:30"), 8.5, 0.5],
    ["clockOutFrom 17:30 on the night shift, meal inside the event", NIGHT, release("17:30"), 4.5, 4.5],
    ["a banquet at 18:00 does not touch a 09:00~18:00 shift", DAY, release("18:00"), 9, 0],
    ["clockOutFrom inside the meal break ends work at 11:45", DAY, release("12:00"), 2.75, 6.25],
    ["clockInFrom 11:00 on 09:00~18:00", DAY, eventsOf(event({ clockInFrom: "11:00" })), 7, 2],
  ];
  for (const [title, shift, events, span, eventCredit] of cases) {
    test(`${title}: span ${span}, event credit ${eventCredit}`, () => {
      const s = scheduleFor(shift, events);
      assert.deepEqual([s.span, s.eventCredit, s.ptoCredit], [span, eventCredit, 9 - span]);
    });
  }
  test("clockOutFrom before the shift starts credits the whole shift", () => {
    const s = scheduleFor(NIGHT, release("12:00"));
    assert.deepEqual([s.mode, s.span, s.ptoCredit], ["event-full", 0, 9]);
  });
  test("clockInFrom after the shift ends credits the whole shift", () => assert.equal(scheduleFor(DAY, eventsOf(event({ clockInFrom: "19:00" }))).mode, "event-full"));
  test("an all-day event credits the whole shift", () => assert.equal(scheduleFor(DAY, eventsOf(event({ allDay: true }))).span, 0));
  test("clockInFrom and clockOutFrom that meet cover the whole shift", () => {
    assert.equal(scheduleFor(DAY, eventsOf(event({ clockInFrom: "13:00", clockOutFrom: "13:00" }))).mode, "event-full");
  });
  test("two events on one date: the earliest release wins", () => {
    assert.equal(scheduleFor(LATE, eventsOf(event({ clockOutFrom: "18:00" }), event({ name: "Birthday", clockOutFrom: "15:00" }))).span, 5);
  });
  test("an event with a morning PTO window credits both without double counting", () => {
    const s = scheduleFor(LATE, release("17:30"), { ptoWindows: [{ start: 10, end: 12 }], ptoHrs: 2 });
    assert.deepEqual([s.earliestCheckin, s.earliestCheckout, s.span, s.ptoCredit], [13, 17.5, 4.5, 4.5]);
  });
  test("an event with legacy PTO hours subtracts the hours after the event cut", () => {
    const s = scheduleFor(LATE, release("17:30"), { ptoHrs: 2 });
    assert.deepEqual([s.span, s.earliestCheckout, s.eventCredit], [5.5, 15.5, 1.5]);
  });
  test("full PTO wins over an event and the event earns no credit", () => {
    const s = scheduleFor(DAY, release("15:00"), { ptoHrs: 8, isFullPTO: true });
    assert.deepEqual([s.mode, s.eventCredit], ["full", 0]);
  });
  test("no events leaves the schedule unchanged", () => assert.deepEqual([scheduleFor(DAY, []).span, scheduleFor(DAY, []).eventCredit], [9, 0]));
  test("working through the event window is measured so it is not credited twice", () => {
    const windows = R.eventWindowsFor(release("17:30"), LATE);
    assert.deepEqual([R.eventOverlapHrs(windows, 10, 19), R.eventOverlapHrs(windows, 10, 17.5), R.eventOverlapHrs(windows, 10, null)], [1.5, 0, 0]);
  });
  test("the release label is the earliest clockOutFrom", () => {
    assert.equal(R.eventReleaseLabel(eventsOf(event({ clockOutFrom: "18:00" }), event({ name: "B", clockOutFrom: "17:30" }))), "17:30");
    assert.equal(R.eventReleaseLabel(eventsOf(event({ allDay: true }))), "");
  });
});

describe("judgeEventDay", () => {
  const judge = (events, extra = {}) => {
    const schedule = scheduleFor(LATE, events, extra.scheduleExtra);
    return R.judgeEventDay({ events, shift: LATE, schedule, inHour: 10, outHour: null, ...extra });
  };
  const release = eventsOf(event({ clockOutFrom: "17:30" }));
  const lateStart = eventsOf(event({ clockInFrom: "11:00" }));

  test("an early-release day with an on-time clock-in and no clock-out passes", () => {
    assert.deepEqual([judge(release).isEventDay, judge(release).verdict], [true, "pass"]);
  });
  test("an early-release day clocked in more than 30 minutes after shift start is LATE", () => assert.equal(judge(release, { inHour: 10 + 31 / 60 }).verdict, "late-in"));
  test("an early-release day clocked in at 10:28 on a 10:00 shift is within the 30-minute grace", () => assert.equal(judge(release, { inHour: 10 + 28 / 60 }).verdict, "pass"));
  test("an early-release day clocked in exactly at start + 30 minutes still passes", () => assert.equal(judge(release, { inHour: 10.5 }).verdict, "pass"));
  test("leaving before the release on an event day is not EARLY", () => assert.equal(judge(release, { outHour: 15 }).verdict, "pass"));
  test("an early-release day with only a clock-out asks for the clock-in", () => assert.equal(judge(release, { inHour: null, outHour: 18 }).verdict, "missing-in"));
  test("a late-start day with no clock-in and an on-time clock-out passes", () => assert.equal(judge(lateStart, { inHour: null, outHour: 19 }).verdict, "pass"));
  test("a late-start day that leaves early is EARLY", () => assert.equal(judge(lateStart, { inHour: null, outHour: 18 }).verdict, "left-early"));
  test("a late-start day with only a clock-in asks for the clock-out", () => assert.equal(judge(lateStart, { inHour: 11, outHour: null }).verdict, "missing-out"));
  test("no punches at all on an event day is NO PUNCH", () => assert.equal(judge(release, { inHour: null }).verdict, "no-punches"));
  test("release and late start on one day need no punch check", () => {
    assert.equal(judge(eventsOf(event({ clockInFrom: "11:00", clockOutFrom: "17:30" })), { inHour: 12, outHour: null }).verdict, "pass");
  });
  test("a release at or after the shift end is not an event day", () => assert.equal(judge(eventsOf(event({ clockOutFrom: "19:00" }))).isEventDay, false));
  test("an all-day event stays a credited day, not an attendance check", () => assert.equal(judge(eventsOf(event({ allDay: true }))).isEventDay, false));
  test("after a morning PTO window the clock-in is judged against the end of the leave", () => {
    const j = judge(release, { inHour: 13, scheduleExtra: { ptoWindows: [{ start: 10, end: 12 }], ptoHrs: 2 } });
    assert.equal(j.verdict, "pass");
  });
  test("a failed event check becomes the day's shortfall after sync and fix checks", () => {
    const base = { isSynced: true, inHour: 10.5, outHour: null, schedule: scheduleFor(LATE, release), shift: LATE, events: release };
    assert.equal(R.explainShortfall({ ...base, eventVerdict: "late-in" }).badge, "LATE");
    assert.equal(R.explainShortfall({ ...base, eventVerdict: "late-in", corrections: [{ kind: "out", status: "pending" }] }).code, "fix-pending");
  });
});

describe("explainShortfall", () => {
  const base = { isSynced: true, inHour: 10, outHour: 17, schedule: R.computeDaySchedule({ shift: LATE }), shift: LATE, shortByHrs: 2 };
  const why = (extra) => R.explainShortfall({ ...base, ...extra });

  test("a day not synced yet asks for a sync before blaming the user", () => assert.equal(why({ isSynced: false, inHour: null, outHour: null }).code, "not-synced"));
  test("a pending forgot-punch request comes before any other reason", () => {
    assert.equal(why({ outHour: null, corrections: [{ kind: "out", status: "pending" }], pendingPTO: { type: "Annual", hours: 8 } }).code, "fix-pending");
  });
  test("a rejected correction on the missing side says so with the reviewer note", () => {
    const r = why({ outHour: null, corrections: [{ kind: "out", status: "rejected", note: "no proof" }] });
    assert.deepEqual([r.code, r.badge], ["fix-rejected", "FIX ❌"]);
    assert.match(r.detail, /no proof/);
  });
  test("a rejected correction on a side that has a punch is not the reason", () => {
    assert.equal(why({ corrections: [{ kind: "in", status: "rejected" }] }).code, "left-early");
  });
  test("leave awaiting approval explains the gap", () => assert.equal(why({ pendingPTO: { type: "Annual Leave", hours: 8 }, inHour: null, outHour: null }).code, "leave-pending"));
  test("only a clock-in means a forgotten clock-out", () => assert.deepEqual([why({ outHour: null }).code, why({ outHour: null }).badge], ["missing-out", "OUT?"]));
  test("only a clock-out means a forgotten clock-in", () => assert.equal(why({ inHour: null }).code, "missing-in"));
  test("no punches at all asks about punches or leave", () => assert.equal(why({ inHour: null, outHour: null }).code, "no-punches"));
  test("leaving 30 minutes or more before the earliest checkout is early", () => {
    assert.equal(why({ outHour: 18.5 }).code, "left-early");
    assert.notEqual(why({ outHour: 18.6, inHour: 10 }).code, "left-early");
  });
  test("leaving early on an event day names the event release", () => {
    const events = eventsOf(event({ clockOutFrom: "17:30" }));
    const r = why({ outHour: 16 + 10 / 60, events, schedule: scheduleFor(LATE, events) });
    assert.match(r.detail, /Left 16:10, 1h 20m before 17:30 \(event release 17:30\)/);
  });
  test("arriving late with an on-time clock-out is LATE", () => assert.equal(why({ inHour: 10.8, outHour: 19 }).code, "late-in"));
  test("arriving 20 minutes after shift start is inside the 30-minute grace, so a short day is plain short", () => assert.equal(why({ inHour: 10 + 20 / 60, outHour: 18.9 }).code, "short"));
  test("the LATE detail on an event day names the start + 30 minutes deadline", () => {
    const events = eventsOf(event({ clockOutFrom: "17:30" }));
    assert.match(why({ inHour: 10.75, outHour: null, events, schedule: scheduleFor(LATE, events), eventVerdict: "late-in" }).detail, /clock in by 10:30/);
  });
  test("anything else is plain short with no badge", () => assert.deepEqual([why({ inHour: 10.1, outHour: 18.9 }).code, why({ inHour: 10.1, outHour: 18.9 }).badge], ["short", ""]));
});

describe("ptoKindOf", () => {
  const icon = (name) => R.ptoKindOf(name).icon;
  test("each Deel type maps to its own icon", () => {
    assert.deepEqual(
      ["Annual Leave - Taiwan", "Sick Leave - Taiwan", "Personal Leave - Taiwan", "Family Care Leave - Taiwan", "Compensatory Leave - Taiwan", "Paid Birthday Leave - Taiwan"].map(icon),
      ["🏝️", "🤒", "👤", "👪", "⏱️", "🎂"],
    );
  });
  test("Chinese type names map too", () => assert.deepEqual(["特休", "病假", "事假", "補休"].map(icon), ["🏝️", "🤒", "👤", "⏱️"]));
  test("an unknown type falls back to the generic leave icon", () => assert.equal(icon("Volunteer Day"), "🌴"));
  test("merged same-day types show each icon once", () => {
    assert.equal(R.ptoIconsOf("Annual Leave - Taiwan + Sick Leave - Taiwan + Annual Leave - Taiwan"), "🏝️🤒");
  });
});

describe("punctualityFlags", () => {
  const plain = R.computeDaySchedule({ shift: LATE });
  const flags = (extra) => R.punctualityFlags({ schedule: plain, inHour: 10, outHour: 19, ...extra });
  const badges = (f) => [f.late?.badge ?? null, f.early?.badge ?? null];
  test("a normal day clocked in at 10:31 is LATE even with full hours", () => assert.deepEqual(badges(flags({ inHour: 10 + 31 / 60, outHour: 20 })), ["LATE", null]));
  test("clocking in exactly at start + 30 minutes is not LATE", () => assert.deepEqual(badges(flags({ inHour: 10.5 })), [null, null]));
  test("leaving exactly 30 minutes before shift end is EARLY", () => assert.deepEqual(badges(flags({ outHour: 18.5 })), [null, "EARLY"]));
  test("leaving 29 minutes before shift end is inside the 30-minute grace", () => assert.deepEqual(badges(flags({ outHour: 18 + 31 / 60 })), [null, null]));
  test("leaving 16 minutes before shift end is not EARLY", () => assert.deepEqual(badges(flags({ outHour: 18 + 44 / 60 })), [null, null]));
  test("a day can be both LATE and EARLY", () => assert.deepEqual(badges(flags({ inHour: 11, outHour: 18 })), ["LATE", "EARLY"]));
  test("morning leave 10-12 moves the LATE deadline to 13:30", () => {
    const schedule = R.computeDaySchedule({ shift: LATE, ptoWindows: [{ start: 10, end: 12 }], ptoHrs: 2 });
    assert.deepEqual([badges(R.punctualityFlags({ schedule, inHour: 13 + 20 / 60, outHour: 19 }))[0], badges(R.punctualityFlags({ schedule, inHour: 13 + 31 / 60, outHour: 19 }))[0]], [null, "LATE"]);
  });
  test("an early-release event day can only be LATE", () => assert.deepEqual(badges(flags({ inHour: 11, outHour: 15, eventChecks: "in" })), ["LATE", null]));
  test("a late-start event day can only be EARLY", () => assert.deepEqual(badges(flags({ inHour: 11, outHour: 15, eventChecks: "out" })), [null, "EARLY"]));
  test("an event day that checks nothing has no flags", () => assert.deepEqual(badges(flags({ inHour: 11, outHour: 15, eventChecks: "none" })), [null, null]));
  test("today is never EARLY while the shift is still running", () => assert.deepEqual(badges(flags({ inHour: 11, outHour: 15, isToday: true })), ["LATE", null]));
  test("a full leave day has no flags", () => assert.deepEqual(badges(R.punctualityFlags({ schedule: R.computeDaySchedule({ shift: LATE, isFullPTO: true }), inHour: 11, outHour: 15 })), [null, null]));
  test("the LATE detail names the on-time deadline", () => assert.match(flags({ inHour: 10.75 }).late.detail, /on time until 10:30/));
});

describe("uncountedPunchHrs", () => {
  const morningLeave = R.computeDaySchedule({ shift: LATE, ptoWindows: [{ start: 10, end: 11.75 }], ptoHrs: 1.75 });
  const afternoonLeave = R.computeDaySchedule({ shift: LATE, ptoWindows: [{ start: 13, end: 19 }], ptoHrs: 6 });
  const uncounted = (schedule, inHour, outHour) => R.uncountedPunchHrs({ schedule, shift: LATE, inHour, outHour });
  test("leave until lunch starts work at 13:00", () => assert.equal(morningLeave.earliestCheckin, 13));
  test("clocking in at 12:00 during lunch after morning leave counts nothing before 13:00", () => assert.equal(uncounted(morningLeave, 12, 19), 1));
  test("clocking in at 12:00 after morning leave is not LATE", () => assert.equal(R.punctualityFlags({ schedule: morningLeave, inHour: 12, outHour: 19 }).late, null));
  test("clocking in at 13:20 after morning leave counts everything and is not LATE", () => {
    assert.deepEqual([uncounted(morningLeave, 13 + 20 / 60, 19), R.punctualityFlags({ schedule: morningLeave, inHour: 13 + 20 / 60, outHour: 19 }).late], [0, null]);
  });
  test("clocking in at 13:31 after morning leave is LATE", () => assert.equal(R.punctualityFlags({ schedule: morningLeave, inHour: 13 + 31 / 60, outHour: 19 }).late.badge, "LATE"));
  test("staying past shift end on a morning-leave day still counts", () => assert.equal(uncounted(morningLeave, 13, 20), 0));
  test("clocking out at 12:30 before afternoon leave counts nothing after 11:45", () => assert.equal(uncounted(afternoonLeave, 10, 12.5), 0.75));
  test("clocking out at 11:00 before afternoon leave is EARLY", () => assert.equal(R.punctualityFlags({ schedule: afternoonLeave, inHour: 10, outHour: 11 }).early.badge, "EARLY"));
  test("arriving early on a normal day still counts", () => assert.equal(uncounted(R.computeDaySchedule({ shift: LATE }), 9.5, 19), 0));
  test("a lunch in the middle of the work window keeps counting", () => {
    assert.equal(uncounted(R.computeDaySchedule({ shift: LATE, ptoWindows: [{ start: 17, end: 19 }], ptoHrs: 2 }), 10, 17), 0);
  });
});
