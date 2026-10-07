// dsh-plugin-pstd · lib/log.js
// R006 ⑦ 统一日志：固定路径、结构化、失败也留痕、日志失败绝不影响工具。
// 每次动作记录：时间 / 工具名 / 入参摘要 / 判断 / 结果摘要 / 诊断 / 耗时。
// 仅用 node:fs + node:path + node:os。
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const LOG_PATH = join(homedir(), 'dsh-collab', 'logs', 'dsh-plugin-pstd.log')

export function summarize(value, max) {
  const limit = typeof max === 'number' && max > 0 ? max : 300
  let text
  try {
    if (value === null || value === undefined) text = String(value)
    else if (typeof value === 'string') text = value
    else text = JSON.stringify(value)
  } catch (err) {
    text = '<unserializable>'
  }
  if (typeof text !== 'string') text = String(text)
  return text.length > limit ? text.slice(0, limit) + '…(截断 ' + (text.length - limit) + ' 字)' : text
}

// 写失败一律吞掉并返回 false —— 日志不可用不是工具失败的理由
export function writeLog(entry) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    const record = Object.assign({ ts: new Date().toISOString() }, entry)
    appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', 'utf8')
    return true
  } catch (err) {
    return false
  }
}

function decisionOf(outcome, error) {
  if (error !== null) return 'throw'
  if (outcome && outcome.blocked === true) return 'blocked:' + String(outcome.gate)
  if (outcome && outcome.ok === true) return 'ok'
  if (outcome && outcome.ok === false) return 'fail'
  return 'unknown'
}

// 包住一次工具执行：成功/失败/占用被拒都在 finally 里落一条，异常原样抛出
export async function withLog(tool, args, run) {
  const started = Date.now()
  let outcome = null
  let error = null
  try {
    outcome = await run()
    return outcome
  } catch (err) {
    error = String((err && err.stack) || (err && err.message) || err)
    throw err
  } finally {
    writeLog({
      tool: tool,
      input: summarize(args),
      decision: decisionOf(outcome, error),
      result: summarize(outcome, 400),
      diagnostic: error === null ? null : summarize(error, 600),
      ms: Date.now() - started,
    })
  }
}
