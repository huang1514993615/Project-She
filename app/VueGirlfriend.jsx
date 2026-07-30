"use client";

import { useEffect, useRef } from "react";
import Vue from "vue/dist/vue.esm.js";
import {
  limitEnsembleTurns,
  maxEnsembleMessages,
} from "../shared/ensemble-turns.js";
import {
  createDefaultRoleVisualStates,
  DEFAULT_ROLE_VISUAL_STATES,
  ROLE_VISUAL_ACTIONS,
  ROLE_VISUAL_EMOTIONS,
} from "../shared/role-visual-states.js";
import {
  STORY_TIME_SEGMENTS,
  advanceStoryClock,
  dueStoryEvents,
  formatStoryMoment,
  normalizeStoryClock,
  normalizeStoryEvent,
  normalizeStoryEvents,
  storyMomentValue,
  storySegmentLabel,
} from "../shared/story-time.js";
import { shouldAnalyzeStoryEvent } from "../shared/story-event-ai.js";

const localImageSourceCache = new Map();
const localImageElementTokens = new WeakMap();
const MAX_LOCAL_IMAGE_CACHE_ITEMS = 24;

function isNativeLocalImageSource(value) {
  return /^(?:asset:\/\/|file:|content:|\/storage\/|\/data\/|_(?:doc|downloads?)\/)/i.test(String(value || "").trim());
}

function cacheLocalImageSource(source, promise) {
  if (localImageSourceCache.has(source)) localImageSourceCache.delete(source);
  localImageSourceCache.set(source, promise);
  while (localImageSourceCache.size > MAX_LOCAL_IMAGE_CACHE_ITEMS) {
    localImageSourceCache.delete(localImageSourceCache.keys().next().value);
  }
  return promise;
}

function resolveNativeLocalImageSource(source, thumbnail = false) {
  if (!isNativeLocalImageSource(source) || !window.__NIGHT_MAILBOX_NATIVE_IMAGE__?.resolvePreviewSource) {
    return Promise.resolve(source);
  }
  const cacheKey = `${thumbnail ? "thumbnail" : "full"}:${source}`;
  const cached = localImageSourceCache.get(cacheKey);
  if (cached) {
    localImageSourceCache.delete(cacheKey);
    localImageSourceCache.set(cacheKey, cached);
    return cached;
  }
  const resolver = thumbnail && window.__NIGHT_MAILBOX_NATIVE_IMAGE__.resolveThumbnailSource
    ? window.__NIGHT_MAILBOX_NATIVE_IMAGE__.resolveThumbnailSource.bind(window.__NIGHT_MAILBOX_NATIVE_IMAGE__)
    : window.__NIGHT_MAILBOX_NATIVE_IMAGE__.resolvePreviewSource.bind(window.__NIGHT_MAILBOX_NATIVE_IMAGE__);
  const request = resolver(source)
    .catch((error) => {
      localImageSourceCache.delete(cacheKey);
      throw error;
    });
  return cacheLocalImageSource(cacheKey, request);
}

function renderLocalImageElement(element, value) {
  const options = value && typeof value === "object" ? value : { src: value };
  const source = String(options.src || "").trim();
  const thumbnail = options.thumbnail === true;
  const token = Symbol("local-image");
  localImageElementTokens.set(element, token);
  if (!source || !isNativeLocalImageSource(source)) return;
  resolveNativeLocalImageSource(source, thumbnail)
    .then((resolved) => {
      if (localImageElementTokens.get(element) !== token || !resolved) return;
      element.src = resolved;
      element.dataset.localImageReady = "true";
    })
    .catch(() => {
      if (localImageElementTokens.get(element) !== token) return;
      element.dataset.localImageReady = "false";
    });
}

function compactTextHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function currentRoleDerivedState(role, storyDay = 1) {
  const source = role?.derivedProfile && typeof role.derivedProfile === "object"
    ? role.derivedProfile
    : {};
  const initialActualAge = source.initialActualAge !== null
    && source.initialActualAge !== ""
    && Number.isFinite(Number(source.initialActualAge))
    ? Number(source.initialActualAge)
    : Number.isFinite(Number(role?.age))
      ? Number(role.age)
      : null;
  const initialApparentAge = source.initialApparentAge !== null
    && source.initialApparentAge !== ""
    && Number.isFinite(Number(source.initialApparentAge))
    ? Number(source.initialApparentAge)
    : initialActualAge;
  const anchorStoryDay = Math.max(1, Number(source.anchorStoryDay) || 1);
  const elapsedYears = Math.max(0, Math.floor((Math.max(1, Number(storyDay) || 1) - anchorStoryDay) / 365));
  const agingRule = ["normal", "fixed", "long-lived", "ageless", "unknown"].includes(source.agingRule)
    ? source.agingRule
    : "unknown";
  const actualAge = initialActualAge === null
    ? null
    : agingRule === "ageless"
      ? initialActualAge
      : initialActualAge + elapsedYears;
  const apparentAge = initialApparentAge === null
    ? null
    : agingRule === "normal"
      ? initialApparentAge + elapsedYears
      : initialApparentAge;
  return {
    ...source,
    agingRule,
    actualAge,
    apparentAge,
    corePersonality: String(source.corePersonality || role?.personality || "").trim(),
  };
}

const localImageDirective = {
  inserted(element, binding) {
    renderLocalImageElement(element, binding.value);
  },
  update(element, binding) {
    const value = binding.value && typeof binding.value === "object" ? binding.value : { src: binding.value };
    const oldValue = binding.oldValue && typeof binding.oldValue === "object" ? binding.oldValue : { src: binding.oldValue };
    if (value.src !== oldValue.src || value.thumbnail !== oldValue.thumbnail) renderLocalImageElement(element, binding.value);
  },
  unbind(element) {
    localImageElementTokens.delete(element);
  },
};

export const CompanionApp = Vue.extend({
  directives: {
    "local-image": localImageDirective,
  },
  template: `
    <div class="app-shell">
      <header class="brand-bar">
        <button class="brand" @click="mobileTab = 'chat'" aria-label="返回聊天">
          <span class="brand-mark">夜</span>
          <span><b>夜航信箱</b><small>NIGHT MAILBOX</small></span>
        </button>
        <button type="button" class="brand-story-clock" @click="timeSheetOpen = true">
          <b>第 {{ storyClock.day }} 日 · {{ storySegmentLabel }}</b>
          <small>{{ storyClock.location || '当前剧情' }}</small>
        </button>
        <div class="brand-actions">
          <button class="prompt-shortcut" @click="openImageStudio">生图</button>
          <button class="prompt-shortcut" @click="openPrompt">提示词</button>
          <button class="icon-button mobile-menu-trigger" @click="openTopMenu" aria-label="打开功能菜单">⚙</button>
        </div>
      </header>

      <div class="workspace" :class="{ 'prompt-mode': mobileTab === 'prompt', 'image-mode': mobileTab === 'image', 'data-mode': mobileTab === 'data' }">
        <aside class="profile-panel" :class="{ 'mobile-active': mobileTab === 'profile' }">
          <button type="button" class="portrait-card portrait-button" @click="openRoleDetail('primary')" aria-label="查看主角色详情">
            <img v-local-image="{ src: profile.avatarUrl || defaultAvatarUrl, thumbnail: true }" :src="profile.avatarUrl || defaultAvatarUrl" :alt="profile.name + '的头像'" />
            <div class="portrait-shade"></div>
            <div class="portrait-copy">
              <span class="online-dot"></span>
              <p>今晚也在</p>
              <h1>{{ profile.name }}</h1>
              <div class="profile-meta">{{ roleDerivedSummary(profile) }} · {{ profile.relation }}</div>
              <div v-if="ensemble.enabled" class="ensemble-meta">多人场景 · 闺蜜 {{ ensemble.friend.name }}</div>
            </div>
          </button>

          <section class="mood-card">
            <div class="section-label"><span>此刻心情</span><em>LIVE</em></div>
            <p class="mood-quote">“窗外在下雨，刚好适合把没说完的话慢慢说完。”</p>
            <div class="sound-wave" aria-label="正在聆听">
              <i v-for="n in 18" :key="n" :style="{ height: (7 + ((n * 7) % 18)) + 'px' }"></i>
            </div>
          </section>

          <section class="cast-roster-card">
            <div class="section-label"><span>当前角色库</span><button @click="settingsOpen = true">管理</button></div>
            <button type="button" class="cast-roster-item primary" @click="openRoleDetail('primary')">
              <img v-local-image="{ src: profile.avatarUrl || '/og.png', thumbnail: true }" :src="profile.avatarUrl || '/og.png'" alt="" />
              <span><b>{{ profile.name }}</b><small>{{ profile.relation }} · 主角色</small></span>
              <em>主</em>
            </button>
            <button type="button" class="cast-roster-item" @click="openRoleDetail('friend')">
              <img v-if="ensemble.friend.avatarUrl" v-local-image="{ src: ensemble.friend.avatarUrl, thumbnail: true }" :src="ensemble.friend.avatarUrl" alt="" />
              <i v-else>{{ ensemble.friend.name.slice(0, 1) }}</i>
              <span><b>{{ ensemble.friend.name }}</b><small>{{ ensemble.friend.relation }}</small></span>
            </button>
            <button
              v-for="role in ensemble.customRoles.slice(0, 5)"
              :key="role.id"
              type="button"
              class="cast-roster-item"
              @click="openRoleDetail(role.id)"
            >
              <img v-if="role.avatarUrl" v-local-image="{ src: role.avatarUrl, thumbnail: true }" :src="role.avatarUrl" alt="" />
              <i v-else>{{ role.name.slice(0, 1) }}</i>
              <span><b>{{ role.name }}</b><small>{{ role.relation }}</small></span>
            </button>
            <button v-if="ensemble.customRoles.length > 5" type="button" class="cast-more" @click="settingsOpen = true">
              还有 {{ ensemble.customRoles.length - 5 }} 位角色
            </button>
          </section>
        </aside>

        <main class="chat-panel" :class="{ 'mobile-hidden': mobileTab !== 'chat' }">
          <section v-if="standaloneMode && motionDisplayEnabled" class="character-stage" :class="[{ 'has-visual': stageImageUrl, 'has-background': stageBackgroundUrl }, stageMotionClass]" aria-live="polite">
            <img v-if="stageBackgroundUrl" v-local-image="stageBackgroundUrl" class="character-stage-background" :src="stageBackgroundUrl" alt="" />
            <div class="character-stage-copy">
              <span>NOW PLAYING</span>
              <button type="button" @click="stageRoleId && openRoleDetail(stageRoleId, 'visual')">
                <b>{{ stageSpeaker || profile.name }}</b>
              </button>
              <p v-if="!stageImageUrl">为角色生成或导入动作图后，对话会按情绪与动作自动切换。</p>
            </div>
            <button
              type="button"
              class="character-stage-portrait"
              @click="replayCurrentStageVisual"
              :aria-label="'重新播放' + (stageSpeaker || profile.name) + '的当前动作'"
            >
              <img
                v-for="(layer, index) in stageLayers"
                :key="index + '-' + stageMotionNonce"
                v-show="layer.url"
                v-local-image="layer.url"
                :src="layer.url"
                alt=""
                :class="{ active: index === stageActiveLayer }"
              />
              <span v-if="!stageImageUrl">{{ (stageSpeaker || profile.name).slice(0, 1) }}</span>
            </button>
            <div class="character-stage-tags">
              <button type="button" class="stage-background-trigger" @click.stop="openBackgroundComposer">
                {{ stageBackgroundUrl ? '更换背景' : '添加背景' }}
              </button>
            </div>
          </section>

          <section class="messages" ref="messages" aria-live="polite">
            <button
              v-if="hiddenEarlierMessageCount"
              type="button"
              class="load-earlier-messages"
              @click="loadEarlierMessages"
            >加载更早的 30 条（还剩 {{ hiddenEarlierMessageCount }} 条）</button>
            <article v-for="message in displayedMessages" :key="message.id" :data-message-id="message.id" class="message-row" :class="message.role">
              <button
                v-if="message.role === 'assistant'"
                type="button"
                class="message-avatar"
                :class="{ 'guest-avatar': message.speaker && message.speaker !== profile.name }"
                @click.stop="openSpeakerDetail(message.speaker || profile.name)"
                :aria-label="'查看' + (message.speaker || profile.name) + '的人物详情'"
              >
                <img v-if="!message.speaker || message.speaker === profile.name" v-local-image="{ src: profile.avatarUrl || '/og.png', thumbnail: true }" :src="profile.avatarUrl || '/og.png'" alt="" />
                <img v-else-if="roleAvatar(message.speaker)" v-local-image="{ src: roleAvatar(message.speaker), thumbnail: true }" :src="roleAvatar(message.speaker)" :alt="message.speaker + '的角色形象'" class="role-avatar-image" />
                <span v-else>{{ message.speaker.slice(0, 1) }}</span>
              </button>
              <div class="message-wrap">
                <figure v-if="message.imageUrl" class="generated-scene">
                  <button type="button" class="generated-scene-preview" @click="openMessageImagePreview(message)" aria-label="放大查看对话场景图">
                    <img v-local-image="message.imageUrl" :src="message.imageUrl" :alt="'根据当前对话生成的场景图'" loading="lazy" />
                  </button>
                  <figcaption>
                    <span>AI 场景图</span>
                    <small>{{ imageQualityLabel(message.imageQuality) }} · {{ message.imageModel }}</small>
                  </figcaption>
                </figure>
                <div v-if="message.role === 'user' && editingMessageId === message.id" class="message-editor">
                  <textarea
                    v-model="editingMessageContent"
                    rows="3"
                    maxlength="500"
                    aria-label="修改已发送的消息"
                    @keydown.enter.exact.prevent="submitEditedMessage(message)"
                    @keydown.esc.prevent="cancelEditMessage"
                  ></textarea>
                  <p>保存后，这条消息之后的旧回复会被移除并重新生成。</p>
                  <div>
                    <button type="button" @click="cancelEditMessage">取消</button>
                    <button type="button" class="message-edit-save" @click="submitEditedMessage(message)" :disabled="!editingMessageContent.trim()">保存并重新发送</button>
                  </div>
                </div>
                <div
                  v-else-if="message.content"
                  class="bubble"
                  :class="{ typing: message.typing }"
                >
                  <template v-if="message.typing && !message.content"><i></i><i></i><i></i></template>
                  <template v-else>
                    <b v-if="message.role === 'assistant' && message.speaker" class="speaker-label">{{ message.speaker }}</b>
                    <span>{{ message.content }}</span>
                  </template>
                </div>
                <div v-else-if="message.typing" class="bubble typing"><i></i><i></i><i></i></div>
                <div class="message-meta">
                  <time>{{ message.time }}</time>
                  <button
                    v-if="message.role === 'user' && editingMessageId !== message.id"
                    type="button"
                    @click="startEditMessage(message)"
                    :disabled="sending"
                    aria-label="修改这条消息"
                  >编辑</button>
                  <button
                    v-if="message.role === 'assistant' && canPromoteSpeaker(message.speaker)"
                    type="button"
                    @click="promoteSpeaker(message)"
                    aria-label="将临时角色加入固定角色库"
                  >加入固定角色</button>
                </div>
              </div>
            </article>

          </section>

          <section v-if="dueReminderEvent" class="event-reminder-card" aria-live="polite">
            <div class="event-reminder-icon">!</div>
            <div class="event-reminder-copy">
              <small>约定时间到了 · {{ formatStoryEventMoment(dueReminderEvent) }}</small>
              <b>{{ dueReminderEvent.title }}</b>
              <span v-if="dueReminderEvent.location">{{ dueReminderEvent.location }}</span>
            </div>
            <div class="event-reminder-actions">
              <button type="button" class="primary" @click="respondToDueEvent(dueReminderEvent, 'go')">现在去</button>
              <button type="button" @click="respondToDueEvent(dueReminderEvent, 'decline')">不去了</button>
              <button type="button" @click="respondToDueEvent(dueReminderEvent, 'delay')">改时间</button>
              <button type="button" @click="respondToDueEvent(dueReminderEvent, 'snooze')">稍后提醒</button>
            </div>
          </section>

          <section v-if="pendingConfirmationEvents.length" class="pending-event-card">
            <div>
              <small>从刚才的对话中识别到约定</small>
              <b>{{ pendingConfirmationEvents[0].title }}</b>
              <span>{{ formatStoryEventMoment(pendingConfirmationEvents[0]) }}<template v-if="pendingConfirmationEvents[0].location"> · {{ pendingConfirmationEvents[0].location }}</template></span>
            </div>
            <div>
              <button type="button" class="primary" @click="confirmStoryEvent(pendingConfirmationEvents[0])">确认记住</button>
              <button type="button" @click="openStoryEventEditor(pendingConfirmationEvents[0])">修改</button>
              <button type="button" @click="cancelStoryEvent(pendingConfirmationEvents[0])">忽略</button>
              <button v-if="pendingConfirmationEvents.length > 1" type="button" @click="openSchedule">还有 {{ pendingConfirmationEvents.length - 1 }} 条</button>
            </div>
          </section>

          <div class="suggestion-block" :class="{ loading: suggestionsLoading }">
            <div class="suggestion-label">
              <span>{{ ensemblePlaying ? '角色正在接话，你可以随时插话' : (suggestionsLoading ? '正在想接下来的剧情…' : '你可以这样回应') }}</span>
              <i v-if="suggestionsLoading || ensemblePlaying" aria-hidden="true"></i>
              <button v-if="ensemblePlaying" type="button" @click="stopEnsemblePlayback">暂停接话</button>
              <button v-if="lastReplyStartId" type="button" @click="scrollToMessage(lastReplyStartId)">回到本轮开头</button>
            </div>
            <div class="suggestions">
              <button v-for="item in suggestions" :key="item" @click="quickSend(item)" :disabled="suggestionsLoading || sending || summarizing || ensemblePlaying || editingMessageId !== null">{{ item }}</button>
            </div>
          </div>

          <form class="composer" @submit.prevent="sendMessage">
            <textarea v-model="draft" @keydown.enter.exact.prevent="sendMessage" rows="1" maxlength="500" :placeholder="ensemblePlaying ? '直接输入就能打断并插话…' : '把想说的话留在这里…'" aria-label="聊天内容"></textarea>
            <button type="submit" class="send" :disabled="sending || summarizing || editingMessageId !== null || !draft.trim()" aria-label="发送消息">↑</button>
          </form>
          <p class="ai-note">对话仅保存在本机 · AI 生成内容仅供陪伴参考</p>
        </main>

        <aside class="task-panel story-panel" :class="{ 'mobile-active': mobileTab === 'world' }">
          <section class="day-card story-status-card">
            <div class="eyebrow">STORY CONTROL</div>
            <div class="day-title"><div><span>多人剧情</span><h2>{{ ensemble.enabled ? '角色共同生活中' : '当前为单人场景' }}</h2></div><strong>{{ 2 + ensemble.customRoles.length }}<small>人</small></strong></div>
            <div class="story-status-tags">
              <span>{{ worldSetting ? '世界设定已启用' : '默认现实世界' }}</span>
              <span>{{ autoCompress ? '自动记忆' : '手动记忆' }}</span>
            </div>
          </section>

          <section class="story-overview-card">
            <div class="section-label"><span>长期剧情记忆</span><button @click="openPromptSection('memory')">编辑</button></div>
            <p>{{ storySummary ? storySummary.slice(0, 220) : '还没有长期摘要。对话增多后可一键压缩，角色会带着摘要继续剧情。' }}</p>
            <small>{{ compressibleMessageCount }} 条当前消息 · 阈值 {{ autoCompressThreshold }}</small>
          </section>

          <section class="story-overview-card">
            <div class="section-label"><span>世界规则</span><button @click="openPromptSection('world')">设置</button></div>
            <p>{{ worldSetting ? worldSetting.slice(0, 220) : '还没有自定义世界。可以输入一句想法，让 AI 补全世界、社会、地点和角色行动规则。' }}</p>
            <small>{{ randomRoleEnabled ? '新剧情可自然引入成年女性角色' : '不会主动引入随机角色' }}</small>
          </section>

          <section class="background-job-card" v-if="activeImageJobs.length">
            <div class="section-label"><span>后台生图</span><em>{{ activeImageJobs.length }}</em></div>
            <div v-for="job in activeImageJobs" :key="job.id" class="background-job-row">
              <span class="job-spinner"></span>
              <div><b>{{ job.targetName || '角色形象' }}</b><small>{{ job.status === 'queued' ? '排队中' : '正在生成，可关闭页面' }}</small></div>
            </div>
          </section>

          <button type="button" class="manage-cast-button" @click="settingsOpen = true">管理全部角色</button>
        </aside>

        <section class="schedule-panel" :class="{ 'mobile-active': mobileTab === 'schedule' }">
          <div class="schedule-page-header">
            <button type="button" @click="switchMobileTab('chat')" aria-label="返回聊天">‹</button>
            <div>
              <small>STORY CALENDAR</small>
              <h2>剧情时间与约定</h2>
            </div>
            <button type="button" class="schedule-add-button" @click="openStoryEventEditor()">＋</button>
          </div>

          <section class="story-time-hero">
            <span>当前剧情时间</span>
            <b>第 {{ storyClock.day }} 日</b>
            <strong>{{ storySegmentLabel }}</strong>
            <label class="story-location-field">
              <span>当前位置</span>
              <input v-model.trim="storyClock.location" maxlength="120" placeholder="地点尚未记录，点这里填写" />
            </label>
          </section>

          <section class="time-quick-actions">
            <button type="button" @click="advanceToNextSegment"><b>下一时段</b><small>自然推进一点</small></button>
            <button type="button" @click="openTimeJump(0, 'night')"><b>到今晚</b><small>预览后确认</small></button>
            <button type="button" @click="openTimeJump(1, 'morning')"><b>明天上午</b><small>跨过一晚</small></button>
            <button type="button" @click="openTimeJump(1, 'dawn')"><b>自定义跳转</b><small>天数与时段</small></button>
          </section>

          <section v-if="pendingConfirmationEvents.length" class="schedule-group">
            <div class="schedule-group-title"><b>等待你确认</b><span>{{ pendingConfirmationEvents.length }}</span></div>
            <article v-for="event in pendingConfirmationEvents" :key="event.id" class="schedule-event pending">
              <time>{{ formatStoryEventMoment(event) }}</time>
              <div><b>{{ event.title }}</b><small>{{ event.location || '地点待定' }}<template v-if="event.participants.length"> · {{ event.participants.join('、') }}</template></small></div>
              <div class="schedule-event-actions">
                <button type="button" class="primary" @click="confirmStoryEvent(event)">确认</button>
                <button type="button" @click="openStoryEventEditor(event)">修改</button>
                <button type="button" @click="cancelStoryEvent(event)">忽略</button>
              </div>
            </article>
          </section>

          <section class="schedule-group">
            <div class="schedule-group-title"><b>接下来的约定</b><span>{{ upcomingStoryEvents.length }}</span></div>
            <p v-if="!upcomingStoryEvents.length" class="schedule-empty">暂时没有确定的安排。你可以手动添加，也可以在对话中说“明天下午去集市”，系统会先让你确认。</p>
            <article v-for="event in upcomingStoryEvents" :key="event.id" class="schedule-event">
              <time>{{ formatStoryEventMoment(event) }}</time>
              <div>
                <b>{{ event.title }}</b>
                <small>{{ event.location || '地点待定' }}<template v-if="event.participants.length"> · {{ event.participants.join('、') }}</template></small>
                <em>{{ storyEventStatusLabel(event.status) }}</em>
              </div>
              <div class="schedule-event-actions">
                <button type="button" @click="openStoryEventEditor(event)">编辑</button>
                <button v-if="storyMomentValue(event.day, event.segment) <= storyMomentValue(storyClock.day, storyClock.segment)" type="button" class="primary" @click="respondToDueEvent(event, 'go')">开始</button>
                <button type="button" @click="completeStoryEvent(event)">完成</button>
              </div>
            </article>
          </section>

          <section v-if="storyEvents.some((event) => ['completed', 'declined', 'missed', 'cancelled'].includes(event.status))" class="schedule-group compact">
            <div class="schedule-group-title"><b>过去的记录</b></div>
            <article
              v-for="event in storyEvents.filter((item) => ['completed', 'declined', 'missed', 'cancelled'].includes(item.status)).slice(-10).reverse()"
              :key="event.id"
              class="schedule-history-row"
            >
              <span>{{ formatStoryEventMoment(event) }}</span>
              <b>{{ event.title }}</b>
              <small>{{ storyEventStatusLabel(event.status) }}</small>
            </article>
          </section>
        </section>

        <section class="prompt-panel" :class="{ 'mobile-active': mobileTab === 'prompt' }">
          <div class="prompt-page-header">
            <div>
              <div class="eyebrow">STORY & WORLD</div>
              <h2>多人剧情控制台</h2>
              <p>世界设定、长期记忆和角色共同规则都会保存在电脑本地，并用于下一轮多人对话。</p>
            </div>
            <button @click="switchMobileTab('chat')" aria-label="返回聊天">×</button>
          </div>
          <section class="prompt-priority-card">
            <div>
              <b>提示词优先级</b>
              <span>内容冲突时按 1 → 4 使用；不会在角色回复中复述这些说明。</span>
            </div>
            <nav aria-label="提示词优先级导航">
              <button type="button" @click="openPromptSection('world')"><em>1</em>世界设定</button>
              <button type="button" @click="openPromptSection('roles')"><em>2</em>人物身份</button>
              <button type="button" @click="openPromptSection('memory')"><em>3</em>剧情与角色记忆</button>
              <button type="button" @click="openPromptSection('system')"><em>4</em>回复风格</button>
            </nav>
          </section>
          <div ref="worldEditor" class="prompt-editor-card world-editor-card" :class="{ focused: promptSection === 'world' }">
            <div class="prompt-editor-meta">
              <span><i></i> 1 · 世界设定（最高优先级）</span>
              <small>{{ worldSetting.length }}/12000</small>
            </div>
            <textarea
              v-model="worldSetting"
              maxlength="12000"
              spellcheck="false"
              aria-label="世界设定"
              placeholder="例如：现代都市、魔法大陆、太空殖民地……写一句想法后可让 AI 补全。"
            ></textarea>
            <div class="world-generation-controls">
              <label class="field-label">给 AI 的创作方向
                <input v-model.trim="worldSeed" maxlength="500" placeholder="例如：丰富魔法阶级、城市、组织与可发展的剧情线索" />
              </label>
              <button type="button" class="prompt-reset" @click="generateWorldSetting" :disabled="worldGenerating">
                {{ worldGenerating ? 'AI 正在整理…' : '让 AI 生成/完善' }}
              </button>
            </div>
            <div class="memory-compression-settings compact">
              <label><input v-model="randomRoleEnabled" type="checkbox" /><span><b>合理引入新角色</b><small>只在新一天、新地点、任务或新剧情时考虑加入，优先成年女性</small></span></label>
              <label class="memory-threshold">间隔参考 <b>{{ randomRoleInterval }} 条</b><input v-model.number="randomRoleInterval" type="range" min="8" max="60" step="2" /></label>
            </div>
            <div class="prompt-actions">
              <span></span>
              <button class="prompt-save" @click="saveWorldSetting" :disabled="worldGenerating || summarySaving">保存世界设定</button>
            </div>
          </div>
          <div ref="memoryEditor" class="prompt-editor-card story-memory-card" :class="{ focused: promptSection === 'memory' }">
            <div class="prompt-editor-meta">
              <span><i></i> 3 · 剧情与角色长期记忆</span>
              <small>{{ storySummary.length }}/20000 · {{ roleMemoryCount }} 位人物记忆 · 当前 {{ compressibleMessageCount }} 条消息</small>
            </div>
            <textarea
              v-model="storySummary"
              maxlength="20000"
              spellcheck="false"
              aria-label="长期剧情摘要"
              placeholder="总结后会在这里保存当前场景、人物关系、重要事件、用户偏好和未完成剧情…"
            ></textarea>
            <div class="memory-compression-settings">
              <label><input v-model="autoCompress" type="checkbox" /><span><b>自动压缩上下文</b><small>达到阈值后，在下一次发送前自动总结并清理旧消息</small></span></label>
              <label class="memory-threshold">触发阈值 <b>{{ autoCompressThreshold }} 条</b><input v-model.number="autoCompressThreshold" type="range" min="20" max="120" step="10" /></label>
            </div>
            <div class="prompt-help">
              <span>{{ summaryUpdatedAt ? '最近总结：' + formatSummaryTime(summaryUpdatedAt) : '尚未生成剧情摘要' }}</span>
              <span>摘要与设置保存在 data/settings.json</span>
            </div>
            <div class="prompt-actions memory-actions">
              <button
                v-if="standaloneMode"
                class="prompt-reset"
                @click="applyStandaloneDefaultScenario"
                :disabled="scenarioApplying || summarySaving || summarizing"
              >
                {{ scenarioApplying ? '正在载入…' : '载入默认艾尔德兰档案' }}
              </button>
              <button class="prompt-reset" @click="saveStorySummary" :disabled="summarySaving || summarizing">
                {{ summarySaving ? '保存中…' : '保存摘要与设置' }}
              </button>
              <button class="prompt-save" @click="summarizeConversation(false)" :disabled="summarizing || sending || compressibleMessageCount < 4">
                {{ summarizing ? '正在分块总结…' : '压缩当前对话' }}
              </button>
            </div>
            <p class="image-prompt-warning">压缩成功后才会清理旧消息；失败时原记录保持不变。</p>
          </div>
          <div ref="roleEditor" class="prompt-editor-card role-prompt-manager-card" :class="{ focused: promptSection === 'roles' }">
            <div class="prompt-editor-meta">
              <span><i></i> 2 · 人物稳定身份（高于剧情摘要）</span>
              <small>{{ 2 + ensemble.customRoles.length + ensemble.temporaryRoles.length }} 位</small>
            </div>
            <p>每个人物只保留一份“人物提示词”和一份“稳定外观”。生图提示词只用于图片模型，不参与对话。</p>
            <div class="managed-role-grid">
              <button type="button" @click="openRoleDetail('primary')"><b>{{ profile.name }}</b><small>主角色 · {{ profile.prompt ? '已设置' : '使用默认' }}</small></button>
              <button type="button" @click="openRoleDetail('friend')"><b>{{ ensemble.friend.name }}</b><small>固定角色 · {{ ensemble.friend.prompt ? '已设置' : '使用默认' }}</small></button>
              <button v-for="role in ensemble.customRoles" :key="role.id" type="button" @click="openRoleDetail(role.id)"><b>{{ role.name }}</b><small>固定角色 · {{ role.prompt ? '已设置' : '使用默认' }}</small></button>
              <button v-for="role in ensemble.temporaryRoles" :key="role.id" type="button" @click="openRoleDetail(role.id)"><b>{{ role.name }}</b><small>临时档案 · {{ role.prompt ? '已设置' : '使用默认' }}</small></button>
            </div>
          </div>
          <div class="prompt-editor-card model-manager-card">
            <div class="prompt-editor-meta">
              <span><i></i> 模型连接</span>
              <small>config/ai-models.json</small>
            </div>
            <div class="model-manager-grid">
              <label class="field-label">对话服务
                <select :value="chatProvider" @change="setChatProvider($event.target.value)" :disabled="sending">
                  <option value="deepseek">DeepSeek 官方</option>
                  <option value="grok">中转模型</option>
                </select>
              </label>
              <label class="field-label">中转对话模型
                <select :value="grokModel" @change="setDownstreamModel($event.target.value)" :disabled="chatModelsLoading || grokMode !== 'configured' || chatProvider !== 'grok'">
                  <option v-for="model in availableChatModels" :key="model" :value="model">{{ model }}</option>
                </select>
              </label>
              <label class="field-label">图片生成模型
                <select :value="imageModel" @change="setImageModel($event.target.value)" :disabled="imageModelsLoading || imageMode !== 'configured'">
                  <option v-for="model in availableImageModels" :key="model" :value="model">{{ model }}</option>
                </select>
              </label>
            </div>
            <label class="model-manager-toggle">
              <span><b>允许图片生成</b><small>只有手动确认生成时才会产生图片费用</small></span>
              <input v-model="imageEnabled" type="checkbox" @change="saveImagePreference" :disabled="imageMode !== 'configured'" />
            </label>
            <p v-if="modelConnectionWarning" class="model-connection-warning">{{ modelConnectionWarning }}</p>
            <p>地址和模型名称可在 JSON 中修改；Token 只填写到 <code>.env.local</code> 的 <code>DOWNSTREAM_API_KEY</code>。</p>
            <div class="model-manager-shortcuts">
              <button type="button" @click="openSchedule">剧情日程</button>
              <button type="button" @click="openImageStudio">图片与相册</button>
              <button type="button" @click="settingsOpen = true">全部人物</button>
              <button type="button" @click="clearConversation">清空对话</button>
            </div>
          </div>
          <details class="advanced-prompt-section" :open="promptSection === 'system'">
            <summary>4 · 回复风格（最低优先级）</summary>
            <div class="prompt-editor-card">
            <div class="prompt-editor-meta">
              <span><i></i> 通用表达与输出风格</span>
              <small>{{ systemPrompt.length }}/12000</small>
            </div>
            <textarea
              v-model="systemPrompt"
              maxlength="12000"
              spellcheck="false"
              aria-label="系统提示词"
              placeholder="输入通用的表达方式和回复结构；人物性格请在人物设定中修改…"
            ></textarea>
            <div class="prompt-help">
              <span>支持变量：{{ promptVariableHelp }}</span>
              <span>文件：data/settings.json</span>
            </div>
            <div class="prompt-actions">
              <button class="prompt-reset" @click="resetPrompt">恢复默认</button>
              <button class="prompt-save" @click="savePrompt" :disabled="promptSaving || !systemPrompt.trim()">
                {{ promptSaving ? '正在保存…' : '保存并立即生效' }}
              </button>
            </div>
          </div>
          </details>
          <div class="prompt-storage-note">
            <b>不会使用数据库</b>
            <p>角色设定保存在 <code>data/settings.json</code>，聊天记录保存在 <code>data/chat-history.json</code>。同一台电脑启动服务后，手机和电脑看到的是同一份记录。</p>
            <button
              v-if="directApiMode"
              type="button"
              class="api-settings-link"
              @click="openDirectApiSettings"
            >接口连接设置</button>
          </div>
        </section>

        <section class="image-studio-panel" v-if="mobileTab === 'image'" :class="{ 'mobile-active': true }">
          <div class="prompt-page-header">
            <div>
              <div class="eyebrow">IMAGE STUDIO</div>
              <h2>场景图片工作台</h2>
              <p>从当前剧情整理画面提示词，确认或修改后再提交。任务在 Node 服务后台运行，关闭页面不会中断。</p>
            </div>
            <button @click="switchMobileTab('chat')" aria-label="返回聊天">×</button>
          </div>

          <nav class="album-tabs" aria-label="图片相册分类">
            <button type="button" :class="{ active: galleryTab === 'scene' }" @click="galleryTab = 'scene'">
              <span>场景相册</span><em>{{ sceneImageJobs.length }}</em>
            </button>
            <button type="button" :class="{ active: galleryTab === 'character' }" @click="galleryTab = 'character'">
              <span>人物相册</span><em>{{ characterImageJobs.length }}</em>
            </button>
          </nav>

          <section v-if="galleryTab === 'scene'" class="image-studio-editor">
            <div class="image-studio-toolbar">
              <label class="model-manager-toggle">
                <span><b>允许图片生成</b><small>最多调用三次；只有明确的 400 内容拒绝才会自动改写重试</small></span>
                <input v-model="imageEnabled" type="checkbox" @change="saveImagePreference" :disabled="imageMode !== 'configured'" />
              </label>
              <label class="field-label">图片模型
                <select v-model="imageModel" @change="saveImagePreference" :disabled="imageModelsLoading">
                  <option v-for="model in availableImageModels" :key="model" :value="model">{{ model }}</option>
                </select>
              </label>
            </div>
            <div class="image-prompt-meta">
              <span>{{ imageModel }} · 标准 · 1024×1536 竖图</span>
              <small>{{ imagePrompt.length }}/1200</small>
            </div>
            <textarea
              v-model="imagePrompt"
              maxlength="1200"
              spellcheck="false"
              aria-label="可编辑的当前场景图片提示词"
              placeholder="点击“从当前剧情整理”，或直接输入要生成的画面…"
              @input="persist"
            ></textarea>
            <p class="image-prompt-warning">提交前可自由修改。若图片模型明确返回 400 内容拒绝，系统会让对话模型独立调整不合适的部分，图片接口总计最多调用三次。</p>
            <div class="image-prompt-actions">
              <button class="prompt-reset" @click="prepareScenePrompt" :disabled="imagePromptPreparing || imageGenerating || !imageEnabled">
                {{ imagePromptPreparing ? '正在整理场景…' : '从当前剧情整理' }}
              </button>
              <button class="prompt-save" @click="generateSceneImage" :disabled="imageGenerating || !imageEnabled || imagePrompt.trim().length < 40">
                {{ imageGenerating ? '正在提交…' : '提交后台生成' }}
              </button>
            </div>
          </section>

          <section v-else class="character-album-guide">
            <div>
              <div class="eyebrow">CHARACTER PORTRAITS</div>
              <h3>人物形象从角色详情中生成</h3>
              <p>点击角色头像进入“形象生成”，每次成功结果都会在这里保留独立的人物资料快照。</p>
            </div>
            <button type="button" @click="switchMobileTab('profile')">前往角色库</button>
          </section>

          <section class="image-job-gallery">
            <div class="section-label">
              <span>{{ galleryTab === 'scene' ? '按时间保存的剧情场景' : '按人物保存的形象档案' }}</span>
              <em>{{ galleryJobs.length }}</em>
            </div>
            <p v-if="!galleryJobs.length" class="image-gallery-empty">
              {{ galleryTab === 'scene' ? '还没有成功的场景图片。生成中的任务会显示在这里，失败记录不会进入相册。' : '还没有成功的人物图片。请从人物详情发起生成。' }}
            </p>
            <div class="album-grid">
            <article v-for="job in displayedGalleryJobs" :key="job.id" class="image-job-card" :class="job.status">
              <button v-if="job.imageUrl" type="button" class="album-image-button" @click="openGalleryPreview(job)" :aria-label="'放大查看' + (job.archive?.title || job.targetName || '生成图片')">
                <img v-local-image="{ src: job.imageUrl, thumbnail: true }" :src="job.imageUrl" :alt="job.archive?.title || job.targetName || '生成图片'" loading="lazy" />
                <span>点击查看大图</span>
              </button>
              <div v-else class="image-job-placeholder">
                <span v-if="job.status === 'queued' || job.status === 'running'" class="job-spinner"></span>
                <small>{{ job.status === 'queued' ? '排队中' : '生成中' }}</small>
              </div>
              <div class="image-job-copy">
                <div><b>{{ job.archive?.title || job.targetName || (isCharacterAlbumItem(job) ? '角色形象' : '当前剧情场景') }}</b><time>{{ formatSummaryTime(job.archive?.capturedAt || job.updatedAt) }}</time></div>
                <p>{{ job.statusMessage || (job.status === 'completed' ? '生成完成' : job.status === 'failed' ? '生成失败' : '正在后台生成') }}</p>
                <p v-if="isCharacterAlbumItem(job)" class="album-summary">
                  {{ [job.archive?.relation, job.archive?.personality].filter(Boolean).join(' · ') || job.archive?.introduction || '人物资料快照保存在本地相册。' }}
                </p>
                <p v-else class="album-summary">
                  {{ job.archive?.eventSummary || job.archive?.scene || job.prompt || '当前剧情事件已随图片单独保存。' }}
                </p>
                <small v-if="job.archive?.summaryGenerated">AI 档案 · {{ job.archive.summaryModel }}</small>
                <small v-else-if="job.archive?.summaryError" class="image-job-error">AI 档案整理失败，已保留生成时原始快照</small>
                <small v-if="job.attempt">图片调用 {{ job.attempt }}/{{ job.maxAttempts || 3 }}<template v-if="job.rewritten"> · 已自动调整提示词</template></small>
              </div>
            </article>
            </div>
            <button
              v-if="displayedGalleryJobs.length < galleryJobs.length"
              type="button"
              class="prompt-reset"
              @click="galleryDisplayLimit += 18"
            >加载更多（剩余 {{ galleryJobs.length - displayedGalleryJobs.length }}）</button>
          </section>
        </section>

        <section class="data-diagnostics-panel" v-if="mobileTab === 'data'">
          <div class="prompt-page-header data-page-header">
            <div>
              <div class="eyebrow">DATA & DIAGNOSTICS</div>
              <h2>数据与诊断</h2>
              <p>图片迁移、完整备份、历史记录和错误日志集中在这里管理。</p>
            </div>
            <button @click="switchMobileTab('chat')" aria-label="返回聊天">×</button>
          </div>

          <div class="data-page-grid">
            <article v-if="standaloneMode" class="asset-storage-card data-page-card">
              <div>
                <b>图片存储与迁移</b>
                <small v-if="assetStorage">
                  {{ assetStorage.backend === 'app-file' ? 'App 文件存储' : '浏览器 IndexedDB' }}
                  · 新资产 {{ assetStorage.assetCount || 0 }} 张
                  · {{ formatStorageBytes(assetStorage.totalBytes) }}
                </small>
                <small v-else>正在读取图片存储状态…</small>
              </div>
              <div v-if="assetStorage" class="asset-storage-metrics">
                <span><b>{{ (assetStorage.legacyCount || 0) + (assetStorage.migratableAssetCount || 0) }}</b><small>待迁移</small></span>
                <span><b>{{ assetStorage.assetCount || 0 }}</b><small>新资产</small></span>
                <span><b>{{ assetStorage.migration?.completed || 0 }}</b><small>本轮成功</small></span>
                <span><b>{{ assetStorage.migration?.failed || 0 }}</b><small>失败</small></span>
              </div>
              <p v-if="assetStorage?.legacyCount || assetStorage?.migratableAssetCount">
                发现 {{ assetStorage.legacyCount || 0 }} 个旧图片引用和 {{ assetStorage.migratableAssetCount || 0 }} 个可搬入 App 文件夹的 IndexedDB 原图。成功项会逐张写入并校验，失败项继续保留原图和原引用。
              </p>
              <p v-else-if="assetStorage">暂未发现需要迁移的旧图片引用。</p>
              <div v-if="backupBusy === 'migration'" class="migration-live-progress" role="status" aria-live="polite">
                <span class="job-spinner"></span>
                <div>
                  <b>正在迁移 {{ assetStorage?.migration?.completed || 0 }}/{{ assetStorage?.migration?.total || 0 }}</b>
                  <small v-if="assetStorage?.migration?.current">当前：{{ assetStorage.migration.current }}</small>
                  <small v-else>正在读取下一张图片…</small>
                </div>
              </div>
              <div class="data-card-actions">
                <button
                  v-if="assetStorage?.legacyCount || assetStorage?.migratableAssetCount"
                  type="button"
                  @click="migrateImageAssets"
                  :disabled="Boolean(backupBusy)"
                >{{ backupBusy === 'migration' ? '正在迁移…' : '开始 / 继续迁移' }}</button>
                <button type="button" @click="refreshAssetStorage" :disabled="Boolean(backupBusy)">重新扫描</button>
              </div>
              <details v-if="assetStorage?.migration?.errors?.length" class="migration-error-list" open>
                <summary>查看 {{ assetStorage.migration.errors.length }} 条迁移错误</summary>
                <article v-for="(entry, index) in assetStorage.migration.errors" :key="index">
                  <b>{{ entry.source || '未知图片' }}</b>
                  <p>{{ entry.error || '迁移失败' }}</p>
                </article>
              </details>
            </article>

            <article class="data-page-card backup-data-card">
              <div class="data-card-heading">
                <div><b>完整备份</b><small>不包含 API Key</small></div>
                <span>世界、人物、记忆、历史和图片</span>
              </div>
              <div class="backup-primary-actions">
                <button type="button" data-testid="backup-export" @click="exportAllData" :disabled="Boolean(backupBusy)">
                  <span>⇩</span><b>{{ backupBusy === 'export' ? '正在整理…' : '一键导出全部数据' }}</b><small>保存为一个 JSON 文件</small>
                </button>
                <button type="button" data-testid="backup-import" @click="triggerBackupImport" :disabled="Boolean(backupBusy)">
                  <span>⇧</span><b>{{ backupBusy === 'import' ? '正在读取…' : '从备份文件导入' }}</b><small>预览后确认替换</small>
                </button>
                <button v-if="appShellMode" type="button" class="backup-native-action" @click="importLatestNativeBackup" :disabled="Boolean(backupBusy)">
                  <span>↻</span><b>恢复 App 最近备份</b><small>读取 App 私有备份目录</small>
                </button>
              </div>
              <input ref="backupFileInput" class="backup-file-input" type="file" accept="application/json,.json,text/plain" @change="importAllData" :disabled="Boolean(backupBusy)" />
              <div v-if="pendingBackup" class="backup-import-confirm" role="alert">
                <b>已读取备份，等待确认</b>
                <p>{{ pendingBackupMeta.messageCount }} 条对话 · {{ pendingBackupMeta.imageCount }} 张图片 · {{ pendingBackupMeta.roleCount }} 位角色</p>
                <small>确认后会替换当前世界、人物、记忆、对话与相册，本机接口配置保留。</small>
                <div>
                  <button type="button" @click="cancelBackupImport" :disabled="Boolean(backupBusy)">取消</button>
                  <button type="button" @click="confirmBackupImport" :disabled="Boolean(backupBusy)">确认导入并替换</button>
                </div>
              </div>
              <p class="backup-live-status" role="status" aria-live="polite">
                <span v-if="backupBusy" class="job-spinner"></span>
                {{ backupStatus || '建议在迁移或清理前先导出一次完整备份。' }}
              </p>
            </article>

            <article v-if="standaloneMode" class="history-storage-card data-page-card">
              <div>
                <b>对话历史库</b>
                <small v-if="historyStorage">
                  {{ historyStorage.total || 0 }} 条 · 当前窗口 {{ historyStorage.activeCount || 0 }} 条
                  <template v-if="memoryStorage"> · {{ memoryStorage.episodeCount || 0 }} 章节 · {{ memoryStorage.factCount || 0 }} 记忆</template>
                </small>
              </div>
              <p>聊天页只分段渲染消息；未显示的原始消息仍保存在 IndexedDB，并参与长期记忆检索。</p>
              <div class="history-storage-actions">
                <button type="button" @click="archiveActiveHistory" :disabled="Boolean(backupBusy) || !historyStorage?.activeCount">清空当前窗口</button>
                <select v-model.number="historyRetentionDays" aria-label="历史保留时间">
                  <option :value="7">清理 7 天前归档</option><option :value="30">清理 30 天前归档</option>
                  <option :value="90">清理 90 天前归档</option><option :value="365">清理 1 年前归档</option>
                </select>
                <button type="button" class="history-delete-button" @click="deleteOldHistory" :disabled="Boolean(backupBusy) || !historyStorage?.total">执行清理</button>
              </div>
              <button v-if="historyStorage?.total" type="button" class="history-list-toggle" @click="historyListOpen = !historyListOpen">
                {{ historyListOpen ? '收起最近历史' : '按剧情日期查看最近历史' }}
              </button>
              <div v-if="historyListOpen" class="history-recent-list">
                <section v-for="group in historyRecentGroups" :key="group.label">
                  <b>{{ group.label }}</b>
                  <article v-for="message in group.messages" :key="message.id">
                    <span>{{ message.role === 'user' ? '我' : message.speaker || profile.name }}</span><p>{{ message.content }}</p>
                  </article>
                </section>
              </div>
            </article>

            <article class="error-log-manager data-page-card">
              <div class="data-card-heading">
                <div><b>错误日志</b><small>对话、生图、迁移、备份和本地文件错误</small></div>
                <span>{{ filteredErrorLogs.length }}/{{ errorLogs.length }} 条</span>
              </div>
              <div class="error-log-toolbar">
                <select v-model="errorLogFilter" aria-label="日志分类">
                  <option value="all">全部分类</option><option value="image">图片生成</option>
                  <option value="migration">图片迁移</option><option value="backup">备份导入导出</option>
                  <option value="chat">对话模型</option><option value="storage">本地存储</option>
                </select>
                <button type="button" @click="exportErrorLogs" :disabled="!errorLogs.length">导出日志</button>
                <button type="button" class="danger-log-button" @click="clearErrorLogs" :disabled="!errorLogs.length">清除日志</button>
              </div>
              <div class="error-log-list data-error-log-list">
                <p v-if="!filteredErrorLogs.length">当前分类暂时没有错误记录。</p>
                <article v-for="entry in filteredErrorLogs.slice(0, 100)" :key="entry.id">
                  <div><b>{{ entry.source }}</b><time>{{ formatSummaryTime(entry.timestamp) }}</time></div>
                  <p>{{ entry.message }}</p><pre v-if="entry.detail">{{ entry.detail }}</pre>
                </article>
              </div>
            </article>
          </div>
        </section>
      </div>

      <transition name="fade">
        <div v-if="mobileMenuOpen" class="modal-backdrop mobile-menu-backdrop" @click.self="mobileMenuOpen = false">
          <section class="mobile-function-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-function-title">
            <div class="sheet-grabber"></div>
            <button class="modal-close" @click="mobileMenuOpen = false" aria-label="关闭">×</button>
            <small>QUICK MENU</small>
            <h2 id="mobile-function-title">想去哪里？</h2>
            <div class="mobile-function-grid">
              <button type="button" @click="openMobileDestination('chat')"><span>●</span><b>返回聊天</b><small>继续当前剧情</small></button>
              <button type="button" @click="openMobileDestination('roles')"><span>◐</span><b>人物管理</b><small>角色与提示词</small></button>
              <button type="button" @click="openMobileDestination('schedule')"><span>◷</span><b>剧情日程</b><small>时间与约定</small></button>
              <button type="button" @click="openMobileDestination('prompt')"><span>✎</span><b>世界与设置</b><small>模型和记忆</small></button>
              <button type="button" @click="openMobileDestination('image')"><span>▣</span><b>图片与相册</b><small>场景和人物图</small></button>
              <button type="button" @click="openMobileDestination('data')"><span>⇄</span><b>数据与诊断</b><small>迁移、备份和日志</small></button>
            </div>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="timeSheetOpen" class="modal-backdrop time-sheet-backdrop" @click.self="timeSheetOpen = false">
          <section class="time-control-sheet" role="dialog" aria-modal="true" aria-labelledby="time-control-title">
            <div class="sheet-grabber"></div>
            <button class="modal-close" @click="timeSheetOpen = false" aria-label="关闭">×</button>
            <small>当前剧情时间</small>
            <h2 id="time-control-title">第 {{ storyClock.day }} 日 · {{ storySegmentLabel }}</h2>
            <p>{{ storyClock.location || '当前地点尚未记录' }}</p>
            <div class="time-sheet-actions">
              <button type="button" @click="advanceToNextSegment"><b>推进到下一时段</b><span>每次操作都会先预览</span></button>
              <button type="button" @click="openTimeJump(0, 'night')"><b>直接到今晚</b><span>跨过白天的日常时间</span></button>
              <button type="button" @click="openTimeJump(1, 'morning')"><b>明天上午</b><span>开始新的一天</span></button>
              <button type="button" @click="openTimeJump(1, 'dawn')"><b>自定义跳转</b><span>选择天数和目标时段</span></button>
            </div>
            <button type="button" class="open-full-schedule" @click="openSchedule">查看全部约定</button>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="eventEditorOpen" class="modal-backdrop" @click.self="eventEditorOpen = false">
          <section class="settings-sheet event-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="event-editor-title">
            <button class="modal-close" @click="eventEditorOpen = false" aria-label="关闭">×</button>
            <div class="eyebrow">STORY EVENT</div>
            <h2 id="event-editor-title">{{ editingStoryEventId ? '修改剧情约定' : '新建剧情约定' }}</h2>
            <label class="field-label">要做的事
              <input v-model.trim="eventDraft.title" maxlength="160" placeholder="例如：和小雨去北门集市找药材" />
            </label>
            <div class="event-time-fields">
              <label class="field-label">第几日
                <input v-model.number="eventDraft.day" type="number" min="1" max="999999" />
              </label>
              <label class="field-label">时间段
                <select v-model="eventDraft.segment">
                  <option v-for="segment in storyTimeSegments" :key="segment.id" :value="segment.id">{{ segment.label }}</option>
                </select>
              </label>
            </div>
            <label class="field-label">地点
              <input v-model.trim="eventDraft.location" maxlength="100" placeholder="可以稍后再决定" />
            </label>
            <label class="field-label">相关人物
              <input v-model.trim="eventParticipantText" maxlength="180" placeholder="用顿号分隔，例如：晚晚、小雨" />
            </label>
            <label class="field-label">备注
              <textarea v-model.trim="eventDraft.notes" rows="4" maxlength="1000" placeholder="要带的东西、约定原因或不能忘的细节…"></textarea>
            </label>
            <button type="button" class="save-profile" @click="saveStoryEventDraft">保存约定</button>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="timeJumpOpen" class="modal-backdrop" @click.self="timeJumpOpen = false">
          <section class="settings-sheet time-jump-sheet" role="dialog" aria-modal="true" aria-labelledby="time-jump-title">
            <button class="modal-close" @click="timeJumpOpen = false" aria-label="关闭">×</button>
            <div class="eyebrow">TIME ADVANCE PREVIEW</div>
            <h2 id="time-jump-title">确认推进剧情时间</h2>
            <div class="time-jump-preview">
              <span>{{ storyMomentLabel }}</span>
              <i>→</i>
              <b>第{{ timeJumpTargetDay }}日 · {{ segmentName(timeJumpSegment) }}</b>
            </div>
            <div class="event-time-fields">
              <label class="field-label">跳过天数
                <input v-model.number="timeJumpDays" type="number" min="0" max="3650" />
              </label>
              <label class="field-label">到达时段
                <select v-model="timeJumpSegment">
                  <option v-for="segment in storyTimeSegments" :key="segment.id" :value="segment.id">{{ segment.label }}</option>
                </select>
              </label>
            </div>
            <section v-if="timeJumpAffectedEvents.length" class="time-jump-warning">
              <b>途中会经过 {{ timeJumpAffectedEvents.length }} 个约定</b>
              <span v-for="event in timeJumpAffectedEvents.slice(0, 5)" :key="event.id">{{ formatStoryEventMoment(event) }} · {{ event.title }}</span>
            </section>
            <label class="model-manager-toggle">
              <span><b>保留途中未处理的约定</b><small>关闭后，这些约定会标记为“已错过”</small></span>
              <input v-model="timeJumpKeepOverdue" type="checkbox" />
            </label>
            <label class="model-manager-toggle">
              <span><b>在聊天中插入时间过渡</b><small>只记录日常流逝，不替你完成重大决定</small></span>
              <input v-model="timeJumpAddTransition" type="checkbox" />
            </label>
            <button type="button" class="save-profile" @click="confirmTimeJump">确认推进</button>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="backgroundComposerOpen" class="modal-backdrop" @click.self="backgroundComposerOpen = false">
          <section class="settings-sheet stage-background-sheet" role="dialog" aria-modal="true" aria-labelledby="stage-background-title">
            <button class="modal-close" @click="backgroundComposerOpen = false" aria-label="关闭">×</button>
            <div class="eyebrow">OPTIONAL STAGE BACKGROUND</div>
            <h2 id="stage-background-title">对话舞台背景</h2>
            <p class="settings-intro">背景与角色立绘分层叠放，组合本身不产生费用。只有你主动点击生成时才会调用一次图片接口；不设置背景时舞台保持空白。</p>
            <div v-if="stageBackgroundUrl" class="stage-background-preview">
              <img v-local-image="stageBackgroundUrl" :src="stageBackgroundUrl" alt="当前对话舞台背景" />
              <span>当前背景已保存在本机</span>
            </div>
            <label class="field-label image-prompt-field">背景最终提示词 <b>{{ stageBackground.prompt.length }}/1200</b>
              <textarea v-model="stageBackground.prompt" maxlength="1200" rows="8" placeholder="只写环境、时间、光线和道具，不要人物。可以自己填写，也可以从当前对话整理。"></textarea>
            </label>
            <div class="background-prompt-actions">
              <button type="button" @click="prepareStageBackground" :disabled="backgroundPromptPreparing || backgroundGenerating">
                {{ backgroundPromptPreparing ? '正在读取当前场景…' : '从当前对话整理' }}
              </button>
              <label class="visual-upload-button">
                导入本地背景
                <input type="file" accept="image/*" @change="uploadStageBackground" />
              </label>
              <button type="button" @click="clearStageBackground" :disabled="Boolean(stageBackgroundJob) || (!stageBackgroundUrl && !stageBackground.prompt)">清空背景</button>
            </div>
            <button
              type="button"
              class="save-profile stage-background-generate"
              @click="generateStageBackground"
              :disabled="imageMode !== 'configured' || backgroundGenerating || Boolean(stageBackgroundJob) || stageBackground.prompt.trim().length < 20"
            >
              {{ stageBackgroundJob ? '背景正在排队或生成…' : (backgroundGenerating ? '正在创建任务…' : '确认付费并生成背景') }}
            </button>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="roleDetailOpen && selectedRole" class="modal-backdrop" @click.self="closeRoleDetail">
          <section class="settings-sheet role-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="role-detail-title">
            <button class="modal-close" @click="closeRoleDetail" aria-label="关闭">×</button>
            <div class="role-detail-hero">
              <button type="button" class="role-detail-avatar" @click="selectedRole.avatarUrl && (portraitPreviewOpen = true)" :disabled="!selectedRole.avatarUrl">
                <img v-if="selectedRole.avatarUrl" v-local-image="selectedRole.avatarUrl" :src="selectedRole.avatarUrl" :alt="selectedRole.name + '的头像预览'" />
                <span v-else>{{ selectedRole.name.slice(0, 1) }}</span>
              </button>
              <div>
                <div class="eyebrow">{{ roleDetailTargetId === 'primary' ? 'PRIMARY CHARACTER' : (selectedRoleIsTemporary ? 'TEMPORARY CHARACTER' : 'CHARACTER PROFILE') }}</div>
                <h2 id="role-detail-title">{{ selectedRole.name }}</h2>
                <p>{{ selectedRole.relation }} · {{ roleDerivedSummary(selectedRole) }} · {{ selectedRole.gender || '未指定' }} <em v-if="selectedRoleIsTemporary" class="temporary-role-badge">临时档案</em></p>
              </div>
            </div>
            <p v-if="selectedRole.avatarUrl" class="role-preview-tip">点击头像可查看大图。头像和提示词均保存在电脑本地。</p>
            <div class="role-detail-tabs" role="tablist" aria-label="人物详情分类">
              <button type="button" :class="{ active: roleDetailTab === 'profile' }" @click="roleDetailTab = 'profile'">人物资料</button>
              <button type="button" :class="{ active: roleDetailTab === 'image' }" @click="roleDetailTab = 'image'">形象生成</button>
              <button type="button" :class="{ active: roleDetailTab === 'album' }" @click="roleDetailTab = 'album'">人物相册（{{ selectedRoleAlbumItems.length }}）</button>
              <button v-if="standaloneMode && motionDisplayEnabled" type="button" :class="{ active: roleDetailTab === 'visual' }" @click="openVisualLibrary">动作图库</button>
            </div>
            <section v-if="roleDetailTab === 'profile'" class="role-detail-pane">
              <div class="role-ai-profile-tools">
                <div>
                  <b>让 AI 整理角色设定</b>
                  <small>读取该角色参与的历史对话，一次生成基础资料、人物提示词与稳定外观；生成后仍可手动修改。</small>
                </div>
                <button type="button" @click="generateRoleSetting('all')" :disabled="roleProfileGenerating">
                  {{ roleProfileGenerating ? '正在分析对话…' : 'AI 生成完整档案' }}
                </button>
              </div>
              <div class="ensemble-fields">
                <label class="field-label">名字<input v-model.trim="selectedRole.name" maxlength="12" :disabled="selectedRoleIsTemporary" /></label>
                <div class="derived-role-state"><b>AI 派生状态</b><span>{{ roleDerivedSummary(selectedRole) }}</span><small>{{ roleDerivedDetail(selectedRole) }}</small></div>
              </div>
              <label class="field-label">性别
                <select v-model="selectedRole.gender">
                  <option>女性</option><option>男性</option><option>非二元</option><option>未指定</option>
                </select>
              </label>
              <label class="field-label">与主角色/用户的关系<input v-model.trim="selectedRole.relation" maxlength="80" /></label>
              <label class="field-label">人物提示词（用于对话）
                <textarea v-model.trim="selectedRole.prompt" maxlength="2000" rows="4" placeholder="人物身份、语气、欲望、行为习惯和与其他人物的互动方式…"></textarea>
              </label>
              <button type="button" class="role-field-ai" @click="generateRoleSetting('prompt')" :disabled="roleProfileGenerating">
                {{ roleProfileGenerating ? 'AI 正在整理…' : 'AI 生成 / 优化人物提示词' }}
              </button>
              <section v-if="selectedRoleMemory" class="role-memory-card">
                <div><b>压缩后的角色长期记忆</b><small>由剧情压缩自动维护，不会因暂时离场而删除</small></div>
                <p v-if="selectedRoleMemory.stableIdentity"><strong>稳定身份</strong>{{ selectedRoleMemory.stableIdentity }}</p>
                <p v-if="selectedRoleMemory.relationshipMemory"><strong>关系记忆</strong>{{ selectedRoleMemory.relationshipMemory }}</p>
                <p v-if="selectedRoleMemory.importantEvents"><strong>重要经历</strong>{{ selectedRoleMemory.importantEvents }}</p>
                <p v-if="selectedRoleMemory.currentStatus"><strong>当前状态</strong>{{ selectedRoleMemory.currentStatus }}</p>
                <p v-if="selectedRoleMemory.lastKnownScene"><strong>最后位置</strong>{{ selectedRoleMemory.lastKnownScene }}</p>
                <p v-if="selectedRoleMemory.commitments"><strong>未完成事项</strong>{{ selectedRoleMemory.commitments }}</p>
              </section>
              <div class="role-profile-actions">
                <button class="save-profile role-detail-save" @click="saveRoleDetail">{{ selectedRoleIsTemporary ? '保存临时角色资料' : '保存人物资料' }}</button>
                <button v-if="selectedRoleIsTemporary && ensemble.customRoles.length < 30" type="button" class="promote-role-button" @click="promoteSelectedTemporaryRole">加入固定角色库</button>
              </div>
            </section>
            <section v-else-if="roleDetailTab === 'image'" class="role-detail-pane image-role-pane">
              <label class="field-label">稳定外观（用于人物一致性）
                <textarea v-model.trim="selectedRole.appearance" maxlength="2000" rows="3" placeholder="发型、五官、体态、穿搭、配饰等长期稳定特征…"></textarea>
              </label>
              <button type="button" class="role-field-ai" @click="generateRoleSetting('appearance')" :disabled="roleProfileGenerating">
                {{ roleProfileGenerating ? 'AI 正在整理…' : 'AI 生成 / 优化稳定外观' }}
              </button>
              <label class="field-label image-prompt-field">生图提示词（只用于图片模型） <b>{{ (selectedRole.imagePrompt || '').length }}/1200</b>
                <textarea v-model.trim="selectedRole.imagePrompt" maxlength="1200" rows="7" placeholder="点击“整理提示词”自动生成，也可以直接输入并修改…"></textarea>
              </label>
              <div class="role-detail-status">
                <span :class="{ ready: imageMode === 'configured' }">{{ imageMode === 'configured' ? imageModel + ' 已配置' : '图片接口未配置' }}</span>
                <small>{{ standaloneMode ? '页面保持打开时会后台继续，不影响聊天' : '提交后在电脑后台继续，可关闭手机页面' }}</small>
              </div>
              <p v-if="characterPromptFallback" class="local-fallback-note">远程对话模型暂时无法连接，当前提示词由本地规则整理，仍可编辑并用于生图。</p>
              <div class="image-prompt-actions role-image-actions">
                <button class="prompt-reset" @click="prepareCharacterPrompt(roleDetailTargetId)" :disabled="characterPromptPreparing">
                  {{ characterPromptPreparing ? '正在整理…' : '整理提示词' }}
                </button>
                <button class="prompt-save" @click="generateSavedCharacterImage" :disabled="imageMode !== 'configured' || characterGenerating || selectedRoleImageJob || !selectedRole.imagePrompt || selectedRole.imagePrompt.trim().length < 80">
                  {{ selectedRoleImageJob ? '后台生成中…' : (characterGenerating ? '正在创建任务…' : (standaloneMode ? '生成人物形象' : '后台生成头像')) }}
                </button>
              </div>
              <button class="save-profile role-detail-save subtle" @click="saveRoleDetail">只保存提示词</button>
            </section>
            <section v-else-if="roleDetailTab === 'album'" class="role-detail-pane role-album-pane">
              <div class="role-album-heading">
                <div>
                  <b>{{ selectedRole.name }}的独立相册</b>
                  <small>包含人物形象、动作基底和以前生成或导入的表情动作图。</small>
                </div>
                <em>{{ selectedRoleAlbumItems.length }} 张</em>
              </div>
              <p v-if="!selectedRoleAlbumItems.length" class="image-gallery-empty">这个角色还没有保存图片。以后生成的人物形象会自动进入这里。</p>
              <div v-else class="album-grid role-album-grid">
                <article v-for="item in selectedRoleAlbumItems" :key="item.id" class="image-job-card completed">
                  <button type="button" class="album-image-button" @click="openGalleryPreview(item)" :aria-label="'放大查看' + item.archive.title">
                    <img v-local-image="{ src: item.imageUrl, thumbnail: true }" :src="item.imageUrl" :alt="item.archive.title" loading="lazy" />
                    <span>点击查看大图</span>
                  </button>
                  <div class="image-job-copy">
                    <div><b>{{ item.archive.title }}</b><time>{{ formatSummaryTime(item.archive.capturedAt || item.updatedAt) }}</time></div>
                    <p>{{ item.albumTypeLabel }}</p>
                    <p class="album-summary">{{ item.archive.appearance || item.archive.personality || item.prompt || '图片保存在当前设备。' }}</p>
                    <button type="button" class="album-delete-button" @click.stop="deleteAlbumImage(item)" :disabled="imageDeletingId === item.id">
                      {{ imageDeletingId === item.id ? '正在删除…' : '删除这张图片' }}
                    </button>
                  </div>
                </article>
              </div>
            </section>
            <section v-else-if="motionDisplayEnabled" class="role-detail-pane visual-library-pane">
              <div class="visual-library-intro">
                <div>
                  <b>固定表情图库＋AI 动作驱动</b>
                  <small>每条对话会携带情绪与动作标签，自动选择最接近的本地图片并淡入切换。生成图和上传图均保存在当前设备 IndexedDB。</small>
                </div>
                <label class="visual-enable-switch">
                  <input v-model="selectedRole.visualEnabled" type="checkbox" />
                  <span>对话中启用</span>
                </label>
              </div>
              <section class="visual-base-card" :class="{ ready: selectedRoleVisualBaseUrl }">
                <div class="visual-base-preview">
                  <img v-if="selectedRoleVisualBaseUrl" v-local-image="selectedRoleVisualBaseUrl" :src="selectedRoleVisualBaseUrl" :alt="selectedRole.name + '的动作基底图'" />
                  <span v-else>基底图</span>
                </div>
                <div class="visual-base-copy">
                  <b>{{ selectedRoleVisualBaseUrl ? '角色基底图已确认' : '请先设置角色基底图' }}</b>
                  <p>后续每张动作图都会直接引用这一张做图生图，不会以上一张动作图继续生成，避免形象逐步漂移。</p>
                  <div>
                    <button type="button" @click="useAvatarAsVisualBase" :disabled="!selectedRole.avatarUrl">使用当前头像</button>
                    <label class="visual-upload-button">
                      导入基底图
                      <input type="file" accept="image/*" @change="uploadVisualBaseImage" />
                    </label>
                    <button type="button" @click="roleDetailTab = 'image'">去生成基础形象</button>
                    <button type="button" @click="clearVisualBaseImage" :disabled="!selectedRoleVisualBaseUrl">清除</button>
                  </div>
                </div>
              </section>
              <div class="visual-batch-toolbar">
                <button type="button" @click="selectVisualStates('missing')">选择缺图</button>
                <button type="button" @click="selectVisualStates('all')">全选</button>
                <button type="button" @click="selectVisualStates('none')">清空</button>
                <button type="button" class="visual-batch-primary" @click="generateSelectedVisualStates" :disabled="visualBatchSubmitting || imageMode !== 'configured' || !selectedVisualGenerateCount || !selectedRoleVisualBaseUrl">
                  {{ visualBatchSubmitting ? '正在加入队列…' : '批量生成 ' + selectedVisualGenerateCount + ' 张' }}
                </button>
              </div>
              <p class="visual-batch-note">后台最多同时生成 6 张，超出的任务自动排队。可继续聊天；若完全关闭 HTML，正在请求的任务会中断，尚未开始的排队任务下次打开会继续。</p>
              <div class="visual-state-grid">
                <article
                  v-for="state in selectedRoleVisualStates"
                  :key="state.id"
                  class="visual-state-card"
                  :class="{ active: visualStateEditorId === state.id, ready: visualStateImage(state) }"
                  @click="visualStateEditorId = state.id"
                >
                  <label class="visual-state-check" @click.stop>
                    <input v-model="state.selected" type="checkbox" />
                  </label>
                  <div class="visual-state-preview">
                    <button
                      v-if="visualStateImage(state)"
                      type="button"
                      class="visual-state-preview-button"
                      @click.stop="openVisualStatePreview(state)"
                      :aria-label="'预览' + selectedRole.name + '的' + state.name + '动作图'"
                    >
                      <img v-local-image="visualStateImage(state)" :src="visualStateImage(state)" :alt="selectedRole.name + state.name" />
                    </button>
                    <span v-else class="visual-state-empty">未生成</span>
                    <em v-if="visualStateJob(state)">{{ visualStateJob(state).status === 'running' ? '生成中' : '排队中' }}</em>
                  </div>
                  <b>{{ state.name }}</b>
                  <small>{{ state.emotion }} · {{ state.action }}</small>
                </article>
              </div>
              <section v-if="selectedVisualState" class="visual-state-editor">
                <div class="visual-state-editor-title">
                  <div><b>{{ selectedVisualState.name }}</b><small>{{ selectedVisualState.custom ? '自定义状态' : '默认状态，可修改名称、提示词与图片' }}</small></div>
                  <button v-if="selectedVisualState.custom" type="button" @click="removeSelectedVisualState">删除</button>
                </div>
                <div class="visual-editor-fields">
                  <label>名称<input v-model.trim="selectedVisualState.name" maxlength="20" /></label>
                  <label>情绪
                    <select v-model="selectedVisualState.emotion">
                      <option v-for="emotion in visualEmotionOptions" :key="emotion">{{ emotion }}</option>
                    </select>
                  </label>
                  <label>动作
                    <select v-model="selectedVisualState.action">
                      <option v-for="action in visualActionOptions" :key="action">{{ action }}</option>
                    </select>
                  </label>
                </div>
                <label class="field-label">动作生图提示词
                  <textarea v-model.trim="selectedVisualState.prompt" rows="4" maxlength="500" placeholder="只描述这一张的表情、动作和构图；稳定外观会自动合并。"></textarea>
                </label>
                <div class="visual-final-prompt-heading">
                  <span>最终图生图提示词（每张独立保存，可继续修改）</span>
                  <button type="button" @click="refreshSelectedVisualFinalPrompt">按动作重新合成</button>
                </div>
                <label class="field-label visual-final-prompt">
                  <textarea v-model="selectedVisualState.finalPrompt" rows="7" maxlength="1200" placeholder="点击“按动作重新合成”，或直接填写最终发送给图片编辑接口的完整提示词。"></textarea>
                </label>
                <div class="visual-editor-actions">
                  <label class="visual-upload-button">
                    导入本地图片
                    <input type="file" accept="image/*" @change="uploadVisualStateImage($event, selectedVisualState)" />
                  </label>
                  <button type="button" @click="clearVisualStateImage(selectedVisualState)" :disabled="!visualStateImage(selectedVisualState)">移除图片</button>
                  <button type="button" class="visual-generate-one" @click="generateVisualState(selectedVisualState)" :disabled="imageMode !== 'configured' || !selectedRoleVisualBaseUrl || Boolean(visualStateJob(selectedVisualState))">基于基底图生成 / 重生成</button>
                </div>
              </section>
              <div class="visual-library-footer">
                <button type="button" @click="addCustomVisualState">＋ 新增表情或动作</button>
                <button type="button" class="save-profile" @click="saveVisualLibrary">保存动作图库</button>
              </div>
            </section>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="portraitPreviewOpen && selectedRole && selectedRole.avatarUrl" class="portrait-preview-backdrop" @click="portraitPreviewOpen = false">
          <button type="button" class="portrait-preview-close" @click="portraitPreviewOpen = false" aria-label="关闭头像大图">×</button>
          <img v-local-image="selectedRole.avatarUrl" :src="selectedRole.avatarUrl" :alt="selectedRole.name + '的人物形象大图'" />
        </div>
      </transition>

      <transition name="fade">
        <div v-if="visualStatePreview && visualStatePreview.imageUrl" class="portrait-preview-backdrop visual-state-image-preview" @click="closeVisualStatePreview">
          <button type="button" class="portrait-preview-close" @click="closeVisualStatePreview" aria-label="关闭动作图片预览">×</button>
          <figure @click.stop>
            <img v-local-image="visualStatePreview.imageUrl" :src="visualStatePreview.imageUrl" :alt="visualStatePreview.roleName + '的' + visualStatePreview.stateName + '动作大图'" />
            <figcaption>{{ visualStatePreview.roleName }} · {{ visualStatePreview.stateName }}</figcaption>
          </figure>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="imagePreviewJob && imagePreviewJob.imageUrl" class="album-preview-backdrop" @click.self="closeGalleryPreview">
          <section class="album-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="album-preview-title" @click.stop>
            <button type="button" class="portrait-preview-close" @click="closeGalleryPreview" aria-label="关闭图片预览">×</button>
            <div class="album-preview-image">
              <span v-if="imagePreviewLoading" class="album-preview-loading">正在读取本地图片…</span>
              <img
                v-else-if="imagePreviewSrc"
                v-local-image="imagePreviewSrc"
                :src="imagePreviewSrc"
                :alt="imagePreviewJob.archive?.title || imagePreviewJob.targetName || '生成图片大图'"
                @error="handleGalleryPreviewError"
              />
              <div v-else class="album-preview-error">
                <b>图片预览加载失败</b>
                <p>{{ imagePreviewError || '无法读取这张本地图片。' }}</p>
                <button type="button" @click="retryGalleryPreview">重新读取</button>
              </div>
            </div>
            <article class="album-preview-copy">
              <div class="eyebrow">{{ imagePreviewJob.kind === 'character' ? 'CHARACTER ARCHIVE' : 'SCENE ARCHIVE' }}</div>
              <h2 id="album-preview-title">{{ imagePreviewJob.archive?.title || imagePreviewJob.targetName || '图片档案' }}</h2>
              <time>{{ formatSummaryTime(imagePreviewJob.archive?.capturedAt || imagePreviewJob.updatedAt) }}</time>
              <template v-if="isCharacterAlbumItem(imagePreviewJob)">
                <div class="album-detail-tags">
                  <span v-if="imagePreviewJob.archive?.age">{{ imagePreviewJob.archive.age }} 岁</span>
                  <span v-if="imagePreviewJob.archive?.relation">{{ imagePreviewJob.archive.relation }}</span>
                  <span v-if="imagePreviewJob.archive?.personality">{{ imagePreviewJob.archive.personality }}</span>
                </div>
                <section v-if="imagePreviewJob.archive?.introduction"><b>人物介绍</b><p>{{ imagePreviewJob.archive.introduction }}</p></section>
                <section v-if="imagePreviewJob.archive?.appearance"><b>外观档案</b><p>{{ imagePreviewJob.archive.appearance }}</p></section>
              </template>
              <template v-else>
                <div v-if="imagePreviewJob.archive?.participants?.length" class="album-detail-tags">
                  <span v-for="name in imagePreviewJob.archive.participants" :key="name">{{ name }}</span>
                </div>
                <section v-if="imagePreviewJob.archive?.scene"><b>时间与场景</b><p>{{ imagePreviewJob.archive.scene }}</p></section>
                <section v-if="imagePreviewJob.archive?.eventSummary"><b>当时事件</b><p>{{ imagePreviewJob.archive.eventSummary }}</p></section>
                <details v-if="imagePreviewJob.archive?.contextSnapshot">
                  <summary>查看生成时的剧情快照</summary>
                  <p>{{ imagePreviewJob.archive.contextSnapshot }}</p>
                </details>
              </template>
              <details v-if="imagePreviewJob.prompt">
                <summary>查看最终生图提示词</summary>
                <p>{{ imagePreviewJob.prompt }}</p>
              </details>
              <p v-if="imagePreviewJob.archive?.summaryError" class="album-summary-error">AI 档案整理失败：{{ imagePreviewJob.archive.summaryError }}</p>
              <small>{{ imagePreviewJob.model || '本地图片' }} · {{ imagePreviewJob.size || '原始尺寸' }}<template v-if="imagePreviewJob.archive?.summaryGenerated"> · 档案由 {{ imagePreviewJob.archive.summaryModel }} 生成</template><template v-if="imagePreviewJob.rewritten"> · 提示词曾自动调整</template></small>
              <button v-if="imagePreviewJob.deletable !== false" type="button" class="album-delete-button preview-delete-button" @click="deleteAlbumImage(imagePreviewJob)" :disabled="imageDeletingId === imagePreviewJob.id">
                {{ imageDeletingId === imagePreviewJob.id ? '正在删除…' : '从相册删除这张图片' }}
              </button>
            </article>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
          <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button class="modal-close" @click="settingsOpen = false" aria-label="关闭">×</button>
            <div class="eyebrow">CUSTOMIZE HER</div>
            <h2 id="settings-title">她们会怎样陪你？</h2>
            <p class="settings-intro">主角色与多人场景设定会写入每次对话。模型会根据地点和剧情决定谁入场、发言或离开。</p>

            <label class="field-label">名字<input v-model.trim="profile.name" maxlength="8" /></label>
            <label class="field-label">性别
              <select v-model="profile.gender"><option>女性</option><option>男性</option><option>非二元</option><option>未指定</option></select>
            </label>
            <div class="derived-role-state"><b>AI 派生年龄与性格</b><span>{{ roleDerivedSummary(profile) }}</span><small>{{ roleDerivedDetail(profile) }}</small></div>
            <label class="field-label">相处关系
              <select v-model="profile.relation"><option>妻子</option><option>成年恋人</option><option>妹妹</option><option>默契搭子</option><option>知心朋友</option></select>
            </label>

            <section class="ensemble-settings">
              <label class="ensemble-switch">
                <span><b>多人场景</b><small>根据情景自动安排配角入场</small></span>
                <input v-model="ensemble.enabled" type="checkbox" />
                <i aria-hidden="true"></i>
              </label>
              <template v-if="ensemble.enabled">
                <div class="ensemble-heading"><b>固定配角 · {{ ensemble.friend.name }}</b><span>不会每轮强制出现</span></div>
                <label class="field-label ensemble-threshold">每轮最多参与 <b>{{ ensemble.maxTurns }} 位角色</b>
                  <input v-model.number="ensemble.maxTurns" type="range" min="1" max="10" step="1" @change="saveEnsembleParticipantLimit" />
                  <small>限制不同角色人数；同一角色可以再次接话，本轮最多 {{ ensembleMessageLimit }} 条，按剧情需要使用，不强制用满。</small>
                </label>
                <div class="role-portrait-row">
                  <button type="button" class="role-portrait" @click="openRoleDetail('friend')" aria-label="查看小雨详情">
                    <img v-if="ensemble.friend.avatarUrl" v-local-image="{ src: ensemble.friend.avatarUrl, thumbnail: true }" :src="ensemble.friend.avatarUrl" alt="小雨的角色形象" />
                    <span v-else>{{ ensemble.friend.name.slice(0, 1) }}</span>
                  </button>
                  <div><b>{{ ensemble.friend.name }}的固定形象</b><small>生成前可查看并修改完整提示词</small></div>
                  <button type="button" @click="openRoleDetail('friend', 'image')">
                    查看 / 生成
                  </button>
                </div>
                <div class="ensemble-fields">
                  <label class="field-label">名字<input v-model.trim="ensemble.friend.name" maxlength="12" /></label>
                  <div class="derived-role-state"><b>AI 派生年龄与性格</b><span>{{ roleDerivedSummary(ensemble.friend) }}</span><small>{{ roleDerivedDetail(ensemble.friend) }}</small></div>
                </div>
                <label class="field-label">性别
                  <select v-model="ensemble.friend.gender"><option>女性</option><option>男性</option><option>非二元</option><option>未指定</option></select>
                </label>
                <label class="field-label">与主角色关系<input v-model.trim="ensemble.friend.relation" maxlength="40" placeholder="例如：晚晚的成年闺蜜" /></label>
                <label class="field-label">人物形象设定
                  <textarea v-model.trim="ensemble.friend.appearance" maxlength="2000" rows="3" placeholder="发型、五官、体态、穿搭、配饰等可长期保持的外观…"></textarea>
                </label>
                <label class="field-label">小雨的专属提示词
                  <textarea v-model.trim="ensemble.friend.prompt" maxlength="2000" rows="3" placeholder="设置她的说话方式、行为习惯、遇到不同场景时怎样行动…"></textarea>
                </label>

                <div class="role-library-heading">
                  <div><b>自定义角色库</b><small>最多再创建 30 个角色 · 修改后自动同步</small></div>
                  <button type="button" @click="addCustomRole" :disabled="ensemble.customRoles.length >= 30">＋ 新建角色</button>
                </div>
                <article v-for="(role, index) in ensemble.customRoles" :key="role.id" class="custom-role-card">
                  <div class="custom-role-title"><b>角色 {{ index + 1 }}</b><button type="button" @click="removeCustomRole(index)">删除</button></div>
                  <div class="role-portrait-row compact">
                    <button type="button" class="role-portrait" @click="openRoleDetail(role.id)" :aria-label="'查看' + role.name + '详情'">
                      <img v-if="role.avatarUrl" v-local-image="{ src: role.avatarUrl, thumbnail: true }" :src="role.avatarUrl" :alt="role.name + '的角色形象'" />
                      <span v-else>{{ role.name.slice(0, 1) }}</span>
                    </button>
                    <div><b>{{ role.name }}</b><small>固定角色形象</small></div>
                    <button type="button" @click="openRoleDetail(role.id, 'image')">
                      查看 / 生成
                    </button>
                  </div>
                  <div class="ensemble-fields">
                    <label class="field-label">名字<input v-model.trim="role.name" maxlength="12" /></label>
                    <div class="derived-role-state"><b>AI 派生年龄与性格</b><span>{{ roleDerivedSummary(role) }}</span><small>{{ roleDerivedDetail(role) }}</small></div>
                  </div>
                  <label class="field-label">性别
                    <select v-model="role.gender"><option>女性</option><option>男性</option><option>非二元</option><option>未指定</option></select>
                  </label>
                  <label class="field-label">与主角色/用户的关系<input v-model.trim="role.relation" maxlength="40" placeholder="例如：共同好友、同事、邻居" /></label>
                  <label class="field-label">人物形象设定
                    <textarea v-model.trim="role.appearance" maxlength="2000" rows="3" placeholder="发型、五官、体态、穿搭和配饰等稳定特征…"></textarea>
                  </label>
                  <label class="field-label">角色专属提示词
                    <textarea v-model.trim="role.prompt" maxlength="2000" rows="3" placeholder="设置说话方式、背景、行为习惯和场景触发规则…"></textarea>
                  </label>
                </article>
                <label class="auto-guest-option">
                  <input v-model="ensemble.autoGuests" type="checkbox" />
                  <span><b>允许场景临时角色</b><small>聚会、商店、医院、出行等场合可自动加入合理的成年配角</small></span>
                </label>
              </template>
            </section>
            <button class="edit-prompt-link" @click="openPrompt">编辑系统提示词</button>
            <button class="save-profile" @click="saveProfile">保存设定，继续聊天</button>
            <p class="boundary-note">{{ standaloneMode ? '默认艾尔德兰档案为纯粹兄妹亲情，没有恋爱线。' : '成人模式允许暧昧、撒娇与亲密互动，但不涉及未成年人、强迫或高风险行为。' }}</p>
          </section>
        </div>
      </transition>

      <transition name="toast"><div v-if="toast" class="toast-message">{{ toast }}</div></transition>
    </div>
  `,
  data() {
    return {
      mobileTab: "chat",
      directApiMode: Boolean(window.__NIGHT_MAILBOX_MOBILE__),
      standaloneMode: Boolean(window.__NIGHT_MAILBOX_STANDALONE__),
      motionDisplayEnabled: false,
      scenarioApplying: false,
      settingsOpen: false,
      roleDetailOpen: false,
      roleDetailTargetId: "",
      roleDetailTab: "profile",
      visualStateEditorId: "",
      visualBatchSubmitting: false,
      visualStatePreview: null,
      visualEmotionOptions: ROLE_VISUAL_EMOTIONS,
      visualActionOptions: ROLE_VISUAL_ACTIONS,
      backgroundComposerOpen: false,
      backgroundPromptPreparing: false,
      backgroundGenerating: false,
      stageBackground: {
        prompt: "",
        imageUrl: "",
        imageJobId: "",
      },
      stageSpeaker: "",
      stageRoleId: "",
      stageStateId: "",
      stageEmotion: "neutral",
      stageAction: "idle",
      stageIntensity: 0.45,
      stageMotionNonce: 0,
      stageLayers: [{ url: "" }, { url: "" }],
      stageActiveLayer: 0,
      stageTransitionTimer: null,
      preloadedVisualUrls: [],
      portraitPreviewOpen: false,
      sending: false,
      draft: "",
      editingMessageId: null,
      editingMessageContent: "",
      toast: "",
      toastTimer: null,
      apiMode: "demo",
      chatProvider: "deepseek",
      deepseekModel: "deepseek-v4-flash",
      grokMode: "disabled",
      grokModel: "claude-haiku-4-5-20251001",
      availableChatModels: ["claude-haiku-4-5-20251001", "grok-4.5"],
      chatModelsLoading: false,
      chatModelPreferenceLoaded: false,
      modelConnectionWarning: "",
      imageMode: "disabled",
      imageModel: "gpt-image-2",
      availableImageModels: ["gpt-image-2"],
      imageModelsLoading: false,
      imageModelPreferenceLoaded: false,
      imageEnabled: false,
      imageGenerating: false,
      imagePromptPreparing: false,
      imagePrompt: "",
      imageQuality: "standard",
      characterPromptOpen: false,
      characterPromptPreparing: false,
      characterPromptFallback: false,
      characterGenerating: false,
      roleProfileGenerating: false,
      roleProfileGenerationIds: [],
      characterPrompt: "",
      characterTargetId: "",
      imageJobs: [],
      activeImageJobs: [],
      galleryTab: "scene",
      galleryDisplayLimit: 18,
      imagePreviewJob: null,
      imagePreviewSrc: "",
      imagePreviewLoading: false,
      imagePreviewError: "",
      imageDeletingId: "",
      imageJobPollTimer: null,
      notifiedImageJobIds: [],
      promptSaving: false,
      promptSection: "",
      worldSetting: "",
      worldSeed: "",
      worldGenerating: false,
      randomRoleEnabled: true,
      randomRoleInterval: 18,
      nextGuestAt: 18,
      summarySaving: false,
      summarizing: false,
      storySummary: "",
      roleMemories: {},
      autoCompress: true,
      autoCompressThreshold: 40,
      summaryUpdatedAt: "",
      settingsReady: false,
      roleAutoSaveTimer: null,
      storyAutoSaveTimer: null,
      settingsSyncTimer: null,
      backupBusy: "",
      backupStatus: "",
      assetStorage: null,
      historyStorage: null,
      memoryStorage: null,
      historyRetentionDays: 90,
      historyListOpen: false,
      pendingBackup: null,
      pendingBackupMeta: null,
      appShellMode: Boolean(window.__NIGHT_MAILBOX_APP_SHELL__),
      mobileMenuOpen: false,
      errorLogs: [],
      errorLogFilter: "all",
      globalErrorHandler: null,
      rejectionErrorHandler: null,
      systemPrompt: "",
      defaultSystemPrompt: "",
      promptVariableHelp: "{{name}}、{{age}}、{{personality}}、{{relation}}",
      suggestionsLoading: false,
      suggestionRequestId: 0,
      suggestionRefreshTimer: null,
      stageSequenceTimers: [],
      chatRequestId: 0,
      ensemblePlaybackToken: 0,
      ensemblePlaying: false,
      lastReplyStartId: null,
      storyClock: normalizeStoryClock({ day: 12, segment: "evening" }),
      storyEvents: [],
      storyTimeSegments: STORY_TIME_SEGMENTS,
      timeSheetOpen: false,
      eventEditorOpen: false,
      editingStoryEventId: "",
      eventParticipantText: "",
      eventDraft: normalizeStoryEvent({
        id: "story-event-draft",
        title: "",
        day: 12,
        segment: "morning",
        status: "confirmed",
      }),
      timeJumpOpen: false,
      timeJumpDays: 1,
      timeJumpSegment: "dawn",
      timeJumpKeepOverdue: true,
      timeJumpAddTransition: true,
      dayCount: 12,
      profile: {
        name: "晚晚",
        age: 24,
        gender: "女性",
        personality: "娇小可爱",
        relation: "妻子",
        prompt: "",
        appearance: "",
        imagePrompt: "",
        avatarUrl: "",
      },
      ensemble: {
        enabled: true,
        autoGuests: true,
        maxTurns: 3,
        friend: {
          name: "小雨",
          age: 25,
          gender: "女性",
          personality: "活泼直率、会照顾气氛",
          relation: "晚晚的成年闺蜜",
          prompt: "说话爽快自然，善于活跃气氛，也会认真照顾朋友的感受。被安排外出办事时，会在合理场景中独立行动并及时回应用户。",
          appearance: "成年女性，清爽自然、亲切有活力；具体发型、五官和穿搭可在生成前继续编辑。",
          imagePrompt: "",
          avatarUrl: "",
        },
        customRoles: [],
        temporaryRoles: [],
      },
      personalities: [
        { name: "娇小可爱", icon: "♡", copy: "软萌俏皮" },
        { name: "俏皮", icon: "✦", copy: "轻松有趣" },
        { name: "理性", icon: "◇", copy: "清醒可靠" },
        { name: "治愈", icon: "☾", copy: "安静倾听" },
      ],
      suggestions: ["我牵住她的手，立刻开始行动", "按刚才的计划，我们现在就出发", "联系相关角色，让新消息进入现场"],
      messageDisplayLimit: 40,
      messageDisplayBatch: 30,
      messages: [
        { id: 1, role: "assistant", content: "【场景：家中客厅 · 雨夜】\n（晚晚抱着靠枕坐在沙发上，听见门响便抬起脸，笑着朝你招了招手。）\n\n回来啦，老公。你比平时晚了一点，是今天有很多事要忙吗？", time: "22:08" },
        { id: 2, role: "user", content: "刚忙完，回来的路上下雨了。", time: "22:09" },
        { id: 3, role: "assistant", content: "【场景：家中客厅 · 窗外下着雨】\n（晚晚踩着柔软的拖鞋走近，接过你微湿的外套挂好，又把温热的杯子轻轻推到你手边。）\n\n那一定有点凉。先喝口热的吧。你愿意的话，可以把今天最累的那一小段交给我。", time: "22:09" },
      ],
      tasks: [
        { id: 1, title: "互道一声早安", detail: "完成今天的第一次问候", points: 10, icon: "☀", done: true },
        { id: 2, title: "分享此刻心情", detail: "用一句话告诉她今天怎样", points: 15, icon: "♡", done: false },
        { id: 3, title: "走一段放松的路", detail: "离开屏幕，散步 10 分钟", points: 20, icon: "↝", done: false },
        { id: 4, title: "认真说一句晚安", detail: "用一句话结束今天的故事", points: 25, icon: "☾", done: false },
      ],
    };
  },
  computed: {
      defaultAvatarUrl() {
        return window.__NIGHT_MAILBOX_DEFAULT_AVATAR__
          || (window.__NIGHT_MAILBOX_MOBILE__ ? "./og.png" : "/og.png");
      },
    ensembleMessageLimit() {
      return maxEnsembleMessages(this.ensemble.maxTurns);
    },
    storyMomentLabel() {
      return formatStoryMoment(this.storyClock);
    },
    storySegmentLabel() {
      return storySegmentLabel(this.storyClock.segment);
    },
    activeScheduleEvents() {
      return normalizeStoryEvents(this.storyEvents)
        .filter((event) => ["pending-confirmation", "confirmed", "accepted"].includes(event.status));
    },
    pendingConfirmationEvents() {
      return this.activeScheduleEvents.filter((event) => event.status === "pending-confirmation");
    },
    dueReminderEvent() {
      return dueStoryEvents(this.storyEvents, this.storyClock)[0] || null;
    },
    upcomingStoryEvents() {
      const current = storyMomentValue(this.storyClock.day, this.storyClock.segment);
      return this.activeScheduleEvents
        .filter((event) =>
          event.day === null
          || storyMomentValue(event.day, event.segment) >= current
          || event.status === "accepted"
        )
        .slice(0, 30);
    },
    timeJumpTargetDay() {
      return Math.min(99999, this.storyClock.day + Math.max(0, Number(this.timeJumpDays) || 0));
    },
    timeJumpAffectedEvents() {
      const current = storyMomentValue(this.storyClock.day, this.storyClock.segment);
      const target = storyMomentValue(this.timeJumpTargetDay, this.timeJumpSegment);
      return this.activeScheduleEvents.filter((event) =>
        event.day !== null
        && storyMomentValue(event.day, event.segment) > current
        && storyMomentValue(event.day, event.segment) < target
      );
    },
    roleMemoryCount() {
      return Object.keys(this.roleMemories || {}).length;
    },
    displayedMessages() {
      const limit = Math.max(1, Number(this.messageDisplayLimit) || 40);
      return this.messages.slice(-limit);
    },
    hiddenEarlierMessageCount() {
      return Math.max(0, this.messages.length - this.displayedMessages.length);
    },
    filteredErrorLogs() {
      const filter = this.errorLogFilter;
      if (!filter || filter === "all") return this.errorLogs;
      const patterns = {
        image: /图片|生图|image/i,
        migration: /迁移|migration/i,
        backup: /备份|导入|导出|backup/i,
        chat: /对话|模型|deepseek|grok|chat/i,
        storage: /存储|文件|indexeddb|storage/i,
      };
      const pattern = patterns[filter];
      return pattern
        ? this.errorLogs.filter((entry) => pattern.test(`${entry.source || ""} ${entry.message || ""}`))
        : this.errorLogs;
    },
    selectedRoleMemory() {
      return this.roleMemories?.[this.roleDetailTargetId] || null;
    },
    historyRecentGroups() {
      const groups = new Map();
      for (const message of this.historyStorage?.messages || []) {
        const label = `剧情第 ${Math.max(1, Number(message.storyDay) || 1)} 天`;
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(message);
      }
      return [...groups.entries()]
        .slice(0, 12)
        .map(([label, messages]) => ({ label, messages: messages.slice(0, 20) }));
    },
    visibleImageJobs() {
      return this.imageJobs.filter((job) =>
        job
        && job.status !== "failed"
        && (
          job.status === "queued"
          || job.status === "running"
          || (job.status === "completed" && job.imageUrl)
        )
      );
    },
    sceneImageJobs() {
      return this.visibleImageJobs.filter((job) => ["scene", "stage-background"].includes(job.kind));
    },
    characterImageJobs() {
      return this.visibleImageJobs.filter((job) => ["character", "visual-state"].includes(job.kind));
    },
    galleryJobs() {
      return this.galleryTab === "character" ? this.characterImageJobs : this.sceneImageJobs;
    },
    displayedGalleryJobs() {
      return this.galleryJobs.slice(0, this.galleryDisplayLimit);
    },
    compressibleMessageCount() {
      return this.messages.filter((message) =>
        !message.typing
        && (message.role === "user" || message.role === "assistant")
        && typeof message.content === "string"
        && message.content.trim()
      ).length;
    },
    activeCharacterRole() {
      if (this.characterTargetId === "primary") return this.profile;
      if (this.characterTargetId === "friend") return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.id === this.characterTargetId)
        || this.ensemble.temporaryRoles.find((role) => role.id === this.characterTargetId)
        || null;
    },
    selectedRole() {
      if (this.roleDetailTargetId === "primary") return this.profile;
      if (this.roleDetailTargetId === "friend") return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.id === this.roleDetailTargetId)
        || this.ensemble.temporaryRoles.find((role) => role.id === this.roleDetailTargetId)
        || null;
    },
    selectedRoleIsTemporary() {
      return this.ensemble.temporaryRoles.some((role) => role.id === this.roleDetailTargetId);
    },
    selectedRoleVisualStates() {
      return Array.isArray(this.selectedRole?.visualStates) ? this.selectedRole.visualStates : [];
    },
    selectedRoleAlbumItems() {
      const role = this.selectedRole;
      const targetId = this.roleDetailTargetId;
      if (!role || !targetId) return [];
      const items = [];
      const seenUrls = new Set();
      const add = (item) => {
        const imageUrl = String(item?.imageUrl || "");
        if (!imageUrl || seenUrls.has(imageUrl)) return;
        seenUrls.add(imageUrl);
        items.push(item);
      };
      const states = Array.isArray(role.visualStates) ? role.visualStates : [];
      this.imageJobs
        .filter((job) =>
          job?.status === "completed"
          && job.imageUrl
          && ["character", "visual-state"].includes(job.kind)
          && (
            job.targetId === targetId
            || (!job.targetId && String(job.targetName || "").startsWith(role.name))
          )
        )
        .forEach((job) => {
          const state = states.find((item) =>
            item.imageJobId === job.id
            || (job.visualStateId && item.id === job.visualStateId)
          );
          add({
            ...job,
            albumSource: "job",
            visualStateId: job.visualStateId || state?.id || "",
            albumTypeLabel: job.kind === "visual-state"
              ? `动作图 · ${state?.name || job.archive?.stateName || "表情动作"}`
              : "人物形象",
            archive: {
              title: job.archive?.title
                || (job.kind === "visual-state"
                  ? `${role.name} · ${state?.name || "动作图"}`
                  : `${role.name}的人物形象`),
              name: role.name,
              age: role.age,
              relation: role.relation,
              personality: role.personality,
              introduction: role.prompt,
              appearance: role.appearance,
              capturedAt: job.updatedAt,
              ...(job.archive || {}),
            },
          });
        });
      states.forEach((state) => {
        const imageUrl = this.visualStateImage(state);
        add({
          id: `role-state-${targetId}-${state.id}`,
          kind: "visual-state",
          targetId,
          targetName: role.name,
          visualStateId: state.id,
          imageUrl,
          prompt: state.finalPrompt || state.prompt || "",
          albumSource: "role-state",
          albumTypeLabel: `动作图 · ${state.name}`,
          updatedAt: state.updatedAt || "",
          archive: {
            title: `${role.name} · ${state.name}`,
            name: role.name,
            age: role.age,
            relation: role.relation,
            personality: `${state.emotion || "自然"} · ${state.action || "自然动作"}`,
            introduction: role.prompt,
            appearance: role.appearance,
            capturedAt: state.updatedAt || "",
          },
        });
      });
      add({
        id: `role-avatar-${targetId}`,
        kind: "character",
        targetId,
        targetName: role.name,
        imageUrl: role.avatarUrl,
        prompt: role.imagePrompt || "",
        albumSource: "role-avatar",
        albumTypeLabel: "当前人物头像",
        updatedAt: "",
        archive: {
          title: `${role.name}的当前头像`,
          name: role.name,
          age: role.age,
          relation: role.relation,
          personality: role.personality,
          introduction: role.prompt,
          appearance: role.appearance,
        },
      });
      add({
        id: `role-base-${targetId}`,
        kind: "visual-state",
        targetId,
        targetName: role.name,
        imageUrl: role.visualBaseImageUrl,
        albumSource: "role-base",
        albumTypeLabel: "动作基底图",
        updatedAt: "",
        archive: {
          title: `${role.name}的动作基底图`,
          name: role.name,
          age: role.age,
          relation: role.relation,
          personality: role.personality,
          introduction: role.prompt,
          appearance: role.appearance,
        },
      });
      return items.sort((left, right) =>
        String(right.archive?.capturedAt || right.updatedAt || "")
          .localeCompare(String(left.archive?.capturedAt || left.updatedAt || ""))
      );
    },
    selectedRoleVisualBaseUrl() {
      const role = this.selectedRole;
      if (!role) return "";
      if (role.visualBaseSource === "upload" && role.visualBaseImageUrl) {
        return role.visualBaseImageUrl;
      }
      if (role.visualBaseImageJobId) {
        const job = this.imageJobs.find((item) =>
          item.id === role.visualBaseImageJobId
          && item.status === "completed"
          && item.imageUrl
        );
        if (job?.imageUrl) return job.imageUrl;
      }
      return role.visualBaseSource === "avatar" ? role.avatarUrl || "" : "";
    },
    selectedVisualState() {
      return this.selectedRoleVisualStates.find((state) => state.id === this.visualStateEditorId) || null;
    },
    selectedVisualGenerateCount() {
      return this.selectedRoleVisualStates.filter((state) =>
        state.enabled !== false && state.selected && !this.visualStateJob(state)
      ).length;
    },
    stageImageUrl() {
      return this.stageLayers[this.stageActiveLayer]?.url || "";
    },
    stageBackgroundJob() {
      if (!this.stageBackground.imageJobId) return null;
      return this.activeImageJobs.find((job) => job.id === this.stageBackground.imageJobId) || null;
    },
    stageBackgroundUrl() {
      if (this.stageBackground.imageUrl) return this.stageBackground.imageUrl;
      if (!this.stageBackground.imageJobId) return "";
      const job = this.imageJobs.find((item) =>
        item.id === this.stageBackground.imageJobId
        && item.status === "completed"
      );
      return job?.imageUrl || "";
    },
    stageStateLabel() {
      const role = this.roleById(this.stageRoleId);
      const state = Array.isArray(role?.visualStates)
        ? role.visualStates.find((item) => item.id === this.stageStateId)
        : null;
      return state?.name || "默认形象";
    },
    stageEmotionLabel() {
      return `情绪 · ${this.stageEmotion || "neutral"}`;
    },
    stageActionLabel() {
      return `动作 · ${this.stageAction || "idle"}`;
    },
    stageMotionClass() {
      if (this.stageIntensity >= 0.72) return "motion-active";
      if (this.stageIntensity <= 0.34) return "motion-calm";
      return "motion-natural";
    },
    selectedRoleImageJob() {
      return this.activeImageJobs.find((job) =>
        job.kind === "character" && job.targetId === this.roleDetailTargetId
      ) || null;
    },
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
  watch: {
    ensemble: {
      deep: true,
      handler() {
        if (!this.settingsReady) return;
        window.clearTimeout(this.roleAutoSaveTimer);
        this.roleAutoSaveTimer = window.setTimeout(() => {
          this.persist();
          this.saveSettings().catch(() => this.showToast("角色资料自动同步失败"));
        }, 900);
      },
    },
    storyClock: {
      deep: true,
      handler() {
        if (!this.settingsReady) return;
        window.clearTimeout(this.storyAutoSaveTimer);
        this.storyAutoSaveTimer = window.setTimeout(() => {
          this.dayCount = this.storyClock.day;
          this.persist();
          this.saveSettings().catch(() => this.showToast("剧情时间自动保存失败"));
        }, 500);
      },
    },
    storyEvents: {
      deep: true,
      handler() {
        if (!this.settingsReady) return;
        window.clearTimeout(this.storyAutoSaveTimer);
        this.storyAutoSaveTimer = window.setTimeout(() => {
          this.persist();
          this.saveSettings().catch(() => this.showToast("日程自动保存失败"));
        }, 500);
      },
    },
  },
  async mounted() {
    this.loadErrorLogs();
    this.globalErrorHandler = (event) => {
      this.recordError("页面运行", event?.error || event?.message || "未知脚本错误", {
        file: event?.filename,
        line: event?.lineno,
        column: event?.colno,
      });
    };
    this.rejectionErrorHandler = (event) => {
      this.recordError("异步任务", event?.reason || "未处理的异步错误");
    };
    window.addEventListener("error", this.globalErrorHandler);
    window.addEventListener("unhandledrejection", this.rejectionErrorHandler);
    let localMessages = [];
    try {
      const saved = JSON.parse(localStorage.getItem("night-mailbox-state") || "null");
      if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
      if (saved?.ensemble) this.applyEnsemble(saved.ensemble);
      if (saved?.chatProvider === "grok") this.chatProvider = "grok";
      if (typeof saved?.grokModel === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(saved.grokModel)) {
        this.grokModel = saved.grokModel;
        this.chatModelPreferenceLoaded = true;
      }
      if (typeof saved?.imageModel === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(saved.imageModel)) {
        this.imageModel = saved.imageModel;
        this.imageModelPreferenceLoaded = true;
      }
      if (Array.isArray(saved?.suggestions) && saved.suggestions.length === 3) {
        this.suggestions = saved.suggestions.filter((item) => typeof item === "string").slice(0, 3);
      }
      this.nextGuestAt = Math.max(8, Number(saved?.nextGuestAt) || this.nextGuestAt);
      this.imageEnabled = saved?.imageEnabled === true;
      this.imageQuality = "standard";
      if (typeof saved?.imagePrompt === "string") this.imagePrompt = saved.imagePrompt.slice(0, 1200);
      if (saved?.storyClock) this.storyClock = normalizeStoryClock(saved.storyClock);
      if (Array.isArray(saved?.storyEvents)) this.storyEvents = normalizeStoryEvents(saved.storyEvents);
      if (this.profile.relation === "成年恋人") this.profile.relation = "妻子";
      if (saved?.tasks) {
        this.tasks = saved.tasks.map((task) => task.id === 4
          ? { ...task, title: "认真说一句晚安", detail: "用一句话结束今天的故事", icon: "☾" }
          : task);
      }
      if (Array.isArray(saved?.messages)) {
        const restoredMessages = saved.messages
          .filter((message) =>
            (message?.role === "user" || message?.role === "assistant")
            && typeof message?.content === "string"
            && message.content.trim()
          )
          .slice(-120)
          .map((message, index) => ({
            id: Number.isFinite(message.id) ? message.id : Date.now() + index,
            role: message.role,
            content: message.content,
            speaker: typeof message.speaker === "string" ? message.speaker : "",
            time: typeof message.time === "string" ? message.time : "",
            imageUrl: typeof message.imageUrl === "string" ? message.imageUrl : "",
            imageModel: typeof message.imageModel === "string" ? message.imageModel : "",
            imageQuality: typeof message.imageQuality === "string" ? message.imageQuality : "",
            mood: typeof message.mood === "string" ? message.mood : "",
            action: typeof message.action === "string" ? message.action : "",
            visual: message.visual && typeof message.visual === "object" ? message.visual : null,
          }));
        if (restoredMessages.length) this.messages = restoredMessages;
        localMessages = restoredMessages;
      }
    } catch {}
    try {
      const response = await fetch("/api/storage");
      if (!response.ok) throw new Error("storage unavailable");
      const saved = await response.json();
      if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
      if (saved?.ensemble) this.applyEnsemble(saved.ensemble);
      this.systemPrompt = typeof saved?.systemPrompt === "string" ? saved.systemPrompt : "";
      this.storySummary = typeof saved?.storySummary === "string" ? saved.storySummary : "";
      this.storyClock = normalizeStoryClock(saved?.storyClock || this.storyClock);
      this.storyEvents = normalizeStoryEvents(saved?.storyEvents || this.storyEvents);
      this.dayCount = this.storyClock.day;
      this.roleMemories = saved?.roleMemories && typeof saved.roleMemories === "object"
        ? saved.roleMemories
        : {};
      this.worldSetting = typeof saved?.worldSetting === "string" ? saved.worldSetting : "";
      this.autoCompress = saved?.autoCompress !== false;
      this.autoCompressThreshold = Math.min(120, Math.max(20, Number(saved?.autoCompressThreshold) || 40));
      this.randomRoleEnabled = saved?.randomRoleEnabled !== false;
      this.randomRoleInterval = Math.min(60, Math.max(8, Number(saved?.randomRoleInterval) || 18));
      if (saved?.stageBackground && typeof saved.stageBackground === "object") {
        this.stageBackground = {
          ...this.stageBackground,
          ...saved.stageBackground,
        };
      }
      this.summaryUpdatedAt = typeof saved?.summaryUpdatedAt === "string" ? saved.summaryUpdatedAt : "";
      this.defaultSystemPrompt = typeof saved?.defaultSystemPrompt === "string" ? saved.defaultSystemPrompt : "";
      if (Array.isArray(saved?.messages) && saved.messages.length) {
        this.messages = saved.messages;
      } else if (localMessages.length) {
        await this.saveHistory();
      }
    } catch {
      this.showToast("本地文件服务暂时不可用");
    }
    this.settingsReady = true;
    this.settingsSyncTimer = window.setInterval(() => this.syncSettingsFromServer(), 12000);
    fetch("/api/health").then((response) => response.json()).then(async (data) => {
      this.apiMode = data.chat === "configured" ? "live" : "demo";
      if (typeof data.deepseekModel === "string" && data.deepseekModel) {
        this.deepseekModel = data.deepseekModel;
      }
      this.grokMode = data.grok === "configured" ? "configured" : "disabled";
      if (!this.chatModelPreferenceLoaded && typeof data.grokModel === "string") {
        this.grokModel = data.grokModel;
      }
      if (this.chatProvider === "grok" && this.grokMode !== "configured") {
        this.chatProvider = "deepseek";
      }
      this.imageMode = data.image === "configured" ? "configured" : "disabled";
      if (!this.imageModelPreferenceLoaded && typeof data.imageModel === "string") {
        this.imageModel = data.imageModel;
      }
      await Promise.all([this.loadChatModels(), this.loadImageModels()]);
    }).catch((error) => this.recordError("接口健康检查", error));
    this.pollImageJobs();
    const latestAssistant = [...this.messages].reverse().find((message) => message.role === "assistant" && message.speaker)
      || { role: "assistant", speaker: this.profile.name, content: "" };
    this.applyStageCue(latestAssistant);
    this.scrollBottom();
  },
  beforeDestroy() {
    window.clearTimeout(this.roleAutoSaveTimer);
    window.clearTimeout(this.storyAutoSaveTimer);
    window.clearTimeout(this.stageTransitionTimer);
    window.clearTimeout(this.suggestionRefreshTimer);
    window.clearInterval(this.settingsSyncTimer);
    window.clearTimeout(this.imageJobPollTimer);
    window.removeEventListener("error", this.globalErrorHandler);
    window.removeEventListener("unhandledrejection", this.rejectionErrorHandler);
    this.clearStageVisualSequence();
    this.stopEnsemblePlayback();
  },
  methods: {
    sanitizeErrorText(value, maxLength = 8000) {
      return String(value || "")
        .replace(/\b(?:sk|key)-[a-zA-Z0-9_-]{8,}\b/gi, "[已隐藏密钥]")
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[已隐藏密钥]")
        .replace(/("(?:apiKey|token|key)"\s*:\s*")[^"]+(")/gi, "$1[已隐藏密钥]$2")
        .slice(0, Math.max(1000, Number(maxLength) || 8000));
    },
    loadErrorLogs() {
      try {
        const saved = JSON.parse(localStorage.getItem("night-mailbox-error-logs") || "[]");
        this.errorLogs = Array.isArray(saved) ? saved.slice(0, 100) : [];
      } catch {
        this.errorLogs = [];
      }
    },
    recordError(source, error, context = {}) {
      const message = this.sanitizeErrorText(error?.message || error || "未知错误");
      if (!message) return;
      const diagnostic = error?.diagnostic && typeof error.diagnostic === "object"
        ? error.diagnostic
        : null;
      const detail = this.sanitizeErrorText([
        error?.stack || "",
        diagnostic ? `返参诊断：\n${JSON.stringify(diagnostic, null, 2)}` : "",
        context && Object.keys(context).length ? `调用上下文：\n${JSON.stringify(context, null, 2)}` : "",
      ].filter(Boolean).join("\n\n"), 120000);
      const latest = this.errorLogs[0];
      if (latest?.source === source && latest?.message === message && Date.now() - latest.id < 2000) return;
      this.errorLogs.unshift({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        source: String(source || "应用").slice(0, 40),
        message,
        detail,
        page: this.mobileTab,
        provider: this.chatProvider,
        model: this.chatProvider === "grok" ? this.grokModel : this.deepseekModel,
        userAgent: navigator.userAgent.slice(0, 500),
      });
      this.errorLogs = this.errorLogs.slice(0, 100);
      try {
        localStorage.setItem("night-mailbox-error-logs", JSON.stringify(this.errorLogs));
      } catch {}
    },
    exportErrorLogs() {
      if (!this.errorLogs.length) return;
      const payload = {
        app: "夜航信箱",
        exportedAt: new Date().toISOString(),
        count: this.errorLogs.length,
        logs: this.errorLogs,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `夜航信箱-错误日志-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      this.showToast("错误日志已导出", false);
    },
    clearErrorLogs() {
      if (!this.errorLogs.length || !window.confirm("确认清除当前设备上的全部错误日志吗？")) return;
      this.errorLogs = [];
      localStorage.removeItem("night-mailbox-error-logs");
      this.showToast("错误日志已清除", false);
    },
    now() {
      return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    },
    roleById(roleId) {
      if (roleId === "primary") return this.profile;
      if (roleId === "friend") return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.id === roleId)
        || this.ensemble.temporaryRoles.find((role) => role.id === roleId)
        || null;
    },
    roleDerivedState(role) {
      return currentRoleDerivedState(role, this.storyClock.day);
    },
    roleDerivedSummary(role) {
      const state = this.roleDerivedState(role);
      const age = state.actualAge === null
        ? "年龄待 AI 提取"
        : state.apparentAge !== null && state.apparentAge !== state.actualAge
          ? `实际 ${state.actualAge} 岁 / 外表约 ${state.apparentAge} 岁`
          : `${state.actualAge} 岁`;
      return [age, state.corePersonality || "性格待 AI 提取"].filter(Boolean).join(" · ");
    },
    roleDerivedDetail(role) {
      const state = this.roleDerivedState(role);
      const ruleLabels = {
        normal: "随剧情每 365 天增长一岁",
        fixed: "实际年龄增长，外表年龄固定",
        "long-lived": "长生种：实际年龄增长，外表变化缓慢或固定",
        ageless: "年龄与外表均不随剧情时间变化",
        unknown: "等待 AI 从人物提示词判断成长规则",
      };
      return `${ruleLabels[state.agingRule] || ruleLabels.unknown}。修改人物提示词后保存，会由 AI 重新提取。`;
    },
    roleRecordByName(name) {
      if (!name || name === this.profile.name) return { id: "primary", role: this.profile };
      if (name === this.ensemble.friend.name) return { id: "friend", role: this.ensemble.friend };
      const role = this.ensemble.customRoles.find((item) => item.name === name)
        || this.ensemble.temporaryRoles.find((item) => item.name === name);
      return role ? { id: role.id, role } : null;
    },
    normalizeVisualLibrary(role) {
      if (!role) return [];
      const stored = Array.isArray(role.visualStates) ? role.visualStates : [];
      const byId = new Map(stored.map((state) => [String(state?.id || ""), state]));
      const defaults = createDefaultRoleVisualStates().map((state) => {
        const savedState = byId.get(state.id) || {};
        const oldAutomaticPrompt = !savedState.finalPromptVersion
          && /图片1是该角色唯一基底图|角色资料仅用于补充/.test(String(savedState.finalPrompt || ""));
        return {
          ...state,
          ...savedState,
          finalPrompt: oldAutomaticPrompt ? "" : String(savedState.finalPrompt || state.finalPrompt || ""),
          finalPromptVersion: oldAutomaticPrompt ? 2 : Number(savedState.finalPromptVersion || state.finalPromptVersion || 2),
          tags: Array.isArray(savedState.tags) ? savedState.tags : state.tags,
        };
      });
      const custom = stored
        .filter((state) => state?.custom && !DEFAULT_ROLE_VISUAL_STATES.some((item) => item.id === state.id))
        .map((state, index) => ({
          id: String(state.id || `custom-${Date.now()}-${index}`),
          name: String(state.name || `自定义动作${index + 1}`),
          emotion: String(state.emotion || "neutral"),
          action: String(state.action || "idle"),
          tags: Array.isArray(state.tags) ? state.tags : [],
          prompt: String(state.prompt || ""),
          finalPrompt: String(state.finalPrompt || ""),
          finalPromptVersion: Number(state.finalPromptVersion || 2),
          imageUrl: String(state.imageUrl || ""),
          imageJobId: String(state.imageJobId || ""),
          enabled: state.enabled !== false,
          selected: state.selected === true,
          custom: true,
        }));
      const states = [...defaults, ...custom];
      this.$set(role, "visualStates", states);
      if (typeof role.visualEnabled !== "boolean") this.$set(role, "visualEnabled", true);
      if (!role.visualDefaultStateId) this.$set(role, "visualDefaultStateId", "idle_neutral");
      if (!role.visualBaseSource) this.$set(role, "visualBaseSource", "");
      if (!role.visualBaseImageUrl) this.$set(role, "visualBaseImageUrl", "");
      if (!role.visualBaseImageJobId) this.$set(role, "visualBaseImageJobId", "");
      return states;
    },
    openRoleDetail(targetId, tab = "profile") {
      const role = targetId === "primary"
        ? this.profile
        : targetId === "friend"
        ? this.ensemble.friend
        : this.ensemble.customRoles.find((item) => item.id === targetId)
          || this.ensemble.temporaryRoles.find((item) => item.id === targetId);
      if (!role) return;
      this.settingsOpen = false;
      this.characterPromptOpen = false;
      this.roleDetailTargetId = targetId;
      this.roleDetailTab = ["image", "album"].includes(tab)
        ? tab
        : tab === "visual" && this.standaloneMode && this.motionDisplayEnabled
          ? "visual"
          : "profile";
      this.characterPromptFallback = false;
      this.roleDetailOpen = true;
      if (this.roleDetailTab === "visual") this.openVisualLibrary();
    },
    openVisualLibrary() {
      if (!this.motionDisplayEnabled || !this.standaloneMode || !this.selectedRole) return;
      const states = this.normalizeVisualLibrary(this.selectedRole);
      this.roleDetailTab = "visual";
      if (!states.some((state) => state.id === this.visualStateEditorId)) {
        this.visualStateEditorId = states[0]?.id || "";
      }
      this.preloadRoleVisuals(this.selectedRole);
    },
    openSpeakerDetail(name) {
      if (!name || name === this.profile.name) {
        this.openRoleDetail("primary");
        return;
      }
      if (name === this.ensemble.friend.name) {
        this.openRoleDetail("friend");
        return;
      }
      const role = this.ensemble.customRoles.find((item) => item.name === name);
      if (role) {
        this.openRoleDetail(role.id);
        return;
      }
      const firstRoleMessage = this.messages.find((item) =>
        item.role === "assistant" && item.speaker === name
      );
      const discovered = this.ensureTemporaryRoleFromMessage(firstRoleMessage || {
        role: "assistant",
        speaker: name,
        content: "",
      });
      if (!discovered?.role) return;
      if (discovered.created) this.autoGenerateTemporaryRoles([discovered.role.id]);
      this.openRoleDetail(discovered.role.id);
    },
    ensureTemporaryRoleFromMessage(message) {
      const name = String(message?.speaker || "").trim().slice(0, 20);
      if (
        !name
        || name === this.profile.name
        || ["用户", "系统", "旁白"].includes(name)
        || this.fixedRoleByName(name)
      ) {
        return null;
      }
      const existing = this.temporaryRoleByName(name);
      if (existing) return { role: existing, created: false };
      if (this.ensemble.temporaryRoles.length >= 80) return null;
      const firstAppearanceEvidence = String(message?.content || "")
        .replace(/\s+/g, " ")
        .slice(0, 700);
      const temporaryRole = {
        id: `temporary-${Date.now()}-${this.ensemble.temporaryRoles.length + 1}`,
        name,
        age: 24,
        gender: "未指定",
        personality: "根据首次登场时的言行与情绪表现建立",
        relation: "根据当前场景与人物互动判断",
        prompt: `依据“${name}”的首次登场与后续对话，保持身份、语气、目标和行为逻辑连续。首次登场证据：${firstAppearanceEvidence || "暂无更多细节"}`,
        appearance: `依据“${name}”的首次登场片段提取五官、发型、体态、服装与标志物；未明确的细节保持可编辑。视觉证据：${firstAppearanceEvidence || "暂无更多细节"}`,
        imagePrompt: "",
        avatarUrl: "",
      };
      this.ensemble.temporaryRoles.push(temporaryRole);
      return { role: temporaryRole, created: true };
    },
    closeRoleDetail() {
      this.portraitPreviewOpen = false;
      this.visualStatePreview = null;
      this.roleDetailOpen = false;
    },
    async saveRoleDetail() {
      if (!this.selectedRole) return;
      const role = this.selectedRole;
      try {
        await this.saveSettings();
        this.persist();
        const sourceHash = compactTextHash(`${role.prompt || ""}\n${role.appearance || ""}`);
        if (
          this.standaloneMode
          && role.prompt?.trim()
          && role.derivedProfile?.sourcePromptHash !== sourceHash
        ) {
          this.roleProfileGenerating = true;
          try {
            await this.generateRoleProfileFor(role, "derive", this.roleDetailTargetId);
            this.showToast(`${role.name}的资料与 AI 派生状态已保存`);
          } catch (error) {
            this.recordError("人物状态提取", error, { roleId: this.roleDetailTargetId, roleName: role.name });
            this.showToast(`${role.name}的资料已保存；AI 状态稍后可重试`, false);
          } finally {
            this.roleProfileGenerating = false;
          }
          return;
        }
        this.showToast(`${role.name}的资料已保存`);
      } catch (error) {
        this.recordError("人物资料保存", error, { roleId: this.roleDetailTargetId });
        this.showToast("人物资料保存失败");
      }
    },
    async readLocalImageFile(file) {
      if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
      if (file.size > 18 * 1024 * 1024) throw new Error("图片不能超过 18MB");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
        reader.readAsDataURL(file);
      });
      if (!this.standaloneMode) return dataUrl;
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", dataUrl, category: "character" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.reference) throw new Error(result.error || "图片保存失败");
      return result.reference;
    },
    async useAvatarAsVisualBase() {
      const role = this.selectedRole;
      if (!role?.avatarUrl) return;
      const matchingJob = this.imageJobs.find((job) =>
        job.kind === "character"
        && job.targetId === this.roleDetailTargetId
        && job.status === "completed"
        && job.imageUrl === role.avatarUrl
      );
      this.$set(role, "visualBaseSource", "avatar");
      this.$set(role, "visualBaseImageUrl", "");
      this.$set(role, "visualBaseImageJobId", matchingJob?.id || "");
      await this.saveSettings().catch(() => {});
      this.preloadImageUrl(role.avatarUrl);
      this.showToast("当前头像已设为动作基底图");
    },
    async uploadVisualBaseImage(event) {
      const file = event?.target?.files?.[0];
      if (!file || !this.selectedRole) return;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.$set(this.selectedRole, "visualBaseSource", "upload");
        this.$set(this.selectedRole, "visualBaseImageUrl", imageUrl);
        this.$set(this.selectedRole, "visualBaseImageJobId", "");
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.showToast("基底图已导入并保存在当前设备");
      } catch (error) {
        this.showToast(String(error?.message || "基底图读取失败"));
      } finally {
        event.target.value = "";
      }
    },
    async clearVisualBaseImage() {
      if (!this.selectedRole) return;
      this.$set(this.selectedRole, "visualBaseSource", "");
      this.$set(this.selectedRole, "visualBaseImageUrl", "");
      this.$set(this.selectedRole, "visualBaseImageJobId", "");
      await this.saveSettings().catch(() => {});
      this.showToast("动作基底图已清除，已有动作图不会删除");
    },
    visualStateJob(state) {
      if (!state?.imageJobId) return null;
      const job = this.imageJobs.find((item) => item.id === state.imageJobId);
      return job && (job.status === "queued" || job.status === "running") ? job : null;
    },
    visualStateImage(state) {
      if (!state) return "";
      if (state.imageUrl) return state.imageUrl;
      if (!state.imageJobId) return "";
      const job = this.imageJobs.find((item) => item.id === state.imageJobId);
      return job?.status === "completed" ? String(job.imageUrl || "") : "";
    },
    openVisualStatePreview(state) {
      const imageUrl = this.visualStateImage(state);
      if (!imageUrl || !this.selectedRole) return;
      this.visualStatePreview = {
        imageUrl,
        roleName: this.selectedRole.name,
        stateName: state.name,
      };
    },
    closeVisualStatePreview() {
      this.visualStatePreview = null;
    },
    selectVisualStates(mode) {
      this.selectedRoleVisualStates.forEach((state) => {
        const selected = mode === "all"
          ? true
          : mode === "missing"
          ? !this.visualStateImage(state)
          : false;
        this.$set(state, "selected", selected);
      });
    },
    async uploadVisualStateImage(event, state) {
      const file = event?.target?.files?.[0];
      if (!file || !state) return;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.$set(state, "imageUrl", imageUrl);
        this.$set(state, "imageJobId", "");
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.applyStageCue({
          speaker: this.selectedRole.name,
          visual: {
            preferredStateId: state.id,
            emotion: state.emotion,
            action: state.action,
          },
        });
        this.showToast(`${state.name}已导入并保存在当前设备`);
      } catch {
        this.showToast("本地图片读取失败");
      } finally {
        event.target.value = "";
      }
    },
    async clearVisualStateImage(state) {
      if (!state) return;
      this.$set(state, "imageUrl", "");
      this.$set(state, "imageJobId", "");
      await this.saveSettings().catch(() => {});
      this.showToast(`${state.name}的图片已移除`);
    },
    addCustomVisualState() {
      const states = this.normalizeVisualLibrary(this.selectedRole);
      const index = states.filter((state) => state.custom).length + 1;
      const state = {
        id: `custom-${Date.now()}`,
        name: `自定义动作${index}`,
        emotion: "neutral",
        action: "idle",
        tags: [],
        prompt: "符合当前人物性格的自然表情与动作，正面全身，人物居中",
        finalPrompt: "",
        finalPromptVersion: 2,
        imageUrl: "",
        imageJobId: "",
        enabled: true,
        selected: true,
        custom: true,
      };
      states.push(state);
      this.visualStateEditorId = state.id;
      this.$nextTick(() => this.$el.querySelector(".visual-state-editor")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      }));
    },
    removeSelectedVisualState() {
      const state = this.selectedVisualState;
      if (!state?.custom || !window.confirm(`确认删除“${state.name}”吗？`)) return;
      const index = this.selectedRoleVisualStates.findIndex((item) => item.id === state.id);
      if (index >= 0) this.selectedRoleVisualStates.splice(index, 1);
      this.visualStateEditorId = this.selectedRoleVisualStates[0]?.id || "";
      this.saveSettings().catch(() => {});
    },
    buildVisualStatePrompt(role, state) {
      const actionPrompt = String(state.prompt || `${state.name}，${state.emotion}情绪，${state.action}动作`)
        .replace(/\s+/g, " ")
        .slice(0, 520);
      return `${actionPrompt}，纯白色背景。以图片1为基底，只改变上述表情和动作；人物必须还是图片1中的同一个人。人物形象、脸型、五官、发型、发色、瞳色、发饰、衣服、衣服颜色与材质、配饰、鞋子、身材比例、画风、镜头距离和构图全部不要变。不要增加其他人物、道具、文字、水印或边框。`.slice(0, 1200);
    },
    refreshSelectedVisualFinalPrompt() {
      if (!this.selectedRole || !this.selectedVisualState) return;
      this.$set(
        this.selectedVisualState,
        "finalPrompt",
        this.buildVisualStatePrompt(this.selectedRole, this.selectedVisualState),
      );
      this.$set(this.selectedVisualState, "finalPromptVersion", 2);
      this.showToast("最终图生图提示词已重新合成，可继续修改");
    },
    async submitVisualStateJob(state, silent = false) {
      const role = this.selectedRole;
      if (!role || !state || this.visualStateJob(state)) return false;
      if (!this.selectedRoleVisualBaseUrl) throw new Error("请先确认角色基底图");
      const finalPrompt = String(state.finalPrompt || this.buildVisualStatePrompt(role, state)).trim().slice(0, 1200);
      this.$set(state, "finalPrompt", finalPrompt);
      this.$set(state, "finalPromptVersion", 2);
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate-async",
          enabled: true,
          kind: "visual-state",
          targetId: this.roleDetailTargetId,
          targetName: `${role.name} · ${state.name}`,
          visualStateId: state.id,
          imageModel: this.imageModel,
          prompt: finalPrompt,
          referenceMode: "role-base",
          archive: {
            title: `${role.name} · ${state.name}`,
            roleId: this.roleDetailTargetId,
            roleName: role.name,
            stateId: state.id,
            stateName: state.name,
            emotion: state.emotion,
            action: state.action,
            appearance: role.appearance || "",
            capturedAt: new Date().toISOString(),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.job?.id) {
        throw new Error(result.detail || result.error || "动作图任务创建失败");
      }
      this.$set(state, "imageJobId", result.job.id);
      this.$set(state, "imageUrl", "");
      if (!silent) this.showToast(`${state.name}已加入后台队列`);
      return true;
    },
    async generateVisualState(state) {
      if (this.imageMode !== "configured") {
        this.showToast("请先配置图片生成 Key");
        return;
      }
      if (!this.selectedRoleVisualBaseUrl) {
        this.showToast("请先生成、导入或确认角色基底图");
        return;
      }
      try {
        await this.submitVisualStateJob(state);
        await this.saveSettings();
        await this.pollImageJobs();
      } catch (error) {
        this.showToast(String(error?.message || "动作图任务创建失败").slice(0, 48));
      }
    },
    async generateSelectedVisualStates() {
      if (!this.selectedRoleVisualBaseUrl) {
        this.showToast("请先确认角色基底图，再批量生成动作");
        return;
      }
      const states = this.selectedRoleVisualStates.filter((state) =>
        state.enabled !== false && state.selected && !this.visualStateJob(state)
      );
      if (!states.length || this.visualBatchSubmitting) return;
      const estimated = (states.length * 0.03).toFixed(2);
      if (!window.confirm(`将为${this.selectedRole.name}生成 ${states.length} 张动作图，按每张约 0.03 元估算约 ${estimated} 元。最多同时生成 6 张，超出的任务自动排队，确认继续吗？`)) return;
      this.visualBatchSubmitting = true;
      let submitted = 0;
      try {
        for (const state of states) {
          if (await this.submitVisualStateJob(state, true)) submitted += 1;
        }
        await this.saveSettings();
        await this.pollImageJobs();
        this.showToast(`已加入 ${submitted} 张动作图，最多 6 张正在同时生成`);
      } catch (error) {
        await this.saveSettings().catch(() => {});
        this.showToast(`已加入 ${submitted} 张，随后失败：${String(error?.message || "").slice(0, 24)}`);
      } finally {
        this.visualBatchSubmitting = false;
      }
    },
    async saveVisualLibrary() {
      if (!this.selectedRole) return;
      this.normalizeVisualLibrary(this.selectedRole);
      await this.saveSettings()
        .then(() => this.showToast(`${this.selectedRole.name}的动作图库已保存`))
        .catch(() => this.showToast("动作图库保存失败"));
    },
    openBackgroundComposer() {
      this.backgroundComposerOpen = true;
    },
    async prepareStageBackground() {
      if (this.backgroundPromptPreparing || this.backgroundGenerating) return;
      this.backgroundPromptPreparing = true;
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare-background",
            enabled: true,
            provider: this.chatProvider,
            model: this.chatProvider === "grok" ? this.grokModel : "",
            worldSetting: this.worldSetting,
            storySummary: this.storySummary,
            messages: this.messages
              .filter((message) => !message.typing && message.content)
              .slice(-10)
              .map(({ role, speaker, content }) => ({ role, speaker, content })),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.prompt) {
          throw new Error(result.detail || result.error || "背景提示词整理失败");
        }
        this.stageBackground.prompt = String(result.prompt).slice(0, 1200);
        await this.saveSettings();
        this.showToast("背景提示词已根据当前场景整理，可继续修改");
      } catch (error) {
        this.showToast(String(error?.message || "背景提示词整理失败").slice(0, 48));
      } finally {
        this.backgroundPromptPreparing = false;
      }
    },
    async uploadStageBackground(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      try {
        const imageUrl = await this.readLocalImageFile(file);
        this.stageBackground.imageUrl = imageUrl;
        this.stageBackground.imageJobId = "";
        await this.saveSettings();
        this.preloadImageUrl(imageUrl);
        this.showToast("本地背景已导入，不产生生图费用");
      } catch (error) {
        this.showToast(String(error?.message || "背景图片读取失败"));
      } finally {
        event.target.value = "";
      }
    },
    async clearStageBackground() {
      this.stageBackground.imageUrl = "";
      this.stageBackground.imageJobId = "";
      this.stageBackground.prompt = "";
      await this.saveSettings().catch(() => {});
      this.showToast("对话舞台背景已清空");
    },
    async generateStageBackground() {
      const prompt = this.stageBackground.prompt.trim();
      if (this.backgroundGenerating || prompt.length < 20) return;
      if (!window.confirm("这会调用一次付费图片生成接口，按当前价格预计约 0.03 元。确认生成这个背景吗？")) return;
      this.backgroundGenerating = true;
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-async",
            enabled: true,
            kind: "stage-background",
            targetName: "当前对话舞台背景",
            imageModel: this.imageModel,
            prompt,
            archive: {
              title: "对话舞台背景",
              scene: prompt,
              eventSummary: "由用户主动选择生成，用于与本地角色立绘前端组合。",
              capturedAt: new Date().toISOString(),
            },
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) {
          throw new Error(result.detail || result.error || "背景任务创建失败");
        }
        this.stageBackground.imageJobId = result.job.id;
        this.stageBackground.imageUrl = "";
        await this.saveSettings();
        await this.pollImageJobs();
        this.showToast("背景已加入后台队列，请保持页面打开");
      } catch (error) {
        this.showToast(String(error?.message || "背景任务创建失败").slice(0, 48));
      } finally {
        this.backgroundGenerating = false;
      }
    },
    preloadImageUrl(url) {
      if (!url || this.preloadedVisualUrls.includes(url)) return;
      const image = new Image();
      image.src = url;
      this.preloadedVisualUrls.push(url);
      this.preloadedVisualUrls = this.preloadedVisualUrls.slice(-96);
    },
    preloadRoleVisuals(role) {
      if (!role) return;
      const states = this.normalizeVisualLibrary(role);
      states
        .filter((state) => state.id === this.stageStateId || state.id === role.visualDefaultStateId)
        .slice(0, 2)
        .map((state) => this.visualStateImage(state))
        .filter(Boolean)
        .forEach((url) => this.preloadImageUrl(url));
    },
    matchVisualState(role, cue = {}) {
      if (!role || role.visualEnabled === false) return null;
      const states = this.normalizeVisualLibrary(role).filter((state) => state.enabled !== false);
      if (!states.length) return null;
      const visual = cue.visual && typeof cue.visual === "object" ? cue.visual : {};
      const preferred = String(visual.preferredStateId || cue.preferredStateId || "");
      const emotion = String(visual.emotion || cue.mood || "").toLowerCase();
      const action = String(visual.action || cue.action || "").toLowerCase();
      const content = String(cue.content || "").toLowerCase();
      return states
        .map((state) => {
          let score = state.id === preferred ? 120 : 0;
          if (emotion && state.emotion.toLowerCase() === emotion) score += 36;
          if (action && state.action.toLowerCase() === action) score += 42;
          if (content.includes(state.name)) score += 24;
          for (const tag of state.tags || []) {
            if (tag && (emotion.includes(tag) || action.includes(tag) || content.includes(tag))) score += 8;
          }
          if (state.id === role.visualDefaultStateId) score += 2;
          if (this.visualStateImage(state)) score += 1;
          return { state, score };
        })
        .sort((a, b) => b.score - a.score)[0]?.state || states[0];
    },
    inferVisualCue(message) {
      if (message?.visual) return message;
      const text = `${message?.mood || ""} ${message?.action || ""} ${message?.content || ""}`;
      const mappings = [
        [/撒娇|求抱|黏|衣角/, ["coquettish", "hold_sleeve", "coquettish_sleeve"]],
        [/嫌弃|白眼|不屑/, ["disdain", "arms_crossed", "disdain_arms_crossed"]],
        [/坏笑|调皮|狡黠/, ["mischievous", "lean_close", "mischievous_grin"]],
        [/困|哈欠|睡眼/, ["sleepy", "yawn", "sleepy_yawn"]],
        [/牵手|拉住.*手/, ["affectionate", "hold_hands", "hold_hands_close"]],
        [/警戒|戒备|危险|脚步声/, ["alert", "scan", "alert_scan"]],
        [/施法|法则|魔力|神力/, ["focused", "cast_spell", "cast_spell"]],
        [/生气|愤怒/, ["angry", "hands_hips", "angry_hands_hips"]],
        [/伤心|流泪|哭/, ["sad", "wipe_tears", "sad_wipe_tears"]],
        [/开心|笑|庆祝/, ["happy", "cheer", "excited_cheer"]],
        [/害羞|脸红/, ["shy", "look_away", "shy_lookaway"]],
        [/害怕|躲到|缩在/, ["afraid", "hide", "afraid_hide"]],
      ];
      const match = mappings.find(([pattern]) => pattern.test(text));
      return {
        ...message,
        visual: match
          ? { emotion: match[1], action: match[2], preferredStateId: match[3], intensity: 0.65 }
          : { emotion: "neutral", action: "idle", preferredStateId: "idle_neutral", intensity: 0.4 },
      };
    },
    replayMessageVisual(message) {
      if (!this.standaloneMode || message?.role !== "assistant" || message?.typing) return;
      this.applyStageCue({
        ...message,
        speaker: message.speaker || this.profile.name,
      }, true);
    },
    replayCurrentStageVisual() {
      if (!this.standaloneMode || !this.stageSpeaker) return;
      this.applyStageCue({
        role: "assistant",
        speaker: this.stageSpeaker,
        visual: {
          preferredStateId: this.stageStateId,
          emotion: this.stageEmotion,
          action: this.stageAction,
          intensity: this.stageIntensity,
        },
      }, true);
    },
    clearStageVisualSequence() {
      this.stageSequenceTimers.forEach((timer) => window.clearTimeout(timer));
      this.stageSequenceTimers = [];
    },
    async applyStageCue(message, forceReplay = false, sequenceFrame = false) {
      if (!this.motionDisplayEnabled || !this.standaloneMode || !message?.speaker) return;
      const sequence = Array.isArray(message.visual?.sequence)
        ? message.visual.sequence.slice(0, 4)
        : [];
      if (!sequenceFrame && sequence.length > 1) {
        this.clearStageVisualSequence();
        let elapsed = 0;
        sequence.forEach((frame, index) => {
          const durationMs = Math.min(2600, Math.max(700, Number(frame?.durationMs) || 1200));
          const play = () => this.applyStageCue({
            ...message,
            visual: { ...message.visual, ...frame, sequence: [] },
          }, forceReplay || index > 0, true);
          if (index === 0) play();
          else this.stageSequenceTimers.push(window.setTimeout(play, elapsed));
          elapsed += durationMs;
        });
        return;
      }
      const record = this.roleRecordByName(message.speaker);
      if (!record) return;
      const cue = this.inferVisualCue(message);
      const state = this.matchVisualState(record.role, cue);
      const previousRoleId = this.stageRoleId;
      const url = state
        ? this.visualStateImage(state)
        : record.role.visualEnabled === false
          ? record.role.avatarUrl || ""
          : "";
      this.stageSpeaker = record.role.name;
      this.stageRoleId = record.id;
      this.stageStateId = state?.id || "";
      this.stageEmotion = cue.visual?.emotion || cue.mood || state?.emotion || "neutral";
      this.stageAction = cue.visual?.action || cue.action || state?.action || "idle";
      this.stageIntensity = Math.min(1, Math.max(0, Number(cue.visual?.intensity) || 0.45));
      this.preloadRoleVisuals(record.role);
      if (!url) {
        if (previousRoleId !== record.id) {
          this.stageLayers = [{ url: "" }, { url: "" }];
          this.stageActiveLayer = 0;
        }
        return;
      }
      if (url === this.stageImageUrl) {
        if (forceReplay) this.stageMotionNonce += 1;
        return;
      }
      this.preloadImageUrl(url);
      const inactive = this.stageActiveLayer === 0 ? 1 : 0;
      this.$set(this.stageLayers, inactive, { url });
      await this.$nextTick();
      window.clearTimeout(this.stageTransitionTimer);
      if (forceReplay) this.stageMotionNonce += 1;
      this.stageActiveLayer = inactive;
      this.stageTransitionTimer = window.setTimeout(() => {
        const old = inactive === 0 ? 1 : 0;
        this.$set(this.stageLayers, old, { url: "" });
      }, 420);
    },
    roleHistoryContext(name) {
      const relatedIndexes = new Set();
      this.messages.forEach((message, index) => {
        if (
          !message.typing
          && typeof message.content === "string"
          && (message.speaker === name || message.content.includes(name))
        ) {
          relatedIndexes.add(index);
          if (index > 0) relatedIndexes.add(index - 1);
          if (index + 1 < this.messages.length) relatedIndexes.add(index + 1);
        }
      });
      return this.messages
        .filter((message, index) =>
          relatedIndexes.has(index)
          && !message.typing
          && (message.role === "user" || message.role === "assistant")
          && typeof message.content === "string"
          && message.content.trim()
        )
        .slice(-30)
        .map(({ role, content, speaker }) => ({ role, content, speaker }));
    },
    async generateRoleSetting(mode = "all") {
      const role = this.selectedRole;
      if (!role || this.roleProfileGenerating) return;
      if (this.roleProfileGenerationIds.includes(this.roleDetailTargetId)) {
        this.showToast("新角色档案正在自动生成，请稍等片刻");
        return;
      }
      this.roleProfileGenerating = true;
      try {
        await this.generateRoleProfileFor(role, mode, this.roleDetailTargetId);
        const label = mode === "prompt"
          ? "人物提示词"
          : mode === "appearance"
          ? "稳定外观"
          : "完整档案";
        this.showToast(`${role.name}的${label}已由 AI 整理，可继续修改`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "角色设定生成失败";
        this.showToast(detail.length > 42 ? "角色设定生成失败，请检查对话模型" : detail);
      } finally {
        this.roleProfileGenerating = false;
      }
    },
    async generateRoleProfileFor(role, mode = "all", roleId = role?.id || "") {
      if (!role) throw new Error("角色不存在");
      const response = await fetch("/api/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: this.chatProvider,
          model: this.chatProvider === "grok" ? this.grokModel : "",
          roleId,
          role,
          roleMemory: this.roleMemories?.[roleId] || null,
          messages: this.roleHistoryContext(role.name),
          storySummary: this.storySummary,
          worldSetting: this.worldSetting,
          storyClock: this.storyClock,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.role?.prompt || !result.role?.appearance) {
        throw new Error(result.detail || result.error || "角色设定生成失败");
      }
      const generated = result.role;
      if (mode === "all") {
        const isTemporary = this.ensemble.temporaryRoles.some((item) => item.id === roleId);
        if (!isTemporary && generated.name) role.name = generated.name.slice(0, 20);
        role.gender = ["女性", "男性", "非二元", "未指定"].includes(generated.gender)
          ? generated.gender
          : role.gender || "未指定";
        role.relation = String(generated.relation || role.relation || "").slice(0, 80);
      }
      if (generated.derivedProfile && typeof generated.derivedProfile === "object") {
        role.derivedProfile = {
          ...generated.derivedProfile,
          anchorStoryDay: Math.max(1, Number(generated.derivedProfile.anchorStoryDay) || this.storyClock.day),
          sourcePromptHash: compactTextHash(`${generated.prompt || role.prompt || ""}\n${generated.appearance || role.appearance || ""}`),
          updatedAt: new Date().toISOString(),
        };
        role.age = Number(generated.derivedProfile.initialActualAge) || role.age || 24;
        role.personality = String(generated.derivedProfile.corePersonality || role.personality || "").slice(0, 120);
      }
      if (mode === "all" || mode === "prompt") {
        role.prompt = String(generated.prompt || role.prompt || "").slice(0, 2000);
      }
      if (mode === "all" || mode === "appearance") {
        role.appearance = String(generated.appearance || role.appearance || "").slice(0, 2000);
      }
      await this.saveSettings();
      this.persist();
      return role;
    },
    async autoGenerateTemporaryRoles(roleIds) {
      for (const roleId of [...new Set(roleIds || [])]) {
        if (this.roleProfileGenerationIds.includes(roleId)) continue;
        const role = this.ensemble.temporaryRoles.find((item) => item.id === roleId);
        if (!role) continue;
        this.roleProfileGenerationIds.push(roleId);
        try {
          await this.generateRoleProfileFor(role, "all", roleId);
          this.showToast(`新角色「${role.name}」的档案已根据登场剧情自动生成`);
        } catch {
          this.showToast(`已建立「${role.name}」的临时档案，可稍后用 AI 继续完善`);
        } finally {
          this.roleProfileGenerationIds = this.roleProfileGenerationIds.filter((id) => id !== roleId);
        }
      }
    },
    promoteSelectedTemporaryRole() {
      const role = this.selectedRole;
      if (!role || !this.selectedRoleIsTemporary || this.ensemble.customRoles.length >= 30) return;
      const temporaryIndex = this.ensemble.temporaryRoles.findIndex((item) => item.id === role.id);
      if (temporaryIndex < 0) return;
      const fixedRole = {
        ...role,
        id: `role-${Date.now()}-${this.ensemble.customRoles.length + 1}`,
      };
      if (this.roleMemories[role.id]) {
        this.$set(this.roleMemories, fixedRole.id, {
          ...this.roleMemories[role.id],
          name: fixedRole.name,
        });
        this.$delete(this.roleMemories, role.id);
      }
      this.ensemble.temporaryRoles.splice(temporaryIndex, 1);
      this.ensemble.customRoles.push(fixedRole);
      this.roleDetailTargetId = fixedRole.id;
      this.ensemble.enabled = true;
      this.saveSettings().then(() => this.showToast(`已将「${fixedRole.name}」加入固定角色库`))
        .catch(() => this.showToast("加入固定角色库失败"));
    },
    generateSavedCharacterImage() {
      const role = this.selectedRole;
      if (!role?.imagePrompt?.trim()) return;
      this.characterTargetId = this.roleDetailTargetId;
      this.characterPrompt = role.imagePrompt.trim().slice(0, 1200);
      this.generateCharacterImage();
    },
    openPromptSection(section = "") {
      this.settingsOpen = false;
      this.roleDetailOpen = false;
      this.promptSection = section;
      this.mobileTab = "prompt";
      this.$nextTick(() => {
        const target = section === "world"
          ? this.$refs.worldEditor
          : section === "memory"
          ? this.$refs.memoryEditor
          : section === "roles"
          ? this.$refs.roleEditor
          : null;
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    async generateWorldSetting() {
      if (this.worldGenerating) return;
      this.worldGenerating = true;
      try {
        const response = await fetch("/api/world", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: this.chatProvider,
            model: this.chatProvider === "grok" ? this.grokModel : "",
            seed: this.worldSeed || this.worldSetting,
            existing: this.worldSetting,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.worldSetting !== "string") {
          throw new Error(result.detail || result.error || "世界设定生成失败");
        }
        this.worldSetting = result.worldSetting.slice(0, 12000);
        await this.saveSettings();
        this.showToast("世界设定已生成并保存");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "世界设定生成失败";
        this.showToast(detail.length > 42 ? "世界设定生成失败，请检查对话模型" : detail);
      } finally {
        this.worldGenerating = false;
      }
    },
    async saveWorldSetting() {
      this.randomRoleInterval = Math.min(60, Math.max(8, Number(this.randomRoleInterval) || 18));
      try {
        await this.saveSettings();
        this.showToast("世界设定与角色加入规则已保存");
      } catch {
        this.showToast("世界设定保存失败");
      }
    },
    async pollImageJobs() {
      window.clearTimeout(this.imageJobPollTimer);
      try {
        const response = await fetch("/api/image", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        const jobs = Array.isArray(result.jobs) ? result.jobs : [];
        const failedJobs = Array.isArray(result.failedJobs)
          ? result.failedJobs
          : jobs.filter((job) => job.status === "failed");
        this.imageJobs = jobs;
        this.activeImageJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
        const recentCutoff = Date.now() - 15 * 60 * 1000;
        const finished = [...jobs, ...failedJobs].filter((job) =>
          (job.status === "completed" || job.status === "failed")
          && new Date(job.updatedAt).getTime() >= recentCutoff
          && !this.notifiedImageJobIds.includes(job.id)
        );
        for (const job of finished) {
          this.notifiedImageJobIds.push(job.id);
          if (job.status === "completed") {
            if (job.kind !== "visual-state") await this.syncSettingsFromServer(true);
            if (job.kind === "visual-state") {
              const role = this.roleById(job.targetId);
              if (role) this.preloadRoleVisuals(role);
              const latestAssistant = [...this.messages].reverse().find((message) => message.role === "assistant" && message.speaker);
              if (latestAssistant) this.applyStageCue(latestAssistant);
            }
            if (job.kind === "stage-background") {
              this.preloadImageUrl(job.imageUrl);
              this.showToast("对话舞台背景已生成并保存在本地");
            } else {
              this.showToast(`${job.targetName || "角色"}的形象已生成并保存在本地`);
            }
          } else {
            this.recordError("图片生成", job.error || "图片生成失败", {
              jobId: job.id,
              kind: job.kind,
              targetId: job.targetId,
              targetName: job.targetName,
              model: job.model || job.request?.imageModel || this.imageModel,
              attempt: job.attempt,
              maxAttempts: job.maxAttempts,
              prompt: job.failedPrompt || job.prompt,
              diagnostic: job.diagnostic || null,
            });
            this.showToast(`${job.targetName || "角色"}生图失败：${String(job.error || "请检查接口").slice(0, 28)}`);
          }
        }
        this.notifiedImageJobIds = this.notifiedImageJobIds.slice(-60);
      } catch (error) {
        this.recordError("图片任务轮询", error);
      }
      const delay = this.activeImageJobs.length ? 3500 : (this.mobileTab === "image" ? 12000 : 30000);
      this.imageJobPollTimer = window.setTimeout(() => this.pollImageJobs(), delay);
    },
    applyEnsemble(value) {
      if (!value || typeof value !== "object") return;
      this.ensemble = {
        enabled: value.enabled !== false,
        autoGuests: value.autoGuests !== false,
        maxTurns: Math.min(10, Math.max(1, Number(value.maxTurns) || 3)),
        friend: {
          ...this.ensemble.friend,
          ...(value.friend && typeof value.friend === "object" ? value.friend : {}),
          gender: ["女性", "男性", "非二元", "未指定"].includes(value.friend?.gender)
            ? value.friend.gender
            : "女性",
        },
        customRoles: Array.isArray(value.customRoles)
          ? value.customRoles.slice(0, 30).map((role, index) => ({
              id: role?.id || `role-${Date.now()}-${index}`,
              name: role?.name || `角色${index + 1}`,
              age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
              gender: ["女性", "男性", "非二元", "未指定"].includes(role?.gender) ? role.gender : "未指定",
              personality: role?.personality || "自然、友善",
              relation: role?.relation || "成年朋友",
              prompt: role?.prompt || "",
              appearance: role?.appearance || "",
              imagePrompt: role?.imagePrompt || "",
              avatarUrl: role?.avatarUrl || "",
              derivedProfile: role?.derivedProfile && typeof role.derivedProfile === "object"
                ? role.derivedProfile
                : null,
              visualEnabled: role?.visualEnabled !== false,
              visualDefaultStateId: role?.visualDefaultStateId || "idle_neutral",
              visualStates: Array.isArray(role?.visualStates) ? role.visualStates : [],
              visualBaseSource: role?.visualBaseSource || "",
              visualBaseImageUrl: role?.visualBaseImageUrl || "",
              visualBaseImageJobId: role?.visualBaseImageJobId || "",
            }))
          : [],
        temporaryRoles: Array.isArray(value.temporaryRoles)
          ? value.temporaryRoles.slice(0, 80).map((role, index) => ({
              id: role?.id || `temporary-${Date.now()}-${index}`,
              name: role?.name || `临时角色${index + 1}`,
              age: Math.min(80, Math.max(18, Number(role?.age) || 24)),
              gender: ["女性", "男性", "非二元", "未指定"].includes(role?.gender) ? role.gender : "未指定",
              personality: role?.personality || "延续对话中已经表现出的性格",
              relation: role?.relation || "场景中认识的成年角色",
              prompt: role?.prompt || "",
              appearance: role?.appearance || "",
              imagePrompt: role?.imagePrompt || "",
              avatarUrl: role?.avatarUrl || "",
              derivedProfile: role?.derivedProfile && typeof role.derivedProfile === "object"
                ? role.derivedProfile
                : null,
              visualEnabled: role?.visualEnabled !== false,
              visualDefaultStateId: role?.visualDefaultStateId || "idle_neutral",
              visualStates: Array.isArray(role?.visualStates) ? role.visualStates : [],
              visualBaseSource: role?.visualBaseSource || "",
              visualBaseImageUrl: role?.visualBaseImageUrl || "",
              visualBaseImageJobId: role?.visualBaseImageJobId || "",
            }))
          : [],
      };
    },
    async syncSettingsFromServer(force = false) {
      if (!force && (
        this.settingsOpen
        || this.roleDetailOpen
        || this.characterPromptOpen
        || this.characterPromptPreparing
        || this.characterGenerating
        || this.mobileTab === "prompt"
      )) return;
      try {
        const response = await fetch("/api/storage?scope=settings", { cache: "no-store" });
        if (!response.ok) return;
        const saved = await response.json();
        this.settingsReady = false;
        if (saved?.profile) this.profile = { ...this.profile, ...saved.profile };
        if (saved?.ensemble) this.applyEnsemble(saved.ensemble);
        if (typeof saved?.systemPrompt === "string") this.systemPrompt = saved.systemPrompt;
        if (typeof saved?.storySummary === "string") this.storySummary = saved.storySummary;
        if (saved?.storyClock) {
          this.storyClock = normalizeStoryClock(saved.storyClock);
          this.dayCount = this.storyClock.day;
        }
        if (Array.isArray(saved?.storyEvents)) this.storyEvents = normalizeStoryEvents(saved.storyEvents);
        if (saved?.roleMemories && typeof saved.roleMemories === "object") this.roleMemories = saved.roleMemories;
        if (typeof saved?.worldSetting === "string") this.worldSetting = saved.worldSetting;
        this.autoCompress = saved?.autoCompress !== false;
        this.autoCompressThreshold = Math.min(120, Math.max(20, Number(saved?.autoCompressThreshold) || 40));
        this.randomRoleEnabled = saved?.randomRoleEnabled !== false;
        this.randomRoleInterval = Math.min(60, Math.max(8, Number(saved?.randomRoleInterval) || 18));
        if (saved?.stageBackground && typeof saved.stageBackground === "object") {
          this.stageBackground = {
            ...this.stageBackground,
            ...saved.stageBackground,
          };
        }
        this.summaryUpdatedAt = typeof saved?.summaryUpdatedAt === "string" ? saved.summaryUpdatedAt : "";
        this.$nextTick(() => { this.settingsReady = true; });
      } catch {}
    },
    addCustomRole() {
      if (this.ensemble.customRoles.length >= 30) return;
      const index = this.ensemble.customRoles.length + 1;
      this.ensemble.customRoles.push({
        id: `role-${Date.now()}-${index}`,
        name: `新角色${index}`,
        age: 24,
        gender: "未指定",
        personality: "自然、友善",
        relation: "成年朋友",
        prompt: "",
        appearance: "",
        imagePrompt: "",
        avatarUrl: "",
      });
      this.$nextTick(() => {
        const cards = this.$el.querySelectorAll(".custom-role-card");
        cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
    removeCustomRole(index) {
      if (!window.confirm("确认删除这个自定义角色吗？已保存的历史消息不会被删除。")) return;
      const roleId = this.ensemble.customRoles[index]?.id;
      this.ensemble.customRoles.splice(index, 1);
      if (roleId && this.roleMemories[roleId]) this.$delete(this.roleMemories, roleId);
    },
    fixedRoleByName(name) {
      if (!name) return null;
      if (name === this.ensemble.friend.name) return this.ensemble.friend;
      return this.ensemble.customRoles.find((role) => role.name === name) || null;
    },
    temporaryRoleByName(name) {
      if (!name) return null;
      return this.ensemble.temporaryRoles.find((role) => role.name === name) || null;
    },
    roleAvatar(name) {
      return this.fixedRoleByName(name)?.avatarUrl
        || this.temporaryRoleByName(name)?.avatarUrl
        || "";
    },
    canPromoteSpeaker(name) {
      return Boolean(
        name
        && name !== this.profile.name
        && !this.fixedRoleByName(name)
        && this.ensemble.customRoles.length < 30
      );
    },
    promoteSpeaker(message) {
      const name = String(message?.speaker || "").trim();
      if (!this.canPromoteSpeaker(name)) return;
      const existingTemporary = this.temporaryRoleByName(name);
      if (existingTemporary) {
        this.roleDetailTargetId = existingTemporary.id;
        this.promoteSelectedTemporaryRole();
        return;
      }
      this.ensemble.customRoles.push({
        id: `role-${Date.now()}-${this.ensemble.customRoles.length + 1}`,
        name,
        age: 24,
        gender: "未指定",
        personality: "延续首次登场时表现出的性格",
        relation: "场景中认识的成年角色",
        prompt: `保持“${name}”在首次登场时的身份、说话方式和行为逻辑。参考首次片段：${String(message.content || "").slice(0, 700)}`,
        appearance: "根据首次登场片段延续稳定外观；请在设置中补充发型、五官、体态和穿搭。",
        imagePrompt: "",
        avatarUrl: "",
      });
      this.ensemble.enabled = true;
      this.showToast(`已将「${name}」加入固定角色库`);
    },
    persist() {
      try {
        const compactRole = (role) => {
          const { visualStates, visualBaseImageUrl, ...rest } = role || {};
          return {
            ...rest,
            visualStateCount: Array.isArray(visualStates) ? visualStates.length : 0,
          };
        };
        localStorage.setItem("night-mailbox-state", JSON.stringify({
          profile: compactRole(this.profile),
          ensemble: {
            ...this.ensemble,
            friend: compactRole(this.ensemble.friend),
            customRoles: this.ensemble.customRoles.map(compactRole),
            temporaryRoles: this.ensemble.temporaryRoles.map(compactRole),
          },
          tasks: this.tasks,
          chatProvider: this.chatProvider,
          grokModel: this.grokModel,
          imageModel: this.imageModel,
          imageEnabled: this.imageEnabled,
          imageQuality: this.imageQuality,
          imagePrompt: this.imagePrompt,
          suggestions: this.suggestions,
          nextGuestAt: this.nextGuestAt,
          storyClock: this.storyClock,
          storyEvents: this.storyEvents,
        }));
      } catch {
        this.showToast("界面偏好保存失败");
      }
    },
    async saveHistory() {
      const roleIdsByName = new Map([
        [this.profile.name, "primary"],
        [this.ensemble.friend.name, "friend"],
        ...this.ensemble.customRoles.map((role) => [role.name, role.id]),
        ...this.ensemble.temporaryRoles.map((role) => [role.name, role.id]),
      ]);
      const messages = this.messages
        .filter((message) => !message.typing && typeof message.content === "string" && message.content.trim())
        .slice(-1000)
        .map((message) => {
          if (!message.createdAt) this.$set(message, "createdAt", new Date(Number(message.id) || Date.now()).toISOString());
          if (!message.storyDay) this.$set(message, "storyDay", this.storyClock.day);
          if (!message.storySegment) this.$set(message, "storySegment", this.storyClock.segment);
          if (!message.speakerId) {
            this.$set(message, "speakerId", message.role === "user"
              ? "user"
              : roleIdsByName.get(message.speaker || this.profile.name) || "");
          }
          const {
            id,
            role,
            content,
            speaker,
            speakerId,
            time,
            createdAt,
            storyDay,
            storySegment,
            imageUrl,
            imageModel,
            imageQuality,
            mood,
            action,
            visual,
          } = message;
          return {
            id,
            role,
            content,
            speaker,
            speakerId,
            time,
            createdAt,
            storyDay,
            storySegment,
            imageUrl,
            imageModel,
            imageQuality,
            mood,
            action,
            visual,
          };
        });
      const response = await fetch("/api/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "history", messages }),
      });
      if (!response.ok) throw new Error("history save failed");
    },
    showToast(text, autoLog = true) {
      if (autoLog && /失败|错误|不可用|未连接|没有连通|超时|中断/.test(String(text || ""))) {
        this.recordError("界面提示", text, { page: this.mobileTab });
      }
      this.toast = text;
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => { this.toast = ""; }, 2400);
    },
    scrollBottom() {
      this.$nextTick(() => {
        if (this.$refs.messages) this.$refs.messages.scrollTop = this.$refs.messages.scrollHeight;
      });
    },
    loadEarlierMessages() {
      const container = this.$refs.messages;
      if (!container || !this.hiddenEarlierMessageCount) return;
      const previousHeight = container.scrollHeight;
      const previousTop = container.scrollTop;
      this.messageDisplayLimit = Math.min(
        this.messages.length,
        this.messageDisplayLimit + this.messageDisplayBatch
      );
      this.$nextTick(() => {
        const addedHeight = container.scrollHeight - previousHeight;
        container.scrollTop = previousTop + Math.max(0, addedHeight);
      });
    },
    scrollToMessage(messageId) {
      if (!messageId) return;
      const messageIndex = this.messages.findIndex((message) => message.id === messageId);
      if (messageIndex >= 0) {
        this.messageDisplayLimit = Math.max(
          this.messageDisplayLimit,
          this.messages.length - messageIndex
        );
      }
      this.$nextTick(() => {
        const container = this.$refs.messages;
        const target = container?.querySelector(`[data-message-id="${messageId}"]`);
        if (!container || !target) return;
        container.scrollTop = Math.max(0, target.offsetTop - 12);
      });
    },
    quickSend(text) {
      if (this.sending || this.summarizing || this.suggestionsLoading || this.editingMessageId !== null) return;
      this.draft = text;
      this.sendMessage();
    },
    startEditMessage(message) {
      if (this.sending || message?.role !== "user") return;
      this.editingMessageId = message.id;
      this.editingMessageContent = message.content;
      this.$nextTick(() => {
        const editor = this.$el.querySelector(".message-editor textarea");
        if (editor) {
          editor.focus();
          editor.setSelectionRange(editor.value.length, editor.value.length);
        }
      });
    },
    cancelEditMessage() {
      this.editingMessageId = null;
      this.editingMessageContent = "";
    },
    submitEditedMessage(message) {
      const content = this.editingMessageContent.trim();
      if (!content || this.sending || message?.role !== "user") return;
      const messageIndex = this.messages.findIndex((item) => item.id === message.id);
      if (messageIndex < 0) {
        this.cancelEditMessage();
        return;
      }
      this.suggestionRequestId += 1;
      window.clearTimeout(this.suggestionRefreshTimer);
      this.suggestionsLoading = false;
      this.messages = this.messages.slice(0, messageIndex);
      this.cancelEditMessage();
      this.draft = content;
      this.persist();
      this.sendMessage();
    },
    setChatProvider(provider) {
      if (this.sending || (provider !== "deepseek" && provider !== "grok")) return;
      if (provider === "grok" && this.grokMode !== "configured") {
        this.showToast("请先配置 DOWNSTREAM_API_KEY");
        return;
      }
      this.chatProvider = provider;
      this.persist();
      this.showToast(provider === "grok"
        ? `${this.grokModel} 对话已启用`
        : `DeepSeek · ${this.deepseekModel} 已启用`);
    },
    async loadChatModels() {
      if (this.grokMode !== "configured" || this.chatModelsLoading) return;
      this.chatModelsLoading = true;
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        const models = Array.isArray(result.models)
          ? result.models.filter((model) =>
              typeof model === "string"
              && /^[a-zA-Z0-9._-]{2,100}$/.test(model)
            )
          : [];
        if (!response.ok || !models.length) throw new Error(result.error || "模型列表为空");
        this.availableChatModels = models;
        this.modelConnectionWarning = typeof result.discoveryError === "string" && result.discoveryError
          ? "暂时无法读取中转站模型列表，当前显示的是 JSON 备用模型。"
          : result.source === "config" && result.authConfigured
          ? "中转站 /models 当前返回空列表；正在使用已实测可用的 Claude 与 Grok 4.5 配置。"
          : "";
        if (!models.includes(this.grokModel)) {
          this.grokModel = models.includes(result.defaultModel) ? result.defaultModel : models[0];
        }
        this.persist();
      } catch {
        this.availableChatModels = ["claude-haiku-4-5-20251001", "grok-4.5"];
        this.modelConnectionWarning = "暂时无法读取中转站模型列表，当前显示 JSON 备用模型。";
        if (!this.availableChatModels.includes(this.grokModel)) {
          this.grokModel = this.availableChatModels[0];
        }
      } finally {
        this.chatModelsLoading = false;
      }
    },
    setDownstreamModel(model) {
      if (
        this.sending
        || this.grokMode !== "configured"
        || !this.availableChatModels.includes(model)
      ) return;
      this.grokModel = model;
      this.chatProvider = "grok";
      this.persist();
      this.showToast(`${model} 对话已启用`);
    },
    async loadImageModels() {
      if (this.imageModelsLoading) return;
      this.imageModelsLoading = true;
      try {
        const response = await fetch("/api/image-models", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        const models = Array.isArray(result.models)
          ? result.models.filter((model) =>
              typeof model === "string" && /^[a-zA-Z0-9._-]{2,100}$/.test(model)
            )
          : [];
        if (!response.ok || !models.length) throw new Error(result.error || "图片模型列表为空");
        this.availableImageModels = models;
        if (!this.modelConnectionWarning && typeof result.discoveryError === "string" && result.discoveryError) {
          this.modelConnectionWarning = "新中转站 Token 验证失败，当前显示的是 JSON 备用模型；更新 DOWNSTREAM_API_KEY 并重启后会自动查询完整列表。";
        }
        if (!models.includes(this.imageModel)) {
          this.imageModel = models.includes(result.defaultModel) ? result.defaultModel : models[0];
        }
        this.persist();
      } catch {
        this.availableImageModels = ["gpt-image-2"];
        if (!this.availableImageModels.includes(this.imageModel)) {
          this.imageModel = this.availableImageModels[0];
        }
      } finally {
        this.imageModelsLoading = false;
      }
    },
    setImageModel(model) {
      if (
        this.imageGenerating
        || this.characterGenerating
        || !this.availableImageModels.includes(model)
      ) return;
      this.imageModel = model;
      this.persist();
      this.showToast(`${model} 图片生成已启用`);
    },
    async refreshSuggestions(provider = this.chatProvider) {
      const requestId = ++this.suggestionRequestId;
      this.suggestionsLoading = true;
      try {
        const contextMessages = this.messages
          .filter((item) => !item.typing && typeof item.content === "string" && item.content.trim())
          .slice(-8)
          .map(({ role, content, speaker }) => ({ role, content, speaker }));
        const response = await fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: provider === "grok" ? this.grokModel : "",
            profile: this.profile,
            ensemble: this.ensemble,
            storySummary: this.storySummary,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            worldSetting: this.worldSetting,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(result.suggestions) || result.suggestions.length !== 3) {
          throw new Error("suggestions unavailable");
        }
        if (requestId === this.suggestionRequestId) {
          this.suggestions = result.suggestions;
        }
      } catch {
        if (requestId === this.suggestionRequestId) {
          this.suggestions = ["我牵住她的手，立刻开始行动", "按刚才的计划，我们现在就出发", "联系相关角色，让新消息进入现场"];
        }
      } finally {
        if (requestId === this.suggestionRequestId) {
          this.suggestionsLoading = false;
          this.persist();
        }
      }
    },
    imageQualityLabel(quality) {
      return { low: "低质量", medium: "中质量", high: "高质量", standard: "标准质量" }[quality] || "场景图";
    },
    narrativeSection(content, label) {
      const match = String(content || "").match(
        new RegExp(`【${label}(?:：|:)?([^】]*)】\\s*([\\s\\S]*?)(?=\\n\\s*【|$)`),
      );
      if (!match) return "";
      return [match[1], match[2]]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    },
    sceneArchiveSnapshot() {
      const recent = this.messages
        .filter((message) =>
          !message.typing
          && (message.role === "user" || message.role === "assistant")
          && typeof message.content === "string"
          && message.content.trim()
        )
        .slice(-8);
      const latestAssistant = [...recent].reverse().find((message) => message.role === "assistant");
      const latestUser = [...recent].reverse().find((message) => message.role === "user");
      const scene = this.narrativeSection(latestAssistant?.content, "场景")
        || String(latestAssistant?.content || "").replace(/\s+/g, " ").slice(0, 180)
        || "当前剧情场景";
      const action = this.narrativeSection(latestAssistant?.content, "动作");
      const dialogue = this.narrativeSection(latestAssistant?.content, "对话");
      const progression = this.narrativeSection(latestAssistant?.content, "剧情推进");
      const eventSummary = [
        latestUser?.content ? `用户刚刚：${latestUser.content.replace(/\s+/g, " ").trim()}` : "",
        action ? `正在发生：${action}` : "",
        dialogue ? `角色回应：${dialogue}` : "",
        progression ? `剧情进展：${progression}` : "",
      ].filter(Boolean).join("\n");
      const participants = [...new Set([
        this.profile.name,
        ...recent.filter((message) => message.role === "assistant" && message.speaker)
          .map((message) => message.speaker),
      ].filter(Boolean))];
      return {
        type: "scene",
        title: scene.slice(0, 80),
        scene: scene.slice(0, 800),
        eventSummary: (eventSummary || String(latestAssistant?.content || "").trim()).slice(0, 3000),
        contextSnapshot: recent.map((message) =>
          `${message.role === "user" ? "用户" : message.speaker || this.profile.name}：${message.content.trim().slice(0, 1200)}`
        ).join("\n\n").slice(0, 8000),
        participants,
        capturedAt: new Date().toISOString(),
      };
    },
    characterArchiveSnapshot(role) {
      return {
        type: "character",
        title: `${role.name}的人物形象`,
        characterId: this.characterTargetId,
        name: role.name,
        age: role.age,
        gender: role.gender || "未指定",
        relation: role.relation,
        personality: role.personality,
        introduction: role.prompt || `${role.name}是${role.relation || "当前剧情中的角色"}，性格${role.personality || "自然鲜明"}。`,
        appearance: role.appearance || role.imagePrompt || "",
        capturedAt: new Date().toISOString(),
      };
    },
    async resolveGalleryPreviewSource(imageUrl) {
      const source = String(imageUrl || "").trim();
      if (!source) throw new Error("图片地址为空");
      if (/^(?:data:|blob:|https?:)/i.test(source)) return source;
      if (window.__NIGHT_MAILBOX_NATIVE_IMAGE__?.resolvePreviewSource) {
        return window.__NIGHT_MAILBOX_NATIVE_IMAGE__.resolvePreviewSource(source);
      }
      const plus = window.plus;
      if (!plus?.io?.resolveLocalFileSystemURL || /^file:/i.test(source)) return source;
      return new Promise((resolve, reject) => {
        const rejectMissingFile = () => {
          reject(new Error("本地图片路径已经失效"));
        };
        plus.io.resolveLocalFileSystemURL(source, (entry) => {
          entry.file((file) => {
            const reader = new plus.io.FileReader();
            reader.onloadend = (event) => {
              const result = String(event?.target?.result || reader.result || "");
              if (result) resolve(result);
              else reject(new Error("本地图片读取结果为空"));
            };
            reader.onerror = () => reject(new Error("本地图片文件读取失败"));
            reader.readAsDataURL(file);
          }, () => reject(new Error("无法打开本地图片文件")));
        }, rejectMissingFile);
      });
    },
    async openGalleryPreview(job) {
      if (!job?.imageUrl) return;
      const previewId = String(job.id || `preview-${Date.now()}`);
      this.imagePreviewJob = {
        ...job,
        id: previewId,
        archive: { ...(job.archive || {}) },
      };
      this.imagePreviewSrc = "";
      this.imagePreviewError = "";
      this.imagePreviewLoading = true;
      try {
        const source = await this.resolveGalleryPreviewSource(job.imageUrl);
        if (this.imagePreviewJob?.id === previewId) this.imagePreviewSrc = source;
      } catch (error) {
        if (this.imagePreviewJob?.id === previewId) {
          this.imagePreviewError = String(error?.message || "图片读取失败");
        }
      } finally {
        if (this.imagePreviewJob?.id === previewId) this.imagePreviewLoading = false;
      }
    },
    openMessageImagePreview(message) {
      return this.openGalleryPreview({
        id: `message-image-${message.id}`,
        kind: "scene",
        imageUrl: message.imageUrl,
        model: message.imageModel,
        size: "",
        prompt: "",
        updatedAt: message.time,
        deletable: false,
        archive: {
          title: "对话场景图",
          scene: "保存在这条对话中的场景图片。",
          capturedAt: message.time,
        },
      });
    },
    handleGalleryPreviewError() {
      this.imagePreviewSrc = "";
      this.imagePreviewError = "图片地址存在，但浏览器无法解码或访问该文件";
    },
    retryGalleryPreview() {
      if (!this.imagePreviewJob) return;
      this.openGalleryPreview(this.imagePreviewJob);
    },
    isCharacterAlbumItem(item) {
      return ["character", "visual-state"].includes(item?.kind);
    },
    closeGalleryPreview() {
      this.imagePreviewJob = null;
      this.imagePreviewSrc = "";
      this.imagePreviewLoading = false;
      this.imagePreviewError = "";
    },
    clearAlbumItemReferences(item) {
      const role = this.roleById(item?.targetId);
      if (!role) return false;
      const imageUrl = String(item.imageUrl || "");
      const jobId = String(item.albumSource === "job" || this.imageJobs.some((job) => job.id === item.id)
        ? item.id
        : "");
      let changed = false;
      if (imageUrl && role.avatarUrl === imageUrl) {
        const fallback = this.imageJobs
          .filter((job) =>
            job.status === "completed"
            && job.kind === "character"
            && job.targetId === item.targetId
            && job.imageUrl
            && job.imageUrl !== imageUrl
            && job.id !== jobId
          )
          .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
        this.$set(role, "avatarUrl", fallback?.imageUrl || "");
        changed = true;
      }
      if (
        (jobId && role.visualBaseImageJobId === jobId)
        || (imageUrl && role.visualBaseImageUrl === imageUrl)
        || item.albumSource === "role-base"
      ) {
        this.$set(role, "visualBaseImageJobId", "");
        this.$set(role, "visualBaseImageUrl", "");
        this.$set(role, "visualBaseSource", "");
        changed = true;
      }
      for (const state of Array.isArray(role.visualStates) ? role.visualStates : []) {
        if (
          (item.visualStateId && state.id === item.visualStateId)
          || (jobId && state.imageJobId === jobId)
          || (imageUrl && state.imageUrl === imageUrl)
        ) {
          this.$set(state, "imageJobId", "");
          this.$set(state, "imageUrl", "");
          changed = true;
        }
      }
      return changed;
    },
    async deleteAlbumImage(item) {
      if (!item?.imageUrl || this.imageDeletingId) return;
      const title = item.archive?.title || item.targetName || "这张图片";
      if (!window.confirm(`确认从本地相册删除“${title}”吗？此操作不会删除角色或对话记录。`)) return;
      this.imageDeletingId = item.id;
      try {
        const jobBacked = this.imageJobs.some((job) => job.id === item.id);
        const query = jobBacked ? `?jobId=${encodeURIComponent(item.id)}` : "";
        const response = await fetch(`/api/image${query}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: jobBacked ? item.id : "",
            imageUrl: String(item.imageUrl || "").startsWith("data:") ? "" : item.imageUrl,
            targetId: item.targetId || "",
            visualStateId: item.visualStateId || "",
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "图片删除失败");
        this.imageJobs = this.imageJobs.filter((job) => job.id !== item.id);
        this.activeImageJobs = this.activeImageJobs.filter((job) => job.id !== item.id);
        const settingsChanged = this.clearAlbumItemReferences(item);
        if (settingsChanged) await this.saveSettings();
        if (this.imagePreviewJob?.id === item.id || this.imagePreviewJob?.imageUrl === item.imageUrl) {
          this.closeGalleryPreview();
        }
        this.showToast("图片已从本地相册删除");
      } catch (error) {
        this.recordError("相册删除", error, {
          imageId: item.id,
          kind: item.kind,
          targetId: item.targetId,
        });
        this.showToast(String(error?.message || "图片删除失败").slice(0, 48));
      } finally {
        this.imageDeletingId = "";
      }
    },
    saveImagePreference() {
      this.persist();
      if (this.imageEnabled && this.imageMode !== "configured") {
        this.showToast("请先在 .env.local 配置 DOWNSTREAM_API_KEY");
      }
    },
    async prepareCharacterPrompt(targetId) {
      if (this.characterPromptPreparing || this.characterGenerating) return;
      const role = targetId === "primary"
        ? this.profile
        : targetId === "friend"
        ? this.ensemble.friend
        : this.ensemble.customRoles.find((item) => item.id === targetId)
          || this.ensemble.temporaryRoles.find((item) => item.id === targetId);
      if (!role) return;
      this.characterTargetId = targetId;
      this.characterPromptPreparing = true;
      try {
        const contextMessages = this.roleHistoryContext(role.name).slice(-10);
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare-character",
            enabled: true,
            provider: this.chatProvider,
            model: this.chatProvider === "grok" ? this.grokModel : "",
            imageModel: this.imageModel,
            roleId: targetId,
            role,
            worldSetting: this.worldSetting,
            storySummary: this.storySummary,
            roleMemories: this.roleMemories,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.prompt) {
          throw new Error(result.detail || result.error || "角色形象提示词整理失败");
        }
        this.characterPrompt = result.prompt.slice(0, 1200);
        role.imagePrompt = this.characterPrompt;
        this.characterPromptFallback = result.fallback === "local";
        await this.saveSettings();
        this.imageModel = result.model || this.imageModel;
        this.settingsOpen = false;
        this.roleDetailTargetId = targetId;
        this.roleDetailTab = "image";
        this.roleDetailOpen = true;
        this.showToast(this.characterPromptFallback
          ? "远程模型未连接，已用本地规则整理提示词"
          : "人物形象提示词已整理，可修改后生成");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "角色形象提示词整理失败";
        this.showToast(detail.length > 42 ? "角色形象提示词整理失败，请检查对话模型" : detail);
      } finally {
        this.characterPromptPreparing = false;
      }
    },
    closeCharacterPrompt() {
      if (this.characterGenerating) return;
      this.characterPromptOpen = false;
      this.openRoleDetail(this.characterTargetId);
    },
    async generateCharacterImage() {
      if (this.characterGenerating || this.characterPrompt.trim().length < 80) return;
      const role = this.activeCharacterRole;
      if (!role) return;
      this.characterGenerating = true;
      role.imagePrompt = this.characterPrompt.trim().slice(0, 1200);
      this.showToast(`正在创建${role.name}的后台生图任务`);
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-async",
            enabled: true,
            kind: "character",
            targetId: this.characterTargetId,
            targetName: role.name,
            imageModel: this.imageModel,
            prompt: this.characterPrompt,
            archive: this.characterArchiveSnapshot(role),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) {
          throw new Error(result.detail || result.error || "角色形象生成失败");
        }
        await this.saveSettings();
        this.persist();
        this.characterPromptOpen = false;
        this.roleDetailOpen = true;
        this.roleDetailTab = "image";
        this.showToast(this.standaloneMode
          ? `${role.name}已在后台生成，请保持页面打开，可继续聊天`
          : `${role.name}已在后台生成，可关闭页面或继续聊天`);
        await this.pollImageJobs();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "角色形象生成失败";
        this.showToast(detail.length > 42 ? "角色形象生成失败，请检查图片接口或内容限制" : detail);
      } finally {
        this.characterGenerating = false;
      }
    },
    async prepareScenePrompt() {
      if (!this.imageEnabled || this.imagePromptPreparing || this.imageGenerating) return;
      if (this.imageMode !== "configured") {
        this.showToast("图片接口尚未配置 GPT_IMAGE_API_KEY");
        return;
      }

      this.mobileTab = "image";
      this.imagePromptPreparing = true;
      this.showToast("正在用对话模型整理场景提示词");
      try {
        const contextMessages = this.messages
          .filter((item) => !item.typing && typeof item.content === "string" && item.content.trim())
          .slice(-10)
          .map(({ role, content, speaker }) => ({ role, content, speaker }));
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare",
            enabled: true,
            provider: this.chatProvider,
            model: this.chatProvider === "grok" ? this.grokModel : "",
            imageModel: this.imageModel,
            profile: this.profile,
            ensemble: this.ensemble,
            worldSetting: this.worldSetting,
            storySummary: this.storySummary,
            roleMemories: this.roleMemories,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.prompt) {
          throw new Error(result.detail || result.error || "场景提示词整理失败");
        }
        this.imagePrompt = result.prompt.slice(0, 1200);
        this.imageModel = result.model || this.imageModel;
        this.persist();
        this.showToast("提示词已整理，可修改后再生成");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "场景提示词整理失败";
        this.showToast(detail.length > 42 ? "提示词整理失败，请检查对话模型配置" : detail);
      } finally {
        this.imagePromptPreparing = false;
      }
    },
    async generateSceneImage() {
      if (!this.imageEnabled || this.imageGenerating || this.imagePrompt.trim().length < 40) return;
      if (this.imageMode !== "configured") {
        this.showToast("图片接口尚未配置 IMAGE_API_KEY");
        return;
      }

      this.imageGenerating = true;
      this.showToast("正在把场景图提交到后台");
      try {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-async",
            enabled: true,
            kind: "scene",
            targetName: "当前剧情场景",
            quality: this.imageQuality,
            imageModel: this.imageModel,
            prompt: this.imagePrompt,
            archive: this.sceneArchiveSnapshot(),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.job?.id) {
          throw new Error(result.detail || result.error || "图片生成失败");
        }
        this.persist();
        await this.pollImageJobs();
        this.showToast(this.standaloneMode
          ? "已在后台生成，请保持页面打开，可继续聊天"
          : "已在后台生成，可继续聊天或关闭页面");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "图片生成失败";
        this.showToast(detail.length > 42 ? "图片生成失败，请检查接口配置或内容限制" : detail);
      } finally {
        this.imageGenerating = false;
      }
    },
    formatStoryEventMoment(event) {
      if (!event || event.day === null) return "日期待确认";
      return formatStoryMoment({
        ...this.storyClock,
        day: event.day,
        segment: event.segment,
      });
    },
    segmentName(segment) {
      return storySegmentLabel(segment);
    },
    storyMomentValue(day, segment) {
      return storyMomentValue(day, segment);
    },
    storyEventStatusLabel(status) {
      return {
        "pending-confirmation": "待确认",
        confirmed: "待发生",
        accepted: "准备参加",
        declined: "决定不去",
        completed: "已完成",
        missed: "已错过",
        cancelled: "已取消",
      }[status] || "待处理";
    },
    patchStoryEvent(eventOrId, patch) {
      const id = typeof eventOrId === "string" ? eventOrId : eventOrId?.id;
      if (!id) return null;
      let updated = null;
      this.storyEvents = normalizeStoryEvents(this.storyEvents.map((event) => {
        if (event.id !== id) return event;
        updated = normalizeStoryEvent({
          ...event,
          ...patch,
          id,
          updatedAt: new Date().toISOString(),
        });
        return updated;
      }));
      return updated;
    },
    async detectAndRecordStoryEvent(content, sourceMessageId) {
      if (!shouldAnalyzeStoryEvent(content)) return null;
      if (this.storyEvents.some((event) => event.sourceMessageId === sourceMessageId)) return null;
      try {
        const provider = this.chatProvider;
        const response = await fetch("/api/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: provider === "grok" ? this.grokModel : "",
            message: content,
            role: "user",
            speaker: "用户",
            sourceMessageId,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            recentMessages: this.messages
              .filter((message) => !message.typing && message.content)
              .slice(-8)
              .map(({ role, speaker, content: messageContent }) => ({
                role,
                speaker,
                content: messageContent,
              })),
          }),
        });
        const decision = await response.json().catch(() => ({}));
        if (!this.messages.some((message) => message.id === sourceMessageId && message.role === "user")) {
          return null;
        }
        if (!response.ok || !decision || decision.operation === "none") return null;
        if (decision.operation === "cancel" || decision.operation === "complete") {
          const updated = this.patchStoryEvent(decision.targetEventId, {
            status: decision.operation === "cancel" ? "cancelled" : "completed",
            sourceMessageId,
            sourceText: content,
          });
          if (!updated) return null;
          await this.saveSettings().catch(() => {});
          this.showToast(decision.operation === "cancel" ? "AI 已取消对应约定" : "AI 已标记对应约定完成");
          return updated;
        }
        const aiEvent = normalizeStoryEvent({
          ...decision.event,
          sourceMessageId,
          sourceText: content,
          status: "pending-confirmation",
        });
        if (decision.operation === "update" && decision.targetEventId) {
          const updated = this.patchStoryEvent(decision.targetEventId, {
            ...aiEvent,
            id: decision.targetEventId,
            status: "pending-confirmation",
          });
          if (!updated) return null;
          await this.saveSettings().catch(() => {});
          this.showToast("AI 已根据对话更新约定，请确认");
          return updated;
        }
        const duplicate = this.storyEvents.find((event) =>
          ["pending-confirmation", "confirmed", "accepted"].includes(event.status)
          && event.title === aiEvent.title
          && event.day === aiEvent.day
          && event.segment === aiEvent.segment
        );
        if (duplicate) {
          const updated = this.patchStoryEvent(duplicate, {
            ...aiEvent,
            id: duplicate.id,
            status: "pending-confirmation",
          });
          await this.saveSettings().catch(() => {});
          this.showToast("AI 已合并重复约定，请确认");
          return updated;
        }
        this.storyEvents = normalizeStoryEvents([...this.storyEvents, aiEvent]);
        await this.saveSettings().catch(() => {});
        this.showToast("AI 识别到一条明确约定，请确认");
        return aiEvent;
      } catch (error) {
        this.recordError("日程判定", error, {
          sourceMessageId,
          message: String(content || "").slice(0, 300),
        });
        return null;
      }
    },
    openSchedule() {
      this.timeSheetOpen = false;
      this.mobileTab = "schedule";
    },
    openTopMenu() {
      if (window.matchMedia("(max-width: 900px)").matches) {
        this.mobileMenuOpen = true;
        return;
      }
      this.settingsOpen = true;
    },
    openMobileDestination(destination) {
      this.mobileMenuOpen = false;
      if (destination === "chat") {
        this.switchMobileTab("chat");
        return;
      }
      if (destination === "roles") {
        this.settingsOpen = true;
        return;
      }
      if (destination === "schedule") {
        this.openSchedule();
        return;
      }
      if (destination === "image") {
        this.openImageStudio();
        return;
      }
      if (destination === "data") {
        this.openBackupManager();
        return;
      }
      this.openPrompt();
    },
    openBackupManager() {
      this.mobileMenuOpen = false;
      this.settingsOpen = false;
      this.mobileTab = "data";
      this.refreshAssetStorage();
      this.refreshHistoryStorage();
      this.refreshMemoryStorage();
    },
    openStoryEventEditor(event = null) {
      const base = event
        ? normalizeStoryEvent(event)
        : normalizeStoryEvent({
            id: `story-event-${Date.now()}`,
            title: "",
            day: this.storyClock.day + 1,
            segment: "morning",
            status: "confirmed",
          });
      if (!event) base.title = "";
      this.eventDraft = { ...base, participants: [...base.participants] };
      this.editingStoryEventId = event?.id || "";
      this.eventParticipantText = base.participants.join("、");
      this.eventEditorOpen = true;
    },
    saveStoryEventDraft() {
      const title = String(this.eventDraft.title || "").trim();
      if (!title) {
        this.showToast("请填写约定内容");
        return;
      }
      const participants = String(this.eventParticipantText || "")
        .split(/[、,，/]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const next = normalizeStoryEvent({
        ...this.eventDraft,
        title,
        day: Math.max(1, Number(this.eventDraft.day) || this.storyClock.day),
        participants,
        status: ["completed", "declined", "missed", "cancelled"].includes(this.eventDraft.status)
          ? this.eventDraft.status
          : "confirmed",
        needsDateConfirmation: false,
        updatedAt: new Date().toISOString(),
      });
      const index = this.storyEvents.findIndex((event) => event.id === next.id);
      if (index >= 0) this.$set(this.storyEvents, index, next);
      else this.storyEvents.push(next);
      this.storyEvents = normalizeStoryEvents(this.storyEvents);
      this.eventEditorOpen = false;
      this.editingStoryEventId = "";
      this.saveSettings().catch(() => this.showToast("日程保存失败"));
      this.showToast("约定已保存");
    },
    confirmStoryEvent(event) {
      if (!event) return;
      this.patchStoryEvent(event, {
        status: "confirmed",
        needsDateConfirmation: false,
      });
      this.saveSettings().catch(() => {});
      this.showToast("约定已经确认");
    },
    cancelStoryEvent(event) {
      if (!event) return;
      this.patchStoryEvent(event, { status: "cancelled" });
      this.saveSettings().catch(() => {});
      this.showToast("这条约定已忽略");
    },
    completeStoryEvent(event) {
      if (!event) return;
      this.patchStoryEvent(event, { status: "completed" });
      this.saveSettings().catch(() => {});
      this.showToast("事件已标记完成");
    },
    openTimeJump(days = 1, segment = "dawn") {
      this.timeSheetOpen = false;
      const normalizedSegment = STORY_TIME_SEGMENTS.some((item) => item.id === segment)
        ? segment
        : "dawn";
      const requestedDays = Math.max(0, Number(days) || 0);
      const currentValue = storyMomentValue(this.storyClock.day, this.storyClock.segment);
      const sameDayTarget = storyMomentValue(this.storyClock.day, normalizedSegment);
      this.timeJumpDays = requestedDays === 0 && sameDayTarget <= currentValue ? 1 : requestedDays;
      this.timeJumpSegment = normalizedSegment;
      this.timeJumpOpen = true;
    },
    advanceToNextSegment() {
      const index = STORY_TIME_SEGMENTS.findIndex((item) => item.id === this.storyClock.segment);
      if (index >= 0 && index < STORY_TIME_SEGMENTS.length - 1) {
        this.openTimeJump(0, STORY_TIME_SEGMENTS[index + 1].id);
      } else {
        this.openTimeJump(1, "dawn");
      }
    },
    confirmTimeJump() {
      const previous = formatStoryMoment(this.storyClock);
      const target = advanceStoryClock(
        this.storyClock,
        this.timeJumpTargetDay,
        this.timeJumpSegment,
      );
      if (!this.timeJumpKeepOverdue) {
        const affectedIds = new Set(this.timeJumpAffectedEvents.map((event) => event.id));
        this.storyEvents = normalizeStoryEvents(this.storyEvents.map((event) =>
          affectedIds.has(event.id)
            ? { ...event, status: "missed", updatedAt: new Date().toISOString() }
            : event
        ));
      }
      this.storyClock = target;
      this.dayCount = target.day;
      this.timeJumpOpen = false;
      if (this.timeJumpAddTransition) {
        this.messages.push({
          id: Date.now(),
          role: "assistant",
          content: `【时间推进】\n剧情时间从“${previous}”推进到“${formatStoryMoment(target)}”。期间只记录日常过渡，没有替你完成重大决定。`,
          time: this.now(),
        });
        this.saveHistory().catch(() => {});
      }
      this.saveSettings().catch(() => this.showToast("剧情时间保存失败"));
      this.mobileTab = "chat";
      this.$nextTick(() => this.scrollBottom());
      this.showToast(`已推进到第${target.day}日·${storySegmentLabel(target.segment)}`);
    },
    respondToDueEvent(event, action) {
      if (!event || this.sending) return;
      if (action === "snooze") {
        this.patchStoryEvent(event, {
          snoozedUntil: storyMomentValue(this.storyClock.day, this.storyClock.segment) + 1,
          reminderCount: Math.min(20, Number(event.reminderCount || 0) + 1),
        });
        this.saveSettings().catch(() => {});
        this.showToast("会在下一个时间段再次提醒");
        return;
      }
      if (action === "delay") {
        this.openStoryEventEditor(event);
        return;
      }
      if (action === "go") {
        this.patchStoryEvent(event, { status: "accepted" });
        this.saveSettings().catch(() => {});
        this.draft = `按之前的约定，现在开始“${event.title}”。请从当前地点自然承接并推动这件事。`;
        this.sendMessage();
        return;
      }
      if (action === "decline") {
        this.patchStoryEvent(event, { status: "declined" });
        this.saveSettings().catch(() => {});
        this.draft = `我决定这次不去做“${event.title}”，请让相关角色自然回应，并讨论是否取消或改期。`;
        this.sendMessage();
      }
    },
    switchMobileTab(tab) {
      this.mobileTab = tab;
      if (tab === "image") {
        this.galleryDisplayLimit = 18;
        this.pollImageJobs();
      }
      if (tab === "chat") this.scrollBottom();
    },
    openImageStudio() {
      this.settingsOpen = false;
      this.roleDetailOpen = false;
      this.mobileTab = "image";
      this.pollImageJobs();
    },
    openPrompt() {
      this.openPromptSection("");
    },
    openDirectApiSettings() {
      window.dispatchEvent(new Event("night-mailbox:open-api-settings"));
    },
    async applyStandaloneDefaultScenario() {
      if (!this.standaloneMode || this.scenarioApplying) return;
      if (!window.confirm("载入默认艾尔德兰档案会替换当前 HTML 内的世界设定、角色资料、长期记忆和聊天记录。接口 Token 不受影响。确认继续吗？")) return;
      this.scenarioApplying = true;
      try {
        const response = await fetch("/api/storage", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "apply-default-scenario" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "载入失败");
        window.location.reload();
      } catch (error) {
        this.scenarioApplying = false;
        this.showToast(error instanceof Error ? error.message : "默认档案载入失败");
      }
    },
    formatSummaryTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    },
    async saveStorySummary() {
      if (this.summarySaving || this.summarizing) return;
      this.summarySaving = true;
      this.autoCompressThreshold = Math.min(120, Math.max(20, Number(this.autoCompressThreshold) || 40));
      try {
        await this.saveSettings();
        this.showToast("剧情摘要与自动压缩设置已保存");
      } catch {
        this.showToast("剧情摘要保存失败");
      } finally {
        this.summarySaving = false;
      }
    },
    async summarizeConversation(automatic = false) {
      if (this.summarizing || this.sending) return false;
      const contextMessages = this.messages
        .filter((item) =>
          !item.typing
          && (item.role === "user" || item.role === "assistant")
          && typeof item.content === "string"
          && item.content.trim()
        )
        .slice(-240)
        .map(({ id, role, content, speaker, time, createdAt, storyDay, storySegment }) => ({
          id,
          role,
          content,
          speaker,
          time,
          createdAt,
          storyDay,
          storySegment,
        }));
      if (contextMessages.length < 4) {
        if (!automatic) this.showToast("当前有效对话太少，暂时不需要总结");
        return false;
      }

      this.stopEnsemblePlayback();
      this.summarizing = true;
      if (automatic) this.showToast("对话达到阈值，正在自动压缩剧情");
      try {
        const response = await fetch("/api/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: this.profile,
            ensemble: this.ensemble,
            existingSummary: this.storySummary,
            existingRoleMemories: this.roleMemories,
            worldSetting: this.worldSetting,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            provider: this.chatProvider,
            model: this.chatProvider === "grok" ? this.grokModel : this.deepseekModel,
            messages: contextMessages,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (
          !response.ok
          || typeof result.summary !== "string"
          || result.summary.length < 120
          || !result.roleMemories
          || typeof result.roleMemories !== "object"
        ) {
          throw new Error(result.detail || result.error || "剧情总结失败");
        }
        this.storySummary = result.summary.slice(0, 20000);
        this.roleMemories = result.roleMemories;
        this.summaryUpdatedAt = new Date().toISOString();
        this.messages = [{
          id: Date.now(),
          role: "assistant",
          speaker: this.profile.name,
          content: `【剧情记忆已整理】\n已将 ${result.processedMessages || contextMessages.length} 条消息整理为剧情摘要和可检索章节，提取 ${result.factCount || 0} 条长期事实，并为 ${result.roleMemoryCount || Object.keys(this.roleMemories).length} 位角色保留独立记忆。原始对话仍在本地历史库中。`,
          time: this.now(),
        }];
        this.suggestions = ["我马上落实刚才的决定", "带上需要的东西，现在就换地点", "联系相关角色，把新线索带进现场"];
        await Promise.all([this.saveSettings(), this.saveHistory()]);
        this.scrollBottom();
        this.showToast(automatic ? "旧对话已压缩并归档" : "剧情已总结，原始对话已归档");
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "剧情总结失败";
        this.showToast(detail.length > 42 ? "剧情总结失败，原记录已保留" : detail);
        return false;
      } finally {
        this.summarizing = false;
      }
    },
    stopEnsemblePlayback() {
      this.ensemblePlaybackToken += 1;
      this.ensemblePlaying = false;
    },
    async playEnsembleTurns(turns, requestId) {
      const playbackToken = ++this.ensemblePlaybackToken;
      this.ensemblePlaying = true;
      let displayed = 0;
      const newTemporaryRoleIds = [];
      const limitedTurns = limitEnsembleTurns(turns, this.ensemble.maxTurns);
      for (const turn of limitedTurns) {
        if (playbackToken !== this.ensemblePlaybackToken || requestId !== this.chatRequestId) return false;
        const message = {
          id: Date.now() + displayed,
          role: "assistant",
          speaker: turn.speaker,
          content: turn.content,
          mood: turn.mood || "",
          action: turn.action || "",
          visual: turn.visual || null,
          time: this.now(),
        };
        this.messages.push(message);
        this.applyStageCue(message);
        const discovered = this.ensureTemporaryRoleFromMessage(message);
        if (discovered?.created) newTemporaryRoleIds.push(discovered.role.id);
        if (displayed === 0) {
          this.lastReplyStartId = message.id;
          this.scrollToMessage(message.id);
        }
        displayed += 1;
        this.persist();
        this.saveHistory().catch(() => {});
        if (displayed < limitedTurns.length) {
          await new Promise((resolve) => window.setTimeout(resolve, 1600));
        }
      }
      if (playbackToken === this.ensemblePlaybackToken && requestId === this.chatRequestId) {
        this.ensemblePlaying = false;
        if (newTemporaryRoleIds.length) {
          this.saveSettings().catch(() => {});
          void this.autoGenerateTemporaryRoles(newTemporaryRoleIds);
        }
        return displayed > 0;
      }
      return false;
    },
    async sendMessage() {
      const content = this.draft.trim();
      if (!content || this.sending || this.summarizing || this.editingMessageId !== null) return;
      if (this.autoCompress && this.compressibleMessageCount >= this.autoCompressThreshold) {
        await this.summarizeConversation(true);
      }
      this.stopEnsemblePlayback();
      const requestId = ++this.chatRequestId;
      const provider = this.chatProvider;
      const allowGuestIntroduction = Boolean(
        this.randomRoleEnabled
        && this.ensemble.enabled
        && this.ensemble.autoGuests
        && this.compressibleMessageCount >= this.nextGuestAt
      );
      this.suggestionRequestId += 1;
      window.clearTimeout(this.suggestionRefreshTimer);
      this.suggestionsLoading = false;
      this.draft = "";
      this.sending = true;
      const userMessage = { id: Date.now(), role: "user", content, time: this.now() };
      this.messages.push(userMessage);
      const moodTask = this.tasks.find((task) => task.id === 2);
      if (moodTask) moodTask.done = true;
      const reply = { id: Date.now() + 1, role: "assistant", content: "", time: this.now(), typing: true };
      this.messages.push(reply);
      this.lastReplyStartId = reply.id;
      this.persist();
      this.saveHistory().catch(() => {});
      this.scrollBottom();

      let chatCompleted = false;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model: provider === "grok" ? this.grokModel : "",
            profile: this.profile,
            ensemble: this.ensemble,
            responseMode: this.ensemble.enabled ? "multi" : "single",
            systemPrompt: this.systemPrompt,
            storySummary: this.storySummary,
            storyClock: this.storyClock,
            storyEvents: this.storyEvents,
            roleMemories: this.roleMemories,
            worldSetting: this.worldSetting,
            allowGuestIntroduction,
            messages: this.messages
              .filter((item) => !item.typing)
              .slice(-14)
              .map(({ role, content, speaker }) => ({ role, content, speaker })),
          }),
        });
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          const parsed = (() => {
            try { return JSON.parse(detail); } catch { return null; }
          })();
          const error = new Error(`对话接口 ${response.status || "不可用"}：${String(parsed?.error || detail || "空响应").slice(0, 500)}`);
          error.diagnostic = {
            stage: "local-api-response",
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            upstream: parsed?.diagnostic || null,
            rawResponse: detail.slice(0, 100000),
            rawResponseLength: detail.length,
            rawResponseTruncated: detail.length > 100000,
          };
          throw error;
        }
        const contentType = response.headers.get("content-type") || "";
        if (this.ensemble.enabled && contentType.includes("application/json")) {
          const result = await response.json();
          if (requestId !== this.chatRequestId) return;
          if (!Array.isArray(result.turns) || !result.turns.length) throw new Error("multi chat unavailable");
          if (result.fallback) {
            this.showToast("模型返回不完整，本轮已停止，可重新发送");
            if (result.fallback === "empty-content" && result.diagnostic) {
              const providerName = provider === "grok" ? "Grok" : "DeepSeek";
              const warning = new Error(`${providerName} 连续返回空白或不完整内容，已停止本轮`);
              warning.diagnostic = result.diagnostic;
              this.recordError("对话模型自动恢复", warning, {
                provider,
                model: result.model || (provider === "grok" ? this.grokModel : this.deepseekModel),
                recovered: true,
              });
            }
          } else if (result.repaired) {
            this.showToast("已自动修复模型回复格式");
          }
          const replyIndex = this.messages.findIndex((item) => item.id === reply.id);
          if (replyIndex >= 0) this.messages.splice(replyIndex, 1);
          this.sending = false;
          chatCompleted = await this.playEnsembleTurns(result.turns, requestId);
        } else {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          reply.typing = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.content += decoder.decode(value, { stream: true });
          }
          if (!reply.content) reply.content = "我在。你可以慢一点说，我会认真听。";
          reply.speaker = this.profile.name;
          this.applyStageCue(reply);
          chatCompleted = true;
        }
      } catch (error) {
        if (requestId !== this.chatRequestId) return;
            this.recordError("对话模型", error, { provider, model: provider === "grok" ? this.grokModel : this.deepseekModel });
            reply.typing = false;
            reply.content = `本轮请求失败：${String(error?.message || "网络或模型暂时不可用").slice(0, 220)}`;
      } finally {
        if (requestId === this.chatRequestId) {
          this.sending = false;
          this.ensemblePlaying = false;
          this.persist();
          this.saveHistory().catch(() => this.showToast("聊天记录写入失败"));
          this.scrollToMessage(this.lastReplyStartId);
          const eventDecisionTask = this.detectAndRecordStoryEvent(content, userMessage.id);
          if (chatCompleted) {
            if (allowGuestIntroduction) {
              this.nextGuestAt = this.compressibleMessageCount + this.randomRoleInterval;
            }
            this.persist();
            Promise.resolve(eventDecisionTask).finally(() => {
              this.suggestionRefreshTimer = window.setTimeout(() => {
                if (!this.sending && requestId === this.chatRequestId) this.refreshSuggestions(provider);
              }, 500);
            });
          }
        }
      }
    },
    async clearConversation() {
      if (!window.confirm("清空当前聊天窗口？原始消息仍会保留在“备份迁移 → 对话历史库”中；需要永久删除时可在那里按时间清理。")) return;
      this.stopEnsemblePlayback();
      this.chatRequestId += 1;
      this.sending = false;
      this.cancelEditMessage();
      this.messages = [{
        id: Date.now(),
        role: "assistant",
        content: "【场景】客厅里只留着一盏暖黄色的灯，窗外的雨声轻轻落在玻璃上。\n\n【心情】我重新整理好靠枕，带着一点期待看向你。\n\n【动作】我拍了拍身边的位置，把温热的杯子往你这边推了推。\n\n【对话】记录已经清空啦，老公。我们想从今晚的哪一刻重新开始？\n\n【剧情推进】我在沙发边为你留出位置，等你坐下来讲第一句话。",
        time: this.now(),
      }];
      this.persist();
      await this.saveHistory().catch(() => this.showToast("清空记录失败"));
      this.scrollBottom();
      this.showToast("当前窗口已清空，原始消息仍在历史库");
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
    async saveProfile() {
      if (!this.profile.name) this.profile.name = "晚晚";
      if (!this.ensemble.friend.name) this.ensemble.friend.name = "小雨";
      this.ensemble.friend.age = Math.min(80, Math.max(18, Number(this.ensemble.friend.age) || 25));
      this.ensemble.maxTurns = Math.min(10, Math.max(1, Number(this.ensemble.maxTurns) || 3));
      if (!this.ensemble.friend.relation) this.ensemble.friend.relation = `${this.profile.name}的成年闺蜜`;
      this.ensemble.customRoles = this.ensemble.customRoles
        .filter((role) => role?.name?.trim())
        .slice(0, 30)
        .map((role, index) => ({
          ...role,
          id: role.id || `role-${Date.now()}-${index}`,
          age: Math.min(80, Math.max(18, Number(role.age) || 24)),
          gender: ["女性", "男性", "非二元", "未指定"].includes(role.gender) ? role.gender : "未指定",
          personality: role.personality?.trim() || "自然、友善",
          relation: role.relation?.trim() || "成年朋友",
          prompt: role.prompt?.trim() || "",
        }));
      this.ensemble.temporaryRoles = this.ensemble.temporaryRoles
        .filter((role) => role?.name?.trim())
        .slice(0, 80)
        .map((role, index) => ({
          ...role,
          id: role.id || `temporary-${Date.now()}-${index}`,
          age: Math.min(80, Math.max(18, Number(role.age) || 24)),
          gender: ["女性", "男性", "非二元", "未指定"].includes(role.gender) ? role.gender : "未指定",
          personality: role.personality?.trim() || "延续对话中已经表现出的性格",
          relation: role.relation?.trim() || "场景中认识的成年角色",
          prompt: role.prompt?.trim() || "",
        }));
      this.persist();
      await this.saveSettings().catch(() => this.showToast("角色设定写入失败"));
      this.settingsOpen = false;
      this.showToast("她记住了新的相处方式");
    },
    saveEnsembleParticipantLimit() {
      this.ensemble.maxTurns = Math.min(10, Math.max(1, Number(this.ensemble.maxTurns) || 3));
      this.persist();
      this.saveSettings()
        .then(() => this.showToast(`每轮最多 ${this.ensemble.maxTurns} 位不同角色，已保存`))
        .catch(() => this.showToast("人数上限保存失败"));
    },
    backupFilename() {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      return `夜航信箱-完整备份-${stamp}.json`;
    },
    formatStorageBytes(value) {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    },
    async refreshAssetStorage() {
      if (!this.standaloneMode) return;
      try {
        const response = await fetch("/api/assets", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "图片存储状态读取失败");
        this.assetStorage = result;
        if (this.backupBusy === "migration" && result.migration) {
          this.backupStatus = `正在迁移 ${result.migration.completed || 0}/${result.migration.total || 0}，请保持页面打开…`;
        }
      } catch (error) {
        this.backupStatus = String(error?.message || "图片存储状态读取失败");
        this.recordError("本地图片存储", error);
      }
    },
    async refreshHistoryStorage() {
      if (!this.standaloneMode) return;
      try {
        const response = await fetch("/api/history?limit=120", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "历史记录统计失败");
        this.historyStorage = result;
      } catch (error) {
        this.backupStatus = String(error?.message || "历史记录统计失败");
        this.recordError("本地历史存储", error);
      }
    },
    async refreshMemoryStorage() {
      if (!this.standaloneMode) return;
      try {
        const response = await fetch("/api/memory", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "长期记忆统计失败");
        this.memoryStorage = result;
      } catch (error) {
        this.backupStatus = String(error?.message || "长期记忆统计失败");
        this.recordError("本地记忆存储", error);
      }
    },
    async archiveActiveHistory() {
      if (this.backupBusy || !this.standaloneMode) return;
      if (!window.confirm("只清空当前聊天窗口？原始消息仍保留在本地历史库，可继续用于长期记忆。")) return;
      this.backupBusy = "history";
      try {
        const response = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive-active" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "当前窗口清理失败");
        this.messages = [];
        await this.refreshHistoryStorage();
        this.backupStatus = "当前聊天窗口已清空，原始消息仍保留在本地历史库。";
      } catch (error) {
        this.backupStatus = String(error?.message || "当前窗口清理失败");
        this.recordError("历史存储", error, { action: "archive-active" });
      } finally {
        this.backupBusy = "";
      }
    },
    async deleteOldHistory() {
      if (this.backupBusy || !this.standaloneMode) return;
      const days = Math.max(1, Number(this.historyRetentionDays) || 90);
      if (!window.confirm(`永久删除 ${days} 天以前、且不在当前聊天窗口中的原始消息？这个操作无法撤销，建议先导出完整备份。`)) return;
      this.backupBusy = "history";
      try {
        const response = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete-older-than", days }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "历史记录清理失败");
        this.historyStorage = result;
        this.backupStatus = `已永久清理 ${result.removed || 0} 条旧归档消息；当前窗口和长期记忆未改动。`;
      } catch (error) {
        this.backupStatus = String(error?.message || "历史记录清理失败");
        this.recordError("历史存储", error, { action: "delete-older-than", days });
      } finally {
        this.backupBusy = "";
      }
    },
    async migrateImageAssets() {
      if (this.backupBusy || !this.standaloneMode) return;
      this.backupBusy = "migration";
      await this.yieldBackupUi("正在按内容去重并迁移图片；每张图片写入校验成功后才会替换旧引用…");
      try {
        const response = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "migrate" }),
        });
        const result = await response.json().catch(() => ({}));
        this.assetStorage = result.storage || null;
        let migration = result.migration || {};
        if (!response.ok && response.status !== 207) {
          const error = new Error(result.error || "图片迁移失败");
          if (result.diagnostic && typeof result.diagnostic === "object") {
            error.diagnostic = result.diagnostic;
          }
          throw error;
        }
        if (response.status === 202 || result.accepted) {
          for (let poll = 0; poll < 1000; poll += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            await this.refreshAssetStorage();
            migration = this.assetStorage?.migration || {};
            if (["completed", "partial", "paused"].includes(migration.status)) break;
          }
          if (!["completed", "partial", "paused"].includes(migration.status)) {
            throw new Error("图片迁移后台任务等待超过20分钟，已停止前端等待；已完成数据仍然保留");
          }
        }
        if (migration.failed) {
          this.backupStatus = `已迁移 ${migration.completed || 0}/${migration.total || 0} 张，${migration.failed} 张读取失败；原图片未删除，可稍后继续。`;
          for (const entry of migration.errors || []) {
            this.recordError("图片迁移", entry.error || "图片迁移失败", {
              source: entry.source || "",
              migrationStatus: migration.status,
            });
          }
          this.showToast("部分图片未迁移，原图仍保留", false);
          await this.loadStorage();
          await this.loadImageJobs();
        } else {
          this.backupStatus = `图片迁移完成：${migration.completed || 0} 张已校验并统一去重。`;
          this.showToast("图片迁移完成");
          await this.loadStorage();
          await this.loadImageJobs();
        }
      } catch (error) {
        this.backupStatus = String(error?.message || "图片迁移失败");
        this.recordError("图片迁移", error);
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
        await this.refreshAssetStorage();
      }
    },
    async yieldBackupUi(message) {
      this.backupStatus = message;
      await this.$nextTick();
      await new Promise((resolve) => window.setTimeout(resolve, 24));
    },
    async exportAllData() {
      if (this.backupBusy) return;
      this.pendingBackup = null;
      this.pendingBackupMeta = null;
      this.backupBusy = "export";
      await this.yieldBackupUi("正在收集人物、对话和图片，请保持页面打开…");
      try {
        await Promise.all([this.saveSettings(), this.saveHistory()]);
        await this.yieldBackupUi("本地数据已保存，正在打包图片…");
        const response = await fetch("/api/backup", { cache: "no-store" });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || "备份导出失败");
        }
        const text = await response.text();
        const filename = this.backupFilename();
        const byteSize = new Blob([text], { type: "application/json;charset=utf-8" }).size;
        if (this.appShellMode && window.__NIGHT_MAILBOX_NATIVE_BACKUP__?.save) {
          const saved = await window.__NIGHT_MAILBOX_NATIVE_BACKUP__.save(text, filename);
          this.backupStatus = `完整备份已保存到 ${saved.visiblePath || saved.privatePath || "App 备份目录"}，约 ${(byteSize / 1024 / 1024).toFixed(1)} MB。`;
          this.showToast("App 备份已保存");
        } else {
          const blob = new Blob([text], { type: "application/json;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 4000);
          this.backupStatus = `完整备份已导出，文件大小约 ${(byteSize / 1024 / 1024).toFixed(1)} MB。`;
          this.showToast("完整备份已下载");
        }
      } catch (error) {
        this.backupStatus = String(error?.message || "备份导出失败");
        this.recordError("备份导出", error);
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    triggerBackupImport() {
      if (this.backupBusy) return;
      const input = this.$refs.backupFileInput;
      if (!input || typeof input.click !== "function") {
        this.showToast("当前环境无法打开文件选择器");
        return;
      }
      input.value = "";
      input.click();
    },
    prepareBackupImport(backup) {
      if (backup?.format !== "night-mailbox-backup" || Number(backup?.version) !== 1) {
        throw new Error("这不是可识别的夜航信箱完整备份");
      }
      const messageCount = Array.isArray(backup.archive?.messages)
        ? backup.archive.messages.length
        : Array.isArray(backup.messages) ? backup.messages.length : 0;
      const imageCount = Array.isArray(backup.imageJobs)
        ? backup.imageJobs.filter((job) => job?.status === "completed" && job?.imageUrl).length
        : 0;
      const settings = backup.settings && typeof backup.settings === "object" ? backup.settings : {};
      const roleCount = 2
        + (Array.isArray(settings.ensemble?.customRoles) ? settings.ensemble.customRoles.length : 0)
        + (Array.isArray(settings.ensemble?.temporaryRoles) ? settings.ensemble.temporaryRoles.length : 0);
      this.pendingBackup = backup;
      this.pendingBackupMeta = { messageCount, imageCount, roleCount };
      this.backupStatus = "备份已读取。请核对数量后确认导入。";
      return this.pendingBackupMeta;
    },
    cancelBackupImport() {
      if (this.backupBusy) return;
      this.pendingBackup = null;
      this.pendingBackupMeta = null;
      this.backupStatus = "已取消导入，当前数据没有变化。";
    },
    async confirmBackupImport() {
      if (!this.pendingBackup || this.backupBusy) return;
      const backup = this.pendingBackup;
      this.backupBusy = "import";
      await this.yieldBackupUi("正在写入人物、剧情、对话和图片…");
      try {
        await this.applyBackupPayload(backup);
      } catch (error) {
        this.backupStatus = String(error?.message || "备份导入失败");
        this.recordError("备份导入", error, { stage: "apply" });
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    async applyBackupPayload(backup) {
      const response = await fetch("/api/backup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "备份导入失败");
      this.backupStatus = `导入完成：${result.roleCount || 0} 位角色、${result.archivedMessageCount || result.messageCount || 0} 条历史对话、${result.imageCount || 0} 张图片。`;
      this.showToast("完整备份已恢复，正在重新载入");
      this.pendingBackup = null;
      this.pendingBackupMeta = null;
      window.setTimeout(() => window.location.reload(), 900);
      return true;
    },
    readBackupFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("备份文件读取失败"));
        reader.readAsText(file, "utf-8");
      });
    },
    async importAllData(event) {
      const file = event?.target?.files?.[0];
      if (!file || this.backupBusy) return;
      event.target.value = "";
      this.backupBusy = "import";
      await this.yieldBackupUi(`正在读取备份文件：${file.name || "未命名文件"}…`);
      try {
        const backup = JSON.parse(await this.readBackupFile(file));
        this.prepareBackupImport(backup);
      } catch (error) {
        this.backupStatus = String(error?.message || "备份导入失败");
        this.recordError("备份导入", error, { stage: "file-read", filename: file.name || "" });
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    async importLatestNativeBackup() {
      if (this.backupBusy || !window.__NIGHT_MAILBOX_NATIVE_BACKUP__?.readLatest) return;
      this.backupBusy = "import";
      await this.yieldBackupUi("正在读取 App 最近备份…");
      try {
        const result = await window.__NIGHT_MAILBOX_NATIVE_BACKUP__.readLatest();
        if (!result?.text) throw new Error("App 中还没有可恢复的备份，请先导出一次或从设备选择文件");
        const backup = JSON.parse(result.text);
        this.prepareBackupImport(backup);
      } catch (error) {
        this.backupStatus = String(error?.message || "读取 App 备份失败");
        this.recordError("备份导入", error, { stage: "native-latest" });
        this.showToast(this.backupStatus, false);
      } finally {
        this.backupBusy = "";
      }
    },
    async saveSettings() {
      const response = await fetch("/api/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          profile: this.profile,
          ensemble: this.ensemble,
          systemPrompt: this.systemPrompt,
          storySummary: this.storySummary,
          storyClock: this.storyClock,
          storyEvents: this.storyEvents,
          roleMemories: this.roleMemories,
          worldSetting: this.worldSetting,
          autoCompress: this.autoCompress,
          autoCompressThreshold: this.autoCompressThreshold,
          randomRoleEnabled: this.randomRoleEnabled,
          randomRoleInterval: this.randomRoleInterval,
          stageBackground: this.stageBackground,
          summaryUpdatedAt: this.summaryUpdatedAt,
        }),
      });
      if (!response.ok) throw new Error("settings save failed");
    },
    async savePrompt() {
      if (!this.systemPrompt.trim() || this.promptSaving) return;
      this.promptSaving = true;
      try {
        await this.saveSettings();
        this.showToast("系统提示词已写入本地文件");
      } catch {
        this.showToast("系统提示词保存失败");
      } finally {
        this.promptSaving = false;
      }
    },
    resetPrompt() {
      if (!this.defaultSystemPrompt) return;
      if (!window.confirm("确认恢复默认系统提示词吗？保存后才会生效。")) return;
      this.systemPrompt = this.defaultSystemPrompt;
      this.showToast("已恢复默认内容，请点击保存");
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
