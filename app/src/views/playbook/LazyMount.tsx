// Renders `children` only once the placeholder has scrolled near the viewport (then keeps them), so play art is never
// computed for off-screen cards.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function LazyMount({ children, placeholder, className, style, rootMargin = "300px" }: { children: ReactNode; placeholder?: ReactNode; className?: string; style?: CSSProperties; rootMargin?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const node = el.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    // The implicit root (viewport) already accounts for clipping by scrolling ancestors.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [shown, rootMargin]);
  return (
    <div ref={el} className={className} style={style}>
      {shown ? children : placeholder}
    </div>
  );
}
