// Runs on ScrapePilot's /extension/connect page, which creates a key for this browser and
// hands it over here. Only messages from that page's own window are accepted.
export {};
declare const chrome: any;
const reply = (data: object) =>
  window.postMessage({ source: "scrapepilot-extension", ...data }, location.origin);
window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    data?.source !== "scrapepilot-page"
  )
    return;
  if (data.type === "hello") reply({ type: "ready" });
  if (data.type === "connect" && typeof data.token === "string")
    chrome.runtime.sendMessage(
      { type: "connect", token: data.token },
      (answer: any) =>
        reply({
          type: "connected",
          ok: !!answer?.ok,
          email: answer?.value?.email,
          error: answer?.error ?? chrome.runtime.lastError?.message,
        }),
    );
});
reply({ type: "ready" });
