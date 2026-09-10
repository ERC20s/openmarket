import { NextApiRequest, NextApiResponse } from 'next'

export type ApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void

export function apiRoute(handler: ApiHandler, opts?: { methods?: string[]; name?: string }) {
  const methods = opts?.methods ? opts!.methods.map((m) => String(m).toUpperCase()) : undefined
  const name = opts?.name ?? 'api'

  return async function (req: NextApiRequest, res: NextApiResponse) {
    // Enforce methods only when the request declares one. This preserves the
    // current behaviour where an undefined method (in some tests) is allowed.
    if (methods && req.method) {
      const method = req.method.toUpperCase()
      if (!methods.includes(method)) {
        res.setHeader('Allow', methods.join(', '))
        res.status(405).json({ error: 'Method not allowed' })
        return
      }
    }

    try {
      await Promise.resolve(handler(req, res))
    } catch (err) {
      // Keep the same logging style the routes used before.
      console.error(`${name} failed`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
