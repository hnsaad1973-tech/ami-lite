// meetscribe v1.0 (20 Nov 2026) — transcribe a meeting recording kept in Google Drive with Gemini, in the background.
// Call: POST {file_id, job} with header x-internal-key = ami_settings.wake_key. Result saved to ami_settings key "meet_<job>" as JSON {status, transcript|error}.
const SB = Deno.env.get("SUPABASE_URL") || "";
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, {
  ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
});
async function setting(k: string): Promise<string> {
  const r = await db(`ami_settings?key=eq.${k}&select=value`);
  return r.ok ? String((await r.json())[0]?.value || "").trim() : "";
}
async function save(k: string, v: unknown) {
  await db("ami_settings", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: k, value: JSON.stringify(v) }) });
}
async function googleToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (Deno.env.get("GOOGLE_CLIENT_ID") || "").trim(), client_secret: (Deno.env.get("GOOGLE_CLIENT_SECRET") || "").trim(),
      refresh_token: (Deno.env.get("GOOGLE_REFRESH_TOKEN") || "").trim(), grant_type: "refresh_token",
    }),
  });
  return (await r.json().catch(() => ({}))).access_token || "";
}
function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
const PROMPT = `This is a recording of a business meeting held in Monrovia, Liberia, involving Hussein Saad (the Chairman of Saad Ventures Group; companies Leone Investment, Cape Realities, Platinum Insurers, RED INC, The Lead). Speakers may use Liberian or Sierra Leonean English, Krio or Arabic.
Write a full transcript in English. Start a new line for each change of speaker, labelled "Speaker 1:", "Speaker 2:" etc. (use a person's name only when it is clearly said in the meeting). Put [mm:ss] at the start of each line. Translate any Arabic or Krio into English and mark it [translated]. Mark unclear words as [unclear]. Do not summarise and do not leave out any part.`;

async function work(fileId: string, job: string) {
  const key = `meet_${job}`;
  try {
    await save(key, { status: "running", at: new Date().toISOString() });
    const tok = await googleToken();
    const f = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!f.ok) throw new Error("Drive download failed: " + f.status);
    const buf = await f.arrayBuffer();
    const gkey = await setting("gemini_api_key");
    if (!gkey) throw new Error("No Gemini key");
    let text = "", last = "";
    for (const model of ["gemini-3.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"]) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(380000), headers: { "x-goog-api-key": gkey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "audio/ogg", data: b64(buf) } }, { text: PROMPT }] }], generationConfig: { temperature: 0, maxOutputTokens: 60000 } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { last = `${model}: ${r.status} ${String(j?.error?.message || "").slice(0, 200)}`; continue; }
      text = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (text) { last = model; break; }
    }
    if (!text) throw new Error("Transcription failed — " + last);
    await save(key, { status: "done", model: last, chars: text.length, transcript: text, at: new Date().toISOString() });
  } catch (e) {
    await save(key, { status: "error", error: (e as Error).message, at: new Date().toISOString() });
  }
}

Deno.serve(async (req) => {
  const k = req.headers.get("x-internal-key") || "";
  if (!k || k !== (await setting("wake_key"))) return new Response(JSON.stringify({ error: "denied" }), { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.file_id || !body.job) return new Response(JSON.stringify({ error: "file_id and job needed" }), { status: 400 });
  const p = work(String(body.file_id), String(body.job).replace(/[^a-z0-9_]/gi, ""));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  return new Response(JSON.stringify({ started: true }), { headers: { "Content-Type": "application/json" } });
});
