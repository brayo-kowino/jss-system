importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyCURCEhuxdsfVNqBLdHTLfzZ8mYn_yQsVQ",
  authDomain: "jss-management-system.firebaseapp.com",
  projectId: "jss-management-system",
  storageBucket: "jss-management-system.firebasestorage.app",
  messagingSenderId: "203154110445",
  appId: "1:203154110445:web:b66b659ce4f778a55d59e4",
  measurementId: "G-JC41066X2Y"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "New Notification";
  const body = payload.notification?.body || "";
  
  const options = {
    body: body.length > 80 ? body.slice(0, 77) + "..." : body,
    icon: "/assets/logo.png",
    tag: "eeskia-push",
    data: {
      url: "/app/#!/notifications"
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || "/app/#!/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes("/app") && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
