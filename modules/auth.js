// auth.js — FIXED & CLEANED 🔥
// Uses modular Firebase ONLY

import {
  auth,
  db,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "./firebase.js";

import {
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isAuthenticated = false;

    this.googleProvider = new GoogleAuthProvider();
    this.googleProvider.addScope("email");
    this.googleProvider.addScope("profile");

    this.init();
  }

  init() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        await this.ensureFirestoreUser(user);
        this.currentUser = user;
        this.isAuthenticated = true;

        localStorage.setItem("currentUser", JSON.stringify(user));
        window.dispatchEvent(new CustomEvent("auth:login", { detail: user }));

        // ⭐ FIX — REDIRECT TO HOME PAGE
        import("./app.js").then(() => {
          if (window.loadPage) {
            loadPage("feed");  // Go to Home page automatically
          }
        });
      } 
      else {
        this.currentUser = null;
        this.isAuthenticated = false;
        localStorage.removeItem("currentUser");
        window.dispatchEvent(new CustomEvent("auth:logout"));
      }
    });
  }

  async ensureFirestoreUser(user) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const username = user.email.split("@")[0];

      await setDoc(ref, {
        uid: user.uid,
        email: user.email,
        username,
        avatar: user.photoURL || "",
        followers: [],
        following: [],
        searchKeywords: generateKeywords(username)
      });

      console.log("🔥 Firestore user created");
    }
  }

  // EMAIL LOGIN
  async loginWithEmail(email, pass) {
    return await signInWithEmailAndPassword(auth, email, pass);
  }

  // EMAIL SIGNUP
  async signUp(email, pass) {
    const userCred = await createUserWithEmailAndPassword(auth, email, pass);
    await this.ensureFirestoreUser(userCred.user);
    return userCred;
  }

  // GOOGLE LOGIN
  async signInWithGoogle() {
    const result = await signInWithPopup(auth, this.googleProvider);
    await this.ensureFirestoreUser(result.user);
    return result.user;
  }

  async logout() {
    await signOut(auth);
  }
}

const authManager = new AuthManager();
export { authManager };

window.authManager = authManager;

// =======================================================
// 🍎 LOGIN SCREEN RENDER
// =======================================================
export function render() {
  return `
    <div class="auth-wrapper">
      <div class="auth-card glass-blur">

        <h1 class="auth-title">Welcome</h1>
        <p class="auth-subtitle">Sign in to continue</p>

        <input id="login-email" class="auth-input" placeholder="Email">
        <input id="login-password" class="auth-input" type="password" placeholder="Password">

        <button class="auth-btn" onclick="loginUser()">Sign In</button>

        <button class="google-btn" onclick="googleLogin()">
          <i class="fab fa-google"></i> Continue with Google
        </button>

        <div class="divider"><span>OR</span></div>

        <input id="signup-email" class="auth-input" placeholder="Create Email">
        <input id="signup-password" class="auth-input" type="password" placeholder="Create Password">

        <button class="auth-btn subtle" onclick="signUp()">Create Account</button>

      </div>
    </div>
  `;
}

// LOGIN
window.loginUser = async function () {
  const email = document.getElementById("login-email").value;
  const pass = document.getElementById("login-password").value;

  try {
    await authManager.loginWithEmail(email, pass);
  } catch (e) {
    alert(e.message);
  }
};

// SIGNUP
window.signUp = async function () {
  const email = document.getElementById("signup-email").value;
  const pass = document.getElementById("signup-password").value;

  try {
    await authManager.signUp(email, pass);
  } catch (e) {
    alert(e.message);
  }
};

// GOOGLE
window.googleLogin = async function () {
  try {
    await authManager.signInWithGoogle();
  } catch (e) {
    alert(e.message);
  }
};

// KEYWORD GENERATOR
function generateKeywords(username) {
  let lower = username.toLowerCase();
  let arr = [];
  for (let i = 1; i <= lower.length; i++) arr.push(lower.slice(0, i));
  return arr;
}


