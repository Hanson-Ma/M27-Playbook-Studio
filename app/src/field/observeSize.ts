// One ResizeObserver shared by every Field: dozens of play cards on a page would otherwise each own an observer.

type SizeCallback = (width: number, height: number) => void;

const callbacks = new WeakMap<Element, SizeCallback>();
let observer: ResizeObserver | undefined;

function shared(): ResizeObserver {
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const cb = callbacks.get(entry.target);
      if (!cb) continue;
      const box = entry.contentBoxSize?.[0];
      cb(box ? box.inlineSize : entry.contentRect.width, box ? box.blockSize : entry.contentRect.height);
    }
  });
  return observer;
}

/** Calls `cb` with the element's content-box size whenever it changes. Returns the unsubscribe function. */
export function observeSize(el: Element, cb: SizeCallback): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  callbacks.set(el, cb);
  shared().observe(el);
  return () => {
    callbacks.delete(el);
    observer?.unobserve(el);
  };
}
