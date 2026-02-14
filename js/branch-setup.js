// branch-setup.js
// Dedicated page for creating departments & employees under branches/<branchKey>/org/

(function () {
  function el(id) { return document.getElementById(id); }

  function showMsg(text, type = 'ok') {
    const box = el('msg');
    box.className = 'msg ' + (type === 'err' ? 'err' : 'ok');
    box.textContent = text;
    box.style.display = 'block';
  }

  function hideMsg() {
    const box = el('msg');
    if (!box) return;
    box.style.display = 'none';
  }

  // Firebase helpers (firebase.js already defines: firebase, auth, db, getBranchKey(), isAdmin())
  function getBranchKeySafe() {
    try {
      if (typeof window.getBranchKey === 'function') return window.getBranchKey();
      if (typeof window.BRANCH_KEY === 'string') return window.BRANCH_KEY;
    } catch (e) {}
    return null;
  }

  function isHaifaLegacy() {
    const k = getBranchKeySafe();
    return k && String(k).toUpperCase() === 'HAIFA';
  }

  function ref(path) {
    const k = getBranchKeySafe();
    if (!k) return db.ref(path);
    if (isHaifaLegacy()) return db.ref(path); // keep HAIFA legacy out of this flow
    return db.ref(`branches/${k}/${path}`);
  }

  function safeKey(s) {
    return String(s || '')
      .trim()
      .replace(/[.#$\[\]\/]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/%/g, '_');
  }

  async function loadOrg() {
    const [depsSnap, empsSnap] = await Promise.all([
      ref('org/departments').once('value'),
      ref('org/employees').once('value')
    ]);

    const deps = depsSnap.val() || {};
    const emps = empsSnap.val() || {};

    // Departments
    const deptList = el('deptList');
    const deptSelect = el('empDept');
    deptList.innerHTML = '';
    deptSelect.innerHTML = '';

    const deptEntries = Object.entries(deps).map(([id, d]) => ({
      id,
      name: (d && typeof d === 'object' && d.name) ? String(d.name) : String(id)
    }));

    deptEntries.sort((a, b) => a.name.localeCompare(b.name, 'he'));

    if (deptEntries.length === 0) {
      deptList.innerHTML = '<div class="item"><div>אין מחלקות עדיין.</div></div>';
      deptSelect.innerHTML = '<option value="">-- קודם הוסף מחלקה --</option>';
    } else {
      deptSelect.innerHTML = '<option value="">-- בחר מחלקה --</option>' +
        deptEntries.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

      for (const d of deptEntries) {
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `<div><strong>${d.name}</strong> <span class="pill">${d.id}</span></div>`;
        const btn = document.createElement('button');
        btn.className = 'btn-red';
        btn.style.width = '120px';
        btn.textContent = 'מחק';
        btn.onclick = async () => {
          try {
            hideMsg();

            // prevent delete if employees exist in this dept
            const empInDept = Object.values(emps).some(e => e && typeof e === 'object' && String(e.deptId || '') === d.id);
            if (empInDept) {
              showMsg('לא ניתן למחוק מחלקה שיש בה עובדים. מחק קודם את העובדים או העבר אותם.', 'err');
              return;
            }

            await ref(`org/departments/${d.id}`).set(null);
            showMsg('✅ מחלקה נמחקה', 'ok');
            await loadOrg();
          } catch (e) {
            console.error('delete dept error', e);
            showMsg('❌ שגיאה במחיקת מחלקה', 'err');
          }
        };
        row.appendChild(btn);
        deptList.appendChild(row);
      }
    }

    // Employees
    const empList = el('empList');
    empList.innerHTML = '';
    const deptNameById = Object.fromEntries(deptEntries.map(d => [d.id, d.name]));

    const empEntries = Object.entries(emps).map(([id, e]) => ({
      id,
      username: String(e?.username || id || '').toUpperCase(),
      displayName: String(e?.displayName || e?.username || id || ''),
      deptId: String(e?.deptId || ''),
    })).filter(x => x.username);

    empEntries.sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));

    if (empEntries.length === 0) {
      empList.innerHTML = '<div class="item"><div>אין עובדים עדיין.</div></div>';
    } else {
      for (const emp of empEntries) {
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `<div>
          <div><strong>${emp.displayName}</strong> <span class="pill">${emp.username}</span></div>
          <div class="small">מחלקה: ${deptNameById[emp.deptId] || emp.deptId || '—'}</div>
        </div>`;
        const btn = document.createElement('button');
        btn.className = 'btn-red';
        btn.style.width = '120px';
        btn.textContent = 'מחק';
        btn.onclick = async () => {
          try {
            hideMsg();
            await ref(`org/employees/${emp.id}`).set(null);
            showMsg('✅ עובד נמחק', 'ok');
            await loadOrg();
          } catch (e) {
            console.error('delete emp error', e);
            showMsg('❌ שגיאה במחיקת עובד', 'err');
          }
        };
        row.appendChild(btn);
        empList.appendChild(row);
      }
    }
  }

  async function addDept() {
    const name = el('deptName').value.trim();
    if (!name) return showMsg('אנא הזן שם מחלקה', 'err');

    const deptId = safeKey(name);
    if (!deptId) return showMsg('שם מחלקה לא תקין', 'err');

    await ref(`org/departments/${deptId}`).update({
      name,
      createdAt: Date.now()
    });

    el('deptName').value = '';
    showMsg('✅ מחלקה נוספה', 'ok');
    await loadOrg();
  }

  async function addEmp() {
    const username = el('empUser').value.trim().toUpperCase();
    const displayName = el('empName').value.trim();
    const password = el('empPass').value.trim();
    const deptId = el('empDept').value;

    if (!username || !displayName || !password) return showMsg('אנא מלא שם משתמש, שם לתצוגה וסיסמה', 'err');
    if (!deptId) return showMsg('אנא בחר מחלקה', 'err');

    const empId = safeKey(username);
    await ref(`org/employees/${empId}`).set({
      username,
      displayName,
      password,
      deptId,
      createdAt: Date.now()
    });

    el('empUser').value = '';
    el('empName').value = '';
    el('empPass').value = '';
    showMsg('✅ עובד נוסף', 'ok');
    await loadOrg();
  }

  async function init() {
    try {
      hideMsg();

      // Require firebase.js globals
      if (!window.firebase || !window.auth || !window.db) {
        showMsg('❌ firebase.js לא נטען. ודא שיש קובץ js/firebase.js בדף הזה.', 'err');
        return;
      }

      // Must be logged in
      const user = auth.currentUser;
      if (!user) {
        showMsg('❌ לא מחובר. חזור למערכת והתחבר כמנהל, ואז לחץ שוב על "הקמת סניף".', 'err');
        return;
      }

      const branchKey = getBranchKeySafe();
      if (!branchKey) {
        showMsg('❌ לא זוהה branchKey. בדוק בקונסול של firebase.js את השורה BRANCH ID (uid).', 'err');
        return;
      }

      if (isHaifaLegacy()) {
        showMsg('ℹ️ חיפה הוא סניף לגאסי. המסך הזה מיועד לסניפים חדשים.', 'err');
        return;
      }

      el('addDeptBtn').onclick = () => addDept().catch(e => { console.error(e); showMsg('❌ שגיאה בהוספת מחלקה', 'err'); });
      el('addEmpBtn').onclick = () => addEmp().catch(e => { console.error(e); showMsg('❌ שגיאה בהוספת עובד', 'err'); });

      await loadOrg();
      showMsg('✅ מחובר. אפשר להתחיל להוסיף מחלקות ועובדים.', 'ok');

    } catch (e) {
      console.error('init error', e);
      showMsg('❌ שגיאה בטעינת המסך', 'err');
    }
  }

  window.addEventListener('load', init);
})();
