// AMI Commercial — `notify` v1.0 (14 Nov 2026) — phone notifications: calendar 30 min before, 8am to-do brief (run every 5 min by pg_cron); test send for a signed-in user
import webpush from "npm:web-push@3.6.7";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });

let keys: Record<string, string> | null = null;
async function getKeys() {
  if (keys) return keys;
  const r = await db("app_secrets?select=name,value");
  const rows: any[] = r.ok ? await r.json() : [];
  keys = Object.fromEntries(rows.map((x) => [x.name, x.value]));
  webpush.setVapidDetails("mailto:assetmanagementami@gmail.com", keys.vapid_public, keys.vapid_private);
  return keys;
}

async function sendTo(user: string, payload: any): Promise<number> {
  const r = await db(`push_subs?user_id=eq.${user}&select=id,endpoint,p256dh,auth`);
  const subs: any[] = r.ok ? await r.json() : [];
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) await db(`push_subs?id=eq.${s.id}`, { method: "DELETE" });
      console.log("push failed", code, String(e?.body || e?.message || e).slice(0, 200));
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const k = await getKeys();
    const body = await req.json().catch(() => ({}));
    // Scheduled run
    if (req.headers.get("x-cron-key") === k.notify_key) {
      const r = await fetch(`${SB}/rest/v1/rpc/notify_candidates`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: "{}" });
      const rows: any[] = r.ok ? await r.json() : [];
      let sent = 0;
      for (const x of rows) sent += await sendTo(x.user_id, { title: x.title, body: x.body, tag: x.tag, url: "./" });
      return json({ ok: true, items: rows.length, sent });
    }
    // Test from the app
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: req.headers.get("Authorization") || "", apikey: ANON } });
    if (!ur.ok) return json({ error: "Please sign in again." }, 401);
    const user = await ur.json();
    if (body.test) {
      const sent = await sendTo(user.id, { title: "AMI", body: "Notifications are working. You'll get calendar alerts 30 minutes before, and your to-dos at 8am.", tag: "test", url: "./" });
      return json(sent ? { sent } : { sent: 0, error: "No phone is set up for notifications yet." });
    }
    return json({ error: "Nothing to do." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
