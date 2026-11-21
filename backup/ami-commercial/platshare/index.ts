// platshare v1.0 (20 Nov 2026) — Platinum: policies and statements of account cannot be printed, saved, copied, emailed or shared without GM or CEO approval.
// Staff ask for approval (document, reason, who it goes to); the GM or CEO approves or declines; an approval lasts 48 hours for that person and that document only.
// The GM and CEO never need approval. Same sign-in and roles as `plat`; every request and decision is written to plat.audit.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const BOSS = ["gm", "admin"];
const KINDS: Record<string, string> = { policy: "Policy", statement: "Statement of account" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Please sign in" }, 401);
    const [me] = await sql`select email, name, role from plat.users where lower(email) = ${email}`;
    if (!me) return json({ error: "Your email is not on the Platinum list. Ask management for access." }, 403);
    const body = await req.json().catch(() => ({}));
    const a = String(body.action || "");
    const boss = BOSS.includes(me.role);
    const kind = KINDS[body.kind] ? String(body.kind) : "policy";
    const ref = String(body.ref || "").trim().slice(0, 120);
    const audit = (detail: unknown) => sql`insert into plat.audit(email, action, detail) values (${email}, ${"share_" + a}, ${sql.json((detail ?? {}) as any)})`;

    if (a === "check") {
      if (boss) return json({ allowed: true, boss: true });
      const [ok] = await sql`select expires_at from plat.share_requests where kind=${kind} and ref=${ref} and lower(requested_by)=${email} and status='approved' and expires_at > now() order by expires_at desc limit 1`;
      const [pend] = await sql`select id, requested_at from plat.share_requests where kind=${kind} and ref=${ref} and lower(requested_by)=${email} and status='pending' limit 1`;
      return json({ allowed: !!ok, until: ok?.expires_at || null, pending: !!pend });
    }

    if (a === "request") {
      if (boss) return json({ ok: true, allowed: true });
      const reason = String(body.reason || "").trim();
      if (!ref) return json({ error: "Document missing" }, 400);
      if (!reason) return json({ error: "Say why it must be shared" }, 400);
      const [pend] = await sql`select id from plat.share_requests where kind=${kind} and ref=${ref} and lower(requested_by)=${email} and status='pending' limit 1`;
      if (pend) return json({ ok: true, already: true });
      const [r] = await sql`insert into plat.share_requests(kind, ref, reason, send_to, requested_by) values (${kind}, ${ref}, ${reason}, ${String(body.send_to || "").trim() || null}, ${email}) returning id`;
      await audit({ id: r.id, kind, ref, reason, send_to: body.send_to || null });
      return json({ ok: true, id: Number(r.id) });
    }

    if (a === "list") {
      const rows = boss
        ? await sql`select s.id, s.kind, s.ref, s.reason, s.send_to, coalesce(us.name, s.requested_by) requested_by, s.requested_at, s.status, s.decided_by, s.decided_at, s.expires_at
            from plat.share_requests s left join plat.users us on lower(us.email)=lower(s.requested_by) order by s.status <> 'pending', s.requested_at desc limit 300`
        : await sql`select id, kind, ref, reason, send_to, requested_at, status, decided_at, expires_at from plat.share_requests where lower(requested_by)=${email} order by requested_at desc limit 100`;
      return json({ rows: rows.map((r: any) => ({ ...r, kind: KINDS[r.kind] || r.kind })), boss });
    }

    if (a === "decide") {
      if (!boss) return json({ error: "Only the General Manager or the CEO can approve sharing" }, 403);
      const ok = body.decision === "approve";
      const [r] = await sql`update plat.share_requests set status=${ok ? "approved" : "declined"}, decided_by=${email}, decided_at=now(),
          decision_note=${String(body.note || "").trim() || null}, expires_at=${ok ? sql`now() + interval '48 hours'` : null}
        where id=${Number(body.id)} and status='pending' returning id, kind, ref, requested_by`;
      if (!r) return json({ error: "Request not found or already decided" }, 400);
      await audit({ id: r.id, kind: r.kind, ref: r.ref, for: r.requested_by, decision: ok ? "approved" : "declined" });
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
