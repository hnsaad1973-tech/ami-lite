// drawelev v1.0 — AMI's elevations / sections / 3D engine: from a building spec (or a brief + AMI's last floor plan),
// draws the four elevations, a section through the middle and a 3D massing view, with levels and measurements,
// as one PDF (A3 pages) + one AutoCAD DXF (metres), saved to Drive. Geometry is computed in code (no AI guessing);
// the AI only turns the brief into the building spec.
// POST (x-internal-key): {brief?, spec?, folder_id?, title?, async?, notify?, use_last_plan?}
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (p: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const STUDIO = "16IOI6ngn5ITaGuUtI84v_hgtkINNBi_T";
let T = "";
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!, grant_type: "refresh_token" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("Google sign-in failed"); T = j.access_token;
}
const num = (v: any, d = 0) => (isFinite(+v) && v !== null && v !== "" ? +v : d);
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const asc = (s: string) => String(s ?? "").replace(/[—–]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/×/g, "x").replace(/[^\x20-\x7e]/g, "");
const esc = (s: string) => asc(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// ---------------- building spec ----------------
type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; name?: string };
export type Spec = {
  title: string; width: number; depth: number;           // x = width (west->east), y = depth (front/south -> back/north)
  grid_x: number[]; grid_y: number[]; column: number;     // column grid lines (m) and column size
  levels: { name: string; z: number; x0?: number; x1?: number; y0?: number; y1?: number }[]; // floor levels from ground; partial slabs give their extent
  roof: number; slab: number; parapet: number; parapet_type: "glass" | "solid";
  pavilion?: Box | null;                                   // enclosed rooftop volume (e.g. restaurant)
  core?: Box | null;                                       // stair/lift core (z1 = top incl. lift overrun)
  glazing: Record<string, "curtain" | "punched" | "solid">; mullion: number;
  entrance?: { face: string; u0: number; u1: number; h: number } | null;
  section_x?: number; notes?: string[];
};
function normalize(s: any): Spec {
  const W = num(s.width, 21), D = num(s.depth, 21);
  const gx = (s.grid_x?.length ? s.grid_x : [0, W]).map(Number).sort((a: number, b: number) => a - b);
  const gy = (s.grid_y?.length ? s.grid_y : [0, D]).map(Number).sort((a: number, b: number) => a - b);
  const levels = (s.levels || [{ name: "GROUND", z: 0 }]).map((l: any) => ({ ...l, name: String(l.name || "LEVEL").toUpperCase(), z: num(l.z) })).sort((a: any, b: any) => a.z - b.z);
  const roof = num(s.roof, levels.length ? Math.max(...levels.map((l: any) => l.z)) + 3.5 : 3.5);
  const box = (b: any, z0: number, z1: number): Box | null => b ? { x0: num(b.x0), x1: num(b.x1, W), y0: num(b.y0), y1: num(b.y1, D), z0: num(b.z0, z0), z1: num(b.z1, z1), name: b.name } : null;
  const pav = box(s.pavilion, roof, roof + num(s.pavilion?.h, 3.5));
  if (pav && s.pavilion?.h && !s.pavilion?.z1) pav.z1 = roof + num(s.pavilion.h);
  const core = box(s.core, 0, roof + 1.5);
  const g = s.glazing || {}; const gl: Record<string, any> = {}; for (const f of ["S", "N", "E", "W"]) gl[f] = g[f] || "curtain";
  return { title: s.title || "Building", width: W, depth: D, grid_x: gx, grid_y: gy, column: num(s.column, 0.4), levels, roof, slab: num(s.slab, 0.3),
    parapet: num(s.parapet, 1.1), parapet_type: s.parapet_type === "solid" ? "solid" : "glass", pavilion: pav, core, glazing: gl, mullion: num(s.mullion, 1.5),
    entrance: s.entrance ? { face: String(s.entrance.face || "S").toUpperCase(), u0: num(s.entrance.u0), u1: num(s.entrance.u1, num(s.entrance.u0) + 3), h: num(s.entrance.h, 3) } : null,
    section_x: s.section_x != null ? num(s.section_x) : undefined, notes: s.notes || [] };
}

// ---------------- drawing primitives (metres, per view) ----------------
type Prim = { t: "l"; a: number[]; ly: string; w: number; c: number[]; dash?: boolean } | { t: "p"; pts: number[][]; ly: string; fill: number[]; stroke?: number[]; w?: number }
  | { t: "x"; x: number; y: number; s: number; str: string; ly: string; al: "l" | "c" | "r"; b?: boolean } | { t: "o"; x: number; y: number; r: number; ly: string };
class View {
  p: Prim[] = []; name: string; constructor(name: string) { this.name = name; }
  line(x1: number, y1: number, x2: number, y2: number, ly = "OUTLINE", w = 0.6, c = [0, 0, 0], dash = false) { this.p.push({ t: "l", a: [x1, y1, x2, y2], ly, w, c, dash }); }
  rect(x0: number, y0: number, x1: number, y1: number, ly = "OUTLINE", w = 0.6, c = [0, 0, 0]) { this.line(x0, y0, x1, y0, ly, w, c); this.line(x1, y0, x1, y1, ly, w, c); this.line(x1, y1, x0, y1, ly, w, c); this.line(x0, y1, x0, y0, ly, w, c); }
  poly(pts: number[][], fill: number[], ly = "FILL", stroke?: number[], w = 0.6) { this.p.push({ t: "p", pts, ly, fill, stroke, w }); }
  fillRect(x0: number, y0: number, x1: number, y1: number, fill: number[], ly = "CUT") { this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, ly, [0, 0, 0], 0.4); }
  text(x: number, y: number, s: number, str: string, al: "l" | "c" | "r" = "c", ly = "TEXT", b = false) { this.p.push({ t: "x", x, y, s, str, ly, al, b }); }
  circle(x: number, y: number, r: number, ly = "GRID") { this.p.push({ t: "o", x, y, r, ly }); }
  bbox() { const xs: number[] = [], ys: number[] = [];
    for (const q of this.p) { if (q.t === "l") { xs.push(q.a[0], q.a[2]); ys.push(q.a[1], q.a[3]); } else if (q.t === "p") for (const [x, y] of q.pts) { xs.push(x); ys.push(y); }
      else if (q.t === "x") { const w = asc(q.str).length * q.s * 0.55; xs.push(q.al === "l" ? q.x + w : q.al === "r" ? q.x - w : q.x + w / 2, q.al === "c" ? q.x - w / 2 : q.x); ys.push(q.y, q.y + q.s); }
      else { xs.push(q.x - q.r, q.x + q.r); ys.push(q.y - q.r, q.y + q.r); } }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }
}
const levelMark = (v: View, x: number, z: number, label: string, right = true) => {
  const d = right ? 1 : -1; v.line(x, z, x + d * 2.6, z, "DIMS", 0.4);
  v.poly([[x + d * 0.35, z], [x + d * 0.6, z + 0.3], [x + d * 0.1, z + 0.3]], [1, 1, 1], "DIMS", [0, 0, 0], 0.4);
  v.text(x + d * 0.75, z + 0.12, 0.3, `${z >= 0 ? "+" : ""}${f2(z)}  ${label}`, right ? "l" : "r", "DIMS");
};
const dimH = (v: View, a: number, b: number, y: number, label?: string) => { // horizontal dimension
  v.line(a, y, b, y, "DIMS", 0.35); for (const x of [a, b]) { v.line(x - 0.15, y - 0.15, x + 0.15, y + 0.15, "DIMS", 0.5); v.line(x, y - 0.35, x, y + 0.35, "DIMS", 0.3); }
  v.text((a + b) / 2, y + 0.15, 0.3, label || f2(b - a), "c", "DIMS"); };
const dimV = (v: View, a: number, b: number, x: number, label?: string) => {
  v.line(x, a, x, b, "DIMS", 0.35); for (const z of [a, b]) { v.line(x - 0.15, z - 0.15, x + 0.15, z + 0.15, "DIMS", 0.5); v.line(x - 0.35, z, x + 0.35, z, "DIMS", 0.3); }
  v.text(x - 0.2, (a + b) / 2 - 0.1, 0.3, label || f2(b - a), "r", "DIMS"); };
const gridName = (i: number, alpha: boolean) => alpha ? String.fromCharCode(65 + i) : String(i + 1);

// ---------------- elevation of one face ----------------
// face S: seen from the front (south), u = x.  N: u = W - x.  E: u = y.  W: u = D - y.
function elevation(s: Spec, face: string): View {
  const W = s.width, D = s.depth, top = s.roof + s.parapet;
  const v = new View(`${face === "S" ? "FRONT (SOUTH)" : face === "N" ? "REAR (NORTH)" : face === "E" ? "SIDE (EAST)" : "SIDE (WEST)"} ELEVATION`);
  const len = face === "S" || face === "N" ? W : D;
  const U = (x: number, y: number) => face === "S" ? x : face === "N" ? W - x : face === "E" ? y : D - y;
  const span = (b: Box) => { const a = U(b.x0, b.y0), c = U(b.x1, b.y1); return [Math.min(a, c), Math.max(a, c)]; };
  // ground
  v.line(-3, 0, len + 3, 0, "OUTLINE", 1.6);
  for (let i = -3; i < len + 3; i += 0.8) v.line(i, 0, i - 0.4, -0.4, "OUTLINE", 0.3);
  // rooftop volumes behind the parapet (farthest first)
  const ups = [s.pavilion, s.core].filter(Boolean) as Box[];
  const depthOf = (b: Box) => face === "S" ? b.y0 : face === "N" ? D - b.y1 : face === "E" ? W - b.x1 : b.x0;
  ups.sort((a, b) => depthOf(b) - depthOf(a));
  for (const b of ups) { const [u0, u1] = span(b); if (b.z1 <= s.roof) continue;
    v.poly([[u0, s.roof], [u1, s.roof], [u1, b.z1], [u0, b.z1]], b === s.core ? [0.9, 0.9, 0.9] : [0.93, 0.96, 1], "OUTLINE", [0, 0, 0], 1);
    if (b === s.pavilion) { for (let u = u0 + s.mullion; u < u1 - 0.1; u += s.mullion) v.line(u, s.roof + 0.1, u, b.z1 - 0.35, "GLAZING", 0.3, [0.2, 0.4, 0.7]);
      v.line(u0, b.z1 - 0.35, u1, b.z1 - 0.35, "OUTLINE", 0.5); v.text(u0 + 0.4, s.roof + s.parapet + 0.4, 0.3, b.name || "ROOF PAVILION", "l", "TEXT", true); }
    else v.text((u0 + u1) / 2, b.z1 + 0.2, 0.3, b.name || "CORE / LIFT OVERRUN", "c"); }
  // main block
  v.poly([[0, 0], [len, 0], [len, s.roof], [0, s.roof]], s.glazing[face] === "solid" ? [0.95, 0.95, 0.93] : [0.88, 0.93, 0.98], "OUTLINE", [0, 0, 0], 1.6);
  // slab edges visible on this face
  const faceAt = face === "S" ? { k: "y", v: 0 } : face === "N" ? { k: "y", v: D } : face === "E" ? { k: "x", v: W } : { k: "x", v: 0 };
  const slabs: { z: number; u0: number; u1: number; name: string; onFace: boolean }[] = [];
  for (const l of s.levels) { if (l.z <= 0 || l.z >= s.roof) continue;
    const b: Box = { x0: num(l.x0, 0), x1: num(l.x1, W), y0: num(l.y0, 0), y1: num(l.y1, D), z0: l.z, z1: l.z };
    const [u0, u1] = span(b); const onFace = faceAt.k === "y" ? Math.abs((faceAt.v === 0 ? b.y0 : b.y1) - faceAt.v) < 0.05 : Math.abs((faceAt.v === 0 ? b.x0 : b.x1) - faceAt.v) < 0.05;
    slabs.push({ z: l.z, u0, u1, name: l.name, onFace }); }
  const gl = s.glazing[face];
  // glazing: mullions + transoms between visible slab bands
  if (gl !== "solid") {
    const bands = [0, ...slabs.filter((b) => b.onFace).map((b) => b.z), s.roof].sort((a, b) => a - b);
    for (let i = 0; i < bands.length - 1; i++) { const z0 = bands[i] + (i ? s.slab / 2 : 0), z1 = bands[i + 1] - s.slab / 2;
      if (gl === "curtain") { for (let u = s.mullion; u < len - 0.05; u += s.mullion) v.line(u, z0, u, z1, "GLAZING", 0.3, [0.2, 0.4, 0.7]);
        if (z1 - z0 > 4.5) for (let z = z0 + 3.5; z < z1 - 0.5; z += 3.5) v.line(0, z, len, z, "GLAZING", 0.25, [0.2, 0.4, 0.7]); }
      else for (let u = 0.9; u < len - 1.5; u += 3) v.rect(u, z0 + 0.9, u + 1.8, Math.min(z1 - 0.3, z0 + 2.7), "GLAZING", 0.4, [0.2, 0.4, 0.7]); } }
  for (const b of slabs) { if (b.onFace) v.fillRect(b.u0, b.z - s.slab, b.u1, b.z, [0.35, 0.35, 0.35], "SLABS");
    else v.line(b.u0, b.z - s.slab / 2, b.u1, b.z - s.slab / 2, "HIDDEN", 0.4, [0.45, 0.45, 0.45], true); }
  v.fillRect(0, s.roof - s.slab, len, s.roof, [0.35, 0.35, 0.35], "SLABS");
  // parapet / balustrade
  if (s.parapet_type === "glass") { v.rect(0, s.roof, len, top, "OUTLINE", 0.6); for (let u = 0; u <= len + 0.01; u += 1.5) v.line(Math.min(u, len), s.roof, Math.min(u, len), top, "OUTLINE", 0.4); }
  else v.poly([[0, s.roof], [len, s.roof], [len, top], [0, top]], [0.9, 0.9, 0.88], "OUTLINE", [0, 0, 0], 1);
  // entrance
  if (s.entrance && s.entrance.face === face) { const e = s.entrance; v.poly([[e.u0, 0], [e.u1, 0], [e.u1, e.h], [e.u0, e.h]], [0.75, 0.85, 0.95], "OUTLINE", [0, 0, 0], 1.2);
    v.line((e.u0 + e.u1) / 2, 0, (e.u0 + e.u1) / 2, e.h, "OUTLINE", 0.6); v.text((e.u0 + e.u1) / 2, e.h + 0.25, 0.3, "MAIN ENTRANCE", "c"); }
  // grid lines + bubbles
  const alpha = face === "S" || face === "N"; const gr = alpha ? s.grid_x : s.grid_y;
  const highest = Math.max(top, ...ups.map((b) => b.z1));
  gr.forEach((g, i) => { const u = alpha ? (face === "S" ? g : W - g) : (face === "E" ? g : D - g);
    v.line(u, -0.6, u, highest + 1.2, "GRID", 0.25, [0.5, 0.5, 0.5], true); v.circle(u, highest + 1.7, 0.45); v.text(u, highest + 1.58, 0.35, gridName(i, alpha), "c", "GRID", true); });
  // levels
  const marks = [{ z: 0, n: s.levels[0]?.name || "GROUND" }, ...s.levels.filter((l) => l.z > 0 && l.z < s.roof).map((l) => ({ z: l.z, n: l.name })), { z: s.roof, n: "ROOF" }, { z: top, n: "TOP OF " + (s.parapet_type === "glass" ? "BALUSTRADE" : "PARAPET") }];
  for (const b of ups) if (b.z1 > top + 0.1) marks.push({ z: b.z1, n: "TOP OF " + (b.name || "CORE") });
  for (const m of marks) levelMark(v, len + 0.6, m.z, m.n);
  // dimensions
  const g2 = [...gr].map((g) => alpha ? (face === "S" ? g : W - g) : (face === "E" ? g : D - g)).sort((a, b) => a - b);
  for (let i = 0; i < g2.length - 1; i++) dimH(v, g2[i], g2[i + 1], -1.4);
  dimH(v, 0, len, -2.4, `${f2(len)} OVERALL`);
  const zs = [...new Set(marks.map((m) => m.z))].sort((a, b) => a - b);
  for (let i = 0; i < zs.length - 1; i++) dimV(v, zs[i], zs[i + 1], -1.2);
  dimV(v, 0, zs[zs.length - 1], -3.0, `${f2(zs[zs.length - 1])} TOTAL`);
  return v;
}

// ---------------- section through the middle (cut on x = section_x, looking west->east: u = y) ----------------
function section(s: Spec): View {
  const W = s.width, D = s.depth, X = s.section_x ?? W / 2, top = s.roof + s.parapet, t = s.slab;
  const v = new View("SECTION A-A");
  const cut = [0.15, 0.15, 0.15];
  // ground + foundation
  v.line(-3, 0, D + 3, 0, "OUTLINE", 1.6); v.fillRect(-0.2, -0.5, D + 0.2, 0, cut, "CUT");
  v.text(D / 2, -1.1, 0.3, "GROUND SLAB ON GRADE / FOUNDATIONS (BY STRUCTURAL ENGINEER)", "c");
  // columns beyond the cut (nearest grid line east of the cut)
  const gxBeyond = s.grid_x.find((g) => g > X + 0.01) ?? s.grid_x[s.grid_x.length - 1];
  for (const gy of s.grid_y) { const h = s.column / 2; v.rect(gy - h, 0, gy + h, s.roof - t, "BEYOND", 0.4, [0.4, 0.4, 0.4]); }
  v.text(D / 2, -1.6, 0.25, `columns shown are on grid ${gridName(s.grid_x.indexOf(gxBeyond), true)} (beyond the cut)`, "c", "TEXT");
  // slabs
  const marks: { z: number; n: string }[] = [{ z: 0, n: s.levels[0]?.name || "GROUND" }];
  for (const l of s.levels) { if (l.z <= 0 || l.z >= s.roof) continue;
    const x0 = num(l.x0, 0), x1 = num(l.x1, W); if (X < x0 || X > x1) { marks.push({ z: l.z, n: l.name + " (not cut)" }); continue; }
    const y0 = num(l.y0, 0), y1 = num(l.y1, D); v.fillRect(y0, l.z - t, y1, l.z, cut); marks.push({ z: l.z, n: l.name });
    if (y0 > 0.05) { v.line(y0, l.z, y0, l.z + 1.1, "OUTLINE", 0.6); v.line(y0 - 0.05, l.z + 1.1, y0 + 0.05, l.z + 1.1, "OUTLINE", 1.2); v.text(y0 + 0.2, l.z + 1.25, 0.25, "BALUSTRADE 1.10", "l"); } }
  v.fillRect(0, s.roof - t, D, s.roof, cut); marks.push({ z: s.roof, n: "ROOF" }, { z: top, n: s.parapet_type === "glass" ? "TOP OF BALUSTRADE" : "TOP OF PARAPET" });
  // double-height spaces: where a level is partial, the uncovered part is a void
  for (const l of s.levels) { if (l.z <= 0 || l.z >= s.roof) continue; const y0 = num(l.y0, 0), y1 = num(l.y1, D);
    const below = s.levels.filter((k) => k.z < l.z).pop()?.z ?? 0; const above = s.levels.find((k) => k.z > l.z)?.z ?? s.roof;
    if (y0 > 0.5) v.text(y0 / 2, (below + above) / 2, 0.35, `DOUBLE HEIGHT ${f2(above - below)} m`, "c", "TEXT", true);
    if (y1 < D - 0.5) v.text((y1 + D) / 2, (below + above) / 2, 0.35, `DOUBLE HEIGHT ${f2(above - below)} m`, "c", "TEXT", true); }
  // facades (cut): glass = thin double line, else solid wall
  for (const [u, f] of [[0, "S"], [D, "N"]] as [number, string][]) { const d = u === 0 ? -1 : 1;
    if (s.glazing[f] === "solid") v.fillRect(u, 0, u + d * 0.2, s.roof, cut); else { v.line(u, 0, u, s.roof - t, "GLAZING", 0.8, [0.2, 0.4, 0.7]); v.line(u + d * 0.08, 0, u + d * 0.08, s.roof - t, "GLAZING", 0.4, [0.2, 0.4, 0.7]); } }
  // parapet
  for (const u of [0, D]) { v.line(u, s.roof, u, top, "OUTLINE", s.parapet_type === "glass" ? 0.8 : 3); }
  v.line(0, top, 0.6, top, "OUTLINE", 1.2); v.line(D - 0.6, top, D, top, "OUTLINE", 1.2);
  // core
  if (s.core) { const c = s.core; const cutCore = X >= c.x0 && X <= c.x1;
    if (cutCore) { v.fillRect(c.y0, 0, c.y0 + 0.2, c.z1, cut); v.fillRect(c.y1 - 0.2, 0, c.y1, c.z1, cut); v.fillRect(c.y0, c.z1 - 0.25, c.y1, c.z1, cut);
      for (const l of s.levels) if (l.z > 0 && l.z < s.roof) v.fillRect(c.y0, l.z - t, c.y1, l.z, cut);
      v.text((c.y0 + c.y1) / 2, c.z1 - 1, 0.3, "LIFT OVERRUN", "c"); v.text((c.y0 + c.y1) / 2, 1.5, 0.3, c.name || "LIFTS / STAIR CORE", "c", "TEXT", true); }
    else v.rect(c.y0, 0, c.y1, c.z1, "BEYOND", 0.5, [0.4, 0.4, 0.4]); }
  // rooftop pavilion
  if (s.pavilion) { const p = s.pavilion; const cutP = X >= p.x0 && X <= p.x1;
    if (cutP) { v.fillRect(p.y0, s.roof, p.y0 + 0.15, p.z1, cut); v.fillRect(p.y1 - 0.15, s.roof, p.y1, p.z1, cut); v.fillRect(p.y0 - 0.3, p.z1 - 0.25, p.y1 + 0.3, p.z1, cut); }
    else v.rect(p.y0, s.roof, p.y1, p.z1, "BEYOND", 0.5, [0.4, 0.4, 0.4]);
    v.text((p.y0 + p.y1) / 2, (s.roof + p.z1) / 2, 0.3, p.name || "ROOF PAVILION", "c"); }
  // level names inside
  const all = [...new Set([0, ...s.levels.map((l) => l.z), s.roof])].sort((a, b) => a - b);
  for (let i = 0; i < all.length - 1; i++) { const l = s.levels.find((k) => k.z === all[i]); if (l) v.text(D * 0.5, (all[i] + all[i + 1]) / 2 + (s.core && X >= s.core.x0 && X <= s.core.x1 ? 0 : 0), 0.3, l.name, "c", "TEXT"); }
  if (s.pavilion) marks.push({ z: s.pavilion.z1, n: "TOP OF " + (s.pavilion.name || "PAVILION") });
  if (s.core && s.core.z1 > top) marks.push({ z: s.core.z1, n: "TOP OF CORE" });
  for (const m of marks) levelMark(v, D + 0.6, m.z, m.n);
  // grid + dims
  const highest = Math.max(top, s.pavilion?.z1 || 0, s.core?.z1 || 0);
  s.grid_y.forEach((g, i) => { v.line(g, -0.6, g, highest + 1.2, "GRID", 0.25, [0.5, 0.5, 0.5], true); v.circle(g, highest + 1.7, 0.45); v.text(g, highest + 1.58, 0.35, gridName(i, false), "c", "GRID", true); });
  for (let i = 0; i < s.grid_y.length - 1; i++) dimH(v, s.grid_y[i], s.grid_y[i + 1], -2.4);
  const zs = [...new Set(marks.map((m) => m.z))].sort((a, b) => a - b);
  for (let i = 0; i < zs.length - 1; i++) dimV(v, zs[i], zs[i + 1], -1.2);
  dimV(v, 0, zs[zs.length - 1], -3.0, `${f2(zs[zs.length - 1])} TOTAL`);
  v.text(-0.5, -3.3, 0.3, "FRONT (SOUTH)", "l", "TEXT", true); v.text(D + 0.5, -3.3, 0.3, "REAR (NORTH)", "r", "TEXT", true);
  return v;
}

// ---------------- 3D massing (isometric, from the south-west) ----------------
function axo(s: Spec): View {
  const v = new View("3D VIEW (FROM SOUTH-WEST)");
  const c = Math.cos(Math.PI / 6), sn = Math.sin(Math.PI / 6);
  const P = (x: number, y: number, z: number) => [(x - y) * c, (x + y) * sn + z];
  const box = (b: Box, shade: number[], top: number[], glass = false, floors: number[] = []) => {
    const { x0, x1, y0, y1, z0, z1 } = b;
    // west face (x = x0) and south face (y = y0) face the viewer, plus the top
    v.poly([P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)], shade, "FILL", [0, 0, 0], 1);
    v.poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], shade.map((k) => Math.min(1, k + 0.08)), "FILL", [0, 0, 0], 1);
    v.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top, "FILL", [0, 0, 0], 1);
    if (glass) { for (let x = x0 + s.mullion; x < x1 - 0.05; x += s.mullion) { const a = P(x, y0, z0), bb = P(x, y0, z1); v.line(a[0], a[1], bb[0], bb[1], "GLAZING", 0.25, [0.25, 0.4, 0.6]); }
      for (let y = y0 + s.mullion; y < y1 - 0.05; y += s.mullion) { const a = P(x0, y, z0), bb = P(x0, y, z1); v.line(a[0], a[1], bb[0], bb[1], "GLAZING", 0.25, [0.25, 0.4, 0.6]); } }
    for (const z of floors) { let a = P(x0, y0, z), bb = P(x1, y0, z); v.line(a[0], a[1], bb[0], bb[1], "SLABS", 1.2, [0.3, 0.3, 0.3]); a = P(x0, y0, z); bb = P(x0, y1, z); v.line(a[0], a[1], bb[0], bb[1], "SLABS", 1.2, [0.3, 0.3, 0.3]); }
  };
  // ground pad
  const g = 3; v.poly([P(-g, -g, 0), P(s.width + g, -g, 0), P(s.width + g, s.depth + g, 0), P(-g, s.depth + g, 0)], [0.94, 0.94, 0.9], "FILL", [0.6, 0.6, 0.6], 0.5);
  const fullFloors = s.levels.filter((l) => l.z > 0 && l.z < s.roof && num(l.y0, 0) < 0.05 && num(l.x0, 0) < 0.05).map((l) => l.z);
  box({ x0: 0, x1: s.width, y0: 0, y1: s.depth, z0: 0, z1: s.roof }, [0.7, 0.8, 0.9], [0.85, 0.85, 0.82], true, fullFloors);
  // partial slabs visible on the west face (e.g. mezzanine over the back bays)
  for (const l of s.levels) { if (l.z <= 0 || l.z >= s.roof || fullFloors.includes(l.z)) continue; if (num(l.x0, 0) < 0.05) { const a = P(0, num(l.y0, 0), l.z), b = P(0, num(l.y1, s.depth), l.z); v.line(a[0], a[1], b[0], b[1], "SLABS", 1.2, [0.3, 0.3, 0.3]); } }
  // balustrade on the roof edge
  const tp = s.roof + s.parapet;
  for (const [a, b] of [[P(0, 0, tp), P(s.width, 0, tp)], [P(0, 0, tp), P(0, s.depth, tp)], [P(s.width, 0, tp), P(s.width, s.depth, tp)], [P(0, s.depth, tp), P(s.width, s.depth, tp)]]) v.line(a[0], a[1], b[0], b[1], "OUTLINE", 0.8);
  for (const [x, y] of [[0, 0], [s.width, 0], [0, s.depth]]) { const a = P(x, y, s.roof), b = P(x, y, tp); v.line(a[0], a[1], b[0], b[1], "OUTLINE", 0.8); }
  const ups = [s.pavilion, s.core].filter((b) => b && b.z1 > s.roof) as Box[];
  ups.sort((a, b) => (b.x0 + b.y0) - (a.x0 + a.y0));
  for (const b of ups) box({ ...b, z0: s.roof }, b === s.core ? [0.82, 0.82, 0.82] : [0.75, 0.85, 0.95], [0.9, 0.9, 0.88], b === s.pavilion);
  if (s.entrance && s.entrance.face === "S") { const e = s.entrance; v.poly([P(e.u0, 0, 0), P(e.u1, 0, 0), P(e.u1, 0, e.h), P(e.u0, 0, e.h)], [0.45, 0.55, 0.65], "FILL", [0, 0, 0], 0.8); }
  const lb = P(s.width / 2, -g - 1.5, 0); v.text(lb[0], lb[1], 0.5, "FRONT (SOUTH)", "c", "TEXT", true);
  return v;
}

// ---------------- output ----------------
function pdfDoc(pages: string[]) {
  const PW = 1190.55, PH = 841.89; const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = []; const F1 = 3 + pages.length * 2, F2 = F1 + 1;
  pages.forEach((c, i) => { const pn = 3 + i * 2; kids.push(`${pn} 0 R`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> >> /Contents ${pn + 1} 0 R >>`, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`); });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  let pdf = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((ob, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${ob}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
// one A3 page holding 1-2 views side by side, with title block
function page(views: View[], title: string, sub: string, pageNo: string, notes: string[] = []) {
  const PW = 1190.55, PH = 841.89, M = 40, TOP = 95, BOT = 95; const o: string[] = [];
  const boxes = views.map((v) => v.bbox()); const totalW = boxes.reduce((a, b) => a + (b.x1 - b.x0), 0) + (views.length - 1) * 4;
  const maxH = Math.max(...boxes.map((b) => b.y1 - b.y0 + 2));
  const s = Math.min((PW - 2 * M) / totalW, (PH - TOP - BOT) / maxH);
  let cx = M + ((PW - 2 * M) - totalW * s) / 2;
  views.forEach((v, i) => { const b = boxes[i]; const ox = cx - b.x0 * s, oy = BOT + 25 + ((PH - TOP - BOT - 25) - (b.y1 - b.y0) * s) / 2 - b.y0 * s;
    const X = (x: number) => (ox + x * s).toFixed(2), Y = (y: number) => (oy + y * s).toFixed(2);
    for (const q of v.p) {
      if (q.t === "p") { o.push(`${q.fill.join(" ")} rg ${q.stroke ? q.stroke.join(" ") + " RG " + (q.w || 0.6) + " w" : ""}`);
        o.push(q.pts.map((p, k) => `${X(p[0])} ${Y(p[1])} ${k ? "l" : "m"}`).join(" ") + ` h ${q.stroke ? "B" : "f"}`); }
      else if (q.t === "l") o.push(`${q.c.join(" ")} RG ${q.w} w ${q.dash ? "[4 3] 0 d" : "[] 0 d"} ${X(q.a[0])} ${Y(q.a[1])} m ${X(q.a[2])} ${Y(q.a[3])} l S [] 0 d`);
      else if (q.t === "o") { const k = 0.5523 * q.r; const cx2 = q.x, cy = q.y, r = q.r;
        o.push(`0 0 0 RG 0.6 w 1 1 1 rg ${X(cx2 + r)} ${Y(cy)} m ${X(cx2 + r)} ${Y(cy + k)} ${X(cx2 + k)} ${Y(cy + r)} ${X(cx2)} ${Y(cy + r)} c ${X(cx2 - k)} ${Y(cy + r)} ${X(cx2 - r)} ${Y(cy + k)} ${X(cx2 - r)} ${Y(cy)} c ${X(cx2 - r)} ${Y(cy - k)} ${X(cx2 - k)} ${Y(cy - r)} ${X(cx2)} ${Y(cy - r)} c ${X(cx2 + k)} ${Y(cy - r)} ${X(cx2 + r)} ${Y(cy - k)} ${X(cx2 + r)} ${Y(cy)} c B`); }
      else { const sz = Math.max(4.5, Math.min(11, q.s * s)); const w = asc(q.str).length * sz * (q.b ? 0.56 : 0.5);
        const px = +X(q.x) - (q.al === "c" ? w / 2 : q.al === "r" ? w : 0); o.push(`0 0 0 rg BT /${q.b ? "F2" : "F1"} ${sz.toFixed(1)} Tf ${px.toFixed(2)} ${Y(q.y)} Td (${esc(q.str)}) Tj ET`); } }
    o.push(`0 0 0 rg BT /F2 11 Tf ${(cx + ((b.x1 - b.x0) * s) / 2 - asc(v.name).length * 3.1).toFixed(2)} ${(BOT + 5).toFixed(2)} Td (${esc(v.name)}) Tj ET`);
    o.push(`0 0 0 RG 0.8 w ${(cx + ((b.x1 - b.x0) * s) / 2 - asc(v.name).length * 3.1).toFixed(2)} ${(BOT + 2).toFixed(2)} m ${(cx + ((b.x1 - b.x0) * s) / 2 + asc(v.name).length * 3.1).toFixed(2)} ${(BOT + 2).toFixed(2)} l S`);
    cx += (b.x1 - b.x0) * s + 4 * s; });
  o.push(`0 0 0 rg BT /F2 16 Tf ${M} ${PH - 45} Td (${esc(title)}) Tj ET`, `BT /F1 9 Tf ${M} ${PH - 62} Td (${esc(sub)}) Tj ET`, `BT /F2 10 Tf ${PW - M - 60} ${PH - 45} Td (${esc(pageNo)}) Tj ET`);
  o.push(`0 0 0 RG 0.6 w ${M} ${BOT - 12} m ${PW - M} ${BOT - 12} l S`);
  notes.slice(0, 5).forEach((n, i) => o.push(`BT /F1 8 Tf ${M} ${BOT - 26 - i * 11} Td (${esc(`${i + 1}. ${n}`.slice(0, 200))}) Tj ET`));
  return o.join("\n");
}
function dxf(views: View[], title: string) {
  const o = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC", "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "10"];
  for (const [n, c] of [["OUTLINE", 7], ["SLABS", 8], ["CUT", 1], ["GLAZING", 5], ["GRID", 9], ["DIMS", 3], ["TEXT", 7], ["HIDDEN", 8], ["BEYOND", 8], ["FILL", 9]]) o.push("0", "LAYER", "2", String(n), "70", "0", "62", String(c), "6", "CONTINUOUS");
  o.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  const f = (v: number) => (+v).toFixed(3); let ox = 0;
  for (const v of views) { const b = v.bbox(); const dx = ox - b.x0;
    for (const q of v.p) {
      if (q.t === "l") o.push("0", "LINE", "8", q.ly, "10", f(q.a[0] + dx), "20", f(q.a[1]), "11", f(q.a[2] + dx), "21", f(q.a[3]));
      else if (q.t === "p") { for (let i = 0; i < q.pts.length; i++) { const a = q.pts[i], c = q.pts[(i + 1) % q.pts.length]; o.push("0", "LINE", "8", q.ly === "FILL" ? "OUTLINE" : q.ly, "10", f(a[0] + dx), "20", f(a[1]), "11", f(c[0] + dx), "21", f(c[1])); } }
      else if (q.t === "o") o.push("0", "CIRCLE", "8", q.ly, "10", f(q.x + dx), "20", f(q.y), "40", f(q.r));
      else { const w = asc(q.str).length * q.s * 0.55; o.push("0", "TEXT", "8", q.ly, "10", f(q.x + dx - (q.al === "c" ? w / 2 : q.al === "r" ? w : 0)), "20", f(q.y), "40", f(q.s), "1", asc(q.str)); } }
    o.push("0", "TEXT", "8", "TEXT", "10", f(ox), "20", f(b.y0 - 2), "40", "0.6", "1", asc(v.name));
    ox += b.x1 - b.x0 + 12; }
  o.push("0", "TEXT", "8", "TEXT", "10", "0", "20", "-6", "40", "0.5", "1", asc(title + " - metres - for architect review"));
  o.push("0", "ENDSEC", "0", "EOF"); return new TextEncoder().encode(o.join("\n") + "\n");
}
export function drawSet(spec: any) {
  const s = normalize(spec);
  const E = { S: elevation(s, "S"), N: elevation(s, "N"), E: elevation(s, "E"), W: elevation(s, "W") }, SEC = section(s), AX = axo(s);
  const day = new Date().toISOString().slice(0, 10);
  const lv = s.levels.map((l) => `${l.name} +${f2(l.z)}`).join(", ") + `, ROOF +${f2(s.roof)}`;
  const sub = `${f2(s.width)} x ${f2(s.depth)} m  |  Levels: ${lv}  |  Dimensions in metres  |  ${day}  |  for architect review`;
  const pages = [page([E.S, E.N], s.title + " - Elevations", sub, "1 / 4", s.notes), page([E.E, E.W], s.title + " - Elevations", sub, "2 / 4", s.notes),
    page([SEC], s.title + " - Section A-A", sub + `  |  cut at x = ${f2(s.section_x ?? s.width / 2)} m`, "3 / 4", s.notes), page([AX], s.title + " - 3D Massing View", sub, "4 / 4", s.notes)];
  return { spec: s, pdf: pdfDoc(pages), dxf: dxf([E.S, E.N, E.E, E.W, SEC], s.title) };
}

// ---------------- brief -> spec (AI), using AMI's last floor plan when asked ----------------
const SPEC_HELP = `Return ONLY JSON (no markdown), metres, x = width west->east, y = depth from the FRONT (south, y=0) to the back:
{"title":"...","width":21,"depth":21,"grid_x":[0,7,14,21],"grid_y":[0,7,14,21],"column":0.4,
 "levels":[{"name":"GROUND","z":0},{"name":"MEZZANINE","z":3.5,"y0":7,"y1":21},{"name":"LEVEL 1","z":7},{"name":"LEVEL 2","z":10.5}],  // every floor level from the ground up; a PARTIAL slab gives its extent x0/x1/y0/y1 (e.g. a mezzanine over the back bays), so the rest is double height
 "roof":14,"slab":0.3,"parapet":1.1,"parapet_type":"glass"|"solid",
 "pavilion":{"name":"ROOF RESTAURANT","x0":..,"x1":..,"y0":..,"y1":..,"h":3.5} or null,   // enclosed volume on the roof terrace
 "core":{"name":"2 LIFTS + STAIR + TECHNICAL","x0":..,"x1":..,"y0":..,"y1":..,"z1":<roof + lift overrun, e.g. roof+1.5 or above the pavilion>} or null,
 "glazing":{"S":"curtain","N":"curtain","E":"curtain","W":"curtain"},   // curtain | punched | solid
 "mullion":1.5,"entrance":{"face":"S","u0":<m from the left as seen from that face>,"u1":..,"h":3},
 "section_x":<x of the section cut, through the core if possible>,
 "notes":["assumptions, max 5 short lines"]}
Floor-to-floor heights: as given in the brief (default 3.5 m). The roof level z = the top of the last occupied floor.`;
async function briefToSpec(brief: string, plan: any) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 4000, messages: [{ role: "user", content:
      `Turn this building description into the building spec for drawing elevations and sections.\n\nDESCRIPTION:\n${brief}\n\n${plan ? "AMI's LAST FLOOR PLAN of this building (use its outline, columns and core if the description does not say otherwise; plan coordinates: x east, y north, origin south-west corner):\n" + JSON.stringify(plan).slice(0, 6000) + "\n\n" : ""}${SPEC_HELP}` }] }) });
  const d = await r.json(); if (!r.ok) throw new Error("AI " + (d?.error?.message || r.status));
  const t = (d.content || []).map((b: any) => b.text || "").join(""); return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}
async function upload(bytes: Uint8Array, name: string, mime: string, folder: string) {
  const bd = "amielev" + Date.now();
  const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${bd}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = new TextEncoder().encode(`\r\n--${bd}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length); body.set(pre); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const u = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { Authorization: "Bearer " + T, "Content-Type": `multipart/related; boundary=${bd}` }, body });
  const j = await u.json(); if (!u.ok) throw new Error("Drive upload: " + (j?.error?.message || u.status)); return j.webViewLink as string;
}
async function whatsapp(text: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), tok = Deno.env.get("TWILIO_AUTH_TOKEN"); if (!sid || !tok) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: `whatsapp:${Deno.env.get("TWILIO_WHATSAPP_FROM") || "+16817351374"}`, To: "whatsapp:+231777170170", Body: text.slice(0, 1500) }) }).catch(() => {});
}
async function run(b: any) {
  await token();
  let spec = b.spec, folder = b.folder_id || "";
  if (!spec) {
    let plan: any = null;
    if (String(b.use_last_plan) !== "false") { const r = await (await db("ami_brain?key=eq.last_drawing&select=data")).json(); const d = r?.[0]?.data;
      if (d) { plan = { title: d.title, shell: d.layout?.raw?.shell, existing: d.layout?.raw?.existing, rooms: (d.layout?.raw?.rooms || []).map((x: any) => ({ name: x.name, x0: x.x0, x1: x.x1, y0: x.y0, y1: x.y1 })) }; if (!folder) folder = d.folder || ""; } }
    spec = await briefToSpec(String(b.brief || ""), plan);
  }
  if (b.title) spec.title = b.title;
  const out = drawSet(spec); if (!folder) folder = STUDIO;
  const day = new Date().toISOString().slice(0, 10); const name = `${asc(out.spec.title)} - Elevations and Section (${day})`;
  const [pdf, dx] = await Promise.all([upload(out.pdf, name + ".pdf", "application/pdf", folder), upload(out.dxf, name + ".dxf", "application/dxf", folder)]);
  const res = { title: out.spec.title, pdf, dxf: dx, folder, spec: out.spec };
  await db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "last_elevations", data: res, updated_at: new Date().toISOString() }) });
  if (b.notify) await whatsapp(`📐 ${out.spec.title} - elevations, section and 3D view are ready, Chairman.\nPDF: ${pdf}\nAutoCAD: ${dx}`);
  return res;
}
Deno.serve(async (req) => {
  try {
    const k = await (await db("ami_settings?key=eq.wake_key&select=value")).json();
    if (!k?.[0]?.value || req.headers.get("x-internal-key") !== k[0].value) return Response.json({ error: "denied" }, { status: 403 });
    const b = await req.json();
    if (b.async) { if (b.notify === undefined) b.notify = true;
      const job = run(b).catch(async (e) => { if (b.notify) await whatsapp("⚠️ The elevations could not be made: " + (e as Error).message); console.log("drawelev error", (e as Error).message); });
      // @ts-ignore EdgeRuntime is provided by Supabase
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
      return Response.json({ started: true, note: "Elevations, section and 3D view in progress - PDF and AutoCAD links come by WhatsApp in about 1 minute." }); }
    return Response.json(await run(b));
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
