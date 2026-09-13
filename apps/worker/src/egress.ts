/** DNS-pinned forward proxy. Never pass an unvalidated hostname to a socket. */
import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { publicIp } from "@scrapepilot/scraper-engine/security";
async function address(host: string) {
  const records = await lookup(host, { all: true });
  if (!records.length || records.some((r) => !publicIp(r.address)))
    throw new Error("Forbidden destination");
  return records[0];
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "");
    if (
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "80")
    )
      throw new Error("Forbidden URL");
    const target = await address(url.hostname);
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: url.host,
    };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const outgoing = http.request(
      {
        hostname: target.address,
        family: target.family,
        port: 80,
        method: req.method,
        path: url.pathname + url.search,
        headers,
        timeout: 30000,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    outgoing.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    outgoing.on("timeout", () => outgoing.destroy());
    req.pipe(outgoing);
  } catch {
    res.writeHead(403);
    res.end("Destination forbidden");
  }
});
server.on("connect", async (req, client, head) => {
  try {
    const url = new URL(`https://${req.url}`);
    if ((url.port && url.port !== "443") || url.username || url.password)
      throw new Error("Forbidden tunnel");
    const target = await address(url.hostname);
    const upstream = net.connect(
      { host: target.address, family: target.family, port: 443 },
      () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      },
    );
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  } catch {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
});
server.listen(3002, "0.0.0.0");
