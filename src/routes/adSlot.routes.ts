import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { AdSlotType, AdSlotStatus } from '../types/enums'

const router = Router()

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { type, district, status, keyword, page = 1, pageSize = 10 } = req.query as any

    const where: any = {}
    if (type) where.type = type
    if (district) where.district = district
    if (status) where.status = status
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { code: { contains: keyword } },
        { address: { contains: keyword } }
      ]
    }

    const total = await prisma.adSlot.count({ where })
    const list = await prisma.adSlot.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      orderBy: { createdAt: 'desc' }
    })

    res.json(successResponse({
      list,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    }))
  } catch (error: any) {
    res.json(errorResponse('广告位操作失败，请稍后重试'))
  }
})

router.get('/available', authMiddleware, async (req, res) => {
  try {
    const { startTime, endTime, type, district, minArea, maxArea } = req.query as any

    const where: any = {
      status: AdSlotStatus.ACTIVE
    }
    if (type) where.type = type
    if (district) where.district = district
    if (minArea) where.area = { ...where.area, gte: parseFloat(minArea) }
    if (maxArea) where.area = { ...where.area, lte: parseFloat(maxArea) }

    const slots = await prisma.adSlot.findMany({
      where,
      include: {
        applications: {
          where: {
            status: {
              in: ['APPROVED', 'PENDING_DESIGN', 'DESIGN_APPROVED', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'PUBLISHED']
            },
            OR: [
              { startTime: { lte: new Date(endTime) }, endTime: { gte: new Date(startTime) } }
            ]
          }
        }
      },
      orderBy: { dailyRate: 'asc' }
    })

    const availableSlots = slots.filter(slot => slot.applications.length === 0)

    res.json(successResponse(availableSlots))
  } catch (error: any) {
    res.json(errorResponse('查询可用广告位失败，请稍后重试'))
  }
})

router.get('/stats/summary', authMiddleware, async (req, res) => {
  try {
    const total = await prisma.adSlot.count()
    const active = await prisma.adSlot.count({ where: { status: AdSlotStatus.ACTIVE } })
    const maintenance = await prisma.adSlot.count({ where: { status: AdSlotStatus.MAINTENANCE } })
    
    const byType = await prisma.adSlot.groupBy({
      by: ['type'],
      _count: { type: true }
    })

    const byDistrict = await prisma.adSlot.groupBy({
      by: ['district'],
      _count: { district: true }
    })

    res.json(successResponse({
      total,
      active,
      maintenance,
      byType,
      byDistrict
    }))
  } catch (error: any) {
    res.json(errorResponse('广告位统计失败，请稍后重试'))
  }
})

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const slot = await prisma.adSlot.findUnique({
      where: { id: req.params.id }
    })
    if (!slot) {
      return res.json(errorResponse('广告位不存在'))
    }
    res.json(successResponse(slot))
  } catch (error: any) {
    res.json(errorResponse('获取广告位详情失败，请稍后重试'))
  }
})

router.post('/', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { name, type, width, height, address, district, latitude, longitude, dailyRate, description } = req.body
    const area = parseFloat(width) * parseFloat(height)

    const slot = await prisma.adSlot.create({
      data: {
        code: generateCode('AD'),
        name,
        type,
        width: parseFloat(width),
        height: parseFloat(height),
        area,
        address,
        district,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        dailyRate: parseFloat(dailyRate),
        description
      }
    })

    res.json(successResponse(slot, '创建成功'))
  } catch (error: any) {
    res.json(errorResponse('创建广告位失败，请检查后重试'))
  }
})

router.put('/:id', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { name, type, width, height, address, district, latitude, longitude, dailyRate, status, description } = req.body
    
    const data: any = {}
    if (name !== undefined) data.name = name
    if (type !== undefined) data.type = type
    if (width !== undefined && height !== undefined) {
      data.width = parseFloat(width)
      data.height = parseFloat(height)
      data.area = parseFloat(width) * parseFloat(height)
    }
    if (address !== undefined) data.address = address
    if (district !== undefined) data.district = district
    if (latitude !== undefined) data.latitude = parseFloat(latitude)
    if (longitude !== undefined) data.longitude = parseFloat(longitude)
    if (dailyRate !== undefined) data.dailyRate = parseFloat(dailyRate)
    if (status !== undefined) data.status = status
    if (description !== undefined) data.description = description

    const slot = await prisma.adSlot.update({
      where: { id: req.params.id },
      data
    })

    res.json(successResponse(slot, '更新成功'))
  } catch (error: any) {
    res.json(errorResponse('更新广告位失败，请检查后重试'))
  }
})

router.delete('/:id', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    await prisma.adSlot.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, '删除成功'))
  } catch (error: any) {
    res.json(errorResponse('删除广告位失败，请稍后重试'))
  }
})

export default router
