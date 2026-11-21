// AMI `mailscan` v1.1 (20 Nov 2026: ASK FOR EMAILS — AMI WhatsApps the contacts the Chairman picks asking for their email; every 10 min the replies are read, the email is saved to the contact (AMI + Contacts Master sheet). Same reader closes a follow-up when the person replies DONE) — v1.0 (20 Nov 2026) — finds the email address of each contact from the Chairman's own Gmail correspondence.
// scan    : reads the From / To / Cc headers of up to 2,000 recent emails (last 2 years, no promotions/social), counts each address.
// match   : contacts that have no email are matched to the addresses whose display name (or address) carries the contact's name.
//           "sure"  = the full name matches one address only;  "check" = partial or more than one candidate.
// Nothing is written to the contact list until the Chairman accepts (one by one, or "accept all sure matches");
// an accepted email is saved in AMI and written into column G of the Contacts Master sheet.
// Access: the Chairman's AMI 1 sign-in token, or the internal key.
import postgres from "npm:postgres@3.4.4";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const SB = Deno.env.get("SUPABASE_URL") || "";
const OWNER = "hnsaad1973@gmail.com";
const SHEET = "1mMRxkXwKLsAZ0FkbOPhgOVbxgcnGBSznm9aJ_DxPe34";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const setting = async (k: string) => String((await sql`select value from ami_settings where key=${k}`)[0]?.value || "").trim();
const put = (k: string, v: string) => sql`insert into ami_settings(key,value) values (${k}, ${v}) on conflict (key) do update set value=excluded.value`;
async function gtoken() {
  const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "", grant_type: "refresh_token" }) })).json();
  if (!t.access_token) throw new Error("Google sign-in failed"); return t.access_token as string;
}
const SKIP = /no-?reply|noreply|notification|mailer-daemon|postmaster|alerts?@|news(letter)?@|info@(google|linkedin|facebook)|@(.*\.)?(google|linkedin|facebook|instagram|twitter|x|amazon|apple|microsoft|zoom|paypal|github|supabase|twilio|zapier|anthropic|openai|stripe|calendly|docusign|dropbox|mailchimp|hubspot)\.com$/i;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["mr", "mrs", "ms", "dr", "eng", "the", "and", "of", "bank", "leb", "lib", "liberia", "sl", "office", "new", "old", "my", "boss", "driver", "ltd", "inc", "llc", "group"]);
const toks = (s: string) => norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

function parseAddrs(h: string) {
  const res: { email: string; display: string }[] = [];
  for (const part of h.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(part) || /^\s*([^\s<>]+@[^\s<>]+)\s*$/.exec(part);
    if (!m) continue;
    const email = (m[2] || m[1]).trim().toLowerCase(), display = m[2] ? m[1].trim() : "";
    if (/@/.test(email)) res.push({ email, display });
  }
  return res;
}
async function scan(maxMsgs = 2000) {
  const tok = await gtoken(), H = { Authorization: "Bearer " + tok };
  const ids: string[] = []; let page = "";
  while (ids.length < maxMsgs) {
    const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent("newer_than:2y -category:promotions -category:social -category:forums")}${page ? "&pageToken=" + page : ""}`;
    const j = await (await fetch(u, { headers: H })).json();
    if (j.error) throw new Error("Gmail: " + j.error.message);
    for (const m of j.messages || []) ids.push(m.id);
    page = j.nextPageToken; if (!page) break;
  }
  const seen = new Map<string, { display: string; msgs: number; last: number }>();
  for (let i = 0; i < ids.length; i += 25) {
    await Promise.all(ids.slice(i, i + 25).map(async (id) => {
      try {
        const j = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`, { headers: H })).json();
        const at = Number(j.internalDate) || 0;
        for (const h of j.payload?.headers || []) for (const a of parseAddrs(String(h.value || ""))) {
          if (a.email === OWNER || SKIP.test(a.email)) continue;
          const s = seen.get(a.email) || { display: "", msgs: 0, last: 0 };
          s.msgs++; if (a.display && a.display.length > s.display.length) s.display = a.display; if (at > s.last) s.last = at;
          seen.set(a.email, s);
        }
      } catch (_) {}
    }));
  }
  const rows = [...seen.entries()].map(([email, s]) => ({ email, display: s.display || null, msgs: s.msgs, last_at: s.last ? new Date(s.last).toISOString() : null, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 500) await sql`insert into ami_email_seen ${sql(rows.slice(i, i + 500))} on conflict (email) do update set display=excluded.display, msgs=excluded.msgs, last_at=excluded.last_at, updated_at=now()`;
  return { messages: ids.length, addresses: rows.length };
}
async function match() {
  const seen = await sql`select email, display, msgs from ami_email_seen`;
  const people = await sql`select id, name, sheet_row from ami_people where (email is null or email='') and name is not null and name not ilike '(no name)%'`;
  // index addresses by name token
  const idx = new Map<string, any[]>();
  for (const s of seen) {
    const local = s.email.split("@")[0].replace(/[._\-0-9]+/g, " ");
    const t = new Set([...toks(s.display || ""), ...toks(local)]);
    (s as any).t = t; (s as any).dn = norm(s.display || "");
    for (const w of t) { const a = idx.get(w) || []; a.push(s); idx.set(w, a); }
  }
  const sugg: any[] = [];
  for (const p of people) {
    const pt = toks(p.name); if (pt.length < 2) continue; // need first + last name to be safe
    const cands = (idx.get(pt[0]) || []).filter((s: any) => pt.every((w) => s.t.has(w)));
    if (!cands.length) continue;
    const pn = norm(p.name);
    const exact = cands.filter((s: any) => s.dn && (s.dn === pn || s.dn === pt.join(" ")));
    const pick = (exact.length === 1 ? exact : cands).sort((a: any, b: any) => b.msgs - a.msgs).slice(0, 3);
    const sure = exact.length === 1 || (cands.length === 1 && cands[0].msgs >= 2);
    for (const s of pick) sugg.push({ contact_id: p.id, contact_name: p.name, sheet_row: p.sheet_row, email: s.email, display: s.display || null, msgs: s.msgs, confidence: sure && s === pick[0] ? "sure" : "check" });
  }
  for (let i = 0; i < sugg.length; i += 500) await sql`insert into ami_email_suggest ${sql(sugg.slice(i, i + 500))} on conflict (contact_name, email) do nothing`;
  return { suggestions: sugg.length, sure: sugg.filter((s) => s.confidence === "sure").length };
}
async function accept(ids: number[]) {
  const rows = await sql`select s.*, p.sheet_row prow from ami_email_suggest s left join ami_people p on p.id=s.contact_id where s.id in ${sql(ids)} and s.status='new'`;
  if (!rows.length) return { accepted: 0, sheet: 0 };
  const tok = await gtoken().catch(() => ""); let sheet = 0;
  for (const r of rows) {
    await sql`update ami_people set email=${r.email} where id=${r.contact_id} and (email is null or email='')`;
    await sql`update ami_email_suggest set status=case when id=${r.id} then 'accepted' else 'skipped' end where contact_name=${r.contact_name} and status='new'`;
    const row = r.prow || r.sheet_row;
    if (tok && row) {
      const u = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'Contacts'!G${row}`)}?valueInputOption=RAW`, { method: "PUT",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ values: [[r.email]] }) });
      if (u.ok) sheet++;
    }
  }
  return { accepted: rows.length, sheet };
}
// ---------- ask contacts for their email on WhatsApp ----------
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "", TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const TPL_MESSAGE = "HX76d27943ed9afb1b9c3f6583db61940a"; // ami_message
const ASK_TEXT = "We are updating Hussein's contact records. Could you please reply to this message with your email address?";
async function spent() { const [r] = await sql`select coalesce(sum(cost_usd),0)::float s from ami_usage where source='followup' and at >= date_trunc('month', now())`; return r.s as number; }
async function ask(ids: number[]) {
  const cap = Number(await setting("followup_cap_usd")) || 50, per = Number(await setting("followup_msg_usd")) || 0.04;
  const people = await sql`select id, name, phone, sheet_row from ami_people where id in ${sql(ids)} and phone is not null
    and id not in (select contact_id from ami_email_requests where contact_id is not null and sent_at > now() - interval '30 days')`;
  let s = await spent(), sent = 0, failed = 0, skipped = 0;
  for (const p of people) {
    if (s + per > cap) { skipped = people.length - sent - failed; break; }
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST",
      headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${p.phone}`, ContentSid: TPL_MESSAGE, ContentVariables: JSON.stringify({ "1": String(p.name).split(" ")[0], "2": ASK_TEXT }) }) });
    const j = await r.json().catch(() => ({})); const ok = r.ok && !j.error_code;
    await sql`insert into ami_usage(source, seat, provider, model, job, cost_usd, ok) values ('followup', 'WhatsApp email request', 'Twilio', 'whatsapp-utility', 'ask for emails', ${ok ? per : 0}, ${ok})`;
    if (ok) { sent++; s += per; await sql`insert into ami_email_requests(contact_id, name, phone, sheet_row) values (${p.id}, ${p.name}, ${p.phone}, ${p.sheet_row})`; } else failed++;
  }
  return { asked: people.length, sent, failed, skipped_budget: skipped, already_asked: ids.length - people.length, cost: +(sent * per).toFixed(2) };
}
async function collect() {
  const since = (await setting("reply_reader_at")) || new Date(Date.now() - 864e5).toISOString();
  const msgs = await sql`select content, created_at from ami_messages where content like '[Reply from %' and created_at > ${since} order by created_at`;
  let saved = 0, done = 0; const savedNames: string[] = [], doneNames: string[] = [];
  const tok = await gtoken().catch(() => "");
  for (const m of msgs) {
    const mm = /^\[Reply from (.*?)\(?(\+\d{8,15})\)?\]\s*([\s\S]*)$/.exec(m.content); if (!mm) continue;
    const phone = mm[2], body = mm[3] || "";
    const em = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/.exec(body);
    const [req] = await sql`select * from ami_email_requests where phone=${phone} and status='sent' order by sent_at desc limit 1`;
    if (req && em) {
      const email = em[0].toLowerCase();
      await sql`update ami_email_requests set status='saved', email=${email}, reply=${body.slice(0, 500)}, replied_at=now() where id=${req.id}`;
      await sql`update ami_people set email=${email} where id=${req.contact_id}`;
      if (tok && req.sheet_row) await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'Contacts'!G${req.sheet_row}`)}?valueInputOption=RAW`, { method: "PUT",
        headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ values: [[email]] }) }).catch(() => null);
      saved++; savedNames.push(`${req.name}: ${email}`);
    } else if (req) await sql`update ami_email_requests set status='replied', reply=${body.slice(0, 500)}, replied_at=now() where id=${req.id}`;
    if (/^\s*(✅\s*)?done\b/i.test(body)) {
      const r = await sql`update ami_followups set status='done', done_at=now(), notes=coalesce(notes,'')||' · closed by reply DONE' where phone=${phone} and status='open' and id=(select id from ami_followups where phone=${phone} and status='open' order by due, id limit 1) returning who, task`;
      if (r.length) { done++; doneNames.push(`${r[0].who}: ${r[0].task}`); }
    }
  }
  if (msgs.length) await put("reply_reader_at", String(msgs[msgs.length - 1].created_at instanceof Date ? msgs[msgs.length - 1].created_at.toISOString() : msgs[msgs.length - 1].created_at));
  if (saved || done) {
    const lines = [...savedNames.slice(0, 8).map((x) => "✉️ " + x), ...doneNames.slice(0, 8).map((x) => "✅ " + x)];
    await fetch(`${SB}/functions/v1/amisend`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": await setting("wake_key") },
      body: JSON.stringify({ action: "notify", text: `AMI updated from replies: ${saved ? saved + " email(s) saved" : ""}${saved && done ? ", " : ""}${done ? done + " follow-up(s) closed" : ""}. ${lines.join(" · ")}`.slice(0, 900) }) }).catch(() => null);
  }
  return { read: msgs.length, saved, done };
}
async function runAll() {
  try { await put("mailscan_status", "scanning Gmail…"); const s = await scan(); await put("mailscan_status", `matching ${s.addresses} addresses…`);
    const m = await match(); await put("mailscan_status", `done: ${s.messages} emails read, ${s.addresses} addresses, ${m.suggestions} suggestions (${m.sure} sure)`); await put("mailscan_at", new Date().toISOString()); }
  catch (e) { await put("mailscan_status", "error: " + String((e as Error).message).slice(0, 200)); }
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
  }
  try {
    if (p.action === "run") { // @ts-ignore
      EdgeRuntime.waitUntil(runAll()); await put("mailscan_status", "starting…"); return out({ started: true }); }
    if (p.action === "list") {
      const rows = await sql`select id, contact_name, email, display, msgs, confidence from ami_email_suggest where status='new' order by (confidence='sure') desc, msgs desc, contact_name limit 120`;
      const [c] = await sql`select count(*) filter (where status='new')::int open, count(*) filter (where status='new' and confidence='sure')::int sure, count(*) filter (where status='accepted')::int accepted from ami_email_suggest`;
      return out({ rows, ...c, status: await setting("mailscan_status"), at: await setting("mailscan_at") });
    }
    if (p.action === "ask") return out(await ask((p.ids || []).map(Number).filter(Boolean).slice(0, 500)));
    if (p.action === "ask_group") { const ids = (await sql`select id from ami_people where coalesce(grp,'Other')=${String(p.grp)} and phone is not null and (email is null or email='') limit 500`).map((r: any) => Number(r.id));
      if (p.preview) return out({ count: ids.length, cost: +(ids.length * (Number(await setting("followup_msg_usd")) || 0.04)).toFixed(2), cap: Number(await setting("followup_cap_usd")) || 50, spent: await spent() });
      return out(await ask(ids)); }
    if (p.action === "collect") return out(await collect());
    if (p.action === "requests") {
      const [c] = await sql`select count(*)::int sent, count(*) filter (where status='saved')::int saved, count(*) filter (where status='replied')::int replied, count(*) filter (where status='sent')::int waiting from ami_email_requests`;
      const recent = await sql`select name, phone, status, email, reply, sent_at, replied_at from ami_email_requests order by coalesce(replied_at, sent_at) desc limit 40`;
      return out({ ...c, recent, ask_text: ASK_TEXT });
    }
    if (p.action === "accept") return out(await accept((p.ids || []).map(Number).filter(Boolean)));
    if (p.action === "accept_sure") { const ids = (await sql`select min(id) id from ami_email_suggest where status='new' and confidence='sure' group by contact_name`).map((r: any) => Number(r.id)); return out(ids.length ? await accept(ids) : { accepted: 0, sheet: 0 }); }
    if (p.action === "reject") { await sql`update ami_email_suggest set status='rejected' where id in ${sql((p.ids || []).map(Number))}`; return out({ ok: true }); }
    return out({ error: "unknown action" }, 400);
  } catch (e) { return out({ error: String((e as Error).message) }, 500); }
});
