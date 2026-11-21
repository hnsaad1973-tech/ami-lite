// AMI `leadfs` v1.1 (19 Nov 2026; v1.1 balance sheet limited to reported months) — The Lead Business Living: monthly financial statements in, accounts updated automatically.
// Key-protected (x-internal-key = ami_settings.wake_key). No Zapier. Runs every 30 minutes (cron ami-lead-fs).
//   {action:"check", dry?:true, file_id?}
//      Looks in Gmail (last 10 days, not from the Chairman) for Excel attachments that contain The Lead's
//      'IS USD Monthly' and 'BS_USD' sheets (e.g. sent by Ghina). For each new one, reads every account by code and
//      posts the 2026 months into "The Lead Business Living — Accounts 2026 (AMI)": P&L 2026 (C:N) and Balance Sheet 2026 (D:O),
//      moves the Actual vs Budget month counter, saves the file in The Lead's Drive folder and tells the Chairman on WhatsApp.
//      file_id = import a Drive file directly instead of Gmail (for files dropped in Drive).
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ACCOUNTS = "1NTq642KxcAGfbTsls9GcKBfO9jvGM3LDILlYJfz8UpY";
const FOLDER = "1L9re05g2QOLBJkE55YfNPLMPItvTtWpX"; // The Lead › 01 Position, Balance sheet & Monthly briefs
const YEAR = 2026;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SH = "https://sheets.googleapis.com/v4/spreadsheets";
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const brain = async (key: string) => (await (await db(`ami_brain?key=eq.${key}&select=data`)).json())?.[0]?.data;
const store = (key: string, data: unknown) => db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }) });
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const col = (n: number) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// Google Sheets serial date -> {y, m}
const serial = (v: unknown) => { if (typeof v !== "number" || v < 30000 || v > 80000) return null; const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); return j.access_token as string;
}

Deno.serve(async (req) => {
  try {
    const key = (await (await db("ami_settings?key=eq.wake_key&select=value")).json())?.[0]?.value;
    if (!key || req.headers.get("x-internal-key") !== key) return Response.json({ error: "denied" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const t = await token(); const H = { Authorization: "Bearer " + t };
    const g = async (u: string, init: RequestInit = {}) => { const r = await fetch(u, { ...init, headers: { ...H, "Content-Type": "application/json", ...(init.headers || {}) } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`); return j; };
    const notify = (text: string) => fetch(`${SB}/functions/v1/amisend`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify({ action: "notify", text }) }).catch(() => null);

    // upload xlsx bytes as a Google Sheet (in The Lead folder when keep=true, else temporary)
    async function toSheet(bytes: Uint8Array, name: string, keep: boolean) {
      const bd = "amil" + Date.now();
      const meta = { name, mimeType: "application/vnd.google-apps.spreadsheet", ...(keep ? { parents: [FOLDER] } : {}) };
      const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: ${XLSX}\r\n\r\n`);
      const post = new TextEncoder().encode(`\r\n--${bd}--`);
      const up = new Uint8Array(pre.length + bytes.length + post.length); up.set(pre); up.set(bytes, pre.length); up.set(post, pre.length + bytes.length);
      const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { ...H, "Content-Type": `multipart/related; boundary=${bd}` }, body: up });
      const j = await r.json(); if (!r.ok) throw new Error("upload " + JSON.stringify(j).slice(0, 150)); return j.id as string;
    }
    const vals = async (id: string, range: string) => (await g(`${SH}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];

    // read one FS sheet: returns {months:[1..12 present], rows:[{code, occ, values{m:val}}]}
    async function readFS(id: string, sheet: string, headerScan: number) {
      const v = await vals(id, `'${sheet}'!A1:T400`);
      let hr = -1, jan = -1;
      for (let i = 0; i < Math.min(headerScan, v.length); i++) {
        const row = v[i] || [];
        for (let c = 0; c < row.length; c++) { const d = serial(row[c]); if (d && d.y === YEAR && d.m === 1) { hr = i; jan = c; break; } }
        if (hr >= 0) break;
      }
      if (hr < 0) throw new Error(`${sheet}: no ${YEAR} month header found`);
      const rows: any[] = [], seen = new Map<number, number>(), present = new Set<number>();
      for (let i = hr + 1; i < v.length; i++) {
        const code = v[i]?.[0];
        if (typeof code !== "number" || code < 1000) continue;
        const occ = (seen.get(code) || 0) + 1; seen.set(code, occ);
        const values: Record<number, number> = {};
        for (let m = 1; m <= 12; m++) { const x = v[i][jan + m - 1]; if (typeof x === "number") { values[m] = x; if (x !== 0) present.add(m); } }
        rows.push({ code, occ, values });
      }
      return { months: [...present].sort((a, b) => a - b), rows };
    }

    // post into the accounts file
    async function post(fs: any, sheet: string, firstMonthCol: number, dry: boolean) {
      const target = await vals(ACCOUNTS, `'${sheet}'!A1:A400`);
      const where = new Map<string, number>(), seen = new Map<number, number>();
      target.forEach((r: any[], i: number) => { const c = r?.[0]; if (typeof c === "number") { const o = (seen.get(c) || 0) + 1; seen.set(c, o); where.set(`${c}#${o}`, i + 1); } });
      const data: any[] = [], missing: number[] = [];
      for (const r of fs.rows) {
        const rowNo = where.get(`${r.code}#${r.occ}`);
        if (!rowNo) { if (Object.values(r.values).some((x: any) => x !== 0)) missing.push(r.code); continue; }
        for (const m of fs.months) data.push({ range: `'${sheet}'!${col(firstMonthCol + m - 1)}${rowNo}`, values: [[r.values[m] ?? 0]] });
      }
      if (!dry && data.length) for (let i = 0; i < data.length; i += 500)
        await g(`${SH}/${ACCOUNTS}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: data.slice(i, i + 500) }) });
      return { cells: data.length, missing };
    }

    async function importBytes(bytes: Uint8Array, name: string, from: string, dry: boolean) {
      const tmp = await toSheet(bytes, "tmp-leadfs-" + Date.now(), false);
      try {
        const meta = await g(`${SH}/${tmp}?fields=sheets.properties.title`);
        const titles = meta.sheets.map((s: any) => s.properties.title);
        if (!titles.includes("IS USD Monthly") || !titles.includes("BS_USD")) return null; // not The Lead's FS
        const is = await readFS(tmp, "IS USD Monthly", 30), bs = await readFS(tmp, "BS_USD", 12);
        if (is.months.length) bs.months = bs.months.filter((m: number) => is.months.includes(m)); // only months actually reported
        const a = await post(is, "P&L 2026", 2, dry);           // C = Jan
        const b = await post(bs, "Balance Sheet 2026", 3, dry); // D = Jan
        const last = Math.max(0, ...is.months);
        if (!dry && last) await g(`${SH}/${ACCOUNTS}/values/${encodeURIComponent("'Actual vs Budget'!C2")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[last]] }) });
        let saved = "";
        if (!dry && from !== "Drive") saved = await toSheet(bytes, name.replace(/\.xlsx?$/i, "") + ` (received ${new Date().toISOString().slice(0, 10)})`, true);
        return { file: name, from, is_months: is.months.map((m) => MON[m - 1]), bs_months: bs.months.map((m) => MON[m - 1]), pl_cells: a.cells, bs_cells: b.cells, new_accounts: [...new Set([...a.missing, ...b.missing])], saved };
      } finally {
        await fetch(`https://www.googleapis.com/drive/v3/files/${tmp}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      }
    }

    const results: any[] = [], problems: string[] = [];
    if (body.file_id) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${body.file_id}?alt=media`, { headers: H });
      if (!r.ok) throw new Error("download " + r.status);
      const res = await importBytes(new Uint8Array(await r.arrayBuffer()), body.name || "Drive file", "Drive", !!body.dry);
      if (res) results.push(res); else problems.push("not a The Lead financial statements file");
    } else {
      const done: string[] = (await brain("leadfs_processed")) || [];
      const q = encodeURIComponent(`has:attachment (filename:xlsx OR filename:xls) newer_than:10d -from:me`);
      const list = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=25`);
      for (const msg of list.messages || []) {
        if (done.includes(msg.id)) continue;
        const full = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`);
        const from = (full.payload?.headers || []).find((h: any) => h.name.toLowerCase() === "from")?.value || "";
        const parts: any[] = []; const walk = (p: any) => { if (!p) return; if (p.filename && p.body?.attachmentId) parts.push(p); (p.parts || []).forEach(walk); }; walk(full.payload);
        for (const p of parts.filter((x) => /\.xlsx?$/i.test(x.filename))) {
          if (/AMI Actual Update/i.test(p.filename)) continue; // handled by monthlyforms
          try {
            const a = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${p.body.attachmentId}`);
            const res = await importBytes(fromB64url(a.data), p.filename, from, !!body.dry);
            if (res) results.push(res);
          } catch (e) { problems.push(`${p.filename}: ${(e as Error).message}`); }
        }
        if (!body.dry) done.push(msg.id);
      }
      if (!body.dry) await store("leadfs_processed", done.slice(-300));
    }
    if (!body.dry && (results.length || problems.length)) {
      await store("leadfs_last", { at: new Date().toISOString(), results, problems });
      for (const r of results) await notify(`The Lead accounts updated from "${r.file}" (${r.from}): P&L months ${r.is_months.join(", ")}; balance sheet months ${r.bs_months.join(", ")}.${r.new_accounts.length ? " New account codes not yet in AMI: " + r.new_accounts.join(", ") + "." : ""}`);
      if (problems.length) await notify("The Lead accounts import problem: " + problems.join("; "));
    }
    return Response.json({ results, problems });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
