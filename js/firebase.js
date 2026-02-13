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
let currentBranchId = null;   // manager UID (auth.uid)
let currentBranchKey = null;  // branch key (e.g. "HAIFA" or new UID)

// =========================
// SYSTEM SUBSCRIPTION (READ ONLY)
// =========================
let systemSubscription = null;
let isAdmin = false;

// =========================
// Helpers
// =========================
function isPermissionDenied(err) {
  return !!err && (err.code === "PERMISSION_DENIED" || err.code === "permission_denied" || String(err).includes("permission_denied"));
}

async function ensureOwnBranchExists(uid) {
  const ownBranchRef = db.ref(`branches/${uid}`);

  // Read is allowed for the owner (rules: auth.uid === $branchId)
  const snap = await ownBranchRef.once("value");
  if (snap.exists()) {
    const data = snap.val() || {};
    currentBranchKey = uid;
    systemSubscription = data.subscription || null;
    return true;
  }

  // Create (write is allowed for the owner)
  await ownBranchRef.set({
    managerUid: uid,
    displayName: "סניף חדש",   // מנהל ישנה אחר כך
    createdAt: Date.now(),
    subscription: null,
    departments: {},
    employees: {}
  });

  currentBranchKey = uid;
  systemSubscription = null;
  return true;
}

// =========================
// Load subscription by manager UID
// =========================
// Goal:
// - Admins (e.g. HAIFA legacy): can read /branches and match by managerUid
// - New/non-admin managers: cannot read /branches root -> work only with /branches/{auth.uid}
async function loadSystemSubscription() {
  const uid = currentBranchId;
  if (!uid) return;

  // 1) Try admin path: read all branches and resolve by managerUid
  try {
    const branchesSnap = await db.ref("branches").once("value");
    isAdmin = true;

    // If branches node doesn't exist at all -> create the manager's branch immediately
    if (!branchesSnap.exists()) {
      currentBranchKey = uid;
      const newBranchRef = db.ref(`branches/${currentBranchKey}`);
      await newBranchRef.set({
        managerUid: uid,
        displayName: "סניף חדש",
        createdAt: Date.now(),
        subscription: null,
        departments: {},
        employees: {}
      });
      systemSubscription = null;
      return;
    }

    let found = false;

    branchesSnap.forEach((branchSnap) => {
      const branchData = branchSnap.val();
      if (branchData && branchData.managerUid === uid) {
        found = true;
        currentBranchKey = branchSnap.key;
        systemSubscription = branchData.subscription || null;

        console.log("BRANCH KEY:", currentBranchKey);
        console.log("SYSTEM SUBSCRIPTION (branch:", currentBranchKey, "):", systemSubscription);
      }
    });

    // If admin didn't find a branch -> create a new UID-keyed branch
    if (!found) {
      currentBranchKey = uid;
      console.log("No branch found -> creating new branch with key:", currentBranchKey);

      const newBranchRef = db.ref(`branches/${currentBranchKey}`);
      const existsSnap = await newBranchRef.once("value");
      if (!existsSnap.exists()) {
        await newBranchRef.set({
          managerUid: uid,
          displayName: "סניף חדש",
          createdAt: Date.now(),
          subscription: null,
          departments: {},
          employees: {}
        });
      }

      systemSubscription = null;
      return;
    }

    return; // resolved via admin scan
  } catch (e) {
    // If we are not admin, reading /branches will fail with permission_denied.
    if (!isPermissionDenied(e)) {
      console.error("Failed to load system subscription (unexpected):", e);
    }
    isAdmin = false;
    // fall through to non-admin path
  }

  // 2) Non-admin path: ONLY touch /branches/{uid}
  try {
    await ensureOwnBranchExists(uid);
  } catch (e) {
    console.error("Failed to load/create own branch:", e);
  }
}

// =========================
// CONSTRAINTS PATH (branch-scoped with legacy fallback)
// =========================
let constraintsBasePath = "constraints";

// Returns the correct constraints base path (scoped if available, fallback to legacy root)
function getConstraintsPath() {
  return constraintsBasePath;
}

// Convenience: db ref under the constraints base
function constraintsRef(suffix = "") {
  const base = getConstraintsPath();
  return suffix ? db.ref(`${base}/${suffix}`) : db.ref(base);
}

// Decide whether to use branches/{branchKey}/constraints or legacy root constraints
async function resolveConstraintsBasePath() {
  // Default: legacy root
  constraintsBasePath = "constraints";

  if (!currentBranchKey) {
    console.log("CONSTRAINTS PATH (legacy):", constraintsBasePath);
    return;
  }

  // Non-admin managers cannot read legacy root nodes like /constraints.
  // They only have access to their own branch subtree.
  if (!isAdmin) {
    constraintsBasePath = `branches/${currentBranchKey}/constraints`;
    console.log("CONSTRAINTS PATH (scoped non-admin):", constraintsBasePath);
    return;
  }

  try {
    const scopedSnap = await db.ref(`branches/${currentBranchKey}/constraints`).limitToFirst(1).once("value");
    if (scopedSnap.exists()) {
      constraintsBasePath = `branches/${currentBranchKey}/constraints`;
      console.log("CONSTRAINTS PATH (scoped):", constraintsBasePath);
      return;
    }

    const legacySnap = await db.ref("constraints").limitToFirst(1).once("value");
    if (legacySnap.exists()) {
      constraintsBasePath = "constraints";
      console.log("CONSTRAINTS PATH (legacy):", constraintsBasePath);
      return;
    }

    // No legacy data -> use scoped for new branches
    constraintsBasePath = `branches/${currentBranchKey}/constraints`;
    console.log("CONSTRAINTS PATH (new scoped):", constraintsBasePath);
  } catch (e) {
    if (isPermissionDenied(e)) {
      constraintsBasePath = `branches/${currentBranchKey}/constraints`;
      console.warn("Constraints path resolution permission_denied -> using scoped:", constraintsBasePath);
    } else {
      console.warn("Constraints path resolution failed, using legacy root constraints", e);
      constraintsBasePath = "constraints";
    }
  }
}

// =========================
// AUTH STATE (single listener)
// =========================
auth.onAuthStateChanged(async (user) => {
  try {
    if (!user) {
      await auth.signInAnonymously();
      return;
    }

    currentBranchId = user.uid;
    console.log("BRANCH ID (uid):", currentBranchId);

    await loadSystemSubscription();
    await resolveConstraintsBasePath();
  } catch (e) {
    console.error("Auth / subscription init error:", e);
  }
});

// =========================
// EXPORTS (for other scripts / index.html)
// =========================
window.db = db;
window.auth = auth;
window.loadSystemSubscription = loadSystemSubscription;
window.resolveConstraintsBasePath = resolveConstraintsBasePath;
window.getConstraintsPath = getConstraintsPath;
window.constraintsRef = constraintsRef;

window.currentBranchId = () => currentBranchId;
window.currentBranchKey = () => currentBranchKey;
window.getSystemSubscription = () => systemSubscription;
