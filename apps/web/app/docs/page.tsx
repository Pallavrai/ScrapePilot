export default function Docs() {
  return (
    <main className="content" style={{ maxWidth: 850 }}>
      <a href="/">← Back to workspace</a>
      <h1 style={{ marginTop: 32 }}>ScrapePilot guide</h1>

      <h2>Create a scraper</h2>
      <p>
        Enter the URL of a site you are authorized to automate, open the
        scraper, and choose Connect browser. Interact mode sends clicks,
        scrolling and typing to the page. Select mode picks elements instead,
        and the inspector on the right shows what you selected.
      </p>

      <h2>Collect data</h2>
      <p>
        In Select mode, click a value such as a product title, name it, and
        choose Add output field. The builder finds the repeating item around it
        (for example the product card) and creates a Collect items step; the
        inspector says how many items the field was found in. Price-like text is
        read as a number, images as image URLs and links as URLs. To use a
        different container, pick a parent element and choose Use as
        collection. Use Preview to extract the first items from the open page
        without saving or disconnecting.
      </p>

      <h2>Record steps</h2>
      <p>
        Select an element, then choose Fill input, Choose option, Click or Wait
        for. Fill, Choose option and Click are also done in the browser, so you
        can record a flow while using it. Put the text or option in Action
        value. Use {"{{searchTerm}}"} for run inputs and{" "}
        {"{{secret.password}}"} for stored credentials; values with {"{{…}}"}{" "}
        are filled in only during runs. Recorded steps are placed before the
        data is collected. Add Wait for when content appears late.
      </p>

      <h2>Log in to a site</h2>
      <p>
        Save the login under Credentials. Each credential is encrypted and
        works only on its domain. Record the login with Fill steps that use{" "}
        {"{{secret.name}}"}, or log in once in Interact mode and choose Save
        login session: runs reuse that session for up to seven days, and Revoke
        session removes it.
      </p>

      <h2>More pages</h2>
      <p>
        Select a next-page link and choose Use selection as Next, or choose Add
        infinite scroll for pages that load more items as you scroll. To read
        detail pages, add a URL field (Read from Attribute, href) to the
        collection, then choose Follow detail links, open one detail page and
        add its fields.
      </p>

      <h2>Run, results and repair</h2>
      <p>
        Run scraper saves a version and runs it in the background; the browser
        disconnects because one browser at a time may use a site. Run history
        shows each run with its status and errors. View results to copy the
        JSON or download all rows as JSON or CSV. Failed runs name the step and
        item that failed and may include a screenshot. Repair / edit opens the
        exact version that ran so you can fix a selector and run again.
      </p>

      <h2>Use the API</h2>
      <p>
        Generate an API key and send it as a Bearer token. Runs are asynchronous;
        use an Idempotency-Key when starting them.
      </p>
      <pre>{`POST /api/v1/scrapers/{id}/runs
Authorization: Bearer YOUR_KEY
Idempotency-Key: YOUR_UNIQUE_REQUEST_ID
Content-Type: application/json

{"input":{"searchTerm":"nerf gun"}}

GET /api/v1/runs/{runId}
GET /api/v1/runs/{runId}/results?limit=100&cursor=0
GET /api/v1/runs/{runId}/results?format=csv`}</pre>

      <h2>Webhooks</h2>
      <p>
        Events (run.completed, run.partial, run.failed, run.blocked) carry a
        stable delivery ID. Verify the x-scrapepilot-signature header: an
        HMAC-SHA256 of the timestamp, a period and the raw request body, with
        the signing key shown when you added the webhook. Reject timestamps
        older than five minutes and ignore repeated delivery IDs.
      </p>
      <pre>{`import { createHmac, timingSafeEqual } from "node:crypto";

const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
const expected = createHmac("sha256", signingKey)
  .update(\`\${parts.t}.\${rawBody}\`)
  .digest("hex");
const valid =
  Math.abs(Date.now() / 1000 - Number(parts.t)) < 300 &&
  parts.v1?.length === expected.length &&
  timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));`}</pre>

      <h2>Share a template</h2>
      <p>
        Submit template publishes the current version for administrator review
        after you confirm it contains no private information. Approved templates
        appear in the Marketplace, where others install a private copy. Updates
        are applied only after the installer reviews the difference. Use Report
        on a template that misuses a site or collects data it should not.
      </p>

      <h2>Limits</h2>
      <p>
        Each account has monthly browser minutes, shown in the sidebar. A run
        may take up to 15 minutes, 25 pages and 1,000 rows. You can have one
        browser session and one active run at a time, and one browser may use a
        site at a time. Results are kept for 30 days and failure screenshots
        for seven.
      </p>
    </main>
  );
}
