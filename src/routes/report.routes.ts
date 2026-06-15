import { Router } from 'express'
import prisma from '../prisma'
import { successResponse, errorResponse } from '../utils'
import { authMiddleware, roleMiddleware } from '../middleware/auth'
import { ApplicationStatus, AdSlotStatus, InspectionStatus } from '../types/enums'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'

const router = Router()

const generateDailyReport = async (date: Date) => {
  const reportDate = dayjs(date).startOf('day')

  const totalSlots = await prisma.adSlot.count({
    where: { status: AdSlotStatus.ACTIVE }
  })

  const occupiedSlots = await prisma.application.count({
    where: {
      status: {
        in: [
          ApplicationStatus.PUBLISHED,
          ApplicationStatus.ACCEPTED,
          ApplicationStatus.DESIGN_APPROVED
        ]
      },
      startTime: { lte: reportDate.endOf('day').toDate() },
      endTime: { gte: reportDate.startOf('day').toDate() }
    }
  })

  const occupancyRate = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 10000) / 100 : 0

  const in30Days = dayjs(date).add(30, 'day').toDate()
  const expiringIn30Days = await prisma.application.count({
    where: {
      status: ApplicationStatus.PUBLISHED,
      endTime: {
        gte: reportDate.startOf('day').toDate(),
        lte: in30Days
      }
    }
  })

  const expiredToday = await prisma.application.count({
    where: {
      status: ApplicationStatus.PUBLISHED,
      endTime: {
        gte: reportDate.startOf('day').toDate(),
        lte: reportDate.endOf('day').toDate()
      }
    }
  })

  const dayStart = reportDate.startOf('day').toDate()
  const dayEnd = reportDate.endOf('day').toDate()

  const inspectionsTotal = await prisma.inspection.count({
    where: {
      scheduledDate: {
        gte: dayStart,
        lte: dayEnd
      }
    }
  })

  const inspectionsDone = await prisma.inspection.count({
    where: {
      completedDate: {
        gte: dayStart,
        lte: dayEnd
      },
      status: {
        in: [InspectionStatus.COMPLETED, InspectionStatus.FAILED]
      }
    }
  })

  const inspectionRate = inspectionsTotal > 0 ? Math.round((inspectionsDone / inspectionsTotal) * 10000) / 100 : 0

  const newApplications = await prisma.application.count({
    where: {
      createdAt: {
        gte: dayStart,
        lte: dayEnd
      }
    }
  })

  const completedOrders = await prisma.workOrder.count({
    where: {
      completedAt: {
        gte: dayStart,
        lte: dayEnd
      },
      status: 'COMPLETED'
    }
  })

  const existingReport = await prisma.dailyReport.findFirst({
    where: {
      reportDate: {
        gte: dayStart,
        lte: dayEnd
      }
    }
  })

  let report
  if (existingReport) {
    report = await prisma.dailyReport.update({
      where: { id: existingReport.id },
      data: {
        totalSlots,
        occupiedSlots,
        occupancyRate,
        expiringIn30Days,
        expiredToday,
        inspectionsTotal,
        inspectionsDone,
        inspectionRate,
        newApplications,
        completedOrders
      }
    })
  } else {
    report = await prisma.dailyReport.create({
      data: {
        reportDate: reportDate.toDate(),
        totalSlots,
        occupiedSlots,
        occupancyRate,
        expiringIn30Days,
        expiredToday,
        inspectionsTotal,
        inspectionsDone,
        inspectionRate,
        newApplications,
        completedOrders
      }
    })
  }

  return report
}

router.post('/generate-daily', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const { date } = req.body
    const reportDate = date ? new Date(date) : new Date()

    const report = await generateDailyReport(reportDate)

    res.json(successResponse(report, '报表生成成功'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/daily', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query as any
    const reportDate = date ? new Date(date) : new Date()

    const dayStart = dayjs(reportDate).startOf('day').toDate()
    const dayEnd = dayjs(reportDate).endOf('day').toDate()

    let report = await prisma.dailyReport.findFirst({
      where: {
        reportDate: {
          gte: dayStart,
          lte: dayEnd
        }
      }
    })

    if (!report) {
      report = await generateDailyReport(reportDate)
    }

    res.json(successResponse(report))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/range', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query as any

    if (!startDate || !endDate) {
      return res.json(errorResponse('请指定开始日期和结束日期'))
    }

    const start = dayjs(startDate).startOf('day').toDate()
    const end = dayjs(endDate).endOf('day').toDate()

    const reports = await prisma.dailyReport.findMany({
      where: {
        reportDate: {
          gte: start,
          lte: end
        }
      },
      orderBy: { reportDate: 'asc' }
    })

    const dates: Date[] = []
    let current = dayjs(start)
    const endDay = dayjs(end)
    
    while (current.isBefore(endDay) || current.isSame(endDay, 'day')) {
      dates.push(current.toDate())
      current = current.add(1, 'day')
    }

    const result = []
    for (const date of dates) {
      const existing = reports.find(r => 
        dayjs(r.reportDate).isSame(dayjs(date), 'day')
      )
      if (existing) {
        result.push(existing)
      } else {
        const generated = await generateDailyReport(date)
        result.push(generated)
      }
    }

    res.json(successResponse(result))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const totalSlots = await prisma.adSlot.count({ where: { status: AdSlotStatus.ACTIVE } })
    
    const now = new Date()
    const activeAds = await prisma.application.count({
      where: {
        status: ApplicationStatus.PUBLISHED,
        startTime: { lte: now },
        endTime: { gte: now }
      }
    })

    const pendingReview = await prisma.application.count({
      where: { status: ApplicationStatus.PENDING_REVIEW }
    })

    const pendingDesign = await prisma.application.count({
      where: { status: ApplicationStatus.PENDING_DESIGN }
    })

    const pendingAcceptance = await prisma.application.count({
      where: { status: ApplicationStatus.PENDING_ACCEPTANCE }
    })

    const in30Days = dayjs().add(30, 'day').toDate()
    const expiringSoon = await prisma.application.count({
      where: {
        status: ApplicationStatus.PUBLISHED,
        endTime: { gte: now, lte: in30Days }
      }
    })

    const pendingWorkOrders = await prisma.workOrder.count({
      where: { status: 'PENDING' }
    })

    const todayStart = dayjs().startOf('day').toDate()
    const todayEnd = dayjs().endOf('day').toDate()
    
    const todayInspections = await prisma.inspection.count({
      where: { scheduledDate: { gte: todayStart, lte: todayEnd } }
    })

    const todayDoneInspections = await prisma.inspection.count({
      where: {
        completedDate: { gte: todayStart, lte: todayEnd },
        status: { in: [InspectionStatus.COMPLETED, InspectionStatus.FAILED] }
      }
    })

    const unpaidBills = await prisma.bill.count({
      where: { status: 'UNPAID' }
    })

    res.json(successResponse({
      totalSlots,
      activeAds,
      occupancyRate: totalSlots > 0 ? Math.round((activeAds / totalSlots) * 10000) / 100 : 0,
      pendingReview,
      pendingDesign,
      pendingAcceptance,
      expiringSoon,
      pendingWorkOrders,
      todayInspections,
      todayDoneInspections,
      todayInspectionRate: todayInspections > 0 ? Math.round((todayDoneInspections / todayInspections) * 10000) / 100 : 0,
      unpaidBills
    }))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.get('/export', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query as any

    if (!startDate || !endDate) {
      return res.json(errorResponse('请指定开始日期和结束日期'))
    }

    const start = dayjs(startDate).startOf('day').toDate()
    const end = dayjs(endDate).endOf('day').toDate()

    const reports = await prisma.dailyReport.findMany({
      where: {
        reportDate: {
          gte: start,
          lte: end
        }
      },
      orderBy: { reportDate: 'asc' }
    })

    const dates: Date[] = []
    let current = dayjs(start)
    const endDay = dayjs(end)
    
    while (current.isBefore(endDay) || current.isSame(endDay, 'day')) {
      dates.push(current.toDate())
      current = current.add(1, 'day')
    }

    const result = []
    for (const date of dates) {
      const existing = reports.find(r => 
        dayjs(r.reportDate).isSame(dayjs(date), 'day')
      )
      if (existing) {
        result.push(existing)
      } else {
        const generated = await generateDailyReport(date)
        result.push(generated)
      }
    }

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('运营报表')

    worksheet.columns = [
      { header: '日期', key: 'reportDate', width: 15 },
      { header: '广告位总数', key: 'totalSlots', width: 12 },
      { header: '已占用数', key: 'occupiedSlots', width: 12 },
      { header: '占用率(%)', key: 'occupancyRate', width: 12 },
      { header: '30天内到期数', key: 'expiringIn30Days', width: 14 },
      { header: '今日到期数', key: 'expiredToday', width: 12 },
      { header: '巡检任务数', key: 'inspectionsTotal', width: 12 },
      { header: '已完成巡检', key: 'inspectionsDone', width: 12 },
      { header: '巡检完成率(%)', key: 'inspectionRate', width: 14 },
      { header: '新增申请数', key: 'newApplications', width: 12 },
      { header: '完成工单数', key: 'completedOrders', width: 12 }
    ]

    for (const report of result) {
      worksheet.addRow({
        reportDate: dayjs(report.reportDate).format('YYYY-MM-DD'),
        totalSlots: report.totalSlots,
        occupiedSlots: report.occupiedSlots,
        occupancyRate: report.occupancyRate,
        expiringIn30Days: report.expiringIn30Days,
        expiredToday: report.expiredToday,
        inspectionsTotal: report.inspectionsTotal,
        inspectionsDone: report.inspectionsDone,
        inspectionRate: report.inspectionRate,
        newApplications: report.newApplications,
        completedOrders: report.completedOrders
      })
    }

    const filename = `运营报表_${dayjs(startDate).format('YYYYMMDD')}_${dayjs(endDate).format('YYYYMMDD')}.xlsx`
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    await workbook.xlsx.write(res)
    res.end()
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
