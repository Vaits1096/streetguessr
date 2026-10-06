import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

// http://localhost:XXXX/?emulador usa los emuladores locales de Firebase (ver README) en vez del proyecto real.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
export const useEmulator = local && new URLSearchParams(location.search).has('emulador');

const config = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-calles', appId: 'demo' }
  : firebaseConfig;
export const configured = useEmulator || !String(firebaseConfig.apiKey).startsWith('TU_');

export const app = configured ? initializeApp(config) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;
if (auth) auth.languageCode = 'es';
if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
