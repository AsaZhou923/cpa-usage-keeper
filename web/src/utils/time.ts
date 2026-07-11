export const MONITORING_TIME_ZONE = 'Asia/Tokyo'

type DateTimeInput = Date | number | string

const getParts = (
  value: DateTimeInput,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> | null => {
  const date = value instanceof Date ? value : new Date(value)
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
