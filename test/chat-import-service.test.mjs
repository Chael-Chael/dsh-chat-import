import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.mjs'
import { makeCtx } from './_support/fake-host.mjs'
import { freshDshHome } from './_support/tmp-db.mjs'
import { hostAbs } from './_support/host-path.mjs'

beforeEach(() => {
  process.env.DSH_HOME = freshDshHome('dsh-home-')
})

test('chatImport service delegates to the import_chat pipeline and returns its result', async () => {
  const path = 'D:\\demo\\proj\\service-session.jsonl'
  const raw = [
    JSON.stringify({ sessionId: 'service-session', type: 'user', cwd: hostAbs('D:/demo/proj'), message: { role: 'user', content: '你好' } }),
    JSON.stringify({ sessionId: 'service-session', type: 'assistant', message: { role: 'assistant', content: '你好！' } }),
  ].join('\n') + '\n'
  const env = makeCtx({ [path]: raw })
  let provided
  env.ctx.provide = (name, service) => {
    if (name === 'chatImport') provided = service
  }

  apply(env.ctx)

  assert.equal(typeof provided?.importPath, 'function')
  const result = await provided.importPath({ format: 'claude', path })
  assert.equal(result.status, 'imported')
  assert.equal(result.mode, 'single')
  assert.equal(result.sessionId, 'import-service-session')
  assert.equal(env.persistence.sessions.size, 1)
})

test('chatImport service validates the public input', async () => {
  const env = makeCtx()
  let provided
  env.ctx.provide = (name, service) => {
    if (name === 'chatImport') provided = service
  }
  apply(env.ctx)

  await assert.rejects(() => provided.importPath({ format: 'claude' }), /path is required/)
  await assert.rejects(() => provided.importPath({ format: 'unknown', path: 'x' }), /未知格式/)
})
