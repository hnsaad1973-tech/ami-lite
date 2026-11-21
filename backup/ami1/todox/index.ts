// todox v1.0 — To-do list extras: list (with urgent flags), ⚠️ Urgent toggle, WhatsApp "To-do list:" replies, urgent reminders.
// App calls: POST {token, action:"list"|"urgent", call_sid, item, on}. Internal (x-internal-key): {action:"add_list", text} | {action:"urgent_ping"}.
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374", SELF = "+231777170170", EMAIL = "hnsaad1973@gmail.com";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) } });
const wa = (text: string) => fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST",
  headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: text.slice(0, 1500) }) });
const clean = (l: string) => l.replace(/^\d+[.)]\s*|^[-•*]\s*/, "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const raw = await req.text(); let b: any = {}; try { b = JSON.parse(raw); } catch (_) {}
    const ik = req.headers.get("x-internal-key") || "";
    if (ik) {
      const k = await (await db("ami_settings?key=eq.wake_key&select=value")).json();
      if (!k?.[0]?.value || ik !== k[0].value) return json({ error: "denied" }, 403);
    } else {
      const u = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: "Bearer " + (b.token || ""), apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } });
      const user = u.ok ? await u.json() : null;
      if (!user || String(user.email || "").toLowerCase() !== EMAIL) return json({ reply: "Not signed in." }, 401);
    }

    if (b.action === "list") {
      const r = await db("ami_calls?orders=not.is.null&orders_status=neq.cancelled&orders_status=neq.superseded&select=call_sid,kind,orders,orders_status,sent_at,done_items,urgent_items&order=sent_at.desc&limit=15");
      return json({ lists: r.ok ? await r.json() : [] });
    }

    if (b.action === "urgent") {
      const sid = String(b.call_sid || ""), item = String(b.item || "").trim(), on = !!b.on;
      const r = await db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}&select=urgent_items`);
      const row = r.ok ? (await r.json())[0] : null;
      if (!row || !item) return json({ reply: "Item not found." }, 404);
      const cur: string[] = Array.isArray(row.urgent_items) ? row.urgent_items : [];
      const next = on ? [...new Set([...cur, item])] : cur.filter((x) => x !== item);
      await db(`ami_calls?call_sid=eq.${encodeURIComponent(sid)}`, { method: "PATCH", body: JSON.stringify({ urgent_items: next }) });
      if (on && !cur.includes(item)) await wa(`⚠️ URGENT — ${clean(item)}`);
      return json({ ok: true, urgent_items: next });
    }

    // WhatsApp reply "To-do list: ..." -> tomorrow's list in the To-do tile. Lines starting with "!" or containing "urgent" are flagged urgent.
    if (b.action === "add_list") {
      const body = String(b.text || "").replace(/^\s*to-?\s*do(\s*list)?\s*[:\-–]?\s*/i, "");
      let lines = body.split(/\n|;/).map((l) => clean(l)).filter(Boolean);
      if (lines.length === 1 && lines[0].includes(",")) lines = lines[0].split(",").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return json({ reply: "I didn't see any items, Chairman. Send: To-do list: then one item per line." });
      const items = lines.map((l, i) => `${i + 1}. ${l.replace(/^!\s*/, "").replace(/\s*\(?urgent\)?\s*$/i, "").trim()}`);
      const urgent = items.filter((_, i) => /^!|\burgent\b/i.test(lines[i]));
      const now = new Date().toISOString();
      const w = await db("ami_calls", { method: "POST", body: JSON.stringify({ call_sid: "wa-" + Date.now(), kind: "evening", turns: [], processed: true, confirmed: true,
        orders: items.join("\n"), summary: items.join("; "), orders_status: "confirmed", sent_at: now, urgent_items: urgent }) });
      if (!w.ok) return json({ reply: "⚠️ Couldn't save the list (database " + w.status + ")." }, 500);
      return json({ reply: `✅ Tomorrow's to-do list saved — ${items.length} item${items.length > 1 ? "s" : ""}${urgent.length ? `, ${urgent.length} urgent` : ""}. It will be in your 11:00 brief and the To-do tile.` });
    }

    // during the day: only open urgent items (cron 13:00 and 16:00)
    if (b.action === "urgent_ping") {
      const r = await db(`ami_calls?orders=not.is.null&orders_status=eq.confirmed&sent_at=gte.${new Date(Date.now() - 4 * 86400000).toISOString()}&select=orders,done_items,urgent_items`);
      const rows = r.ok ? await r.json() : [];
      const open: string[] = [];
      for (const x of rows) for (const u of (x.urgent_items || [])) if (!(x.done_items || []).includes(u)) open.push(clean(u));
      if (!open.length) return json({ sent: 0 });
      await wa("⚠️ Urgent — still open:\n" + [...new Set(open)].map((t, i) => `${i + 1}. ${t}`).join("\n"));
      return json({ sent: open.length });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
