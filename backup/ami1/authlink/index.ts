// authlink: makes a one-time sign-in link for the Chairman (internal key only). No email is sent.
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
Deno.serve(async (req) => {
  const k = req.headers.get("x-internal-key") || "";
  const kr = await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: H });
  const wk = (await kr.json())?.[0]?.value;
  if (!wk || k !== wk) return new Response(JSON.stringify({ error: "denied" }), { status: 403 });
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: H,
    body: JSON.stringify({ type: "magiclink", email: "hnsaad1973@gmail.com", redirect_to: "https://hnsaad1973-tech.github.io/ami-lite/" }) });
  const j = await r.json().catch(() => ({}));
  return new Response(JSON.stringify({ status: r.status, link: j.action_link || j.properties?.action_link || null, err: j.msg || j.error_description || null }), { headers: { "Content-Type": "application/json" } });
});
