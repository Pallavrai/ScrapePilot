import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
const { mailbox } = vi.hoisted(() => ({ mailbox: [] as string[] }));
vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: unknown, init: RequestInit) => {
    const message = JSON.parse(String(init.body));
    mailbox.push(message.text);
    return new Response(JSON.stringify({ id: "test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
);
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "verified authentication lifecycle",
  () => {
    let auth: any, db: any;
    const email = `auth-${randomUUID()}@example.test`,
      password = "IntegrationPassword!234";
    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.BETTER_AUTH_URL = "http://localhost:3000";
      process.env.BETTER_AUTH_SECRET =
        "local-tests-only-long-secret-01234567890";
      process.env.RESEND_API_KEY = "test-provider-is-mocked";
      process.env.EMAIL_FROM = "ScrapePilot <test@example.test>";
      db = await import("../packages/db/src/index");
      auth = (await import("../apps/web/lib/auth")).getAuth();
    });
    it("requires verification and sends a verification token through the email adapter", async () => {
      const user = await auth.api.signUpEmail({
        body: { name: "Authentication test", email, password },
      });
      expect(user.user.emailVerified).toBe(false);
      expect(mailbox[0]).toContain("/verify-email?");
      await expect(
        auth.api.signInEmail({ body: { email, password } }),
      ).rejects.toThrow();
    });
    it("accepts the emailed token then creates a secure session", async () => {
      const url = mailbox[0].slice(mailbox[0].indexOf("http"));
      const response = await auth.handler(new Request(url));
      expect(response.status).toBeLessThan(400);
      const session = await auth.api.signInEmail({ body: { email, password } });
      expect(session.token).toBeTruthy();
      expect(session.user.emailVerified).toBe(true);
    });
    it("resets the password with a one-time token", async () => {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: "http://localhost:3000/reset-password" },
      });
      const link = mailbox.find((t) =>
        t.includes("Reset your ScrapePilot password:"),
      );
      expect(link).toBeTruthy();
      const url = link!.slice(link!.indexOf("http"));
      const response = await auth.handler(new Request(url));
      const location = response.headers.get("location");
      expect(location).toBeTruthy();
      const token = new URL(location!).searchParams.get("token");
      expect(token).toBeTruthy();
      await auth.api.resetPassword({
        body: { token, newPassword: "ChangedPassword!567890" },
      });
      await expect(
        auth.api.signInEmail({ body: { email, password } }),
      ).rejects.toThrow();
      expect(
        (
          await auth.api.signInEmail({
            body: { email, password: "ChangedPassword!567890" },
          })
        ).token,
      ).toBeTruthy();
    });
    it("rejects blank or overlong names and stores trimmed names", async () => {
      for (const name of ["   ", "x".repeat(81)])
        await expect(
          auth.api.signUpEmail({
            body: { name, email: `name-${randomUUID()}@example.test`, password },
          }),
        ).rejects.toThrow("Enter a name of 1 to 80 characters.");
      const created = await auth.api.signUpEmail({
        body: {
          name: "  Ada Lovelace  ",
          email: `trim-${randomUUID()}@example.test`,
          password,
        },
      });
      expect(created.user.name).toBe("Ada Lovelace");
    });
    afterAll(async () => {
      await db?.client.end();
    });
  },
);
