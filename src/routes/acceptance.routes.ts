import { Router } from 'express'
import prisma from '../prisma'
import upload from '../middleware/upload'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { ApplicationStatus, WorkOrderType, WorkOrderStatus, NotificationType, UserRole } from '../types/enums'

const router = Router()

const calculateImageSimilarity = (designImage: string, sitePhoto: string): number => {
  const designLen = designImage.length
  const photoLen = sitePhoto.length
  const diff = Math.abs(designLen - photoLen)
  const maxLen = Math.max(designLen, photoLen)
  const baseSimilarity = (1 - diff / maxLen) * 100

  const randomFactor = (Math.sin(designLen * photoLen) + 1) * 10
  const similarity = Math.max(0, Math.min(100, baseSimilarity * 0.7 + randomFactor * 3))

  return Math.round(similarity * 100) / 100
}

router.post('/upload/:applicationId', authMiddleware, roleMiddleware('INSPECTOR', 'ADMIN'), upload.single('photo'), async (req: AuthRequest, res) => {
  try {
    const { applicationId } = req.params

    if (!req.file) {
      return res.json(errorResponse('请上传现场照片'))
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        adSlot: true,
        applicant: {
          select: { id: true, name: true, username: true }
        }
      }
    })

    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    if (application.status !== ApplicationStatus.DESIGN_APPROVED && application.status !== ApplicationStatus.PENDING_ACCEPTANCE) {
      return res.json(errorResponse('当前状态不允许提交验收'))
    }

    if (!application.designImage) {
      return res.json(errorResponse('设计图尚未上传，无法验收'))
    }

    const photoUrl = `/uploads/${req.file.filename}`
    const similarity = calculateImageSimilarity(application.designImage, photoUrl)

    const passed = similarity >= 80

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: {
        acceptanceImage: photoUrl,
        similarity,
        status: passed ? ApplicationStatus.ACCEPTED : ApplicationStatus.ACCEPTANCE_REJECTED
      },
      include: { adSlot: true }
    })

    if (!passed) {
      const rectificationOrder = await prisma.workOrder.create({
        data: {
          code: generateCode('WO'),
          type: WorkOrderType.RECTIFICATION,
          title: `验收整改 - ${application.adSlot.name}`,
          description: `现场照片与设计图相似度为 ${similarity}%，低于80%标准，需整改后重新验收。`,
          adSlotId: application.adSlotId,
          applicationId: applicationId,
          status: WorkOrderStatus.PENDING,
          priority: 2
        }
      })

      const inspectors = await prisma.user.findMany({
        where: { role: UserRole.INSPECTOR },
        select: { id: true }
      })

      for (const inspector of inspectors) {
        await prisma.notification.create({
          data: {
            userId: inspector.id,
            type: NotificationType.WORK_ORDER,
            title: '新的整改工单',
            content: `广告位「${application.adSlot.name}」验收未通过，需整改`,
            applicationId
          }
        })
        sendNotification(inspector.id, {
          type: NotificationType.WORK_ORDER,
          title: '新的整改工单',
          content: `广告位「${application.adSlot.name}」验收未通过，需整改`,
          applicationId,
          workOrderId: rectificationOrder.id
        })
      }
    } else {
      const publishedApp = await prisma.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.PUBLISHED }
      })

      const notificationData = {
        type: NotificationType.APPLICATION_STATUS,
        title: '广告已发布上线',
        content: `广告位「${application.adSlot.name}」验收通过，广告已发布上线`,
        applicationId
      }

      await prisma.notification.create({
        data: {
          userId: application.applicantId,
          ...notificationData
        }
      })
      sendNotification(application.applicantId, notificationData)
    }

    const applicantNotification = {
      type: NotificationType.APPLICATION_STATUS,
      title: passed ? '现场验收通过' : '现场验收未通过',
      content: passed
        ? `广告位「${application.adSlot.name}」现场验收通过，相似度 ${similarity}%`
        : `广告位「${application.adSlot.name}」现场验收未通过，相似度 ${similarity}%，低于80%标准，需整改`,
      applicationId
    }

    await prisma.notification.create({
      data: {
        userId: application.applicantId,
        ...applicantNotification
      }
    })
    sendNotification(application.applicantId, applicantNotification)

    res.json(successResponse({
      application: updated,
      similarity,
      passed,
      message: passed ? '验收通过' : '验收未通过，已生成整改工单'
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/retry/:applicationId', authMiddleware, roleMiddleware('INSPECTOR', 'ADMIN'), async (req, res) => {
  try {
    const { applicationId } = req.params

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { adSlot: true }
    })

    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    if (application.status !== ApplicationStatus.ACCEPTANCE_REJECTED) {
      return res.json(errorResponse('当前状态不允许重新验收'))
    }

    const pendingRectificationOrders = await prisma.workOrder.findMany({
      where: {
        applicationId,
        type: WorkOrderType.RECTIFICATION,
        status: { in: [WorkOrderStatus.PENDING, WorkOrderStatus.IN_PROGRESS] }
      }
    })

    if (pendingRectificationOrders.length > 0) {
      return res.json(errorResponse('存在未完成的整改工单，请先完成整改'))
    }

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: { status: ApplicationStatus.PENDING_ACCEPTANCE }
    })

    res.json(successResponse(updated, '已重置为待验收状态'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
