import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { verifyPurchaseTransaction, PRICE_PER_PIXEL } from '../solana.js'

const router = Router()
const GRID_SIZE = 1000
const MAX_PIXELS_PER_PURCHASE = 10000

router.post('/', requireAuth, async (req, res) => {
  try {
    const { txSignature, pixels } = req.body
    const wallet = req.wallet

    if (!txSignature || typeof txSignature !== 'string') {
      return res.status(400).json({ message: 'txSignature is required.' })
    }

    if (!Array.isArray(pixels) || pixels.length === 0) {
      return res.status(400).json({ message: 'pixels array is required and must not be empty.' })
    }

    if (pixels.length > MAX_PIXELS_PER_PURCHASE) {
      return res.status(400).json({ message: `Maximum ${MAX_PIXELS_PER_PURCHASE} pixels per purchase.` })
    }

    for (const p of pixels) {
      if (
        !Number.isInteger(p.x) || !Number.isInteger(p.y) ||
        p.x < 0 || p.x >= GRID_SIZE || p.y < 0 || p.y >= GRID_SIZE
      ) {
        return res.status(400).json({ message: `Invalid pixel coordinates: (${p.x}, ${p.y})` })
      }
    }

    const uniquePixels = [...new Map(pixels.map((p) => [`${p.x},${p.y}`, p])).values()]

    const verification = await verifyPurchaseTransaction(txSignature, wallet, uniquePixels.length)
    if (!verification.valid) {
      return res.status(400).json({ message: verification.error })
    }

    const tokenAmount = BigInt(uniquePixels.length) * BigInt(PRICE_PER_PIXEL)

    let purchaseId
    try {
      const purchaseResult = await query(
        'INSERT INTO purchases (wallet, tx_signature, pixel_count, token_amount) VALUES ($1, $2, $3, $4) RETURNING id',
        [wallet, txSignature, uniquePixels.length, tokenAmount.toString()],
      )
      purchaseId = purchaseResult.rows[0].id
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'This transaction signature has already been used.' })
      }
      throw err
    }

    let acquiredCount = 0
    const acquired = []
    const unavailable = []

    for (const p of uniquePixels) {
      const result = await query(
        'INSERT INTO pixels (x, y, owner) VALUES ($1, $2, $3) ON CONFLICT (x, y) DO NOTHING RETURNING x, y',
        [p.x, p.y, wallet],
      )
      if (result.rowCount > 0) {
        acquiredCount += 1
        acquired.push({ x: p.x, y: p.y })
        await query(
          'INSERT INTO purchase_pixels (purchase_id, x, y) VALUES ($1, $2, $3)',
          [purchaseId, p.x, p.y],
        )
      } else {
        unavailable.push({ x: p.x, y: p.y })
      }
    }

    if (acquiredCount === 0) {
      return res.status(409).json({
        message: 'All requested pixels are already owned.',
        acquired: [],
        unavailable,
        purchaseId,
      })
    }

    return res.json({
      message: `Successfully acquired ${acquiredCount} pixels.`,
      purchaseId,
      pixelCount: acquiredCount,
      acquired,
      unavailable,
      txSignature,
    })
  } catch (err) {
    console.error('[purchase] Error:', err)
    return res.status(500).json({ message: 'Failed to process purchase.' })
  }
})

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, tx_signature, pixel_count, token_amount, created_at FROM purchases WHERE wallet = $1 ORDER BY created_at DESC LIMIT 20',
      [req.wallet],
    )
    return res.json({ purchases: result.rows })
  } catch (err) {
    console.error('[purchase] Error:', err)
    return res.status(500).json({ message: 'Failed to load purchases.' })
  }
})

export default router
