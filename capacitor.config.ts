import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cl.porteriavirtual.app',
  appName: 'Portería Virtual',
  webDir: 'dist',

  // Use https scheme so the WebView origin is "https://localhost".
  // Required for Firebase Auth, Service Workers, and matches the CORS allowlist
  // we set up in server.cjs.
  server: {
    androidScheme: 'https',
    // Hosts the WebView is allowed to navigate to (Firebase Auth handshakes,
    // OAuth redirects, our Hostinger backend).
    allowNavigation: [
      'app.porteriavirtual.cl',
      '*.firebaseapp.com',
      '*.googleapis.com',
      'accounts.google.com',
    ],
  },

  android: {
    // Allow Cleartext is false by default; we don't need it (Hostinger is HTTPS).
    allowMixedContent: false,
  },

  plugins: {
    FirebaseAuthentication: {
      // Only enable Google provider on native (mirrors what we use in Login.tsx).
      // Skip auto-link so the plugin uses the same Firebase Auth session as the JS SDK.
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
