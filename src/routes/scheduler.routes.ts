import { Router } from 'express'
import { successResponse, errorResponse } from '../utils'
import { authMiddleware, roleMiddleware } from '../middleware/auth'
import {
  runExpirationCheck,
  runOverdueProcessing,
  runMonthlyBillGeneration,
  runDailyReportGeneration,
  runAutoInspectionGeneration
} from '../services/scheduler.service'

const router = Router()

router.post('/check-expiring', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const result = await runExpirationCheck()
    res.json(successResponse(result, `到期检查完成：检查${result.checked}个，发送${result.notified}条提醒`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/process-overdue', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const result = await runOverdueProcessing()
    res.json(successResponse(result, `逾期处理完成：处理${result.processed}个，生成${result.demolitionOrders}个拆除工单`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/generate-monthly-bills', authMiddleware, roleMiddleware('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const result = await runMonthlyBillGeneration()
    res.json(successResponse(result, `月账单生成完成：生成${result.generated}条`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/generate-daily-report', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const result = await runDailyReportGeneration()
    res.json(successResponse(result, '日报表生成完成'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/generate-inspections', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const result = await runAutoInspectionGeneration()
    res.json(successResponse(result, `巡检任务生成完成：生成${result.generated}条`))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

router.post('/run-all', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
  try {
    const results: any = {}

    results.expirationCheck = await runExpirationCheck()
    results.overdueProcessing = await runOverdueProcessing()
    results.monthlyBills = await runMonthlyBillGeneration()
    results.dailyReport = await runDailyReportGeneration()
    results.inspections = await runAutoInspectionGeneration()

    res.json(successResponse(results, '所有定时任务执行完成'))
  } catch (error: any) {
    res.json(errorResponse(error.message))
  }
})

export default router
