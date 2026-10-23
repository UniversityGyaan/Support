
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, doc, setDoc, getDoc, addDoc, updateDoc, collection, query, orderBy, limit, onSnapshot, serverTimestamp, increment, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { resolvePresence, overrideFor, backText, hourLabel } from "./presence.js?v=9";

const app = initializeApp({
  apiKey: "AIzaSyDPqL-xSWctqMuanjyWD74dL7Rw_jQcJ2w",
  authDomain: "universitygyaan-support.firebaseapp.com",
  projectId: "universitygyaan-support",
  storageBucket: "universitygyaan-support.firebasestorage.app",
  messagingSenderId: "760546596272",
  appId: "1:760546596272:web:40ff8bf447a064cbff7275"
}, "admin");
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] });
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const $ = (id) => document.getElementById(id);

let admin = null, adminName = "Admin", authSeen = false;
let tickets = [], tab = "open", activeId = null, unsubTickets = null, unsubMsgs = null;
let prevUnread = {}, firstSnap = true, replyTo = null, forceBottom = false;
let blockedMap = {}, unsubBlocked = null, unsubPres = null, pres = null;

/* ---------- sound ---------- */
let actx = null;
const unlock = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch {} };
document.addEventListener("click", unlock); document.addEventListener("keydown", unlock);
function beep() {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination); o.frequency.value = 880;
  g.gain.setValueAtTime(.001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(.2, actx.currentTime + .02);
  g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .4);
  o.start(); o.stop(actx.currentTime + .4);
}

/* ---------- login ---------- */
$("loginBtn").onclick = async () => {
  $("loginErr").textContent = ""; $("loginBtn").disabled = true;
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch (e) { $("loginErr").textContent = "Login fail: " + (e.code || e.message); }
  $("loginBtn").disabled = false;
};
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });
$("logoutBtn").onclick = () => signOut(auth);

setTimeout(() => { if (!authSeen) $("loginBox").style.display = "block"; }, 7000);

onAuthStateChanged(auth, async (user) => {
  authSeen = true;
  if (!user) { stopApp(); return; }
  let ok = false, why = "", adoc = null;
  try { adoc = await getDoc(doc(db, "admins", user.uid)); ok = adoc.exists(); } catch (e) { why = " [" + (e.code || e.message) + "]"; }
  if (!ok) {
    $("loginBox").style.display = "block";
    $("loginErr").textContent = why
      ? "Admin check nahi ho paya" + why + ". Internet check karke page refresh karo."
      : "Login ho gaya par admin access nahi hai. Firestore me collection admins ke andar document ID = " + user.uid + " banao (koi bhi field), fir dobara login karo.";
    if (!why) await signOut(auth);   // network error par logout nahi karte
    return;
  }
  admin = user; adminName = (adoc.data() && adoc.data().name) || user.displayName || user.email.split("@")[0];
  $("loginBox").style.display = "none"; $("app").classList.add("on");
  startApp();
}, (e) => { console.error(e); $("loginBox").style.display = "block"; });

function stopApp() {
  if (unsubTickets) unsubTickets(); if (unsubMsgs) unsubMsgs();
  if (unsubBlocked) unsubBlocked(); if (unsubPres) unsubPres(); unsubBlocked = unsubPres = null; blockedMap = {};
  unsubTickets = unsubMsgs = null; admin = null; activeId = null; tickets = []; prevUnread = {}; firstSnap = true;
  $("app").classList.remove("on"); $("loginBox").style.display = "block";
  document.title = "Admin Dashboard - University Gyaan";
}

/* ---------- ticket list ---------- */
function startApp() {
  if (unsubTickets) unsubTickets();
  if (unsubBlocked) unsubBlocked(); if (unsubPres) unsubPres();
  unsubBlocked = onSnapshot(collection(db, "blocked"), (snap) => {
    blockedMap = {}; snap.forEach(d => blockedMap[d.id] = d.data());
    renderList(); updateHeader();
  }, console.error);
  unsubPres = onSnapshot(doc(db, "settings", "presence"), (s) => { pres = s.exists() ? s.data() : {}; renderPres(); }, console.error);
  unsubTickets = onSnapshot(query(collection(db, "tickets"), orderBy("lastMessageAt", "desc"), limit(200)), (snap) => {
    let ring = false;
    tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    snap.docChanges().forEach(ch => {
      if (firstSnap || ch.type === "removed") return;
      const u = ch.doc.data().unreadAdmin || 0;
      if (u > (prevUnread[ch.doc.id] || 0)) ring = true;
    });
    tickets.forEach(t => prevUnread[t.id] = t.unreadAdmin || 0);
    firstSnap = false;
    if (ring) beep();
    renderList(); updateHeader();
    const a = tickets.find(t => t.id === activeId);
    applyTicks(a);
    if (a && (a.unreadAdmin || 0) > 0) updateDoc(doc(db, "tickets", a.id), { unreadAdmin: 0 }).catch(() => {});
  }, console.error);
}

document.querySelectorAll(".tab").forEach(el => el.onclick = () => {
  tab = el.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === el));
  renderList();
});
$("search").addEventListener("input", renderList);

function timeOf(ts) { return ts && ts.toDate ? ts.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; }

function renderList() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("list"); list.replaceChildren();
  const count = { open: 0, hold: 0, resolved: 0 }, unread = { open: 0, hold: 0, resolved: 0 };
  let totalUnread = 0;
  tickets.forEach(t => {
    const s = count[t.status] !== undefined ? t.status : "open";
    count[s]++; unread[s] += (t.id === activeId ? 0 : (t.unreadAdmin || 0)); totalUnread += (t.id === activeId ? 0 : (t.unreadAdmin || 0));
  });
  $("tabOpen").textContent = `Open (${count.open})${unread.open ? " 🔴" : ""}`;
  $("tabHold").textContent = `Hold (${count.hold})${unread.hold ? " 🔴" : ""}`;
  $("tabResolved").textContent = `Resolved (${count.resolved})`;
  const blockedList = Object.entries(blockedMap).map(([uid, b]) => ({ uid, ...b }));
  $("tabBlocked").textContent = `🚫${blockedList.length ? " " + blockedList.length : ""}`;
  document.title = (totalUnread ? `(${totalUnread}) ` : "") + "Admin Dashboard - University Gyaan";

  if (tab === "blocked") {
    const bl = blockedList.filter(b => !q || (b.name || "").toLowerCase().includes(q) || String(b.rollNo || "").toLowerCase().includes(q));
    if (!bl.length) { const n = document.createElement("div"); n.className = "none"; n.textContent = "Koi blocked student nahi."; list.appendChild(n); return; }
    bl.forEach(b => {
      const el = document.createElement("div"); el.className = "t-item";
      const top = document.createElement("div"); top.className = "t-top"; top.textContent = `${b.name || "Student"} · ${b.rollNo || ""}`;
      const pv = document.createElement("div"); pv.className = "t-prev"; pv.textContent = `Block: ${b.by || "admin"}`;
      el.append(top, pv);
      if (b.reason) { const r = document.createElement("div"); r.className = "rsn"; r.textContent = "Karan: " + b.reason; el.appendChild(r); }
      const ub = document.createElement("button"); ub.className = "unb"; ub.textContent = "✅ Unblock";
      ub.onclick = () => { if (confirm(`${b.name || "Student"} (${b.rollNo || ""}) ko unblock karna hai?`)) deleteDoc(doc(db, "blocked", b.uid)).catch(e => alert("Unblock nahi hua: " + (e.code || e.message))); };
      el.appendChild(ub); list.appendChild(el);
    });
    return;
  }
  const shown = tickets.filter(t => (t.status || "open") === tab &&
    (!q || (t.name || "").toLowerCase().includes(q) || String(t.rollNo || "").toLowerCase().includes(q) || (t.university || "").toLowerCase().includes(q)));
  if (!shown.length) { const n = document.createElement("div"); n.className = "none"; n.textContent = "Koi ticket nahi."; list.appendChild(n); return; }
  shown.forEach(t => {
    const el = document.createElement("div"); el.className = "t-item" + (t.id === activeId ? " sel" : "");
    const top = document.createElement("div"); top.className = "t-top";
    const nm = document.createElement("span"); nm.textContent = `${t.name || "Student"} · ${t.rollNo || ""}${t.university ? " · " + t.university : ""}`;
    top.appendChild(nm);
    if ((t.unreadAdmin || 0) > 0 && t.id !== activeId) { const b = document.createElement("span"); b.className = "badge"; b.textContent = t.unreadAdmin; top.appendChild(b); }
    const pv = document.createElement("div"); pv.className = "t-prev"; pv.textContent = `${timeOf(t.lastMessageAt)}  ${t.lastMessage || ""}`;
    el.append(top, pv);
    el.onclick = () => { openTicket(t.id); $("sidebar").classList.remove("active"); };
    list.appendChild(el);
  });
}

/* ---------- reply ---------- */
const previewOf = (m) => ((m.type === "image" || m.type === "pdf") ? "📎 " + (m.fileName || m.text || "file") : String(m.text || "")).slice(0, 120);
function setReply(id, m, t) {
  replyTo = { id, sender: m.sender, text: previewOf(m), type: m.type || "text" };
  $("replyWho").textContent = m.sender === "student" ? ((t && t.name) || "Student") : (m.adminName || "Admin");
  $("replyText").textContent = replyTo.text;
  $("replyBar").classList.add("on");
  $("msgInput").focus();
}
function clearReply() { replyTo = null; $("replyBar").classList.remove("on"); }
$("replyClose").onclick = clearReply;
const withReply = (data) => (replyTo ? { ...data, replyTo } : data);

function jumpTo(id) {
  const el = $("chat-box").querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

/* ---------- ticks: ✓ sent, ✓✓ delivered, ✓✓(blue) seen + typing ----------
   Abhi BAND hai. Chahiye to LIVE_STATUS = true kar do (tg_bridge ke config.json me bhi "LIVE_STATUS": true) */
const LIVE_STATUS = false;
const tms = (t) => (t && t.toMillis) ? t.toMillis() : 0;
function tickState(sender, ts, tg, t) {
  if (!ts) return "wait";
  t = t || {};
  if (sender === "student") {
    if (tms(t.adminSeenAt) >= ts) return "seen";
    return tg ? "deliv" : "sent";
  }
  if (tms(t.studentSeenAt) >= ts) return "seen";
  if (tms(t.studentDeliveredAt) >= ts) return "deliv";
  return "sent";
}
const TICK_TXT = { wait: "🕓", sent: "✓", deliv: "✓✓", seen: "✓✓" };
const TICK_TIP = { wait: "Bhej raha hai...", sent: "Sent", deliv: "Delivered", seen: "Seen" };
function paintTick(el, st) { el.textContent = TICK_TXT[st]; el.className = "tick " + st; el.title = TICK_TIP[st]; }
function makeTick(sender, m, t) {
  const k = document.createElement("span");
  k.dataset.sender = sender; k.dataset.ts = String(tms(m.timestamp)); k.dataset.tg = m.tgSent ? "1" : "0";
  paintTick(k, tickState(sender, tms(m.timestamp), !!m.tgSent, t)); return k;
}
function applyTicks(t) {
  document.querySelectorAll("#chat-box .tick").forEach(el =>
    paintTick(el, tickState(el.dataset.sender, Number(el.dataset.ts), el.dataset.tg === "1", t)));
}

/* ---------- typing indicator ---------- */
let typingTimer = null;
function showTyping(txt) {
  const el = $("typing"); el.textContent = "✍ " + txt + "..."; el.classList.add("on");
  clearTimeout(typingTimer); typingTimer = setTimeout(hideTyping, 5000);
}
function hideTyping() { clearTimeout(typingTimer); const el = $("typing"); el.classList.remove("on"); }
let unsubTyping = null;
function listenTyping(ticketId) {
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }
  hideTyping();
  if (!LIVE_STATUS || !ticketId) return;
  let base = null;
  unsubTyping = onSnapshot(doc(db, "typing", ticketId), (s) => {
    if (s.metadata.hasPendingWrites || s.metadata.fromCache) return;
    const d = s.exists() ? s.data() : {};
    const a = tms(d.studentAt);
    if (base === null) { base = a; return; }          // pehli value purani hoti hai, usse typing mat dikhao
    if (a && a !== base) { base = a; showTyping(((tickets.find(x => x.id === ticketId) || {}).name || "Student") + " typing"); }
  }, () => {});
}

/* student ke messages dekh liye -> adminSeenAt */
let lastStudentTs = 0, ackA = 0;
function ackAdmin() {
  const t = tickets.find(x => x.id === activeId);
  if (!LIVE_STATUS || !t || !lastStudentTs || document.visibilityState !== "visible") return;
  if (lastStudentTs > Math.max(ackA, tms(t.adminSeenAt))) {
    ackA = lastStudentTs;
    updateDoc(doc(db, "tickets", t.id), { adminSeenAt: serverTimestamp(), unreadAdmin: 0 }).catch(() => {});
  }
}
document.addEventListener("visibilitychange", ackAdmin);
window.addEventListener("focus", ackAdmin);

/* ---------- chat ---------- */
function openTicket(id) {
  activeId = id; clearReply(); ackA = 0; lastStudentTs = 0; listenTyping(id);
  $("placeholder").style.display = "none";
  $("chat-box").style.display = "flex";
  updateHeader(); renderList();
  const t = tickets.find(x => x.id === id);
  if (t && (t.unreadAdmin || 0) > 0) updateDoc(doc(db, "tickets", id), { unreadAdmin: 0 }).catch(() => {});
  if (unsubMsgs) unsubMsgs();
  const box = $("chat-box"); box.replaceChildren();
  let first = true; const seen = new Set();
  unsubMsgs = onSnapshot(query(collection(db, "tickets", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
    const tk = tickets.find(x => x.id === id) || t;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    const prevTop = box.scrollTop;
    box.replaceChildren();
    let ls = 0;
    snap.forEach(d => {
      const m = d.data(), isNew = !first && !seen.has(d.id); seen.add(d.id);
      if (m.sender === "student") { ls = Math.max(ls, tms(m.timestamp)); if (isNew) hideTyping(); }
      box.appendChild(buildMsg(d.id, m, tk, isNew));
    });
    lastStudentTs = ls; ackAdmin();
    box.scrollTop = (first || nearBottom || forceBottom) ? box.scrollHeight : prevTop;
    first = false; forceBottom = false;
  }, console.error);
}

function updateHeader() {
  const t = tickets.find(x => x.id === activeId);
  const show = !!t, resolved = t && t.status === "resolved";
  $("title").textContent = t ? `${t.name || "Student"} · Roll ${t.rollNo || ""}${t.university ? " · " + t.university : ""}` : "Select a ticket";
  const b = $("statusBadge"); b.style.display = show ? "inline-block" : "none";
  b.textContent = t ? ({ open: "🟢 Open", hold: "⏸ Hold", resolved: "✅ Resolved" }[t.status] || t.status) : "";
  $("holdBtn").style.display = show && !resolved ? "inline-block" : "none";
  $("holdBtn").textContent = t && t.status === "hold" ? "▶ Unhold" : "⏸ Hold";
  $("resolveBtn").style.display = show && !resolved ? "inline-block" : "none";
  $("inputSection").style.display = show && !resolved ? "flex" : "none";
  const bb = $("blockBtn"); bb.style.display = show && t.uid ? "inline-block" : "none";
  bb.textContent = t && blockedMap[t.uid] ? "✅ Unblock" : "🚫 Block";
  if (resolved) clearReply();
}

function safeUrl(u) { try { return new URL(u).protocol === "https:" ? u : ""; } catch { return ""; } }

function buildMsg(id, m, t, isNew) {
  const div = document.createElement("div");
  const sender = ["student", "admin", "system"].includes(m.sender) ? m.sender : "system";
  div.className = "msg " + sender + (isNew ? " new" : ""); div.dataset.id = id;
  if (sender !== "system") {
    const w = document.createElement("span"); w.className = "who";
    w.textContent = (sender === "student" ? (t && t.name) || "STUDENT" : (m.adminName || "ADMIN")) + (m.source === "telegram" ? " ✈ Telegram" : "");
    div.appendChild(w);
  }
  if (m.replyTo && m.replyTo.id) {
    const q = document.createElement("div"); q.className = "quote";
    const qb = document.createElement("b"); qb.textContent = m.replyTo.sender === "student" ? ((t && t.name) || "Student") : "Admin";
    const qt = document.createElement("span"); qt.textContent = String(m.replyTo.text || "").slice(0, 120);
    q.append(qb, qt); q.onclick = () => jumpTo(m.replyTo.id);
    div.appendChild(q);
  }
  const url = safeUrl(m.fileUrl);
  if (m.type === "image" && url) {
    const img = document.createElement("img"); img.src = url; img.className = "chat-img";
    img.onclick = () => window.open(url, "_blank", "noopener"); div.appendChild(img);
  } else if (m.type === "pdf" && url) {
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.className = "chat-file"; a.textContent = "📄 " + (m.text || "PDF"); div.appendChild(a);
  } else { const s = document.createElement("span"); s.textContent = m.text || ""; div.appendChild(s); }
  const meta = document.createElement("div"); meta.className = "meta";
  if (sender !== "system" && t && t.status !== "resolved") {
    const rb = document.createElement("button"); rb.className = "rbtn"; rb.textContent = "↩ Reply";
    rb.onclick = () => setReply(id, m, t); meta.appendChild(rb);
  }
  const tm = document.createElement("span"); tm.className = "time"; tm.textContent = timeOf(m.timestamp);
  if (LIVE_STATUS && sender === "admin") tm.appendChild(makeTick(sender, m, t));
  meta.appendChild(tm); div.appendChild(meta);
  return div;
}

/* ---------- send ---------- */
async function pushAdminMessage(data, preview) {
  const id = activeId;
  forceBottom = true;
  await Promise.all([
    addDoc(collection(db, "tickets", id, "messages"), {
      sender: "admin", source: "web", adminName, tgSent: false, timestamp: serverTimestamp(), ...withReply(data)
    }),
    updateDoc(doc(db, "tickets", id), {
      lastMessage: preview, lastMessageAt: serverTimestamp(), unreadStudent: increment(1), unreadAdmin: 0, ...(LIVE_STATUS ? { adminSeenAt: serverTimestamp() } : {})
    })
  ]);
  clearReply();
}

async function sendText(text) {
  text = (text || "").trim();
  if (!text || !activeId) return;
  try { await pushAdminMessage({ text, type: "text" }, text.slice(0, 100)); $("msgInput").value = ""; }
  catch (e) { console.error(e); alert("Message nahi bheja ja saka.\n" + (e.code || e.message)); }
}
$("sendBtn").onclick = () => sendText($("msgInput").value);
let lastPing = 0;
$("msgInput").addEventListener("input", () => {
  const t = tickets.find(x => x.id === activeId);
  if (!LIVE_STATUS || !admin || !t || t.status === "resolved" || !$("msgInput").value.trim()) return;
  const n = Date.now(); if (n - lastPing < 2500) return; lastPing = n;
  setDoc(doc(db, "typing", activeId), { adminAt: serverTimestamp(), adminName }, { merge: true }).catch(() => {});
});
$("msgInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText($("msgInput").value); });
document.querySelectorAll(".qr").forEach(b => b.onclick = () => sendText(b.dataset.msg));

const CLOUD_NAME = "h8etcobp", UPLOAD_PRESET = "ug_support";   // Cloudinary
function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("upload_preset", UPLOAD_PRESET);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);
    xhr.timeout = 60000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      try {
        const r = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && r.secure_url) resolve(r.secure_url);
        else reject(new Error((r.error && r.error.message) || "Upload failed"));
      } catch { reject(new Error("Upload failed")); }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Upload timeout"));
    xhr.send(fd);
  });
}

$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file || !activeId) return;
  const isImg = file.type.startsWith("image/"), isPdf = file.type === "application/pdf";
  if (!isImg && !isPdf) { alert("Sirf image ya PDF."); return; }
  if (file.size > 5 * 1024 * 1024) { alert("File 5MB se chhoti honi chahiye."); return; }
  const info = $("uploadInfo");
  try {
    info.textContent = "Uploading 0%";
    const fileUrl = await uploadToCloudinary(file, (p) => { info.textContent = `Uploading ${p}%`; });
    await pushAdminMessage({ type: isImg ? "image" : "pdf", text: file.name, fileName: file.name, fileUrl }, "📎 " + file.name);
    info.textContent = "";
  } catch (err) { console.error(err); info.textContent = ""; alert("Upload fail ho gaya.\n" + (err.message || err.code)); }
});

/* ---------- hold / resolve ---------- */
async function setStatus(status) {
  const t = tickets.find(x => x.id === activeId); if (!t) return;
  const upd = { status, statusBy: adminName, statusAt: serverTimestamp() };
  if (status === "resolved") { upd.resolvedAt = serverTimestamp(); upd.resolvedBy = adminName; }
  const txt = { hold: "⏸ Aapki query abhi hold par hai. Jaldi reply milega.", open: "▶ Aapki query dobara shuru ho gayi hai.", resolved: "✅ Ticket Resolved." }[status];
  await updateDoc(doc(db, "tickets", activeId), upd);
  await addDoc(collection(db, "tickets", activeId, "messages"), {
    sender: "system", text: txt, type: "text", source: "web", tgSent: true, timestamp: serverTimestamp()
  });
}
$("holdBtn").onclick = () => { const t = tickets.find(x => x.id === activeId); if (t) setStatus(t.status === "hold" ? "open" : "hold").catch(console.error); };
$("resolveBtn").onclick = () => { if (confirm("Ye ticket resolve karna hai?")) setStatus("resolved").catch(console.error); };

/* ---------- permanent block ---------- */
$("blockBtn").onclick = async () => {
  const t = tickets.find(x => x.id === activeId); if (!t || !t.uid) return;
  try {
    if (blockedMap[t.uid]) { if (confirm(`${t.name || "Student"} ko unblock karna hai?`)) await deleteDoc(doc(db, "blocked", t.uid)); return; }
    const reason = prompt(`${t.name || "Student"} (Roll ${t.rollNo || ""}) ko PERMANENT block karna hai.\nKaran likho (optional) aur OK dabao:`);
    if (reason === null) return;
    await setDoc(doc(db, "blocked", t.uid), { uid: t.uid, rollNo: t.rollNo || "", name: t.name || "", reason: reason.trim().slice(0, 200), by: adminName, at: serverTimestamp(), authDone: false });
    if (t.status !== "resolved") await updateDoc(doc(db, "tickets", t.id), { status: "resolved", statusBy: adminName, statusAt: serverTimestamp(), resolvedAt: serverTimestamp(), resolvedBy: adminName });
  } catch (e) { console.error(e); alert("Block/Unblock nahi hua.\n" + (e.code || e.message) + "\n(Firestore rules me 'blocked' collection admin ke liye allow karna hai)"); }
};

/* ---------- admin online / offline ---------- */
const HOURS = Array.from({ length: 24 }, (_, h) => h);
for (const id of ["offFrom", "offTo"]) $(id).innerHTML = HOURS.map(h => `<option value="${h}">${hourLabel(h)}</option>`).join("");
function renderPres() {
  const s = resolvePresence(pres);
  $("presTxt").textContent = (s.offline ? "🔴 Offline" : "🟢 Online") + (s.offline && s.back ? ` · ${backText(s.back)} tak` : "") + (s.manual ? " · manual" : " · auto");
  $("presBtn").classList.toggle("off", s.offline);
  if (!$("presMenu").classList.contains("open")) { $("offFrom").value = s.a; $("offTo").value = s.b; }
}
setInterval(() => { if (admin) renderPres(); }, 30000);
$("presBtn").onclick = () => $("presMenu").classList.toggle("open");
async function savePres(data) {
  try { await setDoc(doc(db, "settings", "presence"), { ...data, by: adminName, updatedAt: serverTimestamp() }, { merge: true }); }
  catch (e) { console.error(e); alert("Save nahi hua.\n" + (e.code || e.message) + "\n(Firestore rules me 'settings' collection admin ke liye allow karna hai)"); }
}
document.querySelectorAll("#presMenu [data-p]").forEach(b => b.onclick = () => { savePres(overrideFor(b.dataset.p, pres)); $("presMenu").classList.remove("open"); });
$("presSave").onclick = () => { savePres({ offFrom: Number($("offFrom").value), offTo: Number($("offTo").value) }); $("presMenu").classList.remove("open"); };

/* ---------- mobile sidebar ---------- */
$("menuBtn").onclick = () => $("sidebar").classList.add("active");
$("closeSidebar").onclick = () => $("sidebar").classList.remove("active");
