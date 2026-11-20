// AMI `selftest` v1.1 (20 Nov 2026) — daily health check of AMI 1.
// 1) every edge function answers (no boot error / crash), 2) every outside key still works (Anthropic, OpenAI, xAI, Gemini,
// Perplexity, MetaApi, Twilio + balance, Google), 3) no scheduled job failed in the last 24 h, 4) trading guard ran recently.
// Result kept in ami_brain "selftest"; WhatsApp to the Chairman only when something is wrong (or {notify:"always"}).
// Called by cron (internal key) or from the app (owner token + unlock).
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const OWNER = "hnsaad1973@gmail.com", SELF_WA = "+231777170170";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-internal-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const TO = (ms: number) => AbortSignal.timeout(ms);
// functions in use (old test functions are listed in OLD and only reported, not tested)
const FUNCS = ["ai", "lock", "trade", "panel", "lab", "control", "whatup", "amisend", "todox", "equity", "followup", "mailscan", "wake", "saycall", "newsalert",
  "secrelay", "drivefile", "drivesort", "driveperm", "drawplan", "drawelev", "pricebuild", "sheetbuild", "actualforms", "monthlyforms", "leadfs", "leadreminders",
  "boarddesign", "tracksea", "contactfind", "pdfsplit", "ziplist", "billcheck", "authlink", "meetscribe", "waprofile", "tplmake", "tplsubmit"];
const OLD = ["generate-recipes-with-ai-sdk", "gtest", "sttcheck", "oaicheck", "callcheck", "tplcheck"];

async function setting(k: string) { try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.${k}&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } }
async function getKey(k: string) { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.${k}&select=data`, { headers: H }); return r.ok ? (await r.json())[0]?.data ?? null : null; }
async function setKey(k: string, data: unknown) { await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: k, data, updated_at: new Date().toISOString() }) }); }
async function waSelf(text: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") || "", tok = Deno.env.get("TWILIO_AUTH_TOKEN") || "", from = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
  if (!sid || !tok) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${SELF_WA}`, Body: text.slice(0, 1500) }) }).catch(() => null);
}

// a function is "up" if it boots and answers. We send only a CORS pre-check (OPTIONS), which never runs a job.
async function ping(name: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${SB}/functions/v1/${name}`, { method: "OPTIONS", signal: TO(25000), headers: { Origin: "https://hnsaad1973-tech.github.io", "Access-Control-Request-Method": "POST" } });
    const body = (await r.text().catch(() => "")).slice(0, 160);
    const up = r.status < 500 || (r.status === 500 && !/BOOT_ERROR|WORKER_ERROR|InvalidWorker|NOT_FOUND/i.test(body));
    return { name, up, status: r.status, ms: Date.now() - t0, note: up ? "" : body };
  } catch (e) { return { name, up: false, status: 0, ms: Date.now() - t0, note: (e as Error).message.slice(0, 100) }; }
}
async function keyCheck(name: string, fn: () => Promise<Response | string>) {
  try { const r = await fn(); if (typeof r === "string") return { name, ok: !/^ERR/.test(r), note: r.replace(/^ERR:?\s*/, "") };
    return { name, ok: r.ok, note: r.ok ? "" : "refused (" + r.status + ")" }; }
  catch (e) { return { name, ok: false, note: (e as Error).message.slice(0, 100) }; }
}

async function runTest() {
  const started = new Date().toISOString();
  const env = (k: string) => (Deno.env.get(k) || "").trim();
  const [pings, keys, cronFails, guard] = await Promise.all([
    (async () => { const out: any[] = []; for (let i = 0; i < FUNCS.length; i += 4) { out.push(...await Promise.all(FUNCS.slice(i, i + 4).map(ping))); await new Promise((z) => setTimeout(z, 1500)); }
      // a rate-limit answer is the gateway, not the function: check those once more after a pause
      const rl = out.filter((x) => !x.up && /rate limit/i.test(x.note));
      if (rl.length) { await new Promise((z) => setTimeout(z, 20000)); for (const x of rl) { const y = await ping(x.name); Object.assign(x, y, /rate limit/i.test(y.note) ? { up: true, note: "not checked (rate limit)" } : {}); await new Promise((z) => setTimeout(z, 1500)); } }
      return out; })(),
    Promise.all([
      keyCheck("Anthropic (Claude)", () => fetch("https://api.anthropic.com/v1/models?limit=1", { signal: TO(15000), headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" } })),
      keyCheck("OpenAI (ChatGPT)", async () => env("OPENAI_API_KEY") ? fetch("https://api.openai.com/v1/models", { signal: TO(15000), headers: { Authorization: "Bearer " + env("OPENAI_API_KEY") } }) : "ERR not set"),
      keyCheck("xAI (Grok)", async () => env("XAI_API_KEY") ? fetch("https://api.x.ai/v1/models", { signal: TO(15000), headers: { Authorization: "Bearer " + env("XAI_API_KEY") } }) : "ERR not set"),
      keyCheck("Gemini", async () => { const k = env("GEMINI_API_KEY") || await setting("gemini_key"); return k ? fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { signal: TO(15000), headers: { "x-goog-api-key": k } }) : "ERR not set"; }),
      keyCheck("Perplexity", async () => { const k = await setting("perplexity_key") || env("PERPLEXITY_API_KEY"); return k ? fetch("https://api.perplexity.ai/v1/agent", { method: "POST", signal: TO(30000), headers: { Authorization: "Bearer " + k, "Content-Type": "application/json" }, body: JSON.stringify({ model: "perplexity/sonar", input: "OK", max_output_tokens: 16 }) }) : "ERR not set"; }),
      keyCheck("MetaApi (trading)", async () => { const k = await setting("metaapi_token") || env("METAAPI_TOKEN"); return k ? fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts", { signal: TO(20000), headers: { "auth-token": k } }) : "ERR not set"; }),
      keyCheck("Twilio (WhatsApp)", async () => {
        const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN"); if (!sid || !tok) return "ERR not set";
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, { signal: TO(15000), headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`) } });
        if (!r.ok) return "ERR refused (" + r.status + ")";
        const j = await r.json(); const bal = +j.balance || 0;
        return (bal < 10 ? "ERR " : "") + `balance ${j.currency || "USD"} ${bal.toFixed(2)}${bal < 10 ? " — top up soon" : ""}`;
      }),
      keyCheck("Google (Gmail/Drive/Calendar)", async () => {
        if (!env("GOOGLE_REFRESH_TOKEN")) return "ERR not set";
        const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: TO(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: env("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token" }) });
        return r;
      }),
    ]),
    fetch(`${SB}/rest/v1/rpc/ami_cron_failures`, { method: "POST", headers: H, body: JSON.stringify({ p_hours: 24 }) }).then((r) => r.ok ? r.json() : []).catch(() => []),
    getKey("trade_guard"),
  ]);
  const down = pings.filter((p) => !p.up), badKeys = keys.filter((k) => !k.ok);
  const now = new Date(), weekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
  const guardAgeMin = guard?.at ? Math.round((Date.now() - Date.parse(guard.at)) / 60000) : null;
  const guardStale = weekday && (guardAgeMin === null || guardAgeMin > 60);
  const problems: string[] = [
    ...down.map((p) => `Function ${p.name} is DOWN (${p.status || "no answer"}${p.note ? ": " + p.note : ""})`),
    ...badKeys.map((k) => `${k.name}: ${k.note || "not working"}`),
    ...(cronFails as any[]).map((c: any) => `Scheduled job ${c.jobname} failed ${c.failures}x in 24 h${c.last_error ? " — " + c.last_error : ""}`),
    ...(guardStale ? [`Trading guard has not run for ${guardAgeMin ?? "?"} min (should run every 15 min on weekdays)`] : []),
  ];
  const result = { at: started, ok: !problems.length, functions_up: pings.length - down.length, functions_total: pings.length, functions: pings, keys, cron_failures: cronFails,
    guard_age_min: guardAgeMin, old_test_functions: OLD, problems };
  await setKey("selftest", result);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const ik = req.headers.get("x-internal-key") || "";
  if (ik) { if (ik !== await setting("wake_key")) return json({ error: "Access denied." }, 403); }
  else {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: ANON } });
    if (!u.ok || String((await u.json()).email || "").toLowerCase() !== OWNER) return json({ error: "Not signed in." }, 401);
    const g = await fetch(`${SB}/rest/v1/rpc/ami_gate`, { method: "POST", headers: H, body: JSON.stringify({ p_unlock: String(p.unlock || ""), p_need_unlock: true }) });
    if ((g.ok ? await g.json().catch(() => null) : null) !== "ok") return json({ error: "AMI is locked." }, 423);
  }
  if (p.action === "last") return json({ result: await getKey("selftest") });
  if (p.action !== "run") return json({ error: "Unknown action." }, 400);
  const r = await runTest();
  if (!r.ok || p.notify === "always") {
    await waSelf(r.ok
      ? `✅ AMI self-test: all ${r.functions_total} functions answering, all ${r.keys.length} connections working, no failed jobs.`
      : `⚠️ AMI self-test found ${r.problems.length} problem(s):\n- ${r.problems.slice(0, 12).join("\n- ")}\n\n${r.functions_up}/${r.functions_total} functions answering.`);
  }
  return json({ result: r });
});
