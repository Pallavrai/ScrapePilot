import type { Metadata } from "next";
import { LegalPage, legal } from "../../components/legal";
export const metadata: Metadata = {
  title: "Acceptable Use Policy — ScrapePilot",
};
export default function AcceptableUse() {
  return (
    <LegalPage title="Acceptable Use Policy">
      <p>
        This policy applies to everything you do with ScrapePilot, including the
        editor, runs, the API, webhooks, stored logins and templates. It is part
        of the <a href="/terms">Terms of Service</a>.
      </p>
      <h2>Automate only what you are allowed to</h2>
      <ul>
        <li>
          Use ScrapePilot only on websites and accounts you are authorized to
          access and automate.
        </li>
        <li>
          Follow each website’s terms of use, robots.txt and other access rules.
          If a website owner asks you to stop, stop.
        </li>
        <li>
          Collect only the data you need, at a pace that does not burden the
          website.
        </li>
      </ul>
      <h2>Do not</h2>
      <ul>
        <li>
          Bypass access controls such as CAPTCHAs, paywalls, rate limits, IP
          blocks or bot protection. Runs stop when a website asks for CAPTCHA
          verification; do not work around it.
        </li>
        <li>
          Use logins you are not authorized to use, or try stolen or guessed
          credentials.
        </li>
        <li>
          Collect personal data without a lawful basis, or collect sensitive
          information about people, such as health, biometric, financial or
          government ID data.
        </li>
        <li>
          Track, profile, stalk, harass or expose people, or collect contact
          details to send unsolicited messages.
        </li>
        <li>
          Infringe copyright, database rights or other intellectual property, or
          republish content you have no right to use.
        </li>
        <li>
          Overload or disrupt websites, or evade ScrapePilot’s throttling, usage
          limits or domain blocks, for example by using several accounts.
        </li>
        <li>
          Target private networks, internal systems or cloud metadata services.
        </li>
        <li>
          Probe, attack or disrupt ScrapePilot, its browsers or other users, or
          try to reach data that is not yours.
        </li>
        <li>
          Share your API keys or resell access to ScrapePilot without our
          written permission.
        </li>
        <li>
          Use ScrapePilot for anything illegal, fraudulent or deceptive,
          including phishing and malware.
        </li>
      </ul>
      <h2>Templates</h2>
      <ul>
        <li>
          Publish only templates you may share, with no logins, personal data or
          other private information in their steps, defaults or sample output.
        </li>
        <li>
          Do not publish templates for websites that prohibit automated access.
          We refuse templates for websites whose robots.txt disallows automated
          access to the whole site.
        </li>
        <li>Describe accurately what a template collects.</li>
      </ul>
      <h2>Reporting abuse</h2>
      <p>
        Use Report on a marketplace template, or email {legal.email}. If you own
        a website and do not want ScrapePilot to access it, email us and we can
        block the domain.
      </p>
      <h2>Enforcement</h2>
      <p>
        We may investigate suspected violations, stop runs, remove templates,
        block domains, suspend or close accounts, and cooperate with law
        enforcement. Where appropriate and lawful, we will tell you what we did
        and why.
      </p>
    </LegalPage>
  );
}
