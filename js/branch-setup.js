/* branch-setup.js
   - Works only for NON-HAIFA branches.
   - Uses firebase.js from the main app (expects window.getBranchKey()).
*/

(function () {
  const $ = (id) => document.getElementById(id);

  const auth = firebase.auth();
  const db = firebase.database();

  function showStatus(el, msg, ok) {
    el.style.display = "block";
    el.className = "status " + (ok ? "ok" : "err");
    el.textContent = msg;
  }

  function normKey(s) {
    return String(s || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
  }

  async function ensureBranchRoot(branchKey, uid) {
    // Make sure branches/<branchKey>/managerUid exists for non-uid keys.
    // If branchKey is uid itself, rules already allow.
    const ref = db.ref(`branches/${branchKey}`);
    const snap = await ref.child("managerUid").once("value");
    if (!snap.exists()) {
      await ref.child("managerUid").set(uid);
    }
  }

  function isHaifa(branchKey) {
    return String(branchKey || "").toUpperCase() === "HAIFA";
  }

  function refDepartments(branchKey) {
    return db.ref(`branches/${branchKey}/departments`);
  }

  function refEmployees(branchKey) {
    return db.ref(`branches/${branchKey}/employees`);
  }

  async function loadAll(branchKey) {
    const [dSnap, eSnap] = await Promise.all([
      refDepartments(branchKey).once("value"),
      refEmployees(branchKey).once("value"),
    ]);
    const departments = dSnap.val() || {};
    const employees = eSnap.val() || {};
    return { departments, employees };
  }

  function renderDepartments(branchKey, departments, employees) {
    const list = $("deptList");
    list.innerHTML = "";
    const keys = Object.keys(departments);
    $("deptCount").textContent = String(keys.length);

    // dropdown
    const sel = $("empDept");
    const prev = sel.value;
    sel.innerHTML = '<option value="">— בחר מחלקה —</option>';
    keys
      .sort((a, b) => (departments[a].name || a).localeCompare(departments[b].name || b))
      .forEach((k) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = departments[k].name || k;
        sel.appendChild(opt);
      });
    if (prev && departments[prev]) sel.value = prev;

    if (keys.length === 0) {
      list.innerHTML = '<div class="item"><div><strong>אין מחלקות עדיין</strong></div></div>';
      return;
    }

    keys
      .sort((a, b) => (departments[a].name || a).localeCompare(departments[b].name || b))
      .forEach((k) => {
        const name = departments[k].name || k;
        const empCount = Object.values(employees).filter((e) => e && e.deptKey === k).length;

        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div>
            <strong>${name}</strong>
            <div><small>מפתח: ${k} • עובדים משויכים: ${empCount}</small></div>
          </div>
          <button class="btn-danger" type="button" data-del-dept="${k}">מחק</button>
        `;
        list.appendChild(row);
      });

    list.querySelectorAll("[data-del-dept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const k = btn.getAttribute("data-del-dept");
        const hasEmp = Object.values(employees).some((e) => e && e.deptKey === k);
        if (hasEmp) {
          showStatus($("deptStatus"), "אי אפשר למחוק מחלקה שיש בה עובדים. מחק/העבר עובדים קודם.", false);
          return;
        }
        try {
          await refDepartments(branchKey).child(k).remove();
          showStatus($("deptStatus"), "מחלקה נמחקה.", true);
          refresh(branchKey);
        } catch (err) {
          showStatus($("deptStatus"), "שגיאה במחיקת מחלקה: " + (err?.message || err), false);
        }
      });
    });
  }

  function renderEmployees(branchKey, employees, departments) {
    const list = $("empList");
    list.innerHTML = "";
    const keys = Object.keys(employees);
    $("empCount").textContent = String(keys.length);

    if (keys.length === 0) {
      list.innerHTML = '<div class="item"><div><strong>אין עובדים עדיין</strong></div></div>';
      return;
    }

    keys
      .sort((a, b) => a.localeCompare(b))
      .forEach((k) => {
        const e = employees[k] || {};
        const deptName = e.deptKey && departments[e.deptKey] ? (departments[e.deptKey].name || e.deptKey) : "—";
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div>
            <strong>${e.name || k}</strong>
            <div><small>משתמש: ${k} • מחלקה: ${deptName}</small></div>
          </div>
          <button class="btn-danger" type="button" data-del-emp="${k}">מחק</button>
        `;
        list.appendChild(row);
      });

    list.querySelectorAll("[data-del-emp]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const k = btn.getAttribute("data-del-emp");
        try {
          await refEmployees(branchKey).child(k).remove();
          showStatus($("empStatus"), "עובד נמחק.", true);
          refresh(branchKey);
        } catch (err) {
          showStatus($("empStatus"), "שגיאה במחיקת עובד: " + (err?.message || err), false);
        }
      });
    });
  }

  async function refresh(branchKey) {
    const { departments, employees } = await loadAll(branchKey);
    renderDepartments(branchKey, departments, employees);
    renderEmployees(branchKey, employees, departments);
  }

  async function onReady(uid) {
    let branchKey = (window.getBranchKey && window.getBranchKey()) || uid;

    if (!branchKey) branchKey = uid;

    if (isHaifa(branchKey)) {
      $("legacyNotice").style.display = "block";
      $("main").style.display = "none";
      return;
    }

    $("main").style.display = "block";

    await ensureBranchRoot(branchKey, uid);
    await refresh(branchKey);

    $("btnAddDept").addEventListener("click", async () => {
      const status = $("deptStatus");
      status.style.display = "none";
      const name = $("deptName").value.trim();
      if (!name) return showStatus(status, "נא להזין שם מחלקה.", false);

      const key = normKey(name);
      if (!key) return showStatus(status, "שם מחלקה לא תקין.", false);

      try {
        await refDepartments(branchKey).child(key).set({
          name,
          createdAt: Date.now(),
        });
        $("deptName").value = "";
        showStatus(status, "מחלקה נוספה בהצלחה.", true);
        await refresh(branchKey);
      } catch (err) {
        showStatus(status, "שגיאה בהוספת מחלקה: " + (err?.message || err), false);
      }
    });

    $("btnAddEmp").addEventListener("click", async () => {
      const status = $("empStatus");
      status.style.display = "none";

      const user = normKey($("empUser").value);
      const name = $("empName").value.trim();
      const pass = $("empPass").value.trim();
      const deptKey = $("empDept").value;

      if (!user) return showStatus(status, "נא להזין שם משתמש תקין (אנגלית/ספרות).", false);
      if (!name) return showStatus(status, "נא להזין שם לתצוגה.", false);
      if (!pass) return showStatus(status, "נא להזין סיסמה.", false);
      if (!deptKey) return showStatus(status, "נא לבחור מחלקה לפני הוספת עובד.", false);

      try {
        await refEmployees(branchKey).child(user).set({
          name,
          password: pass,
          deptKey,
          active: true,
          createdAt: Date.now(),
        });
        $("empUser").value = "";
        $("empName").value = "";
        $("empPass").value = "";
        showStatus(status, "עובד נוסף בהצלחה.", true);
        await refresh(branchKey);
      } catch (err) {
        showStatus(status, "שגיאה בהוספת עובד: " + (err?.message || err), false);
      }
    });

    $("btnBack").addEventListener("click", () => {
      window.location.href = "./";
    });

    $("btnSignOut").addEventListener("click", async () => {
      await auth.signOut();
      window.location.href = "./";
    });
  }

  auth.onAuthStateChanged((user) => {
    if (!user) {
      $("authNotice").style.display = "block";
      $("main").style.display = "none";
      return;
    }
    onReady(user.uid).catch((err) => {
      $("main").style.display = "none";
      $("authNotice").style.display = "block";
      $("authNotice").textContent = "שגיאה בטעינת ההקמה: " + (err?.message || err);
    });
  });
})();
