import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { InspectionStatus, WorkOrderType, WorkOrderStatus, NotificationType, UserRole } from '../types/enums'
import dayjs from 'dayjs'

const router = Router()

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
        data: {
          userId: inspectors[inspectorIndex],
          ...notificationData
        }
      })
      sendNotification(inspectors[inspectorIndex], notificationData)
    }

    res.json(successResponse({
      count: inspections.length,
      inspections
    }, `成功生成 ${inspections.length} 条巡检任务`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
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
    res.json(errorResponse(error.message))
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
    res.json(errorResponse(error.message))
  }
})

router.put('/:id/complete', authMiddleware, roleMiddleware('INSPECTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { hasDamage, hasExpired, photos, remark } = req.body
    const id = req.params.id

    const inspection = await prisma.inspection.findUnique({
      where: { id },
      include: { adSlot: true }
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
        status: hasDamage || hasExpired ? InspectionStatus.FAILED : InspectionStatus.COMPLETED,
        hasDamage: hasDamage || false,
        hasExpired: hasExpired || false,
        photos,
        remark,
        completedDate: new Date()
      },
      include: { adSlot: true }
    })

    if (hasDamage) {
      const workOrder = await prisma.workOrder.create({
        data: {
          code: generateCode('WO'),
          type: WorkOrderType.MAINTENANCE,
          title: `维修工单 - ${inspection.adSlot.name}`,
          description: `巡检发现广告位破损：${remark || '需要维修'}`,
          adSlotId: inspection.adSlotId,
          status: WorkOrderStatus.PENDING,
          priority: hasExpired ? 3 : 2
        }
      })

      const admins = await prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true }
      })

      for (const admin of admins) {
        const notifData = {
          type: NotificationType.WORK_ORDER,
          title: '新的维修工单',
          content: `广告位「${inspection.adSlot.name}」巡检发现破损，已生成维修工单`,
          workOrderId: workOrder.id
        }
        await prisma.notification.create({
          data: {
            userId: admin.id,
            ...notifData
          }
        })
        sendNotification(admin.id, notifData)
      }
    }

    res.json(successResponse(updated, '巡检已完成'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
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
      completionRate: total > 0 ? Math.round(((completed + failed) / total) * 100) / 100 : 0
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
