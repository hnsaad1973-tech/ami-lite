// AMI `ai` edge function — v4.4.2 (13 Nov 2026) — invented links removed, studio buttons act at once; v4.4.1 — no false drawing claims; v4.4 — ELEVATIONS/SECTIONS/3D (draw_elevations); v4.3 — DRAWING (draw_plan: floor/partition plans as PDF + AutoCAD DXF in Drive); v4.2 — PRICING DATABASE (price_lookup tool); v4.1 — DIRECT GOOGLE (Gmail, Drive, Sheets, Calendar without Zapier; brain refresh in code); v4.0 — ask inside a company (its lines + its Drive documents); ✓ Done on each to-do item (todo_done); WhatsApp orders keep their own thread (YES approvals work); confirmed orders go to To-do list + Calendar reminders (not executed); Master Brain sheet refresh (Group Position from Drive sheet); inbox Action to-dos into To-do list; Design Studio makes images itself (no prompts); Gmail actions hard-wired (faster brief); brief must really read Gmail (no answers from old chat); Calendar & Events (events, medication, birthdays + WhatsApp reminders); Inbox tile Check now; background jobs (no 150s cut-off); — inbox brief with Noted/Action buttons (empties inbox by archiving); faster: apps only when needed, cached instructions; company brain, To-do, call me, camera, voice
import { GOOGLE_TOOLS, GOOGLE_NAMES, runGoogleTool, googleReady, sheetTabs, brainImportReady } from "./google.ts";
// Includes: "clear chat", "ami status", server-checked send claims,
// direct WhatsApp via Twilio (delivery check + template fallback), YES required before messaging others,
// verification rule with real tool errors, Think Tank only when the message STARTS with it,
// sourced-or-estimate rule for figures, Drive "Ami archive" folder map for knowledge search via Zapier.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ALLOWED = ["hnsaad1973@gmail.com"];
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const SELF_WA = "+231777170170";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const TW_TEMPLATE = Deno.env.get("TWILIO_TEMPLATE_SID") || ""; // optional: Meta-approved template for first contact

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
  });
}

const VOICE_RULE = `
VOICE MODE (this message was spoken, and your reply will be read aloud):
- Talk like a sharp human assistant on a phone call: warm, natural, relaxed. Use contractions.
- Reply in 1 to 3 short sentences. Answer first. No lists, no headings, no bullet points, no markdown, no links, no emojis.
- Never read out sources, URLs or file names unless he asks; just say "from your Gmail" or "from Reuters" in passing if needed.
- If the answer needs detail, give the headline and ask "Want the detail?" instead of reading it all.
- Say numbers the way a person would ("about four thousand and twenty dollars an ounce").
- Don't repeat his question back. Don't open with "Certainly" or "Great question".`;
const STYLE_RULE = `
STYLE: Be brief and human. Lead with the answer. Keep replies to a few short lines unless he asks for detail or the task needs a full document. No filler, no repeating his question.`;
function brainText(b: any) {
  if (!b) return "";
  const f = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
  const lines = (b.companies || []).map((c: any) => `- ${c.name} (as of ${c.as_of}; ${c.sources.join(", ")}): cash ${f(c.cash)}, receivables ${f(c.receivables)}, payables ${f(c.payables)}, bank debt ${f(c.bank_debt)}, net ${f(c.net)}. ${c.notes.join(" ")}`);
  const q = (b.quarters || []).map((x: any) => `${x.label}: in ${f(x.in)}, out ${f(x.out)}, net ${f(x.net)}`).join("; ");
  return `\nGROUP POSITION — the company brain (as of ${b.updated}; ${b.note}):\n${lines.join("\n")}${b.chairman ? `\nBetween the Chairman and the companies: he owes them ${f(b.chairman.owes_companies)}; they owe him ${f(b.chairman.companies_owe_him)}.` : ""}\nGroup total: net ${f(b.total.net)} (cash ${f(b.total.cash)}, receivables ${f(b.total.receivables)}, payables ${f(b.total.payables)}, bank debt ${f(b.total.bank_debt)}). Personal (not in group): owed ${f(b.personal.owed)} — ${b.personal.note}\nCash flow (scheduled items + forecasts): ${q}. When quoting these, give the source and its date.${b.source_url ? ` Master sheet: ${b.source_url}` : ""}\n`;
}
let BRAIN = "";
// ---------- Morning inbox brief ----------
const GMAIL_HOW = `Gmail tools: inbox_digest {query, max_results} and inbox_archive {query} or {ids, unspam}. Call them directly.`;
const INBOX_BRIEF_PROMPT = `MORNING INBOX BRIEF. Use ONLY the Gmail "inbox_digest" tool (it returns sender, subject, date and a short preview — never open full emails, open full emails only if essential).
Call inbox_digest three times: query "in:inbox newer_than:1d category:primary" (max_results 40), query "in:inbox newer_than:1d -category:primary -category:promotions -category:social" (max_results 30), and query "in:spam newer_than:2d" (max_results 20).
Keep ONLY emails that need my attention and are connected to my work: my companies (Leone Investment, Cape Realities, Platinum Insurers, The Lead, M Hotel, JV Ventures, Saad Ventures, JOUN), banks, tenants, clients, suppliers, government, embassies, CBL and tenders, partners, lawyers, auditors. Skip newsletters, promotions, social, security codes and automatic notifications.
For EACH email kept, one line: sender — one sentence on what it is — Action: the one thing I should do (reply, pay, sign, approve, forward, or none). Group under URGENT, TODAY, FYI. Mark work emails found in Spam with "(found in Spam)".
If any work emails were found in Spam, call "inbox_archive" with their ids and unspam "true" so they are rescued from Spam.
Do not reply to, send or delete anything. If nothing needs me, say so in one line. Keep it short.
On the very last line write REFS: then, for every email you listed, id|threadId|sender separated by " ; ".\n${GMAIL_HOW}`;
const INBOX_NOTED_PROMPT = `INBOX NOTED. Call the Gmail "inbox_archive" tool once with query "in:inbox" to archive everything in my inbox (archive only — never delete). Then reply in one line: how many emails were archived.\n${GMAIL_HOW}`;
const inboxActionPrompt = (brief: string) => `INBOX ACTIONS. Below is this morning's inbox brief, with the email ids and thread ids in the REFS line.
For each email whose Action needs a reply, create a Gmail DRAFT reply in its thread (gmail_draft tool with thread_id = the threadId) — short, professional, signed "Hussein Saad". Do NOT send anything. For actions that are not replies (pay, sign, approve, visit), just list them as my to-do.
Work from the brief; open a full email (gmail_read) only if the reply needs it. When done, call the Gmail "inbox_archive" tool once with query "in:inbox" (archive only, never delete).
Reply with a short numbered summary: drafts created (to whom), my to-do items, and how many emails were archived.
On the very last lines write TODO: and then each to-do item on its own line starting with "- " (or "TODO: none").
${GMAIL_HOW}

BRIEF:
${brief}`;
// ---------- Master Brain (Drive sheet "AMI — Master Brain") ----------
const ENTITIES = ["Leone Investment", "Cape Realities — Real Estate", "Cape Realities — Construction", "Platinum Insurers", "The Lead Business Living", "M Hotel", "JV Ventures", "JOUN"];
const brainRefreshPrompt = (cfg: any) => `BRAIN REFRESH. Do exactly these two tool calls and nothing else (do not inspect or search first):
1) execute_zapier_write_action with selected_api "GoogleSheetsV2CLIAPI", action "code_action_googlesheetsv2cliapi__brain_import_ready", params {"master_id": "${cfg.master_id}", "forms": ${JSON.stringify(JSON.stringify(cfg.forms || []))}}.
2) execute_zapier_write_action with selected_api "GoogleSheetsV2CLIAPI", action "code_action_googlesheetsv2cliapi__brain_read", params {"spreadsheet_id": "${cfg.master_id}", "range_suffix": "A1:F600"}.
Then reply in one short line: which forms were imported (or "no new forms").`;
const num = (v: any) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return isFinite(n) ? n : 0; };
// Turn the master sheet tabs into the Group Position the app and AMI use (all arithmetic here, never by the model)
function positionFromSheet(tabs: any, masterUrl: string) {
  const now = new Date();
  const months: string[] = [], keys: string[] = [];
  for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)); keys.push(d.toISOString().slice(0, 7)); months.push(d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })); }
  const read = (name: string) => {
    const rows: any[][] = tabs[name] || [];
    const t: any = { name, month: String(rows[2]?.[1] ?? ""), as_of: String(rows[3]?.[1] ?? "") || "not given", cash: 0, receivables: 0, payables: 0, bank_debt: 0, due_from_chairman: 0, due_to_chairman: 0, contracts: 0, contracts_list: [] as any[], notes: [] as string[], sources: [] as string[], in: keys.map(() => 0), out: keys.map(() => 0) };
    for (const r of rows.slice(8)) {
      const type = String(r?.[0] ?? "").trim().toLowerCase(); if (!type) continue;
      const desc = String(r?.[1] ?? "").trim(), amt = num(r?.[3]), mon = String(r?.[4] ?? "").trim().slice(0, 7), src = String(r?.[5] ?? "").trim();
      if (src && !/^(info|inflow|outflow|contract)$/.test(type)) { const f = src.split(/[;(]/)[0].trim(); if (f && !t.sources.includes(f)) t.sources.push(f); }
      if (type === "cash") t.cash += amt; else if (type === "receivable") t.receivables += amt; else if (type === "payable") t.payables += amt;
      else if (type === "bank debt") t.bank_debt += amt; else if (type === "due from chairman") t.due_from_chairman += amt; else if (type === "due to chairman") t.due_to_chairman += amt;
      else if (type === "contract") { t.contracts += amt; t.contracts_list.push({ name: desc, value: amt, note: src }); }
      else if (type === "inflow" || type === "outflow") { const k = keys.indexOf(mon); if (k >= 0) (type === "inflow" ? t.in : t.out)[k] += amt; }
      else if (type === "info" && desc) t.notes.push(desc + (r?.[3] !== "" && r?.[3] != null ? ` ($${Math.round(amt).toLocaleString("en-US")})` : ""));
    }
    t.net = t.cash + t.receivables + t.due_from_chairman - t.payables - t.bank_debt - t.due_to_chairman;
    return t;
  };
  const ents = ENTITIES.map(read);
  const sum = (k: string) => ents.reduce((a, c) => a + c[k], 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const companies = ents.map((c) => ({ name: c.name, as_of: c.as_of, sources: c.sources.length ? c.sources : ["AMI — Master Brain"], cash: r2(c.cash), receivables: r2(c.receivables), payables: r2(-c.payables), bank_debt: r2(-c.bank_debt),
    due_from_chairman: r2(c.due_from_chairman), due_to_chairman: r2(c.due_to_chairman), contracts: r2(c.contracts), contracts_list: c.contracts_list, net: r2(c.net), notes: c.notes, month: c.month }));
  const flows = ents.filter((c) => c.in.some((x: number) => x) || c.out.some((x: number) => x)).map((c) => ({ name: c.name, in: c.in.map(r2), out: c.out.map((x: number) => r2(-x)), net: c.in.map((x: number, i: number) => r2(x - c.out[i])), basis: `Inflow / Outflow lines on the "${c.name}" tab of the Master Brain sheet.` }));
  const gin = keys.map((_, i) => r2(ents.reduce((a, c) => a + c.in[i], 0))), gout = keys.map((_, i) => r2(-ents.reduce((a, c) => a + c.out[i], 0)));
  const quarters: any[] = [];
  keys.forEach((k, i) => { const y = +k.slice(0, 4), q = Math.floor((+k.slice(5, 7) - 1) / 3) + 1, lab = `Q${q} ${y}`; let g = quarters.find((x) => x.key === lab); if (!g) { g = { key: lab, ms: [], in: 0, out: 0 }; quarters.push(g); } g.ms.push(months[i].slice(0, 3)); g.in += gin[i]; g.out += gout[i]; });
  const qs = quarters.map((g) => ({ label: g.key + (g.ms.length < 3 ? ` (${g.ms[0]}${g.ms.length > 1 ? "–" + g.ms[g.ms.length - 1] : ""})` : ""), in: r2(g.in), out: r2(g.out), net: r2(g.in + g.out) }));
  const per = read("Personal");
  return {
    updated: now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    note: "Live from the AMI — Master Brain sheet in Drive (updated monthly from each company's update form). Ecobank (Leone) left out until Hachem confirms.",
    source_url: masterUrl, companies,
    total: { cash: r2(sum("cash")), receivables: r2(sum("receivables")), payables: r2(-sum("payables")), bank_debt: r2(-sum("bank_debt")), due_from_chairman: r2(sum("due_from_chairman")), due_to_chairman: r2(sum("due_to_chairman")), contracts: r2(sum("contracts")), net: r2(sum("net")) },
    chairman: { owes_companies: r2(sum("due_from_chairman")), companies_owe_him: r2(sum("due_to_chairman")) },
    personal: { as_of: per.as_of, source: per.sources[0] || "Personal tab", owed: r2(-(per.payables + per.bank_debt)), cash: r2(per.cash), note: "Personal account — not in the group total." + (per.notes.length > 1 ? " " + per.notes.slice(1).join(" ") : "") },
    months, flows, group_flow: { in: gin, out: gout, net: gin.map((x, i) => r2(x + gout[i])) }, quarters: qs,
  };
}
const STUDIO_RULE = `
DESIGN STUDIO (sketches, renders, elevations, floor plans, 3D views, logos, any picture): you DO the work yourself — never hand him a prompt, never tell him to use another tool or app.
- FLOOR PLANS / PARTITION PLANS / office or room LAYOUTS: use the draw_plan tool (real PDF + AutoCAD DXF saved in Drive), NOT image generation. If he means an existing plan, find its PDF with drive_search first and pass base_file_id. Changes to the last drawing: draw_plan with revise "true". Tell him the PDF and AutoCAD links come on WhatsApp in about 3 minutes.
- ELEVATIONS / SECTIONS / FACADES / 3D MASSING of a building: use the draw_elevations tool (4 elevations + section + 3D view, with levels and measurements, PDF + AutoCAD). A full drawing set = draw_plan for each floor + draw_elevations + one photoreal render (generate_image below, describing the exact massing, floors, glass facade, roof terrace and setting in Monrovia). The set is for the architect to finish and certify.
- STUDIO BUTTONS (Render / 3D / Adjust): when the message starts with "Turn this sketch" or "Clean up and adjust this sketch" and a sketch link is given, call create_image_edit IMMEDIATELY with that link — no questions, no plan, no talk of partitions; earlier chat in this section does not matter. Then drive_save_image.
- NEVER write an image link or a Drive link that did not come back from a tool in THIS reply. If a tool fails, say it failed.
- New image: execute_zapier_write_action, selected_api "ChatGPTCLIAPI", action "generate_image" (tool_name "chatgpt_openai_generate_an_image"), params {"prompt": "<your detailed description>", "size": "1536x1024", "quality": "medium", "output_format": "jpeg", "results_number": 1}.
- Change HIS sketch/photo (adjust, render it, make it 3D, add materials): execute_zapier_write_action, selected_api "ChatGPTCLIAPI", action "create_image_edit" (tool_name "chatgpt_openai_create_image_edit"), params {"image": "<the sketch link given in the message>", "prompt": "<what to do>", "size": "1536x1024", "output_format": "jpeg", "results_number": 1}.
- For 3D: produce a photoreal 3D perspective or axonometric render of the design (and say it is a 3D-style render image, not a CAD model).
- Put each returned image link on its own line in your reply (the app displays it), then one short line on what you made. Then save a copy with the drive_save_image tool: {"url": "<image link>", "folder_id": "16IOI6ngn5ITaGuUtI84v_hgtkINNBi_T", "name": "<short name>.jpg"} and give the Drive link.
- Measurements he gives (sizes, areas) must appear in the drawing description. If something essential is missing, make a sensible assumption, state it in one line, and still deliver the image.`;
const CO_FOLDERS: Record<string, string> = {
  "Leone Investment": "1qw_-mvcO0e0McEXYnGMncYDLXC2FCiQX", "Cape Realities — Real Estate": "1rB2dXvWVvvZuZEH9oSV5YyZQw_G13mr8",
  "Cape Realities — Construction": "1BvPb2YTambSRnvC037zwhjIxA9LJWErx (and the main Cape folder 1rB2dXvWVvvZuZEH9oSV5YyZQw_G13mr8)", "Platinum Insurers": "1EaJzEKmkGQa6RZwClHTT4gg2WrLGLcwO",
  "The Lead Business Living": "1EVJOqgcvmIu7Hkvx6-4dlgt7LFI6s6Ks", "M Hotel": "1Z67zH3NSsmzrviEp-uTO1OehA83Il47_", "JV Ventures": "1sttdX5fK060WebS2vy9CDOW2j6j3RqSX", "JOUN": "1oVkGTKWEg_zWSIgEtisHD_UrcAqkLEXG" };
function companyText(name: string, rows: any[][] | null) {
  const lines = (rows || []).slice(8).filter((r) => r && String(r[0] || "").trim()).map((r) => [r[0], r[1], r[2], r[3], r[4], r[5]].map((x) => String(x ?? "").trim()).join(" | "));
  return `
COMPANY MODE — the Chairman is inside the company "${name}" in the app. Answer about THIS company only, unless he asks otherwise.
Its lines in the Master Brain sheet (Type | Description | Counterparty | Amount USD | Month | Source):
${lines.join("\n") || "(no lines)"}
- For lists (payables, receivables, tenants, loans, cash flow): first use the lines above. When he wants more detail than the lines give (e.g. supplier by supplier, tenant by tenant), OPEN THE SOURCE DOCUMENT named in the Source column from Drive and list the items from it — do not say you can't.
- Find a file: drive_search tool with {"name": "<part of file name>"} or list this company's folder with {"folder_id": "${CO_FOLDERS[name] || "search by name"}"}.
- Read it: drive_read tool with {"file_ids": "<id>,<id>"} (up to 3 files; spreadsheets give ALL tabs, PDFs and Word files are read in full).
- Lay lists out one item per line: "Name — $amount (due/month)", then the total, and say the source file and its date. Amounts already on the lines above are the official figures; if a document shows a different figure, show both and say which is newer.`;
}
function buildSystem(facts: string[], deep: boolean, voice = false, studio = false) {
  return (voice ? VOICE_RULE + "\n\n" : STYLE_RULE + "\n\n") + `You are AMI, the private executive assistant of Hussein Saad, Chairman of Saad Ventures Group, Monrovia, Liberia. Address him as "Chairman".
Group (8 entities in the group total): Leone Investment Inc. (property management); Cape Realities Liberia LLC — Real Estate; Cape Realities — Construction (projects: ERIC 7th Street, the School project, the Orange Buchanan data centre, and the 11th Street showroom built in-house for Cape Real Estate); Platinum Insurers Liberia Inc.; The Lead Business Living SL Limited (Sierra Leone hospitality, shown at 100%, his share 50%); M Hotel (hotel project); JV Ventures (5 JVs: CBL construction with SIGMA; CBL VRV/HVAC with RED INC; CBL design with Marmar; Dongfeng dealership; Telecel aggregate licence — Cardinal on hold); JOUN (his Lebanon company, Joun resort — included in the group total). Saad Ventures Group is the holding. RED INC is a JV partner, NOT one of his companies. "CBL VRV" = the RED INC JV contract. His personal account is separate and never in the group total; only amounts between him and the companies show (both ways). The Swedish Embassy dispute is settled.
HONESTY RULE (first rule, always):
- Never say yes unless you are sure. If the answer is no, say "No" clearly and why.
- If unsure or missing information, say "I'm not sure" and what you need to confirm it.
- Never guess or invent facts, figures, prices, names or dates.
- For every fact, say where it came from ("from your Gmail", "from the Ami archive: <file>", "from Reuters today", or the web link).
- Every figure must either have a source or be clearly labelled "estimate".

VERIFICATION RULE:
- Never say you sent, saved, moved, booked or did anything unless the tool result confirms it succeeded.
- If a tool fails or returns an error, say so plainly and quote the error. Never pretend it worked.
- The system may append real tool errors under your reply; never contradict them.

PHOTOS: When he sends a photo (invoice, receipt, letter, site, drawing, screen), read it carefully. Give the key facts first (who, what, amounts, dates, reference numbers), then what needs his attention or action. If part of the photo is unreadable, say exactly which part. Never guess unreadable figures.

PERSONALITY: Warm, friendly and a little jovial, with a light touch of humour, like a trusted senior aide. Short and direct. Serious when the topic is serious (money, legal, health, bad news). Personality never overrides honesty.

HIS DETAILS:
- His WhatsApp: ${SELF_WA}. AMI's WhatsApp sender: ${TW_FROM}. When he says "send me" or "WhatsApp me", send by WhatsApp (never SMS): ${TW_SID && TW_TOKEN ? "use the send_whatsapp tool" : `use the Zapier Twilio action with From "whatsapp:${TW_FROM}" and To "whatsapp:<number>"`}.
- His email: hnsaad1973@gmail.com.

SENDING RULE: Before sending any email, WhatsApp or message to ANYONE other than himself, show the exact draft and recipient, and wait for his YES. Only call the send tool in the turn where he has replied YES. Messages to himself may be sent directly.
WHATSAPP NOTE: WhatsApp only allows free-text to someone who messaged AMI's number in the last 24 hours. Otherwise an approved template is needed. If a send fails for that reason, tell him plainly.
CONTACTS: Use the phone numbers in your saved memory. If you don't have someone's WhatsApp number, ask him for it and save it with save_memory.

KNOWLEDGE / ARCHIVE: His documents are in Google Drive, folder "Ami archive", with subfolders: Leone (incl. "Security — Wright & Embassies" and its "KPI Meeting"), Cape Realities (incl. Construction and Showroom 11th Street), Platinum, The Lead, M Hotel, JV Ventures (incl. CBL & SIGMA and Dongfeng), Personal, AMI. JOUN has its own folder outside the archive. When he asks about a document, contract, figure or project, search Drive with drive_search, read with drive_read, and cite the file name. Gmail: inbox_digest / gmail_read / gmail_draft (drafts only — never send email without his YES). His Google Calendar: calendar_events / calendar_add.
PRICING: when he asks to price, cost or estimate anything, call price_lookup FIRST (the group's pricing database of past quotes, BOQs and supplier price lists). Give the newest unit price with date, supplier, project and source; show the range if several; state the currency and never mix USD / SLE / LRD; say if it is a supplier quote, our BOQ rate, a budget or an actual cost. Only if nothing matches, give an estimate clearly labelled "estimate".

MEMORY: Use the save_memory tool when he says "remember", or when he tells you a lasting fact about himself, his companies, people (including their phone numbers) or preferences. Do not save passwords, card numbers or ID numbers.
${facts.length ? "WHAT YOU REMEMBER ABOUT HIM:\n- " + facts.join("\n- ") : "You have no saved long-term memories yet."}

${BRAIN}
Use web search for anything current: news, markets, prices, companies, regulations.
${studio ? STUDIO_RULE : ""}
${deep ? `
THINK TANK MODE IS ON: This is a deep-analysis request. Research thoroughly, consider several options, weigh risks, costs and benefits, and challenge your own conclusions. Structure the answer: Bottom line first, then Options, Analysis, Risks, and a clear Recommendation. Separate facts (with sources) from your judgement. Begin the reply with "🧠 Think Tank".` : ""}`;
}

// WhatsApp quick-reply buttons for the inbox brief (created once, kept in ami_settings)
async function inboxTemplate(): Promise<string> {
  const r = await db("ami_settings?key=eq.inbox_content_sid&select=value");
  const have = r.ok ? (await r.json())[0]?.value : "";
  if (have) return have;
  const c = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/json" },
    body: JSON.stringify({ friendly_name: "ami_inbox_brief", language: "en", variables: { "1": "brief" },
      types: { "twilio/quick-reply": { body: "{{1}}", actions: [{ title: "✅ Noted", id: "noted" }, { title: "⚡ Action", id: "action" }] }, "twilio/text": { body: "{{1}}" } } }),
  });
  const j = await c.json().catch(() => ({}));
  if (j.sid) await db("ami_settings", { method: "POST", body: JSON.stringify({ key: "inbox_content_sid", value: j.sid }), headers: { Prefer: "resolution=merge-duplicates" } });
  return j.sid || "";
}

// next time an event happens at or after `from` (Monrovia = UTC). Birthdays / no time = 09:00.
function nextOcc(ev: any, from: Date): Date | null {
  const t = String(ev.at_time || "09:00").slice(0, 5);
  let d = new Date(`${ev.on_date}T${t}:00Z`);
  if (isNaN(d.getTime())) return null;
  if (ev.repeat === "none") return d >= from ? d : null;
  const step = (x: Date) => {
    const y = new Date(x);
    if (ev.repeat === "daily") y.setUTCDate(y.getUTCDate() + 1);
    else if (ev.repeat === "weekly") y.setUTCDate(y.getUTCDate() + 7);
    else if (ev.repeat === "monthly") y.setUTCMonth(y.getUTCMonth() + 1);
    else y.setUTCFullYear(y.getUTCFullYear() + 1);
    return y;
  };
  // jump close first so daily items from long ago stay fast
  if (d < from && ev.repeat === "daily") { const days = Math.floor((from.getTime() - d.getTime()) / 86400000); d.setUTCDate(d.getUTCDate() + days); }
  if (d < from && ev.repeat === "yearly") d.setUTCFullYear(Math.max(d.getUTCFullYear(), from.getUTCFullYear() - 1));
  for (let i = 0; d < from && i < 1000; i++) d = step(d);
  return d >= from ? d : null;
}

function normPhone(p: string) {
  let n = String(p || "").replace(/[^\d+]/g, "");
  if (n && !n.startsWith("+")) n = "+" + n;
  return n;
}

async function twilio(path: string, form?: URLSearchParams) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

// Sends, then checks delivery status a few seconds later so AMI reports the real outcome.
async function sendWhatsApp(to: string, body: string, useTemplate = false): Promise<{ ok: boolean; info: string }> {
  if (!TW_SID || !TW_TOKEN) return { ok: false, info: "Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN secrets missing)." };
  const form = new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${to}` });
  if (useTemplate) { form.set("ContentSid", TW_TEMPLATE); form.set("ContentVariables", JSON.stringify({ "1": body })); }
  else form.set("Body", body);

  const send = await twilio("Messages.json", form);
  if (!send.ok) return { ok: false, info: `Twilio error ${send.j?.code || ""}: ${send.j?.message || "send failed"}` };

  const sid = send.j.sid;
  await new Promise((res) => setTimeout(res, 4000));
  const chk = await twilio(`Messages/${sid}.json`);
  const status = chk.j?.status || send.j.status;
  const code = chk.j?.error_code;

  if (status === "failed" || status === "undelivered") {
    if (code == 63016 && !useTemplate && TW_TEMPLATE) return sendWhatsApp(to, body, true);
    if (code == 63016) return { ok: false, info: `Not delivered (error 63016): ${to} has not messaged AMI in the last 24 hours, so WhatsApp requires an approved template. No template is set up yet.` };
    return { ok: false, info: `Not delivered: status ${status}, error ${code || "unknown"} ${chk.j?.error_message || ""}`.trim() };
  }
  return { ok: true, info: `WhatsApp ${useTemplate ? "(template) " : ""}to ${to}: status "${status}" (message id ${sid}).` };
}

// Turn a confirmed orders / to-do list into Calendar reminders (ami_events). Items with no date stay in the To-do list only.
async function scheduleOrders(kind: string, orders: string): Promise<string> {
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  let items: any[] = [];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1200,
        system: `Today is ${today} (${now.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}), Monrovia time = UTC. This list was dictated ${kind === "evening" ? "in the evening as TOMORROW's to-do list, so items with no date are for " + tomorrow : "today"}.
For each numbered item return its date and time ONLY if the item states or clearly implies them (e.g. "at 10", "Monday", "tomorrow morning" = 09:00, "before noon" = 11:00, "end of day" = 17:00). Never invent a date or time. ${kind === "evening" ? "Items with a time but no date are on " + tomorrow + "." : "Items with a time but no date are today."}
Return ONLY JSON: {"items":[{"title":"<short item text>","date":"YYYY-MM-DD or null","time":"HH:MM or null"}]}`,
        messages: [{ role: "user", content: orders }] }),
    });
    const d = await r.json(); const t = (d.content || []).map((b: any) => b.text || "").join("");
    items = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)).items || [];
  } catch (_) {}
  const added: string[] = [], listed: string[] = [];
  for (const it of items) {
    const title = String(it.title || "").trim().slice(0, 200); if (!title) continue;
    let date = /^\d{4}-\d{2}-\d{2}$/.test(String(it.date || "")) ? it.date : (kind === "evening" ? tomorrow : "");
    const time = /^\d{2}:\d{2}$/.test(String(it.time || "")) ? it.time : "";
    if (!date) { listed.push(title); continue; }
    const at = time || "08:00"; // dated but untimed: reminder at 08:00 that day
    if (new Date(`${date}T${at}:00Z`).getTime() < Date.now()) { listed.push(title); continue; }
    const w = await db("ami_events", { method: "POST", body: JSON.stringify({ title, kind: "event", on_date: date, at_time: at, repeat: "none", notes: "From your " + (kind === "evening" ? "evening list" : "orders call") }) });
    if (w.ok) added.push(`${date.slice(8)}/${date.slice(5, 7)} ${at} — ${title}`); else listed.push(title);
  }
  let out = "✅ Confirmed — saved to your To-do list.";
  if (added.length) out += `\n📅 Added to your Calendar (WhatsApp reminder 15 min before):\n- ` + added.join("\n- ");
  if (listed.length) out += `\n📋 To-do only (no date/time given):\n- ` + listed.join("\n- ");
  if (!items.length) out += "\n(I couldn't read dates from the list, so it's in the To-do list only.)";
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Body first: the page sends the sign-in token inside the body (no extra CORS handshake = faster)
    const raw = await req.text();
    let message = raw, section = "Ask AMI", image = "", voice = false, bodyToken = "", deliver = "", action = "", storeKey = "";
    try {
      const p = JSON.parse(raw);
      message = p.message || p.prompt || p.text || raw;
      section = p.section || section;
      image = typeof p.image === "string" ? p.image : "";
      voice = p.voice === true;
      bodyToken = typeof p.token === "string" ? p.token : "";
      deliver = p.deliver === "whatsapp" ? "whatsapp" : "";
      action = typeof p.action === "string" ? p.action : "";
      storeKey = typeof p.store_key === "string" ? p.store_key.replace(/[^a-z_]/g, "") : "";
    } catch (_) {}
    const auth = req.headers.get("Authorization") || (bodyToken ? "Bearer " + bodyToken : "");
    // Sign-in check runs at the same time as the history/memory lookup (single allowed user)
    const email = ALLOWED[0];
    const e = encodeURIComponent(email), s = encodeURIComponent(section);
    const internalKey = req.headers.get("x-internal-key") || "";
    let company = ""; try { company = String(JSON.parse(raw).company || "").slice(0, 80); } catch (_) {}
    const [userRes, hRes, mRes, kRes, bRes, tRes] = await Promise.all([
      internalKey ? Promise.resolve(null) : fetch(`${SB}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } }),
      db(`ami_messages?user_email=eq.${e}&section=eq.${s}&select=role,content&order=created_at.desc&limit=${voice ? 8 : 20}`),
      db(`ami_memory?user_email=eq.${e}&select=fact&order=created_at.asc&limit=300`),
      internalKey ? db("ami_settings?key=eq.wake_key&select=value") : Promise.resolve(null),
      db("ami_brain?key=eq.group_position&select=data"),
      company ? db("ami_brain?key=eq.brain_tabs&select=data") : Promise.resolve(null),
    ]);
    let brain: any = null;
    try { brain = bRes && bRes.ok ? (await bRes.json())[0]?.data || null : null; } catch (_) {}
    BRAIN = brainText(brain);
    let COMPANY = "";
    if (company) { let tabs: any = null; try { tabs = tRes && tRes.ok ? (await tRes.json())[0]?.data || null : null; } catch (_) {} COMPANY = companyText(company, tabs ? tabs[company] : null); }
    if (internalKey) {
      // internal call from AMI's own phone system (key kept in the locked ami_settings table)
      const k = kRes && kRes.ok ? (await kRes.json())[0]?.value : "";
      if (!k || k !== internalKey) return json({ reply: "Access denied." }, 403);
    } else {
      if (!userRes || !userRes.ok) return json({ reply: "Not signed in." }, 401);
      const user = await userRes.json();
      if ((user.email || "").toLowerCase() !== email) return json({ reply: "Access denied." }, 403);
    }
    if (image && !message.trim()) message = "Read this photo and tell me what matters.";
    if (internalKey && message.trim() === "INBOX_BRIEF") message = INBOX_BRIEF_PROMPT;
    let brainCfg: any = null;
    if (internalKey && message.trim() === "BRAIN_REFRESH") {
      const cr = await db("ami_brain?key=eq.brain_config&select=data"); brainCfg = cr.ok ? (await cr.json())[0]?.data || null : null;
      if (!brainCfg?.master_id) return json({ reply: "Brain config missing." }, 500);
      if (googleReady()) {
        // Direct Google: import READY forms, read the master, compute in code — no AI, no Zapier
        let reply = "";
        try {
          const imp = await brainImportReady(brainCfg.master_id, brainCfg.forms || []);
          const tabs = await sheetTabs(brainCfg.master_id, "A1:F600");
          const pos = positionFromSheet(tabs, brainCfg.master_url || "");
          const now = new Date().toISOString();
          const w = await db("ami_brain", { method: "POST", body: JSON.stringify({ key: "group_position", data: pos, updated_at: now }), headers: { Prefer: "resolution=merge-duplicates" } });
          await db("ami_brain", { method: "POST", body: JSON.stringify({ key: "brain_tabs", data: tabs, updated_at: now }), headers: { Prefer: "resolution=merge-duplicates" } });
          reply = (w.ok ? `✅ Group Position refreshed from the Master Brain sheet. Group net: ${pos.total.net < 0 ? "-" : ""}$${Math.abs(Math.round(pos.total.net)).toLocaleString("en-US")}.` : `⚠️ Read the sheet but could not save (database ${w.status}).`)
            + `\n${imp.imported.length ? "Imported forms: " + imp.imported.join(", ") : "No new forms."}${imp.errors.length ? "\n⚠️ Form errors: " + imp.errors.join("; ") : ""}`;
        } catch (e) { reply = "⚠️ Group Position NOT refreshed — " + (e as Error).message + ". Nothing was changed."; }
        if (storeKey) await db("ami_brain", { method: "POST", body: JSON.stringify({ key: storeKey, data: { text: reply, status: "done", at: new Date().toISOString() }, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates" } });
        return json({ reply });
      }
      message = brainRefreshPrompt(brainCfg);
    }
    // Design Studio: his sketch/photo gets a private link so the image tools can work on it
    const studio = section === "Design Studio" || /\b(sketch|render|rendering|draw|drawing|elevation|floor ?plan|3d|three[- ]d|mock ?-?up|logo|picture|image of|visuali[sz]e|partition|partitioning|layout|lay out|dxf|autocad|cad|elevations|section|sections|facade|massing|drawing set|re-?draw|redrawn|plans?|structural|mezzanine)\b/i.test(message);
    if (image && studio) {
      try {
        const bin = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
        const path = `sketch-${Date.now()}.jpg`;
        const up = await fetch(`${SB}/storage/v1/object/studio/${path}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/jpeg", "x-upsert": "true" }, body: bin });
        if (up.ok) {
          const sg = await fetch(`${SB}/storage/v1/object/sign/studio/${path}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 7200 }) });
          const sj = await sg.json().catch(() => ({}));
          if (sj.signedURL) message += `\n\n[His sketch/photo link for the image tools: ${SB}/storage/v1${sj.signedURL}]`;
        }
      } catch (_) {}
    }

    // "Call me" button: AMI rings the Chairman's phone now (2-way call via the `wake` function)
    if (action === "callme") {
      const kr = await db("ami_settings?key=eq.wake_key&select=value");
      const wk = kr.ok ? (await kr.json())[0]?.value : "";
      const r = await fetch(`${SB}/functions/v1/wake`, { method: "POST", headers: { "Content-Type": "application/json", "x-wake-key": wk || "" }, body: JSON.stringify({ call: "inbound" }) });
      const d = await r.json().catch(() => ({}));
      return json({ reply: String(d.call || "").startsWith("ok") ? "📞 Calling you now, Chairman." : "Couldn't start the call: " + (d.call || d.error || r.status) });
    }

    // Inbox tile: the latest morning email brief
    if (action === "inbox_brief") {
      const r = await db("ami_brain?key=eq.inbox_brief&select=data,updated_at");
      const row = r.ok ? (await r.json())[0] : null;
      return json({ brief: row ? row.data : null, updated_at: row ? row.updated_at : null });
    }

    // Inbox tile "Check now": run the morning brief immediately (result to WhatsApp + the tile)
    if (action === "inbox_check") {
      await fetch(`${SB}/rest/v1/rpc/ami_inbox_brief`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: "{}" });
      return json({ reply: "🔄 Checking your inbox now — the brief will come to WhatsApp and here in about 2 minutes." });
    }

    if (action === "inbox_noted" || action === "inbox_action") {
      const r = await db("ami_brain?key=eq.inbox_brief&select=data");
      const d0 = r.ok ? (await r.json())[0]?.data || {} : {};
      const message2 = action === "inbox_noted" ? INBOX_NOTED_PROMPT : inboxActionPrompt(String(d0.text || "") + "\nREFS: " + String(d0.refs || ""));
      await db("ami_brain?key=eq.inbox_brief", { method: "PATCH", body: JSON.stringify({ data: { ...d0, status: action === "inbox_noted" ? "noted" : "action" } }) });
      await fetch(`${SB}/rest/v1/rpc/ami_dispatch`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { message: message2, section: "Inbox", deliver: "whatsapp" } }) });
      return json({ reply: action === "inbox_noted" ? "✅ Noted — emptying your inbox now (archived, nothing deleted)." : "⚡ On it — drafting the replies, then emptying your inbox. Summary will come to WhatsApp." });
    }

    // Group Position tile: the company brain as data for the page
    if (action === "position") {
      const cr = await db("ami_brain?key=eq.brain_config&select=data"); const cfg = cr.ok ? (await cr.json())[0]?.data || {} : {};
      return json({ position: brain, master_url: cfg.master_url || "", forms_folder: cfg.forms_folder || "" });
    }
    // Refresh Group Position from the Master Brain sheet (imports READY forms first) — runs in the background
    if (action === "brain_refresh") {
      await fetch(`${SB}/rest/v1/rpc/ami_dispatch`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { message: "BRAIN_REFRESH", section: "Brain", store_key: "brain_refresh" } }) });
      return json({ reply: "🔄 Refreshing from the Master Brain sheet — about a minute." });
    }

    // Calendar & Events tile: events, medication, birthdays (+ WhatsApp reminders every minute)
    if (action === "events_list") {
      const r = await db("ami_events?select=id,title,kind,on_date,at_time,repeat,notes&order=on_date.asc&limit=500");
      const rows = r.ok ? await r.json() : [];
      const now = new Date();
      const list = rows.map((ev: any) => ({ ...ev, next: nextOcc(ev, now)?.toISOString() || null })).filter((ev: any) => ev.next)
        .sort((a: any, b: any) => a.next.localeCompare(b.next));
      return json({ events: list });
    }
    if (action === "events_add") {
      let p: any = {}; try { p = JSON.parse(raw).event || {}; } catch (_) {}
      const kind = ["event", "medication", "birthday", "other"].includes(p.kind) ? p.kind : "event";
      const repeat = ["none", "daily", "weekly", "monthly", "yearly"].includes(p.repeat) ? p.repeat : (kind === "birthday" ? "yearly" : "none");
      const title = String(p.title || "").trim().slice(0, 200);
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.on_date || ""))) return json({ reply: "Need a title and a date." }, 400);
      const at_time = /^\d{2}:\d{2}$/.test(String(p.at_time || "")) ? p.at_time : null;
      const w = await db("ami_events", { method: "POST", body: JSON.stringify({ title, kind, on_date: p.on_date, at_time, repeat, notes: String(p.notes || "").slice(0, 500) || null }) });
      return json({ reply: w.ok ? "✅ Saved — AMI will remind you on WhatsApp." : "Couldn't save (database error " + w.status + ")." });
    }
    if (action === "events_delete") {
      let id = ""; try { id = String(JSON.parse(raw).id || ""); } catch (_) {}
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ reply: "Bad id." }, 400);
      const w = await db(`ami_events?id=eq.${id}`, { method: "DELETE" });
      return json({ reply: w.ok ? "Deleted." : "Couldn't delete (" + w.status + ")." });
    }
    if (action === "events_tick") {
      if (!internalKey) return json({ reply: "Access denied." }, 403);
      const r = await db("ami_events?select=id,title,kind,on_date,at_time,repeat,notes,last_key&limit=500");
      const rows = r.ok ? await r.json() : [];
      const now = Date.now(); const sent: string[] = [];
      for (const ev of rows) {
        const occ = nextOcc(ev, new Date(now - 2 * 60000)); if (!occ) continue;
        const lead = ev.kind === "event" || ev.kind === "other" ? 15 : 0; // events: 15 min before; medication/birthdays: on time
        const remindAt = occ.getTime() - lead * 60000;
        const key = occ.toISOString();
        if (now < remindAt || now > occ.getTime() + 2 * 60000 || ev.last_key === key) continue;
        const hhmm = key.slice(11, 16);
        const msg = ev.kind === "medication" ? `💊 Medication time, Chairman: ${ev.title}${ev.notes ? " — " + ev.notes : ""}`
          : ev.kind === "birthday" ? `🎂 Today is ${ev.title}'s birthday.${ev.notes ? " " + ev.notes : ""} Want me to draft a message? Reply YES with who to send it to.`
          : `📅 In 15 minutes (${hhmm}): ${ev.title}${ev.notes ? " — " + ev.notes : ""}`;
        const s = await sendWhatsApp(SELF_WA, msg);
        await db(`ami_events?id=eq.${ev.id}`, { method: "PATCH", body: JSON.stringify({ last_key: key }) });
        sent.push(ev.title + (s.ok ? "" : " (failed: " + s.info + ")"));
      }
      return json({ sent });
    }

    // To-do list tile: the latest lists from his calls, and Confirm from the app
    if (action === "todo") {
      const r = await db("ami_calls?orders=not.is.null&orders_status=neq.cancelled&orders_status=neq.superseded&select=call_sid,kind,orders,orders_status,sent_at,done_items&order=sent_at.desc&limit=15");
      return json({ lists: r.ok ? await r.json() : [] });
    }
    // ✓ Done on one to-do item: it clears out of the To-do list (kept in the database)
    if (action === "todo_done") {
      let sid = "", item = "", undo = false;
      try { const j = JSON.parse(raw); sid = String(j.call_sid || ""); item = String(j.item || "").trim(); undo = !!j.undo; } catch (_) {}
      if (!sid || !item) return json({ reply: "Missing item." }, 400);
      const r = await db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}&select=done_items`);
      const row = r.ok ? (await r.json())[0] : null;
      if (!row) return json({ reply: "List not found." }, 404);
      const cur: string[] = Array.isArray(row.done_items) ? row.done_items : [];
      const next = undo ? cur.filter((x) => x !== item) : [...new Set([...cur, item])];
      await db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}`, { method: "PATCH", body: JSON.stringify({ done_items: next }) });
      return json({ ok: true, done_items: next });
    }
    // Confirm a call's list: it goes into the To-do list, and every item with a date/time goes into the Calendar with WhatsApp reminders.
    // AMI does NOT carry the orders out on her own.
    if (action === "todo_confirm" || action === "orders_confirm") {
      let sid = ""; try { sid = String(JSON.parse(raw).call_sid || ""); } catch (_) {}
      if (action === "orders_confirm" && !internalKey) return json({ reply: "Access denied." }, 403);
      const r = await db(sid ? `ami_calls?call_sid=eq.${encodeURIComponent(sid)}&select=call_sid,kind,orders` : "ami_calls?orders_status=eq.awaiting&select=call_sid,kind,orders&order=sent_at.desc&limit=1");
      const p = r.ok ? (await r.json())[0] : null;
      if (!p) return json({ reply: "Nothing is waiting for confirmation." });
      await db(`ami_calls?call_sid=eq.${encodeURIComponent(p.call_sid)}`, { method: "PATCH", body: JSON.stringify({ orders_status: "confirmed" }) });
      const res = await scheduleOrders(p.kind, String(p.orders || ""));
      return json({ reply: res });
    }

    // "clear chat" / "new chat" wipes this section's conversation history (long-term memory is kept)
    if (!image && /^\s*(clear|reset|new)\s+chat\s*$/i.test(message)) {
      const d = await db(`ami_messages?user_email=eq.${encodeURIComponent(email)}&section=eq.${encodeURIComponent(section)}`, { method: "DELETE" });
      return json({ reply: d.ok ? `Fresh start, Chairman. ${section} chat history cleared. Long-term memory is untouched.` : `Could not clear the chat (database error ${d.status}).` });
    }

    // "ami status" shows which connections AMI can actually see (never the values)
    if (!image && /^\s*(ami\s+)?status\s*$/i.test(message)) {
      const has = (k: string) => (Deno.env.get(k) ? "✅" : "❌ missing");
      return json({ reply: `AMI status (v4.4 — drawing: plans, elevations, sections, 3D (PDF + AutoCAD), pricing database, direct Google, master brain, studio, calendar, inbox brief + buttons, to-do, phone calls, camera, voice):\n- ANTHROPIC_API_KEY: ${has("ANTHROPIC_API_KEY")}\n- TWILIO_ACCOUNT_SID: ${has("TWILIO_ACCOUNT_SID")}\n- TWILIO_AUTH_TOKEN: ${has("TWILIO_AUTH_TOKEN")}\n- Google direct (Gmail/Drive/Sheets/Calendar): ${googleReady() ? "✅" : "❌ keys missing"}\n- ZAPIER_MCP_URL: ${has("ZAPIER_MCP_URL")}\n- ZAPIER_MCP_TOKEN: ${has("ZAPIER_MCP_TOKEN")}\n- WhatsApp sending: ${TW_SID && TW_TOKEN ? "direct via Twilio ✅" : "via Zapier only"}\n- Sender: ${TW_FROM}\n- Company brain: ${brain ? "loaded (" + brain.updated + ") ✅" : "❌ not loaded"}` });
    }

    // The main job. Background jobs (morning brief, call orders) run after we answer, so the 150-second gateway limit never cuts them off.
    const work = async (): Promise<Response> => { try {
    // Think Tank only when the message STARTS with it (or the Think Tank section is used)
    const deep = /^\s*(🧠\s*)?think\s*tank\b/i.test(message) || section === "Think Tank";
    // Server-side YES check for messages to other people
    const saidYes = /^\s*(yes|yes,|yes\.|yes please|yes send|send it|go ahead|confirm(ed)?|approved?|ok send)\b/i.test(message);

    // background jobs (brief, call orders) start clean: old chat must never be passed off as fresh results
    const history = hRes.ok && !(internalKey && (storeKey || (deliver === "whatsapp" && section !== "WhatsApp"))) ? (await hRes.json()).reverse() : [];
    const facts = mRes.ok ? (await mRes.json()).map((r: any) => r.fact) : [];
    while (history.length && history[0].role !== "user") history.shift();
    // Studio buttons (Render / 3D / Adjust): start clean so old chat in the section can't turn the job into questions
    const studioBtn = !!image && /^\s*(Turn this sketch|Clean up and adjust this sketch)/i.test(message);
    if (studioBtn) history.length = 0;

    // Camera: a photo goes in as an image block alongside the text
    const userContent: any = image
      ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } }, { type: "text", text: message }]
      : message;
    const msgs: any[] = [...history.map((m: any) => ({ role: m.role, content: m.content })), { role: "user", content: userContent }];
    const tools: any[] = [
      { type: "web_search_20250305", name: "web_search", max_uses: deep ? 10 : 5 },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: deep ? 6 : 3 },
      { name: "save_memory", description: "Save one lasting fact about the Chairman, his companies, people (including phone numbers) or preferences to long-term memory.",
        input_schema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] } },
    ];
    // Direct WhatsApp only when Twilio keys are saved; otherwise AMI uses Zapier's Twilio action.
    if (TW_SID && TW_TOKEN) tools.push({ name: "send_whatsapp", description: "Send a WhatsApp message from AMI's number. To the Chairman himself: send directly. To anyone else: only after he has replied YES to the exact draft. Phone in international format, e.g. +231777123456.",
      input_schema: { type: "object", properties: { to: { type: "string", description: "Recipient phone, international format" }, message: { type: "string" } }, required: ["to", "message"] } });
    const mcpUrl = Deno.env.get("ZAPIER_MCP_URL"), mcpToken = Deno.env.get("ZAPIER_MCP_TOKEN");
    const GOOGLE = googleReady();

    // Voice mode: fast model, short spoken replies; Zapier only when the request needs his apps
    const fast = voice && !deep && !image && !studio;
    // Connect his apps (Zapier: Gmail, Drive, Calendar…) only when the request needs them — saves ~10 seconds otherwise
    const needApps = deliver === "whatsapp" || studio || !!company || !!storeKey || /mail|inbox|whats ?app|message|send|text him|text her|drive|file|folder|archive|document|contract|letter|invoice|lease|report|pdf|quote|quotation|tender|bid|boq|price|pricing|prices|cost|costing|estimate|how much|rate for|supplier|calendar|meeting|schedule|appointment|zapier|doc\b|docs|sheet|spreadsheet|print/i.test(message);
    if (GOOGLE && needApps) tools.push(...GOOGLE_TOOLS);
    // Zapier now only for the Design Studio images (ChatGPT) — or for everything if the Google keys are missing
    const needMcp = studio || (!GOOGLE && needApps);
    const toolErrors: string[] = [];
    const toolsUsed: string[] = [];
    const brainReadIds = new Set<string>(); let brainTabs: any = null;
    const confirmed: string[] = [];
    let toolText = ""; // every tool result, to check links in the reply are real
    let sendAttempted = false;
    let data: any = null;
    let useFast = fast;
    const needDigest = storeKey === "inbox_brief";
    for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < 14; i++) {
      const body: any = {
        model: useFast ? "claude-haiku-4-5" : "claude-sonnet-4-5",
        max_tokens: deep ? 16000 : voice ? 600 : company ? 4000 : 2000,
        // standing instructions + brain cached (faster); today's date sent separately so the cache stays valid
        system: [{ type: "text", text: buildSystem(facts, deep, voice && !deep, studio), cache_control: { type: "ephemeral" } },
                 { type: "text", text: `Today is ${new Date().toUTCString()} (Monrovia = UTC).` + COMPANY }],
        messages: msgs,
        tools,
      };
      if (deep) body.thinking = { type: "enabled", budget_tokens: 10000 };
      if (mcpUrl && needMcp) body.mcp_servers = [{ type: "url", url: mcpUrl, name: "zapier", ...(mcpToken ? { authorization_token: mcpToken } : {}) }];

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01",
          "anthropic-beta": "mcp-client-2025-04-04,web-fetch-2025-09-10,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await r.json();
      if (!r.ok && useFast) { useFast = false; i--; continue; } // fast model failed: retry once on the main model
      if (!r.ok) return json({ reply: "AI error: " + (data?.error?.message || r.status) }, 500);

      // Collect real errors from server-side tools (Zapier, web search/fetch)
      for (const b of data.content || []) {
        if (b.type === "mcp_tool_use" && /brain_read/.test(String(b.input?.action || ""))) brainReadIds.add(b.id);
        if (b.type === "mcp_tool_result" && brainReadIds.has(b.tool_use_id) && !b.is_error) {
          try { const t = Array.isArray(b.content) ? b.content.map((c: any) => c.text || "").join("") : String(b.content || ""); const j = JSON.parse(t); const d = j?.results?.data?.data || j?.results?.[0]?.data || j?.data?.data || j?.data; if (d?.tabs) brainTabs = d.tabs; } catch (_) {}
        }
        if (b.type === "mcp_tool_use") toolsUsed.push((b.name || "") + (b.input?.action ? ":" + String(b.input.action).replace(/^code_action_\w+?__/, "") : ""));
        if (b.type === "mcp_tool_use" && /whatsapp|sms|send_email|reply_to|forward/i.test(b.name || "")) sendAttempted = true;
        if (b.type === "mcp_tool_result") toolText += " " + (Array.isArray(b.content) ? b.content.map((c: any) => c.text || "").join(" ") : String(b.content || ""));
        if (b.type === "mcp_tool_result" && b.is_error) {
          const t = Array.isArray(b.content) ? b.content.map((c: any) => c.text || "").join(" ") : String(b.content || "");
          toolErrors.push("Zapier: " + t.slice(0, 300));
        }
        if ((b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result") && b.content?.type?.endsWith("error")) {
          toolErrors.push(`${b.type.replace("_tool_result", "")}: ${b.content.error_code || "error"}`);
        }
      }

      if (internalKey) console.log("ai round", i, data.stop_reason, "tools so far:", toolsUsed.join(","), "usage:", JSON.stringify(data.usage || {}));
      if (data.stop_reason === "pause_turn") { msgs.push({ role: "assistant", content: data.content }); continue; }
      if (data.stop_reason === "tool_use") {
        const uses = (data.content || []).filter((b: any) => b.type === "tool_use" && (b.name === "save_memory" || b.name === "send_whatsapp" || GOOGLE_NAMES.has(b.name)));
        if (!uses.length) break;
        const results: any[] = [];
        // Google tools run in parallel
        const gRes = new Map<string, any>();
        await Promise.all(uses.filter((u: any) => GOOGLE_NAMES.has(u.name)).map(async (u: any) => {
          toolsUsed.push(u.name);
          try { const out = await runGoogleTool(u.name, u.input || {}); let t = JSON.stringify(out); if (t.length > 60000) t = t.slice(0, 60000) + "…(cut)"; toolText += " " + t; gRes.set(u.id, { type: "tool_result", tool_use_id: u.id, content: t }); }
          catch (e) { const m = (e as Error).message; toolErrors.push(u.name + ": " + m.slice(0, 200)); gRes.set(u.id, { type: "tool_result", tool_use_id: u.id, content: "ERROR: " + m, is_error: true }); }
        }));
        for (const u of uses) {
          if (gRes.has(u.id)) { results.push(gRes.get(u.id)); continue; }
          if (u.name === "save_memory") {
            const fact = String(u.input?.fact || "").trim();
            if (!fact) { results.push({ type: "tool_result", tool_use_id: u.id, content: "Nothing to save.", is_error: true }); continue; }
            const w = await db("ami_memory", { method: "POST", body: JSON.stringify({ user_email: email, fact }) });
            if (w.ok) { facts.push(fact); results.push({ type: "tool_result", tool_use_id: u.id, content: "Saved to long-term memory." }); }
            else { toolErrors.push(`save_memory: database error ${w.status}`); results.push({ type: "tool_result", tool_use_id: u.id, content: `Save failed (database error ${w.status}).`, is_error: true }); }
          } else {
            const to = normPhone(u.input?.to);
            const text = String(u.input?.message || "").trim();
            if (!to || !text) { results.push({ type: "tool_result", tool_use_id: u.id, content: "Missing recipient or message.", is_error: true }); continue; }
            if (to !== SELF_WA && !saidYes) {
              results.push({ type: "tool_result", tool_use_id: u.id, is_error: true,
                content: `NOT SENT: messages to ${to} need the Chairman's YES first. Show him the exact draft and recipient, and ask him to reply YES.` });
              continue;
            }
            sendAttempted = true;
            const res = await sendWhatsApp(to, text);
            if (!res.ok) toolErrors.push("WhatsApp: " + res.info); else confirmed.push(res.info);
            results.push({ type: "tool_result", tool_use_id: u.id, content: res.info, ...(res.ok ? {} : { is_error: true }) });
          }
        }
        msgs.push({ role: "assistant", content: data.content });
        msgs.push({ role: "user", content: results });
        continue;
      }
      break;
    }
    // studio button but no image tool ran: try once more with a direct order
    if (studioBtn && attempt === 0 && !toolsUsed.some((t) => /image|edit/i.test(t))) {
      console.log("studio: image tool not called, retrying");
      msgs.splice(0, msgs.length, { role: "user", content: [userContent[0], { type: "text", text: message + "\n\nIMPORTANT: call create_image_edit NOW with the sketch link above, then drive_save_image. Do not ask questions. Do not write any link yourself." }] });
      toolErrors.length = 0; continue;
    }
    // the brief must come from Gmail itself: if the inbox tool never ran, try once more, then report it plainly
    if (needDigest && !toolsUsed.some((t) => /digest/i.test(t)) && attempt === 0) {
      console.log("brief: inbox_digest not called, retrying");
      msgs.splice(0, msgs.length, { role: "user", content: message + "\n\nIMPORTANT: call the inbox_digest tool now. Never answer from memory or earlier chats." });
      continue;
    }
    break;
    }
    const briefFailed = needDigest && !toolsUsed.some((t) => /digest/i.test(t));

    let text = (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim() || "No answer returned.";
    // the inbox brief ends with a REFS line (email ids) — kept for the Action button, not shown to him
    let refs = "";
    const refAt = text.lastIndexOf("REFS:");
    if (refAt >= 0) { refs = text.slice(refAt + 5).trim(); text = text.slice(0, refAt).trim(); }
    // Master Brain: compute Group Position from the sheet values (server-side arithmetic) and store it
    if (brainCfg) {
      if (brainTabs) {
        const pos = positionFromSheet(brainTabs, brainCfg.master_url || "");
        const w = await db("ami_brain", { method: "POST", body: JSON.stringify({ key: "group_position", data: pos, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates" } });
        await db("ami_brain", { method: "POST", body: JSON.stringify({ key: "brain_tabs", data: brainTabs, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates" } });
        text = (w.ok ? `✅ Group Position refreshed from the Master Brain sheet. Group net: ${pos.total.net < 0 ? "-" : ""}$${Math.abs(Math.round(pos.total.net)).toLocaleString("en-US")}.` : `⚠️ Read the sheet but could not save (database ${w.status}).`) + "\n" + text;
      } else text = "⚠️ Group Position NOT refreshed — the Master Brain sheet could not be read. Nothing was changed.\n" + text;
    }
    // Inbox Action: the to-dos also go into the To-do list tile
    if (internalKey && /^INBOX ACTIONS/.test(message)) {
      const at = text.lastIndexOf("TODO:");
      if (at >= 0) {
        const todo = text.slice(at + 5).split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter((l) => l && !/^none\.?$/i.test(l));
        text = text.slice(0, at).trim() + (todo.length ? "\n\n📋 To-do (added to your To-do list):\n" + todo.map((t, i) => `${i + 1}. ${t}`).join("\n") : "");
        if (todo.length) await db("ami_calls", { method: "POST", body: JSON.stringify({ call_sid: "inbox-" + Date.now(), kind: "inbox", turns: [], processed: true, confirmed: true,
          orders: todo.map((t, i) => `${i + 1}. ${t}`).join("\n"), summary: todo.join("; "), orders_status: "confirmed", sent_at: new Date().toISOString() }) });
      }
    }
    if (briefFailed) { text = "⚠️ No inbox brief this time, Chairman — I couldn't reach your Gmail (the inbox tool didn't run), so I'm not guessing. Tap Check now in the Inbox tile to retry." + (toolsUsed.length ? "\nTools that did run: " + toolsUsed.join(", ") : ""); refs = ""; }
    // Server-side verification: confirm real sends, flag claimed sends that never happened
    if (confirmed.length) text += "\n\n✅ Confirmed by Twilio:\n- " + confirmed.join("\n- ");
    if (!sendAttempted && /\b(sent|sending|delivered|i've sent|message (has been|was) sent)\b/i.test(text) && /whatsapp|message|email/i.test(text))
      toolErrors.push("No send was actually attempted in this reply. Nothing was sent. Ask again or type: ami status");
    // links: an image or Drive link must come from a tool result in this reply, otherwise it is invented — remove it
    const fake: string[] = [];
    text = text.replace(/https?:\/\/(?:drive\.google\.com|docs\.google\.com|cdn\.openai\.com|[\w.-]*oaiusercontent\.com|[\w.-]*oaidalleapi[\w.-]*|[\w.-]*\.blob\.core\.windows\.net)\/[^\s)\]"'<>]+/g, (u) => {
      const id = (u.match(/\/d\/([\w-]{20,})/) || u.match(/\/folders\/([\w-]{20,})/) || u.match(/[?&]id=([\w-]{20,})/) || [])[1];
      if (toolText.includes(u) || (id && (toolText.includes(id) || history.some((m: any) => String(m.content || "").includes(id)) || String(message || "").includes(id) || JSON.stringify(facts || "").includes(id) || BRAIN.includes(id) || COMPANY.includes(id) || STUDIO_RULE.includes(id)))) return u;
      fake.push(u); return "[link removed - not produced by a tool]"; });
    if (fake.length) toolErrors.push(`${fake.length} link(s) in this reply were not produced by any tool and were removed. Nothing was made or saved - ask again.`);
    // drawings: never claim a drawing is being made unless a drawing tool really ran
    if (!toolsUsed.some((t) => /draw_plan|draw_elevations/.test(t)) && /(being (re)?drawn|drawing (it|them) now|will (arrive|come) on whats ?app in about)/i.test(text) && /draw|plan|elevation|dxf|autocad/i.test(text))
      toolErrors.push("No drawing was actually started in this reply (the drawing tool did not run). Nothing is coming on WhatsApp. Ask again with the word 'draw'.");
    if (toolErrors.length) text += "\n\n⚠️ System check — tool errors:\n- " + [...new Set(toolErrors)].join("\n- ");

    // History stores text only (photos are not kept), so memory stays small
    const save = db("ami_messages", { method: "POST", body: JSON.stringify([
      { user_email: email, section, role: "user", content: image ? "📷 [photo] " + message : message },
      { user_email: email, section, role: "assistant", content: text },
    ]) }).catch(() => {});
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(save); else await save;

    // Keep a copy for the app (e.g. the morning inbox brief shown in the Inbox tile) — internal calls only
    if (storeKey && internalKey) await db("ami_brain", { method: "POST", body: JSON.stringify({ key: storeKey, data: { text, refs, status: briefFailed ? "failed" : "awaiting", at: new Date().toISOString() }, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates" } });

    // Phone-call orders: send the results to his WhatsApp (split into WhatsApp-size parts)
    if (deliver === "whatsapp") {
      const parts: string[] = [];
      let rest = (storeKey === "inbox_brief" ? "📥 AMI — morning inbox brief:\n\n" : section === "WhatsApp" ? "" : "📞 AMI — results:\n\n") + text;
      while (rest.length > 1500) { let cut = rest.lastIndexOf("\n", 1500); if (cut < 800) cut = 1500; parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); }
      parts.push(rest);
      let failed = "";
      const last = parts.length - 1;
      for (let pi = 0; pi < parts.length; pi++) {
        // the last part of the inbox brief carries the ✅ Noted / ⚡ Action buttons
        if (storeKey === "inbox_brief" && !briefFailed && pi === last && parts[pi].length <= 1000) {
          const sidT = await inboxTemplate();
          if (sidT) { const r = await twilio("Messages.json", new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF_WA}`, ContentSid: sidT, ContentVariables: JSON.stringify({ "1": parts[pi] }) })); if (r.ok) continue; }
          parts[pi] += "\n\nReply NOTED to empty the inbox, or ACTION to draft the replies first.";
        }
        const r = await sendWhatsApp(SELF_WA, parts[pi]); if (!r.ok) { failed = r.info; break; }
      }
      if (failed && TW_SID && TW_TOKEN) {
        // WhatsApp window closed: fall back to a short SMS pointing him to the app
        await twilio("Messages.json", new URLSearchParams({ From: TW_FROM, To: SELF_WA, Body: "AMI: results are ready in the AMI app (WhatsApp could not deliver: " + failed.slice(0, 80) + ")." }));
      }
    }
    if (internalKey) console.log("ai job done", storeKey || section, "tools:", toolsUsed.join(","));
    return json(internalKey ? { reply: text, tools_used: toolsUsed } : { reply: text });
    } catch (err) { console.log("ai job error", (err as Error).message); return json({ reply: "Server error: " + (err as Error).message }, 500); } };

    if (internalKey && (deliver === "whatsapp" || storeKey)) {
      const bg = (async () => {
        const r = await work();
        if (r.status >= 400) { const j: any = await r.json().catch(() => ({})); await sendWhatsApp(SELF_WA, "⚠️ AMI couldn't finish that job: " + String(j.reply || r.status).slice(0, 300)); }
      })();
      // @ts-ignore EdgeRuntime is provided by Supabase
      if (typeof EdgeRuntime !== "undefined") { EdgeRuntime.waitUntil(bg); return json({ queued: true }); }
      await bg; return json({ queued: true });
    }
    return await work();
  } catch (err) {
    return json({ reply: "Server error: " + (err as Error).message }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
