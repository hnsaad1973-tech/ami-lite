// platcheck v1.1 (20 Nov 2026: also returns last night's automatic check, run at 01:17 every night) — v1.0 (20 Nov 2026) — Platinum books check: one page showing that the accounts agree (entries balance, receivables = policies,
// Africa Re share on every ceded policy, commission = agents, creditors = suppliers, petty cash = petty cash book, no double posting, bank/cash not overdrawn).
// Runs plat.books_check(). Accounting, GM and CEO. Read-only.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Please sign in" }, 401);
    const [me] = await sql`select role from plat.users where lower(email) = ${email}`;
    if (!me || !["admin", "gm", "accountant"].includes(me.role)) return json({ error: "Not available for your role" }, 403);
    const body = await req.json().catch(() => ({}));
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : new Date().toISOString().slice(0, 10);
    const [last] = await sql`select ran_at, all_ok, pending, result from plat.check_runs order by id desc limit 1`;
    const L = last ? { ran_at: last.ran_at, all_ok: last.all_ok, pending: last.pending, failed: (last.result?.checks || []).filter((c: any) => !c.ok).map((c: any) => c.check) } : null;
    if (body.last_only) return json({ last: L });
    const [r] = await sql`select plat.books_check(${d}::date) r`;
    return json({ ...r.r, last: L });
  } catch (e) {
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
