// AMI `tracksea` v1.0 (16 Nov 2026) — live container tracking straight from MSC (free, no tracking service).
// actions: {"action":"check"} = check every active B/L in track_watch, WhatsApp the Chairman only when something changed (run by cron every 6 h)
//          {"action":"status","number":"..."} = status text now (adds it to the watch list); {"action":"stop","number":"..."}
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const SELF = "+231777170170";
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) } });
const H = { "Content-Type": "application/json", "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest", "Origin": "https://www.msc.com", "Referer": "https://www.msc.com/en/track-a-shipment", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const nice = (d: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ""); return m ? `${+m[1]} ${MON[+m[2] - 1]} ${m[3]}` : d || "?"; };
const cap = (s: string) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/, (\w\w)$/i, (_, c) => ", " + c.toUpperCase());

async function msc(number: string) {
  for (const mode of ["0", "2", "1"]) { // 0 = B/L or container, 2 = container, 1 = booking
    const r = await fetch("https://www.msc.com/api/feature/tools/TrackingInfo", { method: "POST", headers: H, body: JSON.stringify({ trackingNumber: number, trackingMode: mode }), signal: AbortSignal.timeout(25000) });
    const j = await r.json().catch(() => null);
    if (j?.IsSuccess && j.Data?.BillOfLadings?.length) return j.Data;
  }
  return null;
}

// one WhatsApp-ready summary; the same text = nothing changed
function summarize(number: string, d: any, label?: string) {
  const bl = d.BillOfLadings[0], g = bl.GeneralTrackingInfo || {};
  const cs: any[] = bl.ContainersInfo || [];
  const lines: string[] = [];
  lines.push(`🚢 MSC ${d.TrackingType === "Bill Of Lading" ? "B/L" : d.TrackingType} ${number}${label ? " — " + label : ""}`);
  lines.push(`${cap(g.PortOfLoad || g.ShippedFrom)} → ${cap(g.PortOfDischarge || g.ShippedTo)}${(g.Transshipments || []).length ? " via " + g.Transshipments.map(cap).join(", ") : ""}`);
  const groups = new Map<string, string[]>();
  for (const c of cs) {
    const ev = (c.Events || []).slice().sort((a: any, b: any) => b.Order - a.Order);
    const actual = ev.find((e: any) => !/estimated/i.test(e.Description));
    const eta = ev.find((e: any) => /estimated time of arrival/i.test(e.Description));
    const line = actual ? `${actual.Description} — ${cap(actual.Location)}, ${nice(actual.Date)}${actual.Detail?.[0] && !/LADEN|EMPTY/.test(actual.Detail[0]) ? " (" + actual.Detail.join(" ") + ")" : ""}` : "No movement yet";
    const key = line + (c.Delivered ? " ✅ delivered" : "") + (eta ? `|ETA ${cap(eta.Location)} ${nice(eta.Date)}${eta.EquipmentHandling?.Name ? " — " + cap(eta.EquipmentHandling.Name) : ""}` : "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(`${c.ContainerNumber} (${String(c.ContainerType || "").replace(/'/g, "ft").toLowerCase()})`);
  }
  for (const [k, list] of groups) {
    const [now, eta] = k.split("|");
    lines.push(`\n📦 ${list.join(", ")}\nNow: ${now}${eta ? "\n⏱ " + eta : ""}`);
  }
  if (g.FinalPodEtaDate) lines.push(`\nFinal ETA at ${cap(g.PortOfDischarge)}: ${nice(g.FinalPodEtaDate)}`);
  return lines.join("\n");
}

async function sendSelf(text: string) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { method: "POST",
    headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: text.slice(0, 1500) }) });
  return r.ok;
}

Deno.serve(async (req) => {
  const kr = await db("ami_settings?key=eq.wake_key&select=value");
  const wk = kr.ok ? (await kr.json())[0]?.value : "";
  if (!wk || req.headers.get("x-internal-key") !== wk) return new Response("denied", { status: 403 });
  const p = await req.json().catch(() => ({}));
  try {
    if (p.action === "status") {
      const number = String(p.number || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!number) return Response.json({ reply: "Send a B/L or container number." });
      const d = await msc(number);
      if (!d) return Response.json({ reply: `🚢 ${number}: MSC has no tracking for this number. Check it is complete and correct (MSC only for now).` });
      const row = await db(`track_watch?number=eq.${number}&select=label`); const label = row.ok ? (await row.json())[0]?.label : "";
      const text = summarize(number, d, label);
      await db("track_watch", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ number, carrier: "MSC", active: true, last_summary: text, last_checked: new Date().toISOString() }) });
      return Response.json({ reply: text + "\n\nI'll WhatsApp you whenever it moves." });
    }
    if (p.action === "stop") {
      const number = String(p.number || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      await db(`track_watch?number=eq.${number}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
      return Response.json({ reply: `Stopped tracking ${number}.` });
    }
    // check all
    const r = await db("track_watch?active=eq.true&select=number,label,last_summary");
    const rows: any[] = r.ok ? await r.json() : [];
    const changed: string[] = [];
    for (const w of rows) {
      const d = await msc(w.number).catch(() => null);
      if (!d) continue;
      const text = summarize(w.number, d, w.label);
      const delivered = (d.BillOfLadings[0].ContainersInfo || []).every((c: any) => c.Delivered);
      await db(`track_watch?number=eq.${w.number}`, { method: "PATCH", body: JSON.stringify({ last_summary: text, last_checked: new Date().toISOString(), ...(delivered ? { active: false } : {}) }) });
      if (p.force || text !== w.last_summary) { await sendSelf("🔔 Container update\n\n" + text + (delivered ? "\n\n✅ All delivered — tracking stopped." : "")); changed.push(w.number); }
    }
    return Response.json({ checked: rows.length, changed });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
