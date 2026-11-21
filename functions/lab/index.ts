// AMI `lab` v1.8 (21 Nov 2026: Mistral answers with thinking parts now read correctly) - v1.7 (21 Nov 2026: Gemini retries — 3 models, 10 s wait on busy errors) - v1.6 (21 Nov 2026: long reports no longer cut off — the lead editor continues past its length limit, up to 4 parts) - v1.5 (21 Nov 2026: QS / MEP seat - Claude sits in until a working Mistral key is added) - v1.4 (21 Nov 2026: CHAIRMAN - only providers we trust: Financial Controller is now Meta Llama via Together AI (US), with Claude Opus sitting in until that key is added; Devil's Advocate is now Grok (xAI) for good; Qwen and DeepSeek removed; Financial Controller moved to the standard tier, so it sees the file on normal jobs) - v1.3 (20 Nov 2026: SECURITY + SPENDING — kill switch and app-lock unlock check (ami_gate) on app calls; "start" refused at the daily/monthly AI spending cap; a running job pauses before its next stage if the kill switch is on or the cap is reached)
// v1.2 (20 Nov 2026: every AI call logged to ami_usage — tokens, time, seat, job — for the Control Room cost meter) — v1.1 (20 Nov 2026: opened to the Chairman's AMI 1 sign-in; board VOTE stage after final (9 voting seats, Devil's Advocate excluded); WhatsApp when done; job index for 'Past Lab jobs') — v1.0 (20 Nov 2026) — the AMI Lab: the Chairman sends a job (brief + Drive files); the 10-seat board works on it together.
// Stages (each runs in the background and starts the next): read -> plan -> work -> merge -> critique -> final.
//   read     : Drive files to text (Google Docs/Sheets exported; PDFs and images read by Claude vision).
//   plan     : lead editor (Claude) splits the job into one task per seat + writes an anonymised general question.
//   work     : seats work in parallel on their task.
//   merge    : lead editor merges the parts into one document + an anonymised summary.
//   critique : Devil's Advocate attacks the draft (gets only the anonymised summary — general-only seat).
//   final    : lead editor fixes what was flagged and writes the cover sheet; saved to Drive.
//   vote     : the 9 voting seats each vote yes/no with a score and reason (seats that may not see the file vote on the anonymised summary); WhatsApp to the Chairman.
// TRUST (Chairman, 20 Nov 2026): sensitive jobs -> full file only to the original 5 + General Counsel; every other seat gets
// only the anonymised general question. Normal jobs -> Mistral, the Actuary and the Financial Controller also get the file. The Devil's Advocate only ever gets the anonymised summary.
// Internal key only. Status: {action:"get", id}.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const setting = async (k: string) => { try { return String((await (await fetch(`${SB}/rest/v1/ami_settings?key=eq.${k}&select=value`, { headers: H })).json())?.[0]?.value || "").trim(); } catch (_) { return ""; } };
const TO = (ms: number) => AbortSignal.timeout(ms);
const env = (k: string) => (Deno.env.get(k) || "").trim();
const OWNER = "hnsaad1973@gmail.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- v1.3: kill switch, app lock, spending cap ----------
async function gate(unlock: string, needUnlock: boolean) {
  try { const g = await fetch(`${SB}/rest/v1/rpc/ami_gate`, { method: "POST", headers: H, body: JSON.stringify({ p_unlock: unlock, p_need_unlock: needUnlock }) });
    return g.ok ? String(await g.json().catch(() => "")) : ""; } catch (_) { return ""; }
}
async function spend() {
  try { const sr = await fetch(`${SB}/rest/v1/rpc/ami_spend`, { method: "POST", headers: H, body: "{}" }); return sr.ok ? await sr.json().catch(() => null) : null; } catch (_) { return null; }
}
const capMsg = (sp: any) => `AI spending cap reached (today $${(+sp.today).toFixed(2)} of $${sp.cap_daily}; month $${(+sp.month).toFixed(2)} of $${sp.cap_monthly})`;

// ---------- job record ----------
async function load(id: string) { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.lab_${encodeURIComponent(id)}&select=data`, { headers: H }); return (await r.json())?.[0]?.data || null; }
async function save(job: any) {
  job.updated = new Date().toISOString();
  await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `lab_${job.id}`, data: job, updated_at: job.updated }) });
  try { // short index of the last 40 jobs for "Past Lab jobs"
    const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.lab_index&select=data`, { headers: H });
    const idx: any[] = ((await r.json())?.[0]?.data || []).filter((x: any) => x.id !== job.id);
    idx.unshift({ id: job.id, title: job.title, level: job.level, stage: job.stage, at: job.created, link: job.drive?.link || null, verdict: job.verdict || null });
    await fetch(`${SB}/rest/v1/ami_brain`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "lab_index", data: idx.slice(0, 40), updated_at: job.updated }) });
  } catch (_) {}
}
async function whatsapp(text: string) {
  try { const key = await setting("wake_key");
    await fetch(`${SB}/functions/v1/amisend`, { method: "POST", signal: TO(30000), headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify({ action: "notify", text }) }); } catch (_) {}
}
async function next(id: string, stage: string) {
  const key = await setting("wake_key");
  await fetch(`${SB}/functions/v1/lab`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify({ action: "stage", id, stage }) });
}
async function drive(body: any) {
  const key = await setting("wake_key");
  const r = await fetch(`${SB}/functions/v1/drivefile`, { method: "POST", signal: TO(140000), headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ error: "drivefile " + r.status }));
}

// ---------- seats ----------
type Seat = { name: string; tier: "inner" | "standard" | "general"; voting: boolean; role: string };
const SEATS: Seat[] = [
  { name: "Claude", tier: "inner", voting: true, role: "General board member and LEAD EDITOR." },
  { name: "ChatGPT", tier: "inner", voting: true, role: "General board member: structure, completeness and clear writing." },
  { name: "Grok", tier: "inner", voting: true, role: "General board member: blunt practical judgement, what will actually happen on the ground." },
  { name: "Gemini", tier: "inner", voting: true, role: "General board member: data, tables, cross-checking figures." },
  { name: "Perplexity", tier: "inner", voting: true, role: "General board member: current facts and market/regulatory research from the web, with sources." },
  { name: "General Counsel", tier: "inner", voting: true, role: "GENERAL COUNSEL for Liberia and Sierra Leone: contracts, leases, regulation (CBL, Sierra Leone), liability. Flag where a licensed local lawyer must sign." },
  { name: "Chief Actuary", tier: "standard", voting: true, role: "CHIEF ACTUARY: reserves, pricing adequacy, loss ratios, solvency, reinsurance, capital. Give figures and formulas." },
  { name: "QS / MEP Engineer", tier: "standard", voting: true, role: "QUANTITY SURVEYOR and MEP ENGINEER: quantities, BOQs, rates, HVAC/VRV and building services, tender compliance, construction risk. Give figures." },
  { name: "Financial Controller", tier: "standard", voting: true, role: "GROUP FINANCIAL CONTROLLER and MODELLER: cash flow, IFRS, budgets, NPV/IRR, controls. Give figures." },
  { name: "Devil's Advocate", tier: "general", voting: false, role: "DEVIL'S ADVOCATE (non-voting): argue AGAINST; weakest assumption, worst case, hidden costs, FX/liquidity/counterparty and regulatory traps. Quantify." },
];
const seat = (n: string) => SEATS.find((s) => s.name === n)!;
const getsFile = (s: Seat, level: string) => s.tier === "inner" || (s.tier === "standard" && level !== "sensitive");

async function pickModel(base: string, key: string, prefs: RegExp[]) {
  try { const ids: string[] = ((await (await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: TO(10000) })).json()).data || []).map((m: any) => m.id);
    for (const p of prefs) { const hit = ids.filter((i) => p.test(i)).sort().reverse()[0]; if (hit) return hit; } } catch (_) {}
  return "";
}
async function oaiText(base: string, key: string, model: string, sys: string, user: string, ms = 200000) {
  const r = await fetch(`${base}/chat/completions`, { method: "POST", signal: TO(ms), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || j?.message || "error " + r.status);
  // v1.8: some models (Mistral's newest) return content as a list of parts incl. "thinking" — keep only the answer text
  const c = j.choices?.[0]?.message?.content;
  const text = Array.isArray(c) ? c.filter((x: any) => x && x.type !== "thinking").map((x: any) => typeof x === "string" ? x : (x.text || "")).join("") : String(c || "");
  return { model, text, tin: Number(j.usage?.prompt_tokens || 0), tout: Number(j.usage?.completion_tokens || 0) };
}
async function claude(sys: string, user: string, max = 16000) {
  const key = env("ANTHROPIC_API_KEY"); if (!key) throw new Error("not connected");
  let last: Error | null = null;
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
    try {
      // v1.6: long answers no longer get cut off — if the model stops at its length limit, ask it to continue (up to 3 times) and join the parts
      const msgs: any[] = [{ role: "user", content: user }]; let text = "", tin = 0, tout = 0;
      for (let round = 0; round < 4; round++) {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: TO(280000), headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: max, system: sys, messages: msgs }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || "error " + r.status);
        const part = (j.content || []).map((b: any) => b.text || "").join("");
        text += part; tin += Number(j.usage?.input_tokens || 0); tout += Number(j.usage?.output_tokens || 0);
        if (j.stop_reason !== "max_tokens") break;
        msgs.push({ role: "assistant", content: part }, { role: "user", content: "You stopped at the length limit. Continue EXACTLY where you stopped — no repetition, no preamble." });
      }
      return { model, text, tin, tout };
    } catch (e) { last = e as Error; }
  }
  throw last || new Error("no answer");
}
// ---------- usage log (Control Room) ----------
let JOB_ID = "";
const PROVIDER: Record<string, string> = { Claude: "Anthropic", "Lead editor": "Anthropic", ChatGPT: "OpenAI", "Chief Actuary": "OpenAI", Grok: "xAI", Gemini: "Google", Perplexity: "Perplexity",
  "General Counsel": "Cohere", "QS / MEP Engineer": "Mistral", "Financial Controller": "Together (Meta Llama)", "Devil's Advocate": "xAI" };
async function logUse(seatName: string, r: any, ms: number, ok: boolean) {
  try { await fetch(`${SB}/rest/v1/ami_usage`, { method: "POST", headers: H, body: JSON.stringify({ source: "lab", seat: seatName, provider: PROVIDER[seatName] || null, model: r?.model || null, job: JOB_ID || null, tokens_in: r?.tin || 0, tokens_out: r?.tout || 0, ms, ok }) }); } catch (_) {}
}
async function lead(sys: string, user: string, max = 16000) { const t = Date.now(); try { const r = await claude(sys, user, max); await logUse("Lead editor", r, Date.now() - t, true); return r; } catch (e) { await logUse("Lead editor", null, Date.now() - t, false); throw e; } }
async function call(name: string, sys: string, user: string): Promise<{ model: string; text: string }> {
  const t = Date.now();
  try { const r: any = await callRaw(name, sys, user); await logUse(name, r, Date.now() - t, true); return r; }
  catch (e) { if (!/not connected/.test(String((e as Error).message))) await logUse(name, null, Date.now() - t, false); throw e; }
}
async function callRaw(name: string, sys: string, user: string): Promise<{ model: string; text: string }> {
  switch (name) {
    case "Claude": return claude(sys, user, 8000);
    case "ChatGPT": case "Chief Actuary": { const k = env("OPENAI_API_KEY"); if (!k) throw new Error("not connected");
      const m = name === "ChatGPT" ? (await pickModel("https://api.openai.com/v1", k, [/^gpt-5\.5$/, /^gpt-5\.\d$/, /^gpt-5$/]) || "gpt-5") : (await pickModel("https://api.openai.com/v1", k, [/^o\d+$/, /^gpt-5\.5$/]) || "o3");
      return oaiText("https://api.openai.com/v1", k, m, sys, user); }
    case "Grok": { const k = env("XAI_API_KEY"); if (!k) throw new Error("not connected");
      const m = await pickModel("https://api.x.ai/v1", k, [/^grok-\d+(\.\d+)?$/, /^grok-/]) || "grok-4"; return oaiText("https://api.x.ai/v1", k, m, sys, user); }
    case "Gemini": { const k = env("GEMINI_API_KEY") || await setting("gemini_key"); if (!k) throw new Error("not connected");
      let last: Error | null = null;
      // v1.7: Google often answers 503 "overloaded" — try 3 models, and wait and retry on busy errors instead of giving up at once
      for (const m of ["gemini-4-carbon", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.6-flash"]) {
        try { return await oaiText("https://generativelanguage.googleapis.com/v1beta/openai", k, m, sys, user); }
        catch (e) { last = e as Error; if (/503|overload|unavailable|busy|429|rate/i.test(String(last.message))) await new Promise((r) => setTimeout(r, 10000)); } }
      throw last || new Error("no answer"); }
    case "Perplexity": { const k = env("PERPLEXITY_API_KEY") || await setting("perplexity_key"); if (!k) throw new Error("not connected");
      let last: Error | null = null;
      for (const model of ["perplexity/sonar-pro", "perplexity/sonar"]) {
        const r = await fetch("https://api.perplexity.ai/v1/agent", { method: "POST", signal: TO(170000), headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, instructions: sys, input: user, tools: [{ type: "web_search" }] }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) { last = new Error(j?.error?.message || "error " + r.status); continue; }
        const text = (j.output || []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("") || String(j.output_text || "");
        if (text) return { model, text, tin: Number(j.usage?.input_tokens || j.usage?.prompt_tokens || 0), tout: Number(j.usage?.output_tokens || j.usage?.completion_tokens || 0) }; last = new Error("empty answer");
      }
      throw last || new Error("no answer"); }
    case "General Counsel": { const k = env("COHERE_API_KEY") || await setting("cohere_key"); if (!k) throw new Error("not connected — add COHERE_API_KEY");
      const m = await pickModel("https://api.cohere.ai/compatibility/v1", k, [/^command-a-\d/, /^command-r-plus/]) || "command-a-03-2025"; return oaiText("https://api.cohere.ai/compatibility/v1", k, m, sys, user); }
    case "QS / MEP Engineer": { // Mistral; until that key works, Claude sits in
      const k = env("MISTRAL_API_KEY") || await setting("mistral_key");
      if (k) { try { return await oaiText("https://api.mistral.ai/v1", k, "mistral-large-latest", sys, user); } catch (_) { /* fall through to Claude */ } }
      return claude(sys, user, 8000); }
    case "Financial Controller": { // Meta Llama via Together AI; until that key is added, Claude Opus sits in
      const k = env("TOGETHER_API_KEY") || await setting("together_key");
      if (k) { const m = await pickModel("https://api.together.xyz/v1", k, [/Llama-4-Maverick/i, /Llama-4/i, /Llama-3\.3-70B/i]) || "meta-llama/Llama-3.3-70B-Instruct-Turbo";
        return oaiText("https://api.together.xyz/v1", k, m, sys, user); }
      return claude(sys, user, 8000); }
    case "Devil's Advocate": { const k = env("XAI_API_KEY"); if (!k) throw new Error("not connected");
      const m = await pickModel("https://api.x.ai/v1", k, [/^grok-\d+(\.\d+)?$/, /^grok-/]) || "grok-4"; return oaiText("https://api.x.ai/v1", k, m, sys, user); }
  }
  throw new Error("unknown seat");
}
const BASE = "You sit on the AMI board of Hussein Saad, Chairman of Saad Ventures Group (Monrovia, Liberia): Leone Investment (property, Diplomatic Compound), Cape Realities (hotel, real estate, construction), Platinum Insurers (CBL-regulated, Africa Re treaty), RED INC (engineering, HVAC/VRV, tenders), The Lead Business Living (hospitality, Freetown). You work in the AMI Lab with other AI seats; AMI merges the parts. Plain English, short sentences, figures where possible. Never invent facts or figures: mark assumptions clearly as ASSUMPTION. Your seat: ";
const parseJSON = (t: string) => { const s = t.indexOf("{"), e = t.lastIndexOf("}"); if (s < 0 || e <= s) throw new Error("not JSON"); return JSON.parse(t.slice(s, e + 1)); };

// ---------- stages ----------
async function stRead(job: any) {
  const parts: string[] = [];
  for (const f of job.file_ids || []) {
    let t = "";
    const ex = await drive({ action: "export", file_id: f, max: 60000 });
    if (ex.text) t = ex.text;
    else {
      const v = await drive({ action: "vision", file_id: f, prompt: "Extract ALL the content of this file faithfully as plain text: every heading, paragraph, table (as rows with | separators), figure and note. Do not summarise or add anything." });
      t = v.text || `[could not read file ${f}: ${v.error || "unknown"}]`;
      if (v.name) job.file_names = [...(job.file_names || []), v.name];
    }
    parts.push(`=== FILE ${f} ===\n${t}`);
  }
  job.material = [job.text || "", ...parts].filter(Boolean).join("\n\n").slice(0, 80000);
  return "plan";
}
async function stPlan(job: any) {
  const avail = SEATS.filter((s) => s.name !== "Devil's Advocate" && s.name !== "Claude").map((s) => `- ${s.name} [${getsFile(s, job.level) ? "sees the material" : "general question only"}]: ${s.role}`).join("\n");
  const r = await lead(BASE + "LEAD EDITOR. You plan the job.",
    `JOB: ${job.title}\nCHAIRMAN'S BRIEF: ${job.brief}\nLEVEL: ${job.level}\n\nSEATS:\n${avail}\n\nMATERIAL:\n${job.material.slice(0, 60000)}\n\n` +
    `Plan the job. Give each useful seat ONE specific task (skip seats that add nothing). Write one GENERAL QUESTION for seats that cannot see the material: it must contain NO names of people or companies, NO amounts, NO places beyond "West Africa", NO identifying details — only the general technical/financial question. Describe the outline of the final deliverable.\n` +
    `Answer ONLY JSON: {"deliverable":"what the final document is, 1 line","outline":["section headings"],"tasks":[{"seat":"exact seat name","task":"max 60 words"}],"general_question":"max 120 words"}`, 4000);
  const p = parseJSON(r.text);
  job.plan = { deliverable: String(p.deliverable || ""), outline: (p.outline || []).map(String).slice(0, 15), general_question: String(p.general_question || ""),
    tasks: (p.tasks || []).filter((t: any) => SEATS.some((s) => s.name === t.seat) && t.seat !== "Devil's Advocate").map((t: any) => ({ seat: t.seat, task: String(t.task) })) };
  return "work";
}
async function stWork(job: any) {
  const runs = await Promise.allSettled(job.plan.tasks.map((t: any) => {
    const s = seat(t.seat), full = getsFile(s, job.level);
    const user = full
      ? `JOB: ${job.title}\nBRIEF: ${job.brief}\nDELIVERABLE: ${job.plan.deliverable}\nYOUR TASK: ${t.task}\n\nMATERIAL:\n${job.material.slice(0, 60000)}\n\nWrite your part now (markdown, max ~900 words, tables welcome).`
      : `GENERAL QUESTION (no client details are shared with you): ${job.plan.general_question}\nYOUR ANGLE: ${t.task.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "")}\n\nAnswer from general professional knowledge (markdown, max ~600 words). Give benchmarks, formulas, typical ranges and checks.`;
    return call(t.seat, BASE + s.role, user).then((r) => ({ seat: t.seat, saw_file: full, model: r.model, text: r.text.slice(0, 12000) }));
  }));
  job.parts = runs.map((r, i) => r.status === "fulfilled" ? { ok: true, ...r.value } : { ok: false, seat: job.plan.tasks[i].seat, error: String((r.reason as Error)?.message || r.reason).slice(0, 200) });
  return "merge";
}
async function stMerge(job: any) {
  const parts = job.parts.filter((p: any) => p.ok).map((p: any) => `### PART FROM ${p.seat} (${p.saw_file ? "saw the material" : "general knowledge only"})\n${p.text}`).join("\n\n");
  const r = await lead(BASE + "LEAD EDITOR. You merge the seats' parts into ONE finished document.",
    `JOB: ${job.title}\nBRIEF: ${job.brief}\nDELIVERABLE: ${job.plan.deliverable}\nOUTLINE: ${job.plan.outline.join(" | ")}\n\nMATERIAL (for checking figures):\n${job.material.slice(0, 40000)}\n\nPARTS:\n${parts}\n\n` +
    `Write the finished document in markdown following the outline. Cross-check every figure against the material; where seats disagree, choose and say why in one line. Mark any assumption as ASSUMPTION. ` +
    `Then, after a line containing only ===ANON===, write an anonymised 250-word summary of the draft's key claims, numbers as ranges/percentages only, no names, companies or places, for the Devil's Advocate.`, 16000);
  const [doc, anon] = r.text.split(/\n===ANON===\n?/);
  job.draft = doc.trim(); job.anon = (anon || "").trim() || job.plan.general_question;
  return "critique";
}
async function stCritique(job: any) {
  const ask = `Here is an anonymised summary of a draft the board produced:\n\n${job.anon}\n\nArgue the case AGAINST it. Give: 1) the 5 strongest objections, specific and quantified where possible; 2) a pre-mortem: 3 ways this fails within 12 months, with likely cost; 3) the hidden costs and assumptions to check; 4) what evidence would change your mind. Markdown, max 600 words.`;
  try { const r = await call("Devil's Advocate", BASE + seat("Devil's Advocate").role, ask); job.critique = { by: "Devil's Advocate", model: r.model, text: r.text.slice(0, 10000) }; }
  catch (e) { // DeepSeek not connected: Grok stands in as acting Devil's Advocate on the same anonymised summary
    const r = await call("Grok", BASE + seat("Devil's Advocate").role, ask); job.critique = { by: "Grok (acting Devil's Advocate)", model: r.model, text: r.text.slice(0, 10000), note: String((e as Error).message) };
  }
  return "final";
}
async function stFinal(job: any) {
  const who = job.parts.map((p: any) => `- ${p.seat}: ${p.ok ? (p.saw_file ? "worked on the material" : "general question only") + " (" + p.model + ")" : "did not answer — " + p.error}`).join("\n");
  const r = await lead(BASE + "LEAD EDITOR. Final revision.",
    `DRAFT:\n${job.draft}\n\nDEVIL'S ADVOCATE CRITIQUE:\n${job.critique.text}\n\nRevise the draft: fix every objection that is right; for objections you reject, say why in one line. Then output the FINAL document in markdown starting with this cover sheet:\n` +
    `# ${job.title}\n**Deliverable:** ...\n**Summary for the Chairman:** 5 bullets\n**Who did what:**\n${who}\n**Open risks (Devil's Advocate):** the objections still open\n**Must be signed by a licensed professional:** list, or "none"\n---\nthen the full document. No labels like Draft.`, 16000);
  job.final = r.text.trim();
  const folder = job.folder_id || await setting("lab_folder");
  if (folder) {
    const d = new Date().toISOString().slice(0, 10);
    const put = await drive({ action: "put_text", folder_id: folder, name: `${d} AMI Lab - ${job.title}.md`, mimeType: "text/markdown", text: job.final });
    job.drive = put.link ? { id: put.id, link: put.link } : { error: put.error };
  }
  return "vote";
}
async function stVote(job: any) {
  const voters = SEATS.filter((s) => s.voting);
  const doc = job.final.slice(0, 50000);
  const shape = `Answer ONLY JSON: {"vote":"yes or no","score":1-10,"reason":"max 30 words","fix":"the one change that would most improve it, max 20 words"}`;
  const runs = await Promise.allSettled(voters.map((s) => {
    const full = getsFile(s, job.level);
    const user = full
      ? `The board produced this document for the Chairman. JOB: ${job.title}. BRIEF: ${job.brief}\n\nDOCUMENT:\n${doc}\n\nVote: is it fit to use as it is (yes) or not (no)? ${shape}`
      : `The board produced a document. You see only an anonymised summary:\n${job.anon}\n\nVote from your professional angle: does the approach look sound (yes) or not (no)? ${shape}`;
    return call(s.name, BASE + s.role, user).then((r) => { const j = parseJSON(r.text);
      return { seat: s.name, saw_file: full, vote: /^y/i.test(String(j.vote)) ? "yes" : "no", score: Math.max(1, Math.min(10, Number(j.score) || 0)), reason: String(j.reason || "").slice(0, 250), fix: String(j.fix || "").slice(0, 200) }; });
  }));
  job.votes = runs.map((r, i) => r.status === "fulfilled" ? { ok: true, ...r.value } : { ok: false, seat: voters[i].name, error: String((r.reason as Error)?.message || r.reason).slice(0, 160) });
  const ok = job.votes.filter((v: any) => v.ok), yes = ok.filter((v: any) => v.vote === "yes").length;
  const avg = ok.length ? Math.round(ok.reduce((a: number, v: any) => a + v.score, 0) / ok.length * 10) / 10 : 0;
  job.tally = { yes, no: ok.length - yes, voted: ok.length, seats: voters.length, avg };
  job.verdict = !ok.length ? "NO VOTE" : yes > ok.length / 2 ? "APPROVED" : "NOT APPROVED";
  await whatsapp(`AMI Lab: "${job.title}" is ready. Board: ${job.verdict} — ${yes} yes / ${ok.length - yes} no (${ok.length} of ${voters.length} voted), average ${avg}/10.${job.drive?.link ? " " + job.drive.link : ""}`);
  return "done";
}
const STAGES: Record<string, (j: any) => Promise<string>> = { read: stRead, plan: stPlan, work: stWork, merge: stMerge, critique: stCritique, final: stFinal, vote: stVote };

async function runStage(id: string, stage: string) {
  const job = await load(id); if (!job || job.stage === "done") return; JOB_ID = "lab: " + (job.title || id);
  // v1.3: pause before the stage if AMI is switched off or the spending cap is reached
  const why = (await gate("", false)) === "killed" ? "AMI is switched off by the kill switch" : await spend().then((sp) => (sp?.over ? capMsg(sp) : ""));
  if (why) {
    job.stage = "paused"; job.paused_at = stage; job.error = `${stage}: ${why}`; job.log = [...(job.log || []), `${new Date().toISOString().slice(11, 19)} paused before ${stage} — ${why}`]; await save(job);
    await whatsapp(`AMI Lab: "${job.title}" paused before the ${stage} step — ${why}.`);
    return;
  }
  job.stage = stage; job.log = [...(job.log || []), `${new Date().toISOString().slice(11, 19)} ${stage} started`]; await save(job);
  try {
    const nxt = await STAGES[stage](job);
    job.stage = nxt; job.log.push(`${new Date().toISOString().slice(11, 19)} ${stage} done`); await save(job);
    if (nxt !== "done") await next(id, nxt);
  } catch (e) {
    job.stage = "error"; job.error = `${stage}: ${String((e as Error).message).slice(0, 300)}`; job.log.push(job.error); await save(job);
    await whatsapp(`AMI Lab: "${job.title}" stopped at the ${stage} step — ${job.error.slice(0, 150)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let p: any = {}; try { p = JSON.parse(await req.text()); } catch (_) {}
  const ik = req.headers.get("x-internal-key") || "";
  if (ik) { if (ik !== await setting("wake_key")) return out({ error: "denied" }, 403); }
  else { // the Chairman from AMI 1 (sign-in token)
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + String(p.token || ""), apikey: env("SUPABASE_ANON_KEY") } });
    if (!u.ok) return out({ error: "Not signed in." }, 401);
    if (String((await u.json()).email || "").toLowerCase() !== OWNER) return out({ error: "Access denied." }, 403);
    if (p.action === "stage") return out({ error: "denied" }, 403);
    // v1.3: app calls need AMI switched on and unlocked
    const g = await gate(String(p.unlock || ""), true);
    if (g === "killed") return out({ error: "AMI is switched off by the kill switch.", killed: true }, 423);
    if (g !== "ok") return out({ error: "AMI is locked. Unlock with Face ID or the WhatsApp code.", locked: true }, 423);
  }
  if (p.action === "get") { const j = await load(String(p.id)); if (!j) return out({ error: "not found" }, 404);
    return out(p.full ? j : { id: j.id, title: j.title, level: j.level, stage: j.stage, error: j.error, log: j.log, drive: j.drive, critique_by: j.critique?.by,
      parts: (j.parts || []).map((x: any) => ({ seat: x.seat, ok: x.ok, saw_file: x.saw_file, error: x.error })), votes: j.votes, tally: j.tally, verdict: j.verdict,
      summary: j.final ? (j.final.split(/\n---\n/)[0] || "").slice(0, 4000) : null }); }
  if (p.action === "list") { const r = await fetch(`${SB}/rest/v1/ami_brain?key=eq.lab_index&select=data`, { headers: H }); return out({ jobs: (await r.json())?.[0]?.data || [] }); }
  if (p.action === "seats") return out({ seats: await Promise.all(SEATS.map(async (s) => ({ name: s.name, tier: s.tier, voting: s.voting,
    connected: !!({ Claude: env("ANTHROPIC_API_KEY"), ChatGPT: env("OPENAI_API_KEY"), "Chief Actuary": env("OPENAI_API_KEY"), Grok: env("XAI_API_KEY"), Gemini: env("GEMINI_API_KEY") || await setting("gemini_key"),
      Perplexity: env("PERPLEXITY_API_KEY") || await setting("perplexity_key"), "General Counsel": env("COHERE_API_KEY") || await setting("cohere_key"), "QS / MEP Engineer": env("MISTRAL_API_KEY") || await setting("mistral_key"),
      "Financial Controller": env("ANTHROPIC_API_KEY"), "Devil's Advocate": env("XAI_API_KEY") } as any)[s.name] }))) });
  if (p.action === "start") {
    if ((await gate("", false)) === "killed") return out({ error: "AMI is switched off by the kill switch.", killed: true }, 423);
    const sp = await spend(); if (sp?.over) return out({ error: capMsg(sp) + ". The Lab can start after the cap resets.", capped: true }, 429);
    const brief = String(p.brief || "").trim(); if (brief.length < 5) return out({ error: "brief required" }, 400);
    const id = String(p.id || Date.now());
    const job = { id, title: String(p.title || brief.slice(0, 60)), brief, level: p.level === "normal" ? "normal" : "sensitive", file_ids: (p.file_ids || []).slice(0, 8), text: String(p.text || "").slice(0, 60000),
      folder_id: p.folder_id || null, stage: "queued", created: new Date().toISOString(), log: [] };
    await save(job);
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(runStage(id, "read"));
    return out({ started: true, id, level: job.level });
  }
  if (p.action === "resume") { // continue a paused job from the step where it stopped
    const j = await load(String(p.id)); if (!j || j.stage !== "paused") return out({ error: "no paused job with that id" }, 400);
    if ((await gate("", false)) === "killed") return out({ error: "AMI is switched off by the kill switch.", killed: true }, 423);
    const sp = await spend(); if (sp?.over) return out({ error: capMsg(sp) + ".", capped: true }, 429);
    // @ts-ignore
    EdgeRuntime.waitUntil(runStage(j.id, j.paused_at || "read"));
    return out({ resumed: true, id: j.id, stage: j.paused_at });
  }
  if (p.action === "stage") {
    // @ts-ignore
    EdgeRuntime.waitUntil(runStage(String(p.id), String(p.stage)));
    return out({ ok: true });
  }
  return out({ error: "unknown action" }, 400);
});
