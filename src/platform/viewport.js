/**
 * 统一处理移动浏览器和 App WebView 的可视区域、安全区与软键盘高度。
 * 业务组件只读取 CSS 变量，不需要知道 Android 5+ 的 `plus` API。
 */
export function installViewportGuards() {
  const root = document.documentElement;

  const syncViewportHeight = () => {
    const height = Math.round(window.visualViewport?.height || window.innerHeight || 0);
    if (height > 0) root.style.setProperty("--app-runtime-viewport-height", `${height}px`);
  };

  const applyNativeInsets = () => {
    if (!window.plus) return;
    try {
      const insets = window.plus.navigator?.getSafeAreaInsets?.() || {};
      const bottom = Math.max(0, Number(insets.bottom) || 0, Number(insets.deviceBottom) || 0);
      root.style.setProperty("--app-runtime-safe-bottom", `${Math.round(bottom)}px`);
    } catch {}
    try {
      window.plus.webview?.currentWebview?.().setStyle?.({ softinputMode: "adjustResize" });
    } catch {}
    syncViewportHeight();
  };

  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight, { passive: true });
  window.addEventListener("orientationchange", syncViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", syncViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncViewportHeight, { passive: true });

  if (window.plus) applyNativeInsets();
  else document.addEventListener("plusready", applyNativeInsets, { once: true });
}
