// dsh-plugin-pstd · lib/naming.js
// 命名判断：toSlug / slugIssues / toolIssues / toolAdvisories / deriveIds / slugify。
// 纯函数，无 IO。判据来自 lib/standard.js 的冻结规范。
import {
  PLUGIN_PREFIX, RESERVED_SLUGS, SLUG_MAX, SLUG_MIN, SLUG_RE, TOOL_MAX, TOOL_RE,
} from './standard.js'

// 把各种入参形态（dsh-plugin-x / 路径 / 裸 slug）归一化为 slug
export function toSlug(raw) {
  let s = String(raw == null ? '' : raw).trim()
  const parts = s.split('/')
  if (parts.length > 1) s = parts[parts.length - 1]
  if (s.startsWith(PLUGIN_PREFIX)) s = s.slice(PLUGIN_PREFIX.length)
  return s
}

export function slugIssues(slug) {
  const issues = []
  const s = String(slug)
  const add = (detail) => issues.push({ rule: 'N1', detail: detail })
  if (s.length === 0) add('slug 为空')
  if (s.length > 0 && s.length < SLUG_MIN) add('长度 ' + s.length + ' < ' + SLUG_MIN)
  if (s.length > SLUG_MAX) add('长度 ' + s.length + ' > ' + SLUG_MAX)
  if (/[A-Z]/.test(s)) add('含大写字母（须全小写）')
  if (s.indexOf('_') !== -1) add('含下划线（须用连字符）')
  if (s.indexOf('.') !== -1) add('含点号（破坏目录枚举与黑板键）')
  if (/^[0-9]/.test(s)) add('以数字开头')
  if (s.indexOf('--') !== -1) add('出现连续连字符')
  if (/-$/.test(s)) add('以连字符结尾')
  if (/[^a-z0-9-]/.test(s)) add('含 [a-z0-9-] 之外的字符')
  if (s.length > 0 && !SLUG_RE.test(s)) add('不匹配 ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
  if (RESERVED_SLUGS.indexOf(s) !== -1) issues.push({ rule: 'N8', detail: '命中原保留字：' + s })
  return issues
}

// 该名字是否被声明为「本插件自有」（v1.0.2 新增）：自有工具出现在活体表里是正常的，不构成冲突
export function isSelfOwned(name, selfTools) {
  return Array.isArray(selfTools) && selfTools.indexOf(name) !== -1
}

// liveTools：活体工具表（本机 tools.schemas() 的名字集）；selfTools：调用方声明的自有工具名
export function toolIssues(name, liveTools, selfTools) {
  const issues = []
  const s = String(name == null ? '' : name)
  if (s.length === 0) { issues.push({ rule: 'N4', detail: '工具名为空' }); return issues }
  if (s.indexOf('-') !== -1) issues.push({ rule: 'N4', detail: '工具名用下划线而非连字符' })
  if (!TOOL_RE.test(s)) issues.push({ rule: 'N4', detail: '不匹配 ^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,3}$（须 snake_case 且至少两段，首段=领域前缀）' })
  if (s.length > TOOL_MAX) issues.push({ rule: 'N4', detail: '长度 ' + s.length + ' > ' + TOOL_MAX })
  if (Array.isArray(liveTools) && liveTools.indexOf(s) !== -1 && !isSelfOwned(s, selfTools)) {
    issues.push({ rule: 'N4', detail: '与活体工具表同名（认知分裂风险）' })
  }
  return issues
}

// 与冲突分开报的「已声明自有」提示：不影响 ok，只作 advisory（v1.0.2 修误报）
export function toolAdvisories(name, liveTools, selfTools) {
  const out = []
  const s = String(name == null ? '' : name)
  if (Array.isArray(liveTools) && liveTools.indexOf(s) !== -1 && isSelfOwned(s, selfTools)) {
    out.push('在活体工具表中，但已由 selfTools 声明为本插件自有 —— 不计入冲突')
  }
  return out
}

export function deriveIds(slug) {
  const segs = String(slug).split('-').filter((x) => x.length > 0)
  const alnum = String(slug).split('-').join('')
  const initials = segs.map((x) => x[0]).join('')
  let idPrefix = initials.length >= 3 ? initials : alnum
  idPrefix = idPrefix.slice(0, 6)
  if (idPrefix.length < 3) idPrefix = (alnum + 'xxx').slice(0, 3)
  return {
    slug: slug,
    dir: PLUGIN_PREFIX + slug,
    packageName: PLUGIN_PREFIX + slug,
    patchId: slug,
    patchName: PLUGIN_PREFIX + slug,
    toolDomain: segs.length > 0 ? segs[0] : slug,
    logPath: '~/dsh-collab/logs/' + PLUGIN_PREFIX + slug + '.log',
    registryKey: 'data/registry/' + PLUGIN_PREFIX + slug,
    idPrefix: idPrefix,
    homeDir: '~/' + PLUGIN_PREFIX + slug,
    devicesDir: '~/dsh-collab/devices/' + PLUGIN_PREFIX + slug,
  }
}

// 从用途描述机械生成 slug。
// ★ v1.0.2 修错(d)：截断必须落在「段边界」——按整段累加，装不下就丢弃该段，
//   绝不 slice 出半个词（旧版反例：plugin-naming-gate-and-review-wa）。
export function slugify(purpose) {
  const raw = String(purpose == null ? '' : purpose)
  const tokens = raw.toLowerCase().match(/[a-z0-9]+/g) || []
  const hasCJK = /[\u4e00-\u9fff]/.test(raw)

  const segs = []
  for (const token of tokens) {
    if (segs.concat([token]).join('-').length > SLUG_MAX) break
    segs.push(token)
  }
  let slug = segs.join('-')
  if (!/^[a-z]/.test(slug)) slug = slug.replace(/^[^a-z]+/, '')

  if (slug.length < SLUG_MIN || !SLUG_RE.test(slug)) {
    return {
      slug: null,
      needsManual: true,
      tokens: tokens,
      hasCJK: hasCJK,
      truncated: segs.length < tokens.length,
      reason: hasCJK && tokens.length === 0 ? '用途描述为纯中文，无法机械音译（本工具不做假音译）' : '从描述中提取不到合法 slug',
      guidance: '请手工指定英文 slug：全小写 kebab-case，语义＝领域+对象（如 flower-inventory / voice-activate）',
    }
  }
  return {
    slug: slug,
    needsManual: false,
    tokens: tokens,
    hasCJK: hasCJK,
    truncated: segs.length < tokens.length,
    droppedTokens: tokens.slice(segs.length),
    reason: null,
    guidance: null,
  }
}
