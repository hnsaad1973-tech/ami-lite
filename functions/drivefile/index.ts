// drivefile v1.5 (trash: own test outputs only; put: gz:true = b64 is gzip) — move small files between Drive and Claude's workspace (internal key only).
// {action:'get', file_id} -> {name, mimeType, b64}
// {action:'vision', file_id, prompt, model?} -> {text}
// {action:'pdfops', file_id, offset?, max?} -> decoded PDF content streams
// {action:'pdfsegs', file_id} -> {segs:[[x1,y1,x2,y2]...], texts:[[x,y,str]...]} line segments in PDF points
// {action:'put', folder_id, name, mimeType, b64} | {action:'put_text', folder_id, name, mimeType, text} -> {id, link}
const SB = Deno.env.get('SUPABASE_URL') || '', SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = (p: string) => fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN')!, grant_type: 'refresh_token' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('Google sign-in failed'); return j.access_token as string;
}
const b64enc = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function inflate(u: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter();
  w.write(u).catch(() => {}); w.close().catch(() => {});
  const chunks: Uint8Array[] = []; const r = ds.readable.getReader();
  try { for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); } } catch (_) {}
  const n = chunks.reduce((a, c) => a + c.length, 0); const o = new Uint8Array(n); let p = 0; for (const c of chunks) { o.set(c, p); p += c.length; } return o;
}
async function pdfOps(bytes: Uint8Array) {
  const s = new TextDecoder('latin1').decode(bytes); const out: string[] = []; const re = /stream\r?\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length; const end = s.indexOf('endstream', start); if (end < 0) break; re.lastIndex = end;
    const dict = s.slice(Math.max(0, m.index - 600), m.index); const d = dict.slice(dict.lastIndexOf('<<'));
    if (!/FlateDecode/.test(d) || /Image|ObjStm|XRef|Length1|FontFile/.test(d)) continue;
    let e = end; while (e > start && (s[e - 1] === '\n' || s[e - 1] === '\r')) e--;
    const dec = await inflate(bytes.subarray(start, e)); if (dec.length) out.push(new TextDecoder('latin1').decode(dec));
  }
  return out;
}
function segsFrom(streams: string[]) {
  const segs: number[][] = []; const texts: any[] = []; const seen = new Set<string>();
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const add = (a: number, b: number, c: number, d: number) => { const k = [r1(a), r1(b), r1(c), r1(d)]; const key = k.join(','), key2 = [k[2], k[3], k[0], k[1]].join(','); if (seen.has(key) || seen.has(key2) || (k[0] === k[2] && k[1] === k[3])) return; seen.add(key); segs.push(k); };
  for (const st of streams) {
    if (!/\s[ml]\s/.test(st) && !/\sTj|TJ/.test(st)) continue;
    let cx = 0, cy = 0, sx = 0, sy = 0, tx = 0, ty = 0; const n: number[] = [];
    const toks = st.match(/\((?:\\.|[^\\)])*\)|\[[^\]]*\]|<[0-9A-Fa-f\s]*>|\/[^\s\/\[\]()<>]+|-?\d*\.?\d+(?:[eE]-?\d+)?|[A-Za-z'"*]+/g) || [];
    for (const t of toks) {
      if (/^-?\d*\.?\d+/.test(t)) { n.push(+t); continue; }
      if (t[0] === '(' || t[0] === '[' || t[0] === '<') { texts.push([r1(tx), r1(ty), t.slice(0, 80)]); continue; }
      if (t[0] === '/') continue;
      const L = n.length;
      if (t === 'm' && L >= 2) { cx = sx = n[L - 2]; cy = sy = n[L - 1]; }
      else if ((t === 'l' && L >= 2) || (t === 'c' && L >= 6) || ((t === 'v' || t === 'y') && L >= 4)) { const x = n[L - 2], y = n[L - 1]; add(cx, cy, x, y); cx = x; cy = y; }
      else if (t === 'h') { add(cx, cy, sx, sy); cx = sx; cy = sy; }
      else if (t === 're' && L >= 4) { const [x, y, w, h] = n.slice(-4); add(x, y, x + w, y); add(x + w, y, x + w, y + h); add(x + w, y + h, x, y + h); add(x, y + h, x, y); }
      else if ((t === 'Td' || t === 'TD') && L >= 2) { tx += n[L - 2]; ty += n[L - 1]; }
      else if (t === 'Tm' && L >= 6) { tx = n[L - 2]; ty = n[L - 1]; }
      else if (t === 'BT') { tx = 0; ty = 0; }
      n.length = 0;
    }
  }
  return { segs, texts };
}
Deno.serve(async (req) => {
  try {
    const k = await (await db('ami_settings?key=eq.wake_key&select=value')).json();
    if (!k?.[0]?.value || req.headers.get('x-internal-key') !== k[0].value) return Response.json({ error: 'denied' }, { status: 403 });
    const b = await req.json(); const T = await token(); const H = { Authorization: 'Bearer ' + T };
    if (['get', 'vision', 'pdfops', 'pdfsegs'].includes(b.action)) {
      const m = await (await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?fields=name,mimeType,size`, { headers: H })).json();
      if (+m.size > 6e6) return Response.json({ error: 'too large', size: m.size });
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?alt=media`, { headers: H });
      if (!r.ok) return Response.json({ error: 'download ' + r.status }, { status: 500 });
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (b.action === 'pdfops') { const st = await pdfOps(bytes); const all = st.join('\n%%STREAM%%\n'); const off = +b.offset || 0, max = +b.max || 40000;
        return Response.json({ name: m.name, streams: st.map((x) => x.length), total: all.length, text: all.slice(off, off + max).replace(/[\x00-\x08\x0e-\x1f]/g, '') }); }
      if (b.action === 'pdfsegs') { const st = await pdfOps(bytes); const o = segsFrom(st); return Response.json({ name: m.name, n: o.segs.length, segs: o.segs, texts: o.texts.map((t: any) => [t[0], t[1], String(t[2]).replace(/[\x00-\x1f]/g, '')]) }); }
      const data = b64enc(bytes);
      if (b.action === 'get') return Response.json({ name: m.name, mimeType: m.mimeType, b64: data });
      const block = m.mimeType === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: m.mimeType, data } };
      const a = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: b.model || 'claude-sonnet-4-5', max_tokens: 12000, messages: [{ role: 'user', content: [block, { type: 'text', text: b.prompt }] }] }) });
      const d = await a.json(); if (!a.ok) return Response.json({ error: d?.error?.message || a.status }, { status: 500 });
      return Response.json({ name: m.name, text: (d.content || []).map((x: any) => x.text || '').join('') });
    }
    if (b.action === 'put' || b.action === 'put_text') {
      let bytes = b.action === 'put' ? b64dec(b.b64) : new TextEncoder().encode(b.text);
      if (b.gz) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      const bd = 'amib' + Date.now();
      const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: b.name, parents: [b.folder_id] })}\r\n--${bd}\r\nContent-Type: ${b.mimeType || 'application/octet-stream'}\r\n\r\n`);
      const post = new TextEncoder().encode(`\r\n--${bd}--`);
      const body = new Uint8Array(pre.length + bytes.length + post.length); body.set(pre); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
      const u = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${bd}` }, body });
      const j = await u.json(); if (!u.ok) return Response.json({ error: j?.error?.message || u.status }, { status: 500 });
      return Response.json({ id: j.id, name: j.name, link: j.webViewLink });
    }
    if (b.action === 'trash') { // moves to Drive bin (recoverable 30 days) - never deletes
      const u = await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?fields=id,name,trashed`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      const j = await u.json(); return Response.json(u.ok ? { trashed: true, name: j.name } : { error: j?.error?.message || u.status });
    }
    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
