// AMI `whatup` — WhatsApp webhook (Twilio) — v3.4 (20 Nov 2026) — signature check diagnostics: when a message fails the check, its signature and fields are kept (last one only, in ami_settings.whatup_sig_raw) so the cause can be found; more URL variants tried.
// v3.3 (20 Nov 2026) — SECURITY: checks Twilio's X-Twilio-Signature on every incoming message.
//   Mode is set in ami_settings: whatup_sig_enforce = "yes" blocks messages without a valid signature; anything else = log only.
//   Last check result is written to ami_settings.whatup_sig_last; failures are counted in whatup_sig_fail.
// v3.2 (16 Nov 2026) — booth "✅ Noted" button presses go to secrelay; v3.1 — the Chairman's number can act as a test booth; v3.0 — compound security booth phones are routed to secrelay; v2.9 — "voice status" checks the voice-note engine live; v2.8 — VOICE NOTES: the Chairman's WhatsApp voice notes are transcribed (Gemini first, free; Google Speech-to-Text as fallback) in the background — AMI answers "🎙 Listening…" at once, then "🎙 Heard: …", then carries the order out exactly like a typed message; voice notes from other people are transcribed into the message forwarded to him
// v2.6: replies from other people (e.g. after AMI messages them for the Chairman) are forwarded to the Chairman and logged; v2.5: "To-do list:" replies go straight into the To-do list (todox); short WhatsApp replies; "check" / "check inbox" reruns the inbox brief; every WhatsApp message from him is an order AMI carries out (own "WhatsApp" thread so YES approvals work); inbox brief ✅ Noted / ⚡ Action buttons
// Only the Chairman's number gets AMI's answers; anyone else's message is passed on to him.
// Call lists no longer wait for confirmation (they go straight into the To-do list + Calendar). The old Confirm/Change code
// below only runs if a list is still marked "awaiting".

const MY_NUMBER = "whatsapp:+231777170170";
const SELF = "+231777170170";
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_KEY") || "";
const NOTICE_SID = "HXe4aecbe1d3eabfd95fa25c9b8b97d905"; // approved template ami_notice: "Hello Chairman, this is AMI. You have a new update: {{1}}. ..."
const HOOK_URLS = [
  "https://pdzhlslzwjlhxklqcwus.supabase.co/functions/v1/whatup",
  "https://pdzhlslzwjlhxklqcwus.supabase.co/functions/v1/whatup/",
  "https://pdzhlslzwjlhxklqcwus.supabase.co:443/functions/v1/whatup",
  "http://pdzhlslzwjlhxklqcwus.supabase.co/functions/v1/whatup",
];

const CONFIRM_RE = /^\s*(✅|👍|yes|yes\.|yes,|y|ok|okay|confirm(ed)?|go( ahead)?|approved?|proceed|correct|do it)\b/i;
const CANCEL_RE = /^\s*(cancel|stop|scrap|forget it|don'?t do)/i;
const YES_RE = /^\s*(yes|yes,|yes\.|yes please|yes send|send it|go ahead|confirm(ed)?|approved?|ok send)\b/i;
const CHECK_RE = /^\s*(check|check (my )?(inbox|mail|email|emails|gmail)|inbox)\s*[.!?]?\s*$/i;
const VOICE_STATUS_RE = /^\s*(ami\s+)?voice\s+status\s*[.!?]?\s*$/i;
const TODO_RE = /^\s*to-?\s*do(\s*list)?\s*[:\-–]/i;

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function twiml(text: string) {
  const x = text ? `<Message>${esc(text.slice(0, 1500))}</Message>` : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${x}</Response>`, { headers: { "Content-Type": "text/xml" } });
}
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
});
async function twilio(path: string, form: URLSearchParams) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/${path}`, {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}
async function claude(model: string, system: string, user: string, max = 900) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: "user", content: user }] }),
  });
  const d = await r.json();
  return (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim() || d?.error?.message || "";
}
async function wakeKey() {
  const kr = await db("ami_settings?key=eq.wake_key&select=value");
  return kr.ok ? (await kr.json())[0]?.value || "" : "";
}

// ---------- v3.3: Twilio signature check ----------
async function hmacSha1B64(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  const u = new Uint8Array(sig); let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function twilioSigOk(req: Request, form: FormData): Promise<{ ok: boolean; url: string; pairs: [string, string][]; got: string; q: string }> {
  const got = req.headers.get("x-twilio-signature") || "";
  const tokens = [Deno.env.get("TWILIO_SIGNING_TOKEN") || "", TW_TOKEN].filter(Boolean);
  const pairs: [string, string][] = [];
  for (const [k, v] of form.entries()) if (typeof v === "string") pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  let q = "";
  try { q = new URL(req.url).search || ""; } catch (_) { q = ""; }
  if (!got || !tokens.length) return { ok: false, url: "", pairs, got, q };
  const tail = pairs.map(([k, v]) => k + v).join("");
  for (const base of HOOK_URLS) {
    for (const url of q ? [base + q, base] : [base]) {
      for (const t of tokens) if (safeEq(await hmacSha1B64(t, url + tail), got)) return { ok: true, url, pairs, got, q };
    }
  }
  return { ok: false, url: "", pairs, got, q };
}
async function sigLog(entry: Record<string, unknown>, failed: boolean, raw?: unknown) {
  await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: "whatup_sig_last", value: JSON.stringify({ ...entry, at: new Date().toISOString() }) }) }).catch(() => null);
  if (failed) {
    const r = await db("ami_settings?key=eq.whatup_sig_fail&select=value");
    const n = r.ok ? Number((await r.json())[0]?.value || 0) || 0 : 0;
    await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "whatup_sig_fail", value: String(n + 1) }) }).catch(() => null);
    if (raw) await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "whatup_sig_raw", value: JSON.stringify(raw) }) }).catch(() => null);
  }
}
// ----------------------------------------------------

// ---------- voice notes (v2.7) ----------
function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function googleToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (Deno.env.get("GOOGLE_CLIENT_ID") || "").trim(), client_secret: (Deno.env.get("GOOGLE_CLIENT_SECRET") || "").trim(),
      refresh_token: (Deno.env.get("GOOGLE_REFRESH_TOKEN") || "").trim(), grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  return j.access_token || "";
}
async function setting(k: string): Promise<string> {
  const r = await db(`ami_settings?key=eq.${k}&select=value`);
  return r.ok ? String((await r.json())[0]?.value || "").trim() : "";
}
// v2.8: Gemini (free tier, no card) transcribes first; Google Speech-to-Text is the fallback once its billing is on
async function geminiTranscribe(content: string, mime: string, phrases: string[]): Promise<{ text?: string; error?: string }> {
  const key = await setting("gemini_api_key");
  if (!key) return { error: "no_key" };
  const prompt = `Transcribe this WhatsApp voice note from Hussein Saad (the Chairman) word for word, in English. He may speak Liberian or Sierra Leonean English or Krio; write what he means in plain English. Names and words he often uses: ${phrases.join(", ")}. Return ONLY the transcript, no quotes or notes. If there is no speech, return exactly: EMPTY`;
  for (const model of ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-flash-latest"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(45000), headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime || "audio/ogg", data: content } }, { text: prompt }] }], generationConfig: { temperature: 0 } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) continue;
      const text = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join(" ").replace(/\s+/g, " ").trim();
      if (!text || /^EMPTY\.?$/i.test(text)) return { error: "empty" };
      return { text };
    } catch (_) { /* try the next model */ }
  }
  return { error: "speech" };
}
// returns { text } on success or { error } with a short reason
async function transcribe(mediaUrl: string, mime = "audio/ogg"): Promise<{ text?: string; error?: string }> {
  try {
    const m = await fetch(mediaUrl, { headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`) } });
    if (!m.ok) return { error: "download" };
    const buf = await m.arrayBuffer();
    if (buf.byteLength > 9_000_000) return { error: "too_long" };
    const hints = await setting("voice_hints");
    const phrases = ["AMI", "Chairman", "Leone", "Cape Realities", "Platinum", "RED INC", "The Lead", "Nader", "Hachem", "Monrovia", "Freetown",
      ...hints.split(",").map((x) => x.trim()).filter(Boolean)].slice(0, 400);
    const content = b64(buf);
    const g = await geminiTranscribe(content, mime.split(";")[0], phrases.slice(0, 80));
    if (g.text || g.error === "empty") return g;
    const tok = await googleToken();
    if (!tok) return { error: "google_login" };
    for (const rate of [16000, 48000]) {
      const r = await fetch("https://speech.googleapis.com/v1p1beta1/speech:recognize", {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { encoding: "OGG_OPUS", sampleRateHertz: rate, languageCode: "en-US", alternativeLanguageCodes: ["en-GB", "en-NG"],
            enableAutomaticPunctuation: true, speechContexts: [{ phrases, boost: 12 }] },
          audio: { content },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (j.results || []).map((x: any) => x.alternatives?.[0]?.transcript || "").join(" ").replace(/\s+/g, " ").trim();
        return text ? { text } : { error: "empty" };
      }
      const msg = String(j.error?.message || "");
      if (/sample[_ ]?rate/i.test(msg)) continue;
      if (/too long|duration|exceeds/i.test(msg)) return { error: "too_long" };
      if (/has not been used|disabled/i.test(msg)) return { error: "api_off" };
      return { error: "speech" };
    }
    return { error: "speech" };
  } catch (_) { return { error: "speech" }; }
}
function voiceFail(e?: string) {
  if (e === "too_long") return "🎙 That voice note is too long for me. Please keep voice notes under 1 minute, or send it in two parts.";
  if (e === "empty") return "🎙 I couldn't hear any words in that voice note. Please try again a little closer to the phone.";
  return "🎙 I couldn't understand that voice note. Please try again or type it.";
}
function isAudio(t: string) { return /^audio\//i.test(t); }
function sendSelf(text: string) {
  return twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: text.slice(0, 1500) })).catch(() => null);
}
// keep background work alive after the reply has gone back to WhatsApp
function bg(p: Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(p); else p.catch(() => null);
}
// --------------------------------------

// v2.9: "voice status" — live check of the voice-note engine (Gemini models + Google Speech fallback), all in parallel, under 12 s
async function voiceStatus(): Promise<string> {
  const key = await setting("gemini_api_key");
  const lines: string[] = [];
  lines.push(`- Gemini key: ${key ? "✅ saved (ends " + key.slice(-4) + ")" : "❌ missing"}`);
  const models = ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-flash-latest"];
  const tests = key ? models.map(async (m) => {
    const t0 = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(10000), headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { temperature: 0 } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return `- ${m}: ❌ ${r.status} ${String(j?.error?.message || "").slice(0, 80)}`;
      return `- ${m}: ✅ (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
    } catch (_) { return `- ${m}: ❌ no answer in 10 s`; }
  }) : [];
  const stt = (async () => {
    try {
      const tok = await googleToken();
      if (!tok) return "- Google Speech (backup): ❌ Google sign-in failed";
      const r = await fetch("https://speech.googleapis.com/v1p1beta1/speech:recognize", { method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ config: { encoding: "OGG_OPUS", sampleRateHertz: 16000, languageCode: "en-US" }, audio: { content: "" } }) });
      const j = await r.json().catch(() => ({}));
      const msg = String(j?.error?.message || "");
      if (/has not been used|disabled|billing/i.test(msg)) return "- Google Speech (backup): ⚪ off (needs Google billing) — not needed while Gemini works";
      return "- Google Speech (backup): ✅ reachable";
    } catch (_) { return "- Google Speech (backup): ❌ no answer"; }
  })();
  const res = await Promise.all([...tests, stt]);
  lines.push(...res);
  const ok = res.slice(0, models.length).some((x) => x.includes("✅"));
  const lr = await db("ami_messages?section=eq.WhatsApp&role=eq.user&content=ilike.*voice*&select=created_at&order=created_at.desc&limit=1");
  const last = lr.ok ? (await lr.json())[0]?.created_at : "";
  return `🎙 AMI voice status (whatup v3.4):\n${lines.join("\n")}\n- Twilio WhatsApp: ${TW_SID && TW_TOKEN ? "✅" : "❌ keys missing"}${last ? "\n- Last voice message logged: " + String(last).slice(0, 16).replace("T", " ") : ""}\n${ok ? "✅ Voice notes are working — send one to test." : "❌ Voice notes are NOT working right now — no Gemini model answered."}`;
}

async function confirmTemplate(): Promise<string> {
  const r = await db("ami_settings?key=eq.confirm_content_sid&select=value");
  const have = r.ok ? (await r.json())[0]?.value : "";
  if (have) return have;
  const c = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/json" },
    body: JSON.stringify({ friendly_name: "ami_confirm_orders", language: "en", variables: { "1": "orders" },
      types: { "twilio/quick-reply": { body: "{{1}}", actions: [{ title: "✅ Confirm", id: "confirm" }, { title: "✏️ Change", id: "change" }] },
               "twilio/text": { body: "{{1}}" } } }),
  });
  const j = await c.json().catch(() => ({}));
  if (j.sid) await db("ami_settings", { method: "POST", body: JSON.stringify({ key: "confirm_content_sid", value: j.sid }), headers: { Prefer: "resolution=merge-duplicates" } });
  return j.sid || "";
}
async function sendForConfirm(text: string) {
  const sidC = text.length <= 1000 ? await confirmTemplate() : "";
  if (sidC) {
    const r = await twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, ContentSid: sidC, ContentVariables: JSON.stringify({ "1": text }) }));
    if (r.ok) return;
  }
  await twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: text + "\n\nReply ✅ to confirm, or reply with any changes." }));
}
// hand work to the full AMI brain (`ai` function) through the database; results arrive on WhatsApp
function dispatch(message: string) {
  return fetch(`${SB}/rest/v1/rpc/ami_dispatch`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
    body: JSON.stringify({ payload: { message, section: "WhatsApp", deliver: "whatsapp" } }) });
}
// a message from someone else: log it and pass it on to the Chairman (approved template, so it arrives even outside his 24h window)
async function forwardToChairman(from: string, name: string, body: string, media: number) {
  const num = from.replace("whatsapp:", "");
  const who = name ? `${name} (${num})` : num;
  const text = `Message from ${who}: ${body || ""}${media ? ` [${media} photo/file]` : ""}`.replace(/\s*\n+\s*/g, " ").replace(/ {4,}/g, " ").slice(0, 900);
  await db("ami_messages", { method: "POST", body: JSON.stringify({ user_email: "hnsaad1973@gmail.com", role: "user", section: "WhatsApp", content: `[Reply from ${who}] ${body}` }) }).catch(() => null);
  const r = await twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, ContentSid: NOTICE_SID, ContentVariables: JSON.stringify({ "1": text }) }));
  if (!r.ok || r.j.error_code) await twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: text }));
}

Deno.serve(async (req) => {
  try {
    const form = await req.formData();
    const from = String(form.get("From") || "");

    // v3.3: is this really from Twilio? (internal voice replays carry the wake key instead)
    const vk = req.headers.get("x-voice-key") || "";
    const internal = !!vk && vk === await wakeKey();
    if (!internal) {
      const sig = await twilioSigOk(req, form);
      const enforce = (await setting("whatup_sig_enforce")).toLowerCase() === "yes";
      const hookKey = await setting("whatup_hook_key");
      let qk = ""; try { qk = new URL(req.url).searchParams.get("k") || ""; } catch (_) { qk = ""; }
      const keyOk = !!hookKey && safeEq(qk, hookKey);
      const pass = sig.ok || keyOk;
      await sigLog({ ok: sig.ok, url: sig.url, key_ok: keyOk, pass, from: from.replace("whatsapp:", ""), has_header: !!sig.got, enforce,
        acct_match: String(form.get("AccountSid") || "") === TW_SID, has_query: !!qk }, !pass,
        { got: sig.got, q: sig.q, req_url: req.url, pairs: sig.pairs, ct: req.headers.get("content-type") || "" });
      if (!pass && enforce) return new Response("forbidden", { status: 403 });
    }

    let body = String(form.get("Body") || "").trim();
    const payload = String(form.get("ButtonPayload") || "").trim().toLowerCase();
    const media = Number(form.get("NumMedia") || 0) || 0;
    const mediaType = String(form.get("MediaContentType0") || "");
    const mediaUrl = String(form.get("MediaUrl0") || "");
    const voice = media > 0 && isAudio(mediaType) && !!mediaUrl;

    if (from !== MY_NUMBER) {
      if (!from.startsWith("whatsapp:") || (!body && !media)) return twiml("");
      const profile = String(form.get("ProfileName") || "");
      // compound security booth phones: hand to secrelay (tenant replies / on duty), never to the Chairman
      {
        const num = from.replace("whatsapp:", "");
        const bq = await db(`sec_booths?phone=eq.${encodeURIComponent(num)}&active=eq.true&select=phone`);
        if (bq.ok && (await bq.json()).length) {
          const r = await fetch(`${SB}/functions/v1/secrelay`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": await wakeKey() },
            body: JSON.stringify({ action: "booth", from, body, payload, replied: String(form.get("OriginalRepliedMessageSid") || "") }) });
          const j = await r.json().catch(() => ({}));
          return twiml(j.reply || "");
        }
      }
      if (voice) {
        // transcribe in the background (it can take longer than WhatsApp waits), then forward
        bg((async () => {
          const t = await transcribe(mediaUrl, mediaType);
          const fwd = t.text ? `🎙 (voice note) ${t.text}${body ? " " + body : ""}` : `🎙 (voice note — could not transcribe)${body ? " " + body : ""}`;
          await forwardToChairman(from, profile, fwd, t.text ? media - 1 : media);
        })());
        return twiml("Thank you. I have passed your message to Hussein.");
      }
      await forwardToChairman(from, profile, body, media);
      return twiml("Thank you. I have passed your message to Hussein.");
    }

    // the Chairman's voice note: answer at once, transcribe in the background, echo what was heard,
    // then replay it to this same webhook as a typed message (so every rule below applies) and send AMI's reply
    if (voice) {
      bg((async () => {
        const t = await transcribe(mediaUrl, mediaType);
        if (!t.text) { await sendSelf(voiceFail(t.error)); return; }
        await sendSelf(`🎙 Heard: "${t.text.slice(0, 1200)}"`);
        const wk = await wakeKey();
        const r = await fetch(`${SB}/functions/v1/whatup`, { method: "POST", headers: { "x-voice-key": wk },
          body: new URLSearchParams({ From: MY_NUMBER, Body: body ? `${t.text} ${body}` : t.text, NumMedia: "0" }) });
        const xml = await r.text().catch(() => "");
        const m = /<Message>([\s\S]*?)<\/Message>/.exec(xml);
        if (m) await sendSelf(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      })());
      return twiml("🎙 Listening…");
    }
    const fromVoice = internal;

    if (!body && !payload) return twiml("");

    // v3.1: while the Chairman's own number is listed as a security booth (testing), "On duty" and "105 reply" go to the tenant relay
    if (payload === "sec_noted" || (!payload && /^\s*(on\s*duty\b|(B1-?STUDIO|B4|\d{3})([\s:.\-,]+\S|\s*$))/i.test(body))) {
      const bq = await db(`sec_booths?phone=eq.${encodeURIComponent(SELF)}&active=eq.true&select=phone`);
      if (bq.ok && (await bq.json()).length) {
        const r = await fetch(`${SB}/functions/v1/secrelay`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": await wakeKey() },
          body: JSON.stringify({ action: "booth", from: MY_NUMBER, body, payload, replied: String(form.get("OriginalRepliedMessageSid") || "") }) });
        const j = await r.json().catch(() => ({}));
        if (j.reply) return twiml(j.reply);
      }
    }

    // "voice status": live check of the voice-note engine
    if (!payload && VOICE_STATUS_RE.test(body)) return twiml(await voiceStatus());

    // morning inbox brief buttons: ✅ Noted (archive all) / ⚡ Action (draft replies, then archive)
    const inboxAct = payload === "noted" || /^\s*(✅\s*)?noted\s*[.!]?\s*$/i.test(body) ? "inbox_noted"
      : payload === "action" || /^\s*(⚡\s*)?action\s*[.!]?\s*$/i.test(body) ? "inbox_action" : "";
    if (inboxAct) {
      const wk = await wakeKey();
      const r = await fetch(`${SB}/functions/v1/ai`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": wk },
        body: JSON.stringify({ action: inboxAct }) });
      const d = await r.json().catch(() => ({}));
      return twiml(d.reply || "On it, Chairman.");
    }

    // "check" / "check inbox": run the inbox brief again now
    if (!payload && CHECK_RE.test(body)) {
      const wk = await wakeKey();
      const r = await fetch(`${SB}/functions/v1/ai`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": wk },
        body: JSON.stringify({ action: "inbox_check" }) });
      return twiml(r.ok ? "🔄 Checking your inbox — 2 min." : "⚠️ Couldn't start the inbox check. Try again shortly.");
    }

    // "To-do list: ..." (his answer to the 17:00 request) -> straight into the To-do list as tomorrow's list
    if (!payload && TODO_RE.test(body)) {
      const wk = await wakeKey();
      const r = await fetch(`${SB}/functions/v1/todox`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": wk },
        body: JSON.stringify({ action: "add_list", text: body }) });
      const d = await r.json().catch(() => ({}));
      return twiml(d.reply || (r.ok ? "✅ To-do list saved." : "⚠️ Couldn't save the to-do list. Try again shortly."));
    }

    // a list from a call still waiting for confirmation (only old lists — new ones go straight to the To-do list)
    const since = new Date(Date.now() - 36 * 3600000).toISOString();
    const pr = await db(`ami_calls?orders_status=eq.awaiting&sent_at=gte.${since}&select=call_sid,kind,orders&order=sent_at.desc&limit=1`);
    const pending = pr.ok ? (await pr.json())[0] : null;

    if (pending) {
      const sidq = `ami_calls?call_sid=eq.${encodeURIComponent(pending.call_sid)}`;
      if (payload === "confirm" || (!payload && CONFIRM_RE.test(body) && body.length < 40)) {
        const wk = await wakeKey();
        const r = await fetch(`${SB}/functions/v1/ai`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": wk },
          body: JSON.stringify({ action: "orders_confirm", call_sid: pending.call_sid }) });
        const d = await r.json().catch(() => ({}));
        return twiml(d.reply || "✅ Saved to your To-do list.");
      }
      if (payload === "change") return twiml("✏️ What should I change?");
      if (CANCEL_RE.test(body)) {
        await db(sidq, { method: "PATCH", body: JSON.stringify({ orders_status: "cancelled" }) });
        return twiml("Cancelled.");
      }
      // anything else = a change to the list; also learn word corrections
      const out = await claude("claude-haiku-4-5",
        `You update the Chairman's numbered instruction list from his correction message. Return ONLY JSON: {"list":"<full updated numbered list, one line each>","corrections":[{"heard":"<word the phone mis-heard>","meant":"<correct word>"}]}. "corrections" only for clear spelling/name fixes of mis-heard words; else [].`,
        `CURRENT LIST:\n${pending.orders}\n\nHIS MESSAGE:\n${body}`, 900);
      let list = pending.orders, corr: any[] = [];
      try { const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); list = j.list || list; corr = Array.isArray(j.corrections) ? j.corrections : []; } catch (_) {}
      await db(sidq, { method: "PATCH", body: JSON.stringify({ orders: list, summary: list }) });
      if (corr.length) {
        const facts = corr.filter((c) => c.heard && c.meant).map((c) => ({ user_email: "hnsaad1973@gmail.com", fact: `Voice: on phone calls, when the speech text says "${c.heard}" the Chairman means "${c.meant}".` }));
        if (facts.length) await db("ami_memory", { method: "POST", body: JSON.stringify(facts) });
        const hr = await db("ami_settings?key=eq.voice_hints&select=value");
        const old = hr.ok ? (await hr.json())[0]?.value || "" : "";
        const add = corr.map((c) => String(c.meant || "").trim()).filter(Boolean);
        const merged = [...new Set([...String(old).split(",").map((x: string) => x.trim()).filter(Boolean), ...add])].join(", ");
        await db("ami_settings", { method: "POST", body: JSON.stringify({ key: "voice_hints", value: merged }), headers: { Prefer: "resolution=merge-duplicates" } });
      }
      await sendForConfirm(`📋 Updated list:\n\n${list}`);
      return twiml(corr.length ? "Noted — I'll recognise that word next time." : "");
    }

    // a WhatsApp message from him = an order with direction: the full AMI brain carries it out with all her tools; the result comes back here
    if (YES_RE.test(body)) { await dispatch(body); return twiml(""); }
    await dispatch(`WHATSAPP ORDER from the Chairman${fromVoice ? " (sent as a voice note; this is the transcript, so fix obvious mis-heard words from context)" : ""} — carry it out now with your tools (Gmail, Drive, Calendar, Sheets, Studio, web). Do the work yourself; reply with the result only, in 1 to 3 short WhatsApp lines. Anything to send to another person: show the exact draft and recipient and wait for his YES.\n\nORDER:\n${body}`);
    return twiml("");
  } catch (e) {
    return twiml("⚠️ AMI hit a problem. Try again in a minute.");
  }
});
