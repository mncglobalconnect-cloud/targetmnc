// Minimal RFC-4180 CSV parser for lead imports (quoted fields, escaped quotes, CRLF).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_MAP: Record<string, string> = {
  company: "companyName",
  "company name": "companyName",
  companyname: "companyName",
  phone: "phone",
  "contact phone": "phone",
  mobile: "phone",
  contact: "phone",
  "contact number": "phone",
  email: "email",
  "business email": "email",
  "contact person": "contactPerson",
  "contact name": "contactPerson",
  name: "contactPerson",
  website: "website",
  industry: "industry",
  source: "source",
  "lead source": "source",
  notes: "notes",
  "lead date": "leadDate",
  date: "leadDate",
};

export function csvToLeadRows(text: string): { rows: Record<string, string>[]; unmapped: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], unmapped: [] };
  const keys = header.map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? null);
  const unmapped = header.filter((_, i) => !keys[i]);
  const rows = body.map((r) => {
    const o: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k && r[i] !== undefined && r[i].trim() !== "") o[k] = r[i].trim();
    });
    return o;
  });
  return { rows, unmapped };
}
