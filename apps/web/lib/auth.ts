import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification } from "@scrapepilot/db";
import { Resend } from "resend";
async function send(to: string, subject: string, url: string) {
  if (!process.env.RESEND_API_KEY)
    throw new Error("Email delivery is not configured");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject,
    text: `${subject}: ${url}`,
  });
  if (result.error) throw new Error("Email delivery failed");
}
function createAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) =>
        send(user.email, "Reset your ScrapePilot password", url),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) =>
        send(user.email, "Verify your ScrapePilot account", url),
    },
    rateLimit: { enabled: true },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "user", input: false },
        suspended: { type: "boolean", defaultValue: false, input: false },
      },
    },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
