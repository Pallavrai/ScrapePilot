"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Layers,
  Compass,
  Play,
  KeyRound,
  ShieldCheck,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Activity,
  Box,
  Search,
  LogOut,
  Lock,
  Workflow,
} from "lucide-react";
import { Badge, EmptyState } from "@scrapepilot/ui";
import AuthDialog, { authClient, type FormNotice } from "./auth-dialog";
import {
  KeysPanel,
  MarketplaceGrid,
  ReviewQueue,
  RunsTable,
  ScraperCards,
  SecretsPanel,
  type Act,
} from "./dashboard";
const pages: Record<string, [string, string]> = {
  scrapers: ["My scrapers", "Turn any page into a repeatable data workflow. No code required."],
  runs: ["Run history", "Runs from the editor and the API, newest first."],
  marketplace: ["Explore the marketplace", "Start with a community template. Make it your own."],
  keys: ["API keys", "Start runs and read results from your own code."],
  webhooks: ["Webhooks", "Get notified when runs finish."],
  secrets: ["Credentials", "Encrypted logins your scrapers can fill in, each bound to one domain."],
  "admin/listings": ["Review queue", "Approve or reject marketplace templates."],
  "admin/users": ["Users & quotas", "Suspend accounts and set monthly browser minutes."],
  "admin/domains": ["Domain policies", "Block domains that no scraper may open."],
  "admin/reports": ["Abuse reports", "Reports about published templates."],
};
const Builder = dynamic(() => import("./builder"), {
  ssr: false,
  loading: () => <div className="empty">Opening editor…</div>,
});
const Settings = dynamic(() => import("./settings"), { ssr: false });
export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`/api/v1/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Request failed (HTTP ${r.status})`);
  return data;
}
export default function Workspace() {
  const [tab, setTab] = useState("scrapers"),
    [actor, setActor] = useState<any>(null),
    [items, setItems] = useState<any[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [authDialog, setAuthDialog] = useState<{
      mode: "signin" | "signup";
      notice?: FormNotice;
    } | null>(null),
    [query, setQuery] = useState("");
  const setLogin = (open: boolean) =>
    setAuthDialog(open ? { mode: "signin" } : null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const requested = tab;
    // A slower response for a tab the user already left must not replace the current tab's rows.
    const current = () => tabRef.current === requested;
    try {
      const me = await api("me");
      const rows = await api(requested);
      if (!current()) return;
      setActor(me);
      setItems(rows);
      setError("");
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    // Verification and password-reset emails land here with their outcome in the query string.
    const params = new URLSearchParams(location.search);
    const failed = params.get("error") || params.get("verified")?.includes("error");
    const notice: FormNotice | null = failed
      ? {
          tone: "error",
          text: "That verification link is invalid or has expired. Sign in to send a new one.",
        }
      : params.get("verified")
        ? { tone: "success", text: "Email verified. Sign in to continue." }
        : params.get("signin")
          ? {
              tone: "success",
              text: "Password updated. Sign in with your new password.",
            }
          : null;
    if (!notice) return;
    setAuthDialog({ mode: "signin", notice });
    history.replaceState(null, "", location.pathname);
  }, []);
  // One way to change tabs: clears the previous tab's rows (their shape differs) and reloads
  // even when the current tab is clicked again, which would otherwise not trigger a refresh.
  function go(key: string) {
    setSelected(null);
    setNotice("");
    if (key === tab) return void refresh();
    setItems([]);
    setLoading(true);
    setTab(key);
  }
  const act: Act = async (work, success) => {
    try {
      await work();
      // Refresh first, so a message like "Deleted" never shows next to the item it removed.
      await refresh(true);
      setError("");
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setNotice("");
      setError((e as Error).message);
      return false;
    }
  };
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const s = await api("scrapers", "POST", {
        url: f.get("url"),
        name: f.get("name"),
      });
      setSelected(s.id);
      setNotice("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const nav = [
    ["scrapers", Layers, "My scrapers"],
    ["runs", Activity, "Run history"],
    ["marketplace", Compass, "Marketplace"],
    ["keys", KeyRound, "API keys"],
    ["webhooks", Activity, "Webhooks"],
    ["secrets", Lock, "Credentials"],
  ] as const;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <div className="brand-icon">
            <Workflow size={22} />
          </div>
          scrapepilot<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">
          <span className="avatar">{actor?.name?.[0] ?? "S"}</span>
          <div>
            {actor?.name ?? "Your workspace"}
            <small>Personal workspace</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {nav.map(([key, Icon, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => go(key)}
            >
              <Icon size={18} />
              {label}
              {key === "marketplace" && <span className="tiny-tag">NEW</span>}
            </button>
          ))}
          {actor?.role === "admin" && (
            <button
              onClick={() => go("admin/listings")}
            >
              <ShieldCheck size={18} />
              Review queue
            </button>
          )}
        </nav>
        {actor?.role === "admin" && (
          <nav>
            {[
              ["admin/users", "Users & quotas"],
              ["admin/domains", "Domain policies"],
              ["admin/reports", "Abuse reports"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => go(key)}
              >
                <ShieldCheck size={16} />
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="sidebar-bottom">
          <div className="beta-card">
            <span className="green-dot" /> FREE BETA
            <p>Build something useful.</p>
            <small>
              {actor
                ? `${actor.usedMinutes ?? 0} of ${actor.monthlyMinutes} browser minutes used`
                : "100 browser minutes / month"}
            </small>
            <div
              className="usage-track"
              role="progressbar"
              aria-label="Browser minutes used this month"
              aria-valuemin={0}
              aria-valuemax={actor?.monthlyMinutes ?? 100}
              aria-valuenow={actor?.usedMinutes ?? 0}
            >
              <i
                style={{
                  width: `${Math.min(100, ((actor?.usedMinutes ?? 0) / Math.max(1, actor?.monthlyMinutes ?? 100)) * 100)}%`,
                }}
              />
            </div>
            <span>Usage is enforced on every run</span>
          </div>
          <nav className="legal-links" aria-label="Terms and policies">
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/acceptable-use">Acceptable use</a>
          </nav>
          <button
            className="profile"
            onClick={() =>
              actor
                ? authClient.signOut().then(() => {
                    setActor(null);
                    setItems([]);
                  })
                : setLogin(true)
            }
          >
            <span className="avatar dark">{actor?.name?.[0] ?? "G"}</span>
            <div>
              {actor?.name ?? "Guest preview"}
              <small>{actor ? "Sign out" : "Sign in to get started"}</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={13} />{" "}
            {selected ? "Visual editor" : (pages[tab]?.[0] ?? "Administration")}
          </span>
          <div>
            <span className="status-dot" /> Free beta{" "}
            <a href="/docs" target="_blank" rel="noreferrer">
              Documentation <ArrowUpRight size={13} />
            </a>
          </div>
        </header>
        {selected ? (
          <Builder
            id={selected}
            onBack={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <div className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR DATA, YOUR WAY</div>
                <h1>{pages[tab]?.[0]}</h1>
                <p>{pages[tab]?.[1]}</p>
              </div>
              {!actor && (
                <button className="primary" onClick={() => setLogin(true)}>
                  Sign in <ArrowUpRight size={16} />
                </button>
              )}
            </div>
            {error && (
              <div className="alert">
                {error}
                {!actor && " — the workspace preview is available below."}
              </div>
            )}
            {notice && <div className="notice">{notice}</div>}
            {tab === "scrapers" && (
              <>
                <section className="launch-card">
                  <div>
                    <span className="pill">
                      <span className="green-dot" /> VISUAL SCRAPER BUILDER
                    </span>
                    <h2>
                      The web is full of data.
                      <br />
                      <span>Make it work for you.</span>
                    </h2>
                    <p>
                      Point, click, and collect. Build your first scraper
                      <br />
                      from a website you’re authorized to automate.
                    </p>
                    <form onSubmit={create}>
                      <div className="url-input">
                        <Compass size={18} />
                        <input
                          name="url"
                          type="url"
                          placeholder="https://example.com"
                          required
                        />
                        <button
                          className="primary"
                          type="submit"
                          disabled={!actor}
                        >
                          Create scraper <ArrowUpRight size={16} />
                        </button>
                      </div>
                    </form>
                  </div>
                  <div className="hero-visual">
                    <div className="mini-browser">
                      <div className="browser-dots">
                        <i />
                        <i />
                        <i />
                        <span>your-website.com</span>
                      </div>
                      <div className="mini-cards">
                        {[0, 1, 2].map((i) => (
                          <div
                            className={
                              i === 1 ? "mini-product picked" : "mini-product"
                            }
                            key={i}
                          >
                            <div className="product-shape">
                              <Box size={28} />
                            </div>
                            <b />
                            <span />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="json-card">
                      <div>
                        <span className="green-dot" /> Structured output{" "}
                        <Badge tone="green">JSON</Badge>
                      </div>
                      <code>
                        <span>{"{ "}</span>
                        <br />
                        &nbsp; "title": <em>"Your next idea"</em>,<br />
                        &nbsp; "price": <strong>49.00</strong>,<br />
                        &nbsp; "in_stock": <strong>true</strong>
                        <br />
                        {" }"}
                      </code>
                    </div>
                    <div className="selection-label">↖ Select an element</div>
                  </div>
                </section>
                <div className="section-bar">
                  <div>
                    <h2>
                      All scrapers <span>{items.length}</span>
                    </h2>
                    <p>Your workflows, ready when you are.</p>
                  </div>
                  <div className="search">
                    <Search size={16} />
                    <input
                      placeholder="Search scrapers…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>⌘ K</kbd>
                  </div>
                </div>
              </>
            )}
            {[
              "webhooks",
              "admin/users",
              "admin/domains",
              "admin/reports",
            ].includes(tab) ? (
              <Settings key={tab} section={tab} />
            ) : loading ? (
              <div className="empty">Loading workspace…</div>
            ) : tab === "scrapers" ? (
              <ScraperCards
                items={items}
                query={query}
                act={act}
                onOpen={setSelected}
                onNew={() =>
                  actor
                    ? document
                        .querySelector<HTMLInputElement>("input[name=url]")
                        ?.focus()
                    : setLogin(true)
                }
              />
            ) : tab === "runs" ? (
              <RunsTable
                items={items}
                act={act}
                refresh={() => void refresh(true)}
                onRepair={(run) =>
                  act(async () => {
                    await api(`scrapers/${run.scraperId}/repair`, "POST", {
                      runId: run.id,
                    });
                    setSelected(run.scraperId);
                  })
                }
              />
            ) : tab === "marketplace" ? (
              <MarketplaceGrid
                items={items}
                signedIn={!!actor}
                act={act}
                onInstalled={setSelected}
                onSignIn={() => setLogin(true)}
              />
            ) : tab === "keys" ? (
              <KeysPanel items={items} act={act} />
            ) : tab === "secrets" ? (
              <SecretsPanel items={items} act={act} />
            ) : (
              <ReviewQueue items={items} act={act} />
            )}
            <footer className="page-footer">
              <span>
                <ShieldCheck size={14} /> Your credentials stay private. Your
                workflows stay yours.
              </span>
              <span>Built for the curious.</span>
            </footer>
          </div>
        )}
      </main>
      {authDialog && (
        <AuthDialog
          initialMode={authDialog.mode}
          initialNotice={authDialog.notice}
          onClose={() => setAuthDialog(null)}
          onSignedIn={async () => {
            setAuthDialog(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
