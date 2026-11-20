// AMI `panel` v1.5 (20 Nov 2026: SECURITY + SPENDING — kill switch and app-lock unlock check (ami_gate); "ask" stops at the daily/monthly AI spending cap (ami_spend); every member's answer logged in ami_usage with tokens)
// v1.4 (18 Nov 2026: longer time limits; Claude gets room for a full answer; "only" = ask chosen members; "merge_last" = add their votes to the last result)
// v1.3: up to 5 Drive files per question; + Perplexity = 5th seat; + Gemini, majority rule for up to 5 voters — Advisory Panel: a business plan / feasibility study / idea goes to Claude, ChatGPT, Grok, Gemini and Perplexity.
// Each gives its own opinion and vote (GO / CONDITIONAL / NO-GO, score 1-10, pros, cons, risks, conditions). AMI tallies the votes in code.
// Owner only (sign-in token + unlock). Optional Drive file (Doc, Sheet, PDF, Word) is read and added to the plan. Last 20 results kept in ami_brain "panel_history".
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const OWNER = "hnsaad1973@gmail.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

// ---------- usage log (spending caps + Control Room) ----------
const PROVIDER: Record<string, string> = { Claude: "Anthropic", ChatGPT: "OpenAI", Grok: "xAI", Gemini: "Google", Perplexity: "Perplexity" };
let JOB = "";
async function logUse(seat: string, r: any, ms: number, ok: boolean) {
  try { await fetch(`${SB}/rest/v1/ami_usage`, { method: "POST", headers: H, body: JSON.stringify({ source: "panel", seat, provider: PROVIDER[seat] || null, model: r?.model || null, job: JOB || null, tokens_in: r?.tin || 0, tokens_out: r?.tout || 0, ms, ok }) }); } catch (_) {}
}

// ---------- Google Drive (read one file as text) ----------
async function gToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "", grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); return j.access_token as string;
}
async function driveText(id: string): Promise<{ name: string; text: string }> {
  const t = await gToken(), A = { Authorization: "Bearer " + t }, DR = "https://www.googleapis.com/drive/v3";
  const f = await (await fetch(`${DR}/files/${id}?fields=id,name,mimeType`, { headers: A })).json();
  if (!f.id) throw new Error("File not found in Drive");
  const exp = async (fid: string, mime: string) => (await fetch(`${DR}/files/${fid}/export?mimeType=${encodeURIComponent(mime)}`, { headers: A })).text();
  if (f.mimeType === "application/vnd.google-apps.document" || f.mimeType === "application/vnd.google-apps.presentation") return { name: f.name, text: await exp(id, "text/plain") };
  if (f.mimeType === "application/vnd.google-apps.spreadsheet") return { name: f.name, text: await exp(id, "text/csv") };
  if (/^text\//.test(f.mimeType)) return { name: f.name, text: await (await fetch(`${DR}/files/${id}?alt=media`, { headers: A })).text() };
  const toSheet = /spreadsheetml|ms-excel/.test(f.mimeType);
  const c = await (await fetch(`${DR}/files/${id}/copy?fields=id`, { method: "POST", headers: { ...A, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "AMI temp read — " + f.name, mimeType: toSheet ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document" }) })).json();
  if (!c.id) throw new Error("Could not read this kind of file: " + f.mimeType);
  try { return { name: f.name, text: await exp(c.id, toSheet ? "text/csv" : "text/plain") }; }
  finally { await fetch(`${DR}/files/${c.id}`, { method: "PATCH", headers: { ...A, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch(() => null); }
}

// ---------- The question every panel member answers ----------
const SYS = `You are one member of an independent advisory board for Hussein Saad, Chairman of Saad Ventures Group (Monrovia, Liberia; companies in property, construction, insurance, hospitality in Liberia and Sierra Leone, and Lebanon). The other members are other AI models; you do not see their answers. Give YOUR OWN independent opinion.
Judge the plan, study or idea on: market and demand, numbers (revenue, costs, capital, payback — check the arithmetic), risks (country, currency, legal, execution, partners), and what must be true for it to work. Use what you know about Liberia / West Africa where relevant. Never invent figures: if a number is not in the plan, say it is missing or label your own figure "estimate".
Keep each list to at most 6 short items so the whole answer stays compact.
Answer ONLY with JSON, no other text:
{"verdict":"GO" | "CONDITIONAL" | "NO-GO","score":1-10,"summary":"3-4 sentences, plain English","pros":["..."],"cons":["..."],"risks":["..."],"conditions":["what must be done or confirmed before going ahead"],"missing":["key information missing from the plan"]}`;

function parse(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("answer was not complete JSON");
  const j = JSON.parse(t.slice(s, e + 1));
  const arr = (x: any) => (Array.isArray(x) ? x : x ? [String(x)] : []).map((v: any) => String(v).slice(0, 400)).slice(0, 8);
  const v = String(j.verdict || "").toUpperCase().replace(/\s|_/g, "-");
  return { verdict: v.startsWith("NO") ? "NO-GO" : v.startsWith("COND") ? "CONDITIONAL" : v.startsWith("GO") ? "GO" : "CONDITIONAL",
    score: Math.max(1, Math.min(10, Math.round(Number(j.score) || 5))), summary: String(j.summary || "").slice(0, 1200),
    pros: arr(j.pros), cons: arr(j.cons), risks: arr(j.risks), conditions: arr(j.conditions), missing: arr(j.missing) };
}
const withTimeout = (ms: number) => AbortSignal.timeout(ms);
const TL = 330000; // per-member time limit (edge functions may run up to 400 s)

async function askClaude(prompt: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || ""; if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: withTimeout(model === "claude-opus-5-5" ? 220000 : 100000),
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 12000, system: SYS, messages: [{ role: "user", content: prompt }] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || "error " + r.status);
      return { model, tin: Number(j.usage?.input_tokens || 0), tout: Number(j.usage?.output_tokens || 0), ...parse((j.content || []).map((b: any) => b.text || "").join("")) };
    } catch (e) { last = e as Error; }
  }
  throw last || new Error("no answer");
}
async function pickModel(base: string, key: string, prefs: RegExp[]) {
  try {
    const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: withTimeout(10000) });
    const ids: string[] = ((await r.json()).data || []).map((m: any) => m.id);
    for (const p of prefs) { const hit = ids.filter((i) => p.test(i)).sort().reverse()[0]; if (hit) return hit; }
  } catch (_) {}
  return "";
}
async function askOpenAICompatible(base: string, key: string, model: string, prompt: string, extra: any = {}, ms = TL) {
  const r = await fetch(`${base}/chat/completions`, { method: "POST", signal: withTimeout(ms), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }], ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || "error " + r.status);
  return { model, tin: Number(j.usage?.prompt_tokens || 0), tout: Number(j.usage?.completion_tokens || 0), ...parse(String(j.choices?.[0]?.message?.content || "")) };
}
async function askChatGPT(prompt: string) {
  const key = (Deno.env.get("OPENAI_API_KEY") || "").trim(); if (!key) throw new Error("not connected");
  const model = await pickModel("https://api.openai.com/v1", key, [/^gpt-5\.5$/, /^gpt-5\.\d$/, /^gpt-5$/, /^gpt-4\.1$/, /^gpt-4o$/]) || "gpt-5";
  return askOpenAICompatible("https://api.openai.com/v1", key, model, prompt, { response_format: { type: "json_object" } });
}
async function askGrok(prompt: string) {
  const key = (Deno.env.get("XAI_API_KEY") || "").trim(); if (!key) throw new Error("not connected yet — add XAI_API_KEY in Supabase secrets");
  const model = await pickModel("https://api.x.ai/v1", key, [/^grok-\d+(\.\d+)?$/, /^grok-\d+(\.\d+)?-(latest|\d+)$/, /^grok-/]) || "grok-4";
  try { return await askOpenAICompatible("https://api.x.ai/v1", key, model, prompt, {}, 230000); }
  catch (e) { // fall back to a faster Grok model
    const fast = await pickModel("https://api.x.ai/v1", key, [/^grok-.*fast/, /^grok-\d+-mini/]);
    if (!fast || fast === model) throw e;
    return askOpenAICompatible("https://api.x.ai/v1", key, fast, prompt, {}, 120000);
  }
}

// Gemini (Google) via its OpenAI-compatible endpoint. Key: secret GEMINI_API_KEY, else ami_settings "gemini_key" (locked table).
// Tries Gemini 4 Carbon first; if billing is not on (quota 0), the model is unavailable or too slow, falls back to Gemini 3.8 Flash.
async function geminiKey() { const e = (Deno.env.get("GEMINI_API_KEY") || "").trim(); if (e) return e;
  try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.gemini_key&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } }
async function askGemini(prompt: string) {
  const key = await geminiKey(); if (!key) throw new Error("not connected");
  const base = "https://generativelanguage.googleapis.com/v1beta/openai"; let last: Error | null = null;
  for (const [m, ms] of [["gemini-4-carbon", 220000], ["gemini-3.8-flash", 120000]] as [string, number][]) { try { return await askOpenAICompatible(base, key, m, prompt, { response_format: { type: "json_object" } }, ms); } catch (e) { last = e as Error; } }
  throw last || new Error("no answer");
}

// Perplexity (live web search on every answer) via its Agent API. Key: secret PERPLEXITY_API_KEY, else ami_settings "perplexity_key" (locked table).
async function pplxKey() { const e = (Deno.env.get("PERPLEXITY_API_KEY") || "").trim(); if (e) return e;
  try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.perplexity_key&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } }
async function pplx(system: string, user: string): Promise<{ model: string; text: string; tin: number; tout: number }> {
  const key = await pplxKey(); if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const model of ["perplexity/sonar-pro", "perplexity/sonar"]) {
    const r = await fetch("https://api.perplexity.ai/v1/agent", { method: "POST", signal: AbortSignal.timeout(170000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: system + "\nCheck current facts and prices with web search. Answer ONLY with the JSON, no citation markers inside it.", input: user, tools: [{ type: "web_search" }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { last = new Error(j?.error?.message || "error " + r.status); continue; }
    const text = (j.output || []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("") || String(j.output_text || "");
    if (text) return { model, text: text.replace(/\[\d+\]/g, ""), tin: Number(j.usage?.input_tokens || j.usage?.prompt_tokens || 0), tout: Number(j.usage?.output_tokens || j.usage?.completion_tokens || 0) };
    last = new Error("empty answer");
  }
  throw last || new Error("no answer");
}
async function askPerplexity(prompt: string) { const r = await pplx(SYS, prompt); return { model: r.model, tin: r.tin, tout: r.tout, ...parse(r.text) }; }

// each member call is timed and logged; token counts are not kept in the saved result
function logged(name: string, fn: (q: string) => Promise<any>) {
  return async (q: string) => {
    const t = Date.now();
    try { const r = await fn(q); await logUse(name, r, Date.now() - t, true); const { tin: _a, tout: _b, ...rest } = r; return rest; }
    catch (e) { if (!/not connected/.test(String((e as Error).message))) await logUse(name, null, Date.now() - t, false); throw e; }
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const ik = req.headers.get("x-internal-key") || "";
  if (ik) { // AMI's own internal calls (key kept in the locked ami_settings table)
    const k = (await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: H })).json())?.[0]?.value;
    if (!k || k !== ik) return json({ error: "Access denied." }, 403);
  } else {
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: ANON } });
    if (!u.ok) return json({ error: "Not signed in." }, 401);
    if (String((await u.json()).email || "").toLowerCase() !== OWNER) return json({ error: "Access denied." }, 403);
  }
  // v1.5: kill switch + app lock
  {
    const g = await fetch(`${SB}/rest/v1/rpc/ami_gate`, { method: "POST", headers: H, body: JSON.stringify({ p_unlock: String(p.unlock || ""), p_need_unlock: !ik }) });
    const gate = g.ok ? await g.json().catch(() => null) : null;
    if (gate === "killed") return json({ error: "AMI is switched off by the kill switch.", killed: true }, 423);
    if (!ik && gate !== "ok") return json({ error: "AMI is locked. Unlock with Face ID or the WhatsApp code.", locked: true }, 423);
  }

  if (p.action === "history") { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.panel_history&select=data`, { headers: H }); return json({ history: (r.ok ? (await r.json())[0]?.data : null) || [] }); }
  if (p.action === "status") return json({ claude: !!Deno.env.get("ANTHROPIC_API_KEY"), chatgpt: !!Deno.env.get("OPENAI_API_KEY"), grok: !!Deno.env.get("XAI_API_KEY"), gemini: !!(await geminiKey()), perplexity: !!(await pplxKey()) });

  // action "ask" — v1.5: stop at the spending cap
  { const sr = await fetch(`${SB}/rest/v1/rpc/ami_spend`, { method: "POST", headers: H, body: "{}" }); const sp = sr.ok ? await sr.json().catch(() => null) : null;
    if (sp?.over) return json({ error: `AI spending cap reached (today $${(+sp.today).toFixed(2)} of $${sp.cap_daily}; month $${(+sp.month).toFixed(2)} of $${sp.cap_monthly}). The panel can sit again after the cap resets.`, capped: true }, 429); }
  let text = String(p.text || "").slice(0, 60000), file = "";
  const ids = [...new Set([...(Array.isArray(p.file_ids) ? p.file_ids : []), ...(p.file_id ? [p.file_id] : [])].map(String))].slice(0, 5);
  if (ids.length) { const per = Math.floor(120000 / ids.length), names: string[] = [];
    for (const fid of ids) { try { const d = await driveText(fid); names.push(d.name); text += `\n\n=== DOCUMENT: ${d.name} ===\n` + d.text.slice(0, per); } catch (e) { return json({ error: "Couldn't read a Drive file: " + (e as Error).message }, 400); } }
    file = names.join(" + "); }
  if (text.trim().length < 20) return json({ error: "Give me the plan, study or idea (at least a few lines), or pick a file." }, 400);
  const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. Give your opinion on this:\n\n${text}`;
  JOB = "panel: " + String(p.title || file || text.trim().split("\n")[0]).slice(0, 80);

  const all: Record<string, (q: string) => Promise<any>> = { Claude: logged("Claude", askClaude), ChatGPT: logged("ChatGPT", askChatGPT), Grok: logged("Grok", askGrok), Gemini: logged("Gemini", askGemini), Perplexity: logged("Perplexity", askPerplexity) };
  const order = Object.keys(all);
  const want = Array.isArray(p.only) && p.only.length ? order.filter((n) => p.only.map((x: any) => String(x).toLowerCase()).includes(n.toLowerCase())) : order;
  const runs = await Promise.allSettled(want.map((n) => all[n](prompt)));
  let members: any[] = runs.map((r, i) => r.status === "fulfilled" ? { name: want[i], ok: true, ...r.value } : { name: want[i], ok: false, error: String((r.reason as Error)?.message || r.reason).slice(0, 200) });

  // merge_last: keep the earlier answers of members not asked again, and replace the last result instead of adding a new one
  let prevHist: any[] | null = null;
  if (p.merge_last) {
    const r0 = await fetch(`${SB}/rest/v1/ami_brain?key=eq.panel_history&select=data`, { headers: H });
    prevHist = (r0.ok ? (await r0.json())[0]?.data : null) || [];
    const last = prevHist![0];
    if (last?.members) {
      const byName: any = {}; for (const m of last.members) byName[m.name] = m;
      for (const m of members) if (m.ok || !byName[m.name]?.ok) byName[m.name] = m;
      members = order.filter((n) => byName[n]).map((n) => byName[n]);
    }
  }

  const voted = members.filter((m: any) => m.ok) as any[];
  const count = (v: string) => voted.filter((m) => m.verdict === v).length;
  const tally = { GO: count("GO"), CONDITIONAL: count("CONDITIONAL"), "NO-GO": count("NO-GO"), voters: voted.length };
  // Panel decision (board of up to 5): GO and CONDITIONAL both count as "yes"; needs a majority of those who voted
  const yes = tally.GO + tally.CONDITIONAL, need = Math.floor(voted.length / 2) + 1;
  const decision = voted.length < 2 ? "NOT ENOUGH VOTES" : yes >= need ? (tally.GO >= need ? "GO" : "GO WITH CONDITIONS") : "NO-GO";
  const avg = voted.length ? Math.round(voted.reduce((a, m) => a + m.score, 0) / voted.length * 10) / 10 : 0;
  const title = String(p.title || prevHist?.[0]?.title || file || text.trim().split("\n")[0]).slice(0, 90);
  const result = { title, file: file || prevHist?.[0]?.file || "", at: new Date().toISOString(), decision, tally, avg_score: avg, members };
  try {
    let hist: any[];
    if (prevHist) hist = prevHist.slice(1, 20);
    else { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.panel_history&select=data`, { headers: H }); hist = ((r.ok ? (await r.json())[0]?.data : null) || []).slice(0, 19); }
    await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "panel_history", data: [result, ...hist], updated_at: new Date().toISOString() }) });
  } catch (_) {}
  return json(result);
});
