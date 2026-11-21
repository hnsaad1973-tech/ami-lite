// saycall v1.1 — AMI phones the Chairman (his number only) and reads a message twice. POST {text} or {check: callSid} with x-internal-key.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TOK = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const FROM = Deno.env.get("TWILIO_VOICE_FROM") || Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const SELF = "+231777170170";
const AUTH = () => ({ Authorization: "Basic " + btoa(`${SID}:${TOK}`) });
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
Deno.serve(async (req) => {
  const k = await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } })).json();
  if (!k?.[0]?.value || req.headers.get("x-internal-key") !== k[0].value) return Response.json({ error: "denied" }, { status: 403 });
  const b = await req.json();
  if (b.check) {
    const c = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls/${b.check}.json`, { headers: AUTH() })).json();
    const n = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Notifications.json?PageSize=3`, { headers: AUTH() })).json();
    return Response.json({ status: c.status, duration: c.duration, from: c.from, to: c.to, answered_by: c.answered_by, notes: (n.notifications || []).map((x: any) => ({ code: x.error_code, at: x.date_created, msg: String(x.message_text || "").slice(0, 200) })) });
  }
  const v = 'voice="Polly.Amy-Neural" language="en-GB"';
  const twiml = `<Response><Pause length="1"/><Say ${v}>${xml(b.text)}</Say><Pause length="2"/><Say ${v}>Again.</Say><Say ${v}>${xml(b.text)}</Say></Response>`;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, { method: "POST", headers: { ...AUTH(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: FROM, To: SELF, Twiml: twiml, Timeout: "45" }) });
  const j = await r.json().catch(() => ({}));
  return Response.json({ ok: r.ok, sid: j.sid, status: j.status, from: FROM, error: j.message });
});
