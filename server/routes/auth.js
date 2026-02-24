import { Router } from 'express'
import nacl from 'tweetnacl'
import { PublicKey } from '@solana/web3.js'
import { createToken } from '../middleware/auth.js'

const router = Router()

router.post('/', async (req, res) => {
  try {
    const { wallet, signature, message } = req.body

    if (!wallet || !signature || !message) {
      return res.status(400).json({ message: 'wallet, signature, and message are required.' })
    }

    let pubkey
    try {
      pubkey = new PublicKey(wallet)
    } catch {
      return res.status(400).json({ message: 'Invalid wallet address.' })
    }

    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = Uint8Array.from(Buffer.from(signature, 'base64'))
    const publicKeyBytes = pubkey.toBytes()

    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)

    if (!isValid) {
      return res.status(401).json({ message: 'Signature verification failed.' })
    }

    const token = createToken(wallet)
    return res.json({ token, wallet })
  } catch (err) {
    console.error('[auth] Error:', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

export default router
