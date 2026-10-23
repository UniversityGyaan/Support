
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, updatePassword }
  from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore, doc, setDoc, getDoc, addDoc, updateDoc, collection, query, where, orderBy, onSnapshot, serverTimestamp, increment }
  from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { resolvePresence, backText } from "./presence.js?v=9";

const app = initializeApp({
  apiKey: "AIzaSyDPqL-xSWctqMuanjyWD74dL7Rw_jQcJ2w",
  authDomain: "universitygyaan-support.firebaseapp.com",
  projectId: "universitygyaan-support",
  storageBucket: "universitygyaan-support.firebasestorage.app",
  messagingSenderId: "760546596272",
  appId: "1:760546596272:web:40ff8bf447a064cbff7275"
});
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] });
// long-polling auto-detect: kuch mobile networks par realtime delay hota hai, ye usse bachata hai
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const $ = (id) => document.getElementById(id);
const toEmail = (roll) => `${roll.toLowerCase()}@ug-student.app`;
/* Recovery PIN: PIN kabhi seedha nahi jata, sirf uska PBKDF2 hash (bridge sirf hash match karta hai) */
async function pinHashOf(roll, pin) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("ug:" + roll.toLowerCase()), iterations: 100000 }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(16).padStart(2, "0")).join("");
let pwHint = false;     // temporary password se login hua to password badalne ka box khol do
/* mobile: header + send box fix, sirf beech ki chat scroll ho; keyboard khulne par bhi screen ke hisaab se */
function fitViewport() {
  const h = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  document.documentElement.style.setProperty("--app-h", Math.round(h) + "px");
  if (document.body.classList.contains("chatmode")) {
    window.scrollTo(0, 0);
    const b = document.getElementById("chat-box"); if (b && document.activeElement && document.activeElement.id === "msgInput") b.scrollTop = b.scrollHeight;
  }
}
window.addEventListener("resize", fitViewport);
if (window.visualViewport) { window.visualViewport.addEventListener("resize", fitViewport); window.visualViewport.addEventListener("scroll", fitViewport); }
fitViewport();
const show = (id, on) => { $(id).style.display = on ? "block" : "none"; };

/* ---------- AUTH ---------- */
let mode = "login", registering = false, authSeen = false;

function setMode(m) {
  mode = m; const reg = m === "register";
  $("tabLogin").classList.toggle("active", !reg);
  $("tabRegister").classList.toggle("active", reg);
  show("name", reg); show("university", reg); show("password2", reg); show("regPin", reg); show("regPinHint", reg); show("forgotLink", !reg);
  $("password").autocomplete = reg ? "new-password" : "current-password";
  $("submitBtn").textContent = reg ? "Create Account" : "Login";
  $("err").textContent = "";
}
$("tabLogin").onclick = () => setMode("login");
$("tabRegister").onclick = () => setMode("register");

function friendlyError(e) {
  return ({
    "auth/email-already-in-use": "Is Roll Number se account pehle se bana hai. Login karein.",
    "auth/invalid-credential": "Roll Number ya Password galat hai.",
    "auth/weak-password": "Password kam se kam 6 characters ka rakhein.",
    "auth/too-many-requests": "Bahut zyada attempts. Thodi der baad try karein.",
    "auth/user-disabled": "Aapka account block hai. Admin se sampark karein.",
    "auth/network-request-failed": "Internet check karein.",
    "auth/requires-recent-login": "Security ke liye Logout karke dobara login karein, fir password badlein."
  })[e.code] || "Kuch gadbad hui. Dobara try karein.";
}

$("submitBtn").onclick = async () => {
  const roll = $("rollNo").value.trim(), pass = $("password").value;
  $("err").textContent = "";
  if (!/^[A-Za-z0-9]{3,20}$/.test(roll)) { $("err").textContent = "Valid Roll Number daalein (letters/numbers)."; return; }
  if (pass.length < 6) { $("err").textContent = "Password kam se kam 6 characters ka ho."; return; }
  $("submitBtn").disabled = true;
  try {
    if (mode === "register") {
      const name = $("name").value.trim();
      if (name.length < 2) throw { msg: "Naam daalein." };
      if (pass !== $("password2").value) throw { msg: "Dono passwords match nahi karte." };
      const university = $("university").value.trim().replace(/\s+/g, " ");
      if (university.length < 2) throw { msg: "University / College ka naam daalein." };
      const pin = $("regPin").value.trim();
      if (!/^\d{6}$/.test(pin)) throw { msg: "Recovery PIN 6 digit ka number hona chahiye." };
      registering = true;
      const cred = await createUserWithEmailAndPassword(auth, toEmail(roll), pass);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), { name, rollNo: roll, university, role: "student", createdAt: serverTimestamp() });
      try { await setDoc(doc(db, "recovery", cred.user.uid), { rollNo: roll, hash: await pinHashOf(roll, pin), updatedAt: serverTimestamp() }); }
      catch (e3) { console.warn("recovery pin", e3); }
      registering = false;
      startApp(cred.user, { name, rollNo: roll, university });
    } else {
      await signInWithEmailAndPassword(auth, toEmail(roll), pass);
    }
  } catch (e) { registering = false; $("err").textContent = e.msg || friendlyError(e); }
  $("submitBtn").disabled = false;
};
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("submitBtn").click(); });

// login screen tabhi dikhao jab pata chal jaye ki user sach me logged-out hai
setTimeout(() => { if (!authSeen) { show("boot", false); show("authBox", true); } }, 7000);

async function loadProfile(user) {
  for (let i = 0; i < 3; i++) {
    try {
      const s = await getDoc(doc(db, "users", user.uid));
      if (s.exists()) return s.data();
      const nm = (user.displayName || "Student").slice(0, 60), rn = (user.email || "").split("@")[0].slice(0, 20);
      try { await setDoc(doc(db, "users", user.uid), { name: nm, rollNo: rn, role: "student", createdAt: serverTimestamp() }); } catch (e2) { console.warn("profile heal", e2); }
      return { name: nm, rollNo: rn };
    } catch (e) { console.warn("profile load", e); await new Promise(r => setTimeout(r, 1000)); }
  }
  return { name: user.displayName || "Student", rollNo: (user.email || "").split("@")[0] };
}

onAuthStateChanged(auth, async (user) => {
  authSeen = true;
  if (registering) return;
  if (!user) { stopApp(); return; }
  startApp(user, await loadProfile(user));
}, (e) => { console.error(e); show("boot", false); show("authBox", true); });
$("logoutBtn").onclick = () => signOut(auth);

/* ---------- forgot password (admin-assisted) ---------- */
$("forgotLink").onclick = (e) => {
  e.preventDefault(); $("fRoll").value = $("rollNo").value.trim(); $("fMsg").textContent = "";
  show("authBox", false); show("forgotBox", true);
};
$("fBack").onclick = (e) => { e.preventDefault(); show("forgotBox", false); show("authBox", true); };
$("fInstant").onclick = async () => {
  const roll = $("fRoll").value.trim(), pin = $("fPin").value.trim(), msg = $("fMsg");
  msg.className = "bad"; msg.textContent = ""; show("fResult", false);
  if (!/^[A-Za-z0-9]{3,20}$/.test(roll)) { msg.textContent = "Valid Roll Number daalein."; return; }
  if (!/^\d{6}$/.test(pin)) { msg.textContent = "Recovery PIN 6 digit ka number hota hai."; return; }
  $("fInstant").disabled = true; msg.className = ""; msg.textContent = "Check ho raha hai...";
  let unsub = null, timer = null;
  const finish = () => { if (unsub) unsub(); clearTimeout(timer); $("fInstant").disabled = false; };
  try {
    const claim = randomHex(16), pinHash = await pinHashOf(roll, pin);
    unsub = onSnapshot(doc(db, "resetResults", claim), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data(); finish();
      if (d.status === "ok") {
        msg.textContent = ""; $("fPass").textContent = d.password; show("fResult", true);
        $("fLogin").onclick = () => {
          pwHint = true; $("rollNo").value = roll; $("password").value = d.password;
          show("forgotBox", false); show("authBox", true); setMode("login"); $("submitBtn").click();
        };
        return;
      }
      msg.className = "bad";
      msg.textContent = ({
        wrong: "Roll Number ya Recovery PIN galat hai.",
        nopin: "Is account par Recovery PIN set nahi hai. Telegram wala option try karein.",
        locked: "Bahut zyada galat attempts. 30 minute baad try karein ya Telegram wala option use karein."
      })[d.status] || "Reset nahi ho paya. Dobara try karein.";
    }, () => { finish(); msg.className = "bad"; msg.textContent = "Result nahi mil paya. Dobara try karein."; });
    timer = setTimeout(() => { finish(); msg.className = "bad"; msg.textContent = "Server abhi jawab nahi de raha. Thodi der baad try karein."; }, 25000);
    await addDoc(collection(db, "instantResets"), { rollNo: roll, pinHash, claim, createdAt: serverTimestamp() });
  } catch (e) { console.error(e); finish(); msg.className = "bad"; msg.textContent = "Request nahi bheji ja saki. Internet check karke dobara try karein."; }
};
$("uniSave").onclick = async () => {
  const u = $("uniInput").value.trim().replace(/\s+/g, " "), msg = $("uniMsg"); msg.className = "bad";
  if (u.length < 2) { msg.textContent = "University / College ka naam daalein."; return; }
  $("uniSave").disabled = true;
  try {
    await updateDoc(doc(db, "users", me.uid), { university: u });
    profile.university = u; show("uniBox", false);
    if (current && current.status !== "resolved") { try { await updateDoc(doc(db, "tickets", current.id), { university: u }); } catch (e2) { console.warn("ticket uni", e2); } }
  } catch (e) { console.error(e); msg.textContent = "Save nahi hua. Dobara try karein."; }
  $("uniSave").disabled = false;
};
$("fCopy").onclick = async () => { try { await navigator.clipboard.writeText($("fPass").textContent); $("fCopy").textContent = "Copied ✓"; } catch { $("fCopy").textContent = "Select karke copy karein"; } };
/* ---------- Telegram se password (admin ke bina) ----------
   Student pehle login karke 📲 Telegram jodta hai. Bhoolne par bridge uske apne Telegram par confirm button bhejta hai;
   button dabane par naya temporary password wahin DM me aata hai. */
$("fTg").onclick = async () => {
  const roll = $("fRoll").value.trim(), msg = $("fTgMsg");
  msg.className = "bad"; msg.textContent = "";
  if (!/^[A-Za-z0-9]{3,20}$/.test(roll)) { msg.textContent = "Upar Valid Roll Number daalein."; return; }
  $("fTg").disabled = true; msg.className = ""; msg.textContent = "Check ho raha hai...";
  let unsub = null, timer = null;
  const finish = () => { if (unsub) unsub(); clearTimeout(timer); $("fTg").disabled = false; };
  try {
    const claim = randomHex(16);
    unsub = onSnapshot(doc(db, "resetResults", claim), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data(); finish();
      const ok = d.status === "tgsent";
      msg.className = ok ? "ok" : "bad";
      msg.textContent = ({
        tgsent: "Aapke Telegram par message bhej diya hai. Wahan 'Haan, password reset karo' dabayein, naya password wahin milega.",
        notg: "Is account par Telegram nahi juda hai. Recovery PIN try karein.",
        cooldown: "Abhi hi request ho chuki hai. 2 minute baad try karein."
      })[d.status] || "Nahi ho paya. Dobara try karein.";
    }, () => { finish(); msg.className = "bad"; msg.textContent = "Result nahi mil paya. Dobara try karein."; });
    timer = setTimeout(() => { finish(); msg.className = "bad"; msg.textContent = "Server abhi jawab nahi de raha. Thodi der baad try karein."; }, 25000);
    await addDoc(collection(db, "instantResets"), { rollNo: roll, method: "tg", claim, createdAt: serverTimestamp() });
  } catch (e) { console.error(e); finish(); msg.className = "bad"; msg.textContent = "Request nahi bheji ja saki. Internet check karke dobara try karein."; }
};

/* login ke baad: Telegram jodo (bridge bot ke DM me /start link_TOKEN) */
$("tgLinkBtn").onclick = async () => {
  const msg = $("tgMsg"); msg.className = "bad"; msg.textContent = "";
  if (!me || !profile) return;
  $("tgLinkBtn").disabled = true;
  try {
    const bs = await getDoc(doc(db, "settings", "bridge")), bot = bs.exists() ? bs.data().botUsername : "";
    if (!bot) { msg.textContent = "Abhi setup poora nahi hai. Admin se kahein bridge restart kare."; $("tgLinkBtn").disabled = false; return; }
    const token = randomHex(12);
    await setDoc(doc(db, "tgLinks", token), { uid: me.uid, rollNo: profile.rollNo, createdAt: serverTimestamp() });
    window.open(`https://t.me/${bot}?start=link_${token}`, "_blank", "noopener");
    msg.className = ""; msg.textContent = "Telegram khulega, wahan START dabayein. Phir yahan wapas aayein.";
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      try { const u = await getDoc(doc(db, "users", me.uid)); if (u.exists() && u.data().tgLinked) { clearInterval(iv); msg.className = "ok"; msg.textContent = "✅ Telegram jud gaya."; $("tgLinkBtn").disabled = false; return; } } catch {}
      if (tries > 40) { clearInterval(iv); $("tgLinkBtn").disabled = false; }
    }, 3000);
  } catch (e) { console.error(e); msg.textContent = "Nahi ho paya: " + (e.code || e.message); $("tgLinkBtn").disabled = false; }
};

/* ---------- change password ---------- */
$("pwBtn").onclick = () => { $("pwMsg").textContent = ""; $("pwBox").style.display = $("pwBox").style.display === "none" ? "block" : "none"; };
$("pwSave").onclick = async () => {
  const p1 = $("pw1").value, p2 = $("pw2").value, msg = $("pwMsg");
  msg.className = "bad"; msg.textContent = "";
  if (p1.length < 6) { msg.textContent = "Password kam se kam 6 characters ka ho."; return; }
  if (p1 !== p2) { msg.textContent = "Dono passwords match nahi karte."; return; }
  $("pwSave").disabled = true;
  try {
    await updatePassword(auth.currentUser, p1);
    msg.className = "ok"; msg.textContent = "Password badal gaya.";
    $("pw1").value = ""; $("pw2").value = "";
  } catch (e) { msg.textContent = friendlyError(e); }
  $("pwSave").disabled = false;
};

$("pinSave").onclick = async () => {
  const pin = $("newPin").value.trim(), msg = $("pinMsg");
  msg.className = "bad"; msg.textContent = "";
  if (!/^\d{6}$/.test(pin)) { msg.textContent = "PIN 6 digit ka number hona chahiye."; return; }
  if (!me || !profile) return;
  $("pinSave").disabled = true;
  try {
    await setDoc(doc(db, "recovery", me.uid), { rollNo: profile.rollNo, hash: await pinHashOf(profile.rollNo, pin), updatedAt: serverTimestamp() });
    msg.className = "ok"; msg.textContent = "Recovery PIN save ho gaya."; $("newPin").value = "";
  } catch (e) { console.error(e); msg.textContent = "PIN save nahi hua: " + (e.code || e.message); }
  $("pinSave").disabled = false;
};

/* ---------- TICKET + CHAT ---------- */
let me = null, profile = null;
/* ---------- admin online/offline + block ---------- */
let presData = null, unsubPres = null, unsubBlock = null, isBlocked = false;
function renderPresence() {
  const el = $("presence");
  if (!me || isBlocked) { el.className = ""; el.textContent = ""; return; }
  const s = resolvePresence(presData);
  el.className = "on " + (s.offline ? "offline" : "online");
  el.textContent = !s.offline ? "🟢 Admin online hai"
    : s.back ? `🔴 Admin abhi offline hai. Message chhod do, ${backText(s.back)} ke baad reply milega.`
    : "🔴 Admin abhi offline hai. Message chhod do, online aate hi reply milega.";
}
setInterval(renderPresence, 30000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") renderPresence(); });

function watchExtras(user) {
  if (unsubPres) unsubPres(); if (unsubBlock) unsubBlock();
  // settings doc na mile / rules abhi na lage ho to default timing (10PM-6AM) chalti rahegi
  unsubPres = onSnapshot(doc(db, "settings", "presence"), (s) => { presData = s.exists() ? s.data() : null; renderPresence(); }, () => { presData = null; renderPresence(); });
  unsubBlock = onSnapshot(doc(db, "blocked", user.uid), (s) => {
    const was = isBlocked; isBlocked = s.exists();
    if (isBlocked) {
      if (unsubTickets) { unsubTickets(); unsubTickets = null; } if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; } shownTicketId = undefined;
      $("blockedMsg").textContent = (s.data().reason ? "Karan: " + s.data().reason + ". " : "") + "Support desk ka misuse hone ki wajah se admin ne aapko block kiya hai.";
      show("appBox", false); show("blockedBox", true); document.body.classList.remove("chatmode"); renderPresence();
    } else if (was) { show("blockedBox", false); startApp(me, profile); }
  }, () => {});
}
$("blockedLogout").onclick = () => signOut(auth);

/* spam roko: 0.8 sec me ek aur minute me max 15 message */
const sentTimes = [];
function rateOk() {
  const n = Date.now(); while (sentTimes.length && n - sentTimes[0] > 60000) sentTimes.shift();
  if ((sentTimes.length && n - sentTimes[sentTimes.length - 1] < 800) || sentTimes.length >= 15) { alert("Bahut tez message ja rahe hain. Thoda ruk kar bhejein."); return false; }
  sentTimes.push(n); return true;
}

let tickets = [], current = null, newQueryMode = false;
let unsubTickets = null, unsubMsgs = null, shownTicketId = undefined;
let replyTo = null, forceBottom = false;

function startApp(user, p) {
  me = user; profile = p; newQueryMode = false; shownTicketId = undefined;
  show("boot", false); show("authBox", false); show("forgotBox", false); show("appBox", true); document.body.classList.add("chatmode"); fitViewport();
  $("welcome").textContent = `${p.name} (Roll: ${p.rollNo})`;
  show("uniBox", !p.university);
  if (pwHint) { pwHint = false; $("pwBox").style.display = "block"; $("pwMsg").className = "bad"; $("pwMsg").textContent = "Temporary password se login hue ho. Neeche naya password rakh lo."; }
  if (unsubTickets) unsubTickets();
  watchExtras(user);
  unsubTickets = onSnapshot(query(collection(db, "tickets"), where("uid", "==", user.uid)), { includeMetadataChanges: true }, (snap) => {
    tickets = snap.docs.map(d => ({ id: d.id, _pending: d.metadata.hasPendingWrites, ...d.data() }));
    tickets.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    const active = tickets.find(t => t.status !== "resolved");
    current = active || (newQueryMode ? null : tickets[0] || null);
    renderTicket();
  }, (e) => console.error(e));
}

function stopApp() {
  if (unsubTickets) unsubTickets(); if (unsubMsgs) unsubMsgs();
  if (unsubPres) unsubPres(); if (unsubBlock) unsubBlock();
  unsubPres = unsubBlock = null; presData = null; isBlocked = false; show("blockedBox", false); renderPresence();
  unsubTickets = unsubMsgs = null; me = null; tickets = []; current = null; shownTicketId = undefined;
  show("boot", false); show("appBox", false); show("forgotBox", false); show("authBox", true); document.body.classList.remove("chatmode"); fitViewport();
  $("pwBox").style.display = "none";
  $("chat-box").replaceChildren(); clearReply();
}

const ms = (t) => (t && t.toMillis) ? t.toMillis() : Date.now();

function renderTicket() {
  const resolved = current && current.status === "resolved";
  const banner = $("banner");
  banner.className = ""; banner.textContent = "";
  const held = !!(current && current.status === "hold");
  if (held) { banner.className = "hold"; banner.textContent = "⏸ Admin ne abhi aapki query hold par rakhi hai. Naya message bhejne ke liye unhold request bhejein."; }
  if (resolved) { banner.className = "resolved"; banner.textContent = "✅ Ye query resolve ho chuki hai."; }
  $("msgArea").style.display = (resolved || held) ? "none" : "flex";
  if (resolved || held) clearReply();
  $("newQueryBtn").style.display = resolved ? "block" : "none";
  $("unholdBtn").style.display = held ? "block" : "none";
  $("chat-box").classList.toggle("held", held);
  applyTicks(current);
  if (held) refreshUnholdBtn();

  // admin ke messages dekh liye -> unread reset
  if (current && !resolved && current.unreadStudent > 0) {
    updateDoc(doc(db, "tickets", current.id), { unreadStudent: 0 }).catch(() => {});
  }

  const id = current ? current.id : null;
  if (id !== shownTicketId && !(current && current._pending)) { shownTicketId = id; listenMessages(id); }   // naya ticket server par save hone ke baad hi messages sunna (warna permission-denied)
}

/* ---------- reply ---------- */
const previewOf = (m) => ((m.type === "image" || m.type === "pdf") ? "📎 " + (m.fileName || m.text || "file") : String(m.text || "")).slice(0, 120);
function setReply(id, m) {
  replyTo = { id, sender: m.sender, text: previewOf(m), type: m.type || "text" };
  $("replyWho").textContent = m.sender === "student" ? "Aap" : (m.adminName || "Admin");
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
    const a = tms(d.adminAt);
    if (base === null) { base = a; return; }          // pehli value purani hoti hai, usse typing mat dikhao
    if (a && a !== base) { base = a; showTyping((d.adminName || "Admin") + " typing"); }
  }, () => {});
}

/* admin ke messages: delivered / seen ka nishan ticket par likho */
let lastAdminTs = 0, ackD = 0, ackS = 0;
function ackStudent() {
  if (!LIVE_STATUS || !me || !current || current._pending || current.status === "resolved" || !lastAdminTs) return;
  const upd = {};
  const delivered = lastAdminTs > Math.max(ackD, tms(current.studentDeliveredAt));
  const seen = document.visibilityState === "visible" && lastAdminTs > Math.max(ackS, tms(current.studentSeenAt));
  if (delivered || seen) { upd.studentDeliveredAt = serverTimestamp(); ackD = lastAdminTs; }
  if (seen) { upd.studentSeenAt = serverTimestamp(); upd.unreadStudent = 0; ackS = lastAdminTs; }
  if (Object.keys(upd).length) updateDoc(doc(db, "tickets", current.id), upd).catch(() => {});
}
document.addEventListener("visibilitychange", ackStudent);
window.addEventListener("focus", ackStudent);

function listenMessages(ticketId) {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  const box = $("chat-box");
  box.replaceChildren(); clearReply();
  listenTyping(ticketId);
  if (!ticketId) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = "Apna sawal likhiye, admin jaldi reply karenge.";
    box.appendChild(e); return;
  }
  let first = true; const seen = new Set();
  if (listenMessages.id !== ticketId) { ackD = ackS = 0; lastAdminTs = 0; }
  listenMessages.tries = (listenMessages.id === ticketId) ? listenMessages.tries : 0; listenMessages.id = ticketId;
  unsubMsgs = onSnapshot(query(collection(db, "tickets", ticketId, "messages"), orderBy("timestamp", "asc")), (snap) => {
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    const prevTop = box.scrollTop;
    box.replaceChildren();
    let la = 0;
    snap.forEach(d => {
      const m = d.data(), isNew = !first && !seen.has(d.id); seen.add(d.id);
      if (m.sender === "admin") { la = Math.max(la, tms(m.timestamp)); if (isNew) hideTyping(); }
      box.appendChild(buildMsg(d.id, m, isNew));
    });
    lastAdminTs = la; ackStudent();
    box.scrollTop = (first || nearBottom || forceBottom) ? box.scrollHeight : prevTop;
    first = false; forceBottom = false;
  }, (e) => {
    console.error(e);
    // naya ticket abhi server tak pahunch raha ho to thodi der baad khud dobara try
    if (e.code === "permission-denied" && listenMessages.tries < 8 && shownTicketId === ticketId) {
      listenMessages.tries++; setTimeout(() => { if (shownTicketId === ticketId) listenMessages(ticketId); }, 700 * listenMessages.tries);
      return;
    }
    box.textContent = "Chat load nahi ho pa rahi: " + (e.code || e.message);
  });
}

function safeUrl(u) { try { return new URL(u).protocol === "https:" ? u : ""; } catch { return ""; } }

function buildMsg(id, m, isNew) {
  const div = document.createElement("div");
  const sender = ["student", "admin", "system"].includes(m.sender) ? m.sender : "system";
  div.className = "msg " + sender + (isNew ? " new" : ""); div.dataset.id = id;
  if (sender !== "system") {
    const w = document.createElement("span"); w.className = "who";
    w.textContent = sender === "student" ? "YOU" : (m.adminName || "ADMIN");
    div.appendChild(w);
  }
  if (m.replyTo && m.replyTo.id) {
    const q = document.createElement("div"); q.className = "quote";
    const qb = document.createElement("b"); qb.textContent = m.replyTo.sender === "student" ? "Aap" : "Admin";
    const qt = document.createElement("span"); qt.textContent = String(m.replyTo.text || "").slice(0, 120);
    q.append(qb, qt); q.onclick = () => jumpTo(m.replyTo.id);
    div.appendChild(q);
  }
  const url = safeUrl(m.fileUrl);
  if (m.type === "image" && url) {
    const img = document.createElement("img"); img.src = url; img.className = "chat-img";
    img.onclick = () => window.open(url, "_blank", "noopener");
    div.appendChild(img);
  } else if (m.type === "pdf" && url) {
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.className = "chat-file"; a.textContent = "📄 " + (m.text || "PDF");
    div.appendChild(a);
  } else {
    const t = document.createElement("span"); t.textContent = m.text || ""; div.appendChild(t);
  }
  const meta = document.createElement("div"); meta.className = "meta";
  if (sender !== "system" && current && current.status !== "resolved" && current.status !== "hold") {
    const rb = document.createElement("button"); rb.className = "rbtn"; rb.textContent = "↩ Reply";
    rb.onclick = () => setReply(id, m); meta.appendChild(rb);
  }
  const tm = document.createElement("span"); tm.className = "time";
  tm.textContent = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  if (LIVE_STATUS && sender === "student") tm.appendChild(makeTick(sender, m, current));
  meta.appendChild(tm); div.appendChild(meta);
  return div;
}

// ticket nahi hai (ya resolved hai) to naya banata hai
async function ensureTicket(preview) {
  if (current && current.status !== "resolved") return { id: current.id, isNew: false };
  const r = await addDoc(collection(db, "tickets"), {
    uid: me.uid, rollNo: profile.rollNo, name: profile.name, university: profile.university || "", status: "open",
    lastMessage: preview, lastMessageAt: serverTimestamp(),
    unreadAdmin: 1, unreadStudent: 0, telegramTopicId: null, createdAt: serverTimestamp()
  });
  newQueryMode = false;
  return { id: r.id, isNew: true };
}

// message + ticket update ek saath (parallel) -> kam delay
async function postMessage(data, preview) {
  const t = await ensureTicket(preview);
  const ops = [addDoc(collection(db, "tickets", t.id, "messages"), {
    sender: "student", source: "web", tgSent: false, timestamp: serverTimestamp(), ...withReply(data)
  })];
  if (!t.isNew) ops.push(updateDoc(doc(db, "tickets", t.id), {
    lastMessage: preview, lastMessageAt: serverTimestamp(), unreadAdmin: increment(1)
  }));
  forceBottom = true;
  await Promise.all(ops);
  clearReply();
}

/* ---------- unhold request ---------- */
const UNHOLD_COOLDOWN = 10 * 60 * 1000;   // 10 min me ek hi request
const unholdKey = () => "ug_unhold_" + (current ? current.id : "");
function lastUnhold() { try { return Number(localStorage.getItem(unholdKey())) || 0; } catch { return 0; } }
let unholdTimer = null;
function refreshUnholdBtn() {
  const btn = $("unholdBtn"); clearTimeout(unholdTimer);
  const left = lastUnhold() + UNHOLD_COOLDOWN - Date.now();
  if (left > 0) {
    btn.disabled = true; btn.textContent = "✅ Request bhej di gayi — admin jaldi dekhenge";
    unholdTimer = setTimeout(refreshUnholdBtn, left + 500);
  } else { btn.disabled = false; btn.textContent = "🔓 Chat Unhold Karne Ki Request Bhejo"; }
}
$("unholdBtn").onclick = async () => {
  if (!current || current.status !== "hold" || !me || !rateOk()) return;
  const btn = $("unholdBtn"); btn.disabled = true;
  try {
    await postMessage({ text: "🔓 Student ne chat unhold karne ki request ki hai.", type: "text" }, "🔓 Unhold request");
    try { localStorage.setItem(unholdKey(), String(Date.now())); } catch {}
  } catch (e) { console.error(e); alert("Request nahi bheji ja saki.\n" + (e.code || e.message)); }
  refreshUnholdBtn();
};

let sending = false;
async function sendText() {
  const text = $("msgInput").value.trim();
  if (!text || sending || !me || !rateOk()) return;
  sending = true; $("sendBtn").disabled = true;
  try {
    await postMessage({ text, type: "text" }, text.slice(0, 100));
    $("msgInput").value = "";
  } catch (e) { console.error(e); alert("Message nahi bheja ja saka.\n" + (e.code || e.message)); }
  sending = false; $("sendBtn").disabled = false;
}
$("sendBtn").onclick = sendText;
let lastPing = 0;
$("msgInput").addEventListener("input", () => {
  if (!LIVE_STATUS || !me || !current || current._pending || current.status !== "open" || !$("msgInput").value.trim()) return;
  const n = Date.now(); if (n - lastPing < 2500) return; lastPing = n;
  setDoc(doc(db, "typing", current.id), { studentAt: serverTimestamp() }, { merge: true }).catch(() => {});
});
$("msgInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });

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
  if (!file || !me || !rateOk()) return;
  const isImg = file.type.startsWith("image/"), isPdf = file.type === "application/pdf";
  if (!isImg && !isPdf) { alert("Sirf image ya PDF bhej sakte hain."); return; }
  if (file.size > 2 * 1024 * 1024) { alert("File 2MB se chhoti honi chahiye."); return; }
  const info = $("uploadInfo");
  try {
    info.textContent = "Uploading 0%";
    const fileUrl = await uploadToCloudinary(file, (p) => { info.textContent = `Uploading ${p}%`; });
    await postMessage({ type: isImg ? "image" : "pdf", text: file.name, fileName: file.name, fileUrl }, "📎 " + file.name);
    info.textContent = "";
  } catch (err) { console.error(err); info.textContent = ""; alert("Upload fail ho gaya.\n" + (err.message || err.code)); }
});

$("newQueryBtn").onclick = () => {
  newQueryMode = true; current = null; renderTicket();
};
