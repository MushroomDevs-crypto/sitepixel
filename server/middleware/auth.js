import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

export function createToken(wallet) {
  return jwt.sign({ wallet }, JWT_SECRET, { expiresIn: '24h' })
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid authorization header.' })
  }

  const token = authHeader.slice(7)
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.wallet = decoded.wallet
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' })
  }
}
