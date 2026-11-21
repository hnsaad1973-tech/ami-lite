// AMI `trade` v2.4 (21 Nov 2026: CHAIRMAN picks which voters sit on the study, min 2; none = all 5) — v2.3 (21 Nov 2026: scorecard also counts trades the broker closes at stop/target) — v2.2 (21 Nov 2026: CHAIRMAN'S 3 RULES — (1) orders only on the study's own Monday; (2) a half-share trade (3 YES) is skipped when a NO vote cites a price level / support / resistance; (3) every seat's record kept (right/wrong per closed trade) in trade_scorecard) — v2.1 (20 Nov 2026) — spending cap on new studies + every AI call logged in ami_usage; v2.0 — TRADING SAFETY: kill switch + app-lock check (ami_gate); "guard" action (run every 15 min by cron):
//   weekly loss cap enforced in code ($600 from the Monday balance -> every position closed) and Friday close (from 20:00 UTC Friday nothing stays open);
//   "close" action (one position or all, Chairman only, app unlocked); MetaApi token now read from the Keys store first (ami_settings), env secret as fallback.
// v1.9.1 (18 Nov 2026; one-time send lock per study (no duplicate orders); whole budget invested across approved trades, risk = share of the $600 weekly cap; retries MetaApi read hiccups and chart fetch; 24h 15-min chart per open position; live account + positions for the trading panel (action account); MT4 success code ERR_NO_ERROR counted as placed; picks the broker's tradable symbol version (e.g. EURUSDs); short MT4 order comment; price retry one-by-one, unpriced trades dropped instead of stopping; live price check by Perplexity before voting, Gemini retries when Google is busy; market tabs: all / fx / metals / energy / indices / stocks; Concur & place orders via MetaApi (OneRoyal MT5), decline; risk-based lot sizing from the broker's symbol spec; + Perplexity voter (5th seat); + Gemini voter, sizing for a board of up to 5; week set in code = next Mon-Fri; research text kept across search rounds, stops if prices are missing; structured answers via the answer tool, research then candidates) — Trading Hub (weekly, Mon open -> Fri close). DEMO: no orders are placed.
// 1) Claude (with web search) builds the week's market pack and 6 candidate CFD trades in the Chairman's direction (buy / short / either).
// 2) Claude, ChatGPT and Grok vote blind on every candidate (YES/NO, confidence 1-5, reason).
// 3) Rules in code: 3/3 YES = full size (~$2,000 of a $10,000 budget), 2/3 = half (~$1,000), 0-1 = skip; max 2 trades per theme;
//    stop-loss sized so a hit stop loses about $150 per trade; weekly loss cap $600 (everything closes); all trades close by Friday.
// Runs in the background; the app polls action "get". Owner token or AMI internal key. State: ami_brain "trade_run", history "trade_weeks".
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const OWNER = "hnsaad1973@gmail.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-internal-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const RISK = 150, LOSS_CAP = 600;
const FRIDAY_CLOSE_UTC = 20; // Friday 20:00 UTC (Monrovia time) — markets shut about 21:00-22:00
const SELF_WA = "+231777170170";
async function getKey(k: string) { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.${k}&select=data`, { headers: H }); return r.ok ? (await r.json())[0]?.data ?? null : null; }
async function setKey(k: string, data: unknown) { await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: k, data, updated_at: new Date().toISOString() }) }); }
async function logUse(provider: string, model: string, tin: number, tout: number) {
  await fetch(`${SB}/rest/v1/ami_usage`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ source: "trade", provider, model, job: "trade study", tokens_in: Math.round(tin || 0), tokens_out: Math.round(tout || 0), ok: true }) }).catch(() => null);
}
function jparse(t: string) { const s = t.indexOf("{"), e = t.lastIndexOf("}"); return JSON.parse(t.slice(s, e + 1)); }
// if a model's JSON is broken (e.g. web-search citations inside it), have a fast model rewrite it as clean JSON
async function jfix(t: string) {
  try { return jparse(t); } catch (_) {}
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(90000), headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 8000, system: "Rewrite the user's text as ONE strictly valid JSON object with the same keys and values. Fix quotes, commas and escapes. Remove citation markers. Output only the JSON.", messages: [{ role: "user", content: t.slice(0, 60000) }] }) });
  const j = await r.json().catch(() => ({}));
  return jparse((j.content || []).map((b: any) => b.text || "").join(""));
}
const TO = (ms: number) => AbortSignal.timeout(ms);
// v1.2: answers come back through a forced tool call, so the JSON is always valid
async function claudeTool(model: string, system: string, user: string, schema: any, max = 8000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: TO(170000), headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: max, system: system + "\nIMPORTANT: give your final answer ONLY by calling the 'answer' tool.", messages: [{ role: "user", content: user }], tools: [{ name: "answer", description: "Give the answer", input_schema: schema }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || "Claude error " + r.status);
  if (j.usage) await logUse("anthropic", model, (+j.usage.input_tokens || 0) + (+j.usage.cache_read_input_tokens || 0) * 0.1, +j.usage.output_tokens || 0);
  const t = (j.content || []).find((b: any) => b.type === "tool_use"); if (!t) throw new Error("Claude gave no structured answer");
  return t.input;
}
const S = (o: any) => ({ type: "object", properties: o, required: Object.keys(o) });
const PACK_SCHEMA = S({ week: { type: "string" }, market_brief: { type: "string" }, key_events: { type: "array", items: { type: "string" } },
  candidates: { type: "array", items: S({ symbol: { type: "string" }, name: { type: "string" }, theme: { type: "string" }, direction: { type: "string", enum: ["BUY", "SHORT"] }, price: { type: "number" }, price_note: { type: "string" }, entry: { type: "number" }, stop: { type: "number" }, target: { type: "number" }, reason: { type: "string" } }) } });
const VOTE_SCHEMA = S({ votes: { type: "array", items: S({ symbol: { type: "string" }, vote: { type: "string", enum: ["YES", "NO"] }, confidence: { type: "integer" }, reason: { type: "string" } }) } });

async function claude(model: string, system: string, user: string, search = false, max = 6000) {
  const body: any = { model, max_tokens: max, system, messages: [{ role: "user", content: user }] };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }];
  let msgs = body.messages, acc = "", last = "";
  for (let i = 0; i < 8; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: TO(170000), headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ ...body, messages: msgs }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || "Claude error " + r.status);
    if (j.usage) await logUse("anthropic", model, (+j.usage.input_tokens || 0) + (+j.usage.cache_read_input_tokens || 0) * 0.1, +j.usage.output_tokens || 0);
    acc += (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""); last = String(j.stop_reason || "");
    if (j.stop_reason === "pause_turn") { msgs = [...msgs, { role: "assistant", content: j.content }]; continue; }
    return acc;
  }
  if (acc) return acc;
  throw new Error("Claude did not finish (" + last + ")");
}
async function geminiKey() { const e = (Deno.env.get("GEMINI_API_KEY") || "").trim(); if (e) return e;
  try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.gemini_key&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } }
// Perplexity (live web search on every answer) via its Agent API. Key: secret PERPLEXITY_API_KEY, else ami_settings "perplexity_key" (locked table).
async function pplxKey() { const e = (Deno.env.get("PERPLEXITY_API_KEY") || "").trim(); if (e) return e;
  try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.perplexity_key&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } }
async function pplx(system: string, user: string): Promise<{ model: string; text: string }> {
  const key = await pplxKey(); if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const model of ["perplexity/sonar"]) {
    const r = await fetch("https://api.perplexity.ai/v1/agent", { method: "POST", signal: AbortSignal.timeout(150000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: system + "\nCheck current facts and prices with web search. Answer ONLY with the JSON, no citation markers inside it.", input: user, tools: [{ type: "web_search" }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { last = new Error(j?.error?.message || "error " + r.status); continue; }
    if (j.usage) await logUse("perplexity", model, +j.usage.input_tokens || 0, +j.usage.output_tokens || 0);
    const text = (j.output || []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("") || String(j.output_text || "");
    if (text) return { model, text: text.replace(/\[\d+\]/g, "") };
    last = new Error("empty answer");
  }
  throw last || new Error("no answer");
}
async function pick(base: string, key: string, prefs: RegExp[], dflt: string) {
  try { const ids: string[] = ((await (await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: TO(10000) })).json()).data || []).map((m: any) => m.id);
    for (const p of prefs) { const h = ids.filter((i) => p.test(i)).sort().reverse()[0]; if (h) return h; } } catch (_) {}
  return dflt;
}
async function oai(base: string, key: string, model: string, system: string, user: string, extra: any = {}) {
  const r = await fetch(`${base}/chat/completions`, { method: "POST", signal: TO(150000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...extra }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || "error " + r.status);
  if (j.usage) await logUse(base.includes("x.ai") ? "xai" : base.includes("googleapis") ? "google" : "openai", model, +j.usage.prompt_tokens || 0, +j.usage.completion_tokens || 0);
  return String(j.choices?.[0]?.message?.content || "");
}

// ---------- Broker (OneRoyal MT4/MT5 via MetaApi). Settings in the locked ami_settings table: metaapi_token, metaapi_account, metaapi_region (default new-york).
async function setting(k: string) { try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.${k}&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } }
async function broker() {
  // v2.0: the token saved through the app's Keys box wins; the old secret is only a fallback
  const token = await setting("metaapi_token") || (Deno.env.get("METAAPI_TOKEN") || "").trim(), account = await setting("metaapi_account");
  if (!token || !account) return null;
  const region = (await setting("metaapi_region")) || "new-york";
  const base = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${account}`;
  const call = async (path: string, init: any = {}) => { for (let k = 0; ; k++) { const r = await fetch(base + path, { ...init, signal: TO(60000), headers: { "auth-token": token, "Content-Type": "application/json" } }); const j = await r.json().catch(() => ({}));
    if (r.ok) return j; const m = j?.message || "broker error " + r.status;
    if (k < 2 && (!init.method || init.method === "GET") && /not connected|region|timed? ?out|50\d/i.test(m + r.status)) { await new Promise((z) => setTimeout(z, 1500)); continue; } // MetaApi replica hiccup: retry reads only
    throw new Error(m); } };
  return { call, token, md: `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${account}` };
}
// last 24h of 15-minute closes per open position, for the panel's chart (market-data API, same region/account)
async function withCandles(b: any, positions: any[]) {
  return await Promise.all(positions.map(async (x: any) => { for (let k = 0; k < 2; k++) { try {
    const r = await fetch(`${b.md}/historical-market-data/symbols/${encodeURIComponent(x.broker_symbol)}/timeframes/15m/candles?limit=96`, { signal: TO(20000), headers: { "auth-token": b.token } });
    const c = r.ok ? await r.json() : []; const chart = (Array.isArray(c) ? c : []).map((q: any) => [Date.parse(q.time), +q.close]).filter((q: any) => q[1] > 0);
    if (chart.length > 1 || k) return { ...x, chart };
  } catch (_) {} await new Promise((z) => setTimeout(z, 1500)); } return { ...x, chart: [] }; }));
}
function stepRound(v: number, step: number) { return Math.floor(v / step + 1e-9) * step; }
async function placeOrders(run: any) {
  const b = await broker();
  const picks = (run.trades || []).filter((t: any) => t.allocation > 0);
  if (!b) return { status: "waiting", note: "Broker not connected yet (MetaApi). The orders are saved and will be sent when you tap again after OneRoyal is connected.", orders: picks.map((t: any) => ({ symbol: t.symbol, direction: t.direction, status: "waiting", stop: t.stop, target: t.target })) };
  let symbols: string[] = []; try { symbols = await b.call("/symbols"); } catch (_) {}
  const full = run.budget * 0.2, orders: any[] = [];
  for (const t of picks) {
    const o: any = { symbol: t.symbol, direction: t.direction, stop: t.stop, target: t.target };
    try {
      // broker may list several versions (e.g. EURUSD quote-only, EURUSDs tradable): use the first one whose trade mode is open
      const want = t.symbol.replace(/[^A-Z0-9]/g, "");
      const opts = symbols.filter((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith(want)).sort((a, z) => (a.toUpperCase() === want ? 1 : 0) - (z.toUpperCase() === want ? 1 : 0) || a.length - z.length);
      if (!opts.length) opts.push(t.symbol);
      let sym = opts[0], spec: any = null;
      for (const x of opts) { try { const sp = await b.call(`/symbols/${encodeURIComponent(x)}/specification`); if (!/DISABLED|CLOSEONLY/i.test(String(sp.tradeMode || ""))) { sym = x; spec = sp; break; } if (!spec) { sym = x; spec = sp; } } catch (_) {} }
      if (!spec) spec = await b.call(`/symbols/${encodeURIComponent(sym)}/specification`);
      const risk = t.risk > 0 ? t.risk : RISK * Math.min(1, t.allocation / full), dist = Math.abs(t.entry - t.stop); // v1.9: risk share of the weekly cap
      const units = dist ? risk / dist : 0, cs = +spec.contractSize || 1, step = +spec.volumeStep || 0.01, min = +spec.minVolume || 0.01;
      const lots = Math.round(stepRound(units / cs, step) * 100) / 100;
      o.broker_symbol = sym; o.lots = lots; o.risk = Math.round(risk);
      if (lots < min) { o.status = "skipped"; o.error = `Smallest lot (${min}) would risk more than $${Math.round(risk)}.`; orders.push(o); continue; }
      const res = await b.call("/trade", { method: "POST", body: JSON.stringify({ actionType: t.direction === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL", symbol: sym, volume: lots, stopLoss: t.stop, takeProfit: t.target, comment: "AMI" }) });
      o.status = /DONE|PLACED|NO_ERROR/.test(String(res.stringCode)) || ((res.orderId || res.positionId) && !/^ERR_(?!NO_ERROR)/.test(String(res.stringCode))) ? "placed" : "rejected"; o.code = res.stringCode; o.order_id = res.orderId || res.positionId || ""; if (o.status !== "placed") o.error = res.message || res.stringCode;
    } catch (e) { o.status = "failed"; o.error = (e as Error).message.slice(0, 200); }
    orders.push(o);
  }
  const n = orders.filter((o) => o.status === "placed").length;
  return { status: n === orders.length ? "placed" : n ? "partly placed" : "failed", note: `${n} of ${orders.length} orders placed.`, orders };
}

// ---------- v2.0 safety: close positions, weekly loss cap, Friday close ----------
async function closeList(b: any, positions: any[]) {
  const out: any[] = [];
  for (const x of positions) {
    try {
      const res = await b.call("/trade", { method: "POST", body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: String(x.id) }) });
      const ok = /DONE|NO_ERROR|PLACED/.test(String(res.stringCode));
      out.push({ id: x.id, symbol: String(x.symbol || "").replace(/s$/, ""), side: /SELL/.test(String(x.type || x.side)) ? "SELL" : "BUY", lots: +x.volume || +x.lots || 0, pnl: Math.round((+x.profit || +x.pnl || 0) * 100) / 100, status: ok ? "closed" : "rejected", code: res.stringCode, error: ok ? "" : (res.message || res.stringCode) });
    } catch (e) { out.push({ id: x.id, symbol: x.symbol, status: "failed", error: (e as Error).message.slice(0, 200) }); }
  }
  return out;
}
async function waSelf(text: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") || "", tok = Deno.env.get("TWILIO_AUTH_TOKEN") || "", from = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
  if (!sid || !tok) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${SELF_WA}`, Body: text.slice(0, 1500) }) }).catch(() => null);
}
async function logCloses(out: any[], why: string, by: string) {
  const log = ((await getKey("trade_closes")) || []).slice(0, 49);
  await setKey("trade_closes", [{ at: new Date().toISOString(), why, by, positions: out }, ...log]);
  try { await score(out); } catch (_) {}
}
// v2.2 Rule 3: each seat's record — on every closed position, a YES on a winner or a NO on a loser counts as right
async function score(out: any[]) {
  const weeks = (await getKey("trade_weeks")) || [], sc: any = (await getKey("trade_scorecard")) || { seats: {}, trades: [] };
  const seen = new Set((sc.trades || []).map((t: any) => t.key));
  const bySym: Record<string, number> = {};
  for (const o of out) if (o.status === "closed") bySym[o.symbol] = (bySym[o.symbol] || 0) + (+o.pnl || 0);
  for (const [sym, pnl] of Object.entries(bySym)) {
    const w = weeks.find((x: any) => x.execution && /placed/.test(x.execution.status) && (x.trades || []).some((t: any) => t.symbol === sym && t.allocation > 0));
    if (!w) continue; const key = w.id + ":" + sym; if (seen.has(key) || !pnl) continue;
    const t = w.trades.find((t: any) => t.symbol === sym && t.allocation > 0), win = pnl > 0;
    for (const v of t.votes || []) { const r = (sc.seats[v.name] ||= { right: 0, wrong: 0 }); ((v.vote === "YES") === win) ? r.right++ : r.wrong++; }
    sc.trades = [{ key, symbol: sym, pnl: Math.round(pnl * 100) / 100, win, at: new Date().toISOString() }, ...(sc.trades || [])].slice(0, 100);
  }
  await setKey("trade_scorecard", sc);
}
function mondayOf(d: Date) { const back = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10); }
function closeText(out: any[]) { return out.map((o) => `${o.symbol} ${o.side || ""} ${o.lots || ""}: ${o.status}${o.pnl ? ` (${o.pnl >= 0 ? "+" : "−"}$${Math.abs(o.pnl).toFixed(2)})` : ""}${o.error ? " — " + o.error : ""}`).join("\n"); }

// v1.7: live price check — Perplexity (live web search) fetches current quotes; each trade's entry/stop/target move with the price (same distances)
async function livePrices(cands: any[]) {
  const sys = "You fetch CURRENT market prices with web search. For each symbol give the latest price you can find (CFD/spot/futures front month), its source and time (UTC). If you cannot find a price from today or the last trading session, use 0. Answer ONLY with JSON: {\"prices\":[{\"symbol\":\"...\",\"price\":0,\"source\":\"site\",\"time\":\"YYYY-MM-DD HH:MM UTC\"}]}";
  const norm = (x: string) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const apply = (p: any) => {
    const c = cands.find((x: any) => norm(x.symbol) === norm(p.symbol)); const px = +p.price;
    if (!c || c.live || !(px > 0)) return;
    if (c.price > 0 && Math.abs(px - c.price) / c.price > 0.25) return; // reject obviously wrong quotes
    if (c.entry > 0) { const shift = px - c.entry; c.entry = +(c.entry + shift).toPrecision(8); c.stop = +(c.stop + shift).toPrecision(8); c.target = +(c.target + shift).toPrecision(8); }
    c.price = px; c.price_note = `Live check: ${px} from ${p.source || "web"} at ${p.time || "today"} (Perplexity). Entry, stop and target moved to this price; distances unchanged.`; c.live = true;
  };
  const ask = async (list: any[]) => { try { const r = await pplx(sys, "Today is " + new Date().toUTCString() + ". Symbols: " + list.map((c: any) => `${c.symbol} (${c.name})`).join(", ")); ((await jfix(r.text)).prices || []).forEach(apply); } catch (_) {} };
  await ask(cands);
  const missing = cands.filter((c: any) => !c.live);
  if (missing.length) await Promise.all(missing.map((c: any) => ask([c]))); // second try, one symbol at a time
  return cands.filter((c: any) => c.live).length;
}

function weekOf() { const d = new Date(); const day = d.getUTCDay(); const add = day === 1 ? 0 : (8 - day) % 7 || 7; const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)); const f = new Date(m.getTime() + 4 * 864e5); return m.toISOString().slice(0, 10) + " to " + f.toISOString().slice(0, 10); }
const MARKETS: Record<string, string> = { fx: "major and minor FX pairs (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, EURGBP, EURJPY, GBPJPY)", metals: "metals (XAUUSD gold, XAGUSD silver, XPTUSD platinum, XPDUSD palladium, COPPER)", energy: "oil and gas (USOIL / WTI, UKOIL / Brent, natural gas)", indices: "major stock indices (US500, NAS100, US30, GER40, UK100, JP225)", stocks: "large US stocks (e.g. AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA)" };
function marketRule(m: string) { return MARKETS[m] ? `ALL 6 candidates must come from this market only: ${MARKETS[m]}. Each candidate must be a DIFFERENT instrument; if this market has fewer than 6 sensible instruments this week, propose fewer rather than repeat one.` : "Instruments must be liquid CFDs a MetaTrader broker offers: major FX pairs, gold/silver, oil, major indices (US500, NAS100, US30, GER40, UK100, JP225), or large US stocks. Spread them across different themes."; }
const PACK_SYS = (bias: string, market = "all") => `You are the market analyst of AMI, the assistant of Hussein Saad (Monrovia, Liberia). He trades CFDs weekly through a MetaTrader broker (OneRoyal): positions open Monday and are closed by Friday.
The trading week is ${weekOf()} (Monday open to Friday close). Use web search to get CURRENT prices and this week's news: central bank decisions, inflation/jobs data, earnings, oil/gold drivers, geopolitics. Today is ${new Date().toUTCString()}.
The Chairman's rule: the WHOLE weekly budget (default $10,000) is invested every week, split across the trades the board approves, so propose 6 genuinely tradeable ideas. Then propose exactly 6 candidate trades for this week. Direction rule: ${bias === "buy" ? "ALL candidates must be BUY (long)." : bias === "short" ? "ALL candidates must be SHORT (sell)." : "choose BUY or SHORT per instrument, whichever the evidence supports."}
${marketRule(market)}
For each: current price (from your search, with the time), entry, stop-loss and target (target at least 1.5x the stop distance), and a 1-2 sentence reason. Never invent a price: if you could not find it, say so in "price_note".
Answer ONLY with JSON: {"week":"YYYY-MM-DD to YYYY-MM-DD","market_brief":"5-8 sentences: what drives markets this week","key_events":["day — event"],"candidates":[{"symbol":"XAUUSD","name":"Gold","theme":"metals","direction":"BUY","price":0,"price_note":"source/time","entry":0,"stop":0,"target":0,"reason":"..."}]}`;
const VOTE_SYS = `You are one of the independent voters (Claude, ChatGPT, Grok, Gemini, Perplexity) on a weekly trade list for Hussein Saad. You do not see the others' votes.
Each trade opens Monday and must close by Friday. The Chairman invests the WHOLE weekly budget every week, split across the trades you approve (stronger approval = bigger share); if every stop is hit the week loses at most $${LOSS_CAP}. Judge each candidate on the evidence, the risk/reward, timing of this week's events, and whether the stop and target are realistic for one week.
Vote YES only if you would put money on it this week. Answer ONLY with JSON: {"votes":[{"symbol":"...","vote":"YES"|"NO","confidence":1-5,"reason":"one sentence"}]}`;

async function runWeek(bias: string, budget: number, startedBy: string, market = "all", pickV: string[] = []) {
  const id = new Date().toISOString();
  const run: any = { id, status: "working", step: "Building the market pack (prices and this week's news)…", bias, budget, market, started_by: startedBy, demo: true };
  await setKey("trade_run", run);
  try {
    const notes = await claude("claude-sonnet-5-5", PACK_SYS(bias, market).replace(/Answer ONLY with JSON:[\s\S]*$/, "Write your research notes in plain text: the week's dates, market brief, key events, and the 6 candidates with price (and source/time), entry, stop, target, theme and reason."), "Do the research and write the notes now.", true, 6000);
    if (notes.trim().length < 300) throw new Error("The market research came back empty, so no trades were proposed. Try again in a minute.");
    run.notes_chars = notes.length; run.step = "Turning the research into 6 candidate trades…"; await setKey("trade_run", run);
    const pack: any = await claudeTool("claude-sonnet-5-5", PACK_SYS(bias, market), "Here are your research notes. Turn them into the answer (up to 6 candidates, each a different instrument; keep every price as found, never invent one):\n\n" + notes, PACK_SCHEMA);
    const cands = (pack.candidates || []).slice(0, 6).map((c: any) => ({ symbol: String(c.symbol || "").toUpperCase().slice(0, 15), name: String(c.name || ""), theme: String(c.theme || "other").toLowerCase(),
      direction: /SHORT|SELL/i.test(c.direction) ? "SHORT" : "BUY", price: +c.price || 0, price_note: String(c.price_note || ""), entry: +c.entry || 0, stop: +c.stop || 0, target: +c.target || 0, reason: String(c.reason || "") }));
    if (!cands.length) throw new Error("No candidate trades came back from the market pack.");
    run.step = "Checking live prices (Perplexity)…"; await setKey("trade_run", run);
    run.live_prices = await livePrices(cands);
    const unpriced = cands.filter((c: any) => !(c.price > 0 && c.entry > 0 && c.stop > 0));
    if (unpriced.length === cands.length) throw new Error("No live prices could be found for any of the proposed trades, so the study stopped before voting. Try again in a few minutes.");
    run.dropped_unpriced = unpriced.map((c: any) => c.symbol);
    for (const c of unpriced) cands.splice(cands.indexOf(c), 1); // vote only on trades with a real price
    run.step = `The board (${pickV.length ? pickV.join(", ") : "Claude, ChatGPT, Grok, Gemini, Perplexity"}) is voting…`; run.voters_chosen = pickV; run.pack = { week: weekOf(), market_brief: pack.market_brief, key_events: pack.key_events || [] }; run.candidates = cands; await setKey("trade_run", run);
    const voteMsg = `MARKET PACK\n${pack.market_brief}\nKey events: ${(pack.key_events || []).join("; ")}\n\nCANDIDATES\n` + cands.map((c: any, i: number) => `${i + 1}. ${c.symbol} (${c.name}, ${c.theme}) ${c.direction} — price ${c.price} (${c.price_note}); entry ${c.entry}, stop ${c.stop}, target ${c.target}. Reason: ${c.reason}`).join("\n");
    const ok = (Deno.env.get("OPENAI_API_KEY") || "").trim(), xk = (Deno.env.get("XAI_API_KEY") || "").trim();
    const allVoters = [
      { name: "Claude", go: async () => ({ model: "claude-opus-5-5", text: JSON.stringify(await claudeTool("claude-opus-5-5", VOTE_SYS, voteMsg, VOTE_SCHEMA, 3000)) }) },
      { name: "ChatGPT", go: async () => { if (!ok) throw new Error("not connected"); const m = await pick("https://api.openai.com/v1", ok, [/^gpt-5\.5$/, /^gpt-5\.\d$/, /^gpt-5$/], "gpt-5"); return { model: m, text: await oai("https://api.openai.com/v1", ok, m, VOTE_SYS, voteMsg, { response_format: { type: "json_object" } }) }; } },
      { name: "Grok", go: async () => { if (!xk) throw new Error("not connected"); const m = await pick("https://api.x.ai/v1", xk, [/^grok-\d+(\.\d+)?$/, /^grok-/], "grok-4"); return { model: m, text: await oai("https://api.x.ai/v1", xk, m, VOTE_SYS, voteMsg, { response_format: { type: "json_object" } }) }; } },
      { name: "Gemini", go: async () => { const gk = await geminiKey(); if (!gk) throw new Error("not connected"); let last: any = null;
        for (const m of ["gemini-4-carbon", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash"]) { try { return { model: m, text: await oai("https://generativelanguage.googleapis.com/v1beta/openai", gk, m, VOTE_SYS, voteMsg, { response_format: { type: "json_object" } }) }; } catch (e) { last = e; if (/503|overload|unavailable|busy|429/i.test(String((e as Error).message)) && m !== "gemini-4-carbon") await new Promise((r) => setTimeout(r, 8000)); } }
        throw last || new Error("no answer"); } },
      { name: "Perplexity", go: async () => await pplx(VOTE_SYS, voteMsg) },
    ];
    const voters = pickV.length >= 2 ? allVoters.filter((v) => pickV.includes(v.name)) : allVoters; // v2.4: Chairman picks the voters (min 2)
    const res = await Promise.allSettled(voters.map((v) => v.go()));
    const members = await Promise.all(res.map(async (r, i) => {
      if (r.status !== "fulfilled") return { name: voters[i].name, ok: false, error: String((r.reason as Error)?.message || r.reason).slice(0, 160) };
      try { const v = (await jfix(r.value.text)).votes || []; return { name: voters[i].name, ok: true, model: r.value.model, votes: v }; } catch (_) { return { name: voters[i].name, ok: false, error: "answer could not be read" }; }
    }));
    // tally + sizing (all arithmetic here, not by the models)
    const rows = cands.map((c: any) => {
      const vs = members.filter((m: any) => m.ok).map((m: any) => { const v = (m.votes || []).find((x: any) => String(x.symbol || "").toUpperCase() === c.symbol) || {}; return { name: m.name, vote: /YES/i.test(v.vote) ? "YES" : "NO", confidence: +v.confidence || 0, reason: String(v.reason || "") }; });
      const yes = vs.filter((v: any) => v.vote === "YES").length, voters = vs.length;
      // board of up to 5: 5 or 4 voting -> 4+ YES full, 3 YES half; 3 voting -> 3 full, 2 half; 2 voting -> both YES half
      // v1.9: approval strength -> weight (full = 2, half = 1); the whole budget is later split by weight across approved trades
      let weight = voters >= 4 ? (yes >= 4 ? 2 : yes === 3 ? 1 : 0) : voters === 3 ? (yes === 3 ? 2 : yes === 2 ? 1 : 0) : (voters === 2 && yes === 2 ? 1 : 0);
      // v2.2 Rule 2: a narrow approval (half share) is skipped when a NO vote names a price level the trade must get through
      const levelNo = vs.find((v: any) => v.vote === "NO" && /\d+\.\d{2,}|\b\d{3,}\b|support|resistance|level|floor|ceiling/i.test(v.reason));
      let ruleSkip = "";
      if (weight === 1 && levelNo) { weight = 0; ruleSkip = `Rule 2: ${levelNo.name} voted NO citing a price level ("${levelNo.reason.slice(0, 120)}")`; }
      const dist = Math.abs(c.entry - c.stop);
      const rr = dist ? Math.round(Math.abs(c.target - c.entry) / dist * 10) / 10 : 0;
      return { ...c, votes: vs, yes, voters, weight, allocation: weight, ...(ruleSkip ? { dropped: ruleSkip } : {}), units_for_150_risk: dist ? Math.round(RISK / dist * 1000) / 1000 : null, reward_risk: rr, conf: vs.reduce((a: number, v: any) => a + (v.vote === "YES" ? v.confidence : 0), 0) };
    });
    // max 2 trades per theme (keep the strongest)
    const byTheme: Record<string, any[]> = {};
    rows.filter((r: any) => r.allocation > 0).sort((a: any, b: any) => b.yes - a.yes || b.conf - a.conf).forEach((r: any) => { (byTheme[r.theme] ||= []).push(r); });
    Object.values(byTheme).forEach((list) => list.slice(2).forEach((r: any) => { r.allocation = 0; r.dropped = "more than 2 trades on this theme"; }));
    // Chairman's rule: the WHOLE budget is invested across the approved trades (by weight); total risk if every stop is hit = the weekly cap
    const chosen = rows.filter((r: any) => r.allocation > 0), W = chosen.reduce((a: number, r: any) => a + r.weight, 0);
    rows.forEach((r: any) => { if (r.allocation > 0) { r.allocation = Math.round(budget * r.weight / W); r.risk = Math.round(LOSS_CAP * r.weight / W); } else r.risk = 0; });
    const done = { ...run, status: "done", step: "", finished: new Date().toISOString(), members: members.map((m: any) => ({ name: m.name, ok: m.ok, model: m.model || "", error: m.error || "" })),
      trades: rows, chosen: chosen.length, allocated: chosen.reduce((a: number, r: any) => a + r.allocation, 0), max_loss: chosen.reduce((a: number, r: any) => a + r.risk, 0), loss_cap: LOSS_CAP,
      rules: `The whole $${budget.toLocaleString("en-US")} is invested across the approved trades: ${members.filter((m: any) => m.ok).length >= 4 ? "4+ YES" : "3/3 YES"} = double share, ${members.filter((m: any) => m.ok).length >= 4 ? "3 YES" : "2/3"} = single share, fewer = skip. Max 2 per theme. Stops are set so that if every stop is hit the week loses $${LOSS_CAP} at most; all closed by Friday.` };
    await setKey("trade_run", done);
    const hist = ((await getKey("trade_weeks")) || []).slice(0, 25);
    await setKey("trade_weeks", [done, ...hist]);
  } catch (e) {
    await setKey("trade_run", { ...run, status: "failed", step: "", error: (e as Error).message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const ik = req.headers.get("x-internal-key") || "";
  if (ik) { const k = (await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: H })).json())?.[0]?.value; if (!k || k !== ik) return json({ error: "Access denied." }, 403); }
  else { const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: ANON } });
    if (!u.ok) return json({ error: "Not signed in." }, 401); if (String((await u.json()).email || "").toLowerCase() !== OWNER) return json({ error: "Access denied." }, 403); }
  // v2.0: kill switch + app lock. The protective "guard" still runs when AMI is switched off.
  {
    const g = await fetch(`${SB}/rest/v1/rpc/ami_gate`, { method: "POST", headers: H, body: JSON.stringify({ p_unlock: String(p.unlock || ""), p_need_unlock: !ik }) });
    const gate = g.ok ? await g.json().catch(() => null) : null;
    if (gate === "killed" && p.action !== "guard") return json({ error: "AMI is switched off by the kill switch.", killed: true }, 423);
    if (!ik && gate !== "ok") return json({ error: "AMI is locked. Unlock with Face ID or the WhatsApp code.", locked: true }, 423);
  }
  if (p.action === "get") return json({ run: await getKey("trade_run"), scorecard: await getKey("trade_scorecard"), history: ((await getKey("trade_weeks")) || []).map((w: any) => ({ id: w.id, week: w.pack?.week, bias: w.bias, market: w.market || "all", chosen: w.chosen, allocated: w.allocated })) });
  if (p.action === "week") { const h = (await getKey("trade_weeks")) || []; return json({ run: h.find((w: any) => w.id === p.id) || null }); }
  if (p.action === "start") {
    { const sr = await fetch(`${SB}/rest/v1/rpc/ami_spend`, { method: "POST", headers: H, body: "{}" }); const sp = sr.ok ? await sr.json().catch(() => null) : null;
      if (sp?.over) return json({ error: `AI spending cap reached (today $${(+sp.today).toFixed(2)} of $${sp.cap_daily}; month $${(+sp.month).toFixed(2)} of $${sp.cap_monthly}). The study can run after the cap resets.` }, 429); }
    const cur = await getKey("trade_run");
    if (cur?.status === "working" && Date.now() - Date.parse(cur.id) < 6 * 60000) return json({ error: "A study is already running — give it a few minutes." }, 409);
    const bias = ["buy", "short", "either"].includes(p.bias) ? p.bias : "either";
    const budget = Math.max(1000, Math.min(1000000, Math.round(+p.budget || 10000)));
    const market = ["all", ...Object.keys(MARKETS)].includes(p.market) ? p.market : "all";
    const VN = ["Claude", "ChatGPT", "Grok", "Gemini", "Perplexity"];
    const pickV = Array.isArray(p.voters) ? [...new Set(p.voters.map(String).filter((n: string) => VN.includes(n)))] as string[] : [];
    if (pickV.length === 1) return json({ error: "Pick at least 2 voters (or none for all 5)." }, 400);
    const job = runWeek(bias, budget, ik ? "AMI" : "Chairman", market, pickV);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
    return json({ started: true });
  }
  if (p.action === "concur") { // Chairman concurs with the board: place the chosen orders
    const h = (await getKey("trade_weeks")) || []; const i = h.findIndex((w: any) => w.id === p.id); if (i < 0) return json({ error: "Study not found." }, 404);
    const w = h[i]; if (!w.chosen) return json({ error: "The board chose no trades this week." }, 400);
    if (w.execution && /placed/.test(w.execution.status)) return json({ error: "Orders for this week were already sent." }, 409);
    if (Date.now() - Date.parse(w.id) > 9 * 864e5) return json({ error: "This study is more than a week old. Run a new one." }, 400);
    // v2.2 Rule 1: orders only on the study's own Monday (UTC)
    { const mon = String(w.pack?.week || "").slice(0, 10), today = new Date().toISOString().slice(0, 10);
      if (mon && today !== mon) return json({ error: today < mon ? `Rule 1: this study is for the week starting Monday ${mon}. Orders can only be sent on that Monday.` : `Rule 1: this study's Monday (${mon}) has passed. Run a new study for this week.` }, 400); }
    // v2.0: no new orders after the Friday close time or at the weekend (they would be closed at once)
    { const n = new Date(), d = n.getUTCDay(); if (d === 6 || d === 0 || (d === 5 && n.getUTCHours() >= FRIDAY_CLOSE_UTC)) return json({ error: "Markets are closing for the weekend. Orders can be sent from Monday." }, 400); }
    // v1.9.1: one-time lock per study (insert fails if it already exists), so a double tap can never send the orders twice
    const lockKey = "trade_lock_" + w.id;
    const lk = await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ key: lockKey, data: { at: new Date().toISOString() }, updated_at: new Date().toISOString() }) });
    if (!lk.ok) return json({ error: "Orders for this study are already being sent or were sent." }, 409);
    const ex = { ...(await placeOrders(w)), concurred_at: new Date().toISOString(), by: ik ? "AMI" : "Chairman" };
    if (!/placed/.test(ex.status)) await fetch(`${SB}/rest/v1/ami_brain?key=eq.${encodeURIComponent(lockKey)}`, { method: "DELETE", headers: H }); // nothing placed: allow Send again
    const h2 = (await getKey("trade_weeks")) || h; const i2 = h2.findIndex((x: any) => x.id === w.id); if (i2 >= 0) h2[i2] = { ...h2[i2], execution: ex }; await setKey("trade_weeks", h2);
    const cur = await getKey("trade_run"); if (cur?.id === w.id) await setKey("trade_run", { ...cur, execution: ex });
    return json({ execution: ex });
  }
  if (p.action === "decline") { const h = (await getKey("trade_weeks")) || []; const i = h.findIndex((w: any) => w.id === p.id); if (i < 0) return json({ error: "Study not found." }, 404);
    const ex = { status: "declined", note: "Chairman chose not to trade this week.", orders: [], concurred_at: new Date().toISOString() }; h[i] = { ...h[i], execution: ex }; await setKey("trade_weeks", h);
    const cur = await getKey("trade_run"); if (cur?.id === p.id) await setKey("trade_run", { ...cur, execution: ex }); return json({ execution: ex }); }
  if (p.action === "broker") { const b = await broker(); return json({ connected: !!b }); }
  // v2.0: Chairman closes one position (position_id) or everything (all: true) from the app
  if (p.action === "close") {
    if (ik) return json({ error: "Only the Chairman can close trades from the app." }, 403);
    const b = await broker(); if (!b) return json({ error: "Broker not connected." }, 400);
    let pos: any[] = []; try { pos = await b.call("/positions"); } catch (e) { return json({ error: "Broker: " + (e as Error).message.slice(0, 150) }, 502); }
    const targets = p.all === true ? pos : pos.filter((x: any) => String(x.id) === String(p.position_id || ""));
    if (!targets.length) return json({ error: p.all ? "No open trades." : "Trade not found (already closed?)." }, 404);
    const out = await closeList(b, targets);
    await logCloses(out, p.all ? "Chairman closed all trades" : "Chairman closed a trade", "Chairman");
    return json({ closed: out, note: `${out.filter((o) => o.status === "closed").length} of ${out.length} closed.` });
  }
  // v2.0: safety guard (cron every 15 min, internal key): weekly loss cap and Friday close, enforced in code
  if (p.action === "guard") {
    if (!ik) return json({ error: "Access denied." }, 403);
    const b = await broker(); if (!b) return json({ ok: true, note: "broker not connected" });
    let ai: any, pos: any[];
    try { [ai, pos] = await Promise.all([b.call("/account-information"), b.call("/positions")]); } catch (e) { return json({ ok: false, error: "Broker: " + (e as Error).message.slice(0, 150) }, 502); }
    // v2.3: score trades the broker closed by itself (stop or target hit) — positions seen last run but gone now
    try {
      const seen: any[] = (await getKey("trade_open_seen")) || [], ids = new Set((pos || []).map((x: any) => String(x.id)));
      const gone = seen.filter((x: any) => !ids.has(String(x.id))), out: any[] = [];
      for (const g of gone) { try { const deals: any[] = await b.call(`/history-deals/position/${encodeURIComponent(g.id)}`);
        const pnl = (deals || []).reduce((a: number, x: any) => a + (+x.profit || 0) + (+x.commission || 0) + (+x.swap || 0), 0);
        out.push({ id: g.id, symbol: g.symbol, status: "closed", pnl: Math.round(pnl * 100) / 100 }); } catch (_) {} }
      if (out.length) await score(out);
      await setKey("trade_open_seen", (pos || []).map((x: any) => ({ id: String(x.id), symbol: String(x.symbol || "").replace(/s$/, "") })));
    } catch (_) {}
    const now = new Date(), week = mondayOf(now);
    let ws: any = await getKey("trade_week_start");
    if (!ws || ws.week !== week) { ws = { week, balance: +ai.balance || 0, at: now.toISOString() }; await setKey("trade_week_start", ws); }
    const weekPnl = Math.round(((+ai.equity || 0) - ws.balance) * 100) / 100;
    const d = now.getUTCDay(), friday = (d === 5 && now.getUTCHours() >= FRIDAY_CLOSE_UTC) || d === 6 || d === 0;
    let why = "";
    if ((pos || []).length && weekPnl <= -LOSS_CAP) why = `Weekly loss cap reached: down $${Math.abs(weekPnl).toFixed(2)} this week (cap $${LOSS_CAP}).`;
    else if ((pos || []).length && friday) why = "Friday close: nothing is held over the weekend.";
    const state = { at: now.toISOString(), week, week_start_balance: ws.balance, equity: +ai.equity, week_pnl: weekPnl, open: (pos || []).length, action: why ? "closing" : "none" };
    await setKey("trade_guard", state);
    if (!why) return json({ ok: true, ...state });
    const out = await closeList(b, pos);
    await logCloses(out, why, "AMI guard");
    const okN = out.filter((o) => o.status === "closed").length;
    await waSelf(`🛡 AMI trading guard — ${why}\n${okN} of ${out.length} trades closed:\n${closeText(out)}${okN < out.length ? "\n⚠️ Some trades did not close — check MetaTrader now." : ""}`);
    return json({ ok: true, ...state, closed: out });
  }
  if (p.action === "account") { // live MetaTrader account + open positions for the app's trading panel
    const b = await broker(); if (!b) return json({ connected: false });
    try { const [ai, pos]: any[] = await Promise.all([b.call("/account-information"), b.call("/positions")]);
      const positions = (pos || []).map((x: any) => { const sell = /SELL/.test(x.type), o = +x.openPrice || 0, c = +x.currentPrice || 0;
        return { id: x.id, symbol: String(x.symbol || "").replace(/s$/, ""), broker_symbol: x.symbol, side: sell ? "SELL" : "BUY", lots: +x.volume || 0, open: o, price: c, stop: +x.stopLoss || 0, target: +x.takeProfit || 0,
          change_pct: o ? Math.round(((c - o) / o) * (sell ? -100 : 100) * 1000) / 1000 : 0, pnl: Math.round(((+x.profit || 0) + (+x.swap || 0) + (+x.commission || 0)) * 100) / 100, opened: x.time, ami: /AMI/.test(String(x.comment || x.brokerComment || "")) }; });
      const guard = await getKey("trade_guard");
      return json({ connected: true, broker: ai.broker, server: ai.server, login: ai.login, demo: /DEMO/.test(String(ai.type)), currency: ai.currency || "USD", balance: ai.balance, equity: ai.equity, free_margin: ai.freeMargin,
        pnl: Math.round(positions.reduce((a: number, x: any) => a + x.pnl, 0) * 100) / 100, week_pnl: guard?.week_pnl ?? null, loss_cap: LOSS_CAP, positions: await withCandles(b, positions) }); }
    catch (e) { return json({ connected: true, error: (e as Error).message.slice(0, 200) }, 502); }
  }
  return json({ error: "Unknown action." }, 400);
});
