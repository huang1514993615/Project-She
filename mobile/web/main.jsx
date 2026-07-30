import Vue from "vue/dist/vue.esm.js";
import { CompanionApp } from "../../app/VueGirlfriend.jsx";
import "../../app/globals.css";
import "./mobile.css";
import {
  initializeMobileStorage,
  installMobileApi,
  mountMobileApiSettings,
} from "./native-api.js";

window.__NIGHT_MAILBOX_MOBILE__ = true;

function installMobileViewportGuards() {
  const root = document.documentElement;

  const syncViewportHeight = () => {
    const height = Math.round(window.visualViewport?.height || window.innerHeight || 0);
    if (height > 0) root.style.setProperty("--app-runtime-viewport-height", `${height}px`);
  };

  const applyNativeInsets = () => {
    if (!window.plus) return;
    try {
      const insets = window.plus.navigator?.getSafeAreaInsets?.() || {};
      const bottom = Math.max(
        0,
        Number(insets.bottom) || 0,
        Number(insets.deviceBottom) || 0,
      );
      root.style.setProperty("--app-runtime-safe-bottom", `${Math.round(bottom)}px`);
    } catch {}
    try {
      window.plus.webview?.currentWebview?.().setStyle?.({
        softinputMode: "adjustResize",
      });
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

async function start() {
  installMobileViewportGuards();
  await initializeMobileStorage();
  installMobileApi();

  new Vue({
    render: (h) => h(CompanionApp),
  }).$mount("#app");

  mountMobileApiSettings();
}

start().catch((error) => {
  document.querySelector("#app").innerHTML = `
    <main style="padding:24px;color:#fff;font-family:sans-serif">
      <h1>本地数据初始化失败</h1>
      <p>${String(error?.message || error)}</p>
    </main>`;
});
