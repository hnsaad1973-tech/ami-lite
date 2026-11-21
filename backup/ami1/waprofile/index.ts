// waprofile: read / update AMI's WhatsApp sender profile (Twilio Senders API). Internal key only.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const AUTH = "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`);
Deno.serve(async (req) => {
  const r = await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const wk = r.ok ? (await r.json())[0]?.value : "";
  if (!wk || req.headers.get("x-internal-key") !== wk) return new Response("denied", { status: 403 });
  const p = await req.json().catch(() => ({}));
  const list = await (await fetch("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=20", { headers: { Authorization: AUTH } })).json();
  const senders = list.senders || [];
  if (p.action !== "set_website") return Response.json({ senders: senders.map((s: any) => ({ sid: s.sid, id: s.sender_id, status: s.status, profile: s.profile })) });
  const s = senders.find((x: any) => String(x.sender_id).includes("16817351374"));
  if (!s) return Response.json({ error: "sender not found", senders });
  const u = await fetch(`https://messaging.twilio.com/v2/Channels/Senders/${s.sid}`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ profile: { websites: [{ website: p.website, label: "Website" }] } }) });
  return Response.json({ ok: u.ok, status: u.status, result: await u.json().catch(() => ({})) });
});
