import { lookup } from "node:dns/promises";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import ipaddr from "ipaddr.js";
export function publicIp(ip: string) {
  try {
    let a = ipaddr.parse(ip);
    if (a.kind() === "ipv6" && (a as ipaddr.IPv6).isIPv4MappedAddress())
      a = (a as ipaddr.IPv6).toIPv4Address();
    return a.range() === "unicast";
  } catch {
    return false;
  }
}
export async function assertPublicUrl(
  value: string,
  domains?: string[],
  resolver = lookup,
) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new Error("URL scheme, credentials, or port forbidden");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (domains && !domains.some((d) => host === d.toLowerCase()))
    throw new Error("Domain is not declared in this scraper");
  const addresses = await resolver(host, { all: true });
  if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
    throw new Error("Private or reserved network address forbidden");
  return u;
}
function key() {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32)
    throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}
function seal(value:Buffer,encryptionKey:Buffer,aad:string){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,nonce);cipher.setAAD(Buffer.from(aad));const data=Buffer.concat([cipher.update(value),cipher.final()]);return [nonce.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')];}
function open(parts:string[],encryptionKey:Buffer,aad:string){const [nonce,tag,data]=parts,cipher=createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(nonce,'base64'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]);}
export function encrypt(value:string,aad:string){const dataKey=randomBytes(32),keyId=process.env.ENCRYPTION_KEY_ID??'1';return 'v2.'+Buffer.from(JSON.stringify({keyId,wrapped:seal(dataKey,key(),aad+':key'),payload:seal(Buffer.from(value),dataKey,aad)})).toString('base64');}
export function decrypt(value:string,aad:string){if(value.startsWith('v1.'))return open(value.split('.').slice(1),key(),aad).toString('utf8');if(!value.startsWith('v2.'))throw new Error('Unknown encryption envelope');const envelope=JSON.parse(Buffer.from(value.slice(3),'base64').toString('utf8'));if(!/^[0-9]+$/.test(envelope.keyId))throw new Error('Unknown key identifier');const master=envelope.keyId===(process.env.ENCRYPTION_KEY_ID??'1')?key():Buffer.from(process.env['ENCRYPTION_KEY_'+envelope.keyId]??'','base64');if(master.length!==32)throw new Error('Encryption key version unavailable');return open(envelope.payload,open(envelope.wrapped,master,aad+':key'),aad).toString('utf8');}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function redact(value: string, secrets: string[]) {
  return secrets
    .filter(Boolean)
    .reduce((out, secret) => out.split(secret).join("[REDACTED]"), value)
    .replace(
      /(password|token|authorization)(["\s:=]+)[^\s",}]+/gi,
      "$1$2[REDACTED]",
    );
}
