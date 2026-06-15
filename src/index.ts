import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { initWebSocket } from './services/notification.service'

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

initWebSocket(server)

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`)
  console.log(`WebSocket 运行在 ws://localhost:${PORT}/ws`)
})

export default app
