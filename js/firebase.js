// =========================
// Firebase Init
// =========================
const firebaseConfig = window.firebaseConfig;
if (!firebaseConfig) {
  throw new Error("firebaseConfig is not defined. Set window.firebaseConfig before loading firebase.js");
}
if (!firebase.apps || firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
const auth = firebase.auth();

// =========================
// GLOBAL BRANCH STATE
// =========================
let currentBranchId = null;    // auth.uid
let currentBranchKey = null;   // "HAIFA" or branch uid
let systemSubscription = null;
let isAdmin = false;


// =========================
// HAIFA LEGACY MODE (client flag)
// =========================
const HAIFA_LEGACY_FLAG_KEY = "haifaLegacy";
function isHaifaLegacyModeClient() {
  try { return localStorage.getItem(HAIFA_LEGACY_FLAG_KEY) === "1"; } catch (e) { return false; }
}
// =========================
// Helpers
// =========================
function isPermissionDenied(err) {
  return !!err && (
    err.code === "PERMISSION_DENIED" ||
    err.code === "permission_denied" ||
    String(err).includes("permission_denied")
  );
}

// =========================
// Ensure own branch (non-admin)
// =========================
async function ensureOwnBranchExists(uid) {
  const ref = db.ref(`branches/${uid}`);
  const snap = await ref.once("value");

  if (snap.exists()) {
    const data = snap.val() || {};
    currentBranchKey = uid;
    systemSubscription = data.subscription || null;
    return;
  }

  await ref.set({
    managerUid: uid,
    displayName: "×¡× ×™×£ ×—×“×©",
    createdAt: Date.now(),
    subscription: null,
    departments: {},
    employees: {}
  });

  currentBranchKey = uid;
  systemSubscription = null;
}

// =========================
// Legacy HAIFA resolver
// =========================
async function tryResolveLegacyHaifa(uid) {
  try {
    const snap = await db.ref("branches/HAIFA").once("value");
    if (!snap.exists()) return false;

    const data = snap.val() || {};
    if (data.managerUid === uid) {
      currentBranchKey = "HAIFA";
      systemSubscription = data.subscription || null;
      isAdmin = true;
      console.log("Resolved legacy HAIFA for manager:", uid);
      return true;
    }
  } catch (_) {}
  return false;
}

// =========================
// Load system subscription
// =========================
async function loadSystemSubscription() {
  const uid = currentBranchId;
  if (!uid) return;

  // 0) HAIFA legacy
  if (await tryResolveLegacyHaifa(uid)) {
    if (!currentBranchKey) currentBranchKey = "HAIFA";
    return;
  }

  // 1) Admin scan
  try {
    const snap = await db.ref("branches").once("value");
    isAdmin = true;

    let found = false;
    snap.forEach(branchSnap => {
      const data = branchSnap.val();
      if (data && data.managerUid === uid) {
        found = true;
        currentBranchKey = branchSnap.key;
        systemSubscription = data.subscription || null;
      }
    });

    if (!found) {
      currentBranchKey = uid;
      await ensureOwnBranchExists(uid);
    }

  } catch (e) {
    if (!isPermissionDenied(e)) {
      console.error("Unexpected branches read error:", e);
    }
    isAdmin = false;
    await ensureOwnBranchExists(uid);
  }

  // ðŸ”’ SAFETY NET â€“ never allow null
  if (!currentBranchKey) {
    currentBranchKey = uid;
  }
}

// =========================
// CONSTRAINTS PATH
// =========================
let constraintsBasePath = "constraints";

function getConstraintsPath() {
  return constraintsBasePath;
}

function constraintsRef(suffix = "") {
  return suffix
    ? db.ref(`${constraintsBasePath}/${suffix}`)
    : db.ref(constraintsBasePath);
}

async function resolveConstraintsBasePath() {
  const u = auth.currentUser;
  if (!u) {
    constraintsBasePath = "constraints";
    return;
  }

  const bk =
    (typeof window.getBranchKey === "function" && window.getBranchKey())
      ? window.getBranchKey()
      : null;

  // ðŸ”¥ HAIFA + admins ALWAYS root
  if (
    isAdmin ||
    !bk ||
    String(bk).toUpperCase() === "HAIFA"
  ) {
    constraintsBasePath = "constraints";
    console.log("Constraints path: /constraints");
    return;
  }

  constraintsBasePath = `branches/${bk}/constraints`;
  console.log("Constraints path:", constraintsBasePath);
}

// =========================
// AUTH STATE
// =========================
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    await auth.signInAnonymously();
    return;
  }

  currentBranchId = user.uid;
  console.log("AUTH UID:", currentBranchId);

  
  // ✅ If this browser/device is in HAIFA legacy mode, force legacy paths for EVERYONE (manager + employees)
  if (isHaifaLegacyModeClient()) {
    currentBranchKey = "HAIFA";
    isAdmin = true;
    constraintsBasePath = "constraints";
    console.log("HAIFA legacy mode enabled (client) -> forcing /constraints");
    return;
  }
await loadSystemSubscription();
  await resolveConstraintsBasePath();
});

// =========================
// EXPORTS
// =========================
window.db = db;
window.auth = auth;

window.loadSystemSubscription = loadSystemSubscription;
window.resolveConstraintsBasePath = resolveConstraintsBasePath;

window.getConstraintsPath = getConstraintsPath;
window.constraintsRef = constraintsRef;

window.isAdmin = () => isAdmin;
window.getBranchKey = () => currentBranchKey;

window.currentBranchId = () => currentBranchId;
window.currentBranchKey = () => currentBranchKey;
window.getSystemSubscription = () => systemSubscription;