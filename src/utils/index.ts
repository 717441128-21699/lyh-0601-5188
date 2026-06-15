import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
dayjs.extend(minMax)
import { v4 as uuidv4 } from 'uuid'

export const generateCode = (prefix: string): string => {
  const dateStr = dayjs().format('YYYYMMDD')
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${prefix}${dateStr}${random}`
}

export const calculateDurationDays = (start: Date, end: Date): number => {
  return dayjs(end).diff(dayjs(start), 'day') + 1
}

export const calculateFee = (dailyRate: number, days: number): number => {
  return dailyRate * days
}

export const generateUUID = (): string => {
  return uuidv4()
}

export const successResponse = (data: any, message = '操作成功') => {
  return {
    code: 0,
    message,
    data
  }
}

export const errorResponse = (message: string, code = -1) => {
  return {
    code,
    message,
    data: null
  }
}

export const isValidDate = (value: any): boolean => {
  if (value === null || value === undefined || value === '') return false
  const d = dayjs(value)
  return d.isValid()
}

export const validateDateRange = (startTime: any, endTime: any): { valid: boolean; error?: string; start?: Date; end?: Date; days?: number } => {
  if (!startTime || startTime === '') {
    return { valid: false, error: '开始时间不能为空' }
  }
  if (!endTime || endTime === '') {
    return { valid: false, error: '结束时间不能为空' }
  }
  if (!isValidDate(startTime)) {
    return { valid: false, error: '开始时间格式不正确，请使用 YYYY-MM-DD 格式' }
  }
  if (!isValidDate(endTime)) {
    return { valid: false, error: '结束时间格式不正确，请使用 YYYY-MM-DD 格式' }
  }
  const s = dayjs(startTime)
  const e = dayjs(endTime)
  if (e.isBefore(s, 'day')) {
    return { valid: false, error: '结束时间不能早于开始时间' }
  }
  const days = e.diff(s, 'day') + 1
  if (days <= 0) {
    return { valid: false, error: '投放时长无效' }
  }
  return { valid: true, start: s.toDate(), end: e.toDate(), days }
}

export const BILLABLE_STATUSES = ['ACCEPTED', 'PUBLISHED', 'EXPIRED']

export const calcMonthDays = (appStart: Date, appEnd: Date, monthStart: Date, monthEnd: Date): number => {
  const overlapStart = dayjs.max(dayjs(appStart), dayjs(monthStart))
  const overlapEnd = dayjs.min(dayjs(appEnd), dayjs(monthEnd))
  const days = overlapEnd.diff(overlapStart, 'day') + 1
  return Math.max(days, 0)
}

export const parseBillMonth = (billMonth: string): { ok: boolean; error?: string; monthStart?: Date; monthEnd?: Date; ym?: string } => {
  if (!billMonth || !/^\d{4}-\d{2}$/.test(billMonth)) {
    return { ok: false, error: '月份格式不正确，请使用 YYYY-MM 格式' }
  }
  const [year, month] = billMonth.split('-').map(Number)
  if (month < 1 || month > 12) {
    return { ok: false, error: '月份取值范围无效' }
  }
  const ms = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month')
  const me = ms.endOf('month')
  return { ok: true, monthStart: ms.toDate(), monthEnd: me.toDate(), ym: `${year}-${String(month).padStart(2, '0')}` }
}
