// AMI `amisend` v1.4 (19 Nov 2026) — v1.4 adds {action:"notify", text}: one WhatsApp to the Chairman (ami_notice template, plain text fallback), no Zapier.
// AMI messages other people on WhatsApp for the Chairman, using Meta-approved templates.
// Key-protected (x-internal-key = ami_settings.wake_key). Actions:
//   {action:"status"}                                  -> approval status of AMI's templates
//   {action:"balance"}                                 -> Twilio account balance + recent usage
//   {action:"notify", text}                            -> one WhatsApp to the Chairman
//   {action:"submit", name, body, sample}               -> create + submit a template (UTILITY)
//   {action:"send", to, name, vars, label, once}        -> send an approved template; `once` = a key so a scheduled send goes out only once
//   {action:"media", b64 | file_id, filename, caption, mime}      -> send a file to the Chairman (falls back to a link via ami_notice if outside the 24h window)
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TOK = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374", SELF = "+231777170170";
const AUTH = "Basic " + btoa(`${SID}:${TOK}`);
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) } });
async function setting(k: string) { const r = await db(`ami_settings?key=eq.${encodeURIComponent(k)}&select=value`); return r.ok ? (await r.json())[0]?.value || "" : ""; }
async function put(k: string, v: string) { await db("ami_settings", { method: "POST", body: JSON.stringify({ key: k, value: v }), headers: { Prefer: "resolution=merge-duplicates" } }); }
async function templates(): Promise<any[]> {
  const r = await fetch("https://content.twilio.com/v2/ContentAndApprovals?PageSize=100", { headers: { Authorization: AUTH } });
  const j = await r.json().catch(() => ({}));
  return (j.contents || []).map((c: any) => ({ sid: c.sid, name: c.friendly_name, status: c.approval_requests?.status || "", reason: c.approval_requests?.rejection_reason || "", category: c.approval_requests?.category || "" }));
}
async function balance() {
  const b = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Balance.json`, { headers: { Authorization: AUTH } }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const acc = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`, { headers: { Authorization: AUTH } }).then((r) => r.json()).catch(() => ({}));
  const u = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Usage/Records/Last7Days.json?Category=totalprice`, { headers: { Authorization: AUTH } }).then((r) => r.json()).catch(() => ({}));
  const t = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Usage/Records/Today.json?Category=totalprice`, { headers: { Authorization: AUTH } }).then((r) => r.json()).catch(() => ({}));
  return { balance: b.balance, currency: b.currency, account_status: acc.status, account_name: acc.friendly_name, spent_last7: u.usage_records?.[0]?.price, spent_today: t.usage_records?.[0]?.price };
}
async function wa(params: Record<string, string>) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: `whatsapp:${FROM}`, ...params }) });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}
async function msgStatus(sid: string) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${sid}.json`, { headers: { Authorization: AUTH } });
  return await r.json().catch(() => ({}));
}
async function tellChairman(text: string) {
  const t = (await templates()).find((x) => x.name === "ami_notice" && x.status === "approved");
  if (t) { const r = await wa({ To: `whatsapp:${SELF}`, ContentSid: t.sid, ContentVariables: JSON.stringify({ "1": text.slice(0, 900).replace(/\s*\n+\s*/g, " ") }) }); if (r.ok && !r.j.error_code) return { ok: true, sid: r.j.sid, via: "template" }; }
  const r = await wa({ To: `whatsapp:${SELF}`, Body: text.slice(0, 1500) });
  return { ok: r.ok && !r.j.error_code, sid: r.j.sid, via: "text", error: r.ok ? null : r.j.message || r.j };
}
Deno.serve(async (req) => {
  try {
    const k = req.headers.get("x-internal-key") || "";
    if (!k || k !== await setting("wake_key")) return json({ error: "denied" }, 403);
    const b = await req.json().catch(() => ({}));
    if (b.action === "status") return json({ templates: await templates() });
    if (b.action === "balance") return json(await balance());
    if (b.action === "notify") {
      const text = String(b.text || "").trim();
      if (!text) return json({ error: "text required" }, 400);
      const r = await tellChairman(text);
      await db("ami_messages", { method: "POST", body: JSON.stringify({ user_email: "hnsaad1973@gmail.com", role: "assistant", section: "WhatsApp", content: text }) }).catch(() => null);
      return json({ sent: r.ok, ...r });
    }
    if (b.action === "submit") {
      const c = await fetch("https://content.twilio.com/v1/Content", { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ friendly_name: b.name, language: "en", variables: b.sample || {}, types: { "twilio/text": { body: b.body } } }) });
      const cj = await c.json().catch(() => ({}));
      if (!cj.sid) return json({ error: "create failed", cj }, 500);
      const a = await fetch(`https://content.twilio.com/v1/Content/${cj.sid}/ApprovalRequests/whatsapp`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json" }, body: JSON.stringify({ name: b.name, category: "UTILITY" }) });
      return json({ sid: cj.sid, approval: await a.json().catch(() => ({})) });
    }
    if (b.action === "media") {
      const fn = String(b.filename || "file.pdf").replace(/[^\w.\-]/g, "_"), path = `wa/${Date.now()}_${fn}`;
      let b64 = String(b.b64 || "");
      if (!b64 && b.file_id) { const g = await fetch(`${SB}/functions/v1/drivefile`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": k }, body: JSON.stringify({ action: "get", file_id: b.file_id }) }); const gj = await g.json().catch(() => ({})); if (!gj.b64) return json({ error: "drive get failed", gj }, 500); b64 = gj.b64; }
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const up = await fetch(`${SB}/storage/v1/object/studio/${path}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": b.mime || "application/pdf", "x-upsert": "true" }, body: bytes });
      if (!up.ok) return json({ error: "upload failed", detail: await up.text() }, 500);
      const sg = await fetch(`${SB}/storage/v1/object/sign/studio/${path}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 604800 }) });
      const sj = await sg.json().catch(() => ({}));
      const url = `${SB}/storage/v1${sj.signedURL || sj.signedUrl}`;
      const cap = String(b.caption || fn);
      const r = await wa({ To: `whatsapp:${SELF}`, Body: cap, MediaUrl: url });
      let status = r.j.status || "", via = "file";
      if (r.ok && r.j.sid) {
        for (let i = 0; i < 4 && !/delivered|read|failed|undelivered/.test(status); i++) { await new Promise((s) => setTimeout(s, 3000)); status = (await msgStatus(r.j.sid)).status || status; }
      }
      if (!r.ok || /failed|undelivered/.test(status)) { await tellChairman(`${cap} Open the file here: ${url}`); via = "link"; }
      await db("ami_messages", { method: "POST", body: JSON.stringify({ user_email: "hnsaad1973@gmail.com", role: "assistant", section: "WhatsApp", content: `Sent you a file on WhatsApp: ${fn}` }) }).catch(() => null);
      return json({ sent: true, via, status, sid: r.j.sid, url, error: r.ok ? null : r.j });
    }
    if (b.action === "send") {
      const once = b.once ? `sent:${b.once}` : "";
      if (once && (await setting(once))) return json({ sent: false, reason: "already sent" });
      const to = String(b.to || "").replace(/[^\d+]/g, ""), label = String(b.label || to);
      const vars: Record<string, string> = {};
      for (const [kk, v] of Object.entries(b.vars || {})) vars[kk] = String(v).replace(/\s*\n+\s*/g, " ").replace(/ {4,}/g, " ").trim();
      const t = (await templates()).find((x) => x.name === b.name);
      if (!t || t.status !== "approved") {
        if (b.last || !once || !(await setting(`warned:${b.once}`))) {
          if (once) await put(`warned:${b.once}`, new Date().toISOString());
          await tellChairman(b.last ? `AMI could not message ${label}: WhatsApp still has not approved the message format (${t ? t.status || "pending" : "missing"}). Please message him yourself.` : `AMI is waiting for WhatsApp to approve the message format before messaging ${label} (${t ? t.status || "pending" : "missing"}). It will send as soon as it is approved.`);
        }
        return json({ sent: false, reason: t ? t.status : "missing" });
      }
      const r = await wa({ To: `whatsapp:${to}`, ContentSid: t.sid, ContentVariables: JSON.stringify(vars) });
      const ok = r.ok && !r.j.error_code;
      if (ok && once) await put(once, r.j.sid || new Date().toISOString());
      await db("ami_messages", { method: "POST", body: JSON.stringify({ user_email: "hnsaad1973@gmail.com", role: "assistant", section: "WhatsApp", content: `Sent to ${label} (${to}): ${Object.values(vars).join(" | ")}` }) }).catch(() => null);
      await tellChairman(ok ? `Sent to ${label} on WhatsApp. His reply will be forwarded to you.` : `Could not send to ${label}: ${r.j.message || r.j.error_message || "error"}`);
      return json({ sent: ok, sid: r.j.sid, error: ok ? null : r.j });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
