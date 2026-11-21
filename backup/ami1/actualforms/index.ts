// actualforms v1.1 — "Actual Update" forms (same layout as the projection files).
// POST {action:"make", items:[{company, projection_id}], folder_id}  -> copies each projection file into the folder as "AMI Actual Update — <company>",
//      keeps only: Actual 2027 (to fill), Projection 2027 (reference, protected), How to fill. Status in Actual 2027!B3 (DRAFT / READY).
// POST {action:"import"} -> for every form in ami_brain.actual_forms whose status is READY: copies its Actual 2027 tab into the
//      company's projection file (Actual 2027 tab), marks the form "IMPORTED <date>". Header x-internal-key required.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); return j.access_token as string;
}
const SH = "https://sheets.googleapis.com/v4/spreadsheets";
const HOW = (c: string) => [["How to fill — " + c + " (every month, by the 5th)"], [],
  ["1", "Open the 'Actual 2027' tab. Fill ONLY the yellow month columns for the month(s) just finished: what was really received (income lines) and really paid (cost lines)."],
  ["2", "Costs and payments are NEGATIVE numbers (e.g. -14250). Income is positive."],
  ["3", "Leave future months empty. Do not change the line names, totals or formulas."],
  ["4", "Something new that is not on a line? Add it in the notes column Q next to the nearest line, with the amount."],
  ["5", "When finished, change cell B3 from DRAFT to READY. AMI imports it into the company file the next morning and marks it IMPORTED."],
  ["6", "The 'Projection 2027' tab is the agreed plan — for reference only, do not edit."],
  ["7", "Questions: send them to the Chairman's office."]];

Deno.serve(async (req) => {
  try {
    const k = await (await db("ami_settings?key=eq.wake_key&select=value")).json();
    if (!k?.[0]?.value || req.headers.get("x-internal-key") !== k[0].value) return Response.json({ error: "denied" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const t = await token(); const H = { Authorization: "Bearer " + t, "Content-Type": "application/json" };
    const g = async (u: string, init: RequestInit = {}) => { const r = await fetch(u, { ...init, headers: H }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`); return j; };

    if (body.action === "make") {
      const out: any[] = [];
      for (const it of body.items) {
        const c = await g(`https://www.googleapis.com/drive/v3/files/${it.projection_id}/copy?fields=id`, { method: "POST", body: JSON.stringify({ name: "AMI Actual Update — " + it.company, parents: [body.folder_id] }) });
        const props = await g(`${SH}/${c.id}?fields=sheets.properties(sheetId,title)`);
        const meta = await g(`${SH}/${c.id}?fields=sheets(properties(title),data.rowData.values.formattedValue)&ranges=${encodeURIComponent("'Actual 2027'!A1:A80")}`);
        const sheets = props.sheets.map((s: any) => s.properties);
        const id = (t: string) => sheets.find((s: any) => s.title === t)?.sheetId;
        const rows = (meta.sheets.find((s: any) => s.properties.title === "Actual 2027")?.data?.[0]?.rowData || []).map((r: any) => r?.values?.[0]?.formattedValue || "");
        const TI = rows.indexOf("TOTAL INCOME") + 1, TC = rows.indexOf("TOTAL COSTS AND PAYMENTS") + 1;
        const A = id("Actual 2027"), P = id("Projection 2027"), HW = id("How to update");
        const yellow = (r0: number, r1: number) => ({ repeatCell: { range: { sheetId: A, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 3, endColumnIndex: 15 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.95, blue: 0.6 } } }, fields: "userEnteredFormat.backgroundColor" } });
        const requests: any[] = [
          ...sheets.filter((s: any) => !["Actual 2027", "Projection 2027", "How to update"].includes(s.title)).map((s: any) => ({ deleteSheet: { sheetId: s.sheetId } })),
          { updateSheetProperties: { properties: { sheetId: HW, title: "How to fill" }, fields: "title" } },
          { updateSheetProperties: { properties: { sheetId: A, index: 0 }, fields: "index" } },
          yellow(4, TI - 1), yellow(TI + 1, TC - 1),
          { repeatCell: { range: { sheetId: A, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.8, blue: 0.4 }, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
          { setDataValidation: { range: { sheetId: A, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }, rule: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "DRAFT" }, { userEnteredValue: "READY" }] }, showCustomUi: true, strict: false } } },
          { addProtectedRange: { protectedRange: { range: { sheetId: P }, description: "Agreed plan — reference only", warningOnly: true } } },
        ];
        await g(`${SH}/${c.id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
        await g(`${SH}/${c.id}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: [
          { range: "'Actual 2027'!A3:C3", values: [["Status", "DRAFT", "← change to READY when the month is filled"]] },
          { range: "'Actual 2027'!Q4", values: [["Notes"]] },
          { range: "'How to fill'!A1:B9", values: HOW(it.company) }] }) });
        await fetch(`https://www.googleapis.com/drive/v3/files/${c.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ name: "AMI Actual Update — " + it.company }) });
        out.push({ company: it.company, form_id: c.id, projection_id: it.projection_id, url: `https://docs.google.com/spreadsheets/d/${c.id}/edit` });
      }
      await db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "actual_forms", data: out, updated_at: new Date().toISOString() }) });
      return Response.json({ forms: out });
    }

    if (body.action === "import") {
      const cfg = (await (await db("ami_brain?key=eq.actual_forms&select=data")).json())?.[0]?.data || [];
      const today = new Date().toISOString().slice(0, 10); const imported: string[] = [], skipped: string[] = [], errors: string[] = [];
      for (const f of cfg) {
        try {
          const s = await g(`${SH}/${f.form_id}/values/${encodeURIComponent("'Actual 2027'!B3")}`);
          if (!/^\s*READY/i.test(String(s.values?.[0]?.[0] || ""))) { skipped.push(f.company); continue; }
          const v = await g(`${SH}/${f.form_id}/values/${encodeURIComponent("'Actual 2027'!A4:Q80")}?valueRenderOption=FORMULA`);
          await g(`${SH}/${f.projection_id}/values/${encodeURIComponent("'Actual 2027'!A4:Q80")}:clear`, { method: "POST", body: "{}" });
          await g(`${SH}/${f.projection_id}/values/${encodeURIComponent("'Actual 2027'!A4")}?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ values: v.values || [] }) });
          await g(`${SH}/${f.form_id}/values/${encodeURIComponent("'Actual 2027'!B3")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["IMPORTED " + today]] }) });
          imported.push(f.company);
        } catch (e) { errors.push(f.company + ": " + (e as Error).message); }
      }
      await db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "actual_import", data: { imported, skipped, errors, at: new Date().toISOString() }, updated_at: new Date().toISOString() }) });
      return Response.json({ imported, skipped, errors });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
