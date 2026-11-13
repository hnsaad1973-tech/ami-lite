// AMI direct Google connection (Gmail, Drive, Sheets, Calendar) — replaces Zapier for these apps.
// Uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN (Supabase secrets).

let tok = "", tokExp = 0;
export const googleReady = () => !!(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET") && Deno.env.get("GOOGLE_REFRESH_TOKEN"));

async function token(): Promise<string> {
  if (tok && Date.now() < tokExp - 60000) return tok;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "", grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google sign-in failed: " + (j.error_description || j.error || r.status));
  tok = j.access_token; tokExp = Date.now() + (j.expires_in || 3600) * 1000;
  return tok;
}
async function g(url: string, init: RequestInit = {}): Promise<any> {
  const t = await token();
  const r = await fetch(url, { ...init, headers: { Authorization: "Bearer " + t, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) } });
  if (r.status === 204) return {};
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`Google ${r.status}: ` + (typeof body === "string" ? body.slice(0, 200) : body?.error?.message || JSON.stringify(body).slice(0, 200)));
  return body;
}
const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
const DR = "https://www.googleapis.com/drive/v3";
const SH = "https://sheets.googleapis.com/v4/spreadsheets";
const CAL = "https://www.googleapis.com/calendar/v3";
const b64url = (s: string) => { const b = new TextEncoder().encode(s); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const hdr = (m: any, n: string) => (m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "";

// ---------- Gmail ----------
async function listIds(q: string, max: number): Promise<{ id: string; threadId: string }[]> {
  const out: any[] = []; let page = "";
  while (out.length < max) {
    const u = `${GM}/messages?maxResults=${Math.min(500, max - out.length)}&q=${encodeURIComponent(q)}${q.includes("in:spam") ? "&includeSpamTrash=true" : ""}${page ? "&pageToken=" + page : ""}`;
    const j = await g(u); out.push(...(j.messages || [])); if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return out;
}
export async function inboxDigest(query: string, max = 40) {
  const ids = await listIds(query || "in:inbox", Math.min(+max || 40, 60));
  const rows = await Promise.all(ids.map(async (x) => {
    const m = await g(`${GM}/messages/${x.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    return { id: m.id, threadId: m.threadId, from: hdr(m, "From"), subject: hdr(m, "Subject"), date: hdr(m, "Date"), preview: String(m.snippet || "").slice(0, 200) };
  }));
  return { count: rows.length, emails: rows };
}
export async function inboxArchive(p: { query?: string; ids?: string; unspam?: any }) {
  const ids = p.ids ? String(p.ids).split(/[,\s]+/).filter(Boolean) : (await listIds(p.query || "in:inbox", 1000)).map((x) => x.id);
  if (!ids.length) return { archived: 0 };
  const unspam = String(p.unspam) === "true";
  for (let i = 0; i < ids.length; i += 1000)
    await g(`${GM}/messages/batchModify`, { method: "POST", body: JSON.stringify(unspam ? { ids: ids.slice(i, i + 1000), removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] } : { ids: ids.slice(i, i + 1000), removeLabelIds: ["INBOX"] }) });
  return unspam ? { moved_out_of_spam: ids.length } : { archived: ids.length, note: "archived only, nothing deleted" };
}
export async function gmailRead(id: string) {
  const m = await g(`${GM}/messages/${id}?format=full`);
  const parts: string[] = [];
  const walk = (p: any) => { if (!p) return; if (p.mimeType === "text/plain" && p.body?.data) parts.push(atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/"))); (p.parts || []).forEach(walk); };
  walk(m.payload);
  let text = parts.join("\n");
  try { text = new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))); } catch (_) {}
  return { id: m.id, threadId: m.threadId, from: hdr(m, "From"), to: hdr(m, "To"), subject: hdr(m, "Subject"), date: hdr(m, "Date"), body: (text || m.snippet || "").slice(0, 8000) };
}
export async function gmailDraft(p: { to?: string; subject?: string; body: string; thread_id?: string }) {
  let to = p.to || "", subject = p.subject || "", extra = "";
  if (p.thread_id) {
    const t = await g(`${GM}/threads/${p.thread_id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=Reply-To`);
    const last = (t.messages || []).slice(-1)[0];
    if (last) {
      to = to || hdr(last, "Reply-To") || hdr(last, "From");
      const s = hdr(last, "Subject"); subject = subject || (/^re:/i.test(s) ? s : "Re: " + s);
      const mid = hdr(last, "Message-ID"); if (mid) extra = `In-Reply-To: ${mid}\r\nReferences: ${mid}\r\n`;
    }
  }
  if (!to) throw new Error("No recipient for the draft.");
  const enc = (s: string) => /[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=` : s;
  const raw = `To: ${to}\r\nSubject: ${enc(subject)}\r\n${extra}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${p.body}`;
  const d = await g(`${GM}/drafts`, { method: "POST", body: JSON.stringify({ message: { raw: b64url(raw), ...(p.thread_id ? { threadId: p.thread_id } : {}) } }) });
  return { draft_created: true, draft_id: d.id, to, subject, note: "Saved as a DRAFT in Gmail — not sent." };
}

// ---------- Drive ----------
export async function driveSearch(p: { name?: string; folder_id?: string; text?: string }) {
  const q: string[] = ["trashed=false"];
  if (p.name) q.push(`name contains '${String(p.name).replace(/'/g, "\\'")}'`);
  if (p.text) q.push(`fullText contains '${String(p.text).replace(/'/g, "\\'")}'`);
  if (p.folder_id) q.push(`'${p.folder_id}' in parents`);
  const j = await g(`${DR}/files?pageSize=60&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&q=${encodeURIComponent(q.join(" and "))}`);
  return { count: (j.files || []).length, files: (j.files || []).map((f: any) => ({ id: f.id, name: f.name, type: f.mimeType.replace("application/vnd.google-apps.", "google-"), modified: f.modifiedTime?.slice(0, 10), link: f.webViewLink })) };
}
async function sheetAll(id: string, maxChars: number) {
  const meta = await g(`${SH}/${id}?fields=properties.title,sheets.properties.title`);
  const titles: string[] = (meta.sheets || []).map((s: any) => s.properties.title);
  const ranges = titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:Z400`)}`).join("&");
  const v = titles.length ? await g(`${SH}/${id}/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE`) : { valueRanges: [] };
  let out = "";
  (v.valueRanges || []).forEach((vr: any, i: number) => { out += `\n=== TAB: ${titles[i]} ===\n` + (vr.values || []).map((r: any[]) => r.join(" | ")).join("\n"); });
  return out.slice(0, maxChars);
}
async function readOne(id: string, maxChars: number) {
  const f = await g(`${DR}/files/${id}?fields=id,name,mimeType,size,modifiedTime`);
  const head = { id: f.id, name: f.name, modified: f.modifiedTime?.slice(0, 10) };
  const mt = f.mimeType;
  if (mt === "application/vnd.google-apps.document") return { ...head, text: String(await g(`${DR}/files/${id}/export?mimeType=text/plain`)).slice(0, maxChars) };
  if (mt === "application/vnd.google-apps.spreadsheet") return { ...head, text: await sheetAll(id, maxChars) };
  if (mt === "application/vnd.google-apps.presentation") return { ...head, text: String(await g(`${DR}/files/${id}/export?mimeType=text/plain`)).slice(0, maxChars) };
  if (/^text\/|json|csv/.test(mt)) return { ...head, text: String(await g(`${DR}/files/${id}?alt=media`)).slice(0, maxChars) };
  if (+f.size > 15e6) return { ...head, text: "(file too large to read: " + Math.round(+f.size / 1e6) + " MB)" };
  const toSheet = /spreadsheetml|ms-excel/.test(mt);
  const toDoc = mt === "application/pdf" || /wordprocessingml|msword|presentationml|ms-powerpoint|rtf|opendocument/.test(mt);
  if (!toSheet && !toDoc) return { ...head, text: `(cannot read this kind of file: ${mt})` };
  // temporary Google copy to read the text, then put the copy in the bin (the original is never touched)
  const c = await g(`${DR}/files/${id}/copy?fields=id`, { method: "POST", body: JSON.stringify({ name: "AMI temp read — " + f.name, mimeType: toSheet ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document" }) });
  try {
    const text = toSheet ? await sheetAll(c.id, maxChars) : String(await g(`${DR}/files/${c.id}/export?mimeType=text/plain`)).slice(0, maxChars);
    return { ...head, text };
  } finally { await g(`${DR}/files/${c.id}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) }).catch(() => {}); }
}
export async function driveRead(p: { file_ids: string; max_chars?: any }) {
  const ids = String(p.file_ids || "").split(/[,\s]+/).filter(Boolean).slice(0, 3);
  const max = Math.min(+p.max_chars || 20000, 40000);
  return { files: await Promise.all(ids.map((id) => readOne(id, max).catch((e) => ({ id, error: (e as Error).message })))) };
}
export async function driveSaveFromUrl(p: { url: string; folder_id: string; name: string }) {
  const r = await fetch(p.url); if (!r.ok) throw new Error("Could not download the file: " + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer()); const type = r.headers.get("content-type") || "application/octet-stream";
  const t = await token(); const bd = "amiboundary" + Date.now();
  const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: p.name, parents: [p.folder_id] })}\r\n--${bd}\r\nContent-Type: ${type}\r\n\r\n`);
  const post = new TextEncoder().encode(`\r\n--${bd}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length); body.set(pre); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const u = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": `multipart/related; boundary=${bd}` }, body });
  const j = await u.json(); if (!u.ok) throw new Error("Drive upload failed: " + (j?.error?.message || u.status));
  return { saved: true, name: j.name, link: j.webViewLink };
}

// ---------- Sheets ----------
export async function sheetRead(p: { spreadsheet_id: string; range?: string }) {
  if (p.range) { const v = await g(`${SH}/${p.spreadsheet_id}/values/${encodeURIComponent(p.range)}`); return { range: v.range, rows: v.values || [] }; }
  return { text: await sheetAll(p.spreadsheet_id, 40000) };
}
export async function sheetTabs(id: string, range = "A1:F600"): Promise<Record<string, any[][]>> {
  const meta = await g(`${SH}/${id}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets || []).map((s: any) => s.properties.title);
  const v = await g(`${SH}/${id}/values:batchGet?${titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'!${range}`)}`).join("&")}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
  const tabs: Record<string, any[][]> = {};
  (v.valueRanges || []).forEach((vr: any, i: number) => { tabs[titles[i]] = vr.values || []; });
  return tabs;
}
// Monthly forms: a form whose 'Update'!B6 starts with READY replaces its tab in the master; both are then marked IMPORTED
export async function brainImportReady(masterId: string, forms: { file_id: string; tab: string }[]) {
  const today = new Date().toISOString().slice(0, 10); const imported: string[] = [], skipped: string[] = [], errors: string[] = [];
  for (const f of forms || []) {
    try {
      const s = await g(`${SH}/${f.file_id}/values/${encodeURIComponent("'Update'!B6")}`);
      if (!/^\s*READY/i.test(String(s.values?.[0]?.[0] || ""))) { skipped.push(f.tab); continue; }
      const v = await g(`${SH}/${f.file_id}/values/${encodeURIComponent("'Update'!A1:F600")}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
      const rows = v.values || [];
      const tr = `'${f.tab.replace(/'/g, "''")}'`;
      await g(`${SH}/${masterId}/values/${encodeURIComponent(tr + "!A1:F600")}:clear`, { method: "POST", body: "{}" });
      if (rows.length) await g(`${SH}/${masterId}/values/${encodeURIComponent(tr + "!A1")}?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ values: rows }) });
      await g(`${SH}/${masterId}/values/${encodeURIComponent(tr + "!B6")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["IMPORTED " + today]] }) });
      await g(`${SH}/${f.file_id}/values/${encodeURIComponent("'Update'!B6")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["IMPORTED " + today]] }) });
      imported.push(f.tab);
    } catch (e) { errors.push(f.tab + ": " + (e as Error).message); }
  }
  return { imported, skipped, errors };
}

// ---------- Calendar ----------
export async function calendarEvents(p: { days?: any; query?: string }) {
  const from = new Date(), to = new Date(Date.now() + (+p.days || 7) * 864e5);
  const j = await g(`${CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${from.toISOString()}&timeMax=${to.toISOString()}${p.query ? "&q=" + encodeURIComponent(p.query) : ""}`);
  return { events: (j.items || []).map((e: any) => ({ title: e.summary, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, where: e.location || "", id: e.id })) };
}
export async function calendarAdd(p: { title: string; start: string; end?: string; notes?: string; location?: string }) {
  const s = new Date(p.start); if (isNaN(s.getTime())) throw new Error("Bad start time.");
  const e = p.end ? new Date(p.end) : new Date(s.getTime() + 3600e3);
  const j = await g(`${CAL}/calendars/primary/events`, { method: "POST", body: JSON.stringify({ summary: p.title, description: p.notes || "", location: p.location || "",
    start: { dateTime: s.toISOString(), timeZone: "Africa/Monrovia" }, end: { dateTime: e.toISOString(), timeZone: "Africa/Monrovia" } }) });
  return { added: true, title: j.summary, start: j.start?.dateTime, link: j.htmlLink };
}

// ---------- Pricing database ----------
const PRICE_DB = "1B2x4BW_7nzndL5SO9MMPyzJLaKEud0B_mcLtNnPC_cU";
export async function priceLookup(p: { query: string; currency?: string; max?: any }) {
  const v = await g(`${SH}/${PRICE_DB}/values:batchGet?ranges=${encodeURIComponent("Prices!A2:P6000")}&valueRenderOption=FORMATTED_VALUE`);
  const f = await g(`${SH}/${PRICE_DB}/values/${encodeURIComponent("Prices!O2:O6000")}?valueRenderOption=FORMULA`);
  const rows: any[][] = v.valueRanges?.[0]?.values || [], links: any[][] = f.values || [];
  const words = String(p.query || "").toLowerCase().replace(/[^a-z0-9.\s"/x-]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["the","and","for","of","price","prices","cost","per","how","much","what","with"].includes(w));
  const scored = rows.map((r, i) => {
    const hay = [r[0], r[1], r[2], r[11], r[12]].join(" ").toLowerCase();
    const sc = words.reduce((a, w) => a + (hay.includes(w) ? (String(r[1] || "").toLowerCase().includes(w) ? 2 : 1) : 0), 0);
    return { sc, i, r };
  }).filter((x) => x.sc > 0 && (!p.currency || String(x.r[5] || "").toUpperCase() === String(p.currency).toUpperCase()));
  scored.sort((a, b) => b.sc - a.sc || String(b.r[9] || "").localeCompare(String(a.r[9] || "")));
  const max = Math.min(+p.max || 40, 80);
  return { total_lines_in_database: rows.length, matches: scored.length, sheet: `https://docs.google.com/spreadsheets/d/${PRICE_DB}/edit`,
    results: scored.slice(0, max).map(({ r, i }) => ({ category: r[0], item: r[1], spec: r[2], unit: r[3], unit_price: r[4], currency: r[5], qty: r[6], line_total: r[7],
      supplier: r[8], date: r[9], type: r[10], notes: r[11], project: r[12], company: r[13], source: r[14], source_link: (String(links[i]?.[0] || "").match(/HYPERLINK\("([^"]+)"/) || [])[1] || "" })) };
}

// ---------- Drawing (floor / partition plans -> PDF + AutoCAD DXF in Drive) ----------
export async function drawPlan(p: { brief: string; base_file_id?: string; folder_id?: string; company?: string; title?: string; revise?: any }) {
  const SBU = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const H = { apikey: SRK, Authorization: `Bearer ${SRK}` };
  const key = (await (await fetch(`${SBU}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: H })).json())?.[0]?.value;
  const body: any = { brief: p.brief, base_file_id: p.base_file_id || undefined, folder_id: p.folder_id || undefined, company: p.company || undefined, title: p.title || undefined, async: true };
  if (String(p.revise) === "true") {
    const last = (await (await fetch(`${SBU}/rest/v1/ami_brain?key=eq.last_drawing&select=data`, { headers: H })).json())?.[0]?.data;
    if (last) { body.brief = `${last.brief}\n\nCHANGES REQUESTED NOW (apply these to the plan above):\n${p.brief}`; body.base_file_id = body.base_file_id || last.base_file_id || undefined; body.folder_id = body.folder_id || last.folder || undefined; body.title = body.title || String(last.title || "").replace(/ \(rev.*\)$/, "") + " (rev)"; }
  }
  const r = await fetch(`${SBU}/functions/v1/drawplan`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key || "" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "drawplan " + r.status);
  return { started: true, note: "Drawing started. The PDF and AutoCAD (DXF) links come to his WhatsApp in about 3 minutes and are saved in Drive next to the base plan (or in the company folder)." };
}

// ---------- Elevations / section / 3D (drawelev) ----------
export async function drawElevations(p: { brief: string; folder_id?: string; title?: string; use_last_plan?: any }) {
  const SBU = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = (await (await fetch(`${SBU}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } })).json())?.[0]?.value;
  const r = await fetch(`${SBU}/functions/v1/drawelev`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key || "" },
    body: JSON.stringify({ brief: p.brief, folder_id: p.folder_id || undefined, title: p.title || undefined, use_last_plan: p.use_last_plan ?? "true", async: true }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "drawelev " + r.status);
  return { started: true, note: "Elevations (4 sides), section and 3D massing view started. PDF + AutoCAD links come to his WhatsApp in about 1 minute, saved in the same Drive folder as the floor plan." };
}

// ---------- Tool definitions for the model ----------
export const GOOGLE_TOOLS = [
  { name: "inbox_digest", description: "List emails from his Gmail (sender, subject, date, short preview, id, threadId). Uses Gmail search syntax, e.g. 'in:inbox newer_than:1d category:primary', 'from:ecobank', 'subject:invoice newer_than:30d'.",
    input_schema: { type: "object", properties: { query: { type: "string" }, max_results: { type: "string" } }, required: ["query"] } },
  { name: "gmail_read", description: "Open one email in full (body text) by its id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "inbox_archive", description: "Archive emails (removes them from the inbox; NEVER deletes). Give a Gmail query, or ids separated by commas. With unspam 'true', the given ids are moved out of Spam into the inbox.",
    input_schema: { type: "object", properties: { query: { type: "string" }, ids: { type: "string" }, unspam: { type: "string" } } } },
  { name: "gmail_draft", description: "Create a Gmail DRAFT (never sends). For a reply give thread_id (recipient and subject are filled from the thread). For a new email give to and subject.",
    input_schema: { type: "object", properties: { thread_id: { type: "string" }, to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["body"] } },
  { name: "drive_search", description: "Find files in his Google Drive by part of the name, words inside the file, and/or a folder id (lists that folder). Newest first.",
    input_schema: { type: "object", properties: { name: { type: "string" }, text: { type: "string" }, folder_id: { type: "string" } } } },
  { name: "drive_read", description: "Read the text of up to 3 Drive files (Docs, Sheets with ALL tabs, PDFs, Word, Excel, PowerPoint). file_ids separated by commas.",
    input_schema: { type: "object", properties: { file_ids: { type: "string" }, max_chars: { type: "string" } }, required: ["file_ids"] } },
  { name: "sheet_read", description: "Read a Google Sheet by id: a range like 'Leone Investment'!A1:F200, or all tabs if no range.",
    input_schema: { type: "object", properties: { spreadsheet_id: { type: "string" }, range: { type: "string" } }, required: ["spreadsheet_id"] } },
  { name: "calendar_events", description: "List his Google Calendar events for the next N days (default 7), optional search text.",
    input_schema: { type: "object", properties: { days: { type: "string" }, query: { type: "string" } } } },
  { name: "calendar_add", description: "Add an event to his Google Calendar. start/end as ISO date-time (Monrovia = UTC), e.g. 2026-11-12T10:00:00Z.",
    input_schema: { type: "object", properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" }, notes: { type: "string" }, location: { type: "string" } }, required: ["title", "start"] } },
  { name: "price_lookup", description: "Search the group's PRICING DATABASE (every priced line from past quotes, BOQs, supplier price lists, invoices and cost breakdowns: item, spec, unit, unit price, currency, supplier, date, project, source file). Use FIRST whenever the Chairman asks to price, cost or estimate anything. query = item words, e.g. 'LED bulb 12W', 'rebar 12mm', 'cement', 'split AC 24000'. Optional currency filter (USD, SLE, LRD).",
    input_schema: { type: "object", properties: { query: { type: "string" }, currency: { type: "string" }, max: { type: "string" } }, required: ["query"] } },
  { name: "draw_plan", description: "Draw a FLOOR PLAN / PARTITION PLAN / office or room LAYOUT as real CAD files: a PDF to view and print plus a DXF that opens in AutoCAD, saved in Drive. Use this (not image generation) whenever he asks to draw, lay out, partition or re-plan a floor, office, apartment or building. If he refers to an existing plan in Drive, first find it with drive_search and pass its PDF file id as base_file_id (it must be a PDF exported from AutoCAD, not a photo). Put the whole request in brief: rooms wanted, sizes, where the entrance / fire exit / columns are, what to keep. For changes to the last drawing pass revise 'true' and only the changes in brief. It runs in the background: tell him the PDF and AutoCAD links will come on WhatsApp in about 3 minutes.",
    input_schema: { type: "object", properties: { brief: { type: "string" }, base_file_id: { type: "string" }, folder_id: { type: "string" }, company: { type: "string" }, title: { type: "string" }, revise: { type: "string" } }, required: ["brief"] } },
  { name: "draw_elevations", description: "Draw the ELEVATIONS (all four sides), a SECTION through the middle and a 3D massing view of a building, with levels, grid and all measurements, as one PDF + one AutoCAD DXF in Drive. Use whenever he asks for elevations, sections, facades, heights or a 3D/massing view of a building. Put in brief: footprint size, column grid, every floor with its height (e.g. 3.5 m floor to floor), partial floors such as a mezzanine and where it sits, double-height areas, roof terrace and any rooftop restaurant/pavilion, the stair/lift core position, facade type (glass curtain wall / windows / solid) and the entrance. It uses the last floor plan AMI drew for the outline and core unless use_last_plan is 'false'.",
    input_schema: { type: "object", properties: { brief: { type: "string" }, folder_id: { type: "string" }, title: { type: "string" }, use_last_plan: { type: "string" } }, required: ["brief"] } },
  { name: "drive_save_image", description: "Save a file from a web link (e.g. a generated image) into a Drive folder.",
    input_schema: { type: "object", properties: { url: { type: "string" }, folder_id: { type: "string" }, name: { type: "string" } }, required: ["url", "folder_id", "name"] } },
];
export const GOOGLE_NAMES = new Set(GOOGLE_TOOLS.map((t) => t.name));
export async function runGoogleTool(name: string, p: any): Promise<any> {
  switch (name) {
    case "inbox_digest": return await inboxDigest(p.query, +p.max_results || 40);
    case "gmail_read": return await gmailRead(p.id);
    case "inbox_archive": return await inboxArchive(p);
    case "gmail_draft": return await gmailDraft(p);
    case "drive_search": return await driveSearch(p);
    case "drive_read": return await driveRead(p);
    case "sheet_read": return await sheetRead(p);
    case "calendar_events": return await calendarEvents(p);
    case "calendar_add": return await calendarAdd(p);
    case "price_lookup": return await priceLookup(p);
    case "draw_plan": return await drawPlan(p);
    case "draw_elevations": return await drawElevations(p);
    case "drive_save_image": return await driveSaveFromUrl({ url: p.url, folder_id: p.folder_id, name: p.name });
  }
  throw new Error("Unknown tool " + name);
}
