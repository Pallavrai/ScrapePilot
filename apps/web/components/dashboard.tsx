"use client";
import { useEffect, useState } from "react";
import { Copy, Download, Flag, Layers, Plus, Trash2 } from "lucide-react";
import { Badge, EmptyState } from "@scrapepilot/ui";
import { api } from "./workspace";
import { Modal } from "./modal";
/** Runs an action, shows its error or success message, then refreshes the page data. */
export type Act = (
  work: () => Promise<unknown>,
  success?: string,
) => Promise<boolean>;
export const statusTone = (status?: string) =>
  ["succeeded", "approved", "delivered"].includes(status ?? "")
    ? "green"
    : ["failed", "blocked", "rejected"].includes(status ?? "")
      ? "red"
      : status === "partial"
        ? "amber"
        : "neutral";
export const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
export function RevealDialog({
  title,
  note,
  value,
  onClose,
}: {
  title: string;
  note: string;
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  return (
    <Modal labelledBy="reveal-title" onClose={onClose}>
      <h2 id="reveal-title">{title}</h2>
      <p>{note}</p>
      <code className="secret-value">{value}</code>
      {copied === "no" && (
        <p className="form-message error" role="alert">
          The browser blocked copying. Select the text and copy it manually.
        </p>
      )}
      <div className="actions">
        <button
          onClick={async () =>
            setCopied((await copyText(value)) ? "yes" : "no")
          }
        >
          <Copy size={15} /> {copied === "yes" ? "Copied" : "Copy"}
        </button>
        <button className="primary" onClick={onClose}>
          I have saved it
        </button>
      </div>
    </Modal>
  );
}
export function ScraperCards({
  items,
  query,
  act,
  onOpen,
  onNew,
}: {
  items: any[];
  query: string;
  act: Act;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const visible = items.filter((s) =>
    s.name?.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="scraper-grid">
      {visible.map((s) => (
        <div className="scraper-card" key={s.id}>
          <div className="card-top">
            <span className="site-icon">
              <Layers size={22} />
            </span>
            <Badge tone={statusTone(s.lastRun?.status)}>
              {s.lastRun ? `Last run: ${s.lastRun.status}` : "No runs yet"}
            </Badge>
          </div>
          <button className="card-open" onClick={() => onOpen(s.id)}>
            <h3>{s.name}</h3>
            <p>{s.draft?.allowedDomains?.join(", ")}</p>
          </button>
          <footer>
            <span>
              {s.draft?.steps?.length ?? 0} steps · edited{" "}
              {new Date(s.updatedAt).toLocaleDateString()}
            </span>
            <button
              className="icon-button"
              aria-label={`Delete ${s.name}`}
              title="Delete scraper"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${s.name}" and all of its versions, runs and results? This cannot be undone.`,
                  )
                )
                  void act(
                    () => api(`scrapers/${s.id}`, "DELETE"),
                    `Deleted "${s.name}".`,
                  );
              }}
            >
              <Trash2 size={14} />
            </button>
          </footer>
        </div>
      ))}
      <button className="new-card" onClick={onNew}>
        <span>
          <Plus size={22} />
        </span>
        <h3>Create a new scraper</h3>
        <p>
          {query && !visible.length
            ? `No scrapers match "${query}".`
            : "Start with a URL. Build visually."}
        </p>
      </button>
    </div>
  );
}
function ResultsDialog({
  state,
  onChange,
}: {
  state: { run: any; rows: unknown[]; next: number | null; problem: string };
  onChange: (next: typeof state | null) => void;
}) {
  const { run, rows, next, problem } = state;
  const close = () => onChange(null);
  const [copied, setCopied] = useState("");
  async function more() {
    try {
      const data = await api(`runs/${run.id}/results?limit=100&cursor=${next}`);
      onChange({
        ...state,
        rows: [...rows, ...data.rows],
        next: data.nextCursor,
        problem: "",
      });
    } catch (e) {
      onChange({ ...state, problem: (e as Error).message });
    }
  }
  async function download(format: "json" | "csv") {
    try {
      const r = await fetch(`/api/v1/runs/${run.id}/results?format=${format}`);
      if (!r.ok)
        throw new Error(
          (await r.json().catch(() => ({}))).error ??
            `Download failed (HTTP ${r.status})`,
        );
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await r.blob());
      link.download = `run-${run.id.slice(0, 8)}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (e) {
      onChange({ ...state, problem: (e as Error).message });
    }
  }
  return (
    <Modal labelledBy="results-title" wide onClose={close}>
      <button className="close" aria-label="Close" onClick={close}>
        ×
      </button>
      <h2 id="results-title">{run.scraperName}</h2>
      <p>
        Run {run.id.slice(0, 8)} · {run.status} · {run.rowCount} rows ·{" "}
        {when(run.createdAt)}
      </p>
      {problem && (
        <p className="form-message error" role="alert">
          {problem}
        </p>
      )}
      {rows.length ? (
        <pre className="results-json">{JSON.stringify(rows, null, 2)}</pre>
      ) : (
        <p className="form-message error">
          No result rows are stored for this run. They were deleted or passed
          the 30-day retention.
        </p>
      )}
      <div className="actions">
        {next !== null && <button onClick={more}>Load more</button>}
        <button
          disabled={!rows.length}
          onClick={async () =>
            setCopied(
              (await copyText(JSON.stringify(rows, null, 2)))
                ? `Copied ${rows.length} rows`
                : "Copy blocked; select the text",
            )
          }
        >
          <Copy size={15} /> {copied || "Copy JSON"}
        </button>
        <button disabled={!rows.length} onClick={() => download("json")}>
          <Download size={15} /> Download JSON
        </button>
        <button disabled={!rows.length} onClick={() => download("csv")}>
          <Download size={15} /> Download CSV
        </button>
      </div>
    </Modal>
  );
}
export function RunsTable({
  items,
  act,
  refresh,
  onRepair,
}: {
  items: any[];
  act: Act;
  refresh: () => void;
  onRepair: (run: any) => void;
}) {
  const [open, setOpen] = useState<null | {
    run: any;
    rows: unknown[];
    next: number | null;
    problem: string;
  }>(null);
  const active = items.some((r) => ["queued", "running"].includes(r.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [active, refresh]);
  if (!items.length)
    return (
      <EmptyState title="No runs yet">
        Open a scraper and choose Run scraper, or start a run with the API.
      </EmptyState>
    );
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scraper</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Duration</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.scraperName}</b>
                  <br />
                  <code>{r.id.slice(0, 8)}</code>
                </td>
                <td>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  {r.source === "browser" && (
                    <small className="run-source">In your browser</small>
                  )}
                  {r.error?.message && (
                    <small className="run-error">
                      {String(r.error.message).split("\n")[0]}
                    </small>
                  )}
                </td>
                <td>{r.rowCount}</td>
                <td>
                  {r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : "—"}
                </td>
                <td>{when(r.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    {["queued", "running"].includes(r.status) ? (
                      <button
                        onClick={() => {
                          if (window.confirm("Cancel this run?"))
                            void act(
                              () => api(`runs/${r.id}/cancel`, "POST", {}),
                              "Cancel requested. The run stops within a few seconds.",
                            );
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <>
                        <button
                          disabled={!r.storedRows}
                          onClick={() =>
                            act(async () => {
                              const data = await api(
                                `runs/${r.id}/results?limit=100`,
                              );
                              setOpen({
                                run: r,
                                rows: data.rows,
                                next: data.nextCursor,
                                problem: "",
                              });
                            })
                          }
                        >
                          View results
                        </button>
                        <button onClick={() => onRepair(r)}>
                          Repair / edit
                        </button>
                        {r.hasScreenshot && (
                          <a
                            className="button"
                            target="_blank"
                            rel="noreferrer"
                            href={`/api/v1/runs/${r.id}/artifact`}
                          >
                            Screenshot
                          </a>
                        )}
                        {r.storedRows > 0 && (
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete the ${r.storedRows} stored rows and diagnostics of this run? The run record stays.`,
                                )
                              )
                                void act(
                                  () => api(`runs/${r.id}/results`, "DELETE"),
                                  "Result rows and diagnostics deleted.",
                                );
                            }}
                          >
                            Delete results
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <ResultsDialog state={open} onChange={setOpen} />}
    </>
  );
}
export function KeysPanel({ items, act }: { items: any[]; act: Act }) {
  const [name, setName] = useState(""),
    [token, setToken] = useState<string | null>(null);
  return (
    <>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const created = await api("keys", "POST", {
              name: name.trim() || "API key",
            });
            setToken(created.token);
            setName("");
          });
        }}
      >
        <input
          aria-label="Key name"
          placeholder="Key name, for example Production app"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" type="submit">
          Generate API key <Plus size={16} />
        </button>
      </form>
      {items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
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
                  <td>{when(k.createdAt)}</td>
                  <td>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Revoke "${k.name}"? Apps using it stop working immediately.`,
                          )
                        )
                          void act(
                            () => api(`keys/${k.id}`, "DELETE"),
                            `Revoked "${k.name}".`,
                          );
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
      ) : (
        <EmptyState title="No API keys">
          Generate a key, then send it as Authorization: Bearer sp_… to /api/v1.
        </EmptyState>
      )}
      {token && (
        <RevealDialog
          title="Copy your API key"
          note="This is the only time the full key is shown. Store it somewhere safe, like a secret manager."
          value={token}
          onClose={() => setToken(null)}
        />
      )}
    </>
  );
}
export function SecretsPanel({ items, act }: { items: any[]; act: Act }) {
  const [values, setValues] = useState({ domain: "", name: "", value: "" }),
    [problem, setProblem] = useState("");
  const set =
    (field: keyof typeof values) => (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));
  return (
    <>
      <p className="panel-note">
        Stored encrypted and usable only on the domain you enter. Reference a
        credential in a Fill step as {"{{secret.name}}"}.
      </p>
      <form
        className="inline-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const domain = values.domain.trim().toLowerCase(),
            name = values.name.trim();
          const issue = !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)
            ? "Enter the site's domain, like example.com, without https:// or a path."
            : !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)
              ? "Credential names start with a letter and use only letters, numbers and _."
              : !values.value
                ? "Enter the secret value."
                : "";
          setProblem(issue);
          if (issue) return;
          void act(async () => {
            await api("secrets", "POST", { domain, name, value: values.value });
            setValues({ domain: "", name: "", value: "" });
          }, `Saved ${name} for ${domain}. Use {{secret.${name}}} in a Fill value.`);
        }}
      >
        <input
          aria-label="Domain"
          placeholder="example.com"
          value={values.domain}
          onChange={set("domain")}
        />
        <input
          aria-label="Credential name"
          placeholder="Name, e.g. password"
          value={values.name}
          onChange={set("name")}
        />
        <input
          aria-label="Secret value"
          type="password"
          autoComplete="new-password"
          placeholder="Secret value"
          value={values.value}
          onChange={set("value")}
        />
        <button className="primary" type="submit">
          Save credential
        </button>
      </form>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {items.length ? (
        items.map((s) => (
          <div className="list-row" key={s.id}>
            <b>{s.name}</b>
            <span>{s.domain}</span>
            <code>{`{{secret.${s.name}}}`}</code>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Revoke ${s.name} for ${s.domain}? Scrapers that use it will fail to log in.`,
                  )
                )
                  void act(
                    () => api(`secrets/${s.id}`, "DELETE"),
                    `Revoked ${s.name} for ${s.domain}.`,
                  );
              }}
            >
              Revoke
            </button>
          </div>
        ))
      ) : (
        <EmptyState title="No credentials">
          Save a login for a site you automate, then fill it in a scraper.
        </EmptyState>
      )}
    </>
  );
}
function ReportDialog({
  listing,
  act,
  onClose,
}: {
  listing: any;
  act: Act;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(""),
    [problem, setProblem] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <Modal labelledBy="report-title" onClose={onClose}>
      <button className="close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <h2 id="report-title">Report "{listing.name}"</h2>
      <p>
        Tell an administrator what is wrong, for example that it collects
        personal data or targets a site that forbids automation.
      </p>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < 10)
            return setProblem(
              "Describe the problem in at least 10 characters.",
            );
          setPending(true);
          try {
            await api(`marketplace/${listing.id}/report`, "POST", {
              reason: reason.trim(),
            });
            onClose();
            await act(
              async () => {},
              "Thanks. An administrator will review your report.",
            );
          } catch (err) {
            setProblem((err as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="report-reason" className="field-label">
          What is wrong?
        </label>
        <textarea
          id="report-reason"
          className="dialog-textarea"
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={!!problem}
          aria-describedby={problem ? "report-problem" : undefined}
        />
        {problem && (
          <small id="report-problem" className="field-error" role="alert">
            {problem}
          </small>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send report"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MarketplaceGrid({
  items,
  signedIn,
  act,
  onInstalled,
  onSignIn,
}: {
  items: any[];
  signedIn: boolean;
  act: Act;
  onInstalled: (id: string) => void;
  onSignIn: () => void;
}) {
  const [reporting, setReporting] = useState<any>(null);
  if (!items.length)
    return (
      <EmptyState title="A fresh marketplace">
        Reviewed community templates will appear here.
      </EmptyState>
    );
  return (
    <>
      <div className="scraper-grid">
        {items.map((s) => (
          <div className="scraper-card" key={s.id}>
            <div className="card-top">
              <Badge tone="green">Template v{s.version}</Badge>
              <small className="meta">{s.installCount} installs</small>
            </div>
            <h3>{s.name}</h3>
            <p>{s.description || "No description."}</p>
            <p className="meta">
              By {s.creator} · {(s.domains ?? []).join(", ")}
            </p>
            {Object.keys(s.inputs ?? {}).length > 0 && (
              <p className="meta">
                Inputs:{" "}
                {Object.entries(s.inputs)
                  .map(([name, input]: any) => `${name} (${input.type})`)
                  .join(", ")}
              </p>
            )}
            {Array.isArray(s.sampleOutput) && s.sampleOutput.length > 0 && (
              <details>
                <summary>Sample output</summary>
                <pre>{JSON.stringify(s.sampleOutput.slice(0, 3), null, 2)}</pre>
              </details>
            )}
            <div className="card-actions">
              <button
                className="primary"
                onClick={() =>
                  signedIn
                    ? act(async () => {
                        const installed = await api(
                          `marketplace/${s.id}/install`,
                          "POST",
                          {},
                        );
                        onInstalled(installed.id);
                      }, `Installed "${s.name}" as your private copy.`)
                    : onSignIn()
                }
              >
                Install template <Plus size={15} />
              </button>
              <button onClick={() => (signedIn ? setReporting(s) : onSignIn())}>
                <Flag size={14} /> Report
              </button>
            </div>
          </div>
        ))}
      </div>
      {reporting && (
        <ReportDialog
          listing={reporting}
          act={act}
          onClose={() => setReporting(null)}
        />
      )}
    </>
  );
}
export function ReviewQueue({ items, act }: { items: any[]; act: Act }) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">(
      "pending",
    ),
    [notes, setNotes] = useState<Record<string, string>>({});
  const shown = items.filter((item) => item.listing.status === filter);
  return (
    <>
      <div className="filter-tabs" role="tablist" aria-label="Review status">
        {(["pending", "approved", "rejected"] as const).map((status) => (
          <button
            key={status}
            role="tab"
            aria-selected={filter === status}
            className={filter === status ? "active" : ""}
            onClick={() => setFilter(status)}
          >
            {status[0].toUpperCase() + status.slice(1)} (
            {items.filter((item) => item.listing.status === status).length})
          </button>
        ))}
      </div>
      {!shown.length && (
        <EmptyState
          title={
            filter === "pending"
              ? "Nothing to review"
              : `No ${filter} templates`
          }
        >
          {filter === "pending"
            ? "New template submissions appear here."
            : "Templates move here after a decision."}
        </EmptyState>
      )}
      {shown.map((item) => {
        const { listing } = item,
          note = notes[listing.id] ?? "";
        return (
          <div className="panel" key={listing.id}>
            <h3>
              {listing.name}{" "}
              <Badge tone={statusTone(listing.status)}>{listing.status}</Badge>
            </h3>
            <p>{listing.description || "No description."}</p>
            <p className="meta">
              By {item.creator} · version {item.version} · submitted{" "}
              {when(listing.createdAt)} · domains:{" "}
              {item.definition?.allowedDomains?.join(", ")}
            </p>
            {listing.reviewNote && (
              <p className="meta">Review note: {listing.reviewNote}</p>
            )}
            <details>
              <summary>Inspect definition</summary>
              <pre>{JSON.stringify(item.definition, null, 2)}</pre>
            </details>
            <textarea
              aria-label={`Review note for ${listing.name}`}
              placeholder="Review note (required when rejecting)"
              maxLength={2000}
              value={note}
              onChange={(e) =>
                setNotes((n) => ({ ...n, [listing.id]: e.target.value }))
              }
            />
            <div className="card-actions">
              {listing.status !== "approved" && (
                <button
                  className="primary"
                  onClick={() =>
                    act(
                      () =>
                        api("admin/listings", "POST", {
                          id: listing.id,
                          status: "approved",
                          note,
                        }),
                      `Approved "${listing.name}". It is now public.`,
                    )
                  }
                >
                  Approve
                </button>
              )}
              {listing.status !== "rejected" && (
                <button
                  onClick={() => {
                    if (!note.trim())
                      return void act(async () => {
                        throw new Error(
                          "Add a review note explaining why the template is rejected.",
                        );
                      });
                    if (
                      window.confirm(
                        `Reject "${listing.name}"?${listing.status === "approved" ? " It will be removed from the marketplace." : ""}`,
                      )
                    )
                      void act(
                        () =>
                          api("admin/listings", "POST", {
                            id: listing.id,
                            status: "rejected",
                            note,
                          }),
                        `Rejected "${listing.name}".`,
                      );
                  }}
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
