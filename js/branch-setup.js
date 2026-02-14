/**
 * branch-setup.js
 * Page for creating departments & employees under:
 *   branches/<branchKey>/org/departments/<deptName>/<USERNAME> = true
 *   branches/<branchKey>/org/employees/<USERNAME> = "<password>"
 *   branches/<branchKey>/org/displayNames/<USERNAME> = "<displayName>"   (optional but useful)
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
    try {
      if (typeof window.getBranchKey === 'function') {
        const k = window.getBranchKey();
        if (k) return k;
      }
      if (typeof window.BRANCH_KEY === 'string' && window.BRANCH_KEY) return window.BRANCH_KEY;
      const ls = (typeof localStorage !== 'undefined') ? localStorage.getItem('currentBranchKey') : null;
      if (ls) return ls;
      const u = (window.auth && window.auth.currentUser) ? window.auth.currentUser : null;
      if (u && u.uid) return u.uid;
    } catch (e) {}
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
    if (!k) throw new Error('Branch UID not ready yet');
    return db.ref(`branches/${k}/${path}`);
  }

  function safeKey(s) {
    return String(s || '')
      .trim()
      .replace(/[.#$\[\]\/]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/%/g, '_');
  }

  function safeUsername(s) {
    return safeKey(s).replace(/\s+/g, '').toUpperCase();
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

    const [depsSnap, empsSnap, namesSnap] = await Promise.all([
      ref('org/departments').once('value'),
      ref('org/employees').once('value'),
      ref('org/displayNames').once('value')
    ]);

    // departments structure expected:
    // { "<deptName>": { "<USERNAME>": true, ... }, ... }
    const deps = depsSnap.val() || {};
    // employees structure expected:
    // { "<USERNAME>": "<password>", ... }
    const emps = empsSnap.val() || {};
    // displayNames (optional):
    // { "<USERNAME>": "<displayName>", ... }
    const displayNames = namesSnap.val() || {};

    const deptEntries = Object.keys(deps)
      .map((deptName) => ({
        id: deptName,
        name: deptName,
        members: (deps[deptName] && typeof deps[deptName] === 'object') ? deps[deptName] : {}
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

    // Populate select
    deptSelect.innerHTML = '';
    if (!deptEntries.length) {
      deptSelect.innerHTML = '<option value="">-- קודם הוסף מחלקה --</option>';
    } else {
      deptSelect.innerHTML =
        '<option value="">-- בחר מחלקה --</option>' +
        deptEntries.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }

    // Dept list with safe delete (only if no employees attached)
    renderList(
      deptList,
      deptEntries.map(d => ({
        title: d.name,
        meta: 'עובדים: ' + Object.keys(d.members || {}).length,
        onDelete: async () => {
          try {
            const members = d.members || {};
            const memberCount = Object.keys(members).filter(k => k !== '__meta').length;
            if (memberCount > 0) {
              return showMsg('לא ניתן למחוק מחלקה עם עובדים משויכים. מחק/העבר עובדים קודם.', 'err');
            }
            await ref(`org/departments/${d.id}`).remove();
            showMsg('מחלקה נמחקה', 'ok');
            await loadOrg();
          } catch (e) {
            console.error(e);
            showMsg('שגיאה במחיקת מחלקה: ' + (e && e.message ? e.message : e), 'err');
          }
        }
      })),
      'dept'
    );

    // Employee list (we derive dept by scanning departments membership)
    const deptByUser = {};
    for (const [deptName, members] of Object.entries(deps)) {
      if (members && typeof members === 'object') {
        for (const u of Object.keys(members)) {
          if (u === '__meta') continue;
          if (members[u]) deptByUser[String(u).toUpperCase()] = deptName;
        }
      }
    }

    const empEntries = Object.keys(emps)
      .map((u) => {
        const U = String(u).toUpperCase();
        return {
          id: U,
          user: U,
          dept: deptByUser[U] || '',
          display: displayNames[U] ? String(displayNames[U]) : ''
        };
      })
      .sort((a, b) => (a.display || a.user).localeCompare((b.display || b.user), 'he'));

    renderList(
      empList,
      empEntries.map(e => ({
        title: (e.display ? e.display + ' — ' : '') + e.user,
        meta: e.dept ? ('מחלקה: ' + e.dept) : 'ללא שיוך',
        onDelete: async () => {
          try {
            // Remove employee password
            await ref(`org/employees/${e.id}`).remove();
            // Remove display name
            await ref(`org/displayNames/${e.id}`).remove();

            // Remove from any department membership
            const updates = {};
            for (const d of Object.keys(deps || {})) {
              if (deps[d] && typeof deps[d] === 'object' && deps[d][e.id]) {
                updates[`org/departments/${d}/${e.id}`] = null;
              }
            }
            if (Object.keys(updates).length) {
              await ref('').update(updates);
            }

            showMsg('עובד נמחק', 'ok');
            await loadOrg();
          } catch (err) {
            console.error(err);
            showMsg('שגיאה במחיקת עובד: ' + (err && err.message ? err.message : err), 'err');
          }
        }
      })),
      'emp'
    );
  }

  async function addDepartment() {
    const nameRaw = (el('deptName').value || '').trim();
    if (!nameRaw) return showMsg('נא להקליד שם מחלקה', 'err');

    const deptName = safeKey(nameRaw); // keep as display key (Hebrew/space ok)
    try {
      const snap = await ref(`org/departments/${deptName}`).once('value');
      if (snap.exists()) {
        el('deptName').value = '';
        showMsg('המחלקה כבר קיימת', 'ok');
        await loadOrg();
        return;
      }

      // department value must be an object of employees, not {name:...}
      await ref(`org/departments/${deptName}`).set({});
      el('deptName').value = '';
      showMsg('מחלקה נוספה', 'ok');
      await loadOrg();
    } catch (e) {
      console.error(e);
      showMsg('שגיאה בהוספת מחלקה: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function addEmployee() {
    const username = safeUsername(el('empUser').value || '');
    const displayName = (el('empName').value || '').trim();
    const password = (el('empPass').value || '').trim();
    const departmentName = el('empDept').value; // dept key is dept name

    if (!username) return showMsg('נא להקליד שם משתמש', 'err');
    if (!displayName) return showMsg('נא להקליד שם לתצוגה', 'err');
    if (!password) return showMsg('נא להקליד סיסמה', 'err');
    if (!departmentName) return showMsg('נא לבחור מחלקה', 'err');

    try {
      // Ensure department exists (and is object)
      const dSnap = await ref(`org/departments/${departmentName}`).once('value');
      if (!dSnap.exists() || (dSnap.val() && typeof dSnap.val() !== 'object')) {
        return showMsg('המחלקה שנבחרה אינה תקינה. נסה למחוק/להוסיף אותה מחדש.', 'err');
      }

      // 1) employees: username -> password (as app.js expects)
      await ref(`org/employees/${username}`).set(password);

      // 2) displayNames: username -> displayName (optional)
      await ref(`org/displayNames/${username}`).set(displayName);

      // 3) departments membership: departments/<deptName>/<username> = true
      await ref(`org/departments/${departmentName}/${username}`).set(true);

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
      if (!key && user && user.uid) key = user.uid;

      try {
        window.BRANCH_KEY = key;
        localStorage.setItem('currentBranchKey', key);
      } catch(e) {}

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

      // Back to system: return to manager portal after setup
      const backLink = document.querySelector('a.back');
      if (backLink) {
        backLink.addEventListener('click', (e) => {
          try { localStorage.setItem('afterBranchSetup', '1'); } catch(_) {}
          e.preventDefault();
          window.location.href = './index.html';
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
