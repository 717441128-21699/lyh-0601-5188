import { Router } from 'express'
import prisma from '../prisma'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { successResponse, errorResponse } from '../utils'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'smart-city-ad-secret-key-2024'

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    const user = await prisma.user.findUnique({ where: { username } })
    if (!user) {
      return res.json(errorResponse('用户名或密码错误'))
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return res.json(errorResponse('用户名或密码错误'))
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json(successResponse({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email
      }
    }, '登录成功'))
  } catch (error: any) {
    res.json(errorResponse('认证失败，请检查后重试'))
  }
})

router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        phone: true,
        email: true,
        createdAt: true
      }
    })
    res.json(successResponse(user))
  } catch (error: any) {
    res.json(errorResponse('认证失败，请检查后重试'))
  }
})

export default router
