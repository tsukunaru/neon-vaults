const EDITABLE_SELECTOR = "input,textarea,select,[contenteditable='true']";
const SCROLLER_SELECTOR = ".screen.active,.result-card,.unlock-card,.reel-card,.sector-intro-card";

export function allowsNativeInteraction(target) {
  return Boolean(target?.closest?.(EDITABLE_SELECTOR));
}

export function shouldPreventOverscroll(target, deltaY) {
  if (allowsNativeInteraction(target)) return false;
  const scroller = target?.closest?.(SCROLLER_SELECTOR);
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return true;
  if (deltaY > 0 && scroller.scrollTop <= 0) return true;
  return deltaY < 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
}

export function installViewportGuards({ root, onResize }) {
  let touchY = 0;
  let frame = 0;
  const viewport = window.visualViewport;
  const syncViewport = () => {
    frame = 0;
    document.documentElement.style.setProperty("--viewport-height", `${Math.max(1, Math.round(viewport?.height || window.innerHeight))}px`);
    onResize?.();
  };
  const scheduleSync = () => {
    if (!frame) frame = requestAnimationFrame(syncViewport);
  };
  const prevent = (event) => event.preventDefault();
  const preventSelection = (event) => { if (!allowsNativeInteraction(event.target)) event.preventDefault(); };
  const touchStart = (event) => { touchY = event.touches[0]?.clientY ?? 0; };
  const touchMove = (event) => {
    const nextY = event.touches[0]?.clientY ?? touchY;
    if (shouldPreventOverscroll(event.target, nextY - touchY)) event.preventDefault();
    touchY = nextY;
  };

  root.addEventListener("selectstart", preventSelection, { capture: true });
  root.addEventListener("contextmenu", preventSelection, { capture: true });
  root.addEventListener("dragstart", preventSelection, { capture: true });
  root.addEventListener("gesturestart", prevent, { capture: true, passive: false });
  root.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  root.addEventListener("touchmove", touchMove, { capture: true, passive: false });
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("orientationchange", scheduleSync);
  document.addEventListener("fullscreenchange", scheduleSync);
  document.addEventListener("webkitfullscreenchange", scheduleSync);
  viewport?.addEventListener("resize", scheduleSync);
  viewport?.addEventListener("scroll", scheduleSync);
  scheduleSync();
}
