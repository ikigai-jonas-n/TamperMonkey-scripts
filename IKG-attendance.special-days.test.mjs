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
  test("leaving 15 minutes or more before the earliest checkout is early", () => {
    assert.equal(why({ outHour: 18.75 }).code, "left-early");
    assert.notEqual(why({ outHour: 18.8, inHour: 10 }).code, "left-early");
  });
  test("leaving early on an event day names the event release", () => {
    const events = eventsOf(event({ clockOutFrom: "17:30" }));
    const r = why({ outHour: 16 + 10 / 60, events, schedule: scheduleFor(LATE, events) });
    assert.match(r.detail, /Left 16:10, 1h 20m before 17:30 \(event release 17:30\)/);
  });
  test("arriving late with an on-time clock-out is LATE", () => assert.equal(why({ inHour: 10.8, outHour: 19 }).code, "late-in"));
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
