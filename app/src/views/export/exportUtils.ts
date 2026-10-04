// Export view helpers: routes for issue targets, clipboard, downloads.
import type { IssueTarget } from "../../model/validate";
import { href } from "../../state/router";

/** Hash route of the editor that owns an issue (ARCHITECTURE.md "Cross-view URL contract"). */
export function targetHref(t: IssueTarget): string {
  switch (t.view) {
    case "playbook": {
      const q = new URLSearchParams();
      if (t.f !== undefined) q.set("f", String(t.f));
      if (t.s !== undefined) q.set("s", String(t.s));
      if (t.p !== undefined) q.set("p", String(t.p));
      const qs = q.toString();
      return href("playbook", t.path) + (qs ? `?${qs}` : "");
    }
    case "designer":
      return t.index !== undefined ? href("designer", t.path, t.index) : "#/designer";
    case "formations":
      return t.index !== undefined ? href("formations", t.path, t.index) : "#/formations";
    case "concepts":
      return t.play ? `#/concepts?play=${encodeURIComponent(t.play)}` : "#/concepts";
  }
}

export const TARGET_LABEL: Record<IssueTarget["view"], string> = {
  playbook: "Playbook builder",
  designer: "Play designer",
  formations: "Formation editor",
  concepts: "Concepts",
};

/** Copy text to the clipboard (async API, then the legacy textarea fallback). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through (permissions, insecure context)
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Save bytes as a file through a temporary object URL. */
export function downloadBytes(bytes: Uint8Array, fileName: string, type = "application/zip"): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
