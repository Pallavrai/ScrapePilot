"use client";
import { useState, useEffect, useRef, type MouseEvent } from "react";
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
  Eye,
} from "lucide-react";
import {
  definitionSchema,
  explainDefinitionError,
  type ScraperDefinitionV1,
} from "@scrapepilot/contracts";
import { api } from "./workspace";
type Step = ScraperDefinitionV1["steps"][number];
const stepNames: Record<Step["type"], string> = {
  navigate: "Open page",
  fill: "Fill",
  click: "Click",
  select: "Choose option",
  waitFor: "Wait for",
  extractCollection: "Collect items",
  followEach: "Open each detail link",
  paginate: "Next pages",
};
const namePattern = /^[a-zA-Z][a-zA-Z0-9_]*$/;
function SortableStep({
  step,
  index,
  onClick,
  onDelete,
  selected,
}: {
  step: Step;
  index: number;
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
        <b>
          {index + 1}. {stepNames[step.type]}
          {"fields" in step &&
            ` · ${step.fields.length} field${step.fields.length === 1 ? "" : "s"}`}
        </b>
        <small>
          {step.type === "navigate"
            ? step.url
            : "locator" in step
              ? step.locator.primary
              : step.type === "extractCollection"
                ? step.container.primary
                : step.type === "followEach"
                  ? `link field: ${step.linkField}`
                  : step.mode === "next"
                    ? step.next?.primary
                    : "infinite scroll"}
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
    [installed, setInstalled] = useState(false),
    [message, setMessage] = useState(""),
    [tone, setTone] = useState<"info" | "error">("info"),
    [connected, setConnected] = useState(false),
    [mode, setMode] = useState<"interact" | "select">("interact"),
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
    [jsonError, setJsonError] = useState(""),
    [result, setResult] = useState<unknown>(null),
    [lastRun, setLastRun] = useState<any>(null),
    [baseline, setBaseline] = useState<unknown>(null),
    [runId, setRunId] = useState<string | null>(null),
    [url, setUrl] = useState(""),
    [typing, setTyping] = useState("");
  const socket = useRef<WebSocket | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    lastHover = useRef(0),
    lastPoint = useRef<{ x: number; y: number } | null>(null),
    latest = useRef({ d, mode, selectedStep });
  // WebSocket handlers outlive renders; they read current state through this ref.
  latest.current = { d, mode, selectedStep };
  const say = (text: string) => {
    setMessage(text);
    setTone("info");
  };
  const fail = (e: unknown) => {
    setMessage(explainDefinitionError(e).split("\n")[0]);
    setTone("error");
  };
  function describeRunError(error: { message?: string; stepId?: string }) {
    const steps = latest.current.d?.steps ?? [];
    const index = steps.findIndex((s) => s.id === error.stepId);
    const where =
      index >= 0 ? `step ${index + 1} (${stepNames[steps[index].type]}): ` : "";
    return where + String(error.message ?? "Unknown error").split("\n")[0];
  }
  useEffect(() => {
    api(`scrapers/${id}`)
      .then((s) => {
        setD(s.draft);
        setInstalled(!!s.installedVersionId);
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
        if (s.lastRun?.error) {
          setSelectedStep(s.lastRun.error.stepId ?? "");
          setLastRun(s.lastRun);
          fail(
            `Last run ${s.lastRun.status}: ${String(s.lastRun.error.message).split("\n")[0]}`,
          );
          void api(`runs/${s.lastRun.id}/results`)
            .then((r) => setBaseline(r.rows))
            .catch(() => {});
        }
      })
      .catch(fail);
    return () => socket.current?.close();
  }, [id]);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const r = await api(`runs/${runId}`);
        if (!active) return;
        if (["queued", "running"].includes(r.status)) {
          say(`Run ${r.status}… results appear below when it finishes.`);
          return;
        }
        clearInterval(timer);
        const rows = (await api(`runs/${runId}/results`)).rows;
        if (!active) return;
        setResult(rows);
        setLastRun(r);
        const count = r.rowCount ?? rows.length;
        if (r.status === "succeeded" && count)
          say(
            `Run succeeded · ${count} rows. Reconnect the browser to keep editing.`,
          );
        else if (r.status === "succeeded")
          fail(
            "Run succeeded but found 0 items. Reconnect, then use Preview to check that the collection matches items on the page.",
          );
        else {
          fail(
            `Run ${r.status} · ${count} rows · ${r.error ? describeRunError(r.error) : "no error details"}`,
          );
          if (r.error?.stepId) setSelectedStep(r.error.stepId);
        }
      } catch (e) {
        if (active) fail(e);
      }
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId]);
  // Quiet sends are background syncs (mode, collection) that should not nag before a browser is connected.
  function send(payload: unknown, quiet = false) {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(payload));
      return true;
    }
    if (!quiet) fail("Connect a browser first.");
    return false;
  }
  // Fields are relative to the chosen collection: tell the worker, then re-read the last clicked element for it.
  function syncCollection(selector: string) {
    send({ type: "container", selector }, true);
    if (lastPoint.current)
      send({ type: "inspect", ...lastPoint.current }, true);
  }
  // Pre-fill the field form from what was clicked, so most clicks need no edits.
  function suggestField(s: { tag: string; text?: string }) {
    const text = String(s.text ?? "").trim();
    const kind =
      s.tag === "img"
        ? "image"
        : s.tag === "a"
          ? "url"
          : /^[^\d\s]{0,3}\s?\d[\d,.\s]*$/.test(text)
            ? /[^\d\s.,]|\d,\d/.test(text) // currency symbol or thousands separator, not a rating
              ? "price"
              : "number"
            : "title";
    const taken = new Set(
      (latest.current.d?.steps ?? []).flatMap((step) =>
        "fields" in step ? step.fields.map((f) => f.name) : [],
      ),
    );
    let name: string = kind;
    for (let n = 2; taken.has(name); n++) name = `${kind}${n}`;
    setFieldName(name);
    setFieldType(
      kind === "image"
        ? "imageUrl"
        : kind === "url"
          ? "url"
          : kind === "price" || kind === "number"
            ? "number"
            : "string",
    );
    setFieldSource(kind === "image" || kind === "url" ? "attribute" : "text");
    setAttr(kind === "image" ? "src" : "href");
    setRegex("");
    setRequired(false);
  }
  function showPreview(data: {
    total: number;
    rows: Record<string, unknown>[];
  }) {
    setResult(data.rows);
    setLastRun(null);
    const failed = data.rows.filter((row) => row._error).length;
    const names = [...new Set(data.rows.flatMap((row) => Object.keys(row)))];
    const empty = names.filter(
      (k) => k !== "_error" && data.rows.every((row) => row[k] == null),
    );
    const text =
      `Preview of the current page: ${data.rows.length} of ${data.total} items (not saved).` +
      (failed
        ? ` ${failed} item${failed === 1 ? "" : "s"} failed; see _error below.`
        : "") +
      (empty.length
        ? ` No values found for: ${empty.join(", ")}. Reselect those fields inside an item.`
        : "");
    if (failed || empty.length || !data.rows.length) fail(text);
    else say(text);
  }
  async function connect() {
    try {
      say("Opening a browser session…");
      const { token, url: wsUrl } = await api(
        `scrapers/${id}/browser`,
        "POST",
        {},
      );
      const ws = new WebSocket(wsUrl);
      socket.current = ws;
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "authenticate", token }));
      ws.onclose = (e) => {
        if (socket.current !== ws) return; // closed on purpose (Run, Disconnect, reconnect)
        socket.current = null;
        setConnected(false);
        fail(
          e.reason
            ? `Browser disconnected: ${e.reason}`
            : "Browser disconnected. Connect again to keep editing.",
        );
      };
      ws.onerror = () =>
        fail(
          "Could not reach the browser worker. Check that it is running (pnpm worker), then retry.",
        );
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "ready") {
          setConnected(true);
          // A new worker session starts in Interact mode: re-apply the toolbar mode and chosen collection.
          const { d: current, mode: currentMode, selectedStep: chosen } =
            latest.current;
          ws.send(JSON.stringify({ type: "mode", mode: currentMode }));
          const step = current?.steps.find((s) => s.id === chosen);
          if (step?.type === "extractCollection")
            ws.send(
              JSON.stringify({
                type: "container",
                selector: step.container.primary,
              }),
            );
          say(
            currentMode === "select"
              ? "Browser connected in Select mode. Click a value on the page, such as a product title."
              : "Browser connected. Browse in Interact mode, or switch to Select to pick data.",
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
        if (data.type === "selection") {
          setSelection(data);
          if (data.via === "pointer") suggestField(data);
        }
        if (data.type === "preview") showPreview(data);
        if (data.type === "error") fail(data.message);
        if (data.type === "notice") say(data.message);
        if (data.type === "url") {
          setUrl(data.url);
          lastPoint.current = null;
        }
      };
    } catch (e) {
      fail(e);
    }
  }
  function disconnect() {
    const ws = socket.current;
    socket.current = null;
    ws?.close();
    setConnected(false);
    say("Browser disconnected.");
  }
  function changeMode(next: "interact" | "select") {
    setMode(next);
    send({ type: "mode", mode: next }, true);
    if (connected)
      say(
        next === "select"
          ? "Select mode: click a value on the page, such as a product title."
          : "Interact mode: clicks, scrolling and typing go to the page.",
      );
  }
  function pointFrom(e: MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * e.currentTarget.width) / rect.width,
      y: ((e.clientY - rect.top) * e.currentTarget.height) / rect.height,
    };
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
    const definition = definitionSchema.parse(d);
    await api(`scrapers/${id}`, "PATCH", { definition });
    if (version) return api(`scrapers/${id}/versions`, "POST", {});
    say("Draft saved.");
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
    if (!d) return;
    if (!d.steps.some((s) => "fields" in s && s.fields.length))
      return fail(
        "Nothing to extract yet. Connect the browser, switch to Select, click a value such as a product title, then choose Add output field.",
      );
    if (d.steps.some((s) => "fields" in s && !s.fields.length))
      return fail(
        "Every Collect items or detail step needs an output field. Add one or delete the empty step.",
      );
    let values: unknown;
    try {
      values = JSON.parse(input || "{}");
    } catch {
      return fail(
        'Run inputs must be valid JSON, for example {"searchTerm": "ps5"}.',
      );
    }
    try {
      definitionSchema.parse(d); // report problems before disconnecting the browser
      if (socket.current) {
        const ws = socket.current;
        socket.current = null;
        ws.close();
        setConnected(false);
      }
      await save(true);
      setResult(null);
      setLastRun(null);
      const r = await api(`scrapers/${id}/runs`, "POST", { input: values });
      setRunId(r.runId);
      say(
        "Run queued. The browser was disconnected so the run can use this site; reconnect to keep editing.",
      );
    } catch (e) {
      fail(e);
    }
  }
  function preview() {
    if (!d) return;
    if (
      !d.steps.some((s) => s.type === "extractCollection" && s.fields.length)
    )
      return fail(
        "Nothing to preview yet. Click a value such as a product title, then choose Add output field.",
      );
    try {
      if (
        send({
          type: "preview",
          definition: definitionSchema.parse(d),
          stepId: selectedStep,
        })
      )
        say("Reading items from the current page…");
    } catch (e) {
      fail(e);
    }
  }
  function addField() {
    if (!selection || !d) return;
    if (!namePattern.test(fieldName))
      return fail(
        "Field names start with a letter and use only letters, numbers and _.",
      );
    if (regex)
      try {
        new RegExp(regex);
      } catch {
        return fail(`"${regex}" is not a valid pattern.`);
      }
    const steps = [...d.steps];
    let index = steps.findIndex(
      (s) =>
        s.id === selectedStep &&
        (s.type === "extractCollection" || s.type === "followEach"),
    );
    // No collection step chosen: use the repeating item (e.g. product card) found around this element.
    if (index < 0 && selection.collection) {
      index = steps.findIndex(
        (s) =>
          s.type === "extractCollection" &&
          s.container.primary === selection.collection,
      );
      if (index < 0) {
        steps.push({
          id: crypto.randomUUID(),
          type: "extractCollection",
          container: {
            primary: selection.collection,
            frame: selection.frame,
            fallbacks: [],
          },
          fields: [],
        });
        index = steps.length - 1;
      }
      setSelectedStep(steps[index].id);
      send({ type: "container", selector: selection.collection }, true);
    }
    if (index < 0)
      return fail(
        "This element is not inside a repeating item. Click a value inside a list item, such as a product title, or select a Collect items step first.",
      );
    const step = steps[index];
    if (step.type !== "extractCollection" && step.type !== "followEach") return;
    let primary: string = selection.selector;
    if (step.type === "extractCollection") {
      // Field selectors are relative to the item; one read for another collection would find nothing.
      if (
        selection.collection &&
        selection.collection !== step.container.primary
      ) {
        syncCollection(step.container.primary);
        return fail(
          `That element was read for a different collection. It has been re-read for ${step.container.primary}; check the item count, then choose Add output field again.`,
        );
      }
      if (!selection.relativeSelector)
        return fail(
          `That element is outside the ${step.container.primary} items. Click a value inside one of them.`,
        );
      primary = selection.relativeSelector;
    }
    if (step.fields.some((f) => f.name === fieldName))
      return fail(
        `This step already has a field named "${fieldName}". Rename the new field or remove the existing one.`,
      );
    steps[index] = {
      ...step,
      fields: [
        ...step.fields,
        {
          name: fieldName,
          locator: { primary, fallbacks: [] },
          source: fieldSource as "text",
          ...(fieldSource === "attribute" ? { attribute: attr } : {}),
          ...(regex ? { regex: { pattern: regex, group: 0 } } : {}),
          type: fieldType as "string",
          trim: true,
          required,
        },
      ],
    };
    setD({ ...d, steps });
    say(
      `Added field "${fieldName}"${
        selection.rows && step.type === "extractCollection"
          ? `, found in ${selection.rows.matched} of ${selection.rows.total} items`
          : ""
      }. Click the next value to add, or Preview to check the output.`,
    );
  }
  function collectFromSelection() {
    if (!selection || !d) return;
    // A clicked value such as a title is rarely the repeated item itself; prefer its repeating ancestor.
    const container: string =
      selection.repeats > 1 || !selection.collection
        ? selection.selector
        : selection.collection;
    const existing = d.steps.find(
      (s) => s.type === "extractCollection" && s.container.primary === container,
    );
    const stepId = existing?.id ?? crypto.randomUUID();
    if (!existing)
      setD({
        ...d,
        steps: [
          ...d.steps,
          {
            id: stepId,
            type: "extractCollection",
            container: {
              primary: container,
              frame: selection.frame,
              fallbacks: [],
            },
            fields: [],
          },
        ],
      });
    setSelectedStep(stepId);
    syncCollection(container);
    const items =
      container === selection.selector ? selection.count : selection.rows?.total;
    say(
      `Collecting ${items ?? "the"} items matching ${container}. Click a value inside one item, then choose Add output field.`,
    );
  }
  function replaceSelector() {
    if (!selection || !d) return;
    const index = d.steps.findIndex((s) => s.id === selectedStep);
    const target = d.steps[index];
    const spec = {
      primary: selection.selector,
      frame: selection.frame,
      fallbacks: [],
    };
    let next: Step;
    if (target && "locator" in target) next = { ...target, locator: spec };
    else if (target?.type === "extractCollection")
      next = { ...target, container: spec };
    else if (target?.type === "paginate" && target.mode === "next")
      next = { ...target, next: spec };
    else
      return fail(
        "Select a Fill, Click, Wait for, Collect items or Next pages step in the workflow first, then choose Replace selector.",
      );
    setD({ ...d, steps: d.steps.map((s, i) => (i === index ? next : s)) });
    if (next.type === "extractCollection") syncCollection(selection.selector);
    say(
      `Step ${index + 1} (${stepNames[next.type]}) now uses ${selection.selector}.${
        next.type === "extractCollection"
          ? " Use Preview to check that its fields still match."
          : ""
      }`,
    );
  }
  function addAction(type: "fill" | "click" | "waitFor") {
    if (!selection) return;
    if (type === "fill" && !["input", "textarea"].includes(selection.tag))
      return fail(
        `Fill needs a text box, but you selected a <${selection.tag}>. Select the input field itself.`,
      );
    const locator = {
      primary: selection.selector,
      frame: selection.frame,
      fallbacks: [],
    };
    add(type === "fill" ? { type, locator, value } : { type, locator });
    say(
      `Added "${stepNames[type]}" for ${selection.selector}${
        selection.count > 1
          ? ` (${selection.count} matches; the first is used)`
          : ""
      }. It runs when the scraper runs; to do it now, switch to Interact and use the page.`,
    );
  }
  function addNavigation() {
    if (!d) return;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return fail(
        "Enter a full URL, such as https://www.example.com/page, in the browser address bar first.",
      );
    }
    add({ type: "navigate", url });
    if (d.allowedDomains.includes(host)) say(`Added "Open page" for ${url}.`);
    else
      fail(
        `Added "Open page", but ${host} is not in allowedDomains (${d.allowedDomains.join(", ")}). Add it in Definition if you are authorized to automate it, or runs will reject this step.`,
      );
  }
  function addInput() {
    if (!d) return;
    if (!namePattern.test(inputName))
      return fail(
        "Input names start with a letter and use only letters, numbers and _.",
      );
    let values: Record<string, unknown>;
    try {
      values = JSON.parse(input || "{}");
    } catch {
      return fail("Fix the Run inputs JSON before adding another input.");
    }
    setD({
      ...d,
      inputs: {
        ...d.inputs,
        [inputName]: { type: inputType as "text", required: true },
      },
    });
    if (inputType !== "secretRef")
      setInput(
        JSON.stringify(
          {
            ...values,
            [inputName]:
              inputType === "number" ? 0 : inputType === "boolean" ? false : "",
          },
          null,
          2,
        ),
      );
    say(
      inputType === "secretRef"
        ? `Added secret input "${inputName}". Store the value under Credentials and use {{secret.${inputName}}} in a Fill value.`
        : `Added input "${inputName}". Set its value in Run inputs and use {{${inputName}}} in a Fill value or URL.`,
    );
    setInputName("");
  }
  function followDetails() {
    if (!d) return;
    if (
      !d.steps.some(
        (s) =>
          s.type === "extractCollection" &&
          s.fields.some((f) => f.name === linkField),
      )
    )
      return fail(
        `Add a link field named "${linkField}" to a collection first: select the product link, set Read from to Attribute (href) and type to url.`,
      );
    const stepId = crypto.randomUUID();
    setD({
      ...d,
      steps: [...d.steps, { id: stepId, type: "followEach", linkField, fields: [] }],
    });
    setSelectedStep(stepId);
    say(
      'Added "Open each detail link". In Interact mode open one detail page, switch to Select, click each value and choose Add output field.',
    );
  }
  function addPagination(step: any) {
    if (d?.steps.some((s) => s.type === "paginate"))
      return fail(
        "Only one pagination step is supported. Delete the existing one first.",
      );
    add(step);
    say(
      step.mode === "next"
        ? `Added "Next pages" using ${step.next.primary} (up to ${step.maxPages} pages).`
        : "Added infinite scroll (up to 5 pages).",
    );
  }
  async function checkUpdates() {
    try {
      setUpgrade(await api(`scrapers/${id}/upgrade`));
    } catch (e) {
      fail(e);
    }
  }
  async function submitTemplate() {
    if (
      !d ||
      !window.confirm(
        "I am authorized to automate these domains and have reviewed this definition for sensitive data. Submit for review?",
      )
    )
      return;
    try {
      const v = await save(true);
      await api("marketplace", "POST", {
        versionId: v.id,
        attestation: true,
        description: d.name,
      });
      say(`Submitted version ${v.number} for marketplace review.`);
    } catch (e) {
      fail(e);
    }
  }
  async function exportScript() {
    try {
      const r = await fetch(`/api/v1/scrapers/${id}/export`);
      if (!r.ok) {
        const error = (await r.json().catch(() => ({}))).error;
        throw new Error(
          error === "Save a version first"
            ? "Run the scraper once (that saves a version) before exporting."
            : (error ?? `Export failed (HTTP ${r.status})`),
        );
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await r.blob());
      link.download = "scraper.ts";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      say("Exported the latest saved version as scraper.ts.");
    } catch (e) {
      fail(e);
    }
  }
  if (!d)
    return (
      <div className={tone === "error" ? "empty alert" : "empty"}>
        {message || "Loading scraper…"}
      </div>
    );
  const selectedFields = d.steps.find(
    (s) => s.id === selectedStep && "fields" in s,
  );
  return (
    <div className="builder">
      <div className="builder-heading">
        <button onClick={onBack}>
          <ArrowLeft size={18} /> Back
        </button>
        <input
          className="title-input"
          aria-label="Scraper name"
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
        <span className="spacer" />
        <button
          onClick={() => {
            setJson(JSON.stringify(d, null, 2));
            setJsonError("");
            setRaw(true);
          }}
        >
          <Code size={16} /> Definition
        </button>
        <button onClick={() => save().catch(fail)}>
          <Save size={16} /> Save draft
        </button>
        <button
          onClick={preview}
          disabled={!connected}
          title={
            connected
              ? "Extract the first items from the page open in the browser"
              : "Connect the browser to preview"
          }
        >
          <Eye size={16} /> Preview
        </button>
        <button className="primary" onClick={run}>
          <Play size={15} /> Run scraper
        </button>
      </div>
      <div
        className={`builder-notice ${tone === "error" ? "error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message ||
          "Connect the browser, switch to Select, click a value such as a product title, then choose Add output field."}
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
              {d.steps.map((s, index) => (
                <SortableStep
                  key={s.id}
                  step={s}
                  index={index}
                  selected={s.id === selectedStep}
                  onClick={() => {
                    setSelectedStep(s.id);
                    if (s.type === "extractCollection" && connected)
                      syncCollection(s.container.primary);
                  }}
                  onDelete={() => {
                    setD({ ...d, steps: d.steps.filter((x) => x.id !== s.id) });
                    if (s.id === selectedStep) {
                      setSelectedStep("");
                      send({ type: "container", selector: "" }, true);
                    }
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button className="add-step" onClick={addNavigation}>
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
              <button onClick={addInput}>Add input</button>
            </div>
            <textarea
              aria-label="Run inputs JSON"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <small>
              Values for each input, as JSON. Use {"{{searchTerm}}"} in a Fill
              value or URL.
            </small>
          </details>
          <details className="input-config">
            <summary>Pagination & details</summary>
            <input
              aria-label="Detail link field"
              value={linkField}
              onChange={(e) => setLinkField(e.target.value)}
            />
            <button onClick={followDetails}>Follow detail links</button>
            <button
              onClick={() =>
                addPagination({ type: "paginate", mode: "scroll", maxPages: 5 })
              }
            >
              Add infinite scroll
            </button>
            <button
              disabled={!selection}
              onClick={() =>
                addPagination({
                  type: "paginate",
                  mode: "next",
                  next: {
                    primary: selection.selector,
                    frame: selection.frame,
                    fallbacks: [],
                  },
                  maxPages: 5,
                })
              }
            >
              Use selection as Next
            </button>
            <p>
              Follow detail links opens the URL field named above for every
              item. Use selection as Next clicks the selected next-page button.
            </p>
          </details>
        </section>
        <section className="browser-panel">
          <div className="browser-toolbar">
            <Globe size={16} />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && connected)
                  send({ type: "navigate", url });
              }}
              aria-label="Browser URL"
            />
            <button
              onClick={() => send({ type: "navigate", url })}
              disabled={!connected}
              title="Open this URL in the browser"
            >
              <RefreshCw size={15} />
            </button>
            <button
              className={mode === "interact" ? "toggle active" : "toggle"}
              onClick={() => changeMode("interact")}
            >
              <Hand size={15} /> Interact
            </button>
            <button
              className={mode === "select" ? "toggle active" : "toggle"}
              onClick={() => changeMode("select")}
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
                const point = pointFrom(e);
                if (mode === "select") lastPoint.current = point;
                send({ type: "pointer", ...point });
              }}
              onMouseMove={(e) => {
                // Each hover inspects the remote page; ~10 a second keeps the worker queue short.
                if (mode !== "select" || e.timeStamp - lastHover.current < 100)
                  return;
                lastHover.current = e.timeStamp;
                send({ type: "hover", ...pointFrom(e) }, true);
              }}
              onWheel={(e) => {
                lastPoint.current = null;
                send({ type: "scroll", deltaY: e.deltaY }, true);
              }}
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
                    .then(() => say("Saved session revoked."))
                    .catch(fail)
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
                  if (!typing)
                    return fail(
                      "In Interact mode click a text box on the page, enter the text here, then choose Type.",
                    );
                  send({ type: "type", text: typing });
                  setTyping("");
                }}
              >
                Type
              </button>
              <button onClick={() => send({ type: "key", key: "Enter" })}>
                Enter
              </button>
              <button onClick={disconnect}>Disconnect</button>
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
            {lastRun && lastRun.status !== "succeeded" && lastRun.error && (
              <div className="alert">
                Run {lastRun.status}: {describeRunError(lastRun.error)}
                {lastRun.error.url ? ` (page: ${lastRun.error.url})` : ""}.{" "}
                <a
                  href={`/api/v1/runs/${lastRun.id}/artifact`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Failure screenshot
                </a>
              </div>
            )}
            <pre>
              {result
                ? JSON.stringify(result, null, 2)
                : "// Preview (while connected) or run the scraper to see structured results."}
            </pre>
          </div>
        </section>
        <section className="properties-panel">
          <div className="panel-title">ELEMENT INSPECTOR</div>
          {selectedFields && "fields" in selectedFields && (
            <div className="field-list">
              <h3>Output fields · {stepNames[selectedFields.type]}</h3>
              {!selectedFields.fields.length && (
                <p className="selected-text">
                  No fields yet. Click a value inside an item, then Add output
                  field.
                </p>
              )}
              {selectedFields.fields.map((f, i) => (
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
                          step.id === selectedFields.id && "fields" in step
                            ? {
                                ...step,
                                fields: step.fields.filter(
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
          )}
          {selection ? (
            <>
              <span className="pill">
                {selection.tag} · {selection.count} on page
                {selection.rows &&
                  ` · found in ${selection.rows.matched} of ${selection.rows.total} items`}
              </span>
              <code className="selector-text">{selection.selector}</code>
              {selection.ancestors?.length > 0 && (
                <label>
                  Select a parent element
                  <select
                    value=""
                    onChange={(e) => {
                      const ancestor = selection.ancestors.find(
                        (a: any) => a.selector === e.target.value,
                      );
                      if (!ancestor) return;
                      const next = {
                        ...selection,
                        ...ancestor,
                        relativeSelector: ancestor.relativeSelector,
                      };
                      setSelection(next);
                      suggestField(next);
                    }}
                  >
                    <option value="">Choose parent…</option>
                    {selection.ancestors.map((a: any) => (
                      <option key={a.selector} value={a.selector}>
                        {a.selector} ({a.count} matches
                        {a.repeats > 1 ? `, repeats ×${a.repeats}` : ""})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="selected-text">{selection.text}</p>
              <label>
                Action value (for Fill)
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <div className="action-grid">
                <button
                  onClick={replaceSelector}
                  title="Point the selected workflow step at this element"
                >
                  Replace selector
                </button>
                <button onClick={() => addAction("fill")}>Fill input</button>
                <button onClick={() => addAction("click")}>Click</button>
                <button onClick={() => addAction("waitFor")}>Wait for</button>
                <button
                  onClick={collectFromSelection}
                  title="Extract one row per repeating item"
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
                Required (fail the run when missing)
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
                1. Connect browser · 2. Switch to Select · 3. Click a value such
                as a product title · 4. Add output field · 5. Preview, then Run.
              </p>
            </div>
          )}
          <div className="publish-box">
            {installed && (
              <button onClick={checkUpdates}>Check template updates</button>
            )}
            <h3>Ready to share?</h3>
            <p>Publish a version for administrator review.</p>
            <button onClick={submitTemplate}>
              <Upload size={15} /> Submit template
            </button>
            <button onClick={exportScript}>
              <Download size={15} /> Export TypeScript
            </button>
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
                    say("Template update applied to draft.");
                  } catch (e) {
                    setUpgrade(null);
                    fail(e);
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
            {jsonError && <p className="alert">{jsonError}</p>}
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
                    say("Definition applied. Save the draft to keep it.");
                  } catch (e) {
                    setJsonError(
                      e instanceof SyntaxError
                        ? `Invalid JSON: ${e.message}`
                        : explainDefinitionError(e),
                    );
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
