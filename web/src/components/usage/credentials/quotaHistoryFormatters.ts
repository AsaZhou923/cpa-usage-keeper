import { formatCompactNumber } from '@/utils/usage'
import { MONITORING_TIME_ZONE, parseTokyoDate } from '@/utils/time'

export type QuotaHistoryTimeFormatter = (value: string) => string

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const dateTimeFormatterLimit = 16
const dateTimeOptions: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

function getDateTimeFormatter(key: string, locale: string, timeZone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatters.get(key)
  if (formatter) {
    dateTimeFormatters.delete(key)
  } else {
    formatter = new Intl.DateTimeFormat(locale, { ...dateTimeOptions, timeZone })
    if (dateTimeFormatters.size >= dateTimeFormatterLimit) {
      dateTimeFormatters.delete(dateTimeFormatters.keys().next().value!)
    }
  }
  dateTimeFormatters.set(key, formatter)
  return formatter
}

export function createQuotaHistoryDateTimeFormatter(locale?: string): QuotaHistoryTimeFormatter {
  // 语言沿用当前显示上下文，时区固定为项目时区；逐个标签只查有界实例缓存。
  const resolved = new Intl.DateTimeFormat(locale).resolvedOptions()
  const key = JSON.stringify([resolved.locale, MONITORING_TIME_ZONE])
  return (value) => {
    const date = parseTokyoDate(value)
    if (!Number.isFinite(date.getTime())) return value || '—'
    return getDateTimeFormatter(key, resolved.locale, MONITORING_TIME_ZONE).format(date)
  }
}

const summaryNumberFormatters: Partial<Record<0 | 1 | 2, Intl.NumberFormat>> = {}

function summaryNumberFormatter(maximumFractionDigits: 0 | 1 | 2): Intl.NumberFormat {
  let formatter = summaryNumberFormatters[maximumFractionDigits]
  if (!formatter) {
    // 数字一直使用浏览器默认 locale，与应用语言独立。
    formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits })
    summaryNumberFormatters[maximumFractionDigits] = formatter
  }
  return formatter
}

export function formatQuotaSummaryRequests(value: number): string {
  if (Math.abs(value) >= 1_000) return formatCompactNumber(value)
  return summaryNumberFormatter(Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2).format(value)
}

export function formatQuotaSummaryPercentage(value: number): string {
  return `${summaryNumberFormatter(2).format(value)}%`
}
