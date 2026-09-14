import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import net, { type AddressInfo } from "node:net";
import http from "node:http";
import { once } from "node:events";
import { PassThrough } from "node:stream";
// Controlled DNS: tests answer with a public address first and a private one afterwards (rebinding).
const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));
let server: http.Server,
  port = 0;
const accepted = new Set<net.Socket>();
function proxy(raw: string) {
  // createConnection is the same function as net.connect, but the spies below replace only connect.
  const socket = net.createConnection({ port, host: "127.0.0.1" });
  socket.write(raw);
  const reply = new Promise<string>((resolve) => {
    let text = "";
    socket.on("data", (chunk) => (text += chunk));
    socket.on("close", () => resolve(text));
    socket.on("error", () => resolve(text));
  });
  return { socket, reply };
}
const vetted = [{ address: "93.184.216.34", family: 4 }];
const rebound = [{ address: "127.0.0.1", family: 4 }];
describe("egress proxy", () => {
  beforeAll(async () => {
    process.env.EGRESS_PORT = "0";
    ({ server } = await import("../apps/worker/src/egress"));
    if (!server.listening) await once(server, "listening");
    port = (server.address() as AddressInfo).port;
    server.on("connection", (socket) => accepted.add(socket));
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    lookup.mockReset();
  });
  afterAll(async () => {
    for (const socket of accepted) socket.destroy();
    await new Promise((done) => server.close(done));
  });
  it("pins a CONNECT tunnel to the vetted address, so DNS rebinding cannot redirect it", async () => {
    lookup.mockResolvedValueOnce(vetted).mockResolvedValue(rebound);
    const upstream = vi
      .spyOn(net, "connect")
      .mockImplementation((() => new net.Socket()) as never);
    const { socket } = proxy(
      "CONNECT rebind.example:443 HTTP/1.1\r\nHost: rebind.example:443\r\n\r\n",
    );
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    socket.destroy();
    expect(upstream.mock.calls[0][0]).toMatchObject({
      host: "93.184.216.34",
      port: 443,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("forwards plain HTTP to the vetted address with the original Host header", async () => {
    lookup.mockResolvedValueOnce(vetted).mockResolvedValue(rebound);
    const upstream = vi
      .spyOn(http, "request")
      .mockImplementation((() => new PassThrough()) as never);
    const { socket } = proxy(
      "GET http://rebind.example/items?page=2 HTTP/1.1\r\nHost: rebind.example\r\n\r\n",
    );
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    socket.destroy();
    expect(upstream.mock.calls[0][0]).toMatchObject({
      hostname: "93.184.216.34",
      port: 80,
      path: "/items?page=2",
      headers: expect.objectContaining({ host: "rebind.example" }),
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["a private answer", rebound, "CONNECT internal.example:443"],
    ["a mixed answer", [...vetted, { address: "10.0.0.5", family: 4 }], "CONNECT mixed.example:443"],
    ["an IPv4-mapped metadata address", [{ address: "::ffff:169.254.169.254", family: 6 }], "CONNECT metadata.example:443"],
    ["a port other than 443", vetted, "CONNECT example.com:22"],
  ])("refuses a tunnel with %s", async (_label, answer, line) => {
    lookup.mockResolvedValue(answer);
    const upstream = vi.spyOn(net, "connect");
    const { reply } = proxy(`${line} HTTP/1.1\r\nHost: x\r\n\r\n`);
    expect(await reply).toMatch(/^HTTP\/1\.1 403/);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("refuses plain HTTP to a private address", async () => {
    lookup.mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);
    const upstream = vi.spyOn(http, "request");
    const { reply } = proxy(
      "GET http://router.example/ HTTP/1.1\r\nHost: router.example\r\nConnection: close\r\n\r\n",
    );
    expect(await reply).toMatch(/^HTTP\/1\.1 403/);
    expect(upstream).not.toHaveBeenCalled();
  });
});
