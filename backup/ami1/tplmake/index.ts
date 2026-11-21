// tplmake: create two WhatsApp templates with fixed wording and send them to Meta for approval (internal key only)
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const AUTH = "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`);
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const T = [
  { key: "inbox_content_sid", name: "ami_inbox_brief_v2", sample: "URGENT: Ecobank - transfer approval pending. Action: approve.",
    body: "Chairman, here is your inbox brief:\n\n{{1}}\n\nTap Noted or Action.", actions: [{ title: "Noted", id: "noted" }, { title: "Action", id: "action" }] },
  { key: "confirm_content_sid", name: "ami_confirm_orders_v2", sample: "1. Call the bank at 10:00 2. Send the lease to Hachem",
    body: "Chairman, please confirm these orders:\n\n{{1}}\n\nTap Confirm, or Change to edit them.", actions: [{ title: "Confirm", id: "confirm" }, { title: "Change", id: "change" }] },
];
Deno.serve(async (req) => {
  const k = await db("ami_settings?key=eq.wake_key&select=value").then((r) => r.json()).then((j) => j?.[0]?.value).catch(() => "");
  if (!k || req.headers.get("x-internal-key") !== k) return new Response("denied", { status: 403 });
  const p = await req.json().catch(() => ({}));
  const out: any[] = [];
  for (const t of T) {
    if (p.status) { // check approval of the stored ones
      const s = await db(`ami_settings?key=eq.${t.key}&select=value`).then((r) => r.json()).then((j) => j?.[0]?.value);
      const r = await fetch(`https://content.twilio.com/v1/Content/${s}/ApprovalRequests`, { headers: { Authorization: AUTH } });
      out.push({ name: t.name, sid: s, whatsapp: (await r.json().catch(() => ({})))?.whatsapp }); continue;
    }
    const c = await fetch("https://content.twilio.com/v1/Content", { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ friendly_name: t.name, language: "en", variables: { "1": t.sample },
        types: { "twilio/quick-reply": { body: t.body, actions: t.actions }, "twilio/text": { body: t.body } } }) });
    const cj = await c.json().catch(() => ({}));
    if (!cj.sid) { out.push({ name: t.name, error: cj }); continue; }
    const a = await fetch(`https://content.twilio.com/v1/Content/${cj.sid}/ApprovalRequests/whatsapp`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ name: t.name, category: "UTILITY" }) });
    const aj = await a.json().catch(() => ({}));
    // switch AMI to the new template (button ids unchanged, so Noted / Action / Confirm / Change keep working)
    await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: t.key, value: cj.sid }) });
    out.push({ name: t.name, sid: cj.sid, approval: aj });
  }
  return Response.json(out);
});
