// platlib v1.0 — one-off: copies Policy Library documents (Drive files and CBL web PDFs) into the private plat-library storage bucket,
// so every Platinum user can open them (Drive files are private to the Chairman). Needs AMI's internal key (checked by AMI's drivefile).
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2";
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
const store = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).storage.from("plat-library");
const DRIVEFILE = "https://pdzhlslzwjlhxklqcwus.supabase.co/functions/v1/drivefile";
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const b64dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  const key = req.headers.get("x-internal-key") || "";
  if (!key) return json({ error: "denied" }, 403);
  const b = await req.json().catch(() => ({}));
  const ids: number[] = (Array.isArray(b.ids) ? b.ids : []).map(Number);
  const rows = await sql`select id, title, url from plat.library where url is not null and storage_path is null ${ids.length ? sql`and id in ${sql(ids)}` : sql``} order by id`;
  const out: any[] = [];
  for (const r of rows) {
    try {
      let bytes: Uint8Array, name: string, mime: string;
      const m = String(r.url).match(/drive\.google\.com\/file\/d\/([^/]+)/);
      if (m) {
        const g = await fetch(DRIVEFILE, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": key }, body: JSON.stringify({ action: "get", file_id: m[1] }) });
        const j = await g.json().catch(() => ({}));
        if (g.status === 403) return json({ error: "denied" }, 403);
        if (!j.b64) throw new Error(j.error || "Drive download failed");
        bytes = b64dec(j.b64); name = j.name; mime = j.mimeType || "application/octet-stream";
      } else {
        const g = await fetch(r.url, { signal: AbortSignal.timeout(60000) });
        if (!g.ok) throw new Error("download " + g.status);
        bytes = new Uint8Array(await g.arrayBuffer()); mime = g.headers.get("content-type") || "application/pdf";
        name = decodeURIComponent(String(r.url).split("/").pop() || "document.pdf");
      }
      const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
      const path = `library/${r.id}_${safe}`;
      const { error } = await store.upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw new Error(error.message);
      await sql`update plat.library set storage_path=${path}, file_name=${name}, mime=${mime} where id=${r.id}`;
      out.push({ id: r.id, ok: true, bytes: bytes.length });
    } catch (e) { out.push({ id: r.id, ok: false, error: String((e as Error).message).slice(0, 200) }); }
  }
  return json({ done: out });
});
