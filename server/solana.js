import { Connection } from '@solana/web3.js'

const HELIUS_API_KEY = process.env.HELIUS_API_KEY
const RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : 'https://api.mainnet-beta.solana.com'

export const TOKEN_MINT = '61L6rCdxthsGzzWzVTGZUTjTjAUKYN4A12kJmLVXpump'
export const TOKEN_DECIMALS = 6
export const PRICE_PER_PIXEL = 10 ** TOKEN_DECIMALS // 1 token = 1 pixel

export const connection = new Connection(RPC_URL, 'confirmed')

async function getParsedTransactionWithRetry(txSignature, retries = 5, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    const tx = await connection.getParsedTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (tx) return tx
    if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

function toBigIntAmount(amount) {
  if (typeof amount === 'number') return BigInt(amount)
  if (typeof amount === 'string' && amount.length > 0) return BigInt(amount)
  return 0n
}

function extractBurnAmountFromInstruction(ix, expectedWallet) {
  const parsed = ix?.parsed
  if (!parsed || typeof parsed !== 'object') return 0n
  const type = typeof parsed.type === 'string' ? parsed.type.toLowerCase() : ''
  if (!type.startsWith('burn')) return 0n

  const info = parsed.info
  if (!info || typeof info !== 'object') return 0n
  const authority = info.authority || info.owner || info.multisigAuthority
  if (authority !== expectedWallet) return 0n
  if (info.mint !== TOKEN_MINT) return 0n

  const rawAmount = info.amount ?? info.tokenAmount?.amount
  return toBigIntAmount(rawAmount)
}

function sumWalletTokenBalance(balances, wallet, mint) {
  return balances.reduce((sum, balance) => {
    if (balance.owner !== wallet || balance.mint !== mint) return sum
    return sum + toBigIntAmount(balance.uiTokenAmount?.amount)
  }, 0n)
}

export async function verifyPurchaseTransaction(txSignature, expectedWallet, expectedPixelCount) {
  const expectedAmount = BigInt(expectedPixelCount) * BigInt(PRICE_PER_PIXEL)

  const tx = await getParsedTransactionWithRetry(txSignature)

  if (!tx) {
    return { valid: false, error: 'Transaction not found after multiple retries. Please try again.' }
  }

  if (tx.meta?.err) {
    return { valid: false, error: 'Transaction failed on-chain.' }
  }

  const preBalances = tx.meta?.preTokenBalances || []
  const postBalances = tx.meta?.postTokenBalances || []

  const walletPre = sumWalletTokenBalance(preBalances, expectedWallet, TOKEN_MINT)
  const walletPost = sumWalletTokenBalance(postBalances, expectedWallet, TOKEN_MINT)
  const walletDelta = walletPre - walletPost

  if (walletPre === 0n && walletPost === 0n) {
    return { valid: false, error: 'Sender wallet not found in transaction token balances.' }
  }

  if (walletDelta < expectedAmount) {
    return {
      valid: false,
      error: `Wallet balance did not decrease enough. Expected ${expectedAmount.toString()}, delta ${walletDelta.toString()}.`,
    }
  }

  const topLevelInstructions = tx.transaction.message.instructions || []
  const innerInstructions =
    tx.meta?.innerInstructions?.flatMap((entry) => entry.instructions || []) || []
  const allInstructions = [...topLevelInstructions, ...innerInstructions]
  const burnedAmount = allInstructions.reduce(
    (sum, ix) => sum + extractBurnAmountFromInstruction(ix, expectedWallet),
    0n,
  )

  if (burnedAmount < expectedAmount) {
    return {
      valid: false,
      error: `No valid burn found for required amount. Expected ${expectedAmount.toString()}, burned ${burnedAmount.toString()}.`,
    }
  }

  return { valid: true, error: null }
}
