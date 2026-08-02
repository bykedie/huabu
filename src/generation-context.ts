export type GenerationContextNode = {
  id: string
  data: {
    kind: 'note' | 'text' | 'ai' | 'image' | 'video' | 'group'
    title?: string
    content?: string
    prompt?: string
    imageUrl?: string
  }
}

export type GenerationContextEdge = {
  id?: string
  source: string
  target: string
  data?: { relation?: 'context' | 'result' } | null
}

export type GenerationTextInput = { id: string; title: string; text: string }
export type GenerationImageInput = { id: string; title: string; imageUrl: string }

export function buildGenerationContext(
  targetId: string,
  prompt: string,
  nodes: GenerationContextNode[],
  edges: GenerationContextEdge[],
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const incomingByTarget = new Map<string, GenerationContextEdge[]>()
  for (const edge of edges) {
    const relation = edge.data?.relation
    if (relation === 'result') continue

    let source = edge.source
    let target = edge.target
    const sourceKind = nodesById.get(source)?.data.kind
    const targetKind = nodesById.get(target)?.data.kind
    const isManualContext = relation === 'context' || (!relation && edge.id?.startsWith('xy-edge__'))
    if (isManualContext && sourceKind === 'ai' && targetKind !== 'ai') {
      source = edge.target
      target = edge.source
    }

    const incoming = incomingByTarget.get(target) || []
    incoming.push({ ...edge, source, target })
    incomingByTarget.set(target, incoming)
  }

  const textInputs: GenerationTextInput[] = []
  const referenceImages: GenerationImageInput[] = []
  const visited = new Set<string>([targetId])
  const collect = (nodeId: string) => {
    for (const edge of incomingByTarget.get(nodeId) || []) {
      if (visited.has(edge.source)) continue
      visited.add(edge.source)
      const node = nodesById.get(edge.source)
      if (!node) continue

      collect(node.id)
      if (node.data.kind === 'image' && node.data.imageUrl && referenceImages.length < 4) {
        referenceImages.push({
          id: node.id,
          title: node.data.title || `图片${referenceImages.length + 1}`,
          imageUrl: node.data.imageUrl,
        })
        continue
      }
      if (node.data.kind !== 'text' && node.data.kind !== 'note') continue
      const text = node.data.content?.trim() || node.data.prompt?.trim()
      if (text) textInputs.push({ id: node.id, title: node.data.title || '未命名文本', text })
    }
  }

  collect(targetId)
  return {
    prompt: [prompt.trim(), ...textInputs.map((input) => input.text)].filter(Boolean).join('\n\n'),
    textInputs,
    referenceImages,
  }
}
