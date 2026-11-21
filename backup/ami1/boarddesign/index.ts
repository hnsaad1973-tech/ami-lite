// AMI `boarddesign` v1.4 (20 Nov 2026: board of 10 — 9 voting + Devil's Advocate (non-voting). New seats: Chief Actuary (OpenAI reasoning model), QS/MEP Engineer (Mistral), Group Financial Controller (Qwen), General Counsel LR/SL (Cohere), Devil's Advocate (DeepSeek). Seats without a key are reported 'not connected') — v1.3 (20 Nov 2026: mode "custom" = caller gives the brief and JSON shape in `sys`; answer saved as returned) — v1.2 (20 Nov 2026: mode "vote" = each member votes yes/no on numbered proposals with a short reason) — v1.1 (20 Nov 2026: mode "access" = each member designs who sees and does what, by department) — v1.0 (20 Nov 2026) — the AI board (Claude, ChatGPT, Grok, Gemini, Perplexity) each designs a business process.
// Each member returns its own structure: short brief, steps (who / what / output / time), decision points and controls.
// AMI draws each member's flow on one page. Internal key only. Runs in the background; result saved in ami_brain "board_design_<id>".
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const setting = async (k: string) => { try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.${k}&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } };

const SYS = `You are one member of an independent advisory board for Hussein Saad, Chairman of Saad Ventures Group (Monrovia, Liberia). The other members are other AI models; you do not see their answers. Design the process YOUR way.
Keep it practical for a small Liberian insurer with a few staff. It must fit on ONE printed page: at most 10 steps, short words.
Answer ONLY with JSON, no other text:
{"title":"short name for your design","brief":"what your design does and why, max 80 words","actors":["the roles in order of appearance, e.g. Client, Sales, Underwriting, General Manager, Board, Accounts, System"],
"steps":[{"n":1,"who":"one of the actors","action":"max 12 words","output":"max 8 words","time":"time limit, e.g. same day / 24 h"}],
"decisions":[{"after_step":3,"question":"max 10 words","yes":"go to step n or result","no":"go to step n or result"}],
"statuses":["the policy statuses the system should show, in order"],
"controls":["max 6 key controls, each max 14 words"],
"risk_note":"the one thing most likely to go wrong, max 25 words"}`;

const SYS_ACCESS = `You are one member of an independent advisory board for Hussein Saad, Chairman of Saad Ventures Group (Monrovia, Liberia). The other members are other AI models; you do not see their answers. Design the access YOUR way.
Keep it practical for a small Liberian insurer with a few staff, and keep segregation of duties (nobody approves their own work; who handles money does not approve policies). It must fit on ONE printed page.
Answer ONLY with JSON, no other text:
{"title":"short name for your design","brief":"your access principle, max 70 words",
"departments":[{"name":"department or role","tabs":["the screens / sections (placeholders) this role should have, max 8, 1-4 words each"],"can":["what they can do, max 5, each max 10 words"],"cannot":["what they must NOT see or do, max 4, each max 10 words"]}],
"segregation":["max 5 key separation-of-duties rules, each max 14 words"],
"risk_note":"the biggest access risk, max 25 words"}`;

function parseAccess(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("answer was not complete JSON");
  const j = JSON.parse(t.slice(s, e + 1));
  const arr = (x: any) => (Array.isArray(x) ? x : x ? [x] : []);
  const strs = (x: any, n: number, l: number) => arr(x).map((v: any) => String(v).slice(0, l)).slice(0, n);
  return { title: String(j.title || "").slice(0, 80), brief: String(j.brief || "").slice(0, 600),
    departments: arr(j.departments).slice(0, 9).map((d: any) => ({ name: String(d.name || "").slice(0, 40), tabs: strs(d.tabs, 8, 40), can: strs(d.can, 5, 90), cannot: strs(d.cannot, 4, 90) })),
    segregation: strs(j.segregation, 5, 160), risk_note: String(j.risk_note || "").slice(0, 250) };
}
const SYS_VOTE = `You are one member of an independent advisory board for Hussein Saad, Chairman of Saad Ventures Group (Monrovia, Liberia). The other members are other AI models; you do not see their votes. Vote YOUR way on each numbered proposal, judging what is best for a small Liberian insurer with a few staff (control, fraud risk, speed, practicality).
Answer ONLY with JSON, no other text:
{"votes":[{"item":1,"vote":"yes or no","reason":"max 25 words"}],"note":"anything the Chairman should know, max 30 words"}`;
function parseVote(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("answer was not complete JSON");
  const j = JSON.parse(t.slice(s, e + 1));
  const v = (Array.isArray(j.votes) ? j.votes : []).slice(0, 12).map((x: any) => ({ item: Number(x.item) || 0, vote: /^y/i.test(String(x.vote || "")) ? "yes" : "no", reason: String(x.reason || "").slice(0, 220) }));
  if (!v.length) throw new Error("no votes in answer");
  return { votes: v, note: String(j.note || "").slice(0, 260) };
}
const BOARD = "You are one member of an independent advisory board for Hussein Saad, Chairman of Saad Ventures Group (Monrovia, Liberia). The other members are other AI models; you do not see their answers. Answer YOUR way.\n";
function parseCustom(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("answer was not complete JSON");
  return { answer: JSON.parse(t.slice(s, e + 1)) };
}
let MODE = "flow", CUSTOM = "";
const sysNow = () => (MODE === "access" ? SYS_ACCESS : MODE === "vote" ? SYS_VOTE : MODE === "custom" ? BOARD + CUSTOM + "\nAnswer ONLY with JSON, no other text." : SYS);
const parseNow = (t: string) => (MODE === "access" ? parseAccess(t) : MODE === "vote" ? parseVote(t) : MODE === "custom" ? parseCustom(t) : parse(t));

function parse(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("answer was not complete JSON");
  const j = JSON.parse(t.slice(s, e + 1));
  const arr = (x: any) => (Array.isArray(x) ? x : x ? [x] : []);
  return {
    title: String(j.title || "").slice(0, 80), brief: String(j.brief || "").slice(0, 700),
    actors: arr(j.actors).map((x: any) => String(x).slice(0, 30)).slice(0, 8),
    steps: arr(j.steps).slice(0, 12).map((x: any, i: number) => ({ n: Number(x.n) || i + 1, who: String(x.who || "").slice(0, 30), action: String(x.action || "").slice(0, 120), output: String(x.output || "").slice(0, 80), time: String(x.time || "").slice(0, 30) })),
    decisions: arr(j.decisions).slice(0, 6).map((x: any) => ({ after_step: Number(x.after_step) || 0, question: String(x.question || "").slice(0, 100), yes: String(x.yes || "").slice(0, 60), no: String(x.no || "").slice(0, 60) })),
    statuses: arr(j.statuses).map((x: any) => String(x).slice(0, 40)).slice(0, 10),
    controls: arr(j.controls).map((x: any) => String(x).slice(0, 160)).slice(0, 6),
    risk_note: String(j.risk_note || "").slice(0, 250),
  };
}
const TO = (ms: number) => AbortSignal.timeout(ms);

async function askClaude(prompt: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || ""; if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: TO(200000), headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 6000, system: sysNow(), messages: [{ role: "user", content: prompt }] }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || "error " + r.status);
      return { model, ...parseNow((j.content || []).map((b: any) => b.text || "").join("")) };
    } catch (e) { last = e as Error; }
  }
  throw last || new Error("no answer");
}
async function pickModel(base: string, key: string, prefs: RegExp[]) {
  try { const ids: string[] = ((await (await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: TO(10000) })).json()).data || []).map((m: any) => m.id);
    for (const p of prefs) { const hit = ids.filter((i) => p.test(i)).sort().reverse()[0]; if (hit) return hit; } } catch (_) {}
  return "";
}
async function oai(base: string, key: string, model: string, prompt: string, extra: any = {}, ms = 200000) {
  const r = await fetch(`${base}/chat/completions`, { method: "POST", signal: TO(ms), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: sysNow() }, { role: "user", content: prompt }], ...extra }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || "error " + r.status);
  return { model, ...parseNow(String(j.choices?.[0]?.message?.content || "")) };
}
async function askChatGPT(p: string) { const key = (Deno.env.get("OPENAI_API_KEY") || "").trim(); if (!key) throw new Error("not connected");
  const m = await pickModel("https://api.openai.com/v1", key, [/^gpt-5\.5$/, /^gpt-5\.\d$/, /^gpt-5$/, /^gpt-4\.1$/]) || "gpt-5";
  return oai("https://api.openai.com/v1", key, m, p, { response_format: { type: "json_object" } }); }
async function askGrok(p: string) { const key = (Deno.env.get("XAI_API_KEY") || "").trim(); if (!key) throw new Error("not connected");
  const m = await pickModel("https://api.x.ai/v1", key, [/^grok-\d+(\.\d+)?$/, /^grok-\d+(\.\d+)?-(latest|\d+)$/, /^grok-/]) || "grok-4";
  try { return await oai("https://api.x.ai/v1", key, m, p); }
  catch (e) { const f = await pickModel("https://api.x.ai/v1", key, [/^grok-.*fast/, /^grok-\d+-mini/]); if (!f || f === m) throw e; return oai("https://api.x.ai/v1", key, f, p, {}, 120000); } }
async function askGemini(p: string) { const key = (Deno.env.get("GEMINI_API_KEY") || "").trim() || await setting("gemini_key"); if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const [m, ms] of [["gemini-4-carbon", 200000], ["gemini-3.8-flash", 120000]] as [string, number][]) { try { return await oai("https://generativelanguage.googleapis.com/v1beta/openai", key, m, p, { response_format: { type: "json_object" } }, ms); } catch (e) { last = e as Error; } }
  throw last || new Error("no answer"); }
async function askPerplexity(p: string) { const key = (Deno.env.get("PERPLEXITY_API_KEY") || "").trim() || await setting("perplexity_key"); if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const model of ["perplexity/sonar-pro", "perplexity/sonar"]) {
    const r = await fetch("https://api.perplexity.ai/v1/agent", { method: "POST", signal: TO(170000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: sysNow() + "\nAnswer ONLY with the JSON, no citation markers inside it.", input: p, tools: [{ type: "web_search" }] }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { last = new Error(j?.error?.message || "error " + r.status); continue; }
    const text = (j.output || []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("") || String(j.output_text || "");
    if (text) return { model, ...parseNow(text.replace(/\[\d+\]/g, "")) }; last = new Error("empty answer");
  }
  throw last || new Error("no answer"); }

// Specialist seats: same task, plus a role line. Keys from Edge Function secrets or ami_settings.
const ROLE: Record<string, string> = {
  "Chief Actuary": "Your seat: CHIEF ACTUARY. Judge everything through reserves, pricing adequacy, loss ratios, solvency, reinsurance and capital. Give figures and formulas where you can.",
  "QS / MEP Engineer": "Your seat: QUANTITY SURVEYOR and MEP ENGINEER. Judge everything through quantities, cost, BOQs, HVAC/VRV and building services, tender compliance and construction risk. Give figures where you can.",
  "Financial Controller": "Your seat: GROUP FINANCIAL CONTROLLER and MODELLER. Judge everything through cash flow, IFRS, consolidation, budgets, returns (NPV/IRR) and controls. Give figures where you can.",
  "General Counsel": "Your seat: GENERAL COUNSEL for Liberia and Sierra Leone. Judge everything through contracts, leases, regulation (CBL, Sierra Leone), liability and compliance. Flag where a licensed local lawyer must sign.",
  "Devil's Advocate": "Your seat: DEVIL'S ADVOCATE (non-voting). Your job is to argue AGAINST the proposal: find the weakest assumption, the worst plausible case, hidden costs, FX/liquidity/counterparty and regulatory traps. Be specific and quantify. You cannot veto; the Chairman decides. If asked to vote, still answer in the JSON shape, voting 'no' where the case against is strong and giving the case against as the reason.",
};
async function oaiKey(_name: string, envKey: string, setKey: string) { const k = (Deno.env.get(envKey) || "").trim() || await setting(setKey); if (!k) throw new Error("not connected — add " + envKey); return k; }
async function seatCall(seat: string, base: string, key: string, prefs: RegExp[], fallback: string, p: string, extra: any = {}) {
  const m = await pickModel(base, key, prefs) || fallback;
  const sys = ROLE[seat] + "\n" + sysNow();
  const r = await fetch(`${base}/chat/completions`, { method: "POST", signal: TO(200000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m, messages: [{ role: "system", content: sys }, { role: "user", content: p }], ...extra }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || j?.message || "error " + r.status);
  return { model: m, seat, ...parseNow(String(j.choices?.[0]?.message?.content || "")) };
}
async function askActuary(p: string) { const k = (Deno.env.get("OPENAI_API_KEY") || "").trim(); if (!k) throw new Error("not connected");
  return seatCall("Chief Actuary", "https://api.openai.com/v1", k, [/^o\d+$/, /^o\d+-pro$/, /^gpt-5\.5$/], "o3", p); }
async function askQS(p: string) { return seatCall("QS / MEP Engineer", "https://api.mistral.ai/v1", await oaiKey("Mistral", "MISTRAL_API_KEY", "mistral_key"), [/^mistral-large-latest$/, /^mistral-large/], "mistral-large-latest", p, { response_format: { type: "json_object" } }); }
async function askController(p: string) { return seatCall("Financial Controller", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", await oaiKey("Qwen", "QWEN_API_KEY", "qwen_key"), [/^qwen3?-max$/, /^qwen-max/, /^qwen-plus$/], "qwen-max", p, { response_format: { type: "json_object" } }); }
async function askCounsel(p: string) { return seatCall("General Counsel", "https://api.cohere.ai/compatibility/v1", await oaiKey("Cohere", "COHERE_API_KEY", "cohere_key"), [/^command-a-\d/, /^command-r-plus/], "command-a-03-2025", p); }
async function askDevil(p: string) { return seatCall("Devil's Advocate", "https://api.deepseek.com/v1", await oaiKey("DeepSeek", "DEEPSEEK_API_KEY", "deepseek_key"), [/^deepseek-reasoner$/], "deepseek-reasoner", p); }

const ALL: Record<string, (q: string) => Promise<any>> = { Claude: askClaude, ChatGPT: askChatGPT, Grok: askGrok, Gemini: askGemini, Perplexity: askPerplexity,
  "Chief Actuary": askActuary, "QS / MEP Engineer": askQS, "Financial Controller": askController, "General Counsel": askCounsel, "Devil's Advocate": askDevil };
const NON_VOTING = new Set(["Devil's Advocate"]);

Deno.serve(async (req) => {
  const ik = req.headers.get("x-internal-key") || "";
  if (!ik || ik !== await setting("wake_key")) return json({ error: "denied" }, 403);
  const p = await req.json().catch(() => ({}));
  if (p.action === "get") { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.board_design_${encodeURIComponent(p.id)}&select=data`, { headers: H }); return json((await r.json())?.[0]?.data || { pending: true }); }
  const text = String(p.text || "").slice(0, 30000); if (text.length < 20) return json({ error: "text required" }, 400);
  const id = String(p.id || Date.now());
  MODE = ["access", "vote", "custom"].includes(p.mode) ? p.mode : "flow";
  CUSTOM = String(p.sys || "").slice(0, 6000);
  if (MODE === "custom" && CUSTOM.length < 20) return json({ error: "sys required for custom mode" }, 400);
  const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. ${MODE === "access" ? "Design the access by department for this:" : MODE === "vote" ? "Vote yes or no on each numbered proposal:" : MODE === "custom" ? "Task:" : "Design this process:"}\n\n${text}`;
  const work = (async () => {
    const names = Object.keys(ALL);
    const runs = await Promise.allSettled(names.map((n) => ALL[n](prompt)));
    const members = runs.map((r, i) => ({ voting: !NON_VOTING.has(names[i]), ...(r.status === "fulfilled" ? { name: names[i], ok: true, ...r.value } : { name: names[i], ok: false, error: String((r.reason as Error)?.message || r.reason).slice(0, 200) }) }));
    let tally: any = undefined;
    if (MODE === "vote") { // count only voting members that answered
      tally = {};
      for (const m of members as any[]) if (m.ok && m.voting) for (const v of m.votes || []) { const t = tally[v.item] ||= { yes: 0, no: 0 }; t[v.vote === "yes" ? "yes" : "no"]++; }
    }
    await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: `board_design_${id}`, data: { id, mode: MODE, title: p.title || "", at: new Date().toISOString(), members, tally, voting_seats: names.length - NON_VOTING.size }, updated_at: new Date().toISOString() }) });
  })();
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
  return json({ started: true, id });
});
