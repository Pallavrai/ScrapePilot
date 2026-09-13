"use client";
import { useState, useEffect } from "react";
import { createAuthClient } from "better-auth/react";
const auth = createAuthClient();
export default function ResetPassword() {
  const [token, setToken] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    setToken(new URLSearchParams(location.search).get("token") ?? "");
  }, []);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{token ? "Choose a new password" : "Reset your password"}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const result = token
              ? await auth.resetPassword({
                  token,
                  newPassword: String(f.get("password")),
                })
              : await auth.requestPasswordReset({
                  email: String(f.get("email")),
                  redirectTo: "/reset-password",
                });
            setMessage(
              result.error?.message ??
                (token
                  ? "Password updated. You can sign in."
                  : "If that account exists, a reset link has been sent."),
            );
          }}
        >
          {token ? (
            <input
              name="password"
              type="password"
              minLength={12}
              placeholder="New password (12+ characters)"
              required
            />
          ) : (
            <input
              name="email"
              type="email"
              placeholder="Email address"
              required
            />
          )}
          <button className="primary">
            {token ? "Update password" : "Send reset link"}
          </button>
        </form>
        <p>{message}</p>
        <a href="/">Back to ScrapePilot</a>
      </div>
    </div>
  );
}
