// branch-manager.js
// Dedicated manager dashboard for NEW branches (non-HAIFA)
// Loads employees/departments dynamically from branches/<branchKey>/org/...
// Then reuses existing UI + logic from app.js

(function () {
  let USERS = {};
  let DEPARTMENTS = {};
  let DISPLAY_NAMES = {};
  
  function ensureBranchKey() {
    try {
      // If firebase.js resolved it, use that
      const k = (typeof window.getBranchKey === 'function') ? window.getBranchKey() : null;
      if (k) { window.BRANCH_KEY = k; return k; }

      // Fallback to auth uid if available
      const u = (window.auth && auth.currentUser) ? auth.currentUser : null;
      if (u && u.uid) { window.BRANCH_KEY = u.uid; return u.uid; }
    } catch (e) {}
    return null;
  }

  async function waitForAuthReady(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const u = (window.auth && auth.currentUser) ? auth.currentUser : null;
      const k = ensureBranchKey();
      if (u && k) return { u, k };
      await new Promise(r => setTimeout(r, 150));
    }
    return { 
      u: (window.auth && auth.currentUser) ? auth.currentUser : null, 
      k: ensureBranchKey() 
    };
  }

  // ✅ Load employees and departments from Firebase for this branch
  async function loadBranchOrgData(branchKey) {
    try {
      console.log('[branch-manager] Loading org data for branch:', branchKey);
      
      const [empsSnap, deptsSnap] = await Promise.all([
        db.ref(`branches/${branchKey}/org/employees`).once('value'),
        db.ref(`branches/${branchKey}/org/departments`).once('value')
      ]);

      const emps = empsSnap.val() || {};
      const depts = deptsSnap.val() || {};

      console.log('[branch-manager] Raw org data:', { emps, depts });

      // Convert to the old format used by app.js
      USERS = {};
      DISPLAY_NAMES = {};
      
      Object.entries(emps).forEach(([username, emp]) => {
        USERS[username] = username;
        DISPLAY_NAMES[username] = emp.displayName || emp.name || username;
      });

      DEPARTMENTS = {};
      Object.entries(depts).forEach(([deptId, dept]) => {
        const deptName = dept.name || deptId;
        const deptEmps = Object.entries(emps)
          .filter(([_, emp]) => emp.departmentId === deptId)
          .map(([username]) => username);
        DEPARTMENTS[deptName] = deptEmps;
      });

      // ✅ Override app.js global variables with branch-specific data
      if (typeof window !== 'undefined') {
        window.USERS = USERS;
        window.DEPARTMENTS = DEPARTMENTS;
        window.DISPLAY_NAMES = DISPLAY_NAMES;
      }

      console.log('[branch-manager] ✅ Loaded org data:', { 
        USERS, 
        DEPARTMENTS, 
        DISPLAY_NAMES 
      });
      
      return { emps, depts };
      
    } catch (e) {
      console.error('[branch-manager] Failed to load org data:', e);
      return { emps: {}, depts: {} };
    }
  }

  async function boot() {
    console.log('[branch-manager] Booting...');
    
    const { u, k } = await waitForAuthReady();
    
    if (!u || u.isAnonymous) {
      console.log('[branch-manager] Not authenticated, redirecting to portal');
      window.location.href = './manager-portal.html';
      return;
    }

    if (!k) {
      console.error('[branch-manager] No branch key found');
      alert('לא נמצא branch key');
      window.location.href = './manager-portal.html';
      return;
    }

    console.log('[branch-manager] Auth ready, branchKey:', k);

    // ✅ Load org data BEFORE showing UI
    const { emps, depts } = await loadBranchOrgData(k);
    
    if (Object.keys(emps).length === 0) {
      // No employees yet → redirect to setup
      console.log('[branch-manager] No employees found, redirecting to setup');
      if (confirm('עדיין לא הקמת מחלקות ועובדים. לעבור להקמה?')) {
        window.location.href = './branch-setup.html';
      }
      return;
    }

    console.log('[branch-manager] Org data loaded, showing manager UI');

    // Show manager section
    try {
      if (typeof hideAll === 'function') hideAll();
      const sec = document.getElementById('manager-section');
      if (sec) sec.classList.add('active');
    } catch (e) {
      console.error('[branch-manager] Error showing section:', e);
    }

    // Init manager UI from app.js (now with our USERS/DEPARTMENTS)
    try {
      // Note: We DON'T use initShirotToggleUI/initEliyaToggleUI 
      // because those are HAIFA-specific toggles
      
      if (typeof loadAllConstraints === 'function') {
        console.log('[branch-manager] Loading constraints...');
        loadAllConstraints();
      }
      
      if (typeof initPushNotifications === 'function') {
        console.log('[branch-manager] Initializing push notifications...');
        initPushNotifications();
      }
      
      if (typeof showMessage === 'function') {
        showMessage('✅ מחובר/ת לפאנל מנהל סניף', 'success');
      }
    } catch (e) {
      console.error('[branch-manager] Init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
