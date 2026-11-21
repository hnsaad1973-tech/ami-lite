// billcheck v2: live balances for AMI's prepaid services (internal key only). {"alert":true} = daily check: WhatsApp the Chairman if Twilio is below $10 or a key stops working.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const SELF = "+231777170170";
const LOW = 10;
Deno.serve(async (req) => {
  const k = req.headers.get("x-internal-key") || "";
  const r = await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const wk = r.ok ? (await r.json())[0]?.value : "";
  if (!wk || k !== wk) return new Response("denied", { status: 403 });
  let alert = false; try { alert = !!(await req.json()).alert; } catch (_) {}
  const out: any = {};
  try { const b = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Balance.json`, { headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`) } }); out.twilio = await b.json(); } catch (e) { out.twilio = String(e); }
  try { const a = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 5, messages: [{ role: "user", content: "ok" }] }) }); out.anthropic = a.ok ? "ok" : (await a.text()).slice(0, 200); } catch (e) { out.anthropic = String(e); }
  try { const o = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer " + (Deno.env.get("OPENAI_API_KEY") || "") } }); out.openai_key = o.ok ? "valid" : o.status; } catch (e) { out.openai_key = String(e); }
  if (alert) {
    const msgs: string[] = [];
    const bal = parseFloat(out.twilio?.balance ?? "NaN");
    if (isFinite(bal) && bal < LOW) msgs.push(`💳 Twilio balance is $${bal.toFixed(2)} — below $${LOW}. Top up now or WhatsApp and calls will stop: https://console.twilio.com/us1/billing/manage-billing/billing-overview`);
    if (out.anthropic !== "ok") msgs.push("🧠 AMI's brain (Anthropic API) is failing — credit may be finished: https://console.anthropic.com/settings/billing");
    if (msgs.length) {
      const body = "⚠️ AMI subscription check:\n" + msgs.join("\n");
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: body }) }).catch(() => null);
      out.alert_sent = msgs;
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
