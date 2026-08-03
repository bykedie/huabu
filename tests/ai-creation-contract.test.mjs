import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildGenerationContext } from '../src/generation-context.ts'
import { classifyCanvasImportFiles } from '../src/canvas-import.ts'
import { imageSizeOptions, imageSizeValues, isImageSize } from '../src/image-sizes.ts'
import { shouldSubmitImeEnter } from '../src/ime.ts'

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

test('manual AI connections work in either drag direction while result edges stay excluded', () => {
  const nodes = [
    { id: 'target', data: { kind: 'ai', prompt: 'Create from references' } },
    { id: 'legacy-reverse', data: { kind: 'image', title: 'Legacy reverse', imageUrl: 'data:image/png;base64,LEGACY' } },
    { id: 'explicit-reverse', data: { kind: 'image', title: 'Explicit reverse', imageUrl: 'data:image/png;base64,EXPLICIT' } },
    { id: 'generated-result', data: { kind: 'image', title: 'Generated result', imageUrl: 'data:image/png;base64,RESULT' } },
    { id: 'brief', data: { kind: 'note', title: 'Brief', content: 'Keep the red accent' } },
  ]
  const edges = [
    { id: 'xy-edge__target-legacy-reverse', source: 'target', target: 'legacy-reverse' },
    { id: 'manual-reverse', source: 'target', target: 'explicit-reverse', data: { relation: 'context' } },
    { id: 'generated-edge', source: 'generated-result', target: 'target', data: { relation: 'result' } },
    { id: 'legacy-incoming', source: 'brief', target: 'target' },
  ]

  const context = buildGenerationContext('target', 'User prompt', nodes, edges)

  assert.equal(context.prompt, 'User prompt\n\nKeep the red accent')
  assert.deepEqual(context.referenceImages.map((item) => item.id), ['legacy-reverse', 'explicit-reverse'])
  assert.equal(context.referenceImages.some((item) => item.id === 'generated-result'), false)
})

test('manual context and generated-result edge roles are created and persisted separately', () => {
  const connectStart = appSource.indexOf('const connect = useCallback')
  const changeNodesStart = appSource.indexOf('const changeNodes = useCallback', connectStart)
  const connectSource = appSource.slice(connectStart, changeNodesStart)
  const appendStart = appSource.indexOf('const appendResultNode = useCallback')
  const duplicateStart = appSource.indexOf('const duplicateNode = useCallback', appendStart)
  const appendSource = appSource.slice(appendStart, duplicateStart)

  assert.match(connectSource, /addEdge\(\{[^}]*data:\s*\{\s*relation:\s*'context'\s*\}/s)
  assert.match(appendSource, /relation:\s*'context'\s*\|\s*'result'/)
  assert.match(appendSource, /data:\s*\{\s*relation\s*\}/)
  assert.match(appSource, /appendResultNode\(id,\s*\{\s*kind:\s*'ai'[\s\S]*?\},\s*'context'\)/)
  assert.match(appSource, /edgeRelationData\(edge\)[\s\S]*?relation/)
  assert.match(appSource, /normalizeCanvasEdges\(result\.canvas\.document\.edges\)/)
})

test('testing a newly entered relay key saves it only after verification and refreshes configured state', () => {
  const testStart = appSource.indexOf('async function testRelayKey')
  const clearStart = appSource.indexOf('async function clearRelayKey', testStart)
  const source = appSource.slice(testStart, clearStart)
  const verifyCall = source.indexOf('/me/${kind}-key/test')
  const saveCall = source.indexOf('/me/${kind}-key`', verifyCall + 1)
  const refreshCall = source.indexOf('await refresh()')

  assert.notEqual(testStart, -1)
  assert.match(source, /if \(apiKey\) \{[\s\S]*method:\s*'PUT'/)
  assert.ok(verifyCall >= 0 && saveCall > verifyCall && refreshCall > saveCall)
  assert.match(source, /apiKey \? `\$\{label\} API 密钥测试成功并已安全保存` : `\$\{label\} API 密钥测试成功`/)
  assert.match(appSource, /relayKeyValues\[kind\]\.trim\(\) \? \(configured \? '测试并替换' : '测试并保存'\) : '测试已保存密钥'/)
})

test('AI creation reports a missing administrator model instead of becoming a dead button', () => {
  assert.match(appSource, /disabled=\{data\.busy \|\| !promptValue\.trim\(\)\}/)
  assert.match(appSource, /if \(!model\) \{ data\.onMissingModel\?\.\(mode\); return \}/)
  assert.match(appSource, /const notifyMissingModel = useCallback[\s\S]*?管理员尚未开放\$\{label\}模型/)
  assert.match(appSource, /onMissingModel:\s*notifyMissingModel/)
})

test('text image and video generation all submit typed image references', () => {
  const textStart = appSource.indexOf('const runAI = useCallback')
  const imageStart = appSource.indexOf('const runImage = useCallback', textStart)
  const videoStart = appSource.indexOf('const runVideo = useCallback', imageStart)
  const deleteEdgeStart = appSource.indexOf('const deleteEdge = useCallback', videoStart)
  const textSource = appSource.slice(textStart, imageStart)
  const imageSource = appSource.slice(imageStart, videoStart)
  const videoSource = appSource.slice(videoStart, deleteEdgeStart)

  for (const source of [textSource, imageSource, videoSource]) {
    assert.match(source, /context\.referenceImages/)
    assert.match(source, /referenceImageDataUrl/)
    assert.match(source, /body:\s*JSON\.stringify\(\{[\s\S]*?references/)
  }
  for (const source of [imageSource, videoSource]) {
    assert.match(source, /context\.referenceImages/)
    assert.match(source, /body:\s*JSON\.stringify\(\{[^}]*prompt:\s*context\.prompt[^}]*references/s)
  }
})

test('image generation exposes common ratios and resolutions through one validated preset list', () => {
  assert.deepEqual(imageSizeValues, [
    'auto',
    '1024x1024', '1536x1024', '1024x1536', '1360x1024', '1024x1360', '1824x1024', '1024x1824',
    '2048x2048', '2048x1152', '1152x2048',
    '3840x2160', '2160x3840',
  ])
  assert.equal(new Set(imageSizeValues).size, imageSizeValues.length)
  assert.equal(imageSizeOptions.some((option) => option.group === '1K' && option.ratio === '16:9'), true)
  assert.equal(imageSizeOptions.some((option) => option.group === '2K' && option.ratio === '1:1'), true)
  assert.equal(imageSizeOptions.some((option) => option.group === '4K' && option.ratio === '9:16'), true)
  for (const value of imageSizeValues) assert.equal(isImageSize(value), true, value)
  for (const value of ['1024', '1024*1024', '99999x1', '']) assert.equal(isImageSize(value), false, value)

  assert.match(appSource, /imageSizeOptions\.map\(\(option\) => <option key=\{option\.value\} value=\{option\.value\}>\{option\.label\}<\/option>\)/)
  assert.match(appSource, /if \(data\.imageSize !== undefined && !isImageSize\(data\.imageSize\)\) return null/)
})

test('image generation overlaps canvas persistence with reference preparation and avoids forced PNG base64 edits', () => {
  const imageStart = appSource.indexOf('const runImage = useCallback')
  const videoStart = appSource.indexOf('const runVideo = useCallback', imageStart)
  const imageSource = appSource.slice(imageStart, videoStart)
  const serverSource = readFileSync(join(root, 'server', 'app.js'), 'utf8')
  const editStart = serverSource.indexOf('if (referenceImages.length)')
  const generationStart = serverSource.indexOf('} else {', editStart)
  const editSource = serverSource.slice(editStart, generationStart)

  assert.match(imageSource, /Promise\.all\(\[\s*flushRef\.current\(\),\s*Promise\.all\(context\.referenceImages\.map\(\(item\) => referenceImageDataUrl\(item\.imageUrl\)\)\),?\s*\]\)/s)
  assert.doesNotMatch(editSource, /response_format|output_format|b64_json|png/)
  assert.match(serverSource, /const imageTimeout = numberSetting\('AI_IMAGE_TIMEOUT_MS', 300000/)
  assert.match(serverSource, /setTimeout\(\(\) => controller\.abort\(\), Math\.min\(imageTimeout, 60000\)\)/)
  assert.match(serverSource, /setTimeout\(\(\) => controller\.abort\(\), imageTimeout\)/)
})

test('AI text mode keeps connected image count and reference previews visible', () => {
  const contextStart = appSource.indexOf('<div className="ai-input-chips nodrag">')
  const settingsStart = appSource.indexOf('<div className="ai-settings-section nodrag">', contextStart)
  const contextSource = appSource.slice(contextStart, settingsStart)

  assert.notEqual(contextStart, -1)
  assert.match(contextSource, /imageCount/)
  assert.match(contextSource, /referenceImages\?\.length/)
  assert.doesNotMatch(contextSource, /mode !== 'text'/)
  assert.match(appSource, /referenceImages:\s*generationContext\s*\?\s*generationContext\.referenceImages\s*:\s*undefined/)
})

test('assistant composition keeps DOM-owned input and ignores IME Enter submission', () => {
  const panelStart = appSource.indexOf('function CanvasAssistantPanel')
  const modalStart = appSource.indexOf('function ImageToolModal', panelStart)
  const source = appSource.slice(panelStart, modalStart)

  assert.match(source, /onCompositionStart/)
  assert.match(source, /onCompositionEnd/)
  assert.match(source, /ref=\{composerRef\}/)
  assert.match(source, /defaultValue=""/)
  assert.match(source, /onInput=\{\(event\) => \{ if \(!composingRef\.current\) setValue\(event\.currentTarget\.value\) \}\}/)
  assert.doesNotMatch(source, /value=\{value\} onChange=/)
  assert.match(source, /composerRef\.current\?\.value/)
  assert.match(source, /composerRef\.current\.value = ''/)
  assert.match(source, /nativeEvent\.isComposing/)
  assert.match(source, /shouldSubmitImeEnter/)
  assert.equal(shouldSubmitImeEnter({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 }), false)
  assert.equal(shouldSubmitImeEnter({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 }), false)
  assert.equal(shouldSubmitImeEnter({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }), false)
  assert.equal(shouldSubmitImeEnter({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }), true)
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

test('AI creation card has a compact drag header and stable context settings action hierarchy', () => {
  assert.match(appSource, /className="node-drag-handle ai-node-header"[^>]*>[\s\S]*?<GripHorizontal[^>]*>[\s\S]*?data\.title \|\| 'AI 创作'[\s\S]*?<div className="generation-mode nodrag"/)
  assert.match(appSource, /<div className="ai-body">[\s\S]*?className="ai-input-chips nodrag"[\s\S]*?className="ai-context-section nodrag"[\s\S]*?className="ai-settings-section nodrag"[\s\S]*?className="node-actions ai-node-actions"/)
  assert.match(appSource, /contextSummary:\s*generationContext\s*\?\s*\{\s*textCount:\s*generationContext\.textInputs\.length,\s*imageCount:\s*generationContext\.referenceImages\.length\s*\}/s)
  assert.match(appSource, /const minimumSize = nodeMinimumSize\(data\.kind\)[\s\S]*?<NodeResizer[^>]*minWidth=\{minimumSize\.width\} minHeight=\{minimumSize\.height\}/)
  assert.match(appSource, /const nodeMinimumSize = \(kind: CanvasData\['kind'\]\) => kind === 'ai' \? \{ width: 300, height: 190 \} : \{ width: 220, height: 120 \}/)
  assert.match(appSource, /width: Math\.max\(minimum\.width, node\.width \|\| fallback\.width\), height: Math\.max\(minimum\.height, node\.height \|\| fallback\.height\)/)
  assert.match(appSource, /const loadedNodes = result\.canvas\.document\.nodes\.map\(withNodeSize\)[\s\S]*?const loadedEdges = normalizeCanvasEdges\(result\.canvas\.document\.edges\)[\s\S]*?setNodes\(loadedNodes\)[\s\S]*?resetHistory\(loadedNodes, loadedEdges\)/)
  assert.match(nodeStyles, /\.canvas-node\.kind-ai \.ai-node-header\s*\{[^}]*min-height:\s*4[0-9]px;[^}]*cursor:\s*grab;/s)
  assert.match(nodeStyles, /\.ai-input-chips\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s)
  assert.match(nodeStyles, /\.canvas-node\.kind-ai \.ai-node-actions\s*\{[^}]*margin-top:\s*auto;[^}]*flex:\s*0 0 auto;/s)
})

test('image toolbar stays anchored to its node and clamps inside the active canvas', () => {
  const combinedStyles = `${styles}\n${nodeStyles}`

  assert.match(appSource, /<NodeToolbar[^>]*className=\{`node-toolbar[^>]*position=\{Position\.Top\}/s)
  assert.match(appSource, /const syncNodeToolbarPlacement = useCallback/)
  assert.match(appSource, /closest<HTMLElement>\('\.react-flow__renderer'\)/)
  assert.match(appSource, /getBoundingClientRect\(\)[\s\S]*viewportShiftX[\s\S]*viewportShiftY/)
  assert.match(appSource, /const belowShift = nodeRect \? nodeRect\.bottom \+ 12 - baseTop : 0[\s\S]*preferredShiftY[\s\S]*clampShift\(baseTop, baseBottom, viewportTop, viewportBottom, preferredShiftY\)/)
  assert.match(appSource, /const bottomControls = \['\.canvas-dock', '\.canvas-navigation'\][\s\S]*querySelector<HTMLElement>\(selector\)\?\.getBoundingClientRect\(\)[\s\S]*baseRight > rect\.left && baseLeft < rect\.right[\s\S]*rect\.top - 8/)
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

test('left and right connection handles are always-visible polished circles in both themes', () => {
  assert.match(nodeStyles, /\.canvas-node \.react-flow__handle\s*\{[^}]*width:\s*1[3-5]px;[^}]*height:\s*1[3-5]px;[^}]*border-radius:\s*50%;[^}]*opacity:\s*1;/s)
  assert.match(nodeStyles, /\.canvas-node \.react-flow__handle-left\s*\{[^}]*background:/s)
  assert.match(nodeStyles, /\.canvas-node \.react-flow__handle-right\s*\{[^}]*background:/s)
  assert.match(nodeStyles, /\.canvas-node \.react-flow__handle(?:\.connectingfrom|\.connectingto|\.valid)[\s\S]*box-shadow:/s)
  assert.match(nodeStyles, /\.workspace\.theme-dark \.canvas-node \.react-flow__handle\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*opacity:\s*1;/s)
  assert.match(nodeStyles, /\.workspace\.theme-dark \.canvas-node \.react-flow__handle-left[\s\S]*\.workspace\.theme-dark \.canvas-node \.react-flow__handle-right/s)
})

test('empty image nodes use the concise reference upload toolbar', () => {
  assert.match(appSource, /const emptyImage = data\.kind === 'image' && !imageReady/)
  assert.match(appSource, /className=\{`node-toolbar \${imageReady \? 'image-node-toolbar' : emptyImage \? 'empty-image-toolbar' : ''}/)
  assert.match(appSource, /emptyImage && <>[\s\S]*?<button[^>]*节点信息[\s\S]*?<button className="danger"[^>]*删除节点[\s\S]*?<label className="node-toolbar-upload" title="上传图片"/s)
  assert.match(appSource, /<span>空图片节点<\/span>/)
  assert.match(nodeStyles, /\.node-toolbar\.empty-image-toolbar\s*\{[^}]*width:\s*max-content;[^}]*border-radius:\s*1[6-9]px;/s)
})

test('AI nodes use a compact reference configuration surface', () => {
  const aiBodyStart = appSource.indexOf('<div className="ai-body">')
  const aiBodyEnd = appSource.indexOf('      ) : (', aiBodyStart)
  const aiBodySource = appSource.slice(aiBodyStart, aiBodyEnd)

  assert.match(aiBodySource, /className="ai-input-chips nodrag"/)
  assert.match(aiBodySource, /提示词[\s\S]*?contextSummary\?\.textCount/)
  assert.match(aiBodySource, /参考图[\s\S]*?contextSummary\?\.imageCount/)
  assert.match(aiBodySource, /className=\{`ai-composer-toggle nodrag \$\{data\.composerOpen \? 'active' : ''\}`\} onClick=\{\(\) => data\.onComposerToggle\?\.\(id\)\}/)
  assert.match(aiBodySource, /className="ai-settings-section nodrag"[\s\S]*?className="node-actions ai-node-actions"/s)
  assert.doesNotMatch(aiBodySource, /ai-prompt-section/)
  assert.match(appSource, /const nodeMinimumSize = \(kind: CanvasData\['kind'\]\) => kind === 'ai' \? \{ width: 300, height: 190 \}/)
  assert.match(nodeStyles, /\.canvas-node\.kind-ai \.node-surface\s*\{[^}]*min-height:\s*190px;/s)
})

test('the canvas AI composer follows the node and reuses current generation callbacks', () => {
  assert.match(appSource, /function AIComposerPanel\(/)
  assert.match(appSource, /className="ai-composer-panel nodrag nopan nowheel"/)
  assert.match(appSource, /defaultValue=\{data\.prompt \|\| ''\}/)
  assert.match(appSource, /onCompositionStart=\{\(\) => \{ composingRef\.current = true \}\}/)
  assert.match(appSource, /onCompositionEnd=\{\(event\) => [\s\S]*?data\.onChange\?\.\(id, \{ prompt: next \}\)/s)
  assert.doesNotMatch(appSource.slice(appSource.indexOf('function AIComposerPanel'), appSource.indexOf('function CanvasNodeView')), /value=\{data\.prompt/)
  assert.match(appSource, /data\.referenceImages\?\.slice\(0, 4\)\.map/)
  assert.match(appSource, /if \(mode === 'image'\) data\.onRunImage\?\.\(id, prompt, model, imageSize\)[\s\S]*?else if \(mode === 'video'\) data\.onRunVideo\?\.\(id, prompt, model, videoSize, videoSeconds\)[\s\S]*?else data\.onRun\?\.\(id, prompt, model\)/s)
  assert.match(appSource, /<NodeToolbar className="ai-composer-toolbar" isVisible=\{data\.kind === 'ai' && Boolean\(data\.composerOpen\)\} position=\{Position\.Bottom\}/)
  assert.match(appSource, /const syncComposerPlacement = useCallback[\s\S]*?closest<HTMLElement>\('\.react-flow__renderer'\)[\s\S]*?viewportRight[\s\S]*?viewportBottom[\s\S]*?toolbar\.style\.marginLeft/s)
  assert.match(appSource, /function AIComposerPanel[\s\S]*?const bottomControls = \['\.canvas-dock', '\.canvas-navigation'\][\s\S]*?baseRight > rect\.left && baseLeft < rect\.right[\s\S]*?rect\.top - 12/)
  assert.match(appSource, /renderer\?\.addEventListener\('pointermove', schedulePlacement\)[\s\S]*?renderer\?\.addEventListener\('wheel', schedulePlacement, \{ passive: true \}\)[\s\S]*?requestAnimationFrame/s)
  assert.match(nodeStyles, /\.ai-composer-panel\s*\{[^}]*width:\s*min\(520px, calc\(100vw - 24px\)\);[^}]*min-height:\s*170px;/s)
})
