// AMI `monthlyforms` v1.0 (19 Nov 2026) — monthly Actual Update forms for Leone Investment and Cape Realities, by email.
// Key-protected (x-internal-key = ami_settings.wake_key). No Zapier.
//   {action:"send", dry?:true, force_month?:"2027-01"}
//      On the 1st of each month: exports the Actual Update forms as Excel files and emails them to Leone
//      (info@leone-investment.com), two emails with their own heading: one for Leone Investment, one for Cape Realities
//      (Cape Real Estate + Cape Construction). Skips months before January 2027 (the forms are for 2027 actuals).
//   {action:"collect", dry?:true}
//      Every morning: looks in Gmail for replies from Leone with the filled Excel files attached, reads each file,
//      posts its 'Actual 2027' figures into the company's projection file and the Drive form, and tells the Chairman on WhatsApp.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TO = "info@leone-investment.com", FROM_NAME = "Hussein Saad";
const GROUPS = [
  { heading: "Leone Investment", companies: ["Leone Investment"] },
  { heading: "Cape Realities", companies: ["Cape Real Estate", "Cape Construction"] },
];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SH = "https://sheets.googleapis.com/v4/spreadsheets";
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const brain = async (key: string) => (await (await db(`ami_brain?key=eq.${key}&select=data`)).json())?.[0]?.data;
const store = (key: string, data: unknown) => db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }) });
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); return j.access_token as string;
}
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64url = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const utf8b64 = (s: string) => b64(new TextEncoder().encode(s));
const wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function lastMonth(force?: string) {
  if (force) { const [y, m] = force.split("-").map(Number); return { y, m }; }
  const d = new Date(); const m = d.getUTCMonth(); // 0-based current month
  return m === 0 ? { y: d.getUTCFullYear() - 1, m: 12 } : { y: d.getUTCFullYear(), m };
}

async function notify(text: string, key: string) {
  await fetch(`${SB}/functions/v1/amisend`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify({ action: "notify", text }) }).catch(() => null);
}

Deno.serve(async (req) => {
  try {
    const key = (await (await db("ami_settings?key=eq.wake_key&select=value")).json())?.[0]?.value;
    if (!key || req.headers.get("x-internal-key") !== key) return Response.json({ error: "denied" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const t = await token(); const H = { Authorization: "Bearer " + t };
    const g = async (u: string, init: RequestInit = {}) => { const r = await fetch(u, { ...init, headers: { ...H, "Content-Type": "application/json", ...(init.headers || {}) } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`); return j; };
    const forms: any[] = (await brain("actual_forms")) || [];
    const formOf = (c: string) => forms.find((f) => f.company === c);

    if (body.action === "send") {
      const { y, m } = lastMonth(body.force_month);
      if (y < 2027) return Response.json({ sent: false, reason: `skipped: ${MONTHS[m - 1]} ${y} is before January 2027` });
      const label = `${MONTHS[m - 1]} ${y}`, out: any[] = [];
      for (const grp of GROUPS) {
        const atts: { name: string; data: string }[] = [];
        for (const c of grp.companies) {
          const f = formOf(c); if (!f) throw new Error("no form for " + c);
          if (!body.dry) await g(`${SH}/${f.form_id}/values/${encodeURIComponent("'Actual 2027'!B3")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["DRAFT"]] }) });
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.form_id}/export?mimeType=${encodeURIComponent(XLSX)}`, { headers: H });
          if (!r.ok) throw new Error(`export ${c}: ${r.status}`);
          atts.push({ name: `AMI Actual Update - ${c}.xlsx`, data: b64(new Uint8Array(await r.arrayBuffer())) });
        }
        const subject = `${grp.heading} — Actual Update — ${label}`;
        const list = grp.companies.map((c) => `<li><b>${c}</b>: file "AMI Actual Update - ${c}.xlsx"</li>`).join("");
        const html = `<h2 style="font-family:Arial">${grp.heading}</h2><h3 style="font-family:Arial;font-weight:normal">Actual Update — ${label}</h3>
<p style="font-family:Arial">Dear Hachem,</p>
<p style="font-family:Arial">Please find attached the Actual Update form${atts.length > 1 ? "s" : ""} for ${grp.heading}:</p><ul style="font-family:Arial">${list}</ul>
<p style="font-family:Arial">Please:</p><ol style="font-family:Arial">
<li>Open the <b>Actual 2027</b> tab and fill only the yellow column for <b>${label}</b>: what was really received (income) and really paid (costs).</li>
<li>Costs and payments are negative numbers (e.g. -14250). Income is positive.</li>
<li>Do not change line names, totals or formulas. Anything new goes in the Notes column Q with the amount.</li>
<li>Save the file and <b>reply to this email with the file${atts.length > 1 ? "s" : ""} attached</b> by the 5th of the month. Please keep the file name${atts.length > 1 ? "s" : ""}.</li></ol>
<p style="font-family:Arial">AMI will post the figures automatically when your reply arrives.</p>
<p style="font-family:Arial">Regards,<br>Hussein Saad</p>`;
        const bd = "amib" + crypto.randomUUID().replace(/-/g, "");
        let mime = `To: ${TO}\r\nSubject: =?UTF-8?B?${utf8b64(subject)}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${bd}"\r\n\r\n`;
        mime += `--${bd}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(utf8b64(html))}\r\n`;
        for (const a of atts) mime += `--${bd}\r\nContent-Type: ${XLSX}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(a.data)}\r\n`;
        mime += `--${bd}--`;
        if (body.dry) { out.push({ subject, attachments: atts.map((a) => a.name), bytes: mime.length }); continue; }
        const s = await g("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(utf8b64(mime)) }) });
        out.push({ subject, id: s.id, attachments: atts.map((a) => a.name) });
      }
      if (!body.dry) {
        await store("monthlyforms_sent", { month: `${y}-${String(m).padStart(2, "0")}`, at: new Date().toISOString(), emails: out });
        await notify(`Actual Update forms for ${label} were emailed to Leone (${TO}): one for Leone Investment, one for Cape Realities. AMI will post the figures when Hachem replies.`, key);
      }
      return Response.json({ sent: !body.dry, month: label, emails: out });
    }

    if (body.action === "collect") {
      const done: string[] = (await brain("monthlyforms_processed")) || [];
      const q = encodeURIComponent(`from:${TO} subject:"Actual Update" has:attachment newer_than:45d`);
      const list = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=20`);
      const posted: string[] = [], problems: string[] = [];
      for (const msg of list.messages || []) {
        if (done.includes(msg.id)) continue;
        const full = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`);
        const parts: any[] = []; const walk = (p: any) => { if (!p) return; if (p.filename && p.body?.attachmentId) parts.push(p); (p.parts || []).forEach(walk); }; walk(full.payload);
        const xl = parts.filter((p) => /\.xlsx?$/i.test(p.filename));
        if (!xl.length) { done.push(msg.id); continue; }
        for (const p of xl) {
          try {
            const a = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${p.body.attachmentId}`);
            const bytes = fromB64url(a.data);
            // upload as a temporary Google Sheet to read it
            const bd = "amiu" + Date.now();
            const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: "tmp-actual-" + msg.id, mimeType: "application/vnd.google-apps.spreadsheet" })}\r\n--${bd}\r\nContent-Type: ${XLSX}\r\n\r\n`);
            const post = new TextEncoder().encode(`\r\n--${bd}--`);
            const up = new Uint8Array(pre.length + bytes.length + post.length); up.set(pre); up.set(bytes, pre.length); up.set(post, pre.length + bytes.length);
            const ur = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { ...H, "Content-Type": `multipart/related; boundary=${bd}` }, body: up });
            const tmp = await ur.json(); if (!ur.ok) throw new Error("upload " + JSON.stringify(tmp).slice(0, 150));
            try {
              const how = await g(`${SH}/${tmp.id}/values/${encodeURIComponent("'How to fill'!A1")}`).catch(() => ({}));
              const title = String(how.values?.[0]?.[0] || "") + " " + p.filename;
              const f = forms.find((x) => title.includes(x.company)) ;
              if (!f || !["Leone Investment", "Cape Real Estate", "Cape Construction"].includes(f.company)) throw new Error(`cannot tell which company "${p.filename}" is`);
              const v = await g(`${SH}/${tmp.id}/values/${encodeURIComponent("'Actual 2027'!A4:Q80")}?valueRenderOption=FORMULA`);
              if (!v.values?.length) throw new Error(`${p.filename}: 'Actual 2027' tab empty or missing`);
              if (!body.dry) {
                for (const target of [f.projection_id, f.form_id]) {
                  await g(`${SH}/${target}/values/${encodeURIComponent("'Actual 2027'!A4:Q80")}:clear`, { method: "POST", body: "{}" });
                  await g(`${SH}/${target}/values/${encodeURIComponent("'Actual 2027'!A4")}?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ values: v.values }) });
                }
                await g(`${SH}/${f.form_id}/values/${encodeURIComponent("'Actual 2027'!B3")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["IMPORTED " + new Date().toISOString().slice(0, 10)]] }) });
              }
              posted.push(f.company);
            } finally {
              await fetch(`https://www.googleapis.com/drive/v3/files/${tmp.id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
            }
          } catch (e) { problems.push((e as Error).message); }
        }
        done.push(msg.id);
      }
      if (!body.dry) {
        await store("monthlyforms_processed", done.slice(-200));
        await store("monthlyforms_collect", { at: new Date().toISOString(), posted, problems });
        if (posted.length || problems.length) await notify((posted.length ? `AMI posted the Actual Update figures for: ${posted.join(", ")}.` : "") + (problems.length ? ` Problems: ${problems.join("; ")}` : ""), key);
      }
      return Response.json({ posted, problems, checked: (list.messages || []).length });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
