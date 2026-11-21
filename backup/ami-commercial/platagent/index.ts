// platagent v1.3 (20 Nov 2026: commission payments moved here — one ledger, payment can never exceed what the agent is owed, double-tap and same-day duplicate guard; books check: commission payable control account = sum of agent balances) — v1.2 (20 Nov 2026: Sales picks the agent when entering a new policy — the policy goes under the agent's name; Sales may only set the agent on its own policies before any payment) — v1.1 (20 Nov 2026: list of all policies with their agent, for tick-and-give) — v1.0 (20 Nov 2026) — Platinum agents and brokers: register (code, licence, commission rate, status, payment details, extra details);
// assign an agent to policies (one, several, or all of a client's) — commission already booked on money received moves to the new agent and rate;
// commission earned / paid / owed per agent. Commission is earned when the client pays (plat.receive) and paid from Accounting (plat pay_commission).
// Same sign-in and roles as `plat` (plat.users). Every change is written to plat.audit.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const ACTIONS: Record<string, string[]> = {
  agent_list: ["admin","gm","underwriter","accountant","sales","board"],
  agent_get: ["admin","gm","underwriter","accountant"],
  agent_save: ["admin","gm","underwriter"],
  agent_assign: ["admin","gm","underwriter","sales"],
  agent_policies: ["admin","gm","underwriter"],
  agent_pay: ["admin","accountant"],
  agent_books: ["admin","gm","accountant"],
};

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
    const a = body.action as string;
    if (!ACTIONS[a]) return json({ error: "Unknown action" }, 400);
    if (!ACTIONS[a].includes(me.role)) return json({ error: "Not available for your role" }, 403);
    const audit = (detail: unknown) => sql`insert into plat.audit(email, action, detail) values (${email}, ${a}, ${sql.json((detail ?? {}) as any)})`;

    const pct = (v: unknown) => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n * 100) / 10000 : 0; };
    if (a === "agent_list") {
      const rows = await sql`select g.party_id id, g.code, pa.name, pa.phone, pa.email, pa.company, g.agent_type, g.licence_no, g.licence_expiry, g.area, g.status,
          round(g.comm_pct*100, 2) comm_pct,
          (select count(*)::int from plat.policies p where p.broker_id=g.party_id and p.status<>'cancelled') policies,
          (select coalesce(sum(p.gross_premium),0) from plat.policies p where p.broker_id=g.party_id and p.status<>'cancelled') premium,
          (select coalesce(sum(l.credit),0) from plat.journal_lines l where l.account_code='2122001' and l.party_id=g.party_id) earned,
          (select coalesce(sum(l.debit),0) from plat.journal_lines l where l.account_code='2122001' and l.party_id=g.party_id) paid,
          (select coalesce(sum(l.credit-l.debit),0) from plat.journal_lines l where l.account_code='2122001' and l.party_id=g.party_id) owed
        from plat.agents g join plat.parties pa on pa.id=g.party_id order by g.status <> 'active', pa.name`;
      const [sum] = await sql`select count(*) filter (where status='active')::int active, count(*)::int total,
          count(*) filter (where licence_expiry is not null and licence_expiry < current_date + 30)::int licence_due,
          (select count(*)::int from plat.policies where broker_id is null and status<>'cancelled') direct_policies,
          (select coalesce(sum(credit-debit),0) from plat.journal_lines where account_code='2122001') owed from plat.agents`;
      if (me.role === "board") return json({ rows: rows.map((r: any) => ({ code: r.code, name: r.name, agent_type: r.agent_type, status: r.status, policies: r.policies, premium: r.premium, earned: r.earned, owed: r.owed })), sum });
      if (me.role === "sales") return json({ rows: rows.filter((r: any) => r.status === "active").map((r: any) => ({ id: r.id, code: r.code, name: r.name, comm_pct: r.comm_pct })), sum: {} });
      return json({ rows, sum });
    }

    if (a === "agent_get") {
      const id = num(body.id);
      const [g] = await sql`select g.*, round(g.comm_pct*100,2) comm_pct, pa.name, pa.phone, pa.email, pa.company, pa.address from plat.agents g join plat.parties pa on pa.id=g.party_id where g.party_id=${id}`;
      if (!g) return json({ error: "Agent not found" }, 404);
      const policies = await sql`select p.policy_no, p.old_policy_no, h.name client, p.class_code, p.start_date, p.end_date, p.status, p.gross_premium, round(p.commission_pct*100,2) comm_pct,
          (select coalesce(sum(r.amount),0) from plat.receipts r where r.policy_id=p.id) received,
          (select coalesce(sum(l.credit-l.debit),0) from plat.journal_lines l where l.account_code='2122001' and l.policy_id=p.id and l.party_id=${id}) commission
        from plat.policies p left join plat.parties h on h.id=p.holder_id where p.broker_id=${id} order by p.start_date desc`;
      const lines = await sql`select j.jdate, j.memo, l.debit paid, l.credit earned from plat.journal_lines l join plat.journals j on j.id=l.journal_id
        where l.account_code='2122001' and l.party_id=${id} order by j.jdate, l.id`;
      return json({ agent: g, policies, lines });
    }

    if (a === "agent_save") {
      const g = body.g || {}; const name = String(g.name || "").trim();
      if (!name) return json({ error: "Give the agent's name" }, 400);
      const type = g.agent_type === "broker" ? "broker" : "agent";
      const status = ["active", "suspended", "terminated"].includes(g.status) ? g.status : "active";
      const extra = Array.isArray(g.extra) ? g.extra.filter((x: any) => x && String(x.label || "").trim()).map((x: any) => ({ label: String(x.label).trim(), value: String(x.value || "").trim() })) : [];
      const t = (v: unknown) => String(v ?? "").trim() || null;
      let id = num(g.id);
      if (id) {
        const [ok] = await sql`select 1 from plat.agents where party_id=${id}`; if (!ok) return json({ error: "Agent not found" }, 404);
        await sql`update plat.parties set name=${name}, kind=${type}, phone=${t(g.phone)}, email=${t(g.email)}, company=${t(g.company)}, address=${t(g.address)} where id=${id}`;
        await sql`update plat.agents set agent_type=${type}, licence_no=${t(g.licence_no)}, licence_expiry=${g.licence_expiry || null}, comm_pct=${pct(g.comm_pct)}, area=${t(g.area)},
          payment_details=${t(g.payment_details)}, status=${status}, notes=${t(g.notes)}, extra=${sql.json(extra)}, updated_by=${email}, updated_at=now() where party_id=${id}`;
      } else {
        const [dup] = await sql`select g.code from plat.agents g join plat.parties pa on pa.id=g.party_id where upper(pa.name)=upper(${name})`;
        if (dup) return json({ error: `${name} is already in the list (${dup.code})` }, 400);
        const [pa] = await sql`insert into plat.parties(kind, name, phone, email, company, address, added_by) values (${type}, ${name}, ${t(g.phone)}, ${t(g.email)}, ${t(g.company)}, ${t(g.address)}, ${email}) returning id`;
        id = Number(pa.id);
        await sql`insert into plat.agents(party_id, code, agent_type, licence_no, licence_expiry, comm_pct, area, payment_details, status, notes, extra, added_by)
          values (${id}, ${null}, ${type}, ${t(g.licence_no)}, ${g.licence_expiry || null}, ${pct(g.comm_pct)}, ${t(g.area)}, ${t(g.payment_details)}, ${status}, ${t(g.notes)}, ${sql.json(extra)}, ${email})`;
        await sql`update plat.agents set code=${type === "broker" ? "BR-" : "AG-"} || lpad(nextval('plat.agent_seq')::text, 4, '0') where party_id=${id}`;
      }
      await audit({ id, name, type, status, comm_pct: g.comm_pct });
      const [r] = await sql`select code from plat.agents where party_id=${id}`;
      return json({ ok: true, id, code: r.code });
    }

    if (a === "agent_policies") {
      const rows = await sql`select p.id, p.policy_no, p.old_policy_no, h.name client, pc.name cover, p.start_date, p.end_date, p.gross_premium premium, p.status,
          g.code agent_code, ga.name agent, round(coalesce(p.commission_pct,0)*100,2) rate
        from plat.policies p left join plat.parties h on h.id=p.holder_id left join plat.product_classes pc on pc.code=p.class_code
          left join plat.agents g on g.party_id=p.broker_id left join plat.parties ga on ga.id=p.broker_id
        where p.status<>'cancelled' order by h.name, p.start_date`;
      return json({ rows });
    }

    if (a === "agent_assign") {
      const k = body.k || {};
      const agentId = num(k.agent_id); let ag: any = null;
      if (agentId) { [ag] = await sql`select g.party_id, g.comm_pct, g.status, pa.name from plat.agents g join plat.parties pa on pa.id=g.party_id where g.party_id=${agentId}`;
        if (!ag) return json({ error: "Agent not found" }, 404);
        if (ag.status !== "active") return json({ error: `${ag.name} is ${ag.status}` }, 400); }
      const rate = !ag ? 0 : (k.comm_pct === undefined || k.comm_pct === null || k.comm_pct === "" ? Number(ag.comm_pct) : pct(k.comm_pct));
      const nos = (Array.isArray(k.policy_nos) ? k.policy_nos : String(k.policy_nos || "").split(/[\s,;]+/)).map((x: string) => String(x).trim()).filter(Boolean);
      const ids = Array.isArray(k.policy_ids) ? k.policy_ids.map(Number).filter((x: number) => x > 0) : [];
      const pols = ids.length ? await sql`select * from plat.policies where id in ${sql(ids)}`
        : k.party_id
        ? await sql`select * from plat.policies where holder_id=${num(k.party_id)} and status<>'cancelled'`
        : nos.length ? await sql`select * from plat.policies where policy_no in ${sql(nos)} or old_policy_no in ${sql(nos)}` : [];
      if (!pols.length) return json({ error: "No policies found" }, 400);
      if (me.role === "sales") {
        if (k.party_id) return json({ error: "Not available for your role" }, 403);
        for (const p of pols as any[]) {
          const [rc] = await sql`select count(*)::int n from plat.receipts where policy_id=${p.id}`;
          if (String(p.created_by || "").toLowerCase() !== email || rc.n > 0) return json({ error: `You can only set the agent on your own new policies before payment (${p.policy_no}). Ask Underwriting.` }, 403);
        }
      }
      let adjusted = 0; const today = new Date().toISOString().slice(0, 10);
      for (const p of pols as any[]) {
        await sql`update plat.policies set broker_id=${ag ? ag.party_id : null}, commission_pct=${rate} where id=${p.id}`;
        // commission already booked on money received: move it to the new agent and rate
        const [rc] = await sql`select coalesce(sum(amount),0) paid from plat.receipts where policy_id=${p.id} and journal_id is not null`;
        const due = Number(p.gross_premium) + Number(p.tax || 0) + Number(p.policy_fee || 0);
        const target = Number(rc.paid) > 0 && due > 0 && ag ? Math.round(Number(p.gross_premium) * rate * Number(rc.paid) / due * 100) / 100 : 0;
        const booked = await sql`select party_id, coalesce(sum(credit-debit),0) amt from plat.journal_lines where account_code='5121001' and policy_id=${p.id} group by party_id`;
        const want = new Map<number | null, number>(); for (const b of booked as any[]) want.set(b.party_id === null ? null : Number(b.party_id), 0);
        if (ag) want.set(Number(ag.party_id), target);
        const lines: any[] = [];
        for (const [party, tgt] of want) {
          const cur = (booked as any[]).filter((b) => (b.party_id === null ? null : Number(b.party_id)) === party).reduce((s, b) => s - Number(b.amt), 0); // expense is a debit
          const diff = Math.round((tgt - cur) * 100) / 100;
          if (Math.abs(diff) < 0.01) continue;
          if (diff > 0) lines.push({ a: "5121001", d: diff, pol: p.id, cls: p.class_code, party }, { a: "2122001", c: diff, pol: p.id, party });
          else lines.push({ a: "2122001", d: -diff, pol: p.id, party }, { a: "5121001", c: -diff, pol: p.id, cls: p.class_code, party });
        }
        if (lines.length) { await sql`select plat.post(${today}::date, ${'Commission moved — ' + p.policy_no + (ag ? ' to ' + ag.name : ' (direct)')}, 'commission', ${p.id}, ${sql.json(lines)})`; adjusted++; }
      }
      await audit({ agent: ag?.name || "direct", rate, policies: (pols as any[]).map((p) => p.policy_no), adjusted });
      return json({ ok: true, count: pols.length, rate: Math.round(rate * 10000) / 100, adjusted });
    }

    if (a === "agent_pay") {
      const c = body.c || {}; const id = num(c.agent_id); const amt = Math.round(Number(c.amount) * 100) / 100;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || "")) ? String(c.date) : new Date().toISOString().slice(0, 10);
      const ref = String(c.ref || "").trim();
      if (!id) return json({ error: "Choose the agent" }, 400);
      if (!(amt > 0)) return json({ error: "Enter the amount paid" }, 400);
      const out = await sql.begin(async (t) => {
        await t`select pg_advisory_xact_lock(778001, ${id}::int)`;
        const [g] = await t`select g.party_id, g.code, pa.name from plat.agents g join plat.parties pa on pa.id=g.party_id where g.party_id=${id}`;
        if (!g) return { error: "Agent not found" };
        const [o] = await t`select coalesce(sum(credit-debit),0) owed from plat.journal_lines where account_code='2122001' and party_id=${id}`;
        const owed = Math.round(Number(o.owed) * 100) / 100;
        if (amt > owed + 0.001) return { error: `${g.name} is owed USD ${owed.toFixed(2)} — you cannot pay more than that` };
        const [dup] = await t`select j.id from plat.journals j join plat.journal_lines l on l.journal_id=j.id
          where j.source='commission_paid' and j.source_id=${id} and j.jdate=${date}::date and l.account_code='2122001' and l.debit=${amt}
            and (${ref} = '' or j.memo like ${'%' + ref + '%'}) limit 1`;
        if (dup && !c.confirm_duplicate) return { duplicate: true, error: `A payment of USD ${amt.toFixed(2)} to ${g.name} on ${date} is already posted. Tick "post it again" only if this is a second payment.` };
        const memo = `Commission paid to ${g.code} ${g.name}${ref ? " — ref " + ref : ""}`;
        const [r] = await t`select plat.post(${date}::date, ${memo}, 'commission_paid', ${id}, ${sql.json([{ a: "2122001", d: amt, party: id }, { a: c.method === "cash" ? "1111001" : "1112001", c: amt }] as any)}) j`;
        return { ok: true, journal: r.j, paid: amt, owed_after: Math.round((owed - amt) * 100) / 100, name: g.name };
      });
      if ((out as any).error) return json(out, 400);
      await audit({ agent_id: id, amount: amt, date, ref, method: c.method, journal: (out as any).journal });
      return json(out);
    }

    if (a === "agent_books") {
      const [b] = await sql`select
          coalesce(sum(credit-debit) filter (where account_code='2122001'),0) payable_control,
          coalesce(sum(credit-debit) filter (where account_code='2122001' and party_id in (select party_id from plat.agents)),0) payable_agents,
          coalesce(sum(credit-debit) filter (where account_code='2122001' and (party_id is null or party_id not in (select party_id from plat.agents))),0) payable_unlinked,
          coalesce(sum(debit-credit) filter (where account_code='5121001'),0) expense_total
        from plat.journal_lines where account_code in ('2122001','5121001')`;
      const pays = await sql`select j.jdate date, j.memo, l.debit amount, j.created_by posted_by from plat.journals j join plat.journal_lines l on l.journal_id=j.id
        where l.account_code='2122001' and l.debit>0 and j.source in ('commission_paid','commission') and j.memo like 'Commission paid%' order by j.jdate desc, j.id desc limit 200`;
      return json({ books: { ...b, balanced: Math.abs(Number(b.payable_unlinked)) < 0.01 }, payments: pays });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
