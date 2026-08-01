let fallbackCounter = 0
const encoder = new TextEncoder()

export function createUuid() {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    try { return cryptoApi.randomUUID() } catch {}
  }

  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      cryptoApi.getRandomValues(bytes)
      return formatUuid(bytes)
    } catch {}
  }

  const now = Date.now()
  const view = new DataView(bytes.buffer)
  fallbackCounter = (fallbackCounter + 1) >>> 0
  view.setUint32(0, Math.floor(now / 0x100000000))
  view.setUint32(4, now >>> 0)
  view.setUint32(8, fallbackCounter)
  view.setUint32(12, Math.floor(Math.random() * 0x100000000))
  return formatUuid(bytes)
}

function formatUuid(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

function fallbackHash(value: string) {
  const bytes = encoder.encode(value)
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193)
    second = Math.imul(second ^ byte, 0x85ebca6b)
  }
  first = Math.imul(first ^ bytes.length ^ (first >>> 16), 0x85ebca6b)
  second = Math.imul(second ^ bytes.length ^ (second >>> 13), 0xc2b2ae35)
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0')
}

export async function shortRequestHash(value: string) {
  const subtle = globalThis.crypto?.subtle
  if (typeof subtle?.digest === 'function') {
    try {
      const digest = await subtle.digest('SHA-256', encoder.encode(value))
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
    } catch {}
  }
  return fallbackHash(value)
}
