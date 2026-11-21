// sheetbuild v1.0 — builds a "Projection vs Actual 2027" Google Sheet from a compact spec (direct Google, no Zapier).
// POST { spec } with header x-internal-key (= ami_settings.wake_key).
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); return j.access_token as string;
}
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], C = "DEFGHIJKLMNO".split("");
const NF = { numberFormat: { type: "NUMBER", pattern: "#,##0;(#,##0);\"-\"" } };

function projection(s: any, actual: boolean) {
  const v: any[][] = [];
  v.push([s.heading + (actual ? " · ACTUAL 2027 (fill in every 3 months)" : " · PROJECTION 2027")]);
  v.push([actual ? "USD · enter real amounts received / paid each month · costs negative · leave future months empty" : "USD · " + s.basis + " · costs negative"]);
  v.push([]); v.push(["Section", "Unit", "Line", ...MON, "Total 2027"]);
  let r = 5;
  for (const [a, b, l, m] of s.income) { v.push([a, b, l, ...(actual ? m.map(() => "") : m), `=SUM(D${r}:O${r})`]); r++; }
  const IL = r - 1, TI = r;
  const g = (c: string, x: number, y: number) => `=IF(COUNT(${c}${x}:${c}${y})=0,"",SUM(${c}${x}:${c}${y}))`;
  v.push(["TOTAL INCOME", "", "", ...C.map((c) => g(c, 5, IL)), `=SUM(D${r}:O${r})`]); r++;
  v.push([]); r++; const CF = r;
  for (const [a, b, l, m] of s.costs) { v.push([a, b, l, ...(actual ? m.map(() => "") : m.map((x: number) => -x)), `=SUM(D${r}:O${r})`]); r++; }
  const CL = r - 1, TC = r;
  v.push(["TOTAL COSTS AND PAYMENTS", "", "", ...C.map((c) => g(c, CF, CL)), `=SUM(D${r}:O${r})`]); r++;
  const NR = r;
  v.push(["NET CASH FLOW", "", "", ...C.map((c) => `=IF(AND(${c}${TI}="",${c}${TC}=""),"",N(${c}${TI})+N(${c}${TC}))`), `=SUM(D${r}:O${r})`]); r++;
  v.push([]); r++; const OC = r;
  v.push(["Cash at 1 Jan 2027", "", s.opening_label, s.opening_cash]); r++;
  const CR = r;
  v.push(["CASH AT END OF MONTH", "", "negative = overdraft / funding needed", ...C.map((c, i) => { const p = i ? `${C[i - 1]}${CR}` : `D${OC}`; return `=IF(OR(${c}${NR}="",${p}=""),"",${p}+${c}${NR})`; }), `=O${CR}`]); r++;
  if (s.overdraft) { v.push(["Beyond overdraft limit", "", "overdraft " + s.overdraft, ...C.map((c) => `=IF(${c}${CR}="","",MIN(0,${c}${CR}+${s.overdraft}))`), `=O${r}`]); r++; }
  return { v, TI, TC, NR, CR, last: r - 1 };
}
function pva(s: any, NR: number) {
  const pp = "'Projection 2027'!", aa = "'Actual 2027'!";
  const v: any[][] = [[s.heading + " — Projection vs Actual 2027 (by quarter)"], ["Variance = Actual − Projection (for costs, negative = spent more). Fill the 'Actual 2027' tab each quarter; this tab updates by itself."], [],
    ["Line", ...["Q1", "Q2", "Q3", "Q4"].flatMap((q) => [q + " Projection", q + " Actual", q + " Variance"]), "2027 Projection", "2027 Actual", "2027 Variance", "Status"]];
  for (let r = 5; r <= NR; r++) {
    const row = [`=IF(${pp}A${r}="","",IF(${pp}C${r}="",${pp}A${r},${pp}C${r}))`];
    [["D", "F"], ["G", "I"], ["J", "L"], ["M", "O"]].forEach(([a, b], k) => {
      const P = "BEHK"[k], A = "CFIL"[k];
      row.push(`=IF($A${r}="","",SUM(${pp}${a}${r}:${b}${r}))`, `=IF($A${r}="","",SUM(${aa}${a}${r}:${b}${r}))`, `=IF(OR($A${r}="",COUNT(${aa}${a}${r}:${b}${r})=0),"",${A}${r}-${P}${r})`);
    });
    row.push(`=IF($A${r}="","",${pp}P${r})`, `=IF($A${r}="","",${aa}P${r})`, `=IF(OR($A${r}="",COUNT(${aa}D${r}:O${r})=0),"",O${r}-N${r})`,
      `=IF($A${r}="","",IF(P${r}="","not reported yet",IF(P${r}>=0,"on or above plan",IF(ABS(P${r})<=0.1*ABS(N${r}),"slightly below plan","BELOW PLAN — check"))))`);
    v.push(row);
  }
  return v;
}
Deno.serve(async (req) => {
  try {
    const k = await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } })).json();
    if (!k?.[0]?.value || req.headers.get("x-internal-key") !== k[0].value) return Response.json({ error: "denied" }, { status: 403 });
    const { spec: s } = await req.json();
    const t = await token(); const H = { Authorization: "Bearer " + t, "Content-Type": "application/json" };
    const titles = ["Projection vs Actual", "Projection 2027", "Actual 2027", "Opening 1 Jan 2027", "Assumptions", "How to update"];
    const mk = await (await fetch("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", headers: H, body: JSON.stringify({ properties: { title: s.title }, sheets: titles.map((title, i) => ({ properties: { title, index: i, gridProperties: { frozenRowCount: i < 3 ? 4 : 0, columnCount: 26, rowCount: 200 } } })) }) })).json();
    if (!mk.spreadsheetId) throw new Error("create failed: " + JSON.stringify(mk).slice(0, 200));
    const id = mk.spreadsheetId, sid = mk.sheets.map((x: any) => x.properties.sheetId);
    const P = projection(s, false), A = projection(s, true);
    const how = [["How to update (every 3 months)"], [], ["1", "After each quarter (by 10 Apr, 10 Jul, 10 Oct, 10 Jan) the accountant opens the 'Actual 2027' tab."], ["2", "Enter what was really received and really paid in each month. Costs as negative numbers."], ["3", "Leave future months empty. Totals, cash and the 'Projection vs Actual' tab update by themselves."], ["4", "Do not change the 'Projection 2027' tab — it is the agreed plan. Changes are noted on the 'Assumptions' tab."], ["5", "New lines: add the same line in BOTH tabs, same row."], ["6", "AMI reads this file and gives the Chairman the assessment: what is on plan, what is behind, what needs his attention."]];
    const data = [
      { range: "'Projection 2027'!A1", values: P.v }, { range: "'Actual 2027'!A1", values: A.v },
      { range: "'Opening 1 Jan 2027'!A1", values: [["Opening position — 1 January 2027 (" + s.heading + ")"], [], ["Item", "USD"], ...s.opening] },
      { range: "'Assumptions'!A1", values: [["Assumptions, sources and items to confirm"], [], ...s.assumptions] },
      { range: "'How to update'!A1", values: how }];
    let w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, { method: "POST", headers: H, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
    if (!w.ok) throw new Error("write failed: " + (await w.text()).slice(0, 300));
    w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, { method: "POST", headers: H, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: [{ range: "'Projection vs Actual'!A1", values: pva(s, P.NR) }] }) });
    if (!w.ok) throw new Error("pva failed: " + (await w.text()).slice(0, 300));
    const rng = (i: number, r0: number, r1: number, c0: number, c1: number) => ({ sheetId: sid[i], startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
    const bold = (i: number, rows: number[]) => rows.map((r) => ({ repeatCell: { range: rng(i, r - 1, r, 0, 17), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } }));
    const width = (i: number, ws: number[]) => ws.map((px, c) => ({ updateDimensionProperties: { range: { sheetId: sid[i], dimension: "COLUMNS", startIndex: c, endIndex: c + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } }));
    const nf = (i: number, r0: number, r1: number, c0: number, c1: number) => ({ repeatCell: { range: rng(i, r0, r1, c0, c1), cell: { userEnteredFormat: NF }, fields: "userEnteredFormat.numberFormat" } });
    const pw = [140, 90, 380, ...Array(12).fill(90), 105];
    const requests = [
      ...bold(0, [1, 4]), ...bold(1, [1, 4, P.TI, P.TC, P.NR, P.CR]), ...bold(2, [1, 4, P.TI, P.TC, P.NR, P.CR]), ...bold(3, [1, 3]), ...bold(4, [1]), ...bold(5, [1]),
      ...width(0, [330, ...Array(15).fill(105), 160]), ...width(1, pw), ...width(2, pw), ...width(3, [640, 130]), ...width(4, [900]), ...width(5, [60, 720]),
      nf(0, 4, P.NR, 1, 16), nf(1, 4, P.last, 3, 16), nf(2, 4, P.last, 3, 16), nf(3, 3, 3 + s.opening.length, 1, 2),
      { updateSheetProperties: { properties: { sheetId: sid[0], tabColor: { red: 0.1, green: 0.3, blue: 0.7 } }, fields: "tabColor" } },
      { updateSheetProperties: { properties: { sheetId: sid[2], tabColor: { red: 0.2, green: 0.6, blue: 0.3 } }, fields: "tabColor" } }];
    w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: "POST", headers: H, body: JSON.stringify({ requests }) });
    if (!w.ok) throw new Error("format failed: " + (await w.text()).slice(0, 300));
    if (s.folder_id) {
      const f = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents`, { headers: H })).json();
      await fetch(`https://www.googleapis.com/drive/v3/files/${id}?addParents=${s.folder_id}&removeParents=${(f.parents || []).join(",")}`, { method: "PATCH", headers: H, body: "{}" });
    }
    const sum = (rows: any[]) => Array.from({ length: 12 }, (_, i) => rows.reduce((a, r) => a + (+r[3][i] || 0), 0));
    const ti = sum(s.income), tc = sum(s.costs); let c = +s.opening_cash; const cash = ti.map((x, i) => Math.round(c += x - tc[i]));
    const T = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0));
    return Response.json({ spreadsheet_id: id, url: `https://docs.google.com/spreadsheets/d/${id}/edit`, rows: { TI: P.TI, TC: P.TC, NR: P.NR, CR: P.CR },
      totals: { income: T(ti), costs: T(tc), net: T(ti) - T(tc), cash_end: cash[11], lowest_cash: Math.min(...cash), monthly_income: ti, monthly_costs: tc, monthly_cash: cash } });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
