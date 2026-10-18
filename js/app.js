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

function initAuthForm() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;

  const mode = form.dataset.authForm;
  const status = document.querySelector("[data-form-status]");

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
  const panel = document.querySelector("[data-phone-panel]");
  if (!panel) return;
  const status = document.querySelector("[data-form-status]");
  const toggle = document.querySelector("[data-phone-toggle]");
  const phoneInput = panel.querySelector("#phone");
  const codeInput = panel.querySelector("#smsCode");
  const sendBtn = panel.querySelector("[data-phone-send]");
  const confirmBtn = panel.querySelector("[data-phone-confirm]");
  let confirmation = null;

  if (toggle) {
    toggle.dataset.labelShow = toggle.textContent;
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.textContent = panel.hidden ? toggle.dataset.labelShow : "Hide phone option";
      if (!panel.hidden) phoneInput?.focus();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const phone = String(phoneInput?.value || "").trim();
      if (!phone) {
        if (status) status.textContent = "Enter your phone number first (international format).";
        return;
      }
      sendBtn.disabled = true;
      try {
        const { sendPhoneCode } = await loadFirebaseAuth();
        confirmation = await sendPhoneCode(phone, status);
        if (confirmBtn) confirmBtn.hidden = false;
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

  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      if (!confirmation) {
        if (status) status.textContent = "Tap \"Send code\" first, then enter the SMS code.";
        return;
      }
      const code = String(codeInput?.value || "").trim();
      if (!code) {
        if (status) status.textContent = "Enter the code from the SMS.";
        return;
      }
      confirmBtn.disabled = true;
      try {
        const { confirmPhoneCode } = await loadFirebaseAuth();
        await confirmPhoneCode(confirmation, code, status);
      } catch (error) {
        if (status && !String(status.textContent).includes("Redirecting")) {
          status.textContent = error?.message || "Verification failed. Please try again.";
        }
      } finally {
        confirmBtn.disabled = false;
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
