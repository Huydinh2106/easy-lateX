"use client";

import { FirebaseError } from "firebase/app";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";

type AuthMode = "sign-in" | "create-account";

function authErrorMessage(error: unknown, mode: AuthMode): string {
  if (!(error instanceof FirebaseError)) return "We couldn't complete that request. Please try again.";

  if (["auth/invalid-credential", "auth/invalid-email", "auth/user-disabled"].includes(error.code)) {
    return "The email or password is incorrect.";
  }
  if (error.code === "auth/email-already-in-use") {
    return "We couldn't create an account with those details. Try signing in instead.";
  }
  if (error.code === "auth/weak-password") return "Use a password with at least 6 characters.";
  if (error.code === "auth/popup-closed-by-user") return "Google sign-in was cancelled.";
  if (error.code === "auth/popup-blocked") return "Allow pop-ups for this site, then try Google again.";
  if (error.code === "auth/network-request-failed") return "Check your connection and try again.";
  if (error.code === "auth/too-many-requests") return "Too many attempts. Wait a moment and try again.";
  return mode === "sign-in"
    ? "We couldn't sign you in. Please try again."
    : "We couldn't create your account. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.loading && auth.user) router.replace("/");
  }, [auth.loading, auth.user, router]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "create-account") {
        await auth.createAccount(name.trim(), email.trim(), password);
      } else {
        await auth.signInWithEmail(email.trim(), password);
      }
      router.replace("/");
    } catch (caught) {
      setError(authErrorMessage(caught, mode));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await auth.signInWithGoogle();
      router.replace("/");
    } catch (caught) {
      setError(authErrorMessage(caught, mode));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await auth.resetPassword(email.trim());
      setNotice("If an account exists for that email, reset instructions are on the way.");
    } catch (caught) {
      setError(authErrorMessage(caught, "sign-in"));
    } finally {
      setSubmitting(false);
    }
  }

  if (auth.loading || auth.user) {
    return (
      <main className="auth-loading" aria-busy="true">
        <LoaderCircle className="spinner" aria-hidden="true" />
        <span>Checking your session…</span>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="auth-brand" href="/" aria-label="Easy LaTeX home">
          <span className="brand-mark" aria-hidden="true">
            TeX
          </span>
          <span>Easy LaTeX</span>
        </a>

        <header className="auth-header">
          <h1 id="auth-title">{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1>
          <p>
            {mode === "sign-in"
              ? "Sign in to continue working on your documents."
              : "Create a private workspace for your writing."}
          </p>
        </header>

        {!auth.configured ? (
          <div className="auth-config-warning" role="alert">
            <strong>Sign-in isn&apos;t configured yet.</strong>
            <span>Ask the workspace administrator to finish Firebase setup.</span>
          </div>
        ) : null}

        {error ? <div className="auth-feedback auth-feedback-error" role="alert">{error}</div> : null}
        {notice ? <div className="auth-feedback auth-feedback-success" role="status">{notice}</div> : null}

        <button
          className="button button-secondary google-button"
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={submitting || !auth.configured}
        >
          <span className="google-mark" aria-hidden="true">G</span>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or continue with email</span></div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "create-account" ? (
            <div className="field-group auth-field">
              <label htmlFor="name">Name</label>
              <span className="auth-input">
                <UserRound aria-hidden="true" />
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  disabled={submitting}
                />
              </span>
            </div>
          ) : null}

          <div className="field-group auth-field">
            <label htmlFor="email">Email address</label>
            <span className="auth-input">
              <Mail aria-hidden="true" />
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={submitting}
              />
            </span>
          </div>

          <div className="field-group auth-field">
            <div className="password-label-row">
              <label htmlFor="password">Password</label>
              {mode === "sign-in" ? (
                <button type="button" className="text-button" onClick={() => void handlePasswordReset()} disabled={submitting || !auth.configured}>
                  Forgot password?
                </button>
              ) : null}
            </div>
            <span className="auth-input">
              <LockKeyhole aria-hidden="true" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={submitting}
                aria-describedby={mode === "create-account" ? "password-help" : undefined}
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </span>
            {mode === "create-account" ? <small id="password-help">Use at least 6 characters.</small> : null}
          </div>

          <button
            className="button button-primary auth-submit"
            type="submit"
            disabled={submitting || !auth.configured || (mode === "create-account" && !name.trim())}
            aria-busy={submitting}
          >
            {submitting ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {submitting ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "sign-in" ? "New to Easy LaTeX?" : "Already have an account?"}{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => switchMode(mode === "sign-in" ? "create-account" : "sign-in")}
            disabled={submitting}
          >
            {mode === "sign-in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}
