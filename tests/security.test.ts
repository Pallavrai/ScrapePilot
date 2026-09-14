import { describe, it, expect } from "vitest";
import {
  assertPublicUrl,
  publicIp,
  encrypt,
  decrypt,
  redact,
  hash,
} from "../packages/scraper-engine/src/security";
describe("network boundaries", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "100.64.0.1",
  ])
    it(`blocks ${ip}`, () => expect(publicIp(ip)).toBe(false));
  it("allows public addresses", () =>
    expect(publicIp("93.184.216.34")).toBe(true));
  it("rejects a mixed DNS answer", async () => {
    await expect(
      assertPublicUrl("https://example.com", undefined, (async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]) as any),
    ).rejects.toThrow();
  });
  for (const url of [
    "file:///etc/passwd",
    "http://user:password@example.com",
    "http://example.com:22",
  ])
    it(`rejects ${url}`, async () => {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    });
  it("checks domain boundaries", async () => {
    await expect(
      assertPublicUrl("https://example.com.attacker.com", ["example.com"]),
    ).rejects.toThrow();
  });
  it("leaves DNS to the egress proxy but still checks scheme, port and domain", async () => {
    await expect(
      assertPublicUrl("https://no-dns-here.example/a", ["no-dns-here.example"], null),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertPublicUrl("https://other.example/", ["no-dns-here.example"], null),
    ).rejects.toThrow("not declared");
    await expect(
      assertPublicUrl("https://no-dns-here.example:8443/", undefined, null),
    ).rejects.toThrow("port");
  });
});
describe("credential handling", () => {
  it("authenticates ciphertext and tenant binding", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encrypt("password", "owner:domain:key");
    expect(decrypt(encrypted, "owner:domain:key")).toBe("password");
    expect(() => decrypt(encrypted, "other:domain:key")).toThrow();
    expect(encrypted).not.toContain("password");
  });
  it("redacts explicit values", () =>
    expect(redact("oops secret-value", ["secret-value"])).toBe(
      "oops [REDACTED]",
    ));
  it("hashes API keys irreversibly", () =>
    expect(hash("sp_example")).toMatch(/^[a-f0-9]{64}$/));
});
