import { Connection, PublicKey } from '@solana/web3.js'

const HELIUS_API_KEY = process.env.HELIUS_API_KEY
const RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : 'https://api.mainnet-beta.solana.com'

export const TOKEN_MINT = '61L6rCdxthsGzzWzVTGZUTjTjAUKYN4A12kJmLVXpump'
export const RECEIVER_WALLET = 'A9wa37GiNEShZhTAThbjx59oWpuk1nwfNoqkocLFa3sH'
export const TOKEN_DECIMALS = 6
export const PRICE_PER_PIXEL = 10 ** TOKEN_DECIMALS // 1 token = 1 pixel

export const connection = new Connection(RPC_URL, 'confirmed')

async function getTransactionWithRetry(txSignature, retries = 5, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    const tx = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (tx) return tx
    if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

export async function verifyPurchaseTransaction(txSignature, expectedWallet, expectedPixelCount) {
  const expectedAmount = BigInt(expectedPixelCount) * BigInt(PRICE_PER_PIXEL)

  const tx = await getTransactionWithRetry(txSignature)

  if (!tx) {
    return { valid: false, error: 'Transaction not found after multiple retries. Please try again.' }
  }

  if (tx.meta?.err) {
    return { valid: false, error: 'Transaction failed on-chain.' }
  }

  const preBalances = tx.meta?.preTokenBalances || []
  const postBalances = tx.meta?.postTokenBalances || []

  const receiverPubkey = RECEIVER_WALLET

  const findBalance = (balances, owner, mint) =>
    balances.find((b) => b.owner === owner && b.mint === mint)

  const receiverPre = findBalance(preBalances, receiverPubkey, TOKEN_MINT)
  const receiverPost = findBalance(postBalances, receiverPubkey, TOKEN_MINT)

  const receiverPreAmount = BigInt(receiverPre?.uiTokenAmount?.amount || '0')
  const receiverPostAmount = BigInt(receiverPost?.uiTokenAmount?.amount || '0')
  const receivedAmount = receiverPostAmount - receiverPreAmount

  if (receivedAmount < expectedAmount) {
    return {
      valid: false,
      error: `Insufficient transfer. Expected ${expectedAmount.toString()} smallest units, received ${receivedAmount.toString()}.`,
    }
  }

  const senderPre = preBalances.find(
    (b) => b.owner === expectedWallet && b.mint === TOKEN_MINT,
  )
  const senderPost = postBalances.find(
    (b) => b.owner === expectedWallet && b.mint === TOKEN_MINT,
  )

  if (!senderPre && !senderPost) {
    return { valid: false, error: 'Sender wallet not found in transaction token balances.' }
  }

  const senderPreAmount = BigInt(senderPre?.uiTokenAmount?.amount || '0')
  const senderPostAmount = BigInt(senderPost?.uiTokenAmount?.amount || '0')
  const sentAmount = senderPreAmount - senderPostAmount

  if (sentAmount < expectedAmount) {
    return {
      valid: false,
      error: `Sender did not send enough tokens. Expected ${expectedAmount.toString()}, sent ${sentAmount.toString()}.`,
    }
  }

  // Sender is already validated above via token balance changes
  // (expectedWallet must appear in pre/post token balances with correct amounts)
  return { valid: true, error: null }
}
