// AMI `wake` edge function — v3.7 (10 Nov 2026) — ~5 s pause ends the call; list builder never returns chatter; call orders go straight into the To-do list + Calendar (no WhatsApp, no confirm); Deepgram Nova-3 hearing; "done"/"OK" ends the call — opens with "Your orders, Chairman." then listens silently; up to 3 call attempts
// 1) Calendar reminders: runs every minute (pg_cron); 15 min before each timed event -> WhatsApp + phone call.
// 2) Daily calls: 9pm to-do list for tomorrow and 9am orders.
// 3) Inbound: when the Chairman rings AMI's number, AMI answers and takes orders. Any other caller is rejected.
// Only ever contacts his own number. JSON routes need header x-wake-key; Twilio routes carry ?k=<key>.
// JSON: {"test":true} | {"peek":true} | {"call":"morning"|"evening"|"inbound"} | {"setup":true} | {} (reminder check)

const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ICS_URL = Deno.env.get("GCAL_ICS_URL") || "";
const SELF = "+231777170170";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const TW_VOICE_FROM = Deno.env.get("TWILIO_VOICE_FROM") || TW_FROM;
const LEAD_MIN = Number(Deno.env.get("WAKE_LEAD_MIN") || 15);
const HOME_TZ = "Africa/Monrovia";
const BASE = "https://pdzhlslzwjlhxklqcwus.supabase.co/functions/v1/wake";
const VOICE = `voice="Polly.Amy-Neural" language="en-GB"`;
const MAX_TRIES = 3, RETRY_SEC = 60;
const END_RE = /\b(that'?s (all|it|everything)|nothing else|that will be all|end (the )?call|bye|goodbye|over and out)\b[.!]?\s*$/i;
// "done" said on its own ends the call ("done", "OK done", "I'm done") — but not "the contract is done"
const DONE_RE = /^\s*((ok(ay)?|right|yes|so)[,.]?\s*)?((i'?m|i am|we'?re|we are|all)\s+)?done(\s+(now|for now|ami|chairman))?[.!]?\s*$/i;
const OK_RE = /^\s*(ok(ay)?|ok(ay)? thanks?|ok(ay)? thank you|fine)[.!]?\s*$/i; // a lone "OK" ends the call once at least one order was given
const isEnd = (t: string) => DONE_RE.test(t) || END_RE.test(t);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// run work after the response is sent (Supabase keeps the worker alive for it)
const later = (p: Promise<unknown>) => { /* @ts-ignore */ if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p); };

const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function twilio(path: string, form?: URLSearchParams) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/${path}`, {
    method: form ? "POST" : "GET", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j, info: r.ok ? `ok (${j.sid || ""})` : `error ${j.code || r.status}: ${j.message || ""}` };
}
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function whatsapp(text: string) {
  return twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: text }));
}
function call(spoken: string, statusUrl = "") {
  const twiml = `<Response><Pause length="1"/><Say voice="Polly.Amy-Neural" language="en-GB">${xml(spoken)}</Say><Pause length="1"/><Say voice="Polly.Amy-Neural" language="en-GB">${xml(spoken)}</Say></Response>`;
  const form = new URLSearchParams({ From: TW_VOICE_FROM, To: SELF, Twiml: twiml, Timeout: "45" });
  if (statusUrl) { form.set("StatusCallback", statusUrl); form.set("StatusCallbackMethod", "POST"); form.append("StatusCallbackEvent", "completed"); }
  return twilio("Calls.json", form);
}

// ---------- minimal iCal parsing (with daily/weekly/monthly/yearly repeats) ----------
function unfold(t: string) { return t.replace(/\r?\n[ \t]/g, ""); }
function unesc(s: string) { return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }
function tzOffsetMs(tz: string, d: Date) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p: any = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime();
  } catch { return 0; }
}
// returns {ms, allDay}
function parseDT(params: string, v: string): { ms: number; allDay: boolean } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (!m[4]) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), allDay: true };
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7]) return { ms: naive, allDay: false };
  const tz = (params.match(/TZID=([^;:]+)/i) || [])[1] || HOME_TZ;
  const guess = naive - tzOffsetMs(tz, new Date(naive));
  return { ms: naive - tzOffsetMs(tz, new Date(guess)), allDay: false };
}
type Ev = { uid: string; title: string; where: string; start: number; allDay: boolean; rrule: string; exdates: Set<number>; recId: number | null; cancelled: boolean };
function parseICS(text: string): Ev[] {
  const out: Ev[] = [];
  const blocks = unfold(text).split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const body = b.split("END:VEVENT")[0];
    const ev: Ev = { uid: "", title: "(no title)", where: "", start: 0, allDay: false, rrule: "", exdates: new Set(), recId: null, cancelled: false };
    for (const line of body.split(/\r?\n/)) {
      const i = line.indexOf(":"); if (i < 0) continue;
      const left = line.slice(0, i), val = line.slice(i + 1).trim();
      const name = left.split(";")[0].toUpperCase(), params = left.slice(name.length);
      if (name === "UID") ev.uid = val;
      else if (name === "SUMMARY") ev.title = unesc(val);
      else if (name === "LOCATION") ev.where = unesc(val);
      else if (name === "DTSTART") { const d = parseDT(params, val); if (d) { ev.start = d.ms; ev.allDay = d.allDay; } }
      else if (name === "RRULE") ev.rrule = val;
      else if (name === "EXDATE") for (const x of val.split(",")) { const d = parseDT(params, x); if (d) ev.exdates.add(d.ms); }
      else if (name === "RECURRENCE-ID") { const d = parseDT(params, val); if (d) ev.recId = d.ms; }
      else if (name === "STATUS" && /CANCELLED/i.test(val)) ev.cancelled = true;
    }
    if (ev.uid && ev.start) out.push(ev);
  }
  return out;
}
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
// occurrences of ev starting within [from, to]
function occurrences(ev: Ev, from: number, to: number): number[] {
  if (!ev.rrule) return ev.start >= from && ev.start <= to ? [ev.start] : [];
  const r: any = Object.fromEntries(ev.rrule.split(";").map((p) => p.split("=")));
  const freq = r.FREQ, interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? (parseDT("", r.UNTIL)?.ms ?? Infinity) : Infinity;
  const byday: string[] = r.BYDAY ? r.BYDAY.split(",").map((d: string) => d.slice(-2)) : [];
  const res: number[] = [];
  const DAY = 86400000;
  let n = 0;
  // walk day by day from the series start (capped) — simple and safe for the 2-day lookahead window
  const startDay = ev.start;
  const maxIter = 366 * 30;
  for (let k = 0; k < maxIter; k++) {
    const t = startDay + k * DAY;
    if (t > to || t > until) break;
    const d = new Date(t);
    const daysSince = k;
    let hit = false;
    if (freq === "DAILY") hit = daysSince % interval === 0;
    else if (freq === "WEEKLY") {
      const week = Math.floor(daysSince / 7);
      const dayOk = byday.length ? byday.includes(DAYS[d.getUTCDay()]) : d.getUTCDay() === new Date(startDay).getUTCDay();
      hit = dayOk && week % interval === 0;
    } else if (freq === "MONTHLY") {
      const s = new Date(startDay);
      const months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + d.getUTCMonth() - s.getUTCMonth();
      hit = d.getUTCDate() === s.getUTCDate() && months % interval === 0;
    } else if (freq === "YEARLY") {
      const s = new Date(startDay);
      hit = d.getUTCDate() === s.getUTCDate() && d.getUTCMonth() === s.getUTCMonth() && (d.getUTCFullYear() - s.getUTCFullYear()) % interval === 0;
    } else return ev.start >= from && ev.start <= to ? [ev.start] : [];
    if (!hit) continue;
    n++;
    if (n > count) break;
    if (t >= from && !ev.exdates.has(t)) res.push(t);
  }
  return res;
}
function upcoming(events: Ev[], from: number, to: number) {
  const overrides = new Map<string, Ev>();
  for (const e of events) if (e.recId !== null) overrides.set(e.uid + "|" + e.recId, e);
  const list: { key: string; title: string; where: string; start: number }[] = [];
  for (const e of events) {
    if (e.allDay || e.cancelled || e.recId !== null) continue;
    for (const t of occurrences(e, from, to)) {
      const o = overrides.get(e.uid + "|" + t);
      if (o) continue; // handled by its override below
      list.push({ key: e.uid + "|" + t, title: e.title, where: e.where, start: t });
    }
  }
  for (const o of overrides.values()) if (!o.cancelled && !o.allDay && o.start >= from && o.start <= to)
    list.push({ key: o.uid + "|" + o.recId, title: o.title, where: o.where, start: o.start });
  return list.sort((a, b) => a.start - b.start);
}
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: HOME_TZ });
const spokenTime = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: HOME_TZ }).replace(":00", "");

// ================= PHONE CONVERSATIONS =================
const twiml = (inner: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "Content-Type": "text/xml" } });
const say = (t: string) => `<Say ${VOICE}>${xml(t)}</Say>`;
const turnUrl = (key: string) => xml(`${BASE}?step=turn&k=${key}`);
// His names and words, so speech recognition expects them (plus corrections learned from his WhatsApp edits)
const BASE_HINTS = ["AMI", "Chairman", "Hachem", "Hassan", "Hanan", "Nader", "Nader Ayoub", "Farid", "Alain", "Allan", "Cerra", "Leone", "Leone Investment",
  "Cape Realities", "Platinum", "Platinum Insurers", "The Lead", "Saad Ventures", "M Hotel", "Mamba Point", "JOUN", "Joun", "RED INC", "SIGMA", "CBL",
  "LIB-PSS", "Dongfeng", "GT Bank", "GTBank", "Ecobank", "IBL", "IB Bank", "Bloom Bank", "Zenith", "UBA", "Orange", "ICON-16", "Sinkor", "16th Street",
  "20th Street", "11th Street", "Freetown", "Monrovia", "Buchanan", "Swedish Embassy", "Waves", "Ignite", "Telecel", "WhatsApp", "Drive", "invoice",
  "lease", "tenant", "payables", "receivables", "cash flow", "brief", "contract", "letter", "bank statement", "done", "OK", "VRV", "HVAC"];
let HINTS = BASE_HINTS.join(", ");
async function loadHints() {
  try { const r = await db("ami_settings?key=eq.voice_hints&select=value"); const extra = r.ok ? (await r.json())[0]?.value || "" : "";
    HINTS = [...BASE_HINTS, ...String(extra).split(",").map((x) => x.trim()).filter(Boolean)].slice(0, 400).join(", "); } catch (_) {}
}
// Deepgram Nova-3: strongest accent handling on Twilio; hints = his key terms. AMI is silent between orders,
// so a short 2-second end-of-speech is fine — every piece he says is joined into one list afterwards.
// `wait` = seconds of silence before giving up: 12 for the first order, 3 after an order (2s end-of-speech + 3s = about 5s pause ends the call)
const gather = (key: string, prompt: string, wait = 12) =>
  `<Gather input="speech" action="${turnUrl(key)}" method="POST" language="en" speechModel="deepgram_nova-3" speechTimeout="2" hints="${xml(HINTS)}" actionOnEmptyResult="true" timeout="${wait}">${prompt ? say(prompt) : ""}</Gather>`;
const OPEN = "Your orders, Chairman.";
const VOICEMAIL_RE = /(leave (a|your) message|after the (tone|beep)|not available|voice ?mail|you have reached|you've reached|cannot take your call|is unavailable|mailbox)/i;

async function getCall(sid: string) {
  const r = await db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}&select=*`);
  return r.ok ? (await r.json())[0] || null : null;
}
const saveCall = (sid: string, patch: any) => db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}`, { method: "PATCH", body: JSON.stringify(patch) });

async function todayEvents() {
  if (!ICS_URL) return [];
  try {
    const r = await fetch(ICS_URL); if (!r.ok) return [];
    const now = Date.now();
    const d = new Date(now); const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59); // Monrovia = UTC
    return upcoming(parseICS(await r.text()), now, end);
  } catch { return []; }
}
async function openingLine(kind: string) {
  if (kind === "evening") return "Good evening Chairman. Go ahead with tomorrow's list.";
  if (kind === "inbound") return "Yes Chairman. Go ahead.";
  const ev = (await todayEvents()).slice(0, 5);
  let brief = "Good morning Chairman, it's AMI. ";
  brief += ev.length ? `Today you have ${ev.length === 1 ? "one thing" : ev.length + " things"} in the calendar: ` + ev.map((e) => `${spokenTime(e.start)}, ${e.title}`).join("; ") + ". " : "Your calendar is clear today. ";
  const lr = await db(`ami_calls?kind=eq.evening&summary=not.is.null&created_at=gte.${new Date(Date.now() - 20 * 3600000).toISOString()}&select=summary&order=created_at.desc&limit=1`);
  const last = lr.ok ? (await lr.json())[0]?.summary : "";
  if (last) brief += `Last night's list: ${String(last).replace(/\n/g, " ").slice(0, 350)} `;
  return brief + "Go ahead with your orders.";
}

// Turn what he said on the call into a clean numbered list (his words, nothing added)
async function ordersList(kind: string, said: string[]): Promise<string> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  let facts = "";
  try { const m = await db("ami_memory?select=fact&order=created_at.desc&limit=150"); facts = m.ok ? (await m.json()).map((x: any) => "- " + x.fact).join("\n") : ""; } catch (_) {}
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 900,
        system: `Turn the Chairman's spoken ${kind === "evening" ? "to-do list for tomorrow" : "orders"} (phone speech-to-text, may contain recognition errors; the pieces are consecutive parts of one dictation, so join sentences that were split mid-way) into a short numbered list of clear instructions. One line each, imperative, his meaning only — add nothing, drop filler, merge repeats. Keep every name, amount, date, time and deadline he gave. Where a name or word is clearly a mis-hearing, write your best reading followed by "(?)". Use the context below (his companies, people, and voice corrections he has made before) to read names correctly. Even a single short phrase is an order: output it as item 1. Never ask for input and never comment — output only the list.

His companies: Leone Investment, Cape Realities (real estate + construction), Platinum Insurers, The Lead Business Living (Freetown), M Hotel, JV Ventures, JOUN (Lebanon).
What AMI knows about him:
${facts || "(nothing saved yet)"}`,
        messages: [{ role: "user", content: said.join("\n") }] }),
    });
    const d = await r.json();
    const txt = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (txt && /^\s*1[.)]/.test(txt)) return txt; // only accept a real numbered list
  } catch (_) {}
  finally { clearTimeout(t); }
  return said.map((x, i) => `${i + 1}. ${x}`).join("\n");
}

// After the call: build the list, put it straight into the To-do list and the Calendar (no WhatsApp, no confirm)
async function processCall(sid: string) {
  const claim = await db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}&processed=eq.false`, { method: "PATCH", body: JSON.stringify({ processed: true }), headers: { Prefer: "return=representation" } });
  const row = claim.ok ? (await claim.json())[0] : null;
  if (!row) return;
  const said = (row.turns || []).filter((t: any) => t.role === "user").map((t: any) => String(t.content).replace(END_RE, "").trim()).filter((t: string) => t && !DONE_RE.test(t) && !OK_RE.test(t));
  if (!said.length) return;
  const list = await ordersList(row.kind, said);
  await saveCall(sid, { orders: list, orders_status: "confirmed", summary: list, sent_at: new Date().toISOString() });
  try {
    const kr = await db("ami_settings?key=eq.wake_key&select=value");
    const wk = kr.ok ? (await kr.json())[0]?.value || "" : "";
    await fetch(`${SB}/functions/v1/ai`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": wk }, body: JSON.stringify({ action: "orders_confirm", call_sid: sid }) });
  } catch (_) {}
}

async function placeCall(kind: string, key: string, n = 1) {
  const form = new URLSearchParams({
    From: TW_VOICE_FROM, To: SELF,
    Url: `${BASE}?step=start&kind=${kind}&n=${n}&k=${key}`, Method: "POST",
    StatusCallback: `${BASE}?step=status&kind=${kind}&n=${n}&k=${key}`, StatusCallbackMethod: "POST",
    Timeout: "45",
  });
  form.append("StatusCallbackEvent", "completed");
  return twilio("Calls.json", form);
}

async function phoneRoute(url: URL, req: Request, key: string) {
  const f = new URLSearchParams(await req.text());
  await loadHints();
  const sid = f.get("CallSid") || "";
  const step = url.searchParams.get("step");

  if (step === "incoming") {
    if (normal(f.get("From")) !== SELF) return twiml("<Reject/>");
    await db("ami_calls", { method: "POST", body: JSON.stringify({ call_sid: sid, kind: "inbound", confirmed: true, turns: [] }) });
    return twiml(gather(key, OPEN));
  }
  if (step === "start") {
    // Pickup check first, so a voicemail greeting is never mistaken for the Chairman
    const kind = url.searchParams.get("kind") || "morning";
    const n = +(url.searchParams.get("n") || 1);
    await db("ami_calls", { method: "POST", body: JSON.stringify({ call_sid: sid, kind, attempt: n, confirmed: false, turns: [] }) });
    return twiml(gather(key, OPEN));
  }
  if (step === "turn") {
    const row = await getCall(sid);
    if (!row) return twiml("<Hangup/>");
    const heard = (f.get("SpeechResult") || "").trim();
    const turns = row.turns || [];
    if (!row.confirmed) {
      // first thing heard: a voicemail greeting -> hang up (status callback retries); silence -> ask once more
      if (heard && VOICEMAIL_RE.test(heard)) return twiml("<Hangup/>");
      if (!heard) {
        if ((row.empties || 0) >= 1) return twiml("<Hangup/>");
        await saveCall(sid, { empties: 1 });
        return twiml(gather(key, OPEN));
      }
      await saveCall(sid, { confirmed: true, empties: 0 });
      row.confirmed = true;
    }
    // he paused ~5 seconds after giving orders: orders are complete -> "Noted." and hang up
    if (!heard && turns.some((t: any) => t.role === "user")) { later(processCall(sid)); return twiml(say("Noted.") + "<Hangup/>"); }
    if (!heard) {
      const empties = (row.empties || 0) + 1;
      await saveCall(sid, { empties });
      if (empties >= 2) return twiml("<Hangup/>");
      return twiml(gather(key, OPEN));
    }
    const hadOrders = turns.some((t: any) => t.role === "user");
    turns.push({ role: "user", content: heard });
    // listen only: no repeating back, no chat. "done", "OK" (after an order) or "that's all" ends the call
    if (isEnd(heard) || (hadOrders && OK_RE.test(heard))) {
      await saveCall(sid, { turns, empties: 0 });
      later(processCall(sid));
      return twiml(say("Noted.") + "<Hangup/>");
    }
    await saveCall(sid, { turns, empties: 0 });
    return twiml(gather(key, "", 3)); // listen silently for the next order; a ~5 second pause ends the call
  }
  if (step === "status") {
    const st = f.get("CallStatus") || "";
    const kind = url.searchParams.get("kind") || "";
    const n = +(url.searchParams.get("n") || 1);
    const row = sid ? await getCall(sid) : null;
    const reached = !!row && row.confirmed;
    if (st === "completed" && reached) { later(processCall(sid)); return new Response("ok"); }
    if (kind) {
      // not reached (no answer, busy, voicemail, silence): try again, up to MAX_TRIES calls in total
      if (n < MAX_TRIES) later(sleep(RETRY_SEC * 1000).then(() => placeCall(kind, key, n + 1)));
      else await whatsapp(`📞 AMI called ${MAX_TRIES} times${kind === "inbound" ? "" : " for your " + kind + " call"} and couldn't reach you. Tap "Call me" in AMI any time and I'll ring you.`);
    }
    return new Response("ok");
  }
  if (step === "rstatus") {
    // calendar reminder call: retry if it wasn't picked up
    const st = f.get("CallStatus") || "";
    const n = +(url.searchParams.get("n") || 1), rk = url.searchParams.get("rk") || "";
    const answered = st === "completed" && +(f.get("CallDuration") || 0) >= 8;
    if (!answered && rk && n < MAX_TRIES) {
      const rr = await db(`ami_reminders?event_key=eq.${encodeURIComponent(rk)}&select=spoken`);
      const spoken = rr.ok ? (await rr.json())[0]?.spoken : "";
      if (spoken) later(sleep(RETRY_SEC * 1000).then(() => call(spoken, `${BASE}?step=rstatus&n=${n + 1}&rk=${encodeURIComponent(rk)}&k=${key}`)));
    }
    return new Response("ok");
  }
  return twiml("<Hangup/>");
}
const normal = (p: string | null) => { let n = String(p || "").replace(/[^\d+]/g, ""); if (n && !n.startsWith("+")) n = "+" + n; return n; };

Deno.serve(async (req) => {
  // key is kept in the locked ami_settings table; only the database scheduler knows it
  const kr = await db("ami_settings?key=eq.wake_key&select=value");
  const WAKE_KEY = kr.ok ? ((await kr.json())[0]?.value || "") : "";
  if (!WAKE_KEY) return json({ error: "not configured" }, 500);
  const url = new URL(req.url);
  if (url.searchParams.get("step")) {
    if (url.searchParams.get("k") !== WAKE_KEY) return new Response("forbidden", { status: 403 });
    return phoneRoute(url, req, WAKE_KEY);
  }
  if (req.headers.get("x-wake-key") !== WAKE_KEY) return json({ error: "forbidden" }, 403);
  let p: any = {};
  try { p = await req.json(); } catch (_) {}

  if (p.call) {
    const kind = ["evening", "morning", "inbound"].includes(p.call) ? p.call : "morning";
    // the morning brief (today's calendar + last night's list) comes by WhatsApp, so the call itself is just "Your orders, Chairman."
    if (kind === "morning") later(openingLine("morning").then((b) => whatsapp("☀️ " + b.replace(/\s*Go ahead with your orders\.$/, "").replace("Good morning Chairman, it's AMI. ", "Today:\n"))));
    const c = await placeCall(kind, WAKE_KEY); return json({ call: c.info });
  }
  if (p.setup) {
    const n = await twilio(`IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(TW_VOICE_FROM)}`);
    const num = n.j?.incoming_phone_numbers?.[0];
    if (!num) return json({ error: "number not found", info: n.info });
    const u = await twilio(`IncomingPhoneNumbers/${num.sid}.json`, new URLSearchParams({
      VoiceUrl: `${BASE}?step=incoming&k=${WAKE_KEY}`, VoiceMethod: "POST",
      StatusCallback: `${BASE}?step=status&k=${WAKE_KEY}`, StatusCallbackMethod: "POST" }));
    return json({ number: num.phone_number, voice_capable: num.capabilities?.voice, updated: u.info });
  }

  if (p.test) {
    const wa = await whatsapp("⏰ AMI test: this is how your 15-minute calendar reminders will arrive.");
    const c = await call("Good day Chairman. This is AMI. This is a test of your calendar wake-up call.");
    return json({ whatsapp: wa.info, call: c.info });
  }
  if (!ICS_URL) return json({ error: "GCAL_ICS_URL secret not set" }, 400);

  const r = await fetch(ICS_URL);
  if (!r.ok) return json({ error: `calendar fetch ${r.status}` }, 502);
  const events = parseICS(await r.text());
  const now = Date.now();
  if (p.peek) return json(upcoming(events, now, now + 2 * 86400000).slice(0, 10).map((e) => ({ title: e.title, at: hhmm(e.start), date: new Date(e.start).toISOString() })));

  // events starting between now and now+LEAD_MIN (catches anything just added, too)
  const due = upcoming(events, now, now + LEAD_MIN * 60000 + 30000);
  if (!due.length) return json({ due: 0 });

  const keys = due.map((d) => d.key);
  const seenRes = await db(`ami_reminders?select=event_key&event_key=in.(${keys.map((k) => '"' + k.replace(/"/g, "") + '"').join(",")})`);
  const seen = new Set(seenRes.ok ? (await seenRes.json()).map((x: any) => x.event_key) : []);
  const results: any[] = [];
  for (const d of due) {
    if (seen.has(d.key)) continue;
    // claim first so a parallel run can't double-alert
    const claim = await db("ami_reminders", { method: "POST", body: JSON.stringify({ event_key: d.key, title: d.title, starts_at: new Date(d.start).toISOString() }) });
    if (!claim.ok) continue;
    const mins = Math.max(1, Math.round((d.start - now) / 60000));
    const where = d.where ? ` at ${d.where}` : "";
    const wa = await whatsapp(`⏰ In ${mins} min (${hhmm(d.start)}): ${d.title}${where}`);
    const spoken = `Chairman, this is AMI. Reminder: ${d.title}${where}, at ${spokenTime(d.start)}.`;
    const c = await call(spoken, `${BASE}?step=rstatus&n=1&rk=${encodeURIComponent(d.key)}&k=${WAKE_KEY}`);
    await db(`ami_reminders?event_key=eq.${encodeURIComponent(d.key)}`, { method: "PATCH", body: JSON.stringify({ whatsapp: wa.info, call: c.info, spoken }) });
    results.push({ title: d.title, whatsapp: wa.info, call: c.info });
  }
  return json({ due: due.length, sent: results });
});
