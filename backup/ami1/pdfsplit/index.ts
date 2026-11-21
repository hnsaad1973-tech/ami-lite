// pdfsplit v1.0 (18 Nov 2026) - split a large Drive PDF into one PDF per page and save each page back to Drive (internal key only).
// {file_id, folder_id, prefix?} -> {name, pages, files:[{page,id,size}]}
import { PDFDocument } from "npm:pdf-lib@1.17.1";
const SB = Deno.env.get('SUPABASE_URL') || '', SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = (p: string) => fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN')!, grant_type: 'refresh_token' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('Google sign-in failed'); return j.access_token as string;
}
async function put(T: string, folder: string, name: string, bytes: Uint8Array) {
  const bd = 'amis' + Date.now();
  const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${bd}\r\nContent-Type: application/pdf\r\n\r\n`);
  const post = new TextEncoder().encode(`\r\n--${bd}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length); body.set(pre); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const u = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': `multipart/related; boundary=${bd}` }, body });
  const j = await u.json(); if (!u.ok) throw new Error(j?.error?.message || String(u.status)); return j.id as string;
}
Deno.serve(async (req) => {
  try {
    const k = await (await db('ami_settings?key=eq.wake_key&select=value')).json();
    if (!k?.[0]?.value || req.headers.get('x-internal-key') !== k[0].value) return Response.json({ error: 'denied' }, { status: 403 });
    const b = await req.json(); const T = await token(); const H = { Authorization: 'Bearer ' + T };
    const m = await (await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?fields=name,size`, { headers: H })).json();
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?alt=media`, { headers: H });
    if (!r.ok) return Response.json({ error: 'download ' + r.status }, { status: 500 });
    const src = await PDFDocument.load(new Uint8Array(await r.arrayBuffer()), { ignoreEncryption: true });
    const n = src.getPageCount(); const files: any[] = [];
    const base = String(b.prefix || m.name || 'file').replace(/\.pdf$/i, '');
    for (let i = 0; i < n; i++) {
      const d = await PDFDocument.create(); const [p] = await d.copyPages(src, [i]); d.addPage(p);
      const bytes = await d.save();
      const id = await put(T, b.folder_id, `${base}_p${i + 1}.pdf`, bytes);
      files.push({ page: i + 1, id, size: bytes.length });
    }
    return Response.json({ name: m.name, size: m.size, pages: n, files });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
