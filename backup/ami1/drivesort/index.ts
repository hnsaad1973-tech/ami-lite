// drivesort v1.5 (ownlist/owngive = hand files to the AMI account to free space; share); v1.4 (emptytrash = permanently empty the Drive bin, Chairman YES only); v1.3 tree; v1.2: list loose My Drive files + folders, move files, report a computer upload, and clean it up
// (analyse = find junk + exact duplicates -> drive_cleanup table; trash = bin them, recoverable 30 days). Internal key only.
import { analyse } from "./clean.ts";
const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) } });
async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") || "", grant_type: "refresh_token" }) });
  return (await r.json()).access_token as string;
}
async function listAll(t: string, q: string, fields: string, extra = "") {
  const out: any[] = []; let page = "";
  do {
    const u = `https://www.googleapis.com/drive/v3/files?pageSize=1000${extra}&q=${encodeURIComponent(q)}&fields=nextPageToken,files(${fields})${page ? "&pageToken=" + page : ""}`;
    const j = await (await fetch(u, { headers: { Authorization: "Bearer " + t } })).json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    out.push(...(j.files || [])); page = j.nextPageToken || "";
  } while (page);
  return out;
}
const store = (key: string, data: any) => db("ami_brain", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }) });
function bg(p: Promise<unknown>) { const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => null); }

Deno.serve(async (req) => {
  const r = await fetch(`${SB}/rest/v1/ami_settings?key=eq.wake_key&select=value`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const wk = r.ok ? (await r.json())[0]?.value : "";
  if (!wk || req.headers.get("x-internal-key") !== wk) return new Response("denied", { status: 403 });
  const p = await req.json().catch(() => ({}));
  const t = await token();
  try {
    if (p.action === "list") {
      const files = await listAll(t, "'root' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'", "id,name,mimeType,createdTime,size");
      const folders = await listAll(t, "mimeType = 'application/vnd.google-apps.folder' and trashed=false", "id,name,parents");
      return Response.json({ files: files.map((f) => [f.id, f.name, String(f.createdTime).slice(0, 16), f.size || ""]), folders: folders.map((f) => [f.id, f.name, (f.parents || [])[0] || ""]) });
    }
    if (p.action === "since") {
      const files = await listAll(t, `createdTime > '${p.since}' and trashed=false and mimeType != 'application/vnd.google-apps.folder'`, "id,name,size,createdTime,parents");
      const folders = await listAll(t, `createdTime > '${p.since}' and trashed=false and mimeType = 'application/vnd.google-apps.folder'`, "id,name,parents");
      const fname = new Map(folders.map((f) => [f.id, f.name]));
      const by = new Map<string, { n: number; b: number }>();
      let bytes = 0, newest = "";
      for (const f of files) { const s = +f.size || 0; bytes += s; if (f.createdTime > newest) newest = f.createdTime; const k = fname.get((f.parents || [])[0]) || (f.parents || [])[0] || "?"; const g = by.get(k) || { n: 0, b: 0 }; g.n++; g.b += s; by.set(k, g); }
      const top = [...by.entries()].sort((a, b) => b[1].b - a[1].b).slice(0, 25).map(([k, g]) => [k, g.n, Math.round(g.b / 1e6)]);
      const about = await (await fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota", { headers: { Authorization: "Bearer " + t } })).json();
      return Response.json({ files: files.length, folders: folders.length, mb: Math.round(bytes / 1e6), newest, quota: about.storageQuota, top });
    }
    if (p.action === "tree") {
      const files = await listAll(t, `createdTime > '${p.since}' and trashed=false and mimeType != 'application/vnd.google-apps.folder'`, "size,parents");
      const folders = await listAll(t, `createdTime > '${p.since}' and trashed=false and mimeType = 'application/vnd.google-apps.folder'`, "id,name,parents");
      const fmap = new Map<string, any>(folders.map((f: any) => [f.id, { ...f, n: 0, b: 0 }]));
      for (const f of files) { let cur = (f.parents || [])[0]; for (let i = 0; i < 15 && fmap.has(cur); i++) { const x = fmap.get(cur); x.n++; x.b += +f.size || 0; cur = (x.parents || [])[0]; } }
      const path = (id: string) => { const parts: string[] = []; let cur = id; for (let i = 0; i < 15 && fmap.has(cur); i++) { const f = fmap.get(cur); parts.unshift(f.name); cur = (f.parents || [])[0]; } return parts; };
      const depth = +p.depth || 4;
      const rows = [...fmap.values()].map((f) => ({ id: f.id, p: path(f.id), n: f.n, mb: Math.round(f.b / 1e5) / 10 })).filter((x) => x.p.length <= depth && x.n > 0).sort((a, b) => a.p.join("/").localeCompare(b.p.join("/")));
      return Response.json({ folders: rows.map((x) => [x.id, x.p.join("/"), x.n, x.mb]) });
    }
    if (p.action === "moveto") {
      // move folders/files (anywhere) into a target folder: [[id, newParent]]
      const moves: [string, string][] = p.moves || []; const ok: string[] = [], bad: string[] = [];
      for (let i = 0; i < moves.length; i += 10) {
        await Promise.all(moves.slice(i, i + 10).map(async ([id, folder]) => {
          const meta = await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents`, { headers: { Authorization: "Bearer " + t } })).json();
          const u = `https://www.googleapis.com/drive/v3/files/${id}?addParents=${folder}&removeParents=${(meta.parents || []).join(",")}&fields=id`;
          const x = await fetch(u, { method: "PATCH", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: "{}" });
          if (x.ok) ok.push(id); else bad.push(id + ": " + (await x.text()).slice(0, 160));
        }));
      }
      return Response.json({ moved: ok.length, failed: bad });
    }
    if (p.action === "analyse") {
      bg((async () => {
        try {
          const a = await analyse(t, p.since, listAll);
          await db("drive_cleanup?status=eq.pending", { method: "DELETE" });
          for (let i = 0; i < a.candidates.length; i += 500)
            await db("drive_cleanup", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(a.candidates.slice(i, i + 500).map((x: any) => ({ ...x, status: "pending" }))) });
          await store("drive_cleanup_report", { at: new Date().toISOString(), total: a.total, candidates: a.candidates.length, summary: a.summary, english: a.english, downloads: a.downloads });
        } catch (e) { await store("drive_cleanup_report", { error: (e as Error).message }); }
      })());
      return Response.json({ started: true });
    }
    if (p.action === "trash") {
      // bin (never permanent delete) every pending row, optionally only certain reasons
      bg((async () => {
        let done = 0, failed = 0;
        for (;;) {
          const q = await db(`drive_cleanup?status=eq.pending${p.reason ? "&reason=like." + encodeURIComponent(p.reason) : ""}&select=id&limit=200`);
          const rows: any[] = q.ok ? await q.json() : [];
          if (!rows.length) break;
          const tk = await token();
          for (let i = 0; i < rows.length; i += 20) {
            await Promise.all(rows.slice(i, i + 20).map(async (x) => {
              const res = await fetch(`https://www.googleapis.com/drive/v3/files/${x.id}?fields=id`, { method: "PATCH", headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
              await db(`drive_cleanup?id=eq.${x.id}`, { method: "PATCH", body: JSON.stringify({ status: res.ok ? "trashed" : "failed" }) });
              res.ok ? done++ : failed++;
            }));
          }
          await store("drive_cleanup_progress", { trashed: done, failed, at: new Date().toISOString() });
        }
        await store("drive_cleanup_progress", { trashed: done, failed, finished: true, at: new Date().toISOString() });
      })());
      return Response.json({ started: true });
    }
    if (p.action === "move") {
      const moves: [string, string][] = p.moves || []; const ok: string[] = [], bad: string[] = [];
      for (let i = 0; i < moves.length; i += 10) {
        await Promise.all(moves.slice(i, i + 10).map(async ([id, folder]) => {
          const u = `https://www.googleapis.com/drive/v3/files/${id}?addParents=${folder}&removeParents=root&fields=id`;
          const x = await fetch(u, { method: "PATCH", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: "{}" });
          if (x.ok) ok.push(id); else bad.push(id + ": " + (await x.text()).slice(0, 120));
        }));
      }
      return Response.json({ moved: ok.length, failed: bad });
    }
    if (p.action === "emptytrash") {
      const x = await fetch("https://www.googleapis.com/drive/v3/files/trash", { method: "DELETE", headers: { Authorization: "Bearer " + t } });
      const about = await (await fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota", { headers: { Authorization: "Bearer " + t } })).json();
      return Response.json({ emptied: x.ok, status: x.status, err: x.ok ? "" : (await x.text()).slice(0, 200), quota: about.storageQuota });
    }
    if (p.action === "ownlist") {
      // list every uploaded (storage-using) file under the given root folders into drive_transfer
      const roots: string[] = p.roots || [];
      const folders = await listAll(t, "mimeType = 'application/vnd.google-apps.folder' and trashed=false", "id,parents");
      const kids = new Map<string, string[]>();
      for (const f of folders) { const pa = (f.parents || [])[0]; if (!pa) continue; const a = kids.get(pa) || []; a.push(f.id); kids.set(pa, a); }
      const out: any[] = [];
      for (const root of roots) {
        const ids: string[] = []; const stack = [root];
        while (stack.length) { const x = stack.pop()!; ids.push(x); stack.push(...(kids.get(x) || [])); }
        for (let i = 0; i < ids.length; i += 40) {
          const q = "(" + ids.slice(i, i + 40).map((x) => `'${x}' in parents`).join(" or ") + ") and trashed=false and mimeType != 'application/vnd.google-apps.folder' and 'me' in owners";
          const files = await listAll(t, q, "id,name,size,mimeType");
          for (const f of files) if (+f.size > 0 && !String(f.mimeType).startsWith("application/vnd.google-apps")) out.push({ id: f.id, name: f.name, size: +f.size, root, status: "pending" });
        }
      }
      for (let i = 0; i < out.length; i += 500)
        await db("drive_transfer", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(out.slice(i, i + 500)) });
      return Response.json({ files: out.length, mb: Math.round(out.reduce((a, b) => a + b.size, 0) / 1e6) });
    }
    if (p.action === "owngive") {
      // offer ownership of pending files to the AMI account (it must accept). Runs ~120 s per call; call again until none pending.
      const to = p.to || "assetmanagementami@gmail.com";
      const started = Date.now(); let done = 0, failed = 0;
      while (Date.now() - started < 110000) {
        const q = await db(`drive_transfer?status=eq.pending&select=id&limit=100`);
        const rows: any[] = q.ok ? await q.json() : [];
        if (!rows.length) break;
        for (let i = 0; i < rows.length; i += 10) {
          await Promise.all(rows.slice(i, i + 10).map(async (x) => {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${x.id}/permissions?sendNotificationEmail=false&fields=id`, { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role: "writer", emailAddress: to, pendingOwner: true }) });
            const err = res.ok ? "" : (await res.text()).slice(0, 200);
            await db(`drive_transfer?id=eq.${x.id}`, { method: "PATCH", body: JSON.stringify({ status: res.ok ? "offered" : "failed", err, updated_at: new Date().toISOString() }) });
            res.ok ? done++ : failed++;
          }));
        }
      }
      return Response.json({ offered: done, failed });
    }
    if (p.action === "share") {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${p.id}/permissions?sendNotificationEmail=false&fields=id`, { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role: p.role || "writer", emailAddress: p.to }) });
      return Response.json({ ok: res.ok, r: await res.text() });
    }
    if (p.action === "mkdir") {
      const x = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, mimeType: "application/vnd.google-apps.folder", parents: [p.parent] }) });
      return Response.json(await x.json());
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
