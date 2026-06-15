import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { ApplicationStatus, WorkOrderType, WorkOrderStatus, NotificationType, UserRole } from '../types/enums'
import dayjs from 'dayjs'

const router = Router()

router.post('/check-expiring', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { days = 30 } = req.body as any

    const targetDate = dayjs().add(days, 'day').toDate()
    const today = dayjs().startOf('day').toDate()

    const expiringApplications = await prisma.application.findMany({
      where: {
        status: {
          in: [ApplicationStatus.PUBLISHED, ApplicationStatus.ACCEPTED]
        },
        endTime: {
          gte: today,
          lte: targetDate
        }
      },
      include: {
        adSlot: true,
        applicant: true
      },
      orderBy: { endTime: 'asc' }
    })

    const notifications: any[] = []

    for (const app of expiringApplications) {
      const daysLeft = dayjs(app.endTime).diff(dayjs(), 'day')

      const existingNotif = await prisma.notification.findFirst({
        where: {
          userId: app.applicantId,
          type: NotificationType.EXPIRATION_REMINDER,
          applicationId: app.id,
          createdAt: {
            gte: dayjs().startOf('day').toDate()
          }
        }
      })

      if (!existingNotif) {
        const notificationData = {
          type: NotificationType.EXPIRATION_REMINDER,
          title: '广告到期提醒',
          content: `您的广告「${app.adTitle}」（${app.adSlot.name}）将在 ${daysLeft} 天后到期，请及时续费`,
          applicationId: app.id
        }

        await prisma.notification.create({
          data: {
            userId: app.applicantId,
            ...notificationData
          }
        })
        sendNotification(app.applicantId, notificationData)
        notifications.push(notificationData)
      }
    }

    res.json(successResponse({
      count: expiringApplications.length,
      applications: expiringApplications,
      notificationsSent: notifications.length
    }, `发现 ${expiringApplications.length} 个即将到期的广告`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/renew/:applicationId', authMiddleware, roleMiddleware('ADVERTISER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { applicationId } = req.params
    const { renewDays } = req.body

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { adSlot: true }
    })

    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    if (req.user?.role === UserRole.ADVERTISER && application.applicantId !== req.user.id) {
      return res.json(errorResponse('无权限操作'))
    }

    if (application.status !== ApplicationStatus.PUBLISHED && application.status !== ApplicationStatus.EXPIRED) {
      return res.json(errorResponse('当前状态不允许续费'))
    }

    const days = parseInt(renewDays) || 30
    const newEndTime = dayjs(application.endTime).add(days, 'day').toDate()
    const fee = parseFloat(application.adSlot.dailyRate.toString()) * days

    const newApplication = await prisma.application.create({
      data: {
        code: generateCode('AP'),
        applicantId: application.applicantId,
        adSlotId: application.adSlotId,
        adTitle: application.adTitle + '(续)',
        adContent: application.adContent,
        startTime: dayjs(application.endTime).add(1, 'day').toDate(),
        endTime: newEndTime,
        durationDays: days,
        totalFee: fee,
        designImage: application.designImage,
        designReviewMsg: application.designReviewMsg,
        status: ApplicationStatus.PENDING_REVIEW
      },
      include: { adSlot: true }
    })

    const notificationData = {
      type: NotificationType.APPLICATION_STATUS,
      title: '续费申请已提交',
      content: `广告位「${application.adSlot.name}」续费申请已提交，请等待审核`,
      applicationId: newApplication.id
    }

    await prisma.notification.create({
      data: {
        userId: application.applicantId,
        ...notificationData
      }
    })
    sendNotification(application.applicantId, notificationData)

    res.json(successResponse(newApplication, '续费申请已提交'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/process-overdue', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const today = dayjs().startOf('day').toDate()

    const overdueApplications = await prisma.application.findMany({
      where: {
        status: ApplicationStatus.PUBLISHED,
        endTime: {
          lt: today
        }
      },
      include: {
        adSlot: true,
        applicant: {
          select: { id: true, name: true, username: true }
        }
      }
    })

    const results: any[] = []

    for (const app of overdueApplications) {
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
        const demolitionOrder = await prisma.workOrder.create({
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

        const inspectors = await prisma.user.findMany({
          where: { role: UserRole.INSPECTOR },
          select: { id: true }
        })

        for (const inspector of inspectors) {
          const notifData = {
            type: NotificationType.WORK_ORDER,
            title: '新的拆除任务',
            content: `广告位「${app.adSlot.name}」广告已逾期，需拆除`,
            workOrderId: demolitionOrder.id
          }
          await prisma.notification.create({
            data: {
              userId: inspector.id,
              ...notifData
            }
          })
          sendNotification(inspector.id, notifData)
        }

        results.push({
          applicationId: app.id,
          adTitle: app.adTitle,
          orderId: demolitionOrder.id
        })
      }

      const userNotif = {
        type: NotificationType.EXPIRATION_REMINDER,
        title: '广告已逾期',
        content: `您的广告「${app.adTitle}」已逾期，已生成拆除任务，请尽快处理`,
        applicationId: app.id
      }
      await prisma.notification.create({
        data: {
          userId: app.applicantId,
          ...userNotif
        }
      })
      sendNotification(app.applicantId, userNotif)
    }

    res.json(successResponse({
      count: overdueApplications.length,
      processed: results.length,
      results
    }, `处理了 ${overdueApplications.length} 个逾期广告`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/expiring/list', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { days = 30, page = 1, pageSize = 10 } = req.query as any

    const targetDate = dayjs().add(parseInt(days), 'day').toDate()
    const today = dayjs().startOf('day').toDate()

    const where: any = {
      status: {
        in: [ApplicationStatus.PUBLISHED]
      },
      endTime: {
        gte: today,
        lte: targetDate
      }
    }

    if (req.user?.role === UserRole.ADVERTISER) {
      where.applicantId = req.user.id
    }

    const total = await prisma.application.count({ where })
    const list = await prisma.application.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      include: {
        adSlot: true,
        applicant: { select: { id: true, name: true } }
      },
      orderBy: { endTime: 'asc' }
    })

    res.json(successResponse({
      list,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
