importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyD-uaQ2aO87kGxbcc-m8_9fzJ3uhPv2zvk",
    authDomain: "shift-manager-c026e.firebaseapp.com",
    databaseURL: "https://shift-manager-c026e-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "shift-manager-c026e",
    storageBucket: "shift-manager-c026e.firebasestorage.app",
    messagingSenderId: "1091605398341",
    appId: "1:1091605398341:web:cb6c14e7d832c3e8df342c"
  });

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: './icon-192.png'
  });
});
