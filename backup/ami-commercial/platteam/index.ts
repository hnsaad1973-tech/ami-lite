// platteam v1.0 (20 Nov 2026) — Platinum team and access, up to the licence limit (10 users). CEO only.
// Adding a person creates their sign-in at the same time (email code sign-in, no password); removing a person stops their access at once
// and keeps them on a removed list so they can be restored. You cannot remove yourself or the last CEO. Every change is in plat.audit.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const ROLES = ["admin", "gm", "accountant", "underwriter", "sales", "board", "viewer"];
class Stop extends Error {}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Please sign in" }, 401);
    const [me] = await sql`select role from plat.users where lower(email) = ${email}`;
    if (!me || me.role !== "admin") return json({ error: "Only the CEO manages team and access" }, 403);
    const body = await req.json().catch(() => ({}));
    const a = String(body.action || "");
    const audit = (detail: unknown) => sql`insert into plat.audit(email, action, detail) values (${email}, ${"team_" + a}, ${sql.json((detail ?? {}) as any)})`;
    const [lic] = await sql`select value from plat.settings where key='licence'`;
    const max = Number(lic?.value?.max_users || 10);

    if (a === "list") {
      const users = await sql`select email, name, title, role, authority_limit, added_at::date added_on from plat.users order by role = 'admin' desc, role, name`;
      const removed = await sql`select email, name, title, role, disabled_at::date removed_on, disabled_by removed_by from plat.users_disabled order by disabled_at desc`;
      return json({ users, removed, licence: { licensee: lic?.value?.licensee || "", max_users: max, used: users.length } });
    }

    if (a === "save") {
      const x = body.u || {};
      const em = String(x.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return json({ error: "Enter a valid email" }, 400);
      const role = ROLES.includes(x.role) ? x.role : "viewer";
      const name = String(x.name || "").trim() || null; const title = String(x.title || "").trim() || null;
      const lim = x.authority_limit === "" || x.authority_limit == null ? null : Number(x.authority_limit);
      const [cur] = await sql`select role from plat.users where email=${em}`;
      if (cur && cur.role === "admin" && role !== "admin") {
        const [c] = await sql`select count(*)::int n from plat.users where role='admin'`;
        if (c.n <= 1) return json({ error: "This is the only CEO — make someone else CEO first" }, 400);
      }
      if (!cur) {
        const [c] = await sql`select count(*)::int n from plat.users`;
        if (c.n >= max) return json({ error: `The licence allows ${max} users and all ${max} are in use. Remove someone first.` }, 400);
        // create their sign-in (email code, no password); an existing sign-in is reused
        const { error } = await admin.auth.admin.createUser({ email: em, email_confirm: true, user_metadata: { name, app: "platinum" } });
        if (error && !/already|registered|exists/i.test(error.message)) return json({ error: "Could not create the sign-in: " + error.message }, 400);
      }
      await sql`insert into plat.users(email, name, role, title, authority_limit) values (${em}, ${name}, ${role}, ${title}, ${lim})
        on conflict (email) do update set name=excluded.name, role=excluded.role, title=excluded.title, authority_limit=excluded.authority_limit`;
      await sql`delete from plat.users_disabled where email=${em}`;
      await audit({ email: em, name, role, title, authority_limit: lim, new: !cur });
      return json({ ok: true, created: !cur });
    }

    if (a === "remove") {
      const em = String(body.email || "").trim().toLowerCase();
      if (em === email) return json({ error: "You cannot remove yourself" }, 400);
      const out = await sql.begin(async (t) => {
        const [x] = await t`select * from plat.users where email=${em} for update`;
        if (!x) throw new Stop("Person not found");
        if (x.role === "admin") { const [c] = await t`select count(*)::int n from plat.users where role='admin'`; if (c.n <= 1) throw new Stop("This is the only CEO — it cannot be removed"); }
        await t`insert into plat.users_disabled(email, name, role, title, authority_limit, added_at, disabled_by) values (${x.email}, ${x.name}, ${x.role}, ${x.title}, ${x.authority_limit}, ${x.added_at}, ${email})
          on conflict (email) do update set name=excluded.name, role=excluded.role, title=excluded.title, authority_limit=excluded.authority_limit, disabled_at=now(), disabled_by=excluded.disabled_by`;
        await t`delete from plat.users where email=${em}`;
        return { ok: true };
      });
      await audit({ email: em });
      return json(out);
    }

    if (a === "restore") {
      const em = String(body.email || "").trim().toLowerCase();
      const out = await sql.begin(async (t) => {
        const [x] = await t`select * from plat.users_disabled where email=${em} for update`;
        if (!x) throw new Stop("Person not found on the removed list");
        const [c] = await t`select count(*)::int n from plat.users`;
        if (c.n >= max) throw new Stop(`The licence allows ${max} users and all ${max} are in use. Remove someone first.`);
        await t`insert into plat.users(email, name, role, title, authority_limit) values (${x.email}, ${x.name}, ${x.role}, ${x.title}, ${x.authority_limit})`;
        await t`delete from plat.users_disabled where email=${em}`;
        return { ok: true };
      });
      await audit({ email: em });
      return json(out);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    if (e instanceof Stop) return json({ error: e.message }, 400);
    return json({ error: String((e as Error)?.message || e).replace(/^.*ERROR:\s*/, "") || "Server error" }, 500);
  }
});
