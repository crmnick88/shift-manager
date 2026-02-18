
// ===== Branch-scoped paths (multi-tenant) =====
// For the legacy HAIFA branch, we keep using the old root-level paths so nothing breaks.
function __getBranchKeySafe() {
  try {
    if (typeof window.getBranchKey === 'function') return window.getBranchKey();
    if (typeof window.BRANCH_KEY === 'string') return window.BRANCH_KEY;
  } catch (e) {}
  return null;
}
function __isHaifaLegacy() {
  const k = __getBranchKeySafe();
  return (k && String(k).toUpperCase() === 'HAIFA');
}
function __branchPath(path) {
  const k = __getBranchKeySafe();
  if (!k) return path; // fallback
  if (__isHaifaLegacy()) return path; // keep legacy for HAIFA
  // Scope under branches/<branchKey>/
  return `branches/${k}/${path}`;
}
function __ref(path) {
  return db.ref(__branchPath(path));
}

// ===== Ensure branch-scoped constraints path is ready (prevents falling back to legacy root on hard refresh) =====
async function __ensureConstraintsReady() {
  try {
    if (typeof window.resolveConstraintsBasePath === 'function') {
      await window.resolveConstraintsBasePath();
    }
  } catch (e) {}

  const start = Date.now();
  while (true) {
    try {
      const admin = (typeof window.isAdmin === 'function') ? window.isAdmin() : false;
      const p = (typeof window.getConstraintsPath === 'function') ? window.getConstraintsPath() : 'constraints';
      if (admin || (p && p !== 'constraints')) return true;
    } catch (e) {}

    if (Date.now() - start > 5000) return false;
    await new Promise(r => setTimeout(r, 50));
  }
}
// For a few legacy collections we may want to *read* either new scoped or old root (HAIFA) later.
// Right now: HAIFA stays root, other branches are scoped.

// ===========================================
// מערכת ניהול משמרות - לוגיקה ראשית
// ===========================================

// Firebase init moved to js/firebase.js

// =======================
  // 🔔 PUSH NOTIFICATIONS
  // =======================
  let messaging = null;

  // ✅ Save token without overriding (supports multiple devices per user)
  async function savePushTokenForKey(userKey, token) {
    if (!userKey || !token) return;

    const userRef = db.ref(`pushTokens/${userKey}`);
    const snap = await userRef.once("value");
    const data = snap.val();

    // If old format exists: pushTokens/{userKey} = "tokenString"
    if (typeof data === "string") {
      if (data === token) return; // already same
      // Convert old format to new format (keep old token as a record)
      await userRef.set(null);
      await userRef.push({
        token: data,
        updatedAt: Date.now(),
        ua: navigator.userAgent
      });
    }

    // Dedupe: if token already saved, just update timestamp
    const snap2 = await userRef.once("value");
    const data2 = snap2.val();
    if (data2 && typeof data2 === "object") {
      for (const [k, v] of Object.entries(data2)) {
        if (v && typeof v === "object" && v.token === token) {
          await userRef.child(k).update({
            updatedAt: Date.now(),
            ua: navigator.userAgent
          });
          return;
        }
      }
    }

    // Add as a new device token
    await userRef.push({
      token,
      updatedAt: Date.now(),
      ua: navigator.userAgent
    });
  }


  async function initPushNotifications() {
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Register SW (needed for FCM)
      const swReg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');

      // Messaging instance (requires firebase-messaging-compat.js)
      if (!messaging) messaging = firebase.messaging();

      const token = await messaging.getToken({
        vapidKey: 'BFtoipiPyC21A3_n-3OAKa276cp6hCg8x_bH4CPdHMD3M-ogMgorokpfvEiogsKjpiS08tZRdDVcYvQfyuq1ROA',
        serviceWorkerRegistration: swReg
      });

      if (token) {
        // ✅ Save for employee OR manager (manager key = 'MANAGER')
        const key = currentEmployee || 'MANAGER';
        await savePushTokenForKey(key, token);
        console.log('Push token saved for', key, token);
      } else {
        console.log('Push token:', token);
      }

      // Foreground messages (while app is open)
    // ✅ Foreground notifications (DATA + NOTIFICATION support)
messaging.onMessage((payload) => {
  try {
    const title =
      payload?.notification?.title ||
      payload?.data?.title ||
      "🔔 הודעה";

    const body =
      payload?.notification?.body ||
      payload?.data?.body ||
      "";

    const icon =
      payload?.notification?.icon ||
      payload?.data?.icon ||
      "./icon-192.png";

    if (Notification.permission === "granted") {
      new Notification(title, { body, icon });
    }
  } catch (e) {
    console.log("onMessage error", e);
  }
});


    } catch (err) {
      console.error('Push init error:', err);
    }
  }

  // =======================
  // 🔔 MANAGER REMINDER REQUEST (writes to DB)
  // =======================
  async function sendConstraintsReminderRequest() {
    try {
      const payload = {
        type: "constraints_reminder",
        title: "תזכורת להזנת אילוצים",
        body: "נא להזין אילוצים לשבוע הקרוב במערכת.",
        createdAt: Date.now()
      };

      await db.ref("adminPushRequests").push(payload);
      showMessage("✅ נשלחה בקשת תזכורת (נשמרה ב-Firebase)", "success");
    } catch (e) {
      console.error("sendConstraintsReminderRequest error:", e);
      showMessage("❌ שגיאה בשליחת בקשת תזכורת", "error");
    }
  }

let currentEmployee = '';
  let currentSchedule = null;
  let currentWeekKey = null;

  function getNextSundayKey() {
    const t = new Date(); t.setHours(0,0,0,0);
    const n = new Date(t);
    const d = t.getDay();
    n.setDate(t.getDate() + (d === 0 ? 0 : 7 - d));
    return toLocalDateStr(n);
  }

  function setApproveButtonVisible(v){
    const b = document.getElementById('approve-schedule-btn');
    if(b) b.style.display = v ? 'inline-block' : 'none';
  }

async function approveCurrentSchedule(){
  if(!currentSchedule) return;

  const k = currentWeekKey || getNextSundayKey();

  const payload = {
    data: currentSchedule,
    approvedAt: Date.now(),
    approvedBy: 'MANAGER'
  };

  // ✅ שומר לפי שבוע
  await __ref('approvedSchedules/' + k).set(payload);

  // ✅ מצביע ל"אחרון שאושר"
  await __ref('approvedSchedulesLatest').set({
    weekKey: k,
    approvedAt: payload.approvedAt,
    approvedBy: payload.approvedBy
  });

  showMessage('✅ הסידור נשמר כמאושר', 'success');
}

  async function exportApprovedScheduleToExcel(){
  // טוען את "האחרון שאושר" (או את השבוע הרלוונטי)
  const latestSnap = await __ref('approvedSchedulesLatest').once('value');
  const latest = latestSnap.val();

  if(!latest || !latest.weekKey){
    return showMessage('אין סידור מאושר אחרון לייצוא', 'error');
  }

  const k = latest.weekKey;

  const snap = await __ref('approvedSchedules/' + k + '/data').once('value');
  const approved = snap.val();

  if(!approved){
    return showMessage('הסידור המאושר לא נמצא ב-DB', 'error');
  }

  // ✅ שומרים את מה שעבדת עליו כרגע
  const liveSchedule = currentSchedule;

  // ✅ מייצאים את המאושר בלי להציג אותו באתר
  currentSchedule = approved;
  exportToExcel();

  // ✅ מחזירים את הסידור שאתה עובד עליו (כדי שלא יידרס)
  currentSchedule = liveSchedule;

  showMessage(`📊 ייצאתי את הסידור המאושר לאקסל (${k})`, 'success');
}


 async function loadApprovedScheduleToScreen(){
  const latestSnap = await __ref('approvedSchedulesLatest').once('value');
  const latest = latestSnap.val();

  if(!latest || !latest.weekKey){
    return showMessage('אין סידור מאושר אחרון לטעינה', 'error');
  }

  const k = latest.weekKey;

  const snap = await __ref('approvedSchedules/' + k + '/data').once('value');
  const d = snap.val();

  if(!d) return showMessage('הסידור האחרון לא נמצא ב-DB', 'error');

  currentSchedule = d;
  displaySchedule(d);
  currentWeekKey = k;

  showMessage(`📥 נטען הסידור המאושר האחרון (${k})`, 'success');
}



  let BRANCH_EMPLOYEES = {};

const USERS = {
    'ILAY': 'ILAY',
    'ROVEN': 'ROVEN',
    'HAI': 'HAI',
    'NATALI': 'NATALI',
    'INNA': 'INNA',
    'TAMIR': 'TAMIR',
    'ELIYA': 'ELIYA',
    'LIOR': 'LIOR',
    'AMANI': 'AMANI',
    'SHIROT': 'SHIROT',
    'AVI': 'AVI',
    'MOHAMAD': 'MOHAMAD'
  };

  // =============================
  // HAIFA LEGACY MODE FLAG
  // =============================
  function setHaifaLegacyMode(on) {
    try {
      if (on) localStorage.setItem("haifaLegacy", "1");
      else localStorage.removeItem("haifaLegacy");
    } catch (e) {}
  }
  function isHaifaLegacyMode() {
    try { return localStorage.getItem("haifaLegacy") === "1"; } catch (e) { return false; }
  }


  const DEPARTMENTS = {
    'מחלקת מיחשוב': ['ILAY', 'ROVEN'],
    'מחלקת קטנים': ['HAI', 'NATALI'],
    'מחלקת מחסנאים': ['AVI', 'MOHAMAD'],
    'מחלקת קו לבן': ['INNA', 'TAMIR', 'ELIYA'],
    'נציגות שירות': ['LIOR', 'AMANI', 'SHIROT']
  };


  // מיפוי שמות תצוגה בעברית (רק לתצוגה בטבלה!)
  let DISPLAY_NAMES = {
    'ILAY': 'עילאי',
    'ROVEN': 'ראובן',
    'HAI': 'חי',
    'NATALI': 'נטלי',
    'AVI': 'אבי',
    'MOHAMAD': 'מוחמד',
    'INNA': 'אינה',
    'TAMIR': 'תמיר',
    'ELIYA': 'אליה',
    'LIOR': 'ליאור',
    'AMANI': 'אמאני',
    'SHIROT': 'שירות'
  };

// =============================
// DYNAMIC BRANCH OVERRIDE
// =============================

(function initDynamicBranchData() {
  const branchKey = localStorage.getItem("currentBranchKey");

  // חיפה (legacy): לא טוענים נתונים דינמיים.
  // אם נשאר ערך ישן ב-localStorage או שסומן מצב legacy—ננקה ונצא.
  if (isHaifaLegacyMode() || !branchKey || branchKey === "HAIFA") {
    try { localStorage.removeItem("currentBranchKey"); } catch (e) {}
    return;
  }

  console.log("Loading dynamic branch data for:", branchKey);

  const basePath = `branches/${branchKey}/org`;

  // טען מחלקות
  firebase.database()
    .ref(`${basePath}/departments`)
    .once("value")
    .then(snapshot => {
      const data = snapshot.val();
      if (data) {
        Object.keys(DEPARTMENTS).forEach(k => delete DEPARTMENTS[k]);
        Object.assign(DEPARTMENTS, data);
        console.log("Departments loaded from branch");
      } else {
        // אין נתונים → סניף חדש → ריק
        Object.keys(DEPARTMENTS).forEach(k => delete DEPARTMENTS[k]);
        console.log("No departments yet (new branch)");
      }
    });

  
  // טען שמות תצוגה (DISPLAY NAMES) לסניף
  firebase.database()
    .ref(`${basePath}/displayNames`)
    .once("value")
    .then(snapshot => {
      const data = snapshot.val();
      if (data) {
        Object.keys(DISPLAY_NAMES).forEach(k => delete DISPLAY_NAMES[k]);
        Object.assign(DISPLAY_NAMES, data);
        console.log("Display names loaded from branch");
      } else {
        console.log("No display names yet (new branch)");
      }
    });

  // טען עובדים (לסניפים דינמיים בלבד) — לא לגעת ב-USERS (התחברות)
  firebase.database()
    .ref(`${basePath}/employees`)
    .once("value")
    .then(snapshot => {
      BRANCH_EMPLOYEES = snapshot.val() || {};
      console.log("Employees loaded from branch");
    });

})();

  // ======== נציגות שירות: הפעלה/כיבוי עובד "שירות" (SHIROT) ========
  const SHIROT_TOGGLE_KEY = 'shirotActive';
  function isShirotActive() {
    const v = localStorage.getItem(SHIROT_TOGGLE_KEY);
    return v === null ? true : v === 'true';
  }
  function setShirotActive(v) {
    localStorage.setItem(SHIROT_TOGGLE_KEY, v ? 'true' : 'false');
  }
 function getDeptEmployees(dept) {
  const val = DEPARTMENTS[dept];
  let list = [];

  // חיפה – מערך (לדוגמה: ['AVI','MOHAMAD'])
  if (Array.isArray(val)) {
    list = val.slice();
  }
  // סניף חדש – אובייקט (לדוגמה: {AVI:true, MOHAMAD:true})
  else if (val && typeof val === "object") {
    list = Object.keys(val);
  }

  // ניקוי מפתחות לא חוקיים שמגיעים לפעמים מטפסים/אובייקטים
  list = list.filter(e => {
    if (typeof e !== 'string') return false;
    const t = e.trim();
    if (!t) return false;

    // מסננים מפתחות מערכת/מטא
    if (t === 'name') return false;
    if (t.startsWith('_')) return false;

    // לפעמים נשמר "_meta" או "meta_" ומוצג כעובד בטעות
    const normalized = t.toLowerCase().replace(/[^a-z]/g, '');
    if (normalized === 'meta') return false;

    return true;
  });

  // אם יש רשימת עובדים מוגדרת לסניף החדש – נוודא שהמחלקה משתמשת רק בהם
  if (typeof BRANCH_EMPLOYEES === 'object' && BRANCH_EMPLOYEES && Object.keys(BRANCH_EMPLOYEES).length > 0) {
    const allowed = new Set(Object.keys(BRANCH_EMPLOYEES));
    list = list.filter(e => allowed.has(e));
  }

  // נציגות שירות – כיבוי SHIROT
  if (dept === 'נציגות שירות' && typeof isShirotActive === "function" && !isShirotActive()) {
    list = list.filter(e => e !== 'SHIROT');
  }

  // קו לבן – כיבוי ELIYA
  if (dept === 'מחלקת קו לבן' && typeof isEliyaActive === "function" && !isEliyaActive()) {
    list = list.filter(e => e !== 'ELIYA');
  }

  return list;
}

function getDeptSizeForRules(dept) {
    return getDeptEmployees(dept).length;
  }


  

  // ======== קו לבן: הפעלה/כיבוי עובד "אליה" (ELIYA) ========
  const ELIYA_TOGGLE_KEY = 'eliyaActive';
  function isEliyaActive() {
    const v = localStorage.getItem(ELIYA_TOGGLE_KEY);
    return v === null ? true : v === 'true';
  }
  function setEliyaActive(v) {
    localStorage.setItem(ELIYA_TOGGLE_KEY, v ? 'true' : 'false');
  }

// =============================
// ✅ HAIFA TOGGLES SYNC (shared across devices)
// =============================
async function loadHaifaToggleSettings() {
  try {
    // Only meaningful in HAIFA legacy (root paths)
    const [s1, s2] = await Promise.all([
      db.ref("settings/shirotActive").once("value"),
      db.ref("settings/eliyaActive").once("value")
    ]);
    const sh = s1.val();
    const el = s2.val();
    if (typeof sh === "boolean") localStorage.setItem("shirotActive", sh ? "true" : "false");
    if (typeof el === "boolean") localStorage.setItem("eliyaActive", el ? "true" : "false");
  } catch (e) {
    // ignore (no permission / not set yet)
  }
}
function initShirotToggleUI() {
    const el = document.getElementById('shirot-active-toggle');
    if (!el) return;

    el.checked = isShirotActive();

    el.onchange = async () => {
      setShirotActive(el.checked);

      // רענון תצוגה בהתאם למצב (לא נוגעים בלוגיקת משתמשים/סיסמאות)
      try { await await loadAllConstraints(); } catch(e) {}
      try { if (currentSchedule) displaySchedule(currentSchedule); } catch(e) {}

      showMessage(
        el.checked
          ? '✅ "שירות" פעיל: נציגות שירות מתנהגת כמו 3 עובדים'
          : '⚠️ "שירות" לא פעיל: נציגות שירות מתנהגת כמו 2 עובדים',
        'success'
      );
    };
  }


  

  function initEliyaToggleUI() {
    const el = document.getElementById('eliya-active-toggle');
    if (!el) return;

    el.checked = isEliyaActive();

    el.onchange = async () => {
      setEliyaActive(el.checked);

      // רענון תצוגה בהתאם למצב (לא נוגעים בלוגיקת משתמשים/סיסמאות)
      try { await loadAllConstraints(); } catch(e) {}
      try { if (currentSchedule) displaySchedule(currentSchedule); } catch(e) {}

      showMessage(
        el.checked
          ? '✅ "אליה" פעיל: קו לבן מתנהג כמו 3 עובדים'
          : '⚠️ "אליה" לא פעיל: קו לבן מתנהג כמו 2 עובדים (בלי אמצע)',
        'success'
      );
    };
  }


  // מיפוי שמות תצוגה בעברית (רק לתצוגה בטבלה!)
  

  const MANAGER = { username: 'SAGI', password: '241188' };


  // ======== התאמת אפשרויות אילוץ לפי מחלקה ========
  function getDeptOfEmp(emp) {
    for (const [dept, list] of Object.entries(DEPARTMENTS)) {
      // HAIFA legacy: array
      if (Array.isArray(list) && list.includes(emp)) return dept;
      // New branches: object map {EMP:true}
      if (list && typeof list === 'object' && !Array.isArray(list) && Object.prototype.hasOwnProperty.call(list, emp)) return dept;
    }
    return null;
  }

function buildConstraintOptionsForEmp(emp) {
    const dept = getDeptOfEmp(emp);
    const size = dept ? (getDeptSizeForRules(dept) || 0) : 0;

    if (size === 3) {
      return [
        { value: "", label: "-- בחר --" },
        { value: "want-morning", label: "✅ רוצה בוקר" },
        { value: "want-middle",  label: "✅ רוצה אמצע" },
        { value: "want-evening", label: "✅ רוצה ערב" },
        { value: "day-off",      label: "🏖️ חופש מלא" }
      ];
    }

    return [
      { value: "", label: "-- בחר --" },
      { value: "no-morning", label: "❌ לא בוקר" },
      { value: "no-evening", label: "❌ לא ערב" },
      { value: "day-off",    label: "🏖️ חופש מלא" }
    ];
  }

  function applyConstraintOptions(emp) {
    const options = buildConstraintOptionsForEmp(emp);

    ["c1-type", "c2-type"].forEach(id => {
      const sel = document.getElementById(id);
      const current = sel.value;
      sel.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
      if (options.some(o => o.value === current)) sel.value = current;
    });
  }

  function showLoginForm(type) {
    hideAll();
    document.getElementById(type + '-login').classList.add('active');
  }

  function backToLogin() {
    hideAll();
    document.getElementById('login-screen').classList.add('active');
    clearInputs();
  }

 function logout() {
  currentEmployee = '';
  localStorage.removeItem('currentEmployee'); // ⬅️ חדש: מוחק זיכרון התחברות קבוע
  backToLogin();
  showMessage('התנתקת בהצלחה', 'success');
}


  
// =======================
// ✅ WAIT FOR BRANCH/CONSTRAINTS INIT
// =======================
// When manager logs in, auth state + subscription resolution happen async in firebase.js.
// We must wait until constraints path is resolved to branch-scoped (or admin legacy)
// before doing any DB reads/writes, otherwise we may accidentally touch root paths.
async function waitForBranchReady(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const branchKey = (typeof window.getBranchKey === "function") ? window.getBranchKey() : null;
      const isAdminFn = (typeof window.isAdmin === "function") ? window.isAdmin() : false;
      const cPath = (typeof window.getConstraintsPath === "function") ? window.getConstraintsPath() : "constraints";

      // Admins keep legacy root path; non-admins must have branchKey and scoped constraints path.
    if (isAdminFn) return true;
if (cPath === "constraints") return true; // ✅ HAIFA legacy
if (branchKey && cPath && String(cPath).startsWith(`branches/${branchKey}/constraints`)) return true;
    } catch (e) {}

    // small delay
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}

async function loginEmployee() {
    const username = document.getElementById('emp-username').value.trim().toUpperCase();
    const password = document.getElementById('emp-password').value.trim();

    if (!username || !password) return showMessage

     // אם המשתמש כבר במצב חיפה-legacy (למשל אחרי רענון) נוודא שאין branchKey דינמי
     if (isHaifaLegacyMode()) { try { localStorage.removeItem(\"currentBranchKey\"); } catch(e) {} }

     if (!username || !password) return showMessage('אנא הזן שם משתמש וסיסמה', 'error');

    if (USERS[username] && USERS[username] === password) {
      currentEmployee = username;
      localStorage.setItem('currentEmployee', currentEmployee);

      // ✅ Haifa employees are legacy: force HAIFA context on this device
      try { setHaifaLegacyMode(true); } catch(e) {}
      try { localStorage.removeItem("currentBranchKey"); } catch(e) {}



      hideAll();
      document.getElementById('employee-section').classList.add('active');
      document.getElementById('employee-welcome').textContent = `שלום ${DISPLAY_NAMES[username] || username}! 👋`;

      // ✅ pull HAIFA shared toggles (eliya/shirot) so constraint options match manager
      await loadHaifaToggleSettings();
      applyConstraintOptions(currentEmployee);

      await waitForBranchReady(6000);
      await loadEmployeeConstraints();
      showMessage('התחברת בהצלחה', 'success');
          initPushNotifications();
} else {
      showMessage('שם משתמש או סיסמה שגויים', 'error');
    }
  }

  function loginManager() {
    // Option B (Email/Password) - Option 1 flow (no linkWithCredential):
    // ✅ Sign-in if account exists, otherwise create a new account.
    // Uses fetchSignInMethodsForEmail to distinguish "wrong password" vs "user not found".
    const email = document.getElementById('mgr-username').value.trim();
    const password = document.getElementById('mgr-password').value.trim();

    if (!email || !password) return showMessage('אנא הזן אימייל וסיסמה', 'error');

    const onAuthed = async () => {
      console.log('Firebase Auth OK (manager)');
      
// ✅ Lock branch context for this manager BEFORE resolving paths
const uid = auth.currentUser?.uid;
const HAIFA_MANAGER_UID = "LRHfwBSAqYV9cxrcko9KfCafJOD3";

if (uid === HAIFA_MANAGER_UID) {
  // 🔒 חיפה – מצב legacy מוחלט
  setHaifaLegacyMode(true);
  localStorage.removeItem("currentBranchKey");
  // 🔴 סנכרון מלא עם firebase.js
  window.isAdmin = () => true;
  window.getBranchKey = () => "HAIFA";

  console.log("HAIFA manager forced to legacy admin mode");
} else {
  // סניפים חדשים – branch רגיל
  setHaifaLegacyMode(false);
  localStorage.setItem("currentBranchKey", uid);
}
      
      // ✅ Ensure branch + constraints path resolved before loading data
      try {
        if (typeof window.loadSystemSubscription === "function") await window.loadSystemSubscription();
        if (typeof window.resolveConstraintsBasePath === "function") await window.resolveConstraintsBasePath();
        await waitForBranchReady(6000);
      } catch (e) {
        console.warn("Branch init wait failed:", e);
      }


      


currentEmployee = 'MANAGER';
      localStorage.setItem('currentEmployee', currentEmployee);

      hideAll();
      document.getElementById('manager-section').classList.add('active');
      initShirotToggleUI();
      initEliyaToggleUI();
      loadAllConstraints();
      showMessage('התחברת בהצלחה', 'success');
      initPushNotifications();
    };

    auth.signInWithEmailAndPassword(email, password)
      .then(onAuthed)
      .catch(async (error) => {
        console.error('Firebase Auth ERROR (signIn):', error);

        // If the email doesn't exist, Firebase *should* return auth/user-not-found,
        // but sometimes returns auth/invalid-login-credentials. We'll check methods.
        if (error && (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-login-credentials')) {
          try {
            const methods = await auth.fetchSignInMethodsForEmail(email);
            if (!methods || methods.length === 0) {
              // Truly new email -> create user
              await auth.createUserWithEmailAndPassword(email, password);
              return onAuthed();
            } else {
              // Email exists but creds are wrong
              showMessage('סיסמה שגויה', 'error');
              return;
            }
          } catch (e) {
            console.error('fetchSignInMethodsForEmail failed:', e);
            // Fall back to create attempt (safe-ish): if already exists, Firebase will return email-already-in-use
            try {
              await auth.createUserWithEmailAndPassword(email, password);
              return onAuthed();
            } catch (ce) {
              console.error('Create user failed:', ce);
              if (ce && ce.code === 'auth/email-already-in-use') {
                showMessage('האימייל כבר קיים. נסה להתחבר עם הסיסמה הנכונה', 'error');
              } else if (ce && ce.code === 'auth/weak-password') {
                showMessage('הסיסמה חייבת להיות לפחות 6 תווים', 'error');
              } else if (ce && ce.code === 'auth/invalid-email') {
                showMessage('אימייל לא תקין', 'error');
              } else {
                showMessage('שגיאת התחברות. בדוק אימייל/סיסמה ונסה שוב', 'error');
              }
              return;
            }
          }
        }

        // Other common errors
        if (error && error.code === 'auth/wrong-password') {
          showMessage('סיסמה שגויה', 'error');
        } else if (error && error.code === 'auth/invalid-email') {
          showMessage('אימייל לא תקין', 'error');
        } else if (error && error.code === 'auth/weak-password') {
          showMessage('הסיסמה חייבת להיות לפחות 6 תווים', 'error');
        } else if (error && error.code === 'auth/email-already-in-use') {
          showMessage('האימייל כבר קיים. נסה להתחבר עם הסיסמה הנכונה', 'error');
        } else {
          showMessage('שגיאת התחברות. בדוק אימייל/סיסמה ונסה שוב', 'error');
        }
      });
  }

  async function loadEmployeeConstraints() {
  const __ok = await __ensureConstraintsReady();
  if (!__ok) { console.warn('Constraints path not ready yet'); return; }

    if (currentEmployee) applyConstraintOptions(currentEmployee);

    const snapshot = await constraintsRef(currentEmployee).once('value');
    const data = snapshot.val() || {};

    document.getElementById('c1-date').value = data.c1?.date || '';
    document.getElementById('c1-type').value = data.c1?.type || '';

    document.getElementById('c2-date').value = data.c2?.date || '';
    document.getElementById('c2-type').value = data.c2?.type || '';

    displayMyConstraints(data);
  }

  async function saveConstraints() {
  const __ok = await __ensureConstraintsReady();
  if (!__ok) { console.warn('Constraints path not ready yet'); return; }

    if (!currentEmployee) return;

    const c1Date = document.getElementById('c1-date').value;
    const c1Type = document.getElementById('c1-type').value;
    const c2Date = document.getElementById('c2-date').value;
    const c2Type = document.getElementById('c2-type').value;

    if (c1Date && !isValidWeekday(c1Date)) return showMessage('❌ לא ניתן לבחור שישי או שבת', 'error');
    if (c2Date && !isValidWeekday(c2Date)) return showMessage('❌ לא ניתן לבחור שישי או שבת', 'error');

    const constraints = {};
    if (c1Date && c1Type) constraints.c1 = { date: c1Date, type: c1Type, status: c1Type === 'day-off' ? 'pending' : 'approved' };
    if (c2Date && c2Type) constraints.c2 = { date: c2Date, type: c2Type, status: c2Type === 'day-off' ? 'pending' : 'approved' };

    await constraintsRef(currentEmployee).set(constraints);

    const hasDayOff = c1Type === 'day-off' || c2Type === 'day-off';
    showMessage(hasDayOff ? 'נשמר! בקשות חופש ממתינות לאישור' : 'נשמר בהצלחה!', 'success');
    displayMyConstraints(constraints);
  }

  function displayMyConstraints(data) {
    const today = new Date(); today.setHours(0,0,0,0);
    let html = '<h3 style="color:#667eea;">האילוצים שלי:</h3>';
    let hasValid = false;

    if (data.c1 && new Date(data.c1.date + 'T00:00:00') >= today) {
      html += `<div class="constraint-card"><strong>אילוץ 1:</strong> ${formatDate(data.c1.date)} - ${formatType(data.c1.type)} ${getStatusBadge(data.c1)}</div>`;
      hasValid = true;
    }
    if (data.c2 && new Date(data.c2.date + 'T00:00:00') >= today) {
      html += `<div class="constraint-card"><strong>אילוץ 2:</strong> ${formatDate(data.c2.date)} - ${formatType(data.c2.type)} ${getStatusBadge(data.c2)}</div>`;
      hasValid = true;
    }
    if (!hasValid) html += '<p style="color:#28a745;">אין אילוצים עתידיים</p>';
    document.getElementById('my-constraints').innerHTML = html;
  }

  async function loadAllConstraints() {
  const __ok = await __ensureConstraintsReady();
  if (!__ok) { console.warn('Constraints path not ready yet'); return; }

    const snapshot = await constraintsRef().once('value');
    const allData = snapshot.val() || {};
    const today = new Date(); today.setHours(0,0,0,0);

    let html = '<h2>אילוצי העובדים</h2>';

    for (const [dept] of Object.entries(DEPARTMENTS)) {
      const employees = getDeptEmployees(dept);
      html += `<div style="background:#f0f0f0; padding:15px; border-radius:10px; margin-bottom:20px;">
        <h3 style="color:#667eea;">🏢 ${dept}</h3>`;

      employees.forEach(emp => {
        const data = allData[emp];

        html += `<div class="employee-constraints">`;

        html += `
          <div class="emp-header-row">
            <h4>${DISPLAY_NAMES[emp] || emp}</h4>
          </div>
        `;

        let hasValid = false;

        if (data?.c1 && new Date(data.c1.date + 'T00:00:00') >= today) { html += formatConstraintForManager(emp,'c1',data.c1); hasValid = true; }
        if (data?.c2 && new Date(data.c2.date + 'T00:00:00') >= today) { html += formatConstraintForManager(emp,'c2',data.c2); hasValid = true; }

        if (!hasValid) html += '<p style="color:#28a745;">✅ אין אילוצים</p>';

        html += '</div>';
      });

      html += '</div>';
    }

    document.getElementById('all-constraints').innerHTML = html;
  }

  function formatConstraintForManager(emp, key, c) {
    let html = `<div style="margin:10px 0; padding:10px; background:#f8f9fa; border-radius:6px;">
      📌 ${formatDate(c.date)} - ${formatType(c.type)}`;

    if (c.type === 'day-off') {
      const status = c.status || 'pending';
      if (status === 'pending') {
        html += `<div class="approval-buttons">
          <button class="approve-btn" onclick="updateApproval('${emp}','${key}','approved')">✅ אשר</button>
          <button class="reject-btn" onclick="updateApproval('${emp}','${key}','rejected')">❌ דחה</button>
        </div>
        <span class="status-pending">⏳ ממתין</span>`;
      } else if (status === 'approved') {
        html += `<span class="status-approved">✅ מאושר</span>`;
      } else {
        html += `<span class="status-rejected">❌ נדחה</span>`;
      }
    } else {
      html += `<span class="status-approved">✅ פעיל</span>`;
    }

    html += `
      <div class="approval-buttons" style="margin-top:8px;">
        <button class="reset-btn" onclick="deleteSingleConstraint('${emp}','${key}')">🗑️ מחק אילוץ זה</button>
      </div>
    `;

    return html + `</div>`;
  }

  async function updateApproval(emp, key, status) {
    if (status === 'rejected') {
      await constraintsRef(`${emp}/${key}`).set(null);
      showMessage('בקשת החופש נדחתה ונמחקה', 'success');
    } else {
      await constraintsRef(`${emp}/${key}`).update({
        status: "approved",
        approvedAt: firebase.database.ServerValue.TIMESTAMP,
        approvedBy: MANAGER.username
      });
      showMessage('בקשת החופש אושרה!', 'success');
    }
    await loadAllConstraints();
  }

  async function deleteSingleConstraint(emp, key){
    const ok = confirm(`למחוק את ${key} עבור ${DISPLAY_NAMES[emp] || emp}?`);
    if(!ok) return;
    await constraintsRef(`${emp}/${key}`).set(null);
    showMessage(`נמחק ${key} עבור ${DISPLAY_NAMES[emp] || emp}`, 'success');
    await loadAllConstraints();

    currentSchedule = null;
    document.getElementById('schedule-result').innerHTML = '';
    document.getElementById('export-section').style.display = 'none';
  }

  async function resetEmployeeConstraints(emp){
    const ok = confirm(`לאפס את כל האילוצים של ${DISPLAY_NAMES[emp] || emp}? (ימחק c1+c2)`);
    if(!ok) return;

    await constraintsRef(`${emp}`).set(null);
    showMessage(`אופסו האילוצים של ${DISPLAY_NAMES[emp] || emp}`, 'success');

    await loadAllConstraints();

    currentSchedule = null;
    document.getElementById('schedule-result').innerHTML = '';
    document.getElementById('export-section').style.display = 'none';
  }

  async function resetAllConstraints() {
  const __ok = await __ensureConstraintsReady();
  if (!__ok) { console.warn('Constraints path not ready yet'); return; }

    const ok = confirm(`לאפס אילוצים לכל העובדים? פעולה זו מוחקת את כל האילוצים.`);
    if (!ok) return;

    await constraintsRef().set(null);
    showMessage(`כל האילוצים אופסו`, 'success');

    currentSchedule = null;
    document.getElementById('schedule-result').innerHTML = '';
    document.getElementById('export-section').style.display = 'none';

    await loadAllConstraints();
  }

  async function refreshAll(){
  const __ok = await __ensureConstraintsReady();
  if (!__ok) { console.warn('Constraints path not ready yet'); return; }

    await loadAllConstraints();
    await generateSchedule();
  }

  async function generateSchedule() {
  const __ok = await __ensureConstraintsReady();
  if (!__ok) { console.warn('Constraints path not ready yet'); return; }

    try {
      const snapshot = await constraintsRef().once('value');
      const constraints = snapshot.val() || {};

      const conflicts = checkConflicts(constraints);
      const schedule = await createSchedule(constraints);

      if (conflicts.length > 0) {
        let msg = '⚠️ קונפליקטים:\n\n';
        conflicts.forEach(c => { msg += `🏢 ${c.dept}\n📅 ${formatDate(c.date)}: ${c.emps.join(' ו-')} - ${c.desc}\n\n`; });
        showMessage(msg, 'error');
        document.getElementById('schedule-result').innerHTML = `<div class="message error">${msg}</div>`;
        document.getElementById('export-section').style.display = 'none';
        return;
      }

      currentSchedule = schedule;
      displaySchedule(schedule);
      document.getElementById('export-section').style.display = 'block';
      showMessage('הסידור נוצר בהצלחה!', 'success');
      currentWeekKey = getNextSundayKey();
      setApproveButtonVisible(true);


    } catch (error) {
      console.error(error);
      showMessage(error.message || 'שגיאה ביצירת הסידור', 'error');
      document.getElementById('schedule-result').innerHTML =
        `<div class="message error">${error.message || 'שגיאה ביצירת הסידור'}</div>`;
      document.getElementById('export-section').style.display = 'none';
    }
  }

  function checkConflicts(constraints) {
    const conflicts = [];
    const today = new Date(); today.setHours(0,0,0,0);

    const isApprovedForScheduling = (c) => {
      if (!c) return false;
      if (new Date(c.date + 'T00:00:00') < today) return false;

      if (c.type === 'day-off') {
        return c.status === 'approved' && !!c.approvedAt;
      }
      return !c.status || c.status === 'approved';
    };

    for (const [dept] of Object.entries(DEPARTMENTS)) {
      const emps = getDeptEmployees(dept);
      const allDates = [];

      emps.forEach(emp => {
        const data = constraints[emp];
        if (!data) return;

        const addIfApproved = (c) => {
          if (!isApprovedForScheduling(c)) return;
          allDates.push({ emp, ...c });
        };

        addIfApproved(data.c1);
        addIfApproved(data.c2);
      });

      const byDate = {};
      allDates.forEach(c => { (byDate[c.date] ||= []).push(c); });

      Object.entries(byDate).forEach(([date, dateConstraints]) => {
        const dayOffCount = dateConstraints.filter(c => c.type === 'day-off').length;

        // ספירת "לא יכול" — במצב 2 עובדים, גם אילוצי "רוצה" משפיעים (תאימות למחלקה שירדה מ-3 ל-2)
        const noMorningCount = (emps.length === 2)
          ? dateConstraints.filter(c =>
              c.type === 'no-morning' ||
              c.type === 'day-off' ||
              c.type === 'want-evening' || // רוצה ערב => בפועל לא יכול בוקר
              c.type === 'want-middle'      // אין אמצע במצב 2 עובדים => חוסם גם בוקר
            ).length
          : dateConstraints.filter(c => c.type === 'no-morning' || c.type === 'day-off').length;

        const noEveningCount = (emps.length === 2)
          ? dateConstraints.filter(c =>
              c.type === 'no-evening' ||
              c.type === 'day-off' ||
              c.type === 'want-morning' || // רוצה בוקר => בפועל לא יכול ערב
              c.type === 'want-middle'      // אין אמצע במצב 2 עובדים => חוסם גם ערב
            ).length
          : dateConstraints.filter(c => c.type === 'no-evening' || c.type === 'day-off').length;

        if (emps.length === 3) {
          if (dayOffCount >= 2) {
            conflicts.push({
              dept, date,
              emps: dateConstraints.filter(c => c.type === 'day-off').map(c => c.emp),
              desc: 'יותר מעובד אחד ביקש חופש'
            });
          }

          const wantMorning = dateConstraints.filter(c => c.type === 'want-morning').map(c => c.emp);
          const wantMiddle  = dateConstraints.filter(c => c.type === 'want-middle').map(c => c.emp);
          const wantEvening = dateConstraints.filter(c => c.type === 'want-evening').map(c => c.emp);

          if (wantMorning.length > 1) conflicts.push({ dept, date, emps: wantMorning, desc: 'יותר מעובד אחד בחר משמרת בוקר' });
          if (wantMiddle.length  > 1) conflicts.push({ dept, date, emps: wantMiddle,  desc: 'יותר מעובד אחד בחר משמרת אמצע' });
          if (wantEvening.length > 1) conflicts.push({ dept, date, emps: wantEvening, desc: 'יותר מעובד אחד בחר משמרת ערב' });

        } else {
          if (dayOffCount === 2) conflicts.push({ dept, date, emps: dateConstraints.map(c => c.emp), desc: 'שניהם ביקשו חופש' });
          else if (noMorningCount === 2) conflicts.push({ dept, date, emps: dateConstraints.map(c => c.emp), desc: 'שניהם לא יכולים בוקר' });
          else if (noEveningCount === 2) conflicts.push({ dept, date, emps: dateConstraints.map(c => c.emp), desc: 'שניהם לא יכולים ערב' });
        }
      });
    }

    return conflicts;
  }

  async function createSchedule(constraints) {
   const today = new Date(); today.setHours(0,0,0,0);
const nextSunday = new Date(today);
const dow = today.getDay();

// ראשון הבא (השבוע הבא תמיד)
nextSunday.setDate(today.getDate() + (dow === 0 ? 7 : 7 - dow));



    const allSchedules = {};

    // קריאת היסטוריית מוצ"ש מ-Firebase
    const historySnapshot = await __ref('saturdayHistory').once('value');
    const saturdayHistory = historySnapshot.val() || {};

    // ✅ NEW: היסטוריה למחלקות של 2 עובדים (מי פותח את השבוע)
    const weekdaySnap = await __ref('weekdayStartHistory').once('value');
    const weekdayStartHistory = weekdaySnap.val() || {};


    const isApprovedForScheduling = (c) => {
      if (!c) return false;
      if (new Date(c.date + 'T00:00:00') < today) return false;

      if (c.type === 'day-off') {
        return c.status === 'approved' && !!c.approvedAt;
      }
      return !c.status || c.status === 'approved';
    };

    const getApprovedConstraintOnDate = (emp, dateStr) => {
      const data = constraints[emp];
      if (!data) return null;
      const c1 = data.c1 && isApprovedForScheduling(data.c1) && data.c1.date === dateStr ? data.c1 : null;
      const c2 = data.c2 && isApprovedForScheduling(data.c2) && data.c2.date === dateStr ? data.c2 : null;
      return c1 || c2;
    };

    const isDayOffApproved = (emp, dateStr) => {
      const c = getApprovedConstraintOnDate(emp, dateStr);
      return c && c.type === 'day-off';
    };

    const getWantedShift = (emp, dateStr) => {
      const c = getApprovedConstraintOnDate(emp, dateStr);
      if (!c) return null;
      if (c.type === 'want-morning') return 'morning';
      if (c.type === 'want-middle')  return 'middle';
      if (c.type === 'want-evening') return 'evening';
      return null;
    };

    const cannotMorning = (emp, dateStr) => {
      const c = getApprovedConstraintOnDate(emp, dateStr);
      if (!c) return false;

      // ✅ תאימות: אם מחלקה ירדה מ-3 עובדים ל-2 (למשל נציגות שירות כש"שירות" כבוי),
      // אילוצים מסוג "רוצה" צריכים עדיין להשפיע.
      const dept = getDeptOfEmp(emp);
      const size = dept ? getDeptSizeForRules(dept) : 0;

      if (size === 2) {
        // רוצה ערב => בפועל "לא יכול בוקר"
        if (c.type === 'want-evening') return true;
        // רוצה אמצע => אין אמצע במצב 2 עובדים, נתייחס כ"חסום בוקר"
        if (c.type === 'want-middle') return true;
      }

      return (c.type === 'no-morning' || c.type === 'day-off');
    };
    const cannotEvening = (emp, dateStr) => {
      const c = getApprovedConstraintOnDate(emp, dateStr);
      if (!c) return false;

      // ✅ תאימות: אם מחלקה ירדה מ-3 עובדים ל-2 (למשל נציגות שירות כש"שירות" כבוי),
      // אילוצים מסוג "רוצה" צריכים עדיין להשפיע.
      const dept = getDeptOfEmp(emp);
      const size = dept ? getDeptSizeForRules(dept) : 0;

      if (size === 2) {
        // רוצה בוקר => בפועל "לא יכול ערב"
        if (c.type === 'want-morning') return true;
        // רוצה אמצע => אין אמצע במצב 2 עובדים, נתייחס כ"חסום ערב"
        if (c.type === 'want-middle') return true;
      }

      return (c.type === 'no-evening' || c.type === 'day-off');
    };

    for (const [dept] of Object.entries(DEPARTMENTS)) {
      const emps = getDeptEmployees(dept);
      const schedule = [];
      const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
      const isThreeEmp = emps.length === 3;
          const isStockroomDept = (dept === 'מחלקת מחסנאים') && (emps.length === 2) && emps.includes('AVI') && emps.includes('MOHAMAD');
      const isServiceRepsTwoDept = (dept === 'נציגות שירות') && (emps.length === 2) && emps.includes('LIOR') && emps.includes('AMANI');

      

      // ✅ NEW: במחלקה של 2 עובדים - קובע מי פותח את השבוע (ראשון בבוקר)
      let weekdayStartEmp = null;
      if (!isThreeEmp && !isStockroomDept) {
        const a = emps[0], b = emps[1];
        weekdayStartEmp = weekdayStartHistory[dept] || (Math.random() < 0.5 ? a : b);
      } else if (isStockroomDept) {
        // מחלקת מחסנאים: קיבוע אבי בוקר ומוחמד ערב (אין צורך בהיסטוריה שבועית)
        weekdayStartEmp = 'AVI';
      }
// ✅ NEW: מונה משמרות לכל עובד למען הוגנות
      const shiftCounts = {};
      emps.forEach(emp => { shiftCounts[emp] = { morning: 0, middle: 0, evening: 0 }; });

      // פונקציה לבחירת עובד עם הכי פחות משמרות מסוג מסוים
      const pickLeastBurdenedEmp = (availableEmps, shift) => {
        if (!availableEmps || availableEmps.length === 0) return null;
        
        // מיון לפי מספר משמרות מסוג זה
        const sorted = availableEmps.slice().sort((a, b) => {
          const countA = shiftCounts[a][shift];
          const countB = shiftCounts[b][shift];
          if (countA !== countB) return countA - countB;
          // שובר שוויון - מי שיש לו פחות משמרות בכלל
          const totalA = shiftCounts[a].morning + shiftCounts[a].middle + shiftCounts[a].evening;
          const totalB = shiftCounts[b].morning + shiftCounts[b].middle + shiftCounts[b].evening;
          if (totalA !== totalB) return totalA - totalB;
          // שובר שוויון נוסף - רנדומלי!
          return Math.random() - 0.5;
        });
        
        // אם יש כמה עובדים עם אותו מספר משמרות, בחר רנדומלית ביניהם
        const minCount = shiftCounts[sorted[0]][shift];
        const candidates = sorted.filter(emp => shiftCounts[emp][shift] === minCount);
        
        if (candidates.length > 1) {
          // בחר רנדומלית מבין המועמדים
          return candidates[Math.floor(Math.random() * candidates.length)];
        }
        
        return sorted[0];
      };

      for (let i=0;i<5;i++) {
        const date = new Date(nextSunday);
        date.setDate(nextSunday.getDate() + i);
        const dateStr = toLocalDateStr(date);

        // מחלקת מחסנאים: א'-ה' קבוע (אבי בוקר, מוחמד ערב). אם אחד בחופש מאושר – השני כפולה.
        if (isStockroomDept) {
          const a = 'AVI', b = 'MOHAMAD';
          const aOff = isDayOffApproved(a, dateStr);
          const bOff = isDayOffApproved(b, dateStr);
          if (aOff && bOff) {
            schedule.push({ day: days[i], date: dateStr, morning: null, evening: null, dept });
          } else if (aOff && !bOff) {
            schedule.push({ day: days[i], date: dateStr, morning: b, evening: b, dept });
          } else if (bOff && !aOff) {
            schedule.push({ day: days[i], date: dateStr, morning: a, evening: a, dept });
          } else {
            schedule.push({ day: days[i], date: dateStr, morning: a, evening: b, dept });
          }
          continue;
        }

        if (isThreeEmp) {
          const dayOffs = emps.filter(emp => isDayOffApproved(emp, dateStr));

          if (dayOffs.length === 1) {
            // עובד אחד בחופש - רק 2 עובדים עובדים (בוקר + ערב)
            const working = emps.filter(emp => !dayOffs.includes(emp));
            
            const morningEmp = pickLeastBurdenedEmp(working, 'morning');
            const eveningEmp = working.filter(e => e !== morningEmp)[0];
            
            schedule.push({ day: days[i], date: dateStr, morning: morningEmp, evening: eveningEmp, dept });
            
            shiftCounts[morningEmp].morning++;
            shiftCounts[eveningEmp].evening++;

          } else {
            // יום רגיל - 3 משמרות
            
            // בדיקה אם יש בחירות "רוצה משמרת"
            const wanted = { morning: null, middle: null, evening: null };
            for (const emp of emps) {
              const w = getWantedShift(emp, dateStr);
              if (w) wanted[w] = emp;
            }

            const used = new Set();
            const assign = { morning: null, middle: null, evening: null };

            // קודם כל מכבדים את הבחירות
            for (const shift of ['morning', 'middle', 'evening']) {
              if (wanted[shift]) {
                assign[shift] = wanted[shift];
                used.add(wanted[shift]);
              }
            }

            // עכשיו משלימים משמרות חסרות בצורה הוגנת
            const availableEmps = emps.filter(e => !used.has(e));
            
            for (const shift of ['morning', 'middle', 'evening']) {
              if (!assign[shift]) {
                const emp = pickLeastBurdenedEmp(availableEmps, shift);
                if (emp) {
                  assign[shift] = emp;
                  availableEmps.splice(availableEmps.indexOf(emp), 1);
                  used.add(emp);
                }
              }
            }

            schedule.push({ day: days[i], date: dateStr, morning: assign.morning, middle: assign.middle, evening: assign.evening, dept });
            
            // עדכון מונים
            shiftCounts[assign.morning].morning++;
            shiftCounts[assign.middle].middle++;
            shiftCounts[assign.evening].evening++;
          }

        } else {
          // 2 עובדים – רוטציה היסטורית (מתחשב בשבוע הקודם)
          const a = emps[0], b = emps[1];

          // מי פותח את השבוע (ראשון בבוקר) נקבע פעם אחת למחלקה (weekdayStartEmp)
          let startEmp = weekdayStartEmp || (Math.random() < 0.5 ? a : b);
          const otherEmp = (startEmp === a) ? b : a;
          const aOff = isDayOffApproved(a, dateStr);
          const bOff = isDayOffApproved(b, dateStr);

          if (aOff && !bOff) schedule.push({ day: days[i], date: dateStr, morning: b, evening: b, dept });
          else if (bOff && !aOff) schedule.push({ day: days[i], date: dateStr, morning: a, evening: a, dept });
          else {
            const m = (i % 2 === 0) ? startEmp : otherEmp;
            const e = (m === startEmp) ? otherEmp : startEmp;

            const mCant = cannotMorning(m, dateStr);
            const eCant = cannotEvening(e, dateStr);

            let morning = mCant ? e : m;
            let evening = eCant ? m : e;

            if (morning === evening) {
              if (mCant && !cannotEvening(m, dateStr)) {
                evening = m;
              } else if (eCant && !cannotMorning(e, dateStr)) {
                morning = e;
              }
            }

            schedule.push({ day: days[i], date: dateStr, morning, evening, dept });
          }
        }
      }


      // ✅ NEW: במחלקה של 2 עובדים - בשבוע הבא העובד השני יפתח את השבוע
      if (!isThreeEmp && weekdayStartEmp && !isStockroomDept) {
        const a = emps[0], b = emps[1];
        weekdayStartHistory[dept] = (weekdayStartEmp === a) ? b : a;
      }

      // שישי ושבת - רוטציה עם שמירה ב-Firebase
      const fri = new Date(nextSunday); fri.setDate(nextSunday.getDate() + 5);
      const friStr = toLocalDateStr(fri);
      const sat = new Date(nextSunday); sat.setDate(nextSunday.getDate() + 6);
      const satStr = toLocalDateStr(sat);

      // מחלקת מחסנאים: שישי קבוע אבי, מוצ"ש קבוע מוחמד. אם אחד בחופש מאושר – השני מחליף. אין שמירת היסטוריה.
      if (isStockroomDept) {
        const a = 'AVI', b = 'MOHAMAD';
        const aFriOff = isDayOffApproved(a, friStr);
        const bFriOff = isDayOffApproved(b, friStr);
        const aSatOff = isDayOffApproved(a, satStr);
        const bSatOff = isDayOffApproved(b, satStr);

        // חשוב: בשאר הקוד friday הוא "עובד אחד" (מחרוזת) ולא מערך.
        // לכן נשמור עקביות כדי שהתצוגה/ייצוא לא ייפגעו.
        const friWorking = (aFriOff && bFriOff) ? null : (aFriOff ? b : a);
        const satWorking = (aSatOff && bSatOff) ? null : (bSatOff ? a : b);

        schedule.push({ day:'שישי', date: friStr, friday: friWorking, dept });
        schedule.push({ day:'מוצ"ש', date: satStr, saturday: satWorking, dept });
      } else if (isServiceRepsTwoDept) {
        // נציגות שירות במצב 2 עובדים: ליאור קבוע בשישי, אמאני קבוע במוצ"ש.
        // אם העובד הקבוע בחופש מאושר – השני מחליף. אם שניהם בחופש – null.
        const lior = 'LIOR', amani = 'AMANI';
        const liorFriOff = isDayOffApproved(lior, friStr);
        const amaniFriOff = isDayOffApproved(amani, friStr);
        const liorSatOff = isDayOffApproved(lior, satStr);
        const amaniSatOff = isDayOffApproved(amani, satStr);

        const friWorking = (liorFriOff && amaniFriOff) ? null : (liorFriOff ? amani : lior);
        const satWorking = (liorSatOff && amaniSatOff) ? null : (amaniSatOff ? lior : amani);

        schedule.push({ day:'שישי', date: friStr, friday: friWorking, dept });
        schedule.push({ day:'מוצ"ש', date: satStr, saturday: satWorking, dept });
      } else if (isThreeEmp) {
        const friOff = emps.find(emp => isDayOffApproved(emp, friStr));
        const satOff = emps.find(emp => isDayOffApproved(emp, satStr));
        
        let satWorking = null;

        if (satOff) {
          // יש עובד בחופש בשבת
          const available = emps.filter(e => e !== satOff);
          
          // בדיקה אם מי שעבד בפעם הקודמת זמין
          const lastSatEmp = saturdayHistory[dept];
          if (lastSatEmp && available.includes(lastSatEmp)) {
            // העובד הקודם זמין - בוחר את השני
            const nextIndex = (available.indexOf(lastSatEmp) + 1) % available.length;
            satWorking = available[nextIndex];
          } else {
            // העובד הקודם לא זמין - בוחר רנדומלית
            satWorking = available[Math.floor(Math.random() * available.length)];
          }
        } else {
          // אין חופש - רוטציה רגילה
          const lastSatEmp = saturdayHistory[dept];
          
          if (lastSatEmp && emps.includes(lastSatEmp)) {
            // יש היסטוריה - בוחר את הבא בתור
            const currentIndex = emps.indexOf(lastSatEmp);
            const nextIndex = (currentIndex + 1) % emps.length;
            satWorking = emps[nextIndex];
          } else {
            // אין היסטוריה - סידור ראשון, בוחר רנדומלית
            satWorking = emps[Math.floor(Math.random() * emps.length)];
          }
        }

        // שמירת מי עבד במוצ"ש הפעם
        saturdayHistory[dept] = satWorking;

        // שישי - מי שלא עובד בשבת
        let friWorking;
        if (friOff) {
          // יש חופש בשישי - השניים האחרים
          friWorking = emps.filter(x => x !== friOff);
        } else {
          // אין חופש - מי שלא עובד בשבת
          friWorking = emps.filter(e => e !== satWorking);
        }

        schedule.push({ day:'שישי', date: friStr, friday: friWorking, dept });
        schedule.push({ day:'מוצ"ש', date: satStr, saturday: satWorking, dept });
        
      } else {
        // 2 עובדים - רוטציה כמו 3 עובדים!
        const a = emps[0], b = emps[1];
        const friOff = emps.find(emp => isDayOffApproved(emp, friStr));
        const satOff = emps.find(emp => isDayOffApproved(emp, satStr));
        
        let satWorking = null;

        if (satOff) {
          // יש חופש בשבת - השני עובד
          satWorking = satOff === a ? b : a;
        } else {
          // אין חופש - רוטציה לפי היסטוריה
          const lastSatEmp = saturdayHistory[dept];
          
          if (lastSatEmp && emps.includes(lastSatEmp)) {
            // יש היסטוריה - בוחר את השני
            satWorking = lastSatEmp === a ? b : a;
          } else {
            // אין היסטוריה - סידור ראשון, בוחר רנדומלית
            satWorking = Math.random() < 0.5 ? a : b;
          }
        }

        // שמירת מי עבד במוצ"ש הפעם
        saturdayHistory[dept] = satWorking;

        // שישי - מי שלא עובד בשבת
        let friWorking;
        if (friOff) {
          // יש חופש בשישי - השני עובד
          friWorking = friOff === a ? b : a;
        } else {
          // אין חופש - מי שלא עובד בשבת
          friWorking = satWorking === a ? b : a;
        }

        schedule.push({ day:'שישי', date: friStr, friday: friWorking, dept });
        schedule.push({ day:'מוצ"ש', date: satStr, saturday: satWorking, dept });
      }

      allSchedules[dept] = schedule;
    }

    // שמירת היסטוריית מוצ"ש ב-Firebase
    // ניקוי ערכים undefined לפני כתיבה ל-Firebase (Firebase לא מקבל undefined)
    Object.keys(saturdayHistory).forEach(k => {
      if (saturdayHistory[k] === undefined) delete saturdayHistory[k];
    });

    await __ref('saturdayHistory').set(saturdayHistory);

    // ✅ Save weekday start history (2-employee departments)
    // ניקוי ערכים undefined לפני כתיבה ל-Firebase
    Object.keys(weekdayStartHistory).forEach(k => {
      if (weekdayStartHistory[k] === undefined) delete weekdayStartHistory[k];
    });

    await __ref('weekdayStartHistory').set(weekdayStartHistory);

    return allSchedules;
  }

  function displaySchedule(allSchedules) {
    const deptOrder = Object.keys(DEPARTMENTS);
    const sampleDept = deptOrder.find(d => allSchedules[d] && allSchedules[d].length) || deptOrder[0];
    const sampleSchedule = allSchedules[sampleDept] || [];
    if (sampleSchedule.length === 0) { document.getElementById('schedule-result').innerHTML = ''; return; }

    const dayCols = sampleSchedule.map(d => ({ day: d.day, date: d.date }));
    const totalCols = dayCols.length + 1;

    let html = `
      <h2 style="color:#667eea; margin-top:30px;">📅 סידור שבועי - כל הסניף</h2>
      <div style="background:#f8f9fa; padding:20px; border-radius:12px; margin-bottom:20px;">
        <table class="schedule-table">
          <tr>
            <th>עובד</th>`;

    dayCols.forEach(c => { html += `<th>${c.day}<br>${formatDate(c.date)}</th>`; });
    html += `</tr>`;

    deptOrder.forEach(dept => {
      const employees = getDeptEmployees(dept);
      const deptSchedule = allSchedules[dept] || [];

      html += `<tr class="dept-divider"><td colspan="${totalCols}">🏢 ${dept}</td></tr>`;

      employees.forEach(emp => {
        html += `<tr>
          <td style="background:#667eea; color:white; font-weight:bold;">${DISPLAY_NAMES[emp] || emp}</td>`;

        dayCols.forEach(c => {
          const day = deptSchedule.find(d => d.date === c.date);
          if (!day) { html += `<td style="background:#f0f0f0;">-</td>`; return; }

          const isThreeEmp = employees.length === 3;
          const isKavLavan = dept === 'מחלקת קו לבן';

          if (day.friday) {
            if (isThreeEmp) {
              const works = Array.isArray(day.friday) && day.friday.includes(emp);
              html += works
                ? (isKavLavan ? `<td><span class="shift-friday">עובד בשישי</span></td>` : `<td><span class="shift-friday">שישי<br>8:30-14:30</span></td>`)
                : `<td style="background:#f0f0f0;">-</td>`;
            } else {
              html += (day.friday === emp) ? `<td><span class="shift-friday">בוקר<br>8:30-14:30</span></td>` : `<td style="background:#f0f0f0;">-</td>`;
            }
            return;
          }

          if (day.saturday) {
            if (isThreeEmp) {
              html += (day.saturday === emp)
                ? (isKavLavan ? `<td><span class="shift-saturday">עובד במוצ"ש</span></td>` : `<td><span class="shift-saturday">מוצ"ש<br>מוצ"ש-22:30</span></td>`)
                : `<td style="background:#f0f0f0;">-</td>`;
            } else {
              html += (day.saturday === emp) ? `<td><span class="shift-saturday">ערב<br>מוצ"ש-22:30</span></td>` : `<td style="background:#f0f0f0;">-</td>`;
            }
            return;
          }

          const shifts = [];
          const isService = dept === 'נציגות שירות';
          const isTwoEmpKavLavan = (dept === 'מחלקת קו לבן') && (employees.length === 2);
          const isWarehouse = dept === 'מחלקת מחסנאים';

          if (day.morning === emp) shifts.push(
            isService ? '<span class="shift-morning">בוקר<br>9:00-17:00</span>'
            : (isTwoEmpKavLavan ? '<span class="shift-morning">בוקר<br>9:00-19:00</span>' : (isKavLavan ? '<span class=\"shift-morning\">בוקר</span>' : (isWarehouse ? '<span class=\"shift-morning\">בוקר<br>9:00-17:00</span>' : '<span class=\"shift-morning\">בוקר<br>9:00-16:00</span>')))
          );
          if (day.middle === emp) shifts.push(
            isService ? '<span class="shift-middle">אמצע<br>11:00-19:00</span>'
            : (isKavLavan ? '<span class="shift-middle">אמצע</span>' : '<span class="shift-middle">אמצע<br>11:00-19:00</span>')
          );
          if (day.evening === emp) shifts.push(
            isService ? '<span class="shift-evening">ערב<br>13:00-21:30</span>'
            : (isTwoEmpKavLavan ? '<span class="shift-evening">ערב<br>11:00-21:30</span>' : (isKavLavan ? '<span class=\"shift-evening\">ערב</span>' : (isWarehouse ? '<span class=\"shift-evening\">ערב<br>13:30-21:30</span>' : '<span class=\"shift-evening\">ערב<br>15:00-21:30</span>')))
          );
if (shifts.length >= 2) {
            html += `<td><span class="shift-double">כפולה</span></td>`;
          } else {
            html += shifts.length ? `<td>${shifts.join('<br>')}</td>` : `<td style="background:#f0f0f0;">-</td>`;
          }
        });

        html += `</tr>`;
      });
    });

    html += `</table></div>`;
    document.getElementById('schedule-result').innerHTML = html;
  }

  function exportToHTML() {
  try {
    if (!currentSchedule) {
      showMessage('אין סידור לייצא! יש ליצור סידור תחילה.', 'error');
      return;
    }

    // ודא שיש טבלה על המסך כדי לייצא בדיוק "כמו באתר"
    let table = document.querySelector('#schedule-result table.schedule-table');
    if (!table) {
      try { displaySchedule(currentSchedule); } catch(e) {}
      table = document.querySelector('#schedule-result table.schedule-table');
    }
    if (!table) {
      showMessage('לא נמצאה טבלת סידור לייצוא. נסה ליצור/לרענן סידור ואז לייצא.', 'error');
      return;
    }

    // קח את ה-CSS של המערכת (כדי לשמור עיצוב זהה)
    const styleTag = document.querySelector('head style');
    const css = styleTag ? styleTag.textContent : '';

    // שכפול הטבלה בדיוק כפי שמופיעה (כולל מחלקות / צבעים / <br>)
    const tableHtml = table.outerHTML;

    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>סידור עבודה שבועי</title>
  <style>
${css}
  /* התאמות קטנות למסמך המיוצא בלבד */
  body{ background:#f5f5f5 !important; padding:20px !important; }
  .container{ max-width:1200px !important; }
  </style>
</head>
<body>
  <div class="container">
    <h1 style="text-align:center; color:#667eea; margin-bottom:20px;">סידור עבודה שבועי</h1>
    <div style="background:white; padding:20px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.15); overflow:auto;">
      ${tableHtml}
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date();
    a.download = `סידור_${today.getDate()}-${today.getMonth()+1}-${today.getFullYear()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showMessage('הקובץ יוצא בהצלחה! ✅', 'success');
  } catch (e) {
    console.error('exportToHTML error:', e);
    showMessage('❌ שגיאה בייצוא ל-HTML', 'error');
  }
}

  function exportToExcel() {
  // ✅ Ensure XLSX library is loaded (prevents "XLSX is not defined")
  if (typeof window.XLSX === 'undefined') {
    if (!window.__xlsxLoading) {
      window.__xlsxLoading = true;
      const s = document.createElement('script');
      s.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.full.min.js";
      s.onload = () => {
        window.__xlsxLoading = false;
        exportToExcel(); // retry after load
      };
      s.onerror = () => {
        window.__xlsxLoading = false;
        console.error("Failed to load XLSX library from CDN");
        showMessage('❌ לא הצלחתי לטעון את ספריית האקסל. בדוק חיבור אינטרנט/חסימה של רשת.', 'error');
      };
      document.head.appendChild(s);
    }
    showMessage('טוען ספריית אקסל… נסה שוב בעוד שנייה', 'info');
    return;
  }

  try {
    if (!currentSchedule) {
      showMessage('אין סידור לייצא! יש ליצור סידור תחילה.', 'error');
      return;
    }

    // ודא שהטבלה מוצגת – כדי לייצא "בדיוק כמו באתר"
    let table = document.querySelector('#schedule-result table.schedule-table');
    if (!table) {
      try { displaySchedule(currentSchedule); } catch(e) {}
      table = document.querySelector('#schedule-result table.schedule-table');
    }
    if (!table) {
      showMessage('לא נמצאה טבלת סידור לייצוא. נסה ליצור/לרענן סידור ואז לייצא.', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();

    // קורא את הטבלה מה-DOM כדי לקבל מלל/שעות בדיוק כמו שמופיע במסך
    const rows = Array.from(table.querySelectorAll('tr'));

    // ספירת עמודות לפי שורת כותרת
    const headerCells = Array.from(rows[0].querySelectorAll('th,td'));
    const colCount = headerCells.length;

    const aoa = [];
    const classMap = []; // שומר class לכל תא לצביעה

    rows.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('th,td'));
      const rowVals = new Array(colCount).fill('');
      const rowCls  = new Array(colCount).fill('');

      // טיפול בשורות עם colspan (למשל כותרת מחלקה)
      if (cells.length === 1 && (cells[0].getAttribute('colspan') || '').toString() !== '') {
        const text = (cells[0].innerText || '').trim();
        rowVals[0] = text;
        rowCls[0]  = (cells[0].className || 'dept-divider').toString();
      } else {
        for (let c = 0; c < Math.min(cells.length, colCount); c++) {
          const cell = cells[c];

          // innerText שומר שורות (במקום <br>) – מצוין ל-Wrap באקסל
          let text = (cell.innerText || '').replace(/\u00A0/g, ' ').trim();
          if (!text) text = '-';
          rowVals[c] = text;

          // שמירת class (לתאי משמרות לפעמים ה-class על span פנימי)
          let cls = (cell.className || '').toString().trim();
          if (!cls) {
            const span = cell.querySelector('span');
            if (span && span.className) cls = span.className.toString().trim();
          }
          rowCls[c] = cls;
        }

        // ריפוד אם חסר
        for (let c = cells.length; c < colCount; c++) {
          rowVals[c] = ' ';
          rowCls[c] = '';
        }
      }

      aoa.push(rowVals);
      classMap.push(rowCls);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // עיצוב בסיסי (גבולות/יישור/Wrap)
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!cols'] = new Array(colCount).fill({ wch: 10 });
    ws['!rows'] = new Array(aoa.length).fill({ hpt: 30 });

    const border = {
      top:    { style: "thin", color: { rgb: "000000" } },
      bottom: { style: "thin", color: { rgb: "000000" } },
      left:   { style: "thin", color: { rgb: "000000" } },
      right:  { style: "thin", color: { rgb: "000000" } }
    };

    // ✅ זיהוי שורות מחלקה (colspan) – כדי לצבוע את כל התאים בשורה בכחול
    const deptRows = new Set();
    rows.forEach((tr, idx) => {
      const cells = Array.from(tr.querySelectorAll('th,td'));
      if (cells.length === 1 && (cells[0].getAttribute('colspan') || '').toString() !== '') {
        deptRows.add(idx);
      }
    });

    // ✅ זיהוי תאי שמות עובדים – בודק אם ב-DOM יש לתא רקע כחול (style inline) או class מיוחד
    const empNameCells = new Set();
    rows.forEach((tr, idx) => {
      if (idx === 0 || deptRows.has(idx)) return;
      const cells = Array.from(tr.querySelectorAll('th,td'));
      if (cells.length > 0) {
        const firstCell = cells[0];
        const bg = (firstCell.style.background || firstCell.style.backgroundColor || '').toLowerCase();
        // זיהוי רקע כחול באינליין או font-weight bold + color white
        if (bg.includes('667eea') || bg.includes('rgb(102, 126, 234)') || bg.includes('#667eea')) {
          empNameCells.add(idx);
        }
        // גם אם אין inline style, בדיקת className
        const cls = (firstCell.className || '').toString();
        if (cls.includes('emp-name') || cls.includes('employee-name')) {
          empNameCells.add(idx);
        }
      }
    });

    const fillByClass = (cls, value) => {
      const c = (cls || '').toLowerCase();
      if (c.includes('dept-divider')) return '667EEA';
      if (c.includes('shift-double') || value === 'כפולה') return 'F8CBAD';
      if (c.includes('shift-morning') || value.includes('בוקר')) return 'FFF3CD';
      if (c.includes('shift-middle') || value.includes('אמצע')) return 'FFD4A3';
      if (c.includes('shift-evening') || (value.includes('ערב') && !value.includes('שישי') && !value.includes('מוצ'))) return 'D1ECF1';
      if (c.includes('shift-friday') || value.includes('שישי')) return 'D4EDDA';
      if (c.includes('shift-saturday') || value.includes('מוצ')) return 'E7D4F5';
      if (value.trim() === '-' ) return 'F0F0F0';
      return null;
    };

    // ✅ בניית סט שמות עובדים לזיהוי עמודה ראשונה
    const allEmpDisplayNames = new Set(Object.values(DISPLAY_NAMES));

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) {
          // ✅ יצירת תא ריק עבור שורות מחלקה כדי שכל השורה תהיה כחולה
          if (deptRows.has(r)) {
            ws[addr] = { v: '', t: 's', s: {} };
          } else {
            continue;
          }
        }

        const value = (ws[addr].v || '').toString();
        const cls = (classMap[r] && classMap[r][c]) ? classMap[r][c] : '';

        const isHeaderRow = (r === 0);
        const isDeptRow = deptRows.has(r);
        const isFirstCol = (c === 0);

        ws[addr].s = ws[addr].s || {};
        ws[addr].s.border = border;
        ws[addr].s.alignment = { vertical: "center", horizontal: "center", wrapText: true };

        // ✅ שורת כותרת (ימים)
        if (isHeaderRow) {
          ws[addr].s.fill = { fgColor: { rgb: "667EEA" } };
          ws[addr].s.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 12 };
        }
        // ✅ שורת מחלקה – כל התאים בשורה כחולים עם טקסט לבן
        else if (isDeptRow) {
          ws[addr].s.fill = { fgColor: { rgb: "667EEA" } };
          ws[addr].s.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 13 };
          ws[addr].s.border = {
            top:    { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left:   { style: "thin", color: { rgb: "000000" } },
            right:  { style: "thin", color: { rgb: "000000" } }
          };
        }
        // ✅ עמודת שם עובד – רקע כחול + טקסט לבן (כמו באתר)
        else if (isFirstCol && !isHeaderRow && !isDeptRow) {
          const cellVal = value.trim();
          if (cellVal && cellVal !== '-' && (allEmpDisplayNames.has(cellVal) || empNameCells.has(r))) {
            ws[addr].s.fill = { fgColor: { rgb: "667EEA" } };
            ws[addr].s.font = { bold: true, color: { rgb: "FFFFFF" }, sz: 12 };
          } else {
            ws[addr].s.font = { bold: true };
          }
        }

        // ✅ צבעי משמרות
        if (!isHeaderRow && !isDeptRow && !(isFirstCol && allEmpDisplayNames.has(value.trim()))) {
          const fill = fillByClass(cls, value);
          if (fill) {
            ws[addr].s.fill = { fgColor: { rgb: fill } };
            if (fill === '667EEA') {
              ws[addr].s.font = { bold: true, color: { rgb: "FFFFFF" } };
            } else if (fill === 'F8CBAD') {
              ws[addr].s.font = { bold: true, color: { rgb: "8B4513" } };
            } else if (fill === 'F0F0F0') {
              ws[addr].s.font = { color: { rgb: "999999" } };
            }
          }
        }
      }
    }

    // ✅ מיזוג תאים בשורות מחלקה כדי שהטקסט יהיה ממורכז על כל הרוחב (כמו באתר)
    if (!ws['!merges']) ws['!merges'] = [];
    deptRows.forEach(r => {
      ws['!merges'].push({
        s: { r: r, c: 0 },
        e: { r: r, c: colCount - 1 }
      });
    });

    XLSX.utils.book_append_sheet(wb, ws, 'סידור שבועי');

    // ✅ RTL לכל הקובץ (הגיליון ייפתח מימין לשמאל)
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Views = [{ RTL: true }];

    const today = new Date();
    const filename = `סידור_${today.getDate()}-${today.getMonth()+1}-${today.getFullYear()}.xlsx`;
    XLSX.writeFile(wb, filename);

    showMessage('קובץ Excel יוצא בהצלחה! ✅', 'success');
  } catch (e) {
    console.error('exportToExcel error:', e);
    showMessage('❌ שגיאה בייצוא לאקסל', 'error');
  }
}

  // Helpers
  function hideAll() {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('message').innerHTML = '';
  }
  function clearInputs() {
    document.getElementById('emp-username').value = '';
    document.getElementById('emp-password').value = '';
    document.getElementById('mgr-username').value = '';
    document.getElementById('mgr-password').value = '';
  }
  function showMessage(text, type) {
    const div = document.getElementById('message');
    div.className = `message ${type}`;
    div.textContent = text;
    setTimeout(() => div.innerHTML = '', 8000);
  }
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function toLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function formatType(type) {
    const types = {
      'no-morning':'❌ לא בוקר',
      'no-evening':'❌ לא ערב',
      'want-morning':'✅ רוצה בוקר',
      'want-middle':'✅ רוצה אמצע',
      'want-evening':'✅ רוצה ערב',
      'day-off':'🏖️ חופש מלא'
    };
    return types[type] || type;
  }

  function isValidWeekday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    return day !== 5 && day !== 6;
  }
  function getStatusBadge(c) {
    if (c.type !== 'day-off') return '';
    const statuses = { 'pending':'⏳ ממתין', 'approved':'✅ מאושר', 'rejected':'❌ נדחה' };
    const classes  = { 'pending':'status-pending', 'approved':'status-approved', 'rejected':'status-rejected' };
    const status = c.status || 'pending';
    return `<span class="${classes[status]}">${statuses[status]}</span>`;
  }


// ========================================
// 📊 NOTIFICATION HISTORY TRACKING
// ========================================

/**
 * Listen for notification clicks from Service Worker
 */
navigator.serviceWorker.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'NOTIFICATION_CLICKED') {
    const notificationId = event.data.notificationId;
    const clickedAt = event.data.clickedAt;
    
    if (currentEmployee && notificationId) {
      try {
        await db.ref(`notificationHistory/${notificationId}/clickedBy/${currentEmployee}`).set({
          clickedAt: clickedAt,
          device: navigator.userAgent,
        });
        console.log('✅ Recorded notification click:', currentEmployee, notificationId);
      } catch (e) {
        console.error('Failed to record click:', e);
      }
    }
  }
});

/**
 * Show notification history screen
 */
function showNotificationHistory() {
  hideAll();
  document.getElementById('notification-history-section').classList.add('active');
  loadEmployeeTokenStatus();
  loadNotificationHistory();
}

/**
 * Back to manager panel
 */
function backToManager() {
  hideAll();
  document.getElementById('manager-section').classList.add('active');
}


// =======================
// ✍️ MANUAL CONSTRAINTS (MANAGER)
// =======================
function openManualConstraints(){
  hideAll();
  document.getElementById('manual-constraints-section').classList.add('active');
  populateManualEmployeeList();
  document.getElementById('mc-preview').innerHTML = '';
  // Initialize selects with default options (2-emp style) until employee chosen
  setManualConstraintOptions(null);
}

function backToManagerFromManualConstraints(){
  hideAll();
  document.getElementById('manager-section').classList.add('active');
}

// Builds employee list dynamically (respects SHIROT/ELIYA toggles)
function populateManualEmployeeList(){
  const sel = document.getElementById('mc-employee');
  if(!sel) return;

  const seen = new Set();
  const emps = [];
  for (const dept of Object.keys(DEPARTMENTS)) {
    const list = getDeptEmployees(dept);
    list.forEach(e => {
      if(!seen.has(e)) { seen.add(e); emps.push(e); }
    });
  }

  // Sort by display name (Hebrew), fallback to key
  emps.sort((a,b)=>{
    const da = DISPLAY_NAMES[a] || a;
    const dbn = DISPLAY_NAMES[b] || b;
    return da.localeCompare(dbn, 'he');
  });

  const current = sel.value;
  sel.innerHTML = `<option value="">-- בחר עובד --</option>` + emps
    .map(e => `<option value="${e}">${DISPLAY_NAMES[e] || e}</option>`).join('');
  if (current && emps.includes(current)) sel.value = current;
}

function loadManualConstraintsForSelected(){
  const emp = document.getElementById('mc-employee')?.value || '';
  if(!emp){
    document.getElementById('mc-c1-date').value = '';
    document.getElementById('mc-c2-date').value = '';
    setManualConstraintOptions(null);
    document.getElementById('mc-preview').innerHTML = '';
    return;
  }
  setManualConstraintOptions(emp);
  loadManualConstraintsForEmp(emp);
}

// Set options based on employee dept size rules (same as employee page)
function setManualConstraintOptions(emp){
  const options = emp ? buildConstraintOptionsForEmp(emp) : [
    { value: "", label: "-- בחר --" },
    { value: "no-morning", label: "❌ לא בוקר" },
    { value: "no-evening", label: "❌ לא ערב" },
    { value: "day-off",    label: "🏖️ חופש מלא" }
  ];

  ["mc-c1-type","mc-c2-type"].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const cur = sel.value;
    sel.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    if (options.some(o => o.value === cur)) sel.value = cur;
  });
}

async function loadManualConstraintsForEmp(emp){
  try{
    const snapshot = await constraintsRef(emp).once('value');
    const data = snapshot.val() || {};

    document.getElementById('mc-c1-date').value = data.c1?.date || '';
    document.getElementById('mc-c1-type').value = data.c1?.type || '';

    document.getElementById('mc-c2-date').value = data.c2?.date || '';
    document.getElementById('mc-c2-type').value = data.c2?.type || '';

    displayManualPreview(emp, data);
  } catch(e){
    console.error('loadManualConstraintsForEmp error', e);
    showMessage('❌ שגיאה בטעינת האילוצים', 'error');
  }
}

// Manager saves directly. Day-off is saved as APPROVED with approvedAt/approvedBy so scheduling uses it immediately.
async function saveManualConstraints(){
  const emp = document.getElementById('mc-employee')?.value || '';
  if(!emp) return showMessage('אנא בחר עובד', 'error');

  const c1Date = document.getElementById('mc-c1-date').value;
  const c1Type = document.getElementById('mc-c1-type').value;
  const c2Date = document.getElementById('mc-c2-date').value;
  const c2Type = document.getElementById('mc-c2-type').value;

  if (c1Date && !isValidWeekday(c1Date)) return showMessage('❌ לא ניתן לבחור שישי או שבת', 'error');
  if (c2Date && !isValidWeekday(c2Date)) return showMessage('❌ לא ניתן לבחור שישי או שבת', 'error');

  const build = (date, type) => {
    if (!date || !type) return null;
    if (type === 'day-off') {
      return {
        date,
        type,
        status: 'approved',
        approvedAt: firebase.database.ServerValue.TIMESTAMP,
        approvedBy: MANAGER.username
      };
    }
    return { date, type, status: 'approved' };
  };

  const out = {};
  const c1 = build(c1Date, c1Type);
  const c2 = build(c2Date, c2Type);
  if (c1) out.c1 = c1;
  if (c2) out.c2 = c2;

  try{
    await constraintsRef(emp).set(Object.keys(out).length ? out : null);

    showMessage('✅ נשמר בהצלחה (מנהל)', 'success');

    // Refresh manager constraints list + preview
    try { await loadAllConstraints(); } catch(e) {}
    await loadManualConstraintsForEmp(emp);

    // Reset current schedule view (because constraints changed)
    currentSchedule = null;
    document.getElementById('schedule-result').innerHTML = '';
    document.getElementById('export-section').style.display = 'none';
    setApproveButtonVisible(false);

  } catch(e){
    console.error('saveManualConstraints error', e);
    showMessage('❌ שגיאה בשמירה', 'error');
  }
}

function displayManualPreview(emp, data){
  const today = new Date(); today.setHours(0,0,0,0);
  let html = `<h3 style="color:#667eea;">אילוצים עבור ${DISPLAY_NAMES[emp] || emp}:</h3>`;
  let hasValid = false;

  const addLine = (label, c) => {
    if(!c) return;
    if (new Date(c.date + 'T00:00:00') < today) return;
    html += `<div class="constraint-card"><strong>${label}:</strong> ${formatDate(c.date)} - ${formatType(c.type)} ${getStatusBadge(c)}</div>`;
    hasValid = true;
  };

  addLine('אילוץ 1', data.c1);
  addLine('אילוץ 2', data.c2);

  if(!hasValid) html += '<p style="color:#28a745;">אין אילוצים עתידיים</p>';

  const el = document.getElementById('mc-preview');
  if(el) el.innerHTML = html;
}


/**
 * Load employee token status
 */
async function loadEmployeeTokenStatus() {
  try {
    const snapshot = await db.ref('pushTokens').once('value');
    const tokensData = snapshot.val() || {};
    
    let html = '';
    
    const allEmployees = Object.keys(BRANCH_EMPLOYEES);
    
    allEmployees.forEach(emp => {
      const hasToken = tokensData[emp] && typeof tokensData[emp] === 'object';
      const tokenCount = hasToken ? Object.keys(tokensData[emp]).length : 0;
      
      let lastUpdate = '';
      if (hasToken) {
        const tokens = Object.values(tokensData[emp]);
        const latestToken = tokens.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (latestToken && latestToken.updatedAt) {
          const date = new Date(latestToken.updatedAt);
          lastUpdate = formatDateTime(date);
        }
      }
      
      const cardClass = hasToken ? 'status-card' : 'status-card no-token';
      const statusIcon = hasToken ? '✅' : '❌';
      const statusText = hasToken ? `${tokenCount} מכשירים` : 'אין Token';
      
      html += `
        <div class="${cardClass}">
          <div>
            <div class="name">${statusIcon} ${DISPLAY_NAMES[emp] || emp}</div>
            <div class="info">${statusText}${lastUpdate ? ' • ' + lastUpdate : ''}</div>
          </div>
          ${!hasToken ? '<span class="badge danger">לא נרשם</span>' : ''}
        </div>
      `;
    });
    
    document.getElementById('employee-status-list').innerHTML = html;
  } catch (e) {
    console.error('Error loading employee status:', e);
    document.getElementById('employee-status-list').innerHTML = '<p style="color:#dc3545;">שגיאה בטעינת סטטוס עובדים</p>';
  }
}

/**
 * Load notification history
 */
async function loadNotificationHistory() {
  try {
    showMessage('טוען היסטוריה...', 'info');
    
    const snapshot = await __ref('notificationHistory').orderByChild('sentAt').limitToLast(10).once('value');
    const historyData = snapshot.val();
    
    if (!historyData) {
      document.getElementById('notification-history-list').innerHTML = '<p style="text-align:center; color:#999;">אין היסטוריה עדיין. שלח תזכורת ראשונה!</p>';
      showMessage('', '');
      return;
    }
    
    const historyArray = Object.entries(historyData).map(([id, data]) => ({
      id,
      ...data
    })).sort((a, b) => b.sentAt - a.sentAt);
    
    let html = '';
    
    historyArray.forEach(notification => {
      const sentDate = new Date(notification.sentAt);
      const recipients = notification.recipients || {};
      const clickedBy = notification.clickedBy || {};
      
      const totalSent = notification.successCount || 0;
      const totalFailed = notification.failureCount || 0;
      const totalClicked = Object.keys(clickedBy).length;
      
      html += `
        <div class="history-card">
          <div class="header">
            <div class="title">📬 ${notification.title || 'תזכורת'}</div>
            <div class="timestamp">${formatDateTime(sentDate)}</div>
          </div>
          
          <div class="stats">
            <div class="stat total">📊 ${notification.totalDevices || 0} מכשירים</div>
            <div class="stat success">✅ ${totalSent} הצליחו</div>
            <div class="stat failed">❌ ${totalFailed} נכשלו</div>
            <span class="badge info">👆 ${totalClicked} לחצו</span>
          </div>
          
          <div class="recipient-list">
            <h4 style="margin-bottom:10px; color:#667eea;">פירוט לפי עובד:</h4>
      `;
      
      Object.entries(recipients).forEach(([empName, data]) => {
        const sent = data.sent || 0;
        const failed = data.failed || 0;
        const clicked = clickedBy[empName] ? true : false;
        
        let statusHtml = '';
        if (clicked) {
          const clickTime = new Date(clickedBy[empName].clickedAt);
          statusHtml = `<span class="status clicked">👆 לחץ ${formatTime(clickTime)}</span>`;
        } else if (sent > 0) {
          statusHtml = `<span class="status sent">✅ נשלח (${sent})</span>`;
        } else if (failed > 0) {
          statusHtml = `<span class="status failed">❌ נכשל</span>`;
        }
        
        html += `
          <div class="recipient-item">
            <div class="name">${DISPLAY_NAMES[empName] || empName}</div>
            <div>${statusHtml}</div>
          </div>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
    });
    
    document.getElementById('notification-history-list').innerHTML = html;
    showMessage('', '');
  } catch (e) {
    console.error('Error loading notification history:', e);
    document.getElementById('notification-history-list').innerHTML = '<p style="color:#dc3545;">שגיאה בטעינת היסטוריה</p>';
    showMessage('שגיאה בטעינת היסטוריה', 'error');
  }
}

/**
 * Format date and time
 */
function formatDateTime(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Format time only
 */
function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js");
    });
  }
    // =======================
// 🔁 Restore login after refresh
// =======================
document.addEventListener('DOMContentLoaded', () => {
  // ✅ If we just finished branch setup, continue to the branch manager portal
  try {
   if (localStorage.getItem('afterBranchSetup') === '1') {
  localStorage.removeItem('afterBranchSetup');

  // אם כבר יש “סשן מקומי” של מנהל – נכנסים ישר למסך מנהל
  const saved = localStorage.getItem('currentEmployee');
  if (saved === 'MANAGER') {
    hideAll();
    document.getElementById('manager-section').classList.add('active');
    initShirotToggleUI();
    initEliyaToggleUI();
    loadAllConstraints();
    initPushNotifications();
    return;
  }

  // ואם יש Firebase session פעיל – גם נכנסים כמנהל
  if (window.auth && auth.currentUser) {
    localStorage.setItem('currentEmployee', 'MANAGER');
    currentEmployee = 'MANAGER';
    hideAll();
    document.getElementById('manager-section').classList.add('active');
    initShirotToggleUI();
    initEliyaToggleUI();
    loadAllConstraints();
    initPushNotifications();
    return;
  }

  // אחרת – פותחים כניסת מנהל
  showLoginForm('manager');
  return;
}
  } catch(e) {}

  const saved = localStorage.getItem('currentEmployee');

  if (!saved) {
    backToLogin();
    return;
  }

  currentEmployee = saved;

  if (saved === 'MANAGER') {
    hideAll();
    document.getElementById('manager-section').classList.add('active');
    initShirotToggleUI();
      initEliyaToggleUI();
    loadAllConstraints();
  } else {
    hideAll();
    document.getElementById('employee-section').classList.add('active');
    document.getElementById('employee-welcome').textContent = `שלום ${DISPLAY_NAMES[saved] || saved}! 👋`;
    applyConstraintOptions(currentEmployee);
    loadEmployeeConstraints();
  }

  initPushNotifications();
});
