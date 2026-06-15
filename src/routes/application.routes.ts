import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode, calculateDurationDays, calculateFee } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { ApplicationStatus, NotificationType, UserRole } from '../types/enums'
import dayjs from 'dayjs'

const router = Router()

const ACTIVE_STATUSES = [
  ApplicationStatus.APPROVED,
  ApplicationStatus.PENDING_DESIGN,
  ApplicationStatus.DESIGN_APPROVED,
  ApplicationStatus.PENDING_ACCEPTANCE,
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.PUBLISHED
]

const checkConflict = async (adSlotId: string, startTime: Date, endTime: Date, excludeId?: string): Promise<boolean> => {
  const where: any = {
    adSlotId,
    status: { in: ACTIVE_STATUSES },
    AND: [
      { startTime: { lte: endTime } },
      { endTime: { gte: startTime } }
    ]
  }
  if (excludeId) {
    where.NOT = { id: excludeId }
  }
  const count = await prisma.application.count({ where })
  return count > 0
}

const findAlternativeSlots = async (
  originType: string,
  originDistrict: string,
  originArea: number,
  startTime: Date,
  endTime: Date
): Promise<any[]> => {
  const activeStatuses = ACTIVE_STATUSES

  const allSlots = await prisma.adSlot.findMany({
    where: { status: 'ACTIVE' },
    include: {
      applications: {
        where: {
          status: { in: activeStatuses },
          AND: [
            { startTime: { lte: endTime } },
            { endTime: { gte: startTime } }
          ]
        }
      }
    }
  })

  const available = allSlots
    .filter(slot => slot.applications.length === 0)
    .map(slot => {
      let score = 0
      if (slot.type === originType) score += 100
      if (slot.district === originDistrict) score += 80
      const areaDiff = Math.abs(slot.area - originArea)
      const areaRatio = originArea > 0 ? 1 - Math.min(areaDiff / originArea, 1) : 0
      score += Math.round(areaRatio * 60)
      return {
        id: slot.id,
        code: slot.code,
        name: slot.name,
        type: slot.type,
        area: slot.area,
        address: slot.address,
        district: slot.district,
        dailyRate: slot.dailyRate,
        width: slot.width,
        height: slot.height,
        matchScore: score,
        sameType: slot.type === originType,
        sameDistrict: slot.district === originDistrict
      }
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10)

  return available
}

router.post('/calculate-fee', authMiddleware, async (req, res) => {
  try {
    const { adSlotId, startTime, endTime } = req.body

    const slot = await prisma.adSlot.findUnique({ where: { id: adSlotId } })
    if (!slot) {
      return res.json(errorResponse('广告位不存在'))
    }

    const days = calculateDurationDays(new Date(startTime), new Date(endTime))
    if (days <= 0) {
      return res.json(errorResponse('结束时间必须晚于开始时间'))
    }

    const hasConflict = await checkConflict(adSlotId, new Date(startTime), new Date(endTime))
    const totalFee = calculateFee(parseFloat(slot.dailyRate.toString()), days)

    res.json(successResponse({
      dailyRate: slot.dailyRate,
      days,
      totalFee,
      hasConflict
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/check-conflict', authMiddleware, async (req, res) => {
  try {
    const { adSlotId, startTime, endTime } = req.body

    const slot = await prisma.adSlot.findUnique({ where: { id: adSlotId } })
    if (!slot) {
      return res.json(errorResponse('广告位不存在'))
    }

    const hasConflict = await checkConflict(adSlotId, new Date(startTime), new Date(endTime))
    
    const alternatives = hasConflict 
      ? await findAlternativeSlots(slot.type, slot.district, slot.area, new Date(startTime), new Date(endTime))
      : []

    res.json(successResponse({
      hasConflict,
      alternatives
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/alternatives', authMiddleware, async (req, res) => {
  try {
    const { type, district, minArea, startTime, endTime } = req.body

    const alternatives = await findAlternativeSlots(
      type || '',
      district || '',
      minArea || 0,
      new Date(startTime),
      new Date(endTime)
    )

    res.json(successResponse(alternatives))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { status, adSlotId, applicantId, keyword, page = 1, pageSize = 10 } = req.query as any

    const where: any = {}
    if (status) where.status = status
    if (adSlotId) where.adSlotId = adSlotId
    if (applicantId) where.applicantId = applicantId
    
    if (req.user?.role === UserRole.ADVERTISER) {
      where.applicantId = req.user.id
    }

    if (keyword) {
      where.OR = [
        { adTitle: { contains: keyword } },
        { code: { contains: keyword } }
      ]
    }

    const total = await prisma.application.count({ where })
    const list = await prisma.application.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      include: {
        adSlot: true,
        applicant: {
          select: { id: true, name: true, username: true }
        }
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
    res.json(errorResponse(error.message))
  }
})

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        adSlot: true,
        applicant: {
          select: { id: true, name: true, username: true, phone: true, email: true }
        },
        workOrders: true,
        bills: true
      }
    })

    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    res.json(successResponse(application))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/', authMiddleware, roleMiddleware('ADVERTISER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { adSlotId, adTitle, adContent, startTime, endTime } = req.body
    const applicantId = req.user?.id

    const slot = await prisma.adSlot.findUnique({ where: { id: adSlotId } })
    if (!slot) {
      return res.json(errorResponse('广告位不存在'))
    }

    const st = new Date(startTime)
    const et = new Date(endTime)
    const hasConflict = await checkConflict(adSlotId, st, et)

    if (hasConflict) {
      const alternatives = await findAlternativeSlots(slot.type, slot.district, slot.area, st, et)
      return res.json({
        code: -2,
        message: '所选时段存在冲突，已为您推荐可替代广告位',
        data: { hasConflict: true, alternatives }
      })
    }

    const days = calculateDurationDays(st, et)
    const totalFee = calculateFee(parseFloat(slot.dailyRate.toString()), days)

    const application = await prisma.application.create({
      data: {
        code: generateCode('AP'),
        applicantId: applicantId!,
        adSlotId,
        adTitle,
        adContent,
        startTime: st,
        endTime: et,
        durationDays: days,
        totalFee,
        status: ApplicationStatus.PENDING_REVIEW
      },
      include: {
        adSlot: true,
        applicant: { select: { id: true, name: true, username: true } }
      }
    })

    const admins = await prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true }
    })

    const notificationData = {
      type: NotificationType.APPLICATION_STATUS,
      title: '新的广告发布申请',
      content: `广告位「${slot.name}」有新的发布申请待审核`,
      applicationId: application.id
    }

    for (const admin of admins) {
      await prisma.notification.create({
        data: { userId: admin.id, ...notificationData }
      })
      sendNotification(admin.id, notificationData)
    }

    res.json(successResponse(application, '申请提交成功'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.put('/:id/review', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { approved, rejectReason } = req.body
    const id = req.params.id

    const application = await prisma.application.findUnique({
      where: { id },
      include: { adSlot: true }
    })
    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    if (application.status !== ApplicationStatus.PENDING_REVIEW) {
      return res.json(errorResponse('当前状态不允许审核'))
    }

    const newStatus = approved ? ApplicationStatus.PENDING_DESIGN : ApplicationStatus.REJECTED
    
    const updated = await prisma.application.update({
      where: { id },
      data: {
        status: newStatus,
        rejectReason: approved ? null : rejectReason
      },
      include: {
        adSlot: true,
        applicant: { select: { id: true, name: true } }
      }
    })

    const notificationData = {
      type: NotificationType.APPLICATION_STATUS,
      title: approved ? '申请审核通过' : '申请审核拒绝',
      content: approved 
        ? `广告位「${updated.adSlot.name}」申请已通过，请上传设计图`
        : `广告位「${updated.adSlot.name}」申请被拒绝：${rejectReason}`,
      applicationId: id
    }

    await prisma.notification.create({
      data: { userId: application.applicantId, ...notificationData }
    })
    sendNotification(application.applicantId, notificationData)

    res.json(successResponse(updated, approved ? '审核通过' : '已拒绝'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.put('/:id/cancel', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id

    const application = await prisma.application.findUnique({
      where: { id },
      include: { adSlot: true }
    })
    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    if (req.user?.role === UserRole.ADVERTISER && application.applicantId !== req.user.id) {
      return res.json(errorResponse('无权限操作'))
    }

    if (![ApplicationStatus.PENDING_REVIEW, ApplicationStatus.PENDING_DESIGN, ApplicationStatus.DESIGN_REJECTED].includes(application.status)) {
      return res.json(errorResponse('当前状态不允许取消'))
    }

    const updated = await prisma.application.update({
      where: { id },
      data: { status: ApplicationStatus.CANCELLED }
    })

    const admins = await prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true }
    })

    const cancelNotif = {
      type: NotificationType.APPLICATION_STATUS,
      title: '申请已取消',
      content: `广告位「${application.adSlot.name}」的申请「${application.adTitle}」已取消`,
      applicationId: id
    }

    for (const admin of admins) {
      await prisma.notification.create({
        data: { userId: admin.id, ...cancelNotif }
      })
      sendNotification(admin.id, cancelNotif)
    }

    if (req.user?.role === UserRole.ADVERTISER) {
      await prisma.notification.create({
        data: { userId: application.applicantId, ...cancelNotif }
      })
      sendNotification(application.applicantId, cancelNotif)
    }

    res.json(successResponse(updated, '已取消申请'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
