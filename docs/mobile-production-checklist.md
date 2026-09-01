# Mobile Production Checklist for Salon

## Scope
This project is a static web app wrapped in Capacitor. It is not a backend-powered app and does not have a database or server-side API. This means the mobile build is a packaging shell around the current HTML/CSS/JS implementation.

## Verified state
- `npm run cap:sync` succeeds
- `npm run cap:doctor` reports Android is healthy
- `npx cap doctor` reports Xcode is not installed in this machine
- Android debug build currently fails due to local Java/Gradle incompatibility (`Unsupported class file major version 69`), which is an environment issue, not a project-code issue

## Android APK / AAB production readiness

### 1. Android app identity
- Application ID: `com.salon.app`
- App name: `صالونك`
- Version name: `1.0.0`
- Version code: `1`
- Min SDK: `24` (already set in Android project)
- Target SDK: `36` (already set in Android project)
- Compile SDK: `36` (already set in Android project)

### 2. Android release build process
Run on a Linux machine with a compatible JDK:

```bash
cd /workspaces/salon
npm install
npx cap sync
cd android
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$JAVA_HOME/bin:$PATH
./gradlew clean
./gradlew assembleDebug
./gradlew assembleRelease
```

### 3. Android release signing
Create a keystore and configure the project:

```bash
cd /workspaces/salon/android
keytool -genkeypair -v \
  -keystore salon-release.keystore \
  -alias salon_release \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Create `keystore.properties`:

```properties
storeFile=../salon-release.keystore
storePassword=CHANGE_ME
keyAlias=salon_release
keyPassword=CHANGE_ME
```

### 4. Android build outputs
- APK: `android/app/build/outputs/apk/release/`
- AAB: `android/app/build/outputs/bundle/release/`

### 5. Google Play requirements overview
Google Play requires:
- valid app signing configuration
- a release keystore and matching upload key
- a signed AAB or APK
- privacy policy if personal data is handled
- Play Console account and developer registration
- target API compatibility and security requirements
- app access rules if the app collects personal information
- proper permissions and privacy disclosures

This project currently stores data in `localStorage` only and does not have a server-side backend or real user database. That is acceptable as a prototype, but not for a secure production-grade identity or auth system.

## iOS app readiness plan

### 1. iOS app identity
- Bundle identifier: `com.salon.app`
- Display name: `صالونك`
- Version: `1.0`
- Build number: `1`
- Deployment target: `iOS 15.0` (already present in the generated Xcode project)

### 2. Required environment
This requires a Mac with Xcode installed and an Apple Developer account for signing and distribution.

### 3. iOS build commands
On macOS:

```bash
cd /workspaces/salon
npm install
npx cap sync
npx cap open ios
```

Then in Xcode:
- set Signing & Capabilities
- set Bundle Identifier
- set Version and Build
- choose your Apple Developer team
- build and archive

### 4. iOS app config notes
The generated Xcode project already contains:
- deployment target `15.0`
- product bundle identifier `com.salon.app`
- launch screen configured
- Portrait/Landscape orientation settings in Info.plist

### 5. iOS-specific requirements
For a real app store build, Apple requires:
- Apple Developer Program membership
- valid signing certificate
- valid provisioning profile
- App Store Connect app record
- privacy manifest and data handling declarations as applicable

No certificate or Apple credentials were created in this workspace, because that would require an Apple Developer account and a real signing environment.

## App assets
The repository currently does not include a final branded asset set. The project already has generated Capacitor native structure and launch assets placeholders, but a final production icon set should be designed and replaced before release.

### Required asset sets
- Android app icon
- Android adaptive icon foreground/background
- Android splash screen assets
- iOS AppIcon set
- iOS LaunchScreen assets
- optional Store listing graphics

### Placeholder policy
Because there is no final visual identity defined, the project should use a clean, neutral placeholder asset package until the real brand assets are approved.

Files to replace later:
- `android/app/src/main/res/mipmap-*/*`
- `android/app/src/main/res/drawable/splash.png`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/*`
- `ios/App/App/Assets.xcassets/Splash.imageset/*`

## Backend and database review
This project is not backed by a real server, API layer, or database.

### Current behavior
- persisted in browser `localStorage`
- no authenticated backend session
- no server-side authorization
- no persistent multi-user database
- no real message delivery system
- no password hashing or secure storing of personal data

### Production risk
This is acceptable only for a local prototype or demo. It is not enough for production-grade mobile app deployment where personal data, booking data, and account records must be secure, multi-user, and persistent across devices.

## Recommended next production step
The safe next phase is:
1. resolve Java 17 + Gradle compatibility for Android
2. generate signed release build for APK/AAB
3. open the iOS project on a Mac with Xcode
4. provide Apple signing steps using an actual Apple Developer account
5. replace placeholder asset pack with final brand assets
6. add a real backend and database before handling real user accounts or personal data in production

## Files relevant to the current mobile setup
- [capacitor.config.json](../capacitor.config.json)
- [android/app/build.gradle](../android/app/build.gradle)
- [android/app/src/main/AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml)
- [android/variables.gradle](../android/variables.gradle)
- [ios/App/App/Info.plist](../ios/App/App/Info.plist)
- [ios/App/App.xcodeproj/project.pbxproj](../ios/App/App.xcodeproj/project.pbxproj)
