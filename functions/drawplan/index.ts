// drawplan v1.4 — AMI's drawing engine: floor / partition plans as PDF (to view & print) + DXF (AutoCAD), saved to Drive.
// POST (x-internal-key): {brief, base_file_id?, folder_id?, company?, title?, async?, notify?}
//  - base_file_id: a vector PDF plan in Drive (e.g. from AutoCAD). Its lines are read and scaled to metres from the dimension labels.
//  - without a base file the whole plan is drawn from the brief.
//  - async:true -> returns at once; files are WhatsApped to the Chairman when ready (notify defaults to true when async).
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const DR = "https://www.googleapis.com/drive/v3";
const CO_FOLDERS: Record<string, string> = {
  "leone": "1qw_-mvcO0e0McEXYnGMncYDLXC2FCiQX", "cape": "1rB2dXvWVvvZuZEH9oSV5YyZQw_G13mr8", "construction": "1BvPb2YTambSRnvC037zwhjIxA9LJWErx",
  "platinum": "1EaJzEKmkGQa6RZwClHTT4gg2WrLGLcwO", "lead": "1EVJOqgcvmIu7Hkvx6-4dlgt7LFI6s6Ks", "hotel": "1Z67zH3NSsmzrviEp-uTO1OehA83Il47_",
  "jv": "1sttdX5fK060WebS2vy9CDOW2j6j3RqSX", "joun": "1oVkGTKWEg_zWSIgEtisHD_UrcAqkLEXG" };
const STUDIO = "16IOI6ngn5ITaGuUtI84v_hgtkINNBi_T";
let T = "";
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); T = j.access_token;
}
async function g(u: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(u, { ...init, headers: { Authorization: "Bearer " + T, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) } });
  const ct = r.headers.get("content-type") || ""; const b = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(`Google ${r.status}: ${typeof b === "string" ? b.slice(0, 150) : b?.error?.message}`); return b;
}
const b64enc = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// ---------------- base plan: vector lines from the PDF ----------------
async function inflate(u: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate"); const w = ds.writable.getWriter();
  w.write(u).catch(() => {}); w.close().catch(() => {});
  const chunks: Uint8Array[] = []; const r = ds.readable.getReader();
  try { for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); } } catch (_) {}
  const n = chunks.reduce((a, c) => a + c.length, 0); const o = new Uint8Array(n); let p = 0; for (const c of chunks) { o.set(c, p); p += c.length; } return o;
}
async function pdfStreams(bytes: Uint8Array) {
  const s = new TextDecoder("latin1").decode(bytes); const out: string[] = []; const re = /stream\r?\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length; const end = s.indexOf("endstream", start); if (end < 0) break; re.lastIndex = end;
    const dict = s.slice(Math.max(0, m.index - 600), m.index); const d = dict.slice(dict.lastIndexOf("<<"));
    if (/Image|ObjStm|XRef|Length1|FontFile/.test(d)) continue;
    let e = end; while (e > start && (s[e - 1] === "\n" || s[e - 1] === "\r")) e--;
    if (/FlateDecode/.test(d)) { const dec = await inflate(bytes.subarray(start, e)); if (dec.length) out.push(new TextDecoder("latin1").decode(dec)); }
    else if (!/Filter/.test(d)) out.push(s.slice(start, e));
  }
  return out;
}
function decodeStr(t: string): string {
  if (t[0] === "<") { const h = t.replace(/[<>\s]/g, ""); let o = ""; const step = h.length % 4 === 0 && /^(00[0-9a-f]{2})+$/i.test(h) ? 4 : 2;
    for (let i = 0; i < h.length; i += step) { const c = parseInt(h.slice(i, i + step), 16); o += String.fromCharCode(step === 4 ? c + 29 : c); } return o; }
  if (t[0] === "(") return t.slice(1, -1).replace(/\\(.)/g, "$1");
  if (t[0] === "[") return (t.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g) || []).map(decodeStr).join("");
  return "";
}
function parse(streams: string[]) {
  const segs: number[][] = []; const texts: { x: number; y: number; s: string }[] = []; const seen = new Set<string>();
  const add = (a: number, b: number, c: number, d: number) => { const k = [a, b, c, d].map((v) => Math.round(v * 10) / 10); if (k[0] === k[2] && k[1] === k[3]) return;
    const key = k.join(","), key2 = [k[2], k[3], k[0], k[1]].join(","); if (seen.has(key) || seen.has(key2)) return; seen.add(key); segs.push(k); };
  for (const st of streams) {
    if (!/\s[mlc]\s|re\s|Tj|TJ/.test(st)) continue;
    let cx = 0, cy = 0, sx = 0, sy = 0, tx = 0, ty = 0; const n: number[] = [];
    const toks = st.match(/\((?:\\.|[^\\)])*\)|\[[^\]]*\]|<[0-9A-Fa-f\s]*>|\/[^\s\/\[\]()<>]+|-?\d*\.?\d+(?:[eE]-?\d+)?|[A-Za-z'"*]+/g) || [];
    let pending = "";
    for (const t of toks) {
      if (/^-?\d*\.?\d+/.test(t)) { n.push(+t); continue; }
      if (t[0] === "(" || t[0] === "[" || t[0] === "<") { pending = t; continue; }
      if (t[0] === "/") continue;
      const L = n.length;
      if (t === "m" && L >= 2) { cx = sx = n[L - 2]; cy = sy = n[L - 1]; }
      else if ((t === "l" && L >= 2) || (t === "c" && L >= 6) || ((t === "v" || t === "y") && L >= 4)) { const x = n[L - 2], y = n[L - 1]; add(cx, cy, x, y); cx = x; cy = y; }
      else if (t === "h") { add(cx, cy, sx, sy); cx = sx; cy = sy; }
      else if (t === "re" && L >= 4) { const [x, y, w, h] = n.slice(-4); add(x, y, x + w, y); add(x + w, y, x + w, y + h); add(x + w, y + h, x, y + h); add(x, y + h, x, y); }
      else if ((t === "Td" || t === "TD") && L >= 2) { tx += n[L - 2]; ty += n[L - 1]; }
      else if (t === "Tm" && L >= 6) { tx = n[L - 2]; ty = n[L - 1]; }
      else if (t === "BT") { tx = 0; ty = 0; }
      else if ((t === "Tj" || t === "TJ" || t === "'" || t === '"') && pending) { const s = decodeStr(pending).replace(/[\x00-\x1f]/g, "").trim(); if (s) texts.push({ x: tx, y: ty, s }); pending = ""; }
      n.length = 0;
    }
  }
  return { segs, texts };
}
// scale (points per metre) from dimension labels like "25.1 m" sitting next to a dimension line of the same length.
// Returns the scale and the dimension lines that agree with it (used to find the room / office outline).
type Cand = { k: number; lo: number; hi: number; at: number; hz: boolean; v: number };
function findScale(segs: number[][], texts: { x: number; y: number; s: string }[]): { k: number; dims: Cand[] } {
  // every line near a label like "25.1 m" gives a candidate scale (length / 25.1). Real dimension lines agree with each other
  // across many labels; the little boxes drawn around the labels do not. Pick the scale most labels agree on.
  const per: Cand[][] = [];
  for (const t of texts) {
    const mm = t.s.match(/^(\d+(?:\.\d+)?)\s*m$/i); if (!mm) continue; const v = +mm[1]; if (!(v > 0.3)) continue;
    const ks: Cand[] = [];
    for (const [a, b, c, d] of segs) {
      const len = Math.hypot(c - a, d - b); if (len < 8) continue;
      const hz = Math.abs(b - d) < 0.3, vt = Math.abs(a - c) < 0.3; if (!hz && !vt) continue;
      const along = hz ? t.x : t.y, lo = hz ? Math.min(a, c) : Math.min(b, d), hi = hz ? Math.max(a, c) : Math.max(b, d);
      const dist = hz ? Math.abs(t.y - b) : Math.abs(t.x - a);
      if (along < lo - 40 || along > hi + 10 || dist > 30) continue;
      // the measured points are where the little ticks / extension lines touch the dimension line (lines often overshoot the ticks)
      const pts: number[] = [];
      for (const [p, q, r, u] of segs) {
        if (Math.hypot(r - p, u - q) > 15) continue;
        for (const [ex, ey] of [[p, q], [r, u]]) {
          const off = hz ? Math.abs(ey - b) : Math.abs(ex - a), at = hz ? ex : ey;
          if (off < 0.6 && at >= lo - 1 && at <= hi + 1) pts.push(at);
        }
      }
      const span = pts.length >= 2 ? Math.max(...pts) - Math.min(...pts) : 0;
      const useTicks = span > len * 0.5;
      ks.push({ k: (useTicks ? span : len) / v, lo: useTicks ? Math.min(...pts) : lo, hi: useTicks ? Math.max(...pts) : hi, at: hz ? b : a, hz, v });
    }
    if (ks.length) per.push(ks);
  }
  let bestK = 0, bestN = 0;
  for (const ks of per) for (const { k } of ks) {
    const n = per.filter((o) => o.some((c) => Math.abs(c.k - k) / k < 0.02)).length;
    if (n > bestN || (n === bestN && k > bestK)) { bestN = n; bestK = k; }
  }
  if (bestN < 2 && per.length > 1) return { k: 0, dims: [] };
  const close = per.flatMap((o) => o.filter((c) => Math.abs(c.k - bestK) / bestK < 0.02));
  return { k: close.reduce((a, c) => a + c.k, 0) / close.length, dims: close };
}

// ---------------- reading the structure of the base plan (metres) ----------------
// columns = small closed squares (0.2-0.7 m); outline = the longest horizontal and vertical overall dimensions.
function columns(segs: number[][]) {
  const H = segs.filter((s) => Math.abs(s[1] - s[3]) < 0.02), V = segs.filter((s) => Math.abs(s[0] - s[2]) < 0.02);
  const cols: number[][] = [];
  for (const h of H) {
    const x0 = Math.min(h[0], h[2]), x1 = Math.max(h[0], h[2]), L = x1 - x0; if (L < 0.2 || L > 0.7) continue;
    for (const h2 of H) {
      if (h2 === h) continue; const a = Math.min(h2[0], h2[2]), b = Math.max(h2[0], h2[2]), dy = h2[1] - h[1];
      if (!(Math.abs(a - x0) < 0.03 && Math.abs(b - x1) < 0.03 && dy > 0.2 && dy < 0.7 && Math.abs(dy - L) < 0.12)) continue;
      const side = (x: number) => V.some((v) => Math.abs(v[0] - x) < 0.03 && Math.min(v[1], v[3]) < h[1] + 0.03 && Math.max(v[1], v[3]) > h2[1] - 0.03);
      if (side(x0) && side(x1)) { const c = [(x0 + x1) / 2, (h[1] + h2[1]) / 2, L]; if (!cols.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < 0.3)) cols.push(c); }
    }
  }
  return cols;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
function structure(base: any) {
  const o = base.office; const W = o.x1 - o.x0, Hh = o.y1 - o.y0;
  const rel = (x: number, y: number) => [r2(x - o.x0), r2(y - o.y0)];
  const cols = columns(base.segs).filter((c) => c[0] > o.x0 - 0.5 && c[0] < o.x1 + 0.5 && c[1] > o.y0 - 0.5 && c[1] < o.y1 + 0.5)
    .map((c) => { const [x, y] = rel(c[0], c[1]); return { x, y, size: r2(c[2]) }; });
  // columns in rows (by y); the row nearest the middle of the space is the main column line ("the pillars")
  const rows: any[][] = [];
  for (const c of [...cols].sort((a, b) => a.x - b.x)) { const r = rows.find((r) => Math.abs(r[0].y - c.y) < 0.4); if (r) r.push(c); else rows.push([c]); }
  rows.sort((a, b) => a[0].y - b[0].y);
  const ym = (r: any[]) => r2(r.reduce((a, c) => a + c.y, 0) / r.length);
  const main = rows.length ? rows.reduce((a, r) => Math.abs(ym(r) - Hh / 2) < Math.abs(ym(a) - Hh / 2) ? r : a) : null;
  const labels = base.labels.filter((t: any) => t.x > o.x0 - 0.3 && t.x < o.x1 + 0.3 && t.y > o.y0 - 0.3 && t.y < o.y1 + 0.3 && /[A-Za-z]{2,}/.test(t.s))
    .map((t: any) => { const [x, y] = rel(t.x, t.y); return `${t.s} @ (${x}, ${y})`; });
  const lines = [
    `MAIN SPACE (inner faces of the outer walls, from the plan's overall dimensions): ${r2(W)} m (x, west->east) by ${r2(Hh)} m (y, south->north). Origin (0,0) = its south-west inner corner.`,
    rows.length ? `COLUMNS (centres, numbered west to east in each row):\n` + rows.map((r) => `  ${r === main ? "MAIN COLUMN LINE (the free-standing pillars)" : "row"} at y~${ym(r)}: ` + r.map((c, j) => `C${j + 1}=(${c.x}, ${c.y}) ${c.size}m sq`).join("; ")).join("\n") : "COLUMNS: none detected.",
    labels.length ? `TEXT ON THE PLAN INSIDE THIS SPACE (room names etc.): ` + labels.join(" | ") : "",
  ].filter(Boolean);
  return lines.join("\n");
}

// ---------------- the AI layout ----------------
// The model sees the base plan re-drawn with a 1 m grid in main-space coordinates, and answers with ROOM RECTANGLES.
// Code turns the rectangles into partition lines, door gaps and sizes, and checks overlaps (one repair round).
function pdfFile(content: string, PW = 1190.55, PH = 841.89) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  let pdf = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((ob, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${ob}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
// the base plan in main-space metres with a labelled 1 m grid (what the model looks at)
function gridPdf(base: any) {
  const o = base.office, W = o.x1 - o.x0, H = o.y1 - o.y0, M = 30;
  const segs = base.segs.map((t: number[]) => [t[0] - o.x0, t[1] - o.y0, t[2] - o.x0, t[3] - o.y0]);
  const xs = segs.flatMap((t: number[]) => [t[0], t[2]]), ys = segs.flatMap((t: number[]) => [t[1], t[3]]);
  const x0 = Math.min(-1, ...xs) - 0.8, x1 = Math.max(W + 1, ...xs) + 0.8, y0 = Math.min(-1, ...ys) - 0.8, y1 = Math.max(H + 1, ...ys) + 0.8;
  const s = 1500 / (x1 - x0), PW = (x1 - x0) * s + 2 * M, PH = (y1 - y0) * s + 2 * M;   // page cut to the plan, so it fills the image
  const X = (x: number) => (M + (x - x0) * s).toFixed(2), Y = (y: number) => (M + (y - y0) * s).toFixed(2);
  const o2: string[] = []; const ln = (a: number, b: number, c: number, d: number) => o2.push(`${X(a)} ${Y(b)} m ${X(c)} ${Y(d)} l S`);
  const tx = (x: number, y: number, sz: number, t: string) => o2.push(`BT /F2 ${sz} Tf ${(+X(x) - t.length * sz * 0.28).toFixed(2)} ${(+Y(y) - sz * 0.35).toFixed(2)} Td (${esc(t)}) Tj ET`);
  o2.push("0.72 0.82 1 RG 0.4 w");
  for (let x = Math.ceil(x0); x <= x1; x++) ln(x, y0, x, y1);
  for (let y = Math.ceil(y0); y <= y1; y++) ln(x0, y, x1, y);
  o2.push("0.1 0.3 0.9 rg");
  for (let x = Math.ceil(x0); x <= x1; x++) { tx(x, y0 + 0.3, 11, String(x)); tx(x, y1 - 0.3, 11, String(x)); }
  for (let y = Math.ceil(y0); y <= y1; y++) { tx(x0 + 0.35, y, 11, String(y)); tx(x1 - 0.35, y, 11, String(y)); }
  o2.push("0 0 0 RG 1 w"); for (const t of segs) ln(t[0], t[1], t[2], t[3]);
  o2.push("0 0.6 0.2 RG 2 w"); ln(0, 0, W, 0); ln(W, 0, W, H); ln(W, H, 0, H); ln(0, H, 0, 0);
  return pdfFile(o2.join("\n"), +PW.toFixed(2), +PH.toFixed(2));
}
const SPEC = `Return ONLY one JSON object (no markdown). ALL coordinates in METRES in the main-space grid (origin = south-west inner corner, x east, y north - read them off the grid drawing):
{"title":"short title","summary":"one line",
 "plan":"3-6 short lines: how you read the brief (which column is which pillar, where the entrance and fire exit are), the zones west->east with their x ranges, the corridor y range",
 "existing":[{"name":"WC 1","x0":..,"y0":..,"x1":..,"y1":..}],   // existing enclosed rooms you keep as they are (WCs, kitchen, stairs, lifts, shafts, server...) - their walls already exist
 "rooms":[{"name":"VISA SECTION","x0":..,"y0":..,"x1":..,"y1":..,
           "doors":[{"side":"N"|"S"|"E"|"W","at":<x (N/S side) or y (E/W side) of the door centre>,"w":0.9}],
           "open":["E"]}],   // NEW rooms as rectangles. New partitions are drawn on every side except sides on the outer walls, on existing walls, or listed in "open" (no wall, e.g. reception open to waiting). A corridor is a room named "CORRIDOR" - no walls are drawn for it; its neighbours make its walls.
 "existing_doors":[{"room":"KITCHENETTE","side":"E","at":..,"w":0.8}],   // NEW doors cut into the walls of an existing room
 "close":[[x0,y0,x1,y1]],                // existing doors / openings to be walled up (line across the opening)
 "furniture":[{"label":"VISA COUNTER","x":..,"y":..,"w":..,"h":..}],  // x,y = bottom-left
 "markers":[{"text":"MAIN ENTRANCE","x":..,"y":..,"dx":-2.5,"dy":0}],  // arrow pointing at x,y from x+dx,y+dy (outside the space)
 "shell":{"outline":[[x,y],...],"columns":[[x,y],...],"column_size":0.4},  // ONLY when there is NO base plan: the building outline polygon (inner face of outer walls, counter-clockwise, origin at its south-west corner) incl. any projecting core, and every column centre
 "notes":["short note", ...]}            // how you read the brief, assumptions, anything that does not fit`;
const RULES = `HOW TO LAY IT OUT (follow strictly):
1. First study the grid drawing: the main space (green outline), the columns, the EXISTING enclosed rooms (WCs, kitchenette, server, stairs, lift) with their real positions, and where the entrance door and fire exit door are in the outer walls. List the kept existing rooms in "existing" with their true rectangles. New rooms must NEVER overlap existing rooms or each other.
2. Pillars in the brief: number the free-standing columns from the entrance end, unless the brief clearly counts otherwise. If the brief names more pillars than exist, count the outer wall at each end of the column line as a pillar too, and say how you counted in notes.
3. A corridor "along the pillars" runs parallel to the column line, 1.2-1.5 m wide, with the column line on ONE of its edges (the columns sit inside that edge wall), never in the middle of the corridor.
4. Rooms sit between columns: put the room edges perpendicular to the corridor at column centres. Fill the space - every square metre is a room, the corridor, or an existing room.
5. Every new room has at least one door (0.9 m; 0.8 m for WC/store/server) onto the corridor or the room it is reached from, at least 0.2 m from a corner, and doors never land on a column.
6. Keep existing wet rooms where they are. Close existing doors that the brief says must not open where they do now (close), and add the new doors asked for (existing_doors).
7. Keep a clear 1.2 m route to every fire exit; no room blocks the fire exit door.
8. Everything stays inside the main space (0..W, 0..H).`;
const MODELS = ["claude-opus-4-5", "claude-sonnet-4-5"];
async function askAI(content: any[], budget: number) {
  for (let a = 0, mi = 0; a < 4; a++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELS[mi], max_tokens: budget + 12000, thinking: { type: "enabled", budget_tokens: budget }, messages: content }) });
    const d = await r.json();
    if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 8000)); continue; }
    if (!r.ok && mi < MODELS.length - 1 && /model/i.test(String(d?.error?.message || ""))) { mi++; continue; }   // model not available on this key: next one
    if (!r.ok) throw new Error("AI " + (d?.error?.message || r.status));
    const t = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text || "").join("");
    try { return { L: JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)), text: t, model: MODELS[mi] }; } catch (_) { if (a === 3) throw new Error("AI layout was not valid JSON"); }
  }
  throw new Error("AI busy");
}
async function aiLayout(brief: string, base: any, pdfB64: string | null) {
  const user: any[] = [];
  let ctx = "NO BASE PLAN: design the whole floor from the brief. The MAIN SPACE is the main floor plate, origin (0,0) at its south-west inner corner. Give the building outline and the columns in \"shell\" (they are drawn as the existing structure); list the stair/lift core and any other fixed shafts in \"existing\" (they get walls drawn); rooms may sit outside the main space only inside the outline (e.g. in a projecting core).";
  if (base) {
    user.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64enc(gridPdf(base)) } });
    if (pdfB64) user.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } });
    ctx = `DOCUMENT 1 is the existing plan redrawn by me in METRES with a 1 m grid (blue numbers = grid coordinates, green = the main space). ${pdfB64 ? "DOCUMENT 2 is the architect's original plan (for room names and door swings). " : ""}Take every coordinate from the grid in document 1.
STRUCTURE (measured from the drawing, same coordinates):
${structure(base)}`;
  }
  user.push({ type: "text", text: `You are a senior interior architect laying out office partitions for a client in Monrovia, Liberia. Work carefully - the drawing goes to the contractor.\n\n${ctx}\n\nBRIEF FROM THE CLIENT:\n${brief}\n\n${RULES}\n\n${SPEC}` });
  const msgs: any[] = [{ role: "user", content: user }];
  const t0 = Date.now();
  let { L, text, model } = await askAI(msgs, 10000);
  let errs = check(L, base);
  console.log("drawplan layout", model, Math.round((Date.now() - t0) / 1000) + "s", errs.length, "issues");
  if (errs.length && Date.now() - t0 < 170000) {
    msgs.push({ role: "assistant", content: text }, { role: "user", content: `These problems were found in your layout:\n- ${errs.join("\n- ")}\nFix them and return the complete corrected JSON (same format).` });
    try { const r = await askAI(msgs, 5000); const e2 = check(r.L, base); if (e2.length <= errs.length) { L = r.L; errs = e2; } } catch (_) {}
  }
  const out = build(L, base);
  if (errs.length) out.notes = [...(out.notes || []), "Check on site: " + errs.slice(0, 2).join("; ")];
  return out;
}
const num = (v: any) => +v || 0;
const rect = (r: any) => ({ x0: Math.min(num(r.x0), num(r.x1)), x1: Math.max(num(r.x0), num(r.x1)), y0: Math.min(num(r.y0), num(r.y1)), y1: Math.max(num(r.y0), num(r.y1)) });
const ov = (a: any, b: any) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
function check(L: any, base: any) {
  const errs: string[] = []; const W = base ? base.office.x1 - base.office.x0 : 1e9, H = base ? base.office.y1 - base.office.y0 : 1e9;
  const rooms = (L.rooms || []).map((r: any) => ({ n: String(r.name || "?"), ...rect(r), r }));
  const ex = (L.existing || []).map((r: any) => ({ n: String(r.name || "?"), ...rect(r) }));
  for (const a of rooms) {
    if (a.x1 - a.x0 < 0.8 || a.y1 - a.y0 < 0.8) errs.push(`${a.n} is too small (${r2(a.x1 - a.x0)} x ${r2(a.y1 - a.y0)} m)`);
    if (a.x0 < -0.1 || a.y0 < -0.1 || a.x1 > W + 0.1 || a.y1 > H + 0.1) errs.push(`${a.n} goes outside the main space`);
    if (!/corridor/i.test(a.n) && !(a.r.doors || []).length && !(a.r.open || []).length) errs.push(`${a.n} has no door`);
    for (const b of rooms) if (a !== b && a.n <= b.n && ov(a, b) > 0.15) errs.push(`${a.n} overlaps ${b.n} by ${r2(ov(a, b))} m2`);
    for (const b of ex) if (ov(a, b) > 0.15) errs.push(`${a.n} overlaps the existing ${b.n} by ${r2(ov(a, b))} m2`);
    for (const d of a.r.doors || []) { const at = num(d.at), w = num(d.w) || 0.9, hz = d.side === "N" || d.side === "S";
      const lo = hz ? a.x0 : a.y0, hi = hz ? a.x1 : a.y1; if (at - w / 2 < lo + 0.05 || at + w / 2 > hi - 0.05) errs.push(`a door of ${a.n} (side ${d.side} at ${at}) is not within that side (${r2(lo)}..${r2(hi)})`); }
  }
  const cor = rooms.filter((r: any) => /corridor/i.test(r.n));
  for (const c of cor) { const w = Math.min(c.x1 - c.x0, c.y1 - c.y0); if (w > 1.7) errs.push(`${c.n} is ${r2(w)} m wide - keep it 1.2-1.5 m`); }
  if (!base && !((L.shell?.outline || []).length >= 3)) errs.push("shell.outline is missing - give the building outline polygon");
  return [...new Set(errs)];
}
// rectangles -> partition centre-lines (merged, door gaps cut), doors, labels with true sizes; then onto the base plan
function shellSegs(L: any) {
  const segs: number[][] = []; const sh = L.shell || {};
  const pts = (sh.outline || []).map((p: any) => [num(p[0]), num(p[1])]);
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push([a[0], a[1], b[0], b[1]]);
    // outer wall thickness 0.2 m drawn outside the inner face
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = dy / l * 0.2, ny = -dx / l * 0.2; segs.push([a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny]); }
  const c = num(sh.column_size) || 0.4, h = c / 2;
  for (const p of sh.columns || []) { const x = num(p[0]), y = num(p[1]); segs.push([x - h, y - h, x + h, y - h], [x + h, y - h, x + h, y + h], [x + h, y + h, x - h, y + h], [x - h, y + h, x - h, y - h]); }
  for (const e of L.existing || []) { const R = rect(e); segs.push([R.x0, R.y0, R.x1, R.y0], [R.x1, R.y0, R.x1, R.y1], [R.x1, R.y1, R.x0, R.y1], [R.x0, R.y1, R.x0, R.y0]); }
  return segs;
}
function build(L: any, base: any) {
  let o = base?.office || { x0: 0, y0: 0, x1: 1e9, y1: 1e9 };
  if (!base && (L.shell?.outline || []).length >= 3) { const xs = L.shell.outline.map((p: any) => num(p[0])), ys = L.shell.outline.map((p: any) => num(p[1])); const x0m = Math.min(...xs); const yW = L.shell.outline.filter((p: any) => Math.abs(num(p[0]) - x0m) < 0.01).map((p: any) => num(p[1])); o = { x0: 0, y0: 0, x1: Math.max(...xs), y1: yW.length ? Math.max(...yW) : Math.max(...ys) }; } const ox = o.x0, oy = o.y0, W = o.x1 - o.x0, H = o.y1 - o.y0;
  const T = 0.12; const ex = (L.existing || []).map(rect);
  const lines = new Map<string, number[][]>(); // key "h:y" / "v:x" -> [lo,hi] intervals
  const add = (hz: boolean, at: number, lo: number, hi: number) => {
    if (hi - lo < 0.05) return;
    if (hz ? (at < T || at > H - T) : (at < T || at > W - T)) return;               // on an outer wall
    // drop the parts that lie on an existing room's wall
    let parts = [[lo, hi]];
    for (const e of ex) { const on = hz ? (Math.abs(at - e.y0) < T || Math.abs(at - e.y1) < T) : (Math.abs(at - e.x0) < T || Math.abs(at - e.x1) < T); if (!on) continue;
      const a = hz ? e.x0 : e.y0, b = hz ? e.x1 : e.y1; parts = parts.flatMap(([p, q]) => [[p, Math.min(q, a)], [Math.max(p, b), q]]).filter(([p, q]) => q - p > 0.05); }
    const k = (hz ? "h:" : "v:") + (Math.round(at * 20) / 20).toFixed(2); lines.set(k, [...(lines.get(k) || []), ...parts]); };
  const doors: any[] = [], labels: any[] = [], cuts: { hz: boolean; at: number; lo: number; hi: number }[] = [];
  const door = (R: any, d: any, into: boolean) => { const at = num(d.at), w = num(d.w) || 0.9, sd = String(d.side || "S").toUpperCase(); const hz = sd === "N" || sd === "S";
    const line = sd === "S" ? R.y0 : sd === "N" ? R.y1 : sd === "W" ? R.x0 : R.x1; const lo = at - w / 2;
    cuts.push({ hz, at: line, lo, hi: lo + w });
    const inward = sd === "S" || sd === "W" ? 1 : -1;  // into the room
    doors.push(hz ? { x: lo + ox, y: line + oy, w, o: "h", s: into ? inward : -inward } : { x: line + ox, y: lo + oy, w, o: "v", s: into ? inward : -inward }); };
  for (const r of L.rooms || []) {
    const R = rect(r); const open = (r.open || []).map((x: string) => String(x).toUpperCase()); const cor = /corridor/i.test(String(r.name));
    if (!cor) { if (!open.includes("S")) add(true, R.y0, R.x0, R.x1); if (!open.includes("N")) add(true, R.y1, R.x0, R.x1);
      if (!open.includes("W")) add(false, R.x0, R.y0, R.y1); if (!open.includes("E")) add(false, R.x1, R.y0, R.y1);
      for (const d of r.doors || []) door(R, d, true); }
    labels.push({ name: String(r.name || ""), x: (R.x0 + R.x1) / 2 + ox, y: (R.y0 + R.y1) / 2 + oy, size: cor ? `${r2(Math.min(R.x1 - R.x0, R.y1 - R.y0))} m wide` : `${(R.x1 - R.x0).toFixed(1)} x ${(R.y1 - R.y0).toFixed(1)} m` });
  }
  for (const d of L.existing_doors || []) { const e = (L.existing || []).find((x: any) => String(x.name).toLowerCase() === String(d.room || "").toLowerCase()); if (e) door(rect(e), d, true); }
  for (const e of L.existing || []) { const R = rect(e); labels.push({ name: String(e.name || ""), x: (R.x0 + R.x1) / 2 + ox, y: (R.y0 + R.y1) / 2 + oy, size: "" }); }
  const walls: number[][] = [];
  for (const [k, iv] of lines) {
    const hz = k[0] === "h", at = +k.slice(2); iv.sort((a, b) => a[0] - b[0]);
    const merged: number[][] = []; for (const [p, q] of iv) { const m = merged[merged.length - 1]; if (m && p <= m[1] + 0.02) m[1] = Math.max(m[1], q); else merged.push([p, q]); }
    let parts = merged;
    for (const c of cuts) if (c.hz === hz && Math.abs(c.at - at) < 0.08) parts = parts.flatMap(([p, q]) => [[p, Math.min(q, c.lo)], [Math.max(p, c.hi), q]]).filter(([p, q]) => q - p > 0.03);
    for (const [p, q] of parts) walls.push(hz ? [p + ox, at + oy, q + ox, at + oy] : [at + ox, p + oy, at + ox, q + oy]);
  }
  const sh = (e: any) => ({ ...e, x: num(e.x) + ox, y: num(e.y) + oy });
  return { title: L.title, summary: L.summary, plan: L.plan, notes: L.notes || [], walls, doors, rooms: labels,
    close: (L.close || []).filter((w: any) => Array.isArray(w) && w.length === 4).map((w: number[]) => [num(w[0]) + ox, num(w[1]) + oy, num(w[2]) + ox, num(w[3]) + oy]),
    furniture: (L.furniture || []).map(sh), markers: (L.markers || []).map(sh),
    dims: o.x1 < 1e8 ? [{ x0: o.x0, y0: o.y0 - 0.9, x1: o.x1, y1: o.y0 - 0.9, text: `${r2(W)} m` }, { x0: o.x1 + 0.9, y0: o.y0, x1: o.x1 + 0.9, y1: o.y1, text: `${r2(H)} m` }] : [],
    shell: base ? null : shellSegs(L),
    raw: { rooms: L.rooms, existing: L.existing, existing_doors: L.existing_doors, shell: L.shell } };
}

// ---------------- output: PDF (vector, Helvetica) ----------------
const asc = (s: string) => String(s ?? "").replace(/[—–]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/×/g, "x").replace(/[^\x20-\x7e]/g, "");
const esc = (s: string) => asc(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
function makePdf(base: any, L: any, title: string, sub: string) {
  const PW = 1190.55, PH = 841.89, M = 40, TOP = 90, BOT = 120;
  const pts: number[][] = [];
  for (const s of base?.segs || []) pts.push([s[0], s[1]], [s[2], s[3]]);
  for (const w of [...(L.walls || []), ...(L.close || [])]) pts.push([w[0], w[1]], [w[2], w[3]]);
  for (const m of L.markers || []) pts.push([m.x + (m.dx || 0), m.y + (m.dy || 0)]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1.5, y0 = Math.min(...ys) - 1.5, y1 = Math.max(...ys) + 1;
  const s = Math.min((PW - 2 * M) / (x1 - x0), (PH - TOP - BOT) / (y1 - y0));
  const ox = M + ((PW - 2 * M) - (x1 - x0) * s) / 2, oy = BOT + ((PH - TOP - BOT) - (y1 - y0) * s) / 2;
  const X = (x: number) => (ox + (x - x0) * s).toFixed(2), Y = (y: number) => (oy + (y - y0) * s).toFixed(2);
  const o: string[] = [];
  const line = (a: number, b: number, c: number, d: number) => o.push(`${X(a)} ${Y(b)} m ${X(c)} ${Y(d)} l S`);
  const text = (x: number, y: number, size: number, str: string, bold = false, center = true) => {
    const w = asc(str).length * size * (bold ? 0.56 : 0.52);
    o.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${(+X(x) - (center ? w / 2 : 0)).toFixed(2)} ${(+Y(y) - size * 0.35).toFixed(2)} Td (${esc(str)}) Tj ET`); };
  const rawText = (px: number, py: number, size: number, str: string, bold = false) => o.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${px.toFixed(2)} ${py.toFixed(2)} Td (${esc(str)}) Tj ET`);
  const arc = (cx: number, cy: number, r: number, a0: number) => { // quarter circle from angle a0 (deg) to a0+90
    const k = 0.5523, a = (a0 * Math.PI) / 180, b = ((a0 + 90) * Math.PI) / 180;
    const p0 = [cx + r * Math.cos(a), cy + r * Math.sin(a)], p3 = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    const p1 = [p0[0] - k * r * Math.sin(a), p0[1] + k * r * Math.cos(a)], p2 = [p3[0] + k * r * Math.sin(b), p3[1] - k * r * Math.cos(b)];
    o.push(`${X(p0[0])} ${Y(p0[1])} m ${X(p1[0])} ${Y(p1[1])} ${X(p2[0])} ${Y(p2[1])} ${X(p3[0])} ${Y(p3[1])} c S`); };
  // existing
  o.push("0.55 0.55 0.55 RG 0.6 w 1 J");
  for (const sg of base?.segs || []) line(sg[0], sg[1], sg[2], sg[3]);
  // furniture / counters
  o.push("0.14 0.44 0.64 RG 0.84 0.92 0.97 rg 0.8 w");
  for (const f of L.furniture || []) { o.push(`${X(f.x)} ${Y(f.y)} ${(f.w * s).toFixed(2)} ${(f.h * s).toFixed(2)} re B`); }
  o.push("0.14 0.44 0.64 rg");
  for (const f of L.furniture || []) text(f.x + f.w / 2, f.y + f.h / 2, 6, f.label || "");
  // closed openings and new partitions
  o.push("0.75 0.22 0.17 RG 0 J");
  o.push(`${Math.max(1.6, 0.1 * s).toFixed(2)} w`);
  for (const w of L.close || []) line(w[0], w[1], w[2], w[3]);
  for (const w of L.walls || []) line(w[0], w[1], w[2], w[3]);
  // doors
  o.push("0.8 w");
  for (const d of L.doors || []) {
    const w = d.w || 0.9, sg = d.s >= 0 ? 1 : -1;
    if (d.o === "v") { line(d.x, d.y, d.x + sg * w, d.y); arc(d.x, d.y, w, sg > 0 ? 0 : 90); }
    else { line(d.x, d.y, d.x, d.y + sg * w); arc(d.x, d.y, w, sg > 0 ? 0 : 270); }
  }
  // markers (arrows)
  o.push("0.07 0.48 0.4 RG 0.07 0.48 0.4 rg 1.4 w");
  for (const m of L.markers || []) {
    const sx = m.x + (m.dx || 0), sy = m.y + (m.dy || 0); line(sx, sy, m.x, m.y);
    const ang = Math.atan2(m.y - sy, m.x - sx), h = 0.35;
    o.push(`${X(m.x)} ${Y(m.y)} m ${X(m.x - h * Math.cos(ang - 0.4))} ${Y(m.y - h * Math.sin(ang - 0.4))} l ${X(m.x - h * Math.cos(ang + 0.4))} ${Y(m.y - h * Math.sin(ang + 0.4))} l f`);
    const right = (m.dx || 0) > 0;
    text(sx + (right ? 0.15 : -0.15), sy + ((m.dy || 0) ? (m.dy > 0 ? 0.3 : -0.3) : 0), 8, m.text || "", true, false);
    if (!right && !(m.dy)) { o.pop(); const w = asc(m.text).length * 8 * 0.56; rawText(+X(sx - 0.15) - w, +Y(sy) - 2.8, 8, m.text || "", true); }
  }
  // dimensions
  o.push("0 0 0 RG 0 0 0 rg 0.5 w");
  for (const d of L.dims || []) { line(d.x0, d.y0, d.x1, d.y1); for (const [px, py] of [[d.x0, d.y0], [d.x1, d.y1]]) line(px - 0.12, py - 0.12, px + 0.12, py + 0.12);
    const hz = Math.abs(d.y1 - d.y0) < Math.abs(d.x1 - d.x0); text((d.x0 + d.x1) / 2 + (hz ? 0 : 0.35), (d.y0 + d.y1) / 2 + (hz ? -0.3 : 0), 7, d.text || ""); }
  // room labels
  o.push("0.1 0.15 0.19 rg");
  for (const r of L.rooms || []) {
    const parts = String(r.name || "").split(/\n|\\n/).map(asc); parts.forEach((p, i) => text(r.x, r.y + (parts.length - 1) * 0.17 - i * 0.34, 8.5, p, true));
    if (r.size) { o.push("0.35 0.35 0.35 rg"); text(r.x, r.y - parts.length * 0.3 - 0.05, 6.5, r.size); o.push("0.1 0.15 0.19 rg"); }
  }
  // title, legend, notes
  o.push("0 0 0 rg");
  rawText(M, PH - 45, 16, title, true);
  rawText(M, PH - 64, 9, sub);
  rawText(M, BOT - 30, 8, "LEGEND: grey = existing / structure   red = new partitions, doors and closed openings   blue = counters / furniture   green = entrance / exits", true);
  (L.notes || []).slice(0, 7).forEach((n: string, i: number) => rawText(M, BOT - 46 - i * 11, 8, `${i + 1}. ${n}`.slice(0, 210)));
  return pdfFile(o.join("\n"), PW, PH);
}

// ---------------- output: DXF (R12, metres) ----------------
function makeDxf(base: any, L: any, title: string) {
  const o = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC", "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "6"];
  for (const [n, c] of [["EXISTING", 8], ["PARTITIONS", 1], ["CLOSED", 1], ["DOORS", 1], ["FURNITURE", 5], ["TEXT", 7]]) o.push("0", "LAYER", "2", String(n), "70", "0", "62", String(c), "6", "CONTINUOUS");
  o.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  const f = (v: number) => (+v).toFixed(3);
  const ln = (a: number, b: number, c: number, d: number, ly: string) => o.push("0", "LINE", "8", ly, "10", f(a), "20", f(b), "11", f(c), "21", f(d));
  const tx = (x: number, y: number, h: number, s: string, ly = "TEXT") => o.push("0", "TEXT", "8", ly, "10", f(x), "20", f(y), "40", String(h), "1", asc(s));
  const arc = (x: number, y: number, r: number, a0: number, a1: number) => o.push("0", "ARC", "8", "DOORS", "10", f(x), "20", f(y), "40", f(r), "50", String(a0), "51", String(a1));
  for (const s of base?.segs || []) ln(s[0], s[1], s[2], s[3], "EXISTING");
  const thick = (w: number[], ly: string) => { const [a, b, c, d] = w; const len = Math.hypot(c - a, d - b) || 1; const nx = -(d - b) / len * 0.05, ny = (c - a) / len * 0.05;
    ln(a + nx, b + ny, c + nx, d + ny, ly); ln(a - nx, b - ny, c - nx, d - ny, ly); };
  for (const w of L.walls || []) thick(w, "PARTITIONS");
  for (const w of L.close || []) thick(w, "CLOSED");
  for (const d of L.doors || []) { const w = d.w || 0.9, sg = d.s >= 0 ? 1 : -1;
    if (d.o === "v") { ln(d.x, d.y, d.x + sg * w, d.y, "DOORS"); arc(d.x, d.y, w, sg > 0 ? 0 : 90, sg > 0 ? 90 : 180); }
    else { ln(d.x, d.y, d.x, d.y + sg * w, "DOORS"); arc(d.x, d.y, w, sg > 0 ? 0 : 270, sg > 0 ? 90 : 360); } }
  for (const r of L.furniture || []) { const { x, y, w, h } = r; ln(x, y, x + w, y, "FURNITURE"); ln(x + w, y, x + w, y + h, "FURNITURE"); ln(x + w, y + h, x, y + h, "FURNITURE"); ln(x, y + h, x, y, "FURNITURE"); tx(x + 0.05, y + h / 2, 0.12, r.label || "", "FURNITURE"); }
  for (const r of L.rooms || []) { tx(r.x - 0.8, r.y, 0.22, String(r.name || "").replace(/\n|\\n/g, " ")); if (r.size) tx(r.x - 0.8, r.y - 0.35, 0.15, r.size); }
  for (const m of L.markers || []) { ln(m.x + (m.dx || 0), m.y + (m.dy || 0), m.x, m.y, "TEXT"); tx(m.x + (m.dx || 0), m.y + (m.dy || 0) + 0.15, 0.2, m.text || ""); }
  for (const d of L.dims || []) { ln(d.x0, d.y0, d.x1, d.y1, "TEXT"); tx((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2 + 0.1, 0.18, d.text || ""); }
  tx(0, -2, 0.3, title + " - metres - verify on site");
  o.push("0", "ENDSEC", "0", "EOF");
  return new TextEncoder().encode(o.join("\n") + "\n");
}

async function upload(bytes: Uint8Array, name: string, mime: string, folder: string) {
  const bd = "amidraw" + Date.now();
  const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${bd}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = new TextEncoder().encode(`\r\n--${bd}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length); body.set(pre); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const u = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { Authorization: "Bearer " + T, "Content-Type": `multipart/related; boundary=${bd}` }, body });
  const j = await u.json(); if (!u.ok) throw new Error("Drive upload: " + (j?.error?.message || u.status)); return j.webViewLink as string;
}
async function whatsapp(text: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), tok = Deno.env.get("TWILIO_AUTH_TOKEN"); if (!sid || !tok) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374"}`, To: "whatsapp:+231777170170", Body: text.slice(0, 1500) }) }).catch(() => {});
}

async function run(b: any) {
  await token();
  let base: any = null, pdfB64: string | null = null, folder = b.folder_id || "", baseName = "";
  if (b.base_file_id) {
    const f = await g(`${DR}/files/${b.base_file_id}?fields=name,mimeType,size,parents`);
    baseName = f.name; if (!folder) folder = f.parents?.[0] || "";
    if (f.mimeType !== "application/pdf") throw new Error("The base plan must be a PDF (export it from AutoCAD as PDF). Got: " + f.mimeType);
    const r = await fetch(`${DR}/files/${b.base_file_id}?alt=media`, { headers: { Authorization: "Bearer " + T } });
    const bytes = new Uint8Array(await r.arrayBuffer()); if (bytes.length < 9e6) pdfB64 = b64enc(bytes);
    const { segs, texts } = parse(await pdfStreams(bytes));
    if (segs.length < 8) throw new Error("This PDF has no drawing lines I can read (it may be a scan or photo). Send the AutoCAD/PDF export instead.");
    const sc = findScale(segs, texts); let k = +b.scale || sc.k;
    if (!k) throw new Error("I could not find a dimension like '25.1 m' on the plan to set the scale. Tell me one real length (e.g. 'the long wall is 25.1 m').");
    const keep = segs.filter(([a, bb, c, d]) => Math.hypot(c - a, d - bb) / k >= 0.05);
    const kx = keep.flatMap((s) => [s[0], s[2]]), ky = keep.flatMap((s) => [s[1], s[3]]);
    const X0 = Math.min(...kx), Y0 = Math.min(...ky);
    const m = (v: number, o: number) => Math.round(((v - o) / k) * 1000) / 1000;
    const ms = keep.map(([a, bb, c, d]) => [m(a, X0), m(bb, Y0), m(c, X0), m(d, Y0)]);
    const W = (Math.max(...kx) - X0) / k, H = (Math.max(...ky) - Y0) / k;
    // the main space = the longest horizontal and longest vertical overall dimension lines (else the whole drawing)
    const hd = sc.dims.filter((d) => d.hz).sort((a, c) => c.v - a.v)[0], vd = sc.dims.filter((d) => !d.hz).sort((a, c) => c.v - a.v)[0];
    const office = { x0: hd ? m(hd.lo, X0) : 0, x1: hd ? m(hd.lo + hd.v * k, X0) : W, y0: vd ? m(vd.lo, Y0) : 0, y1: vd ? m(vd.lo + vd.v * k, Y0) : H };
    base = { k, segs: ms, labels: texts.map((t) => ({ x: (t.x - X0) / k, y: (t.y - Y0) / k, s: t.s })), W, H, office };
    if (base.segs.length > 2500) base.segs = base.segs.filter((s: number[]) => Math.hypot(s[2] - s[0], s[3] - s[1]) >= 0.15);
  }
  if (!folder) { const key = Object.keys(CO_FOLDERS).find((c) => String(b.company || "").toLowerCase().includes(c)); folder = key ? CO_FOLDERS[key] : STUDIO; }
  const L = await aiLayout(String(b.brief || ""), base, pdfB64);
  const title = asc(b.title || L.title || "Partition plan");
  const day = new Date().toISOString().slice(0, 10);
  const sub = `${baseName ? "Base plan: " + baseName + "  |  " : ""}Scale: fit to A3  |  Dimensions in metres  |  ${day}  |  verify all sizes on site`;
  const drawBase = base || (L.shell && L.shell.length ? { segs: L.shell } : null);
  const pdf = makePdf(drawBase, L, title, sub), dxf = makeDxf(drawBase, L, title);
  const name = `${title} (${day})`;
  const [pdfLink, dxfLink] = await Promise.all([upload(pdf, name + ".pdf", "application/pdf", folder), upload(dxf, name + ".dxf", "application/dxf", folder)]);
  const out = { title, summary: L.summary || "", pdf: pdfLink, dxf: dxfLink, folder, scale_pt_per_m: base?.k || null, rooms: (L.rooms || []).map((r: any) => `${String(r.name).replace(/\n|\\n/g, " ")} ${r.size || ""}`.trim()), notes: L.notes || [] };
  await db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "last_drawing", data: { ...out, brief: b.brief, base_file_id: b.base_file_id || null, layout: L }, updated_at: new Date().toISOString() }) });
  if (b.notify) await whatsapp(`📐 ${title} is ready, Chairman.\nPDF: ${pdfLink}\nAutoCAD: ${dxfLink}${out.notes.length ? "\nNotes: " + out.notes.slice(0, 3).join(" · ") : ""}`);
  return out;
}

Deno.serve(async (req) => {
  try {
    const k = await (await db("ami_settings?key=eq.wake_key&select=value")).json();
    if (!k?.[0]?.value || req.headers.get("x-internal-key") !== k[0].value) return Response.json({ error: "denied" }, { status: 403 });
    const b = await req.json();
    if (b.async) {
      if (b.notify === undefined) b.notify = true;
      const job = run(b).catch(async (e) => { if (b.notify) await whatsapp("⚠️ The drawing could not be made: " + (e as Error).message); console.log("drawplan error", (e as Error).message); });
      // @ts-ignore EdgeRuntime is provided by Supabase
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
      return Response.json({ started: true, note: "Drawing in progress - PDF and AutoCAD links will come by WhatsApp in about 3 minutes and be saved in Drive." });
    }
    return Response.json(await run(b));
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
