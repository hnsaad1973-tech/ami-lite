// AMI `leadreminders` v1.0 (19 Nov 2026) — standing orders from Hussein Saad, sent by AMI to Ghina (info@leoneinvest-lib.com).
// Key-protected (x-internal-key = ami_settings.wake_key). No Zapier.
//   {action:"monthly", force_month?:"2026-10"} -> 15th of every month: request The Lead's financial statements for the previous month, due within 15 days.
//   {action:"budget", force_year?:2027}        -> every 15 November: request next year's budget, ready for presentation and approval by 15 December.
// Each send is logged in ami_brain (leadreminders_log) and the Chairman gets a WhatsApp notice.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TO = "info@leoneinvest-lib.com", COPY_TO = "hnsaad1973@gmail.com";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const b64 = (s: string) => { const u = new TextEncoder().encode(s); let x = ""; for (let i = 0; i < u.length; i += 0x8000) x += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(x); };
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); return j.access_token as string;
}
const SIGN = `<p style="font-family:Arial">Regards,<br><b>AMI, Assistant to Hussein Saad</b><br><span style="color:#666">(standing order from Hussein Saad)</span></p>`;

Deno.serve(async (req) => {
  try {
    const key = (await (await db("ami_settings?key=eq.wake_key&select=value")).json())?.[0]?.value;
    if (!key || req.headers.get("x-internal-key") !== key) return Response.json({ error: "denied" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    let subject = "", html = "", notice = "";
    if (body.action === "monthly") {
      let y: number, m: number; // previous month, 1-based
      if (body.force_month) [y, m] = body.force_month.split("-").map(Number);
      else { m = now.getUTCMonth(); y = now.getUTCFullYear(); if (m === 0) { m = 12; y--; } }
      const label = `${MONTHS[m - 1]} ${y}`;
      const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate() + 15, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate())));
      const dueLabel = `${due.getUTCDate()} ${MONTHS[due.getUTCMonth()]} ${due.getUTCFullYear()}`;
      subject = `Standing Order — The Lead financial statements for ${label}`;
      html = `<p style="font-family:Arial">Dear Ghina,</p><p style="font-family:Arial">This is a reminder that The Lead Business Living's financial statements for <b>${label}</b> are due. Please send the Excel file to ${COPY_TO} within 15 days, by <b>${dueLabel}</b>.</p>${SIGN}`;
      notice = `Standing order sent to Ghina: The Lead financial statements for ${label}, due ${dueLabel}.`;
    } else if (body.action === "budget") {
      const year = Number(body.force_year) || now.getUTCFullYear() + 1;
      const dueYear = year - 1;
      subject = `Standing Order — The Lead ${year} budget for approval`;
      html = `<p style="font-family:Arial">Dear Ghina,</p><p style="font-family:Arial">Please prepare The Lead Business Living's budget for <b>${year}</b>. It should be ready for presentation and approval no later than <b>15 December ${dueYear}</b>. Please send it in Excel to ${COPY_TO}.</p>${SIGN}`;
      notice = `Standing order sent to Ghina: The Lead ${year} budget, ready for approval by 15 December ${dueYear}.`;
    } else return Response.json({ error: "unknown action" }, { status: 400 });

    if (body.dry) return Response.json({ to: TO, subject, html });
    const mime = `To: ${TO}\r\nSubject: =?UTF-8?B?${b64(subject)}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html).replace(/(.{76})/g, "$1\r\n")}`;
    const t = await token();
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ raw: b64url(mime) }) });
    const j = await r.json(); if (!r.ok) throw new Error("gmail " + JSON.stringify(j).slice(0, 200));
    const prev = (await (await db("ami_brain?key=eq.leadreminders_log&select=data")).json())?.[0]?.data || [];
    await db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "leadreminders_log", data: [...prev, { at: now.toISOString(), subject, id: j.id }].slice(-60), updated_at: now.toISOString() }) });
    await fetch(`${SB}/functions/v1/amisend`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify({ action: "notify", text: notice }) }).catch(() => null);
    return Response.json({ sent: true, subject, id: j.id });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
