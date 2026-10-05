// In-memory stand-in for a File System Access directory handle (tests only; nothing in the app imports it).
// Behaves like Chrome's handles where the folder backend depends on it: NotFoundError / TypeMismatchError
// DOMExceptions, writes that land on close() (swap-file semantics), lastModified bumped per write, optional
// case-insensitive names (macOS / Windows), and a permission state that can be revoked.
import type { FsDirHandle, FsFile, FsFileHandle, FsPermissionDescriptor, FsWritable } from "./folderBackend";

const enc = new TextEncoder();

export interface MemoryFsOptions {
  /** Names compare ignoring letter case (like APFS / NTFS defaults). Default false. */
  caseInsensitive?: boolean;
}

interface Shared {
  caseInsensitive: boolean;
  clock: number;
  permission: PermissionState;
  /** What requestPermission() answers (default "granted"). */
  onRequest: () => PermissionState;
  requests: number;
}

const notFound = (name: string) => new DOMException(`A requested file or directory could not be found: ${name}`, "NotFoundError");
const typeMismatch = (name: string) => new DOMException(`The path supplied exists, but was not an entry of requested type: ${name}`, "TypeMismatchError");
const denied = () => new DOMException("The request is not allowed by the user agent or the platform in the current context.", "NotAllowedError");

class MemFileHandle implements FsFileHandle {
  readonly kind = "file" as const;
  name: string;
  data: Uint8Array;
  lastModified: number;
  private shared: Shared;

  constructor(name: string, data: Uint8Array, shared: Shared) {
    this.name = name;
    this.data = data;
    this.shared = shared;
    this.lastModified = ++shared.clock;
  }

  async getFile(): Promise<FsFile> {
    if (this.shared.permission !== "granted") throw denied();
    return new File([this.data as BlobPart], this.name, { lastModified: this.lastModified });
  }

  async createWritable(): Promise<FsWritable> {
    if (this.shared.permission !== "granted") throw denied();
    const parts: Uint8Array[] = [];
    let closed = false;
    return {
      write: async (data) => {
        if (closed) throw new TypeError("closed");
        if (typeof data === "string") parts.push(enc.encode(data));
        else if (data instanceof Blob) parts.push(new Uint8Array(await data.arrayBuffer()));
        else if (data instanceof ArrayBuffer) parts.push(new Uint8Array(data));
        else parts.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      },
      close: async () => {
        closed = true;
        const total = parts.reduce((n, p) => n + p.byteLength, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.byteLength;
        }
        this.data = out;
        this.lastModified = ++this.shared.clock;
      },
      abort: async () => {
        closed = true;
      },
    };
  }
}

class MemDirHandle implements FsDirHandle {
  readonly kind = "directory" as const;
  name: string;
  children = new Map<string, MemDirHandle | MemFileHandle>();
  private shared: Shared;

  constructor(name: string, shared: Shared) {
    this.name = name;
    this.shared = shared;
  }

  private key(name: string): string | undefined {
    if (this.children.has(name)) return name;
    if (!this.shared.caseInsensitive) return undefined;
    const lower = name.toLowerCase();
    return [...this.children.keys()].find((k) => k.toLowerCase() === lower);
  }

  private guard(): void {
    if (this.shared.permission !== "granted") throw denied();
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemDirHandle> {
    this.guard();
    const k = this.key(name);
    const hit = k === undefined ? undefined : this.children.get(k);
    if (hit) {
      if (hit.kind !== "directory") throw typeMismatch(name);
      return hit;
    }
    if (!options?.create) throw notFound(name);
    const dir = new MemDirHandle(name, this.shared);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemFileHandle> {
    this.guard();
    const k = this.key(name);
    const hit = k === undefined ? undefined : this.children.get(k);
    if (hit) {
      if (hit.kind !== "file") throw typeMismatch(name);
      return hit;
    }
    if (!options?.create) throw notFound(name);
    const file = new MemFileHandle(name, new Uint8Array(0), this.shared);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    this.guard();
    const k = this.key(name);
    const hit = k === undefined ? undefined : this.children.get(k);
    if (!hit) throw notFound(name);
    if (hit.kind === "directory" && hit.children.size && !options?.recursive) {
      throw new DOMException("The directory is not empty.", "InvalidModificationError");
    }
    this.children.delete(k!);
  }

  async *entries(): AsyncGenerator<[string, MemDirHandle | MemFileHandle]> {
    this.guard();
    for (const [name, h] of [...this.children]) yield [name, h];
  }

  async queryPermission(_d?: FsPermissionDescriptor): Promise<PermissionState> {
    return this.shared.permission;
  }

  async requestPermission(_d?: FsPermissionDescriptor): Promise<PermissionState> {
    this.shared.requests++;
    this.shared.permission = this.shared.onRequest();
    return this.shared.permission;
  }
}

/** A fake folder with test helpers. Paths are "/"-separated and relative to the root. */
export interface MemoryFolder {
  root: FsDirHandle;
  /** Create or overwrite a file (bumps lastModified) — "another app changed it". */
  put(path: string, content: string | Uint8Array): void;
  /** File content as text, or undefined when missing. */
  text(path: string): string | undefined;
  /** lastModified + size of a file, or undefined. */
  stat(path: string): { mtime: number; size: number } | undefined;
  /** Remove a file or folder (no trash). */
  remove(path: string): void;
  /** Every file path, sorted. */
  paths(): string[];
  /** Simulate Chrome dropping the grant; `onRequest` decides what requestPermission() returns. */
  setPermission(state: PermissionState, onRequest?: () => PermissionState): void;
  /** How many times requestPermission() was called. */
  readonly permissionRequests: number;
}

export function memoryFolder(name: string, files: Record<string, string | Uint8Array> = {}, opts: MemoryFsOptions = {}): MemoryFolder {
  const shared: Shared = { caseInsensitive: !!opts.caseInsensitive, clock: 1_700_000_000_000, permission: "granted", onRequest: () => "granted", requests: 0 };
  const root = new MemDirHandle(name, shared);

  const walk = (path: string, create: boolean): { dir: MemDirHandle; base: string } | undefined => {
    const segs = path.split("/");
    const base = segs.pop()!;
    let dir = root;
    for (const seg of segs) {
      let next = dir.children.get(seg);
      if (!next) {
        if (!create) return undefined;
        next = new MemDirHandle(seg, shared);
        dir.children.set(seg, next);
      }
      if (next.kind !== "directory") return undefined;
      dir = next;
    }
    return { dir, base };
  };
  const fileAt = (path: string): MemFileHandle | undefined => {
    const w = walk(path, false);
    const h = w?.dir.children.get(w.base);
    return h?.kind === "file" ? h : undefined;
  };

  const folder: MemoryFolder = {
    root,
    put(path, content) {
      const w = walk(path, true)!;
      const data = typeof content === "string" ? enc.encode(content) : content;
      const cur = w.dir.children.get(w.base);
      if (cur?.kind === "file") {
        cur.data = data;
        cur.lastModified = ++shared.clock;
      } else {
        w.dir.children.set(w.base, new MemFileHandle(w.base, data, shared));
      }
    },
    text(path) {
      const f = fileAt(path);
      return f ? new TextDecoder().decode(f.data) : undefined;
    },
    stat(path) {
      const f = fileAt(path);
      return f ? { mtime: f.lastModified, size: f.data.byteLength } : undefined;
    },
    remove(path) {
      const w = walk(path, false);
      w?.dir.children.delete(w.base);
    },
    paths() {
      const out: string[] = [];
      const visit = (dir: MemDirHandle, prefix: string) => {
        for (const [n, h] of dir.children) {
          if (h.kind === "file") out.push(prefix + n);
          else visit(h, `${prefix}${n}/`);
        }
      };
      visit(root, "");
      return out.sort();
    },
    setPermission(state, onRequest) {
      shared.permission = state;
      if (onRequest) shared.onRequest = onRequest;
    },
    get permissionRequests() {
      return shared.requests;
    },
  };
  for (const [p, c] of Object.entries(files)) folder.put(p, c);
  return folder;
}
