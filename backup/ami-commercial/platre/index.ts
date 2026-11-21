// platre v1.0 (20 Nov 2026) — Platinum reinsurer accounts (Africa Re, facultative reinsurers, more can be added): balances, statement, policies ceded,
// payments to and receipts from reinsurers. Held by the GM and CEO. Accounting is off by default; the GM or CEO can let Accounting view and/or prepare
// payments later (setting reinsurer_access). A payment prepared by Accounting posts only after GM or CEO approval. A payment can never exceed what is owed.
// Same sign-in and roles as `plat`; every action is written to plat.audit.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const r2 = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
const CASH: Record<string, string> = { bank: "1112001", cash: "1111001" };
class Stop extends Error {}

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
    const boss = me.role === "gm" || me.role === "admin";
    const [st] = await sql`select value from plat.settings where key='reinsurer_access'`;
    const acc = (st?.value || {}) as any;
    const canView = boss || (me.role === "accountant" && (acc.accounting_can_view || acc.accounting_can_prepare));
    const canPrepare = boss || (me.role === "accountant" && acc.accounting_can_prepare);
    const audit = (detail: unknown) => sql`insert into plat.audit(email, action, detail) values (${email}, ${"re_" + a}, ${sql.json((detail ?? {}) as any)})`;
    if (a === "access") return json({ view: canView, prepare: canPrepare, boss, setting: acc });
    if (!canView) return json({ error: "Reinsurer accounts are held by the General Manager and the CEO" }, 403);

    const balances = async (t: any, r: any) => {
      const [p] = await t`select coalesce(sum(credit-debit),0) b from plat.journal_lines where account_code=${r.payable_account}`;
      let rec = 0;
      if (r.kind === "treaty" && r.recoverable_account) { const [x] = await t`select coalesce(sum(debit-credit),0) b from plat.journal_lines where account_code=${r.recoverable_account}`; rec = Number(x.b); }
      return { owed_to_reinsurer: r2(p.b), recoverable: r2(rec) };
    };
    const post = async (t: any, pay: any, r: any) => {
      const bal = await balances(t, r);
      const amt = r2(pay.amount);
      if (pay.direction === "pay" && amt > bal.owed_to_reinsurer + 0.001) throw new Stop(`${r.name} is owed USD ${bal.owed_to_reinsurer.toFixed(2)} — you cannot pay more than that`);
      if (pay.direction === "receive" && amt > bal.recoverable + 0.001) throw new Stop(`Only USD ${bal.recoverable.toFixed(2)} is due from ${r.name} on claims`);
      const [c] = await t`select 1 from plat.periods where closed and period::text like ${String(pay.pdate).slice(0, 7) + "%"} limit 1`;
      if (c) throw new Stop("That month is closed — use a date in an open month");
      const lines = pay.direction === "pay" ? [{ a: r.payable_account, d: amt }, { a: CASH[pay.method], c: amt }] : [{ a: CASH[pay.method], d: amt }, { a: r.recoverable_account, c: amt }];
      const memo = `${pay.direction === "pay" ? "Paid to" : "Received from"} ${r.name}${pay.ref ? " — ref " + pay.ref : ""}`;
      const [j] = await t`select plat.post(${pay.pdate}::date, ${memo}, 'reinsurer', ${pay.id}, ${sql.json(lines as any)}) j`;
      return j.j;
    };

    if (a === "summary") {
      const rs = await sql`select * from plat.reinsurers order by kind, id`;
      const out: any[] = [];
      for (const r of rs as any[]) out.push({ id: r.id, name: r.name, kind: r.kind, account: r.payable_account, active: r.active, contact: r.contact, email: r.email, ...(await balances(sql, r)) });
      const rid = Number(body.id) || (rs[0] as any)?.id;
      const r: any = (rs as any[]).find((x) => Number(x.id) === rid) || rs[0];
      const statement = r ? await sql`select j.jdate date, j.memo, l.debit, l.credit from plat.journal_lines l join plat.journals j on j.id=l.journal_id where l.account_code=${r.payable_account} order by j.jdate, l.id` : [];
      const cessions = r && r.kind === "treaty" ? await sql`select p.policy_no, h.name client, pc.name cover, pc.treaty_section section, p.start_date, p.end_date, p.sum_insured, p.gross_premium,
          round(coalesce(p.ceded_pct,0)*100,1) ceded_pct_shown, p.ceded_premium, p.fac_confirmed
        from plat.policies p join plat.product_classes pc on pc.code=p.class_code left join plat.parties h on h.id=p.holder_id
        where p.status<>'cancelled' and coalesce(p.ceded_premium,0) > 0 order by p.start_date desc` : [];
      const [motor] = await sql`select count(*)::int n, coalesce(sum(p.gross_premium),0) premium from plat.policies p join plat.product_classes pc on pc.code=p.class_code where pc.treaty_section='MOTOR_XL' and p.status<>'cancelled'`;
      const payments = await sql`select x.id, rr.name reinsurer, x.direction, x.amount, x.pdate, x.method, x.ref, x.status, x.prepared_by, x.decided_by, x.decided_at from plat.ri_payments x join plat.reinsurers rr on rr.id=x.reinsurer_id order by x.status <> 'prepared', x.prepared_at desc limit 200`;
      return json({ reinsurers: out, selected: r ? Number(r.id) : null, statement, cessions, motor_xl: motor, payments, access: { view: canView, prepare: canPrepare, boss, setting: acc } });
    }

    if (a === "prepare") {
      if (!canPrepare) return json({ error: "Not allowed to prepare reinsurer payments" }, 403);
      const p = body.p || {}; const amt = r2(p.amount);
      const dir = p.direction === "receive" ? "receive" : "pay"; const method = CASH[p.method] ? p.method : "bank";
      const pdate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.pdate || "")) ? String(p.pdate) : new Date().toISOString().slice(0, 10);
      if (!(amt > 0)) return json({ error: "Enter the amount" }, 400);
      const out = await sql.begin(async (t) => {
        const [r] = await t`select * from plat.reinsurers where id=${Number(p.reinsurer_id)}`; if (!r) throw new Stop("Reinsurer not found");
        await t`select pg_advisory_xact_lock(778003, ${Number(r.id)}::int)`;
        const [x] = await t`insert into plat.ri_payments(reinsurer_id, direction, amount, pdate, method, ref, note, prepared_by, status)
          values (${r.id}, ${dir}, ${amt}, ${pdate}, ${method}, ${String(p.ref || "").trim() || null}, ${String(p.note || "").trim() || null}, ${email}, 'prepared') returning *`;
        if (!boss) { const b = await balances(t, r); if (dir === "pay" && amt > b.owed_to_reinsurer + 0.001) throw new Stop(`${r.name} is owed USD ${b.owed_to_reinsurer.toFixed(2)}`); return { ok: true, posted: false }; }
        const j = await post(t, x, r);
        await t`update plat.ri_payments set status='approved', decided_by=${email}, decided_at=now(), journal_id=${j} where id=${x.id}`;
        return { ok: true, posted: true };
      });
      await audit({ ...p, amount: amt }); return json(out);
    }

    if (a === "decide") {
      if (!boss) return json({ error: "Only the General Manager or the CEO can approve" }, 403);
      const ok = body.decision === "approve";
      const out = await sql.begin(async (t) => {
        const [x] = await t`select * from plat.ri_payments where id=${Number(body.id)} for update`;
        if (!x || x.status !== "prepared") throw new Stop("Not found or already decided");
        if (String(x.prepared_by).toLowerCase() === email) throw new Stop("You prepared this payment — the other approver must approve it");
        const [r] = await t`select * from plat.reinsurers where id=${x.reinsurer_id}`;
        await t`select pg_advisory_xact_lock(778003, ${Number(r.id)}::int)`;
        let j = null; if (ok) j = await post(t, x, r);
        await t`update plat.ri_payments set status=${ok ? "approved" : "declined"}, decided_by=${email}, decided_at=now(), decision_note=${String(body.note || "").trim() || null}, journal_id=${j} where id=${x.id}`;
        return { ok: true };
      });
      await audit({ id: body.id, decision: ok ? "approved" : "declined" }); return json(out);
    }

    if (a === "add") {
      if (!boss) return json({ error: "Only the General Manager or the CEO" }, 403);
      const name = String(body.name || "").trim(); if (!name) return json({ error: "Give the reinsurer's name" }, 400);
      const kind = body.kind === "treaty" ? "treaty" : "facultative";
      const out = await sql.begin(async (t) => {
        const [dup] = await t`select id from plat.reinsurers where upper(name)=upper(${name})`; if (dup) throw new Stop(`${name} is already in the list`);
        const [n] = await t`select coalesce(max(code::bigint), 2121002) + 1 c from plat.accounts where code like '21210%'`;
        const code = String(n.c);
        await t`insert into plat.accounts(code, name, type, active) values (${code}, ${"Reinsurer current account — " + name}, 'liability', true)`;
        const [r] = await t`insert into plat.reinsurers(name, payable_account, recoverable_account, kind, contact, email, added_by) values (${name}, ${code}, '1122001', ${kind}, ${String(body.contact || "").trim() || null}, ${String(body.email || "").trim() || null}, ${email}) returning id`;
        return { ok: true, id: Number(r.id), account: code };
      });
      await audit({ name, kind, ...out }); return json(out);
    }

    if (a === "access_set") {
      if (!boss) return json({ error: "Only the General Manager or the CEO" }, 403);
      const v = { accounting_can_view: !!body.view, accounting_can_prepare: !!body.prepare };
      await sql`insert into plat.settings(key, value) values ('reinsurer_access', ${sql.json(v)}) on conflict (key) do update set value=excluded.value`;
      await audit(v); return json({ ok: true, setting: v });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    if (e instanceof Stop) return json({ error: e.message }, 400);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
