import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { WorkOrderStatus, NotificationType, UserRole, WorkOrderType, ApplicationStatus } from '../types/enums'
import dayjs from 'dayjs'

const router = Router()

const PRIORITY_DEADLINE_DAYS: Record<number, number> = {
  3: 1,
  2: 3,
  1: 7
}

const getAutoDeadline = (priority: number): Date => {
  const days = PRIORITY_DEADLINE_DAYS[priority] || 7
  return dayjs().add(days, 'day').endOf('day').toDate()
}

const notifyRoles = async (roles: string[], notifData: any) => {
  const users = await prisma.user.findMany({
    where: { role: { in: roles } },
    select: { id: true }
  })
  for (const u of users) {
    await prisma.notification.create({
      data: { userId: u.id, ...notifData }
    })
    sendNotification(u.id, notifData)
  }
}

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { type, status, adSlotId, assigneeId, overdue, upcoming, page = 1, pageSize = 10 } = req.query as any

    const where: any = {}
    if (type) where.type = type
    if (status) where.status = status
    if (adSlotId) where.adSlotId = adSlotId
    if (assigneeId) where.assigneeId = assigneeId

    if (overdue === 'true' || overdue === '1') {
      where.status = { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] }
      where.deadline = { lt: new Date() }
    } else if (upcoming === 'true' || upcoming === '1') {
      where.status = { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] }
      where.deadline = {
        gte: new Date(),
        lte: dayjs().add(3, 'day').endOf('day').toDate()
      }
    }

    if (req.user?.role === UserRole.INSPECTOR) {
      where.OR = [
        { assigneeId: req.user.id },
        { assigneeId: null }
      ]
    }

    const total = await prisma.workOrder.count({ where })
    const list = await prisma.workOrder.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      include: {
        adSlot: true,
        application: {
          select: { id: true, code: true, adTitle: true }
        },
        assignee: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    const enrichedList = list.map(wo => {
      const isOverdue = wo.status !== WorkOrderStatus.COMPLETED && wo.deadline && dayjs(wo.deadline).isBefore(dayjs())
      const isUpcoming = wo.status !== WorkOrderStatus.COMPLETED && wo.deadline && !isOverdue && dayjs(wo.deadline).isBefore(dayjs().add(3, 'day'))
      return {
        ...wo,
        isOverdue,
        isUpcoming,
        remainingDays: wo.deadline ? Math.max(dayjs(wo.deadline).diff(dayjs(), 'day'), -999) : null
      }
    })

    res.json(successResponse({
      list: enrichedList,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    }))
  } catch (error: any) {
    res.json(errorResponse('查询工单列表失败，请稍后重试'))
  }
})

router.get('/stats/summary', authMiddleware, async (req, res) => {
  try {
    const total = await prisma.workOrder.count()
    const pending = await prisma.workOrder.count({ where: { status: WorkOrderStatus.PENDING } })
    const inProgress = await prisma.workOrder.count({ where: { status: WorkOrderStatus.IN_PROGRESS } })
    const completed = await prisma.workOrder.count({ where: { status: WorkOrderStatus.COMPLETED } })

    const overdueCount = await prisma.workOrder.count({
      where: {
        status: { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] },
        deadline: { lt: new Date() }
      }
    })

    const upcomingCount = await prisma.workOrder.count({
      where: {
        status: { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] },
        deadline: {
          gte: new Date(),
          lte: dayjs().add(3, 'day').endOf('day').toDate()
        }
      }
    })

    const byType = await prisma.workOrder.groupBy({
      by: ['type'],
      _count: { type: true }
    })

    res.json(successResponse({
      total,
      pending,
      inProgress,
      completed,
      overdue: overdueCount,
      upcoming: upcomingCount,
      byType
    }))
  } catch (error: any) {
    res.json(errorResponse('工单统计失败，请稍后重试'))
  }
})

router.post('/check-overdue', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const overdueOrders = await prisma.workOrder.findMany({
      where: {
        status: { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] },
        deadline: { lt: new Date() }
      },
      include: {
        assignee: { select: { id: true, name: true } },
        adSlot: true
      }
    })

    let notified = 0
    for (const order of overdueOrders) {
      const todayStr = dayjs().format('YYYY-MM-DD')
      const existingNotif = await prisma.notification.findFirst({
        where: {
          type: NotificationType.WORK_ORDER,
          workOrderId: order.id,
          content: { contains: '已超期' },
          createdAt: { gte: dayjs().startOf('day').toDate() }
        }
      })
      if (!existingNotif) {
        const notifData = {
          type: NotificationType.WORK_ORDER,
          title: '工单超期提醒',
          content: `工单「${order.title}」已超期，请尽快处理`,
          workOrderId: order.id
        }
        await notifyRoles([UserRole.ADMIN], notifData)
        if (order.assigneeId) {
          await prisma.notification.create({
            data: { userId: order.assigneeId, ...notifData }
          })
          sendNotification(order.assigneeId, notifData)
        }
        notified++
      }
    }

    res.json(successResponse({ overdueCount: overdueOrders.length, notified }, `检查完成：${overdueOrders.length}个超期工单，发送${notified}条通知`))
  } catch (error: any) {
    res.json(errorResponse('超期检查失败，请稍后重试'))
  }
})

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: {
        adSlot: true,
        application: {
          include: {
            applicant: { select: { id: true, name: true } }
          }
        },
        assignee: { select: { id: true, name: true, username: true, phone: true } }
      }
    })

    if (!workOrder) {
      return res.json(errorResponse('工单不存在'))
    }

    const isOverdue = workOrder.status !== WorkOrderStatus.COMPLETED && workOrder.deadline && dayjs(workOrder.deadline).isBefore(dayjs())
    const isUpcoming = workOrder.status !== WorkOrderStatus.COMPLETED && workOrder.deadline && !isOverdue && dayjs(workOrder.deadline).isBefore(dayjs().add(3, 'day'))

    res.json(successResponse({
      ...workOrder,
      isOverdue,
      isUpcoming,
      remainingDays: workOrder.deadline ? Math.max(dayjs(workOrder.deadline).diff(dayjs(), 'day'), -999) : null
    }))
  } catch (error: any) {
    res.json(errorResponse('工单操作失败，请稍后重试'))
  }
})

router.post('/', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { type, title, description, adSlotId, applicationId, assigneeId, priority, deadline } = req.body

    const p = priority || 1
    const autoDeadline = deadline ? new Date(deadline) : getAutoDeadline(p)

    const workOrder = await prisma.workOrder.create({
      data: {
        code: generateCode('WO'),
        type,
        title,
        description,
        adSlotId,
        applicationId: applicationId || null,
        assigneeId: assigneeId || null,
        priority: p,
        deadline: autoDeadline,
        status: WorkOrderStatus.PENDING
      },
      include: { adSlot: true }
    })

    if (assigneeId) {
      const notificationData = {
        type: NotificationType.WORK_ORDER,
        title: '新的工单指派',
        content: `您有新的工单：${title}，处理期限：${dayjs(autoDeadline).format('YYYY-MM-DD')}`,
        workOrderId: workOrder.id
      }
      await prisma.notification.create({
        data: { userId: assigneeId, ...notificationData }
      })
      sendNotification(assigneeId, notificationData)
    }

    await notifyRoles([UserRole.ADMIN], {
      type: NotificationType.WORK_ORDER,
      title: '新工单已创建',
      content: `工单「${title}」已创建，处理期限：${dayjs(autoDeadline).format('YYYY-MM-DD')}`,
      workOrderId: workOrder.id
    })

    res.json(successResponse(workOrder, '工单创建成功'))
  } catch (error: any) {
    res.json(errorResponse('工单操作失败，请稍后重试'))
  }
})

router.put('/:id/assign', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { assigneeId } = req.body
    const id = req.params.id

    const workOrder = await prisma.workOrder.findUnique({ where: { id } })
    if (!workOrder) {
      return res.json(errorResponse('工单不存在'))
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: { assigneeId }
    })

    const notificationData = {
      type: NotificationType.WORK_ORDER,
      title: '工单指派通知',
      content: `您被指派了新的工单：${workOrder.title}`,
      workOrderId: id
    }
    await prisma.notification.create({
      data: { userId: assigneeId, ...notificationData }
    })
    sendNotification(assigneeId, notificationData)

    res.json(successResponse(updated, '指派成功'))
  } catch (error: any) {
    res.json(errorResponse('工单操作失败，请稍后重试'))
  }
})

router.put('/:id/start', authMiddleware, roleMiddleware('INSPECTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id

    const workOrder = await prisma.workOrder.findUnique({
      where: { id },
      include: { adSlot: true }
    })
    if (!workOrder) {
      return res.json(errorResponse('工单不存在'))
    }

    if (workOrder.status !== WorkOrderStatus.PENDING) {
      return res.json(errorResponse('当前状态不允许开始'))
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: { status: WorkOrderStatus.IN_PROGRESS }
    })

    await notifyRoles([UserRole.ADMIN], {
      type: NotificationType.WORK_ORDER,
      title: '工单已开始处理',
      content: `工单「${workOrder.title}」已被开始处理`,
      workOrderId: id
    })

    if (workOrder.applicationId) {
      const app = await prisma.application.findUnique({
        where: { id: workOrder.applicationId },
        select: { applicantId: true }
      })
      if (app) {
        const userNotif = {
          type: NotificationType.WORK_ORDER,
          title: '工单处理中',
          content: `广告位「${workOrder.adSlot.name}」的工单已开始处理`,
          applicationId: workOrder.applicationId
        }
        await prisma.notification.create({
          data: { userId: app.applicantId, ...userNotif }
        })
        sendNotification(app.applicantId, userNotif)
      }
    }

    res.json(successResponse(updated, '已开始处理'))
  } catch (error: any) {
    res.json(errorResponse('工单操作失败，请稍后重试'))
  }
})

router.put('/:id/complete', authMiddleware, roleMiddleware('INSPECTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { result } = req.body
    const id = req.params.id

    const workOrder = await prisma.workOrder.findUnique({
      where: { id },
      include: { adSlot: true }
    })
    if (!workOrder) {
      return res.json(errorResponse('工单不存在'))
    }

    if (workOrder.status !== WorkOrderStatus.IN_PROGRESS && workOrder.status !== WorkOrderStatus.PENDING) {
      return res.json(errorResponse('当前状态不允许完成'))
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: WorkOrderStatus.COMPLETED,
        completedAt: new Date(),
        result
      },
      include: {
        application: true,
        adSlot: true
      }
    })

    await notifyRoles([UserRole.ADMIN], {
      type: NotificationType.WORK_ORDER,
      title: '工单已完成',
      content: `工单「${workOrder.title}」已完成处理`,
      workOrderId: id
    })

    if (workOrder.applicationId) {
      const app = await prisma.application.findUnique({
        where: { id: workOrder.applicationId },
        select: { applicantId: true }
      })
      if (app) {
        const userNotif = {
          type: NotificationType.WORK_ORDER,
          title: '工单已完成',
          content: `广告位「${workOrder.adSlot.name}」的工单已完成处理`,
          applicationId: workOrder.applicationId
        }
        await prisma.notification.create({
          data: { userId: app.applicantId, ...userNotif }
        })
        sendNotification(app.applicantId, userNotif)
      }
    }

    if (updated.type === WorkOrderType.RECTIFICATION && updated.applicationId) {
      const application = await prisma.application.findUnique({
        where: { id: updated.applicationId }
      })
      if (application && application.status === ApplicationStatus.ACCEPTANCE_REJECTED) {
        await prisma.application.update({
          where: { id: updated.applicationId },
          data: { status: ApplicationStatus.PENDING_ACCEPTANCE }
        })
      }
    }

    res.json(successResponse(updated, '工单已完成'))
  } catch (error: any) {
    res.json(errorResponse('工单操作失败，请稍后重试'))
  }
})

export default router
