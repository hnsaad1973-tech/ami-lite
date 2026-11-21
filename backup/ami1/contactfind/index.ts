// contactfind: search the Contacts Master sheet (all rows) by words (internal key only)
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SHEET = "1mMRxkXwKLsAZ0FkbOPhgOVbxgcnGBSznm9aJ_DxPe34";
Deno.serve(async (req) => {
  const kr = await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const wk = (await kr.json())?.[0]?.value;
  if (!wk || req.headers.get("x-internal-key") !== wk) return new Response("denied", { status: 403 });
  let p: any = {}; try { p = await req.json(); } catch (_) {}
  const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "", grant_type: "refresh_token" }) })).json();
  const out: any = {};
  for (const tab of ["Contacts", "Needs check"]) {
    const v = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'${tab}'!A1:J7000`)}`, { headers: { Authorization: "Bearer " + t.access_token } })).json();
    const rows: string[][] = v.values || [];
    const res: any[] = [];
    for (const [i, r] of rows.entries()) {
      const line = r.join(" | ");
      if ((p.patterns || []).some((x: string) => new RegExp(x, "i").test(line))) res.push({ row: i + 1, line });
    }
    out[tab] = { total_rows: rows.length, matches: res };
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
