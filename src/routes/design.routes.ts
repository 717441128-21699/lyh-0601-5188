import { Router } from 'express'
import prisma from '../prisma'
import upload from '../middleware/upload'
import { successResponse, errorResponse } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { ApplicationStatus, NotificationType, UserRole } from '../types/enums'

const router = Router()

const checkDesignCompliance = (imagePath: string, adTitle: string): { compliant: boolean; reasons: string[] } => {
  const reasons: string[] = []
  const seed = imagePath.length + adTitle.length

  if (seed % 3 === 0) {
    reasons.push('设计图分辨率不足，建议不低于1920x1080')
  }
  if (seed % 5 === 0) {
    reasons.push('广告内容涉及敏感词汇，请修改后重新提交')
  }
  if (seed % 7 === 0) {
    reasons.push('设计图尺寸与广告位规格不匹配，请调整')
  }

  return {
    compliant: reasons.length === 0,
    reasons
  }
}

router.post('/upload/:applicationId', authMiddleware, upload.single('design'), async (req: AuthRequest, res) => {
  try {
    const { applicationId } = req.params

    if (!req.file) {
      return res.json(errorResponse('请上传设计图文件'))
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

    if (req.user?.role === UserRole.ADVERTISER && application.applicantId !== req.user.id) {
      return res.json(errorResponse('无权限操作'))
    }

    if (![ApplicationStatus.PENDING_DESIGN, ApplicationStatus.DESIGN_REJECTED].includes(application.status)) {
      return res.json(errorResponse('当前状态不允许上传设计图'))
    }

    const imageUrl = `/uploads/${req.file.filename}`

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        designImage: imageUrl,
        designReviewMsg: null,
        status: ApplicationStatus.PENDING_DESIGN
      }
    })

    const complianceResult = checkDesignCompliance(imageUrl, application.adTitle)

    let finalStatus = application.status
    let reviewMsg = ''

    if (complianceResult.compliant) {
      finalStatus = ApplicationStatus.DESIGN_APPROVED
      reviewMsg = '设计图合规性检测通过'
    } else {
      finalStatus = ApplicationStatus.DESIGN_REJECTED
      reviewMsg = complianceResult.reasons.join('；')
    }

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: finalStatus,
        designReviewMsg: reviewMsg
      },
      include: { adSlot: true }
    })

    const notificationData = {
      type: NotificationType.APPLICATION_STATUS,
      title: complianceResult.compliant ? '设计图审核通过' : '设计图审核不通过',
      content: complianceResult.compliant
        ? `广告位「${updated.adSlot.name}」的设计图审核通过，可以安排验收`
        : `广告位「${updated.adSlot.name}」的设计图审核不通过：${reviewMsg}`,
      applicationId
    }

    await prisma.notification.create({
      data: {
        userId: application.applicantId,
        ...notificationData
      }
    })
    sendNotification(application.applicantId, notificationData)

    if (complianceResult.compliant) {
      const admins = await prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true }
      })

      for (const admin of admins) {
        await prisma.notification.create({
          data: {
            userId: admin.id,
            title: '设计图待安排验收',
            content: `广告位「${updated.adSlot.name}」设计图已通过，待安排现场验收`,
            type: NotificationType.APPLICATION_STATUS,
            applicationId
          }
        })
        sendNotification(admin.id, {
          title: '设计图待安排验收',
          content: `广告位「${updated.adSlot.name}」设计图已通过，待安排现场验收`,
          type: NotificationType.APPLICATION_STATUS,
          applicationId
        })
      }
    }

    res.json(successResponse({
      application: updated,
      compliance: complianceResult
    }, complianceResult.compliant ? '设计图审核通过' : '设计图审核不通过'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/recheck/:applicationId', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { applicationId } = req.params
    const { approved, reviewMsg } = req.body

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { adSlot: true }
    })

    if (!application) {
      return res.json(errorResponse('申请不存在'))
    }

    if (application.status !== ApplicationStatus.PENDING_DESIGN) {
      return res.json(errorResponse('当前状态不允许审核'))
    }

    if (!application.designImage) {
      return res.json(errorResponse('尚未上传设计图'))
    }

    const newStatus = approved ? ApplicationStatus.DESIGN_APPROVED : ApplicationStatus.DESIGN_REJECTED

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: newStatus,
        designReviewMsg: approved ? '人工审核通过' : reviewMsg
      }
    })

    const notificationData = {
      type: NotificationType.APPLICATION_STATUS,
      title: approved ? '设计图审核通过' : '设计图审核不通过',
      content: approved
        ? `广告位「${application.adSlot.name}」的设计图审核通过`
        : `广告位「${application.adSlot.name}」的设计图审核不通过：${reviewMsg}`,
      applicationId
    }

    await prisma.notification.create({
      data: {
        userId: application.applicantId,
        ...notificationData
      }
    })
    sendNotification(application.applicantId, notificationData)

    res.json(successResponse(updated, approved ? '审核通过' : '已拒绝'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
