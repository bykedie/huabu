import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge, Background, BackgroundVariant, Connection, Controls, Edge, Handle, MiniMap,
  Node, NodeProps, Position, ReactFlow, ReactFlowInstance, useEdgesState, useNodesState,
} from '@xyflow/react'
import {
  Bot, Check, ChevronLeft, CircleDollarSign, FilePlus2, Image, LayoutDashboard,
  LogOut, Menu, Plus, Save, Settings, StickyNote, Text, Trash2, X,
} from 'lucide-react'
import { api, session, User } from './api'

type CanvasData = {
  kind: 'note' | 'text' | 'ai' | 'image'
  title?: string
  content?: string
  prompt?: string
  imageUrl?: string
  busy?: boolean
  onChange?: (id: string, patch: Partial<CanvasData>) => void
  onRun?: (id: string, prompt: string) => void
}
type CanvasNode = Node<CanvasData>
type CanvasInfo = {
  id: string
  name: string
  updated_at?: string
  document?: { nodes: CanvasNode[]; edges: Edge[] }
}
type Notice = { type: 'ok' | 'error'; text: string } | null
const uid = () => crypto.randomUUID()
async function aiRequestKey(canvasId: string, nodeId: string, prompt: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const storageKey = `ink-ai:${canvasId}:${nodeId}:${hash}`
  const requestKey = localStorage.getItem(storageKey) || uid()
  localStorage.setItem(storageKey, requestKey)
  return { requestKey, storageKey }
}

function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const icon = data.kind === 'ai' ? <Bot size={15} /> : data.kind === 'image' ? <Image size={15} /> : data.kind === 'note' ? <StickyNote size={15} /> : <Text size={15} />
  return (
    <article className={`canvas-node kind-${data.kind} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <header>{icon}<input className="node-title nodrag" aria-label="节点标题" value={data.title || ''} onChange={(event) => data.onChange?.(id, { title: event.target.value })} /></header>
      {data.kind === 'image' ? (
        <div className="image-body">
          {data.imageUrl && <img src={data.imageUrl} alt={data.title || '画布图片'} />}
          <input className="node-input nodrag" placeholder="粘贴图片地址" value={data.imageUrl || ''} onChange={(event) => data.onChange?.(id, { imageUrl: event.target.value })} />
        </div>
      ) : data.kind === 'ai' ? (
        <div className="ai-body">
          <textarea className="nodrag nowheel" placeholder="告诉 AI 你想探索什么…" value={data.prompt || ''} onChange={(event) => data.onChange?.(id, { prompt: event.target.value })} />
          {data.content && <div className="ai-answer">{data.content}</div>}
          <button className="node-run nodrag" disabled={data.busy || !data.prompt?.trim()} onClick={() => data.onRun?.(id, data.prompt || '')}>{data.busy ? '思考中…' : <><Bot size={14} />生成</>}</button>
        </div>
      ) : (
        <textarea className="node-content nodrag nowheel" placeholder="写点什么…" value={data.content || ''} onChange={(event) => data.onChange?.(id, { content: event.target.value })} />
      )}
      <Handle type="source" position={Position.Right} />
    </article>
  )
}

function Auth({ onDone }: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget))
      const result = await api<{ token: string; user: User }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) })
      session.set(result.token)
      onDone(result.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-visual" aria-hidden="true">
        <div className="visual-grid" />
        <div className="visual-node visual-a"><StickyNote size={18} /><span>梳理创意</span></div>
        <div className="visual-node visual-b"><Bot size={18} /><span>让 AI 延展思路</span></div>
        <div className="visual-node visual-c"><Image size={18} /><span>收集视觉参考</span></div>
        <svg viewBox="0 0 600 500"><path d="M180 170 C270 170 250 270 350 270 M350 270 C420 270 405 365 470 365" /></svg>
        <div className="brand-lockup"><div className="brand-mark">墨</div><strong>墨屿画布</strong><p>把散落的想法，连成可以生长的地图。</p></div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <div className="mobile-brand"><div className="brand-mark">墨</div><strong>墨屿画布</strong></div>
          <span className="eyebrow">INFINITE WORKSPACE</span>
          <h1>{mode === 'login' ? '回到你的画布' : '创建创作空间'}</h1>
          <p>{mode === 'login' ? '继续整理灵感、素材和 AI 对话。' : '注册后即可创建画布，站长可使用初始化码创建管理员。'}</p>
          {mode === 'register' && <label>昵称<input name="name" minLength={2} maxLength={30} required placeholder="你的称呼" /></label>}
          <label>邮箱<input name="email" type="email" required placeholder="name@example.com" /></label>
          <label>密码<input name="password" type="password" minLength={8} required placeholder="至少 8 位" /></label>
          {mode === 'register' && <label>管理员初始化码（可选）<input name="setupToken" type="password" autoComplete="off" placeholder="仅站长首次注册时填写" /></label>}
          {error && <div className="form-error">{error}</div>}
          <button className="primary full" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}</button>
          <button type="button" className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}</button>
        </form>
      </section>
    </main>
  )
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <><button className="drawer-backdrop" aria-label="关闭" onClick={onClose} /><aside className="drawer"><header><h2>{title}</h2><button className="icon-button" title="关闭" onClick={onClose}><X size={19} /></button></header>{children}</aside></>
}

function WalletDrawer({ user, refresh, close, notify }: { user: User; refresh: () => void; close: () => void; notify: (notice: Notice) => void }) {
  type Entry = { id: string; amount: number; note: string; created_at: string }
  type TopupOrder = { id: string; amount_cents: number; points: number; status: 'pending' | 'approved' | 'rejected' }
  const [ledger, setLedger] = useState<Entry[]>([])
  const [orders, setOrders] = useState<TopupOrder[]>([])
  const [config, setConfig] = useState({ centsPerPoint: 1, topupInstructions: '' })
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState(10)
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [wallet, topups, publicConfig] = await Promise.all([
      api<{ ledger: Entry[] }>('/wallet'),
      api<{ orders: TopupOrder[] }>('/topups'),
      api<{ centsPerPoint: number; topupInstructions: string }>('/config'),
    ])
    setLedger(wallet.ledger)
    setOrders(topups.orders)
    setConfig(publicConfig)
  }, [])
  useEffect(() => { void load().catch((err) => notify({ type: 'error', text: err.message })) }, [load, notify])
  async function redeem() {
    if (busy) return
    setBusy(true)
    try {
      await api('/redeem', { method: 'POST', body: JSON.stringify({ code }) })
      setCode('')
      await load()
      refresh()
      notify({ type: 'ok', text: '兑换成功，积分已到账' })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { setBusy(false) }
  }
  async function topup() {
    if (busy || !Number.isFinite(amount) || amount < 1 || amount > 100000 || proof.trim().length < 4) return
    setBusy(true)
    try {
      await api('/topups', { method: 'POST', body: JSON.stringify({ amountCents: Math.round(amount * 100), proof }) })
      setProof('')
      await load()
      notify({ type: 'ok', text: '充值申请已提交，等待管理员审核' })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { setBusy(false) }
  }
  const statusText = { pending: '待审核', approved: '已到账', rejected: '已驳回' }
  const estimatedPoints = Number.isFinite(amount) && amount >= 0 ? Math.floor(amount * 100 / config.centsPerPoint) : 0
  return <Drawer title="积分账户" onClose={close}>
    <div className="balance-band"><span>可用积分</span><strong>{user.balance.toLocaleString()}</strong><small>AI 调用按实际用量结算</small></div>
    <section className="drawer-section"><h3>兑换积分</h3><div className="inline-form"><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="输入兑换码" /><button className="primary" onClick={redeem} disabled={busy || !code.trim()}>兑换</button></div></section>
    <section className="drawer-section"><h3>充值申请</h3>{config.topupInstructions ? <p className="payment-instructions">{config.topupInstructions}</p> : <p className="muted">管理员尚未配置收款方式，暂时可使用兑换码充值。</p>}<label>充值金额（元）<input type="number" min={1} max={100000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label><p className="muted">预计到账 {estimatedPoints.toLocaleString()} 积分</p><label>付款交易单号<input value={proof} minLength={4} maxLength={100} required onChange={(event) => setProof(event.target.value)} placeholder="填写唯一的微信或支付宝交易单号" /></label><button className="secondary" onClick={topup} disabled={busy || !config.topupInstructions || !Number.isFinite(amount) || amount < 1 || amount > 100000 || proof.trim().length < 4}>提交审核</button><p className="muted">当前采用人工审核，管理员确认收款后积分到账。</p></section>
    {orders.length > 0 && <section className="drawer-section"><h3>充值记录</h3><div className="topup-history">{orders.slice(0, 10).map((order) => <div key={order.id}><span>¥{(order.amount_cents / 100).toFixed(2)} · {order.points.toLocaleString()} 积分</span><strong className={order.status}>{statusText[order.status]}</strong></div>)}</div></section>}
    <section className="drawer-section"><h3>最近明细</h3><div className="ledger">{ledger.map((item) => <div key={item.id}><span>{item.note || '积分变动'}<small>{new Date(item.created_at + 'Z').toLocaleString()}</small></span><strong className={item.amount > 0 ? 'gain' : 'cost'}>{item.amount > 0 ? '+' : ''}{item.amount}</strong></div>)}</div></section>
  </Drawer>
}

function AdminDrawer({ close, notify, refresh }: { close: () => void; notify: (notice: Notice) => void; refresh: () => void }) {
  type Order = { id: string; email: string; amount_cents: number; points: number; status: string; proof?: string }
  type AdminData = { stats: Record<string, number>; orders: Order[]; ai: { configured: boolean; baseUrl: string } }
  const [data, setData] = useState<AdminData | null>(null)
  const [points, setPoints] = useState(100)
  const [count, setCount] = useState(1)
  const [codes, setCodes] = useState<string[]>([])
  const load = useCallback(() => api<AdminData>('/admin/overview').then(setData), [])
  useEffect(() => { void load() }, [load])
  async function createCodes() {
    try {
      const result = await api<{ codes: string[] }>('/admin/codes', { method: 'POST', body: JSON.stringify({ points, count, maxUses: 1, label: '后台生成' }) })
      setCodes(result.codes)
      notify({ type: 'ok', text: `已生成 ${result.codes.length} 个兑换码` })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) }
  }
  async function review(id: string, action: 'approve' | 'reject') {
    try {
      await api(`/admin/topups/${id}/${action}`, { method: 'POST' })
      await load()
      if (action === 'approve') refresh()
      notify({ type: 'ok', text: action === 'approve' ? '积分已到账' : '订单已驳回' })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) }
  }
  const pending = data?.orders.filter((order) => order.status === 'pending') || []
  return <Drawer title="运营管理" onClose={close}>
    {data && <><div className="stats-row"><div><span>用户</span><strong>{data.stats.users}</strong></div><div><span>画布</span><strong>{data.stats.canvases}</strong></div><div><span>待审核</span><strong>{data.stats.pendingTopups}</strong></div></div><div className={`config-status ${data.ai.configured ? 'ready' : ''}`}><span>{data.ai.configured ? <Check size={16} /> : <Settings size={16} />}{data.ai.configured ? 'AI 中转已配置' : 'AI 中转待配置'}</span><small>{data.ai.baseUrl || '请在服务器 .env 中配置中转站地址和密钥'}</small></div></>}
    <section className="drawer-section"><h3>生成兑换码</h3><div className="two-cols"><label>每码积分<input type="number" min={1} value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label><label>生成数量<input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label></div><button className="secondary" onClick={createCodes}>生成兑换码</button>{codes.length > 0 && <textarea className="codes-output" readOnly value={codes.join(String.fromCharCode(10))} />}</section>
    <section className="drawer-section"><h3>充值审核</h3><div className="orders">{pending.map((order) => <div key={order.id}><span><strong>{order.email}</strong><small>¥{(order.amount_cents / 100).toFixed(2)} · {order.points} 积分</small><small>{order.proof || '未填写备注'}</small></span><div><button className="icon-button accept" title="通过" onClick={() => review(order.id, 'approve')}><Check size={17} /></button><button className="icon-button" title="驳回" onClick={() => review(order.id, 'reject')}><X size={17} /></button></div></div>)}{pending.length === 0 && <p className="muted">暂无待审核订单</p>}</div></section>
  </Drawer>
}

function Workspace({ user, setUser }: { user: User; setUser: (user: User | null) => void }) {
  const [canvases, setCanvases] = useState<CanvasInfo[]>([])
  const [current, setCurrent] = useState<CanvasInfo | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const [panel, setPanel] = useState<'wallet' | 'admin' | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [creatingCanvas, setCreatingCanvas] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const flow = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)
  const aiInFlight = useRef(0)
  const aiNodesInFlight = useRef(new Set<string>())
  const resolvedAIKeys = useRef(new Map<string, number>())
  const creatingCanvasRef = useRef(false)
  const revision = useRef(0)
  const persistedRevision = useRef(0)
  const activeCanvasId = useRef<string | null>(null)
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true))
  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const deletedCanvasIds = useRef(new Set<string>())
  const openRequest = useRef(0)
  activeCanvasId.current = current?.id || null

  const refreshUser = useCallback(async () => {
    const result = await api<{ user: User }>('/me')
    setUser(result.user)
  }, [setUser])
  const markDirty = useCallback(() => {
    revision.current += 1
    setSaveState('dirty')
  }, [])
  const updateNode = useCallback((id: string, patch: Partial<CanvasData>) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))
    markDirty()
  }, [markDirty, setNodes])
  const setNodeBusy = useCallback((id: string, busy: boolean) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, busy } } : node))
  }, [setNodes])
  const runAI = useCallback(async (id: string, prompt: string) => {
    const canvasId = activeCanvasId.current
    if (!canvasId || aiNodesInFlight.current.has(id)) return
    aiNodesInFlight.current.add(id)
    aiInFlight.current += 1
    setNodeBusy(id, true)
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再生成')
      const { requestKey, storageKey } = await aiRequestKey(canvasId, id, prompt)
      const result = await api<{ content: string; charged: number; cached: boolean }>('/ai/chat', { method: 'POST', body: JSON.stringify({ requestKey, messages: [{ role: 'user', content: prompt }], maxTokens: 1024 }) })
      if (activeCanvasId.current === canvasId) updateNode(id, { busy: false, content: result.content })
      resolvedAIKeys.current.set(storageKey, revision.current)
      await refreshUser()
      setNotice({ type: 'ok', text: result.cached ? '已恢复生成结果，本次未重复扣分' : `生成完成，消耗 ${result.charged} 积分` })
    } catch (err) {
      if (activeCanvasId.current === canvasId) setNodeBusy(id, false)
      setNotice({ type: 'error', text: (err as Error).message })
    } finally {
      aiNodesInFlight.current.delete(id)
      aiInFlight.current = Math.max(0, aiInFlight.current - 1)
    }
  }, [refreshUser, setNodeBusy, updateNode])
  const liveNodes = useMemo(() => nodes.map((node) => ({ ...node, data: { ...node.data, onChange: updateNode, onRun: runAI } })), [nodes, updateNode, runAI])
  const nodeTypes = useMemo(() => ({ canvasNode: CanvasNodeView }), [])
  const save = useCallback(() => {
    if (!current) return Promise.resolve(true)
    const canvas = { ...current }
    const savedName = canvas.name.trim() || '未命名画布'
    const savedRevision = revision.current
    const cleanNodes = nodes.map((node) => ({ ...node, data: { kind: node.data.kind, title: node.data.title, content: node.data.content, prompt: node.data.prompt, imageUrl: node.data.imageUrl } }))
    const cleanEdges = edges.map((edge) => ({ ...edge }))
    const persist = async () => {
      if (deletedCanvasIds.current.has(canvas.id)) return true
      if (activeCanvasId.current === canvas.id) setSaveState('saving')
      try {
        await api(`/canvases/${canvas.id}`, { method: 'PUT', body: JSON.stringify({ name: savedName, document: { nodes: cleanNodes, edges: cleanEdges } }) })
        for (const [key, requiredRevision] of resolvedAIKeys.current) {
          if (!key.startsWith(`ink-ai:${canvas.id}:`) || requiredRevision > savedRevision) continue
          localStorage.removeItem(key)
          resolvedAIKeys.current.delete(key)
        }
        setCanvases((items) => items.map((item) => item.id === canvas.id ? { ...item, name: savedName } : item))
        if (activeCanvasId.current === canvas.id) {
          if (canvas.name !== savedName) setCurrent((item) => item?.id === canvas.id ? { ...item, name: savedName } : item)
          persistedRevision.current = Math.max(persistedRevision.current, savedRevision)
          const nextState = revision.current === savedRevision ? 'saved' : 'dirty'
          setSaveState(nextState)
        }
        return true
      } catch (err) {
        if (activeCanvasId.current === canvas.id) {
          setSaveState('error')
          setNotice({ type: 'error', text: (err as Error).message })
        }
        return false
      }
    }
    saveQueue.current = saveQueue.current.then(persist, persist)
    return saveQueue.current
  }, [current, edges, nodes])
  saveRef.current = save
  const flush = useCallback(async () => {
    const canvasId = activeCanvasId.current
    if (canvasId && deletedCanvasIds.current.has(canvasId)) return true
    while (canvasId && activeCanvasId.current === canvasId && persistedRevision.current < revision.current) {
      if (!(await saveRef.current())) return false
    }
    return true
  }, [])
  flushRef.current = flush

  const openCanvas = useCallback(async (id: string) => {
    try {
      if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再切换画布' }); return }
      if (creatingCanvasRef.current) { setNotice({ type: 'error', text: '请等待画布创建完成' }); return }
      if (id === activeCanvasId.current || deletedCanvasIds.current.has(id)) return
      if (activeCanvasId.current && !(await flushRef.current())) return
      const requestId = ++openRequest.current
      const result = await api<{ canvas: CanvasInfo & { document: { nodes: CanvasNode[]; edges: Edge[] } } }>(`/canvases/${id}`)
      if (requestId !== openRequest.current || deletedCanvasIds.current.has(id)) return
      if (!(await flushRef.current()) || requestId !== openRequest.current) return
      activeCanvasId.current = id
      revision.current = 0
      persistedRevision.current = 0
      setCurrent(result.canvas)
      setNodes(result.canvas.document.nodes)
      setEdges(result.canvas.document.edges)
      setSaveState('saved')
      setSidebar(false)
      window.setTimeout(() => flow.current?.fitView({ padding: 0.25 }), 30)
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [setEdges, setNodes])
  useEffect(() => {
    api<{ canvases: CanvasInfo[] }>('/canvases').then((result) => {
      setCanvases(result.canvases)
      if (result.canvases[0]) void openCanvas(result.canvases[0].id)
    }).catch((err) => setNotice({ type: 'error', text: err.message }))
  }, [openCanvas])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function createCanvas() {
    if (creatingCanvasRef.current) return
    if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再新建画布' }); return }
    creatingCanvasRef.current = true
    setCreatingCanvas(true)
    try {
      if (activeCanvasId.current && !(await flushRef.current())) return
      const requestId = ++openRequest.current
      const result = await api<{ canvas: CanvasInfo }>('/canvases', { method: 'POST', body: JSON.stringify({ name: '未命名画布' }) })
      setCanvases((items) => items.some((item) => item.id === result.canvas.id) ? items : [result.canvas, ...items])
      if (!(await flushRef.current()) || requestId !== openRequest.current) return
      const first: CanvasNode = { id: uid(), type: 'canvasNode', position: { x: 80, y: 80 }, data: { kind: 'note', title: '欢迎来到墨屿', content: '从左侧添加内容，拖动画布探索空间。节点会自动保存。' } }
      activeCanvasId.current = result.canvas.id
      revision.current = 1
      persistedRevision.current = 0
      setCurrent(result.canvas)
      setNodes([first])
      setEdges([])
      setSaveState('dirty')
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message })
    } finally {
      creatingCanvasRef.current = false
      setCreatingCanvas(false)
    }
  }
  async function deleteCanvas(id: string) {
    if (deletedCanvasIds.current.has(id)) return
    if (creatingCanvasRef.current) { setNotice({ type: 'error', text: '请等待画布创建完成后再删除' }); return }
    if (id === activeCanvasId.current && aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再删除画布' }); return }
    if (!window.confirm('确定删除这张画布吗？此操作无法撤销。')) return
    ++openRequest.current
    deletedCanvasIds.current.add(id)
    try {
      await saveQueue.current
      await api(`/canvases/${id}`, { method: 'DELETE' })
    } catch (err) {
      deletedCanvasIds.current.delete(id)
      setNotice({ type: 'error', text: (err as Error).message })
      void flushRef.current()
      return
    }
    const remaining = canvases.filter((canvas) => canvas.id !== id)
    setCanvases(remaining)
    if (activeCanvasId.current === id) {
      ++openRequest.current
      activeCanvasId.current = null
      revision.current = 0
      persistedRevision.current = 0
      setCurrent(null)
      setNodes([])
      setEdges([])
      if (remaining[0]) await openCanvas(remaining[0].id)
    }
  }
  useEffect(() => {
    if (saveState !== 'dirty' || !current) return
    const timer = window.setTimeout(() => void save(), 900)
    return () => window.clearTimeout(timer)
  }, [current, edges, nodes, save, saveState])

  function addNode(kind: CanvasData['kind']) {
    const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    const title = kind === 'ai' ? 'AI 灵感' : kind === 'image' ? '视觉参考' : kind === 'note' ? '便签' : '文本'
    setNodes((items) => {
      const slot = items.length % 6
      const position = { x: center.x + (slot % 3) * 42, y: center.y + Math.floor(slot / 3) * 42 }
      return [...items, { id: uid(), type: 'canvasNode', position, data: { kind, title, content: '' } }]
    })
    markDirty()
  }
  const connect = useCallback((connection: Connection) => {
    setEdges((items) => addEdge({ ...connection, type: 'smoothstep' }, items))
    markDirty()
  }, [markDirty, setEdges])
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (persistedRevision.current >= revision.current && aiInFlight.current === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [])
  const logout = useCallback(async () => {
    if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再退出' }); return }
    if (!(await flushRef.current())) return
    session.clear()
    setUser(null)
  }, [setUser])

  return <main className="workspace">
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <div className="sidebar-brand"><div className="brand-mark small">墨</div><strong>墨屿</strong><button className="icon-button sidebar-close" title="收起" onClick={() => setSidebar(false)}><ChevronLeft size={18} /></button></div>
      <button className="new-canvas" onClick={createCanvas} disabled={creatingCanvas}><Plus size={17} />新建画布</button>
      <nav className="canvas-list" aria-label="我的画布">{canvases.map((canvas) => <div className={canvas.id === current?.id ? 'active' : ''} key={canvas.id}><button onClick={() => openCanvas(canvas.id)}><LayoutDashboard size={15} /><span>{canvas.name}</span></button><button className="canvas-delete" title="删除画布" onClick={() => deleteCanvas(canvas.id)}><Trash2 size={14} /></button></div>)}</nav>
      <div className="sidebar-account"><button onClick={() => setPanel('wallet')}><div className="avatar">{user.name.slice(0, 1)}</div><span><strong>{user.name}</strong><small>{user.balance} 积分</small></span></button><button className="icon-button" title="退出登录" onClick={() => void logout()}><LogOut size={17} /></button></div>
    </aside>
    {sidebar && <button className="sidebar-backdrop" onClick={() => setSidebar(false)} aria-label="关闭侧栏" />}
    <section className="canvas-shell">
      <header className="topbar"><button className="icon-button menu-button" title="菜单" onClick={() => setSidebar(true)}><Menu size={19} /></button>{current ? <input className="canvas-name" maxLength={80} value={current.name} onChange={(event) => { setCurrent({ ...current, name: event.target.value }); markDirty() }} aria-label="画布名称" /> : <strong>我的画布</strong>}<div className="top-actions"><span className={`save-state ${saveState}`}>{saveState === 'saving' ? '保存中' : saveState === 'dirty' ? '待保存' : saveState === 'error' ? '保存失败' : <><Check size={13} />已保存</>}</span><button className="points-button" onClick={() => setPanel('wallet')}><CircleDollarSign size={16} />{user.balance}</button>{user.role === 'admin' && <button className="icon-button" title="运营管理" onClick={() => setPanel('admin')}><Settings size={18} /></button>}<button className="icon-button" title="立即保存" onClick={() => void flush()}><Save size={18} /></button></div></header>
      {current ? <div className="flow-wrap">
        <ReactFlow<CanvasNode, Edge> nodes={liveNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={(changes) => { onNodesChange(changes); markDirty() }} onEdgesChange={(changes) => { onEdgesChange(changes); markDirty() }} onConnect={connect} onInit={(instance) => { flow.current = instance }} fitView deleteKeyCode={['Backspace', 'Delete']} minZoom={0.08} maxZoom={3} snapToGrid snapGrid={[16, 16]}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#c9cdd3" />
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data?.kind === 'ai' ? '#80cbc4' : node.data?.kind === 'note' ? '#efb64f' : '#aab7c8'} />
        </ReactFlow>
        <div className="tool-rail"><button title="便签" onClick={() => addNode('note')}><StickyNote size={19} /></button><button title="文本" onClick={() => addNode('text')}><Text size={19} /></button><button title="图片" onClick={() => addNode('image')}><Image size={19} /></button><span /><button className="ai-tool" title="AI 对话" onClick={() => addNode('ai')}><Bot size={19} /></button></div>
      </div> : <div className="empty-state"><div><FilePlus2 size={34} /><h2>从一张空白画布开始</h2><p>把文字、图片和 AI 对话放到同一个可延展空间。</p><button className="primary" onClick={createCanvas} disabled={creatingCanvas}><Plus size={17} />新建画布</button></div></div>}
    </section>
    {panel === 'wallet' && <WalletDrawer user={user} refresh={() => void refreshUser()} close={() => setPanel(null)} notify={setNotice} />}
    {panel === 'admin' && <AdminDrawer close={() => setPanel(null)} notify={setNotice} refresh={() => void refreshUser()} />}
    {notice && <div className={`toast ${notice.type}`}>{notice.type === 'ok' ? <Check size={16} /> : <X size={16} />}{notice.text}</div>}
  </main>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(session.get()))
  useEffect(() => {
    if (!session.get()) return
    api<{ user: User }>('/me').then((result) => setUser(result.user)).catch(() => session.clear()).finally(() => setLoading(false))
  }, [])
  if (loading) return <div className="app-loading"><div className="brand-mark">墨</div><span>正在打开画布…</span></div>
  return user ? <Workspace user={user} setUser={setUser} /> : <Auth onDone={setUser} />
}
