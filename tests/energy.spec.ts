import { describe, expect, it } from 'vitest'
import {
  burnSunForEnergy,
  compareEnergyFees,
  parseEnergyDuration,
  parseEnergyPriceSun,
  parseEnergyQuantity,
  parseEstimatePayload,
  parseOrderNo,
  parseOrderStatus,
  parsePayTxHash,
  parseResourcePayload,
  rentQuantity,
  requiredEnergy,
  sunToTrx,
} from '../electron/main/energy/codec'

describe('能量租赁 codec', () => {
  it('sun 转 TRX 不走浮点', () => {
    expect(sunToTrx(565000)).toBe('0.565')
    expect(sunToTrx('1500000')).toBe('1.5')
    expect(sunToTrx(1_000_000n)).toBe('1')
  })

  it('校验数量与时长', () => {
    expect(parseEnergyQuantity(65000)).toBe(65000)
    expect(parseEnergyDuration('1h')).toBe('1h')
    expect(parseEnergyDuration('1d')).toBe('1d')
    expect(() => parseEnergyQuantity(100)).toThrow(/能量数量/)
    expect(() => parseEnergyDuration('30m')).toThrow(/时长/)
  })

  it('按缺口计算租赁数量', () => {
    expect(requiredEnergy(64285, 65000)).toBe(64285)
    expect(requiredEnergy(0, null)).toBe(65000)
    expect(requiredEnergy(0, 65000)).toBe(65000)
    expect(requiredEnergy(0, 1000000)).toBe(65000)
    expect(requiredEnergy(131000, 1000000)).toBe(131000)
    expect(rentQuantity(65000, 65000)).toBe(0)
    expect(rentQuantity(65000, 10000)).toBe(55000)
    expect(rentQuantity(65000, 64000)).toBe(32000)
  })

  it('估算燃烧花费并和租赁比价', () => {
    expect(parseEnergyPriceSun('0:210,1680000000000:420')).toBe(420n)
    expect(burnSunForEnergy(65000, 0, 210n)).toBe(13_650_000n)
    expect(sunToTrx(burnSunForEnergy(65000, 0, 210n))).toBe('13.65')
    expect(compareEnergyFees(565_000n, 13_650_000n)).toBe('rent')
    expect(compareEnergyFees(20_000_000n, 13_650_000n)).toBe('burn')
    expect(compareEnergyFees(1n, 1n)).toBe('same')
  })

  it('解包询价', () => {
    const quote = parseEstimatePayload({
      price: 565000,
      queryNo: '1736674646782828544',
      targetAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      quantity: 65000,
    })
    expect(quote.priceSun).toBe(565000n)
    expect(quote.queryNo).toBe('1736674646782828544')
    expect(quote.quantity).toBe(65000)
    expect(() =>
      parseEstimatePayload({
        price: 565000,
        queryNo: '1',
        targetAddress: 'not-tron',
        quantity: 65000,
      }),
    ).toThrow(/TRON/)
  })

  it('解包订单号与状态', () => {
    expect(parseOrderNo('1988001')).toBe('1988001')
    expect(parseOrderNo({ order_no: '1988001' })).toBe('1988001')
    expect(parseOrderStatus({ status: 2, description: '能量值充值成功' })).toEqual({
      status: 2,
      description: '能量值充值成功',
    })
    expect(parsePayTxHash('0x' + 'ab'.repeat(32))).toBe('ab'.repeat(32))
    expect(() => parsePayTxHash('zz')).toThrow(/哈希/)
  })

  it('解包账户资源', () => {
    const resources = parseResourcePayload(
      { EnergyLimit: 1000, EnergyUsed: 200, freeNetLimit: 600, freeNetUsed: 50 },
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      2_500_000n,
    )
    expect(resources.energyLeft).toBe(800)
    expect(resources.bandwidthLeft).toBe(550)
    expect(resources.balanceTrx).toBe('2.5')
  })
})
