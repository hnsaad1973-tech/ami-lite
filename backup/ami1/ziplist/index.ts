// ziplist v1.1 (18 Nov 2026) - read big zips in Drive without downloading them all. Internal key only.
// {file_id} -> list entries | {file_id, inner:[names]} -> list entries of zips inside the zip | {file_id, extract:name, inner_name?, folder_id, save_as} -> save one file to Drive
const SB = Deno.env.get('SUPABASE_URL') || '', SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = (p: string) => fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN')!, grant_type: 'refresh_token' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('Google sign-in failed'); return j.access_token as string;
}
async function inflateRaw(u: Uint8Array) { return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
function parseDir(tail: Uint8Array, tailStart: number) {
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1; for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip directory not found');
  return { cdSize: dv.getUint32(eocd + 12, true), cdOff: dv.getUint32(eocd + 16, true), count: dv.getUint16(eocd + 10, true) };
}
function parseCD(cd: Uint8Array) {
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength); const dec = new TextDecoder(); const out: any[] = []; let p = 0;
  while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50) {
    const method = v.getUint16(p + 10, true); const csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true); const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true); const lho = v.getUint32(p + 42, true);
    out.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + nl)), size, csize, method, lho }); p += 46 + nl + el + cl;
  }
  return out;
}
async function entryData(get: (a: number, z: number) => Promise<Uint8Array>, e: any) {
  const h = await get(e.lho, e.lho + 29); const hv = new DataView(h.buffer); const nl = hv.getUint16(26, true), el = hv.getUint16(28, true);
  const start = e.lho + 30 + nl + el; const raw = await get(start, start + e.csize - 1);
  return e.method === 8 ? await inflateRaw(raw) : raw;
}
function memZip(bytes: Uint8Array) {
  const { cdOff, cdSize } = parseDir(bytes.subarray(Math.max(0, bytes.length - 70000)), 0);
  const ents = parseCD(bytes.subarray(cdOff, cdOff + cdSize));
  const get = async (a: number, z: number) => bytes.slice(a, z + 1);
  return { ents, get };
}
Deno.serve(async (req) => {
  try {
    const k = await (await db('ami_settings?key=eq.wake_key&select=value')).json();
    if (!k?.[0]?.value || req.headers.get('x-internal-key') !== k[0].value) return Response.json({ error: 'denied' }, { status: 403 });
    const b = await req.json(); const T = await token(); const H = { Authorization: 'Bearer ' + T };
    const m = await (await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?fields=name,size`, { headers: H })).json();
    const size = Number(m.size);
    const get = async (a: number, z: number) => new Uint8Array(await (await fetch(`https://www.googleapis.com/drive/v3/files/${b.file_id}?alt=media`, { headers: { ...H, Range: `bytes=${a}-${z}` } })).arrayBuffer());
    const tailLen = Math.min(size, 70000); const tail = await get(size - tailLen, size - 1);
    const { cdOff, cdSize } = parseDir(tail, size - tailLen);
    const ents = parseCD(await get(cdOff, cdOff + cdSize - 1));
    if (b.inner) {
      const res: any = {};
      for (const n of b.inner) { const e = ents.find((x) => x.name === n); if (!e) { res[n] = 'missing'; continue; } const data = await entryData(get, e); const z = memZip(data); res[n] = z.ents.map((x) => ({ name: x.name, size: x.size })); }
      return Response.json({ inner: res });
    }
    if (b.extract) {
      const e = ents.find((x) => x.name === b.extract); if (!e) return Response.json({ error: 'missing ' + b.extract });
      let data = await entryData(get, e);
      if (b.inner_name) { const z = memZip(data); const ie = z.ents.find((x) => x.name === b.inner_name); if (!ie) return Response.json({ error: 'missing inner ' + b.inner_name }); data = await entryData(z.get, ie); }
      const bd = 'zx' + Date.now();
      const pre = new TextEncoder().encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: b.save_as, parents: [b.folder_id] })}\r\n--${bd}\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const post = new TextEncoder().encode(`\r\n--${bd}--`); const body = new Uint8Array(pre.length + data.length + post.length); body.set(pre); body.set(data, pre.length); body.set(post, pre.length + data.length);
      const u = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', { method: 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${bd}` }, body });
      return Response.json(await u.json());
    }
    return Response.json({ name: m.name, size, count: ents.length, entries: ents.map((x) => ({ name: x.name, size: x.size })) });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
});
