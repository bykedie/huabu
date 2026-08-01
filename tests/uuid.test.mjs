import test from 'node:test'
import assert from 'node:assert/strict'

import { createUuid, shortRequestHash } from '../src/uuid.ts'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function withCrypto(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value })
  try { return await run() } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
    else delete globalThis.crypto
  }
}

test('client UUID helper works with native, partial, and missing Web Crypto', async () => {
  const nativeUuid = createUuid()
  assert.match(nativeUuid, uuidV4)

  await withCrypto({
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 17 + 3) & 255
      return bytes
    },
  }, async () => {
    assert.match(createUuid(), uuidV4)
    const first = await shortRequestHash('same prompt')
    const second = await shortRequestHash('same prompt')
    assert.equal(first, second)
    assert.match(first, /^[0-9a-f]{16}$/)
  })

  await withCrypto(undefined, async () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createUuid()))
    assert.equal(ids.size, 1000)
    for (const id of ids) assert.match(id, uuidV4)
    assert.match(await shortRequestHash('fallback prompt'), /^[0-9a-f]{16}$/)
  })
})
