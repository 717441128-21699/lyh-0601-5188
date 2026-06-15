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

router.get('/reconciliation', authMiddleware, roleMiddleware('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { billMonth, applicantId } = req.query as any

    const where: any = {}
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
      orderBy: [{ billMonth: 'desc' }, { createdAt: 'desc' }]
    })

    const byAdvertiser = new Map<string, any>()
    const byMonth = new Map<string, any>()
    const bySlot = new Map<string, any>()
    let totalReceivable = 0
    let totalReceived = 0
    let totalUnpaid = 0
    let totalOverdue = 0

    for (const bill of bills) {
      const amount = parseFloat(bill.amount.toString())
      const isOverdue = bill.status === BillStatus.UNPAID && dayjs().isAfter(dayjs(bill.createdAt).add(30, 'day'))

      totalReceivable += amount
      if (bill.status === BillStatus.PAID) {
        totalReceived += amount
      } else {
        totalUnpaid += amount
        if (isOverdue) totalOverdue += amount
      }

      const advId = bill.application.applicantId
      if (!byAdvertiser.has(advId)) {
        byAdvertiser.set(advId, {
          applicantId: advId,
          applicantName: bill.application.applicant.name,
          receivable: 0, received: 0, unpaid: 0, overdue: 0, billCount: 0
        })
      }
      const adv = byAdvertiser.get(advId)!
      adv.receivable += amount
      adv.received += bill.status === BillStatus.PAID ? amount : 0
      adv.unpaid += bill.status !== BillStatus.PAID ? amount : 0
      adv.overdue += isOverdue ? amount : 0
      adv.billCount++

      if (!byMonth.has(bill.billMonth)) {
        byMonth.set(bill.billMonth, {
          billMonth: bill.billMonth,
          receivable: 0, received: 0, unpaid: 0, overdue: 0, billCount: 0
        })
      }
      const m = byMonth.get(bill.billMonth)!
      m.receivable += amount
      m.received += bill.status === BillStatus.PAID ? amount : 0
      m.unpaid += bill.status !== BillStatus.PAID ? amount : 0
      m.overdue += isOverdue ? amount : 0
      m.billCount++

      const slotId = bill.application.adSlotId
      if (!bySlot.has(slotId)) {
        bySlot.set(slotId, {
          adSlotId: slotId,
          adSlotName: bill.application.adSlot.name,
          district: bill.application.adSlot.district,
          receivable: 0, received: 0, unpaid: 0, overdue: 0, billCount: 0
        })
      }
      const s = bySlot.get(slotId)!
      s.receivable += amount
      s.received += bill.status === BillStatus.PAID ? amount : 0
      s.unpaid += bill.status !== BillStatus.PAID ? amount : 0
      s.overdue += isOverdue ? amount : 0
      s.billCount++
    }

    res.json(successResponse({
      summary: {
        totalReceivable: parseFloat(totalReceivable.toFixed(2)),
        totalReceived: parseFloat(totalReceived.toFixed(2)),
        totalUnpaid: parseFloat(totalUnpaid.toFixed(2)),
        totalOverdue: parseFloat(totalOverdue.toFixed(2)),
        totalBills: bills.length
      },
      byAdvertiser: Array.from(byAdvertiser.values()),
      byMonth: Array.from(byMonth.values()).sort((a: any, b: any) => b.billMonth.localeCompare(a.billMonth)),
      bySlot: Array.from(bySlot.values())
    }))
  } catch (error: any) {
    res.json(errorResponse('对账查询失败，请稍后重试'))
  }
})

router.get('/reconciliation/:applicantId/:billMonth', authMiddleware, roleMiddleware('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { applicantId, billMonth } = req.params

    const bills = await prisma.bill.findMany({
      where: {
        billMonth,
        application: { applicantId }
      },
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

    const summary = {
      receivable: 0, received: 0, unpaid: 0, overdue: 0
    }
    for (const bill of bills) {
      const amount = parseFloat(bill.amount.toString())
      const isOverdue = bill.status === BillStatus.UNPAID && dayjs().isAfter(dayjs(bill.createdAt).add(30, 'day'))
      summary.receivable += amount
      if (bill.status === BillStatus.PAID) {
        summary.received += amount
      } else {
        summary.unpaid += amount
        if (isOverdue) summary.overdue += amount
      }
    }

    res.json(successResponse({
      applicantId,
      billMonth,
      summary: {
        receivable: parseFloat(summary.receivable.toFixed(2)),
        received: parseFloat(summary.received.toFixed(2)),
        unpaid: parseFloat(summary.unpaid.toFixed(2)),
        overdue: parseFloat(summary.overdue.toFixed(2))
      },
      bills
    }))
  } catch (error: any) {
    res.json(errorResponse('对账明细查询失败，请稍后重试'))
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

router.put('/:id/pay', authMiddleware, roleMiddleware('FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const id = req.params.id
    const { paymentMethod, transactionNo, paymentRemark } = req.body

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
      return res.json(errorResponse('该账单已支付，请勿重复登记'))
    }

    const updated = await prisma.bill.update({
      where: { id },
      data: {
        status: BillStatus.PAID,
        paidAt: new Date(),
        paymentMethod: paymentMethod || null,
        transactionNo: transactionNo || null,
        paymentRemark: paymentRemark || null
      }
    })

    const methodMap: any = {
      BANK_TRANSFER: '银行转账',
      CASH: '现金',
      ALIPAY: '支付宝',
      WECHAT: '微信支付',
      OTHER: '其他'
    }
    const methodText = methodMap[paymentMethod] || paymentMethod || '未指定'

    const applicantNotif = {
      type: NotificationType.BILL,
      title: '账单已支付',
      content: `账单 ${bill.code}（${bill.billMonth}月，¥${parseFloat(bill.amount.toString()).toFixed(2)}）已确认收款，付款方式：${methodText}`,
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
        title: '账单收款登记通知',
        content: `广告主「${bill.application.applicant.name}」的账单 ${bill.code}（¥${parseFloat(bill.amount.toString()).toFixed(2)}）已登记收款，付款方式：${methodText}${transactionNo ? `，流水号：${transactionNo}` : ''}`,
        applicationId: bill.applicationId
      }
      await prisma.notification.create({
        data: { userId: u.id, ...adminNotif }
      })
      sendNotification(u.id, adminNotif)
    }

    res.json(successResponse(updated, '收款登记成功'))
  } catch (error: any) {
    res.json(errorResponse('收款登记失败，请稍后重试'))
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
      { header: '付款方式', key: 'paymentMethod', width: 12 },
      { header: '流水号', key: 'transactionNo', width: 18 },
      { header: '收款备注', key: 'paymentRemark', width: 20 },
      { header: '支付时间', key: 'paidAt', width: 20 },
      { header: '生成时间', key: 'createdAt', width: 20 }
    ]

    const statusMap: any = {
      UNPAID: '未支付',
      PAID: '已支付',
      OVERDUE: '已逾期'
    }
    const methodMap: any = {
      BANK_TRANSFER: '银行转账',
      CASH: '现金',
      ALIPAY: '支付宝',
      WECHAT: '微信支付',
      OTHER: '其他'
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
        paymentMethod: methodMap[bill.paymentMethod!] || bill.paymentMethod || '',
        transactionNo: bill.transactionNo || '',
        paymentRemark: bill.paymentRemark || '',
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
    res.json(errorResponse('账单导出失败，请稍后重试'))
  }
})

export default router
