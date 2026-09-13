"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Layers,
  Compass,
  Play,
  KeyRound,
  ShieldCheck,
  Plus,
  ArrowUpRight,
  Command,
  ChevronRight,
  Activity,
  Box,
  Search,
  LogOut,
  Lock,
  Workflow,
} from "lucide-react";
import { createAuthClient } from "better-auth/react";
import { Badge, EmptyState } from "@scrapepilot/ui";
const Builder = dynamic(() => import("./builder"), {
  ssr: false,
  loading: () => <div className="empty">Opening editor…</div>,
});
const Settings = dynamic(() => import("./settings"), { ssr: false });
const auth = createAuthClient();
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
    [login, setLogin] = useState(false),
    [signup, setSignup] = useState(false),
    [query, setQuery] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setActor(await api("me"));
      setItems(await api(tab));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
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
  async function sign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      data = {
        email: String(f.get("email")),
        password: String(f.get("password")),
        name: String(f.get("name") ?? ""),
      };
    const r = signup
      ? await auth.signUp.email(data)
      : await auth.signIn.email(data);
    if (r.error) setError(r.error.message ?? "Authentication failed");
    else if (signup)
      setNotice("Check your inbox to verify your email before signing in.");
    else {
      setLogin(false);
      await refresh();
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
              onClick={() => {
                setSelected(null);
                setTab(key);
              }}
            >
              <Icon size={18} />
              {label}
              {key === "marketplace" && <span className="tiny-tag">NEW</span>}
            </button>
          ))}
          {actor?.role === "admin" && (
            <button
              onClick={() => {
                setTab("admin/listings");
                setSelected(null);
              }}
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
                onClick={() => {
                  setTab(key);
                  setSelected(null);
                }}
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
              {actor?.monthlyMinutes ?? 100} browser minutes / month
            </small>
            <div className="usage-track" />
            <span>Usage is enforced on every run</span>
          </div>
          <button
            className="profile"
            onClick={() =>
              actor
                ? auth.signOut().then(() => {
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
            {selected
              ? "Visual editor"
              : (nav.find((n) => n[0] === tab)?.[2] ?? "Administration")}
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
                <h1>
                  {tab === "scrapers"
                    ? "My scrapers"
                    : tab === "runs"
                      ? "Run history"
                      : tab === "marketplace"
                        ? "Explore the marketplace"
                        : tab === "keys"
                          ? "API keys"
                          : tab === "secrets"
                            ? "Credentials"
                            : "Review queue"}
                </h1>
                <p>
                  {tab === "scrapers"
                    ? "Turn any page into a repeatable data workflow. No code required."
                    : tab === "marketplace"
                      ? "Start with a community template. Make it your own."
                      : "Manage your workspace with everything in one place."}
                </p>
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
              <Settings section={tab} />
            ) : loading ? (
              <div className="empty">Loading workspace…</div>
            ) : tab === "scrapers" ? (
              <div className="scraper-grid">
                {items
                  .filter((s) =>
                    s.name?.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((s) => (
                    <button
                      className="scraper-card"
                      key={s.id}
                      onClick={() => setSelected(s.id)}
                    >
                      <div className="card-top">
                        <span className="site-icon">
                          <Layers size={22} />
                        </span>
                        <Badge>Draft</Badge>
                      </div>
                      <h3>{s.name}</h3>
                      <p>{s.draft?.allowedDomains?.join(", ")}</p>
                      <footer>
                        <span>{s.draft?.steps?.length ?? 0} steps</span>
                        <ArrowUpRight size={17} />
                      </footer>
                    </button>
                  ))}
                <button
                  className="new-card"
                  onClick={() =>
                    actor
                      ? document
                          .querySelector<HTMLInputElement>("input[name=url]")
                          ?.focus()
                      : setLogin(true)
                  }
                >
                  <span>
                    <Plus size={22} />
                  </span>
                  <h3>Create a new scraper</h3>
                  <p>Start with a URL. Build visually.</p>
                </button>
              </div>
            ) : tab === "marketplace" ? (
              <div className="scraper-grid">
                {items.map((s) => (
                  <div className="scraper-card" key={s.id}>
                    <Badge tone="green">Community template</Badge>
                    <h3>{s.name}</h3>
                    <p>{s.description}</p>
                    <button
                      className="primary"
                      onClick={async () => {
                        try {
                          const installed = await api(
                            `marketplace/${s.id}/install`,
                            "POST",
                            {},
                          );
                          setSelected(installed.id);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Install template <Plus size={15} />
                    </button>
                    <small>{s.installCount} installs</small>
                  </div>
                ))}
                {!items.length && (
                  <EmptyState title="A fresh marketplace">
                    Reviewed community templates will appear here.
                  </EmptyState>
                )}
              </div>
            ) : tab === "keys" ? (
              <>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      const k = await api("keys", "POST", {
                        name: "Workspace key",
                      });
                      setNotice(
                        `Copy this key now; it will not be shown again: ${k.token}`,
                      );
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Generate API key <Plus size={16} />
                </button>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Prefix</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((k) => (
                        <tr key={k.id}>
                          <td>{k.name}</td>
                          <td>
                            <code>{k.prefix}…</code>
                          </td>
                          <td>
                            <button
                              onClick={async () => {
                                await api(`keys/${k.id}`, "DELETE");
                                await refresh();
                              }}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : tab === "secrets" ? (
              <>
                <form
                  className="inline-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    try {
                      await api("secrets", "POST", Object.fromEntries(f));
                      form.reset();
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <input name="domain" placeholder="example.com" required />
                  <input name="name" placeholder="Secret name" required />
                  <input
                    name="value"
                    type="password"
                    placeholder="Secret value"
                    required
                  />
                  <button className="primary">Save credential</button>
                </form>
                {items.map((s) => (
                  <div className="list-row" key={s.id}>
                    <b>{s.name}</b>
                    <span>{s.domain}</span>
                    <button
                      onClick={async () => {
                        await api(`secrets/${s.id}`, "DELETE");
                        await refresh();
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </>
            ) : tab === "runs" ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Status</th>
                      <th>Rows</th>
                      <th>Duration</th>
                      <th>Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <code>{r.id.slice(0, 8)}</code>
                        </td>
                        <td>
                          <Badge
                            tone={
                              r.status === "succeeded" ? "green" : "neutral"
                            }
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td>{r.rowCount}</td>
                        <td>{Math.round(r.durationMs / 1000)}s</td>
                        <td>{new Date(r.createdAt).toLocaleString()}</td>
                        <td>
                          <button
                            onClick={async () => {
                              const data = await api(`runs/${r.id}/results`);
                              setNotice(JSON.stringify(data.rows, null, 2));
                            }}
                          >
                            View JSON
                          </button>
                          {["queued", "running"].includes(r.status) ? (
                            <button
                              onClick={async () => {
                                await api(`runs/${r.id}/cancel`, "POST", {});
                                await refresh();
                              }}
                            >
                              Cancel
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={async () => {
                                  await api(
                                    `scrapers/${r.scraperId}/repair`,
                                    "POST",
                                    { runId: r.id },
                                  );
                                  setSelected(r.scraperId);
                                }}
                              >
                                Repair / edit
                              </button>
                              <a
                                className="button"
                                target="_blank"
                                href={`/api/v1/runs/${r.id}/artifact`}
                              >
                                Screenshot
                              </a>
                              <button
                                onClick={async () => {
                                  await api(`runs/${r.id}/results`, "DELETE");
                                  setNotice(
                                    "Result rows and diagnostics deleted.",
                                  );
                                }}
                              >
                                Delete results
                              </button>
                            </>
                          )}
                          {r.error?.message && <small>{r.error.message}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              items.map((item) => (
                <div className="panel" key={item.listing.id}>
                  <h3>
                    {item.listing.name} <Badge>{item.listing.status}</Badge>
                  </h3>
                  <p>{item.listing.description}</p>
                  <details>
                    <summary>Inspect definition</summary>
                    <pre>{JSON.stringify(item.definition, null, 2)}</pre>
                  </details>
                  <button
                    onClick={async () => {
                      await api("admin/listings", "POST", {
                        id: item.listing.id,
                        status: "approved",
                      });
                      await refresh();
                    }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={async () => {
                      await api("admin/listings", "POST", {
                        id: item.listing.id,
                        status: "rejected",
                      });
                      await refresh();
                    }}
                  >
                    Reject
                  </button>
                </div>
              ))
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
      {login && (
        <div className="modal-backdrop">
          <div className="modal">
            <button className="close" onClick={() => setLogin(false)}>
              ×
            </button>
            <span className="brand-icon">
              <Command />
            </span>
            <h2>{signup ? "Create your workspace" : "Welcome back"}</h2>
            <p>Make the web work for you.</p>
            <form onSubmit={sign}>
              {signup && <input name="name" placeholder="Full name" required />}
              <input
                name="email"
                type="email"
                placeholder="Email address"
                required
              />
              <input
                name="password"
                type="password"
                minLength={12}
                placeholder="Password (12+ characters)"
                required
              />
              <button className="primary">
                {signup ? "Create account" : "Sign in"}
              </button>
            </form>
            <a href="/reset-password">Forgot password?</a>
            <p className="error">{error}</p>
            <p>{notice}</p>
            <button onClick={() => setSignup(!signup)}>
              {signup
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
