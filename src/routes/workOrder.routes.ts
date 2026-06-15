import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { WorkOrderStatus, NotificationType, UserRole, WorkOrderType, ApplicationStatus } from '../types/enums'

const router = Router()

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
    const { type, status, adSlotId, assigneeId, page = 1, pageSize = 10 } = req.query as any

    const where: any = {}
    if (type) where.type = type
    if (status) where.status = status
    if (adSlotId) where.adSlotId = adSlotId
    if (assigneeId) where.assigneeId = assigneeId

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

    res.json(successResponse({
      list,
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

    const byType = await prisma.workOrder.groupBy({
      by: ['type'],
      _count: { type: true }
    })

    res.json(successResponse({
      total,
      pending,
      inProgress,
      completed,
      byType
    }))
  } catch (error: any) {
    res.json(errorResponse('工单统计失败，请稍后重试'))
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

    res.json(successResponse(workOrder))
  } catch (error: any) {
    res.json(errorResponse('工单操作失败，请稍后重试'))
  }
})

router.post('/', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { type, title, description, adSlotId, applicationId, assigneeId, priority, deadline } = req.body

    const workOrder = await prisma.workOrder.create({
      data: {
        code: generateCode('WO'),
        type,
        title,
        description,
        adSlotId,
        applicationId: applicationId || null,
        assigneeId: assigneeId || null,
        priority: priority || 1,
        deadline: deadline ? new Date(deadline) : null,
        status: WorkOrderStatus.PENDING
      },
      include: { adSlot: true }
    })

    if (assigneeId) {
      const notificationData = {
        type: NotificationType.WORK_ORDER,
        title: '新的工单指派',
        content: `您有新的工单：${title}`,
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
      content: `工单「${title}」已创建`,
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
