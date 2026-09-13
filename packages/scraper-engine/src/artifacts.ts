import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
export interface ArtifactStore {
  put(
    id: string,
    kind: "png" | "html",
    data: Uint8Array | string,
  ): Promise<void>;
  get(id: string, kind: "png" | "html"): Promise<Buffer>;
  delete(id: string): Promise<void>;
  prune(before: Date): Promise<void>;
}
export class LocalArtifactStore implements ArtifactStore {
  constructor(private root: string) {}
  private path(id: string, kind: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !["png", "html"].includes(kind))
      throw new Error("Invalid artifact identifier");
    return resolve(this.root, `${id}.${kind}`);
  }
  async put(id: string, kind: "png" | "html", data: Uint8Array | string) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(id, kind), data, { mode: 0o600 });
  }
  async get(id: string, kind: "png" | "html") {
    return readFile(this.path(id, kind));
  }
  async delete(id: string) {
    for (const kind of ["png", "html"])
      await unlink(this.path(id, kind)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
  async prune(before: Date) {
    await mkdir(this.root, { recursive: true });
    for (const file of await readdir(this.root)) {
      if (!/^[a-f0-9-]{36}\.(png|html)$/.test(file)) continue;
      const path = resolve(this.root, file);
      if ((await stat(path)).mtime < before) await unlink(path);
    }
  }
}
