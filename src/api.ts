export type User = { id: string; email: string; name: string; role: 'admin' | 'user'; balance: number }

const tokenKey = 'ink-canvas-token'
const sessionEvents = new EventTarget()
export const session = {
  get: () => localStorage.getItem(tokenKey),
  set: (token: string) => localStorage.setItem(tokenKey, token),
  clear: () => {
    localStorage.removeItem(tokenKey)
    sessionEvents.dispatchEvent(new Event('clear'))
  },
  onClear: (listener: () => void) => {
    sessionEvents.addEventListener('clear', listener)
    return () => sessionEvents.removeEventListener('clear', listener)
  },
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('content-type', 'application/json')
  const token = session.get()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`/api${path}`, { ...options, headers })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) {
      session.clear()
    }
    throw new Error(data.error || '请求失败，请稍后重试')
  }
  return data as T
}
