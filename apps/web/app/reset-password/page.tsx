"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  authClient,
  authMessage,
  emailIssue,
  Field,
  networkNotice,
  PasswordField,
  passwordIssue,
  type FormNotice,
} from "../../components/auth-dialog";
import { Modal } from "../../components/modal";
export default function ResetPassword() {
  const [token, setToken] = useState(""),
    [values, setValues] = useState({ email: "", password: "", confirm: "" }),
    [submitted, setSubmitted] = useState(false),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState<FormNotice | null>(null),
    [done, setDone] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setToken(params.get("token") ?? "");
    // Better Auth redirects expired or reused links here with ?error=INVALID_TOKEN.
    if (params.get("error"))
      setNotice({
        tone: "error",
        text: "This reset link is invalid or has expired. Request a new one below.",
      });
  }, []);
  const issues: Record<string, string | undefined> = token
    ? {
        password: passwordIssue(values.password, "new"),
        confirm: !values.confirm
          ? "Re-enter your new password."
          : values.confirm !== values.password
            ? "Passwords do not match."
            : undefined,
      }
    : { email: emailIssue(values.email.trim()) };
  const bind = (field: keyof typeof values) => ({
    name: field,
    value: values[field],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [field]: e.target.value })),
    error: submitted ? issues[field] : undefined,
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setNotice(null);
    const invalid = Object.keys(issues).find((field) => issues[field]);
    if (invalid) {
      form.current
        ?.querySelector<HTMLInputElement>(`[name="${invalid}"]`)
        ?.focus();
      return;
    }
    setPending(true);
    try {
      if (token) {
        const { error } = await authClient.resetPassword({
          token,
          newPassword: values.password,
        });
        if (error) {
          setNotice({ tone: "error", text: authMessage(error) });
          if (error.code === "INVALID_TOKEN") {
            setToken("");
            setSubmitted(false);
            history.replaceState(null, "", location.pathname);
          }
        } else {
          setDone(true);
          setNotice({ tone: "success", text: "Password updated." });
        }
      } else {
        const { error } = await authClient.requestPasswordReset({
          email: values.email.trim().toLowerCase(),
          redirectTo: "/reset-password",
        });
        setNotice(
          error
            ? { tone: "error", text: authMessage(error) }
            : {
                tone: "success",
                text: "If an account exists for that email, a reset link is on its way.",
              },
        );
      }
    } catch {
      setNotice(networkNotice);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal labelledBy="reset-title">
      <h2 id="reset-title">
        {token ? "Choose a new password" : "Reset your password"}
      </h2>
      <p>
        {token
          ? "Use a password you don't use anywhere else."
          : "Enter your account email and we'll send you a reset link."}
      </p>
      {notice && (
        <div
          className={`form-message ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </div>
      )}
      {done ? (
        <a className="button primary" href="/?signin=1">
          Sign in
        </a>
      ) : (
        <form ref={form} onSubmit={submit} noValidate>
          {token ? (
            <>
              <PasswordField
                label="New password"
                autoComplete="new-password"
                autoFocus
                hint="At least 12 characters."
                {...bind("password")}
              />
              <PasswordField
                label="Confirm new password"
                autoComplete="new-password"
                {...bind("confirm")}
              />
            </>
          ) : (
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              {...bind("email")}
            />
          )}
          <button
            className="primary"
            type="submit"
            disabled={pending}
            aria-busy={pending}
          >
            {pending
              ? token
                ? "Updating…"
                : "Sending…"
              : token
                ? "Update password"
                : "Send reset link"}
          </button>
        </form>
      )}
      <div className="auth-links">
        <a href="/">Back to ScrapePilot</a>
      </div>
    </Modal>
  );
}
