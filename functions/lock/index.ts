// AMI `lock` edge function — v1.4 (20 Nov 2026: key_save "twilio" — Twilio primary auth token for the WhatsApp signature check, tested against Twilio and against a real signed message) — v1.3 (20 Nov 2026)
// Face ID / passkey app lock + WhatsApp unlock code + kill-switch status for AMI 1.
// Every call needs the Chairman's sign-in token (body.token). Unlock tokens last 12 hours.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@13.1.1";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.1.1/helpers";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const OWNER = "hnsaad1973@gmail.com";
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RP_ID = "hnsaad1973-tech.github.io";
const ORIGIN = "https://hnsaad1973-tech.github.io";
const SELF_WA = "+231777170170";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const UNLOCK_HOURS = 12;

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
});
const rpc = async (fn: string, args: unknown) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  return r.ok ? await r.json() : null;
};
const rand = (n = 32) => isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(n)));
async function sha(s: string) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return isoBase64URL.fromBuffer(new Uint8Array(h)); }

async function signedIn(token: string) {
  if (!token) return false;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + token, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } });
  if (!r.ok) return false;
  const u = await r.json();
  return String(u.email || "").toLowerCase() === OWNER;
}
async function newUnlock(method: string, device: string) {
  // unlocking after the kill switch turns AMI back on
  const g = await rpc("ami_gate", { p_unlock: "", p_need_unlock: false });
  if (g === "killed") await rpc("ami_kill", { p_on: false });
  const token = rand(32);
  const exp = new Date(Date.now() + UNLOCK_HOURS * 3600e3).toISOString();
  await db("ami_unlock", { method: "POST", body: JSON.stringify({ token, method, device: device.slice(0, 80), expires_at: exp }) });
  await db("ami_unlock?expires_at=lt." + new Date().toISOString(), { method: "DELETE" });
  return { unlock: token, expires_at: exp };
}
async function putChallenge(kind: string, value: string, minutes = 5) {
  const id = kind + "-" + rand(12);
  await db("ami_lock_challenges?expires_at=lt." + new Date().toISOString(), { method: "DELETE" });
  await db("ami_lock_challenges", { method: "POST", body: JSON.stringify({ id, kind, value, expires_at: new Date(Date.now() + minutes * 60e3).toISOString() }) });
  return id;
}
async function takeChallenge(id: string, kind: string) {
  const r = await db(`ami_lock_challenges?id=eq.${encodeURIComponent(id)}&kind=eq.${kind}&expires_at=gt.${new Date().toISOString()}&select=value,tries`);
  const row = r.ok ? (await r.json())[0] : null;
  return row || null;
}
const dropChallenge = (id: string) => db(`ami_lock_challenges?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = await req.json(); } catch (_) {}
  const action = String(p.action || "");
  const device = String(p.device || "device");
  try {
    if (!(await signedIn(String(p.token || "")))) return json({ error: "Not signed in." }, 401);
    const gate = await rpc("ami_gate", { p_unlock: String(p.unlock || ""), p_need_unlock: true });
    // Kill switch on: only status and unlocking are allowed. A successful Face ID / WhatsApp code unlock turns AMI back on.
    const killed = gate === "killed";
    if (killed && !["status", "auth_options", "auth_verify", "code_send", "code_verify"].includes(action))
      return json({ killed: true, error: "AMI is switched off by the kill switch. Unlock with Face ID or the WhatsApp code to turn her back on." }, 423);
    const unlocked = gate === "ok";
    const pkRes = await db("ami_passkeys?select=id,public_key,counter,device");
    const keys: any[] = pkRes.ok ? await pkRes.json() : [];

    if (action === "status") return json({ killed, unlocked, passkeys: keys.map((k) => k.device || "passkey") });

    if (action === "lock_now") {
      if (p.unlock) await db(`ami_unlock?token=eq.${encodeURIComponent(String(p.unlock))}`, { method: "DELETE" });
      return json({ ok: true });
    }

    // ---- Register a passkey (Face ID / fingerprint). First one is free; more need the app unlocked. ----
    if (action === "reg_options") {
      if (keys.length && !unlocked) return json({ error: "Unlock AMI first to add another device." }, 403);
      const options = await generateRegistrationOptions({
        rpName: "AMI 1", rpID: RP_ID, userName: OWNER, userDisplayName: "Hussein Saad",
        userID: new TextEncoder().encode("ami-owner"),
        attestationType: "none",
        excludeCredentials: keys.map((k) => ({ id: k.id })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      });
      const cid = await putChallenge("reg", options.challenge);
      return json({ options, cid });
    }
    if (action === "reg_verify") {
      const ch = await takeChallenge(String(p.cid || ""), "reg");
      if (!ch) return json({ error: "That request expired. Try again." }, 400);
      await dropChallenge(String(p.cid));
      const v = await verifyRegistrationResponse({ response: p.response, expectedChallenge: ch.value, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo) return json({ error: "Face ID registration not verified." }, 400);
      const c = v.registrationInfo.credential;
      await db("ami_passkeys", { method: "POST", body: JSON.stringify({ id: c.id, public_key: isoBase64URL.fromBuffer(c.publicKey), counter: c.counter || 0, device: device.slice(0, 80) }) });
      return json({ ok: true, ...(await newUnlock("passkey", device)) });
    }

    // ---- Unlock with Face ID ----
    if (action === "auth_options") {
      if (!keys.length) return json({ error: "No Face ID set up yet.", setup: true }, 400);
      const options = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: keys.map((k) => ({ id: k.id })), userVerification: "required" });
      const cid = await putChallenge("auth", options.challenge);
      return json({ options, cid });
    }
    if (action === "auth_verify") {
      const ch = await takeChallenge(String(p.cid || ""), "auth");
      if (!ch) return json({ error: "That request expired. Try again." }, 400);
      await dropChallenge(String(p.cid));
      const key = keys.find((k) => k.id === p.response?.id);
      if (!key) return json({ error: "This device's Face ID is not registered with AMI." }, 400);
      const v = await verifyAuthenticationResponse({
        response: p.response, expectedChallenge: ch.value, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
        credential: { id: key.id, publicKey: isoBase64URL.toBuffer(key.public_key), counter: Number(key.counter) || 0 },
      });
      if (!v.verified) return json({ error: "Face ID not verified." }, 400);
      await db(`ami_passkeys?id=eq.${encodeURIComponent(key.id)}`, { method: "PATCH", body: JSON.stringify({ counter: v.authenticationInfo.newCounter, last_used: new Date().toISOString() }) });
      return json({ ok: true, ...(await newUnlock("passkey", device)) });
    }

    // ---- Unlock with a 6-digit code sent to his WhatsApp (for the PC, which has no Face ID) ----
    if (action === "code_send") {
      if (!TW_SID || !TW_TOKEN) return json({ error: "WhatsApp is not set up." }, 500);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      const cid = await putChallenge("code", await sha(code), 5);
      const form = new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF_WA}`, Body: `🔐 AMI unlock code: ${code}\nValid 5 minutes. If you did not ask for this, reply LOCK AMI.` });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: form });
      if (!r.ok) return json({ error: "Could not send the WhatsApp code." }, 502);
      return json({ ok: true, cid });
    }
    if (action === "code_verify") {
      const cid = String(p.cid || "");
      const ch = await takeChallenge(cid, "code");
      if (!ch) return json({ error: "Code expired. Ask for a new one." }, 400);
      if (ch.tries >= 4) { await dropChallenge(cid); return json({ error: "Too many wrong codes. Ask for a new one." }, 429); }
      if ((await sha(String(p.code || "").trim())) !== ch.value) {
        await db(`ami_lock_challenges?id=eq.${encodeURIComponent(cid)}`, { method: "PATCH", body: JSON.stringify({ tries: ch.tries + 1 }) });
        return json({ error: "Wrong code." }, 400);
      }
      await dropChallenge(cid);
      return json({ ok: true, ...(await newUnlock("whatsapp", device)) });
    }

    // ---- Replace an API key without pasting it in chat (app must be unlocked). The key is tested first. ----
    if (action === "key_save") {
      if (!unlocked) return json({ error: "Unlock AMI first." }, 403);
      const name = String(p.name || ""), val = String(p.value || "").trim();
      if (val.length < 20 || val.length > 4000 || /\s/.test(val)) return json({ error: "That doesn't look like a valid key." }, 400);
      let test: Response | null = null, rows: string[] = [];
      if (name === "gemini") {
        test = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": val } });
        rows = ["gemini_key", "gemini_api_key"];
      } else if (name === "perplexity") {
        test = await fetch("https://api.perplexity.ai/v1/agent", { method: "POST", headers: { Authorization: "Bearer " + val, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "perplexity/sonar", input: "OK", max_output_tokens: 16 }) });
        rows = ["perplexity_key"];
      } else if (name === "metaapi") {
        test = await fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts", { headers: { "auth-token": val } });
        rows = ["metaapi_token"];
      } else if (name === "twilio") {
        // v1.4: Twilio PRIMARY auth token — whatup uses it to check that WhatsApp messages really come from Twilio
        const sid = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
        test = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: "Basic " + btoa(`${sid}:${val}`) } });
        if (test.ok) { // does it sign WhatsApp messages? check it against the last message that failed the check
          const rr = await db("ami_settings?key=eq.whatup_sig_raw&select=value");
          const raw = rr.ok ? JSON.parse((await rr.json())[0]?.value || "null") : null;
          if (raw?.got && Array.isArray(raw.pairs)) {
            const data = "https://pdzhlslzwjlhxklqcwus.supabase.co/functions/v1/whatup" + (raw.q || "") + raw.pairs.map(([a, b]: [string, string]) => a + b).join("");
            const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(val), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
            const u = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data))); let s = ""; for (const b of u) s += String.fromCharCode(b);
            if (btoa(s) !== raw.got) return json({ error: "Twilio accepted this token, but it is not the one that signs WhatsApp messages. In the Twilio console copy the PRIMARY Auth Token (not the secondary). Nothing was changed." }, 400);
          }
        }
        rows = ["twilio_sign_token"];
      } else return json({ error: "Unknown key name." }, 400);
      if (!test || !test.ok) return json({ error: `The new key was refused by ${name} (${test ? test.status : "no answer"}; the pasted key was ${val.length} characters, starting ${val.slice(0, 5)}). Nothing was changed.` }, 400);
      for (const k of rows) await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: k, value: val }) });
      return json({ ok: true, message: `${name} key tested and saved. Now delete the old key on the ${name} website.` });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "Lock error: " + (e as Error).message }, 500);
  }
});
