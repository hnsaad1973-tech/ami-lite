// driveperm: inspect / fix ownership-transfer permissions (internal key only)
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") || "", grant_type: "refresh_token" }) });
  return (await r.json()).access_token as string;
}
Deno.serve(async (req) => {
  const r = await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const wk = r.ok ? (await r.json())[0]?.value : "";
  if (!wk || req.headers.get("x-internal-key") !== wk) return new Response("denied", { status: 403 });
  const p = await req.json().catch(() => ({}));
  const t = await token(); const H = { Authorization: "Bearer " + t, "Content-Type": "application/json" };
  const out: any[] = [];
  for (const id of (p.ids || [])) {
    if (p.fix) {
      const x = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions/${p.perm}?fields=*`, { method: "PATCH", headers: H, body: JSON.stringify({ role: "writer", pendingOwner: true }) });
      out.push({ id, fix: x.status, r: (await x.text()).slice(0, 300) });
    } else {
      const x = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?fields=*`, { headers: H });
      out.push({ id, r: (await x.text()).slice(0, 1200) });
    }
  }
  return Response.json(out);
});
