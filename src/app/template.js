/** Root Vue template. Feature behavior lives outside this file. */
export const appTemplate = `
    <div class="app-shell">
      <header class="brand-bar">
        <button class="brand" @click="mobileTab = 'chat'" aria-label="返回聊天">
          <span class="brand-mark">夜</span>
          <span><b>夜航信箱</b><small>NIGHT MAILBOX</small></span>
        </button>
        <button type="button" class="brand-story-clock" @click="openStorySkip" :disabled="storySkipping" aria-label="跳过当前剧情">
          <b>跳过当前剧情</b>
          <small>{{ storySkipping ? '正在推进剧情…' : '让故事继续向前' }}</small>
        </button>
        <div class="brand-actions">
          <button class="prompt-shortcut" @click="openImageStudio">生图</button>
          <button class="prompt-shortcut" @click="openPrompt">提示词</button>
          <button class="icon-button mobile-menu-trigger" @click="openTopMenu" aria-label="打开功能菜单">⚙</button>
        </div>
      </header>

      <button v-if="setupReminder" type="button" class="setup-reminder-banner" @click="openSetupReminder">
        <span>●</span>
        <b>{{ setupReminder }}</b>
        <small>点击继续配置 ›</small>
        <i class="setup-reminder-dismiss" @click.stop="dismissSetupReminder" aria-label="关闭剧情提醒">×</i>
      </button>

      <div class="workspace" :class="{ 'prompt-mode': mobileTab === 'prompt', 'image-mode': mobileTab === 'image', 'data-mode': mobileTab === 'data', 'connection-mode': mobileTab === 'connection' }">
        <aside class="profile-panel" :class="{ 'mobile-active': mobileTab === 'profile' }">
          <button type="button" class="portrait-card portrait-button" @click="openRoleDetail('primary')" aria-label="查看主角色详情">
            <img v-local-image="{ src: profile.avatarUrl || defaultAvatarUrl, thumbnail: true }" :src="profile.avatarUrl || defaultAvatarUrl" :alt="profile.name + '的头像'" />
            <div class="portrait-shade"></div>
            <div class="portrait-copy">
              <span class="online-dot"></span>
              <p>今晚也在</p>
              <h1>{{ profile.name }}</h1>
              <div class="profile-meta">{{ roleDerivedSummary(profile) }} · {{ profile.relation }}</div>
              <div v-if="ensemble.enabled" class="ensemble-meta">多人场景 · {{ fixedFriendAvailable ? '含固定角色 ' + ensemble.friend.name : '按当前角色库安排' }}</div>
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
              <img v-local-image="{ src: profile.avatarUrl || defaultAvatarUrl, thumbnail: true }" :src="profile.avatarUrl || defaultAvatarUrl" alt="" />
              <span><b>{{ profile.name }}</b><small>{{ profile.relation }} · 主角色</small></span>
              <em>主</em>
            </button>
            <button v-if="fixedFriendAvailable" type="button" class="cast-roster-item" @click="openRoleDetail('friend')">
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
                <img v-if="!message.speaker || message.speaker === profile.name" v-local-image="{ src: profile.avatarUrl || defaultAvatarUrl, thumbnail: true }" :src="profile.avatarUrl || defaultAvatarUrl" alt="" />
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

          <div class="suggestion-block inspiration-block" :class="{ loading: suggestionsLoading, open: suggestionsVisible }">
            <div class="suggestion-label">
              <span>{{ ensemblePlaying ? '角色正在接话，你可以随时插话' : (suggestionsLoading ? '正在整理三个剧情方向…' : (suggestionsVisible ? '这些只是方向，点一下填入输入框后还可以修改' : '卡住时再向 AI 要灵感，不会每轮自动生成')) }}</span>
              <i v-if="suggestionsLoading || ensemblePlaying" aria-hidden="true"></i>
              <span v-if="currentSuggestionStyle" class="suggestion-style-tag">更{{ currentSuggestionStyle }}</span>
              <button v-if="ensemblePlaying" type="button" @click="stopEnsemblePlayback">暂停接话</button>
              <button v-if="lastReplyStartId" type="button" @click="scrollToMessage(lastReplyStartId)">回到本轮开头</button>
            </div>
            <button v-if="!suggestionsVisible" type="button" class="inspiration-trigger" @click="requestSuggestions" :disabled="suggestionsLoading || sending || summarizing || ensemblePlaying || editingMessageId !== null">💡 给我点灵感</button>
            <div v-else class="suggestions">
              <button v-for="item in suggestions" :key="item" @click="quickSend(item)" :disabled="suggestionsLoading || sending || summarizing || ensemblePlaying || editingMessageId !== null">{{ item }}</button>
              <button type="button" class="suggestion-refresh" title="换一组（随机风格：更冒险 / 更保守 / 更幽默）" aria-label="换一组快捷回复" :disabled="suggestionsLoading || sending || summarizing || ensemblePlaying || editingMessageId !== null" @click="rerollSuggestions">⟳</button>
              <button type="button" class="suggestion-dismiss" @click="dismissSuggestions">收起</button>
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
            <div class="day-title"><div><span>多人剧情</span><h2>{{ ensemble.enabled ? '角色共同生活中' : '当前为单人场景' }}</h2></div><strong>{{ 1 + (fixedFriendAvailable ? 1 : 0) + ensemble.customRoles.length }}<small>人</small></strong></div>
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
            <small>{{ randomRoleEnabled ? '新剧情可自然引入符合场景的成年角色' : '不会主动引入随机角色' }}</small>
          </section>

          <section class="background-job-card" v-if="activeImageJobs.length">
            <div class="section-label"><span>后台生图</span><em>{{ activeImageJobs.length }}</em></div>
            <div v-for="job in activeImageJobs" :key="job.id" class="background-job-row">
              <span class="job-spinner"></span>
              <div><b>{{ job.targetName || '角色形象' }}</b><small>{{ imageJobStatusText(job) }}</small></div>
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
            <span>当前位置</span>
            <input v-model.trim="storyClock.location" maxlength="120" placeholder="地点尚未记录，点这里填写" />
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
              <h2>世界与剧情</h2>
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
              <div class="prompt-meta-actions">
                <small>{{ worldSetting.length }}/12000</small>
                <button type="button" class="copy-text-button" @click="copyText(worldSetting, '世界设定')" :disabled="!worldSetting.trim()">复制</button>
              </div>
            </div>
            <textarea
              v-model="worldSetting"
              maxlength="12000"
              spellcheck="false"
              aria-label="世界设定"
              placeholder="例如：现代都市、魔法大陆、太空殖民地……写一句想法后可让 AI 补全。"
            ></textarea>
            <section v-if="worldSyncPending" class="world-sync-warning">
              <div><b>世界已更新到第 {{ worldVersion }} 版</b><small>核心人物仍来自较早版本。长期记忆和已经发生的剧情不会自动删除。</small></div>
              <p>你可以让 AI 只适配冲突的身份、职业和外观，或完整保留人物，仅让之后的回复遵守新世界规则。</p>
              <div><button type="button" @click="adaptCoreRoleToWorld" :disabled="roleProfileGenerating || !chatConnectionVerified">{{ roleProfileGenerating ? '正在适配…' : 'AI 适配核心人物' }}</button><button type="button" @click="keepCoreRoleAfterWorldChange">保留人物与记忆</button></div>
            </section>
            <div class="world-generation-controls">
              <label class="field-label">给 AI 的创作方向
                <input v-model.trim="worldSeed" maxlength="500" placeholder="例如：丰富魔法阶级、城市、组织与可发展的剧情线索" />
              </label>
              <button type="button" class="prompt-reset" @click="generateWorldSetting" :disabled="worldGenerating">
                {{ worldGenerating ? 'AI 正在整理…' : '让 AI 生成/完善' }}
              </button>
            </div>
            <div class="memory-compression-settings compact">
              <label><input v-model="randomRoleEnabled" type="checkbox" /><span><b>合理引入新角色</b><small>只在新一天、新地点、任务或新剧情时考虑加入符合场景的成年人</small></span></label>
              <label class="memory-threshold">间隔参考 <b>{{ randomRoleInterval }} 条</b><input v-model.number="randomRoleInterval" type="range" min="8" max="60" step="2" /></label>
              <label class="action-style-field">主角行动倾向
                <small>用于快捷回复生成的隐式约束</small>
                <select v-model="actionStyle" @change="saveActionStyle">
                  <option value="观察型">观察型 · 先观察、询问再行动</option>
                  <option value="行动型">行动型 · 直接执行、推进任务</option>
                  <option value="幽默型">幽默型 · 轻松俏皮、带玩笑感</option>
                  <option value="谨慎型">谨慎型 · 稳妥安全、留有余地</option>
                </select>
              </label>
            </div>
            <div class="prompt-actions">
              <span></span>
              <button class="prompt-save" @click="saveWorldSetting" :disabled="worldGenerating || summarySaving">保存世界设定</button>
            </div>
          </div>
          <div ref="memoryEditor" class="prompt-editor-card story-memory-card" :class="{ focused: promptSection === 'memory' }">
            <div class="prompt-editor-meta">
              <span><i></i> 3 · 剧情与角色长期记忆</span>
              <div class="prompt-meta-actions">
                <small>{{ storySummary.length }}/20000 · {{ roleMemoryCount }} 位人物记忆 · 当前 {{ compressibleMessageCount }} 条消息</small>
                <button type="button" class="copy-text-button" @click="copyText(storySummary, '剧情摘要')" :disabled="!storySummary.trim()">复制</button>
              </div>
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
              <span>{{ summaryUpdatedAt ? '最近总结：' + formatSummaryTime(summaryUpdatedAt) : (storySummary.trim() ? '已有手动保存的摘要' : '尚未生成剧情摘要') }}</span>
              <span>摘要与设置保存在当前设备</span>
            </div>
            <div class="prompt-actions memory-actions">
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
              <small>{{ 1 + (fixedFriendAvailable ? 1 : 0) + ensemble.customRoles.length + ensemble.temporaryRoles.length }} 位</small>
            </div>
            <p>每个人物只保留一份“人物提示词”和一份“稳定外观”。生图提示词只用于图片模型，不参与对话。</p>
            <div class="managed-role-grid">
              <button type="button" @click="openRoleDetail('primary')"><b>{{ profile.name }}</b><small>主角色 · {{ profile.prompt ? '已设置' : '使用默认' }}</small></button>
              <button v-if="fixedFriendAvailable" type="button" @click="openRoleDetail('friend')"><b>{{ ensemble.friend.name }}</b><small>固定角色 · {{ ensemble.friend.prompt ? '已设置' : '使用默认' }}</small></button>
              <button v-for="role in ensemble.customRoles" :key="role.id" type="button" @click="openRoleDetail(role.id)"><b>{{ role.name }}</b><small>固定角色 · {{ role.prompt ? '已设置' : '使用默认' }}</small></button>
              <button v-for="role in ensemble.temporaryRoles" :key="role.id" type="button" @click="openRoleDetail(role.id)"><b>{{ role.name }}</b><small>临时档案 · {{ role.prompt ? '已设置' : '使用默认' }}</small></button>
            </div>
          </div>
          <details class="advanced-prompt-section" :open="promptSection === 'system'">
            <summary>4 · 回复风格（最低优先级）</summary>
            <div class="prompt-editor-card">
            <div class="prompt-editor-meta">
              <span><i></i> 通用表达与输出风格</span>
              <div class="prompt-meta-actions">
                <small>{{ systemPrompt.length }}/12000</small>
                <button type="button" class="copy-text-button" @click="copyText(systemPrompt, '系统提示词')" :disabled="!systemPrompt.trim()">复制</button>
              </div>
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
              <span>保存在当前设备</span>
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
            <b>数据保存在当前设备</b>
            <p>角色、对话、相册与 API 配置均由浏览器本地保存，不需要数据库，也不会写入网站构建文件。清理浏览器数据前请先导出备份。</p>
          </div>
        </section>

        <section class="image-studio-panel" v-if="mobileTab === 'image'" :class="{ 'mobile-active': true }">
          <div class="prompt-page-header">
            <div>
              <div class="eyebrow">IMAGE STUDIO</div>
              <h2>场景图片工作台</h2>
              <p>从当前剧情整理画面提示词，确认或修改后再提交。页面保持打开时任务会继续执行。</p>
            </div>
            <button @click="switchMobileTab('chat')" aria-label="返回聊天">×</button>
          </div>

          <nav class="album-tabs" aria-label="图片相册分类">
            <button type="button" :class="{ active: galleryTab === 'scene' }" @click="galleryTab = 'scene'">
              <span>场景相册</span><em>{{ sceneAlbumCount }}</em>
            </button>
            <button type="button" :class="{ active: galleryTab === 'character' }" @click="galleryTab = 'character'">
              <span>人物相册</span><em>{{ characterAlbumCount }}</em>
            </button>
          </nav>

          <section v-if="galleryTab === 'scene'" class="image-studio-editor">
            <div class="image-studio-toolbar">
              <label class="model-manager-toggle">
                <span><b>允许图片生成</b><small>生图失败不自动重试，每次提交只调用一次图片接口</small></span>
                <input v-model="imageEnabled" type="checkbox" @change="saveImagePreference" :disabled="!imageConnectionVerified" />
              </label>
              <label class="field-label">图片模型
                <select :value="imageModel" @change="setImageModel($event.target.value)" :disabled="imageModelsLoading || !imageCatalogVerified">
                  <option value="" disabled>请选择图片模型</option>
                  <option v-for="model in availableImageModels" :key="model" :value="model">{{ imageModelLabel(model) }}</option>
                </select>
              </label>
            </div>
            <div v-if="directApiMode" class="image-key-channel image-key-channel-studio"><span><b>图片连接状态</b><small>所选模型使用连接中心保存的单一图片 Key</small></span><em :class="{ ready: currentImageKeyConfigured }">{{ activeImageKeyStatus }}</em></div>
            <div class="image-prompt-meta">
              <span>{{ imageModelLabel(imageModel) }} · {{ imageModelSpec(imageModel, 'scene') }}</span>
              <div class="prompt-meta-actions">
                <small>{{ imagePrompt.length }}/1200</small>
                <button type="button" class="copy-text-button" @click="copyText(imagePrompt, '场景生图提示词')" :disabled="!imagePrompt.trim()">复制提示词</button>
              </div>
            </div>
            <textarea
              v-model="imagePrompt"
              maxlength="1200"
              spellcheck="false"
              aria-label="可编辑的当前场景图片提示词"
              placeholder="点击“从当前剧情整理”，或直接输入要生成的画面…"
              @input="persist"
            ></textarea>
            <div class="image-style-presets">
              <span>风格预设</span>
              <button
                v-for="preset in imageStylePresets"
                :key="preset"
                type="button"
                :class="{ active: imageStylePreset === preset && !imageStyleCustom }"
                :disabled="imagePromptPreparing || imageGenerating || !imageEnabled"
                @click="applySceneImageStyle(preset)"
              >{{ preset }}</button>
              <input
                v-model.trim="imageStyleCustom"
                maxlength="200"
                placeholder="自定义风格，如：赛博朋克霓虹、水彩绘本…"
                aria-label="自定义画面风格"
                @keydown.enter.prevent="applySceneCustomStyle"
              />
              <button type="button" class="prompt-reset" :disabled="!imageStyleCustom || imagePromptPreparing || imageGenerating || !imageEnabled" @click="applySceneCustomStyle">按此风格整理</button>
              <button v-if="imageStylePreset || imageStyleCustom" type="button" class="style-clear" @click="clearSceneImageStyle">清除风格</button>
            </div>
            <p class="image-prompt-warning">提交前可自由修改。每次提交只调用一次图片接口，失败时会保留最终提示词和错误信息，不会自动重试扣费。</p>
            <div class="image-prompt-actions">
              <button class="prompt-reset" @click="prepareScenePrompt" :disabled="imagePromptPreparing || imageGenerating || !imageEnabled">
                {{ imagePromptPreparing ? '正在整理场景…' : '从当前剧情整理' }}
              </button>
              <button class="prompt-save" @click="generateSceneImage" :disabled="imageGenerating || !imageEnabled || !currentImageKeyConfigured || imagePrompt.trim().length < 40">
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
              <em>{{ galleryTab === 'scene' ? sceneAlbumCount : characterAlbumCount }} 张成功 · {{ galleryJobs.length }} 个任务</em>
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
                <small>{{ job.status === 'failed' ? '生成失败' : (job.status === 'queued' ? '排队中' : '生成中') }}</small>
              </div>
              <div class="image-job-copy">
                <div><b>{{ imageJobTitle(job) }}</b><time>{{ formatSummaryTime(job.archive?.capturedAt || job.updatedAt) }}</time></div>
                <p :class="{ 'image-job-error': job.status === 'failed' }">{{ imageJobStatusText(job) }}</p>
                <p v-if="isCharacterAlbumItem(job)" class="album-summary">
                  {{ [job.archive?.relation, job.archive?.personality].filter(Boolean).join(' · ') || job.archive?.introduction || '人物资料快照保存在本地相册。' }}
                </p>
                <p v-else class="album-summary">
                  {{ job.archive?.eventSummary || job.archive?.scene || job.prompt || '当前剧情事件已随图片单独保存。' }}
                </p>
                <small v-if="job.archive?.summaryGenerated">AI 档案 · {{ job.archive.summaryModel }}</small>
                <small v-else-if="job.archive?.summaryError" class="image-job-error">AI 档案整理失败，已保留生成时原始快照</small>
                <small v-if="job.attempt">图片调用 {{ job.attempt }}/{{ job.maxAttempts || 1 }}<template v-if="job.rewritten"> · 已自动调整提示词</template></small>
                <button v-if="job.prompt" type="button" class="copy-text-button album-prompt-copy" @click.stop="copyText(job.prompt, '最终生图提示词')">复制最终提示词</button>
                <button v-if="job.status === 'failed'" type="button" class="image-job-retry" @click="retryImageJob(job)">检查后手动重试</button>
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

            <article class="token-usage-card data-page-card">
              <div class="data-card-heading">
                <div><b>Token 用量</b><small>仅统计对话、生图提示词整理和记忆压缩，不包含图片本身费用</small></div>
                <span v-if="tokenUsage && (tokenUsage.today.estimated || tokenUsage.last7Days.estimated || tokenUsage.cumulative.estimated)">含估算</span>
              </div>
              <div v-if="tokenUsageLoading && !tokenUsage" class="token-usage-empty">正在读取用量…</div>
              <template v-else-if="tokenUsage">
                <div class="token-usage-summary">
                  <span><b>{{ formatTokenCount(tokenUsage.today.total) }}</b><small>今日 · 输入 {{ formatTokenCount(tokenUsage.today.input) }} / 输出 {{ formatTokenCount(tokenUsage.today.output) }}</small></span>
                  <span><b>{{ formatTokenCount(tokenUsage.last7Days.total) }}</b><small>近 7 天</small></span>
                  <span><b>{{ formatTokenCount(tokenUsage.cumulative.total) }}</b><small>累计</small></span>
                </div>
                <p v-if="tokenUsage.today.estimated || tokenUsage.last7Days.estimated || tokenUsage.cumulative.estimated" class="token-estimate-note">部分接口没有返回 usage，相关数字为按字符估算，不代表精确值。</p>
                <div class="token-category-stats">
                  <span><b>{{ formatTokenCount(tokenUsage.categories?.chat?.total || 0) }}</b><small>对话</small></span>
                  <span><b>{{ formatTokenCount(tokenUsage.categories?.['image-prompt']?.total || 0) }}</b><small>生图提示词</small></span>
                  <span><b>{{ formatTokenCount(tokenUsage.categories?.summary?.total || 0) }}</b><small>记忆压缩</small></span>
                </div>
                <label class="field-label token-price-label">模型单价（元 / 百万 token，可选）
                  <div class="token-price-row">
                    <input v-model="tokenPriceInput" type="number" min="0" step="0.01" placeholder="输入单价" aria-label="每百万输入 token 价格" />
                    <input v-model="tokenPriceOutput" type="number" min="0" step="0.01" placeholder="输出单价" aria-label="每百万输出 token 价格" />
                  </div>
                </label>
                <p class="token-cost-line">估算费用：今日 {{ formatCost(tokenUsage.estimatedCost.today, tokenUsage) }} · 近 7 天 {{ formatCost(tokenUsage.estimatedCost.last7Days, tokenUsage) }} · 累计 {{ formatCost(tokenUsage.estimatedCost.cumulative, tokenUsage) }}</p>
                <div class="data-card-actions">
                  <button type="button" @click="saveTokenPrice" :disabled="tokenUsageLoading">保存单价并刷新</button>
                  <button type="button" @click="refreshTokenUsage" :disabled="tokenUsageLoading">刷新</button>
                </div>
              </template>
              <p v-else class="token-usage-empty">尚未产生模型请求。发起对话、整理生图提示词或压缩记忆后，用量会显示在这里。</p>
            </article>
          </div>
        </section>

        <section v-if="directApiMode && mobileTab === 'connection'" class="connection-center-panel">
          <div class="prompt-page-header connection-page-header">
            <div>
              <div class="eyebrow">CONNECTION CENTER</div>
              <h2>连接中心</h2>
              <p>只需填写 API 地址和密钥，系统会自动发现可用模型并记住你的选择。</p>
            </div>
            <button @click="switchMobileTab('chat')" aria-label="返回聊天">×</button>
          </div>

          <div class="connection-status-grid">
            <article :class="{ ready: chatConnectionVerified }"><span>对话连接</span><b>{{ chatConnectionVerified ? '已就绪' : (chatCatalogVerified ? '请选择模型' : (chatModelsLoading ? '正在检测' : '待验证')) }}</b><small>{{ chatCatalogVerified ? availableChatModels.length + ' 个接口返回模型' : (modelConnectionWarning || '填写地址和密钥后检测') }}</small></article>
            <article :class="{ ready: imageConnectionVerified }"><span>图片连接</span><b>{{ imageConnectionVerified ? '已就绪' : (imageCatalogVerified ? '请选择模型' : (imageModelsLoading ? '正在检测' : '待验证')) }}</b><small>{{ imageCatalogVerified ? availableImageModels.length + ' 个图片候选模型' : (imageConnectionWarning || '可以使用独立图片地址和一个 Key') }}</small></article>
          </div>

          <article class="connection-card connection-config-card">
            <div><span class="connection-step">1</span><div><b>API 地址与密钥</b><small>对话和图片可以使用不同地址；图片只保留一个 Key</small></div></div>
            <button type="button" class="connection-primary-action" @click="openDirectApiSettings">配置或检测</button>
          </article>

          <details class="connection-card connection-advanced-card" open>
            <summary class="connection-card-heading"><span class="connection-step">2</span><div><b>选择使用的模型</b><small>系统不会自动选择第一个；确认后会保存在当前设备</small></div></summary>
            <div class="connection-fields">
              <label class="field-label">默认对话模型
                <select :value="chatModel" @change="setChatModel($event.target.value)" :disabled="chatModelsLoading || !chatCatalogVerified">
                  <option value="" disabled>请选择对话模型</option>
                  <option v-for="model in availableChatModels" :key="model" :value="model">{{ model }}</option>
                </select>
              </label>
              <label class="field-label">默认图片模型
                <select :value="imageModel" @change="setImageModel($event.target.value)" :disabled="imageModelsLoading || !imageCatalogVerified">
                  <option value="" disabled>请选择图片模型</option>
                  <option v-for="model in availableImageModels" :key="model" :value="model">{{ imageModelLabel(model) }}</option>
                </select>
              </label>
              <label class="field-label connection-custom-model">自定义兼容模型
                <span><input v-model.trim="customImageModel" maxlength="100" placeholder="例如：flux-1.1-pro" /><button type="button" @click="useCustomImageModel" :disabled="!customImageModel">使用</button></span>
              </label>
            </div>
            <p v-if="modelConnectionWarning" class="model-connection-warning">{{ modelConnectionWarning }}</p>
            <p v-if="imageConnectionWarning" class="model-connection-warning">{{ imageConnectionWarning }}</p>
            <label class="model-manager-toggle connection-image-toggle">
              <span><b>允许图片生成</b><small>只有手动确认后才会调用一次图片接口</small></span>
              <input v-model="imageEnabled" type="checkbox" @change="saveImagePreference" :disabled="!imageConnectionVerified" />
            </label>
          </details>
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
              <button type="button" @click="openMobileDestination('prompt')"><span>✎</span><b>世界与剧情</b><small>设定、记忆和风格</small></button>
              <button v-if="directApiMode" type="button" @click="openMobileDestination('connection')"><span>⌁</span><b>连接中心</b><small>API、模型和生图</small></button>
              <button type="button" @click="openMobileDestination('image')"><span>▣</span><b>图片与相册</b><small>场景和人物图</small></button>
              <button type="button" @click="openMobileDestination('data')"><span>⇄</span><b>数据与诊断</b><small>迁移、备份和日志</small></button>
            </div>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="storySkipOpen" class="modal-backdrop mobile-menu-backdrop" @click.self="storySkipOpen = false">
          <section class="mobile-function-menu" role="dialog" aria-modal="true" aria-labelledby="story-skip-title">
            <div class="sheet-grabber"></div>
            <button class="modal-close" @click="storySkipOpen = false" aria-label="关闭">×</button>
            <small>STORY ADVANCE</small>
            <h2 id="story-skip-title">跳过当前剧情</h2>
            <p class="onboarding-note">AI 会把这段故事自然收尾，并推进到所选时间点继续向前。</p>
            <div class="mobile-function-grid">
              <button type="button" @click="skipCurrentStory('next')"><span>▶</span><b>下一时段</b><small>自然推进一点</small></button>
              <button type="button" @click="skipCurrentStory('night')"><span>☾</span><b>到今晚</b><small>跨过白天日常</small></button>
              <button type="button" @click="skipCurrentStory('morning')"><span>☀</span><b>明天上午</b><small>开始新的一天</small></button>
            </div>
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
              <input v-model.trim="eventDraft.title" maxlength="160" placeholder="例如：和林夏去三楼资料室核对清单" />
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
              <input v-model.trim="eventParticipantText" maxlength="180" placeholder="用顿号分隔，例如：岚、林夏" />
            </label>
            <label class="field-label">备注
              <textarea v-model.trim="eventDraft.notes" rows="4" maxlength="1000" placeholder="要带的东西、约定原因或不能忘的细节…"></textarea>
            </label>
            <button type="button" class="save-profile" @click="saveStoryEventDraft">保存约定</button>
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
              :disabled="!currentImageKeyConfigured || backgroundGenerating || Boolean(stageBackgroundJob) || stageBackground.prompt.trim().length < 20"
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
            <button type="button" class="role-detail-back" @click="backToCharacterManager">← 返回人物列表</button>
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
            <div class="role-avatar-actions">
              <label class="avatar-upload-button"><span>{{ avatarUploadingId === roleDetailTargetId ? '正在保存图片…' : '从设备上传头像' }}</span><input type="file" accept="image/*" @change="uploadRoleAvatar($event, roleDetailTargetId)" :disabled="avatarUploadingId === roleDetailTargetId" /></label>
              <small>支持 JPG、PNG、WebP 等常见图片，最大 18MB；H5/App 会保存到统一本地资产层。</small>
            </div>
            <div class="role-detail-tabs" role="tablist" aria-label="人物详情分类">
              <button type="button" :class="{ active: roleDetailTab === 'profile' }" @click="roleDetailTab = 'profile'">人物资料</button>
              <button type="button" :class="{ active: roleDetailTab === 'image' }" @click="roleDetailTab = 'image'">形象生成</button>
              <button type="button" :class="{ active: roleDetailTab === 'album' }" @click="roleDetailTab = 'album'">人物相册（{{ selectedRoleAlbumItems.length }}）</button>
              <button v-if="standaloneMode && motionDisplayEnabled" type="button" :class="{ active: roleDetailTab === 'visual' }" @click="openVisualLibrary">动作图库</button>
            </div>
            <section v-if="roleDetailTab === 'profile'" class="role-detail-pane">
              <div class="role-ai-profile-tools">
                <div>
                  <b>告诉 AI 你想怎样修改</b>
                  <small>输入自然语言要求，AI 会结合现有档案与历史对话修改基础资料、人物提示词和稳定外观。</small>
                </div>
                <button type="button" @click="generateRoleSetting('all')" :disabled="roleProfileGenerating">
                  {{ roleProfileGenerating ? '正在分析与修改…' : 'AI 生成 / 修改完整档案' }}
                </button>
                <label class="role-ai-instruction">
                  <textarea v-model.trim="roleAiInstruction" maxlength="1000" rows="3" placeholder="例如：把她改成利落短发的机械师，保留温和性格；说话更简洁主动，但不要改变已经发生的关系。"></textarea>
                  <span>{{ roleAiInstruction.length }}/1000 · 留空时会根据现有设定与对话自动完善</span>
                </label>
              </div>
              <div class="ensemble-fields">
                <label class="field-label">名字<input v-model.trim="selectedRole.name" maxlength="12" /></label>
                <div class="derived-role-state"><b>AI 派生状态</b><span>{{ roleDerivedSummary(selectedRole) }}</span><small>{{ roleDerivedDetail(selectedRole) }}</small></div>
              </div>
              <div class="role-age-fields">
                <label class="field-label">实际年龄（岁）
                  <input v-model.number="selectedRole.derivedProfile.initialActualAge" type="number" min="0" max="200" placeholder="留空=未知，由 AI 提取" @change="normalizeRoleAge(selectedRole)" />
                </label>
                <label class="field-label">外表年龄（岁，可选）
                  <input v-model.number="selectedRole.derivedProfile.initialApparentAge" type="number" min="0" max="200" placeholder="留空=同实际年龄" @change="normalizeRoleAge(selectedRole)" />
                </label>
              </div>
              <label class="field-label">性别
                <select v-model="selectedRole.gender">
                  <option>女性</option><option>男性</option><option>非二元</option><option>未指定</option>
                </select>
              </label>
              <label class="field-label">与主角色/用户的关系<input v-model.trim="selectedRole.relation" maxlength="80" /></label>
              <label class="field-label"><span class="field-label-heading"><span>人物提示词（用于对话）</span><button type="button" class="copy-text-button" @click.prevent.stop="copyText(selectedRole.prompt, '人物提示词')" :disabled="!(selectedRole.prompt || '').trim()">复制</button></span>
                <textarea v-model.trim="selectedRole.prompt" maxlength="2000" rows="4" placeholder="人物身份、语气、欲望、行为习惯和与其他人物的互动方式…"></textarea>
              </label>
              <button type="button" class="role-field-ai" @click="generateRoleSetting('prompt')" :disabled="roleProfileGenerating">
                {{ roleProfileGenerating ? 'AI 正在整理…' : 'AI 生成 / 优化人物提示词' }}
              </button>
              <label class="field-label"><span class="field-label-heading"><span>稳定外观（长相与穿搭）</span><button type="button" class="copy-text-button" @click.prevent.stop="copyText(selectedRole.appearance, '稳定外观')" :disabled="!(selectedRole.appearance || '').trim()">复制</button></span>
                <textarea v-model.trim="selectedRole.appearance" maxlength="2000" rows="4" placeholder="发型、五官、体态、穿搭、配饰等长期稳定特征…"></textarea>
              </label>
              <button type="button" class="role-field-ai" @click="generateRoleSetting('appearance')" :disabled="roleProfileGenerating">
                {{ roleProfileGenerating ? 'AI 正在整理…' : 'AI 生成 / 优化稳定外观' }}
              </button>
              <p class="role-editing-note">AI 结果会写入当前角色档案；你仍可以继续手动修改名字、关系、人物提示词与长相，确认后点击保存。</p>
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
              <label class="field-label">本次人物生图模型
                <select :value="imageModel" @change="setImageModel($event.target.value)" :disabled="imageModelsLoading || !imageCatalogVerified || characterGenerating || !!selectedRoleImageJob">
                  <option value="" disabled>请选择图片模型</option>
                  <option v-for="model in availableImageModels" :key="model" :value="model">{{ imageModelLabel(model) }}</option>
                </select>
                <small>只影响之后提交的人物图片；场景工作台也会同步使用所选模型。</small>
              </label>
              <div v-if="directApiMode" class="image-key-channel compact"><span><b>图片连接状态</b><small>不按模型品牌切换 Key</small></span><em :class="{ ready: currentImageKeyConfigured }">{{ activeImageKeyStatus }}</em></div>
              <label class="field-label"><span class="field-label-heading"><span>稳定外观（用于人物一致性）</span><button type="button" class="copy-text-button" @click.prevent.stop="copyText(selectedRole.appearance, '稳定外观')" :disabled="!(selectedRole.appearance || '').trim()">复制</button></span>
                <textarea v-model.trim="selectedRole.appearance" maxlength="2000" rows="3" placeholder="发型、五官、体态、穿搭、配饰等长期稳定特征…"></textarea>
              </label>
              <button type="button" class="role-field-ai" @click="generateRoleSetting('appearance')" :disabled="roleProfileGenerating">
                {{ roleProfileGenerating ? 'AI 正在整理…' : 'AI 生成 / 优化稳定外观' }}
              </button>
              <label class="field-label image-prompt-field"><span class="field-label-heading"><span>生图提示词（只用于图片模型）</span><span class="field-label-tools"><b>{{ (selectedRole.imagePrompt || '').length }}/1200</b><button type="button" class="copy-text-button" @click.prevent.stop="copyText(selectedRole.imagePrompt, '人物生图提示词')" :disabled="!(selectedRole.imagePrompt || '').trim()">复制提示词</button></span></span>
                <textarea v-model.trim="selectedRole.imagePrompt" maxlength="1200" rows="7" placeholder="点击“整理提示词”自动生成，也可以直接输入并修改…"></textarea>
              </label>
              <div v-if="standaloneMode" class="reference-image-picker">
                <div class="reference-image-heading">
                  <span><b>参考图（可选）</b><small>基于该角色已有图片生成，保持脸型、发型和外观稳定</small></span>
                </div>
                <div v-if="selectedRoleReferenceImage" class="reference-image-current">
                  <img v-local-image="{ src: selectedRoleReferenceImage.imageUrl, thumbnail: true }" :src="selectedRoleReferenceImage.imageUrl" :alt="selectedRole.name + '的参考图'" />
                  <span>已选择参考图，提交时会自动附加“保持同一人物”约束</span>
                  <button type="button" class="style-clear" @click="selectedRoleReferenceImage = null">清除</button>
                </div>
                <div v-else class="reference-image-empty">
                  <span v-if="!selectedRoleAlbumItems.length">该角色还没有可用的图片，先生成或导入一张形象。</span>
                  <button v-else type="button" class="prompt-reset" @click="roleReferencePickerOpen = !roleReferencePickerOpen">
                    {{ roleReferencePickerOpen ? '收起选择器' : '从相册选择参考图' }}
                  </button>
                </div>
                <div v-if="roleReferencePickerOpen" class="reference-picker-grid">
                  <button
                    v-for="item in selectedRoleAlbumItems"
                    :key="item.id"
                    type="button"
                    :class="{ active: selectedRoleReferenceImage && selectedRoleReferenceImage.imageUrl === item.imageUrl }"
                    @click="pickRoleReferenceImage(item)"
                  >
                    <img v-local-image="{ src: item.imageUrl, thumbnail: true }" :src="item.imageUrl" :alt="item.archive?.title || '参考图'" loading="lazy" />
                    <span>{{ item.albumTypeLabel || '人物形象' }}</span>
                  </button>
                </div>
              </div>
              <div class="image-style-presets compact">
                <span>风格预设</span>
                <button
                  v-for="preset in imageStylePresets"
                  :key="preset"
                  type="button"
                  :class="{ active: characterImageStylePreset === preset && !characterImageStyleCustom }"
                  :disabled="characterPromptPreparing"
                  @click="applyCharacterImageStyle(preset)"
                >{{ preset }}</button>
                <input
                  v-model.trim="characterImageStyleCustom"
                  maxlength="200"
                  placeholder="自定义风格，如：复古胶片、水墨丹青…"
                  aria-label="自定义人物形象风格"
                  @keydown.enter.prevent="applyCharacterCustomStyle"
                />
                <button type="button" class="prompt-reset" :disabled="!characterImageStyleCustom || characterPromptPreparing" @click="applyCharacterCustomStyle">按此风格整理</button>
                <button v-if="characterImageStylePreset || characterImageStyleCustom" type="button" class="style-clear" @click="clearCharacterImageStyle">清除风格</button>
              </div>
              <div class="role-detail-status">
                <span :class="{ ready: currentImageKeyConfigured }">{{ currentImageKeyConfigured ? imageModel + ' 已配置' : activeImageKeyStatus }}</span>
                <small>{{ standaloneMode ? '页面保持打开时会后台继续，不影响聊天' : '提交后在电脑后台继续，可关闭手机页面' }}</small>
              </div>
              <p v-if="characterPromptFallback" class="local-fallback-note">远程对话模型暂时无法连接，当前提示词由本地规则整理，仍可编辑并用于生图。</p>
              <div class="image-prompt-actions role-image-actions">
                <button class="prompt-reset" @click="prepareCharacterPrompt(roleDetailTargetId)" :disabled="characterPromptPreparing">
                  {{ characterPromptPreparing ? '正在整理…' : '整理提示词' }}
                </button>
                <button class="prompt-save" @click="generateSavedCharacterImage" :disabled="!currentImageKeyConfigured || characterGenerating || selectedRoleImageJob || !selectedRole.imagePrompt || selectedRole.imagePrompt.trim().length < 80">
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
                    <button v-if="item.prompt" type="button" class="copy-text-button album-prompt-copy" @click.stop="copyText(item.prompt, '最终生图提示词')">复制最终提示词</button>
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
                <button type="button" class="visual-batch-primary" @click="generateSelectedVisualStates" :disabled="visualBatchSubmitting || !currentImageKeyConfigured || !selectedVisualGenerateCount || !selectedRoleVisualBaseUrl">
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
                  <button type="button" class="visual-generate-one" @click="generateVisualState(selectedVisualState)" :disabled="!currentImageKeyConfigured || !selectedRoleVisualBaseUrl || Boolean(visualStateJob(selectedVisualState))">基于基底图生成 / 重生成</button>
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
        <div v-if="aiProposal" class="modal-backdrop ai-diff-backdrop" @click.self="cancelAiProposal">
          <section class="settings-sheet ai-diff-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-diff-title">
            <button class="modal-close" @click="cancelAiProposal" aria-label="关闭差异预览">×</button>
            <div class="eyebrow">AI CHANGE PREVIEW</div>
            <h2 id="ai-diff-title">{{ aiProposal.title }}</h2>
            <p class="settings-intro">AI 结果尚未写入。勾选要采用的字段，确认后才会覆盖当前内容。</p>
            <div class="ai-diff-mobile-tabs" role="tablist">
              <button type="button" :class="{ active: aiProposalView === 'before' }" @click="aiProposalView = 'before'">当前内容</button>
              <button type="button" :class="{ active: aiProposalView === 'after' }" @click="aiProposalView = 'after'">AI 建议</button>
            </div>
            <div class="ai-diff-list">
              <article v-for="field in aiProposal.fields" :key="field.key" class="ai-diff-field">
                <label class="ai-diff-select"><input v-model="field.selected" type="checkbox" /><b>{{ field.label }}</b><span>{{ field.selected ? '将应用' : '保持原样' }}</span></label>
                <div class="ai-diff-columns">
                  <section :class="{ 'mobile-visible': aiProposalView === 'before' }"><small>当前内容</small><pre>{{ field.before || '（空）' }}</pre></section>
                  <section class="after" :class="{ 'mobile-visible': aiProposalView === 'after' }"><small>AI 建议</small><pre>{{ field.after || '（空）' }}</pre></section>
                </div>
              </article>
            </div>
            <div class="ai-diff-actions">
              <button type="button" @click="cancelAiProposal">取消，不修改</button>
              <button type="button" class="primary" @click="confirmAiProposal" :disabled="!aiProposal.fields.some((field) => field.selected)">确认应用所选内容</button>
            </div>
          </section>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="imagePreviewJob && imagePreviewJob.imageUrl" class="album-preview-backdrop" @click.self="closeGalleryPreview">
          <section class="album-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="album-preview-title" @click.stop>
            <button type="button" class="portrait-preview-close" @click="closeGalleryPreview" aria-label="关闭图片预览">×</button>
            <div class="album-preview-image">
              <button
                type="button"
                class="album-preview-info-toggle"
                :class="{ active: imagePreviewDetailsVisible }"
                @click="imagePreviewDetailsVisible = !imagePreviewDetailsVisible"
                :aria-expanded="imagePreviewDetailsVisible ? 'true' : 'false'"
                aria-controls="album-preview-details"
              >{{ imagePreviewDetailsVisible ? '收起信息' : '图片信息' }}</button>
              <span v-if="imagePreviewLoading" class="album-preview-loading">正在读取本地图片…</span>
              <img
                v-else-if="imagePreviewSrc"
                v-local-image="imagePreviewSrc"
                :src="imagePreviewSrc"
                :alt="imagePreviewJob.archive?.title || imagePreviewJob.targetName || '生成图片大图'"
                :style="{ transform: 'translate3d(' + imagePreviewOffsetX + 'px,' + imagePreviewOffsetY + 'px,0) scale(' + imagePreviewScale + ')' }"
                :class="{ zoomed: imagePreviewScale > 1 }"
                @error="handleGalleryPreviewError"
                @dblclick="toggleGalleryZoom"
                @wheel.prevent="handleGalleryZoomWheel"
                @pointerdown.prevent="handleGalleryPointerDown"
                @pointermove.prevent="handleGalleryPointerMove"
                @pointerup.prevent="handleGalleryPointerUp"
                @pointercancel.prevent="handleGalleryPointerUp"
              />
              <div v-else class="album-preview-error">
                <b>图片预览加载失败</b>
                <p>{{ imagePreviewError || '无法读取这张本地图片。' }}</p>
                <button type="button" @click="retryGalleryPreview">重新读取</button>
              </div>
              <div v-if="imagePreviewSrc" class="album-zoom-controls" role="group" aria-label="图片缩放">
                <button type="button" @click="changeGalleryZoom(-0.25)" :disabled="imagePreviewScale <= 1" aria-label="缩小">−</button>
                <button type="button" class="zoom-percentage" @click="resetGalleryZoom">{{ Math.round(imagePreviewScale * 100) }}%</button>
                <button type="button" @click="changeGalleryZoom(0.25)" :disabled="imagePreviewScale >= 4" aria-label="放大">＋</button>
              </div>
              <button v-if="imagePreviewItems.length > 1" type="button" class="album-preview-nav previous" @click="showAdjacentPreview(-1)" aria-label="上一张图片">‹</button>
              <button v-if="imagePreviewItems.length > 1" type="button" class="album-preview-nav next" @click="showAdjacentPreview(1)" aria-label="下一张图片">›</button>
              <small v-if="imagePreviewSrc" class="album-gesture-hint">双指缩放 · 双击放大 · 拖动查看<template v-if="imagePreviewItems.length > 1"> · 左右滑动切换</template></small>
            </div>
            <article id="album-preview-details" class="album-preview-copy" :class="{ 'details-visible': imagePreviewDetailsVisible }">
              <div class="eyebrow">{{ isCharacterAlbumItem(imagePreviewJob) ? 'CHARACTER ARCHIVE' : 'SCENE ARCHIVE' }}</div>
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
                <button type="button" class="copy-text-button album-prompt-copy" @click.stop="copyText(imagePreviewJob.prompt, '最终生图提示词')">复制最终提示词</button>
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
          <section class="settings-sheet character-manager-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button class="modal-close" @click="onboardingCompleted ? settingsOpen = false : dismissOnboarding()" aria-label="关闭">×</button>
            <div class="eyebrow">{{ !onboardingCompleted ? 'WELCOME' : 'CHARACTERS' }}</div>
            <h2 id="settings-title">{{ !onboardingCompleted ? '建立你的故事档案' : '人物管理' }}</h2>
            <p class="settings-intro">{{ !onboardingCompleted ? '先连接模型，再确定世界和人物。模板只是默认值，你可以随时修改；也可以先关闭稍后再配置。' : '先浏览全部角色，再点击一张角色卡片编辑设定、长相、人物提示词或相册。' }}</p>

            <template v-if="!onboardingCompleted">
              <nav class="onboarding-progress" aria-label="初始化进度">
                <button v-for="(label, index) in onboardingStepLabels" :key="label" type="button" :class="{ active: onboardingStep === index + 1, done: onboardingStep > index + 1 }" :disabled="index + 1 > onboardingStep" @click="goToOnboardingStep(index + 1)"><i>{{ index + 1 }}</i><span>{{ label }}</span></button>
              </nav>

              <section v-if="onboardingStep === 1" class="onboarding-pane">
                <div class="onboarding-pane-heading"><b>先配置对话模型</b><small>点击下方按钮填写 API 地址与 Key，保存后会自动读取模型列表，再选一个要用的模型。</small></div>
                <article class="onboarding-connection-card" :class="{ ready: chatConnectionVerified }">
                  <span>{{ chatConnectionVerified ? '对话连接已就绪' : (chatCatalogVerified ? '模型目录读取成功，请选择模型' : (chatModelsLoading ? '正在验证模型目录…' : '尚未配置 API 连接')) }}</span>
                  <b>{{ chatConnectionVerified ? chatModel : (chatCatalogVerified ? availableChatModels.length + ' 个模型可选，请选择' : (chatModelsLoading ? '正在读取模型列表…' : '点击下方按钮填写 API 地址与 Key')) }}</b>
                  <small>{{ chatConnectionVerified ? '该选择会保存在当前设备' : (modelConnectionWarning || '保存后会读取模型列表，再选择要用的模型') }}</small>
                  <button type="button" @click="openDirectApiSettings">{{ chatApiMode === 'configured' ? '重新配置或检测' : '配置 API 连接' }}</button>
                </article>
                <label v-if="chatCatalogVerified" class="field-label">选择对话模型
                  <select :value="chatModel" @change="setChatModel($event.target.value)" :disabled="chatModelsLoading || !availableChatModels.length">
                    <option value="" disabled>请选择一个模型</option>
                    <option v-for="model in availableChatModels" :key="model" :value="model">{{ model }}</option>
                  </select>
                </label>
                <p v-if="chatApiMode === 'configured' && !chatCatalogVerified && !chatModelsLoading" class="onboarding-blocker">尚未从接口成功读取对话模型。请检查地址、Key、跨域权限与网络后重新检测。</p>
                <div class="onboarding-actions single"><span></span><button type="button" class="primary" @click="advanceOnboarding" :disabled="!chatConnectionVerified">下一步：设置我的身份</button></div>
              </section>

              <section v-else-if="onboardingStep === 2" class="onboarding-pane">
                <div class="onboarding-pane-heading"><b>你的身份</b><small>填一个想被称呼的名字或称呼；性别只用于代词，不会据此推断性格、能力或关系。</small></div>
                <section class="identity-setup-card user-identity-card">
                  <label class="field-label">名字或称呼<input v-model.trim="userProfile.name" maxlength="20" placeholder="例如：旅行者、小安" /></label>
                  <label class="field-label">性别
                    <select v-model="userProfile.gender" @change="syncUserPronoun"><option>女性</option><option>男性</option><option>非二元</option><option>未指定</option></select>
                  </label>
                  <label class="field-label">代词 / 称谓<input v-model.trim="userProfile.pronoun" maxlength="12" placeholder="她、他、TA 或自定义称谓" /></label>
                </section>
                <div class="onboarding-actions"><button type="button" @click="goToOnboardingStep(1)">上一步</button><button type="button" class="primary" @click="advanceOnboarding" :disabled="!userProfile.name.trim() || !userProfile.pronoun.trim()">下一步：创建世界</button></div>
              </section>

              <section v-else-if="onboardingStep === 3" class="onboarding-pane">
                <div class="onboarding-pane-heading"><b>先确定世界</b><small>已为你预填「神秘快递 · AI 恋人」的默认世界设定，可直接使用，也可编辑或让 AI 进一步完善。</small></div>
                <div class="onboarding-mode-switch" role="group" aria-label="世界创建方式">
                  <button type="button" :class="{ active: onboardingWorldMode === 'ai' }" @click="onboardingWorldMode = 'ai'">AI 帮我建立</button>
                  <button type="button" :class="{ active: onboardingWorldMode === 'manual' }" @click="onboardingWorldMode = 'manual'">我自己填写</button>
                </div>
                <button type="button" class="onboarding-template-card" :class="{ active: onboardingWorldTemplateId === 'mystery-delivery-lover' }" @click="applyLoverWorldTemplate('mystery-delivery-lover', true)">
                  <span>◆</span>
                  <b>神秘快递 · AI 恋人</b>
                  <small>现代都市，你收到一个无寄件人的快递，打开是一个远超时代的仿真人 AI 恋人，只能直流电充电，能力随相处逐步开发。点击一键填入完整世界设定。</small>
                </button>
                <label v-if="onboardingWorldMode === 'ai'" class="field-label">告诉 AI 你想要的世界
                  <textarea v-model.trim="worldSeed" maxlength="1000" rows="4" placeholder="留空则使用默认世界的基调；想个性化时在这里写：例如现代沿海小城，现实日常中带一点悬疑。"></textarea>
                </label>
                <label class="field-label"><span class="field-label-heading"><span>完整世界设定</span><small>{{ worldSetting.length }}/12000</small></span>
                  <textarea v-model.trim="worldSetting" maxlength="12000" rows="9" placeholder="写清时代、地点、世界规则、故事基调、禁止内容和故事起点。"></textarea>
                </label>
                <button v-if="onboardingWorldMode === 'ai'" type="button" class="onboarding-ai-action compact" @click="generateWorldSetting" :disabled="worldGenerating || !worldSeed.trim()">{{ worldGenerating ? 'AI 正在建立世界…' : '让 AI 按上面的方向完善世界' }}</button>
                <p class="onboarding-note">默认世界设定已预填，可直接使用；AI 完善是可选项，结果会先显示差异预览，确认后才写入。</p>
                <p v-if="worldSetting.trim().length < 60" class="onboarding-length-hint">完整世界设定至少需要 60 字，当前 {{ worldSetting.trim().length }} 字。</p>
                <div class="onboarding-actions"><button type="button" @click="goToOnboardingStep(2)">上一步</button><button type="button" class="primary" @click="advanceOnboarding" :disabled="worldSetting.trim().length < 60">确认世界，创建人物</button></div>
              </section>

              <section v-else-if="onboardingStep === 4" class="onboarding-pane">
                <div class="onboarding-pane-heading"><b>创建核心人物</b><small>已按人物性别预填默认性格与外观模板，可直接使用或让 AI 生成完整人物。</small></div>
                <div class="onboarding-role-grid">
                  <label class="field-label">人物名字<input v-model.trim="profile.name" maxlength="12" placeholder="可以先留空，让 AI 命名" /></label>
                  <label class="field-label">人物性别
                    <select v-model="profile.gender" @change="applyRoleTemplateForGender"><option>女性</option><option>男性</option><option>非二元</option><option>未指定</option></select>
                  </label>
                </div>
                <label class="field-label">恋人模板（可选，一键填入人物要求）
                  <select :value="onboardingRoleTemplateId" @change="applyLoverRoleTemplate($event.target.value)">
                    <option value="" disabled>请选择一个模板</option>
                    <option v-for="template in onboardingRoleTemplateOptions()" :key="template.id" :value="template.id">{{ template.label }}</option>
                  </select>
                  <small>已按人物性别预选了默认模板；切换性别会自动更换，也可清空后自行填写。</small>
                </label>
                <button v-if="onboardingRoleTemplateId" type="button" class="onboarding-template-clear" @click="clearOnboardingRoleTemplate">清除模板，完全自己写</button>
                <label class="field-label">与我的初始关系
                  <select v-model="profile.relation"><option>旅伴</option><option>默契搭子</option><option>知心朋友</option><option>成年恋人</option><option>妻子</option><option>丈夫</option><option>姐姐</option><option>哥哥</option><option>妹妹</option><option>弟弟</option><option>自定义关系</option></select>
                </label>
                <label class="field-label">给 AI 的人物要求
                  <textarea v-model.trim="roleAiInstruction" maxlength="1000" rows="3" placeholder="例如：世界中的档案修复师，冷静但并不冷漠，行动主动，说话简洁；不要预设恋爱关系。"></textarea>
                </label>
                <button type="button" class="onboarding-ai-action" @click="generateOnboardingRole" :disabled="roleProfileGenerating || !chatConnectionVerified">{{ roleProfileGenerating ? 'AI 正在生成人物…' : '根据世界生成完整人物' }}</button>
                <label class="field-label">人物提示词（用于对话）
                  <textarea v-model.trim="profile.prompt" maxlength="2000" rows="5" placeholder="AI 生成后可以继续修改；也可以完全由你自行填写人物身份、性格、动机、语气与行为边界。"></textarea>
                </label>
                <label class="field-label">稳定外观
                  <textarea v-model.trim="profile.appearance" maxlength="2000" rows="4" placeholder="五官、发型、体态、基础穿搭和长期不变的标志物。"></textarea>
                </label>
                <div class="core-avatar-picker">
                  <span><b>选择或上传人物头像</b><small>内置头像不调用图片接口；上传图会进入当前设备的统一图片存储。</small></span>
                  <div>
                    <button v-for="preset in matchingCoreAvatarPresets" :key="preset.id" type="button" :class="{ active: profile.avatarUrl === preset.url || (!profile.avatarUrl && defaultCoreAvatarPreset.id === preset.id) }" @click="selectCoreAvatar(preset)">
                      <img :src="preset.url" :alt="preset.label + '预设头像'" /><small>{{ preset.label }}{{ preset.id === defaultCoreAvatarPreset.id ? ' · 推荐' : '' }}</small>
                    </button>
                  </div>
                  <label class="avatar-upload-button"><span>{{ avatarUploadingId === 'primary' ? '正在保存图片…' : '从设备上传头像' }}</span><input type="file" accept="image/*" @change="uploadRoleAvatar($event, 'primary')" :disabled="avatarUploadingId === 'primary'" /></label>
                </div>
                <div class="onboarding-actions"><button type="button" @click="goToOnboardingStep(3)">上一步</button><button type="button" class="primary" @click="advanceOnboarding" :disabled="!onboardingRoleReady">下一步：确认档案</button></div>
              </section>

              <section v-else class="onboarding-pane onboarding-review">
                <div class="onboarding-pane-heading"><b>确认后再开始剧情</b><small>第一条剧情只会在模型、世界和人物全部确认后生成。</small></div>
                <article><span>对话模型</span><b>{{ chatModel }}</b><small>已验证连接</small></article>
                <article><span>你的身份</span><b>{{ userProfile.name }}</b><small>{{ userProfile.gender }} · {{ userProfile.pronoun }}</small></article>
                <article><span>世界设定</span><b>第 {{ worldVersion }} 版世界</b><small>{{ worldSetting.slice(0, 120) }}</small></article>
                <article class="role"><img v-local-image="profile.avatarUrl || defaultAvatarUrl" :src="profile.avatarUrl || defaultAvatarUrl" alt="" /><div><span>核心人物</span><b>{{ profile.name }}</b><small>{{ profile.gender }} · {{ profile.relation }} · {{ roleDerivedSummary(profile) }}</small></div></article>
                <p class="onboarding-note">初始化不会创建额外固定配角。以后可在人物管理中自行添加，并让 AI 根据当前世界生成。</p>
                <div class="onboarding-actions"><button type="button" @click="goToOnboardingStep(4)">返回修改人物</button><button type="button" class="primary" @click="completeOnboarding" :disabled="storyInitializing">{{ storyInitializing ? '正在生成开场…' : '确认档案并进入故事' }}</button></div>
              </section>
            </template>

            <template v-else>
              <div class="character-manager-toolbar">
                <div><b>全部角色</b><small>共 {{ managedRoleCards.length }} 位 · 最多再创建 30 个角色</small></div>
                <button type="button" @click="addCustomRole" :disabled="ensemble.customRoles.length >= 30">＋ 新建角色</button>
              </div>
              <div class="character-manager-grid">
                <article v-for="entry in managedRoleCards" :key="entry.id" class="character-manager-card">
                  <button type="button" class="character-manager-main" @click="openRoleDetail(entry.id)" :aria-label="'编辑' + entry.role.name + '的人物设定'">
                    <span class="character-manager-avatar">
                      <img v-if="entry.role.avatarUrl" v-local-image="{ src: entry.role.avatarUrl, thumbnail: true }" :src="entry.role.avatarUrl" :alt="entry.role.name + '的头像'" loading="lazy" />
                      <i v-else>{{ (entry.role.name || '?').slice(0, 1) }}</i>
                    </span>
                    <span class="character-manager-copy">
                      <span class="character-manager-name"><b>{{ entry.role.name }}</b><em>{{ entry.typeLabel }}</em></span>
                      <small>{{ entry.role.gender || '未指定' }} · {{ entry.role.relation || '关系待补充' }}</small>
                      <span>{{ roleDerivedSummary(entry.role) }}</span>
                    </span>
                  </button>
                  <div class="character-manager-meta">
                    <span :class="{ ready: roleSetupStatus(entry.role) === '设定完整' }">{{ roleSetupStatus(entry.role) }}</span>
                    <span>{{ roleAlbumCountFor(entry.id, entry.role) }} 张图片</span>
                  </div>
                  <div class="character-manager-actions">
                    <button type="button" @click="openRoleDetail(entry.id)">编辑设定</button>
                    <button type="button" @click="openRoleDetail(entry.id, 'image')">形象 / 生图</button>
                    <button v-if="entry.canDelete" type="button" class="danger" @click="removeManagedRole(entry)">删除</button>
                  </div>
                </article>
              </div>

              <details class="character-manager-global-settings">
                <summary><span><b>用户身份与多人规则</b><small>称谓、多人参与上限及临时角色</small></span><i>展开设置</i></summary>
                <section class="identity-setup-card user-identity-card">
                  <div><b>你的身份</b><small>只用于称呼，不自动推断性格或关系</small></div>
                  <label class="field-label">名字或称呼<input v-model.trim="userProfile.name" maxlength="20" /></label>
                  <label class="field-label">性别
                    <select v-model="userProfile.gender" @change="syncUserPronoun"><option>女性</option><option>男性</option><option>非二元</option><option>未指定</option></select>
                  </label>
                  <label class="field-label">代词 / 称谓<input v-model.trim="userProfile.pronoun" maxlength="12" /></label>
                </section>
                <section class="ensemble-settings character-manager-rules">
                  <label class="ensemble-switch">
                    <span><b>多人场景</b><small>根据情景自动安排配角入场</small></span>
                    <input v-model="ensemble.enabled" type="checkbox" />
                    <i aria-hidden="true"></i>
                  </label>
                  <template v-if="ensemble.enabled">
                    <label class="field-label ensemble-threshold">每轮最多参与 <b>{{ ensemble.maxTurns }} 位角色</b>
                      <input v-model.number="ensemble.maxTurns" type="range" min="1" max="10" step="1" />
                      <small>限制不同角色人数；完成一轮后会停下，让用户继续插话。</small>
                    </label>
                    <label class="auto-guest-option">
                      <input v-model="ensemble.autoGuests" type="checkbox" />
                      <span><b>允许场景临时角色</b><small>需要时自动创建可继续编辑的临时人物档案</small></span>
                    </label>
                  </template>
                </section>
                <button class="edit-prompt-link" @click="openPrompt">编辑系统提示词</button>
                <button class="save-profile" @click="saveProfile">保存用户与多人规则</button>
              </details>
            </template>
            <p class="boundary-note">{{ !onboardingCompleted ? '已为你预填默认世界与角色模板，可随时修改或清空自行填写；不会按性别推断性格、能力或关系。' : (standaloneMode ? '新建档案不会预载固定世界或人物，也不会按性别推断性格、能力或关系。' : '成人模式允许暧昧、撒娇与亲密互动，但不涉及未成年人、强迫或高风险行为。') }}</p>
          </section>
        </div>
      </transition>

      <transition name="toast"><div v-if="toast" class="toast-message">{{ toast }}</div></transition>
    </div>
`;
