"use client"; // Error boundaries must be Client Components
import { useEffect } from "react";
// Replaces a blank page when a render fails; saved data lives on the server and is unaffected.
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="crash-title"
        aria-describedby="crash-text"
      >
        <h2 id="crash-title">Something went wrong</h2>
        <p id="crash-text">
          This page hit an unexpected error. Your scrapers, runs and results are
          saved and not affected. Try again, or reload the page if it keeps
          happening.
        </p>
        {error.digest && <p className="meta">Reference: {error.digest}</p>}
        <div className="actions">
          <button onClick={() => location.reload()}>Reload page</button>
          <button className="primary" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
