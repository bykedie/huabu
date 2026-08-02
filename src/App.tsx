import { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge, Background, BackgroundVariant, BaseEdge, Connection, Edge, EdgeLabelRenderer, EdgeProps, getBezierPath, Handle, MiniMap, NodeResizer, NodeToolbar,
  EdgeChange, Node, NodeChange, NodeProps, Position, ReactFlow, ReactFlowInstance, SelectionMode,
  useEdgesState, useNodesState,
} from '@xyflow/react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, Group,
  BookmarkPlus, Bot, Check, ChevronLeft, CircleDot, Compass, Copy, Download, Eraser, FilePlus2, Focus, Grid2X2, GripHorizontal, Hand, Image, Info, LayoutDashboard, Library,
  Crop, HelpCircle, KeyRound, LocateFixed, Lock, LockOpen, LogOut, Maximize2, Menu, MessageSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, Palette, Pencil, Plus, Redo2, Save, Search, Send, Settings, Sparkles, Square, StickyNote, Sun, Text, Trash2, Undo2, Video, X, ZoomIn,
  Upload,
} from 'lucide-react'
import { api, ApiError, session, User } from './api'
import { classifyCanvasImportFiles } from './canvas-import'
import { buildGenerationContext } from './generation-context'
import { createUuid, shortRequestHash } from './uuid'

type CanvasData = {
  kind: 'note' | 'text' | 'ai' | 'image' | 'video' | 'group'
  title?: string
  content?: string
  prompt?: string
  imageUrl?: string
  videoUrl?: string
  mode?: 'text' | 'image' | 'video'
  textModel?: string
  imageModel?: string
  imageSize?: ImageSize
  videoModel?: string
  videoSize?: VideoSize
  videoSeconds?: number
  textModels?: string[]
  imageModels?: string[]
  freeResize?: boolean
  videoModels?: string[]
  groupId?: string
  groupChildCount?: number
  referenceImages?: Array<{ id: string; title: string; imageUrl: string }>
  contextSummary?: { textCount: number; imageCount: number }
  hovered?: boolean
  busy?: boolean
  onChange?: (id: string, patch: Partial<CanvasData>) => void
  onRun?: (id: string, prompt: string, model?: string) => void
  onRunImage?: (id: string, prompt: string, model?: string, size?: ImageSize) => void
  onInspect?: (id: string) => void
  onRunVideo?: (id: string, prompt: string, model?: string, size?: VideoSize, seconds?: number) => void
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
  onBranch?: (id: string) => void
  onUpload?: (id: string, file: File) => void
  onDownload?: (id: string) => void
  onSaveAsset?: (id: string) => void
  onToggleImageRatio?: (id: string) => void
  onImageTool?: (id: string, tool: 'crop' | 'split' | 'upscale' | 'view') => void
}
type ImageSize = '1024x1024' | '1536x1024' | '1024x1536'
type VideoSize = '1280x720' | '720x1280' | '1024x1024'
type VideoGenerationResult = {
  id: string
  status: 'pending' | 'completed'
  videoUrl?: string
  model?: string
  charged: number
  cached: boolean
  pollAfterMs?: number
}
type CanvasNode = Node<CanvasData>
type CanvasInfo = {
  id: string
  name: string
  version: number
  updated_at?: string
  document?: { nodes: CanvasNode[]; edges: Edge[]; assistantMessages?: AssistantMessage[] }
}
type Notice = { type: 'ok' | 'error'; text: string } | null
type CanvasDraft = { baseVersion: number; name: string; nodes: CanvasNode[]; edges: Edge[]; assistantMessages: AssistantMessage[] }
type CanvasSnapshot = { nodes: CanvasNode[]; edges: Edge[] }
type BackgroundMode = 'dots' | 'lines' | 'blank'
type CanvasThemeMode = 'dark' | 'light'
type CanvasPanelTab = 'canvas' | 'assets' | 'prompts'
type CanvasMenu = { type: 'canvas'; x: number; y: number; screenX: number; screenY: number } | { type: 'node'; x: number; y: number; nodeId: string } | null
type Asset = { id: string; kind: 'image' | 'video' | 'text'; title: string; content: string; source_canvas_id?: string | null; source_node_id?: string | null; created_at?: string; updated_at?: string }
type AssistantMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number }
type ImageToolDialog = { nodeId: string; tool: 'crop' | 'split' | 'upscale' | 'view' } | null
type ImageToolbarToolId = 'info' | 'delete' | 'saveAsset' | 'download' | 'edit' | 'replace' | 'resize' | 'crop' | 'split' | 'upscale' | 'view'
type ImageToolbarConfig = { ids: ImageToolbarToolId[]; showLabels: boolean }
const uid = createUuid
const maxImageImportCount = 12
const imageToolbarStorageKey = 'ink-image-quick-tools-v1'
const imageToolbarToolIds: ImageToolbarToolId[] = ['info', 'delete', 'saveAsset', 'download', 'edit', 'replace', 'resize', 'crop', 'split', 'upscale', 'view']
const defaultImageToolbarConfig: ImageToolbarConfig = { ids: imageToolbarToolIds, showLabels: true }
function readImageToolbarConfig(): ImageToolbarConfig {
  try {
    const value = JSON.parse(localStorage.getItem(imageToolbarStorageKey) || 'null') as Partial<ImageToolbarConfig> | null
    const ids = Array.isArray(value?.ids) ? imageToolbarToolIds.filter((id) => value.ids?.includes(id)) : imageToolbarToolIds
    return { ids, showLabels: value?.showLabels !== false }
  } catch {
    localStorage.removeItem(imageToolbarStorageKey)
    return defaultImageToolbarConfig
  }
}
const draftKey = (userId: string, canvasId: string) => `ink-draft:${userId}:${canvasId}`
const nodeSize = (kind: CanvasData['kind']) => kind === 'group' ? { width: 760, height: 480 } : kind === 'ai' ? { width: 336, height: 320 } : kind === 'video' ? { width: 320, height: 292 } : kind === 'image' ? { width: 276, height: 260 } : { width: 276, height: 180 }
const nodeMinimumSize = (kind: CanvasData['kind']) => kind === 'ai' ? { width: 300, height: 280 } : { width: 220, height: 120 }
const withNodeSize = (node: CanvasNode): CanvasNode => {
  const fallback = nodeSize(node.data.kind)
  const minimum = nodeMinimumSize(node.data.kind)
  return { ...node, width: Math.max(minimum.width, node.width || fallback.width), height: Math.max(minimum.height, node.height || fallback.height), ...(node.data.kind === 'group' && node.zIndex === undefined ? { zIndex: -1 } : {}) }
}
const nodeDimensions = (node: CanvasNode) => ({
  width: node.measured?.width || node.width || nodeSize(node.data.kind).width,
  height: node.measured?.height || node.height || nodeSize(node.data.kind).height,
})
function openNodePosition(nodes: CanvasNode[], desired: { x: number; y: number }, kind: CanvasData['kind']) {
  const size = nodeSize(kind)
  const stepX = Math.max(340, size.width + 56)
  const stepY = Math.max(270, size.height + 56)
  const clear = (position: { x: number; y: number }) => nodes.every((node) => {
    const dimensions = nodeDimensions(node)
    return position.x + size.width + 24 <= node.position.x
      || position.x >= node.position.x + dimensions.width + 24
      || position.y + size.height + 24 <= node.position.y
      || position.y >= node.position.y + dimensions.height + 24
  })
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (radius && Math.abs(x) !== radius && Math.abs(y) !== radius) continue
        const position = { x: desired.x + x * stepX, y: desired.y + y * stepY }
        if (clear(position)) return position
      }
    }
  }
  return { x: desired.x + nodes.length * 36, y: desired.y + nodes.length * 36 }
}
const promptPresets = [
  { title: '电影感人像', content: '电影感人像摄影，自然肤色，柔和侧光，真实镜头质感，细节丰富，浅景深。' },
  { title: '产品视觉', content: '极简产品摄影，干净背景，精确材质，高级棚拍布光，商业广告质感。' },
  { title: '故事场景', content: '富有叙事感的场景，明确前中后景，环境光自然，电影构图，氛围细腻。' },
]
function parseAssistantMessages(value: unknown): AssistantMessage[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) return null
  const messages: AssistantMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const message = item as Record<string, unknown>
    if (typeof message.id !== 'string' || !message.id || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string' || message.content.length > 20000 || typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt)) return null
    messages.push({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt })
  }
  return messages
}
function makeDraft(baseVersion: number, name: string, nodes: CanvasNode[], edges: Edge[], assistantMessages: AssistantMessage[] = []): CanvasDraft {
  return {
    baseVersion,
    name,
    nodes: nodes.map((node) => {
      const { selected: _selected, dragging: _dragging, measured: _measured, ...persistedNode } = node
      return { ...persistedNode, data: {
        kind: node.data.kind, title: node.data.title, content: node.data.content, prompt: node.data.prompt, imageUrl: node.data.imageUrl, videoUrl: node.data.videoUrl,
        mode: node.data.mode, textModel: node.data.textModel, imageModel: node.data.imageModel, imageSize: node.data.imageSize,
        videoModel: node.data.videoModel, videoSize: node.data.videoSize, videoSeconds: node.data.videoSeconds, groupId: node.data.groupId, freeResize: node.data.freeResize,
      } }
    }),
    edges: edges.map((edge) => {
      const { selected: _selected, ...persistedEdge } = edge
      return persistedEdge
    }),
    assistantMessages: assistantMessages.slice(-50).map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt })),
  }
}
function parseDraft(value: unknown): CanvasDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Record<string, unknown>
  if (!Number.isInteger(draft.baseVersion) || typeof draft.name !== 'string' || draft.name.length > 80 || !Array.isArray(draft.nodes) || draft.nodes.length > 1000 || !Array.isArray(draft.edges) || draft.edges.length > 2000) return null
  const kinds = new Set<CanvasData['kind']>(['note', 'text', 'ai', 'image', 'video', 'group'])
  const nodes: CanvasNode[] = []
  for (const value of draft.nodes) {
    if (!value || typeof value !== 'object') return null
    const node = value as Record<string, unknown>
    const position = node.position as Record<string, unknown> | undefined
    const data = node.data as Record<string, unknown> | undefined
    if (typeof node.id !== 'string' || !node.id || node.id.length > 200 || !position || typeof position.x !== 'number' || !Number.isFinite(position.x) || typeof position.y !== 'number' || !Number.isFinite(position.y) || !data || !kinds.has(data.kind as CanvasData['kind'])) return null
    const textFields = ['title', 'content', 'prompt', 'imageUrl', 'videoUrl', 'textModel', 'imageModel', 'videoModel'] as const
    if (textFields.some((field) => data[field] !== undefined && typeof data[field] !== 'string')) return null
    if (data.mode !== undefined && data.mode !== 'text' && data.mode !== 'image' && data.mode !== 'video') return null
    if (data.imageSize !== undefined && !['1024x1024', '1536x1024', '1024x1536'].includes(String(data.imageSize))) return null
    if (data.videoSize !== undefined && !['1280x720', '720x1280', '1024x1024'].includes(String(data.videoSize))) return null
    if (data.videoSeconds !== undefined && (!Number.isInteger(data.videoSeconds) || Number(data.videoSeconds) < 1 || Number(data.videoSeconds) > 20)) return null
    const kind = data.kind as CanvasData['kind']
    const minimum = nodeMinimumSize(kind)
    const width = typeof node.width === 'number' && Number.isFinite(node.width) && node.width >= 220 && node.width <= 1600 ? Math.max(minimum.width, node.width) : nodeSize(kind).width
    const height = typeof node.height === 'number' && Number.isFinite(node.height) && node.height >= 120 && node.height <= 1200 ? Math.max(minimum.height, node.height) : nodeSize(kind).height
    nodes.push({
      id: node.id,
      type: 'canvasNode',
      position: { x: position.x, y: position.y },
      width,
      height,
      ...(data.kind === 'group' ? { zIndex: -1 } : {}),
      data: {
        kind,
        ...Object.fromEntries(textFields.filter((field) => typeof data[field] === 'string').map((field) => [field, data[field]])),
        ...(data.mode ? { mode: data.mode as CanvasData['mode'] } : {}),
        ...(data.imageSize ? { imageSize: data.imageSize as ImageSize } : {}),
        ...(data.videoSize ? { videoSize: data.videoSize as VideoSize } : {}),
        ...(data.videoSeconds ? { videoSeconds: data.videoSeconds as number } : {}),
        ...(typeof data.groupId === 'string' && data.groupId ? { groupId: data.groupId } : {}),
        ...(typeof data.freeResize === 'boolean' ? { freeResize: data.freeResize } : {}),
      },
    })
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodeIds.size !== nodes.length) return null
  const groupIds = new Set(nodes.filter((node) => node.data.kind === 'group').map((node) => node.id))
  nodes.forEach((node) => { if (node.data.groupId && !groupIds.has(node.data.groupId)) node.data.groupId = undefined })
  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  for (const value of draft.edges) {
    if (!value || typeof value !== 'object') return null
    const edge = value as Record<string, unknown>
    if (typeof edge.id !== 'string' || !edge.id || edge.id.length > 200 || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null
    if (edgeIds.has(edge.id)) return null
    if ((edge.sourceHandle !== undefined && edge.sourceHandle !== null && typeof edge.sourceHandle !== 'string') || (edge.targetHandle !== undefined && edge.targetHandle !== null && typeof edge.targetHandle !== 'string')) return null
    edges.push({ id: edge.id, source: edge.source, target: edge.target, type: 'bezier', sourceHandle: edge.sourceHandle as string | null | undefined, targetHandle: edge.targetHandle as string | null | undefined })
    edgeIds.add(edge.id)
  }
  const assistantMessages = parseAssistantMessages(draft.assistantMessages)
  if (!assistantMessages) return null
  return { baseVersion: draft.baseVersion as number, name: draft.name, nodes, edges, assistantMessages }
}
function readDraft(userId: string, canvasId: string): CanvasDraft | null {
  try {
    return parseDraft(JSON.parse(localStorage.getItem(draftKey(userId, canvasId)) || 'null'))
  } catch { return null }
}
async function aiRequestKey(canvasId: string, nodeId: string, prompt: string) {
  const hash = await shortRequestHash(prompt)
  const storageKey = `ink-ai:${canvasId}:${nodeId}:${hash}`
  const requestKey = localStorage.getItem(storageKey) || uid()
  localStorage.setItem(storageKey, requestKey)
  return { requestKey, storageKey }
}
async function compressedImageUrl(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理这张图片')
    for (const maxDimension of [1600, 1280, 1024, 896]) {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [.82, .7, .58]) {
        const dataUrl = canvas.toDataURL('image/webp', quality)
        if (dataUrl.length <= 1_200_000) return dataUrl
      }
    }
    throw new Error('图片压缩后仍然过大，请换一张尺寸更小的图片')
  } finally { bitmap.close() }
}
const imageFileUrl = (file: File) => compressedImageUrl(file)
async function persistableGeneratedImageUrl(imageUrl: string) {
  if (!imageUrl.startsWith('data:image/')) return imageUrl
  const comma = imageUrl.indexOf(',')
  const header = imageUrl.slice(0, comma)
  if (comma < 0 || !header.endsWith(';base64')) throw new Error('生图中转站返回了无效图片数据')
  const mimeType = header.slice(5, -7) || 'image/png'
  const binary = atob(imageUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return compressedImageUrl(new Blob([bytes], { type: mimeType }))
}
async function referenceImageDataUrl(imageUrl: string) {
  if (imageUrl.startsWith('data:image/')) return imageUrl
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('参考图读取失败，请重新上传到图片节点')
  return compressedImageUrl(await response.blob())
}
async function imageBitmapFromUrl(imageUrl: string) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('图片读取失败，请检查地址是否允许访问')
  return createImageBitmap(await response.blob())
}
async function canvasToDataUrl(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', .9))
  if (!blob) throw new Error('浏览器无法导出处理后的图片')
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片导出失败'))
    reader.readAsDataURL(blob)
  })
}
async function cropImageUrl(imageUrl: string, ratio: number | null) {
  const bitmap = await imageBitmapFromUrl(imageUrl)
  try {
    let width = bitmap.width
    let height = bitmap.height
    if (ratio) {
      if (width / height > ratio) width = Math.round(height * ratio)
      else height = Math.round(width / ratio)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, Math.round((bitmap.width - width) / 2), Math.round((bitmap.height - height) / 2), width, height, 0, 0, width, height)
    return { imageUrl: await canvasToDataUrl(canvas), width, height }
  } finally { bitmap.close() }
}
async function splitImageUrl(imageUrl: string, rows: number, columns: number) {
  const bitmap = await imageBitmapFromUrl(imageUrl)
  try {
    const pieces: Array<{ imageUrl: string; row: number; column: number; width: number; height: number }> = []
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const sx = Math.round(column * bitmap.width / columns)
      const sy = Math.round(row * bitmap.height / rows)
      const ex = Math.round((column + 1) * bitmap.width / columns)
      const ey = Math.round((row + 1) * bitmap.height / rows)
      const canvas = document.createElement('canvas')
      canvas.width = ex - sx; canvas.height = ey - sy
      canvas.getContext('2d')?.drawImage(bitmap, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
      pieces.push({ imageUrl: await canvasToDataUrl(canvas), row, column, width: canvas.width, height: canvas.height })
    }
    return pieces
  } finally { bitmap.close() }
}
async function upscaleImageUrl(imageUrl: string, scale: number) {
  const bitmap = await imageBitmapFromUrl(imageUrl)
  try {
    const limitedScale = Math.min(scale, 4096 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(bitmap.width, Math.round(bitmap.width * limitedScale))
    const height = Math.max(bitmap.height, Math.round(bitmap.height * limitedScale))
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理这张图片')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    return { imageUrl: await canvasToDataUrl(canvas), width, height }
  } finally { bitmap.close() }
}
function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const [hovered, setHovered] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null)
  const [imageToolbarConfig, setImageToolbarConfig] = useState<ImageToolbarConfig>(readImageToolbarConfig)
  const [imageToolbarSettingsOpen, setImageToolbarSettingsOpen] = useState(false)
  const hoverTimer = useRef<number | null>(null)
  const toolbarContentRef = useRef<HTMLDivElement>(null)
  const toolbarElementRef = useRef<HTMLElement | null>(null)
  const toolbarShift = useRef({ x: 0, y: 0 })
  const toolbarPlacementFrame = useRef<number | null>(null)
  const icon = data.kind === 'group' ? <Group size={15} /> : data.kind === 'ai' ? <Bot size={15} /> : data.kind === 'video' ? <Video size={15} /> : data.kind === 'image' ? <Image size={15} /> : data.kind === 'note' ? <StickyNote size={15} /> : <Text size={15} />
  const mode: NonNullable<CanvasData['mode']> = data.mode === 'image' || data.mode === 'video' ? data.mode : 'text'
  const models = mode === 'image' ? data.imageModels || [] : mode === 'video' ? data.videoModels || [] : data.textModels || []
  const configuredModel = mode === 'image' ? data.imageModel : mode === 'video' ? data.videoModel : data.textModel
  const model = configuredModel && models.includes(configuredModel) ? configuredModel : models[0] || ''
  const imageSize = data.imageSize || '1024x1024'
  const videoSize = data.videoSize || '1280x720'
  const videoSeconds = data.videoSeconds || 6
  const keepToolbar = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHovered(true)
  }
  const leaveToolbar = () => {
    if (imageToolbarSettingsOpen) return
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHovered(false), 160)
  }
  const syncNodeToolbarPlacement = useCallback(() => {
    const toolbarContent = toolbarContentRef.current
    const toolbar = toolbarContent?.parentElement
    const renderer = toolbar?.closest<HTMLElement>('.react-flow__renderer')
    if (!toolbar || !renderer) return
    if (toolbarElementRef.current !== toolbar) {
      toolbarElementRef.current = toolbar
      toolbarShift.current = { x: 0, y: 0 }
    }

    const rendererRect = renderer.getBoundingClientRect()
    const currentShift = toolbarShift.current
    const floatingElements = [toolbar, toolbar.querySelector<HTMLElement>('.image-toolbar-settings')].filter((element): element is HTMLElement => Boolean(element))
    const floatingRects = floatingElements.map((element) => element.getBoundingClientRect())
    const baseLeft = Math.min(...floatingRects.map((rect) => rect.left - currentShift.x))
    const baseRight = Math.max(...floatingRects.map((rect) => rect.right - currentShift.x))
    const baseTop = Math.min(...floatingRects.map((rect) => rect.top - currentShift.y))
    const baseBottom = Math.max(...floatingRects.map((rect) => rect.bottom - currentShift.y))
    const workspace = renderer.closest<HTMLElement>('.workspace')
    const topbarRect = workspace?.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect()
    const canvasDockRect = workspace?.querySelector<HTMLElement>('.canvas-dock')?.getBoundingClientRect()
    const viewportLeft = rendererRect.left + 8
    const viewportRight = rendererRect.right - 8
    const preferredTop = Math.max(rendererRect.top + 8, (topbarRect?.bottom || rendererRect.top) + 8)
    const viewportTop = preferredTop < rendererRect.bottom - 48 ? preferredTop : rendererRect.top + 8
    const viewportBottom = imageToolbarSettingsOpen && canvasDockRect
      ? Math.min(rendererRect.bottom - 8, canvasDockRect.top - 8)
      : rendererRect.bottom - 8
    const clampShift = (start: number, end: number, minimum: number, maximum: number, preferred = 0) => {
      const minimumShift = minimum - start
      const maximumShift = maximum - end
      return minimumShift > maximumShift ? minimumShift : Math.min(Math.max(preferred, minimumShift), maximumShift)
    }
    const viewportShiftX = clampShift(baseLeft, baseRight, viewportLeft, viewportRight)
    const toolbarNodeIds = (toolbar.dataset.id || '').split(/\s+/).filter(Boolean)
    const toolbarNode = Array.from(renderer.querySelectorAll<HTMLElement>('.react-flow__node'))
      .find((element) => toolbarNodeIds.includes(element.dataset.id || ''))
    const nodeRect = toolbarNode?.getBoundingClientRect()
    const belowShift = nodeRect ? nodeRect.bottom + 12 - baseTop : 0
    const preferredShiftY = nodeRect && baseTop < viewportTop && baseBottom + belowShift <= viewportBottom ? belowShift : 0
    const viewportShiftY = clampShift(baseTop, baseBottom, viewportTop, viewportBottom, preferredShiftY)

    if (viewportShiftX !== currentShift.x) toolbar.style.marginLeft = `${viewportShiftX}px`
    if (viewportShiftY !== currentShift.y) toolbar.style.marginTop = `${viewportShiftY}px`
    toolbarShift.current = { x: viewportShiftX, y: viewportShiftY }
  }, [imageToolbarSettingsOpen])
  const scheduleNodeToolbarPlacement = useCallback(() => {
    if (toolbarPlacementFrame.current !== null) window.cancelAnimationFrame(toolbarPlacementFrame.current)
    toolbarPlacementFrame.current = window.requestAnimationFrame(() => {
      toolbarPlacementFrame.current = null
      syncNodeToolbarPlacement()
    })
  }, [syncNodeToolbarPlacement])
  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current) }, [])
  useEffect(() => setImageToolbarSettingsOpen(false), [id])
  useEffect(() => {
    if (data.kind !== 'ai' || !models.length || configuredModel === model) return
    data.onChange?.(id, mode === 'image' ? { imageModel: model } : mode === 'video' ? { videoModel: model } : { textModel: model })
  }, [configuredModel, data.kind, data.onChange, id, mode, model, models])
  const saveImageToolbarConfig = (next: ImageToolbarConfig) => {
    setImageToolbarConfig(next)
    localStorage.setItem(imageToolbarStorageKey, JSON.stringify(next))
  }
  const toggleImageToolbarTool = (toolId: ImageToolbarToolId) => {
    const selectedIds = new Set(imageToolbarConfig.ids)
    if (selectedIds.has(toolId)) selectedIds.delete(toolId)
    else selectedIds.add(toolId)
    saveImageToolbarConfig({ ...imageToolbarConfig, ids: imageToolbarToolIds.filter((item) => selectedIds.has(item)) })
  }
  const imageToolVisible = (toolId: ImageToolbarToolId) => imageToolbarConfig.ids.includes(toolId)
  const imageToolLabel = (label: string) => imageToolbarConfig.showLabels ? <span>{label}</span> : null
  const showNodeChrome = selected || Boolean(data.hovered) || hovered || titleEditing || imageToolbarSettingsOpen
  const imageReady = data.kind === 'image' && Boolean(data.imageUrl)
  const imagePreviewReady = Boolean(data.imageUrl && (data.imageUrl.startsWith('data:image/') || loadedImageUrl === data.imageUrl))
  const hasDragHandle = data.kind === 'text' || data.kind === 'note' || data.kind === 'ai'
  const minimumSize = nodeMinimumSize(data.kind)
  useLayoutEffect(() => {
    if (!showNodeChrome) {
      toolbarElementRef.current = null
      toolbarShift.current = { x: 0, y: 0 }
      return
    }
    scheduleNodeToolbarPlacement()
    const toolbarContent = toolbarContentRef.current
    const toolbar = toolbarContent?.parentElement
    const renderer = toolbar?.closest<HTMLElement>('.react-flow__renderer')
    if (!toolbar || !renderer) return
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleNodeToolbarPlacement)
    resizeObserver?.observe(toolbarContent)
    resizeObserver?.observe(renderer)
    const settings = toolbar.querySelector<HTMLElement>('.image-toolbar-settings')
    if (settings) resizeObserver?.observe(settings)
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(scheduleNodeToolbarPlacement)
    mutationObserver?.observe(toolbar, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', scheduleNodeToolbarPlacement)
    return () => {
      if (toolbarPlacementFrame.current !== null) window.cancelAnimationFrame(toolbarPlacementFrame.current)
      toolbarPlacementFrame.current = null
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', scheduleNodeToolbarPlacement)
    }
  }, [data.freeResize, imageToolbarConfig, imageToolbarSettingsOpen, scheduleNodeToolbarPlacement, showNodeChrome])
  return (
    <article className={`canvas-node kind-${data.kind} ${selected ? 'selected' : ''} ${titleEditing ? 'title-editing' : ''}`} onMouseEnter={keepToolbar} onMouseLeave={leaveToolbar}>
      <NodeResizer isVisible={selected} keepAspectRatio={data.kind === 'image' && !data.freeResize} minWidth={minimumSize.width} minHeight={minimumSize.height} maxWidth={1600} maxHeight={1200} lineClassName="node-resize-line" handleClassName="node-resize-handle" />
      <NodeToolbar className={`node-toolbar ${imageReady ? 'image-node-toolbar' : ''} ${imageToolbarConfig.showLabels ? '' : 'labels-hidden'}`} isVisible={showNodeChrome} position={Position.Top} offset={48} onMouseEnter={keepToolbar} onMouseLeave={leaveToolbar} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <div ref={toolbarContentRef} className="node-toolbar-scroll nodrag nopan nowheel">
          {(!imageReady || imageToolVisible('info')) && <button title="节点信息" aria-label="节点信息" onClick={() => data.onInspect?.(id)}><Info size={15} />{imageReady ? imageToolLabel('信息') : <span>信息</span>}</button>}
          {imageReady && imageToolVisible('delete') && <button className="danger" title="删除节点" onClick={() => data.onDelete?.(id)}><Trash2 size={15} />{imageToolLabel('删除')}</button>}
          {(data.kind === 'text' || data.kind === 'note') && <button title="用这段内容继续创作" aria-label="用这段内容继续创作" onClick={() => data.onBranch?.(id)}><Sparkles size={15} /><span>生图</span></button>}
          {((imageReady && imageToolVisible('download')) || (data.kind === 'video' && data.videoUrl)) && <button title={data.kind === 'video' ? '下载视频' : '下载图片'} onClick={() => data.onDownload?.(id)}><Download size={15} />{imageReady ? imageToolLabel('下载') : <span>下载</span>}</button>}
          {((imageReady && imageToolVisible('saveAsset')) || (data.kind === 'video' && data.videoUrl) || ((data.kind === 'text' || data.kind === 'note') && data.content?.trim())) && <button title="收藏到资产库" aria-label="收藏到资产库" onClick={() => data.onSaveAsset?.(id)}><BookmarkPlus size={15} />{imageReady ? imageToolLabel('存资产') : <span>存资产</span>}</button>}
          {imageReady && <>{imageToolVisible('edit') && <label className="node-toolbar-upload" title="编辑图片"><MessageSquare size={15} />{imageToolLabel('编辑')}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) data.onUpload?.(id, file) }} /></label>}{imageToolVisible('replace') && <label className="node-toolbar-upload" title="替换图片"><Upload size={15} />{imageToolLabel('替换')}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) data.onUpload?.(id, file) }} /></label>}{imageToolVisible('resize') && <button className={data.freeResize ? 'active' : ''} title={data.freeResize ? '切换为等比缩放' : '切换为自由缩放'} onClick={() => data.onToggleImageRatio?.(id)}>{data.freeResize ? <LockOpen size={15} /> : <Lock size={15} />}{imageToolLabel(data.freeResize ? '自由比例' : '锁比例')}</button>}{imageToolVisible('crop') && <button title="裁剪并生成新节点" onClick={() => data.onImageTool?.(id, 'crop')}><Crop size={15} />{imageToolLabel('裁剪')}</button>}{imageToolVisible('split') && <button title="按网格切分图片" onClick={() => data.onImageTool?.(id, 'split')}><Grid2X2 size={15} />{imageToolLabel('切图')}</button>}{imageToolVisible('upscale') && <button title="放大图片分辨率" onClick={() => data.onImageTool?.(id, 'upscale')}><ZoomIn size={15} />{imageToolLabel('放大')}</button>}{imageToolVisible('view') && <button title="查看大图" onClick={() => data.onImageTool?.(id, 'view')}><Maximize2 size={15} />{imageToolLabel('查看大图')}</button>}<button className={imageToolbarSettingsOpen ? 'active' : ''} title="配置快捷工具" onClick={() => setImageToolbarSettingsOpen((value) => !value)}><MoreHorizontal size={15} />{imageToolLabel('更多')}</button></>}
          {!imageReady && <button title="复制节点" onClick={() => data.onDuplicate?.(id)}><Copy size={15} /><span>复制</span></button>}
          {!imageReady && <button className="danger" title="删除节点" onClick={() => data.onDelete?.(id)}><Trash2 size={15} /><span>删除</span></button>}
        </div>
        {imageReady && imageToolbarSettingsOpen && <div className="image-toolbar-settings nodrag nopan nowheel" role="dialog" aria-label="图片快捷工具设置" onPointerDown={(event) => event.stopPropagation()}><strong>快捷工具</strong><div>{imageToolbarToolIds.map((toolId) => <label key={toolId}><input type="checkbox" checked={imageToolbarConfig.ids.includes(toolId)} onChange={() => toggleImageToolbarTool(toolId)} /><span>{{ info: '信息', delete: '删除', saveAsset: '存资产', download: '下载', edit: '编辑', replace: '替换', resize: '比例锁定', crop: '裁剪', split: '切图', upscale: '放大', view: '查看大图' }[toolId]}</span></label>)}</div><label className="image-toolbar-label-switch"><input type="checkbox" checked={imageToolbarConfig.showLabels} onChange={(event) => saveImageToolbarConfig({ ...imageToolbarConfig, showLabels: event.target.checked })} /><span>显示文字标签</span></label><button className="image-toolbar-settings-done" onClick={() => setImageToolbarSettingsOpen(false)}>完成</button></div>}
      </NodeToolbar>
      {data.kind !== 'group' && <Handle type="target" position={Position.Left} />}
      {data.kind !== 'ai' && <div className={`node-floating-title nodrag ${showNodeChrome ? 'visible' : ''}`}>{icon}{titleEditing ? <input autoFocus className="node-title" aria-label="节点标题" maxLength={64} value={data.title || ''} onChange={(event) => data.onChange?.(id, { title: event.target.value })} onBlur={() => setTitleEditing(false)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setTitleEditing(false) }} /> : <button title="双击修改节点名称" onDoubleClick={(event) => { event.stopPropagation(); setTitleEditing(true) }}>{data.title || '未命名节点'}</button>}{data.kind === 'group' && Boolean(data.groupChildCount) && <span className="group-count">{data.groupChildCount}</span>}</div>}
      <div className="node-surface">{data.kind === 'ai' ? <div className="node-drag-handle ai-node-header" title="拖动 AI 创作节点" aria-label="拖动 AI 创作节点"><div className="ai-node-heading"><GripHorizontal size={17} />{titleEditing ? <input autoFocus className="node-title nodrag" aria-label="节点标题" maxLength={64} value={data.title || ''} onChange={(event) => data.onChange?.(id, { title: event.target.value })} onBlur={() => setTitleEditing(false)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setTitleEditing(false) }} /> : <span title="双击修改节点名称" onDoubleClick={(event) => { event.stopPropagation(); setTitleEditing(true) }}>{data.title || 'AI 创作'}</span>}</div><div className="generation-mode nodrag" role="group" aria-label="生成类型"><button className={mode === 'text' ? 'active' : ''} onClick={() => data.onChange?.(id, { mode: 'text' })}><Bot size={13} />文字</button><button className={mode === 'image' ? 'active' : ''} onClick={() => data.onChange?.(id, { mode: 'image' })}><Image size={13} />生图</button><button className={mode === 'video' ? 'active' : ''} onClick={() => data.onChange?.(id, { mode: 'video' })}><Video size={13} />视频</button></div></div> : hasDragHandle && <div className="node-drag-handle" title="拖动节点" aria-label="拖动节点"><GripHorizontal size={17} /></div>}{data.kind === 'group' ? (
        <div className="group-body" />
      ) : data.kind === 'image' ? (
        <div className="image-body">
          {data.imageUrl ? <div className={`image-preview ${data.freeResize ? 'free-resize' : 'ratio-locked'}`}><img src={data.imageUrl} alt={data.title || '画布图片'} draggable={false} onLoad={() => setLoadedImageUrl(data.imageUrl || null)} onError={() => setLoadedImageUrl(null)} /><div className="image-actions nodrag nopan"><label title="替换图片" aria-label="替换图片"><Upload size={14} /><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) data.onUpload?.(id, file) }} /></label><button title="下载图片" onClick={() => data.onDownload?.(id)}><Download size={14} /></button></div></div> : <label className="image-drop nodrag"><Image size={24} /><span>上传图片或粘贴地址</span><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) data.onUpload?.(id, file) }} /></label>}
          {!imagePreviewReady && <input className="node-input nodrag" placeholder="图片地址" value={data.imageUrl || ''} onChange={(event) => data.onChange?.(id, { imageUrl: event.target.value })} />}
        </div>
      ) : data.kind === 'video' ? (
        <div className="video-body">
          {data.videoUrl ? <div className="video-preview"><video src={data.videoUrl} controls preload="metadata" playsInline aria-label={data.title || '画布视频'} /><div className="image-actions"><label title="替换视频" aria-label="替换视频"><Upload size={14} /><input type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) data.onUpload?.(id, file) }} /></label><button title="下载视频" onClick={() => data.onDownload?.(id)}><Download size={14} /></button></div></div> : <label className="image-drop video-drop nodrag"><Video size={24} /><span>上传视频或粘贴地址</span><input type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) data.onUpload?.(id, file) }} /></label>}
          <input className="node-input nodrag" placeholder="视频地址" value={data.videoUrl || ''} onChange={(event) => data.onChange?.(id, { videoUrl: event.target.value })} />
        </div>
      ) : data.kind === 'ai' ? (
        <div className="ai-body">
          <div className="ai-prompt-section nodrag"><span className="ai-section-label">提示词</span><textarea className="nowheel" placeholder="告诉 AI 你想探索什么…" value={data.prompt || ''} onChange={(event) => data.onChange?.(id, { prompt: event.target.value })} /></div>
          <div className="ai-context-section nodrag"><div className="ai-context-heading"><span className="ai-section-label">连接上下文</span><small>{data.contextSummary?.textCount || 0} 段文本{mode !== 'text' ? ` · ${data.contextSummary?.imageCount || 0} 张图片` : ''}</small></div>{mode !== 'text' && Boolean(data.referenceImages?.length) && <div className="reference-strip"><div>{data.referenceImages?.slice(0, 4).map((item) => <img key={item.id} src={item.imageUrl} alt={item.title} title={item.title} />)}</div><span>{data.referenceImages?.length} 张参考图</span></div>}</div>
          <div className="ai-settings-section nodrag"><span className="ai-section-label">生成设置</span><div className="generator-settings">
              <select aria-label={mode === 'image' ? '生图模型' : mode === 'video' ? '视频模型' : '文字模型'} title={mode === 'image' ? '生图模型' : mode === 'video' ? '视频模型' : '文字模型'} value={model} onChange={(event) => data.onChange?.(id, mode === 'image' ? { imageModel: event.target.value } : mode === 'video' ? { videoModel: event.target.value } : { textModel: event.target.value })}>{models.length ? models.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">未配置模型</option>}</select>
              {mode === 'image' && <select aria-label="图片尺寸" title="图片尺寸" value={imageSize} onChange={(event) => data.onChange?.(id, { imageSize: event.target.value as ImageSize })}><option value="1024x1024">方形 1:1</option><option value="1536x1024">横向 3:2</option><option value="1024x1536">竖向 2:3</option></select>}
              {mode === 'video' && <><select aria-label="视频尺寸" title="视频尺寸" value={videoSize} onChange={(event) => data.onChange?.(id, { videoSize: event.target.value as VideoSize })}><option value="1280x720">横向 16:9</option><option value="720x1280">竖向 9:16</option><option value="1024x1024">方形 1:1</option></select><select aria-label="视频时长" title="视频时长" value={videoSeconds} onChange={(event) => data.onChange?.(id, { videoSeconds: Number(event.target.value) })}>{Array.from({ length: 20 }, (_item, index) => index + 1).map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></>}
            </div>
          </div>
          <div className="node-actions ai-node-actions"><button
            className={'node-run nodrag ' + (mode === 'image' ? 'image-run' : '')}
            disabled={data.busy || !data.prompt?.trim() || !model}
            onClick={() => mode === 'image' ? data.onRunImage?.(id, data.prompt || '', model, imageSize) : mode === 'video' ? data.onRunVideo?.(id, data.prompt || '', model, videoSize, videoSeconds) : data.onRun?.(id, data.prompt || '', model)}
          >{data.busy ? '生成中…' : <><Sparkles size={14} />{mode === 'image' ? '生成图片' : mode === 'video' ? '生成视频' : '生成文字'}</>}</button></div>
        </div>
      ) : (
        <textarea className="node-content nodrag nowheel" placeholder="写点什么…" value={data.content || ''} onChange={(event) => data.onChange?.(id, { content: event.target.value })} />
      )}</div>
      {data.kind !== 'group' && <Handle type="source" position={Position.Right} />}
    </article>
  )
}

function CanvasEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.34 })
  return <><BaseEdge id={id} path={path} interactionWidth={24} /><EdgeLabelRenderer><button className="edge-delete nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }} title="删除连接" aria-label="删除连接" onClick={() => (data as { onDelete?: (id: string) => void } | undefined)?.onDelete?.(id)}><Trash2 size={12} /></button></EdgeLabelRenderer></>
}
const canvasNodeTypes = { canvasNode: CanvasNodeView }
const canvasEdgeTypes = { bezier: CanvasEdgeView }

function AuthArtwork({ kind }: { kind: 'idea' | 'ai' | 'reference' }) {
  if (kind === 'idea') return (
    <div className="visual-art idea-art">
      <svg viewBox="0 0 72 64" focusable="false">
        <path className="idea-thread thread-a" d="M7 43C18 38 20 24 32 26s11 18 25 15" />
        <path className="idea-thread thread-b" d="M16 52c9-2 14-8 18-18 4-11 12-15 27-14" />
        <path className="idea-paper paper-back" d="M13 16 34 9l7 20-21 7z" />
        <path className="idea-paper paper-front" d="m27 17 24-5 4 21-24 5z" />
        <path className="idea-mark" d="m35 23 4 3 7-8M34 31h12" />
        <circle className="idea-point point-a" cx="9" cy="44" r="3" />
        <circle className="idea-point point-b" cx="61" cy="20" r="3.5" />
        <path className="idea-spark" d="M57 44v9m-4.5-4.5h9" />
      </svg>
    </div>
  )
  if (kind === 'ai') return (
    <div className="visual-art ai-art">
      <svg viewBox="0 0 72 64" focusable="false">
        <path className="ai-orbit orbit-a" d="M8 40C15 18 33 10 55 17" />
        <path className="ai-orbit orbit-b" d="M16 52c16 4 36-5 47-24" />
        <path className="ai-link" d="M16 22 30 30m12-10-7 10m10 7 13 7M31 36 20 49" />
        <path className="ai-core core-back" d="m34 20 13 12-13 14-13-14z" />
        <path className="ai-core core-front" d="m34 25 7 7-7 8-7-8z" />
        <circle className="ai-node node-a" cx="14" cy="20" r="4" />
        <circle className="ai-node node-b" cx="45" cy="17" r="3" />
        <circle className="ai-node node-c" cx="60" cy="45" r="4.5" />
        <circle className="ai-node node-d" cx="18" cy="51" r="2.5" />
        <path className="ai-spark" d="M59 10v8m-4-4h8" />
      </svg>
    </div>
  )
  return (
    <div className="visual-art reference-art">
      <svg viewBox="0 0 72 64" focusable="false">
        <path className="reference-card card-back" d="m21 10 37 8-8 35-37-8z" />
        <path className="reference-card card-front" d="M10 16h39v39H10z" />
        <path className="reference-window" d="M15 21h29v21H15z" />
        <circle className="reference-sun" cx="37" cy="27" r="4" />
        <path className="reference-land" d="m15 39 8-9 7 6 5-5 9 8" />
        <path className="reference-pin" d="m14 16 8-2m28 3 8 2" />
        <circle className="reference-swatch swatch-a" cx="55" cy="46" r="5" />
        <circle className="reference-swatch swatch-b" cx="62" cy="37" r="4" />
        <circle className="reference-swatch swatch-c" cx="60" cy="53" r="3" />
      </svg>
    </div>
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
        <div className="visual-node visual-a"><AuthArtwork kind="idea" /><span>梳理创意</span></div>
        <div className="visual-node visual-b"><AuthArtwork kind="ai" /><span>让 AI 延展思路</span></div>
        <div className="visual-node visual-c"><AuthArtwork kind="reference" /><span>收集视觉参考</span></div>
        <svg className="visual-connector" viewBox="0 0 600 500" preserveAspectRatio="none"><path d="M180 170 C270 170 250 270 350 270 M350 270 C420 270 405 365 470 365" /></svg>
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
  const drawerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose
  useEffect(() => {
    const drawer = drawerRef.current
    if (!drawer) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    const focusFirst = () => (drawer.querySelector<HTMLElement>(focusableSelector) || drawer).focus()
    const frame = window.requestAnimationFrame(focusFirst)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) {
        event.preventDefault()
        drawer.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [])
  return <><div className="drawer-backdrop" aria-hidden="true" onClick={onClose} /><aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X size={19} /></button></header>{children}</aside></>
}

const nodeKindLabels: Record<CanvasData['kind'], string> = { note: '便签', text: '文本', ai: 'AI 创作', image: '图片', video: '视频', group: '创作框架' }
function formatNodeBytes(value?: string) {
  if (!value?.startsWith('data:')) return ''
  const comma = value.indexOf(',')
  if (comma < 0) return ''
  const bytes = Math.max(0, Math.floor(value.slice(comma + 1).length * 3 / 4))
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function NodeInfoDrawer({ node, nodes, edges, close }: { node: CanvasNode; nodes: CanvasNode[]; edges: Edge[]; close: () => void }) {
  const [view, setView] = useState<'info' | 'json'>('info')
  useEffect(() => setView('info'), [node.id])
  const dimensions = nodeDimensions(node)
  const connections = useMemo(() => edges.flatMap((edge) => {
    if (edge.source === node.id) return [{ direction: '下游', id: edge.target }]
    if (edge.target === node.id) return [{ direction: '上游', id: edge.source }]
    return []
  }).map((item) => ({ ...item, title: nodes.find((candidate) => candidate.id === item.id)?.data.title || '未命名节点' })), [edges, node.id, nodes])
  const imageBytes = formatNodeBytes(node.data.imageUrl)
  const json = useMemo(() => JSON.stringify({
    id: node.id,
    type: node.data.kind,
    position: node.position,
    width: Math.round(dimensions.width),
    height: Math.round(dimensions.height),
    data: {
      kind: node.data.kind, title: node.data.title, content: node.data.content, prompt: node.data.prompt,
      imageUrl: node.data.imageUrl?.startsWith('data:image/') ? `[图片数据 ${imageBytes || '已内嵌'}]` : node.data.imageUrl,
      videoUrl: node.data.videoUrl, mode: node.data.mode, textModel: node.data.textModel, imageModel: node.data.imageModel,
      imageSize: node.data.imageSize, videoModel: node.data.videoModel, videoSize: node.data.videoSize, videoSeconds: node.data.videoSeconds, groupId: node.data.groupId,
    },
    connections: connections.map(({ direction, id }) => ({ direction, nodeId: id })),
  }, null, 2), [connections, dimensions.height, dimensions.width, imageBytes, node])
  return <Drawer title="节点信息" onClose={close}>
    <div className="node-info-head"><div className={`node-info-icon kind-${node.data.kind}`}>{node.data.kind === 'image' ? <Image size={20} /> : node.data.kind === 'ai' ? <Bot size={20} /> : node.data.kind === 'group' ? <Group size={20} /> : node.data.kind === 'video' ? <Video size={20} /> : node.data.kind === 'note' ? <StickyNote size={20} /> : <Text size={20} />}</div><span><strong>{node.data.title || '未命名节点'}</strong><small>{nodeKindLabels[node.data.kind]}</small></span></div>
    <div className="node-info-tabs" role="tablist" aria-label="节点信息视图"><button role="tab" aria-selected={view === 'info'} className={view === 'info' ? 'active' : ''} onClick={() => setView('info')}>信息</button><button role="tab" aria-selected={view === 'json'} className={view === 'json' ? 'active' : ''} onClick={() => setView('json')}>JSON</button></div>
    {view === 'info' ? <div className="node-info-content">
      {node.data.kind === 'image' && node.data.imageUrl && <div className="node-info-preview"><img src={node.data.imageUrl} alt={node.data.title || '节点图片'} /></div>}
      <dl className="node-info-grid"><div><dt>ID</dt><dd title={node.id}>{node.id}</dd></div><div><dt>尺寸</dt><dd>{Math.round(dimensions.width)} × {Math.round(dimensions.height)}</dd></div><div><dt>位置</dt><dd>{Math.round(node.position.x)}, {Math.round(node.position.y)}</dd></div><div><dt>连接</dt><dd>{connections.length} 条</dd></div>{imageBytes && <div><dt>图片大小</dt><dd>{imageBytes}</dd></div>}{node.data.busy && <div><dt>状态</dt><dd>生成中</dd></div>}</dl>
      <section className="node-connection-section"><h3>节点连接</h3>{connections.length ? <div className="node-connection-list">{connections.map((item) => <div key={`${item.direction}-${item.id}`}><span>{item.direction}</span><strong>{item.title}</strong><code>{item.id.slice(0, 8)}</code></div>)}</div> : <p>当前节点还没有连接。</p>}</section>
      {node.data.prompt?.trim() && <section className="node-info-copy"><h3>提示词</h3><p>{node.data.prompt}</p></section>}
    </div> : <pre className="node-info-json">{json}</pre>}
  </Drawer>
}

function AccountDrawer({ user, refresh, close, notify }: { user: User; refresh: () => Promise<void>; close: () => void; notify: (notice: Notice) => void }) {
  type RelayKeyKind = 'text' | 'image' | 'video'
  const relayKeys: Array<{ kind: RelayKeyKind; label: string; configured: boolean }> = [
    { kind: 'text', label: '文字', configured: user.textApiKeyConfigured },
    { kind: 'image', label: '图片', configured: user.imageApiKeyConfigured },
    { kind: 'video', label: '视频', configured: user.videoApiKeyConfigured },
  ]
  const [busy, setBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [relayKeyValues, setRelayKeyValues] = useState<Record<RelayKeyKind, string>>({ text: '', image: '', video: '' })
  const [relayKeyErrors, setRelayKeyErrors] = useState<Record<RelayKeyKind, string>>({ text: '', image: '', video: '' })
  const setRelayKeyValue = (kind: RelayKeyKind, value: string) => setRelayKeyValues((current) => ({ ...current, [kind]: value }))
  const setRelayKeyError = (kind: RelayKeyKind, value: string) => setRelayKeyErrors((current) => ({ ...current, [kind]: value }))
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('currentPassword') || '')
    const newPassword = String(form.get('newPassword') || '')
    if (newPassword !== String(form.get('confirmation') || '')) { setPasswordError('两次输入的新密码不一致'); return }
    setBusy(true)
    setPasswordError('')
    try {
      const result = await api<{ token: string; user: User }>('/auth/password', {
        method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
      })
      session.set(result.token)
      close()
      notify({ type: 'ok', text: '密码已更新，其他设备需要重新登录' })
    } catch (err) { setPasswordError((err as Error).message) } finally { setBusy(false) }
  }
  async function saveRelayKey(kind: RelayKeyKind, label: string) {
    const apiKey = relayKeyValues[kind].trim()
    if (busy || !apiKey) return
    setBusy(true)
    setRelayKeyError(kind, '')
    try {
      await api(`/me/${kind}-key`, { method: 'PUT', body: JSON.stringify({ apiKey }) })
      await refresh()
      notify({ type: 'ok', text: `${label} API 密钥已安全保存` })
    } catch (err) { setRelayKeyError(kind, (err as Error).message) } finally { setRelayKeyValue(kind, ''); setBusy(false) }
  }
  async function testRelayKey(kind: RelayKeyKind, label: string, configured: boolean) {
    const apiKey = relayKeyValues[kind].trim()
    if (busy || (!apiKey && !configured)) return
    setBusy(true)
    setRelayKeyError(kind, '')
    try {
      await api(`/me/${kind}-key/test`, { method: 'POST', body: JSON.stringify({ apiKey: apiKey || undefined }) })
      notify({ type: 'ok', text: `${label} API 密钥测试成功` })
    } catch (err) { setRelayKeyError(kind, (err as Error).message) } finally { setRelayKeyValue(kind, ''); setBusy(false) }
  }
  async function clearRelayKey(kind: RelayKeyKind, label: string, configured: boolean) {
    if (busy || !configured || !window.confirm(`确认清除已保存的${label} API 密钥？清除后对应生成功能将不可用，直到重新配置。`)) return
    setBusy(true)
    setRelayKeyError(kind, '')
    try {
      await api(`/me/${kind}-key`, { method: 'DELETE' })
      await refresh()
      notify({ type: 'ok', text: `${label} API 密钥已清除` })
    } catch (err) { setRelayKeyError(kind, (err as Error).message) } finally { setRelayKeyValue(kind, ''); setBusy(false) }
  }
  return <Drawer title={'账户安全'} onClose={close}>
    <section className={'drawer-section'}><h3>登录账号</h3><p className={'account-email'}>{user.email}</p></section>
    {relayKeys.map(({ kind, label, configured }) => <section className={'drawer-section relay-key-section'} key={kind}><h3>{label} API 密钥</h3>
      <label>你的 API 密钥<input type={'password'} placeholder={configured ? '已配置，输入新密钥可替换' : `输入你的${label} API 密钥`} value={relayKeyValues[kind]} onChange={(event) => setRelayKeyValue(kind, event.target.value)} autoComplete={'new-password'} disabled={busy} /></label>
      <p className={'muted'}>{configured ? '已配置。密钥不会回显，只保存在服务端。' : `尚未配置。使用${label}生成前，请先保存并测试。`}</p>
      {relayKeyErrors[kind] && <div className={'form-error'} role={'alert'}>{relayKeyErrors[kind]}</div>}
      <div className={'relay-actions'}><button className={'primary'} type={'button'} onClick={() => void saveRelayKey(kind, label)} disabled={busy || !relayKeyValues[kind].trim()}><KeyRound size={16} />{configured ? '替换密钥' : '保存密钥'}</button><button className={'secondary'} type={'button'} onClick={() => void testRelayKey(kind, label, configured)} disabled={busy || (!relayKeyValues[kind].trim() && !configured)}><Check size={16} />测试密钥</button>{configured && <button className={'secondary danger-text'} type={'button'} onClick={() => void clearRelayKey(kind, label, configured)} disabled={busy}>清除密钥</button>}</div>
    </section>)}
    <form className={'drawer-section'} onSubmit={changePassword}><h3>修改密码</h3>
      <label>当前密码<input name={'currentPassword'} type={'password'} minLength={8} maxLength={72} autoComplete={'current-password'} required /></label>
      <label>新密码<input name={'newPassword'} type={'password'} minLength={8} maxLength={72} autoComplete={'new-password'} required /></label>
      <label>确认新密码<input name={'confirmation'} type={'password'} minLength={8} maxLength={72} autoComplete={'new-password'} required /></label>
      {passwordError && <div className={'form-error'} role={'alert'}>{passwordError}</div>}
      <button className={'primary full'} disabled={busy}><KeyRound size={17} />{busy ? '正在更新' : '更新密码'}</button>
      <p className={'muted'}>更新后，其他设备上的登录会立即失效。</p>
    </form>
  </Drawer>
}

function AdminDrawer({ close, notify }: { close: () => void; notify: (notice: Notice) => void }) {
  type RelayKind = 'text' | 'image' | 'video'
  type AuditEntry = { id: string; action: string; actor_email: string; created_at: string }
  type RelayData = { baseUrl: string; models: string[]; source: string }
  type AdminData = { stats: Record<string, number>; audit: AuditEntry[]; text: RelayData; image: RelayData; video: RelayData }
  const relayModelRoutes: Record<RelayKind, string> = {
    text: '/admin/text-config/models',
    image: '/admin/image-config/models',
    video: '/admin/video-config/models',
  }
  const [data, setData] = useState<AdminData | null>(null)
  const [textBaseUrl, setTextBaseUrl] = useState('')
  const [textModels, setTextModels] = useState<string[]>([])
  const [discoveredTextModels, setDiscoveredTextModels] = useState<string[]>([])
  const [textModelQuery, setTextModelQuery] = useState('')
  const [imageBaseUrl, setImageBaseUrl] = useState('')
  const [imageModels, setImageModels] = useState<string[]>([])
  const [discoveredImageModels, setDiscoveredImageModels] = useState<string[]>([])
  const [imageModelQuery, setImageModelQuery] = useState('')
  const [videoBaseUrl, setVideoBaseUrl] = useState('')
  const [videoModels, setVideoModels] = useState<string[]>([])
  const [discoveredVideoModels, setDiscoveredVideoModels] = useState<string[]>([])
  const [videoModelQuery, setVideoModelQuery] = useState('')
  const [relayTab, setRelayTab] = useState<RelayKind>('text')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const load = useCallback(() => api<AdminData>('/admin/overview').then((result) => {
    setData(result)
    setTextBaseUrl(result.text.baseUrl)
    setTextModels(result.text.models)
    setDiscoveredTextModels(result.text.models)
    setImageBaseUrl(result.image.baseUrl)
    setImageModels(result.image.models)
    setDiscoveredImageModels(result.image.models)
    setVideoBaseUrl(result.video.baseUrl)
    setVideoModels(result.video.models)
    setDiscoveredVideoModels(result.video.models)
  }), [])
  useEffect(() => { void load().catch((err) => notify({ type: 'error', text: err.message })) }, [load, notify])
  const relayDraft = (kind: RelayKind) => kind === 'text'
    ? { baseUrl: textBaseUrl.trim(), models: textModels }
    : kind === 'image'
      ? { baseUrl: imageBaseUrl.trim(), models: imageModels }
      : { baseUrl: videoBaseUrl.trim(), models: videoModels }
  const relayLabel = (kind: RelayKind) => kind === 'text' ? '文字' : kind === 'image' ? '图片' : '视频'
  async function saveRelayConfig(kind: RelayKind) {
    if (busyRef.current) return
    const draft = relayDraft(kind)
    const label = relayLabel(kind)
    if (!draft.baseUrl) return notify({ type: 'error', text: `请填写${label}中转站地址` })
    if (!draft.models.length) return notify({ type: 'error', text: `请至少开放一个${label}模型` })
    busyRef.current = true
    setBusy(true)
    try {
      await api(`/admin/${kind}-config`, { method: 'PUT', body: JSON.stringify(draft) })
      await load()
      notify({ type: 'ok', text: `${label}中转配置已保存` })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  async function testRelayConfig(kind: RelayKind) {
    if (busyRef.current) return
    const draft = relayDraft(kind)
    const label = relayLabel(kind)
    if (!draft.baseUrl || !draft.models[0]) return notify({ type: 'error', text: `请先填写${label}中转站地址并选择模型` })
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api<{ reply?: string }>(`/admin/${kind}-config/test`, { method: 'POST', body: JSON.stringify({ baseUrl: draft.baseUrl, model: draft.models[0] }) })
      notify({ type: 'ok', text: `${label}中转测试成功${result.reply ? `：${result.reply}` : ''}` })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  async function discoverModels(kind: RelayKind) {
    if (busyRef.current) return
    const draft = relayDraft(kind)
    const label = relayLabel(kind)
    if (!draft.baseUrl) return notify({ type: 'error', text: `请先填写${label}中转站地址` })
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api<{ models: string[] }>(relayModelRoutes[kind], { method: 'POST', body: JSON.stringify({ baseUrl: draft.baseUrl }) })
      if (kind === 'text') {
        setDiscoveredTextModels(result.models)
        setTextModels([])
        setTextModelQuery('')
      } else if (kind === 'image') {
        setDiscoveredImageModels(result.models)
        setImageModels([])
        setImageModelQuery('')
      } else {
        setDiscoveredVideoModels(result.models)
        setVideoModels([])
        setVideoModelQuery('')
      }
      notify({ type: 'ok', text: `已获取 ${result.models.length} 个上游${label}模型，请重新勾选要开放的模型` })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  function closeAdmin() {
    if (busyRef.current) return notify({ type: 'error', text: '操作正在处理中，请等待完成后再关闭' })
    close()
  }
  function setModelChecked(kind: RelayKind, model: string, checked: boolean) {
    const update = (models: string[]) => checked ? [...new Set([...models, model])] : models.filter((item) => item !== model)
    if (kind === 'text') setTextModels(update)
    else if (kind === 'image') setImageModels(update)
    else setVideoModels(update)
  }
  const auditText = (entry: AuditEntry) => entry.action === 'text_config.update' || entry.action === 'ai_config.update'
    ? '更新文字中转配置'
    : entry.action === 'image_config.update'
      ? '更新图片中转配置'
      : entry.action === 'video_config.update'
        ? '更新视频中转配置'
        : '后台操作'
  const relayReady = (relay: RelayData) => Boolean(relay.baseUrl && relay.models.length)
  const renderRelayConfig = (kind: RelayKind) => {
    const label = relayLabel(kind)
    const baseUrl = kind === 'text' ? textBaseUrl : kind === 'image' ? imageBaseUrl : videoBaseUrl
    const models = kind === 'text' ? textModels : kind === 'image' ? imageModels : videoModels
    const discovered = kind === 'text' ? discoveredTextModels : kind === 'image' ? discoveredImageModels : discoveredVideoModels
    const query = kind === 'text' ? textModelQuery : kind === 'image' ? imageModelQuery : videoModelQuery
    const visibleModels = discovered.filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()))
    return <><h3>{label}中转</h3><label>{label}中转站地址<input type="url" placeholder="https://relay.example.com/v1" value={baseUrl} onChange={(event) => {
      if (kind === 'text') setTextBaseUrl(event.target.value)
      else if (kind === 'image') setImageBaseUrl(event.target.value)
      else setVideoBaseUrl(event.target.value)
    }} disabled={busy} /></label><div className="relay-model-heading"><strong>开放{label}模型</strong><button className="secondary" type="button" onClick={() => void discoverModels(kind)} disabled={busy || !baseUrl.trim()}><Search size={15} />获取上游模型</button></div>{discovered.length > 0 ? <><label className="relay-model-search"><Search size={14} /><input aria-label={`筛选${label}模型`} placeholder="筛选模型" value={query} onChange={(event) => {
      if (kind === 'text') setTextModelQuery(event.target.value)
      else if (kind === 'image') setImageModelQuery(event.target.value)
      else setVideoModelQuery(event.target.value)
    }} /></label><div className="relay-model-list">{visibleModels.map((model) => <label key={model}><input type="checkbox" checked={models.includes(model)} onChange={(event) => setModelChecked(kind, model, event.target.checked)} disabled={busy} /><span>{model}</span></label>)}{visibleModels.length === 0 && <p className="muted">没有匹配模型</p>}</div><small>已开放 {models.length} 个模型</small></> : <p className="muted">获取上游模型后选择要向用户开放的模型。</p>}<div className="relay-actions"><button className="primary" onClick={() => void saveRelayConfig(kind)} disabled={busy || !baseUrl.trim() || !models.length}><Settings size={16} />保存配置</button><button className="secondary" onClick={() => void testRelayConfig(kind)} disabled={busy || !baseUrl.trim() || !models.length}><Check size={16} />测试{label}</button></div></>
  }
  return <Drawer title="运营管理" onClose={closeAdmin}>
    {data && <><div className="stats-row compact"><div><span>用户</span><strong>{data.stats.users}</strong></div><div><span>画布</span><strong>{data.stats.canvases}</strong></div></div><div className="relay-summary">{([['text', '文字', Bot], ['image', '图片', Image], ['video', '视频', Video]] as const).map(([kind, label, Icon]) => { const relay = data[kind]; const ready = relayReady(relay); return <div className={`config-status ${ready ? 'ready' : ''}`} key={kind}><span>{ready ? <Check size={16} /> : <Icon size={16} />}{ready ? `${label}中转已配置` : `${label}中转待配置`}</span><small>{relay.baseUrl || '尚未设置地址'} · {relay.models.length} 个开放模型</small></div> })}</div></>}
    <section className="drawer-section relay-config"><div className="relay-tabs" role="tablist" aria-label="中转配置类型"><button role="tab" aria-selected={relayTab === 'text'} className={relayTab === 'text' ? 'active' : ''} onClick={() => setRelayTab('text')}><Bot size={15} />文字</button><button role="tab" aria-selected={relayTab === 'image'} className={relayTab === 'image' ? 'active' : ''} onClick={() => setRelayTab('image')}><Image size={15} />图片</button><button role="tab" aria-selected={relayTab === 'video'} className={relayTab === 'video' ? 'active' : ''} onClick={() => setRelayTab('video')}><Video size={15} />视频</button></div>{renderRelayConfig(relayTab)}</section>
    <section className="drawer-section"><h3>操作审计</h3><div className="audit-list">{data?.audit.map((entry) => <div key={entry.id}><strong>{auditText(entry)}</strong><small>{entry.actor_email} · {new Date(entry.created_at + 'Z').toLocaleString()}</small></div>)}{data?.audit.length === 0 && <p className="muted">暂无后台操作记录</p>}</div></section>
  </Drawer>
}

function nodeKindIcon(kind: CanvasData['kind']) {
  if (kind === 'image') return <Image size={15} />
  if (kind === 'video') return <Video size={15} />
  if (kind === 'ai') return <Sparkles size={15} />
  if (kind === 'note') return <StickyNote size={15} />
  if (kind === 'group') return <Square size={15} />
  return <Text size={15} />
}

function CanvasSidePanel({ open, width, tab, query, nodes, assets, assetsLoading, selectedNodeIds, onTab, onQuery, onFocus, onAdd, onInsertAsset, onDeleteAsset, onResizeStart }: {
  open: boolean
  width: number
  tab: CanvasPanelTab
  query: string
  nodes: CanvasNode[]
  assets: Asset[]
  assetsLoading: boolean
  selectedNodeIds: Set<string>
  onTab: (tab: CanvasPanelTab) => void
  onQuery: (query: string) => void
  onFocus: (id: string) => void
  onAdd: (kind: CanvasData['kind'], content?: string, title?: string) => void
  onInsertAsset: (asset: Asset) => void
  onDeleteAsset: (id: string) => void
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const normalized = query.trim().toLowerCase()
  const visibleNodes = nodes.filter((node) => !normalized || [node.data.title, node.data.content, node.data.prompt].some((value) => value?.toLowerCase().includes(normalized)))
  const visibleAssets = assets.filter((asset) => !normalized || [asset.title, asset.content].some((value) => value.toLowerCase().includes(normalized)))
  const visiblePrompts = promptPresets.filter((item) => !normalized || (item.title + ' ' + item.content).toLowerCase().includes(normalized))
  return <aside className={'canvas-side-panel ' + (open ? 'open' : '')} aria-hidden={!open} style={{ width }}>
    <div className="canvas-panel-tabs" role="tablist" aria-label="画布资源">
      <button className={tab === 'canvas' ? 'active' : ''} role="tab" aria-selected={tab === 'canvas'} onClick={() => onTab('canvas')}>画布</button>
      <button className={tab === 'assets' ? 'active' : ''} role="tab" aria-selected={tab === 'assets'} onClick={() => onTab('assets')}>资产</button>
      <button className={tab === 'prompts' ? 'active' : ''} role="tab" aria-selected={tab === 'prompts'} onClick={() => onTab('prompts')}>提示词库</button>
    </div>
    <label className="canvas-panel-search"><Search size={15} /><input aria-label="搜索画布内容" placeholder="搜索" value={query} onChange={(event) => onQuery(event.target.value)} /></label>
    <div className="canvas-panel-body">
      {tab === 'canvas' && <div className="canvas-node-list">{visibleNodes.map((node) => <button className={selectedNodeIds.has(node.id) ? 'active' : ''} key={node.id} onClick={() => onFocus(node.id)}>{nodeKindIcon(node.data.kind)}<span><strong>{node.data.title || '未命名节点'}</strong><small>{node.data.kind === 'group' ? '框架' : node.data.kind === 'ai' ? '生成配置' : node.data.kind === 'image' ? '图片' : node.data.kind === 'video' ? '视频' : node.data.kind === 'note' ? '便签' : '文本'}</small></span><LocateFixed size={14} /></button>)}{visibleNodes.length === 0 && <p className="panel-empty">没有匹配节点</p>}</div>}
      {tab === 'assets' && <>{assetsLoading ? <p className="panel-empty">正在加载资产…</p> : <div className="canvas-assets-grid">{visibleAssets.map((asset) => <article key={asset.id}><button className="asset-insert" title="插入画布" onClick={() => onInsertAsset(asset)}>{asset.kind === 'image' ? <img src={asset.content} alt="" /> : asset.kind === 'video' ? <video src={asset.content} muted preload="metadata" style={{ width: '100%', height: 92, display: 'block', objectFit: 'cover', background: '#18181b' }} /> : <span>{asset.content}</span>}<strong>{asset.title}</strong></button><button className="asset-remove" title="移除资产" aria-label={`移除资产 ${asset.title}`} onClick={() => onDeleteAsset(asset.id)}><Trash2 size={13} /></button></article>)}{visibleAssets.length === 0 && <p className="panel-empty"><Library size={20} />资产库还是空的</p>}</div>}</>}
      {tab === 'prompts' && <div className="canvas-prompt-list">{visiblePrompts.map((item) => <button key={item.title} onClick={() => onAdd('text', item.content, item.title)}><Sparkles size={15} /><span><strong>{item.title}</strong><small>{item.content}</small></span><Plus size={15} /></button>)}</div>}
    </div>
    <button className="canvas-panel-resize" aria-label="调整左侧面板宽度" title="拖动调整面板宽度" onPointerDown={onResizeStart} />
  </aside>
}

function CanvasAssistantPanel({ open, messages, busy, contextCount, models, model, onModel, onClose, onSend, onInsertText, onCreateImage, onClear }: {
  open: boolean
  messages: AssistantMessage[]
  busy: boolean
  contextCount: number
  models: string[]
  model: string
  onModel: (model: string) => void
  onClose: () => void
  onSend: (content: string, model: string) => void
  onInsertText: (content: string) => void
  onCreateImage: (content: string) => void
  onClear: () => void
}) {
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); const content = value.trim(); if (!content || !model || busy) return; setValue(''); onSend(content, model) }
  return <aside className={'canvas-assistant ' + (open ? 'open' : '')} aria-hidden={!open} onClick={(event) => event.stopPropagation()}>
    <header><span><MessageSquare size={16} /><strong>画布助手</strong></span><div>{messages.length > 0 && <button title="清空对话" aria-label="清空对话" onClick={onClear}><Trash2 size={15} /></button>}<button title="收起助手" aria-label="收起助手" onClick={onClose}><PanelRightClose size={16} /></button></div></header>
    <div className="assistant-context"><span>{contextCount ? `已聚焦 ${contextCount} 个节点` : '基于整张画布'}</span><select aria-label="画布助手文字模型" title="文字模型" value={model} onChange={(event) => onModel(event.target.value)}>{models.length ? models.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">未配置模型</option>}</select></div>
    <div className="assistant-messages">{messages.length === 0 ? <div className="assistant-empty"><Sparkles size={22} /><strong>从画布继续思考</strong></div> : messages.map((message) => <article className={message.role} key={message.id}><div>{message.content}</div>{message.role === 'assistant' && <footer><button onClick={() => onInsertText(message.content)}><Text size={13} />放入画布</button><button onClick={() => onCreateImage(message.content)}><Image size={13} />转为生图</button></footer>}</article>)}{busy && <article className="assistant loading"><div>正在整理画布内容…</div></article>}</div>
    <form className="assistant-composer" onSubmit={submit}><textarea className="nodrag nowheel" aria-label="询问画布助手" placeholder="描述下一步创作方向…" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} /><button title="发送" aria-label="发送" disabled={busy || !model || !value.trim()}><Send size={17} /></button></form>
  </aside>
}

function ImageToolModal({ dialog, node, busy, onClose, onApply }: {
  dialog: NonNullable<ImageToolDialog>
  node: CanvasNode
  busy: boolean
  onClose: () => void
  onApply: (options: { ratio?: number | null; rows?: number; columns?: number; scale?: number }) => void
}) {
  const [ratio, setRatio] = useState('1')
  const [rows, setRows] = useState(2)
  const [columns, setColumns] = useState(2)
  const [scale, setScale] = useState(2)
  const toolTitle = dialog.tool === 'crop' ? '裁剪图片' : dialog.tool === 'split' ? '切分图片' : dialog.tool === 'upscale' ? '放大图片' : '查看大图'
  return <div className="image-tool-backdrop" role="presentation" onMouseDown={onClose}>
    <section className={`image-tool-dialog ${dialog.tool === 'view' ? 'viewer' : ''}`} role="dialog" aria-modal="true" aria-label={toolTitle} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><strong>{toolTitle}</strong><small>{node.data.title || '画布图片'}</small></div><button title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
      <div className="image-tool-preview"><img src={node.data.imageUrl} alt={node.data.title || '待处理图片'} /></div>
      {dialog.tool === 'crop' && <div className="image-tool-options"><span>输出比例</span><div className="image-tool-segments">{[['0', '原比例'], ['1', '1:1'], ['1.5', '3:2'], ['0.6666667', '2:3'], ['1.7777778', '16:9']].map(([value, label]) => <button key={value} className={ratio === value ? 'active' : ''} onClick={() => setRatio(value)}>{label}</button>)}</div><small>从图片中心裁剪，原图会保留并自动连接新节点。</small></div>}
      {dialog.tool === 'split' && <div className="image-tool-options two"><label><span>行数</span><input type="number" min="1" max="4" value={rows} onChange={(event) => setRows(Math.min(4, Math.max(1, Number(event.target.value))))} /></label><label><span>列数</span><input type="number" min="1" max="4" value={columns} onChange={(event) => setColumns(Math.min(4, Math.max(1, Number(event.target.value))))} /></label><small>将生成 {rows * columns} 个独立图片节点。</small></div>}
      {dialog.tool === 'upscale' && <div className="image-tool-options"><span>放大倍数</span><div className="image-tool-segments">{[2, 3, 4].map((value) => <button key={value} className={scale === value ? 'active' : ''} onClick={() => setScale(value)}>{value}x</button>)}</div><small>使用高质量插值，最长边限制为 4096 像素。</small></div>}
      {dialog.tool !== 'view' && <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={() => onApply(dialog.tool === 'crop' ? { ratio: Number(ratio) || null } : dialog.tool === 'split' ? { rows, columns } : { scale })}>{busy ? '处理中…' : '生成新节点'}</button></footer>}
    </section>
  </div>
}

function Workspace({ user, setUser }: { user: User; setUser: (user: User | null) => void }) {
  const [canvases, setCanvases] = useState<CanvasInfo[]>([])
  const canvasesRef = useRef<CanvasInfo[]>([])
  const [current, setCurrent] = useState<CanvasInfo | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const nodesRef = useRef<CanvasNode[]>([])
  const edgesRef = useRef<Edge[]>([])
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const [panel, setPanel] = useState<'account' | 'admin' | null>(null)
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(true)
  const [canvasPanelWidth, setCanvasPanelWidth] = useState(() => {
    const raw = localStorage.getItem('ink-canvas-panel-width')
    const stored = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(stored) ? Math.min(420, Math.max(250, stored)) : 280
  })
  const [canvasPanelTab, setCanvasPanelTab] = useState<CanvasPanelTab>('canvas')
  const [canvasPanelQuery, setCanvasPanelQuery] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([])
  const assistantMessagesRef = useRef<AssistantMessage[]>([])
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [assistantModel, setAssistantModel] = useState('')
  const assistantBusyRef = useRef(false)
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenu>(null)
  const canvasMenuRef = useRef<HTMLDivElement | null>(null)
  const [canvasMenuPosition, setCanvasMenuPosition] = useState({ x: 0, y: 0 })
  const [topbarMenuOpen, setTopbarMenuOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<CanvasThemeMode>(() => localStorage.getItem('ink-theme') === 'light' ? 'light' : 'dark')
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => (localStorage.getItem('ink-background-mode') as BackgroundMode) || 'lines')
  const [showMiniMap, setShowMiniMap] = useState(() => localStorage.getItem('ink-show-minimap') === 'true')
  const [canvasZoom, setCanvasZoom] = useState(1)
  const [imageToolDialog, setImageToolDialog] = useState<ImageToolDialog>(null)
  const [imageToolBusy, setImageToolBusy] = useState(false)
  const [canvasTitleEditing, setCanvasTitleEditing] = useState(false)
  const [canvasTitleDraft, setCanvasTitleDraft] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [creatingCanvas, setCreatingCanvas] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [relayConfig, setRelayConfig] = useState<{
    textModels: string[]
    imageModels: string[]
    videoModels: string[]
  }>({ textModels: [], imageModels: [], videoModels: [] })
  const [blockedReason, setBlockedReason] = useState<'session' | 'conflict' | 'storage' | 'deleted' | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const flow = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const topImportInput = useRef<HTMLInputElement>(null)
  const imageImportInput = useRef<HTMLInputElement>(null)
  const aiInFlight = useRef(0)
  const aiNodesInFlight = useRef(new Set<string>())
  const resolvedAIKeys = useRef(new Map<string, number>())
  const creatingCanvasRef = useRef(false)
  const revision = useRef(0)
  const persistedRevision = useRef(0)
  const serverVersion = useRef(0)
  const activeCanvasId = useRef<string | null>(null)
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true))
  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const deletedCanvasIds = useRef(new Set<string>())
  const openRequest = useRef(0)
  const undoStack = useRef<CanvasSnapshot[]>([])
  const redoStack = useRef<CanvasSnapshot[]>([])
  const historyApplying = useRef(false)
  const lastSnapshot = useRef<CanvasSnapshot>({ nodes: [], edges: [] })
  const clipboard = useRef<CanvasSnapshot>({ nodes: [], edges: [] })
  const groupDragStart = useRef<{ id: string; x: number; y: number; children: Map<string, { x: number; y: number }> } | null>(null)
  activeCanvasId.current = current?.id || null
  nodesRef.current = nodes
  edgesRef.current = edges
  assistantMessagesRef.current = assistantMessages
  useEffect(() => {
    localStorage.setItem('ink-theme', themeMode)
    document.documentElement.dataset.theme = themeMode
    document.documentElement.style.colorScheme = themeMode
  }, [themeMode])
  useEffect(() => setInspectedNodeId(null), [current?.id])
  useEffect(() => {
    setCanvasTitleEditing(false)
    setCanvasTitleDraft(current?.name || '')
  }, [current?.id])
  const replaceAssistantMessages = useCallback((messages: AssistantMessage[]) => {
    assistantMessagesRef.current = messages
    setAssistantMessages(messages)
  }, [])
  const cloneSnapshot = useCallback((snapshot: CanvasSnapshot): CanvasSnapshot => ({
    nodes: snapshot.nodes.map((node) => {
      const { dragging: _dragging, measured: _measured, selected: _selected, ...rest } = node
      return JSON.parse(JSON.stringify({ ...rest, selected: false, data: {
        kind: node.data.kind, title: node.data.title, content: node.data.content, prompt: node.data.prompt, imageUrl: node.data.imageUrl, videoUrl: node.data.videoUrl,
        mode: node.data.mode, textModel: node.data.textModel, imageModel: node.data.imageModel, imageSize: node.data.imageSize,
        videoModel: node.data.videoModel, videoSize: node.data.videoSize, videoSeconds: node.data.videoSeconds, groupId: node.data.groupId, freeResize: node.data.freeResize,
      } }))
    }),
    edges: snapshot.edges.map((edge) => { const { selected: _selected, data: _data, ...rest } = edge; return JSON.parse(JSON.stringify({ ...rest, selected: false })) }),
  }), [])
  const resetHistory = useCallback((nextNodes: CanvasNode[], nextEdges: Edge[]) => { undoStack.current = []; redoStack.current = []; lastSnapshot.current = cloneSnapshot({ nodes: nextNodes, edges: nextEdges }); setHistoryVersion((value) => value + 1) }, [cloneSnapshot])
  useEffect(() => {
    if (historyApplying.current) { historyApplying.current = false; lastSnapshot.current = cloneSnapshot({ nodes, edges }); return }
    const timer = window.setTimeout(() => {
      const previous = lastSnapshot.current
      const next = cloneSnapshot({ nodes, edges })
      if (JSON.stringify(previous) === JSON.stringify(next)) return
      undoStack.current.push(cloneSnapshot(previous)); if (undoStack.current.length > 50) undoStack.current.shift()
      redoStack.current = []; lastSnapshot.current = next; setHistoryVersion((value) => value + 1)
    }, 240)
    return () => window.clearTimeout(timer)
  }, [cloneSnapshot, edges, nodes])
  const applySnapshot = useCallback((snapshot: CanvasSnapshot) => { historyApplying.current = true; const next = cloneSnapshot(snapshot); setNodes(next.nodes); setEdges(next.edges); revision.current += 1; setSaveState('dirty'); setHistoryVersion((value) => value + 1) }, [cloneSnapshot, setEdges, setNodes])
  const undo = useCallback(() => { const previous = undoStack.current.pop(); if (!previous) return; redoStack.current.push(cloneSnapshot({ nodes: nodesRef.current, edges })); applySnapshot(previous) }, [applySnapshot, cloneSnapshot, edges])
  const redo = useCallback(() => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push(cloneSnapshot({ nodes: nodesRef.current, edges })); applySnapshot(next) }, [applySnapshot, cloneSnapshot, edges])
  const updateCanvases = useCallback((update: CanvasInfo[] | ((items: CanvasInfo[]) => CanvasInfo[])) => {
    const next = typeof update === 'function' ? update(canvasesRef.current) : update
    canvasesRef.current = next
    setCanvases(next)
    return next
  }, [])

  const refreshUser = useCallback(async () => {
    const result = await api<{ user: User }>('/me')
    setUser(result.user)
  }, [setUser])
  useEffect(() => {
    if (panel !== null) return
    api<{ textModels: string[]; imageModels: string[]; videoModels: string[] }>('/config')
      .then((config) => setRelayConfig({
        textModels: config.textModels || [], imageModels: config.imageModels || [],
        videoModels: config.videoModels || [],
      }))
      .catch((err) => setNotice({ type: 'error', text: err.message }))
  }, [panel])
  useEffect(() => {
    setAssistantModel((currentModel) => relayConfig.textModels.includes(currentModel) ? currentModel : relayConfig.textModels[0] || '')
  }, [relayConfig.textModels])
  const markDirty = useCallback(() => {
    revision.current += 1
    setSaveState('dirty')
  }, [])
  const finishCanvasTitleEditing = useCallback(() => {
    if (!current) return
    const name = canvasTitleDraft.trim() || '未命名画布'
    if (name !== current.name) {
      setCurrent({ ...current, name })
      updateCanvases((items) => items.map((item) => item.id === current.id ? { ...item, name } : item))
      markDirty()
    }
    setCanvasTitleDraft(name)
    setCanvasTitleEditing(false)
  }, [canvasTitleDraft, current, markDirty, updateCanvases])
  const cancelCanvasTitleEditing = useCallback(() => {
    setCanvasTitleDraft(current?.name || '')
    setCanvasTitleEditing(false)
  }, [current?.name])
  const startCanvasTitleEditing = useCallback(() => {
    if (!current) return
    setCanvasTitleDraft(current.name)
    setCanvasTitleEditing(true)
  }, [current])
  const startCanvasPanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = canvasPanelWidth
    let nextWidth = startWidth
    const move = (moveEvent: PointerEvent) => {
      nextWidth = Math.min(420, Math.max(250, startWidth + moveEvent.clientX - startX))
      setCanvasPanelWidth(nextWidth)
    }
    const finish = () => {
      localStorage.setItem('ink-canvas-panel-width', String(nextWidth))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }, [canvasPanelWidth])
  const updateNode = useCallback((id: string, patch: Partial<CanvasData>) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))
    markDirty()
  }, [markDirty, setNodes])
  const setNodeBusy = useCallback((id: string, busy: boolean) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, busy } } : node))
  }, [setNodes])
  const appendResultNode = useCallback((sourceId: string, data: CanvasData) => {
    const source = nodesRef.current.find((node) => node.id === sourceId)
    if (!source) return ''
    const id = uid()
    const sourceWidth = source.measured?.width || source.width || (source.data.kind === 'ai' ? 310 : 265)
    const siblingCount = edgesRef.current.filter((edge) => edge.source === sourceId).length
    const position = { x: source.position.x + sourceWidth + 96, y: source.position.y + siblingCount * 196 }
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), withNodeSize({ id, type: 'canvasNode', position, selected: true, data })])
    setEdges((items) => addEdge({ id: `edge-${sourceId}-${id}`, source: sourceId, target: id, type: 'bezier' }, items))
    markDirty()
    window.setTimeout(() => flow.current?.fitView({ nodes: [{ id: sourceId }, { id }], padding: 0.3, duration: 320, maxZoom: 1.2 }), 30)
    return id
  }, [markDirty, setEdges, setNodes])
  const duplicateNode = useCallback((id: string) => {
    const source = nodesRef.current.find((node) => node.id === id)
    if (!source) return
    const duplicateId = uid()
    const data = {
      kind: source.data.kind, title: `${source.data.title || '节点'} 副本`, content: source.data.content, prompt: source.data.prompt, imageUrl: source.data.imageUrl, videoUrl: source.data.videoUrl,
      mode: source.data.mode, textModel: source.data.textModel, imageModel: source.data.imageModel, imageSize: source.data.imageSize,
      videoModel: source.data.videoModel, videoSize: source.data.videoSize, videoSeconds: source.data.videoSeconds, groupId: source.data.groupId, freeResize: source.data.freeResize,
    }
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), withNodeSize({ id: duplicateId, type: 'canvasNode', position: { x: source.position.x + 38, y: source.position.y + 38 }, width: source.width, height: source.height, selected: true, data })])
    markDirty()
  }, [markDirty, setNodes])
  const deleteNode = useCallback((id: string) => {
    setNodes((items) => items.filter((node) => node.id !== id).map((node) => node.data.groupId === id ? { ...node, data: { ...node.data, groupId: undefined } } : node))
    setEdges((items) => items.filter((edge) => edge.source !== id && edge.target !== id))
    markDirty()
  }, [markDirty, setEdges, setNodes])
  const branchNode = useCallback((id: string) => {
    const source = nodesRef.current.find((node) => node.id === id)
    const prompt = source?.data.content?.trim() || source?.data.prompt?.trim()
    if (!source || !prompt) { setNotice({ type: 'error', text: '先在节点里写下内容，再继续创作' }); return }
    appendResultNode(id, { kind: 'ai', title: 'AI 创作', prompt, mode: 'text', textModel: relayConfig.textModels[0] })
  }, [appendResultNode, relayConfig.textModels])
  const uploadNodeMedia = useCallback(async (id: string, file: File) => {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    if (node.data.kind === 'video') {
      const extension = file.name.split('.').pop()?.toLowerCase()
      const mimeType = file.type || (extension === 'webm' ? 'video/webm' : extension === 'mov' ? 'video/quicktime' : extension === 'mp4' ? 'video/mp4' : '')
      if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(mimeType)) { setNotice({ type: 'error', text: '仅支持 MP4、WebM 或 MOV 视频' }); return }
      try {
        const result = await api<{ videoUrl: string }>('/media/video', { method: 'POST', headers: { 'content-type': mimeType }, body: file })
        updateNode(id, { videoUrl: result.videoUrl, title: file.name.replace(/\.[^.]+$/, '') || '视频' })
      } catch (err) { setNotice({ type: 'error', text: (err as Error).message || '视频上传失败' }) }
      return
    }
    if (node.data.kind !== 'image' || !file.type.startsWith('image/')) return
    if (file.size > 8 * 1024 * 1024) { setNotice({ type: 'error', text: '图片不能超过 8MB' }); return }
    try {
      const imageUrl = await imageFileUrl(file)
      updateNode(id, { imageUrl, title: file.name.replace(/\.[^.]+$/, '') || '视觉参考' })
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message || '图片读取失败' }) }
  }, [updateNode])
  const downloadNodeMedia = useCallback(async (id: string) => {
    const node = nodesRef.current.find((item) => item.id === id)
    const mediaUrl = node?.data.kind === 'video' ? node.data.videoUrl : node?.data.imageUrl
    if (!node || !mediaUrl) return
    const fallbackExtension = node.data.kind === 'video' ? '.mp4' : '.png'
    const baseName = (node.data.title || (node.data.kind === 'video' ? '画布视频' : '画布图片')).replace(/[\/\\?%*:|"<>]/g, '-')
    const clickLink = (href: string, extension = fallbackExtension, revoke = false) => {
      const link = document.createElement('a')
      link.href = href
      link.download = baseName + extension
      if (!revoke) link.target = '_blank'
      link.click()
      if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    }
    try {
      const response = await fetch(mediaUrl)
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      const extension = blob.type.includes('webm') ? '.webm' : blob.type.includes('quicktime') ? '.mov' : blob.type.includes('jpeg') ? '.jpg' : blob.type.includes('webp') ? '.webp' : fallbackExtension
      clickLink(URL.createObjectURL(blob), extension, true)
    } catch { clickLink(mediaUrl) }
  }, [])
  const loadAssets = useCallback(async () => {
    setAssetsLoading(true)
    try {
      const result = await api<{ assets: Asset[] }>('/assets')
      setAssets(result.assets)
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message })
    } finally { setAssetsLoading(false) }
  }, [])
  useEffect(() => { void loadAssets() }, [loadAssets])
  const saveNodeAsset = useCallback(async (id: string) => {
    const node = nodesRef.current.find((item) => item.id === id)
    const canvasId = activeCanvasId.current
    if (!node || !canvasId) return
    try {
      const kind: Asset['kind'] = node.data.kind === 'image' ? 'image' : node.data.kind === 'video' ? 'video' : 'text'
      const rawContent = kind === 'image' ? node.data.imageUrl : kind === 'video' ? node.data.videoUrl : node.data.content
      if (!rawContent?.trim()) throw new Error('这个节点还没有可以收藏的内容')
      const content = kind === 'image' ? await referenceImageDataUrl(rawContent) : rawContent.trim()
      const result = await api<{ asset: Asset }>('/assets', {
        method: 'POST',
        body: JSON.stringify({ kind, title: node.data.title?.trim() || (kind === 'image' ? '画布图片' : kind === 'video' ? '画布视频' : '画布文本'), content, sourceCanvasId: canvasId, sourceNodeId: id }),
      })
      setAssets((items) => [result.asset, ...items])
      setNotice({ type: 'ok', text: '已收藏到资产库' })
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [])
  const toggleImageRatio = useCallback((id: string) => {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node || node.data.kind !== 'image') return
    updateNode(id, { freeResize: !node.data.freeResize })
    setNotice({ type: 'ok', text: node.data.freeResize ? '已切换为等比缩放' : '已切换为自由缩放' })
  }, [updateNode])
  const openImageTool = useCallback((id: string, tool: 'crop' | 'split' | 'upscale' | 'view') => {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node?.data.imageUrl) { setNotice({ type: 'error', text: '这个节点还没有图片' }); return }
    setImageToolDialog({ nodeId: id, tool })
  }, [])
  const applyImageTool = useCallback(async (options: { ratio?: number | null; rows?: number; columns?: number; scale?: number }) => {
    if (!imageToolDialog || imageToolBusy) return
    const source = nodesRef.current.find((node) => node.id === imageToolDialog.nodeId)
    if (!source?.data.imageUrl) return
    setImageToolBusy(true)
    try {
      const rawResults = imageToolDialog.tool === 'crop'
        ? [await cropImageUrl(source.data.imageUrl, options.ratio ?? null)]
        : imageToolDialog.tool === 'split'
          ? await splitImageUrl(source.data.imageUrl, options.rows || 2, options.columns || 2)
          : [await upscaleImageUrl(source.data.imageUrl, options.scale || 2)]
      const results: Array<{ imageUrl: string; width: number; height: number; row: number; column: number }> = rawResults.map((result, index) => ({
        imageUrl: result.imageUrl, width: result.width, height: result.height,
        row: 'row' in result && typeof result.row === 'number' ? result.row : index,
        column: 'column' in result && typeof result.column === 'number' ? result.column : 0,
      }))
      const columns = imageToolDialog.tool === 'split' ? options.columns || 2 : 1
      const sourceSize = nodeDimensions(source)
      const gap = 18
      const cellWidth = imageToolDialog.tool === 'split' ? Math.max(220, Math.round(sourceSize.width / columns)) : sourceSize.width
      const created = results.map((result, index) => {
        const ratio = result.width / Math.max(1, result.height)
        const width = Math.min(520, Math.max(220, cellWidth))
        const height = Math.min(720, Math.max(150, Math.round(width / ratio)))
        const { column, row } = result
        const id = uid()
        return withNodeSize({
          id, type: 'canvasNode', selected: true,
          position: { x: source.position.x + sourceSize.width + 96 + column * (width + gap), y: source.position.y + row * (height + gap) },
          width, height,
          data: { kind: 'image', title: imageToolDialog.tool === 'crop' ? `${source.data.title || '图片'} · 裁剪` : imageToolDialog.tool === 'upscale' ? `${source.data.title || '图片'} · ${options.scale || 2}x` : `${source.data.title || '图片'} · ${row + 1}-${column + 1}`, imageUrl: result.imageUrl, freeResize: false },
        })
      })
      setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...created])
      setEdges((items) => [...items, ...created.map((node) => ({ id: `edge-${source.id}-${node.id}`, source: source.id, target: node.id, type: 'bezier' }))])
      markDirty()
      setImageToolDialog(null)
      setNotice({ type: 'ok', text: imageToolDialog.tool === 'split' ? `已生成 ${created.length} 个切图节点` : '已生成新的图片节点' })
      window.setTimeout(() => flow.current?.fitView({ nodes: [{ id: source.id }, ...created.map((node) => ({ id: node.id }))], padding: .2, duration: 360, maxZoom: 1.05 }), 30)
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message || '图片处理失败' }) }
    finally { setImageToolBusy(false) }
  }, [imageToolBusy, imageToolDialog, markDirty, setEdges, setNodes])
  const insertAsset = useCallback(async (asset: Asset) => {
    const desired = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    let sourceVideo: CanvasNode | undefined
    if (asset.kind === 'video' && asset.source_node_id) {
      if (asset.source_canvas_id === activeCanvasId.current) sourceVideo = nodesRef.current.find((node) => node.id === asset.source_node_id)
      else if (asset.source_canvas_id) {
        try {
          const result = await api<{ canvas: CanvasInfo & { document: { nodes: CanvasNode[] } } }>(`/canvases/${asset.source_canvas_id}`)
          sourceVideo = result.canvas.document.nodes.find((node) => node.id === asset.source_node_id)
        } catch {}
      }
    }
    const data: CanvasData = asset.kind === 'image'
      ? { kind: 'image', title: asset.title, imageUrl: asset.content }
      : asset.kind === 'video'
        ? { kind: 'video', title: asset.title, videoUrl: asset.content, videoModel: sourceVideo?.data.videoModel, videoSize: sourceVideo?.data.videoSize, videoSeconds: sourceVideo?.data.videoSeconds }
        : { kind: 'text', title: asset.title, content: asset.content }
    const id = uid()
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), withNodeSize({ id, type: 'canvasNode', position: openNodePosition(items, desired, data.kind), selected: true, data })])
    markDirty()
    window.setTimeout(() => flow.current?.fitView({ nodes: [{ id }], padding: 0.45, duration: 280, maxZoom: 1.2 }), 20)
  }, [markDirty, setNodes])
  const deleteAsset = useCallback(async (id: string) => {
    try {
      await api(`/assets/${id}`, { method: 'DELETE' })
      setAssets((items) => items.filter((asset) => asset.id !== id))
      setNotice({ type: 'ok', text: '资产已移除' })
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [])
  const runAI = useCallback(async (id: string, prompt: string, model?: string) => {
    const canvasId = activeCanvasId.current
    if (!canvasId || aiNodesInFlight.current.has(id)) return
    if (!user.textApiKeyConfigured) {
      setNotice({ type: 'error', text: '请先在账户安全中保存并测试你的文字 API 密钥' })
      setPanel('account')
      return
    }
    aiNodesInFlight.current.add(id)
    aiInFlight.current += 1
    setNodeBusy(id, true)
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再生成')
      const finalPrompt = buildGenerationContext(id, prompt, nodesRef.current, edgesRef.current).prompt
      const { requestKey, storageKey } = await aiRequestKey(canvasId, id, 'text:' + (model || '') + ':' + finalPrompt)
      const result = await api<{ content: string; charged: number; cached: boolean }>('/ai/chat', { method: 'POST', body: JSON.stringify({ requestKey, model, messages: [{ role: 'user', content: finalPrompt }], maxTokens: 1024 }) })
      if (activeCanvasId.current === canvasId) { setNodeBusy(id, false); appendResultNode(id, { kind: 'text', title: `文字结果${model ? ` · ${model}` : ''}`, content: result.content }) }
      resolvedAIKeys.current.set(storageKey, revision.current)
      await refreshUser()
      setNotice({ type: 'ok', text: result.cached ? '已恢复生成结果' : '生成完成' })
    } catch (err) {
      if (activeCanvasId.current === canvasId) setNodeBusy(id, false)
      setNotice({ type: 'error', text: (err as Error).message })
    } finally {
      aiNodesInFlight.current.delete(id)
      aiInFlight.current = Math.max(0, aiInFlight.current - 1)
    }
  }, [appendResultNode, refreshUser, setNodeBusy, user.textApiKeyConfigured])
  const runImage = useCallback(async (id: string, prompt: string, model?: string, size: ImageSize = '1024x1024') => {
    const canvasId = activeCanvasId.current
    if (!canvasId || aiNodesInFlight.current.has(id)) return
    if (!user.imageApiKeyConfigured) {
      setNotice({ type: 'error', text: '请先在账户安全中保存并测试你的图片 API 密钥' })
      setPanel('account')
      return
    }
    aiNodesInFlight.current.add(id); aiInFlight.current += 1; setNodeBusy(id, true)
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再生成')
      const context = buildGenerationContext(id, prompt, nodesRef.current, edgesRef.current)
      const references = await Promise.all(context.referenceImages.map((item) => referenceImageDataUrl(item.imageUrl)))
      const requestContent = JSON.stringify({ model: model || '', size, prompt: context.prompt, references })
      const { requestKey, storageKey } = await aiRequestKey(canvasId, id, 'image:' + requestContent)
      const result = await api<{ imageUrl: string; model?: string; cached: boolean }>('/ai/image', { method: 'POST', body: JSON.stringify({ requestKey, model, prompt: context.prompt, size, references }) })
      const imageUrl = await persistableGeneratedImageUrl(result.imageUrl)
      if (activeCanvasId.current === canvasId) { appendResultNode(id, { kind: 'image', title: `图片结果${result.model || model ? ` · ${result.model || model}` : ''}`, imageUrl }); setNodeBusy(id, false) }
      resolvedAIKeys.current.set(storageKey, revision.current); await refreshUser(); setNotice({ type: 'ok', text: result.cached ? '已恢复图片结果' : '图片生成完成' })
    } catch (err) {
      if (activeCanvasId.current === canvasId) setNodeBusy(id, false)
      setNotice({ type: 'error', text: (err as Error).message })
    } finally { aiNodesInFlight.current.delete(id); aiInFlight.current = Math.max(0, aiInFlight.current - 1) }
  }, [appendResultNode, refreshUser, setNodeBusy, user.imageApiKeyConfigured])
  const runVideo = useCallback(async (id: string, prompt: string, model?: string, size: VideoSize = '1280x720', seconds = 6) => {
    const canvasId = activeCanvasId.current
    if (!canvasId || aiNodesInFlight.current.has(id)) return
    if (!user.videoApiKeyConfigured) {
      setNotice({ type: 'error', text: '请先在账户安全中保存并测试你的视频 API 密钥' })
      setPanel('account')
      return
    }
    aiNodesInFlight.current.add(id); aiInFlight.current += 1; setNodeBusy(id, true)
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再生成')
      const context = buildGenerationContext(id, prompt, nodesRef.current, edgesRef.current)
      const references = await Promise.all(context.referenceImages.map((item) => referenceImageDataUrl(item.imageUrl)))
      const requestContent = JSON.stringify({ model: model || '', size, seconds, prompt: context.prompt, references })
      const { requestKey, storageKey } = await aiRequestKey(canvasId, id, 'video:' + requestContent)
      let result = await api<VideoGenerationResult>('/ai/video', { method: 'POST', body: JSON.stringify({ requestKey, model, prompt: context.prompt, size, seconds, references }) })
      while (result.status === 'pending') {
        await new Promise((resolve) => window.setTimeout(resolve, result.pollAfterMs || 1000))
        result = await api<VideoGenerationResult>(`/ai/video/${result.id}`)
      }
      if (!result.videoUrl) throw new Error('视频生成完成，但没有返回视频地址')
      if (activeCanvasId.current === canvasId) {
        appendResultNode(id, { kind: 'video', title: `视频结果${result.model || model ? ` · ${result.model || model}` : ''}`, videoUrl: result.videoUrl, videoModel: result.model || model, videoSize: size, videoSeconds: seconds })
        setNodeBusy(id, false)
      }
      resolvedAIKeys.current.set(storageKey, revision.current)
      await refreshUser().catch(() => {})
      setNotice({ type: 'ok', text: result.cached ? '已恢复视频结果' : '视频生成完成' })
    } catch (err) {
      if (activeCanvasId.current === canvasId) setNodeBusy(id, false)
      await refreshUser().catch(() => {})
      setNotice({ type: 'error', text: (err as Error).message })
    } finally { aiNodesInFlight.current.delete(id); aiInFlight.current = Math.max(0, aiInFlight.current - 1) }
  }, [appendResultNode, refreshUser, setNodeBusy, user.videoApiKeyConfigured])
  const deleteEdge = useCallback((id: string) => { setEdges((items) => items.filter((edge) => edge.id !== id)); markDirty() }, [markDirty, setEdges])
  const groupChildCounts = useMemo(() => {
    const counts = new Map<string, number>()
    nodes.forEach((node) => { if (node.data.groupId) counts.set(node.data.groupId, (counts.get(node.data.groupId) || 0) + 1) })
    return counts
  }, [nodes])
  const liveNodes = useMemo(() => nodes.map((node) => {
    const generationContext = node.data.kind === 'ai' ? buildGenerationContext(node.id, node.data.prompt || '', nodes, edges) : null
    const hasDedicatedDragHandle = node.data.kind === 'text' || node.data.kind === 'note' || node.data.kind === 'ai'
    return { ...node, dragHandle: hasDedicatedDragHandle ? '.node-drag-handle' : undefined, data: {
      ...node.data,
      hovered: hoveredNodeId === node.id,
      groupChildCount: node.data.kind === 'group' ? groupChildCounts.get(node.id) || 0 : undefined,
      referenceImages: generationContext && (node.data.mode === 'image' || node.data.mode === 'video') ? generationContext.referenceImages : undefined,
      contextSummary: generationContext ? { textCount: generationContext.textInputs.length, imageCount: generationContext.referenceImages.length } : undefined,
      textModels: relayConfig.textModels, imageModels: relayConfig.imageModels,
      videoModels: relayConfig.videoModels,
      onChange: updateNode, onRun: runAI, onRunImage: runImage, onRunVideo: runVideo, onInspect: setInspectedNodeId, onDuplicate: duplicateNode, onDelete: deleteNode, onBranch: branchNode, onUpload: uploadNodeMedia, onDownload: downloadNodeMedia, onSaveAsset: saveNodeAsset, onToggleImageRatio: toggleImageRatio, onImageTool: openImageTool,
    } }
  }), [branchNode, deleteNode, downloadNodeMedia, duplicateNode, edges, groupChildCounts, hoveredNodeId, nodes, openImageTool, relayConfig.imageModels, relayConfig.textModels, relayConfig.videoModels, runAI, runImage, runVideo, saveNodeAsset, toggleImageRatio, updateNode, uploadNodeMedia])
  const selectedNodeIds = useMemo(() => new Set(nodes.filter((node) => node.selected).map((node) => node.id)), [nodes])
  const selectedNodeCount = selectedNodeIds.size
  const liveEdges = useMemo(() => edges.map((edge) => ({ ...edge, type: 'bezier', className: selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target) ? 'connected' : edge.className, data: { ...edge.data, onDelete: deleteEdge } })), [deleteEdge, edges, selectedNodeIds])
  const deselectCanvas = useCallback(() => {
    setNodes((items) => items.map((node) => node.selected ? { ...node, selected: false } : node))
    setEdges((items) => items.map((edge) => edge.selected ? { ...edge, selected: false } : edge))
  }, [setEdges, setNodes])
  const deleteSelectedNodes = useCallback(() => {
    if (!selectedNodeIds.size) return
    const ids = new Set(selectedNodeIds)
    setNodes((items) => items.filter((node) => !ids.has(node.id)).map((node) => node.data.groupId && ids.has(node.data.groupId) ? { ...node, data: { ...node.data, groupId: undefined } } : node))
    setEdges((items) => items.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)))
    setInspectedNodeId((id) => id && ids.has(id) ? null : id)
    markDirty()
  }, [markDirty, selectedNodeIds, setEdges, setNodes])
  const openNodeMenu = useCallback((event: ReactMouseEvent, node: CanvasNode) => {
    event.preventDefault()
    event.stopPropagation()
    setAppearanceOpen(false)
    setNodes((items) => items.map((item) => ({ ...item, selected: item.id === node.id })))
    setCanvasMenu({ type: 'node', x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [setNodes])
  useLayoutEffect(() => {
    const menu = canvasMenuRef.current
    if (!canvasMenu || !menu) return

    const placeMenu = () => {
      const margin = 8
      const { width, height } = menu.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = document.documentElement.clientHeight
      const x = Math.min(Math.max(margin, canvasMenu.x), Math.max(margin, viewportWidth - width - margin))
      const y = Math.min(Math.max(margin, canvasMenu.y), Math.max(margin, viewportHeight - height - margin))
      setCanvasMenuPosition((position) => position.x === x && position.y === y ? position : { x, y })
    }

    placeMenu()
    const observer = new ResizeObserver(placeMenu)
    observer.observe(menu)
    window.addEventListener('resize', placeMenu)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', placeMenu)
    }
  }, [canvasMenu])
  const clearCanvas = useCallback(() => {
    if (!nodesRef.current.length && !edgesRef.current.length) return
    if (!window.confirm('清空当前画布上的所有节点和连接吗？')) return
    setCanvasMenu(null)
    setInspectedNodeId(null)
    setNodes([])
    setEdges([])
    markDirty()
  }, [markDirty, setEdges, setNodes])
  const save = useCallback(() => {
    if (!current) return Promise.resolve(true)
    const canvas = { ...current }
    const savedName = canvas.name.trim() || '未命名画布'
    const savedRevision = revision.current
    const draft = makeDraft(serverVersion.current, savedName, nodes, edges, assistantMessagesRef.current)
    const persist = async () => {
      if (deletedCanvasIds.current.has(canvas.id)) return true
      if (activeCanvasId.current === canvas.id) setSaveState('saving')
      try {
        const result = await api<{ version: number }>(`/canvases/${canvas.id}`, { method: 'PUT', body: JSON.stringify({ name: savedName, version: serverVersion.current, document: { nodes: draft.nodes, edges: draft.edges, assistantMessages: draft.assistantMessages } }) })
        serverVersion.current = result.version
        for (const [key, requiredRevision] of resolvedAIKeys.current) {
          if (!key.startsWith(`ink-ai:${canvas.id}:`) || requiredRevision > savedRevision) continue
          localStorage.removeItem(key)
          resolvedAIKeys.current.delete(key)
        }
        updateCanvases((items) => items.map((item) => item.id === canvas.id ? { ...item, name: savedName, version: result.version } : item))
        if (activeCanvasId.current === canvas.id) {
          setCurrent((item) => item?.id === canvas.id ? {
            ...item,
            ...(revision.current === savedRevision ? { name: savedName } : {}),
            version: result.version,
          } : item)
          persistedRevision.current = Math.max(persistedRevision.current, savedRevision)
          const nextState = revision.current === savedRevision ? 'saved' : 'dirty'
          setSaveState(nextState)
          if (nextState === 'saved') {
            localStorage.removeItem(draftKey(user.id, canvas.id))
            setBlockedReason(null)
          }
        }
        return true
      } catch (err) {
        if (activeCanvasId.current === canvas.id) {
          setSaveState('error')
          if (err instanceof ApiError && err.status === 404) {
            updateCanvases((items) => items.filter((item) => item.id !== canvas.id))
            setBlockedReason('deleted')
          } else if ((err as Error).message.includes('其他页面更新')) setBlockedReason('conflict')
          setNotice({ type: 'error', text: (err as Error).message })
        }
        return false
      }
    }
    saveQueue.current = saveQueue.current.then(persist, persist)
    return saveQueue.current
  }, [current, edges, nodes, updateCanvases, user.id])
  saveRef.current = save
  const flush = useCallback(async () => {
    if (blockedReason === 'session' || blockedReason === 'conflict') return false
    if (blockedReason === 'deleted') return true
    const canvasId = activeCanvasId.current
    if (canvasId && deletedCanvasIds.current.has(canvasId)) return true
    while (canvasId && activeCanvasId.current === canvasId && persistedRevision.current < revision.current) {
      if (!(await saveRef.current())) return false
    }
    return true
  }, [blockedReason])
  flushRef.current = flush

  const openCanvas = useCallback(async (id: string) => {
    try {
      if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再切换画布' }); return }
      if (creatingCanvasRef.current) { setNotice({ type: 'error', text: '请等待画布创建完成' }); return }
      if (id === activeCanvasId.current || deletedCanvasIds.current.has(id)) return
      if (activeCanvasId.current && !(await flushRef.current())) return
      const requestId = ++openRequest.current
      const result = await api<{ canvas: CanvasInfo & { document: { nodes: CanvasNode[]; edges: Edge[]; assistantMessages?: AssistantMessage[] } } }>(`/canvases/${id}`)
      if (requestId !== openRequest.current || deletedCanvasIds.current.has(id)) return
      if (!(await flushRef.current()) || requestId !== openRequest.current) return
      const draft = readDraft(user.id, id)
      activeCanvasId.current = id
      serverVersion.current = draft?.baseVersion ?? result.canvas.version
      if (draft) {
        revision.current = 1
        persistedRevision.current = 0
        setCurrent({ ...result.canvas, name: draft.name, version: draft.baseVersion })
        setNodes(draft.nodes)
        setEdges(draft.edges)
        replaceAssistantMessages(draft.assistantMessages)
        resetHistory(draft.nodes, draft.edges)
        const hasConflict = draft.baseVersion !== result.canvas.version
        setSaveState(hasConflict ? 'error' : 'dirty')
        setBlockedReason(hasConflict ? 'conflict' : null)
        setNotice({ type: hasConflict ? 'error' : 'ok', text: hasConflict ? '服务器已有更新，本地草稿已恢复但不会自动覆盖' : '已恢复本地草稿' })
      } else {
        revision.current = 0
        persistedRevision.current = 0
        const loadedNodes = result.canvas.document.nodes.map(withNodeSize)
        setCurrent(result.canvas)
        setNodes(loadedNodes)
        setEdges(result.canvas.document.edges)
        replaceAssistantMessages(result.canvas.document.assistantMessages || [])
        resetHistory(loadedNodes, result.canvas.document.edges)
        setSaveState('saved')
        setBlockedReason(null)
      }
      setSidebar(false)
      window.setTimeout(() => flow.current?.fitView({ padding: 0.25, maxZoom: 1.2 }), 30)
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [replaceAssistantMessages, resetHistory, setEdges, setNodes, user.id])
  useEffect(() => {
    api<{ canvases: CanvasInfo[] }>('/canvases').then((result) => {
      updateCanvases(result.canvases)
      if (result.canvases[0]) void openCanvas(result.canvases[0].id)
    }).catch((err) => setNotice({ type: 'error', text: err.message }))
  }, [openCanvas, updateCanvases])
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
      updateCanvases((items) => items.some((item) => item.id === result.canvas.id) ? items : [result.canvas, ...items])
      if (!(await flushRef.current()) || requestId !== openRequest.current) return
      const first: CanvasNode = withNodeSize({ id: uid(), type: 'canvasNode', position: { x: 80, y: 80 }, data: { kind: 'note', title: '欢迎来到墨屿', content: '从左侧添加内容，拖动画布探索空间。节点会自动保存。' } })
      activeCanvasId.current = result.canvas.id
      serverVersion.current = result.canvas.version
      revision.current = 1
      persistedRevision.current = 0
      setCurrent(result.canvas)
      setNodes([first])
      setEdges([])
      replaceAssistantMessages([])
      resetHistory([first], [])
      setSaveState('dirty')
      setBlockedReason(null)
      setSidebar(false)
      window.setTimeout(() => flow.current?.fitView({ padding: 0.25, maxZoom: 1.2 }), 30)
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
      localStorage.removeItem(draftKey(user.id, id))
    } catch (err) {
      deletedCanvasIds.current.delete(id)
      setNotice({ type: 'error', text: (err as Error).message })
      void flushRef.current()
      return
    }
    const remaining = updateCanvases((items) => items.filter((canvas) => canvas.id !== id))
    if (activeCanvasId.current === id) {
      ++openRequest.current
      activeCanvasId.current = null
      revision.current = 0
      persistedRevision.current = 0
      setCurrent(null)
      setNodes([])
      setEdges([])
      replaceAssistantMessages([])
      const next = remaining.find((canvas) => !deletedCanvasIds.current.has(canvas.id))
      if (next) await openCanvas(next.id)
    }
  }
  useEffect(() => {
    if (saveState !== 'dirty' || !current || blockedReason === 'session' || blockedReason === 'conflict' || blockedReason === 'deleted') return
    const timer = window.setTimeout(() => void save(), 900)
    return () => window.clearTimeout(timer)
  }, [assistantMessages, blockedReason, current, edges, nodes, save, saveState])
  useEffect(() => {
    if (!current || (saveState !== 'dirty' && saveState !== 'error')) return
    try {
      localStorage.setItem(draftKey(user.id, current.id), JSON.stringify(makeDraft(serverVersion.current, current.name, nodes, edges, assistantMessages)))
      setBlockedReason((reason) => reason === 'storage' ? null : reason)
    } catch {
      if (session.get()) setBlockedReason('storage')
      setNotice({ type: 'error', text: '本地草稿空间不足，请立即下载草稿备份' })
    }
  }, [assistantMessages, current, edges, nodes, saveState, user.id])

  function addNode(kind: CanvasData['kind'], screenPosition?: { x: number; y: number }, content = '', customTitle?: string) {
    const center = flow.current?.screenToFlowPosition(screenPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    const title = customTitle || (kind === 'group' ? '创作框架' : kind === 'ai' ? 'AI 创作' : kind === 'video' ? '视频' : kind === 'image' ? '视觉参考' : kind === 'note' ? '便签' : '文本')
    setNodes((items) => {
      const data: CanvasData = kind === 'ai'
        ? { kind, title, prompt: content, mode: 'text', textModel: relayConfig.textModels[0], imageModel: relayConfig.imageModels[0], imageSize: '1024x1024', videoModel: relayConfig.videoModels[0], videoSize: '1280x720', videoSeconds: 6 }
        : kind === 'video'
          ? { kind, title, videoUrl: content || undefined }
          : { kind, title, content }
      return [...items.map((node) => ({ ...node, selected: false })), withNodeSize({ id: uid(), type: 'canvasNode', position: openNodePosition(items, center, kind), selected: true, data })]
    })
    markDirty()
  }
  const assistantContextNodes = nodes.filter((node) => node.selected && node.data.kind !== 'group')
  const assistantContextCount = assistantContextNodes.length
  async function sendAssistant(content: string, model: string) {
    const canvasId = activeCanvasId.current
    if (!canvasId || assistantBusyRef.current) return
    if (!user.textApiKeyConfigured) {
      setNotice({ type: 'error', text: '请先在账户安全中保存并测试你的文字 API 密钥' })
      setPanel('account')
      return
    }
    if (!model) { setNotice({ type: 'error', text: '管理员尚未配置文字模型' }); return }
    const sourceNodes = (assistantContextNodes.length ? assistantContextNodes : nodesRef.current.filter((node) => node.data.kind !== 'group')).slice(0, 24)
    const context = sourceNodes.map((node, index) => {
      const value = node.data.content?.trim() || node.data.prompt?.trim() || (node.data.kind === 'image' ? '[图片节点]' : '')
      return `${index + 1}. ${node.data.title || '未命名节点'}：${value.slice(0, 2400)}`
    }).join('\n')
    const previous = assistantMessagesRef.current
    const userMessage: AssistantMessage = { id: uid(), role: 'user', content, createdAt: Date.now() }
    replaceAssistantMessages([...previous, userMessage].slice(-50))
    markDirty()
    assistantBusyRef.current = true
    setAssistantBusy(true)
    aiInFlight.current += 1
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再询问助手')
      const messages = [
        { role: 'system' as const, content: `你是无限画布中的创作助手。基于画布上下文直接回答，给出具体、可放回画布继续使用的内容。\n\n画布上下文：\n${context || '当前画布没有可用文字内容。'}` },
        ...previous.slice(-10).map((message) => ({ role: message.role, content: message.content })),
        { role: 'user' as const, content },
      ]
      const { requestKey, storageKey } = await aiRequestKey(canvasId, 'assistant', JSON.stringify({ id: userMessage.id, model, messages }))
      const result = await api<{ content: string; charged: number; cached: boolean }>('/ai/chat', { method: 'POST', body: JSON.stringify({ requestKey, model, messages, maxTokens: 1400 }) })
      if (activeCanvasId.current === canvasId) {
        const reply: AssistantMessage = { id: uid(), role: 'assistant', content: result.content, createdAt: Date.now() }
        replaceAssistantMessages([...assistantMessagesRef.current, reply].slice(-50))
        markDirty()
        resolvedAIKeys.current.set(storageKey, revision.current)
        setNotice({ type: 'ok', text: result.cached ? '已恢复助手回复' : '助手回复完成' })
      }
      await refreshUser()
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message })
    } finally {
      assistantBusyRef.current = false
      setAssistantBusy(false)
      aiInFlight.current = Math.max(0, aiInFlight.current - 1)
    }
  }
  function createImageFromAssistant(content: string) {
    const desired = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    const id = uid()
    const data: CanvasData = { kind: 'ai', title: '生图创作', prompt: content, mode: 'image', textModel: relayConfig.textModels[0], imageModel: relayConfig.imageModels[0], imageSize: '1024x1024' }
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), withNodeSize({ id, type: 'canvasNode', position: openNodePosition(items, desired, 'ai'), selected: true, data })])
    markDirty()
    window.setTimeout(() => flow.current?.fitView({ nodes: [{ id }], padding: 0.45, duration: 280, maxZoom: 1.1 }), 20)
  }
  function clearAssistant() {
    if (assistantBusyRef.current || !assistantMessagesRef.current.length) return
    if (!window.confirm('清空当前画布的助手对话吗？')) return
    replaceAssistantMessages([])
    markDirty()
  }
  const addGroup = useCallback(() => {
    const selected = nodesRef.current.filter((node) => node.selected && node.data.kind !== 'group')
    const size = (node: CanvasNode) => ({ width: node.measured?.width || node.width || nodeSize(node.data.kind).width, height: node.measured?.height || node.height || nodeSize(node.data.kind).height })
    const bounds = selected.length ? {
      left: Math.min(...selected.map((node) => node.position.x)),
      top: Math.min(...selected.map((node) => node.position.y)),
      right: Math.max(...selected.map((node) => node.position.x + size(node).width)),
      bottom: Math.max(...selected.map((node) => node.position.y + size(node).height)),
    } : null
    const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    const width = Math.max(760, (bounds?.right || center.x + 320) - (bounds?.left || center.x - 320) + 80)
    const height = Math.max(480, (bounds?.bottom || center.y + 180) - (bounds?.top || center.y - 180) + 80)
    const position = { x: (bounds?.left ?? center.x - 320) - 40, y: (bounds?.top ?? center.y - 180) - 40 }
    const group = withNodeSize({ id: uid(), type: 'canvasNode', position, width, height, zIndex: -1, selected: true, data: { kind: 'group', title: '创作框架', content: '' } })
    setNodes((items) => [group, ...items.map((node) => ({ ...node, selected: false, data: selected.some((item) => item.id === node.id) ? { ...node.data, groupId: group.id } : node.data }))])
    markDirty()
  }, [markDirty, setNodes])
  const createNodeFromConnection = useCallback((sourceId: string, position: { x: number; y: number }) => {
    const source = nodesRef.current.find((node) => node.id === sourceId)
    if (!source) return
    const id = uid()
    const content = source.data.content?.trim() || source.data.prompt?.trim() || ''
    const data: CanvasData = { kind: 'text', title: '连接内容', content }
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), withNodeSize({ id, type: 'canvasNode', position, selected: true, data })])
    setEdges((items) => addEdge({ id: `edge-${sourceId}-${id}`, source: sourceId, target: id, type: 'bezier' }, items))
    markDirty()
  }, [markDirty, setEdges, setNodes])
  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: { fromNode: { id: string } | null; toNode: unknown; to: { x: number; y: number } | null }) => {
    if (state.fromNode && !state.toNode && state.to) createNodeFromConnection(state.fromNode.id, state.to)
  }, [createNodeFromConnection])
  const connect = useCallback((connection: Connection) => {
    setEdges((items) => addEdge({ ...connection, type: 'bezier' }, items))
    markDirty()
  }, [markDirty, setEdges])
  const changeNodes = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const removedGroupIds = new Set(changes
      .filter((change): change is Extract<NodeChange<CanvasNode>, { type: 'remove' }> => change.type === 'remove')
      .map((change) => nodesRef.current.find((node) => node.id === change.id))
      .filter((node): node is CanvasNode => node?.data.kind === 'group')
      .map((node) => node.id))
    onNodesChange(changes)
    if (removedGroupIds.size) {
      setNodes((items) => items.map((node) => removedGroupIds.has(node.data.groupId || '') ? { ...node, data: { ...node.data, groupId: undefined } } : node))
    }
    if (changes.some((change) => change.type === 'position' || change.type === 'dimensions' || change.type === 'add' || change.type === 'remove' || change.type === 'replace')) markDirty()
  }, [markDirty, onNodesChange, setNodes])
  const focusNode = useCallback((id: string) => {
    setNodes((items) => items.map((node) => ({ ...node, selected: node.id === id })))
    window.setTimeout(() => flow.current?.fitView({ nodes: [{ id }], padding: 0.45, duration: 280, maxZoom: 1.25 }), 20)
  }, [setNodes])
  const selectNode = useCallback((event: ReactMouseEvent, node: CanvasNode) => {
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    setNodes((items) => items.map((item) => item.id === node.id ? { ...item, selected: !item.selected } : item))
  }, [setNodes])
  const startNodeDrag = useCallback((_event: ReactMouseEvent, node: CanvasNode) => {
    setCanvasMenu(null)
    if (node.data.kind !== 'group') { groupDragStart.current = null; return }
    groupDragStart.current = { id: node.id, x: node.position.x, y: node.position.y, children: new Map(nodesRef.current.filter((item) => item.data.groupId === node.id).map((item) => [item.id, { ...item.position }])) }
  }, [])
  const dragNode = useCallback((_event: ReactMouseEvent, node: CanvasNode) => {
    const group = groupDragStart.current
    if (!group || group.id !== node.id) return
    const dx = node.position.x - group.x
    const dy = node.position.y - group.y
    setNodes((items) => items.map((item) => {
      const start = group.children.get(item.id)
      return start ? { ...item, position: { x: start.x + dx, y: start.y + dy } } : item
    }))
  }, [setNodes])
  const stopNodeDrag = useCallback((_event: ReactMouseEvent, node: CanvasNode) => {
    const group = groupDragStart.current
    if (group?.id === node.id) { dragNode(_event, node); groupDragStart.current = null; return }
    groupDragStart.current = null
    const currentNodes = nodesRef.current
    const movedIds = new Set(node.selected ? currentNodes.filter((item) => item.selected && item.data.kind !== 'group').map((item) => item.id) : [node.id])
    let changed = false
    const next = currentNodes.map((item) => {
      if (!movedIds.has(item.id) || item.data.kind === 'group') return item
      const dimensions = nodeDimensions(item)
      const centerX = item.position.x + dimensions.width / 2
      const centerY = item.position.y + dimensions.height / 2
      const target = [...currentNodes].reverse().find((candidate) => {
        if (candidate.data.kind !== 'group' || candidate.id === item.id) return false
        const size = nodeDimensions(candidate)
        return centerX >= candidate.position.x && centerX <= candidate.position.x + size.width && centerY >= candidate.position.y && centerY <= candidate.position.y + size.height
      })
      const groupId = target?.id
      if (item.data.groupId === groupId) return item
      changed = true
      return { ...item, data: { ...item.data, groupId } }
    })
    if (changed) { setNodes(next); markDirty() }
  }, [dragNode, markDirty, setNodes])
  const changeEdges = useCallback((changes: EdgeChange<Edge>[]) => {
    onEdgesChange(changes)
    if (changes.some((change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace')) markDirty()
  }, [markDirty, onEdgesChange])
  const arrangeSelection = useCallback((action: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'spaceX' | 'spaceY') => {
    const selected = nodesRef.current.filter((node) => node.selected)
    if (selected.length < 2) return
    const size = (node: CanvasNode) => ({ width: node.measured?.width || node.width || nodeSize(node.data.kind).width, height: node.measured?.height || node.height || nodeSize(node.data.kind).height })
    const left = Math.min(...selected.map((node) => node.position.x))
    const right = Math.max(...selected.map((node) => node.position.x + size(node).width))
    const top = Math.min(...selected.map((node) => node.position.y))
    const bottom = Math.max(...selected.map((node) => node.position.y + size(node).height))
    const positions = new Map<string, { x: number; y: number }>()
    if (action === 'spaceX' && selected.length >= 3) {
      const ordered = [...selected].sort((a, b) => a.position.x - b.position.x)
      const gap = Math.max(0, (right - left - ordered.reduce((sum, node) => sum + size(node).width, 0)) / (ordered.length - 1))
      let x = left
      ordered.forEach((node) => { positions.set(node.id, { x, y: node.position.y }); x += size(node).width + gap })
    } else if (action === 'spaceY' && selected.length >= 3) {
      const ordered = [...selected].sort((a, b) => a.position.y - b.position.y)
      const gap = Math.max(0, (bottom - top - ordered.reduce((sum, node) => sum + size(node).height, 0)) / (ordered.length - 1))
      let y = top
      ordered.forEach((node) => { positions.set(node.id, { x: node.position.x, y }); y += size(node).height + gap })
    } else {
      selected.forEach((node) => {
        const dimensions = size(node)
        const x = action === 'left' ? left : action === 'centerX' ? (left + right - dimensions.width) / 2 : action === 'right' ? right - dimensions.width : node.position.x
        const y = action === 'top' ? top : action === 'centerY' ? (top + bottom - dimensions.height) / 2 : action === 'bottom' ? bottom - dimensions.height : node.position.y
        positions.set(node.id, { x, y })
      })
    }
    if (!positions.size) return
    setNodes((items) => items.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node))
    markDirty()
  }, [markDirty, setNodes])
  const pasteCopiedNodes = useCallback(() => {
    if (!clipboard.current.nodes.length) return false
    const idMap = new Map(clipboard.current.nodes.map((node) => [node.id, uid()]))
    const copiedIds = new Set(clipboard.current.nodes.map((node) => node.id))
    const copies = clipboard.current.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      position: { x: node.position.x + 42, y: node.position.y + 42 },
      selected: true,
      data: {
        ...node.data,
        groupId: node.data.groupId && copiedIds.has(node.data.groupId)
          ? idMap.get(node.data.groupId)
          : undefined,
      },
    }))
    const copiedEdges = clipboard.current.edges.map((edge) => ({ ...edge, id: uid(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, selected: false, type: 'bezier' }))
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...copies])
    setEdges((items) => [...items.map((edge) => ({ ...edge, selected: false })), ...copiedEdges])
    clipboard.current = cloneSnapshot({ nodes: copies, edges: copiedEdges })
    markDirty()
    return true
  }, [cloneSnapshot, markDirty, setEdges, setNodes])
  const insertImageFiles = useCallback(async (files: File[], anchor: { x: number; y: number }, action: '粘贴' | '导入') => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    const valid = images.filter((file) => file.size <= 8 * 1024 * 1024).slice(0, maxImageImportCount)
    const skipped = images.length - valid.length
    if (!valid.length) { setNotice({ type: 'error', text: '每张图片不能超过 8MB' }); return }
    try {
      const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(valid.length))))
      const created: CanvasNode[] = []
      for (let index = 0; index < valid.length; index += 1) {
        const file = valid[index]
        const desired = { x: anchor.x + (index % columns) * 324, y: anchor.y + Math.floor(index / columns) * 308 }
        const position = openNodePosition([...nodesRef.current, ...created], desired, 'image')
        created.push(withNodeSize({ id: uid(), type: 'canvasNode', position, selected: true, data: { kind: 'image', title: file.name.replace(/\.[^.]+$/, '') || `${action}图片`, imageUrl: await imageFileUrl(file) } }))
      }
      setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...created])
      markDirty()
      setNotice({ type: 'ok', text: `已${action} ${created.length} 张图片${skipped ? `，跳过 ${skipped} 张超限图片` : ''}` })
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message || '剪贴板图片读取失败' }) }
  }, [markDirty, setNodes])
  const pasteImages = useCallback((files: File[]) => {
    const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    return insertImageFiles(files, center, '粘贴')
  }, [insertImageFiles])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable=true]')) return
      const modifier = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        setCanvasMenu(null)
        setAppearanceOpen(false)
        setTopbarMenuOpen(false)
        setSidebar(false)
        setShortcutsOpen(false)
        setNodes((items) => items.map((node) => node.selected ? { ...node, selected: false } : node))
        setEdges((items) => items.map((edge) => edge.selected ? { ...edge, selected: false } : edge))
        return
      }
      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setNodes((items) => items.map((node) => ({ ...node, selected: true })))
        return
      }
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (modifier && event.key.toLowerCase() === 'c') {
        const selectedNodes = nodesRef.current.filter((node) => node.selected)
        if (!selectedNodes.length) return
        event.preventDefault()
        const selectedIds = new Set(selectedNodes.map((node) => node.id))
        clipboard.current = cloneSnapshot({ nodes: selectedNodes, edges: edgesRef.current.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)) })
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cloneSnapshot, redo, setEdges, setNodes, undo])
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable=true]')) return
      const images = Array.from(event.clipboardData?.items || []).filter((item) => item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))
      if (images.length) { event.preventDefault(); void pasteImages(images); return }
      if (pasteCopiedNodes()) { event.preventDefault(); return }
      const text = event.clipboardData?.getData('text/plain').trim()
      if (text) { event.preventDefault(); addNode('text', undefined, text, '粘贴文本') }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [pasteCopiedNodes, pasteImages])
  const dropImage = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    const anchor = flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || { x: 200, y: 150 }
    await insertImageFiles(files, anchor, '导入')
  }, [insertImageFiles])
  const toggleMiniMap = useCallback(() => {
    setShowMiniMap((visible) => {
      localStorage.setItem('ink-show-minimap', String(!visible))
      return !visible
    })
  }, [])
  const focusCanvas = useCallback(() => {
    if (nodesRef.current.length) void flow.current?.fitView({ padding: 0.22, duration: 320, maxZoom: 1.2 })
    else void flow.current?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 260 })
  }, [])
  const zoomCanvas = useCallback((zoom: number) => {
    const bounded = Math.min(5, Math.max(0.05, zoom))
    setCanvasZoom(bounded)
    void flow.current?.zoomTo(bounded, { duration: 80 })
  }, [])
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
  const downloadDraft = useCallback(() => {
    if (!current) return
    const draft = JSON.stringify(makeDraft(serverVersion.current, current.name, nodes, edges, assistantMessages), null, 2)
    const url = URL.createObjectURL(new Blob([draft], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${current.name.trim() || '画布'}-本地草稿.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [assistantMessages, current, edges, nodes])
  const importDraft = useCallback(async (file: File) => {
    const canvasId = activeCanvasId.current
    if (!current || !canvasId) return
    if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再导入草稿' }); return }
    if (file.size > 10 * 1024 * 1024) { setNotice({ type: 'error', text: '草稿文件不能超过 10MB' }); return }
    let draft: CanvasDraft | null = null
    try { draft = parseDraft(JSON.parse(await file.text())) } catch {}
    if (!draft) { setNotice({ type: 'error', text: '草稿文件格式无效或内容已损坏' }); return }
    if (!window.confirm(`导入将覆盖当前画布“${current.name}”的内容，确认继续吗？`)) return
    try {
      const result = await api<{ canvas: CanvasInfo }>(`/canvases/${canvasId}`)
      if (activeCanvasId.current !== canvasId || deletedCanvasIds.current.has(canvasId)) return
      ++openRequest.current
      serverVersion.current = result.canvas.version
      revision.current += 1
      persistedRevision.current = Math.min(persistedRevision.current, revision.current - 1)
      setCurrent((item) => item?.id === canvasId ? { ...item, name: draft.name.trim() || '未命名画布', version: result.canvas.version } : item)
      setNodes(draft.nodes)
      setEdges(draft.edges)
      replaceAssistantMessages(draft.assistantMessages)
      resetHistory(draft.nodes, draft.edges)
      setBlockedReason(null)
      setSaveState('dirty')
      setNotice({ type: 'ok', text: '草稿已导入，正在保存' })
      window.setTimeout(() => flow.current?.fitView({ padding: 0.25, maxZoom: 1.2 }), 30)
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [current, replaceAssistantMessages, resetHistory, setEdges, setNodes])
  const chooseDraft = useCallback(() => {
    if (!current) return
    if (blockedReason === 'session') { setNotice({ type: 'error', text: '请重新登录后再导入草稿' }); return }
    importInput.current?.click()
  }, [blockedReason, current])
  const chooseCanvasImport = useCallback(() => {
    if (!current) return
    if (blockedReason === 'session') { setNotice({ type: 'error', text: '请重新登录后再导入文件' }); return }
    topImportInput.current?.click()
  }, [blockedReason, current])
  const importCanvasFiles = useCallback((files: File[]) => {
    const selection = classifyCanvasImportFiles(files)
    if (selection.kind === 'draft') { void importDraft(selection.file); return }
    if (selection.kind === 'images') {
      const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
      void insertImageFiles(selection.files, center, '导入')
      return
    }
    const text = selection.reason === 'multiple-drafts'
      ? '一次只能导入一份画布草稿'
      : selection.reason === 'mixed'
        ? '画布草稿和图片不能混合导入'
        : '请选择画布草稿 JSON 或图片文件'
    setNotice({ type: 'error', text })
  }, [importDraft, insertImageFiles])
  const discardDraft = useCallback(() => {
    if (!current || !window.confirm('确定放弃本地草稿并加载服务器版本吗？此操作无法撤销。')) return
    localStorage.removeItem(draftKey(user.id, current.id))
    window.location.reload()
  }, [current, user.id])
  const abandonDeletedCanvas = useCallback(() => {
    if (!current || !window.confirm('确定放弃这张已删除画布的本地草稿吗？请先下载需要保留的内容。')) return
    const canvasId = current.id
    localStorage.removeItem(draftKey(user.id, canvasId))
    const remaining = updateCanvases((items) => items.filter((item) => item.id !== canvasId))
    ++openRequest.current
    activeCanvasId.current = null
    revision.current = 0
    persistedRevision.current = 0
    setCurrent(null)
    setNodes([])
    setEdges([])
    replaceAssistantMessages([])
    setSaveState('saved')
    setBlockedReason(null)
    if (remaining[0]) void openCanvas(remaining[0].id)
  }, [current, openCanvas, replaceAssistantMessages, setEdges, setNodes, updateCanvases, user.id])
  useEffect(() => session.onClear(() => {
    if (persistedRevision.current >= revision.current && aiInFlight.current === 0) setUser(null)
    else {
      setBlockedReason('session')
      setNotice({ type: 'error', text: '登录已失效；未保存内容已保留在本机' })
    }
  }), [setUser])

  const backgroundGridColor = themeMode === 'dark' ? 'rgba(245,245,244,.10)' : 'rgba(68,64,60,.12)'
  return <main className={`workspace theme-${themeMode}`}>
    <aside className={`sidebar ${sidebar ? 'open' : ''}`} aria-hidden={!sidebar} inert={!sidebar}>
      <div className="sidebar-brand"><div className="brand-mark small">墨</div><strong>墨屿</strong><button className="icon-button sidebar-close" title="收起" aria-label="收起我的画布" onClick={() => setSidebar(false)}><ChevronLeft size={18} /></button></div>
      <button className="new-canvas" onClick={createCanvas} disabled={creatingCanvas}><Plus size={17} />新建画布</button>
      <nav className="canvas-list" aria-label="我的画布">{canvases.map((canvas) => <div className={canvas.id === current?.id ? 'active' : ''} key={canvas.id}><button onClick={() => openCanvas(canvas.id)}><LayoutDashboard size={15} /><span>{canvas.name}</span></button><button className="canvas-delete" title="删除画布" onClick={() => deleteCanvas(canvas.id)}><Trash2 size={14} /></button></div>)}</nav>
      <div className={'sidebar-account'}><button onClick={() => setPanel('account')}><div className={'avatar'}>{user.name.slice(0, 1)}</div><span><strong>{user.name}</strong><small>账户安全与 API 密钥</small></span></button><button className={'icon-button'} title={'退出登录'} onClick={() => void logout()}><LogOut size={17} /></button></div>
    </aside>
    {sidebar && <button className="sidebar-backdrop" onClick={() => setSidebar(false)} aria-label="关闭侧栏" />}
    <section className="canvas-shell" style={{ '--canvas-panel-width': `${canvasPanelWidth}px`, '--canvas-panel-half': `${canvasPanelWidth / 2}px` } as CSSProperties}>
      {blockedReason && <div className="workspace-alert" role="alert"><span>{blockedReason === 'session' ? '登录已失效，本地草稿会在重新登录后恢复。' : blockedReason === 'conflict' ? '服务器存在更新，本地草稿未覆盖服务器内容。' : blockedReason === 'deleted' ? '这张画布已在其他页面删除，本地草稿尚未丢失。' : '本地草稿空间不足，请下载备份。'}</span><div><button className="icon-button" title="下载草稿" onClick={downloadDraft}><Download size={17} /></button>{blockedReason !== 'session' && blockedReason !== 'deleted' && <button className="icon-button" title="导入草稿" onClick={chooseDraft}><Upload size={17} /></button>}{blockedReason === 'session' ? <button className="secondary" onClick={() => setUser(null)}>重新登录</button> : blockedReason === 'conflict' ? <button className="secondary" onClick={discardDraft}>使用服务器版本</button> : blockedReason === 'deleted' ? <button className="secondary" onClick={abandonDeletedCanvas}>放弃本地草稿</button> : null}</div></div>}
      <header className={'topbar ' + (canvasPanelOpen ? 'panel-open' : '')}>
        <div className="topbar-left">
          <button className="icon-button panel-toggle" title={canvasPanelOpen ? '收起节点面板' : '展开节点面板'} aria-label={canvasPanelOpen ? '收起节点面板' : '展开节点面板'} onClick={() => { setCanvasPanelOpen((value) => !value); setAssistantOpen(false) }}>{canvasPanelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
          <div className="topbar-menu-wrap"><button className={`icon-button menu-button ${topbarMenuOpen ? 'active' : ''}`} title="画布菜单" aria-label="打开画布菜单" aria-expanded={topbarMenuOpen} onClick={() => setTopbarMenuOpen((value) => !value)}><Menu size={18} /></button>{topbarMenuOpen && <div className="topbar-menu" role="menu"><button role="menuitem" onClick={() => { setSidebar(true); setTopbarMenuOpen(false) }}><LayoutDashboard size={15} />我的画布</button><i /><button role="menuitem" onClick={() => { void createCanvas(); setTopbarMenuOpen(false) }}><Plus size={15} />新建画布</button><button role="menuitem" className="danger" disabled={!current} onClick={() => { if (current) void deleteCanvas(current.id); setTopbarMenuOpen(false) }}><Trash2 size={15} />删除当前画布</button><i /><button role="menuitem" disabled={!current} onClick={() => { chooseDraft(); setTopbarMenuOpen(false) }}><Upload size={15} />导入草稿</button><button role="menuitem" disabled={!current} onClick={() => { downloadDraft(); setTopbarMenuOpen(false) }}><Download size={15} />导出当前画布</button><i /><button role="menuitem" disabled={!undoStack.current.length} onClick={() => { undo(); setTopbarMenuOpen(false) }}><Undo2 size={15} />撤销<span>Ctrl Z</span></button><button role="menuitem" disabled={!redoStack.current.length} onClick={() => { redo(); setTopbarMenuOpen(false) }}><Redo2 size={15} />重做<span>Ctrl Shift Z</span></button></div>}</div>
          {current ? canvasTitleEditing
            ? <input className="canvas-name canvas-name-input" autoFocus maxLength={80} value={canvasTitleDraft} onChange={(event) => setCanvasTitleDraft(event.target.value)} onBlur={finishCanvasTitleEditing} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishCanvasTitleEditing() } if (event.key === 'Escape') { event.preventDefault(); cancelCanvasTitleEditing() } }} aria-label="画布名称" />
            : <button className="canvas-name canvas-name-label" title="修改画布名称" onClick={startCanvasTitleEditing}><span>{current.name}</span><Pencil size={14} /></button>
            : <strong>我的画布</strong>}
          <span className={`save-state ${saveState}`}>{saveState === 'saving' ? '保存中' : saveState === 'dirty' ? '待保存' : saveState === 'error' ? '保存失败' : <><Check size={13} />已保存</>}</span>
        </div>
        <div className="top-actions">
          <button className={`agent-button ${assistantOpen ? 'active' : ''}`} title={assistantOpen ? '收起画布助手' : '打开画布助手'} disabled={!current} onClick={() => { setAssistantOpen((value) => !value); setCanvasPanelOpen(false); setAppearanceOpen(false) }}><Bot size={16} />Agent</button>
          <button className="api-key-button" onClick={() => setPanel('account')}><KeyRound size={16} />API 密钥</button>
          {user.role === 'admin' && <button className="icon-button" title="运营管理" aria-label="运营管理" onClick={() => setPanel('admin')}><Settings size={18} /></button>}
          <button className="icon-button import-button" title="导入草稿或图片" aria-label="导入草稿或图片" disabled={!current || blockedReason === 'session' || blockedReason === 'deleted'} onClick={chooseCanvasImport}><Upload size={18} /></button>
          <button className="icon-button" title="立即保存" aria-label="立即保存" disabled={blockedReason === 'session' || blockedReason === 'conflict' || blockedReason === 'deleted'} onClick={() => void flush()}><Save size={18} /></button>
        </div>
      </header>
      {topbarMenuOpen && <button className="topbar-menu-backdrop" aria-label="关闭画布菜单" onClick={() => setTopbarMenuOpen(false)} />}
      <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importDraft(file) }} />
      <input ref={topImportInput} className="visually-hidden" type="file" accept="application/json,.json,image/*" multiple tabIndex={-1} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) importCanvasFiles(files) }} />
      <input ref={imageImportInput} className="visually-hidden" type="file" accept="image/*" multiple tabIndex={-1} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }; if (files.length) void insertImageFiles(files, center, '导入') }} />
      {current ? <div className={`flow-wrap ${canvasPanelOpen ? 'panel-open' : ''}`} onMouseDown={(event) => { const target = event.target as HTMLElement; if (!target.closest('.react-flow__node, .canvas-context-menu, .canvas-assistant, .canvas-side-panel, .canvas-dock, .canvas-navigation, .selection-toolbar, .node-toolbar')) (document.activeElement as HTMLElement | null)?.blur() }} onClick={() => { setCanvasMenu(null); setAppearanceOpen(false) }} onContextMenu={(event) => { const target = event.target as HTMLElement; if (target.closest('.react-flow__node, .canvas-context-menu, .canvas-assistant, .canvas-side-panel, .canvas-dock, .canvas-navigation, .selection-toolbar, .node-toolbar')) return; event.preventDefault(); setCanvasMenu({ type: 'canvas', x: event.clientX, y: event.clientY, screenX: event.clientX, screenY: event.clientY }) }} onDoubleClick={(event) => { const target = event.target as HTMLElement; if (target.closest('.react-flow__node, .react-flow__minimap, .tool-rail, .canvas-dock, .canvas-navigation, .selection-toolbar, .canvas-side-panel, .canvas-assistant, .canvas-context-menu')) return; addNode('text', { x: event.clientX, y: event.clientY }) }} onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith('image/'))) event.preventDefault() }} onDrop={(event) => void dropImage(event)}>
        {canvasPanelOpen && <CanvasSidePanel open width={canvasPanelWidth} tab={canvasPanelTab} query={canvasPanelQuery} nodes={nodes} assets={assets} assetsLoading={assetsLoading} selectedNodeIds={selectedNodeIds} onTab={(tab) => { setCanvasPanelTab(tab); if (tab === 'assets') void loadAssets() }} onQuery={setCanvasPanelQuery} onFocus={focusNode} onAdd={(kind, content, title) => addNode(kind, undefined, content, title)} onInsertAsset={insertAsset} onDeleteAsset={(id) => void deleteAsset(id)} onResizeStart={startCanvasPanelResize} />}
        {assistantOpen && <CanvasAssistantPanel open messages={assistantMessages} busy={assistantBusy} contextCount={assistantContextCount} models={relayConfig.textModels} model={assistantModel} onModel={setAssistantModel} onClose={() => setAssistantOpen(false)} onSend={(content, model) => void sendAssistant(content, model)} onInsertText={(content) => addNode('text', undefined, content, '助手建议')} onCreateImage={createImageFromAssistant} onClear={clearAssistant} />}
        <ReactFlow<CanvasNode, Edge> nodes={liveNodes} edges={liveEdges} nodeTypes={canvasNodeTypes} edgeTypes={canvasEdgeTypes} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={connect} onConnectEnd={handleConnectEnd} onNodeClick={selectNode} onNodeContextMenu={openNodeMenu} onNodeMouseEnter={(_event, node) => setHoveredNodeId(node.id)} onNodeMouseLeave={() => setHoveredNodeId(null)} onNodeDragStart={startNodeDrag} onNodeDrag={dragNode} onNodeDragStop={stopNodeDrag} onInit={(instance) => { flow.current = instance; setCanvasZoom(instance.getZoom()) }} onMove={(_event, viewport) => setCanvasZoom(viewport.zoom)} fitView fitViewOptions={{ padding: 0.22, maxZoom: 1.2 }} deleteKeyCode={['Backspace', 'Delete']} minZoom={0.05} maxZoom={5} selectionKeyCode={['Control', 'Meta']} selectionMode={SelectionMode.Partial} panOnDrag={[0, 1, 2]} panActivationKeyCode="Space" multiSelectionKeyCode={['Shift', 'Control', 'Meta']} zoomOnDoubleClick={false}>
          {backgroundMode !== 'blank' && <Background variant={backgroundMode === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={backgroundMode === 'lines' ? 28 : 24} size={backgroundMode === 'lines' ? 1 : 1.2} color={backgroundGridColor} />}
          {showMiniMap && <MiniMap className="canvas-minimap" position="bottom-left" pannable zoomable nodeColor={(node) => node.data?.kind === 'ai' ? '#80cbc4' : node.data?.kind === 'note' ? '#efb64f' : node.data?.kind === 'image' ? '#70a5dc' : '#a8a29e'} />}
        </ReactFlow>
        <div className="canvas-navigation" role="toolbar" aria-label="画布导航" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button className={`minimap-toggle ${showMiniMap ? 'active' : ''}`} title={showMiniMap ? '关闭小地图' : '打开小地图'} aria-label={showMiniMap ? '关闭小地图' : '打开小地图'} onClick={toggleMiniMap}><Compass size={17} /></button>
          <button title="聚焦全部节点" aria-label="聚焦全部节点" onClick={focusCanvas}><Focus size={17} /></button>
          <input type="range" min="5" max="500" step="1" value={Math.round(canvasZoom * 100)} onInput={(event) => zoomCanvas(Number(event.currentTarget.value) / 100)} aria-label="画布缩放" title="画布缩放" />
          <output aria-live="polite">{Math.round(canvasZoom * 100)}%</output>
          <button title="快捷键" aria-label="快捷键" className={shortcutsOpen ? 'active' : ''} onClick={() => setShortcutsOpen(true)}><HelpCircle size={17} /></button>
        </div>
        {shortcutsOpen && <div className="shortcuts-backdrop" role="presentation" onMouseDown={() => setShortcutsOpen(false)}><section className="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onMouseDown={(event) => event.stopPropagation()}><header><h2 id="shortcuts-title">快捷键</h2><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setShortcutsOpen(false)}><X size={18} /></button></header><div><span><kbd>拖动画布</kbd><small>平移视图</small></span><span><kbd>滚轮</kbd><small>缩放画布</small></span><span><kbd>Ctrl / Cmd + 拖动</kbd><small>框选多个节点</small></span><span><kbd>Shift / Ctrl / Cmd + 点击</kbd><small>追加选择节点</small></span><span><kbd>Ctrl / Cmd + C / V</kbd><small>复制 / 粘贴节点</small></span><span><kbd>Delete / Backspace</kbd><small>删除选中节点</small></span><span><kbd>Ctrl / Cmd + Z</kbd><small>撤销</small></span><span><kbd>Esc</kbd><small>取消选择并关闭浮层</small></span></div></section></div>}
        {appearanceOpen && <div className="appearance-popover" role="dialog" aria-label="画布外观" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><strong>画布外观</strong><span>主题</span><div className="appearance-options two"><button className={themeMode === 'dark' ? 'active' : ''} onClick={() => setThemeMode('dark')}><Moon size={15} />深色</button><button className={themeMode === 'light' ? 'active' : ''} onClick={() => setThemeMode('light')}><Sun size={15} />浅色</button></div><span>背景</span><div className="appearance-options"><button className={backgroundMode === 'dots' ? 'active' : ''} onClick={() => { setBackgroundMode('dots'); localStorage.setItem('ink-background-mode', 'dots') }}><CircleDot size={15} />点阵</button><button className={backgroundMode === 'lines' ? 'active' : ''} onClick={() => { setBackgroundMode('lines'); localStorage.setItem('ink-background-mode', 'lines') }}><Grid2X2 size={15} />网格</button><button className={backgroundMode === 'blank' ? 'active' : ''} onClick={() => { setBackgroundMode('blank'); localStorage.setItem('ink-background-mode', 'blank') }}><Square size={15} />空白</button></div><label className="appearance-switch"><span>显示小地图</span><input type="checkbox" checked={showMiniMap} onChange={(event) => { setShowMiniMap(event.target.checked); localStorage.setItem('ink-show-minimap', String(event.target.checked)) }} /></label></div>}
        {canvasMenu && <div ref={canvasMenuRef} className="canvas-context-menu" style={{ left: canvasMenuPosition.x, top: canvasMenuPosition.y, minWidth: 'min(176px, calc(100vw - 16px))', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }} role="menu" onPointerDown={(event) => event.stopPropagation()}>{canvasMenu.type === 'node' ? <><button onClick={() => { duplicateNode(canvasMenu.nodeId); setCanvasMenu(null) }}><Copy size={15} />复制</button><button className="danger" onClick={() => { deleteNode(canvasMenu.nodeId); setCanvasMenu(null) }}><Trash2 size={15} />删除</button></> : <><button onClick={() => { addNode('text', canvasMenu); setCanvasMenu(null) }}><Text size={15} />添加文本</button><button onClick={() => { addNode('note', canvasMenu); setCanvasMenu(null) }}><StickyNote size={15} />添加便签</button><button onClick={() => { addNode('image', canvasMenu); setCanvasMenu(null) }}><Image size={15} />添加图片</button><button onClick={() => { addNode('ai', canvasMenu); setCanvasMenu(null) }}><Sparkles size={15} />添加 AI</button><button onClick={() => { addNode('group', canvasMenu); setCanvasMenu(null) }}><Group size={15} />添加框架</button><i /><button onClick={() => { undo(); setCanvasMenu(null) }} disabled={!undoStack.current.length}><Undo2 size={15} />撤销</button><button onClick={() => { redo(); setCanvasMenu(null) }} disabled={!redoStack.current.length}><Redo2 size={15} />重做</button></>}</div>}
        {selectedNodeCount >= 2 && <div className="selection-toolbar" role="toolbar" aria-label="多选排版">
          <span>{selectedNodeCount} 个节点</span>
          <button title="左对齐" onClick={() => arrangeSelection('left')}><AlignStartVertical size={17} /></button>
          <button title="水平居中" onClick={() => arrangeSelection('centerX')}><AlignCenterVertical size={17} /></button>
          <button title="右对齐" onClick={() => arrangeSelection('right')}><AlignEndVertical size={17} /></button>
          <button title="顶部对齐" onClick={() => arrangeSelection('top')}><AlignStartHorizontal size={17} /></button>
          <button title="垂直居中" onClick={() => arrangeSelection('centerY')}><AlignCenterHorizontal size={17} /></button>
          <button title="底部对齐" onClick={() => arrangeSelection('bottom')}><AlignEndHorizontal size={17} /></button>
          <i />
          <button title="水平等距分布" disabled={selectedNodeCount < 3} onClick={() => arrangeSelection('spaceX')}><AlignHorizontalSpaceBetween size={17} /></button>
          <button title="垂直等距分布" disabled={selectedNodeCount < 3} onClick={() => arrangeSelection('spaceY')}><AlignVerticalSpaceBetween size={17} /></button>
        </div>}
        <div className="canvas-dock" role="toolbar" aria-label="画布工具" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button data-tooltip="移动/选择" title="移动/选择" aria-label="移动/选择" className={!selectedNodeCount ? 'active' : ''} onClick={deselectCanvas}><Hand size={18} /></button>
          <button data-tooltip="撤销" title="撤销" aria-label="撤销" onClick={undo} disabled={!undoStack.current.length}><Undo2 size={17} /></button>
          <button data-tooltip="重做" title="重做" aria-label="重做" onClick={redo} disabled={!redoStack.current.length}><Redo2 size={17} /></button>
          <i />
          <button data-tooltip="文本" title="文本" aria-label="文本" onClick={() => addNode('text')}><Text size={18} /></button>
          <button data-tooltip="便签" title="便签" aria-label="便签" onClick={() => addNode('note')}><StickyNote size={18} /></button>
          <button data-tooltip="图片" title="图片" aria-label="图片" onClick={() => addNode('image')}><Image size={18} /></button>
          <button data-tooltip="视频" title="视频" aria-label="视频" onClick={() => addNode('video')}><Video size={18} /></button>
          <button data-tooltip="生成配置" title="生成配置" aria-label="生成配置" onClick={() => addNode('ai')}><Settings size={18} /></button>
          <button data-tooltip="创作框架" title="创作框架" aria-label="创作框架" onClick={addGroup}><Group size={18} /></button>
          <button data-tooltip="上传图片" title="上传图片" aria-label="上传图片" onClick={() => imageImportInput.current?.click()}><Upload size={18} /></button>
          <i />
          <button data-tooltip="画布外观" title="画布外观" aria-label="画布外观" className={appearanceOpen ? 'active' : ''} onClick={() => { setAppearanceOpen((value) => !value); setAssistantOpen(false) }}><Palette size={18} /></button>
          {selectedNodeCount ? <button data-tooltip="删除选中" className="danger" title="删除选中" aria-label="删除选中" onClick={deleteSelectedNodes}><Trash2 size={18} /></button> : null}
          <button data-tooltip="清空画布" className="danger" title="清空画布" aria-label="清空画布" onClick={clearCanvas}><Eraser size={18} /></button>
        </div>
      </div> : <div className="empty-state"><div><FilePlus2 size={34} /><h2>从一张空白画布开始</h2><p>把文字、图片和 AI 对话放到同一个可延展空间。</p><button className="primary" onClick={createCanvas} disabled={creatingCanvas}><Plus size={17} />新建画布</button></div></div>}
    </section>
    {panel === 'account' && <AccountDrawer user={user} refresh={refreshUser} close={() => setPanel(null)} notify={setNotice} />}
    {panel === 'admin' && <AdminDrawer close={() => setPanel(null)} notify={setNotice} />}
    {inspectedNodeId && nodes.find((node) => node.id === inspectedNodeId) && <NodeInfoDrawer node={nodes.find((node) => node.id === inspectedNodeId)!} nodes={nodes} edges={edges} close={() => setInspectedNodeId(null)} />}
    {imageToolDialog && nodes.find((node) => node.id === imageToolDialog.nodeId) && <ImageToolModal dialog={imageToolDialog} node={nodes.find((node) => node.id === imageToolDialog.nodeId)!} busy={imageToolBusy} onClose={() => { if (!imageToolBusy) setImageToolDialog(null) }} onApply={(options) => void applyImageTool(options)} />}
    {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'ok' ? <Check size={16} /> : <X size={16} />}{notice.text}</div>}
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
