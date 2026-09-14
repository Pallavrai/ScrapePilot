"use client";
import { useEffect, useRef, useState } from "react";
import AuthDialog from "../../../components/auth-dialog";
type State = "checking" | "signed-out" | "ready" | "connecting" | "connected";
/**
 * Creates a key for the Chrome extension and hands it to the extension's content script on
 * this page, so nobody copies or pastes a key. The key is revocable under API keys.
 */
export default function ConnectExtension() {
  const [state, setState] = useState<State>("checking"),
    [email, setEmail] = useState(""),
    [installed, setInstalled] = useState(false),
    [signIn, setSignIn] = useState(false),
    [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  async function load() {
    const r = await fetch("/api/v1/me").catch(() => null);
    if (r?.status === 401) return setState("signed-out");
    const me = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setError(me?.error ?? "Couldn't reach ScrapePilot. Check your connection and reload.");
      return setState("signed-out");
    }
    setEmail(me.email);
    setState("ready");
  }
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== "scrapepilot-extension") return;
      if (event.data.type === "ready") setInstalled(true);
      if (event.data.type === "connected") {
        clearTimeout(timer.current);
        if (event.data.ok) return setState("connected");
        setError(event.data.error ?? "The extension couldn't connect. Reload this page and try again.");
        setState("ready");
      }
    };
    window.addEventListener("message", listen);
    window.postMessage({ source: "scrapepilot-page", type: "hello" }, location.origin);
    void load();
    return () => {
      window.removeEventListener("message", listen);
      clearTimeout(timer.current);
    };
  }, []);
  async function connect() {
    setError("");
    setState("connecting");
    const r = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Chrome extension, ${new Date().toLocaleDateString()}` }),
    }).catch(() => null);
    const data = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setError(data?.error ?? "Couldn't reach ScrapePilot. Check your connection and try again.");
      return setState("ready");
    }
    timer.current = setTimeout(() => {
      setError("The extension didn't answer. Reload this page and try again. You can revoke the unused key under API keys.");
      setState("ready");
    }, 10000);
    window.postMessage({ source: "scrapepilot-page", type: "connect", token: data.token }, location.origin);
  }
  return (
    <main className="content connect-page">
      <a href="/">← Back to workspace</a>
      <h1>Connect the Chrome extension</h1>
      <p>
        The extension runs your saved scrapers in this browser, with the logins you already
        have. Results save to your account, in Run history and through the API, the same as
        cloud runs.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {state === "checking" && <p className="meta">Checking your account…</p>}
      {state === "signed-out" && (
        <>
          <p>Sign in to ScrapePilot to connect the extension.</p>
          <button className="primary" onClick={() => setSignIn(true)}>
            Sign in
          </button>
        </>
      )}
      {(state === "ready" || state === "connecting") &&
        (installed ? (
          <>
            <p>
              This browser will get its own key for <b>{email}</b>. You can revoke it any time
              under API keys, or choose Disconnect in the extension.
            </p>
            <button className="primary" disabled={state === "connecting"} onClick={connect}>
              {state === "connecting" ? "Connecting…" : "Connect extension"}
            </button>
          </>
        ) : (
          <p className="alert">
            The ScrapePilot extension isn&apos;t installed in this browser. Install it, then
            reload this page.
          </p>
        ))}
      {state === "connected" && (
        <p className="notice" role="status">
          Connected as {email}. Open ScrapePilot from Chrome&apos;s toolbar to run a scraper. You
          can close this tab.
        </p>
      )}
      <p className="meta">
        Runs use your own accounts. Follow each site&apos;s rules and the{" "}
        <a href="/acceptable-use">Acceptable Use Policy</a>.
      </p>
      {signIn && (
        <AuthDialog
          onClose={() => setSignIn(false)}
          onSignedIn={async () => {
            setSignIn(false);
            setError("");
            await load();
          }}
        />
      )}
    </main>
  );
}
