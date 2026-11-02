import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./IKG-attendance.user.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// @@work-rules:start"), source.indexOf("// @@work-rules:end"));
const R = new Function(`${block}\nreturn IkgWorkRules;`)();

const mockSummaryOct28 = {
  id: "b797a3f5-e4a9-43c1-ba69-4474040a50bf",
  domain: "TIME_TRACKING",
  status: "APPROVED",
  detailsSummary: "Oct 28th, 2026 ·2 hrs 30 mins",
  details: {
    day: "2026-10-28T00:00:00.000Z",
    shiftType: "OVERTIME",
    start: "2026-10-28T00:00:00.000Z",
    totalWorkedHours: 2.5,
    previousShiftData: {
      totalHours: "2.5",
      totalWorkedHours: "2.5",
      description: "Updated PR based on team reviews and spent time doing integration testing",
      contractId: "mgdzvxk",
      approvalRequestId: "b797a3f5-e4a9-43c1-ba69-4474040a50bf",
    },
  },
  requestedAt: "2026-10-30T09:26:32.040Z",
  updatedAt: "2026-11-02T06:06:52.621Z",
};

const mockDetailOct28 = {
  id: "b797a3f5-e4a9-43c1-ba69-4474040a50bf",
  status: "APPROVED",
  requestApprovers: [
    {
      ordinal: 1,
      numberOfRequiredApprovers: 1,
      numberOfApproved: 1,
      approvers: [{ fullName: "Maggie Lu", roleName: "Direct Manager", status: "APPROVED" }],
    },
    {
      ordinal: 2,
      numberOfRequiredApprovers: 1,
      numberOfApproved: 1,
      approvers: [{ fullName: "Chin Yuan Chen", roleName: "Organization Admin", status: "APPROVED" }],
    },
  ],
};

const mockSummaryMay31 = {
  id: "7d6e7530-e1d4-408d-a35a-055f4afed890",
  domain: "TIME_TRACKING",
  status: "APPROVED",
  detailsSummary: "May 31st, 2026 ·4 hrs ",
  details: {
    day: "2026-05-31T00:00:00.000Z",
    shiftType: "OVERTIME",
    totalWorkedHours: 4,
    previousShiftData: {
      description: "Update math config",
      contractId: "mgdzvxk",
    },
  },
  requestedAt: "2026-05-31T10:13:58.281Z",
  updatedAt: "2026-06-01T03:56:55.011Z",
};

const mockPendingSummary = {
  id: "pending-123",
  domain: "TIME_TRACKING",
  status: "PENDING",
  detailsSummary: "Nov 3rd, 2026 ·3 hrs",
  details: {
    day: "2026-11-03T00:00:00.000Z",
    shiftType: "OVERTIME",
    totalWorkedHours: 3,
    previousShiftData: {
      description: "Urgent prod bugfix",
      contractId: "mgdzvxk",
    },
  },
  requestedAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
};

const mockPendingDetail = {
  id: "pending-123",
  status: "PARTIALLY_APPROVED",
  requestApprovers: [
    {
      ordinal: 1,
      numberOfRequiredApprovers: 1,
      numberOfApproved: 1,
      approvers: [{ fullName: "Maggie Lu", roleName: "Direct Manager", status: "APPROVED" }],
    },
    {
      ordinal: 2,
      numberOfRequiredApprovers: 1,
      numberOfApproved: 0,
      approvers: [{ fullName: "Chin Yuan Chen", roleName: "Organization Admin", status: "PENDING" }],
    },
  ],
};

describe("IkgWorkRules Overtime normalization & grouping", () => {
  test("toOvertimeItem normalizes approved Deel request", () => {
    const item = R.toOvertimeItem(mockSummaryOct28, mockDetailOct28, "2026-11-02");
    assert.equal(item.id, "b797a3f5-e4a9-43c1-ba69-4474040a50bf");
    assert.equal(item.date, "2026-10-28");
    assert.equal(item.hours, 2.5);
    assert.equal(item.status, "approved");
    assert.equal(item.bucket, "approved");
    assert.equal(item.year, 2026);
    assert.match(item.description, /Updated PR/);
    assert.equal(item.stageSummary, "Approved (Maggie Lu, Chin Yuan Chen)");
  });

  test("toOvertimeItem formats partially approved / pending stepper", () => {
    const item = R.toOvertimeItem(mockPendingSummary, mockPendingDetail, "2026-11-02");
    assert.equal(item.status, "partially_approved");
    assert.equal(item.bucket, "pending");
    assert.equal(item.stageSummary, "1/2 Approved (Maggie Lu) · Waiting for Chin Yuan Chen");
  });

  test("toOvertimeItem detects ongoing shift for today", () => {
    const todaySummary = {
      ...mockSummaryOct28,
      id: "today-1",
      details: { ...mockSummaryOct28.details, day: "2026-11-02" },
    };
    const item = R.toOvertimeItem(todaySummary, mockDetailOct28, "2026-11-02");
    assert.equal(item.bucket, "ongoing");
  });

  test("groupOvertimeRequests categorizes and calculates summaries", () => {
    const item1 = R.toOvertimeItem(mockSummaryOct28, mockDetailOct28, "2026-11-02");
    const item2 = R.toOvertimeItem(mockSummaryMay31, null, "2026-11-02");
    const item3 = R.toOvertimeItem(mockPendingSummary, mockPendingDetail, "2026-11-02");

    const groups = R.groupOvertimeRequests([item1, item2, item3], "2026-11-02");
    assert.equal(groups.approved.length, 2);
    assert.equal(groups.pending.length, 1);
    assert.equal(groups.ongoing.length, 0);
    assert.equal(groups.totalApprovedHrs, 6.5);
    assert.equal(groups.totalPendingHrs, 3);
    assert.equal(groups.pendingCount, 1);
    assert.equal(groups.approved[0].date, "2026-10-28");
    assert.equal(groups.approved[1].date, "2026-05-31");
  });

  test("handles empty lists and missing fields gracefully", () => {
    const groups = R.groupOvertimeRequests([], "2026-11-02");
    assert.equal(groups.approved.length, 0);
    assert.equal(groups.totalApprovedHrs, 0);
    assert.equal(groups.totalPendingHrs, 0);

    const item = R.toOvertimeItem({ id: "bare-1" }, null, "2026-11-02");
    assert.equal(item.id, "bare-1");
    assert.equal(item.hours, 0);
    assert.equal(item.status, "pending");
  });

  test("formats multi-stage approver progress correctly", () => {
    const multiDetail = {
      id: "multi-1",
      status: "PARTIALLY_APPROVED",
      requestApprovers: [
        {
          ordinal: 1,
          numberOfRequiredApprovers: 1,
          approvers: [{ fullName: "Manager Alice", status: "APPROVED" }],
        },
        {
          ordinal: 2,
          numberOfRequiredApprovers: 1,
          approvers: [{ fullName: "VP Bob", status: "PENDING" }],
        },
      ],
    };
    const item = R.toOvertimeItem({ id: "multi-1", details: { day: "2026-11-01" } }, multiDetail, "2026-11-02");
    assert.equal(item.stageSummary, "1/2 Approved (Manager Alice) · Waiting for VP Bob");
  });
});
