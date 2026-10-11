// lib/chat-import-service.mjs — 给其它 DSH 插件复用的导入服务
//
// 只暴露现有 import_chat 分发器的 host 面，不另写一套解析或落盘逻辑。

import { IMPORT_SPECS, buildImportExecutor } from './toolkit.mjs'

const SERVICE_NAME = 'chatImport'

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new TypeError('chatImport.importPath: input must be an object')
  if (typeof input.format !== 'string' || !input.format) throw new TypeError('chatImport.importPath: format is required')
  if (typeof input.path !== 'string' || !input.path) throw new TypeError('chatImport.importPath: path is required')
}

/**
 * Register the public host service after the import specs have been built.
 * The service returns the same result shape as import_chat, including sessionId
 * for a single import and results for a batch import.
 */
export function registerChatImportService(ctx) {
  if (typeof ctx.provide !== 'function') return

  const service = Object.freeze({
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
  })

  ctx.provide(SERVICE_NAME, service)
}
