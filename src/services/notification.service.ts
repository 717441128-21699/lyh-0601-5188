import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'

let wss: WebSocketServer

interface ConnectedClients {
  [userId: string]: WebSocket[]
}

const clients: ConnectedClients = {}

export const initWebSocket = (server: Server) => {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', 'http://localhost')
    const userId = url.searchParams.get('userId')

    if (userId) {
      if (!clients[userId]) {
        clients[userId] = []
      }
      clients[userId].push(ws)
      console.log(`用户 ${userId} 已连接 WebSocket`)
    }

    ws.on('close', () => {
      if (userId && clients[userId]) {
        clients[userId] = clients[userId].filter(c => c !== ws)
        if (clients[userId].length === 0) {
          delete clients[userId]
        }
      }
    })
  })

  console.log('WebSocket 服务器已启动')
}

export const sendNotification = (userId: string, data: any) => {
  if (clients[userId] && clients[userId].length > 0) {
    clients[userId].forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    })
  }
}

export const broadcastNotification = (userIds: string[], data: any) => {
  userIds.forEach(userId => sendNotification(userId, data))
}
