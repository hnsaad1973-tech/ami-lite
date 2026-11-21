// AMI Commercial — `ask` v2.1 (16 Nov 2026) — weekday fix: AMI reads dates from a 14-day table instead of working them out. v2.0: supplier invoices posted to inventory from a photo; never describes photos it cannot see; follow-ups keep the last photo; Clear chat; receipts; stock, sales, petty cash; double-entry tools; records; to-do
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
});
const rpc = (fn: string, body: unknown) => fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const SECTIONS = ["calendar", "clients", "orders", "lookbook", "fabrics", "social", "contacts", "notes"];
const FIELDS = ["title", "notes", "client", "on_date", "at_time", "amount", "paid", "currency", "kind", "done"];
function clean(inp: any) {
  const o: any = {};
  for (const k of FIELDS) {
    if (inp?.[k] === undefined || inp?.[k] === null || inp?.[k] === "") continue;
    let v = inp[k];
    if (k === "on_date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) continue;
    if (k === "at_time" && !/^\d{1,2}:\d{2}$/.test(String(v))) continue;
    if ((k === "amount" || k === "paid") && !isFinite(+v)) continue;
    if (k === "currency" && !["USD", "LRD", "SLE"].includes(String(v).toUpperCase())) continue;
    if (k === "amount" || k === "paid") v = +v; else if (k === "done") v = v === true; else if (k === "currency") v = String(v).toUpperCase(); else v = String(v).slice(0, k === "notes" ? 4000 : 300);
    o[k] = v;
  }
  return o;
}

const ACC_TOOLS = ["book_money", "make_invoice", "pay_invoice", "transfer", "accounts_report", "list_invoices", "list_stock", "add_stock_item", "buy_stock", "adjust_stock", "sell"];
const d8 = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : new Date().toISOString().slice(0, 10);
async function rpcJ(fn: string, body: unknown) {
  const r = await rpc(fn, body); const t = await r.text(); let j: any = t; try { j = JSON.parse(t); } catch (_) {}
  if (!r.ok) throw new Error((j && j.message) || t || String(r.status));
  return j;
}
async function findItem(org: string, name: string): Promise<any> {
  const r = await db(`acc_items?org_id=eq.${org}&active=eq.true&select=id,name,unit,qty,avg_cost,sale_price`); const all: any[] = r.ok ? await r.json() : [];
  const n = String(name || "").trim().toLowerCase(); if (!n) throw new Error("Item name is needed");
  const exact = all.filter(i => i.name.toLowerCase() === n); if (exact.length === 1) return exact[0];
  const part = all.filter(i => i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase()));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new Error(`Several items match "${name}": ${part.map(i => i.name).join(", ")}. Ask which one.`);
  throw new Error(`No stock item called "${name}". Items: ${all.map(i => i.name).join(", ") || "none yet"}. Ask whether to add it with add_stock_item.`);
}
async function runAcc(name: string, inp: any, org: string): Promise<string> {
  if (name === "list_stock") { const r = await db(`acc_items?org_id=eq.${org}&active=eq.true&select=name,unit,qty,avg_cost,sale_price&order=name`); return r.ok ? JSON.stringify(await r.json()) : "Could not read stock."; }
  if (name === "add_stock_item") { const id = await rpcJ("acc_item_save", { p_org: org, p_id: null, p_name: inp.name, p_sku: inp.code || null, p_unit: inp.unit || "pcs", p_sale_price: +inp.sale_price || 0, p_active: true });
    if (+inp.opening_qty > 0) await rpcJ("acc_stock_adjust", { p_org: org, p_item: id, p_date: d8(inp.date), p_qty_change: +inp.opening_qty, p_reason: "opening", p_unit_cost: +inp.unit_cost, p_memo: null });
    return `Added item ${inp.name}${+inp.opening_qty > 0 ? ` with ${inp.opening_qty} in stock at ${inp.unit_cost} each` : ""}.`; }
  if (name === "buy_stock") { const it = await findItem(org, inp.item);
    await rpcJ("acc_stock_buy", { p_org: org, p_item: it.id, p_date: d8(inp.date), p_qty: +inp.qty, p_unit_cost: +inp.unit_cost, p_paid_code: inp.paid_from ? String(inp.paid_from) : null, p_party: inp.supplier || null, p_memo: null });
    return `Bought ${inp.qty} ${it.unit} ${it.name} at ${inp.unit_cost} each${inp.paid_from ? ` paid from ${inp.paid_from}` : " on credit (supplier bill created)"}. Stock now ${+it.qty + +inp.qty}.`; }
  if (name === "adjust_stock") { const it = await findItem(org, inp.item); const q = Math.abs(+inp.qty);
    await rpcJ("acc_stock_adjust", { p_org: org, p_item: it.id, p_date: d8(inp.date), p_qty_change: inp.reason === "damage" ? -q : q, p_reason: inp.reason, p_unit_cost: inp.unit_cost ? +inp.unit_cost : null, p_memo: inp.note || null });
    return `Stock of ${it.name} adjusted (${inp.reason}) by ${inp.reason === "damage" ? -q : q}.`; }
  if (name === "sell") { const lines: any[] = [];
    for (const l of (inp.lines || [])) { if (l.item) { const it = await findItem(org, l.item); lines.push({ item_id: it.id, qty: +l.qty || 1, price: l.price != null ? +l.price : null }); }
      else lines.push({ description: String(l.description || "Service"), qty: +l.qty || 1, price: +l.price || 0, account_code: l.account || null }); }
    const r = await rpcJ("acc_sale", { p_org: org, p_date: d8(inp.date), p_party: inp.customer || null, p_lines: lines, p_paid_code: inp.paid_into ? String(inp.paid_into) : null, p_due: /^\d{4}-\d{2}-\d{2}$/.test(String(inp.due_date || "")) ? inp.due_date : null, p_note: inp.note || null });
    return `Sale ${r.number}: total ${r.total}, cost of goods ${r.cost}, ${r.paid ? "paid" : "on credit"}. Stock taken off automatically. The invoice${r.paid ? " and receipt" : ""} can be printed in Accounting > Invoices.`; }
  if (name === "book_money") { await rpcJ("acc_money", { p_org: org, p_dir: inp.dir, p_date: d8(inp.date), p_amount: +inp.amount, p_paid_code: String(inp.account), p_category_code: String(inp.category), p_party: inp.party || null, p_memo: inp.memo || null }); return `Booked: money ${inp.dir} ${inp.amount} (${inp.account} / ${inp.category}).`; }
  if (name === "make_invoice") { await rpcJ("acc_invoice", { p_org: org, p_kind: inp.kind, p_party: inp.party, p_date: d8(inp.date), p_due: /^\d{4}-\d{2}-\d{2}$/.test(String(inp.due_date || "")) ? inp.due_date : null, p_desc: inp.description || null, p_amount: +inp.amount, p_account_code: inp.category || null });
    const r = await db(`acc_invoices?org_id=eq.${org}&kind=eq.${inp.kind}&select=number&order=created_at.desc&limit=1`); const n = r.ok ? (await r.json())[0]?.number : ""; return `Created ${n} for ${inp.party}: ${inp.amount}.`; }
  if (name === "pay_invoice") { const r = await db(`acc_invoices?org_id=eq.${org}&number=eq.${encodeURIComponent(String(inp.number).toUpperCase())}&select=id`); const id = r.ok ? (await r.json())[0]?.id : null;
    if (!id) throw new Error("No invoice or bill numbered " + inp.number); await rpcJ("acc_pay", { p_org: org, p_invoice: id, p_date: d8(inp.date), p_amount: +inp.amount, p_paid_code: String(inp.account) }); return `Payment of ${inp.amount} recorded on ${inp.number}.`; }
  if (name === "transfer") { await rpcJ("acc_transfer", { p_org: org, p_date: d8(inp.date), p_amount: +inp.amount, p_from: String(inp.from), p_to: String(inp.to), p_memo: inp.memo || null }); return `Transferred ${inp.amount} from ${inp.from} to ${inp.to}.`; }
  if (name === "accounts_report") { const to = d8(inp.to); const from = inp.kind === "pl" ? (/^\d{4}-\d{2}-\d{2}$/.test(String(inp.from || "")) ? inp.from : to.slice(0, 8) + "01") : null;
    return JSON.stringify(await rpcJ("acc_report", { p_org: org, p_kind: inp.kind, p_from: from, p_to: to })); }
  if (name === "list_invoices") { const k = inp.kind === "sale" || inp.kind === "bill" ? `&kind=eq.${inp.kind}` : "";
    const r = await db(`acc_invoice_status?org_id=eq.${org}${k}&select=number,kind,party,inv_date,due_date,description,total,paid,balance,state&order=inv_date.desc&limit=100`); return r.ok ? JSON.stringify(await r.json()) : "Could not read invoices."; }
  return "Unknown tool.";
}

const TRADE: Record<string, string> = {
  fashion: `TRADE: this is a FASHION business: styling clients and designing/making clothes (stylist, designer, tailor).
You are an experienced fashion business assistant. You know styling (body shapes, colour, occasion dressing, wardrobe edits, shoots and events), design and making (sketch briefs, fabrics and their uses, linings and trims, yardage estimates, fittings, alterations, production timelines) and the business side (pricing an order = fabric + trims + labour hours + overhead + margin; deposits, usually 50% up front; balance on collection; client records with measurements; order tracking; social media for fashion: Instagram and TikTok captions, hashtags, content ideas, lookbooks).
Know the local scene: West African fashion, Ankara/wax print, lappa, kaftans, agbada, Liberian and Sierra Leonean occasions (weddings, church, graduations, Independence Day), tailors and fabric markets; prices often in USD and LRD.
Measurements: when the user gives client measurements, save them in the clients section with add_item (title = client name, notes = measurements and preferences); if the client already exists, update_item her notes. When estimating fabric, show your working and label it "estimate".
Write captions and client messages in a warm, stylish voice. Keep advice practical for a small fashion business.`,
  construction: "TRADE: this is a CONSTRUCTION business: quotes, BOQs, materials, site work, subcontractors.",
  property: "TRADE: this is a PROPERTY business: tenants, leases, rent collection, maintenance.",
  retail: "TRADE: this is a SHOP / TRADING business: stock, suppliers, sales, margins.",
  beauty: "TRADE: this is a SALON / BEAUTY business: appointments, clients, products, staff.",
};

function system(company: string, name: string, trade: string, facts: string[]) {
  return `You are AMI, a business assistant for ${name || "the user"} at ${company}. You work for this company only.
${TRADE[trade] || ""}
STYLE: warm, short and direct. Lead with the answer. A few short lines unless asked for detail.
HONESTY: never invent facts, figures, names or dates. If unsure, say "I'm not sure" and what you need. Label estimates as "estimate".
PRIVACY: you only know what this user tells you and what is saved for this company. Never mention other customers.
You can draft emails, letters, contracts, client messages and social posts; plan and organise work; explain business, tax and accounting questions (say you are not a lawyer or accountant where it matters); and use web search for anything current.
TO-DO LIST: the user's to-do list lives in AMI. When they ask to add, make or turn something into a to-do list, call add_tasks (one item per task; due_date YYYY-MM-DD only if a day is stated or clearly implied, using today's date below; urgent true only if they say urgent/asap). To see the list use list_tasks; to tick one off use complete_task. After adding, confirm in one short line how many tasks were added and that they are in the To-do list section.
RECORDS: every section of the app keeps real records. Use add_item to save one when the user asks (or clearly wants it saved): section "calendar" (meetings, fittings, events: title, on_date, at_time), "clients" (title = client name, notes = measurements/sizes/preferences, client phone in kind), "orders" (title = what is being made, client, on_date = due date, amount = price, paid = deposit/paid so far, notes = fabric/fitting details), "lookbook" (design ideas: title, notes), "fabrics" (stock/supplies: title, notes = quantity/supplier, amount = cost), "social" (posts: title, notes = caption, on_date = post date), "contacts" (people/suppliers: title = name, notes = phone/details). Currency USD unless they say LRD or SLE. Use list_items to look things up (e.g. balances owed = orders amount minus paid) and update_item to change one (e.g. record a payment or mark done). Confirm in one short line what was saved and in which section.
ACCOUNTING (proper double-entry books; never use add_item for money): 
- Money accounts: 1000 Cash on hand, 1005 Petty cash, 1010 Bank, 1020 Mobile money. Small office spending usually comes from 1005 Petty cash; top it up with transfer (e.g. 1010 -> 1005).
- Selling goods or services: ALWAYS use sell (not book_money), with one line per item; stock items are taken off automatically and their cost of goods sold is booked. paid_into = money account if paid now; leave it out for a sale on credit (customer name needed). A service line has description + price (default income 4100).
- Stock: list_stock to see items, quantities, costs; add_stock_item for a new item (with opening_qty + unit_cost for stock already held); buy_stock when buying stock to sell (paid_from = money account, or leave out with supplier for credit); adjust_stock for a stock count (count), damaged/lost/used (damage) or opening stock. Never book stock purchases with book_money.
- Money received now that is not a sale: book_money dir "in" (account = 1000/1005/1010/1020; category = income account, 4100 Service income or 4900 Other income, or 2100 Loans / 3000 Owner's capital).
- Money paid now: book_money dir "out" (account = 1000/1005/1010/1020; category = expense account: 6000 Rent, 6010 Salaries, 6020 Electricity and water, 6030 Fuel and transport, 6040 Phone and internet, 6050 Office supplies, 6060 Repairs, 6070 Marketing, 6080 Bank charges, 6090 Taxes and licences, 6990 Other; or 1500 Equipment, 3100 Owner's drawings, 2100 Loans repaid).
- A one-line invoice for a customer who pays later: make_invoice kind "sale"; a supplier bill to pay later: make_invoice kind "bill". When paid: pay_invoice with its number (INV-0001 / BILL-0001).
- Moving money between cash, petty cash, bank and mobile money: transfer. Reports: accounts_report (pl, bs, tb, cash). Invoices list: list_invoices.
- If an item name is unclear or several match, ask which one. Confirm totals back in one short line. Invoices and receipts are printed from Accounting > Invoices.
- If the account is unclear (cash or bank?), ask one short question before booking. Use today's date unless another date is given. After booking, confirm in one line: what was booked, amount, accounts. Never invent amounts.
PHOTOS (receipts, supplier invoices, price lists):
- SEEING: only describe a photo that is actually attached to this conversation. Older photos marked "(no longer shown)" are NOT visible: never describe, quote or guess their contents; ask the user to snap them again. If no photo is visible, say so. Never make up a shop name, item or amount.
- SHOP RECEIPT (paid expense): read the shop, date, items, total and currency, then book it straight away: one book_money dir "out" with the best expense category, party = shop name, memo = what was bought, date = the receipt date. Paid from: what the user says; if nothing, up to 100 USD (or the same value in LRD/SLE) from 1005 Petty cash; for larger amounts ask one short question (cash, bank or mobile money?) and list what you read.
- SUPPLIER INVOICE, PROFORMA or goods bought to resell, or the user says "create inventory", "add to stock" or "post": post it without asking for selling prices. For each line: if the item is not in list_stock, add_stock_item (name as on the invoice, unit, code if shown); then buy_stock with the quantity and unit cost from the invoice, supplier = issuer, date = invoice date. Paid from: what the user says; if nothing, leave paid_from out so it is booked on credit as a supplier bill. Then reply with one line per item (qty x unit cost) and the total, and say it is in Accounting > Stock and Bills.
- PRICE LIST or quote with no quantities: list the items and prices you read, then ask only which items and how many were bought; when told, post them as a supplier invoice above.
- A bill not for stock (e.g. electricity, rent): make_invoice kind "bill" with the due date if shown.
- The most recent photo stays attached, so a follow-up like "post", "send to accounts" or "paid by bank" refers to it: act on it without asking the user to repeat what is in it.
- If the total or a number cannot be read, say which part you cannot read and ask; never guess an amount.
- After booking reply in 2 to 4 short lines and say the photo is saved in Documents.
MEMORY: use save_memory when the user says "remember" or shares a lasting fact about their business, clients, people or preferences. Never save passwords, card or ID numbers.
${facts.length ? "WHAT YOU KNOW ABOUT THIS COMPANY:\n- " + facts.join("\n- ") : ""}`;
}

// v2.1: a ready-made table of the next 14 dates with weekday names, so AMI never counts weekdays itself.
function dateGuide(now = new Date()): string {
  const W = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows: string[] = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date(base + i * 86400000);
    const tag = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    rows.push(`- ${W[d.getUTCDay()]} ${d.toISOString().slice(0, 10)}${tag}`);
  }
  return `Today is ${W[now.getUTCDay()]} ${now.toISOString().slice(0, 10)}, time ${now.toISOString().slice(11, 16)} (Monrovia, GMT).
DATES: never work out a weekday or date yourself; read it from this table.
${rows.join("\n")}
A weekday name ("Friday") means the next one AFTER today in this table; "next Friday" means the same; if they name today's weekday, use today only if they say "today", otherwise the one a week later. "This weekend" = the coming Saturday. Always confirm the saved date with its weekday, e.g. "Fri 20 Nov".`;
}

function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function loadPhoto(org: string, name: string): Promise<any> {
  try {
    const r = await db(`documents?org_id=eq.${org}&name=eq.${encodeURIComponent(name)}&select=storage_path,mime_type&order=created_at.desc&limit=1`);
    const d = r.ok ? (await r.json())[0] : null; if (!d) return null;
    const f = await fetch(`${SB}/storage/v1/object/customer-files/${encodeURI(d.storage_path)}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
    if (!f.ok) return null;
    const buf = await f.arrayBuffer(); if (buf.byteLength > 5000000) return null;
    const mt = /^image\/(jpeg|png|webp)$/.test(String(d.mime_type || "")) ? d.mime_type : "image/jpeg";
    return { type: "image", source: { type: "base64", media_type: mt, data: b64(buf) } };
  } catch (_) { return null; }
}

async function saveReceipt(org: string, user: string, img: any): Promise<string> {
  try {
    const bin = atob(img.data); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = img.media_type === "image/png" ? "png" : img.media_type === "image/webp" ? "webp" : "jpg";
    const name = `Receipt ${new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "h").replace(/h(\d\d)h(\d\d)$/, "h$1m$2")}.${ext}`;
    const path = `${org}/${Date.now()}-${name}`;
    const up = await fetch(`${SB}/storage/v1/object/customer-files/${encodeURI(path)}`, {
      method: "POST", headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": img.media_type, "x-upsert": "false" }, body: bytes,
    });
    if (!up.ok) return "";
    const w = await db("documents", { method: "POST", body: JSON.stringify({ org_id: org, uploaded_by: user, name, mime_type: img.media_type, size_bytes: bytes.length, storage_path: path }) });
    return w.ok ? name : "";
  } catch (_) { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
    if (!ur.ok) return json({ reply: "Please sign in again." }, 401);
    const user = await ur.json();
    const p = await req.json().catch(() => ({}));
    const img = p.image && typeof p.image.data === "string" && /^image\/(jpeg|png|webp)$/.test(String(p.image.media_type || "")) ? p.image : null;
    if (img && img.data.length > 7000000) return json({ reply: "That photo is too large. Please try again." }, 400);
    let message = String(p.message || "").trim().slice(0, 8000);
    if (!message && img) message = "Here is a photo of a receipt or invoice. Read it and record it.";
    if (!message) return json({ reply: "Type a question first." }, 400);

    const mr = await db(`members?user_id=eq.${user.id}&select=org_id,full_name,chat_cleared_at,orgs(name,business_type)&limit=1`);
    const mem = mr.ok ? (await mr.json())[0] : null;
    if (!mem) return json({ reply: "Your account is not set up yet. Enter your invite code first." }, 403);
    const org = mem.org_id;

    const gate = await (await rpc("use_question", { p_org: org, p_user: user.id, p_ai_cost: 0 })).json().catch(() => ({}));
    if (!gate.allowed) {
      const why = gate.reason === "daily_cap" ? `You've used all ${gate.cap} questions for today. Your limit resets at midnight, or upgrade for more.`
        : gate.reason === "subscription_expired" ? "Your 30-day trial has ended. Choose a plan to keep using AMI."
        : "Your subscription is not active. Choose a plan to keep using AMI.";
      return json({ reply: why, blocked: gate.reason || "blocked" });
    }
    if (!AKEY) return json({ reply: "AMI is being set up — the AI key is not added yet.", used: gate.used, cap: gate.cap }, 503);

    const docName = img ? await saveReceipt(org, user.id, img) : "";

    const since = mem.chat_cleared_at ? `&created_at=gt.${encodeURIComponent(mem.chat_cleared_at)}` : "";
    const [hr, fr] = await Promise.all([
      db(`messages?org_id=eq.${org}&user_id=eq.${user.id}${since}&select=role,content&order=created_at.desc&limit=16`),
      db(`memory?org_id=eq.${org}&select=fact&order=created_at.asc&limit=300`),
    ]);
    const history = hr.ok ? (await hr.json()).reverse() : [];
    while (history.length && history[0].role !== "user") history.shift();
    const facts = fr.ok ? (await fr.json()).map((r: any) => r.fact) : [];
    const hist: any[] = history.map((m: any) => ({ role: m.role, content: m.content }));
    let shown = !!img;
    for (let i = hist.length - 1; i >= 0; i--) {
      const mm = hist[i].role === "user" ? /^\[Receipt photo: (.+?)\]/.exec(String(hist[i].content)) : null;
      if (!mm) continue;
      const ph = shown ? null : await loadPhoto(org, mm[1]);
      if (ph) { hist[i].content = [ph, { type: "text", text: String(hist[i].content) }]; shown = true; }
      else hist[i].content = String(hist[i].content).replace(/^\[Receipt photo: (.+?)\]/, "[Earlier photo $1 (no longer shown)]");
    }
    const userContent: any = img
      ? [{ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
         { type: "text", text: message + (docName ? `\n(The photo is saved in Documents as "${docName}".)` : "\n(The photo could not be saved in Documents.)") }]
      : message;
    const msgs: any[] = [...hist, { role: "user", content: userContent }];
    const tools: any[] = [
      { type: "web_search_20250305", name: "web_search", max_uses: 4 },
      { name: "save_memory", description: "Save one lasting fact about this company, its clients (e.g. measurements, preferences), people or the user's preferences.",
        input_schema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] } },
      { name: "add_tasks", description: "Add one or more tasks to this company's to-do list.",
        input_schema: { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, due_date: { type: "string", description: "YYYY-MM-DD or empty" }, urgent: { type: "boolean" } }, required: ["title"] } } }, required: ["tasks"] } },
      { name: "list_tasks", description: "List this company's open tasks (and recently done ones).", input_schema: { type: "object", properties: {} } },
      { name: "complete_task", description: "Mark a task done by its id (from list_tasks).", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "add_item", description: "Save one record in a section of the app.",
        input_schema: { type: "object", properties: { section: { type: "string", enum: SECTIONS }, title: { type: "string" }, notes: { type: "string" }, client: { type: "string" },
          on_date: { type: "string", description: "YYYY-MM-DD" }, at_time: { type: "string", description: "HH:MM" }, amount: { type: "number" }, paid: { type: "number" },
          currency: { type: "string", enum: ["USD", "LRD", "SLE"] }, kind: { type: "string" } }, required: ["section", "title"] } },
      { name: "list_items", description: "List records in one section (newest dates first).", input_schema: { type: "object", properties: { section: { type: "string", enum: SECTIONS } }, required: ["section"] } },
      { name: "book_money", description: "Book money received (in) or paid (out) now, as a balanced double-entry. Not for sales of goods (use sell) or stock purchases (use buy_stock).",
        input_schema: { type: "object", properties: { dir: { type: "string", enum: ["in", "out"] }, amount: { type: "number" }, account: { type: "string", description: "1000 cash, 1005 petty cash, 1010 bank or 1020 mobile money" },
          category: { type: "string", description: "income or expense account code" }, date: { type: "string", description: "YYYY-MM-DD" }, party: { type: "string" }, memo: { type: "string" } }, required: ["dir", "amount", "account", "category"] } },
      { name: "make_invoice", description: "Create a customer invoice (sale: they owe us) or a supplier bill (bill: we owe them).",
        input_schema: { type: "object", properties: { kind: { type: "string", enum: ["sale", "bill"] }, party: { type: "string" }, amount: { type: "number" }, description: { type: "string" },
          date: { type: "string" }, due_date: { type: "string" }, category: { type: "string", description: "income account for sales (default 4000), expense account for bills (default 6990)" } }, required: ["kind", "party", "amount"] } },
      { name: "pay_invoice", description: "Record a payment received for an invoice or paid for a bill.",
        input_schema: { type: "object", properties: { number: { type: "string", description: "e.g. INV-0001 or BILL-0002" }, amount: { type: "number" }, account: { type: "string", description: "1000, 1010 or 1020" }, date: { type: "string" } }, required: ["number", "amount", "account"] } },
      { name: "transfer", description: "Move money between cash (1000), petty cash (1005), bank (1010) and mobile money (1020).",
        input_schema: { type: "object", properties: { amount: { type: "number" }, from: { type: "string" }, to: { type: "string" }, date: { type: "string" }, memo: { type: "string" } }, required: ["amount", "from", "to"] } },
      { name: "accounts_report", description: "Accounting report: pl (profit and loss, needs from/to), bs (balance sheet as at to), tb (trial balance), cash (cash position, receivable, payable).",
        input_schema: { type: "object", properties: { kind: { type: "string", enum: ["pl", "bs", "tb", "cash"] }, from: { type: "string" }, to: { type: "string" } }, required: ["kind"] } },
      { name: "list_invoices", description: "List invoices and bills with paid amount, balance and state (open, overdue, paid, void).",
        input_schema: { type: "object", properties: { kind: { type: "string", enum: ["sale", "bill", "all"] } } } },
      { name: "list_stock", description: "List stock items with quantity on hand, average cost and selling price.", input_schema: { type: "object", properties: {} } },
      { name: "add_stock_item", description: "Add a new stock item, optionally with the quantity already held (opening stock).",
        input_schema: { type: "object", properties: { name: { type: "string" }, unit: { type: "string", description: "e.g. pcs, bag, carton, tin, kg, unit" }, sale_price: { type: "number" }, code: { type: "string" },
          opening_qty: { type: "number" }, unit_cost: { type: "number", description: "cost per unit of the opening stock" }, date: { type: "string" } }, required: ["name"] } },
      { name: "buy_stock", description: "Buy stock to sell: quantity goes up, average cost updates. Paid now (paid_from) or on credit (supplier, creates a bill).",
        input_schema: { type: "object", properties: { item: { type: "string", description: "item name" }, qty: { type: "number" }, unit_cost: { type: "number" }, paid_from: { type: "string", description: "1000, 1005, 1010 or 1020; leave out for credit" },
          supplier: { type: "string" }, date: { type: "string" } }, required: ["item", "qty", "unit_cost"] } },
      { name: "adjust_stock", description: "Adjust stock: count (found more), damage (damaged, lost or used: reduces stock), opening (opening stock).",
        input_schema: { type: "object", properties: { item: { type: "string" }, qty: { type: "number", description: "positive number of units" }, reason: { type: "string", enum: ["count", "damage", "opening"] },
          unit_cost: { type: "number" }, note: { type: "string" }, date: { type: "string" } }, required: ["item", "qty", "reason"] } },
      { name: "sell", description: "Record a sale with one or more lines. Stock items are taken off stock automatically with cost of goods sold. Creates a numbered invoice; if paid_into is given it is marked paid with a receipt.",
        input_schema: { type: "object", properties: { customer: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { item: { type: "string", description: "stock item name" }, description: { type: "string", description: "for a service line" },
          qty: { type: "number" }, price: { type: "number", description: "price each; leave out to use the item's selling price" }, account: { type: "string", description: "income account for a service line (default 4100)" } } } },
          paid_into: { type: "string", description: "1000, 1005, 1010 or 1020 if paid now; leave out for credit" }, due_date: { type: "string" }, date: { type: "string" }, note: { type: "string" } }, required: ["lines"] } },
      { name: "update_item", description: "Change a record by id (from list_items). Only send the fields to change; done true to mark it done.",
        input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, notes: { type: "string" }, client: { type: "string" }, on_date: { type: "string" }, at_time: { type: "string" },
          amount: { type: "number" }, paid: { type: "number" }, currency: { type: "string" }, kind: { type: "string" }, done: { type: "boolean" } }, required: ["id"] } },
    ];

    let data: any = null, inTok = 0, outTok = 0, tasksChanged = false;
    for (let i = 0; i < 10; i++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2000, system: system(mem.orgs?.name || "your company", mem.full_name || "", mem.orgs?.business_type || "general", facts) + "\n" + dateGuide(), messages: msgs, tools }),
      });
      data = await r.json();
      if (!r.ok) return json({ reply: "AI error: " + (data?.error?.message || r.status) }, 502);
      inTok += data.usage?.input_tokens || 0; outTok += data.usage?.output_tokens || 0;
      if (data.stop_reason === "pause_turn") { msgs.push({ role: "assistant", content: data.content }); continue; }
      if (data.stop_reason === "tool_use") {
        const uses = (data.content || []).filter((b: any) => b.type === "tool_use" && ["save_memory", "add_tasks", "list_tasks", "complete_task", "add_item", "list_items", "update_item", ...ACC_TOOLS].includes(b.name));
        if (!uses.length) break;
        const results: any[] = [];
        for (const u of uses) {
          if (u.name === "save_memory") {
            const fact = String(u.input?.fact || "").trim().slice(0, 500);
            const w = fact ? await db("memory", { method: "POST", body: JSON.stringify({ org_id: org, user_id: user.id, fact }) }) : null;
            results.push({ type: "tool_result", tool_use_id: u.id, content: w && w.ok ? "Saved." : "Not saved.", ...(w && w.ok ? {} : { is_error: true }) });
          } else if (u.name === "add_tasks") {
            const rows = (Array.isArray(u.input?.tasks) ? u.input.tasks : []).slice(0, 30).map((t: any) => ({
              org_id: org, created_by: user.id, title: String(t.title || "").trim().slice(0, 300),
              due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due_date || "")) ? t.due_date : null, urgent: t.urgent === true,
            })).filter((r: any) => r.title);
            const w = rows.length ? await db("tasks", { method: "POST", body: JSON.stringify(rows) }) : null;
            tasksChanged = tasksChanged || !!(w && w.ok);
            results.push({ type: "tool_result", tool_use_id: u.id, content: w && w.ok ? `Added ${rows.length} task(s).` : "Could not add tasks" + (w ? ` (database ${w.status})` : ""), ...(w && w.ok ? {} : { is_error: true }) });
          } else if (u.name === "list_tasks") {
            const r = await db(`tasks?org_id=eq.${org}&select=id,title,due_date,urgent,done&order=done.asc,urgent.desc,due_date.asc.nullslast&limit=60`);
            results.push({ type: "tool_result", tool_use_id: u.id, content: r.ok ? JSON.stringify(await r.json()) : "Could not read tasks.", ...(r.ok ? {} : { is_error: true }) });
          } else if (u.name === "add_item") {
            const sec = String(u.input?.section || ""); const row = { ...clean(u.input), org_id: org, created_by: user.id, section: sec };
            const ok = SECTIONS.includes(sec) && row.title;
            const w = ok ? await db("items", { method: "POST", body: JSON.stringify(row) }) : null;
            tasksChanged = tasksChanged || !!(w && w.ok);
            results.push({ type: "tool_result", tool_use_id: u.id, content: w && w.ok ? `Saved in ${sec}.` : "Not saved" + (w ? ` (database ${w.status})` : " (section or title missing)"), ...(w && w.ok ? {} : { is_error: true }) });
          } else if (u.name === "list_items") {
            const sec = String(u.input?.section || "");
            const r = SECTIONS.includes(sec) ? await db(`items?org_id=eq.${org}&section=eq.${sec}&select=id,title,notes,client,on_date,at_time,amount,paid,currency,kind,done&order=on_date.desc.nullslast,created_at.desc&limit=100`) : null;
            results.push({ type: "tool_result", tool_use_id: u.id, content: r && r.ok ? JSON.stringify(await r.json()) : "Could not read that section.", ...(r && r.ok ? {} : { is_error: true }) });
          } else if (ACC_TOOLS.includes(u.name)) {
            try { const out = await runAcc(u.name, u.input || {}, org); if (!["accounts_report", "list_invoices", "list_stock"].includes(u.name)) tasksChanged = true; results.push({ type: "tool_result", tool_use_id: u.id, content: out }); }
            catch (e) { results.push({ type: "tool_result", tool_use_id: u.id, content: "NOT booked: " + (e as Error).message, is_error: true }); }
          } else if (u.name === "update_item") {
            const id = String(u.input?.id || ""); const ch = { ...clean(u.input), updated_at: new Date().toISOString() };
            const w = /^[0-9a-f-]{36}$/.test(id) ? await db(`items?id=eq.${id}&org_id=eq.${org}`, { method: "PATCH", body: JSON.stringify(ch) }) : null;
            tasksChanged = tasksChanged || !!(w && w.ok);
            results.push({ type: "tool_result", tool_use_id: u.id, content: w && w.ok ? "Updated." : "Could not update it.", ...(w && w.ok ? {} : { is_error: true }) });
          } else {
            const id = String(u.input?.id || "");
            const w = /^[0-9a-f-]{36}$/.test(id) ? await db(`tasks?id=eq.${id}&org_id=eq.${org}`, { method: "PATCH", body: JSON.stringify({ done: true, done_at: new Date().toISOString() }) }) : null;
            tasksChanged = tasksChanged || !!(w && w.ok);
            results.push({ type: "tool_result", tool_use_id: u.id, content: w && w.ok ? "Marked done." : "Could not mark it done.", ...(w && w.ok ? {} : { is_error: true }) });
          }
        }
        msgs.push({ role: "assistant", content: data.content }, { role: "user", content: results });
        continue;
      }
      break;
    }
    const text = (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim() || "No answer returned.";
    const cost = Math.round(((inTok * 3 + outTok * 15) / 1e6) * 10000) / 10000;
    await Promise.all([
      db("messages", { method: "POST", body: JSON.stringify([
        { org_id: org, user_id: user.id, channel: "web", role: "user", content: img ? `[Receipt photo${docName ? ": " + docName : ""}] ${message}` : message },
        { org_id: org, user_id: user.id, channel: "web", role: "assistant", content: text },
      ]) }),
      rpc("add_ai_cost", { p_org: org, p_user: user.id, p_cost: cost }).catch(() => null),
    ]);
    return json({ reply: text, used: gate.used, cap: gate.cap, tasks_changed: tasksChanged || !!docName });
  } catch (e) {
    return json({ reply: "Server error: " + (e as Error).message }, 500);
  }
});
