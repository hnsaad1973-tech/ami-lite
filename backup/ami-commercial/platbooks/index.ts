// platbooks v1.3 (20 Nov 2026: CBL quarterly and Africa Re report figures served here only, GM and CEO) — v1.2 (20 Nov 2026: CBL quarterly and Africa Re reports — GM and CEO only; edit and save the report per quarter, keep history, go back to the figures from the books) — v1.1 (20 Nov 2026: debtors list with the agent / broker of each policy) — v1.0 (20 Nov 2026) — Platinum creditors, purchases and petty cash.
// Purchases on credit: Dr expense / Cr Accounts payable (2161001) under the supplier. Paid now: Dr expense / Cr Bank, Cash or Petty cash.
// Supplier payments: Dr Accounts payable / Cr Bank, Cash or Petty cash — never more than the bill's balance. Same supplier invoice number cannot be entered twice.
// Petty cash: top-up (Dr Petty cash / Cr Bank or Cash), expense (Dr expense / Cr Petty cash — never more than the cash in the box), return to bank.
// Every entry posts once through plat.post (journals must balance); closed months are refused. Same sign-in and roles as `plat`; every action in plat.audit.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const r2 = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
const ACTIONS: Record<string, string[]> = {
  books_summary: ["admin","gm","accountant"],
  debtors: ["admin","gm","accountant","underwriter","board"],
  supplier_save: ["admin","accountant"],
  purchase_add: ["admin","accountant"],
  purchase_pay: ["admin","accountant"],
  purchase_void: ["admin","accountant"],
  petty_add: ["admin","accountant"],
  qr_get: ["admin","gm"],
  qr_save: ["admin","gm"],
  qr_reset: ["admin","gm"],
  cbl_report: ["admin","gm"],
  are_report: ["admin","gm"],
};
const PAY: Record<string, string> = { bank: "1112001", cash: "1111001", petty: "1113001" };
const AP = "2161001", PETTY = "1113001";
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
    const a = body.action as string;
    if (!ACTIONS[a]) return json({ error: "Unknown action" }, 400);
    if (!ACTIONS[a].includes(me.role)) return json({ error: "Not available for your role" }, 403);
    const audit = (detail: unknown) => sql`insert into plat.audit(email, action, detail) values (${email}, ${a}, ${sql.json((detail ?? {}) as any)})`;
    const dateOf = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : new Date().toISOString().slice(0, 10));
    const openPeriod = async (t: any, d: string) => {
      const [c] = await t`select 1 from plat.periods where closed and period::text like ${d.slice(0, 7) + "%"} limit 1`;
      if (c) throw new Stop(`${d.slice(0, 7)} is closed — use a date in an open month`);
    };
    const pettyBal = async (t: any) => { const [b] = await t`select coalesce(sum(debit-credit),0) b from plat.journal_lines where account_code=${PETTY}`; return r2(b.b); };
    const okAccount = async (t: any, code: string) => {
      const [x] = await t`select code from plat.accounts where code=${code} and active and (type='expense' or code in ('1221001','1131001','2151001'))`;
      if (!x) throw new Stop("Choose what the purchase is for (expense account)");
    };

    if (a === "cbl_report" || a === "are_report") {
      const d = dateOf(body.date);
      const [r] = a === "cbl_report" ? await sql`select plat.cbl_quarterly_gm(${d}::date) r` : await sql`select plat.africa_re_submission_gm(${d}::date) r`;
      await audit({ date: d });
      return json({ report: r.r, me: { name: me.name, role: me.role } });
    }

    if (a === "qr_get" || a === "qr_save" || a === "qr_reset") {
      const kind = body.kind === "africare" ? "africare" : "cbl"; const quarter = String(body.quarter || "").trim().slice(0, 40);
      if (!quarter) return json({ error: "Quarter missing" }, 400);
      if (a === "qr_get") {
        const [e] = await sql`select html, edited_by, edited_at from plat.quarterly_edits where kind=${kind} and quarter=${quarter}`;
        return json({ ok: true, edit: e || null, me: { name: me.name, role: me.role } });
      }
      if (a === "qr_reset") {
        await sql`delete from plat.quarterly_edits where kind=${kind} and quarter=${quarter}`;
        await sql`insert into plat.quarterly_edit_history(kind, quarter, html, action, by_email) values (${kind}, ${quarter}, null, 'reset', ${email})`;
        await audit({ kind, quarter, reset: true }); return json({ ok: true });
      }
      let html = String(body.html || "");
      if (html.length < 50 || html.length > 2000000) return json({ error: "Nothing to save" }, 400);
      html = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<(iframe|object|embed|link|meta|style)[^>]*>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/javascript:/gi, "").replace(/\scontenteditable="[^"]*"/gi, "");
      await sql`insert into plat.quarterly_edits(kind, quarter, html, edited_by) values (${kind}, ${quarter}, ${html}, ${email})
        on conflict (kind, quarter) do update set html=excluded.html, edited_by=excluded.edited_by, edited_at=now()`;
      await sql`insert into plat.quarterly_edit_history(kind, quarter, html, action, by_email) values (${kind}, ${quarter}, ${html}, 'save', ${email})`;
      await audit({ kind, quarter, saved: html.length }); return json({ ok: true });
    }

    if (a === "debtors") {
      const rows = await sql`select policy_no, holder, agent, issue_date, balance, days_outstanding from plat.v_debtors where balance > 0 order by agent = 'Direct', agent, balance desc`;
      return json({ rows });
    }

    if (a === "books_summary") {
      const suppliers = await sql`select pa.id, pa.name, pa.phone, pa.email, pa.company,
          (select count(*)::int from plat.purchases p where p.supplier_id=pa.id and p.status<>'void') bills,
          (select coalesce(sum(credit),0) from plat.journal_lines where account_code=${AP} and party_id=pa.id) billed,
          (select coalesce(sum(debit),0) from plat.journal_lines where account_code=${AP} and party_id=pa.id) paid,
          (select coalesce(sum(credit-debit),0) from plat.journal_lines where account_code=${AP} and party_id=pa.id) owed,
          (select coalesce(sum(p.amount - coalesce((select sum(x.amount) from plat.purchase_payments x where x.purchase_id=p.id),0)),0) from plat.purchases p
             where p.supplier_id=pa.id and p.status in ('unpaid','part_paid') and p.due_date < current_date) overdue
        from plat.parties pa where pa.kind='supplier' order by pa.name`;
      const purchases = await sql`select p.id, p.bill_date, p.due_date, s.name supplier, p.invoice_no, p.description, ac.name account, p.amount,
          coalesce((select sum(x.amount) from plat.purchase_payments x where x.purchase_id=p.id),0) + case when p.paid_now is not null then p.amount else 0 end paid,
          case when p.status='void' then 0 when p.paid_now is not null then 0 else p.amount - coalesce((select sum(x.amount) from plat.purchase_payments x where x.purchase_id=p.id),0) end balance,
          coalesce(p.paid_now, 'credit') how, p.status, p.created_by
        from plat.purchases p join plat.parties s on s.id=p.supplier_id join plat.accounts ac on ac.code=p.account_code order by p.bill_date desc, p.id desc limit 500`;
      const petty = await sql`select c.id, c.tdate, c.kind, c.description, ac.name account, c.paid_to, c.receipt_no,
          case when c.kind='top_up' then c.amount else 0 end cash_in, case when c.kind<>'top_up' then c.amount else 0 end cash_out, c.created_by
        from plat.petty_cash c left join plat.accounts ac on ac.code=c.account_code order by c.tdate desc, c.id desc limit 500`;
      const accounts = await sql`select code, name from plat.accounts where active and (type='expense' or code='1221001') and code not in ('5111001','5111002','5111003','5121001','6211001','6211002','6291001') order by code`;
      const [b] = await sql`select
          coalesce((select sum(credit-debit) from plat.journal_lines where account_code=${AP}),0) ap_control,
          coalesce((select sum(credit-debit) from plat.journal_lines l join plat.parties pa on pa.id=l.party_id and pa.kind='supplier' where l.account_code=${AP}),0) ap_suppliers,
          coalesce((select sum(debit-credit) from plat.journal_lines where account_code=${PETTY}),0) petty_balance,
          coalesce((select sum(p.amount) from plat.purchases p where p.status<>'void' and date_trunc('month',p.bill_date)=date_trunc('month',current_date)),0) purchases_month,
          coalesce((select sum(c.amount) from plat.petty_cash c where c.kind='expense' and date_trunc('month',c.tdate)=date_trunc('month',current_date)),0) petty_spent_month`;
      return json({ suppliers, purchases, petty, accounts, books: { ...b, balanced: Math.abs(Number(b.ap_control) - Number(b.ap_suppliers)) < 0.01 } });
    }

    if (a === "supplier_save") {
      const s = body.s || {}; const name = String(s.name || "").trim();
      if (!name) return json({ error: "Give the supplier's name" }, 400);
      const t = (v: unknown) => String(v ?? "").trim() || null;
      if (num(s.id)) {
        await sql`update plat.parties set name=${name}, phone=${t(s.phone)}, email=${t(s.email)}, company=${t(s.company)}, address=${t(s.address)}, notes=${t(s.notes)} where id=${num(s.id)} and kind='supplier'`;
        await audit({ id: s.id, name }); return json({ ok: true, id: num(s.id) });
      }
      const [dup] = await sql`select id from plat.parties where kind='supplier' and upper(name)=upper(${name})`;
      if (dup) return json({ error: `${name} is already a supplier` }, 400);
      const [r] = await sql`insert into plat.parties(kind, name, phone, email, company, address, notes, added_by) values ('supplier', ${name}, ${t(s.phone)}, ${t(s.email)}, ${t(s.company)}, ${t(s.address)}, ${t(s.notes)}, ${email}) returning id`;
      await audit({ id: r.id, name }); return json({ ok: true, id: Number(r.id) });
    }

    if (a === "purchase_add") {
      const p = body.p || {}; const amt = r2(p.amount); const date = dateOf(p.bill_date);
      const paidNow = ["bank", "cash", "petty"].includes(p.paid_now) ? p.paid_now : null;
      const inv = String(p.invoice_no || "").trim() || null; const desc = String(p.description || "").trim();
      if (!(amt > 0)) return json({ error: "Enter the amount" }, 400);
      if (!desc) return json({ error: "Say what was bought" }, 400);
      const out = await sql.begin(async (t) => {
        await openPeriod(t, date); await okAccount(t, String(p.account_code || ""));
        let sid = num(p.supplier_id);
        if (!sid) {
          const nm = String(p.supplier_name || "").trim(); if (!nm) throw new Stop("Choose or type the supplier");
          const [ex] = await t`select id from plat.parties where kind='supplier' and upper(name)=upper(${nm})`;
          sid = ex ? Number(ex.id) : Number((await t`insert into plat.parties(kind, name, added_by) values ('supplier', ${nm}, ${email}) returning id`)[0].id);
        }
        const [s] = await t`select id, name from plat.parties where id=${sid} and kind='supplier'`; if (!s) throw new Stop("Supplier not found");
        if (inv) { const [d] = await t`select id from plat.purchases where supplier_id=${sid} and upper(invoice_no)=upper(${inv}) and status<>'void'`; if (d) throw new Stop(`Invoice ${inv} from ${s.name} is already entered`); }
        if (paidNow === "petty") { await t`select pg_advisory_xact_lock(778002, 1)`; const bal = await pettyBal(t); if (amt > bal + 0.001) throw new Stop(`Petty cash has only USD ${bal.toFixed(2)}`); }
        const [row] = await t`insert into plat.purchases(supplier_id, bill_date, due_date, invoice_no, description, account_code, amount, paid_now, status, created_by)
          values (${sid}, ${date}, ${p.due_date || null}, ${inv}, ${desc}, ${p.account_code}, ${amt}, ${paidNow}, ${paidNow ? "paid" : "unpaid"}, ${email}) returning id`;
        const memo = `Purchase — ${s.name}${inv ? " inv " + inv : ""} — ${desc}`;
        const lines = [{ a: p.account_code, d: amt, party: sid }, paidNow ? { a: PAY[paidNow], c: amt } : { a: AP, c: amt, party: sid }];
        const [j] = await t`select plat.post(${date}::date, ${memo}, 'purchase', ${row.id}, ${sql.json(lines as any)}) j`;
        await t`update plat.purchases set journal_id=${j.j} where id=${row.id}`;
        if (paidNow === "petty") await t`insert into plat.petty_cash(tdate, kind, account_code, description, amount, receipt_no, paid_to, purchase_id, journal_id, created_by)
          values (${date}, 'expense', ${p.account_code}, ${desc}, ${amt}, ${inv}, ${s.name}, ${row.id}, ${j.j}, ${email})`;
        return { ok: true, id: Number(row.id), supplier: s.name };
      });
      await audit({ ...p, amount: amt, id: out.id }); return json(out);
    }

    if (a === "purchase_pay") {
      const k = body.k || {}; const amt = r2(k.amount); const date = dateOf(k.date); const method = PAY[k.method] ? k.method : "bank";
      if (!(amt > 0)) return json({ error: "Enter the amount paid" }, 400);
      const out = await sql.begin(async (t) => {
        await openPeriod(t, date);
        const [p] = await t`select p.*, s.name supplier from plat.purchases p join plat.parties s on s.id=p.supplier_id where p.id=${num(k.id)} for update of p`;
        if (!p) throw new Stop("Bill not found");
        if (p.status === "void" || p.paid_now) throw new Stop("This bill is not on credit");
        const [pd] = await t`select coalesce(sum(amount),0) s from plat.purchase_payments where purchase_id=${p.id}`;
        const bal = r2(Number(p.amount) - Number(pd.s));
        if (amt > bal + 0.001) throw new Stop(`Only USD ${bal.toFixed(2)} is still owed on this bill`);
        if (method === "petty") { await t`select pg_advisory_xact_lock(778002, 1)`; const pb = await pettyBal(t); if (amt > pb + 0.001) throw new Stop(`Petty cash has only USD ${pb.toFixed(2)}`); }
        const [pp] = await t`insert into plat.purchase_payments(purchase_id, pdate, amount, method, ref, created_by) values (${p.id}, ${date}, ${amt}, ${method}, ${String(k.ref || "").trim() || null}, ${email}) returning id`;
        const memo = `Paid ${p.supplier}${p.invoice_no ? " inv " + p.invoice_no : ""}${k.ref ? " — ref " + k.ref : ""}`;
        const [j] = await t`select plat.post(${date}::date, ${memo}, 'supplier_payment', ${pp.id}, ${sql.json([{ a: AP, d: amt, party: p.supplier_id }, { a: PAY[method], c: amt }] as any)}) j`;
        await t`update plat.purchase_payments set journal_id=${j.j} where id=${pp.id}`;
        await t`update plat.purchases set status=${bal - amt < 0.01 ? "paid" : "part_paid"} where id=${p.id}`;
        if (method === "petty") await t`insert into plat.petty_cash(tdate, kind, account_code, description, amount, receipt_no, paid_to, purchase_id, journal_id, created_by)
          values (${date}, 'expense', ${AP}, ${"Paid supplier bill " + (p.invoice_no || p.id)}, ${amt}, ${k.ref || null}, ${p.supplier}, ${p.id}, ${j.j}, ${email})`;
        return { ok: true, paid: amt, left: r2(bal - amt), supplier: p.supplier };
      });
      await audit({ ...k, amount: amt }); return json(out);
    }

    if (a === "purchase_void") {
      const reason = String(body.reason || "").trim(); if (!reason) return json({ error: "Give the reason" }, 400);
      const out = await sql.begin(async (t) => {
        const [p] = await t`select * from plat.purchases where id=${num(body.id)} for update`;
        if (!p) throw new Stop("Bill not found"); if (p.status === "void") throw new Stop("Already void");
        const [pd] = await t`select count(*)::int n from plat.purchase_payments where purchase_id=${p.id}`;
        if (pd.n > 0) throw new Stop("Payments were made on this bill — it cannot be voided");
        const today = new Date().toISOString().slice(0, 10); await openPeriod(t, today);
        const lines = await t`select account_code a, credit d, debit c, party_id party from plat.journal_lines where journal_id=${p.journal_id}`;
        await t`select plat.post(${today}::date, ${"Void purchase " + (p.invoice_no || p.id) + " — " + reason}, 'purchase_void', ${p.id}, ${sql.json(lines.map((l: any) => ({ a: l.a, d: Number(l.d), c: Number(l.c), party: l.party })) as any)})`;
        await t`update plat.purchases set status='void', void_reason=${reason} where id=${p.id}`;
        if (p.paid_now === "petty") await t`delete from plat.petty_cash where purchase_id=${p.id} and kind='expense'`;
        return { ok: true };
      });
      await audit({ id: body.id, reason }); return json(out);
    }

    if (a === "petty_add") {
      const c = body.c || {}; const amt = r2(c.amount); const date = dateOf(c.tdate);
      const kind = ["top_up", "expense", "return"].includes(c.kind) ? c.kind : "expense"; const desc = String(c.description || "").trim();
      if (!(amt > 0)) return json({ error: "Enter the amount" }, 400);
      if (!desc) return json({ error: "Say what it was for" }, 400);
      const out = await sql.begin(async (t) => {
        await openPeriod(t, date); await t`select pg_advisory_xact_lock(778002, 1)`;
        const bal = await pettyBal(t);
        let lines: any[]; const src = c.source === "cash" ? "1111001" : "1112001";
        if (kind === "top_up") lines = [{ a: PETTY, d: amt }, { a: src, c: amt }];
        else {
          if (amt > bal + 0.001) throw new Stop(`Petty cash has only USD ${bal.toFixed(2)}`);
          if (kind === "expense") { await okAccount(t, String(c.account_code || "")); lines = [{ a: c.account_code, d: amt }, { a: PETTY, c: amt }]; }
          else lines = [{ a: src, d: amt }, { a: PETTY, c: amt }];
        }
        const memo = `Petty cash ${kind.replace("_", "-")} — ${desc}${c.paid_to ? " — " + c.paid_to : ""}`;
        const [j] = await t`select plat.post(${date}::date, ${memo}, 'petty_cash', null, ${sql.json(lines as any)}) j`;
        await t`insert into plat.petty_cash(tdate, kind, account_code, description, amount, receipt_no, paid_to, journal_id, created_by)
          values (${date}, ${kind}, ${kind === "expense" ? c.account_code : null}, ${desc}, ${amt}, ${String(c.receipt_no || "").trim() || null}, ${String(c.paid_to || "").trim() || null}, ${j.j}, ${email})`;
        return { ok: true, balance: r2(kind === "top_up" ? bal + amt : bal - amt) };
      });
      await audit({ ...c, amount: amt }); return json(out);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    if (e instanceof Stop) return json({ error: e.message }, 400);
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
