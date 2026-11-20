// AMI `control` v1.1 (20 Nov 2026: SECURITY — app calls need AMI switched on (kill switch) and unlocked (Face ID / WhatsApp code) via ami_gate; overview shows the spending caps (ami_spend))
// v1.0.1 (20 Nov 2026: quoted month/year column names) — AMI Control Room: cost meter (day / month / year), tokens, usage hours, cost by seat and job,
// health of every connected service, subscription register (renewal, expiry, funding, daily caps) and WhatsApp alerts.
// Usage comes from table ami_usage (every AI call AMI makes is logged there with tokens; cost from ami_prices).
// Access: the Chairman's AMI 1 sign-in token + unlock, or the internal key. Daily run (cron 06:50 UTC): {action:"daily"} -> health check + alerts (runs even when the kill switch is on).
import postgres from "npm:postgres@3.4.4";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const OWNER = "hnsaad1973@gmail.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) || "").trim();
const TO = (ms: number) => AbortSignal.timeout(ms);
const setting = async (k: string) => { const r = await sql`select value from ami_settings where key=${k}`; return String(r[0]?.value || "").trim(); };
async function internal(fn: string, body: any, ms = 30000) {
  const r = await fetch(`${SB}/functions/v1/${fn}`, { method: "POST", signal: TO(ms), headers: { "Content-Type": "application/json", "x-internal-key": await setting("wake_key") }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ error: String(r.status) }));
}

// ---------- health ----------
async function ping(name: string, f: () => Promise<boolean | string>) {
  const t = Date.now();
  try { const r = await f(); return { name, ok: r === true, note: r === true ? "" : String(r || "not connected"), ms: Date.now() - t }; }
  catch (e) { return { name, ok: false, note: String((e as Error).message).slice(0, 120), ms: Date.now() - t }; }
}
const models = async (base: string, key: string, hdr: Record<string, string> = {}) => { if (!key) return "no key"; const r = await fetch(`${base}/models`, { signal: TO(12000), headers: { Authorization: `Bearer ${key}`, ...hdr } }); return r.ok ? true : `error ${r.status}`; };
async function health() {
  const checks = await Promise.all([
    ping("Claude (Anthropic)", async () => { const k = env("ANTHROPIC_API_KEY"); if (!k) return "no key"; const r = await fetch("https://api.anthropic.com/v1/models", { signal: TO(12000), headers: { "x-api-key": k, "anthropic-version": "2023-06-01" } }); return r.ok || `error ${r.status}`; }),
    ping("ChatGPT + Chief Actuary (OpenAI)", () => models("https://api.openai.com/v1", env("OPENAI_API_KEY"))),
    ping("Grok (xAI)", () => models("https://api.x.ai/v1", env("XAI_API_KEY"))),
    ping("Gemini (Google)", async () => models("https://generativelanguage.googleapis.com/v1beta/openai", env("GEMINI_API_KEY") || await setting("gemini_key"))),
    ping("Perplexity", async () => (env("PERPLEXITY_API_KEY") || await setting("perplexity_key")) ? true : "no key"),
    ping("General Counsel (Cohere)", async () => models("https://api.cohere.ai/compatibility/v1", env("COHERE_API_KEY") || await setting("cohere_key"))),
    ping("QS / MEP Engineer (Mistral)", async () => models("https://api.mistral.ai/v1", env("MISTRAL_API_KEY") || await setting("mistral_key"))),
    ping("Financial Controller (Qwen)", async () => models("https://dashscope-intl.aliyuncs.com/compatible-mode/v1", env("QWEN_API_KEY") || await setting("qwen_key"))),
    ping("Devil's Advocate (DeepSeek)", async () => models("https://api.deepseek.com/v1", env("DEEPSEEK_API_KEY") || await setting("deepseek_key"))),
    ping("WhatsApp (Twilio)", async () => { const b = await internal("amisend", { action: "balance" }); return b.error ? b.error : true; }),
    ping("Google Drive", async () => { const f = await setting("lab_folder"); const d = await internal("drivefile", { action: "list", folder_id: f }); return d.files ? true : (d.error?.message || d.error || "error"); }),
    ping("AMI 1 web app", async () => { const r = await fetch("https://hnsaad1973-tech.github.io/ami-lite/", { signal: TO(12000) }); return r.ok || `error ${r.status}`; }),
    ping("Platinum platform", async () => { const r = await fetch("https://app.amiinnovations.com/platinum/", { signal: TO(12000) }); return r.ok || `error ${r.status}`; }),
    ping("Trading link (MetaApi)", async () => (env("METAAPI_TOKEN") || await setting("metaapi_token")) ? true : "no token"),
  ]);
  const bal = await internal("amisend", { action: "balance" }).catch(() => ({}));
  const res = { at: new Date().toISOString(), checks, twilio_balance: bal?.balance ?? bal?.account?.balance ?? null };
  await sql`insert into ami_brain(key, data, updated_at) values ('control_health', ${sql.json(res as any)}, now()) on conflict (key) do update set data=excluded.data, updated_at=now()`;
  return res;
}

// ---------- overview ----------
async function overview() {
  const [k] = await sql`select
      coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now())),0)::float as "today",
      coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now()) - interval '1 day' and at < date_trunc('day', now())),0)::float as "yesterday",
      coalesce(sum(cost_usd) filter (where at >= date_trunc('month', now())),0)::float as "month",
      coalesce(sum(cost_usd) filter (where at >= date_trunc('year', now())),0)::float as "year",
      coalesce(sum(tokens_in+tokens_out) filter (where at >= date_trunc('day', now())),0)::bigint tokens_today,
      coalesce(sum(tokens_in+tokens_out) filter (where at >= date_trunc('month', now())),0)::bigint tokens_month,
      coalesce(sum(ms) filter (where at >= date_trunc('day', now())),0)::float/3600000 hours_today,
      coalesce(sum(ms) filter (where at >= date_trunc('month', now())),0)::float/3600000 hours_month,
      count(*) filter (where at >= date_trunc('day', now()))::int calls_today,
      min(at) first_logged
    from ami_usage`;
  const days = Math.max(1, Math.min(30, (Date.now() - new Date(k.first_logged || Date.now()).getTime()) / 864e5));
  const [avg] = await sql`select coalesce(sum(cost_usd),0)::float / ${days} per_day from ami_usage where at >= now() - interval '30 days'`;
  const daily = await sql`select to_char(d, 'YYYY-MM-DD') as "day", coalesce(sum(u.cost_usd),0)::float cost, coalesce(sum(u.tokens_in+u.tokens_out),0)::bigint tokens, coalesce(sum(u.ms),0)::float/3600000 hours
    from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
    left join ami_usage u on u.at >= d and u.at < d + interval '1 day' group by d order by d`;
  const seats = await sql`select coalesce(seat, provider, 'other') seat, sum(cost_usd)::float cost, sum(tokens_in+tokens_out)::bigint tokens, count(*)::int calls
    from ami_usage where at >= date_trunc('month', now()) group by 1 order by cost desc limit 15`;
  const sources = await sql`select coalesce(source,'other') source, sum(cost_usd)::float cost, count(*)::int calls from ami_usage where at >= date_trunc('month', now()) group by 1 order by cost desc`;
  const jobs = await sql`select job, max(source) source, sum(cost_usd)::float cost, sum(tokens_in+tokens_out)::bigint tokens, max(at) at from ami_usage where job is not null and at >= now() - interval '30 days' group by job order by max(at) desc limit 12`;
  const subs = await sql`select *, (renews_on - current_date) renew_days, (expires_on - current_date) expiry_days from ami_subs where active order by coalesce(least(renews_on, expires_on), '2999-01-01'), name`;
  const caps = await sql`select s.name, s.daily_cap_usd, coalesce((select sum(cost_usd) from ami_usage u where u.at >= date_trunc('day', now()) and u.provider ilike s.provider),0)::float spent
    from ami_subs s where s.daily_cap_usd is not null`;
  const [sp] = await sql`select ami_spend() as s`;
  const [h] = await sql`select data from ami_brain where key='control_health'`;
  return { kpi: { ...k, per_day_30: avg.per_day, month_projection: avg.per_day * 30.4, year_projection: avg.per_day * 365 }, spend: sp?.s || null, daily, seats, sources, jobs, subs, caps, health: h?.data || null };
}

// ---------- daily alerts ----------
async function daily() {
  const hc = await health();
  const o = await overview();
  const lines: string[] = [];
  const red = hc.checks.filter((c: any) => !c.ok && !/no key|no token/.test(c.note));
  if (red.length) lines.push("⚠️ Not working: " + red.map((c: any) => c.name).join(", "));
  for (const s of o.subs as any[]) {
    for (const [d, what] of [[s.renew_days, "renews"], [s.expiry_days, "expires"]] as [number | null, string][])
      if (d !== null && [14, 7, 1, 0].includes(Number(d))) lines.push(`📅 ${s.name} ${what} ${d === 0 ? "TODAY" : `in ${d} day${d === 1 ? "" : "s"}`}${s.cost_usd ? ` (USD ${s.cost_usd})` : ""}`);
    if (s.balance_usd !== null && s.low_balance_usd !== null && Number(s.balance_usd) <= Number(s.low_balance_usd)) lines.push(`💳 ${s.name} balance low: USD ${s.balance_usd}`);
  }
  for (const c of o.caps as any[]) if (c.spent >= Number(c.daily_cap_usd)) lines.push(`🛑 ${c.name} passed its daily cap (USD ${c.spent.toFixed(2)} of ${c.daily_cap_usd})`);
  const k: any = o.kpi;
  lines.push(`💰 AI cost yesterday USD ${k.yesterday.toFixed(2)} · this month USD ${k.month.toFixed(2)} · projected month USD ${k.month_projection.toFixed(0)}`);
  await internal("amisend", { action: "notify", text: "AMI Control Room\n" + lines.join("\n") });
  return { sent: lines };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const ik = req.headers.get("x-internal-key") || "";
  if (ik) { if (ik !== await setting("wake_key")) return out({ error: "denied" }, 403); }
  else {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: env("SUPABASE_ANON_KEY") } });
    if (!u.ok) return out({ error: "Not signed in." }, 401);
    if (String((await u.json()).email || "").toLowerCase() !== OWNER) return out({ error: "Access denied." }, 403);
    // v1.1: kill switch + app lock
    const g = await fetch(`${SB}/rest/v1/rpc/ami_gate`, { method: "POST", headers: H, body: JSON.stringify({ p_unlock: String(p.unlock || ""), p_need_unlock: true }) });
    const gate = g.ok ? await g.json().catch(() => null) : null;
    if (gate === "killed") return out({ error: "AMI is switched off by the kill switch.", killed: true }, 423);
    if (gate !== "ok") return out({ error: "AMI is locked. Unlock with Face ID or the WhatsApp code.", locked: true }, 423);
  }
  try {
    if (p.action === "overview") return out(await overview());
    if (p.action === "check") { await health(); return out(await overview()); }
    if (p.action === "daily") return out(await daily());
    if (p.action === "sub_save") {
      const s = p.s || {}; const d = (v: any) => (v ? String(v).slice(0, 10) : null); const n = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
      if (s.id) await sql`update ami_subs set name=${s.name}, plan=${s.plan || null}, cost_usd=${n(s.cost_usd)}, cycle=${s.cycle || null}, renews_on=${d(s.renews_on)}, expires_on=${d(s.expires_on)},
          paid_with=${s.paid_with || null}, balance_usd=${n(s.balance_usd)}, low_balance_usd=${n(s.low_balance_usd)}, daily_cap_usd=${n(s.daily_cap_usd)}, key_added_on=${d(s.key_added_on)}, notes=${s.notes || null}, updated_at=now() where id=${Number(s.id)}`;
      else await sql`insert into ami_subs(name, provider, kind, plan, cost_usd, cycle, renews_on, expires_on, paid_with, balance_usd, low_balance_usd, daily_cap_usd, notes)
          values (${s.name}, ${s.provider || null}, ${s.kind || null}, ${s.plan || null}, ${n(s.cost_usd)}, ${s.cycle || null}, ${d(s.renews_on)}, ${d(s.expires_on)}, ${s.paid_with || null}, ${n(s.balance_usd)}, ${n(s.low_balance_usd)}, ${n(s.daily_cap_usd)}, ${s.notes || null})`;
      return out({ ok: true });
    }
    return out({ error: "unknown action" }, 400);
  } catch (e) { return out({ error: String((e as Error).message) }, 500); }
});
