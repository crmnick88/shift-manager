// =========================
// Firebase Init
// =========================
firebase.initializeApp(firebaseConfig);
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
  } catch (e) {
    console.error('Auth / subscription init error:', e);
  }
});
