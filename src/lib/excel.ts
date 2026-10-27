import ExcelJS from "exceljs";
import type { PerformanceResult } from "./performance";
import type { Dataset } from "./datasets";

// Indian digit grouping (1,00,000) via conditional number sections.
const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';
const PCT = "0.00%";
const BRAND = "FF1D53F0";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF5FF" } };

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Number(v));

function styleHeader(ws: ExcelJS.Worksheet, row = 1) {
  const r = ws.getRow(row);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = HEADER_FILL;
  r.alignment = { vertical: "middle", wrapText: true };
  r.height = 28;
}

function finish(ws: ExcelJS.Worksheet, headerRow: number, lastRow: number, cols: number) {
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  if (lastRow > headerRow) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastRow, column: cols } };
}

/** Green ≥100%, amber 70–99.99%, red <70% on a percentage column range. */
function pctFormatting(ws: ExcelJS.Worksheet, ref: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [
      { type: "cellIs", operator: "greaterThan", formulae: ["0.99999"], priority: 1, style: { font: { color: { argb: "FF15803D" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDCFCE7" } } } },
      { type: "cellIs", operator: "between", formulae: ["0.7", "0.999989"], priority: 2, style: { font: { color: { argb: "FFB45309" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } } },
      { type: "cellIs", operator: "lessThan", formulae: ["0.7"], priority: 3, style: { font: { color: { argb: "FFB91C1C" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
    ],
  });
}

const col = (i: number) => {
  let s = "";
  for (let n = i; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export interface WorkbookInput {
  title: string;
  scopeLabel: string;
  perf: PerformanceResult;
  achievements: Dataset;
  leads: Dataset;
  generatedBy: string;
}

export async function buildWorkbook(input: WorkbookInput): Promise<Buffer> {
  const { perf } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MNC Groups — Target & Lead Management";
  wb.created = new Date();

  // ---------- Executive summary ----------
  const sum = wb.addWorksheet("Executive Summary", { properties: { tabColor: { argb: BRAND } } });
  sum.columns = [{ width: 34 }, { width: 22 }, { width: 4 }, { width: 26 }, { width: 14 }];
  sum.mergeCells("A1:E1");
  sum.getCell("A1").value = input.title;
  sum.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF0F1D3A" } };
  sum.getCell("A2").value = `Period: ${perf.from} to ${perf.to}   •   Scope: ${input.scopeLabel}`;
  sum.getCell("A3").value = `Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by ${input.generatedBy}`;
  sum.getCell("A3").font = { italic: true, color: { argb: "FF64748B" } };

  const t = perf.totals;
  const kpis: [string, ExcelJS.CellValue, string?][] = [
    ["Total Assigned Target", num(t.target), INR],
    ["Total Target Achieved", num(t.achieved), INR],
    ["Remaining Target", { formula: "MAX(B5-B6,0)", result: num(t.balance) }, INR],
    ["Target Achievement %", { formula: 'IF(B5=0,"",B6/B5)', result: t.pct === null ? "" : t.pct / 100 }, PCT],
    ["Total Lead Target", t.leadTarget],
    ["Total Leads Generated", t.leads],
    ["Remaining Leads", { formula: "MAX(B9-B10,0)", result: t.leadBalance }],
    ["Lead Achievement %", { formula: 'IF(B9=0,"",B10/B9)', result: t.leadPct === null ? "" : t.leadPct / 100 }, PCT],
  ];
  sum.getCell("A4").value = "Metric";
  sum.getCell("B4").value = "Value";
  styleHeader(sum, 4);
  kpis.forEach(([label, value, fmt], i) => {
    const r = sum.getRow(5 + i);
    r.getCell(1).value = label;
    r.getCell(2).value = value;
    if (fmt) r.getCell(2).numFmt = fmt;
    r.getCell(1).font = { bold: true };
  });
  pctFormatting(sum, "B8");
  pctFormatting(sum, "B12");

  sum.getCell("D4").value = "Status";
  sum.getCell("E4").value = "Count";
  ["D4", "E4"].forEach((c) => {
    sum.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sum.getCell(c).fill = HEADER_FILL;
  });
  Object.entries(perf.statusCounts).forEach(([s, c], i) => {
    sum.getCell(`D${5 + i}`).value = s.replace(/_/g, " ");
    sum.getCell(`E${5 + i}`).value = c;
  });
  sum.getCell("A14").value = "Validated stored totals (for reconciliation)";
  sum.getCell("A14").font = { bold: true };
  sum.getCell("A15").value = "Achieved (DB)";
  sum.getCell("B15").value = num(t.achieved);
  sum.getCell("B15").numFmt = INR;
  sum.getCell("A16").value = "Leads (DB)";
  sum.getCell("B16").value = t.leads;
  sum.getCell("A17").value = "Company totals are the sum of individual allocations; team-level goals are never added on top.";
  sum.getCell("A17").font = { italic: true, color: { argb: "FF64748B" } };

  // ---------- Employee performance ----------
  const emp = wb.addWorksheet("Employee Performance");
  const eh = ["Date", "Code", "Employee", "Team", "Department", "Assigned Target", "Achieved", "Remaining Target", "Achievement %", "Lead Target", "Leads Added", "Remaining Leads", "Lead %", "Status", "Submission", "Non-qualifying (pipeline)"];
  emp.addRow(eh);
  styleHeader(emp);
  emp.columns = [12, 10, 24, 18, 16, 16, 16, 16, 12, 10, 10, 12, 10, 14, 12, 18].map((w) => ({ width: w }));
  const rows = [...perf.rows].sort((a, b) => (a.date === b.date ? a.employeeName.localeCompare(b.employeeName) : a.date < b.date ? -1 : 1));
  rows.forEach((r, i) => {
    const n = i + 2;
    emp.addRow([
      new Date(`${r.date}T00:00:00Z`), r.employeeCode, r.employeeName, r.teamName ?? "—", r.departmentName ?? "—",
      num(r.target), num(r.achieved),
      { formula: `MAX(F${n}-G${n},0)`, result: num(r.balance) },
      { formula: `IF(F${n}=0,"",G${n}/F${n})`, result: r.pct === null ? "" : r.pct / 100 },
      r.leadTarget, r.leads,
      { formula: `MAX(J${n}-K${n},0)`, result: r.leadBalance },
      { formula: `IF(J${n}=0,"",K${n}/J${n})`, result: r.leadPct === null ? "" : r.leadPct / 100 },
      r.status.replace(/_/g, " "), r.submissionStatus ?? "—", num(r.nonQualifying),
    ]);
  });
  const last = rows.length + 1;
  if (rows.length) {
    const tr = emp.addRow([
      "TOTAL", "", "", "", "",
      { formula: `SUBTOTAL(9,F2:F${last})`, result: num(t.target) },
      { formula: `SUBTOTAL(9,G2:G${last})`, result: num(t.achieved) },
      { formula: `MAX(F${last + 1}-G${last + 1},0)`, result: num(t.balance) },
      { formula: `IF(F${last + 1}=0,"",G${last + 1}/F${last + 1})`, result: t.pct === null ? "" : t.pct / 100 },
      { formula: `SUBTOTAL(9,J2:J${last})`, result: t.leadTarget },
      { formula: `SUBTOTAL(9,K2:K${last})`, result: t.leads },
      { formula: `MAX(J${last + 1}-K${last + 1},0)`, result: t.leadBalance },
      { formula: `IF(J${last + 1}=0,"",K${last + 1}/J${last + 1})`, result: t.leadPct === null ? "" : t.leadPct / 100 },
    ]);
    tr.font = { bold: true };
    tr.fill = TOTAL_FILL;
  }
  emp.getColumn(1).numFmt = "dd-mmm-yyyy";
  [6, 7, 8, 16].forEach((c) => (emp.getColumn(c).numFmt = INR));
  [9, 13].forEach((c) => (emp.getColumn(c).numFmt = PCT));
  if (rows.length) {
    pctFormatting(emp, `I2:I${last + 1}`);
    pctFormatting(emp, `M2:M${last + 1}`);
  }
  finish(emp, 1, last, eh.length);

  // ---------- Team performance ----------
  const team = wb.addWorksheet("Team Performance");
  const th = ["Team", "Mode", "Team Target (Goal)", "Allocated to Members", "Achieved", "Remaining vs Goal", "Achievement %", "Team Lead Target", "Leads Generated", "Remaining Leads", "Lead %", "Members"];
  team.addRow(th);
  styleHeader(team);
  team.columns = [22, 16, 18, 18, 16, 16, 12, 12, 12, 12, 10, 10].map((w) => ({ width: w }));
  perf.byTeam.forEach((x, i) => {
    const n = i + 2;
    team.addRow([
      x.teamName, x.modes.join(", ") || "Sum of members", num(x.goalTarget), num(x.memberTarget), num(x.achieved),
      { formula: `MAX(C${n}-E${n},0)`, result: num(x.goalBalance) },
      { formula: `IF(C${n}=0,"",E${n}/C${n})`, result: x.goalPct === null ? "" : x.goalPct / 100 },
      x.goalLeadTarget, x.leads,
      { formula: `MAX(H${n}-I${n},0)`, result: x.goalLeadBalance },
      { formula: `IF(H${n}=0,"",I${n}/H${n})`, result: x.goalLeadPct === null ? "" : x.goalLeadPct / 100 },
      x.memberCount,
    ]);
  });
  [3, 4, 5, 6].forEach((c) => (team.getColumn(c).numFmt = INR));
  [7, 11].forEach((c) => (team.getColumn(c).numFmt = PCT));
  if (perf.byTeam.length) {
    pctFormatting(team, `G2:G${perf.byTeam.length + 1}`);
    pctFormatting(team, `K2:K${perf.byTeam.length + 1}`);
  }
  finish(team, 1, perf.byTeam.length + 1, th.length);

  // ---------- Daily trend (multi-day only) ----------
  if (perf.from !== perf.to) {
    const tr = wb.addWorksheet("Daily Trend");
    tr.addRow(["Date", "Working Day", "Target", "Achieved", "Remaining", "Achievement %", "Lead Target", "Leads", "Remaining Leads", "Lead %"]);
    styleHeader(tr);
    tr.columns = [12, 10, 16, 16, 16, 12, 10, 10, 12, 10].map((w) => ({ width: w }));
    perf.byDate.forEach((d, i) => {
      const n = i + 2;
      tr.addRow([
        new Date(`${d.date}T00:00:00Z`), d.working ? "Yes" : "No", num(d.target), num(d.achieved),
        { formula: `MAX(C${n}-D${n},0)`, result: num(d.balance) },
        { formula: `IF(C${n}=0,"",D${n}/C${n})`, result: d.pct === null ? "" : d.pct / 100 },
        d.leadTarget, d.leads,
        { formula: `MAX(G${n}-H${n},0)`, result: d.leadBalance },
        { formula: `IF(G${n}=0,"",H${n}/G${n})`, result: d.leadPct === null ? "" : d.leadPct / 100 },
      ]);
    });
    tr.getColumn(1).numFmt = "dd-mmm-yyyy";
    [3, 4, 5].forEach((c) => (tr.getColumn(c).numFmt = INR));
    [6, 10].forEach((c) => (tr.getColumn(c).numFmt = PCT));
    finish(tr, 1, perf.byDate.length + 1, 10);
  }

  // ---------- Achievement & lead details ----------
  const addDataset = (name: string, ds: Dataset, moneyCols: string[], dateCols: string[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(ds.columns);
    styleHeader(ws);
    ds.rows.forEach((r) => ws.addRow(r.map((c, i) => (dateCols.includes(ds.columns[i]) && typeof c === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c) ? new Date(`${c}T00:00:00Z`) : c))));
    ds.columns.forEach((c, i) => {
      const column = ws.getColumn(i + 1);
      column.width = Math.min(40, Math.max(12, c.length + 4));
      if (moneyCols.includes(c)) column.numFmt = INR;
      if (dateCols.includes(c)) column.numFmt = "dd-mmm-yyyy";
    });
    ws.getColumn(1).hidden = false;
    finish(ws, 1, ds.rows.length + 1, ds.columns.length);
    const amountIdx = ds.columns.findIndex((c) => moneyCols[0] === c);
    if (amountIdx >= 0 && ds.rows.length) {
      const L = col(amountIdx + 1);
      const r = ws.addRow([]);
      r.getCell(1).value = "TOTAL (filtered)";
      r.getCell(amountIdx + 1).value = { formula: `SUBTOTAL(9,${L}2:${L}${ds.rows.length + 1})`, result: ds.rows.reduce((s, x) => s + num(x[amountIdx] as number), 0) };
      r.getCell(amountIdx + 1).numFmt = INR;
      r.font = { bold: true };
      r.fill = TOTAL_FILL;
    }
  };
  addDataset("Achievement Details", input.achievements, ["Amount"], ["Date"]);
  addDataset("Lead Details", input.leads, ["Estimated Value", "Converted Value"], ["Lead Date", "Follow-up Date"]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
