// lib/chat-import-service.mjs — 给其它 DSH 插件复用的导入服务
//
// 只暴露现有 import_chat 分发器的 host 面，不另写一套解析或落盘逻辑。

import { resolveImportBudget } from './budget.mjs'
import { runScanDiscover } from './discovery-host.mjs'
import { summarizeClaudeJsonl, summarizeCodexJsonl } from './handoff.mjs'
import { beginRegistryBatch, endRegistryBatch, resolveRegistryDir } from './imports.mjs'
import { importDiscoveryItem, IMPORT_SPECS, buildImportExecutor } from './toolkit.mjs'

const SERVICE_NAME = 'chatImport'

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new TypeError('chatImport.importPath: input must be an object')
  if (typeof input.format !== 'string' || !input.format) throw new TypeError('chatImport.importPath: format is required')
  if (typeof input.path !== 'string' || !input.path) throw new TypeError('chatImport.importPath: path is required')
}

function objectInput(name, input) {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('chatImport.' + name + ': input must be an object')
  }
  return input
}

function validateResumeInput(input) {
  if (typeof input.format !== 'string' || !['claude', 'codex'].includes(input.format)) {
    throw new TypeError('chatImport.resumeSummary: format must be claude or codex')
  }
  if (typeof input.path !== 'string' || !input.path) {
    throw new TypeError('chatImport.resumeSummary: path is required')
  }
}

async function importAll(ctx, registryDir, input, signal) {
  const budgetInfo = await resolveImportBudget(ctx, input)
  signal?.throwIfAborted?.()
  const scan = await runScanDiscover(ctx, { format: input.format, path: input.path, query: input.query }, registryDir)
  const summary = {
    mode: 'batch',
    scanned: scan.total,
    imported: 0,
    appended: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    results: [],
    warnings: scan.warnings,
  }
  beginRegistryBatch(registryDir)
  try {
    for (const session of scan.sessions || []) {
      signal?.throwIfAborted?.()
      if (!input.force && (session.importStatus === 'imported' || session.importStatus === 'archived')) {
        summary.skipped++
        summary.results.push({ format: session.format, sourcePath: session.sourcePath, sourceSessionId: session.sessionId, status: 'skipped' })
        continue
      }
      try {
        const out = await importDiscoveryItem(ctx, session.format, session.sourcePath, [session.sessionId], {
          force: input.force === true,
          budget: budgetInfo.budget,
          budgetSource: budgetInfo.source,
          storeImages: input.storeImages,
        })
        if (out.mode === 'batch') {
          summary.imported += out.imported || 0
          summary.appended += out.appended || 0
          summary.skipped += (out.alreadyImported || 0) + (out.skipped || 0)
          summary.failed += out.failed || 0
        } else if (out.status === 'imported') summary.imported++
        else if (out.status === 'appended') summary.appended++
        else if (out.status === 'failed') summary.failed++
        else summary.skipped++
        summary.results.push({
          format: session.format,
          sourcePath: session.sourcePath,
          sourceSessionId: session.sessionId,
          status: out.status || out.mode,
          result: out,
        })
      } catch (err) {
        summary.failed++
        const error = String((err && err.message) || err)
        if (summary.errors.length < 8) summary.errors.push({ sourcePath: session.sourcePath, error })
        summary.results.push({ format: session.format, sourcePath: session.sourcePath, sourceSessionId: session.sessionId, status: 'failed', error })
      }
    }
  } finally {
    await endRegistryBatch()
  }
  signal?.throwIfAborted?.()
  return summary
}

/**
 * Register the public host service after the import specs have been built.
 * The service returns the same result shape as import_chat, including sessionId
 * for a single import and results for a batch import.
 */
export function registerChatImportService(ctx) {
  if (typeof ctx.provide !== 'function') return

  const registryDir = resolveRegistryDir()

  const service = Object.freeze({
    async scanDiscover(input, signal) {
      const args = objectInput('scanDiscover', input)
      signal?.throwIfAborted?.()
      const result = await runScanDiscover(ctx, args, registryDir)
      signal?.throwIfAborted?.()
      return result
    },
    async importPath(input, signal) {
      validateInput(input)
      signal?.throwIfAborted?.()
      const { format, ...args } = input
      const spec = IMPORT_SPECS.get(format)
      if (!spec) throw new Error('未知格式: ' + format)
      const result = await buildImportExecutor(ctx, spec)(args)
      signal?.throwIfAborted?.()
      return result
    },
    async importAll(input, signal) {
      return importAll(ctx, registryDir, objectInput('importAll', input), signal)
    },
    async resumeSummary(input, signal) {
      const args = objectInput('resumeSummary', input)
      validateResumeInput(args)
      signal?.throwIfAborted?.()
      const raw = await ctx.fs.readText(await ctx.fs.resolve(args.path))
      signal?.throwIfAborted?.()
      const summarize = args.format === 'claude' ? summarizeClaudeJsonl : summarizeCodexJsonl
      const result = summarize(raw, { sessionId: args.sessionId || null })
      if (!result.lastUserPrompt) throw new Error('会话 ' + (args.sessionId || args.path) + ' 无用户回合可交接')
      signal?.throwIfAborted?.()
      return { format: args.format, sessionId: args.sessionId, ...result }
    },
  })

  ctx.provide(SERVICE_NAME, service)
}
