export type CanvasImportFile = { name: string; type: string }

export type CanvasImportSelection<T extends CanvasImportFile> =
  | { kind: 'draft'; file: T }
  | { kind: 'images'; files: T[] }
  | { kind: 'invalid'; reason: 'empty' | 'mixed' | 'multiple-drafts' | 'unsupported' }

export function classifyCanvasImportFiles<T extends CanvasImportFile>(files: T[]): CanvasImportSelection<T> {
  if (!files.length) return { kind: 'invalid', reason: 'empty' }
  const drafts = files.filter((file) => file.type === 'application/json' || file.name.toLowerCase().endsWith('.json'))
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (drafts.length === 1 && files.length === 1) return { kind: 'draft', file: drafts[0] }
  if (images.length === files.length) return { kind: 'images', files: images }
  if (drafts.length > 1 && drafts.length === files.length) return { kind: 'invalid', reason: 'multiple-drafts' }
  if (drafts.length || images.length) return { kind: 'invalid', reason: 'mixed' }
  return { kind: 'invalid', reason: 'unsupported' }
}
