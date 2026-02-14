(function () {
  const auth = firebase.auth();
  const db = firebase.database();

  const statusEl = document.getElementById("status");
  const actionsEl = document.getElementById("actions");

  function setStatus(msg, ok) {
    statusEl.style.display = "block";
    statusEl.className = "status " + (ok ? "ok" : "err");
    statusEl.textContent = msg;
  }

  async function resolveIsHaifaManager(uid) {
    try {
      const snap = await db.ref("branches/HAIFA/managerUid").once("value");
      return snap.exists() && snap.val() === uid;
    } catch (e) {
      // If rules block it, just assume it's not haifa.
      return false;
    }
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      setStatus("לא מחובר. היכנס כמנהל במערכת הראשית ואז חזור לפורטל.", false);
      actionsEl.style.display = "none";
      return;
    }

    const uid = user.uid;
    const isHaifa = await resolveIsHaifaManager(uid);

    // If this user is HAIFA manager, just send them to the main system.
    if (isHaifa) {
      window.location.href = "./";
      return;
    }

    // New-branch manager
    actionsEl.style.display = "block";

    document.getElementById("btnSetup").onclick = () => {
      window.location.href = "./branch-setup.html";
    };

    document.getElementById("btnMainHaifa").onclick = () => {
      window.location.href = "./";
    };

    document.getElementById("btnOut").onclick = async () => {
      await auth.signOut();
      window.location.href = "./";
    };
  });
})();
