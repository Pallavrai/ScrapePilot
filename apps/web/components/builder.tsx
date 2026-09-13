"use client";
import { useState, useEffect, useRef } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Play,
  Save,
  MousePointer2,
  Hand,
  GripVertical,
  Plus,
  Trash2,
  Globe,
  Code,
  Download,
  Upload,
  RefreshCw,
} from "lucide-react";
import {
  definitionSchema,
  type ScraperDefinitionV1,
} from "@scrapepilot/contracts";
import { api } from "./workspace";
function SortableStep({
  step,
  onClick,
  onDelete,
  selected,
}: {
  step: any;
  onClick: () => void;
  onDelete: () => void;
  selected: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: step.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`step ${selected ? "selected" : ""}`}
    >
      <button {...attributes} {...listeners} aria-label="Reorder step">
        <GripVertical size={15} />
      </button>
      <button className="step-title" onClick={onClick}>
        <b>{step.type}</b>
        <small>
          {step.url ??
            step.locator?.primary ??
            step.container?.primary ??
            step.linkField ??
            step.mode}
        </small>
      </button>
      <button onClick={onDelete} aria-label="Delete step">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
export default function Builder({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const [d, setD] = useState<ScraperDefinitionV1 | null>(null),
    [regex, setRegex] = useState(""),
    [required, setRequired] = useState(false),
    [inputName, setInputName] = useState(""),
    [inputType, setInputType] = useState("text"),
    [linkField, setLinkField] = useState("url"),
    [upgrade, setUpgrade] = useState<any>(null),
    [message, setMessage] = useState(""),
    [connected, setConnected] = useState(false),
    [mode, setMode] = useState("interact"),
    [selection, setSelection] = useState<any>(null),
    [fieldName, setFieldName] = useState("title"),
    [fieldType, setFieldType] = useState("string"),
    [fieldSource, setFieldSource] = useState("text"),
    [attr, setAttr] = useState("href"),
    [value, setValue] = useState("{{searchTerm}}"),
    [selectedStep, setSelectedStep] = useState(""),
    [input, setInput] = useState("{}"),
    [raw, setRaw] = useState(false),
    [json, setJson] = useState(""),
    [result, setResult] = useState<unknown>(null),
    [baseline, setBaseline] = useState<unknown>(null),
    [runId, setRunId] = useState<string | null>(null),
    [url, setUrl] = useState(""),
    [typing, setTyping] = useState("");
  const socket = useRef<WebSocket | null>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    api(`scrapers/${id}`)
      .then((s) => {
        setD(s.draft);
        if (s.lastRun?.error) {
          setSelectedStep(s.lastRun.error.stepId ?? "");
          setMessage(
            `Last run: ${s.lastRun.error.message}. Select a replacement element or field, then run a new version.`,
          );
          void api(`runs/${s.lastRun.id}/results`).then((r) =>
            setBaseline(r.rows),
          );
        }
        setUrl(
          s.draft.steps.find((s: any) => s.type === "navigate")?.url ?? "",
        );
        setInput(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(s.draft.inputs)
                .filter(([, v]: any) => v.type !== "secretRef")
                .map(([k, v]: any) => [k, v.default ?? ""]),
            ),
            null,
            2,
          ),
        );
      })
      .catch((e) => setMessage(e.message));
    return () => socket.current?.close();
  }, [id]);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const r = await api(`runs/${runId}`);
        if (!active) return;
        setMessage(`Run ${r.status}${r.error ? `: ${r.error.message}` : ""}`);
        if (!["queued", "running"].includes(r.status)) {
          clearInterval(timer);
          setResult((await api(`runs/${runId}/results`)).rows);
        }
      } catch (e) {
        setMessage((e as Error).message);
      }
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId]);
  function send(payload: unknown) {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(payload));
    else setMessage("Connect a browser first.");
  }
  async function connect() {
    try {
      const { token, url: wsUrl } = await api(
        `scrapers/${id}/browser`,
        "POST",
        {},
      );
      const ws = new WebSocket(wsUrl);
      socket.current = ws;
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "authenticate", token }));
      ws.onclose = () => setConnected(false);
      ws.onerror = () =>
        setMessage("Browser worker is unavailable. Start the worker service.");
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "ready") {
          setConnected(true);
          setMessage(
            "Browser connected. Interact with the page or switch to Select.",
          );
        }
        if (data.type === "frame") {
          const img = new Image();
          img.onload = () => {
            const c = canvas.current;
            if (c) {
              c.width = img.width;
              c.height = img.height;
              c.getContext("2d")?.drawImage(img, 0, 0);
            }
          };
          img.src = `data:image/jpeg;base64,${data.data}`;
        }
        if (data.type === "selection") setSelection(data);
        if (data.type === "error") setMessage(data.message);
        if (data.type === "notice") setMessage(data.message);
        if (data.type === "url") setUrl(data.url);
      };
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function add(step: any) {
    setD((prev) =>
      prev
        ? {
            ...prev,
            steps: [...prev.steps, { ...step, id: crypto.randomUUID() }],
          }
        : prev,
    );
  }
  async function save(version = false) {
    if (!d) return;
    const parsed = definitionSchema.parse(d);
    await api(`scrapers/${id}`, "PATCH", { definition: parsed });
    if (version) {
      const v = await api(`scrapers/${id}/versions`, "POST", {});
      return v;
    }
    setMessage("Draft saved.");
  }
  function drag(e: DragEndEvent) {
    if (d && e.over && e.active.id !== e.over.id)
      setD({
        ...d,
        steps: arrayMove(
          d.steps,
          d.steps.findIndex((s) => s.id === e.active.id),
          d.steps.findIndex((s) => s.id === e.over!.id),
        ),
      });
  }
  async function run() {
    try {
      socket.current?.close();
      setConnected(false);
      await save(true);
      const r = await api(`scrapers/${id}/runs`, "POST", {
        input: JSON.parse(input),
      });
      setRunId(r.runId);
      setMessage("Run queued.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function addField() {
    if (!selection || !d) return;
    const index = d.steps.findIndex(
      (s) =>
        s.id === selectedStep &&
        (s.type === "extractCollection" || s.type === "followEach"),
    );
    if (index < 0) {
      setMessage(
        "Select a collection step first, then select a child field in the browser.",
      );
      return;
    }
    const steps = [...d.steps];
    const step = steps[index];
    if (step.type !== "extractCollection" && step.type !== "followEach") return;
    steps[index] = {
      ...step,
      fields: [
        ...step.fields.filter((f) => f.name !== fieldName),
        {
          name: fieldName,
          locator: {
            primary: selection.relativeSelector ?? selection.selector,
            fallbacks: [],
          },
          source: fieldSource as any,
          ...(regex ? { regex: { pattern: regex, group: 0 } } : {}),
          attribute: attr,
          type: fieldType as any,
          trim: true,
          required,
        },
      ],
    };
    setD({ ...d, steps });
  }
  if (!d) return <div className="empty">{message || "Loading scraper…"}</div>;
  return (
    <div className="builder">
      <div className="builder-heading">
        <button onClick={onBack}>
          <ArrowLeft size={18} /> Back
        </button>
        <input
          className="title-input"
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
        <span className="spacer" />
        <button
          onClick={() => {
            setJson(JSON.stringify(d, null, 2));
            setRaw(!raw);
          }}
        >
          <Code size={16} /> Definition
        </button>
        <button onClick={() => save().catch((e) => setMessage(e.message))}>
          <Save size={16} /> Save draft
        </button>
        <button className="primary" onClick={run}>
          <Play size={15} /> Run scraper
        </button>
      </div>
      <div className="builder-notice">
        {message ||
          "Connect a browser, select an element, and build a repeatable workflow."}
      </div>
      <div className="editor-grid">
        <section className="steps-panel">
          <div className="panel-title">
            WORKFLOW <span>{d.steps.length} STEPS</span>
          </div>
          <DndContext collisionDetection={closestCenter} onDragEnd={drag}>
            <SortableContext
              items={d.steps.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {d.steps.map((s) => (
                <SortableStep
                  key={s.id}
                  step={s}
                  selected={s.id === selectedStep}
                  onClick={() => {
                    setSelectedStep(s.id);
                    if (s.type === "extractCollection")
                      send({
                        type: "container",
                        selector: s.container.primary,
                      });
                  }}
                  onDelete={() =>
                    setD({ ...d, steps: d.steps.filter((x) => x.id !== s.id) })
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            className="add-step"
            onClick={() => add({ type: "navigate", url })}
          >
            <Plus size={16} /> Add navigation
          </button>
          <details className="input-config" open>
            <summary>Run inputs</summary>
            <div className="input-builder">
              <input
                placeholder="Input name"
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
              />
              <select
                value={inputType}
                onChange={(e) => setInputType(e.target.value)}
              >
                {["text", "number", "boolean", "url", "secretRef"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(inputName)) {
                    setMessage("Use a field name beginning with a letter.");
                    return;
                  }
                  setD({
                    ...d,
                    inputs: {
                      ...d.inputs,
                      [inputName]: { type: inputType as any, required: true },
                    },
                  });
                  setInputName("");
                }}
              >
                Add input
              </button>
            </div>
            <textarea
              aria-label="Run inputs JSON"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <small>
              Bind form fields using {"{{searchTerm}}"}. Add input declarations
              in Definition.
            </small>
          </details>
          <details className="input-config">
            <summary>Pagination & details</summary>
            <input
              aria-label="Detail link field"
              value={linkField}
              onChange={(e) => setLinkField(e.target.value)}
            />
            <button
              onClick={() => {
                const stepId = crypto.randomUUID();
                setD({
                  ...d,
                  steps: [
                    ...d.steps,
                    { id: stepId, type: "followEach", linkField, fields: [] },
                  ],
                });
                setSelectedStep(stepId);
                setMessage(
                  "Open a detail page in the browser, then select fields to add to this detail step.",
                );
              }}
            >
              Follow detail links
            </button>
            <button
              onClick={() =>
                add({ type: "paginate", mode: "scroll", maxPages: 5 })
              }
            >
              Add infinite scroll
            </button>
            <button
              disabled={!selection}
              onClick={() =>
                add({
                  type: "paginate",
                  mode: "next",
                  next: { primary: selection.selector, fallbacks: [] },
                  maxPages: 5,
                })
              }
            >
              Use selection as Next
            </button>
            <p>
              Detail-page field mappings are editable in Definition using a
              followEach step.
            </p>
          </details>
        </section>
        <section className="browser-panel">
          <div className="browser-toolbar">
            <Globe size={16} />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Browser URL"
            />
            <button
              onClick={() => send({ type: "navigate", url })}
              disabled={!connected}
            >
              <RefreshCw size={15} />
            </button>
            <button
              className={mode === "interact" ? "toggle active" : "toggle"}
              onClick={() => {
                setMode("interact");
                send({ type: "mode", mode: "interact" });
              }}
            >
              <Hand size={15} /> Interact
            </button>
            <button
              className={mode === "select" ? "toggle active" : "toggle"}
              onClick={() => {
                setMode("select");
                send({ type: "mode", mode: "select" });
              }}
            >
              <MousePointer2 size={15} /> Select
            </button>
          </div>
          <div className="browser-stage">
            {!connected && (
              <div className="connect-prompt">
                <div className="connect-icon">
                  <Globe size={36} />
                </div>
                <h2>Your browser, inside the builder.</h2>
                <p>
                  Connect a secure browser session to explore the site
                  <br />
                  and select the data you want to collect.
                </p>
                <button className="primary" onClick={connect}>
                  Connect browser{" "}
                  <ArrowLeft
                    size={16}
                    style={{ transform: "rotate(180deg)" }}
                  />
                </button>
                <small>The browser worker must be running.</small>
              </div>
            )}
            <canvas
              ref={canvas}
              tabIndex={0}
              aria-label="Remote browser viewport"
              className={connected ? "viewport" : "viewport hidden"}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                send({
                  type: "pointer",
                  x:
                    ((e.clientX - rect.left) * e.currentTarget.width) /
                    rect.width,
                  y:
                    ((e.clientY - rect.top) * e.currentTarget.height) /
                    rect.height,
                });
              }}
              onMouseMove={(e) => {
                if (mode !== "select") return;
                const rect = e.currentTarget.getBoundingClientRect();
                send({
                  type: "hover",
                  x:
                    ((e.clientX - rect.left) * e.currentTarget.width) /
                    rect.width,
                  y:
                    ((e.clientY - rect.top) * e.currentTarget.height) /
                    rect.height,
                });
              }}
              onWheel={(e) => send({ type: "scroll", deltaY: e.deltaY })}
              onKeyDown={(e) => {
                if (
                  e.key === "Tab" ||
                  e.key === "Enter" ||
                  e.key === "Backspace"
                ) {
                  e.preventDefault();
                  send({ type: "key", key: e.key });
                }
              }}
            />
          </div>
          {connected && (
            <div className="typing-bar">
              <button onClick={() => send({ type: "saveSession" })}>
                Save login session
              </button>
              <button
                onClick={() =>
                  api(`scrapers/${id}/session`, "DELETE")
                    .then(() => setMessage("Saved session revoked."))
                    .catch((e) => setMessage(e.message))
                }
              >
                Revoke session
              </button>
              <input
                value={typing}
                onChange={(e) => setTyping(e.target.value)}
                placeholder="Text to type into the focused field"
              />
              <button
                onClick={() => {
                  send({ type: "type", text: typing });
                  setTyping("");
                }}
              >
                Type
              </button>
              <button onClick={() => send({ type: "key", key: "Enter" })}>
                Enter
              </button>
            </div>
          )}
          <div className="results-panel">
            {baseline !== null && (
              <details>
                <summary>Previous output (compare after rerun)</summary>
                <pre>{JSON.stringify(baseline, null, 2)}</pre>
              </details>
            )}
            <div className="panel-title">
              OUTPUT PREVIEW <span>JSON</span>
            </div>
            <pre>
              {result
                ? JSON.stringify(result, null, 2)
                : "// Run your scraper to preview structured results."}
            </pre>
          </div>
        </section>
        <section className="properties-panel">
          <div className="panel-title">ELEMENT INSPECTOR</div>
          {d.steps
            .filter((s) => s.id === selectedStep && "fields" in s)
            .map(
              (s) =>
                "fields" in s && (
                  <div key={s.id} className="field-list">
                    <h3>Output fields</h3>
                    {s.fields.map((f, i) => (
                      <div key={f.name}>
                        <span>
                          {f.name} <small>{f.type}</small>
                        </span>
                        <button
                          aria-label={`Remove ${f.name}`}
                          onClick={() =>
                            setD({
                              ...d,
                              steps: d.steps.map((step) =>
                                step.id === s.id
                                  ? {
                                      ...s,
                                      fields: s.fields.filter(
                                        (_, index) => index !== i,
                                      ),
                                    }
                                  : step,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ),
            )}
          {selection ? (
            <>
              <span className="pill">
                {selection.tag} · {selection.count} matching
              </span>
              <code className="selector-text">{selection.selector}</code>
              {selection.ancestors?.length > 0 && (
                <label>
                  Select a parent container
                  <select
                    value=""
                    onChange={(e) => {
                      const ancestor = selection.ancestors.find(
                        (a: any) => a.selector === e.target.value,
                      );
                      if (ancestor)
                        setSelection({
                          ...selection,
                          ...ancestor,
                          relativeSelector: ancestor.selector,
                        });
                    }}
                  >
                    <option value="">Choose parent…</option>
                    {selection.ancestors.map((a: any) => (
                      <option key={a.selector} value={a.selector}>
                        {a.selector} ({a.count} matches)
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="selected-text">{selection.text}</p>
              <label>
                Action value
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <div className="action-grid">
                <button
                  onClick={() => {
                    setD({
                      ...d,
                      steps: d.steps.map((s) =>
                        s.id !== selectedStep
                          ? s
                          : "locator" in s
                            ? {
                                ...s,
                                locator: {
                                  primary: selection.selector,
                                  frame: selection.frame,
                                  fallbacks: [],
                                },
                              }
                            : s.type === "extractCollection"
                              ? {
                                  ...s,
                                  container: {
                                    primary: selection.selector,
                                    frame: selection.frame,
                                    fallbacks: [],
                                  },
                                }
                              : s,
                      ),
                    });
                    setMessage("Selected step now uses this element.");
                  }}
                >
                  Replace selector
                </button>
                <button
                  onClick={() =>
                    add({
                      type: "fill",
                      locator: {
                        primary: selection.selector,
                        frame: selection.frame,
                        fallbacks: [],
                      },
                      value,
                    })
                  }
                >
                  Fill input
                </button>
                <button
                  onClick={() =>
                    add({
                      type: "click",
                      locator: {
                        primary: selection.selector,
                        frame: selection.frame,
                        fallbacks: [],
                      },
                    })
                  }
                >
                  Click
                </button>
                <button
                  onClick={() =>
                    add({
                      type: "waitFor",
                      locator: {
                        primary: selection.selector,
                        frame: selection.frame,
                        fallbacks: [],
                      },
                    })
                  }
                >
                  Wait for
                </button>
                <button
                  onClick={() => {
                    const stepId = crypto.randomUUID();
                    setD({
                      ...d,
                      steps: [
                        ...d.steps,
                        {
                          id: stepId,
                          type: "extractCollection",
                          container: {
                            primary: selection.selector,
                            frame: selection.frame,
                            fallbacks: [],
                          },
                          fields: [],
                        },
                      ],
                    });
                    setSelectedStep(stepId);
                    send({ type: "container", selector: selection.selector });
                    setMessage(
                      "Collection selected. Select a child field and add it below.",
                    );
                  }}
                >
                  Use as collection
                </button>
              </div>
              <hr />
              <label>
                Output field name
                <input
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                />
              </label>
              <label>
                Extract matching text (optional)
                <input
                  value={regex}
                  onChange={(e) => setRegex(e.target.value)}
                  placeholder="e.g. [0-9.]+"
                />
              </label>
              <label>
                <input
                  style={{ display: "inline", width: "auto" }}
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />{" "}
                Required field
              </label>
              <label>
                Output type
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                >
                  {[
                    "string",
                    "number",
                    "boolean",
                    "date",
                    "url",
                    "imageUrl",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Read from
                <select
                  value={fieldSource}
                  onChange={(e) => setFieldSource(e.target.value)}
                >
                  <option value="text">Text content</option>
                  <option value="attribute">Attribute</option>
                  <option value="innerHTML">HTML string</option>
                </select>
              </label>
              {fieldSource === "attribute" && (
                <label>
                  Attribute
                  <input
                    value={attr}
                    onChange={(e) => setAttr(e.target.value)}
                  />
                </label>
              )}
              <button className="primary" onClick={addField}>
                <Plus size={15} /> Add output field
              </button>
            </>
          ) : (
            <div className="inspector-empty">
              <MousePointer2 size={25} />
              <h3>Point to your data</h3>
              <p>
                Switch to Select and click an element in the browser to
                configure it.
              </p>
            </div>
          )}
          <div className="publish-box">
            <button
              onClick={async () => {
                try {
                  setUpgrade(await api(`scrapers/${id}/upgrade`));
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Check template updates
            </button>
            <h3>Ready to share?</h3>
            <p>Publish a version for administrator review.</p>
            <button
              onClick={async () => {
                try {
                  const v = await save(true);
                  if (
                    !window.confirm(
                      "I am authorized to automate these domains and have reviewed this definition for sensitive data. Submit for review?",
                    )
                  )
                    return;
                  await api("marketplace", "POST", {
                    versionId: v.id,
                    attestation: true,
                    description: d.name,
                  });
                  setMessage("Submitted for marketplace review.");
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <Upload size={15} /> Submit template
            </button>
            <a className="button" href={`/api/v1/scrapers/${id}/export`}>
              <Download size={15} /> Export TypeScript
            </a>
          </div>
        </section>
      </div>
      {upgrade && (
        <div className="modal-backdrop">
          <div className="modal wide">
            <h2>Review template update · v{upgrade.number}</h2>
            <p>
              Your current draft will be replaced only when you apply this
              update. Existing versions remain available.
            </p>
            <div className="diff-grid">
              <pre>{JSON.stringify(upgrade.current, null, 2)}</pre>
              <pre>{JSON.stringify(upgrade.proposed, null, 2)}</pre>
            </div>
            <div className="actions">
              <button onClick={() => setUpgrade(null)}>Keep current</button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await api(`scrapers/${id}/upgrade`, "POST", {
                      versionId: upgrade.versionId,
                    });
                    setD(upgrade.proposed);
                    setUpgrade(null);
                    setMessage("Template update applied to draft.");
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                Apply update
              </button>
            </div>
          </div>
        </div>
      )}
      {raw && (
        <div className="modal-backdrop">
          <div className="modal wide">
            <h2>Workflow definition</h2>
            <p>
              Edit typed inputs, field mappings, fallback selectors, and detail
              extraction.
            </p>
            <textarea
              className="code-editor"
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="actions">
              <button onClick={() => setRaw(false)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  try {
                    setD(definitionSchema.parse(JSON.parse(json)));
                    setRaw(false);
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                Apply definition
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
