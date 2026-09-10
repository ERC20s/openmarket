import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import handler from '../pages/api/health'
import { mockReq, mockRes } from './helpers/prisma-mock'

let errorSpy: any

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('GET /api/health', () => {
  it('returns 200 JSON with ok, uptime and now', async () => {
    const res = mockRes()
    await handler(mockReq('/api/health', 'GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('ok', true)
    expect(res.body).toHaveProperty('uptime')
    expect(typeof res.body.uptime).toBe('number')
    expect(res.body).toHaveProperty('now')
    expect(typeof res.body.now).toBe('string')
  })

  it('returns 405 for non-GET methods and sets Allow header', async () => {
    const res = mockRes()
    await handler(mockReq('/api/health', 'POST'), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('GET')
    expect(res.body).toHaveProperty('error')
  })
})
