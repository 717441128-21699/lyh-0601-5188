import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { BillStatus, NotificationType, UserRole, ApplicationStatus } from '../types/enums'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'

const router = Router()

router.post('/generate-monthly', authMiddleware, roleMiddleware('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { billMonth } = req.body

    if (!billMonth) {
      return res.json(errorResponse('请指定账单月份'))
    }

    const [year, month] = billMonth.split('-').map(Number)
    const startDate = dayjs(`${year}-${month}-01`).startOf('month').toDate()
    const endDate = dayjs(`${year}-${month}-01`).endOf('month').toDate()

    const publishedApps = await prisma.application.findMany({
      where: {
        status: {
          in: [ApplicationStatus.PUBLISHED, ApplicationStatus.ACCEPTED, ApplicationStatus.EXPIRED]
        },
        OR: [
          { startTime: { lte: endDate }, endTime: { gte: startDate } }
        ]
      },
      include: {
        adSlot: true,
        applicant: {
          select: { id: true, name: true, username: true }
        }
      }
    })

    const generatedBills: any[] = []

    for (const app of publishedApps) {
      const overlapStart = dayjs.max(dayjs(app.startTime), dayjs(startDate))
      const overlapEnd = dayjs.min(dayjs(app.endTime), dayjs(endDate))
      const days = overlapEnd.diff(overlapStart, 'day') + 1

      if (days <= 0) continue

      const dailyRate = parseFloat(app.adSlot.dailyRate.toString())
      const amount = dailyRate * days

      const existingBill = await prisma.bill.findFirst({
        where: {
          applicationId: app.id,
          billMonth
        }
      })

      if (!existingBill) {
        const bill = await prisma.bill.create({
          data: {
            code: generateCode('BL'),
            applicationId: app.id,
            billMonth,
            amount,
            status: BillStatus.UNPAID
          },
          include: {
            application: {
              include: {
        adSlot: true,
        applicant: {
          select: { id: true, name: true, username: true }
        }
      }
            }
          }
        })
        generatedBills.push(bill)

        const notificationData = {
          type: NotificationType.BILL,
          title: '新的账单',
          content: `您有新的账单：${billMonth}月，金额 ¥${amount.toFixed(2)}`,
          applicationId: app.id
        }

        await prisma.notification.create({
          data: {
            userId: app.applicantId,
            ...notificationData
          }
        })
        sendNotification(app.applicantId, notificationData)
      }
    }

    res.json(successResponse({
      count: generatedBills.length,
      bills: generatedBills
    }, `生成了 ${generatedBills.length} 条账单`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { status, billMonth, applicantId, page = 1, pageSize = 10 } = req.query as any

    const where: any = {}
    if (status) where.status = status
    if (billMonth) where.billMonth = billMonth

    if (req.user?.role === UserRole.ADVERTISER) {
      where.application = { applicantId: req.user.id }
    } else if (applicantId) {
      where.application = { applicantId }
    }

    const total = await prisma.bill.count({ where })
    const list = await prisma.bill.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      include: {
        application: {
          include: {
            adSlot: true,
            applicant: { select: { id: true, name: true, username: true } }
          }
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
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: {
        application: {
          include: {
            adSlot: true,
            applicant: { select: { id: true, name: true, username: true, phone: true } }
          }
        }
      }
    })

    if (!bill) {
      return res.json(errorResponse('账单不存在'))
    }

    res.json(successResponse(bill))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.put('/:id/pay', authMiddleware, roleMiddleware('ADVERTISER', 'ADMIN', 'FINANCE'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { application: { include: { adSlot: true } } }
    })

    if (!bill) {
      return res.json(errorResponse('账单不存在'))
    }

    if (bill.status === BillStatus.PAID) {
      return res.json(errorResponse('账单已支付'))
    }

    const updated = await prisma.bill.update({
      where: { id },
      data: {
        status: BillStatus.PAID,
        paidAt: new Date()
      }
    })

    const notificationData = {
      type: NotificationType.BILL,
      title: '账单已支付',
      content: `账单 ${bill.code} 已支付成功`,
      applicationId: bill.applicationId
    }

    await prisma.notification.create({
      data: {
        userId: bill.application.applicantId,
        ...notificationData
      }
    })
    sendNotification(bill.application.applicantId, notificationData)

    res.json(successResponse(updated, '支付成功'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/export', authMiddleware, roleMiddleware('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { billMonth, status, applicantId } = req.body

    const where: any = {}
    if (status) where.status = status
    if (billMonth) where.billMonth = billMonth
    if (applicantId) where.application = { applicantId }

    const bills = await prisma.bill.findMany({
      where,
      include: {
        application: {
          include: {
            adSlot: true,
            applicant: { select: { id: true, name: true, username: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('对账单')

    worksheet.columns = [
      { header: '账单编号', key: 'code', width: 20 },
      { header: '账单月份', key: 'billMonth', width: 12 },
      { header: '广告主', key: 'advertiser', width: 15 },
      { header: '广告位', key: 'adSlot', width: 20 },
      { header: '广告标题', key: 'adTitle', width: 25 },
      { header: '金额(元)', key: 'amount', width: 12 },
      { header: '状态', key: 'status', width: 10 },
      { header: '支付时间', key: 'paidAt', width: 20 },
      { header: '生成时间', key: 'createdAt', width: 20 }
    ]

    const statusMap: any = {
      UNPAID: '未支付',
      PAID: '已支付',
      OVERDUE: '已逾期'
    }

    for (const bill of bills) {
      worksheet.addRow({
        code: bill.code,
        billMonth: bill.billMonth,
        advertiser: bill.application.applicant.name,
        adSlot: bill.application.adSlot.name,
        adTitle: bill.application.adTitle,
        amount: parseFloat(bill.amount.toString()).toFixed(2),
        status: statusMap[bill.status] || bill.status,
        paidAt: bill.paidAt ? dayjs(bill.paidAt).format('YYYY-MM-DD HH:mm') : '',
        createdAt: dayjs(bill.createdAt).format('YYYY-MM-DD HH:mm')
      })
    }

    const totalAmount = bills.reduce((sum, bill) => sum + parseFloat(bill.amount.toString()), 0)
    worksheet.addRow({})
    worksheet.addRow({ code: '合计', amount: totalAmount.toFixed(2) })

    const filename = `对账单_${billMonth || '全部'}_${dayjs().format('YYYYMMDDHHmmss')}.xlsx`
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
