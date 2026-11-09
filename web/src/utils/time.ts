export const MONITORING_TIME_ZONE = 'Asia/Tokyo'

type DateTimeInput = Date | number | string

export const parseTokyoDate = (value: DateTimeInput): Date => {
  if (value instanceof Date) return value
  // Legacy timestamps without an offset describe the project clock, not the browser clock.
  const normalized = typeof value === 'string'
    ? value.trim().replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/, '$1T$2+09:00')
    : value
  return new Date(typeof normalized === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T00:00:00+09:00`
    : normalized)
}

const getParts = (
  value: DateTimeInput,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> | null => {
  const date = parseTokyoDate(value)
  if (Number.isNaN(date.getTime())) return null

  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      ...options,
      hourCycle: 'h23',
      timeZone: MONITORING_TIME_ZONE,
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
}

export const formatTokyoClock = (value: DateTimeInput, includeSeconds = false): string => {
  const parts = getParts(value, {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  })
  if (!parts) return ''
  return includeSeconds
    ? `${parts.hour}:${parts.minute}:${parts.second}`
    : `${parts.hour}:${parts.minute}`
}

export const formatTokyoMonthDayTime = (value: DateTimeInput): string => {
  const parts = getParts(value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  if (!parts) return ''
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

export const formatTokyoDateTime = (value: DateTimeInput): string => {
  const parts = getParts(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  if (!parts) return ''
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}
