/** Formats a millisecond timestamp string into a readable time. */
export const formatTimestamp = (value: string): string => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return '-'
  }
  return new Date(parsed).toLocaleTimeString()
}
