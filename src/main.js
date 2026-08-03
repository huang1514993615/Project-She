/**
 * 纯前端应用唯一入口。
 *
 * 这里只组装运行环境，不放人物、剧情、图片等业务逻辑。云部署版、
 * 单文件 H5 和 App 内置页都从该入口启动，避免多个发行版行为不一致。
 */
import Vue from "vue/dist/vue.esm.js";
import { CompanionApp } from "./app/CompanionApp.js";
import "./styles/app.css";
import "./styles/features/characters.css";
import "./styles/features/albums.css";
import "./styles/runtime.css";
import {
  initializeMobileStorage,
  installMobileApi,
} from "./runtime/browser-api.js";
import { mountApiSettingsDialog } from "./features/connections/api-settings.js";
import { installViewportGuards } from "./platform/viewport.js";

// “MOBILE”表示使用浏览器本地运行时，不代表必须运行在手机上。
window.__NIGHT_MAILBOX_MOBILE__ = true;

async function startApplication() {
  installViewportGuards();
  await initializeMobileStorage();
  installMobileApi();

  new Vue({
    render: (createElement) => createElement(CompanionApp),
  }).$mount("#app");

  mountApiSettingsDialog();
}

startApplication().catch((error) => {
  const root = document.querySelector("#app");
  if (!root) return;
  root.innerHTML = `
    <main style="padding:24px;color:#fff;font-family:sans-serif">
      <h1>本地数据初始化失败</h1>
      <p>${String(error?.message || error)}</p>
    </main>`;
});
