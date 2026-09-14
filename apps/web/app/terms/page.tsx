import type { Metadata } from "next";
import { LegalPage, legal } from "../../components/legal";
export const metadata: Metadata = { title: "Terms of Service — ScrapePilot" };
export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <h2>1. Agreement</h2>
      <p>
        These terms govern your use of ScrapePilot, including the website, the
        visual editor, the API, webhooks and the template marketplace (the
        “service”), operated by {legal.operator} (“we” or “us”). By creating an
        account or using the service, you agree to these terms and to the{" "}
        <a href="/acceptable-use">Acceptable Use Policy</a>. The{" "}
        <a href="/privacy">Privacy Policy</a> explains how we handle personal
        data.
      </p>
      <p>
        You must be at least 18 years old and able to enter a binding contract.
        If you use the service for an organization, you confirm that you may
        accept these terms on its behalf, and “you” includes that organization.
      </p>
      <h2>2. The beta service</h2>
      <ul>
        <li>
          ScrapePilot is a free beta. Features, limits and availability may
          change, and we may pause or end the beta.
        </li>
        <li>
          Accounts have usage limits, such as monthly browser minutes and limits
          on the time, pages and rows of each run. The current limits are listed
          in the <a href="/docs">guide</a>.
        </li>
        <li>
          We do not guarantee availability. Runs can fail when websites change,
          block automated access or go offline.
        </li>
      </ul>
      <h2>3. Your account</h2>
      <ul>
        <li>
          Give accurate information, and keep your password and API keys secret.
          You are responsible for activity under your account and keys.
        </li>
        <li>
          Tell us at {legal.email} as soon as you suspect unauthorized access.
        </li>
      </ul>
      <h2>4. Your content and data</h2>
      <ul>
        <li>
          Your content includes scraper definitions, inputs, stored site logins,
          saved login sessions, results, templates you submit and anything else
          you add to or collect with the service.
        </li>
        <li>
          You keep your rights in your content. You allow us to host, copy,
          process and transmit it only as needed to provide, secure and support
          the service, and as described for templates below.
        </li>
        <li>
          You are responsible for your content and for having the rights and a
          lawful basis to collect, store and use the data your scrapers gather,
          including personal data. We process that data on your instructions.
        </li>
        <li>
          Results are deleted 30 days after a run and failure screenshots after
          7 days. Download anything you need to keep.
        </li>
      </ul>
      <h2>5. Websites you automate</h2>
      <ul>
        <li>
          Use the service only on websites and accounts you are allowed to
          automate. Follow their terms, robots.txt and other access rules, and
          the Acceptable Use Policy.
        </li>
        <li>
          Store a site login only for an account you are authorized to use.
          Stored logins and saved sessions are encrypted and used only for your
          scrapers on the site you saved them for.
        </li>
        <li>
          Runs come from our servers, so websites see our network addresses. We
          may slow, stop or refuse runs and block domains to protect websites,
          users or the service.
        </li>
      </ul>
      <h2>6. Templates</h2>
      <ul>
        <li>
          When you submit a template, you confirm that it contains no private
          information and that you may share it. After an administrator approves
          it, other users can see its name, description, your name, the domains
          it opens, its inputs and any sample output you included, and they can
          install a private copy.
        </li>
        <li>
          You allow users who install your template to use, copy and modify its
          definition within the service, without payment, for as long as they
          keep their copy.
        </li>
        <li>
          Templates from other users are provided by them, as they are. Check a
          template and the sites it opens before you run it.
        </li>
        <li>
          We may reject or remove templates, for example after a report.
          Removing a template does not delete copies users already installed.
        </li>
      </ul>
      <h2>7. API and webhooks</h2>
      <ul>
        <li>
          Keep API keys secret and revoke keys you no longer use. Usage limits
          and rate limits apply to the API.
        </li>
        <li>
          Webhooks send run notifications to the HTTPS addresses you register.
          Register only addresses you control.
        </li>
      </ul>
      <h2>8. Suspension and ending your use</h2>
      <ul>
        <li>
          We may stop runs, remove templates, block domains, or suspend or close
          accounts if we reasonably believe these terms or the Acceptable Use
          Policy were broken, if the law requires it, or to protect users,
          websites or the service. Where appropriate, we will tell you why.
        </li>
        <li>
          You can stop using the service at any time and ask us to delete your
          account by emailing {legal.email}.
        </li>
        <li>
          Sections that by their nature should continue, such as your
          responsibility for your content, the disclaimers, the limitation of
          liability and the indemnity, continue after your use ends.
        </li>
      </ul>
      <h2>9. Fees</h2>
      <p>
        The beta is free. If we introduce paid plans, we will tell you in
        advance, and we will not charge you unless you agree.
      </p>
      <h2>10. Disclaimers</h2>
      <p>
        To the extent permitted by law, the service is provided “as is” and “as
        available”, without warranties of any kind, including merchantability,
        fitness for a particular purpose and non-infringement. We do not warrant
        that results are complete or accurate, or that any website will remain
        accessible.
      </p>
      <h2>11. Limitation of liability</h2>
      <p>
        To the extent permitted by law, we are not liable for indirect,
        incidental, special, consequential or punitive damages, or for lost
        profits, revenue, data or goodwill. Our total liability for all claims
        relating to the service is limited to the greater of the amounts you
        paid us in the 12 months before the claim and [amount and currency].
        Nothing in these terms limits liability that the law does not allow to
        be limited.
      </p>
      <h2>12. Indemnity</h2>
      <p>
        To the extent permitted by law, you will defend and indemnify us against
        claims, damages and costs arising from your content, your use of the
        service (including the websites you automate and the data you collect)
        or your breach of these terms.
      </p>
      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms. We will publish the new version here with a
        new effective date and, for material changes, tell you by email or in
        the app before they take effect. If you keep using the service after
        that, the updated terms apply.
      </p>
      <h2>14. Governing law</h2>
      <p>
        These terms are governed by the laws of {legal.jurisdiction}. Disputes
        will be heard by {legal.courts}, unless the law where you live gives you
        the right to bring them elsewhere.
      </p>
      <h2>15. Contact</h2>
      <p>
        {legal.operator}, {legal.address}. Email {legal.email}.
      </p>
    </LegalPage>
  );
}
