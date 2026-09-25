import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@work-rules:start"), source.indexOf("// @@work-rules:end"));
const R = new Function(`${block}\nreturn IkgWorkRules;`)();

const DATE = "2026-09-23";
const rec = (type, time) => ({ type, time });
const req = (type, time, reviewStatus = "Approved", date = DATE, reviewNote = "") => ({
  date, type, time, reviewStatus, reviewNote, witnessStatus: "N/A", id: `MC-${type}-${time}`,
});
const at = (hhmm) => {
  const [h, m, s = 0] = hhmm.split(":").map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
};
const withMs = (punches) => punches.map((p) => ({ ...p, atMs: at(p.time) }));
const classify = (records, requests = []) => R.classifyGasPunches(records, requests, DATE).punches;
const resolve = (office, records, requests = []) =>
  R.resolvePunches({ officeIn: office.in ? at(office.in) : null, officeOut: office.out ? at(office.out) : null }, withMs(classify(records, requests)));
const src = (r, side) => r.punchSources[side]?.source ?? null;

describe("normalize GAS fields", () => {
  test("times gain seconds and accept am/pm", () => {
    assert.equal(R.normalizeGasTime("19:36"), "19:36:00");
    assert.equal(R.normalizeGasTime("7:36 PM"), "19:36:00");
    assert.equal(R.normalizeGasTime("12:05 am"), "00:05:00");
    assert.equal(R.normalizeGasTime("25:00"), null);
  });
  test("dates accept slashes and single digits", () => {
    assert.equal(R.normalizeGasDate("2026/9/3"), "2026-09-03");
    assert.equal(R.normalizeGasDate("2026-09-23"), "2026-09-23");
    assert.equal(R.normalizeGasDate("garbage"), null);
  });
  test("types are case-insensitive and unknown types are null", () => {
    assert.equal(R.normalizeGasType("clock OUT"), "out");
    assert.equal(R.normalizeGasType("Clock In"), "in");
    assert.equal(R.normalizeGasType("Clock In & Out"), null);
  });
  test("review status buckets into approved, pending or rejected", () => {
    assert.equal(R.normalizeReviewStatus("Approved"), "approved");
    assert.equal(R.normalizeReviewStatus("Rejected"), "rejected");
    assert.equal(R.normalizeReviewStatus("Pending"), "pending");
    assert.equal(R.normalizeReviewStatus(""), "pending");
  });
});

describe("classifyGasPunches", () => {
  test("a record matching an approved request is a correction", () => {
    const [p] = classify([rec("Clock Out", "19:36:00")], [req("Clock Out", "19:36:00")]);
    assert.deepEqual([p.kind, p.source, p.status], ["out", "correction", "approved"]);
  });
  test("a record without a request is WFH", () => assert.equal(classify([rec("Clock In", "10:00:00")])[0].source, "wfh"));
  test("record 19:36 matches request 19:36:00 after normalization", () =>
    assert.equal(classify([rec("Clock Out", "19:36")], [req("Clock Out", "19:36:00")])[0].source, "correction"));
  test("a reviewer-edited time still matches by date and type", () =>
    assert.equal(classify([rec("Clock Out", "19:40:00")], [req("Clock Out", "19:36:00")])[0].source, "correction"));
  test("identical duplicate records collapse into one punch", () =>
    assert.equal(classify([rec("Clock Out", "19:36:00"), rec("Clock Out", "19:36:00")], [req("Clock Out", "19:36:00")]).length, 1));
  test("one request is consumed once, so the exact-time punch wins it", () => {
    const punches = classify([rec("Clock Out", "18:00:00"), rec("Clock Out", "19:00:00")], [req("Clock Out", "19:00:00")]);
    assert.deepEqual(punches.map((p) => [p.time, p.source]), [["18:00:00", "wfh"], ["19:00:00", "correction"]]);
  });
  test("a request for another date never matches", () =>
    assert.equal(classify([rec("Clock Out", "19:36:00")], [req("Clock Out", "19:36:00", "Approved", "2026-09-21")])[0].source, "wfh"));
  test("a request with an unknown type is reported and not matched", () => {
    const out = R.classifyGasPunches([rec("Clock Out", "19:36:00")], [req("Clock In & Out", "19:36:00")], DATE);
    assert.equal(out.punches[0].source, "wfh");
    assert.equal(out.unknownRequests.length, 1);
  });
  test("records with unknown types or times are skipped", () => assert.equal(classify([rec("Break", "12:00:00"), rec("Clock In", "")]).length, 0));
  test("the review note is carried onto the correction", () =>
    assert.equal(classify([rec("Clock Out", "19:36:00")], [req("Clock Out", "19:36:00", "Approved", DATE, "ok")])[0].note, "ok"));
});

describe("resolvePunches", () => {
  test("office IN plus corrected OUT is an office day with the OUT marked corrected", () => {
    const r = resolve({ in: "10:27:47" }, [rec("Clock Out", "19:36:00")], [req("Clock Out", "19:36:00")]);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH, r.corrections.length], ["office", "correction", false, 1]);
    assert.equal(r.endMs, at("19:36:00"));
  });
  test("GAS punches without requests make a WFH day", () => {
    const r = resolve({}, [rec("Clock In", "10:00:00"), rec("Clock Out", "19:00:00")]);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH], ["wfh", "wfh", true]);
  });
  test("forgetting both IN and OUT is an office day, not WFH", () => {
    const r = resolve({}, [rec("Clock In", "09:58:00"), rec("Clock Out", "19:02:00")], [req("Clock In", "09:58:00"), req("Clock Out", "19:02:00")]);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH, r.corrections.length], ["correction", "correction", false, 2]);
  });
  test("WFH IN plus corrected OUT is WFH with a correction", () => {
    const r = resolve({}, [rec("Clock In", "10:00:00"), rec("Clock Out", "19:30:00")], [req("Clock Out", "19:30:00")]);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH], ["wfh", "correction", true]);
  });
  test("corrected IN plus WFH OUT is WFH with a correction", () => {
    const r = resolve({}, [rec("Clock In", "10:00:00"), rec("Clock Out", "19:30:00")], [req("Clock In", "10:00:00")]);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH], ["correction", "wfh", true]);
  });
  test("office wins a tie with an equal-time correction but the correction is still listed", () => {
    const r = resolve({ in: "10:00:00", out: "19:00:00" }, [rec("Clock In", "10:00:00")], [req("Clock In", "10:00:00")]);
    assert.deepEqual([src(r, "in"), r.corrections.length, r.isWFH], ["office", 1, false]);
  });
  test("an earlier corrected IN beats a later office IN", () => {
    const r = resolve({ in: "13:00:00" }, [rec("Clock In", "10:00:00")], [req("Clock In", "10:00:00")]);
    assert.deepEqual([src(r, "in"), r.startMs], ["correction", at("10:00:00")]);
  });
  test("a pending correction still counts and keeps its status", () => {
    const r = resolve({ in: "10:00:00" }, [rec("Clock Out", "19:00:00")], [req("Clock Out", "19:00:00", "Pending")]);
    assert.deepEqual([src(r, "out"), r.punchSources.out.status, r.endMs], ["correction", "pending", at("19:00:00")]);
  });
  test("a rejected correction is dropped from the hours but listed", () => {
    const r = resolve({ in: "10:00:00" }, [rec("Clock Out", "19:00:00")], [req("Clock Out", "19:00:00", "Rejected")]);
    assert.deepEqual([r.endMs, r.punchSources.out, r.corrections[0].status], [null, null, "rejected"]);
  });
  test("a correction deleted from GAS disappears on the next resolve", () => {
    const r = resolve({ in: "10:00:00" }, []);
    assert.deepEqual([r.endMs, r.corrections.length], [null, 0]);
  });
  test("requests without GAS records produce nothing", () => {
    const r = resolve({}, [], [req("Clock Out", "19:00:00")]);
    assert.deepEqual([r.startMs, r.endMs, r.isWFH], [null, null, false]);
  });
  test("an office-only day has office sources and no GAS fields", () => {
    const r = resolve({ in: "09:00:00", out: "18:00:00" }, []);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH, r.corrections.length], ["office", "office", false, 0]);
  });
  test("a later WFH OUT does not hide an office IN", () => {
    const r = resolve({ in: "10:00:00" }, [rec("Clock Out", "19:00:00")]);
    assert.deepEqual([src(r, "in"), src(r, "out"), r.isWFH], ["office", "wfh", true]);
  });
});

describe("parseGasEnvelope", () => {
  test("parses the getRecordsByDate envelope", () => {
    const raw = `)]}'\n[["op.exec",[0,"[{\\"type\\":\\"Clock Out\\",\\"time\\":\\"19:36:00\\"}]"]],["di",2052]]`;
    assert.deepEqual(R.parseGasEnvelope(raw), [{ type: "Clock Out", time: "19:36:00" }]);
  });
  test("parses the getMyRequests envelope with a spaced prefix", () => {
    const raw = `)]} '\n[["op.exec",[0,"[{\\"date\\":\\"2026-09-23\\",\\"reviewStatus\\":\\"Approved\\",\\"time\\":\\"19:36:00\\",\\"type\\":\\"Clock Out\\"}]"]],["di",1501]]`;
    assert.equal(R.parseGasEnvelope(raw)[0].reviewStatus, "Approved");
  });
  test("an error envelope yields null", () => assert.equal(R.parseGasEnvelope(`)]}'\n[["er",null,null,null,null,401],["di",301]]`), null));
});
