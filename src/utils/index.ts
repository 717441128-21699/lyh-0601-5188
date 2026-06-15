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
