// plat v3.4 (20 Nov 2026, board vote 5-0: only Accounts records payments; claims = Underwriting verifies, GM approves, Accounts pays, nobody handles a claim on a policy they underwrote; Board sees the audit trail view-only) — plat v3.3 (20 Nov 2026: Client contact info — Sales adds client contacts to Platinum's database, then view-only; consolidated list only for GM and CEO) — plat v3.2 (20 Nov 2026: Sales sees only its own clients' contact info, no premiums, no download) — plat v3.1 (20 Nov 2026: 7-day pay-by and automatic lapse; Awaiting facultative stage; Board only above USD 1,000,000 with 72-hour deadline) — plat v3.0 (20 Nov 2026: Sales submits → Underwriting reviews, sets deductible, signs → GM final approval (Board above 1M / capacity) → Sales issues to client; library served from storage) — plat v2.3 — Platinum Insurers: sales, underwriting, accounts, management and board (AMI Commercial project, schema plat)
// Roles: admin = CEO (full), gm, board, accountant, underwriter, sales, viewer. Access is enforced here, not only in the screens.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 3, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const store = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).storage.from("plat-library");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

const POLICY_COLS = `p.id, p.policy_no, p.class_code, pc.name class_name, h.name holder, h.phone, p.start_date, p.end_date,
  p.sum_insured, p.gross_premium, p.policy_fee, p.status, p.uw_status, p.referred_to, p.docs_verified_at,
  (select count(*) from plat.policy_items i where i.policy_id=p.id) items, p.created_by, p.issued_to_client_at, p.pay_by, p.lapsed_at,
  p.gross_premium + coalesce(p.tax,0) + coalesce(p.policy_fee,0) - coalesce((select sum(amount) from plat.receipts r where r.policy_id=p.id),0) balance`;
const POLICY_FROM = `from plat.policies p join plat.product_classes pc on pc.code=p.class_code left join plat.parties h on h.id=p.holder_id`;

// list name -> [sql, roles allowed]
const LISTS: Record<string, [string, string[]]> = {
  // sales platform
  classes: [`select pc.code, pc.name, pc.treaty_section, pc.blocked, r.pattern, r.rate_unit, r.always_refer from plat.product_classes pc left join plat.product_rules r on r.class_code=pc.code order by pc.name`, ["admin","underwriter","sales","accountant","board","viewer"]],
  tariff: [`select id, category, sub_category, months, premium, fee from plat.mot_tariff order by category, sub_category, months`, ["admin","underwriter","sales","accountant","viewer"]],
  rules: [`select r.class_code, pc.name, pc.treaty_section, r.status, r.pattern, r.rating_basis, r.rate, r.rate_unit, r.min_premium, r.policy_fee, r.max_auto_value, r.max_value,
      r.always_refer, r.limits, r.deductible, r.deductible_pct, r.deductible_min, r.eligibility, r.documents, r.exclusions, r.conditions, r.referral_triggers, r.approved_by, r.approved_at
      from plat.product_rules r join plat.product_classes pc on pc.code=r.class_code order by pc.name`, ["admin","underwriter","sales","board","viewer"]],
  clients: [`select * from plat.v_clients`, ["admin"]], // consolidated client contacts: General Manager (gm) and CEO only
  quotations: [`select * from plat.quotations order by quote_date desc`, ["admin","underwriter","sales","viewer"]],
  // underwriting
  policies: [`select ${POLICY_COLS} ${POLICY_FROM} order by p.id desc`, ["admin","underwriter","accountant","viewer"]],
  uw_queue: [`select p.policy_no, pc.name class_name, h.name holder, p.sum_insured, p.gross_premium, p.uw_status, p.referred_to, p.referral_reason,
      p.deductible_text, p.uw_conditions, p.uw_signed_by, p.uw_signed_at, p.board_approval, p.board_due_at, p.stage_since, p.fac_confirmed, p.created_by, p.created_at, p.docs_verified_at, p.start_date ${POLICY_FROM}
      where p.uw_status in ('submitted','referred','returned','uw_approved','board') or (p.uw_status='approved' and p.docs_verified_at is null and p.status<>'cancelled') order by p.id desc`, ["admin","underwriter","board"]],
  claims: [`select c.claim_no, p.policy_no, h.name holder, c.loss_date, c.reported_date, c.description, c.status,
      case when c.status<>'open' then c.status when c.approved_at is not null then 'approved — Accounts to pay' when c.verified_at is not null then 'verified — with GM' else 'registered — Underwriting to verify' end stage,
      b.outstanding, b.paid, c.approved_amount, b.ri_recoverable, c.registered_by, c.verified_by, c.approved_by, p.uw_signed_by underwritten_by
      from plat.claims c join plat.policies p on p.id=c.policy_id left join plat.parties h on h.id=p.holder_id
      join plat.v_claims_bordereau b on b.claim_no=c.claim_no order by c.id desc`, ["admin","underwriter","accountant","viewer"]],
  treaty: [`select code, name, reinsurer, qs_pct, retention, surplus_lines, capacity, ri_commission_pct, profit_commission_pct,
      xl_deductible, xl_limit, xl_aggregate, xl_premium_annual, bound, terms_source from plat.treaty_sections order by code`, ["admin","underwriter","accountant","board","viewer"]],
  xl: [`select code, name, protects, limit_amount, deductible, reinstatements, rate, premium, bound from plat.xl_covers order by code`, ["admin","underwriter","accountant","board","viewer"]],
  // accounts
  receipts: [`select r.rdate, p.policy_no, h.name holder, r.amount, r.method, r.ref from plat.receipts r join plat.policies p on p.id=r.policy_id left join plat.parties h on h.id=p.holder_id order by r.id desc`, ["admin","accountant"]],
  debtors: [`select policy_no, holder, issue_date, balance, days_outstanding from plat.v_debtors where balance > 0 order by balance desc`, ["admin","accountant","underwriter","board"]],
  commissions: [`select * from plat.v_commissions`, ["admin","accountant"]],
  tb: [`select code, name, type, debit, credit, balance from plat.v_trial_balance where debit<>0 or credit<>0 order by code`, ["admin","accountant","board"]],
  pnl: [`select period, code, name, type, amount from plat.v_pnl_monthly order by period, code`, ["admin","accountant","board"]],
  journals: [`select j.id, j.jdate, j.memo, j.source, sum(l.debit) amount from plat.journals j join plat.journal_lines l on l.journal_id=j.id group by j.id order by j.id desc limit 150`, ["admin","accountant"]],
  africa_re: [`select * from plat.v_africa_re_quarterly where premium_ceded<>0 or ri_commission<>0 or claims_recovered<>0`, ["admin","accountant","board"]],
  prem_bdx: [`select * from plat.v_premium_bordereau order by policy_no`, ["admin","accountant","underwriter"]],
  clm_bdx: [`select * from plat.v_claims_bordereau order by claim_no`, ["admin","accountant","underwriter"]],
  retention: [`select * from plat.v_retention`, ["admin","accountant","underwriter","board"]],
  banks: [`select bank_name, account_name, account_last4, currency, gl_code, opening_balance, opening_date from plat.bank_accounts`, ["admin","accountant"]],
  payroll: [`select * from plat.v_payroll`, ["admin","accountant"]],
  staff: [`select id, name, position, department, currency, basic_salary, allowances, active, notes from plat.staff order by id`, ["admin","accountant"]],
  library: [`select id, category, title, class_code, version, effective_date, status,
      case when storage_path is not null then 'file' when url is not null then 'link' else '' end source, notes, uploaded_by, uploaded_at
      from plat.library order by category, status, class_code nulls first, title`, ["admin","underwriter","accountant","board","viewer"]],
  wordings: [`select w.id, w.class_code, pc.name product, w.version, w.status, w.effective_date, w.title, w.source, w.approved_by, length(w.body) chars
      from plat.wordings w join plat.product_classes pc on pc.code=w.class_code order by pc.name, w.id desc`, ["admin","underwriter","sales","accountant","board","viewer"]],
  clauses: [`select code, title, body, applies_to, premium_basis, premium_value, notes from plat.clauses where active order by title`, ["admin","underwriter","sales","viewer"]],
  endorsements: [`select e.id, p.policy_no, h.name holder, e.endorsement_no, e.title, e.additional_premium, e.effective_date, e.created_by
      from plat.endorsements e join plat.policies p on p.id=e.policy_id left join plat.parties h on h.id=p.holder_id order by e.id desc`, ["admin","underwriter","accountant","viewer"]],
  // management
  alerts: [`select * from plat.v_alerts`, ["admin","board","accountant","underwriter"]],
  compliance: [`select id, item, regulation, frequency, due_date, owner, case when status='open' and due_date < current_date then 'overdue' else status end status, notes from plat.compliance order by due_date nulls last`, ["admin","board","accountant"]],
  shareholders: [`select certificate_no, name, shares, issued from plat.shareholders order by certificate_no`, ["admin","board"]],
  users: [`select email, name, role, title, authority_limit from plat.users order by role, email`, ["admin"]],
  audit: [`select at, email, action, detail from plat.audit order by id desc limit 200`, ["admin","board"]],
};

const ACTIONS: Record<string, string[]> = {
  dashboard: ["admin","board","accountant","underwriter","sales","viewer"],
  my_policies: ["sales","admin","underwriter"],
  my_clients: ["sales","admin","underwriter"],
  add_contact: ["sales","admin","underwriter"],
  policy_detail: ["admin","underwriter","sales","accountant","board","viewer"],
  quote: ["admin","underwriter","sales"],
  create_policy: ["admin","underwriter","sales"],
  add_receipt: ["admin","accountant"],
  uw_decide: ["admin","underwriter","board"],
  verify_docs: ["admin","underwriter"],
  save_rule: ["admin","underwriter"],
  create_claim: ["admin","underwriter"],
  claim_move: ["admin","underwriter"],
  claim_verify: ["admin","underwriter"],
  claim_approve: ["admin"],
  claim_pay: ["admin","accountant"],
  month_end: ["admin","accountant"],
  run_payroll: ["admin","accountant"],
  update_staff: ["admin","accountant"],
  pay_commission: ["admin","accountant"],
  update_compliance: ["admin","accountant"],
  board_report: ["admin","board","accountant"],
  review: ["admin","underwriter"],
  fac_confirm: ["admin","underwriter"],
  gm_decide: ["admin"],
  issue_client: ["admin","sales","underwriter"],
  resubmit: ["admin","sales","underwriter"],
  lib_list: ["admin","underwriter","accountant","board","viewer"],
  cbl_report: ["admin","accountant","board"],
  are_report: ["admin","accountant","underwriter","board"],
  add_user: ["admin"],
  lib_open: ["admin","underwriter","accountant","board","viewer"],
  lib_add: ["admin","underwriter"],
  lib_status: ["admin","underwriter"],
  wording_get: ["admin","underwriter","sales","accountant","board","viewer"],
  wording_save: ["admin","underwriter"],
  endorse: ["admin","underwriter"],
};

const YEAR = new Date().getFullYear();

async function priceItems(cls: string, items: any[]) {
  const [rule] = await sql`select * from plat.product_rules where class_code=${cls}`;
  let premium = 0, fee = 0, si = 0;
  const priced = [];
  for (const i of items) {
    let p: number | null = null;
    if (rule?.rate_unit === "tariff" || (cls === "MFLEET" && num(i.tariff_id))) {
      const [t] = await sql`select premium, fee, months from plat.mot_tariff where id=${num(i.tariff_id)}`;
      if (!t) throw new Error(`Choose the tariff category for ${i.plate_no || i.description || "each vehicle"}`);
      p = Number(t.premium); fee += Number(t.fee); i.cover_months = t.months;
    } else if (cls === "MFLEET") {
      const [r] = await sql`select plat.rate_item('MCOMP', ${num(i.sum_insured) || 0}) v`; p = Number(r.v); fee += Number(rule?.policy_fee || 0);
    } else {
      const [r] = await sql`select plat.rate_item(${cls}, ${num(i.sum_insured) || 0}) v`; p = r.v === null ? null : Number(r.v);
    }
    i.premium = p;
    premium += p || 0; si += num(i.sum_insured) || 0;
    priced.push(i);
  }
  if (cls === "MFLEET" && items.length >= 25) premium *= 0.9; else if (cls === "MFLEET" && items.length >= 10) premium *= 0.95;
  if (rule && rule.rate_unit !== "tariff" && cls !== "MFLEET") fee = Number(rule.policy_fee || 0);
  return { rule, items: priced, premium: Math.round(premium * 100) / 100, fee, si, priced: premium > 0 };
}

function referral(me: any, rule: any, cls: string, si: number, items: any[]) {
  const why: string[] = [];
  const old = items.some((i) => num(i.year) && YEAR - Number(i.year) > 10);
  if (!rule) why.push("No underwriting rule for this product");
  if (rule?.always_refer) why.push(rule.referral_triggers || "Always referred");
  if (rule?.max_auto_value !== null && rule?.max_auto_value !== undefined && si > Number(rule.max_auto_value)) why.push(`Value over USD ${Number(rule.max_auto_value).toLocaleString()}`);
  if (["MCOMP","MTPFT","MFLEET"].includes(cls) && old) why.push("Vehicle over 10 years old");
  const overCap = rule?.max_value && Number(rule.max_value) > 0 && si > Number(rule.max_value);
  if (overCap) why.push(`Above the USD ${Number(rule.max_value).toLocaleString()} limit for this product — facultative needed`);
  if (si > 1000000) why.push("Above USD 1,000,000 — Board approval and facultative");
  if (me.role === "sales" && cls !== "MTPL") why.push("Sales may issue motor third party only");
  if (me.role !== "admin" && me.authority_limit !== null && si > Number(me.authority_limit)) why.push(`Above your limit of USD ${Number(me.authority_limit).toLocaleString()}`);
  const board = si > 1000000;
  const to = board ? "Board" : si > 250000 || why.some((w) => w.includes("10 years")) || (cls === "MCOMP" && si > 100000) ? "General Manager" : "Underwriting";
  if (me.role === "admin") return { refer: false, board, to: board ? "Board (noted)" : null, why: why.join("; ") || null };
  return { refer: why.length > 0, board, to, why: why.join("; ") || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (new URL(req.url).searchParams.get("health") === "1") {
      const [h] = await sql`select count(*)::int n from plat.product_rules`;
      return json({ ok: true, rules: h.n });
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Please sign in" }, 401);
    const [me] = await sql`select email, name, role, title, authority_limit from plat.users where lower(email) = ${email}`;
    if (!me) return json({ error: "Your email is not on the Platinum list. Ask management for access." }, 403);

    const body = await req.json().catch(() => ({}));
    const a = body.action as string;
    const audit = (detail: unknown) => sql`insert into plat.audit(email, action, detail) values (${email}, ${a}, ${sql.json((detail ?? {}) as any)})`;

    if (a === "me") return json({ me });

    if (a === "list") {
      const L = LISTS[body.name as string];
      if (!L) return json({ error: "Unknown list" }, 400);
      if (!(L[1].includes(me.role) || (me.role === "gm" && !["users", "audit"].includes(body.name)))) return json({ error: "Not available for your role" }, 403);
      return json({ rows: await sql.unsafe(L[0]) });
    }

    if (!ACTIONS[a]) return json({ error: "Unknown action" }, 400);
    if (!(ACTIONS[a].includes(me.role) || (me.role === "gm" && a !== "add_user"))) return json({ error: "Not available for your role" }, 403);

    if (a === "dashboard") {
      if (me.role === "sales") {
        const [d] = await sql`select (select count(*) from plat.policies where created_by=${email}) my_policies,
          (select coalesce(sum(gross_premium),0) from plat.policies where created_by=${email} and uw_status='approved') my_premium,
          (select count(*) from plat.policies where created_by=${email} and uw_status in ('submitted','referred','uw_approved','board')) my_referred,
          (select count(*) from plat.policies where created_by=${email} and uw_status='approved' and issued_to_client_at is null) my_to_issue,
          (select count(*) from plat.policies where created_by=${email} and uw_status='returned') my_returned,
          (select count(*) from plat.policies where created_by=${email} and status='pending_payment' and uw_status='approved') my_unpaid,
          (select count(*) from plat.policies where uw_status='approved' and status<>'cancelled' and end_date between current_date and current_date+30) renewals_30`;
        return json({ me, d, view: "sales" });
      }
      const [d] = await sql`select
          (select coalesce(sum(credit-debit),0) from plat.journal_lines where account_code='4111001') gwp,
          (select coalesce(sum(l.credit-l.debit),0) from plat.journal_lines l join plat.accounts a on a.code=l.account_code where a.type in ('income','expense')) result,
          (select coalesce(sum(debit-credit),0) from plat.journal_lines where account_code like '1121%') receivable,
          (select coalesce(sum(debit-credit),0) from plat.journal_lines where account_code in ('1111001','1112001','1112002')) cash,
          (select coalesce(sum(credit-debit),0) from plat.journal_lines where account_code in ('2112001','2112002')) claims_reserve,
          (select count(*) from plat.policies where uw_status='approved' and status<>'cancelled') policies,
          (select count(*) from plat.policies where uw_status in ('submitted','referred')) referred,
          (select count(*) from plat.policies where uw_status='uw_approved') gm_pending,
          (select count(*) from plat.policies where uw_status='board') board_pending,
          (select count(*) from plat.claims where status='open') open_claims,
          (select count(*) from plat.v_alerts where sev=1) urgent,
          (select count(*) from plat.compliance where status='open' and due_date < current_date) compliance_overdue,
          (select retained_pct from plat.v_retention order by yr desc limit 1) retained_pct,
          (select count(*) from plat.product_rules where status='proposed') rules_unsigned`;
      const show = me.role === "underwriter" ? { policies: d.policies, referred: d.referred, open_claims: d.open_claims, claims_reserve: d.claims_reserve, urgent: d.urgent, rules_unsigned: d.rules_unsigned } : d;
      return json({ me, d: show, view: me.role });
    }

    if (a === "my_clients") {
      // contact details only, and only for clients this person entered — no premiums, balances or other staff's clients
      return json({ rows: await sql`select h.name client, h.company, h.phone, h.email, h.address, h.notes, h.created_at::date added_on, count(p.id)::int policies,
          max(p.end_date) filter (where p.uw_status='approved' and p.status<>'cancelled') latest_cover_ends
        from plat.parties h left join plat.policies p on p.holder_id=h.id and p.created_by=${email}
        where h.kind='policyholder' and (lower(h.added_by)=${email} or p.id is not null)
        group by h.id order by h.name` });
    }

    if (a === "add_contact") {
      // Sales records a client contact into Platinum's own database. Once saved, Sales cannot change it (management can).
      const c = body.c || {};
      const name = String(c.name || "").trim(), phone = String(c.phone || "").trim();
      if (!name) return json({ error: "Enter the client's name" }, 400);
      if (!phone && !String(c.email || "").trim()) return json({ error: "Enter a phone number or an email" }, 400);
      const [dup] = await sql`select id, added_by from plat.parties where kind='policyholder' and (upper(name)=upper(${name}) or (${phone} <> '' and regexp_replace(coalesce(phone,''),'[^0-9]','','g') = regexp_replace(${phone},'[^0-9]','','g')))`;
      if (dup) return json({ error: "This client is already in Platinum's records. Ask Underwriting or management if details need changing." }, 400);
      await sql`insert into plat.parties(kind, name, phone, email, company, address, notes, added_by)
        values ('policyholder', ${name}, ${phone || null}, ${String(c.email || "").trim() || null}, ${String(c.company || "").trim() || null}, ${String(c.address || "").trim() || null}, ${String(c.notes || "").trim() || null}, ${email})`;
      await audit({ name, phone });
      return json({ ok: true });
    }

    if (a === "my_policies") {
      return json({ rows: await sql.unsafe(`select ${POLICY_COLS} ${POLICY_FROM} where p.created_by = $1 order by p.id desc`, [email]) });
    }

    if (a === "policy_detail") {
      const [p] = await sql`select p.*, pc.name class_name, pc.treaty_section, h.name holder, h.phone, h.email holder_email
        from plat.policies p join plat.product_classes pc on pc.code=p.class_code left join plat.parties h on h.id=p.holder_id
        where p.policy_no = ${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (me.role === "sales" && p.created_by !== email) return json({ error: "You can only open policies you issued" }, 403);
      const items = await sql`select description, plate_no, chassis_vin, make_model, year, use_category, location, sum_insured, premium, cover_months
        from plat.policy_items where policy_id=${p.id} order by id`;
      const receipts = await sql`select rdate, amount, method, ref from plat.receipts where policy_id=${p.id} order by rdate`;
      const [rule] = await sql`select limits, deductible, exclusions, conditions, documents from plat.product_rules where class_code=${p.class_code}`;
      const [co] = await sql`select value from plat.settings where key='company'`;
      const [tpl] = await sql`select value from plat.settings where key='statutory_tpl'`;
      const [wording] = await sql`select title, version, status, body from plat.wordings where id = coalesce(${p.wording_id},
        (select id from plat.wordings where class_code=${p.class_code} and status in ('approved','proposed') order by (status='approved') desc, id desc limit 1))`;
      const endorsements = await sql`select endorsement_no, title, body, additional_premium, effective_date from plat.endorsements where policy_id=${p.id} order by endorsement_no`;
      const [ex] = await sql`select plat.exposure(${p.class_code}, ${p.sum_insured}) e`;
      const signers = await sql`select email, name, title from plat.users where lower(email) in (${(p.uw_signed_by || "").toLowerCase()}, ${(p.gm_approved_by || p.approved_by || "").toLowerCase()})`;
      const who = (e: string) => { const u = signers.find((x: any) => x.email.toLowerCase() === String(e || "").toLowerCase()); return u ? { name: u.name || u.email, title: u.title } : e ? { name: e, title: "" } : null; };
      return json({ p, items, receipts, rule, wording, endorsements, company: co?.value, tpl: tpl?.value, exposure: ex.e,
        signed: { underwriter: who(p.uw_signed_by), underwriter_at: p.uw_signed_at, gm: who(p.gm_approved_by || (p.uw_status === "approved" ? p.approved_by : null)), gm_at: p.gm_approved_at || p.approved_at } });
    }

    if (a === "quote" || a === "create_policy") {
      const p = body.p || {};
      const items: any[] = (Array.isArray(p.items) ? p.items : []).filter((i: any) => i && (i.description || i.plate_no || i.chassis_vin || num(i.sum_insured) || num(i.tariff_id)));
      if (!p.class_code) return json({ error: "Choose the product" }, 400);
      const [cls] = await sql`select blocked from plat.product_classes where code=${p.class_code}`;
      if (cls?.blocked) return json({ error: "This product is not offered" }, 400);
      if (!items.length) return json({ error: "Add at least one vehicle or item" }, 400);
      const pr = await priceItems(p.class_code, items);
      let premium = pr.premium, reason = null;
      if (num(p.premium_override) && ["admin", "underwriter", "gm"].includes(me.role)) { premium = Number(p.premium_override); reason = p.override_reason || "Underwriter rating"; }
      if (!premium) return json({ error: "This product has no automatic rate — an underwriter must enter the premium" }, 400);
      const si = pr.si;
      const ref = referral(me, pr.rule, p.class_code, si, items);
      const months = items[0]?.cover_months || num(p.months) || 12;
      const start = p.start_date || new Date().toISOString().slice(0, 10);
      const e = new Date(start + "T00:00:00Z"); e.setUTCMonth(e.getUTCMonth() + months); e.setUTCDate(e.getUTCDate() - 1);
      const end = p.end_date || e.toISOString().slice(0, 10);
      const quote = { premium, fee: pr.fee, total: premium + pr.fee, sum_insured: si, items: pr.items, start_date: start, end_date: end,
        refer: true, referred_to: "Underwriting", why: ref.why, board: ref.board, deductible: pr.rule?.deductible, limits: pr.rule?.limits,
        documents: pr.rule?.documents, rule_status: pr.rule?.status };
      if (a === "quote") return json({ ok: true, quote });

      if (!p.holder) return json({ error: "Enter the client's name" }, 400);
      const out = await sql.begin(async (t) => {
        let [h] = await t`select id from plat.parties where kind='policyholder' and upper(name)=upper(${p.holder}) limit 1`;
        if (!h) [h] = await t`insert into plat.parties(kind, name, phone, email, added_by) values ('policyholder', ${p.holder}, ${p.phone || null}, ${p.email || null}, ${email}) returning id`;
        else if (p.phone) await t`update plat.parties set phone=coalesce(phone, ${p.phone}) where id=${h.id}`;
        const [s] = await t`select nextval('plat.policy_seq') n`;
        const dt = new Date(start + "T00:00:00Z");
        const no = `PIL${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCFullYear()).slice(2)}/${s.n}`;
        const [pol] = await t`insert into plat.policies(policy_no, class_code, holder_id, issue_date, start_date, end_date, sum_insured,
            gross_premium, tax, policy_fee, commission_pct, fac_confirmed, source, uw_status, referred_to, referral_reason, board_approval, created_by,
            approved_by, approved_at, docs_verified_at, docs_verified_by, premium_override_reason)
          values (${no}, ${p.class_code}, ${h.id}, ${new Date().toISOString().slice(0, 10)}, ${start}, ${end}, ${si},
            ${premium}, 0, ${pr.fee}, ${num(p.commission_pct) || 0}, ${!!p.fac_confirmed}, 'app',
            'submitted', 'Underwriting', ${[ref.why, p.note].filter(Boolean).join(" — ") || null}, ${ref.board}, ${email},
            null, null,
            ${p.docs_verified && me.role !== "sales" ? new Date().toISOString().slice(0, 10) : null}, ${p.docs_verified && me.role !== "sales" ? email : null}, ${reason})
          returning id`;
        for (const i of pr.items) {
          await t`insert into plat.policy_items(policy_id, description, plate_no, chassis_vin, make_model, year, use_category, location, sum_insured, premium, tariff_id, cover_months)
            values (${pol.id}, ${i.description || null}, ${i.plate_no || null}, ${i.chassis_vin || null}, ${i.make_model || null}, ${num(i.year)},
              ${i.use_category || null}, ${i.location || null}, ${num(i.sum_insured) || 0}, ${num(i.premium) || 0}, ${num(i.tariff_id)}, ${num(i.cover_months)})`;
        }
        return t`select policy_no, status, uw_status, referred_to, referral_reason, board_approval, gross_premium, policy_fee, ceded_pct from plat.policies where id=${pol.id}`;
      });
      await audit({ ...p, premium, referral: ref });
      return json({ ok: true, policy: out[0] });
    }

    if (a === "uw_decide") {
      const [p] = await sql`select id, policy_no, sum_insured, uw_status, board_approval from plat.policies where policy_no=${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (p.uw_status !== "board") return json({ error: "This policy is not waiting for a Board decision" }, 400);
      if (!["admin", "board"].includes(me.role)) return json({ error: "Only the Board or CEO decides at this stage" }, 403);
      if (["underwriter", "gm"].includes(me.role) && Number(p.sum_insured) > Number(me.authority_limit || 0)) return json({ error: "Above your approval limit" }, 403);
      if (body.decision === "approve") {
        if (body.fac_confirmed) await sql`update plat.policies set fac_confirmed=true where id=${p.id}`;
        if (num(body.premium)) await sql`update plat.policies set gross_premium=${num(body.premium)}, premium_override_reason=${body.reason || 'Underwriter rating'} where id=${p.id}`;
        await sql`select plat.approve_policy(${p.id}, ${email})`;
        await sql`update plat.policies set gm_approved_by=coalesce(gm_approved_by, ${email}), gm_approved_at=coalesce(gm_approved_at, now()) where id=${p.id}`;
        if (body.reason) await sql`update plat.policies set referral_reason=coalesce(referral_reason,'')||' — approved: '||${body.reason} where id=${p.id}`;
      } else {
        await sql`update plat.policies set uw_status='declined', approved_by=${email}, approved_at=now(), referral_reason=coalesce(referral_reason,'')||' — declined: '||${body.reason || ''} where id=${p.id}`;
      }
      await audit({ policy_no: p.policy_no, decision: body.decision, reason: body.reason, premium: body.premium });
      return json({ ok: true });
    }

    if (a === "review") {
      // Underwriting: checks rules + Africa Re, sets deductible and conditions, signs → GM. Or returns to sales / declines.
      const [p] = await sql`select p.id, p.policy_no, p.class_code, p.sum_insured, p.gross_premium, p.uw_status, p.fac_confirmed, p.created_by from plat.policies p where policy_no=${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (p.uw_status !== "submitted") return json({ error: "This policy is not waiting for underwriting" }, 400);
      const note = String(body.note || "").trim();
      if (body.decision === "return" || body.decision === "decline") {
        if (!note) return json({ error: "Give the reason" }, 400);
        await sql`update plat.policies set uw_status=${body.decision === "return" ? "returned" : "declined"}, referred_to=${body.decision === "return" ? "Sales" : null},
          referral_reason=coalesce(referral_reason,'')||${(body.decision === "return" ? " — returned by underwriting: " : " — declined by underwriting: ") + note},
          approved_by=${body.decision === "decline" ? email : null}, approved_at=${body.decision === "decline" ? new Date().toISOString() : null} where id=${p.id}`;
        await audit({ policy_no: p.policy_no, decision: body.decision, note });
        return json({ ok: true, status: body.decision === "return" ? "returned" : "declined" });
      }
      if (!String(body.deductible || "").trim()) return json({ error: "Set the deductible for this policy" }, 400);
      if (num(body.premium)) await sql`update plat.policies set gross_premium=${num(body.premium)}, premium_override_reason=${note || "Underwriter rating"} where id=${p.id}`;
      if (body.fac_confirmed) await sql`update plat.policies set fac_confirmed=true where id=${p.id}`;
      const [ex] = await sql`select plat.exposure(${p.class_code}, ${p.sum_insured}) e`;
      const facWait = ex.e.fac_needed && !(body.fac_confirmed || p.fac_confirmed);
      if (body.docs_verified) await sql`update plat.policies set docs_verified_at=coalesce(docs_verified_at, current_date), docs_verified_by=coalesce(docs_verified_by, ${email}) where id=${p.id}`;
      const board = Number(p.sum_insured) > 1000000;
      await sql`update plat.policies set uw_status=${facWait ? "referred" : "uw_approved"}, referred_to=${facWait ? "Underwriting — awaiting facultative" : board ? "General Manager, then Board" : "General Manager"}, board_approval=${board},
        deductible_text=${String(body.deductible).trim()}, uw_conditions=${String(body.conditions || "").trim() || null}, uw_signed_by=${email}, uw_signed_at=now() where id=${p.id}`;
      await audit({ policy_no: p.policy_no, decision: facWait ? "signed_awaiting_facultative" : "signed", deductible: body.deductible, conditions: body.conditions, premium: body.premium, exposure: ex.e });
      return json({ ok: true, status: facWait ? "fac_pending" : "uw_approved", exposure: ex.e });
    }

    if (a === "fac_confirm") {
      const [p] = await sql`select id, policy_no, sum_insured, uw_status from plat.policies where policy_no=${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (p.uw_status !== "referred") return json({ error: "This policy is not awaiting facultative" }, 400);
      const ref = String(body.note || "").trim(); if (!ref) return json({ error: "Give the facultative reinsurer and slip reference" }, 400);
      const board = Number(p.sum_insured) > 1000000;
      await sql`update plat.policies set fac_confirmed=true, uw_status='uw_approved', referred_to=${board ? "General Manager, then Board" : "General Manager"},
        referral_reason=coalesce(referral_reason,'')||${" — facultative confirmed: " + ref} where id=${p.id}`;
      await audit({ policy_no: p.policy_no, facultative: ref });
      return json({ ok: true });
    }

    if (a === "gm_decide") {
      const [p] = await sql`select id, policy_no, sum_insured, uw_status, board_approval from plat.policies where policy_no=${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (p.uw_status !== "uw_approved") return json({ error: "This policy is not waiting for the GM" }, 400);
      const note = String(body.note || "").trim();
      if (body.decision === "approve") {
        if (p.board_approval && me.role !== "admin") {
          await sql`update plat.policies set uw_status='board', referred_to='Board', gm_approved_by=${email}, gm_approved_at=now() where id=${p.id}`;
          await audit({ policy_no: p.policy_no, decision: "gm_approved_to_board", note });
          return json({ ok: true, status: "board" });
        }
        await sql`update plat.policies set gm_approved_by=${email}, gm_approved_at=now() where id=${p.id}`;
        await sql`select plat.approve_policy(${p.id}, ${email})`;
        await audit({ policy_no: p.policy_no, decision: "final_approved", note });
        return json({ ok: true, status: "approved" });
      }
      if (!note) return json({ error: "Give the reason" }, 400);
      const back = body.decision === "back";
      if (back) await sql`update plat.policies set uw_status='submitted', referred_to='Underwriting', uw_signed_by=null, uw_signed_at=null,
        referral_reason=coalesce(referral_reason,'')||${" — sent back by GM: " + note} where id=${p.id}`;
      else await sql`update plat.policies set uw_status='declined', referred_to=null, approved_by=${email}, approved_at=now(),
        referral_reason=coalesce(referral_reason,'')||${" — declined by GM: " + note} where id=${p.id}`;
      await audit({ policy_no: p.policy_no, decision: body.decision, note });
      return json({ ok: true, status: back ? "submitted" : "declined" });
    }

    if (a === "resubmit") {
      const [p] = await sql`select id, policy_no, uw_status, created_by from plat.policies where policy_no=${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (me.role === "sales" && p.created_by !== email) return json({ error: "You can only resubmit policies you entered" }, 403);
      if (p.uw_status !== "returned") return json({ error: "Only returned policies can be resubmitted" }, 400);
      await sql`update plat.policies set uw_status='submitted', referred_to='Underwriting', referral_reason=coalesce(referral_reason,'')||${" — resubmitted by sales: " + String(body.note || "")} where id=${p.id}`;
      await audit({ policy_no: p.policy_no, note: body.note });
      return json({ ok: true });
    }

    if (a === "issue_client") {
      const [p] = await sql`select id, policy_no, uw_status, created_by, issued_to_client_at from plat.policies where policy_no=${body.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      if (me.role === "sales" && p.created_by !== email) return json({ error: "You can only issue policies you entered" }, 403);
      if (p.uw_status !== "approved") return json({ error: "The policy has not had final approval yet" }, 400);
      if (!p.issued_to_client_at) await sql`update plat.policies set issued_to_client_at=now(), issued_by=${email} where id=${p.id}`;
      await audit({ policy_no: p.policy_no });
      return json({ ok: true });
    }

    if (a === "lib_list") {
      const rows = await sql`select id, category, title, class_code, version, effective_date, status, url, storage_path, notes from plat.library
        order by category, status, class_code nulls first, title`;
      const paths = rows.filter((r: any) => r.storage_path).map((r: any) => r.storage_path);
      const signed: Record<string, string> = {};
      if (paths.length) { const { data } = await store.createSignedUrls(paths, 3600); for (const d of data || []) if (d.signedUrl && d.path) signed[d.path] = d.signedUrl; }
      return json({ rows: rows.map((r: any) => ({ id: r.id, category: r.category, title: r.title, class_code: r.class_code, version: r.version, effective_date: r.effective_date, status: r.status, notes: r.notes,
        link: r.storage_path ? signed[r.storage_path] || null : r.url || null, kind: r.storage_path ? "file" : r.url ? "link" : "" })) });
    }

    if (a === "verify_docs") {
      const d = body.date || new Date().toISOString().slice(0, 10);
      const r = await sql`update plat.policies set docs_verified_at=${d}, docs_verified_by=${email} where policy_no=${body.policy_no} returning policy_no, docs_verified_at + 15 claims_from`;
      if (!r.length) return json({ error: "Policy not found" }, 404);
      await audit({ policy_no: body.policy_no, date: d });
      return json({ ok: true, claims_from: r[0].claims_from });
    }

    if (a === "save_rule") {
      const r = body.r || {};
      const approve = me.role === "admin" && r.status === "approved";
      await sql`update plat.product_rules set rating_basis=${r.rating_basis}, rate=${num(r.rate)}, min_premium=${num(r.min_premium) || 0}, policy_fee=${num(r.policy_fee) || 0},
        max_auto_value=${num(r.max_auto_value)}, max_value=${num(r.max_value)}, always_refer=${!!r.always_refer}, limits=${r.limits}, deductible=${r.deductible},
        deductible_pct=${num(r.deductible_pct)}, deductible_min=${num(r.deductible_min)}, eligibility=${r.eligibility}, documents=${r.documents},
        exclusions=${r.exclusions}, conditions=${r.conditions}, referral_triggers=${r.referral_triggers},
        status=${approve ? "approved" : "proposed"}, approved_by=${approve ? email : null}, approved_at=${approve ? new Date().toISOString() : null}, updated_at=now()
        where class_code=${r.class_code}`;
      await audit(r);
      return json({ ok: true, status: approve ? "approved" : "proposed" });
    }

    if (a === "add_receipt") {
      const r = body.r || {};
      const [pol] = await sql`select id, uw_status, created_by from plat.policies where policy_no=${r.policy_no}`;
      if (!pol) return json({ error: "Policy not found" }, 400);
      if (me.role === "sales" && pol.created_by !== email) return json({ error: "You can only take payment on policies you issued" }, 403);
      if (pol.uw_status !== "approved") return json({ error: "Policy is not approved yet" }, 400);
      const [st] = await sql`select status, lapsed_at from plat.policies where id=${pol.id}`;
      if (st.status === "cancelled") return json({ error: st.lapsed_at ? "This policy lapsed because it was not paid in time — enter a new request" : "This policy is cancelled" }, 400);
      await sql`insert into plat.receipts(policy_id, rdate, amount, method, ref) values (${pol.id}, ${r.rdate || new Date().toISOString().slice(0, 10)}, ${num(r.amount)}, ${r.method || 'cash'}, ${r.ref || null})`;
      await audit(r);
      const [s] = await sql`select policy_no, status from plat.policies where id=${pol.id}`;
      return json({ ok: true, policy: s });
    }

    if (a === "create_claim") {
      const c = body.c || {};
      const [pol] = await sql`select id from plat.policies where policy_no=${c.policy_no}`;
      if (!pol) return json({ error: "Policy not found" }, 400);
      const out = await sql.begin(async (t) => {
        const [s] = await t`select nextval('plat.claim_seq') n`;
        const no = `CL-${String(c.loss_date).slice(0, 4)}-${String(s.n).padStart(4, "0")}`;
        const [cl] = await t`insert into plat.claims(claim_no, policy_id, loss_date, description, registered_by) values (${no}, ${pol.id}, ${c.loss_date}, ${c.description || null}, ${email}) returning id, claim_no`;
        if (num(c.reserve)) await t`insert into plat.claim_movements(claim_id, kind, amount, memo) values (${cl.id}, 'reserve', ${num(c.reserve)}, 'Initial reserve')`;
        return cl;
      });
      await audit(c);
      return json({ ok: true, claim: out });
    }

    if (a === "claim_move") {
      const m = body.m || {};
      const [cl] = await sql`select id from plat.claims where claim_no=${m.claim_no}`;
      if (!cl) return json({ error: "Claim not found" }, 400);
      if (m.kind === "payment") return json({ error: "Claim payments are made by Accounts after GM approval" }, 403);
      if (!["reserve", "salvage"].includes(m.kind)) return json({ error: "Bad type" }, 400);
      await sql`insert into plat.claim_movements(claim_id, mdate, kind, amount, memo) values (${cl.id}, ${m.mdate || new Date().toISOString().slice(0, 10)}, ${m.kind}, ${num(m.amount)}, ${m.memo || null})`;
      if (m.close) await sql`update plat.claims set status='closed' where id=${cl.id}`;
      await audit(m);
      return json({ ok: true });
    }

    // Claims (board vote 20 Nov 2026, 5-0): Underwriting verifies -> GM approves amount -> Accounts pays.
    // Nobody verifies, approves or pays a claim on a policy they underwrote.
    if (a === "claim_verify" || a === "claim_approve" || a === "claim_pay") {
      const k = body.k || {};
      const [cl] = await sql`select c.id, c.claim_no, c.status, c.verified_at, c.approved_at, c.approved_amount, c.registered_by, p.uw_signed_by,
        (select coalesce(sum(amount),0) from plat.claim_movements m where m.claim_id=c.id and m.kind='payment') paid
        from plat.claims c join plat.policies p on p.id=c.policy_id where c.claim_no=${k.claim_no}`;
      if (!cl) return json({ error: "Claim not found" }, 400);
      if (cl.status !== "open") return json({ error: "Claim is " + cl.status }, 400);
      if ((cl.uw_signed_by || "").toLowerCase() === email) return json({ error: "You underwrote this policy — another person must handle this claim" }, 403);
      if (a === "claim_verify") {
        if (cl.verified_at) return json({ error: "Already verified" }, 400);
        if (k.decline) {
          if (!String(k.note || "").trim()) return json({ error: "Give the reason for declining" }, 400);
          await sql`update plat.claims set status='declined', verified_by=${email}, verified_at=now(), verify_note=${k.note} where id=${cl.id}`;
        } else await sql`update plat.claims set verified_by=${email}, verified_at=now(), verify_note=${k.note || null} where id=${cl.id}`;
        await audit(k); return json({ ok: true });
      }
      if (a === "claim_approve") {
        if (!cl.verified_at) return json({ error: "Underwriting must verify the claim first" }, 400);
        if (cl.approved_at) return json({ error: "Already approved" }, 400);
        if (cl.registered_by && cl.registered_by.toLowerCase() === email) return json({ error: "You registered this claim — someone else must approve it" }, 403);
        const amt = num(k.amount); if (!(amt > 0)) return json({ error: "Enter the amount approved" }, 400);
        await sql`update plat.claims set approved_amount=${amt}, approved_by=${email}, approved_at=now() where id=${cl.id}`;
        await audit(k); return json({ ok: true });
      }
      if (!cl.approved_at) return json({ error: "The GM has not approved this claim yet" }, 400);
      const amt = num(k.amount), left = Number(cl.approved_amount) - Number(cl.paid);
      if (!(amt > 0)) return json({ error: "Enter the amount paid" }, 400);
      if (amt > left + 0.005) return json({ error: `Only ${left.toFixed(2)} of the approved amount is left to pay` }, 400);
      await sql`insert into plat.claim_movements(claim_id, mdate, kind, amount, memo) values (${cl.id}, ${k.mdate || new Date().toISOString().slice(0, 10)}, 'payment', ${amt}, ${(k.ref ? "Ref " + k.ref + " · " : "") + "paid by " + email})`;
      if (k.close || amt >= left - 0.005) await sql`update plat.claims set status='closed' where id=${cl.id}`;
      await audit(k); return json({ ok: true });
    }

    if (a === "month_end") {
      const [r] = await sql`select plat.month_end(${body.date}::date) j`;
      await audit({ date: body.date });
      return json({ ok: true, journal: r.j });
    }

    if (a === "run_payroll") {
      const [r] = await sql`select plat.run_payroll(${body.period}, ${body.run_date}::date, ${num(body.fx)}) j`;
      await audit({ period: body.period, fx: body.fx });
      return json({ ok: true, journal: r.j });
    }

    if (a === "update_staff") {
      const s = body.s || {};
      if (s.id) await sql`update plat.staff set name=${s.name}, position=${s.position || null}, basic_salary=${num(s.basic_salary)}, allowances=${num(s.allowances) || 0}, active=${s.active !== false} where id=${s.id}`;
      else await sql`insert into plat.staff(name, position, basic_salary, allowances) values (${s.name}, ${s.position || null}, ${num(s.basic_salary)}, ${num(s.allowances) || 0})`;
      await audit(s);
      return json({ ok: true });
    }

    if (a === "pay_commission") {
      const c = body.c || {};
      const [b] = await sql`select id from plat.parties where kind in ('broker','agent') and upper(name)=upper(${c.broker}) limit 1`;
      if (!b) return json({ error: "Broker not found" }, 400);
      const [r] = await sql`select plat.post(${c.date || new Date().toISOString().slice(0, 10)}::date, ${'Commission paid to ' + c.broker}, 'commission', null,
        ${sql.json([{ a: "2122001", d: num(c.amount), party: b.id }, { a: c.method === "cash" ? "1111001" : "1112001", c: num(c.amount) }] as any)}) j`;
      await audit(c);
      return json({ ok: true, journal: r.j });
    }

    if (a === "update_compliance") {
      const c = body.c || {};
      if (c.id) await sql`update plat.compliance set status=${c.status}, due_date=${c.due_date || null}, notes=${c.notes || null}, done_at=${c.status === 'done' ? new Date().toISOString().slice(0, 10) : null} where id=${c.id}`;
      else await sql`insert into plat.compliance(item, regulation, frequency, due_date, owner, notes) values (${c.item}, ${c.regulation || null}, ${c.frequency || null}, ${c.due_date || null}, ${c.owner || null}, ${c.notes || null})`;
      await audit(c);
      return json({ ok: true });
    }

    if (a === "board_report") {
      const month = body.month || new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 7);
      const [r] = await sql`select plat.board_report(${month}) r`;
      return json({ report: r.r, me });
    }

    if (a === "cbl_report" || a === "are_report") {
      const d = body.date || new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
      const [r] = a === "cbl_report" ? await sql`select plat.cbl_quarterly(${d}::date) r` : await sql`select plat.africa_re_submission(${d}::date) r`;
      return json({ report: r.r, me });
    }

    if (a === "lib_open") {
      const [d] = await sql`select url, storage_path, title from plat.library where id=${num(body.id)}`;
      if (!d) return json({ error: "Document not found" }, 404);
      if (d.storage_path) {
        const { data, error } = await store.createSignedUrl(d.storage_path, 600);
        if (error) return json({ error: error.message }, 400);
        return json({ url: data.signedUrl });
      }
      if (!d.url) return json({ error: "This document has not been uploaded yet" }, 400);
      return json({ url: d.url });
    }

    if (a === "lib_add") {
      const d = body.d || {};
      if (!d.title || !d.category) return json({ error: "Title and category are required" }, 400);
      let path: string | null = null;
      if (d.file?.b64) {
        const bytes = Uint8Array.from(atob(d.file.b64), (c) => c.charCodeAt(0));
        if (bytes.length > 15 * 1024 * 1024) return json({ error: "File is over 15 MB" }, 400);
        const safe = String(d.file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
        path = `${String(d.category).replace(/[^A-Za-z]+/g, "_")}/${Date.now()}_${safe}`;
        const { error } = await store.upload(path, bytes, { contentType: d.file.type || "application/octet-stream", upsert: false });
        if (error) return json({ error: error.message }, 400);
      } else if (!d.url) return json({ error: "Attach a file or give a link" }, 400);
      if (num(d.replace_id)) {
        const [old] = await sql`select status from plat.library where id=${num(d.replace_id)}`;
        if (old?.status === "missing") await sql`delete from plat.library where id=${num(d.replace_id)}`;
        else await sql`update plat.library set status='superseded' where id=${num(d.replace_id)}`;
      }
      const [row] = await sql`insert into plat.library(title, category, class_code, version, effective_date, status, url, storage_path, file_name, mime, notes, uploaded_by)
        values (${d.title}, ${d.category}, ${d.class_code || null}, ${d.version || null}, ${d.effective_date || null}, ${d.status || 'current'}, ${d.url || null}, ${path},
          ${d.file?.name || null}, ${d.file?.type || null}, ${d.notes || null}, ${email}) returning id`;
      await audit({ title: d.title, category: d.category, class_code: d.class_code, replace_id: d.replace_id, path });
      return json({ ok: true, id: row.id });
    }

    if (a === "lib_status") {
      await sql`update plat.library set status=${body.status} where id=${num(body.id)}`;
      await audit({ id: body.id, status: body.status });
      return json({ ok: true });
    }

    if (a === "wording_get") {
      const [w] = await sql`select w.*, pc.name product from plat.wordings w join plat.product_classes pc on pc.code=w.class_code
        where ${num(body.id) ? sql`w.id=${num(body.id)}` : sql`w.class_code=${body.class_code} and w.status<>'superseded'`} order by (w.status='approved') desc, w.id desc limit 1`;
      if (!w) return json({ error: "No wording for this product yet" }, 404);
      return json({ wording: w });
    }

    if (a === "wording_save") {
      const w = body.w || {};
      if (!w.class_code || !w.body) return json({ error: "Product and wording text are required" }, 400);
      const approve = me.role === "admin" && w.status === "approved";
      const [row] = await sql.begin(async (t) => {
        if (approve) await t`update plat.wordings set status='superseded' where class_code=${w.class_code} and status='approved'`;
        await t`update plat.wordings set status='superseded' where class_code=${w.class_code} and status='proposed'`;
        return t`insert into plat.wordings(class_code, version, status, title, body, source, created_by, approved_by, approved_at)
          values (${w.class_code}, ${w.version || new Date().toISOString().slice(0, 10)}, ${approve ? "approved" : "proposed"}, ${w.title || null}, ${w.body},
            ${w.source || 'Edited in the system'}, ${email}, ${approve ? email : null}, ${approve ? new Date().toISOString() : null}) returning id, status`;
      });
      await audit({ class_code: w.class_code, version: w.version, status: row.status });
      return json({ ok: true, status: row.status });
    }

    if (a === "endorse") {
      const e = body.e || {};
      const [p] = await sql`select id, gross_premium, sum_insured from plat.policies where policy_no=${e.policy_no}`;
      if (!p) return json({ error: "Policy not found" }, 404);
      let title = e.title, text = e.body, prem = num(e.premium);
      if (e.clause_code) {
        const [c] = await sql`select * from plat.clauses where code=${e.clause_code}`;
        if (!c) return json({ error: "Clause not found" }, 404);
        title = title || c.title; text = text || c.body;
        if (prem === null) prem = c.premium_basis === "flat" ? Number(c.premium_value) * Math.max(1, Number(e.units) || 1)
          : c.premium_basis === "pct_premium" ? Math.round(Number(p.gross_premium) * Number(c.premium_value)) / 100
          : c.premium_basis === "pct_value" ? Math.round(Number(p.sum_insured) * Number(c.premium_value)) / 100 : 0;
      }
      if (!title || !text) return json({ error: "Give the clause title and wording" }, 400);
      const [r] = await sql`select plat.endorse(${p.id}, ${e.clause_code || null}, ${title}, ${text}, ${prem || 0}, ${email}, ${e.date || new Date().toISOString().slice(0, 10)}::date) id`;
      await audit({ ...e, premium: prem });
      return json({ ok: true, id: r.id, premium: prem || 0 });
    }

    if (a === "add_user") {
      const x = body.u || {};
      await sql`insert into plat.users(email, name, role, title, authority_limit) values (${String(x.email).toLowerCase().trim()}, ${x.name || null}, ${x.role || 'viewer'}, ${x.title || null}, ${num(x.authority_limit)})
        on conflict (email) do update set role = excluded.role, name = excluded.name, title = excluded.title, authority_limit = excluded.authority_limit`;
      await audit(x);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e).replace(/^.*ERROR:\s*/, "");
    return json({ error: msg }, 400);
  }
});
