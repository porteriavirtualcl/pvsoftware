import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'cl.porteriavirtual.app',
  appName: 'Portería Virtual',
  webDir: 'dist',

  // Use https scheme so the WebView origin is "https://localhost".
  // Required for Firebase Auth, Service Workers, and matches the CORS allowlist
  // we set up in server.cjs.
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
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

  ios: {
    contentInset: 'automatic',
  },

  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
    Keyboard: {
      // `Native` tells Android to resize the WebView itself (adjustResize) so
      // `100dvh` shrinks when the keyboard opens — the modal then scrolls the
      // focused input into view instead of pushing the form off-screen.
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
    // Android 15+ enforces edge-to-edge. This plugin applies WindowInsets so the
    // WebView is padded below the status bar and above the navigation bar.
    // Use the dark surface so no white flash occurs when the OS is in dark mode.
    // The StatusBar plugin overrides this at runtime for the light theme.
    EdgeToEdge: {
      backgroundColor: '#020617',
    },
  },
};

export default config;
