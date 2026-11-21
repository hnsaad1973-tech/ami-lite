// secrelay v1.6 (button title without emoji, as WhatsApp requires); v1.5 (buttons inside the 24h window, approved template outside it); v1.4 ("✅ Noted" button on booth messages answers the tenant automatically); v1.3 (a bare unit number from the booth = "Received ✅"); v1.2 (approved WhatsApp template so booths get messages without writing first); v1.1 (On duty also shows the last 2 hours of tenant messages) — Leone Diplomatic Compound: tenant ↔ security booth messages without sharing phone numbers.
// Tenants use the web page (unit link + PIN). Booth phones get WhatsApp from AMI's number; guards reply "105 message".
// Actions: open / send (tenant page, CORS) · booth (internal key, called by whatup for booth phones).
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const SALT = "leone-sec-v1:";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function wakeKey() { const r = await db("ami_settings?key=eq.wake_key&select=value"); return r.ok ? (await r.json())[0]?.value || "" : ""; }
const TW_AUTH = () => "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`);
async function setting(k: string) { const r = await db(`ami_settings?key=eq.${k}&select=value`); return r.ok ? String((await r.json())[0]?.value || "") : ""; }
async function saveSetting(k: string, v: string) { await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: k, value: v }) }); }
// approved WhatsApp template = can message a booth phone any time, even if it has not written first
async function templateSid(): Promise<string> {
  const sid = await setting("sec_template_sid");
  if (!sid) return "";
  if (await setting("sec_template_ok") === "approved") return sid;
  const r = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, { headers: { Authorization: TW_AUTH() } });
  const j = await r.json().catch(() => ({}));
  const st = String(j?.whatsapp?.status || "");
  if (st) await saveSetting("sec_template_ok", st);
  return st === "approved" ? sid : "";
}
async function wa(to: string, unit: string, text: string, lastIn?: string | null) {
  // inside WhatsApp's 24h window (booth wrote to AMI recently) any message works, buttons included;
  // outside it only an approved template gets through
  const inSession = to === "+231777170170" || (!!lastIn && Date.now() - new Date(lastIn).getTime() < 23.5 * 3600000);
  const btn = await setting("sec_button_sid");
  const btnOk = btn && (await buttonStatus()) === "approved";
  const tpl = await templateSid();
  const sid = (btn && (inSession || btnOk)) ? btn : (tpl || "");
  const vars = JSON.stringify({ "1": `Unit ${unit}: ${text}`.slice(0, 900) });
  const form = sid ? new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${to}`, ContentSid: sid, ContentVariables: vars })
    : new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${to}`, Body: `🏠 Unit ${unit}: ${text}\n\nTo answer, reply: ${unit} your message`.slice(0, 1500) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST",
    headers: { Authorization: TW_AUTH(), "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json().catch(() => ({}));
  if (j.sid) await db("sec_outbound", { method: "POST", body: JSON.stringify({ sid: j.sid, unit, booth_phone: to }) });
  return r.ok && !j.error_code;
}
async function buttonStatus(): Promise<string> {
  const sid = await setting("sec_button_sid");
  if (!sid) return "";
  const known = await setting("sec_button_ok");
  if (known === "approved" || known === "rejected") return known;
  const r = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, { headers: { Authorization: TW_AUTH() } });
  const j = await r.json().catch(() => ({}));
  const st = String(j?.whatsapp?.status || "");
  if (st) await saveSetting("sec_button_ok", st);
  return st;
}
async function unitFor(token: string, pin: string) {
  if (!token || !/^\d{4}$/.test(pin)) return null;
  const r = await db(`sec_units?token=eq.${encodeURIComponent(token)}&active=eq.true&select=unit,pin_hash`);
  const u = r.ok ? (await r.json())[0] : null;
  if (!u) return null;
  return (await sha(SALT + u.unit + ":" + pin)) === u.pin_hash ? u.unit as string : null;
}
async function history(unit: string) {
  const r = await db(`sec_messages?unit=eq.${encodeURIComponent(unit)}&select=dir,body,created_at,delivered&order=created_at.desc&limit=30`);
  return r.ok ? (await r.json()).reverse() : [];
}
const clean = (s: string) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 500);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const p = await req.json().catch(() => ({}));

    // ---- one-time: create the WhatsApp template and send it to Meta for approval (internal key) ----
    if (p.action === "make_template" || p.action === "template_status") {
      if (req.headers.get("x-internal-key") !== await wakeKey()) return json({ error: "denied" }, 403);
      let sid = await setting("sec_template_sid");
      if (p.action === "make_template" && !sid) {
        const c = await fetch("https://content.twilio.com/v1/Content", { method: "POST", headers: { Authorization: TW_AUTH(), "Content-Type": "application/json" },
          body: JSON.stringify({ friendly_name: "compound_security_message", language: "en", variables: { "1": "Unit 105: Visitor arriving now, please let them in." },
            types: { "twilio/text": { body: "Compound security message for the booth. {{1}}. To answer, reply with the unit number first, for example: 105 OK." } } }) });
        const cj = await c.json().catch(() => ({}));
        if (!cj.sid) return json({ error: "create failed", detail: cj });
        sid = cj.sid; await saveSetting("sec_template_sid", sid);
        const a = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`, { method: "POST", headers: { Authorization: TW_AUTH(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "compound_security_message", category: "UTILITY" }) });
        const aj = await a.json().catch(() => ({}));
        await saveSetting("sec_template_ok", String(aj?.status || "submitted"));
        return json({ sid, approval: aj });
      }
      const r = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, { headers: { Authorization: TW_AUTH() } });
      const j = await r.json().catch(() => ({}));
      if (j?.whatsapp?.status) await saveSetting("sec_template_ok", j.whatsapp.status);
      return json({ sid, whatsapp: j?.whatsapp || j });
    }

    // ---- one-time: the message with a "✅ Noted" button, sent to Meta for approval (internal key) ----
    if (p.action === "make_buttons" || p.action === "buttons_status") {
      if (req.headers.get("x-internal-key") !== await wakeKey()) return json({ error: "denied" }, 403);
      let sid = await setting("sec_button_sid");
      if (p.action === "make_buttons" && !sid) {
        const c = await fetch("https://content.twilio.com/v1/Content", { method: "POST", headers: { Authorization: TW_AUTH(), "Content-Type": "application/json" },
          body: JSON.stringify({ friendly_name: "compound_security_noted_v2", language: "en", variables: { "1": "Unit 105: Visitor arriving now, please let them in." },
            types: { "twilio/quick-reply": { body: "Compound security message for the booth. {{1}}. Tap Noted, or reply with the unit number first, for example: 105 OK.", actions: [{ title: "Noted", id: "sec_noted" }] },
                     "twilio/text": { body: "Compound security message for the booth. {{1}}. Reply with the unit number first, for example: 105 OK." } } }) });
        const cj = await c.json().catch(() => ({}));
        if (!cj.sid) return json({ error: "create failed", detail: cj });
        sid = cj.sid; await saveSetting("sec_button_sid", sid);
        const a = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`, { method: "POST", headers: { Authorization: TW_AUTH(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "compound_security_noted_v2", category: "UTILITY" }) });
        const aj = await a.json().catch(() => ({}));
        await saveSetting("sec_button_ok", String(aj?.status || "submitted"));
        return json({ sid, approval: aj });
      }
      await saveSetting("sec_button_ok", "");
      const st = await buttonStatus();
      const r2 = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, { headers: { Authorization: TW_AUTH() } });
      return json({ sid, status: st, detail: await r2.json().catch(() => ({})) });
    }

    // ---- booth phone (from whatup) ----
    if (p.action === "booth") {
      if (req.headers.get("x-internal-key") !== await wakeKey()) return json({ error: "denied" }, 403);
      const from = String(p.from || "").replace("whatsapp:", "");
      const body = clean(p.body);
      const br = await db(`sec_booths?phone=eq.${encodeURIComponent(from)}&active=eq.true&select=phone,name`);
      const booth = br.ok ? (await br.json())[0] : null;
      if (!booth) return json({ reply: "" });
      await db(`sec_booths?phone=eq.${encodeURIComponent(from)}`, { method: "PATCH", body: JSON.stringify({ last_onduty: new Date().toISOString() }) });
      if (String(p.payload || "") === "sec_noted") {
        const or = await db(`sec_outbound?sid=eq.${encodeURIComponent(String(p.replied || ""))}&select=unit`);
        const hit = or.ok ? (await or.json())[0] : null;
        if (!hit) return json({ reply: "Noted, but I couldn't tell which unit. Reply with the unit number, e.g. 105 OK." });
        await db("sec_messages", { method: "POST", body: JSON.stringify({ unit: hit.unit, dir: "booth", body: "Noted ✅", booth: booth.name, delivered: true }) });
        return json({ reply: `✅ Unit ${hit.unit} told: Noted.` });
      }
      if (/^on\s*duty\b/i.test(body)) {
        // pass on tenant messages from the last 2 hours (they may not have reached this phone before it checked in)
        const since = new Date(Date.now() - 2 * 3600000).toISOString();
        const pr = await db(`sec_messages?dir=eq.tenant&created_at=gte.${since}&select=unit,body,created_at&order=created_at.asc&limit=10`);
        const recent: any[] = pr.ok ? await pr.json() : [];
        const list = recent.map((x) => `🏠 Unit ${x.unit} (${new Date(x.created_at).toISOString().slice(11, 16)} GMT): ${x.body}`).join("\n");
        return json({ reply: `✅ ${booth.name}: on duty noted. Tenant messages will come here.\nTo answer, start with the unit number, e.g.\n105 OK, driver let in${list ? "\n\nMessages from the last 2 hours:\n" + list : ""}` });
      }
      const m = /^(B1-?STUDIO|B4|\d{3})(?:[\s:.\-,]+(.+))?$/i.exec(body);
      if (!m) return json({ reply: "To answer a tenant, start with the unit number, e.g.\n105 OK, driver let in\n\nAt the start of each shift send: On duty" });
      const unit = m[1].toUpperCase().replace(/^B1-?STUDIO$/, "B1-STUDIO");
      const ur = await db(`sec_units?unit=eq.${encodeURIComponent(unit)}&select=unit`);
      if (!(ur.ok && (await ur.json())[0])) return json({ reply: `Unit ${unit} not found. Check the number and send again.` });
      await db("sec_messages", { method: "POST", body: JSON.stringify({ unit, dir: "booth", body: (m[2] || "Received ✅").slice(0, 500), booth: booth.name, delivered: true }) });
      return json({ reply: `✅ Sent to Unit ${unit}.` });
    }

    // ---- tenant page ----
    const unit = await unitFor(String(p.token || ""), String(p.pin || ""));
    if (!unit) return json({ error: "Wrong link or PIN." }, 401);
    if (p.action === "open") return json({ unit, messages: await history(unit) });
    if (p.action === "send") {
      const text = clean(p.text);
      if (!text) return json({ error: "Type a message first." }, 400);
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const cr = await db(`sec_messages?unit=eq.${encodeURIComponent(unit)}&dir=eq.tenant&created_at=gte.${since}&select=id`);
      if (cr.ok && (await cr.json()).length >= 10) return json({ error: "Too many messages. Please wait a few minutes." }, 429);
      const br = await db("sec_booths?active=eq.true&select=phone,name,last_onduty");
      const booths: any[] = br.ok ? await br.json() : [];
      let ok = false;
      for (const b of booths) if (await wa(b.phone, unit, text, b.last_onduty)) ok = true;
      await db("sec_messages", { method: "POST", body: JSON.stringify({ unit, dir: "tenant", body: text, delivered: ok }) });
      return json({ unit, delivered: ok, messages: await history(unit) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
