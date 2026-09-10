import { NextApiRequest, NextApiResponse } from 'next'
import { apiRoute } from '../../lib/api'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Lightweight process-level health check. Intentionally does not touch
  // the database or other services so it can be used as a stable liveness
  // / readiness probe for the Node/Next process itself.
  res.status(200).json({ ok: true, uptime: process.uptime(), now: new Date().toISOString() })
}, { methods: ['GET'], name: 'GET /api/health' })
