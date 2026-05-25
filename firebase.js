// ---------------------------
// FIREBASE INITIALIZATION
// ---------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCfoaPyX6nxJm9I28oTWm4MxhNDHkZWmMo",
  authDomain: "nuvvunenu-cf326.firebaseapp.com",
  projectId: "nuvvunenu-cf326",
  storageBucket: "nuvvunenu-cf326.firebasestorage.app",
  messagingSenderId: "178972908907",
  appId: "1:178972908907:web:475180e1fb38599cae802e",
  measurementId: "G-FHQ8DL88M3"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Enable offline persistence (caches data to IndexedDB to save reads!)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

// Storage for voice notes / shared media
export const storage = getStorage(app);

// SINGLE clean provider
export const googleProvider = new GoogleAuthProvider();

// LOGIN FUNCTIONS
export function googleLogin() {
  return signInWithPopup(auth, googleProvider);
}

export function loginEmail(email, pass) {
  return signInWithEmailAndPassword(auth, email, pass);
}

export function signupEmail(email, pass) {
  return createUserWithEmailAndPassword(auth, email, pass);
}

// MAKE ACCESSIBLE (optional)
window.googleLogin = googleLogin;
window.loginEmail = loginEmail;
window.signupEmail = signupEmail;
