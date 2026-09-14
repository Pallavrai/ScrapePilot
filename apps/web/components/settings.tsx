"use client";
import { useEffect, useState } from "react";
import { Badge, EmptyState } from "@scrapepilot/ui";
import { api } from "./workspace";
import { RevealDialog, statusTone, when } from "./dashboard";
type Message = { tone: "error" | "success"; text: string };
export default function Settings({ section }: { section: string }) {
  const [items, setItems] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState<Message | null>(null),
    [signingKey, setSigningKey] = useState<string | null>(null),
    [url, setUrl] = useState(""),
    [domain, setDomain] = useState("");
  const fail = (text: string) => setMessage({ tone: "error", text });
  async function load() {
    try {
      setItems(await api(section));
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setLoading(true);
    setMessage(null);
    void load();
  }, [section]);
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) {
    try {
      const result = await api(path, method, body);
      if (result.signingKey) setSigningKey(result.signingKey);
      setMessage({ tone: "success", text: success });
      await load();
      return true;
    } catch (e) {
      fail((e as Error).message);
      return false;
    }
  }
  return (
    <div>
      {message && (
        <div
          className={message.tone === "error" ? "alert" : "notice"}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </div>
      )}
      {section === "webhooks" && (
        <>
          <p className="panel-note">
            Receive signed run events (run.completed, run.partial, run.failed,
            run.blocked) at an HTTPS endpoint. Verify each request with its
            signing key as described in the Documentation.
          </p>
          <form
            className="inline-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!/^https:\/\/[^\s/]+/i.test(url.trim()))
                return fail("Webhook URLs must be public and start with https://.");
              if (await mutate("webhooks", "POST", { url: url.trim() }, "Webhook added."))
                setUrl("");
            }}
          >
            <input
              aria-label="Webhook URL"
              type="url"
              placeholder="https://your-app.com/webhooks"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="primary" type="submit">
              Add webhook
            </button>
          </form>
          {!loading && !items.length && (
            <EmptyState title="No webhooks">
              Add an HTTPS endpoint to be notified when runs finish.
            </EmptyState>
          )}
          {items.map((item) => (
            <div className="panel" key={item.id}>
              <div className="list-row">
                <b>{item.url}</b>
                <span className="meta">added {when(item.createdAt)}</span>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke the webhook for ${item.url}? It stops receiving events.`,
                      )
                    )
                      void mutate(`webhooks/${item.id}`, "DELETE", undefined, "Webhook revoked.");
                  }}
                >
                  Revoke
                </button>
              </div>
              <p className="meta">
                {item.deliveries?.length ? "Recent deliveries:" : "No deliveries yet."}
                {item.deliveries?.map((d: any) => (
                  <Badge key={`${d.runId}-${d.createdAt}`} tone={statusTone(d.status)}>
                    {d.status} · {when(d.createdAt)}
                  </Badge>
                ))}
              </p>
            </div>
          ))}
          {signingKey && (
            <RevealDialog
              title="Copy your signing key"
              note="Use it to verify the x-scrapepilot-signature header of each event. It is shown only once."
              value={signingKey}
              onClose={() => setSigningKey(null)}
            />
          )}
        </>
      )}
      {section === "admin/users" &&
        items.map((u) => (
          <form
            className="list-row"
            key={u.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                minutes = Number(f.get("minutes"));
              if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10000)
                return fail("Monthly minutes must be a whole number from 0 to 10000.");
              void mutate(
                section,
                "POST",
                {
                  id: u.id,
                  monthlyMinutes: minutes,
                  suspended: f.get("suspended") === "on",
                },
                `Saved ${u.email}.`,
              );
            }}
          >
            <span>
              <b>{u.name}</b> <small className="meta">{u.email}</small>
            </span>
            {u.role === "admin" && <Badge tone="green">admin</Badge>}
            <span className="meta">{u.usedMinutes} min used this month</span>
            <label>
              Monthly minutes{" "}
              <input
                name="minutes"
                type="number"
                min="0"
                max="10000"
                step="1"
                defaultValue={u.monthlyMinutes}
              />
            </label>
            <label>
              <input
                name="suspended"
                type="checkbox"
                defaultChecked={u.suspended}
              />{" "}
              Suspended
            </label>
            <button type="submit">Save</button>
          </form>
        ))}
      {section === "admin/domains" && (
        <>
          <form
            className="inline-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const value = domain.trim().toLowerCase();
              if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
                return fail("Enter a domain like example.com, without https:// or a path.");
              if (
                await mutate(section, "POST", { domain: value, blocked: true }, `Blocked ${value}.`)
              )
                setDomain("");
            }}
          >
            <input
              aria-label="Domain to block"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <button type="submit">Block domain</button>
          </form>
          {!loading && !items.length && (
            <EmptyState title="No domain policies">
              Blocked domains cannot be opened by any scraper or published as a template.
            </EmptyState>
          )}
          {items.map((p) => (
            <div className="list-row" key={p.domain}>
              <b>{p.domain}</b>
              <Badge tone={p.blocked ? "red" : "green"}>
                {p.blocked ? "Blocked" : "Allowed"}
              </Badge>
              <button
                onClick={() =>
                  mutate(
                    section,
                    "POST",
                    { domain: p.domain, blocked: !p.blocked },
                    `${p.blocked ? "Unblocked" : "Blocked"} ${p.domain}.`,
                  )
                }
              >
                {p.blocked ? "Unblock" : "Block"}
              </button>
            </div>
          ))}
        </>
      )}
      {section === "admin/reports" && (
        <>
          {!loading && !items.length && (
            <EmptyState title="No reports">
              Reports that users send about marketplace templates appear here.
            </EmptyState>
          )}
          {items.map((r) => (
            <div className="panel" key={r.id}>
              <h3>
                {r.listingName}{" "}
                <Badge tone={statusTone(r.listingStatus)}>{r.listingStatus}</Badge>
              </h3>
              <p>{r.reason}</p>
              <p className="meta">Reported {when(r.createdAt)}</p>
              {r.listingStatus === "approved" && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Take down "${r.listingName}"? It disappears from the marketplace.`,
                      )
                    )
                      void mutate(
                        "admin/listings",
                        "POST",
                        {
                          id: r.listingId,
                          status: "rejected",
                          note: `Taken down after a report: ${r.reason}`.slice(0, 2000),
                        },
                        `Took down "${r.listingName}".`,
                      );
                  }}
                >
                  Take down listing
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
