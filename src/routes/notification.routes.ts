import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse } from '../utils'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { isRead, type, page = 1, pageSize = 20 } = req.query as any
    const userId = req.user?.id

    const where: any = { userId }
    if (isRead !== undefined) where.isRead = isRead === 'true' || isRead === true
    if (type) where.type = type

    const total = await prisma.notification.count({ where })
    const list = await prisma.notification.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      orderBy: { createdAt: 'desc' }
    })

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    })

    res.json(successResponse({
      list,
      total,
      unreadCount,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/unread-count', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id

    const count = await prisma.notification.count({
      where: { userId, isRead: false }
    })

    res.json(successResponse({ count }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.put('/:id/read', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id
    const userId = req.user?.id

    const notification = await prisma.notification.findUnique({ where: { id } })
    if (!notification) {
      return res.json(errorResponse('通知不存在'))
    }

    if (notification.userId !== userId) {
      return res.json(errorResponse('无权限操作'))
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true }
    })

    res.json(successResponse(updated, '已标记为已读'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.put('/read-all', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    })

    res.json(successResponse(null, '全部标记为已读'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id
    const userId = req.user?.id

    const notification = await prisma.notification.findUnique({ where: { id } })
    if (!notification) {
      return res.json(errorResponse('通知不存在'))
    }

    if (notification.userId !== userId) {
      return res.json(errorResponse('无权限操作'))
    }

    await prisma.notification.delete({ where: { id } })

    res.json(successResponse(null, '删除成功'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
