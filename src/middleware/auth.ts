import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { errorResponse } from '../utils'

const JWT_SECRET = process.env.JWT_SECRET || 'smart-city-ad-secret-key-2024'

export interface AuthRequest extends Request {
  user?: {
    id: string
    username: string
    role: string
  }
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  
  if (!token) {
    return res.status(401).json(errorResponse('未提供认证令牌'))
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    req.user = decoded
    next()
  } catch (error) {
    return res.status(401).json(errorResponse('认证令牌无效'))
  }
}

export const roleMiddleware = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json(errorResponse('未认证'))
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json(errorResponse('权限不足'))
    }
    
    next()
  }
}
