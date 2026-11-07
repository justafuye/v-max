# V-MAX

V-MAX is a React and Vite music discovery app. It can play audio files you own or have permission to use, generated demo tones, YouTube videos through YouTube's official embedded player when search is configured, and Spotify tracks through Spotify's Web Playback SDK when configured and eligible.

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173/` for local development.

## Set up Firebase and Creator Studio

1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
2. In **Project settings → General**, add a **Web app** and copy its web configuration.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. Create a **Firestore Database** and enable **Storage** in the Firebase console.
5. Add the web app values to the root `.env.local` file:

   ```env
   VITE_FIREBASE_API_KEY=your_firebase_web_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_APP_ID=your_firebase_web_app_id
   VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
   ```

   Copy the exact Storage bucket name shown in Firebase project settings; older projects may use a `*.appspot.com` bucket.
6. Deploy the rules in `firestore.rules` and `storage.rules`. With the Firebase CLI installed and authenticated, run `firebase use --add` to select your project, then `firebase deploy --only firestore:rules,storage`.
7. Restart Vite, create an account, and open **Creator Studio**.

Firebase web configuration is used by browser apps and is not an admin credential. The included security rules allow public reads of published creator profiles/tracks/playlists and restrict writes to the authenticated owner. Creator Studio supports profiles, audio publishing (up to 50 MB), genre discovery, follows, comments, public playlists with share links, opt-in offline downloads, and approximate play-start analytics. Creators must attest they have permission to publish each upload. There is no content moderation workflow, verified-artist program, rights review, or dispute process yet; do not launch open uploads publicly until those operations are in place.

Play-start analytics are client-reported and are not verified streams, royalty statements, or payout calculations. V-MAX does not yet accept or distribute creator royalties. Subscription/donation checkout and ads also remain setup previews until payment/ad providers and required server-side verification are integrated. The Firebase rules are provided in this project, but you must deploy them to your own Firebase project before using the features.

On the first V-MAX launch in a browser, a welcome screen lets listeners choose music genres and moods. Curated V-MAX picks, mixes, and track stories are filtered to match; when both genres and moods are selected, a track must match at least one selected genre and one selected mood. The external US trending chart is independent of these preferences. Change picks from **Home → Edit your music picks**. Catalog/YouTube searches and tracks you imported, liked, or previously saved are not recommendations and remain available. This is V-MAX's own onboarding and does not copy another platform's interface. It appears on first launch because browsers do not provide a reliable event for showing onboarding at the exact moment a PWA is installed.

## Install V-MAX

V-MAX is a Progressive Web App. Build and deploy the `dist` folder to a host that serves the site over HTTPS. On desktop Chrome or Edge, open the deployed site and use **Install app** in the address bar or browser menu. On Android Chrome, choose **Install app** or **Add to Home screen** from the browser menu. On iPhone/iPad, open the HTTPS site in Safari, tap **Share**, then **Add to Home Screen**. The V-MAX multicolor equalizer mark is used for the favicon and install icons. The app shell is cached for basic offline opening after the site has loaded once; online music search and streaming still need a connection.

## Monetization setup

The **Support V-MAX** page is a setup preview for a future subscription, voluntary donations, and sponsored ad placements. These controls do not currently process payments, create memberships, serve ads, or generate revenue. Before accepting money, connect a payment provider using a secure server-side integration; do not put payment secrets in browser environment variables. Set membership pricing, benefits, cancellation and refund terms before launch. To serve ads, configure an ad provider and complete its site approval, consent, and placement requirements. Keep third-party music players and content compliant with their respective terms.

## Connect Spotify

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/) and copy its **Client ID**.
2. In the Spotify app settings, add the exact V-MAX redirect URI:
   - Local development: `http://127.0.0.1:5173/`
   - Deployed app: its full HTTPS origin, for example `https://your-domain.example/`
3. Add the Client ID to the root `.env.local` file:

   ```env
   VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
   VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/
   ```

   `VITE_SPOTIFY_REDIRECT_URI` is optional when it matches the site's origin; set it explicitly if your deployed app's redirect URI differs from the origin. Do not add a Spotify Client Secret to this browser app.
4. Restart Vite, open V-MAX at the matching redirect origin, and select **Connect** in the sidebar (or **Connect Spotify** in search results). Approve Spotify's requested permissions.
5. Search for a track and select it to stream. Spotify playback requires an eligible Spotify Premium account and is subject to catalog availability, Spotify app access, and playback restrictions. In development mode, the Spotify app owner may need Premium and listener accounts may need to be added to the app's user allowlist.

V-MAX uses Spotify Authorization Code with PKCE and the official Web Playback SDK. In **Your library**, connect Spotify to view your recently played tracks. The access session stays in the current browser tab. If you have connected before this feature was added, disconnect and reconnect so Spotify can grant the recently played permission. Use **Disconnect** in Spotify search to clear the session. iOS playback requires a user gesture. Spotify's developer terms require prior written approval to use the Web Playback SDK in a commercial project; review its [Developer Terms](https://developer.spotify.com/terms) and [Developer Policy](https://developer.spotify.com/policy) before a public or commercial launch. See Spotify's [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk), and [redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

V-MAX lets users search song metadata without signing in through Apple's public iTunes Search API and browse the US top-songs chart from the **Trending** tab or **Discover**. The chart refreshes when V-MAX opens, at local midnight, and when you press **Refresh**. Apple search and chart results are information only: selecting one does not open Apple Music or play audio. Spotify search results can be played through Spotify when the integration is configured and the account is eligible.

## Test YouTube playback

Type a song or artist into V-MAX's main search box. Matching YouTube video results appear automatically in the **YouTube videos** section; choose a result to play it in YouTube's official embedded player.

To enable YouTube search, enable **YouTube Data API v3** in a Google Cloud project, create an API key, restrict it to the YouTube Data API and the V-MAX development website referrers (including `http://127.0.0.1:5173/*`), then add it to `.env.local`:

```env
VITE_YOUTUBE_API_KEY=your_restricted_api_key
```

Restart Vite after changing `.env.local`. Without this key, video search cannot run. Browser API keys are visible to users, so use HTTP referrer and API restrictions and monitor quota. YouTube search finds videos, not the YouTube Music licensed catalog; full-song availability and embedding depend on each video. Playback stays in the official YouTube player and follows [YouTube API terms](https://developers.google.com/youtube/terms/api-services-terms-of-service).

Open **Your library → Add audio files** to add and play audio you own or have permission to use. V-MAX shows an activity indicator while files are being saved. Audio stays in the browser's IndexedDB storage and is not uploaded to a server. Likes, the generated playlist, and listening history are saved in this browser. Clearing site data removes the local library. Supported formats depend on the browser. Browser installation APIs do not expose a percentage-complete value, so V-MAX shows an installing status while the browser completes the install instead.

Click the artwork or track details in the bottom player to open the full-screen **Now Playing** view. It includes track artwork, progress seeking, likes, previous/next controls, and the current queue. Local files play their full audio; built-in V-MAX demo picks use generated demo tones, not commercial recordings. Spotify playback is streamed by Spotify and is not downloaded by V-MAX.

V-MAX uses its own dark, chart-focused discovery design and local creator tools inspired by music platforms such as Audiomack. It is not an Audiomack integration: it does not search Audiomack's catalog or stream its tracks, and its audio upload button imports files only into this browser's personal library. Audiomack catalog access requires Audiomack's explicit API/partnership authorization.

Spotify or YouTube accounts do not grant V-MAX permission to download or redistribute catalog tracks. V-MAX cannot download Spotify catalog tracks for offline listening; local audio import is for files the listener owns or has permission to use.
