import prisma from '../prisma'
import { generateCode } from '../utils'
import { sendNotification } from './notification.service'
import {
  ApplicationStatus, WorkOrderType, WorkOrderStatus,
  NotificationType, UserRole, InspectionStatus
} from '../types/enums'
import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
dayjs.extend(minMax)
import { generateMonthlyBills } from './billing.service'

export const runExpirationCheck = async (): Promise<{ checked: number; notified: number }> => {
  const targetDate = dayjs().add(30, 'day').toDate()
  const today = dayjs().startOf('day').toDate()

  const expiring = await prisma.application.findMany({
    where: {
      status: { in: [ApplicationStatus.PUBLISHED, ApplicationStatus.ACCEPTED] },
      endTime: { gte: today, lte: targetDate }
    },
    include: {
      adSlot: true,
      applicant: { select: { id: true, name: true } }
    }
  })

  let notified = 0
  for (const app of expiring) {
    const daysLeft = dayjs(app.endTime).diff(dayjs(), 'day')
    const existing = await prisma.notification.findFirst({
      where: {
        userId: app.applicantId,
        type: NotificationType.EXPIRATION_REMINDER,
        applicationId: app.id,
        createdAt: { gte: dayjs().startOf('day').toDate() }
      }
    })
    if (!existing) {
      const notifData = {
        type: NotificationType.EXPIRATION_REMINDER,
        title: '广告到期提醒',
        content: `您的广告「${app.adTitle}」（${app.adSlot.name}）将在 ${daysLeft} 天后到期，请及时续费`,
        applicationId: app.id
      }
      await prisma.notification.create({
        data: { userId: app.applicantId, ...notifData }
      })
      sendNotification(app.applicantId, notifData)
      notified++
    }
  }

  return { checked: expiring.length, notified }
}

export const runOverdueProcessing = async (): Promise<{ processed: number; demolitionOrders: number }> => {
  const today = dayjs().startOf('day').toDate()

  const overdue = await prisma.application.findMany({
    where: {
      status: ApplicationStatus.PUBLISHED,
      endTime: { lt: today }
    },
    include: {
      adSlot: true,
      applicant: { select: { id: true, name: true } }
    }
  })

  let demolitionOrders = 0
  for (const app of overdue) {
    await prisma.application.update({
      where: { id: app.id },
      data: { status: ApplicationStatus.EXPIRED }
    })

    const existingOrder = await prisma.workOrder.findFirst({
      where: {
        applicationId: app.id,
        type: WorkOrderType.DEMOLITION,
        status: { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] }
      }
    })

    if (!existingOrder) {
      const order = await prisma.workOrder.create({
        data: {
          code: generateCode('WO'),
          type: WorkOrderType.DEMOLITION,
          title: `拆除任务 - ${app.adSlot.name}`,
          description: `广告「${app.adTitle}」已逾期，请安排拆除`,
          adSlotId: app.adSlotId,
          applicationId: app.id,
          status: WorkOrderStatus.PENDING,
          priority: 3,
          deadline: dayjs().add(7, 'day').toDate()
        }
      })
      demolitionOrders++

      const inspectors = await prisma.user.findMany({
        where: { role: UserRole.INSPECTOR },
        select: { id: true }
      })
      const admins = await prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true }
      })
      const allTargets = [...inspectors, ...admins]
      const seen = new Set<string>()
      for (const t of allTargets) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        const notifData = {
          type: NotificationType.WORK_ORDER,
          title: '新的拆除任务',
          content: `广告位「${app.adSlot.name}」广告已逾期，需拆除`,
          workOrderId: order.id
        }
        await prisma.notification.create({
          data: { userId: t.id, ...notifData }
        })
        sendNotification(t.id, notifData)
      }
    }

    const userNotif = {
      type: NotificationType.EXPIRATION_REMINDER,
      title: '广告已逾期',
      content: `您的广告「${app.adTitle}」已逾期，已生成拆除任务，请尽快处理`,
      applicationId: app.id
    }
    await prisma.notification.create({
      data: { userId: app.applicantId, ...userNotif }
    })
    sendNotification(app.applicantId, userNotif)
  }

  return { processed: overdue.length, demolitionOrders }
}

export const runMonthlyBillGeneration = async (): Promise<{ generated: number; created: number; updated: number }> => {
  const billMonth = dayjs().subtract(1, 'month').format('YYYY-MM')
  try {
    const result = await generateMonthlyBills(billMonth)
    return { generated: result.count, created: result.created, updated: result.updated }
  } catch (e) {
    return { generated: 0, created: 0, updated: 0 }
  }
}

export const runDailyReportGeneration = async (): Promise<{ generated: boolean }> => {
  const today = dayjs().startOf('day')
  const totalSlots = await prisma.adSlot.count({ where: { status: 'ACTIVE' } })

  const occupiedSlots = await prisma.application.count({
    where: {
      status: { in: [ApplicationStatus.PUBLISHED, ApplicationStatus.ACCEPTED, ApplicationStatus.DESIGN_APPROVED] },
      startTime: { lte: today.endOf('day').toDate() },
      endTime: { gte: today.startOf('day').toDate() }
    }
  })
  const occupancyRate = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 10000) / 100 : 0

  const expiringIn30Days = await prisma.application.count({
    where: {
      status: ApplicationStatus.PUBLISHED,
      endTime: { gte: today.toDate(), lte: today.add(30, 'day').toDate() }
    }
  })

  const expiredToday = await prisma.application.count({
    where: {
      status: ApplicationStatus.PUBLISHED,
      endTime: { gte: today.startOf('day').toDate(), lte: today.endOf('day').toDate() }
    }
  })

  const inspectionsTotal = await prisma.inspection.count({
    where: { scheduledDate: { gte: today.startOf('day').toDate(), lte: today.endOf('day').toDate() } }
  })
  const inspectionsDone = await prisma.inspection.count({
    where: {
      completedDate: { gte: today.startOf('day').toDate(), lte: today.endOf('day').toDate() },
      status: { in: [InspectionStatus.COMPLETED, InspectionStatus.FAILED] }
    }
  })
  const inspectionRate = inspectionsTotal > 0 ? Math.round((inspectionsDone / inspectionsTotal) * 10000) / 100 : 0

  const newApplications = await prisma.application.count({
    where: { createdAt: { gte: today.startOf('day').toDate(), lte: today.endOf('day').toDate() } }
  })

  const completedOrders = await prisma.workOrder.count({
    where: {
      completedAt: { gte: today.startOf('day').toDate(), lte: today.endOf('day').toDate() },
      status: 'COMPLETED'
    }
  })

  const existing = await prisma.dailyReport.findFirst({
    where: { reportDate: { gte: today.startOf('day').toDate(), lte: today.endOf('day').toDate() } }
  })

  if (existing) {
    await prisma.dailyReport.update({
      where: { id: existing.id },
      data: { totalSlots, occupiedSlots, occupancyRate, expiringIn30Days, expiredToday, inspectionsTotal, inspectionsDone, inspectionRate, newApplications, completedOrders }
    })
  } else {
    await prisma.dailyReport.create({
      data: { reportDate: today.toDate(), totalSlots, occupiedSlots, occupancyRate, expiringIn30Days, expiredToday, inspectionsTotal, inspectionsDone, inspectionRate, newApplications, completedOrders }
    })
  }

  return { generated: true }
}

export const runAutoInspectionGeneration = async (): Promise<{ generated: number }> => {
  const districts = await prisma.adSlot.groupBy({
    by: ['district'],
    where: { status: 'ACTIVE' },
    _count: { district: true }
  })

  const inspectors = await prisma.user.findMany({
    where: { role: UserRole.INSPECTOR },
    select: { id: true }
  })

  if (inspectors.length === 0) return { generated: 0 }

  let generated = 0
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD')

  for (const d of districts) {
    const slots = await prisma.adSlot.findMany({
      where: { status: 'ACTIVE', district: d.district }
    })

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const inspectorId = inspectors[i % inspectors.length].id

      const existing = await prisma.inspection.findFirst({
        where: {
          adSlotId: slot.id,
          scheduledDate: {
            gte: dayjs(tomorrow).startOf('day').toDate(),
            lte: dayjs(tomorrow).endOf('day').toDate()
          }
        }
      })

      if (!existing) {
        await prisma.inspection.create({
          data: {
            code: generateCode('IN'),
            adSlotId: slot.id,
            inspectorId,
            scheduledDate: new Date(tomorrow),
            status: InspectionStatus.PENDING
          }
        })

        const notifData = {
          type: NotificationType.INSPECTION,
          title: '新的巡检任务',
          content: `您有新的巡检任务：${slot.name}，请按时完成`,
        }
        await prisma.notification.create({
          data: { userId: inspectorId, ...notifData }
        })
        sendNotification(inspectorId, notifData)
        generated++
      }
    }
  }

  return { generated }
}
