export default function Docs() {
  return (
    <main className="content" style={{ maxWidth: 850 }}>
      <a href="/">← Back to workspace</a>
      <h1 style={{ marginTop: 32 }}>ScrapePilot guide</h1>
      <h2>Create a scraper</h2>
      <p>
        Enter a website URL, connect a browser, and select the parts of the page
        you want to collect. Interact mode lets you browse; Select mode
        highlights page elements.
      </p>
      <h2>Make it reusable</h2>
      <p>
        Add fill and click steps, bind changing values with {"{{searchTerm}}"},
        select repeated cards as a collection, then name and type each output
        field. Use the parent selector to choose a card around a smaller
        element.
      </p>
      <h2>Run and repair</h2>
      <p>
        Save a version before running. Run history contains status, results, and
        available diagnostics. A repair starts from the exact version used in
        the failed run. Your old versions remain available.
      </p>
      <h2>Use the API</h2>
      <p>
        Generate an API key, then send a Bearer token. Scrapes run
        asynchronously.
      </p>
      <pre>{`POST /api/v1/scrapers/{id}/runs\nAuthorization: Bearer YOUR_KEY\nIdempotency-Key: YOUR_UNIQUE_REQUEST_ID\nContent-Type: application/json\n\n{"input":{"searchTerm":"nerf gun"}}\n\nGET /api/v1/runs/{runId}\nGET /api/v1/runs/{runId}/results?limit=100`}</pre>
      <h2>Webhooks</h2>
      <p>
        Events include a timestamp and stable delivery ID. Verify the
        HMAC-SHA256 signature over timestamp + a period + the raw request body,
        reject timestamps outside five minutes, and deduplicate event IDs. The
        x-scrapepilot-signature header contains t and v1 fields.
      </p>
      <h2>Share a template</h2>
      <p>
        Submit a version after reviewing its inputs and definition for private
        information. An administrator reviews every public version. Installing
        makes a private copy; upgrades require your confirmation.
      </p>
    </main>
  );
}
