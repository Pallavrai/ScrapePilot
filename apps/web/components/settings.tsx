"use client";
import { useEffect, useState } from "react";
import { api } from "./workspace";
export default function Settings({ section }: { section: string }) {
  const [items, setItems] = useState<any[]>([]),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setItems(await api(section));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [section]);
  async function mutate(path: string, method: string, body?: unknown) {
    try {
      const result = await api(path, method, body);
      setMessage(
        result.signingKey
          ? `Copy your signing key now: ${result.signingKey}`
          : "Saved.",
      );
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div>
      {message && <div className="notice">{message}</div>}
      {section === "webhooks" && (
        <>
          <p>Receive signed run completion events at your HTTPS endpoint.</p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                "webhooks",
                "POST",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
            }}
          >
            <input
              name="url"
              type="url"
              placeholder="https://your-app.com/webhooks"
              required
            />
            <button className="primary">Add webhook</button>
          </form>
          {items.map((item) => (
            <div className="list-row" key={item.id}>
              <span>{item.url}</span>
              <button onClick={() => mutate(`webhooks/${item.id}`, "DELETE")}>
                Revoke
              </button>
            </div>
          ))}
        </>
      )}
      {section === "admin/users" &&
        items.map((u) => (
          <form
            className="list-row"
            key={u.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(section, "POST", {
                id: u.id,
                monthlyMinutes: Number(f.get("minutes")),
                suspended: f.get("suspended") === "on",
              });
            }}
          >
            <b>{u.email}</b>
            <label>
              Monthly minutes{" "}
              <input
                name="minutes"
                type="number"
                min="0"
                max="10000"
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
            <button>Save</button>
          </form>
        ))}
      {section === "admin/domains" && (
        <>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(section, "POST", {
                ...Object.fromEntries(new FormData(e.currentTarget)),
                blocked: true,
              });
            }}
          >
            <input name="domain" placeholder="example.com" required />
            <button>Block domain</button>
          </form>
          {items.map((p) => (
            <div className="list-row" key={p.domain}>
              <b>{p.domain}</b>
              <span>{p.blocked ? "Blocked" : "Allowed"}</span>
              <button
                onClick={() =>
                  mutate(section, "POST", {
                    domain: p.domain,
                    blocked: !p.blocked,
                  })
                }
              >
                {p.blocked ? "Unblock" : "Block"}
              </button>
            </div>
          ))}
        </>
      )}
      {section === "admin/reports" &&
        items.map((r) => (
          <div className="panel" key={r.id}>
            <h3>Template report</h3>
            <p>{r.reason}</p>
            <code>{r.listingId}</code>
            <button
              onClick={() =>
                mutate("admin/listings", "POST", {
                  id: r.listingId,
                  status: "rejected",
                  note: r.reason,
                })
              }
            >
              Take down listing
            </button>
          </div>
        ))}
    </div>
  );
}
