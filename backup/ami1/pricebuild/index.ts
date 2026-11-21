// pricebuild v1.3 (Document AI OCR for scanned PDFs and photos) — AMI Pricing Database: reads quotes / BOQs / price lists from Drive and writes every priced line into one Google Sheet.
// POST (x-internal-key): {action:"extract", file_id, project, company, kind} | {action:"scan"} | {action:"dedupe"} | {action:"ocr_test", file_id} | {action:"list", q}
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const SH = "https://sheets.googleapis.com/v4/spreadsheets", DR = "https://www.googleapis.com/drive/v3";
let T = "";
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); T = j.access_token;
}
async function g(u: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(u, { ...init, headers: { Authorization: "Bearer " + T, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) } });
  const ct = r.headers.get("content-type") || ""; const b = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`Google ${r.status}: ${typeof b === "string" ? b.slice(0, 150) : b?.error?.message}`); return b;
}
async function sheetText(id: string) {
  const m = await g(`${SH}/${id}?fields=sheets.properties.title`);
  const titles: string[] = m.sheets.map((s: any) => s.properties.title);
  const v = await g(`${SH}/${id}/values:batchGet?${titles.map((t) => "ranges=" + encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:Z3000`)).join("&")}&valueRenderOption=FORMATTED_VALUE`);
  return (v.valueRanges || []).map((vr: any, i: number) => `\n=== TAB: ${titles[i]} ===\n` + (vr.values || []).filter((r: any[]) => r.some((c) => String(c).trim())).map((r: any[]) => r.join(" | ")).join("\n")).join("");
}
const DOCAI = "https://us-documentai.googleapis.com/v1/projects/174035325618/locations/us/processors/543a0b3c1fa66e31:process";
async function ocr(id: string, mime: string): Promise<string> {
  const r = await fetch(`${DR}/files/${id}?alt=media`, { headers: { Authorization: "Bearer " + T } });
  if (!r.ok) throw new Error("download " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer()); if (buf.length > 19e6) throw new Error("file too large for OCR");
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const j = await g(DOCAI, { method: "POST", body: JSON.stringify({ rawDocument: { content: btoa(bin), mimeType: mime }, processOptions: { ocrConfig: { enableImageQualityScores: false } }, imagelessMode: true }) });
  return String(j.document?.text || "");
}
async function fileText(id: string) {
  const f = await g(`${DR}/files/${id}?fields=id,name,mimeType,modifiedTime,size,webViewLink`);
  const mt = f.mimeType; let text = "", via = "text";
  if (mt === "application/vnd.google-apps.spreadsheet") text = await sheetText(id);
  else if (mt.startsWith("application/vnd.google-apps.")) text = String(await g(`${DR}/files/${id}/export?mimeType=text/plain`));
  else if (/^image\//.test(mt)) { text = await ocr(id, mt); via = "ocr"; }
  else {
    const toSheet = /spreadsheetml|ms-excel/.test(mt);
    const c = await g(`${DR}/files/${id}/copy?fields=id`, { method: "POST", body: JSON.stringify({ name: "AMI temp read — " + f.name, mimeType: toSheet ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document" }) });
    try { text = toSheet ? await sheetText(c.id) : String(await g(`${DR}/files/${c.id}/export?mimeType=text/plain`)); }
    finally { await g(`${DR}/files/${c.id}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) }).catch(() => {}); }
    // scanned PDF (little or no text layer): read it with Document AI
    if (mt === "application/pdf" && text.replace(/\s/g, "").length < 400) { try { const o = await ocr(id, mt); if (o.length > text.length) { text = o; via = "ocr"; } } catch (e) { console.log("ocr failed", (e as Error).message); } }
  }
  return { f, text, via };
}
const PROMPT = (meta: string) => `You extract PRICES from a construction / supply / services document for a pricing database. ${meta}
Return ONLY tab-separated lines, no header, no commentary, one line per priced item, with exactly these 12 fields:
category<TAB>item<TAB>specification<TAB>unit<TAB>unit_price<TAB>currency<TAB>qty<TAB>line_total<TAB>supplier<TAB>date<TAB>type<TAB>notes
- category: one of Concrete & masonry, Steel & structure, Roofing, Doors & windows / glazing, Finishes (tiles, paint, ceilings), Plumbing & sanitary, Electrical, HVAC & mechanical, Generators & power, IT & data centre, Furniture & fittings, Vehicles, Labour & services, Security services, Design & consultancy, Equipment & tools, Materials (general), Other.
- item: short name (e.g. "Ceramic floor tile 60x60", "Rebar 12mm", "Split AC 24,000 BTU").
- unit: m, m2, m3, kg, ton, pcs, set, lot, LS, month, day, hour, etc. Keep the document's unit.
- unit_price and line_total: plain numbers only (no commas or symbols); leave empty if not given. If only a total and qty are given, compute unit_price = total/qty.
- currency: USD, LRD, SLE (Leones), EUR, AED, LBP… as shown; default USD if the document is clearly in dollars.
- supplier: who quoted or who will be paid (supplier, contractor, shop) if stated; else empty.
- date: YYYY-MM-DD or YYYY-MM if stated in the document; else empty.
- type: quote | BOQ | price list | budget | actual cost | contract | invoice.
- Skip section headers, subtotals, grand totals, VAT/GST lines, and lines without any price. Never invent a price. Keep every distinct priced line (do not merge or summarise).
If the text has no priced items, return exactly: NONE`;
let LAST_RAW = "";
async function callAI(model: string, meta: string, chunk: string) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 16000, system: PROMPT(meta), messages: [{ role: "user", content: chunk }] }) });
    const d = await r.json();
    if (r.status === 429 || r.status === 529 || r.status >= 500) { await new Promise((res) => setTimeout(res, 8000 * (a + 1))); continue; }
    if (!r.ok) throw new Error("AI " + (d?.error?.message || r.status));
    const t = (d.content || []).map((b: any) => b.text || "").join(""); LAST_RAW = t;
    return t.split("\n").map((l: string) => l.split("\t")).filter((c: string[]) => c.length >= 10 && c[1]?.trim() && (c[4]?.trim() || c[7]?.trim()));
  }
  throw new Error("AI busy");
}
async function extractChunk(meta: string, chunk: string): Promise<string[][]> {
  let rows = await callAI("claude-haiku-4-5", meta, chunk);
  const money = (chunk.match(/\$\s?\d|\d[\d,]*\.\d{2}\b|USD|Le\s?\d|SLE|LRD/g) || []).length;
  if (rows.length < Math.min(5, money / 4)) { const r2 = await callAI("claude-sonnet-4-5", meta, chunk).catch(() => [] as string[][]); if (r2.length > rows.length) rows = r2; }
  return rows;
}
const num = (s: string) => { const n = parseFloat(String(s || "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : ""; };

async function extract(b: any) {
  const cfg = (await (await db("ami_brain?key=eq.pricing_db&select=data")).json())?.[0]?.data;
  if (!cfg?.sheet_id) throw new Error("pricing_db not initialised");
  const { f, text, via } = await fileText(b.file_id);
  if (b.debug) { const m0 = `Document: "${f.name}".`; const rr = await extractChunk(m0, text.slice(0, 28000)); return { file: f.name, text: text.slice(0, 2500), raw: LAST_RAW.slice(0, 2500), parsed: rr.length }; }
  const meta = `Document: "${f.name}" (file date ${String(f.modifiedTime).slice(0, 10)}). Project: ${b.project || "unknown — infer from the document"}. Company: ${b.company || "unknown — infer from the document"}.`;
  const CH = 28000, chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 10; i += CH) chunks.push(text.slice(i, i + CH));
  const parts = await Promise.all(chunks.map((c) => extractChunk(meta, c).catch((e) => { console.log("chunk error", (e as Error).message); return [] as string[][]; })));
  const today = new Date().toISOString().slice(0, 10);
  const link = `=HYPERLINK("${f.webViewLink}","${String(f.name).replace(/"/g, "'").slice(0, 90)}")`;
  const rows = parts.flat().map((c) => [c[0], c[1], c[2], c[3], num(c[4]), c[5] || "USD", num(c[6]), num(c[7]), c[8], c[9], c[10], c[11] || "", b.project || "", b.company || "", link, today].map((x) => typeof x === "string" ? x.trim() : x));
  if (rows.length) await g(`${SH}/${cfg.sheet_id}/values/Prices!A:P:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: rows }) });
  await g(`${SH}/${cfg.sheet_id}/values/Sources!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST",
    body: JSON.stringify({ values: [[link, b.project || "", b.company || "", b.kind || "", rows.length, today, (text.length > CH * 10 ? "partly read (very long)" : "read") + (via === "ocr" ? " (scan, OCR)" : "")]] }) });
  return { file: f.name, via, chars: text.length, chunks: chunks.length, rows: rows.length };
}

Deno.serve(async (req) => {
  try {
    const k = await (await db("ami_settings?key=eq.wake_key&select=value")).json();
    if (!k?.[0]?.value || req.headers.get("x-internal-key") !== k[0].value) return Response.json({ error: "denied" }, { status: 403 });
    const b = await req.json(); await token();

    if (b.action === "extract") return Response.json(await extract(b));
    if (b.action === "ocr_test") { const f = await g(`${DR}/files/${b.file_id}?fields=mimeType,name`); const t = await ocr(b.file_id, f.mimeType); return Response.json({ file: f.name, chars: t.length, sample: t.slice(0, 600) }); }
    if (b.action === "list") { const q = encodeURIComponent(b.q); const l = await g(`${DR}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=200&orderBy=modifiedTime desc`); return Response.json(l); }

    if (b.action === "scan") {
      const cfg = (await (await db("ami_brain?key=eq.pricing_db&select=data")).json())?.[0]?.data;
      const src = await g(`${SH}/${cfg.sheet_id}/values/Sources!A2:A2000?valueRenderOption=FORMULA`);
      const done = new Set<string>(); for (const r of (src.values || [])) { const m = String(r[0] || "").match(/\/d\/([\w-]{20,})/); if (m) done.add(m[1]); }
      const q = encodeURIComponent(`'${cfg.folder_id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`);
      const l = await g(`${DR}/files?q=${q}&fields=files(id,name)&pageSize=200`);
      const fresh = (l.files || []).filter((x: any) => x.id !== cfg.sheet_id && !done.has(x.id)).slice(0, 6);
      const out = [];
      for (const x of fresh) { try { out.push(await extract({ file_id: x.id, project: b.project || "", company: b.company || "", kind: "dropped in archive" })); } catch (e) { out.push({ file: x.name, error: (e as Error).message }); } }
      return Response.json({ new_files: out });
    }
    if (b.action === "dedupe") {
      const cfg = (await (await db("ami_brain?key=eq.pricing_db&select=data")).json())?.[0]?.data;
      const v = await g(`${SH}/${cfg.sheet_id}/values/Prices!A2:P20000?valueRenderOption=FORMULA`);
      const seen = new Set<string>(), keep: any[][] = [];
      for (const r of (v.values || [])) { const key = [r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[14]].map((x) => String(x ?? "").trim().toLowerCase()).join("|"); if (!seen.has(key)) { seen.add(key); keep.push(r); } }
      if (keep.length) await g(`${SH}/${cfg.sheet_id}/values/Prices!A2?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ values: keep }) });
      await g(`${SH}/${cfg.sheet_id}/values/Prices!A${keep.length + 2}:P20000:clear`, { method: "POST", body: "{}" });
      return Response.json({ before: (v.values || []).length, after: keep.length });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
