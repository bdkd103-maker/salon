# Salon

This project is a static salon web app that has been prepared for native mobile packaging using Capacitor without rewriting the existing business logic.

## Current state

- Web app: index.html, women.html, customer-profile.html
- Native wrapper: Capacitor
- Android project: android/
- iOS project: ios/
- Web assets for native wrapper: www/

## Local development

```bash
npm install
npm run serve
```

Then open:
- http://localhost:8000/

## Mobile sync and tooling

```bash
npm run cap:sync
npm run cap:doctor
npm run android:open
npm run ios:open
```

## Android build

On a machine with a compatible JDK installed:

```bash
npm run android:debug
```

For a release build, use the Android signing flow and then:

```bash
npm run android:release
```

## iOS build

iOS requires macOS and Xcode. After opening the project:

```bash
npm run ios:open
```

Then build the app in Xcode and configure signing and provisioning.

## Push notifications for Android and iOS

The app includes a native-ready notification bootstrap for Capacitor. The implementation is designed to register the device token, request permissions, and route notification actions to the correct screen or booking flow.

### Required setup

- Android: Firebase Cloud Messaging and `google-services.json`
- iOS: APNs certificates or a push key and `Apple Push Notification service` entitlement
- Backend: send device token to your API and trigger push messages for booking confirmations, reminders, and status updates

See the full setup guide in [docs/push-notifications.md](docs/push-notifications.md).

## Production checklist

- Use Java 17/21 compatible with Gradle in the local environment.
- Configure Android signing keystore and release config.
- Configure Apple signing and provisioning profiles.
- Add Google services configuration for Firebase Cloud Messaging.
- Add APNs certificates or keys for iOS push notifications.
- Verify app icons, splash screens, app metadata, and app ids.
- Test all flows in the mobile shell before release.

## Important note

The web app remains the source of business logic. Capacitor is used as the native shell for packaging and distribution, preserving the current app behavior while enabling Android and iOS distribution.
