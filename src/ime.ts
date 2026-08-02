export type ImeEnterState = {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}

export const shouldSubmitImeEnter = ({ key, shiftKey, isComposing, keyCode }: ImeEnterState) => (
  key === 'Enter' && !shiftKey && !isComposing && keyCode !== 229
)
