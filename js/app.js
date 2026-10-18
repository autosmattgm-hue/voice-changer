import { apiFetch, setSession, clearToken } from "./api.js";

function loadFirebaseAuth() {
  return import("./firebase-auth.js");
}

// Codes meaning the Firebase project itself can't serve sign-ups (provider disabled,
// domain not authorized, bad key) — safe to fall back to the backend-only register path.
const FIREBASE_DISABLED_CODES = [
  "operation-not-allowed",
  "unauthorized-domain",
  "auth/configuration-not-found",
  "auth/api-key-not-valid"
];

function redirectAfterAuth() {
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next && next.startsWith("/") ? next : "/dashboard.html";
}

async function trackReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref") || localStorage.getItem("mat_referral_code");
    if (ref) {
      localStorage.removeItem("mat_referral_code");
      await apiFetch("/api/earn/track-signup", { method: "POST", body: JSON.stringify({ ref }) }).catch(() => {});
    }
  } catch {}
}

// Shared phone sign-in state: [data-phone-toggle] swaps the form between email
// and phone modes, and the SMS confirmation survives across taps (Send code →
// submit) during phone registration.
let phoneMode = false;
let phoneConfirmation = null;

function applyAuthMode(form) {
  const mode = phoneMode ? "phone" : "email";
  form.querySelectorAll("[data-auth-when]").forEach((wrap) => {
    const show = wrap.dataset.authWhen === "always" || wrap.dataset.authWhen === mode;
    wrap.hidden = !show;
    wrap.querySelectorAll("input").forEach((input) => {
      // The SMS code is validated in JS — it only becomes required after a code is sent.
      if (input.id !== "smsCode") input.required = show;
    });
  });

  const toggle = form.querySelector("[data-phone-toggle]");
  if (toggle) {
    toggle.textContent = phoneMode
      ? toggle.dataset.labelPhoneMode || "Use email instead"
      : toggle.dataset.labelEmailMode || "Use phone instead";
  }

  if (!phoneMode) {
    phoneConfirmation = null;
    const codeInput = form.querySelector("#smsCode");
    if (codeInput) codeInput.value = "";
  }

  const status = document.querySelector("[data-form-status]");
  if (status) {
    status.textContent = phoneMode
      ? form.dataset.authForm === "register"
        ? "Enter your phone number and password, then confirm the SMS code we text you."
        : "Enter your phone number and password to sign in."
      : form.dataset.statusDefault || "";
  }

  if (phoneMode) form.querySelector("#phone")?.focus();
}

async function handlePhoneSubmit(form, mode, status) {
  const phone = String(form.querySelector("#phone")?.value || "").trim().replace(/[\s\-().]/g, "");
  const password = String(form.querySelector("#password")?.value || "");

  if (!/^\+\d{7,15}$/.test(phone)) {
    if (status) status.textContent = "Enter your phone number in international format, e.g. +2348012345678.";
    return;
  }
  if (password.length < 8) {
    if (status) status.textContent = "Password must be at least 8 characters.";
    return;
  }

  if (mode === "login") {
    if (status) status.textContent = "Signing in...";
    try {
      const result = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password })
      });
      setSession(result);
      if (status) status.textContent = "Success. Redirecting...";
      redirectAfterAuth();
    } catch (error) {
      if (status) status.textContent = error.message;
    }
    return;
  }

  // Registration: the first submit sends the SMS code; the second verifies it
  // and creates the account (the password is stored for phone+password login).
  if (!phoneConfirmation) {
    if (status) status.textContent = "Sending SMS code...";
    try {
      const { sendPhoneCode } = await loadFirebaseAuth();
      phoneConfirmation = await sendPhoneCode(phone, status);
      form.querySelector("#smsCode")?.focus();
    } catch (error) {
      if (status && !String(status.textContent).toLowerCase().includes("code sent")) {
        status.textContent = error?.message || "Could not send the code. Please try again.";
      }
    }
    return;
  }

  const code = String(form.querySelector("#smsCode")?.value || "").trim();
  if (!code) {
    if (status) status.textContent = "Enter the code from the SMS.";
    return;
  }
  try {
    const { confirmPhoneCode } = await loadFirebaseAuth();
    await confirmPhoneCode(phoneConfirmation, code, status, {
      name: String(form.querySelector("#name")?.value || "").trim(),
      password
    });
  } catch (error) {
    if (status && !String(status.textContent).includes("Redirecting")) {
      status.textContent = error?.message || "Verification failed. Please try again.";
    }
  }
}

function initAuthForm() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;

  const mode = form.dataset.authForm;
  const status = document.querySelector("[data-form-status]");
  // Keep the original notice text so toggling back from phone mode can restore it.
  if (status) form.dataset.statusDefault = status.textContent;

  const googleBtn = document.querySelector("[data-google-auth]");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      if (googleBtn.disabled) return;
      googleBtn.disabled = true;
      try {
        const { signInWithGoogle } = await loadFirebaseAuth();
        await signInWithGoogle(status);
      } catch (error) {
        if (status && !String(status.textContent).includes("Redirecting")) {
          status.textContent = error?.message || "Google sign-in failed. Please try again.";
        }
      } finally {
        googleBtn.disabled = false;
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (phoneMode) {
      await handlePhoneSubmit(form, mode, status);
      return;
    }

    if (status) status.textContent = "Submitting...";

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    if (mode === "register") {
      try {
        const { registerWithEmail } = await loadFirebaseAuth();
        // Creates the Firebase account, emails the verification link, opens the
        // backend session (auto-persists the user in Firestore) and redirects.
        await registerWithEmail(payload.name, payload.email, payload.password, status);
        return;
      } catch (error) {
        const code = String(error?.code || "");
        const firebaseDisabled = FIREBASE_DISABLED_CODES.some((c) => code.includes(c));
        const importFailure = !code && !error?.status; // CDN unreachable — no server response involved
        if (!firebaseDisabled && !importFailure) {
          if (status) status.textContent = error?.message || "Signup failed. Please try again.";
          return;
        }
        if (status) status.textContent = "Firebase unavailable — creating account directly...";
      }
      try {
        const result = await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setSession(result);
        await trackReferral();
        if (status) status.textContent = "Success. Redirecting...";
        redirectAfterAuth();
      } catch (error) {
        if (status) status.textContent = error.message;
      }
      return;
    }

    try {
      const result = await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSession(result);
      if (status) status.textContent = "Success. Redirecting...";
      redirectAfterAuth();
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  });
}

function initPhoneAuth() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;
  const status = document.querySelector("[data-form-status]");
  const phoneInput = form.querySelector("#phone");
  const codeInput = form.querySelector("#smsCode");
  const sendBtn = form.querySelector("[data-phone-send]");
  const toggle = form.querySelector("[data-phone-toggle]");

  if (toggle) {
    toggle.addEventListener("click", () => {
      phoneMode = !phoneMode;
      applyAuthMode(form);
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const phone = String(phoneInput?.value || "").trim().replace(/[\s\-().]/g, "");
      if (!phone) {
        if (status) status.textContent = "Enter your phone number first (international format).";
        return;
      }
      sendBtn.disabled = true;
      try {
        const { sendPhoneCode } = await loadFirebaseAuth();
        phoneConfirmation = await sendPhoneCode(phone, status);
        codeInput?.focus();
      } catch (error) {
        if (status && !String(status.textContent).toLowerCase().includes("code sent")) {
          status.textContent = error?.message || "Could not send the code. Please try again.";
        }
      } finally {
        sendBtn.disabled = false;
      }
    });
  }
}

function initForgotPassword() {
  const form = document.querySelector("[data-forgot-form]");
  if (!form) return;
  const status = document.querySelector("[data-form-status]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email || !status) return;
    try {
      const { sendPasswordReset } = await loadFirebaseAuth();
      await sendPasswordReset(email, status);
    } catch (error) {
      status.textContent = error?.message || "Could not send the reset email.";
    }
  });
}

function initVerifyBanner() {
  if (!document.querySelector("[data-verify-banner]")) return;
  loadFirebaseAuth()
    .then((m) => m.watchVerificationBanner())
    .catch(() => {});
}

function initLogout() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-logout]")) {
      clearToken();
      window.location.href = "/login.html";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initAuthForm();
  initPhoneAuth();
  initForgotPassword();
  initVerifyBanner();
  initLogout();
});
