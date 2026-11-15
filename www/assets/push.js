(function () {
  const appHost = window.location.hostname;
  const isNativeApp = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function storePushToken(token) {
    if (!token) return;
    try {
      localStorage.setItem("salonDeviceToken", JSON.stringify({
        token,
        updatedAt: new Date().toISOString(),
        platform: window.Capacitor?.getPlatform?.() || (appHost.includes("ios") ? "ios" : "android")
      }));
    } catch (error) {
      console.warn("Failed to store push token", error);
    }
  }

  function handleNotificationAction(payload = {}) {
    const bookingId = payload.bookingId || payload.booking_id || payload.data?.bookingId || payload.data?.booking_id;
    const salonId = payload.salonId || payload.salon_id || payload.data?.salonId || payload.data?.salon_id;

    if (bookingId) {
      window.location.href = `index.html#booking?bookingId=${encodeURIComponent(bookingId)}`;
      return;
    }

    if (salonId) {
      window.location.href = `index.html#salons?s=${encodeURIComponent(salonId)}`;
      return;
    }

    window.location.href = "index.html#booking";
  }

  async function registerPushNotifications() {
    if (!isNativeApp || !window.Capacitor) return;

    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") {
        console.warn("Push notifications permission not granted");
        return;
      }

      await PushNotifications.register();
      PushNotifications.addListener("registration", ({ value }) => {
        storePushToken(value);
        console.log("Native push token registered", value);
      });

      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        console.log("Foreground notification", notification);
      });

      PushNotifications.addListener("pushNotificationActionPerformed", (notification) => {
        console.log("Notification action performed", notification);
        handleNotificationAction(notification.notification?.data || notification.data || {});
      });
    } catch (error) {
      console.warn("Push notifications registration failed", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!isNativeApp) return;
    registerPushNotifications();
  });

  window.handleNotificationAction = handleNotificationAction;
})();
