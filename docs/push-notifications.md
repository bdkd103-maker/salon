# Push Notifications for Android and iOS

This app uses Capacitor and the Capacitor Push Notifications plugin as the native notification bridge for Android and iOS.

## Architecture

- Android: Firebase Cloud Messaging (FCM)
- iOS: Apple Push Notification service (APNs)
- Frontend: Capacitor notification registration and permission requests
- Backend: stores device tokens and sends push messages to the correct platform

## Android (Firebase Cloud Messaging)

### 1. Create Firebase project

1. Create a Firebase project in the Firebase console.
2. Add Android app with the same package id as the Capacitor app: `com.salon.app`
3. Download `google-services.json`.
4. Place it in `android/app/`.

### 2. Add Android Gradle plugin

In `android/build.gradle`:

```gradle
buildscript {
  dependencies {
    classpath 'com.google.gms:google-services:4.4.2'
  }
}
```

In `android/app/build.gradle`:

```gradle
apply plugin: 'com.google.gms.google-services'
```

### 3. Register the app

After `npx cap sync android`, build the app with the Firebase config included.

### 4. Device token flow

The app asks for permission and registers the token with `PushNotifications.register()`.

The backend should receive the token and store it by user with platform info:

```json
{
  "userId": "...",
  "platform": "android",
  "token": "...",
  "createdAt": "2026-08-28T00:00:00.000Z"
}
```

### 5. Background and foreground behavior

For Android, notification handling is handled by the native Firebase layer. In the app, the push plugin listens for:

- `registration`
- `pushNotificationReceived`
- `pushNotificationActionPerformed`

This allows the app to process notifications while open and route the user to the right screen when tapped.

## iOS (APNs)

### 1. Enable push notifications in Xcode

1. Open the iOS project in Xcode.
2. Select the app target.
3. Enable `Signing & Capabilities`.
4. Add `Push Notifications`.
5. Add `Background Modes` if needed for silent or background actions.

### 2. Create APNs auth

Use either:

- an APNs certificate, or
- a p8 key generated in Apple Developer

The backend then sends push payloads to the APNs server based on the token received from the app.

### 3. iOS permission request

On iOS, the app must request permission before registration.

Example flow:

```js
const permission = await PushNotifications.requestPermissions();
if (permission.receive === 'granted') {
  await PushNotifications.register();
}
```

### 4. Device token flow

`PushNotifications.addListener('registration', ...)` returns the iOS device token. Store it server-side and map it to the user account.

## Backend requirements

The backend should expose an endpoint such as:

```http
POST /api/v1/device-tokens
```

Payload:

```json
{
  "platform": "android",
  "token": "...",
  "userId": "..."
}
```

The backend should also support sending push notifications to a user's registered devices for:

- booking confirmation
- booking reminder
- booking status change
- cancellation notice
- salon message delivery

## Notification handling

### When app is open

Foreground notifications should still be received in the app via:

```js
PushNotifications.addListener('pushNotificationReceived', (notification) => {
  console.log(notification);
});
```

### When app is in background

The OS handles background delivery. Tapping the notification should open the app and deep-link to the intended section.

### When app is closed

The native platform launches the app on tap. The app can inspect the notification payload and redirect to the relevant route.

## Deep linking

Use notification data payloads such as:

```json
{
  "bookingId": "uuid",
  "salonId": "uuid",
  "route": "booking",
  "type": "booking-confirmed"
}
```

Then resolve with:

```js
if (bookingId) {
  window.location.href = `index.html#booking?bookingId=${encodeURIComponent(bookingId)}`;
}
```

This ensures that a push notification can open the correct appointment or salon view.

## Recommended next steps for this repo

1. Run `npm install` to include the Capacitor push package.
2. Sync native platforms with `npx cap sync`.
3. Configure Firebase for Android and APNs for iOS.
4. Add a backend endpoint to store device tokens.
5. Trigger push messages from booking and salon events.
6. Add deep-link handling for booking confirmation and reminders.

## Important security note

Do not store raw push tokens in plain front-end local storage for production authorization flows. Use server-side storage tied to authenticated users, and treat device tokens as sensitive push registration data under privacy laws such as GDPR.
