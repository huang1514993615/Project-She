"use client";

import { useEffect, useRef } from "react";
import Vue from "vue/dist/vue.esm.js";

const CompanionApp = Vue.extend({
  template: `
    <div class="app-shell">
      <header class="brand-bar">
        <button class="brand" @click="mobileTab = 'chat'" aria-label="返回聊天">
          <span class="brand-mark">夜</span>
          <span><b>夜航信箱</b><small>NIGHT MAILBOX</small></span>
        </button>
        <div class="brand-note">第 {{ dayCount }} 天 · 把今天也写进故事里</div>
        <button class="icon-button" @click="settingsOpen = true" aria-label="打开角色设置">⌁</button>
      </header>

      <div class="workspace">
        <aside class="profile-panel" :class="{ 'mobile-active': mobileTab === 'profile' }">
          <section class="portrait-card">
            <img src="/og.png" alt="晚晚的雨夜头像" />
            <div class="portrait-shade"></div>
            <div class="portrait-copy">
              <span class="online-dot"></span>
              <p>今晚也在</p>
              <h1>{{ profile.name }}</h1>
              <div class="profile-meta">{{ profile.age }} 岁 · {{ profile.personality }} · {{ profile.relation }}</div>
            </div>
          </section>

          <section class="mood-card">
            <div class="section-label"><span>此刻心情</span><em>LIVE</em></div>
            <p class="mood-quote">“窗外在下雨，刚好适合把没说完的话慢慢说完。”</p>
            <div class="sound-wave" aria-label="正在聆听">
              <i v-for="n in 18" :key="n" :style="{ height: (7 + ((n * 7) % 18)) + 'px' }"></i>
            </div>
          </section>

          <section class="facts-card">
            <div class="section-label"><span>她记得</span><button @click="settingsOpen = true">编辑</button></div>
            <div class="fact-row"><span>☕</span><p>你更喜欢少糖的拿铁</p></div>
            <div class="fact-row"><span>☂</span><p>下雨天容易想很多</p></div>
            <div class="fact-row"><span>◷</span><p>最近常常睡得有些晚</p></div>
          </section>
        </aside>

        <main class="chat-panel" :class="{ 'mobile-hidden': mobileTab !== 'chat' }">
          <div class="chat-header">
            <div class="mini-avatar">
              <img src="/og.png" alt="" />
              <span></span>
            </div>
            <div>
              <h2>{{ profile.name }}</h2>
              <p>{{ apiMode === 'live' ? 'DeepSeek 已连接' : '演示陪伴模式' }} · 正在听你说</p>
            </div>
            <button class="scene-button" @click="generateScene" :disabled="generating">
              <span>{{ generating ? '◌' : '▧' }}</span>{{ generating ? '正在想象…' : '生成此刻' }}
            </button>
          </div>

          <div class="date-divider"><span>今天</span></div>

          <section class="messages" ref="messages" aria-live="polite">
            <article v-for="message in messages" :key="message.id" class="message-row" :class="message.role">
              <div v-if="message.role === 'assistant'" class="message-avatar"><img src="/og.png" alt="" /></div>
              <div class="message-wrap">
                <div class="bubble" :class="{ typing: message.typing }">
                  <template v-if="message.typing && !message.content"><i></i><i></i><i></i></template>
                  <template v-else>{{ message.content }}</template>
                </div>
                <time>{{ message.time }}</time>
              </div>
            </article>

            <article v-if="memoryImage" class="memory-card">
              <img :src="memoryImage.url" :alt="memoryImage.caption" />
              <div class="memory-caption">
                <span>我们的此刻 · AI 场景记忆</span>
                <p>{{ memoryImage.caption }}</p>
              </div>
            </article>
          </section>

          <div class="suggestions">
            <button v-for="item in suggestions" :key="item" @click="quickSend(item)">{{ item }}</button>
          </div>

          <form class="composer" @submit.prevent="sendMessage">
            <button type="button" class="attach" @click="generateScene" aria-label="生成场景图片">＋</button>
            <textarea v-model="draft" @keydown.enter.exact.prevent="sendMessage" rows="1" maxlength="500" placeholder="把想说的话留在这里…" aria-label="聊天内容"></textarea>
            <button type="submit" class="send" :disabled="sending || !draft.trim()" aria-label="发送消息">↑</button>
          </form>
          <p class="ai-note">AI 生成内容仅供陪伴参考 · 真实生活同样值得被拥抱</p>
        </main>

        <aside class="task-panel" :class="{ 'mobile-active': mobileTab === 'tasks' }">
          <section class="day-card">
            <div class="eyebrow">OUR LITTLE ROUTINE</div>
            <div class="day-title"><div><span>今天，一起</span><h2>完成一点小事</h2></div><strong>{{ completedCount }}<small>/{{ tasks.length }}</small></strong></div>
            <div class="progress-track"><i :style="{ width: progress + '%' }"></i></div>
          </section>

          <section class="task-list">
            <button v-for="task in tasks" :key="task.id" class="task-item" :class="{ done: task.done }" @click="toggleTask(task)">
              <span class="task-check">{{ task.done ? '✓' : task.icon }}</span>
              <span><b>{{ task.title }}</b><small>{{ task.detail }}</small></span>
              <em>+{{ task.points }}</em>
            </button>
          </section>

          <section class="memory-preview">
            <div class="section-label"><span>本周记忆</span><button @click="generateScene">再生成一张</button></div>
            <div class="memory-photo">
              <img :src="memoryImage ? memoryImage.url : '/og.png'" alt="本周共同记忆" />
              <span>{{ memoryImage ? '刚刚 · 我们的此刻' : '星期五 · 雨夜来信' }}</span>
            </div>
          </section>

          <section class="streak-card">
            <span>✦</span><div><b>{{ points }} 颗心意</b><small>连续陪伴 {{ dayCount }} 天</small></div>
            <button @click="sendEncouragement">收下晚安</button>
          </section>
        </aside>
      </div>

      <nav class="mobile-nav" aria-label="移动端导航">
        <button :class="{ active: mobileTab === 'profile' }" @click="mobileTab = 'profile'"><span>◐</span>她</button>
        <button :class="{ active: mobileTab === 'chat' }" @click="mobileTab = 'chat'"><span>◌</span>对话</button>
        <button :class="{ active: mobileTab === 'tasks' }" @click="mobileTab = 'tasks'"><span>✓</span>我们</button>
      </nav>

      <transition name="fade">
        <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
          <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button class="modal-close" @click="settingsOpen = false" aria-label="关闭">×</button>
            <div class="eyebrow">CUSTOMIZE HER</div>
            <h2 id="settings-title">她会以怎样的方式陪你？</h2>
            <p class="settings-intro">这些设定会写入每次对话，让回应更像你熟悉的她。</p>

            <label class="field-label">名字<input v-model.trim="profile.name" maxlength="8" /></label>
            <label class="field-label">年龄 <b>{{ profile.age }} 岁</b><input v-model.number="profile.age" type="range" min="18" max="40" /></label>
            <div class="field-label">性格</div>
            <div class="choice-grid">
              <button v-for="item in personalities" :key="item.name" :class="{ active: profile.personality === item.name }" @click="profile.personality = item.name">
                <span>{{ item.icon }}</span><b>{{ item.name }}</b><small>{{ item.copy }}</small>
              </button>
            </div>
            <label class="field-label">相处关系
              <select v-model="profile.relation"><option>默契搭子</option><option>温柔恋人</option><option>知心朋友</option><option>成长伙伴</option></select>
            </label>
            <button class="save-profile" @click="saveProfile">保存设定，继续聊天</button>
            <p class="boundary-note">角色年龄固定为成年人。AI 会尊重边界，不鼓励情感依赖，也不会替代现实中的专业帮助。</p>
          </section>
        </div>
      </transition>

      <transition name="toast"><div v-if="toast" class="toast-message">{{ toast }}</div></transition>
    </div>
  `,
  data() {
    return {
      mobileTab: "chat",
      settingsOpen: false,
      sending: false,
      generating: false,
      draft: "",
      toast: "",
      toastTimer: null,
      apiMode: "demo",
      dayCount: 12,
      profile: {
        name: "晚晚",
        age: 24,
        personality: "温柔",
        relation: "默契搭子",
      },
      personalities: [
        { name: "温柔", icon: "☁", copy: "细腻回应" },
        { name: "俏皮", icon: "✦", copy: "轻松有趣" },
        { name: "理性", icon: "◇", copy: "清醒可靠" },
        { name: "治愈", icon: "☾", copy: "安静倾听" },
      ],
      suggestions: ["今天有点累", "陪我聊五分钟", "想听你讲个故事"],
      messages: [
        { id: 1, role: "assistant", content: "晚上好呀。你比平时晚了一点，是今天有很多事要忙吗？", time: "22:08" },
        { id: 2, role: "user", content: "刚忙完，回来的路上下雨了。", time: "22:09" },
        { id: 3, role: "assistant", content: "那一定有点凉。先把外套挂好，喝口热的吧。你愿意的话，可以把今天最累的那一小段交给我。", time: "22:09" },
      ],
      tasks: [
        { id: 1, title: "互道一声早安", detail: "完成今天的第一次问候", points: 10, icon: "☀", done: true },
        { id: 2, title: "分享此刻心情", detail: "用一句话告诉她今天怎样", points: 15, icon: "♡", done: false },
        { id: 3, title: "走一段放松的路", detail: "离开屏幕，散步 10 分钟", points: 20, icon: "↝", done: false },
        { id: 4, title: "生成共同记忆", detail: "把一段对话变成场景图片", points: 25, icon: "▧", done: false },
      ],
      memoryImage: null,
    };
  },
  computed: {
    completedCount() {
      return this.tasks.filter((task) => task.done).length;
    },
    progress() {
      return Math.round((this.completedCount / this.tasks.length) * 100);
    },
    points() {
      return 86 + this.tasks.filter((task) => task.done).reduce((sum, task) => sum + task.points, 0);
    },
  },
  mounted() {
    try {
      const saved = JSON.parse(localStorage.getItem("night-mailbox-state") || "null");
      if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
      if (saved?.tasks) this.tasks = saved.tasks;
    } catch {}
    fetch("/api/health").then((response) => response.json()).then((data) => {
      this.apiMode = data.chat === "configured" ? "live" : "demo";
    }).catch(() => {});
    this.scrollBottom();
  },
  methods: {
    now() {
      return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    },
    persist() {
      localStorage.setItem("night-mailbox-state", JSON.stringify({ profile: this.profile, tasks: this.tasks }));
    },
    showToast(text) {
      this.toast = text;
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => { this.toast = ""; }, 2400);
    },
    scrollBottom() {
      this.$nextTick(() => {
        if (this.$refs.messages) this.$refs.messages.scrollTop = this.$refs.messages.scrollHeight;
      });
    },
    quickSend(text) {
      this.draft = text;
      this.sendMessage();
    },
    async sendMessage() {
      const content = this.draft.trim();
      if (!content || this.sending) return;
      this.draft = "";
      this.sending = true;
      this.messages.push({ id: Date.now(), role: "user", content, time: this.now() });
      const moodTask = this.tasks.find((task) => task.id === 2);
      if (moodTask) moodTask.done = true;
      const reply = { id: Date.now() + 1, role: "assistant", content: "", time: this.now(), typing: true };
      this.messages.push(reply);
      this.persist();
      this.scrollBottom();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: this.profile,
            messages: this.messages.filter((item) => !item.typing).slice(-14).map(({ role, content }) => ({ role, content })),
          }),
        });
        if (!response.ok || !response.body) throw new Error("chat unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        reply.typing = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.content += decoder.decode(value, { stream: true });
          this.scrollBottom();
        }
        if (!reply.content) reply.content = "我在。你可以慢一点说，我会认真听。";
      } catch {
        reply.typing = false;
        reply.content = "刚刚的信号有一点远，不过我没有走开。你愿意再说一次吗？";
      } finally {
        this.sending = false;
        this.scrollBottom();
      }
    },
    async generateScene() {
      if (this.generating) return;
      this.generating = true;
      this.showToast("正在把对话变成一帧记忆…");
      const recent = this.messages.slice(-6).map((item) => `${item.role === "user" ? "我" : this.profile.name}：${item.content}`).join("\n");
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: this.profile, conversation: recent }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        this.memoryImage = { url: data.imageUrl, caption: data.caption || "把这一刻，好好收进信箱里。" };
        const task = this.tasks.find((item) => item.id === 4);
        if (task) task.done = true;
        this.persist();
        this.showToast(data.demo ? "已生成演示记忆 · 配置图片接口后可实时出图" : "这一刻已经收进记忆");
        this.scrollBottom();
      } catch {
        this.showToast("图片没有寄到，再试一次吧");
      } finally {
        this.generating = false;
      }
    },
    toggleTask(task) {
      task.done = !task.done;
      this.persist();
      this.showToast(task.done ? `完成「${task.title}」+${task.points}` : "已恢复为待完成");
    },
    sendEncouragement() {
      this.mobileTab = "chat";
      this.draft = "可以认真和我说一句晚安吗？";
      this.sendMessage();
    },
    saveProfile() {
      if (!this.profile.name) this.profile.name = "晚晚";
      this.persist();
      this.settingsOpen = false;
      this.showToast("她记住了新的相处方式");
    },
  },
});

export default function VueGirlfriend() {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const app = new Vue({
      render: (h) => h(CompanionApp),
    }).$mount(mountRef.current);
    return () => app.$destroy();
  }, []);

  return <div ref={mountRef} />;
}
