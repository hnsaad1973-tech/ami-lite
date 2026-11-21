// AMI `followup` v1.1.1 (20 Nov 2026: contact search fixed — a name search no longer matches every number) — v1.1 (20 Nov 2026: AMI contact list — synced from the Contacts Master sheet; add/edit contacts (written back to the sheet); WhatsApp message and Gmail email to any contact (Chairman taps Send = his yes); new job (follow-up) from a contact) — v1.0 (20 Nov 2026) — the follow-up engine (AMI's first "muscle").
// Every task gets an owner, a phone and a due date. On weekdays at 09:00 and 14:00 Monrovia time AMI chases each open task that is
// due or overdue on WhatsApp (approved template ami_message), at most once per `every_days`, and the Chairman gets a 07:00 report.
// BUDGET CAP (Chairman, 20 Nov 2026): every chase is logged to ami_usage (source "followup"); when this month's follow-up spend
// reaches ami_settings.followup_cap_usd (default 50) AMI stops chasing and tells the Chairman once — nothing is left half-sent.
// Access: the Chairman's AMI 1 sign-in token, or the internal key (cron).
import postgres from "npm:postgres@3.4.4";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const SB = Deno.env.get("SUPABASE_URL") || "";
const OWNER = "hnsaad1973@gmail.com";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const TPL_MESSAGE = "HX76d27943ed9afb1b9c3f6583db61940a"; // ami_message: "Hello {{1}}, this is AMI, Hussein Saad's assistant. {{2}} Please reply here and I will pass your answer to Hussein."
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const setting = async (k: string) => String((await sql`select value from ami_settings where key=${k}`)[0]?.value || "").trim();
const phoneOk = (p: string) => /^\+\d{8,15}$/.test(p);
const clean = (p: unknown) => { let s = String(p || "").replace(/[^\d+]/g, ""); if (s && !s.startsWith("+")) s = s.startsWith("0") ? "+231" + s.slice(1) : "+" + s; return s; };

const SHEET = "1mMRxkXwKLsAZ0FkbOPhgOVbxgcnGBSznm9aJ_DxPe34"; // Contacts Master: Name | Group | Company | Role | WhatsApp / mobile | Other numbers | Email | Country | Note | Check
async function gtoken() {
  const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "", grant_type: "refresh_token" }) })).json();
  if (!t.access_token) throw new Error("Google sign-in failed"); return t.access_token as string;
}
async function syncContacts() {
  const tok = await gtoken();
  const v = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'Contacts'!A2:J8000")}`, { headers: { Authorization: "Bearer " + tok } })).json();
  if (!v.values) throw new Error(v.error?.message || "Could not read the Contacts Master sheet");
  const rows = (v.values as string[][]).map((r, i) => ({ row: i + 2, name: (r[0] || "").trim(), grp: r[1] || null, company: r[2] || null, role: r[3] || null, phone: clean(r[4]) || null, other: r[5] || null, email: (r[6] || "").trim() || null, country: r[7] || null, note: r[8] || null })).filter((r) => r.name);
  await sql.begin(async (t) => {
    await t`delete from ami_people where source='sheet'`;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ name: r.name, grp: r.grp, company: r.company, role: r.role, phone: r.phone, other_numbers: r.other, email: r.email, country: r.country, note: r.note, source: "sheet", sheet_row: r.row }));
      await t`insert into ami_people ${t(chunk)}`;
    }
    // AMI-only contacts that are now in the sheet are dropped (the sheet copy wins)
    await t`delete from ami_people a where a.source in ('ami','sheet_pending') and exists (select 1 from ami_people s where s.source='sheet' and (lower(s.name)=lower(a.name) or (a.phone is not null and s.phone=a.phone)))`;
  });
  return rows.length;
}
async function appendToSheet(c: any) {
  try { const tok = await gtoken();
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'Contacts'!A:J")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ values: [[c.name, c.grp || "", c.company || "", c.role || "", c.phone || "", c.other_numbers || "", c.email || "", c.country || "", c.note || "Added from AMI", ""]] }) });
    return r.ok; } catch (_) { return false; }
}
async function sendText(name: string, phone: string, text: string, job: string) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST",
    headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${phone}`, ContentSid: TPL_MESSAGE, ContentVariables: JSON.stringify({ "1": String(name).split(" ")[0], "2": text.replace(/\s+/g, " ").slice(0, 900) }) }) });
  const j = await r.json().catch(() => ({})); const ok = r.ok && !j.error_code;
  await sql`insert into ami_usage(source, seat, provider, model, job, cost_usd, ok) values ('followup', 'WhatsApp message', 'Twilio', 'whatsapp-utility', ${job}, ${ok ? Number(await setting("followup_msg_usd")) || 0.04 : 0}, ${ok})`;
  await sql`insert into ami_messages(user_email, role, section, content) values (${OWNER}, 'assistant', 'WhatsApp', ${`Message to ${name} (${phone}): ${text}${ok ? "" : " — NOT SENT"}`})`.catch(() => null);
  return { ok, error: ok ? null : (j.message || j.error_message || String(r.status)) };
}
async function sendEmail(to: string, subject: string, body: string) {
  const tok = await gtoken();
  const enc = (x: string) => "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(x))) + "?=";
  const mime = [`To: ${to}`, `Subject: ${enc(subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", btoa(unescape(encodeURIComponent(body)))].join("\r\n");
  const raw = btoa(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  const j = await r.json().catch(() => ({}));
  await sql`insert into ami_messages(user_email, role, section, content) values (${OWNER}, 'assistant', 'Email', ${`Email to ${to} — ${subject}${r.ok ? "" : " — NOT SENT: " + (j.error?.message || r.status)}`})`.catch(() => null);
  return { ok: r.ok, id: j.id, error: r.ok ? null : (j.error?.message || String(r.status)) };
}
async function notify(text: string) {
  await fetch(`${SB}/functions/v1/amisend`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": await setting("wake_key") }, body: JSON.stringify({ action: "notify", text }) }).catch(() => null);
}
async function monthSpend() {
  const [r] = await sql`select coalesce(sum(cost_usd),0)::float s from ami_usage where source='followup' and at >= date_trunc('month', now())`;
  return r.s as number;
}
async function sendChase(f: any) {
  const first = String(f.who).split(" ")[0];
  const due = new Date(f.due).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  const when = due < today ? `It was due on ${due} and is now overdue.` : `It is due today (${due}).`;
  const msg = `Follow-up: ${f.task}. ${when} Is it done? Reply DONE, or tell me the new date and what is holding it up.`.replace(/\s+/g, " ").slice(0, 900);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST",
    headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${f.phone}`, ContentSid: TPL_MESSAGE, ContentVariables: JSON.stringify({ "1": first, "2": msg }) }) });
  const j = await r.json().catch(() => ({}));
  const ok = r.ok && !j.error_code;
  await sql`insert into ami_usage(source, seat, provider, model, job, cost_usd, ok) values ('followup', 'WhatsApp chase', 'Twilio', 'whatsapp-utility', ${"follow-up #" + f.id}, ${ok ? Number(await setting("followup_msg_usd")) || 0.04 : 0}, ${ok})`;
  if (ok) await sql`update ami_followups set chase_count=chase_count+1, last_chased_at=now() where id=${f.id}`;
  await sql`insert into ami_messages(user_email, role, section, content) values (${OWNER}, 'assistant', 'WhatsApp', ${`Follow-up chase to ${f.who} (${f.phone}): ${msg}${ok ? "" : " — NOT SENT: " + (j.message || j.error_message || r.status)}`})`.catch(() => null);
  return { id: f.id, who: f.who, ok, error: ok ? null : (j.message || j.error_message || String(r.status)) };
}
async function chase() {
  const cap = Number(await setting("followup_cap_usd")) || 50, per = Number(await setting("followup_msg_usd")) || 0.04;
  const due = await sql`select * from ami_followups where status='open' and due <= current_date and phone is not null
    and (last_chased_at is null or last_chased_at < now() - make_interval(days => greatest(every_days,1)) + interval '2 hours') order by due, id limit 40`;
  const sent: any[] = []; let spend = await monthSpend(), stopped = 0;
  for (const f of due) {
    if (spend + per > cap) { stopped = due.length - sent.length; break; }
    const r = await sendChase(f); sent.push(r); if (r.ok) spend += per;
  }
  if (stopped) {
    const key = `followup_cap_warned_${new Date().toISOString().slice(0, 7)}`;
    if (!(await setting(key))) {
      await sql`insert into ami_settings(key,value) values (${key}, ${new Date().toISOString()}) on conflict (key) do update set value=excluded.value`;
      await notify(`Follow-ups paused: this month's chase budget of USD ${cap} is used up (USD ${spend.toFixed(2)}). ${stopped} reminder(s) were not sent. Raise the cap in AMI › Follow-ups to continue.`);
    }
  }
  return { sent, stopped, spend };
}
async function report() {
  const open = await sql`select id, task, who, due, chase_count from ami_followups where status='open' order by due, id`;
  const doneY = await sql`select task, who from ami_followups where status='done' and done_at >= now() - interval '1 day'`;
  const today = new Date().toISOString().slice(0, 10);
  const over = open.filter((f: any) => new Date(f.due).toISOString().slice(0, 10) < today);
  if (!open.length && !doneY.length) return { sent: false };
  const lines = [`📌 Follow-ups: ${open.length} open, ${over.length} overdue, ${doneY.length} done since yesterday.`];
  for (const f of over.slice(0, 8)) lines.push(`⏰ #${f.id} ${f.who}: ${f.task} (due ${new Date(f.due).toISOString().slice(5, 10)}, chased ${f.chase_count}x)${f.chase_count >= 3 ? " — needs you" : ""}`);
  for (const d of doneY.slice(0, 5)) lines.push(`✅ ${d.who}: ${d.task}`);
  await notify(lines.join("\n").slice(0, 900));
  return { sent: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const ik = req.headers.get("x-internal-key") || "";
  if (ik) { if (ik !== await setting("wake_key")) return out({ error: "denied" }, 403); }
  else {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } });
    if (!u.ok) return out({ error: "Not signed in." }, 401);
    if (String((await u.json()).email || "").toLowerCase() !== OWNER) return out({ error: "Access denied." }, 403);
    if (["chase", "report"].includes(p.action)) return out({ error: "denied" }, 403);
  }
  try {
    if (p.action === "list") {
      const items = await sql`select *, (due - current_date) days_left from ami_followups where status='open' or done_at >= now() - interval '7 days' order by (status='open') desc, due, id`;
      const people = await sql`select name, phone, company, role from ami_people where phone is not null order by name`;
      return out({ items, people, cap: Number(await setting("followup_cap_usd")) || 50, spent: await monthSpend(), per_message: Number(await setting("followup_msg_usd")) || 0.04 });
    }
    if (p.action === "add") {
      const f = p.f || {}; const task = String(f.task || "").trim(), who = String(f.who || "").trim();
      if (!task || !who) return out({ error: "Task and person are required" }, 400);
      let phone = clean(f.phone);
      if (!phone) phone = String((await sql`select phone from ami_people where lower(name)=lower(${who})`)[0]?.phone || "");
      if (!phoneOk(phone)) return out({ error: `I need ${who}'s WhatsApp number (with country code, e.g. +231…).` }, 400);
      const [known] = await sql`select id from ami_people where lower(name)=lower(${who}) limit 1`;
      if (known) await sql`update ami_people set phone=coalesce(phone, ${phone}) where id=${known.id}`;
      else { const c = { name: who, phone, company: f.company || null }; await sql`insert into ami_people(name, phone, company, source) values (${who}, ${phone}, ${f.company || null}, ${(await appendToSheet(c)) ? "sheet_pending" : "ami"})`; }
      const [r] = await sql`insert into ami_followups(task, who, phone, company, due, every_days, notes) values (${task}, ${who}, ${phone}, ${f.company || null}, ${f.due || new Date().toISOString().slice(0, 10)}, ${Math.max(1, Number(f.every_days) || 1)}, ${f.notes || null}) returning id`;
      return out({ ok: true, id: r.id });
    }
    if (p.action === "contacts") {
      const q = String(p.q || "").trim();
      const digits = q.replace(/[^\d]/g, ""), like = "%" + q + "%", ph = digits.length >= 4 ? "%" + digits + "%" : "~no-phone-search~";
      const rows = q ? await sql`select id, name, grp, company, role, phone, email, country, note, source from ami_people
          where name ilike ${like} or company ilike ${like} or grp ilike ${like} or role ilike ${like} or email ilike ${like} or phone like ${ph}
          order by (name ilike ${q + "%"}) desc, (name ilike ${"% " + q + "%"}) desc, (phone is null), name limit 60`
        : await sql`select id, name, grp, company, role, phone, email, country, note, source from ami_people order by (source<>'sheet') desc, name limit 60`;
      const [n] = await sql`select count(*)::int n, count(*) filter (where phone is not null)::int wa, count(*) filter (where email is not null)::int em from ami_people`;
      const groups = await sql`select coalesce(grp,'Other') grp, count(*)::int n from ami_people group by 1 order by 2 desc limit 20`;
      const [sync] = await sql`select value from ami_settings where key='contacts_synced_at'`;
      return out({ rows, total: n.n, with_whatsapp: n.wa, with_email: n.em, groups, synced_at: sync?.value || null });
    }
    if (p.action === "sync_contacts") {
      const n = await syncContacts();
      await sql`insert into ami_settings(key,value) values ('contacts_synced_at', ${new Date().toISOString()}) on conflict (key) do update set value=excluded.value`;
      return out({ ok: true, contacts: n });
    }
    if (p.action === "contact_save") {
      const c = p.c || {}; const name = String(c.name || "").trim(); if (!name) return out({ error: "Name is required" }, 400);
      const phone = clean(c.phone); if (phone && !phoneOk(phone)) return out({ error: "Check the WhatsApp number (country code, e.g. +231…)" }, 400);
      const email = String(c.email || "").trim(); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out({ error: "Check the email address" }, 400);
      const row = { name, grp: c.grp || null, company: c.company || null, role: c.role || null, phone: phone || null, email: email || null, country: c.country || null, note: c.note || null };
      if (c.id) { await sql`update ami_people set ${sql(row)} where id=${Number(c.id)}`; return out({ ok: true, sheet: "edit the sheet row too if needed" }); }
      const inSheet = await appendToSheet(row);
      const [r] = await sql`insert into ami_people ${sql({ ...row, source: inSheet ? "sheet_pending" : "ami" })} returning id`;
      return out({ ok: true, id: r.id, sheet: inSheet });
    }
    if (p.action === "message") {
      const [c] = await sql`select name, phone from ami_people where id=${Number(p.id)}`; if (!c?.phone) return out({ error: "No WhatsApp number for this contact" }, 400);
      const text = String(p.text || "").trim(); if (text.length < 2) return out({ error: "Write the message" }, 400);
      const cap = Number(await setting("followup_cap_usd")) || 50; if ((await monthSpend()) >= cap) return out({ error: `This month's WhatsApp budget (USD ${cap}) is used up.` }, 400);
      return out(await sendText(c.name, c.phone, text, "message to " + c.name));
    }
    if (p.action === "email") {
      const [c] = await sql`select name, email from ami_people where id=${Number(p.id)}`; if (!c?.email) return out({ error: "No email for this contact" }, 400);
      const subject = String(p.subject || "").trim(), body = String(p.body || "").trim(); if (!subject || !body) return out({ error: "Subject and message are required" }, 400);
      return out(await sendEmail(c.email, subject, body));
    }
    if (p.action === "done") { await sql`update ami_followups set status='done', done_at=now() where id=${Number(p.id)}`; return out({ ok: true }); }
    if (p.action === "cancel") { await sql`update ami_followups set status='cancelled', done_at=now() where id=${Number(p.id)}`; return out({ ok: true }); }
    if (p.action === "move") { await sql`update ami_followups set due=${String(p.due).slice(0, 10)}, chase_count=0, last_chased_at=null where id=${Number(p.id)}`; return out({ ok: true }); }
    if (p.action === "chase_now") { const [f] = await sql`select * from ami_followups where id=${Number(p.id)} and status='open'`; if (!f) return out({ error: "Not open" }, 400);
      const cap = Number(await setting("followup_cap_usd")) || 50; if ((await monthSpend()) >= cap) return out({ error: `This month's chase budget (USD ${cap}) is used up.` }, 400);
      return out(await sendChase(f)); }
    if (p.action === "set_cap") { const c = Number(p.cap); if (!(c >= 0)) return out({ error: "Bad amount" }, 400);
      await sql`insert into ami_settings(key,value) values ('followup_cap_usd', ${String(c)}) on conflict (key) do update set value=excluded.value`; return out({ ok: true }); }
    if (p.action === "chase") return out(await chase());
    if (p.action === "report") return out(await report());
    return out({ error: "unknown action" }, 400);
  } catch (e) { return out({ error: String((e as Error).message) }, 500); }
});
