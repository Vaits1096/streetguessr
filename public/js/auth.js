// Inicio de sesión con Google o con correo + contraseña (con verificación del correo).
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth, useEmulator } from './firebase.js';
import { $, setError, toast } from './ui.js';

const ERRORS = {
  'auth/invalid-email': 'El correo no es válido.',
  'auth/missing-password': 'Escribe la contraseña.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/email-already-in-use': 'Ya hay una cuenta con ese correo. Entra con él o recupera la contraseña.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
  'auth/user-disabled': 'Esta cuenta está desactivada.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un poco y vuelve a probar.',
  'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
  'auth/account-exists-with-different-credential': 'Ese correo ya está registrado con contraseña. Entra con correo y contraseña.',
  'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains).',
  'auth/operation-not-allowed': 'Este método de acceso no está activado en Firebase.',
};
export const authMessage = e => (e?.code in ERRORS ? ERRORS[e.code] : `Error: ${e?.message || e}`);

// Al pulsar el enlace del correo vuelve a la página del juego
const actionSettings = () => ({ url: location.origin + location.pathname });

export function setupLogin() {
  let mode = 'login';
  $('emuGoogleHint').hidden = !useEmulator;
  const setMode = m => {
    mode = m;
    for (const t of $('authTabs').children) t.classList.toggle('active', t.dataset.mode === m);
    $('password2Row').hidden = m !== 'signup';
    $('emailSubmit').textContent = m === 'signup' ? 'Crear cuenta' : 'Entrar';
    $('forgot').hidden = m === 'signup';
    $('password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('authTitle').textContent = m === 'signup' ? 'Crea tu cuenta' : 'Entra a jugar';
    setError('authError', '');
  };
  for (const t of $('authTabs').children) t.onclick = () => setMode(t.dataset.mode);

  /** Devuelve false si falla (el error queda escrito en la ventana de acceso). */
  const google = async () => {
    setError('authError', '');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
      return true;
    } catch (e) {
      // algunos navegadores móviles bloquean las ventanas emergentes
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider);
        return true;
      }
      const msg = authMessage(e);
      setError('authError', msg);
      return !msg;   // cerrar la ventana de Google no es un error
    }
  };
  $('googleBtn').onclick = google;
  getRedirectResult(auth).catch(e => setError('authError', authMessage(e)));

  $('emailForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('email').value.trim();
    const pass = $('password').value;
    setError('authError', '');
    if (mode === 'signup' && pass !== $('password2').value) return setError('authError', 'Las contraseñas no coinciden.');
    const btn = $('emailSubmit');
    btn.disabled = true;
    try {
      if (mode === 'signup') {
        const { user } = await createUserWithEmailAndPassword(auth, email, pass);
        await sendEmailVerification(user, actionSettings());
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
    } catch (err) {
      setError('authError', authMessage(err));
    } finally {
      btn.disabled = false;
    }
  };

  $('forgot').onclick = async () => {
    const email = $('email').value.trim();
    if (!email) return setError('authError', 'Escribe tu correo arriba y vuelve a pulsar aquí.');
    try {
      await sendPasswordResetEmail(auth, email, actionSettings());
      toast(`Te hemos enviado un correo a ${email} para cambiar la contraseña.`, 6000);
    } catch (err) {
      setError('authError', authMessage(err));
    }
  };

  return { setMode, google };
}

/**
 * Pantalla de verificación. `onVerified` se llama cuando el correo ya está verificado
 * (después de refrescar el token para que las reglas de Firestore lo vean).
 */
export function setupVerify(onVerified) {
  let timer = null;
  const check = async (manual = false) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await user.reload();
      if (auth.currentUser.emailVerified) {
        stop();
        await auth.currentUser.getIdToken(true);
        onVerified(auth.currentUser);
      } else if (manual) {
        setError('verifyError', 'Todavía no aparece como verificado. Abre el enlace del correo (mira también en spam).');
      }
    } catch (e) {
      if (manual) setError('verifyError', authMessage(e));
    }
  };
  const stop = () => { clearInterval(timer); timer = null; };

  $('verifyCheck').onclick = () => check(true);
  $('verifyResend').onclick = async () => {
    try {
      await sendEmailVerification(auth.currentUser, actionSettings());
      toast('Correo reenviado.');
    } catch (e) {
      setError('verifyError', authMessage(e));
    }
  };
  $('verifyLogout').onclick = () => { stop(); signOut(auth); };

  // Con los emuladores no se envían correos: el enlace se pide a la API del emulador y se "abre" desde aquí
  $('verifyEmuRow').hidden = !useEmulator;
  $('verifyEmu').onclick = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${auth.app.options.projectId}/oobCodes`);
      const { oobCodes = [] } = await res.json();
      const code = oobCodes.reverse().find(c => c.requestType === 'VERIFY_EMAIL' && c.email === auth.currentUser.email);
      if (!code) return setError('verifyError', 'El emulador no tiene ningún enlace para este correo. Pulsa «Reenviar correo».');
      await fetch(code.oobLink, { mode: 'no-cors' });
      await check(true);
    } catch (e) {
      setError('verifyError', `No se ha podido verificar con el emulador: ${e.message}`);
    }
  };

  return {
    open(user) {
      $('verifyEmail').textContent = user.email;
      setError('verifyError', '');
      stop();
      timer = setInterval(check, 4000);
    },
    stop,
  };
}

export const logout = () => signOut(auth);
