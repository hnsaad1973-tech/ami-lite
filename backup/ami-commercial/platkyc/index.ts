// platkyc v1.6 (20 Nov 2026: stickers and ECOWAS Brown Cards — stock register (Ministry of Transport numbered stickers, Brown Card certificates), allocate to each vehicle of a policy, void/lost with reason) — v1.5 (20 Nov 2026: generate new policy — replaces an old (opening book / register) policy with a new Platinum policy number and document; old number kept for reference; accounts untouched) — v1.4 (20 Nov 2026: extra details on client files — any label and value, added with a + button) — v1.3 (20 Nov 2026: client files editable — client contact details, terms, policies list; a change to a signed file sends it back for signing) — v1.2 (20 Nov 2026: missing-details list on every KYC; Sales can add missing details while the file is with Underwriting) — v1.1 (20 Nov 2026: client underwriting files — one per client, proposed from the book, signed by Underwriting/GM/CEO) — v1.0 (20 Nov 2026) — Platinum KYC: client identity files. Sales captures details and uploads documents for their own clients;
// Underwriting / GM / CEO verify (never the person who submitted); risk rating and next review date are set automatically; documents in private storage (plat-kyc).
// Same sign-in and roles as `plat` (plat.users). Every action is written to plat.audit.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
const kycStore = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).storage.from("plat-kyc");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const ACTIONS: Record<string, string[]> = {
  kyc_list: ["admin","gm","underwriter","sales","board"],
  kyc_get: ["admin","gm","underwriter","sales"],
  kyc_save: ["admin","gm","underwriter","sales"],
  kyc_doc_add: ["admin","gm","underwriter","sales"],
  kyc_doc_open: ["admin","gm","underwriter","sales"],
  kyc_verify: ["admin","gm","underwriter"],
  kyc_summary: ["admin","gm","board","underwriter","accountant"],
  uw_files: ["admin","gm","underwriter","board"],
  uw_file_save: ["admin","gm","underwriter"],
  uw_file_get: ["admin","gm","underwriter"],
  pol_reissue: ["admin","gm","underwriter"],
  cert_list: ["admin","gm","underwriter","board"],
  cert_add: ["admin","gm","underwriter"],
  cert_policy: ["admin","gm","underwriter"],
  cert_allocate: ["admin","gm","underwriter"],
  cert_void: ["admin","gm","underwriter"],
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

    if (a === "kyc_summary") {
      return json({ rows: await sql`select status, risk, count(*)::int clients, count(*) filter (where pep)::int pep, count(*) filter (where next_review < current_date)::int review_overdue,
        count(*) filter (where id_expiry < current_date)::int id_expired from plat.kyc group by status, risk order by status, risk` });
    }
    const kycCanSee = async (partyId: number) => {
      if (me.role !== "sales") return true;
      const [x] = await sql`select 1 from plat.parties h where h.id=${partyId} and (lower(h.added_by)=${email}
        or exists (select 1 from plat.policies p where p.holder_id=h.id and p.created_by=${email}))`;
      return !!x;
    };
    const kycRisk = (k: any) => {
      const prem = Number(k.expected_annual_premium || 0);
      if (k.pep || (k.sanctions_note && /hit|match/i.test(k.sanctions_note) && !/no (hit|match)/i.test(k.sanctions_note)) || prem > 50000 || (k.client_type === "company" && !String(k.beneficial_owners || "").trim())) return "high";
      if (k.client_type === "company" || prem > 10000 || (k.nationality && !/liberia/i.test(k.nationality))) return "medium";
      return "low";
    };
    const KYC_FIELDS = ["client_type","full_name","id_type","id_number","id_issue_date","id_expiry","date_of_birth","nationality","gender","occupation","employer_business",
      "residential_address","county","company_reg_no","date_incorporated","business_type","directors","beneficial_owners","authorised_signatory","tin","phone","email",
      "source_of_funds","expected_annual_premium","pep","pep_detail","sanctions_checked","sanctions_note"];
    const kycMissing = (v: any, docs: any[]) => {
      const miss: string[] = [];
      const need = v.client_type === "company"
        ? [["full_name","company name"],["company_reg_no","business registration number"],["business_type","type of business"],["directors","directors"],["beneficial_owners","owners (25% or more)"],["authorised_signatory","authorised signatory"],["residential_address","business address"],["tin","TIN"],["phone","phone"],["source_of_funds","source of funds"]]
        : [["full_name","full name"],["id_type","ID type"],["id_number","ID number"],["id_expiry","ID expiry date"],["date_of_birth","date of birth"],["nationality","nationality"],["occupation","occupation"],["residential_address","home address"],["phone","phone"],["source_of_funds","source of funds"]];
      for (const [f, l] of need) if (!v[f]) miss.push(l);
      if (v.pep && !v.pep_detail) miss.push("PEP details (position held)");
      const kinds = new Set((docs || []).map((d: any) => d.kind));
      if (v.client_type === "company") { if (!kinds.has("registration")) miss.push("business registration certificate (upload)"); if (!kinds.has("id")) miss.push("ID of the authorised signatory (upload)"); }
      else if (!kinds.has("id")) miss.push("copy of the ID (upload)");
      if (v.id_expiry && new Date(v.id_expiry) < new Date(new Date().toISOString().slice(0, 10))) miss.push("a valid ID — the one given has expired");
      return miss;
    };

    if (a === "kyc_list") {
      const rows = await sql`select h.id party_id, h.name client, h.company, h.phone, coalesce(k.status,'none') kyc_status, k.risk, k.client_type, k.id_expiry,
          k.next_review, jsonb_array_length(coalesce(k.docs,'[]'::jsonb))::int docs, k.submitted_by, k.verified_by, k.verified_at::date verified_on, h.added_by
        from plat.parties h left join plat.kyc k on k.party_id=h.id
        where h.kind='policyholder' and (${me.role} <> 'sales' or lower(h.added_by)=${email}
          or exists (select 1 from plat.policies p where p.holder_id=h.id and p.created_by=${email}))
        order by case coalesce(k.status,'none') when 'submitted' then 0 when 'rejected' then 1 when 'none' then 2 when 'draft' then 3 else 4 end, h.name`;
      if (me.role === "board") return json({ rows: rows.map((r: any) => ({ client: r.client, kyc_status: r.kyc_status, risk: r.risk, next_review: r.next_review })) });
      const full = await sql`select * from plat.kyc`;
      const byP = new Map(full.map((k: any) => [Number(k.party_id), k]));
      return json({ rows: rows.map((r: any) => { const k: any = byP.get(Number(r.party_id)); return { ...r, missing: k ? kycMissing(k, k.docs).length : null }; }) });
    }

    if (a === "kyc_get") {
      const pid = num(body.party_id)!;
      if (!(await kycCanSee(pid))) return json({ error: "You can only open your own clients" }, 403);
      const [h] = await sql`select id, name, company, phone, email, address from plat.parties where id=${pid} and kind='policyholder'`;
      if (!h) return json({ error: "Client not found" }, 404);
      const [k] = await sql`select * from plat.kyc where party_id=${pid}`;
      return json({ party: h, kyc: k || null, missing: k ? kycMissing(k, k.docs) : null });
    }

    if (a === "kyc_save") {
      const pid = num(body.party_id)!; const k = body.k || {}; const submit = !!body.submit;
      if (!(await kycCanSee(pid))) return json({ error: "You can only work on your own clients" }, 403);
      const [h] = await sql`select id, name, phone, email, address from plat.parties where id=${pid} and kind='policyholder'`;
      if (!h) return json({ error: "Client not found" }, 404);
      const [old] = await sql`select * from plat.kyc where party_id=${pid}`;
      if (me.role === "sales" && old && !["draft","rejected","submitted"].includes(old.status)) return json({ error: "This KYC is already verified. Ask Underwriting if something must change." }, 400);
      const v: any = {};
      for (const f of KYC_FIELDS) {
        let x = k[f];
        if (f === "pep" || f === "sanctions_checked") x = !!x;
        else if (f === "expected_annual_premium") x = num(x);
        else { x = x === undefined || x === null ? "" : String(x).trim(); if (x === "") x = null; }
        v[f] = x;
      }
      if (me.role === "sales" && old) { v.sanctions_checked = old.sanctions_checked; v.sanctions_note = old.sanctions_note; }
      if (!["individual","company"].includes(v.client_type)) v.client_type = "individual";
      v.full_name = v.full_name || h.name; v.phone = v.phone || h.phone; v.email = v.email || h.email; v.residential_address = v.residential_address || h.address;
      v.risk = kycRisk(v);
      if (submit) {
        const miss = kycMissing(v, (old?.docs || []) as any[]);
        if (miss.length) return json({ error: "Before sending to Underwriting, add: " + miss.join(", ") }, 400);
      }
      const status = submit ? "submitted" : (old && old.status !== "rejected" ? old.status : "draft");
      const row = { ...v, status, submitted_by: submit ? email : old?.submitted_by || null, submitted_at: submit ? new Date() : old?.submitted_at || null };
      if (old) {
        await sql`update plat.kyc set ${sql(row, ...Object.keys(row))}, updated_at=now() where party_id=${pid}`;
      } else {
        await sql`insert into plat.kyc ${sql({ ...row, party_id: pid, created_by: email })}`;
      }
      await audit({ party_id: pid, client: h.name, status, risk: v.risk });
      const [nk] = await sql`select docs from plat.kyc where party_id=${pid}`;
      return json({ ok: true, status, risk: v.risk, missing: kycMissing(v, nk?.docs || []) });
    }

    if (a === "kyc_doc_add") {
      const pid = num(body.party_id)!; const d = body.d || {};
      if (!(await kycCanSee(pid))) return json({ error: "You can only work on your own clients" }, 403);
      if (!d.file?.b64) return json({ error: "Choose a file" }, 400);
      const kind = ["id","address","registration","tin","other"].includes(d.kind) ? d.kind : "other";
      let [k] = await sql`select id, status, docs from plat.kyc where party_id=${pid}`;
      if (me.role === "sales" && k && !["draft","rejected","submitted"].includes(k.status)) return json({ error: "This KYC is already verified. Ask Underwriting to add the document." }, 400);
      if (!k) [k] = await sql`insert into plat.kyc(party_id, created_by, status) values (${pid}, ${email}, 'draft') returning id, status, docs`;
      const bytes = Uint8Array.from(atob(d.file.b64), (c) => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return json({ error: "File is over 10 MB" }, 400);
      const safe = String(d.file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
      const path = `${pid}/${Date.now()}_${kind}_${safe}`;
      const { error } = await kycStore.upload(path, bytes, { contentType: d.file.type || "application/octet-stream", upsert: false });
      if (error) return json({ error: error.message }, 400);
      const doc = { kind, name: safe, path, by: email, at: new Date().toISOString() };
      await sql`update plat.kyc set docs = docs || ${sql.json([doc] as any)}, updated_at=now() where id=${k.id}`;
      await audit({ party_id: pid, kind, name: safe });
      return json({ ok: true });
    }

    if (a === "kyc_doc_open") {
      const pid = num(body.party_id)!;
      if (!(await kycCanSee(pid))) return json({ error: "You can only open your own clients" }, 403);
      const [k] = await sql`select docs from plat.kyc where party_id=${pid}`;
      const doc = ((k?.docs || []) as any[]).find((x) => x.path === body.path);
      if (!doc) return json({ error: "Document not found" }, 404);
      const { data, error } = await kycStore.createSignedUrl(doc.path, 300);
      if (error) return json({ error: error.message }, 400);
      await audit({ party_id: pid, opened: doc.name });
      return json({ url: data.signedUrl });
    }

    if (a === "kyc_verify") {
      const pid = num(body.party_id)!; const ok = body.decision === "verify"; const note = String(body.note || "").trim();
      const [k] = await sql`select * from plat.kyc where party_id=${pid}`;
      if (!k) return json({ error: "No KYC for this client yet" }, 404);
      if (k.status !== "submitted") return json({ error: "Only a submitted KYC can be verified or sent back" }, 400);
      if (String(k.submitted_by || "").toLowerCase() === email) return json({ error: "You submitted this KYC — someone else must verify it" }, 403);
      if (!ok && !note) return json({ error: "Give the reason for sending it back" }, 400);
      if (ok && !k.sanctions_checked) return json({ error: "Set 'Sanctions list checked' to Yes (and note the result) before verifying" }, 400);
      const years = k.risk === "high" ? 1 : k.risk === "medium" ? 2 : 3;
      const due = new Date(); due.setFullYear(due.getFullYear() + years);
      await sql`update plat.kyc set status=${ok ? "verified" : "rejected"}, verified_by=${email}, verified_at=now(), verify_note=${note || null},
        next_review=${ok ? due.toISOString().slice(0, 10) : null}, updated_at=now() where party_id=${pid}`;
      await audit({ party_id: pid, decision: ok ? "verified" : "rejected", note });
      return json({ ok: true, status: ok ? "verified" : "rejected" });
    }

    if (a === "uw_files") {
      const rows = await sql`select u.party_id, h.name client, k.client_type, coalesce(k.status,'none') kyc, u.covers, u.policies, u.vehicles, u.total_premium, u.outstanding, u.claims,
          u.next_renewal, u.fleet_terms, u.deductibles, u.special_terms, u.risk_notes, u.status, u.signed_by, u.signed_at::date signed_on, u.sign_note
        from plat.client_uw u join plat.parties h on h.id=u.party_id left join plat.kyc k on k.party_id=u.party_id order by u.total_premium desc nulls last`;
      if (me.role === "board") return json({ rows: rows.map((r: any) => ({ client: r.client, covers: r.covers, vehicles: r.vehicles, total_premium: r.total_premium, status: r.status })) });
      return json({ rows });
    }

    if (a === "uw_file_get") {
      const pid = num(body.party_id)!;
      const [h] = await sql`select id, name, company, phone, email, address, notes from plat.parties where id=${pid}`;
      if (!h) return json({ error: "Client not found" }, 404);
      const [u] = await sql`select * from plat.client_uw where party_id=${pid}`;
      const pols = await sql`select p.policy_no, p.old_policy_no replaces, (p.source <> 'app' and p.old_policy_no is null) is_old, pc.name cover, p.start_date, p.end_date, (select count(*)::int from plat.policy_items i where i.policy_id=p.id) items, p.gross_premium,
          p.gross_premium + coalesce(p.tax,0) + coalesce(p.policy_fee,0) - coalesce((select sum(amount) from plat.receipts r where r.policy_id=p.id),0) unpaid, p.status
        from plat.policies p join plat.product_classes pc on pc.code=p.class_code where p.holder_id=${pid} order by p.start_date, p.policy_no`;
      return json({ party: h, file: u || null, policies: pols });
    }

    if (a === "uw_file_save") {
      const f = body.f || {}; const pid = num(f.party_id)!;
      const [u] = await sql`select * from plat.client_uw where party_id=${pid}`;
      if (!u) return json({ error: "Client file not found" }, 404);
      const sign = f.decision === "sign", decline = f.decision === "decline";
      if ((sign || decline) && !String(f.note || "").trim()) return json({ error: "Add a sign-off note (what was checked)" }, 400);
      const t = (x: unknown, d: unknown) => { const v = String(x ?? d ?? "").trim(); return v || null; };
      if (f.client) {
        const c = f.client; const [h] = await sql`select * from plat.parties where id=${pid}`;
        const name = t(c.name, h.name);
        if (!name) return json({ error: "Client name cannot be empty" }, 400);
        await sql`update plat.parties set name=${name}, company=${t(c.company, h.company)}, phone=${t(c.phone, h.phone)}, email=${t(c.email, h.email)}, address=${t(c.address, h.address)}, notes=${t(c.notes, h.notes)} where id=${pid}`;
      }
      let extra = u.extra || [];
      if (Array.isArray(f.extra)) extra = f.extra.map((x: any) => ({ label: String(x?.label || "").trim().slice(0, 80), value: String(x?.value || "").trim().slice(0, 2000) })).filter((x: any) => x.label || x.value).slice(0, 50);
      const changed = ["fleet_terms","deductibles","special_terms","risk_notes"].some((k) => f[k] !== undefined && t(f[k], null) !== (u[k] ?? null)) || !!f.client_changed || JSON.stringify(extra) !== JSON.stringify(u.extra || []);
      const status = sign ? "signed" : decline ? "declined" : (u.status === "signed" && changed ? "proposed" : u.status);
      await sql`update plat.client_uw set fleet_terms=${t(f.fleet_terms, u.fleet_terms)}, deductibles=${t(f.deductibles, u.deductibles)},
        special_terms=${t(f.special_terms, u.special_terms)}, risk_notes=${t(f.risk_notes, u.risk_notes)}, extra=${sql.json(extra as any)},
        status=${status}, signed_by=${sign || decline ? email : status === "proposed" ? null : u.signed_by}, signed_at=${sign || decline ? new Date() : status === "proposed" ? null : u.signed_at},
        sign_note=${sign || decline ? String(f.note).trim() : status === "proposed" ? null : u.sign_note}, updated_at=now() where party_id=${pid}`;
      await audit({ party_id: pid, decision: f.decision || "edit", resign: u.status === "signed" && status === "proposed" });
      return json({ ok: true, status });
    }

    if (a === "pol_reissue") {
      // one policy (policy_no) or all old ones (all:true, optional party_id)
      const all = !!body.all; const pid = num(body.party_id);
      const list = all
        ? await sql`select id, policy_no, start_date from plat.policies where source <> 'app' and old_policy_no is null and status <> 'cancelled' ${pid ? sql`and holder_id=${pid}` : sql``} order by start_date, id`
        : await sql`select id, policy_no, start_date, source, old_policy_no from plat.policies where policy_no=${String(body.policy_no || "")}`;
      if (!list.length) return json({ error: all ? "No old policies left to replace" : "Policy not found" }, 404);
      if (!all && (list[0].source === "app" || list[0].old_policy_no)) return json({ error: "This policy is already a Platinum policy" }, 400);
      const done: any[] = [];
      for (const p of list) {
        const [s2] = await sql`select nextval('plat.policy_seq') n`;
        const dt = new Date(p.start_date);
        const no = `PIL${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCFullYear()).slice(2)}/${s2.n}`;
        await sql`update plat.policies set old_policy_no=${p.policy_no}, policy_no=${no}, reissued_at=now(), reissued_by=${email},
          wording_id=coalesce(wording_id, (select id from plat.wordings w where w.class_code=plat.policies.class_code and w.status in ('approved','proposed') order by (w.status='approved') desc, w.effective_date desc, w.id desc limit 1))
          where id=${p.id}`;
        done.push({ old: p.policy_no, new: no });
      }
      await audit({ reissued: done });
      return json({ ok: true, done });
    }

    // ---------- stickers and Brown Cards (v1.6) ----------
    const KINDS: Record<string, string> = { sticker: "Insurance sticker", brown_card: "Brown Card" };
    if (a === "cert_list") {
      const rows = await sql`select c.id, c.kind, c.serial, c.status, c.batch, c.supplier, c.received_on, c.unit_cost, p.policy_no, h.name client,
          coalesce(i.make_model, i.description) vehicle, i.plate_no, c.allocated_by, c.allocated_at::date allocated_on, c.void_reason
        from plat.certificates c left join plat.policies p on p.id=c.policy_id left join plat.parties h on h.id=p.holder_id left join plat.policy_items i on i.id=c.item_id
        order by c.kind, c.status <> 'in_stock', c.serial`;
      const [sum] = await sql`select count(*) filter (where kind='sticker' and status='in_stock')::int stickers_in_stock, count(*) filter (where kind='sticker' and status='allocated')::int stickers_used,
          count(*) filter (where kind='brown_card' and status='in_stock')::int brown_in_stock, count(*) filter (where kind='brown_card' and status='allocated')::int brown_used,
          count(*) filter (where status in ('void','lost'))::int void_lost,
          (select count(*)::int from plat.policy_items i join plat.policies p on p.id=i.policy_id where p.class_code in ('MTPL','MCOMP','MTPFT','MFLEET') and p.status<>'cancelled'
             and not exists (select 1 from plat.certificates c where c.item_id=i.id and c.kind='sticker' and c.status='allocated')) vehicles_without_sticker
        from plat.certificates`;
      if (me.role === "board") return json({ rows: [], sum });
      return json({ rows, sum });
    }

    if (a === "cert_add") {
      const c = body.c || {}; const kind = c.kind === "brown_card" ? "brown_card" : "sticker";
      let serials: string[] = [];
      if (String(c.list || "").trim()) serials = String(c.list).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      else {
        const from = String(c.from || "").trim(), to = String(c.to || "").trim();
        const mf = from.match(/^(.*?)(\d+)$/), mt = to.match(/^(.*?)(\d+)$/);
        if (!mf || !mt || mf[1] !== mt[1]) return json({ error: "Give a range like PIL0001 to PIL0500 (same letters, numbers at the end), or paste a list" }, 400);
        const a1 = parseInt(mf[2], 10), a2 = parseInt(mt[2], 10), w = mf[2].length;
        if (a2 < a1 || a2 - a1 > 5000) return json({ error: "Range must go upwards and be at most 5,000 numbers" }, 400);
        for (let n = a1; n <= a2; n++) serials.push(mf[1] + String(n).padStart(w, "0"));
      }
      if (!serials.length) return json({ error: "No numbers given" }, 400);
      if (serials.length > 5000) return json({ error: "At most 5,000 at a time" }, 400);
      const rows = serials.map((s) => ({ kind, serial: s, batch: String(c.batch || "").trim() || null, supplier: String(c.supplier || "").trim() || (kind === "sticker" ? "Ministry of Transport" : null),
        received_on: c.received_on || null, unit_cost: num(c.unit_cost), added_by: email }));
      const ins = await sql`insert into plat.certificates ${sql(rows)} on conflict (kind, serial) do nothing returning id`;
      await audit({ kind, added: ins.length, skipped: serials.length - ins.length, first: serials[0], last: serials[serials.length - 1] });
      return json({ ok: true, added: ins.length, skipped: serials.length - ins.length });
    }

    if (a === "cert_policy") {
      const [p] = await sql`select p.id, p.policy_no, p.old_policy_no, p.class_code, h.name client from plat.policies p left join plat.parties h on h.id=p.holder_id
        where p.policy_no=${String(body.policy_no || "").trim()} or p.old_policy_no=${String(body.policy_no || "").trim()} limit 1`;
      if (!p) return json({ error: "Policy not found" }, 404);
      const items = await sql`select i.id item_id, coalesce(i.make_model, i.description) vehicle, i.plate_no, i.chassis_vin,
          (select serial from plat.certificates c where c.item_id=i.id and c.kind='sticker' and c.status='allocated' limit 1) sticker,
          (select serial from plat.certificates c where c.item_id=i.id and c.kind='brown_card' and c.status='allocated' limit 1) brown_card
        from plat.policy_items i where i.policy_id=${p.id} order by i.id`;
      const next = await sql`select kind, min(serial) serial from plat.certificates where status='in_stock' group by kind`;
      return json({ policy: p, items, next });
    }

    if (a === "cert_allocate") {
      const k = body.k || {}; const kind = k.kind === "brown_card" ? "brown_card" : "sticker"; const itemId = num(k.item_id)!;
      const [it] = await sql`select i.id, i.policy_id, i.plate_no from plat.policy_items i where i.id=${itemId}`;
      if (!it) return json({ error: "Vehicle not found" }, 404);
      const [have] = await sql`select serial from plat.certificates where item_id=${itemId} and kind=${kind} and status='allocated'`;
      if (have) return json({ error: `This vehicle already has ${KINDS[kind]} ${have.serial}. Void it first to give a new one.` }, 400);
      if (k.plate_no !== undefined && String(k.plate_no).trim()) await sql`update plat.policy_items set plate_no=${String(k.plate_no).trim()} where id=${itemId}`;
      const serial = String(k.serial || "").trim();
      const [c] = serial
        ? await sql`select id, serial, status from plat.certificates where kind=${kind} and serial=${serial}`
        : await sql`select id, serial, status from plat.certificates where kind=${kind} and status='in_stock' order by serial limit 1`;
      if (!c) return json({ error: serial ? `${KINDS[kind]} ${serial} is not in the register. Upload it to stock first.` : `No ${KINDS[kind]}s left in stock` }, 400);
      if (c.status !== "in_stock") return json({ error: `${KINDS[kind]} ${c.serial} is ${c.status.replace("_", " ")}` }, 400);
      await sql`update plat.certificates set status='allocated', policy_id=${it.policy_id}, item_id=${itemId}, allocated_by=${email}, allocated_at=now() where id=${c.id}`;
      await audit({ kind, serial: c.serial, item_id: itemId, policy_id: it.policy_id });
      return json({ ok: true, serial: c.serial });
    }

    if (a === "cert_void") {
      const k = body.k || {}; const reason = String(k.reason || "").trim();
      if (!reason) return json({ error: "Give the reason (spoilt, lost, returned, wrong vehicle…)" }, 400);
      const [c] = await sql`select id, kind, serial, status from plat.certificates where id=${num(k.id)}`;
      if (!c) return json({ error: "Not found" }, 404);
      const status = k.lost ? "lost" : "void";
      await sql`update plat.certificates set status=${status}, void_reason=${reason} where id=${c.id}`;
      await audit({ kind: c.kind, serial: c.serial, from: c.status, to: status, reason });
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Server error" }, 500);
  }
});
