import {
  flushMobileStorage,
  getMobileApiConfig,
  saveMobileApiConfig,
} from "../../runtime/browser-api.js";

/**
 * 挂载独立于业务页面的连接凭据编辑器。
 *
 * 模型选择仍在 Vue 的“连接中心”完成；这里仅保存地址和 Key。图片连接
 * 只有一个 Key，留空时复用对话 Key，不再按模型品牌维护双 Key。
 */
export function mountApiSettingsDialog() {
  const backdrop = document.createElement("div");
  backdrop.className = "mobile-api-backdrop";
  backdrop.innerHTML = `
    <section class="mobile-api-sheet" role="dialog" aria-modal="true" aria-labelledby="api-settings-title">
      <h2 id="api-settings-title">接口连接</h2>
      <p>保存地址和密钥后，连接中心会重新读取模型列表。读取成功不代表已经选择模型。</p>

      <fieldset class="mobile-api-group">
        <legend>对话接口</legend>
        <label>对话 API 地址<input data-key="chatBaseUrl" type="url" placeholder="https://example.com/v1"></label>
        <label>对话 API Key<input data-key="chatApiKey" type="password" autocomplete="new-password" placeholder="sk-…"></label>
      </fieldset>

      <fieldset class="mobile-api-group">
        <legend>图片生成接口</legend>
        <label>图片 API 地址<input data-key="imageBaseUrl" type="url" placeholder="留空则使用对话 API 地址"></label>
        <label>图片 API Key<input data-key="imageApiKey" type="password" autocomplete="new-password" placeholder="留空则使用对话 API Key"></label>
        <small>图片检测只读取模型目录，不会自动生成图片或产生生图费用。</small>
      </fieldset>

      <details class="mobile-api-advanced">
        <summary>兼容设置</summary>
        <label class="mobile-api-toggle">
          <span><b>对话流式传输</b><small>服务不兼容流式响应时可以关闭。</small></span>
          <input data-key="chatStream" type="checkbox">
        </label>
      </details>
      <div class="mobile-api-actions">
        <button class="mobile-api-cancel" type="button">取消</button>
        <button class="mobile-api-save" type="button">保存并重新检测</button>
      </div>
    </section>`;
  document.body.append(backdrop);

  const fill = () => {
    const config = getMobileApiConfig();
    backdrop.querySelectorAll("[data-key]").forEach((input) => {
      if (input.type === "checkbox") input.checked = config[input.dataset.key] !== false;
      else input.value = config[input.dataset.key] || "";
    });
  };
  const open = () => {
    fill();
    backdrop.classList.add("open");
  };
  const close = () => backdrop.classList.remove("open");

  window.addEventListener("night-mailbox:open-api-settings", open);
  backdrop.querySelector(".mobile-api-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector(".mobile-api-save").addEventListener("click", async () => {
    const next = {};
    backdrop.querySelectorAll("[data-key]").forEach((input) => {
      next[input.dataset.key] = input.type === "checkbox" ? input.checked : input.value;
    });
    saveMobileApiConfig(next);
    await flushMobileStorage();
    window.location.reload();
  });
}
