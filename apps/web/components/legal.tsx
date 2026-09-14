import type { ReactNode } from "react";
/**
 * Details only the operator can provide. Fill them in, have the three documents reviewed by a
 * qualified lawyer, then set draft to false to remove the draft notice.
 */
export const legal = {
  draft: true,
  operator: "[Legal name of the business that operates ScrapePilot]",
  address: "[Registered postal address]",
  email: "[Contact email for legal and privacy requests]",
  effective: "[Effective date]",
  jurisdiction: "[Country or state whose law governs these terms]",
  courts: "[Courts that will hear disputes]",
  hosting: "[Hosting provider and server region]",
  backups: "[Backup storage provider and region]",
};
export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="content legal">
      <a href="/">← Back to workspace</a>
      <h1>{title}</h1>
      <p className="meta">
        Effective {legal.effective} · {legal.operator}
      </p>
      {legal.draft && (
        <p className="legal-draft" role="note">
          Draft for legal review. It has not been checked by a lawyer, and the
          details in [brackets] still need to be filled in.
        </p>
      )}
      {children}
      <nav className="legal-nav" aria-label="Terms and policies">
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/acceptable-use">Acceptable Use Policy</a>
      </nav>
    </main>
  );
}
