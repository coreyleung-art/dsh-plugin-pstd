// dsh-plugin-pstd · lib/selfcheck.js
// R006 ② TCC 能力边界自检：① 能力清单 ② 不该发生路径 ③ 依赖完整性
// ★ 并含 R006 ① 第 5 项「真挂载冒烟」：真 import 入口 + 桩 ctx 调 apply + 断言注册结果（三态如实分报）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LOG_PATH } from './log.js'
import { TOOL_NAMES } from './standard.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

export const CAPABILITIES = Object.freeze([
  '能力清单：命名门 N1–N8（plugin_name_gate：check / allocate / audit / explain）',
  '能力清单：R006 十项审查（plugin_review，含 ★真挂载冒烟，单插件或 all 批量）',
  '能力清单：模式化交付 P1–P5（plugin_pattern_list / plugin_pattern_scaffold，dry-run 默认零变更）',
  '能力清单：规范台与可执行自证矩阵（plugin_standard：norms / r006 / patterns / gates / all / selfproof）',
  '能力清单：统一日志（' + LOG_PATH + '）',
])
export const FORBIDDEN_PATHS = Object.freeze([
  '不该发生：覆盖既有交付物 —— 目标目录存在且非空一律 EXISTS_GATE 拒写，本包没有覆盖分支',
  '不该发生：越出白名单根写盘 —— 只允许 home 或 devices 两个根，其余 PATH_GATE 拒',
  '不该发生：未确认写盘 —— dryRun=false 必须同时 confirm=true，否则 ENTRY_GATE 拒',
  '不该发生：未冻结的模式或动作 —— 模式与入口都是冻结枚举，枚举外无法表达',
  '不该发生：任意命令执行 —— 唯一出站是 node 真挂载冒烟，命令逐字符比对冻结模板',
  '不该发生：删除/强杀/评估类原语 —— 源码层禁用（rm -rf / pkill / killall / process.kill / eval / rmSync / unlinkSync）',
])
export const PEERS = Object.freeze(['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'])
export const EXPECTED_TOOLS = TOOL_NAMES

export function dependencyReport() {
  // 两级解析：本目录 node_modules → profile node_modules（只试一级 = 假失败）
  return PEERS.map((name) => {
    const local = join(ROOT, 'node_modules', name, 'package.json')
    const profile = resolve(ROOT, '..', '..', 'node_modules', name, 'package.json')
    if (existsSync(local)) return { peer: name, resolved: true, where: 'plugin/node_modules' }
    if (existsSync(profile)) return { peer: name, resolved: true, where: 'profile/node_modules' }
    return { peer: name, resolved: false, where: null }
  })
}

export function symbolCheck(required, sourceFiles) {
  // ★ 必须显式给 sourceFiles：不给就会扫到本文件自身 → 假失败或假通过
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    return { ok: null, skipped: true, reason: '未提供 sourceFiles，符号检查如实跳过（不假装通过）' }
  }
  const text = sourceFiles.map((f) => {
    try {
      return readFileSync(join(ROOT, f), 'utf8')
    } catch (e) {
      return ''
    }
  }).join(' ')
  const missing = required.filter((s) => text.indexOf(s) === -1)
  return { ok: missing.length === 0, missing: missing }
}

// 递归保护：apply() 首行也会调 runSelfCheck，而冒烟又要调 apply() —— 不设闸会自递归。
let smokeDepth = 0

export async function mountSmoke(entry = join(ROOT, 'lib', 'index.js'), expect = EXPECTED_TOOLS) {
  if (smokeDepth > 0) {
    return {
      state: 'skipped', registered: [], errors: [],
      reason: 're-entrant mount smoke suppressed：apply() 内的 runSelfCheck 不再触发第二次挂载冒烟',
    }
  }
  smokeDepth += 1
  try {
    const out = { state: 'pass', registered: [], errors: [] }
    const anyStub = (label) => new Proxy(function () {}, {
      get: (_t, k) => {
        if (typeof k === 'symbol' || k === 'then') return undefined
        if (k === 'register') {
          return (d) => {
            out.registered.push(typeof d === 'string' ? d : (d && d.name) || '?')
            return () => {}
          }
        }
        return anyStub(label + '.' + String(k))
      },
      apply: () => anyStub(label + '()'),
      set: () => true,
    })
    const base = {
      on: () => () => {},
      effect: (cb) => {
        try {
          const d = cb()
          return typeof d === 'function' ? d : () => {}
        } catch (e) {
          out.errors.push(String((e && e.message) || e))
          return () => {}
        }
      },
      get: (n) => anyStub('get:' + String(n)),
    }
    const ctx = new Proxy(base, {
      get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : anyStub('ctx:' + String(k))),
    })
    try {
      const mod = await import(pathToFileURL(entry).href)
      const apply = typeof mod.apply === 'function'
        ? mod.apply
        : (mod.default && typeof mod.default.apply === 'function' ? mod.default.apply : null)
      if (apply === null) {
        out.state = 'fail'
        out.errors.push('入口未导出 apply(ctx, config)')
      } else {
        await apply(ctx, {})
      }
    } catch (e) {
      const msg = String((e && e.message) || e)
      if ((e && e.code === 'ERR_MODULE_NOT_FOUND') || /Cannot find (package|module)/.test(msg)) {
        out.state = 'skipped'
        out.reason = msg
      } else {
        out.state = 'fail'
        out.errors.push(msg)
      }
    }

    // 断言恰好注册到期望的工具名（R006 ① 第 5 项：要断言注册结果，不是只看文件能加载）
    if (out.state === 'pass') {
      const got = out.registered.slice().sort()
      const want = expect.slice().sort()
      const same = got.length === want.length && got.every((n, i) => n === want[i])
      if (!same) {
        out.state = 'fail'
        out.errors.push('注册的工具名与期望不一致：得到 [' + got.join(', ') + ']，期望 [' + want.join(', ') + ']')
      }
    }
    return out
  } finally {
    smokeDepth -= 1
  }
}

export async function runSelfCheck(name, spec = {}) {
  const deps = dependencyReport()
  const symbols = symbolCheck(spec.requiredSymbols || [], spec.sourceFiles || [])
  const smoke = await mountSmoke()
  const result = {
    ok: symbols.ok !== false && smoke.state !== 'fail',
    tool: name,
    sections: {
      capabilities: CAPABILITIES,
      forbidden: FORBIDDEN_PATHS,
      dependencies: deps,
      symbols: symbols,
      smoke: smoke,
    },
    expectedTools: EXPECTED_TOOLS,
    logPath: LOG_PATH,
  }
  try {
    const dir = join(process.env.HOME || '.', '.dsh', 'plugin-selfcheck')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name + '.json'), JSON.stringify(result, null, 2))
  } catch (e) {
    // 落盘失败不阻断挂载
  }
  return result
}
