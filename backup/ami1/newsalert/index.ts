// AMI `newsalert` — v1.2 (10 Nov 2026)
// Runs every 15 minutes (pg_cron, header x-wake-key). Reads world + market headlines,
// keeps only truly major / catastrophic events (or serious news in Liberia, Sierra Leone, Lebanon),
// and WhatsApps the Chairman once per story. Everything else is ignored.

const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SELF = "+231777170170";
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TW_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374";
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const FEEDS: [string, string][] = [
  ["BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"],
  ["Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"],
  ["The Guardian", "https://www.theguardian.com/world/rss"],
  ["BBC Africa", "https://feeds.bbci.co.uk/news/world/africa/rss.xml"],
  ["BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"],
  ["CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"],
];
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const unx = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
async function hash(s: string) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s.toLowerCase().replace(/\W+/g, " ").trim()));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const kr = await db("ami_settings?key=eq.wake_key&select=value");
  const KEY = kr.ok ? (await kr.json())[0]?.value || "" : "";
  if (!KEY || req.headers.get("x-wake-key") !== KEY) return json({ error: "forbidden" }, 403);
  let p: any = {}; try { p = await req.json(); } catch (_) {}

  // 1) collect headlines from the last 45 minutes
  const since = Date.now() - 45 * 60000;
  const items: { src: string; title: string; link: string; h: string }[] = [];
  await Promise.all(FEEDS.map(async ([src, url]) => {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 AMI" } }); if (!r.ok) return;
      const x = await r.text();
      for (const m of x.split(/<item[\s>]/i).slice(1, 30)) {
        const title = unx((m.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
        const link = unx((m.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
        const t = Date.parse(unx((m.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "")) || 0;
        if (title && (p.test || t >= since)) items.push({ src, title, link, h: await hash(title) });
      }
    } catch (_) {}
  }));
  if (!items.length) return json({ checked: 0 });

  // 2) drop stories already judged
  const hs = [...new Set(items.map((i) => i.h))];
  const sr = await db(`ami_news_seen?select=h&h=in.(${hs.join(",")})`);
  const seen = new Set(sr.ok ? (await sr.json()).map((x: any) => x.h) : []);
  const fresh = items.filter((i, k) => !seen.has(i.h) && items.findIndex((j) => j.h === i.h) === k).slice(0, 60);
  if (!fresh.length) return json({ checked: items.length, fresh: 0 });
  if (!p.test) await db("ami_news_seen", { method: "POST", body: JSON.stringify(fresh.map((i) => ({ h: i.h, title: i.title }))), headers: { Prefer: "resolution=ignore-duplicates" } });

  // 3) strict filter — only catastrophic / truly major events, or serious news where he has businesses
  const list = fresh.map((i, k) => `${k}. [${i.src}] ${i.title}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 600,
      system: `You screen headlines for a busy chairman with businesses in Liberia, Sierra Leone and Lebanon. Be VERY strict: he wants a WhatsApp only for news of world-changing or catastrophic scale — the kind that leads every bulletin worldwide. ALERT only for: a new war or a major military escalation between states; a terror attack or disaster with roughly 100+ deaths; a coup or sudden collapse of a government; assassination or sudden death of a major world leader; a global market crash or extreme move (major index down 4%+ in a day, oil up/down 10%+, a major bank or exchange collapse); a new pandemic or global emergency; or a SERIOUS national event in Liberia, Sierra Leone or Lebanon (coup, war, major unrest, currency collapse, airport/border closure, deadly disaster). Do NOT alert for: accidents or disasters with tens of deaths, ongoing conflicts with no major new escalation, elections, politics, opinion, features, sport, business or market news of normal size. When in doubt, do not alert. Most checks must return an empty list. Score each headline you would even consider from 1 to 10, where 10 = world-stopping (e.g. a war between major powers, a 9/11-scale attack, a global crash) and 9 = must interrupt him now; a deadly accident with under 50 deaths is at most 4. Return ONLY JSON: {"alerts":[{"i":<index>,"score":<1-10>,"why":"<5-10 words>"}]} listing only headlines scoring 8 or more.`,
      messages: [{ role: "user", content: list }] }),
  });
  const d = await r.json();
  const txt = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let alerts: any[] = [];
  try { alerts = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)).alerts || []; } catch (_) {}
  alerts = alerts.filter((a) => fresh[a.i] && +a.score >= 9).slice(0, 3);
  if (p.test) return json({ checked: items.length, fresh: fresh.length, alerts: alerts.map((a) => ({ ...fresh[a.i], why: a.why, score: a.score })) });

  // 4) WhatsApp each alert once
  const sent: string[] = [];
  for (const a of alerts) {
    const it = fresh[a.i];
    const body = `🚨 BREAKING — ${it.title}\n${a.why ? "(" + a.why + ")\n" : ""}Source: ${it.src}\n${it.link}`;
    const w = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
      method: "POST", headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: `whatsapp:${TW_FROM}`, To: `whatsapp:${SELF}`, Body: body }),
    });
    if (w.ok) { sent.push(it.title); await db(`ami_news_seen?h=eq.${it.h}`, { method: "PATCH", body: JSON.stringify({ alerted: true }) }); }
  }
  return json({ checked: items.length, fresh: fresh.length, sent });
});
