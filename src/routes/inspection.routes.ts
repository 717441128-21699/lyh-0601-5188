import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { InspectionStatus, WorkOrderType, WorkOrderStatus, NotificationType, UserRole } from '../types/enums'
import dayjs from 'dayjs'

const router = Router()

const notifyWorkOrder = async (workOrder: any, slotName: string) => {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true }
  })
  const inspectors = await prisma.user.findMany({
    where: { role: UserRole.INSPECTOR },
    select: { id: true }
  })
  const targets = [...admins, ...inspectors]
  const seen = new Set<string>()
  for (const t of targets) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    const notifData = {
      type: NotificationType.WORK_ORDER,
      title: '新的工单',
      content: `广告位「${slotName}」已生成工单：${workOrder.title}`,
      workOrderId: workOrder.id
    }
    await prisma.notification.create({
      data: { userId: t.id, ...notifData }
    })
    sendNotification(t.id, notifData)
  }
}

router.post('/generate', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { district, scheduledDate, inspectorIds } = req.body

    const where: any = { status: 'ACTIVE' }
    if (district) where.district = district

    const slots = await prisma.adSlot.findMany({ where })

    if (slots.length === 0) {
      return res.json(errorResponse('没有找到符合条件的广告位'))
    }

    let inspectors: string[] = []
    if (inspectorIds && inspectorIds.length > 0) {
      inspectors = inspectorIds
    } else {
      const inspectorUsers = await prisma.user.findMany({
        where: { role: UserRole.INSPECTOR },
        select: { id: true }
      })
      inspectors = inspectorUsers.map(u => u.id)
    }

    if (inspectors.length === 0) {
      return res.json(errorResponse('没有可用的巡检员'))
    }

    const scheduled = new Date(scheduledDate || dayjs().add(1, 'day').format('YYYY-MM-DD'))
    const inspections: any[] = []

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const inspectorIndex = i % inspectors.length

      const inspection = await prisma.inspection.create({
        data: {
          code: generateCode('IN'),
          adSlotId: slot.id,
          inspectorId: inspectors[inspectorIndex],
          scheduledDate: scheduled,
          status: InspectionStatus.PENDING
        },
        include: {
          adSlot: true,
          inspector: { select: { id: true, name: true } }
        }
      })
      inspections.push(inspection)

      const notificationData = {
        type: NotificationType.INSPECTION,
        title: '新的巡检任务',
        content: `您有新的巡检任务：${slot.name}，请按时完成`,
      }
      await prisma.notification.create({
        data: { userId: inspectors[inspectorIndex], ...notificationData }
      })
      sendNotification(inspectors[inspectorIndex], notificationData)
    }

    res.json(successResponse({
      count: inspections.length,
      inspections
    }, `成功生成 ${inspections.length} 条巡检任务`))
  } catch (error: any) {
    res.json(errorResponse('巡检操作失败，请稍后重试'))
  }
})

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { status, district, inspectorId, startDate, endDate, page = 1, pageSize = 10 } = req.query as any

    const where: any = {}
    if (status) where.status = status
    if (inspectorId) where.inspectorId = inspectorId
    
    if (req.user?.role === UserRole.INSPECTOR) {
      where.inspectorId = req.user.id
    }

    if (startDate || endDate) {
      where.scheduledDate = {}
      if (startDate) where.scheduledDate.gte = new Date(startDate)
      if (endDate) where.scheduledDate.lte = new Date(endDate)
    }

    if (district) {
      where.adSlot = { district }
    }

    const total = await prisma.inspection.count({ where })
    const list = await prisma.inspection.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      include: {
        adSlot: true,
        inspector: { select: { id: true, name: true, username: true } }
      },
      orderBy: { scheduledDate: 'desc' }
    })

    res.json(successResponse({
      list,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    }))
  } catch (error: any) {
    res.json(errorResponse('查询巡检列表失败，请稍后重试'))
  }
})

router.get('/stats/summary', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { startDate, endDate } = req.query as any
    const where: any = {}

    if (startDate || endDate) {
      where.scheduledDate = {}
      if (startDate) where.scheduledDate.gte = new Date(startDate)
      if (endDate) where.scheduledDate.lte = new Date(endDate)
    }

    const total = await prisma.inspection.count({ where })
    const completed = await prisma.inspection.count({
      where: { ...where, status: InspectionStatus.COMPLETED }
    })
    const failed = await prisma.inspection.count({
      where: { ...where, status: InspectionStatus.FAILED }
    })
    const pending = await prisma.inspection.count({
      where: { ...where, status: InspectionStatus.PENDING }
    })

    res.json(successResponse({
      total,
      completed,
      failed,
      pending,
      completionRate: total > 0 ? Math.round(((completed + failed) / total) * 10000) / 100 : 0
    }))
  } catch (error: any) {
    res.json(errorResponse('巡检统计失败，请稍后重试'))
  }
})

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const inspection = await prisma.inspection.findUnique({
      where: { id: req.params.id },
      include: {
        adSlot: true,
        inspector: { select: { id: true, name: true, username: true, phone: true } }
      }
    })

    if (!inspection) {
      return res.json(errorResponse('巡检记录不存在'))
    }

    res.json(successResponse(inspection))
  } catch (error: any) {
    res.json(errorResponse('巡检操作失败，请稍后重试'))
  }
})

router.put('/:id/complete', authMiddleware, roleMiddleware('INSPECTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { hasDamage, hasExpired, photos, remark } = req.body
    const id = req.params.id
    const damage = hasDamage || false
    const expired = hasExpired || false

    const inspection = await prisma.inspection.findUnique({
      where: { id },
      include: { adSlot: true, inspector: { select: { id: true, name: true } } }
    })

    if (!inspection) {
      return res.json(errorResponse('巡检记录不存在'))
    }

    if (inspection.status !== InspectionStatus.PENDING) {
      return res.json(errorResponse('当前状态不允许提交'))
    }

    if (req.user?.role === UserRole.INSPECTOR && inspection.inspectorId !== req.user.id) {
      return res.json(errorResponse('无权限操作此巡检任务'))
    }

    const updated = await prisma.inspection.update({
      where: { id },
      data: {
        status: damage || expired ? InspectionStatus.FAILED : InspectionStatus.COMPLETED,
        hasDamage: damage,
        hasExpired: expired,
        photos,
        remark,
        completedDate: new Date()
      },
      include: { adSlot: true }
    })

    if (damage || expired) {
      const issues: string[] = []
      let priority = 1
      let orderType = WorkOrderType.MAINTENANCE

      if (damage && expired) {
        issues.push('广告位破损')
        issues.push('广告已过期')
        priority = 3
        orderType = WorkOrderType.MAINTENANCE
      } else if (damage) {
        issues.push('广告位破损')
        priority = 2
        orderType = WorkOrderType.MAINTENANCE
      } else if (expired) {
        issues.push('广告已过期需处理')
        priority = 2
        orderType = WorkOrderType.MAINTENANCE
      }

      const issueSummary = issues.join('；')
      const descriptionParts = [
        `巡检发现问题：${issueSummary}`,
        remark ? `备注：${remark}` : '',
        `优先级：P${priority}（${priority === 3 ? '紧急' : priority === 2 ? '高' : '普通'}）`
      ].filter(Boolean).join('\n')

      const workOrder = await prisma.workOrder.create({
        data: {
          code: generateCode('WO'),
          type: orderType,
          title: `${damage && expired ? '维修+过期处置' : damage ? '维修' : '过期处置'} - ${inspection.adSlot.name}`,
          description: descriptionParts,
          adSlotId: inspection.adSlotId,
          status: WorkOrderStatus.PENDING,
          priority
        }
      })

      await notifyWorkOrder(workOrder, inspection.adSlot.name)
    }

    const inspectorNotif = {
      type: NotificationType.INSPECTION,
      title: '巡检提交成功',
      content: `广告位「${inspection.adSlot.name}」巡检已提交，${damage || expired ? '已生成工单' : '状态正常'}`,
    }
    await prisma.notification.create({
      data: { userId: inspection.inspectorId, ...inspectorNotif }
    })
    sendNotification(inspection.inspectorId, inspectorNotif)

    res.json(successResponse(updated, '巡检已完成'))
  } catch (error: any) {
    res.json(errorResponse('巡检操作失败，请稍后重试'))
  }
})

export default router
