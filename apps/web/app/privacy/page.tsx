import type { Metadata } from "next";
import { LegalPage, legal } from "../../components/legal";
export const metadata: Metadata = { title: "Privacy Policy — ScrapePilot" };
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {legal.operator} operates ScrapePilot and is responsible for the
        personal data described in this policy. Contact us at {legal.email} or{" "}
        {legal.address}.
      </p>
      <h2>What we collect</h2>
      <h3>Your account</h3>
      <ul>
        <li>Your name, email address and whether the address is verified.</li>
        <li>Your password, stored only as a salted hash.</li>
        <li>
          Account settings: your role, whether the account is suspended and your
          monthly browser-minute allowance.
        </li>
      </ul>
      <h3>Signing in</h3>
      <ul>
        <li>A cookie that keeps you signed in.</li>
        <li>
          The IP address and browser details (user agent) recorded with each
          sign-in session.
        </li>
        <li>
          IP addresses held briefly in memory to limit repeated sign-in
          attempts.
        </li>
      </ul>
      <h3>What you create and run</h3>
      <ul>
        <li>
          Scraper definitions, such as web addresses, selectors, steps and
          inputs, and their saved versions.
        </li>
        <li>
          Run history: inputs, status, timing, row counts and error messages.
        </li>
        <li>
          The results your runs collect, which may include personal data from
          the websites you choose.
        </li>
        <li>
          Failure screenshots and page HTML, captured only for runs that use no
          stored login or saved session.
        </li>
        <li>
          Site logins you store and login sessions you save, both encrypted.
        </li>
        <li>
          API keys, stored only as a hash with a short prefix so you can
          recognize them.
        </li>
        <li>
          Webhook addresses, their encrypted signing keys and delivery status.
        </li>
        <li>
          Browser-minute usage, templates you submit, reports you send and a
          record of administrator actions.
        </li>
      </ul>
      <p>We do not use analytics, advertising or tracking cookies.</p>
      <p>
        Scrapers you download and run on your own computer send nothing back to
        ScrapePilot. Their logins and results stay on that computer.
      </p>
      <h2>Personal data in your results</h2>
      <p>
        You choose which websites to automate and what your scrapers collect.
        For personal data in your results, you are responsible for having a
        lawful basis and for respecting the rights of the people concerned. We
        process that data only to run your scrapers and give you the results.
        [Describe any data processing agreement you offer.]
      </p>
      <h2>How we use personal data</h2>
      <ul>
        <li>
          To create and secure your account, sign you in and send verification
          and password-reset emails.
        </li>
        <li>
          To run your scrapers, store your results and send the webhooks you set
          up.
        </li>
        <li>
          To apply usage limits, prevent abuse, and review templates and
          reports.
        </li>
        <li>
          To keep the service reliable and secure, and to meet legal
          obligations.
        </li>
      </ul>
      <p>We do not sell personal data or use it for advertising.</p>
      <h2>Legal bases</h2>
      <p>
        Where data protection law requires a legal basis, we rely on performing
        our contract with you (your account, runs, results and service emails),
        our legitimate interests in keeping the service secure and preventing
        abuse, and compliance with legal obligations.
      </p>
      <h2>Who receives personal data</h2>
      <ul>
        <li>
          Providers that run ScrapePilot for us: {legal.hosting} for servers and
          the database, Resend for verification and password-reset emails, and{" "}
          {legal.backups} for encrypted backups.
        </li>
        <li>
          Google Fonts: our pages load fonts from Google, which receives your IP
          address and browser details when a page loads.
        </li>
        <li>
          The websites your scrapers visit. They receive requests from our
          servers, including any values your steps enter, such as a login you
          stored for that site.
        </li>
        <li>
          The webhook addresses you register, which receive each run’s ID,
          status and row count.
        </li>
        <li>
          Other ScrapePilot users, who see your name and the template name,
          description, domains, inputs and any sample output of templates you
          publish.
        </li>
        <li>
          Authorities or others when the law requires it or to protect rights
          and safety, and a successor if the business is sold or merged. We will
          tell you if that happens.
        </li>
      </ul>
      <p>
        Our administrators access account and workspace data only when needed to
        operate, secure and support the service.
      </p>
      <h2>How long we keep data</h2>
      <ul>
        <li>Results: 30 days after the run.</li>
        <li>Failure screenshots and page HTML: 7 days.</li>
        <li>Saved login sessions: 7 days.</li>
        <li>Sign-in sessions: they expire after 7 days without use.</li>
        <li>
          Your account, scrapers, run history, stored logins, API keys and
          webhooks: until you delete them or we delete your account.
        </li>
        <li>Backups: up to [30] days after data is deleted.</li>
        <li>Server logs: [log retention period].</li>
      </ul>
      <h2>Security</h2>
      <p>
        Connections use HTTPS. Passwords and API keys are stored as hashes.
        Stored logins, saved sessions and webhook signing keys are encrypted
        with keys kept outside the database. Scrapers run in isolated, sandboxed
        browsers with restricted network access. No system is completely secure;
        if you find a vulnerability, tell us at {legal.email}.
      </p>
      <h2>International transfers</h2>
      <p>
        [Where personal data is stored and processed, including by Resend, and
        the safeguards used for transfers, such as Standard Contractual
        Clauses.]
      </p>
      <h2>Your rights</h2>
      <p>
        Depending on where you live, you can ask us to access, correct, delete
        or export your personal data, object to or restrict how we use it, and
        complain to your data protection authority.
      </p>
      <p>
        In the app you can delete scrapers, results, stored logins, API keys and
        webhooks, and download results as JSON or CSV. To delete your account or
        make any other request, email {legal.email}. We will answer within [30
        days].
      </p>
      <h2>Cookies</h2>
      <p>
        ScrapePilot sets only the cookies needed to keep you signed in. They are
        required for the service to work and are not used for tracking.
      </p>
      <h2>Children</h2>
      <p>
        ScrapePilot is not intended for anyone under 18, and we do not knowingly
        collect their personal data.
      </p>
      <h2>Changes to this policy</h2>
      <p>
        We will publish updates here with a new effective date and tell you
        about material changes by email or in the app.
      </p>
    </LegalPage>
  );
}
