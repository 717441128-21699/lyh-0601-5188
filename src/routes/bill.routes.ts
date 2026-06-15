import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse, generateCode, parseBillMonth, calcMonthDays } from '../utils'
import { authMiddleware, roleMiddleware, AuthRequest } from '../middleware/auth'
import { sendNotification } from '../services/notification.service'
import { generateMonthlyBills } from '../services/billing.service'
import { BillStatus, NotificationType, UserRole, ApplicationStatus } from '../types/enums'
import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
dayjs.extend(minMax)
import ExcelJS from 'exceljs'

const router = Router()

router.post('/generate-monthly', authMiddleware, roleMiddleware('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { billMonth } = req.body
    const parsed = parseBillMonth(billMonth)
    if (!parsed.ok) {
      return res.json(errorResponse(parsed.error!))
    }

    const result = await generateMonthlyBills(billMonth)

    res.json(successResponse({
      count: result.count,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      bills: result.bills
    }, `账单生成完成：新建${result.created}条，更新${result.updated}条，跳过${result.skipped}条`))
  } catch (error: any) {
    res.json(errorResponse('账单生成失败，请检查后重试'))
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
    res.json(errorResponse('账单操作失败，请稍后重试'))
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
    res.json(errorResponse('账单操作失败，请稍后重试'))
  }
})

router.put('/:id/pay', authMiddleware, roleMiddleware('ADVERTISER', 'ADMIN', 'FINANCE'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        application: {
          include: {
            adSlot: true,
            applicant: { select: { id: true, name: true } }
          }
        }
      }
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

    const applicantNotif = {
      type: NotificationType.BILL,
      title: '账单已支付',
      content: `账单 ${bill.code}（${bill.billMonth}月，¥${parseFloat(bill.amount.toString()).toFixed(2)}）已支付成功`,
      applicationId: bill.applicationId
    }
    await prisma.notification.create({
      data: { userId: bill.application.applicantId, ...applicantNotif }
    })
    sendNotification(bill.application.applicantId, applicantNotif)

    const adminFinanceUsers = await prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.FINANCE] } },
      select: { id: true }
    })
    for (const u of adminFinanceUsers) {
      const adminNotif = {
        type: NotificationType.BILL,
        title: '账单支付通知',
        content: `广告主「${bill.application.applicant.name}」的账单 ${bill.code}（¥${parseFloat(bill.amount.toString()).toFixed(2)}）已支付`,
        applicationId: bill.applicationId
      }
      await prisma.notification.create({
        data: { userId: u.id, ...adminNotif }
      })
      sendNotification(u.id, adminNotif)
    }

    res.json(successResponse(updated, '支付成功'))
  } catch (error: any) {
    res.json(errorResponse('账单操作失败，请稍后重试'))
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
      { header: '占用天数', key: 'occupiedDays', width: 10 },
      { header: '日费率(元)', key: 'dailyRate', width: 12 },
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
        occupiedDays: bill.occupiedDays,
        dailyRate: parseFloat(bill.application.adSlot.dailyRate.toString()).toFixed(2),
        amount: parseFloat(bill.amount.toString()).toFixed(2),
        status: statusMap[bill.status] || bill.status,
        paidAt: bill.paidAt ? dayjs(bill.paidAt).format('YYYY-MM-DD HH:mm') : '',
        createdAt: dayjs(bill.createdAt).format('YYYY-MM-DD HH:mm')
      })
    }

    const totalAmount = bills.reduce((sum, bill) => sum + parseFloat(bill.amount.toString()), 0)
    const totalDays = bills.reduce((sum, bill) => sum + bill.occupiedDays, 0)
    worksheet.addRow({})
    worksheet.addRow({ code: '合计', occupiedDays: totalDays, amount: totalAmount.toFixed(2) })

    const filename = `对账单_${billMonth || '全部'}_${dayjs().format('YYYYMMDDHHmmss')}.xlsx`
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (error: any) {
    res.json(errorResponse('账单操作失败，请稍后重试'))
  }
})

export default router
