import { getAuth } from "./auth";
import { db, apiKeys, user, eq, and } from "@scrapepilot/db";
import { hash } from "@scrapepilot/scraper-engine/security";
import { Queue } from "bullmq";
import Redis from "ioredis";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function identity(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  let id: string | undefined;
  if (token) {
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.hash, hash(token)));
    id = key?.ownerId;
  } else {
    id = (await getAuth().api.getSession({ headers: req.headers }))?.user.id;
  }
  if (!id) throw new HttpError(401, "Please sign in");
  const [u] = await db.select().from(user).where(eq(user.id, id));
  if (!u || u.suspended || !u.emailVerified)
    throw new HttpError(403, "Account is not active or email is unverified");
  const rate=await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`api-rate:${id}`);
  if(Number(rate)>120)throw new HttpError(429,'API rate limit exceeded. Retry in one minute.');
  if (
    !token &&
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? req.url).origin
  )
    throw new HttpError(403, "Invalid request origin");
  return u;
}
export async function readBody(req:Request,limit=131072){const reader=req.body?.getReader();if(!reader)return {};const parts:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new HttpError(413,'Request body is too large');}parts.push(value);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw new HttpError(400,'Invalid JSON body')}}
let instance: Queue | undefined;
export const getQueue = () =>
  (instance ??= new Queue("runs", {
    connection: {
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    },
  }));
export const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
export const owned = (
  table: { id: any; ownerId: any },
  id: string,
  ownerId: string,
) => and(eq(table.id, id), eq(table.ownerId, ownerId));
