#!/usr/bin/env node
// dsh-plugin-pstd · 插件命名铁门 N1–N8 与 R006 十项审查员（含 P1–P5 模式化交付生成）
// R006 ⑨ CLI 治理：严格参数（未知旗标 exit 2）/ 退出码 0 成功·1 失败·2 用法或 IO / --dry-run 零变更 / --json / --help
// R006 ⑦ 统一日志：每次调用（含失败与用法错误）都落一条
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lean4Check } from './lib/gate.js'
import { CAPABILITIES, runSelfCheck } from './lib/selfcheck.js'
import { LOG_PATH, summarize, writeLog } from './lib/log.js'
import { STD_ID, TOOL_NAMES } from './lib/standard.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const FLAGS = Object.freeze(['--help', '-h', '--json', '--dry-run', '--selfcheck', '--lean4-check', '--tool-version'])

export function usage() {
  return [
    'dsh-plugin-pstd — 插件命名铁门 N1–N8 与 R006 十项审查员（含 P1–P5 模式化交付生成）',
    '',
    '用法：pstd [旗标]',
    '',
    '  --selfcheck      能力清单 / 不该发生路径 / 依赖完整性 + 真挂载冒烟（R006 ②）',
    '  --lean4-check    约束门六项自证 A–F（R006 ⑩）',
    '  --tool-version   打印版本（唯一来源：package.json）',
    '  --dry-run        零变更演练',
    '  --json           机器可读输出',
    '  --help           本帮助',
    '',
    '退出码：0 成功 · 1 失败/门失效 · 2 用法或 IO 错误',
  ].join('\n') + '\n'
}

export function toolVersion() {
  // ⑥ 版本单一来源：只从 package.json 读，绝不第二处硬编码
  return JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version
}

export function statusReport(options = {}) {
  const dryRun = options.dryRun === true
  return {
    ok: true,
    tool: 'pstd',
    version: toolVersion(),
    std: STD_ID,
    tools: TOOL_NAMES,
    logPath: LOG_PATH,
    dryRun: dryRun,
    checkedAt: new Date().toISOString(),
    capabilities: CAPABILITIES,
    note: '只读状态报告：不写盘、不改任何外部状态',
  }
}

export async function main(argv) {
  const started = Date.now()
  const finish = (code, summary, diagnostic) => {
    writeLog({
      tool: 'pstd-cli',
      input: summarize(argv, 200),
      decision: 'exit:' + code,
      result: summarize(summary, 400),
      diagnostic: diagnostic === undefined ? null : summarize(diagnostic, 600),
      ms: Date.now() - started,
    })
    return code
  }

  const unknown = argv.filter((a) => a.indexOf('-') === 0 && FLAGS.indexOf(a) === -1)
  if (unknown.length > 0) {
    process.stderr.write('用法错误：未知旗标 ' + unknown.join(' ') + '\n')
    return finish(2, '未知旗标', unknown.join(' '))
  }

  try {
    const emit = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n')
    if (argv.length === 0 || argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
      process.stdout.write(usage())
      return finish(0, 'help')
    }
    if (argv.indexOf('--tool-version') !== -1) {
      const version = toolVersion()
      process.stdout.write(version + '\n')
      return finish(0, 'tool-version ' + version)
    }
    if (argv.indexOf('--selfcheck') !== -1) {
      const result = await runSelfCheck('pstd', { sourceFiles: ['cli.js', 'lib/index.js'], requiredSymbols: ['apply'] })
      emit(result)
      return finish(result.ok ? 0 : 1, 'selfcheck ok=' + result.ok + ' smoke=' + result.sections.smoke.state)
    }
    if (argv.indexOf('--lean4-check') !== -1) {
      const result = lean4Check()
      emit(result)
      return finish(result.ok ? 0 : 1, 'lean4-check ok=' + result.ok + ' 负例' + result.negativeCount + ' 正例' + result.positiveCount)
    }
    const status = statusReport({ dryRun: argv.indexOf('--dry-run') !== -1 })
    emit(status)
    return finish(0, 'status dryRun=' + status.dryRun)
  } catch (err) {
    const detail = String((err && err.message) || err)
    process.stderr.write('IO 错误：' + detail + '\n')
    return finish(2, 'exception', String((err && err.stack) || err))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)))
}
