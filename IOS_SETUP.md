# Shipping Lumi to the App Store

The app is already a working web app. Capacitor wraps it into a native iOS app. Here's the whole path.

## 0. Prerequisites (one-time)
- A Mac with **Xcode** installed (Mac App Store, free).
- **Node.js** and **CocoaPods**: `sudo gem install cocoapods`
- An **Apple Developer account** ($99/yr) — apple.com/developer.

## 1. Generate the iOS project (one command)
```bash
cd glowup
bash setup-ios.sh
```
This installs Capacitor, copies the web app into `www/`, creates the native `ios/` project, and syncs. Then:
```bash
npx cap open ios   # opens the project in Xcode
```
In Xcode: **Signing & Capabilities → Team** (your Apple ID), pick a simulator or your plugged-in iPhone, press ▶. Lumi runs natively.

## 2. Add paid subscriptions (REQUIRED for the App Store)
Apple does **not** allow Stripe for digital subscriptions inside an iOS app — you must use **In-App Purchase**. The painless way is **RevenueCat** (free up to ~$2.5k/mo tracked revenue):

1. Create the subscription product in **App Store Connect** → your app → Subscriptions:
   - Product ID: `lumi_pro_weekly`
   - Price: $6.99/week · Introductory offer: **3-day free trial**
2. Sign up at **revenuecat.com**, create a project, paste your App Store shared secret, add the `lumi_pro_weekly` product to an entitlement called `pro`.
3. Add the plugin:
   ```bash
   npm install @revenuecat/purchases-capacitor
   npx cap sync
   ```
4. In `app.js`, replace the `btn-trial` handler with the native purchase call (RevenueCat docs: `Purchases.purchasePackage`) and unlock on success — the rest of the gating (`isPro()` / `setPro()`) already works. Keep the **Stripe** path for the web build.

> Net: **web visitors pay via Stripe; iOS users pay via Apple/RevenueCat.** Same paywall UI, two checkout backends.

## 3. App Store submission checklist
- **Icons & launch screen:** generate from a 1024×1024 PNG (`@capacitor/assets` or Xcode asset catalog).
- **Screenshots:** use the 6 from `APP_STORE_LISTING.md` (6.7" + 6.5" + 5.5" sizes).
- **Listing copy:** paste from `APP_STORE_LISTING.md`.
- **Privacy:** point App Privacy questions to `privacy.html`; because analysis is on-device, you can truthfully select "Data Not Collected" for photos. Host `terms.html` + `privacy.html` at public URLs and link them in App Store Connect.
- **Review notes:** state clearly "cosmetic skincare guidance, not a medical device." This is why we kept all medical-diagnosis language out — it avoids Guideline 1.4 (medical) and 4.1 (copycat) rejections.
- **Age rating:** 4+ (or 12+ if you add user-generated content later).

## 4. After approval
Ship the TestFlight build first (`Product → Archive` in Xcode → upload), test the trial→paid flow on a real device with a sandbox account, then submit for review. Then turn on the content engine (`CONTENT_WEEK1.md`).
