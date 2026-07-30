<template>
  <view class="page">
    <!-- #ifndef APP-PLUS -->
    <web-view
      v-if="viewerOpen && webSrc"
      :src="webSrc"
      @error="handleWebViewError"
    ></web-view>
    <!-- #endif -->

    <scroll-view v-if="!viewerOpen" class="update-scroll" scroll-y>
      <view class="update-shell">
        <view class="brand">
          <text class="eyebrow">NIGHT MAILBOX</text>
          <text class="title">夜航信箱</text>
          <text class="subtitle">页面保存在 App 内部，不会跳转到外部浏览器。</text>
        </view>

        <view class="card">
          <view class="card-head">
            <text class="card-title">打开应用</text>
            <text class="badge">{{ currentVersionLabel }}</text>
          </view>
          <text class="card-copy">
            聊天、人物、图片和设置仍保存在当前 App 的本地空间。替换 HTML 不会主动清除这些数据。
          </text>
          <button class="primary-button" :disabled="!ready || busy" @click="openMailbox">
            {{ ready ? "打开夜航信箱" : "正在准备本地页面…" }}
          </button>
        </view>

        <view class="card">
          <text class="card-title">从电脑拉取更新</text>
          <text class="card-copy">
            手机和电脑连接同一个 Wi-Fi，电脑端项目保持启动，然后填写电脑的局域网地址。
          </text>

          <view class="field">
            <text class="field-label">电脑地址</text>
            <input
              v-model.trim="serverAddress"
              class="input"
              type="text"
              :disabled="busy"
              placeholder="例如 192.168.1.6:3000"
              confirm-type="done"
            />
          </view>

          <view v-if="busy" class="progress-block">
            <view class="progress-track">
              <view class="progress-value" :style="{ width: progress + '%' }"></view>
            </view>
            <text class="progress-copy">{{ progressLabel }}</text>
          </view>

          <button class="update-button" :disabled="busy" @click="pullUpdate">
            {{ busy ? "正在拉取…" : "检查并拉取最新页面" }}
          </button>

          <text class="tip">
            连接失败时先确认电脑运行 node server/local-server.mjs，并允许 Windows 防火墙访问 3000 端口。
          </text>
        </view>

        <view class="status-card" :class="{ error: statusType === 'error' }">
          <text class="status-title">{{ statusTitle }}</text>
          <text class="status-message">{{ statusMessage }}</text>
        </view>

        <button class="text-button" :disabled="busy" @click="restoreBundledVersion">
          恢复安装包内置页面
        </button>
      </view>
    </scroll-view>
  </view>
</template>

<script>
const SERVER_STORAGE_KEY = "night-mailbox-update-server";
const META_STORAGE_KEY = "night-mailbox-update-meta";
const LOCAL_DIRECTORY = "night-mailbox";
const LOCAL_HTML = "index.html";
const BACKUP_HTML = "index.backup.html";
const UPDATE_TEMP_HTML = "index.update.tmp";
const BUNDLED_HTML = "_www/hybrid/html/night-mailbox-app.html";
const CONTENT_WEBVIEW_ID = "night-mailbox-local-content";
let contentWebview = null;

export default {
  data() {
    return {
      viewerOpen: false,
      webSrc: "",
      ready: false,
      busy: false,
      progress: 0,
      progressLabel: "",
      serverAddress: uni.getStorageSync(SERVER_STORAGE_KEY) || "",
      currentMeta: uni.getStorageSync(META_STORAGE_KEY) || null,
      statusType: "normal",
      statusTitle: "本地页面",
      statusMessage: "正在检查 App 内的页面文件。",
    };
  },

  computed: {
    currentVersionLabel() {
      const version = this.currentMeta && this.currentMeta.version;
      if (!version) return "内置版";
      return String(version).split("-").slice(-1)[0].slice(0, 12);
    },
  },

  onReady() {
    // #ifdef APP-PLUS
    this.prepareLocalPage();
    // #endif

    // #ifndef APP-PLUS
    this.ready = true;
    this.webSrc = "/hybrid/html/index.html";
    this.statusMessage = "当前为调试环境；Android App 中会使用 App 私有目录。";
    // #endif
  },

  onBackPress() {
    if (contentWebview) {
      contentWebview.close("slide-out-right", 180);
      contentWebview = null;
      this.viewerOpen = false;
      return true;
    }
    if (this.viewerOpen) {
      this.viewerOpen = false;
      return true;
    }
    return false;
  },

  onUnload() {
    if (contentWebview) {
      contentWebview.close("none");
      contentWebview = null;
    }
  },

  methods: {
    setStatus(title, message, type) {
      this.statusTitle = title;
      this.statusMessage = message;
      this.statusType = type || "normal";
    },

    normalizeServerAddress(value) {
      let address = String(value || "").trim();
      if (!address) throw new Error("请先填写电脑的局域网地址");
      if (!/^https?:\/\//i.test(address)) address = `http://${address}`;
      address = address.replace(/\/+$/, "");
      const match = address.match(/^(https?:\/\/)(\[[^\]]+\]|[^/:]+)(?::(\d+))?(\/.*)?$/i);
      if (!match) throw new Error("电脑地址格式不正确");
      const hostname = match[2];
      const isLocalHost = hostname === "localhost"
        || hostname === "127.0.0.1"
        || /^192\.168\./.test(hostname)
        || /^10\./.test(hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
      const port = match[3] || (isLocalHost ? "3000" : "");
      return `${match[1]}${hostname}${port ? `:${port}` : ""}${match[4] || ""}`;
    },

    resolveEntry(path) {
      return new Promise((resolve, reject) => {
        plus.io.resolveLocalFileSystemURL(path, resolve, reject);
      });
    },

    getDirectory(parent, name, create) {
      return new Promise((resolve, reject) => {
        parent.getDirectory(name, { create: Boolean(create) }, resolve, reject);
      });
    },

    getFile(parent, name, create) {
      return new Promise((resolve, reject) => {
        parent.getFile(name, { create: Boolean(create) }, resolve, reject);
      });
    },

    removeEntry(entry) {
      return new Promise((resolve, reject) => entry.remove(resolve, reject));
    },

    copyEntry(entry, parent, name) {
      return new Promise((resolve, reject) => entry.copyTo(parent, name, resolve, reject));
    },

    moveEntry(entry, parent, name) {
      return new Promise((resolve, reject) => entry.moveTo(parent, name, resolve, reject));
    },

    entryMetadata(entry) {
      return new Promise((resolve, reject) => entry.getMetadata(resolve, reject));
    },

    async getLocalDirectory() {
      const documentRoot = await this.resolveEntry("_doc/");
      return this.getDirectory(documentRoot, LOCAL_DIRECTORY, true);
    },

    async findFile(parent, name) {
      try {
        return await this.getFile(parent, name, false);
      } catch (_) {
        return null;
      }
    },

    async removeNamedFile(parent, name) {
      const entry = await this.findFile(parent, name);
      if (entry) await this.removeEntry(entry);
    },

    localPageUrl(cacheKey) {
      return `_doc/${LOCAL_DIRECTORY}/${LOCAL_HTML}?v=${encodeURIComponent(cacheKey || Date.now())}`;
    },

    async installBundledPage(directory) {
      const bundled = await this.resolveEntry(BUNDLED_HTML);
      await this.removeNamedFile(directory, UPDATE_TEMP_HTML);
      const temporary = await this.copyEntry(bundled, directory, UPDATE_TEMP_HTML);
      await this.replaceLocalPage(directory, temporary);
      const metadata = {
        format: "night-mailbox-app-update",
        version: "bundled",
        source: "bundled",
        updatedAt: new Date().toISOString(),
      };
      uni.setStorageSync(META_STORAGE_KEY, metadata);
      this.currentMeta = metadata;
    },

    async prepareLocalPage() {
      try {
        const directory = await this.getLocalDirectory();
        let localPage = await this.findFile(directory, LOCAL_HTML);
        if (!localPage) {
          await this.installBundledPage(directory);
          localPage = await this.findFile(directory, LOCAL_HTML);
        }
        if (!localPage) throw new Error("无法创建 App 本地页面");
        this.webSrc = this.localPageUrl(this.currentVersionLabel);
        this.ready = true;
        this.setStatus("本地页面已就绪", "可直接打开；需要更新时填写电脑地址并点击拉取。");
      } catch (error) {
        this.webSrc = "/hybrid/html/index.html";
        this.ready = true;
        this.setStatus(
          "使用兼容内置页面",
          `私有目录初始化失败：${this.errorMessage(error)}。仍可打开安装包内页面。`,
          "error",
        );
      }
    },

    openMailbox() {
      if (!this.ready || !this.webSrc) return;
      this.webSrc = this.webSrc.replace(/[?&]open=\d+$/, "")
        + `${this.webSrc.includes("?") ? "&" : "?"}open=${Date.now()}`;

      // #ifdef APP-PLUS
      this.openNativeMailbox();
      return;
      // #endif

      // #ifndef APP-PLUS
      this.viewerOpen = true;
      // #endif
    },

    openNativeMailbox() {
      try {
        const existing = plus.webview.getWebviewById(CONTENT_WEBVIEW_ID);
        if (existing) existing.close("none");
        uni.showLoading({ title: "正在打开", mask: true });
        const webview = plus.webview.create(
          this.webSrc,
          CONTENT_WEBVIEW_ID,
          {
            top: "0px",
            bottom: "0px",
            bounce: "none",
            plusrequire: "ahead",
            hardwareAccelerated: true,
            popGesture: "close",
            softinputMode: "adjustResize",
          },
        );
        contentWebview = webview;
        this.viewerOpen = true;
        webview.addEventListener("loaded", () => {
          uni.hideLoading();
          if (contentWebview === webview) {
            webview.show("slide-in-right", 180);
          }
        });
        webview.addEventListener("error", (event) => {
          uni.hideLoading();
          if (contentWebview === webview) contentWebview = null;
          this.viewerOpen = false;
          this.setStatus(
            "页面打开失败",
            this.errorMessage(event && event.message ? event.message : event),
            "error",
          );
          try {
            webview.close("none");
          } catch (_) {}
        });
        webview.addEventListener("close", () => {
          uni.hideLoading();
          if (contentWebview === webview) contentWebview = null;
          this.viewerOpen = false;
        });
      } catch (error) {
        uni.hideLoading();
        contentWebview = null;
        this.viewerOpen = false;
        this.setStatus("页面打开失败", this.errorMessage(error), "error");
      }
    },

    requestManifest(baseUrl) {
      return new Promise((resolve, reject) => {
        uni.request({
          url: `${baseUrl}/app-update/manifest.json`,
          method: "GET",
          timeout: 120000,
          success: (result) => {
            if (result.statusCode !== 200) {
              const detail = typeof result.data === "string"
                ? result.data
                : JSON.stringify(result.data || {});
              reject(new Error(`电脑返回 ${result.statusCode}：${detail.slice(0, 500)}`));
              return;
            }
            let manifest = result.data;
            if (typeof manifest === "string") {
              try {
                manifest = JSON.parse(manifest);
              } catch (_) {
                reject(new Error("电脑返回的更新清单不是有效 JSON"));
                return;
              }
            }
            if (manifest && manifest.format === "night-mailbox-app-update"
              && manifest.path && manifest.sha256 && Number(manifest.byteSize) > 0) {
              resolve(manifest);
              return;
            }
            reject(new Error("电脑返回的更新清单字段不完整"));
          },
          fail: (error) => reject(new Error(error.errMsg || "无法连接电脑")),
        });
      });
    },

    downloadUpdate(url) {
      return new Promise((resolve, reject) => {
        const task = plus.downloader.createDownload(
          url,
          {
            filename: `_doc/${LOCAL_DIRECTORY}/${UPDATE_TEMP_HTML}`,
            timeout: 600,
            retry: 1,
          },
          (download, status) => {
            if (status === 200) {
              resolve(download.filename);
              return;
            }
            reject(new Error(`下载页面失败，HTTP ${status || "未知"}`));
          },
        );
        task.addEventListener("statechanged", (download) => {
          if (download.totalSize > 0) {
            this.progress = Math.min(95, Math.round(download.downloadedSize / download.totalSize * 100));
            this.progressLabel = `已下载 ${this.progress}%`;
          } else if (download.state === 3) {
            this.progressLabel = "正在接收页面文件…";
          }
        });
        task.start();
      });
    },

    fileSha256(entry) {
      const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
      if (!cryptoApi || !cryptoApi.subtle) return Promise.resolve("");
      return new Promise((resolve, reject) => {
        entry.file((file) => {
          const reader = new plus.io.FileReader();
          reader.onloadend = async (event) => {
            try {
              const dataUrl = String(event.target.result || "");
              const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
              const binary = atob(encoded);
              const bytes = new Uint8Array(binary.length);
              for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
              }
              const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
              const hash = Array.from(new Uint8Array(digest))
                .map((value) => value.toString(16).padStart(2, "0"))
                .join("");
              resolve(hash);
            } catch (error) {
              reject(error);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }, reject);
      });
    },

    async validateDownloadedFile(entry, manifest) {
      const metadata = await this.entryMetadata(entry);
      if (Number(metadata.size) !== Number(manifest.byteSize)) {
        throw new Error(`文件大小校验失败：收到 ${metadata.size}，应为 ${manifest.byteSize}`);
      }
      const hash = await this.fileSha256(entry);
      if (hash && hash.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
        throw new Error("文件 SHA-256 校验失败，已拒绝替换");
      }
      return Boolean(hash);
    },

    async replaceLocalPage(directory, temporary) {
      await this.removeNamedFile(directory, BACKUP_HTML);
      const current = await this.findFile(directory, LOCAL_HTML);
      let backup = null;
      if (current) backup = await this.moveEntry(current, directory, BACKUP_HTML);
      try {
        await this.moveEntry(temporary, directory, LOCAL_HTML);
      } catch (error) {
        if (backup) {
          try {
            await this.moveEntry(backup, directory, LOCAL_HTML);
          } catch (_) {}
        }
        throw error;
      }
    },

    async pullUpdate() {
      if (this.busy) return;
      this.busy = true;
      this.progress = 4;
      this.progressLabel = "正在让电脑构建最新页面…";
      this.setStatus("检查更新", "正在连接电脑并生成最新单文件页面。");

      let directory;
      try {
        const baseUrl = this.normalizeServerAddress(this.serverAddress);
        this.serverAddress = baseUrl;
        uni.setStorageSync(SERVER_STORAGE_KEY, baseUrl);
        const manifest = await this.requestManifest(baseUrl);
        if (this.currentMeta && this.currentMeta.sha256 === manifest.sha256) {
          this.progress = 100;
          this.setStatus("已经是最新版", `当前版本更新时间：${manifest.updatedAt || "未知"}`);
          return;
        }

        directory = await this.getLocalDirectory();
        await this.removeNamedFile(directory, UPDATE_TEMP_HTML);
        this.progress = 8;
        this.progressLabel = "正在下载最新页面…";
        const downloadedPath = await this.downloadUpdate(`${baseUrl}${manifest.path}`);
        const temporary = await this.resolveEntry(downloadedPath);
        this.progress = 96;
        this.progressLabel = "正在校验文件…";
        const hashVerified = await this.validateDownloadedFile(temporary, manifest);
        await this.replaceLocalPage(directory, temporary);

        uni.setStorageSync(META_STORAGE_KEY, manifest);
        this.currentMeta = manifest;
        this.webSrc = this.localPageUrl(manifest.sha256.slice(0, 12));
        this.progress = 100;
        this.setStatus(
          "更新完成",
          hashVerified
            ? "文件大小和 SHA-256 均已校验，旧页面已保留为回滚副本。"
            : "文件大小已校验，旧页面已保留为回滚副本。",
        );
        uni.showToast({ title: "更新完成", icon: "success" });
      } catch (error) {
        if (directory) {
          try {
            await this.removeNamedFile(directory, UPDATE_TEMP_HTML);
          } catch (_) {}
        }
        this.setStatus("拉取失败", this.friendlyNetworkError(error), "error");
        uni.showToast({ title: "更新失败", icon: "none" });
      } finally {
        this.busy = false;
      }
    },

    restoreBundledVersion() {
      if (this.busy) return;
      uni.showModal({
        title: "恢复内置页面",
        content: "只替换页面代码，不主动删除聊天、人物、图片和 API 设置。是否继续？",
        success: async (result) => {
          if (!result.confirm) return;
          this.busy = true;
          this.progress = 20;
          this.progressLabel = "正在恢复…";
          try {
            const directory = await this.getLocalDirectory();
            await this.installBundledPage(directory);
            this.webSrc = this.localPageUrl("bundled");
            this.progress = 100;
            this.setStatus("已恢复内置页面", "App 本地数据保持不变。");
          } catch (error) {
            this.setStatus("恢复失败", this.errorMessage(error), "error");
          } finally {
            this.busy = false;
          }
        },
      });
    },

    handleWebViewError(event) {
      const detail = event && event.detail ? JSON.stringify(event.detail) : "未知错误";
      this.viewerOpen = false;
      this.setStatus("页面打开失败", detail, "error");
    },

    errorMessage(error) {
      return String((error && (error.message || error.errMsg)) || error || "未知错误");
    },

    friendlyNetworkError(error) {
      const message = this.errorMessage(error);
      if (/timeout|超时/i.test(message)) {
        return `${message}。请确认电脑服务仍在运行，且手机没有开启会隔离局域网的 VPN。`;
      }
      if (/request:fail|无法连接|network|abort|refused|unreachable/i.test(message)) {
        return `${message}。请确认手机与电脑在同一 Wi-Fi、地址是电脑当前 IPv4，并放行防火墙 3000 端口。`;
      }
      return message;
    },
  },
};
</script>

<style>
page,
.page {
  width: 100%;
  min-height: 100%;
  background: #12131d;
  color: #f7f1ea;
}

.page {
  min-height: 100vh;
}

.update-scroll {
  width: 100%;
  height: 100vh;
}

.update-shell {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 68rpx 30rpx calc(64rpx + env(safe-area-inset-bottom));
  background:
    radial-gradient(circle at 15% 5%, rgba(164, 113, 120, 0.2), transparent 32%),
    radial-gradient(circle at 90% 30%, rgba(92, 103, 148, 0.16), transparent 35%);
}

.brand {
  display: flex;
  flex-direction: column;
  margin: 20rpx 8rpx 48rpx;
}

.eyebrow {
  margin-bottom: 12rpx;
  color: #c99ca3;
  font-size: 20rpx;
  letter-spacing: 8rpx;
}

.title {
  font-family: serif;
  font-size: 62rpx;
  font-weight: 600;
  line-height: 1.15;
}

.subtitle {
  margin-top: 18rpx;
  color: #aaa7b1;
  font-size: 26rpx;
  line-height: 1.7;
}

.card {
  box-sizing: border-box;
  margin-bottom: 24rpx;
  padding: 32rpx;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 28rpx;
  background: rgba(31, 32, 45, 0.92);
  box-shadow: 0 22rpx 70rpx rgba(0, 0, 0, 0.2);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  color: #fffaf4;
  font-size: 32rpx;
  font-weight: 600;
}

.badge {
  max-width: 220rpx;
  padding: 8rpx 16rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(202, 151, 160, 0.13);
  color: #e0b0b7;
  font-size: 20rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-copy,
.tip {
  display: block;
  margin-top: 16rpx;
  color: #aaa7b1;
  font-size: 24rpx;
  line-height: 1.75;
}

.field {
  margin-top: 28rpx;
}

.field-label {
  display: block;
  margin-bottom: 12rpx;
  color: #d7d2d5;
  font-size: 24rpx;
}

.input {
  box-sizing: border-box;
  width: 100%;
  height: 92rpx;
  padding: 0 24rpx;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18rpx;
  background: #171824;
  color: #fff;
  font-size: 28rpx;
}

.primary-button,
.update-button {
  height: 92rpx;
  margin-top: 28rpx;
  border: 0;
  border-radius: 20rpx;
  font-size: 28rpx;
  line-height: 92rpx;
}

.primary-button {
  background: linear-gradient(135deg, #c98f99, #9e6974);
  color: #1c1114;
  font-weight: 700;
}

.update-button {
  background: #ede3dc;
  color: #29232a;
  font-weight: 650;
}

button[disabled] {
  opacity: 0.55;
}

button::after {
  border: 0;
}

.progress-block {
  margin-top: 26rpx;
}

.progress-track {
  height: 10rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.08);
}

.progress-value {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #a7747e, #e2b6bd);
  transition: width 0.25s ease;
}

.progress-copy {
  display: block;
  margin-top: 12rpx;
  color: #bdb8bf;
  font-size: 22rpx;
}

.status-card {
  display: flex;
  flex-direction: column;
  margin: 10rpx 4rpx 0;
  padding: 24rpx;
  border-left: 5rpx solid #8daa9b;
  border-radius: 8rpx 20rpx 20rpx 8rpx;
  background: rgba(111, 145, 128, 0.1);
}

.status-card.error {
  border-left-color: #c77878;
  background: rgba(160, 70, 70, 0.1);
}

.status-title {
  font-size: 25rpx;
  font-weight: 600;
}

.status-message {
  margin-top: 8rpx;
  color: #aaa7b1;
  font-size: 22rpx;
  line-height: 1.65;
  word-break: break-all;
}

.text-button {
  margin-top: 26rpx;
  background: transparent;
  color: #8f8b96;
  font-size: 23rpx;
}
</style>
