/* Admin online/offline logic. student.js + admin.js dono yahi use karte hain (tg_bridge.py me bhi same logic hai).
   Firestore doc: settings/presence = { mode: "auto"|"online"|"offline", until: ms|null, offFrom: 22, offTo: 6 }
   auto    -> raat offFrom baje se subah offTo baje tak offline (IST), baaki din online
   manual  -> admin ne online/offline kiya; `until` par khud khatam hoke auto wapas aa jata hai (null = jab tak admin na badle) */
const IST = 19800000, HR = 3600000;
const num = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? d : ((Number(v) % 24) + 24) % 24;
const ist = (ms) => new Date(ms + IST);
export const hourOf = (ms) => ist(ms).getUTCHours();
export const schedOffline = (ms, a, b) => { const h = hourOf(ms); return a > b ? (h >= a || h < b) : (h >= a && h < b); };
/* ms ke baad agla "hr:00" (IST) */
export function nextAt(ms, hr) { const d = ist(ms); d.setUTCHours(hr, 0, 0, 0); const t = d.getTime() - IST; return t > ms ? t : t + 24 * HR; }

export function resolvePresence(p, ms = Date.now()) {
  p = p || {};
  const a = num(p.offFrom, 22), b = num(p.offTo, 6), sched = schedOffline(ms, a, b);
  const until = (p.until === null || p.until === undefined) ? null : Number(p.until);
  const manual = (p.mode === "online" || p.mode === "offline") && (until === null || ms < until);
  const offline = manual ? p.mode === "offline" : sched;
  let back = null;                                   // kab online honge (null = pata nahi / admin par depend)
  if (offline && !(manual && until === null)) { const t = manual ? until : ms; back = schedOffline(t, a, b) ? nextAt(t, b) : t; }
  return { offline, manual, back, sched, a, b };
}

/* admin ka button -> Firestore me kya likhna hai */
export function overrideFor(kind, p, ms = Date.now()) {
  p = p || {};
  const a = num(p.offFrom, 22), b = num(p.offTo, 6), so = schedOffline(ms, a, b);
  if (kind === "online") return so ? { mode: "online", until: nextAt(ms, b) } : { mode: "auto", until: null };
  if (kind === "offline") return { mode: "offline", until: so ? nextAt(nextAt(ms, b), a) : nextAt(ms, a) };
  if (kind === "offline_forever") return { mode: "offline", until: null };
  return { mode: "auto", until: null };
}

export function backText(ms, now = Date.now()) {
  if (!ms) return "";
  const d = ist(ms), n = ist(now);
  const day = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86400000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return (day === 1 ? "kal " : day > 1 ? `${d.getUTCDate()}/${d.getUTCMonth() + 1} ` : "") + `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export const hourLabel = (h) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;
