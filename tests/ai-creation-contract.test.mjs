import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildGenerationContext } from '../src/generation-context.ts'
import { classifyCanvasImportFiles } from '../src/canvas-import.ts'

const root = resolve(import.meta.dirname, '..')
const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8')
const styles = readFileSync(join(root, 'src', 'styles.css'), 'utf8')
const nodeStyles = readFileSync(join(root, 'src', 'styles', 'canvas-nodes-reference.css'), 'utf8')

test('canvas UI uses one local system font stack across native controls', () => {
  assert.match(styles, /--app-font-sans:\s*[^;]*"PingFang SC"[^;]*"Microsoft YaHei"[^;]*sans-serif;/)
  assert.match(styles, /:root\s*\{[^}]*font-family:\s*var\(--app-font-sans\);/s)
  assert.match(styles, /button,\s*input,\s*textarea,\s*select,\s*option\s*\{[^}]*font:\s*inherit;/s)
  assert.doesNotMatch(styles, /@font-face|@import\s+url|fonts\.(?:googleapis|gstatic)\.com/i)
})

test('connected generation context keeps text and image inputs typed', () => {
  const nodes = [
    { id: 'target', data: { kind: 'ai', prompt: 'target config prompt' } },
    { id: 'root-text', data: { kind: 'text', title: 'Brief', content: 'Root text context' } },
    { id: 'note', data: { kind: 'note', title: 'Note', content: 'Connected note context' } },
    { id: 'image', data: { kind: 'image', title: 'Reference', imageUrl: 'data:image/png;base64,INTERNAL_IMAGE_DATA' } },
    { id: 'video', data: { kind: 'video', content: 'Ignore video content', prompt: 'Ignore video prompt', videoUrl: 'https://internal.example/video.mp4' } },
    { id: 'other-ai', data: { kind: 'ai', prompt: 'Ignore upstream AI settings' } },
    { id: 'group', data: { kind: 'group', content: 'Ignore group content' } },
  ]
  const edges = [
    { source: 'root-text', target: 'note' },
    { source: 'image', target: 'note' },
    { source: 'note', target: 'target' },
    { source: 'video', target: 'target' },
    { source: 'other-ai', target: 'target' },
    { source: 'group', target: 'target' },
  ]

  const context = buildGenerationContext('target', 'User prompt', nodes, edges)

  assert.equal(context.prompt, 'User prompt\n\nRoot text context\n\nConnected note context')
  assert.deepEqual(context.textInputs.map((item) => item.id), ['root-text', 'note'])
  assert.deepEqual(context.referenceImages, [{ id: 'image', title: 'Reference', imageUrl: 'data:image/png;base64,INTERNAL_IMAGE_DATA' }])
  for (const hidden of ['INTERNAL_IMAGE_DATA', 'internal.example', 'Ignore video', 'Ignore upstream AI', 'Ignore group']) {
    assert.equal(context.prompt.includes(hidden), false, hidden)
  }
})

test('text generation submits text context while image and video share typed references', () => {
  const textStart = appSource.indexOf('const runAI = useCallback')
  const imageStart = appSource.indexOf('const runImage = useCallback', textStart)
  const videoStart = appSource.indexOf('const runVideo = useCallback', imageStart)
  const deleteEdgeStart = appSource.indexOf('const deleteEdge = useCallback', videoStart)
  const textSource = appSource.slice(textStart, imageStart)
  const imageSource = appSource.slice(imageStart, videoStart)
  const videoSource = appSource.slice(videoStart, deleteEdgeStart)

  assert.match(textSource, /buildGenerationContext[^;]*\.prompt/)
  assert.doesNotMatch(textSource, /referenceImages|references/)
  for (const source of [imageSource, videoSource]) {
    assert.match(source, /context\.referenceImages/)
    assert.match(source, /body:\s*JSON\.stringify\(\{[^}]*prompt:\s*context\.prompt[^}]*references/s)
  }
})

test('top import classifies one draft or an image group without mixing them', () => {
  const draft = { name: 'canvas.json', type: 'application/json' }
  const images = [{ name: 'one.png', type: 'image/png' }, { name: 'two.webp', type: 'image/webp' }]

  assert.deepEqual(classifyCanvasImportFiles([draft]), { kind: 'draft', file: draft })
  assert.deepEqual(classifyCanvasImportFiles(images), { kind: 'images', files: images })
  assert.equal(classifyCanvasImportFiles([draft, ...images]).kind, 'invalid')
  assert.equal(classifyCanvasImportFiles([draft, { ...draft, name: 'other.json' }]).kind, 'invalid')
  assert.equal(classifyCanvasImportFiles([{ name: 'notes.txt', type: 'text/plain' }]).kind, 'invalid')

  const buttonStart = appSource.indexOf('title="导入草稿或图片"')
  assert.notEqual(buttonStart, -1)
  assert.match(appSource.slice(buttonStart, buttonStart + 420), /onClick=\{chooseCanvasImport\}/)
  assert.match(appSource, /ref=\{topImportInput\}[^>]*accept="application\/json,\.json,image\/\*"[^>]*multiple[^>]*onChange=\{\(event\) => \{[^}]*importCanvasFiles\(files\)/s)
  assert.match(appSource, /selection\.kind === 'images'[\s\S]*insertImageFiles\(selection\.files, center, '导入'\)/)
})

test('image URL editing disappears only after the preview is ready', () => {
  assert.match(appSource, /const \[loadedImageUrl, setLoadedImageUrl\] = useState/)
  assert.match(appSource, /const imagePreviewReady = Boolean\(data\.imageUrl && \(data\.imageUrl\.startsWith\('data:image\/'\) \|\| loadedImageUrl === data\.imageUrl\)\)/)
  assert.match(appSource, /<img[^>]*onLoad=\{\(\) => setLoadedImageUrl\(data\.imageUrl \|\| null\)\}[^>]*onError=\{\(\) => setLoadedImageUrl\(null\)\}/s)
  assert.match(appSource, /\{!imagePreviewReady && <input className="node-input nodrag" placeholder="图片地址"/)
})

test('resized images fill the node with explicit locked and free-fit modes', () => {
  assert.match(appSource, /className=\{`image-preview \$\{data\.freeResize \? 'free-resize' : 'ratio-locked'\}`\}/)
  assert.match(nodeStyles, /\.canvas-node\.kind-image \.image-preview\s*\{[^}]*flex:\s*1;[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s)
  assert.match(nodeStyles, /\.canvas-node\.kind-image \.image-preview\.ratio-locked > img\s*\{[^}]*object-fit:\s*contain;/s)
  assert.match(nodeStyles, /\.canvas-node\.kind-image \.image-preview\.free-resize > img\s*\{[^}]*object-fit:\s*fill;/s)
})

test('text note and AI nodes expose a large drag surface outside editable controls', () => {
  assert.match(appSource, /const hasDragHandle = data\.kind === 'text' \|\| data\.kind === 'note' \|\| data\.kind === 'ai'/)
  assert.match(appSource, /data\.kind === 'ai' \? <div className="node-drag-handle ai-node-header"/)
  assert.match(appSource, /hasDragHandle && <div className="node-drag-handle"[^>]*><GripHorizontal/)
  assert.match(nodeStyles, /\.node-drag-handle\s*\{[^}]*min-height:\s*(?:3[0-9]|[4-9][0-9])px;[^}]*cursor:\s*grab;/s)
  assert.doesNotMatch(appSource, /className="node-drag-handle nodrag"/)
})

test('AI creation card has a compact drag header and stable prompt context settings action hierarchy', () => {
  assert.match(appSource, /className="node-drag-handle ai-node-header"[^>]*>[\s\S]*?<GripHorizontal[^>]*>[\s\S]*?data\.title \|\| 'AI 创作'[\s\S]*?<div className="generation-mode nodrag"/)
  assert.match(appSource, /<div className="ai-body">[\s\S]*?className="ai-prompt-section nodrag"[\s\S]*?className="ai-context-section nodrag"[\s\S]*?className="ai-settings-section nodrag"[\s\S]*?className="node-actions ai-node-actions"/)
  assert.match(appSource, /contextSummary:\s*generationContext\s*\?\s*\{\s*textCount:\s*generationContext\.textInputs\.length,\s*imageCount:\s*generationContext\.referenceImages\.length\s*\}/s)
  assert.match(appSource, /const minimumSize = nodeMinimumSize\(data\.kind\)[\s\S]*?<NodeResizer[^>]*minWidth=\{minimumSize\.width\} minHeight=\{minimumSize\.height\}/)
  assert.match(appSource, /const nodeMinimumSize = \(kind: CanvasData\['kind'\]\) => kind === 'ai' \? \{ width: 300, height: 280 \} : \{ width: 220, height: 120 \}/)
  assert.match(appSource, /width: Math\.max\(minimum\.width, node\.width \|\| fallback\.width\), height: Math\.max\(minimum\.height, node\.height \|\| fallback\.height\)/)
  assert.match(appSource, /const loadedNodes = result\.canvas\.document\.nodes\.map\(withNodeSize\)[\s\S]*?setNodes\(loadedNodes\)[\s\S]*?resetHistory\(loadedNodes, result\.canvas\.document\.edges\)/)
  assert.match(nodeStyles, /\.canvas-node\.kind-ai \.ai-node-header\s*\{[^}]*min-height:\s*4[0-9]px;[^}]*cursor:\s*grab;/s)
  assert.match(nodeStyles, /\.canvas-node\.kind-ai \.ai-prompt-section\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1;/s)
  assert.match(nodeStyles, /\.canvas-node\.kind-ai \.ai-node-actions\s*\{[^}]*margin-top:\s*auto;[^}]*flex:\s*0 0 auto;/s)
})

test('image toolbar stays anchored to its node and clamps inside the active canvas', () => {
  const combinedStyles = `${styles}\n${nodeStyles}`

  assert.match(appSource, /<NodeToolbar[^>]*className=\{`node-toolbar[^>]*position=\{Position\.Top\}/s)
  assert.match(appSource, /const syncNodeToolbarPlacement = useCallback/)
  assert.match(appSource, /closest<HTMLElement>\('\.react-flow__renderer'\)/)
  assert.match(appSource, /getBoundingClientRect\(\)[\s\S]*viewportShiftX[\s\S]*viewportShiftY/)
  assert.match(appSource, /const belowShift = nodeRect \? nodeRect\.bottom \+ 12 - baseTop : 0[\s\S]*preferredShiftY[\s\S]*clampShift\(baseTop, baseBottom, viewportTop, viewportBottom, preferredShiftY\)/)
  assert.match(appSource, /const canvasDockRect = workspace\?\.querySelector<HTMLElement>\('\.canvas-dock'\)\?\.getBoundingClientRect\(\)[\s\S]*imageToolbarSettingsOpen && canvasDockRect[\s\S]*canvasDockRect\.top - 8/)
  assert.match(appSource, /className="node-toolbar-scroll nodrag nopan nowheel"/)
  assert.match(nodeStyles, /\.node-toolbar-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s)
  assert.match(nodeStyles, /\.node-toolbar\.image-node-toolbar\s*\{[^}]*max-width:\s*calc\(100% - 16px\);/s)
  assert.match(styles, /\.image-toolbar-settings\s*\{[^}]*max-height:\s*min\(540px, calc\(100vh - 240px\)\);[^}]*overflow-y:\s*auto;/s)
  assert.doesNotMatch(combinedStyles, /\.node-toolbar(?:\.image-node-toolbar)?[^{}]*\{[^}]*position:\s*fixed/s)
})

test('dedicated drag handles and image resize controls do not compete with node tools', () => {
  assert.match(appSource, /dragHandle:\s*hasDedicatedDragHandle\s*\? '\.node-drag-handle'\s*:\s*undefined/)
  assert.match(appSource, /const hasDedicatedDragHandle = node\.data\.kind === 'text' \|\| node\.data\.kind === 'note' \|\| node\.data\.kind === 'ai'/)
  assert.match(appSource, /<img[^>]*draggable=\{false\}[^>]*onLoad=/s)
  assert.match(appSource, /<NodeResizer[^>]*keepAspectRatio=\{data\.kind === 'image' && !data\.freeResize\}[^>]*handleClassName="node-resize-handle"/)
  assert.match(appSource, /<NodeToolbar[^>]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(nodeStyles, /\.react-flow__node\.dragging \.node-drag-handle\s*\{[^}]*cursor:\s*grabbing;/s)
})
