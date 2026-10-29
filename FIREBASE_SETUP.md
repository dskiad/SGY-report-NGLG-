# Shared entries on the GitHub page

The GitHub Pages copy (https://dskiad.github.io/SGY-report-NGLG-/) shares entries through a free Firebase project.
Until `FB_CONFIG` is filled in, the page saves entries only on each device.

1. Go to https://console.firebase.google.com → **Add project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
   Then **Settings → Authorized domains → Add domain**: `dskiad.github.io`.
3. **Build → Firestore Database → Create database** (production mode, any EU location).
   Open **Rules**, paste `firestore.rules` from this repo, replace the example emails with the
   editors' Google addresses, and **Publish**.
4. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app, no hosting.
   Copy the `firebaseConfig` object.
5. In `index.html`, replace `const FB_CONFIG=null;` with that object, e.g.
   `const FB_CONFIG={apiKey:'…',authDomain:'….firebaseapp.com',projectId:'…',appId:'…'};`
   (The web config is not a secret; access is controlled by the rules.)

Editors press **Σύνδεση Google** on the page. Accounts not in the rules keep a device-only copy.
To add or remove an editor later, edit the email list in the Firestore rules and publish.
