/**
 * branch-setup.js
 * Dedicated page for creating departments & employees under:
 *   branches/<branchKey>/org/departments
 *   branches/<branchKey>/org/employees
 *
 * Depends on ./js/firebase.js which initializes:
 *   firebase, auth, db and sets branch key helpers.
 */
(function () {
  function el(id) { return document.getElementById(id); }

  function showMsg(text, type = 'ok') {
    const box = el('msg');
    if (!box) {
      console.error('[branch-setup] msg element missing:', text);
      alert(text);
      return;
    }
    box.className = 'msg ' + (type === 'err' ? 'err' : 'ok');
    box.textContent = text;
    box.style.display = 'block';
  }

  function clearMsg() {
    const box = el('msg');
    if (box) box.style.display = 'none';
  }

  function assertEls() {
    const must = ['deptList','empDept','deptName','addDeptBtn','empUser','empName','empPass','addEmpBtn','empList','msg'];
    const missing = must.filter(id => !el(id));
    if (missing.length) {
      console.error('[branch-setup] Missing DOM ids:', missing);
      showMsg('שגיאה: חסרים רכיבי UI בדף: ' + missing.join(', '), 'err');
      return false;
    }
    return true;
  }

  // Firebase helpers (firebase.js already defines: firebase, auth, db, getBranchKey(), isAdmin())
  function getBranchKeySafe() {
    // Prefer firebase.js resolver
    try {
      if (typeof window.getBranchKey === 'function') {
        const k = window.getBranchKey();
        if (k) return k;
      }
      // Fallback: cached BRANCH_KEY
      if (typeof window.BRANCH_KEY === 'string' && window.BRANCH_KEY) return window.BRANCH_KEY;
      // Fallback: auth user uid (always branch-scoped for new managers)
      const u = (window.auth && window.auth.currentUser) ? window.auth.currentUser : null;
      if (u && u.uid) return u.uid;
    } catch (e) {}
    return null;
  }
    return null;
  }

  function isHaifaLegacy() {
    const k = getBranchKeySafe();
    return k && String(k).toUpperCase() === 'HAIFA';
  }

  function ref(path) {
    const k = getBranchKeySafe();
    // HAIFA legacy stays on root to avoid breaking existing data
    if (k && String(k).toUpperCase() === 'HAIFA') return db.ref(path);
    // For new managers, ALWAYS scope under branches/<uid>/
    const uid = k || (auth.currentUser && auth.currentUser.uid ? auth.currentUser.uid : null);
    if (!uid) return db.ref(path); // last-resort (shouldn't happen after auth)
    return db.ref(`branches/${uid}/${path}`);
  }

  function safeKey(s) {
    return String(s || '')
      .trim()
      .replace(/[.#$\[\]\/]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/%/g, '_');
  }

  function renderList(container, items, kind) {
    container.innerHTML = '';
    if (!items.length) {
      container.innerHTML = '<div class="item"><div>אין עדיין.</div></div>';
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'item';

      const left = document.createElement('div');
      left.innerHTML = `<div><b>${it.title}</b></div>` + (it.meta ? `<div class="meta">${it.meta}</div>` : '');

      const btn = document.createElement('button');
      btn.className = 'dangerBtn';
      btn.type = 'button';
      btn.textContent = (kind === 'dept') ? 'מחק מחלקה' : 'מחק עובד';
      btn.onclick = it.onDelete;

      row.appendChild(left);
      row.appendChild(btn);
      container.appendChild(row);
    }
  }

  async function loadOrg() {
    clearMsg();
    const deptList = el('deptList');
    const deptSelect = el('empDept');
    const empList = el('empList');

    const [depsSnap, empsSnap] = await Promise.all([
      ref('org/departments').once('value'),
      ref('org/employees').once('value')
    ]);

    const deps = depsSnap.val() || {};
    const emps = empsSnap.val() || {};

    const deptEntries = Object.entries(deps).map(([id, d]) => ({
      id,
      name: (d && typeof d === 'object' && d.name) ? String(d.name) : String(id)
    })).sort((a, b) => a.name.localeCompare(b.name, 'he'));

    // Populate select
    deptSelect.innerHTML = '';
    if (!deptEntries.length) {
      deptSelect.innerHTML = '<option value="">-- קודם הוסף מחלקה --</option>';
    } else {
      deptSelect.innerHTML = '<option value="">-- בחר מחלקה --</option>' +
        deptEntries.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }

    // Dept list with safe delete
    renderList(deptList, deptEntries.map(d => ({
      title: d.name,
      meta: 'מזהה: ' + d.id,
      onDelete: async () => {
        try {
          // block delete if employees are attached
          const hasEmp = Object.values(emps).some(e => e && e.departmentId === d.id);
          if (hasEmp) return showMsg('לא ניתן למחוק מחלקה עם עובדים משויכים. מחק/העבר עובדים קודם.', 'err');
          await ref(`org/departments/${d.id}`).remove();
          showMsg('מחלקה נמחקה', 'ok');
          await loadOrg();
        } catch (e) {
          console.error(e);
          showMsg('שגיאה במחיקת מחלקה: ' + (e && e.message ? e.message : e), 'err');
        }
      }
    })), 'dept');

    // Employee list
    const empEntries = Object.entries(emps).map(([id, e]) => ({
      id,
      user: e?.username ? String(e.username) : '',
      name: e?.displayName ? String(e.displayName) : (e?.name ? String(e.name) : ''),
      deptId: e?.departmentId ? String(e.departmentId) : ''
    })).sort((a, b) => (a.name || a.user).localeCompare((b.name || b.user), 'he'));

    const deptNameById = Object.fromEntries(deptEntries.map(d => [d.id, d.name]));
    renderList(empList, empEntries.map(e => ({
      title: (e.name ? e.name + ' — ' : '') + (e.user || e.id),
      meta: e.deptId ? ('מחלקה: ' + (deptNameById[e.deptId] || e.deptId)) : 'ללא שיוך',
      onDelete: async () => {
        try {
          await ref(`org/employees/${e.id}`).remove();
          showMsg('עובד נמחק', 'ok');
          await loadOrg();
        } catch (err) {
          console.error(err);
          showMsg('שגיאה במחיקת עובד: ' + (err && err.message ? err.message : err), 'err');
        }
      }
    })), 'emp');
  }

  async function addDepartment() {
    const name = (el('deptName').value || '').trim();
    if (!name) return showMsg('נא להקליד שם מחלקה', 'err');

    const id = safeKey(name);
    try {
      await ref(`org/departments/${id}`).set({ name });
      el('deptName').value = '';
      showMsg('מחלקה נוספה', 'ok');
      await loadOrg();
    } catch (e) {
      console.error(e);
      showMsg('שגיאה בהוספת מחלקה: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function addEmployee() {
    const username = safeKey(el('empUser').value).replace(/\s+/g, '');
    const displayName = (el('empName').value || '').trim();
    const password = (el('empPass').value || '').trim();
    const departmentId = el('empDept').value;

    if (!username) return showMsg('נא להקליד שם משתמש', 'err');
    if (!displayName) return showMsg('נא להקליד שם לתצוגה', 'err');
    if (!password) return showMsg('נא להקליד סיסמה', 'err');
    if (!departmentId) return showMsg('נא לבחור מחלקה', 'err');

    try {
      await ref(`org/employees/${username}`).set({
        username,
        displayName,
        password,
        departmentId,
        createdAt: Date.now()
      });
      el('empUser').value = '';
      el('empName').value = '';
      el('empPass').value = '';
      showMsg('עובד נוסף', 'ok');
      await loadOrg();
    } catch (e) {
      console.error(e);
      showMsg('שגיאה בהוספת עובד: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function boot() {
    if (!assertEls()) return;

    // wait for auth
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        showMsg('לא מחובר. חזור ונסה שוב דרך "כניסת מנהל".', 'err');
        return;
      }
      let key = getBranchKeySafe();
      // firebase.js may populate currentBranchKey asynchronously; always fall back to auth.uid
      if (!key && user && user.uid) key = user.uid;
      // Persist for this page so refs never fall back to root
      try { window.BRANCH_KEY = key; } catch (e) {}
      if (!key) {
        showMsg('לא נמצא branchKey (UID). ודא שנכנסת כמנהל.', 'err');
        return;
      }
      if (isHaifaLegacy()) {
        showMsg('זהו סניף Legacy (חיפה). ההקמה אינה רלוונטית כאן.', 'err');
        return;
      }

      // wire buttons
      el('addDeptBtn').addEventListener('click', addDepartment);
      el('addEmpBtn').addEventListener('click', addEmployee);

      // Back to system: open manager login automatically
      const back = document.getElementById('backToSystem');
      if (back) {
        back.addEventListener('click', () => {
          try { localStorage.setItem('openManagerAfterSetup', '1'); } catch(e) {}
        });
      }

      await loadOrg();
      unsub();
    });
  }

  boot().catch((e) => {
    console.error(e);
    showMsg('שגיאת אתחול: ' + (e && e.message ? e.message : e), 'err');
  });
})();
