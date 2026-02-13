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
let currentBranchId = null;   // manager UID
let currentBranchKey = null;  // branch key (e.g. "HAIFA")

// =========================
// SYSTEM SUBSCRIPTION (READ ONLY)
// =========================
let systemSubscription = null;

// =========================
// Load subscription by manager UID
// =========================
async function loadSystemSubscription() {
  try {
    const branchesSnap = await db.ref('branches').once('value');

    if (!branchesSnap.exists()) {
      console.warn('No branches found');
      systemSubscription = null;
      currentBranchKey = null;
      return;
    }

    let found = false;

    branchesSnap.forEach(branchSnap => {
      const branchData = branchSnap.val();

      if (branchData.managerUid === currentBranchId) {
        currentBranchKey = branchSnap.key;
        systemSubscription = branchData.subscription || null;

        console.log('BRANCH KEY:', currentBranchKey);
        console.log(
          'SYSTEM SUBSCRIPTION (branch:',
          currentBranchKey,
          '):',
          systemSubscription
        );

        found = true;
      }
    });

    if (!found) {
      console.warn('No branch found for manager UID:', currentBranchId);
      systemSubscription = null;
      currentBranchKey = null;
    }
  } catch (e) {
    console.error('Failed to load system subscription', e);
  }
}


// =========================
// CONSTRAINTS PATH (branch-scoped with legacy fallback)
// =========================
let constraintsBasePath = 'constraints';

// Returns the correct constraints base path (scoped if available, fallback to legacy root)
function getConstraintsPath() {
  return constraintsBasePath;
}

// Convenience: db ref under the constraints base
function constraintsRef(suffix = '') {
  const base = getConstraintsPath();
  return suffix ? db.ref(`${base}/${suffix}`) : db.ref(base);
}

// Decide whether to use branches/{branchKey}/constraints or legacy root constraints
async function resolveConstraintsBasePath() {
  // Default: legacy root
  constraintsBasePath = 'constraints';

  if (!currentBranchKey) {
    console.log('CONSTRAINTS PATH (legacy):', constraintsBasePath);
    return;
  }

  try {
    const scopedSnap = await db.ref(`branches/${currentBranchKey}/constraints`).limitToFirst(1).once('value');
    if (scopedSnap.exists()) {
      constraintsBasePath = `branches/${currentBranchKey}/constraints`;
      console.log('CONSTRAINTS PATH (scoped):', constraintsBasePath);
      return;
    }

    const legacySnap = await db.ref('constraints').limitToFirst(1).once('value');
    if (legacySnap.exists()) {
      constraintsBasePath = 'constraints';
      console.log('CONSTRAINTS PATH (legacy):', constraintsBasePath);
      return;
    }

    // No legacy data -> use scoped for new branches
    constraintsBasePath = `branches/${currentBranchKey}/constraints`;
    console.log('CONSTRAINTS PATH (new scoped):', constraintsBasePath);
  } catch (e) {
    console.warn('Constraints path resolution failed, using legacy root constraints', e);
    constraintsBasePath = 'constraints';
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
    console.log('BRANCH ID (uid):', currentBranchId);

    await loadSystemSubscription();
    await resolveConstraintsBasePath();
  } catch (e) {
    console.error('Auth / subscription init error:', e);
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
