// 八类能力：配置默认值与合并。
//
// 配置来源优先级（低 → 高）：
//   1. 本文件 DEFAULT_CONFIG
//   2. qq-bridge/config.json 的 capabilities 块（部署脚本只做幂等合并）
//   3. 管理端写入的运行时覆盖（SQLite cap_config，面板/接口写这里）
// 这样面板改开关不会重写用户的 config.json，也不会在部署时覆盖同期手改。

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,          // 八类能力总开关
  dryRun: true,           // 全局演练模式：所有对外写动作默认不真正执行
  growth: {
    enabled: true,
    autoTrial: false,     // 后台只能“提出”变化，不能自称已生效
    minSources: 3,        // 一条变化至少绑定 3 条真实收到消息
    minDistinctUsers: 2,  // 且来自至少 2 个不同的人（防止一个人的口癖被当成风格）
    capacity: 24,
    injectMax: 3,
    injectMaxChars: 600
  },
  groupCulture: {
    enabled: true,
    refreshMinutes: 30,
    minNewMessages: 40,
    injectMaxChars: 900,
    maxTerms: 12,
    maxTopics: 6
  },
  activity: {
    enabled: true,
    dailyBudget: 4,          // 全局每天最多几次公开阅读
    cooldownMinutes: 90,     // 全局两次活动的最小间隔
    maxConcurrent: 1,
    quietHours: { start: 0, end: 8 },
    retryBackoffMinutes: 30,
    taskTtlMinutes: 15,
    biliMinIntervalHours: 24,
    interests: [],            // 显式兴趣；为空时沿 growth 的 active 兴趣
    publishTopics: []         // 允许用于对外生活痕迹的主题（专门发布许可）
  },
  presence: {
    enabled: false,
    dryRun: true,
    dailyBudget: 1,
    minIntervalHours: 24,
    avatarFile: '',
    qzoneTarget: '',
    targets: { avatar: false, signature: false, qzone: false, qzone_like: false, qzone_comment: false },
    protocol: {
      profileAction: 'set_qq_profile',
      avatarAction: 'set_qq_avatar',
      qzoneAction: 'send_qzone_msg',
      qzoneFeedAction: 'get_qzone_feeds',
      qzoneLikeAction: 'like_qzone',
      qzoneCommentAction: 'comment_qzone'
    }
  },
  speech: {
    enabled: true,
    imageMetaGuard: true,
    stickerAsTone: true,
    stickerSubType: 1,
    allowWhenAsked: true
  },
  recreation: {
    enabled: true,
    repeat: {
      enabled: false,
      chance: 0.5,
      windowSeconds: 120,        // 连续两人同文的时间窗
      minIntervalSeconds: 180,
      maxPerHour: 2,
      minChars: 2,
      maxChars: 40,
      cooldownPerTextSeconds: 600,
      claimTtlSeconds: 90,       // 发送挂起超过这个时间视为投递不明
      unknownCooldownSeconds: 600 // 投递不明后，同内容不再自动重发
    },
    meme: { enabled: true }
  },
  transfer: {
    enabled: true,
    requireAdminConfirm: true,
    ttlHours: 6,
    maxPerHour: 2,
    maxForwardNodes: 60,
    allowFrom: [],           // 允许作为来源的会话 key；空 = 不额外限制来源本身
    allowTo: [],             // 允许转发到的目标；空 = 只允许现有白名单内的会话
    maxExcerptChars: 4000
  },
  voice: {
    enabled: false,          // 未配置音色/API 时明确待配置
    provider: 'dashscope',
    maxChars: 80,
    timeoutMs: 20000,
    cleanupMinutes: 10,
    fallbackText: true,
    gptsovits: {
      baseUrl: '',
      refAudioPath: '',
      promptText: '',
      promptLang: 'zh',
      textLang: 'zh'
    }
  }
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, patch) {
  if (!isObj(base)) return isObj(patch) ? structuredClone(patch) : patch;
  const out = { ...base };
  if (!isObj(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(base[k])) out[k] = deepMerge(base[k], v);
    else if (Array.isArray(v)) out[k] = v.slice();
    else out[k] = v;
  }
  return out;
}

export function effectiveConfig(fileConfig = {}, overrides = {}) {
  return deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), overrides);
}

/** 安静时段判断（支持跨零点，例如 23→7）。 */
export function inQuietHours(date, quiet = {}) {
  if (!quiet || typeof quiet !== 'object') return false;
  const start = Number(quiet.start);
  const end = Number(quiet.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const h = (date instanceof Date ? date : new Date(date)).getHours();
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * loadConfig 是白名单式展开；文件里的 capabilities 块必须显式透传，否则
 * config.json 与面板/默认值会分叉。bridge 与测试共用这一处。
 */
export function withCapabilitiesBlock(file, cfg = {}) {
  const block = file && typeof file === 'object' ? file.capabilities : null;
  return {
    ...cfg,
    capabilities: (block && typeof block === 'object' && !Array.isArray(block)) ? block : {}
  };
}
