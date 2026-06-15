import dotenv from 'dotenv'
dotenv.config()

import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
dayjs.extend(minMax)

import express from 'express'
import cors from 'cors'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { initWebSocket } from './services/notification.service'
import {
  runExpirationCheck,
  runOverdueProcessing,
  runMonthlyBillGeneration,
  runDailyReportGeneration,
  runAutoInspectionGeneration,
  runWorkOrderOverdueCheck
} from './services/scheduler.service'

import authRoutes from './routes/auth.routes'
import adSlotRoutes from './routes/adSlot.routes'
import applicationRoutes from './routes/application.routes'
import designRoutes from './routes/design.routes'
import acceptanceRoutes from './routes/acceptance.routes'
import inspectionRoutes from './routes/inspection.routes'
import workOrderRoutes from './routes/workOrder.routes'
import billRoutes from './routes/bill.routes'
import reportRoutes from './routes/report.routes'
import notificationRoutes from './routes/notification.routes'
import expirationRoutes from './routes/expiration.routes'
import schedulerRoutes from './routes/scheduler.routes'

const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 3000

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(uploadDir))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '智慧城市户外广告设施管理系统 API 运行正常' })
})

app.use('/api/auth', authRoutes)
app.use('/api/ad-slots', adSlotRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/designs', designRoutes)
app.use('/api/acceptance', acceptanceRoutes)
app.use('/api/inspections', inspectionRoutes)
app.use('/api/work-orders', workOrderRoutes)
app.use('/api/bills', billRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/expiration', expirationRoutes)
app.use('/api/scheduler', schedulerRoutes)

initWebSocket(server)

const startScheduledTasks = () => {
  console.log('启动定时任务服务...')

  const runStartupTasks = async () => {
    try {
      console.log('[定时任务] 执行启动初始化任务...')
      await runDailyReportGeneration()
      await runExpirationCheck()
      await runOverdueProcessing()
      console.log('[定时任务] 启动初始化任务完成')
    } catch (e) {
      console.error('[定时任务] 启动初始化任务异常:', e)
    }
  }

  setTimeout(runStartupTasks, 5000)

  setInterval(async () => {
    const now = dayjs()
    const hour = now.hour()
    const minute = now.minute()

    try {
      if (hour === 8 && minute === 0) {
        console.log('[定时任务 08:00] 每日巡检任务生成')
        await runAutoInspectionGeneration()
      }

      if (hour === 9 && minute === 0) {
        console.log('[定时任务 09:00] 到期提醒 + 逾期处理 + 工单超期检查')
        await runExpirationCheck()
        await runOverdueProcessing()
        await runWorkOrderOverdueCheck()
      }

      if (hour === 23 && minute === 50) {
        console.log('[定时任务 23:50] 生成每日运营报表')
        await runDailyReportGeneration()
      }

      if (hour === 1 && minute === 0 && now.date() === 1) {
        console.log('[定时任务 每月1号01:00] 生成上月账单')
        await runMonthlyBillGeneration()
      }
    } catch (e) {
      console.error('[定时任务] 执行异常:', e)
    }
  }, 60000)
}

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`)
  console.log(`WebSocket 运行在 ws://localhost:${PORT}/ws`)
  startScheduledTasks()
})

export default app
