// Animation frames that keep running when the browser isn't painting (an occluded or background window): the
// animation frame, with a 40 ms timer as the fallback. Returns a cancel function.
export function nextFrame(run: () => void): () => void {
  let done = false;
  let raf = 0;
  let timer = 0;
  const go = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    run();
  };
  raf = requestAnimationFrame(go);
  timer = window.setTimeout(go, 40);
  return () => {
    done = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
  };
}
