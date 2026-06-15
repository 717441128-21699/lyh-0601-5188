import prisma from '../prisma'
import { generateCode, parseBillMonth, calcMonthDays, BILLABLE_STATUSES, successResponse, errorResponse } from '../utils'
import { sendNotification } from './notification.service'
import { NotificationType, BillStatus } from '../types/enums'

export interface BillGenerateResult {
  count: number
  created: number
  updated: number
  skipped: number
  bills: any[]
}

export const generateMonthlyBills = async (billMonthRaw: string): Promise<BillGenerateResult> => {
  const parsed = parseBillMonth(billMonthRaw)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  const { monthStart, monthEnd, ym } = parsed

  const billableApps = await prisma.application.findMany({
    where: {
      status: { in: BILLABLE_STATUSES },
      startTime: { lte: monthEnd! },
      endTime: { gte: monthStart! }
    },
    include: {
      adSlot: true,
      applicant: { select: { id: true, name: true, username: true } }
    }
  })

  const bills: any[] = []
  let created = 0
  let updated = 0
  let skipped = 0

  for (const app of billableApps) {
    const occupiedDays = calcMonthDays(app.startTime, app.endTime, monthStart!, monthEnd!)
    if (occupiedDays <= 0) {
      skipped++
      continue
    }

    const dailyRate = parseFloat(app.adSlot.dailyRate.toString())
    if (!isFinite(dailyRate) || dailyRate <= 0) {
      skipped++
      continue
    }
    const amount = parseFloat((dailyRate * occupiedDays).toFixed(2))
    if (!isFinite(amount) || amount <= 0) {
      skipped++
      continue
    }

    const existingBill = await prisma.bill.findFirst({
      where: { applicationId: app.id, billMonth: ym! }
    })

    if (!existingBill) {
      const bill = await prisma.bill.create({
        data: {
          code: generateCode('BL'),
          applicationId: app.id,
          billMonth: ym!,
          occupiedDays,
          amount,
          status: BillStatus.UNPAID
        },
        include: {
          application: {
            include: {
              adSlot: true,
              applicant: { select: { id: true, name: true, username: true } }
            }
          }
        }
      })
      bills.push(bill)
      created++

      const notifData = {
        type: NotificationType.BILL,
        title: '新的月度账单',
        content: `您有新的账单：${ym!}月，占用${occupiedDays}天，金额 ¥${amount.toFixed(2)}`,
        applicationId: app.id
      }
      await prisma.notification.create({
        data: { userId: app.applicantId, ...notifData }
      })
      sendNotification(app.applicantId, notifData)
    } else {
      const existingAmount = parseFloat(existingBill.amount.toString())
      if (existingBill.occupiedDays !== occupiedDays || Math.abs(existingAmount - amount) > 0.01) {
        const updatedBill = await prisma.bill.update({
          where: { id: existingBill.id },
          data: { occupiedDays, amount }
        })
        bills.push(updatedBill)
        updated++
      } else {
        bills.push(existingBill)
        skipped++
      }
    }
  }

  return { count: bills.length, created, updated, skipped, bills }
}

export { successResponse, errorResponse }
