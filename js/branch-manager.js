// branch-manager.js
// Dedicated manager dashboard for NEW branches (non-HAIFA), using branches/<branchKey>/... data.
// Reuses existing UI + logic from app.js, but ensures BRANCH_KEY is ready and shows manager section.

(function () {
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
    return { u: (window.auth && auth.currentUser) ? auth.currentUser : null, k: ensureBranchKey() };
  }

  async function boot() {
    // If not logged-in as manager, send to manager-portal (login)
    const { u, k } = await waitForAuthReady();
    if (!u || u.isAnonymous) {
      // go to portal to login
      window.location.href = './manager-portal.html';
      return;
    }

    // Make sure manager section is visible
    try {
      if (typeof hideAll === 'function') hideAll();
      const sec = document.getElementById('manager-section');
      if (sec) sec.classList.add('active');
    } catch (e) {}

    // Init manager UI from app.js
    try {
      if (typeof initShirotToggleUI === 'function') initShirotToggleUI();
      if (typeof initEliyaToggleUI === 'function') initEliyaToggleUI();
      if (typeof loadAllConstraints === 'function') loadAllConstraints();
      if (typeof initPushNotifications === 'function') initPushNotifications();
      if (typeof showMessage === 'function') showMessage('✅ מחובר/ת לפאנל מנהל סניף', 'success');
    } catch (e) {
      console.error('[branch-manager] init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
