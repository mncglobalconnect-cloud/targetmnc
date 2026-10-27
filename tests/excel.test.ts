import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWorkbook } from "../src/lib/excel";
import type { PerformanceResult, SerializedMetrics } from "../src/lib/performance";
import { eachDate } from "../src/lib/dates";
import { periodRange, type ReportPeriod } from "../src/lib/report-periods";

const metrics: SerializedMetrics = {
  target: "100.30", achieved: "30.10", balance: "70.20", pct: 30.01,
  leadTarget: 5, leads: 1, leadBalance: 4, leadPct: 20,
};

for (const period of ["daily", "weekly", "monthly", "yearly"] satisfies Exclude<ReportPeriod, "custom">[]) {
  test(`${period} Excel has the expected sheets, totals, literal text and formatting`, async () => {
    const [from, to] = periodRange(period, "2024-02-29");
    const perf: PerformanceResult = {
      from, to, today: "2024-02-29", totals: metrics,
      rows: [{
        ...metrics, date: "2024-02-29", employeeId: "employee-1", employeeName: "=1+1",
        employeeCode: "TEST1", teamId: "team-1", teamName: "Test team", departmentName: "Sales",
        hasAllocation: true, nonQualifying: "5.20", status: "PARTIAL", submissionStatus: null,
        remarks: null, managerRemarks: null,
      }],
      byEmployee: [],
      byTeam: [{
        ...metrics, teamId: "team-1", teamName: "Test team", memberTarget: metrics.target,
        memberLeadTarget: metrics.leadTarget, goalTarget: metrics.target, goalLeadTarget: metrics.leadTarget,
        goalPct: metrics.pct, goalLeadPct: metrics.leadPct, goalBalance: metrics.balance,
        goalLeadBalance: metrics.leadBalance, modes: ["ALLOCATED"], memberCount: 1, locked: false,
      }],
      byDate: eachDate(from, to).map((date) => ({ ...metrics, date, working: true })),
      statusCounts: { PARTIAL: 1 }, missingTargets: [],
    };
    const buffer = await buildWorkbook({
      title: `${period} report`, scopeLabel: "Company", perf, generatedBy: "Test admin",
      achievements: { columns: ["ID", "Date", "Amount", "Description"], rows: [["a1", "2024-02-29", 30.1, "=HYPERLINK(\"https://example.invalid\")"]] },
      leads: { columns: ["ID", "Lead Date", "Company", "Estimated Value"], rows: [["l1", "2024-02-29", "+cmd", 12]] },
    });
    assert.equal(buffer.subarray(0, 2).toString(), "PK");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(buffer).buffer);
    assert.deepEqual(wb.worksheets.map((sheet) => sheet.name), [
      "Executive Summary", "Employee Performance", "Team Performance",
      ...(period === "daily" ? [] : ["Daily Trend"]), "Achievement Details", "Lead Details",
    ]);
    assert.equal(wb.getWorksheet("Executive Summary")!.getCell("B5").value, 100.3);
    assert.equal(wb.getWorksheet("Executive Summary")!.getCell("B7").result, 70.2);
    const emp = wb.getWorksheet("Employee Performance")!;
    assert.equal(emp.getCell("C2").value, "=1+1");
    assert.equal(emp.getCell("H2").formula, "MAX(F2-G2,0)");
    assert.equal(emp.getCell("H2").result, 70.2);
    assert.equal(emp.getCell("F3").formula, "SUBTOTAL(9,F2:F2)");
    assert.equal(emp.getCell("F3").result, 100.3);
    assert.equal(emp.getCell("I2").numFmt, "0.00%");
    assert.equal(emp.getCell("A2").numFmt, "dd-mmm-yyyy");
    assert.equal(emp.views[0].state, "frozen");
    assert.equal(emp.getRow(1).font.bold, true);
    assert.equal(wb.getWorksheet("Achievement Details")!.getCell("D2").type, ExcelJS.ValueType.String);
    assert.equal(wb.getWorksheet("Lead Details")!.getCell("C2").value, "+cmd");
    if (period !== "daily") {
      const trend = wb.getWorksheet("Daily Trend")!;
      assert.equal(trend.rowCount, eachDate(from, to).length + 1);
      if (period === "yearly") assert.equal(trend.rowCount, 367);
    }
  });
}
