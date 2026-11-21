// AMI `equity` v1.1 (18 Nov 2026) — Capital & shareholder equity per company (Companies tile); v1.1: Personal account (personal_get / personal_save, ami_brain key "personal_account").
// Stored in ami_brain key "company_equity": { "<company>": { share_capital, shareholders:[{name,pct}], note, updated } }
// Equity itself = the company's net position from the Master Brain; retained earnings = equity - share capital (worked out in the app).
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const OWNER = "hnsaad1973@gmail.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function load() { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.company_equity&select=data,updated_at`, { headers: H }); const j = r.ok ? await r.json() : []; return j[0]?.data || {}; }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: ANON } });
  if (!u.ok) return json({ error: "Not signed in." }, 401);
  if (String((await u.json()).email || "").toLowerCase() !== OWNER) return json({ error: "Access denied." }, 403);
  const all = await load();
  if (p.action === "personal_get") { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.personal_account&select=data`, { headers: H }); const j = r.ok ? await r.json() : []; return json({ personal: j[0]?.data || { items: [] } }); }
  if (p.action === "personal_save") {
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 200).map((x: any) => ({ group: ["company", "other", "owed_to_me"].includes(x.group) ? x.group : "other", who: String(x.who || "").trim().slice(0, 80),
      amount: Math.round(Number(String(x.amount ?? "").replace(/[$,\s]/g, "")) * 100) / 100, note: String(x.note || "").trim().slice(0, 200) })).filter((x: any) => x.who && isFinite(x.amount));
    const data = { items, as_of: new Date().toISOString().slice(0, 10) };
    const w = await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "personal_account", data, updated_at: new Date().toISOString() }) });
    return w.ok ? json({ ok: true, personal: data }) : json({ error: "Database error " + w.status }, 500);
  }
  if (p.action === "get") return json({ equity: all });
  if (p.action === "save") {
    const name = String(p.company || "").slice(0, 80); if (!name) return json({ error: "No company." }, 400);
    const cap = Number(String(p.share_capital ?? "").replace(/[$,\s]/g, ""));
    const sh = (Array.isArray(p.shareholders) ? p.shareholders : []).map((x: any) => ({ name: String(x.name || "").trim().slice(0, 80), pct: Math.round(Number(x.pct) * 100) / 100 }))
      .filter((x: any) => x.name && isFinite(x.pct) && x.pct > 0);
    const tot = sh.reduce((a: number, x: any) => a + x.pct, 0);
    if (tot > 100.01) return json({ error: `Shareholdings add up to ${tot}% — more than 100%.` }, 400);
    all[name] = { share_capital: isFinite(cap) && String(p.share_capital ?? "").trim() !== "" ? cap : null, shareholders: sh, note: String(p.note || "").slice(0, 300), updated: new Date().toISOString().slice(0, 10) };
    const w = await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "company_equity", data: all, updated_at: new Date().toISOString() }) });
    return w.ok ? json({ ok: true, equity: all }) : json({ error: "Database error " + w.status }, 500);
  }
  return json({ error: "Unknown action." }, 400);
});
