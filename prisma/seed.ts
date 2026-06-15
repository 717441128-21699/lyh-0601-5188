import { PrismaClient } from '@prisma/client'

const UserRole = {
  ADMIN: 'ADMIN',
  ADVERTISER: 'ADVERTISER',
  INSPECTOR: 'INSPECTOR',
  FINANCE: 'FINANCE'
}

const AdSlotType = {
  BILLBOARD: 'BILLBOARD',
  BUS_STOP: 'BUS_STOP',
  SUBWAY: 'SUBWAY',
  STREET_LAMP: 'STREET_LAMP',
  BUILDING: 'BUILDING',
  LED_SCREEN: 'LED_SCREEN'
}

const AdSlotStatus = {
  ACTIVE: 'ACTIVE',
  MAINTENANCE: 'MAINTENANCE',
  DECOMMISSIONED: 'DECOMMISSIONED'
}

const ApplicationStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING_DESIGN: 'PENDING_DESIGN',
  DESIGN_APPROVED: 'DESIGN_APPROVED',
  DESIGN_REJECTED: 'DESIGN_REJECTED',
  PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
  ACCEPTED: 'ACCEPTED',
  ACCEPTANCE_REJECTED: 'ACCEPTANCE_REJECTED',
  PUBLISHED: 'PUBLISHED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
}
import bcrypt from 'bcryptjs'
import dayjs from 'dayjs'

const prisma = new PrismaClient()

async function main() {
  console.log('开始生成种子数据...')

  const hashedPassword = await bcrypt.hash('123456', 10)

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      name: '系统管理员',
      role: UserRole.ADMIN,
      phone: '13800000001',
      email: 'admin@example.com'
    }
  })

  const advertiser = await prisma.user.upsert({
    where: { username: 'advertiser1' },
    update: {},
    create: {
      username: 'advertiser1',
      password: hashedPassword,
      name: '广告主张三',
      role: UserRole.ADVERTISER,
      phone: '13800000002',
      email: 'adv1@example.com'
    }
  })

  const advertiser2 = await prisma.user.upsert({
    where: { username: 'advertiser2' },
    update: {},
    create: {
      username: 'advertiser2',
      password: hashedPassword,
      name: '广告主李四',
      role: UserRole.ADVERTISER,
      phone: '13800000003',
      email: 'adv2@example.com'
    }
  })

  const inspector = await prisma.user.upsert({
    where: { username: 'inspector1' },
    update: {},
    create: {
      username: 'inspector1',
      password: hashedPassword,
      name: '巡检员王五',
      role: UserRole.INSPECTOR,
      phone: '13800000004',
      email: 'ins1@example.com'
    }
  })

  const inspector2 = await prisma.user.upsert({
    where: { username: 'inspector2' },
    update: {},
    create: {
      username: 'inspector2',
      password: hashedPassword,
      name: '巡检员赵六',
      role: UserRole.INSPECTOR,
      phone: '13800000005',
      email: 'ins2@example.com'
    }
  })

  const finance = await prisma.user.upsert({
    where: { username: 'finance1' },
    update: {},
    create: {
      username: 'finance1',
      password: hashedPassword,
      name: '财务孙七',
      role: UserRole.FINANCE,
      phone: '13800000006',
      email: 'fin1@example.com'
    }
  })

  console.log('用户数据创建完成')

  const districts = ['东城区', '西城区', '朝阳区', '海淀区', '丰台区']
  const adSlotTypes = [AdSlotType.BILLBOARD, AdSlotType.BUS_STOP, AdSlotType.LED_SCREEN, AdSlotType.BUILDING, AdSlotType.STREET_LAMP]

  const slotNames = [
    { type: AdSlotType.BILLBOARD, name: '人民广场大牌广告位', width: 10, height: 5, dailyRate: 5000, address: '人民广场东北角', district: '东城区' },
    { type: AdSlotType.BILLBOARD, name: '火车站出站口大牌', width: 8, height: 4, dailyRate: 8000, address: '火车站出站大厅', district: '西城区' },
    { type: AdSlotType.BUS_STOP, name: '市政府公交站', width: 3, height: 1.5, dailyRate: 800, address: '市政府门前公交站', district: '东城区' },
    { type: AdSlotType.BUS_STOP, name: '中心公园公交站', width: 3, height: 1.5, dailyRate: 700, address: '中心公园南门', district: '朝阳区' },
    { type: AdSlotType.LED_SCREEN, name: 'CBD商圈LED大屏', width: 15, height: 8, dailyRate: 15000, address: 'CBD核心商圈', district: '朝阳区' },
    { type: AdSlotType.LED_SCREEN, name: '科技园区LED屏', width: 10, height: 6, dailyRate: 12000, address: '科技园中心广场', district: '海淀区' },
    { type: AdSlotType.BUILDING, name: '国贸大厦楼体广告', width: 20, height: 15, dailyRate: 20000, address: '国贸大厦北侧楼体', district: '朝阳区' },
    { type: AdSlotType.BUILDING, name: '金融中心大厦', width: 18, height: 12, dailyRate: 18000, address: '金融中心A座', district: '西城区' },
    { type: AdSlotType.STREET_LAMP, name: '长安街灯箱广告A', width: 1.2, height: 0.8, dailyRate: 200, address: '长安街东段', district: '东城区' },
    { type: AdSlotType.STREET_LAMP, name: '学院路灯箱广告B', width: 1.2, height: 0.8, dailyRate: 180, address: '学院路中段', district: '海淀区' },
    { type: AdSlotType.BILLBOARD, name: '购物中心入口大牌', width: 6, height: 3, dailyRate: 6000, address: '万达广场入口', district: '丰台区' },
    { type: AdSlotType.BUS_STOP, name: '体育馆公交站', width: 3, height: 1.5, dailyRate: 750, address: '市体育馆北门', district: '丰台区' }
  ]

  const adSlots = []
  for (let i = 0; i < slotNames.length; i++) {
    const slot = slotNames[i]
    const code = `AD${dayjs().format('YYYYMMDD')}${String(i + 1).padStart(4, '0')}`
    
    const existing = await prisma.adSlot.findUnique({ where: { code } })
    if (!existing) {
      const adSlot = await prisma.adSlot.create({
        data: {
          code,
          name: slot.name,
          type: slot.type,
          width: slot.width,
          height: slot.height,
          area: slot.width * slot.height,
          address: slot.address,
          district: slot.district,
          dailyRate: slot.dailyRate,
          status: AdSlotStatus.ACTIVE,
          description: `${slot.type}类型广告位，位于${slot.address}`,
          latitude: 39.9 + Math.random() * 0.2,
          longitude: 116.3 + Math.random() * 0.2
        }
      })
      adSlots.push(adSlot)
    } else {
      adSlots.push(existing)
    }
  }

  console.log('广告位数据创建完成')

  const applications = [
    {
      adSlotIndex: 0,
      adTitle: '新年促销活动广告',
      adContent: '全场商品5折起，限时抢购！',
      startTime: dayjs().subtract(10, 'day').toDate(),
      endTime: dayjs().add(20, 'day').toDate(),
      status: ApplicationStatus.PUBLISHED,
      applicantId: advertiser.id
    },
    {
      adSlotIndex: 2,
      adTitle: '新品上市宣传',
      adContent: '全新产品震撼上市，欢迎体验',
      startTime: dayjs().add(5, 'day').toDate(),
      endTime: dayjs().add(35, 'day').toDate(),
      status: ApplicationStatus.APPROVED,
      applicantId: advertiser.id
    },
    {
      adSlotIndex: 4,
      adTitle: '品牌形象广告',
      adContent: '打造行业领先品牌',
      startTime: dayjs().subtract(20, 'day').toDate(),
      endTime: dayjs().subtract(5, 'day').toDate(),
      status: ApplicationStatus.EXPIRED,
      applicantId: advertiser2.id
    },
    {
      adSlotIndex: 6,
      adTitle: '企业招聘广告',
      adContent: '诚聘英才，共创未来',
      startTime: dayjs().add(1, 'day').toDate(),
      endTime: dayjs().add(31, 'day').toDate(),
      status: ApplicationStatus.PENDING_REVIEW,
      applicantId: advertiser2.id
    }
  ]

  for (let i = 0; i < applications.length; i++) {
    const app = applications[i]
    const slot = adSlots[app.adSlotIndex]
    const code = `AP${dayjs().format('YYYYMMDD')}${String(i + 1).padStart(4, '0')}`
    
    const existing = await prisma.application.findUnique({ where: { code } })
    if (!existing) {
      const days = dayjs(app.endTime).diff(dayjs(app.startTime), 'day') + 1
      const totalFee = parseFloat(slot.dailyRate.toString()) * days

      await prisma.application.create({
        data: {
          code,
          applicantId: app.applicantId,
          adSlotId: slot.id,
          adTitle: app.adTitle,
          adContent: app.adContent,
          startTime: app.startTime,
          endTime: app.endTime,
          durationDays: days,
          totalFee,
          status: app.status
        }
      })
    }
  }

  console.log('申请数据创建完成')
  console.log('种子数据生成完毕！')
  console.log('测试账号：')
  console.log('  管理员: admin / 123456')
  console.log('  广告主: advertiser1 / 123456')
  console.log('  广告主: advertiser2 / 123456')
  console.log('  巡检员: inspector1 / 123456')
  console.log('  巡检员: inspector2 / 123456')
  console.log('  财务: finance1 / 123456')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
