"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Command, Eye, EyeOff } from "lucide-react";
import { createAuthClient } from "better-auth/react";
import { Modal } from "./modal";
export const authClient = createAuthClient();
export const PASSWORD_MIN = 12,
  PASSWORD_MAX = 128;
export type FormNotice = { tone: "error" | "success"; text: string };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const emailIssue = (email: string) =>
  !email
    ? "Enter your email address."
    : email.length > 254 || !emailPattern.test(email)
      ? "Enter a valid email address, like name@example.com."
      : undefined;
export const passwordIssue = (password: string, kind: "new" | "current") =>
  !password
    ? kind === "new"
      ? "Choose a password."
      : "Enter your password."
    : kind === "new" && password.length < PASSWORD_MIN
      ? `Use at least ${PASSWORD_MIN} characters (${password.length}/${PASSWORD_MIN}).`
      : password.length > PASSWORD_MAX
        ? `Use at most ${PASSWORD_MAX} characters.`
        : undefined;
export const networkNotice: FormNotice = {
  tone: "error",
  text: "Could not reach ScrapePilot. Check your connection and try again.",
};
/** Better Auth error codes, in words a person can act on. */
export function authMessage(error: {
  code?: string;
  message?: string;
  status?: number;
}) {
  if (error.status === 429)
    return "Too many attempts. Wait a minute, then try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Incorrect email or password.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email before signing in. Open the link we emailed you, or send a new one.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Sign in instead, or reset your password.";
    case "PASSWORD_TOO_SHORT":
      return `Use at least ${PASSWORD_MIN} characters.`;
    case "PASSWORD_TOO_LONG":
      return `Use at most ${PASSWORD_MAX} characters.`;
    case "INVALID_EMAIL":
      return "Enter a valid email address, like name@example.com.";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "This link is invalid or has expired. Request a new one.";
  }
  return error.message || "Something went wrong. Try again.";
}
type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
};
// The label holds only the field name: messages are attached with aria-describedby, and the
// show-password button sits outside it, so screen readers announce "Password", not the whole row.
function FieldShell({
  label,
  id,
  error,
  hint,
  name,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {(error || hint) && (
        <small
          id={`${name}-message`}
          className={error ? "field-error" : "field-hint"}
        >
          {error ?? hint}
        </small>
      )}
    </div>
  );
}
export function Field({ label, error, hint, ...input }: FieldProps) {
  const id = useId();
  return (
    <FieldShell
      label={label}
      id={id}
      error={error}
      hint={hint}
      name={input.name}
    >
      <input
        {...input}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${input.name}-message` : undefined}
      />
    </FieldShell>
  );
}
export function PasswordField({ label, error, hint, ...input }: FieldProps) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  return (
    <FieldShell
      label={label}
      id={id}
      error={error}
      hint={hint}
      name={input.name}
    >
      <div className="password-input">
        <input
          {...input}
          id={id}
          type={visible ? "text" : "password"}
          maxLength={PASSWORD_MAX}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${input.name}-message` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </FieldShell>
  );
}
type Mode = "signin" | "signup";
export default function AuthDialog({
  initialMode = "signin",
  initialNotice,
  onClose,
  onSignedIn,
}: {
  initialMode?: Mode;
  initialNotice?: FormNotice;
  onClose: () => void;
  onSignedIn: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode),
    [values, setValues] = useState({
      name: "",
      email: "",
      password: "",
      confirm: "",
    }),
    [touched, setTouched] = useState<Record<string, boolean>>({}),
    [submitted, setSubmitted] = useState(false),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState<FormNotice | null>(initialNotice ?? null),
    [action, setAction] = useState<"resend" | "signin" | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const signup = mode === "signup";
  const name = values.name.trim(),
    email = values.email.trim().toLowerCase();
  const issues: Record<keyof typeof values, string | undefined> = {
    name: !signup
      ? undefined
      : !name
        ? "Enter your name."
        : name.length > 80
          ? "Use at most 80 characters."
          : undefined,
    email: emailIssue(email),
    password: passwordIssue(values.password, signup ? "new" : "current"),
    confirm: !signup
      ? undefined
      : !values.confirm
        ? "Re-enter your password."
        : values.confirm !== values.password
          ? "Passwords do not match."
          : undefined,
  };
  // Show a field's problem once it was left with something in it, or after a submit attempt.
  const shown = (field: keyof typeof values) =>
    submitted || (touched[field] && values[field]) ? issues[field] : undefined;
  const bind = (field: keyof typeof values) => ({
    name: field,
    value: values[field],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [field]: e.target.value })),
    onBlur: () => setTouched((t) => ({ ...t, [field]: true })),
    error: shown(field),
  });
  function switchMode(next: Mode, keep?: FormNotice) {
    setMode(next);
    setSubmitted(false);
    setTouched({});
    setAction(null);
    setNotice(keep ?? null);
    setValues((v) => ({ ...v, password: "", confirm: "" }));
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setNotice(null);
    setAction(null);
    const invalid = (Object.keys(issues) as (keyof typeof values)[]).find(
      (field) => issues[field],
    );
    if (invalid) {
      form.current
        ?.querySelector<HTMLInputElement>(`[name="${invalid}"]`)
        ?.focus();
      return;
    }
    setPending(true);
    try {
      const { error } = signup
        ? await authClient.signUp.email({
            name,
            email,
            password: values.password,
            callbackURL: "/?verified=1",
          })
        : await authClient.signIn.email({ email, password: values.password });
      if (error) {
        setNotice({ tone: "error", text: authMessage(error) });
        setAction(
          error.code === "EMAIL_NOT_VERIFIED"
            ? "resend"
            : error.code?.startsWith("USER_ALREADY_EXISTS")
              ? "signin"
              : null,
        );
      } else if (signup)
        // Existing emails get the same answer, so the form does not reveal who has an account.
        switchMode("signin", {
          tone: "success",
          text: `Almost done. If ${email} is new to ScrapePilot, a verification link is on its way. Open it, then sign in here.`,
        });
      else await onSignedIn();
    } catch {
      setNotice(networkNotice);
    } finally {
      setPending(false);
    }
  }
  async function resend() {
    setPending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/?verified=1",
      });
      setNotice(
        error
          ? { tone: "error", text: authMessage(error) }
          : {
              tone: "success",
              text: `A new verification link is on its way to ${email}.`,
            },
      );
      if (!error) setAction(null);
    } catch {
      setNotice(networkNotice);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal labelledBy="auth-title" onClose={pending ? undefined : onClose}>
      <button
        type="button"
        className="close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <span className="brand-icon">
        <Command />
      </span>
      <h2 id="auth-title">
        {signup ? "Create your workspace" : "Welcome back"}
      </h2>
      <p>
        {signup
          ? "Verify your email once, then build scrapers."
          : "Sign in to your workspace."}
      </p>
      {notice && (
        <div
          className={`form-message ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
          {action === "resend" && (
            <button
              type="button"
              className="link-button"
              onClick={resend}
              disabled={pending}
            >
              Send a new verification link
            </button>
          )}
          {action === "signin" && (
            <button
              type="button"
              className="link-button"
              onClick={() => switchMode("signin")}
            >
              Sign in instead
            </button>
          )}
        </div>
      )}
      <form ref={form} onSubmit={submit} noValidate>
        {signup && (
          <Field
            label="Name"
            autoComplete="name"
            maxLength={80}
            autoFocus
            {...bind("name")}
          />
        )}
        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={!signup}
          {...bind("email")}
        />
        <PasswordField
          label="Password"
          autoComplete={signup ? "new-password" : "current-password"}
          hint={
            signup
              ? `At least ${PASSWORD_MIN} characters${values.password ? ` (${values.password.length}/${PASSWORD_MIN})` : ""}.`
              : undefined
          }
          {...bind("password")}
        />
        {signup && (
          <PasswordField
            label="Confirm password"
            autoComplete="new-password"
            {...bind("confirm")}
          />
        )}
        {signup && (
          <p className="auth-consent">
            By creating an account, you agree to the{" "}
            <a href="/terms" target="_blank" rel="noreferrer">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/acceptable-use" target="_blank" rel="noreferrer">
              Acceptable Use Policy
            </a>
            , and acknowledge the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            .
          </p>
        )}
        <button
          className="primary"
          type="submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending
            ? signup
              ? "Creating account…"
              : "Signing in…"
            : signup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
      <div className="auth-links">
        {!signup && <a href="/reset-password">Forgot password?</a>}
        <button
          type="button"
          className="link-button"
          onClick={() => switchMode(signup ? "signin" : "signup")}
          disabled={pending}
        >
          {signup
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </div>
    </Modal>
  );
}
