export const imageSizeOptions = [
  { value: 'auto', label: '自动', group: '自动', ratio: 'auto' },
  { value: '1024x1024', label: '1K 方形 1:1 · 1024x1024', group: '1K', ratio: '1:1' },
  { value: '1536x1024', label: '1K 横向 3:2 · 1536x1024', group: '1K', ratio: '3:2' },
  { value: '1024x1536', label: '1K 竖向 2:3 · 1024x1536', group: '1K', ratio: '2:3' },
  { value: '1360x1024', label: '1K 横向 4:3 · 1360x1024', group: '1K', ratio: '4:3' },
  { value: '1024x1360', label: '1K 竖向 3:4 · 1024x1360', group: '1K', ratio: '3:4' },
  { value: '1824x1024', label: '1K 横屏 16:9 · 1824x1024', group: '1K', ratio: '16:9' },
  { value: '1024x1824', label: '1K 竖屏 9:16 · 1024x1824', group: '1K', ratio: '9:16' },
  { value: '2048x2048', label: '2K 方形 1:1 · 2048x2048', group: '2K', ratio: '1:1' },
  { value: '2048x1152', label: '2K 横屏 16:9 · 2048x1152', group: '2K', ratio: '16:9' },
  { value: '1152x2048', label: '2K 竖屏 9:16 · 1152x2048', group: '2K', ratio: '9:16' },
  { value: '3840x2160', label: '4K 横屏 16:9 · 3840x2160', group: '4K', ratio: '16:9' },
  { value: '2160x3840', label: '4K 竖屏 9:16 · 2160x3840', group: '4K', ratio: '9:16' },
] as const

export type ImageSize = typeof imageSizeOptions[number]['value']

export const imageSizeValues = imageSizeOptions.map((option) => option.value) as ImageSize[]

const imageSizeSet = new Set<string>(imageSizeValues)

export function isImageSize(value: unknown): value is ImageSize {
  return typeof value === 'string' && imageSizeSet.has(value)
}
