// drivesort clean-up helpers (v1.2): analyse the computer upload for junk + exact duplicates, then bin (trash, recoverable 30 days)
export const JUNK_EXT = /\.(exe|msi|msp|dmg|pkg|iso|img|tmp|temp|log|ini|lnk|url|crdownload|part|partial|download|torrent|apk|cab|dll|sys|ocx|drv|cpl|scr|bat|cmd|vbs|reg|dat|db|db-journal|sqlite-journal|thumbs|ds_store|vtt|srt|ass|sub|pf|etl|dmp|mdmp|chk|old|cache|lock|plist|nfo|sfv|map|pdb|js\.map|css\.map)$/i;
export const JUNK_NAME = /^(thumbs\.db|desktop\.ini|\.ds_store|~\$.*|\._.*|icon\r?|autorun\.inf)$/i;

export async function analyse(t: string, since: string, listAll: Function) {
  const files = await listAll(t, `createdTime > '${since}' and trashed=false and mimeType != 'application/vnd.google-apps.folder'`, "id,name,size,md5Checksum,parents,createdTime,modifiedTime");
  const folders = await listAll(t, `createdTime > '${since}' and trashed=false and mimeType = 'application/vnd.google-apps.folder'`, "id,name,parents");
  const fmap = new Map<string, any>(folders.map((f: any) => [f.id, f]));
  const path = (pid: string) => { const parts: string[] = []; let cur = pid; for (let i = 0; i < 12 && fmap.has(cur); i++) { const f = fmap.get(cur); parts.unshift(f.name); cur = (f.parents || [])[0]; } return parts.join("/"); };
  const out: any[] = [];
  // 1) junk by type / name
  for (const f of files) {
    const p = path((f.parents || [])[0]);
    if (JUNK_NAME.test(f.name) || JUNK_EXT.test(f.name)) out.push({ id: f.id, name: f.name, folder: p, size: +f.size || 0, reason: "junk: " + (f.name.split(".").pop() || "").toLowerCase() });
  }
  const junkIds = new Set(out.map((x) => x.id));
  // 2) exact duplicates (same content checksum): keep the copy with the shortest path (oldest if tie), bin the rest
  const byMd5 = new Map<string, any[]>();
  for (const f of files) { if (!f.md5Checksum || junkIds.has(f.id)) continue; const a = byMd5.get(f.md5Checksum) || []; a.push(f); byMd5.set(f.md5Checksum, a); }
  for (const group of byMd5.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => path((a.parents || [])[0]).length - path((b.parents || [])[0]).length || String(a.modifiedTime).localeCompare(String(b.modifiedTime)));
    const keep = group[0];
    for (const f of group.slice(1)) out.push({ id: f.id, name: f.name, folder: path((f.parents || [])[0]), size: +f.size || 0, reason: "duplicate of " + path((keep.parents || [])[0]) + "/" + keep.name });
  }
  // summary per reason group and the "English" folder sample
  const sum = new Map<string, { n: number; b: number }>();
  for (const x of out) { const k = x.reason.startsWith("junk") ? x.reason : "duplicate"; const g = sum.get(k) || { n: 0, b: 0 }; g.n++; g.b += x.size; sum.set(k, g); }
  const english = files.filter((f: any) => /(^|\/)English(\/|$)/.test(path((f.parents || [])[0]))).slice(0, 25).map((f: any) => path((f.parents || [])[0]) + "/" + f.name);
  const downloads = files.filter((f: any) => /(^|\/)Downloads(\/|$)/.test(path((f.parents || [])[0]))).sort((a: any, b: any) => (+b.size || 0) - (+a.size || 0)).slice(0, 40).map((f: any) => [f.name, Math.round((+f.size || 0) / 1e6)]);
  return { total: files.length, candidates: out, summary: [...sum.entries()].sort((a, b) => b[1].b - a[1].b).map(([k, g]) => [k, g.n, Math.round(g.b / 1e6)]), english, downloads };
}
