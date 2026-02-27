import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey, Transaction } from '@solana/web3.js'
import { createBurnInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { TOKEN_MINT, PRICE_PER_PIXEL } from './solana-config'
import { apiFetch, setToken, clearToken } from './api'
import bg1 from './assets/bg/1.png'
import bg2 from './assets/bg/2.png'
import bg3 from './assets/bg/3.png'
import bg4 from './assets/bg/4.png'
import bg5 from './assets/bg/5.png'
import './App.css'

const GRID_SIZE = 1000
const TOTAL_PIXELS = GRID_SIZE * GRID_SIZE
const WHITE_HEX = '#ffffff'
const WHITE_INT = Number.parseInt(WHITE_HEX.slice(1), 16)
const DEFAULT_COLOR = '#ff5a36'
const TOOLS = {
  select: 'select',
  paint: 'paint',
  media: 'media',
  linkButton: 'link-button',
}
const BRUSH_SHAPES = {
  square: 'square',
  circle: 'circle',
}
const MIN_BRUSH_SIZE = 1
const MAX_BRUSH_SIZE = 25
const MIN_MEDIA_SIDE = 23
const MEDIA_SLOT_PIXELS = MIN_MEDIA_SIDE * MIN_MEDIA_SIDE
const MIN_PIXELS_FOR_LINK_BUTTON = 5000
const DEFAULT_LINK_BUTTON_WIDTH = 16
const DEFAULT_LINK_BUTTON_HEIGHT = 6

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const hexToInt = (hex) => Number.parseInt(hex.slice(1), 16)

const countOwnedInRect = (prefix, x, y, width, height) => {
  if (!prefix) return 0
  if (width <= 0 || height <= 0) return 0

  const stride = GRID_SIZE + 1
  const x1 = x
  const y1 = y
  const x2 = x + width
  const y2 = y + height

  return (
    prefix[y2 * stride + x2] -
    prefix[y1 * stride + x2] -
    prefix[y2 * stride + x1] +
    prefix[y1 * stride + x1]
  )
}

const TOKEN_MINT_PUBKEY = new PublicKey(TOKEN_MINT)

function App() {
  const { publicKey, signMessage, signTransaction, connected } = useWallet()
  const { connection } = useConnection()
  const walletAddress = publicKey?.toBase58() ?? null

  const canvasRef = useRef(null)
  const ownedHighlightCanvasRef = useRef(null)
  const selectionCanvasRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const contextRef = useRef(null)
  const ownedHighlightContextRef = useRef(null)
  const selectionContextRef = useRef(null)
  const previewContextRef = useRef(null)
  const mediaDragOffsetRef = useRef({ x: 0, y: 0 })
  const mediaInteractionRef = useRef(null)
  const linkButtonInteractionRef = useRef(null)
  const fileInputRef = useRef(null)

  const pixelsRef = useRef(new Uint32Array(TOTAL_PIXELS).fill(WHITE_INT))
  const ownersRef = useRef(new Int32Array(TOTAL_PIXELS))
  const selectionMaskRef = useRef(new Uint8Array(TOTAL_PIXELS))

  const dragToolRef = useRef(null)
  const selectActionRef = useRef(null)
  const blockedPaintNoticeRef = useRef(false)
  const blockedSelectionNoticeRef = useRef(false)
  const selectionCountRef = useRef(0)
  const selectionCountRafRef = useRef(null)
  const previewBoundsRef = useRef(null)
  const paintBufferRef = useRef([])
  const paintFlushTimerRef = useRef(null)

  const [brushColor, setBrushColor] = useState(DEFAULT_COLOR)
  const [brushShape, setBrushShape] = useState(BRUSH_SHAPES.square)
  const [brushSize, setBrushSize] = useState(1)
  const [zoom, setZoom] = useState(8)
  const [tool, setTool] = useState(TOOLS.select)
  const [highlightOwnedBlinkEnabled, setHighlightOwnedBlinkEnabled] = useState(false)
  const [mediaDraft, setMediaDraft] = useState(null)
  const [placedMedia, setPlacedMedia] = useState([])
  const [linkButtonDraft, setLinkButtonDraft] = useState(null)
  const [placedLinkButtons, setPlacedLinkButtons] = useState([])
  const [linkButtonTextInput, setLinkButtonTextInput] = useState('Visit')
  const [linkButtonUrlInput, setLinkButtonUrlInput] = useState('https://')

  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [walletIdMap, setWalletIdMap] = useState(new Map())
  const [status, setStatus] = useState('Connect your Solana wallet to get started.')
  const [selectionCount, setSelectionCount] = useState(0)
  const [purchases, setPurchases] = useState([])
  const [ownersSnapshot, setOwnersSnapshot] = useState(() => new Int32Array(TOTAL_PIXELS))
  const [buying, setBuying] = useState(false)

  const myLocalId = walletAddress ? (walletIdMap.get(walletAddress) ?? 0) : 0

  const canvasStyleSize = useMemo(() => `${GRID_SIZE * zoom}px`, [zoom])
  const canvasStackStyle = useMemo(
    () => ({
      width: canvasStyleSize,
      height: canvasStyleSize,
      '--pixel-size': `${zoom}px`,
      '--grid-line-size': zoom <= 2 ? '0.35px' : zoom <= 6 ? '0.5px' : '1px',
    }),
    [canvasStyleSize, zoom],
  )

  const activeAccountOwnedPixels = useMemo(() => {
    if (!myLocalId) return 0
    let count = 0
    const owners = ownersSnapshot
    for (let i = 0; i < TOTAL_PIXELS; i++) {
      if (owners[i] === myLocalId) count++
    }
    return count
  }, [ownersSnapshot, myLocalId])

  const showOwnedBlink =
    highlightOwnedBlinkEnabled && myLocalId > 0 && activeAccountOwnedPixels > 0
  const brushSizeLabel = `${brushSize}x${brushSize}`
  const brushShapeLabel = brushShape === BRUSH_SHAPES.circle ? 'Circle' : 'Square'
  const activeAccountMedia = useMemo(
    () => placedMedia.filter((item) => item.wallet === walletAddress),
    [placedMedia, walletAddress],
  )
  const activeAccountLinkButtons = useMemo(
    () => placedLinkButtons.filter((item) => item.wallet === walletAddress),
    [placedLinkButtons, walletAddress],
  )
  const canUseLinkButtons = activeAccountOwnedPixels >= MIN_PIXELS_FOR_LINK_BUTTON
  const pixelsMissingForLinkButtons = Math.max(MIN_PIXELS_FOR_LINK_BUTTON - activeAccountOwnedPixels, 0)
  const mediaSlotsUsed = activeAccountMedia.length
  const mediaSlotCapacity = Math.floor(activeAccountOwnedPixels / MEDIA_SLOT_PIXELS)
  const mediaSlotsRemaining = Math.max(mediaSlotCapacity - mediaSlotsUsed, 0)
  const nextMediaRequiredPixels = (mediaSlotsUsed + 1) * MEDIA_SLOT_PIXELS
  const pixelsMissingForNextMedia = Math.max(nextMediaRequiredPixels - activeAccountOwnedPixels, 0)

  const normalizeMediaRect = (draft) => {
    if (!draft) return null
    const width = clamp(Math.round(draft.width ?? 1), 1, GRID_SIZE)
    const height = clamp(Math.round(draft.height ?? 1), 1, GRID_SIZE)
    const maxX = GRID_SIZE - width
    const maxY = GRID_SIZE - height
    const x = clamp(Math.round(draft.x ?? 0), 0, maxX)
    const y = clamp(Math.round(draft.y ?? 0), 0, maxY)
    return { ...draft, x, y, width, height }
  }

  const normalizeRect = normalizeMediaRect

  const findFirstOwnedRect = (width, height) => {
    if (!activeOwnedPrefix) return null
    const nw = clamp(Math.round(width), 1, GRID_SIZE)
    const nh = clamp(Math.round(height), 1, GRID_SIZE)
    const area = nw * nh
    const lx = GRID_SIZE - nw
    const ly = GRID_SIZE - nh
    for (let y = 0; y <= ly; y += 1) {
      for (let x = 0; x <= lx; x += 1) {
        if (countOwnedInRect(activeOwnedPrefix, x, y, nw, nh) === area) return { x, y }
      }
    }
    return null
  }

  const normalizeExternalUrl = (rawUrl) => {
    const trimmedUrl = rawUrl.trim()
    if (!trimmedUrl) return null
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl)
    const candidateUrl = hasScheme ? trimmedUrl : `https://${trimmedUrl}`
    try {
      const parsedUrl = new URL(candidateUrl)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return null
      return parsedUrl.toString()
    } catch {
      return null
    }
  }

  const activeOwnedPrefix = (() => {
    if (!myLocalId) return null
    const stride = GRID_SIZE + 1
    const prefix = new Uint32Array(stride * stride)
    for (let y = 1; y <= GRID_SIZE; y += 1) {
      let rowOwned = 0
      const rowBase = (y - 1) * GRID_SIZE
      const cur = y * stride
      const prev = (y - 1) * stride
      for (let x = 1; x <= GRID_SIZE; x += 1) {
        if (ownersSnapshot[rowBase + x - 1] === myLocalId) rowOwned += 1
        prefix[cur + x] = prefix[prev + x] + rowOwned
      }
    }
    return prefix
  })()

  const mediaAreaEligibility = (() => {
    if (!myLocalId || !activeOwnedPrefix) return { canPlace: false, firstAnchor: null }
    const requiredArea = MIN_MEDIA_SIDE * MIN_MEDIA_SIDE
    if (activeAccountOwnedPixels < requiredArea) return { canPlace: false, firstAnchor: null }
    const limit = GRID_SIZE - MIN_MEDIA_SIDE
    for (let y = 0; y <= limit; y += 1) {
      for (let x = 0; x <= limit; x += 1) {
        if (countOwnedInRect(activeOwnedPrefix, x, y, MIN_MEDIA_SIDE, MIN_MEDIA_SIDE) === requiredArea) {
          return { canPlace: true, firstAnchor: { x, y } }
        }
      }
    }
    return { canPlace: false, firstAnchor: null }
  })()

  const canPlaceMediaByAreaRule = mediaAreaEligibility.canPlace
  const firstValidMediaAnchor = mediaAreaEligibility.firstAnchor

  const normalizedMediaDraft = useMemo(() => normalizeMediaRect(mediaDraft), [mediaDraft])
  const normalizedLinkButtonDraft = useMemo(() => normalizeRect(linkButtonDraft), [linkButtonDraft])

  const linkButtonDraftValidation = useMemo(() => {
    if (!normalizedLinkButtonDraft) return { isValid: false, message: 'Create a button draft to position.' }
    if (!myLocalId) return { isValid: false, message: 'Connect your wallet to insert a button.' }
    if (!canUseLinkButtons) return { isValid: false, message: `Button locked: minimum ${MIN_PIXELS_FOR_LINK_BUTTON}px purchased (need ${pixelsMissingForLinkButtons}px more).` }
    if (!activeOwnedPrefix) return { isValid: false, message: 'Could not validate your area for the button.' }
    if (!normalizedLinkButtonDraft.text.trim()) return { isValid: false, message: 'Set a text for the button.' }
    const normalizedUrl = normalizeExternalUrl(normalizedLinkButtonDraft.url || '')
    if (!normalizedUrl) return { isValid: false, message: 'Enter a valid link (http/https).' }
    const owned = countOwnedInRect(activeOwnedPrefix, normalizedLinkButtonDraft.x, normalizedLinkButtonDraft.y, normalizedLinkButtonDraft.width, normalizedLinkButtonDraft.height)
    const total = normalizedLinkButtonDraft.width * normalizedLinkButtonDraft.height
    if (owned !== total) return { isValid: false, message: `Button outside your property. Need ${total - owned}px more in this area.` }
    return { isValid: true, message: 'Button ready to insert.' }
  }, [normalizedLinkButtonDraft, myLocalId, canUseLinkButtons, pixelsMissingForLinkButtons, activeOwnedPrefix])

  const mediaDraftValidation = useMemo(() => {
    if (!normalizedMediaDraft) return { isValid: false, message: 'Select a GIF or image to position.' }
    if (!myLocalId) return { isValid: false, message: 'Connect your wallet to insert a GIF/image.' }
    if (mediaSlotsRemaining <= 0) return { isValid: false, message: `Image limit reached. Need ${pixelsMissingForNextMedia}px more to unlock.` }
    if (!canPlaceMediaByAreaRule) return { isValid: false, message: '23x23 rule: buy a 23x23 block to unlock.' }
    if (!activeOwnedPrefix) return { isValid: false, message: 'Could not validate your area right now.' }
    const owned = countOwnedInRect(activeOwnedPrefix, normalizedMediaDraft.x, normalizedMediaDraft.y, normalizedMediaDraft.width, normalizedMediaDraft.height)
    const total = normalizedMediaDraft.width * normalizedMediaDraft.height
    if (owned !== total) return { isValid: false, message: `Media area extends outside your property. Need ${total - owned} more owned pixels.` }
    return { isValid: true, message: 'Valid position. You can insert the GIF/image.' }
  }, [normalizedMediaDraft, myLocalId, mediaSlotsRemaining, pixelsMissingForNextMedia, canPlaceMediaByAreaRule, activeOwnedPrefix])

  // --- Canvas setup ---
  useEffect(() => {
    const canvas = canvasRef.current
    const oh = ownedHighlightCanvasRef.current
    const sel = selectionCanvasRef.current
    const prev = previewCanvasRef.current
    if (!canvas || !oh || !sel || !prev) return
    for (const c of [canvas, oh, sel, prev]) { c.width = GRID_SIZE; c.height = GRID_SIZE }
    const ctx = canvas.getContext('2d', { alpha: false })
    const ohCtx = oh.getContext('2d')
    const selCtx = sel.getContext('2d')
    const prevCtx = prev.getContext('2d')
    if (!ctx || !ohCtx || !selCtx || !prevCtx) return
    for (const c of [ctx, ohCtx, selCtx, prevCtx]) c.imageSmoothingEnabled = false
    ctx.fillStyle = WHITE_HEX
    ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE)
    contextRef.current = ctx
    ownedHighlightContextRef.current = ohCtx
    selectionContextRef.current = selCtx
    previewContextRef.current = prevCtx
  }, [])

  // --- Load grid from server ---
  useEffect(() => {
    async function loadGrid() {
      try {
        const data = await apiFetch('/grid')
        const idMap = new Map()
        let nextId = 1
        const pixels = pixelsRef.current
        const owners = ownersRef.current
        pixels.fill(WHITE_INT)
        owners.fill(0)
        for (const p of data.pixels) {
          if (!idMap.has(p.owner)) idMap.set(p.owner, nextId++)
          const idx = p.y * GRID_SIZE + p.x
          owners[idx] = idMap.get(p.owner)
          pixels[idx] = hexToInt(p.color)
        }
        setWalletIdMap(idMap)
        setOwnersSnapshot(new Int32Array(owners))
        setPlacedMedia(data.media || [])
        setPlacedLinkButtons(data.linkButtons || [])
        const context = contextRef.current
        if (context) {
          const imageData = context.createImageData(GRID_SIZE, GRID_SIZE)
          const buf = imageData.data
          for (let i = 0; i < TOTAL_PIXELS; i++) {
            const c = pixels[i]
            const off = i * 4
            buf[off] = (c >> 16) & 255
            buf[off + 1] = (c >> 8) & 255
            buf[off + 2] = c & 255
            buf[off + 3] = 255
          }
          context.putImageData(imageData, 0, 0)
        }
        updateStatus('Grid loaded. Connect your wallet to interact.')
      } catch (err) {
        updateStatus('Error loading grid: ' + err.message)
      }
    }
    loadGrid()
  }, [])

  // --- Authenticate on wallet connect ---
  useEffect(() => {
    if (!connected || !publicKey || !signMessage) {
      setIsAuthenticated(false)
      clearToken()
      return
    }
    async function authenticate() {
      try {
        const message = `Sign in to CriptoPixel\nWallet: ${publicKey.toBase58()}\nTimestamp: ${Date.now()}`
        const encodedMessage = new TextEncoder().encode(message)
        const signature = await signMessage(encodedMessage)
        const { token } = await apiFetch('/auth', {
          method: 'POST',
          body: JSON.stringify({
            wallet: publicKey.toBase58(),
            signature: btoa(String.fromCharCode(...signature)),
            message,
          }),
        })
        setToken(token)
        setIsAuthenticated(true)
        setWalletIdMap((prev) => {
          if (prev.has(publicKey.toBase58())) return prev
          const next = new Map(prev)
          const maxId = Math.max(0, ...prev.values())
          next.set(publicKey.toBase58(), maxId + 1)
          return next
        })
        updateStatus(`Connected wallet: ${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`)
      } catch (err) {
        updateStatus('Authentication failed: ' + err.message)
      }
    }
    authenticate()
  }, [connected, publicKey, signMessage])

  useEffect(() => () => { if (selectionCountRafRef.current !== null) cancelAnimationFrame(selectionCountRafRef.current) }, [])

  // --- Owned blink ---
  useEffect(() => {
    const ctx = ownedHighlightContextRef.current
    if (!ctx) return
    if (!showOwnedBlink || !myLocalId) { ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE); return }
    const imageData = ctx.createImageData(GRID_SIZE, GRID_SIZE)
    const buf = imageData.data
    for (let i = 0; i < TOTAL_PIXELS; i++) {
      if (ownersRef.current[i] !== myLocalId) continue
      const off = i * 4
      buf[off] = 14; buf[off + 1] = 165; buf[off + 2] = 233; buf[off + 3] = 150
    }
    ctx.putImageData(imageData, 0, 0)
  }, [showOwnedBlink, myLocalId, ownersSnapshot])

  const updateStatus = (s) => setStatus((prev) => prev === s ? prev : s)
  const syncSelectionCountState = () => {
    if (selectionCountRafRef.current !== null) return
    selectionCountRafRef.current = requestAnimationFrame(() => { selectionCountRafRef.current = null; setSelectionCount(selectionCountRef.current) })
  }
  const clearSelection = () => { selectionMaskRef.current.fill(0); selectionCountRef.current = 0; setSelectionCount(0); selectionContextRef.current?.clearRect(0, 0, GRID_SIZE, GRID_SIZE) }

  const toggleOwnedBlink = () => {
    setHighlightOwnedBlinkEnabled((v) => { updateStatus(!v ? 'Blink activated.' : 'Blink deactivated.'); return !v })
  }

  const clearMediaDraft = () => { setMediaDraft(null); mediaDragOffsetRef.current = { x: 0, y: 0 }; mediaInteractionRef.current = null }
  const updateMediaDraftRect = (r) => setMediaDraft((d) => d ? normalizeMediaRect({ ...d, ...r }) : d)
  const moveMediaDraftToPoint = (p) => { if (!p) return; const o = mediaDragOffsetRef.current; updateMediaDraftRect({ x: p.x - o.x, y: p.y - o.y }) }

  const getCanvasFloatPoint = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return { x: ((event.clientX - rect.left) / rect.width) * GRID_SIZE, y: ((event.clientY - rect.top) / rect.height) * GRID_SIZE }
  }

  const handleMediaDraftPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (tool !== TOOLS.media || !normalizedMediaDraft) return
    const point = getCanvasFloatPoint(event)
    if (!point) return
    const dir = event.target.dataset.handle || null
    mediaInteractionRef.current = { mode: dir ? 'resize' : 'move', resizeDirection: dir, startPoint: point, startRect: { x: normalizedMediaDraft.x, y: normalizedMediaDraft.y, width: normalizedMediaDraft.width, height: normalizedMediaDraft.height } }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleMediaDraftPointerMove = (event) => {
    const i = mediaInteractionRef.current
    if (!i) return
    const p = getCanvasFloatPoint(event)
    if (!p) return
    const dx = p.x - i.startPoint.x, dy = p.y - i.startPoint.y
    if (i.mode === 'move') { updateMediaDraftRect({ x: i.startRect.x + dx, y: i.startRect.y + dy }); return }
    let nx = i.startRect.x, ny = i.startRect.y, nw = i.startRect.width, nh = i.startRect.height
    const d = i.resizeDirection || 'se'
    if (d.includes('e')) nw = i.startRect.width + dx
    if (d.includes('s')) nh = i.startRect.height + dy
    if (d.includes('w')) { nx = i.startRect.x + dx; nw = i.startRect.width - dx }
    if (d.includes('n')) { ny = i.startRect.y + dy; nh = i.startRect.height - dy }
    updateMediaDraftRect({ x: nx, y: ny, width: nw, height: nh })
  }

  const endMediaDraftInteraction = (event) => { if (!mediaInteractionRef.current) return; mediaInteractionRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId) }

  const handleMediaFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    if (!myLocalId) { updateStatus('Connect your wallet before uploading a GIF/image.'); return }
    if (!canPlaceMediaByAreaRule || !firstValidMediaAnchor) { updateStatus('23x23 rule: buy a 23x23 block first.'); return }
    if (mediaSlotsRemaining <= 0) { updateStatus('Image limit reached.'); return }
    const fileUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      setMediaDraft(normalizeMediaRect({ id: `draft-${Date.now()}`, fileName: file.name, mimeType: file.type, url: fileUrl, fileObject: file, width: MIN_MEDIA_SIDE, height: MIN_MEDIA_SIDE, x: firstValidMediaAnchor.x, y: firstValidMediaAnchor.y }))
      switchTool(TOOLS.media)
      clearBrushPreview()
      updateStatus('GIF/image loaded. Drag to position.')
    }
    image.onerror = () => { URL.revokeObjectURL(fileUrl); updateStatus('Could not read this image/GIF.') }
    image.src = fileUrl
  }

  const insertMediaAtDraft = async () => {
    if (!normalizedMediaDraft) { updateStatus('Upload a GIF/image first.'); return }
    if (mediaSlotsRemaining <= 0) { updateStatus('Image limit reached.'); return }
    if (!mediaDraftValidation.isValid) { updateStatus(mediaDraftValidation.message); return }
    try {
      const formData = new FormData()
      formData.append('file', normalizedMediaDraft.fileObject)
      formData.append('x', normalizedMediaDraft.x)
      formData.append('y', normalizedMediaDraft.y)
      formData.append('width', normalizedMediaDraft.width)
      formData.append('height', normalizedMediaDraft.height)
      const result = await apiFetch('/media', { method: 'POST', body: formData })
      setPlacedMedia((prev) => [result.media, ...prev])
      updateStatus(`GIF/image inserted at ${normalizedMediaDraft.width}x${normalizedMediaDraft.height} pixels.`)
    } catch (err) { updateStatus('Error inserting media: ' + err.message) }
  }

  const removeLastMediaFromActiveAccount = async () => {
    if (!walletAddress) { updateStatus('Connect your wallet.'); return }
    const my = placedMedia.filter((i) => i.wallet === walletAddress)
    if (my.length === 0) { updateStatus('No media to remove.'); return }
    try {
      await apiFetch(`/media/${my[0].id}`, { method: 'DELETE' })
      setPlacedMedia((prev) => prev.filter((i) => i.id !== my[0].id))
      updateStatus('Media removed.')
    } catch (err) { updateStatus('Error: ' + err.message) }
  }

  const clearLinkButtonDraft = () => { setLinkButtonDraft(null); linkButtonInteractionRef.current = null }
  const updateLinkButtonDraftRect = (r) => setLinkButtonDraft((d) => d ? normalizeRect({ ...d, ...r }) : d)
  const updateLinkButtonDraftText = (t) => { setLinkButtonTextInput(t); setLinkButtonDraft((d) => d ? { ...d, text: t } : d) }
  const updateLinkButtonDraftUrl = (u) => { setLinkButtonUrlInput(u); setLinkButtonDraft((d) => d ? { ...d, url: u } : d) }

  const createLinkButtonDraft = () => {
    if (!myLocalId) { updateStatus('Connect your wallet.'); return }
    if (!canUseLinkButtons) { updateStatus(`Button locked: minimum ${MIN_PIXELS_FOR_LINK_BUTTON}px.`); return }
    const anchor = findFirstOwnedRect(DEFAULT_LINK_BUTTON_WIDTH, DEFAULT_LINK_BUTTON_HEIGHT) || findFirstOwnedRect(1, 1)
    if (!anchor) { updateStatus('No owned space for the button.'); return }
    setLinkButtonDraft(normalizeRect({ x: anchor.x, y: anchor.y, width: DEFAULT_LINK_BUTTON_WIDTH, height: DEFAULT_LINK_BUTTON_HEIGHT, text: linkButtonTextInput.trim() || 'Visit', url: linkButtonUrlInput.trim() || 'https://' }))
    switchTool(TOOLS.linkButton)
    clearBrushPreview()
    updateStatus('Button draft created. Drag and resize.')
  }

  const insertLinkButtonAtDraft = async () => {
    if (!normalizedLinkButtonDraft) { updateStatus('Create a button draft first.'); return }
    if (!linkButtonDraftValidation.isValid) { updateStatus(linkButtonDraftValidation.message); return }
    const normalizedUrl = normalizeExternalUrl(normalizedLinkButtonDraft.url || '')
    if (!normalizedUrl) { updateStatus('Invalid link.'); return }
    try {
      const result = await apiFetch('/link-buttons', { method: 'POST', body: JSON.stringify({ x: normalizedLinkButtonDraft.x, y: normalizedLinkButtonDraft.y, width: normalizedLinkButtonDraft.width, height: normalizedLinkButtonDraft.height, text: normalizedLinkButtonDraft.text.trim(), url: normalizedUrl }) })
      setPlacedLinkButtons((prev) => [result.linkButton, ...prev])
      updateStatus('Button inserted.')
    } catch (err) { updateStatus('Error: ' + err.message) }
  }

  const removeLastLinkButtonFromActiveAccount = async () => {
    if (!walletAddress) { updateStatus('Connect your wallet.'); return }
    const my = placedLinkButtons.filter((i) => i.wallet === walletAddress)
    if (my.length === 0) { updateStatus('No button to remove.'); return }
    try {
      await apiFetch(`/link-buttons/${my[0].id}`, { method: 'DELETE' })
      setPlacedLinkButtons((prev) => prev.filter((i) => i.id !== my[0].id))
      updateStatus('Button removed.')
    } catch (err) { updateStatus('Error: ' + err.message) }
  }

  const handleLinkButtonDraftPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (tool !== TOOLS.linkButton || !normalizedLinkButtonDraft) return
    const point = getCanvasFloatPoint(event)
    if (!point) return
    const dir = event.target.dataset.handle || null
    linkButtonInteractionRef.current = { mode: dir ? 'resize' : 'move', resizeDirection: dir, startPoint: point, startRect: { x: normalizedLinkButtonDraft.x, y: normalizedLinkButtonDraft.y, width: normalizedLinkButtonDraft.width, height: normalizedLinkButtonDraft.height } }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleLinkButtonDraftPointerMove = (event) => {
    const i = linkButtonInteractionRef.current
    if (!i) return
    const p = getCanvasFloatPoint(event)
    if (!p) return
    const dx = p.x - i.startPoint.x, dy = p.y - i.startPoint.y
    if (i.mode === 'move') { updateLinkButtonDraftRect({ x: i.startRect.x + dx, y: i.startRect.y + dy }); return }
    let nx = i.startRect.x, ny = i.startRect.y, nw = i.startRect.width, nh = i.startRect.height
    const d = i.resizeDirection || 'se'
    if (d.includes('e')) nw = i.startRect.width + dx
    if (d.includes('s')) nh = i.startRect.height + dy
    if (d.includes('w')) { nx = i.startRect.x + dx; nw = i.startRect.width - dx }
    if (d.includes('n')) { ny = i.startRect.y + dy; nh = i.startRect.height - dy }
    updateLinkButtonDraftRect({ x: nx, y: ny, width: nw, height: nh })
  }

  const endLinkButtonDraftInteraction = (event) => { if (!linkButtonInteractionRef.current) return; linkButtonInteractionRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId) }

  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * GRID_SIZE)
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * GRID_SIZE)
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null
    return { x, y }
  }

  const forEachBrushPoint = (centerPoint, callback) => {
    const half = Math.floor(brushSize / 2)
    const sx = centerPoint.x - half, ex = sx + brushSize - 1
    const sy = centerPoint.y - half, ey = sy + brushSize - 1
    for (let y = sy; y <= ey; y++) {
      if (y < 0 || y >= GRID_SIZE) continue
      for (let x = sx; x <= ex; x++) {
        if (x < 0 || x >= GRID_SIZE) continue
        if (brushShape === BRUSH_SHAPES.circle) {
          const dx = x - centerPoint.x, dy = y - centerPoint.y
          if (dx * dx + dy * dy > half * half) continue
        }
        callback(x, y)
      }
    }
  }

  const clearBrushPreview = () => {
    const ctx = previewContextRef.current, b = previewBoundsRef.current
    if (!ctx || !b) return
    ctx.clearRect(b.x, b.y, b.width, b.height)
    previewBoundsRef.current = null
  }

  const drawBrushPreview = (point) => {
    const ctx = previewContextRef.current
    if (!ctx) return
    clearBrushPreview()
    if (!point) return
    let minX = GRID_SIZE, minY = GRID_SIZE, maxX = -1, maxY = -1
    if (tool === TOOLS.paint) {
      const c = hexToInt(brushColor)
      ctx.fillStyle = `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, 0.45)`
    } else { ctx.fillStyle = 'rgba(34, 197, 94, 0.4)' }
    forEachBrushPoint(point, (x, y) => { ctx.fillRect(x, y, 1, 1); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) })
    if (maxX < minX) return
    previewBoundsRef.current = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  }

  const updateBrushPreviewFromEvent = (event) => drawBrushPreview(getCanvasPoint(event))

  const drawSelectionPixel = (x, y, selected) => {
    const ctx = selectionContextRef.current
    if (!ctx) return
    if (selected) ctx.fillRect(x, y, 1, 1)
    else ctx.clearRect(x, y, 1, 1)
  }

  const resolveSelectionAction = (point) => {
    let firstFree = null, ownBlocked = 0, otherBlocked = 0
    forEachBrushPoint(point, (x, y) => {
      const idx = y * GRID_SIZE + x, owner = ownersRef.current[idx]
      if (owner === 0) { if (firstFree === null) firstFree = selectionMaskRef.current[idx] === 1; return }
      if (owner === myLocalId) ownBlocked++; else otherBlocked++
    })
    if (firstFree === null) return { shouldSelect: null, ownBlockedCount: ownBlocked, otherBlockedCount: otherBlocked }
    return { shouldSelect: !firstFree, ownBlockedCount: ownBlocked, otherBlockedCount: otherBlocked }
  }

  const setSelectionWithBrushAtPoint = (point, shouldSelect) => {
    const ctx = selectionContextRef.current
    if (!ctx) return
    ctx.fillStyle = 'rgba(34, 197, 94, 0.45)'
    let changed = 0, blocked = 0
    forEachBrushPoint(point, (x, y) => {
      const idx = y * GRID_SIZE + x
      if (ownersRef.current[idx] !== 0) { blocked++; return }
      const was = selectionMaskRef.current[idx] === 1
      if (was === shouldSelect) return
      selectionMaskRef.current[idx] = shouldSelect ? 1 : 0
      selectionCountRef.current += shouldSelect ? 1 : -1
      drawSelectionPixel(x, y, shouldSelect)
      changed++
    })
    if (changed > 0) { syncSelectionCountState(); return }
    if (blocked === 0 || blockedSelectionNoticeRef.current) return
    updateStatus('Brush area has no free pixels.')
    blockedSelectionNoticeRef.current = true
  }

  // --- Paint with batched API ---
  const flushPaintBuffer = useCallback(async () => {
    const buffer = paintBufferRef.current
    if (buffer.length === 0) return
    paintBufferRef.current = []
    try { await apiFetch('/paint', { method: 'POST', body: JSON.stringify({ pixels: buffer }) }) }
    catch (err) { updateStatus('Error saving paint: ' + err.message) }
  }, [])

  const paintWithBrush = (event) => {
    const ctx = contextRef.current
    if (!ctx) return
    if (!myLocalId) { updateStatus('Connect your wallet to paint.'); return }
    const point = getCanvasPoint(event)
    if (!point) return
    const nextColor = hexToInt(brushColor)
    ctx.fillStyle = brushColor
    let painted = 0, blocked = 0
    forEachBrushPoint(point, (x, y) => {
      const idx = y * GRID_SIZE + x
      if (ownersRef.current[idx] !== myLocalId) { blocked++; return }
      if (pixelsRef.current[idx] === nextColor) return
      pixelsRef.current[idx] = nextColor
      ctx.fillRect(x, y, 1, 1)
      paintBufferRef.current.push({ x, y, color: brushColor })
      painted++
    })
    if (painted > 0) { clearTimeout(paintFlushTimerRef.current); paintFlushTimerRef.current = setTimeout(flushPaintBuffer, 300); return }
    if (blocked === 0 || blockedPaintNoticeRef.current) return
    updateStatus('Brush only reached blocked or unpurchased pixels.')
    blockedPaintNoticeRef.current = true
  }

  const startSelecting = (event) => {
    if (!myLocalId) { updateStatus('Connect your wallet.'); return }
    const point = getCanvasPoint(event)
    if (!point) return
    const action = resolveSelectionAction(point)
    if (action.shouldSelect === null) {
      if (action.otherBlockedCount > 0) updateStatus('Pixels owned by other wallets.')
      else if (action.ownBlockedCount > 0) updateStatus('You already own these pixels.')
      else updateStatus('No free pixels here.')
      return
    }
    selectActionRef.current = action.shouldSelect
    dragToolRef.current = TOOLS.select
    blockedSelectionNoticeRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSelectionWithBrushAtPoint(point, action.shouldSelect)
  }

  const keepSelecting = (event) => {
    if (dragToolRef.current !== TOOLS.select || selectActionRef.current === null) return
    const point = getCanvasPoint(event)
    if (!point) return
    setSelectionWithBrushAtPoint(point, Boolean(selectActionRef.current))
  }

  const startPainting = (event) => {
    if (!myLocalId) { updateStatus('Connect your wallet.'); return }
    dragToolRef.current = TOOLS.paint
    blockedPaintNoticeRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
    paintWithBrush(event)
  }

  const keepPainting = (event) => { if (dragToolRef.current !== TOOLS.paint) return; paintWithBrush(event) }

  const startMediaPositioning = (event) => {
    if (!myLocalId) { updateStatus('Connect your wallet.'); return }
    if (!canPlaceMediaByAreaRule) { updateStatus('23x23 rule not met.'); return }
    if (!normalizedMediaDraft) { updateStatus('Upload a GIF/image first.'); return }
    const point = getCanvasPoint(event)
    if (!point) return
    const inside = point.x >= normalizedMediaDraft.x && point.x < normalizedMediaDraft.x + normalizedMediaDraft.width && point.y >= normalizedMediaDraft.y && point.y < normalizedMediaDraft.y + normalizedMediaDraft.height
    if (inside) mediaDragOffsetRef.current = { x: point.x - normalizedMediaDraft.x, y: point.y - normalizedMediaDraft.y }
    else { mediaDragOffsetRef.current = { x: 0, y: 0 }; moveMediaDraftToPoint(point) }
    dragToolRef.current = TOOLS.media
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const keepMediaPositioning = (event) => {
    if (dragToolRef.current !== TOOLS.media) return
    const point = getCanvasPoint(event)
    if (point) moveMediaDraftToPoint(point)
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (tool !== TOOLS.media && tool !== TOOLS.linkButton) updateBrushPreviewFromEvent(event)
    else clearBrushPreview()
    if (tool === TOOLS.paint) { startPainting(event); return }
    if (tool === TOOLS.media) { startMediaPositioning(event); return }
    if (tool === TOOLS.linkButton) return
    startSelecting(event)
  }

  const handlePointerMove = (event) => {
    if (tool !== TOOLS.media && tool !== TOOLS.linkButton) updateBrushPreviewFromEvent(event)
    keepPainting(event)
    keepSelecting(event)
    keepMediaPositioning(event)
  }

  const stopInteraction = (event) => {
    if (!dragToolRef.current) return
    const wasPaint = dragToolRef.current === TOOLS.paint
    dragToolRef.current = null
    selectActionRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (tool === TOOLS.select) updateStatus(`Selection: ${selectionCountRef.current} pixels = ${selectionCountRef.current} tokens`)
    if (wasPaint) flushPaintBuffer()
    mediaDragOffsetRef.current = { x: 0, y: 0 }
  }

  const handlePointerCancel = (event) => { stopInteraction(event); clearBrushPreview() }
  const handlePointerLeave = (event) => { stopInteraction(event); clearBrushPreview() }

  const clearMyColors = async () => {
    if (!myLocalId) { updateStatus('Connect your wallet.'); return }
    try {
      const result = await apiFetch('/paint/clear', { method: 'POST' })
      const ctx = contextRef.current
      if (ctx) {
        ctx.fillStyle = WHITE_HEX
        for (let i = 0; i < TOTAL_PIXELS; i++) {
          if (ownersRef.current[i] !== myLocalId || pixelsRef.current[i] === WHITE_INT) continue
          pixelsRef.current[i] = WHITE_INT
          ctx.fillRect(i % GRID_SIZE, Math.floor(i / GRID_SIZE), 1, 1)
        }
      }
      updateStatus(`Cleared ${result.cleared} pixels.`)
    } catch (err) { updateStatus('Error: ' + err.message) }
  }

  // --- Buy pixels by burning Solana SPL tokens ---
  const buySelectedPixels = async () => {
    if (!walletAddress || !isAuthenticated) { updateStatus('Connect and authenticate your wallet.'); return }
    if (selectionCountRef.current === 0) { updateStatus('Select at least 1 pixel.'); return }
    if (!signTransaction) { updateStatus('Wallet does not support transaction signing.'); return }

    const selectedPixels = []
    for (let i = 0; i < TOTAL_PIXELS; i++) {
      if (selectionMaskRef.current[i] !== 1 || ownersRef.current[i] !== 0) continue
      selectedPixels.push({ x: i % GRID_SIZE, y: Math.floor(i / GRID_SIZE) })
    }
    if (selectedPixels.length === 0) { clearSelection(); updateStatus('No available pixels in selection.'); return }

    setBuying(true)
    updateStatus(`Building burn transaction for ${selectedPixels.length} pixels...`)

    try {
      const amount = selectedPixels.length * PRICE_PER_PIXEL
      const senderATA = getAssociatedTokenAddressSync(TOKEN_MINT_PUBKEY, publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
      const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: publicKey })

      tx.add(createBurnInstruction(senderATA, TOKEN_MINT_PUBKEY, publicKey, amount, [], TOKEN_2022_PROGRAM_ID))

      updateStatus('Sign the burn transaction in your wallet...')
      const signed = await signTransaction(tx)

      updateStatus('Sending burn transaction...')
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })

      updateStatus(`Burn tx sent (${sig.slice(0, 8)}...). Awaiting confirmation...`)
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

      updateStatus('Burn confirmed. Recording purchase...')
      const result = await apiFetch('/purchase', { method: 'POST', body: JSON.stringify({ txSignature: sig, pixels: selectedPixels }) })

      // Update local state
      const localId = walletIdMap.get(walletAddress) || myLocalId
      for (const p of result.acquired) { ownersRef.current[p.y * GRID_SIZE + p.x] = localId }
      setOwnersSnapshot(new Int32Array(ownersRef.current))
      setPurchases((prev) => [{ txSignature: sig, pixelCount: result.pixelCount }, ...prev])
      clearSelection()
      updateStatus(`Purchase complete: ${result.pixelCount} pixels!` + (result.unavailable?.length > 0 ? ` (${result.unavailable.length} already taken)` : ''))
    } catch (err) {
      if (err.message?.includes('User rejected')) updateStatus('Transaction cancelled.')
      else updateStatus('Error during purchase: ' + err.message)
    } finally { setBuying(false) }
  }

  const switchTool = (t) => { if (t === TOOLS.media) clearBrushPreview(); setTool(t) }
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : null

  return (
    <>
      <div className="parallax-bg" aria-hidden="true">
        <div className="parallax-layer parallax-layer-1" style={{ backgroundImage: `url(${bg1})` }} />
        <div className="parallax-layer parallax-layer-2" style={{ backgroundImage: `url(${bg2})` }} />
        <div className="parallax-layer parallax-layer-3" style={{ backgroundImage: `url(${bg3})` }} />
        <div className="parallax-layer parallax-layer-4" style={{ backgroundImage: `url(${bg4})` }} />
        <div className="parallax-layer parallax-layer-5" style={{ backgroundImage: `url(${bg5})` }} />
      </div>
    <main className="page">
      <header className="topbar">
        <div className="title-wrap">
          <h1>Cripto Pixel</h1>
          <p>1,000,000 pixels (1000 x 1000) — 1 token per pixel, paid with Solana.</p>
        </div>

        <div className="account-panel">
          <WalletMultiButton />
          {walletAddress ? (
            <p className="account-stats">{shortWallet} — {activeAccountOwnedPixels} pixels owned{isAuthenticated ? '' : ' (authenticating...)'}</p>
          ) : (
            <p className="account-stats">Connect your Solana wallet to get started.</p>
          )}
        </div>

        <div className="controls">
          <div className="tool-group">
            <button type="button" className={tool === TOOLS.select ? 'active-tool' : ''} onClick={() => switchTool(TOOLS.select)}>Select to buy</button>
            <button type="button" className={tool === TOOLS.paint ? 'active-tool' : ''} onClick={() => switchTool(TOOLS.paint)}>Paint my pixels</button>
            <button type="button" className={tool === TOOLS.media ? 'active-tool' : ''} onClick={() => switchTool(TOOLS.media)}>Place GIF/Image</button>
            <button type="button" className={tool === TOOLS.linkButton ? 'active-tool' : ''} onClick={() => switchTool(TOOLS.linkButton)}>Place Button</button>
            <button type="button" className={showOwnedBlink ? 'active-tool' : ''} onClick={toggleOwnedBlink} disabled={!myLocalId || activeAccountOwnedPixels === 0}>{showOwnedBlink ? 'Stop blinking' : 'Blink my pixels'}</button>
          </div>

          <label className="field"><span>Color</span><input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} /></label>
          <button type="button" onClick={() => setBrushColor(WHITE_HEX)}>Eraser</button>

          <label className="field brush-field">
            <span>Brush: {brushShapeLabel} {brushSizeLabel}</span>
            <select value={brushShape} onChange={(e) => setBrushShape(e.target.value)}>
              <option value={BRUSH_SHAPES.square}>Square</option>
              <option value={BRUSH_SHAPES.circle}>Circle</option>
            </select>
            <input type="range" min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} step="1" value={brushSize} onChange={(e) => setBrushSize(clamp(Number(e.target.value), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE))} />
          </label>

          <label className="field zoom-field">
            <span>Zoom: {zoom}x</span>
            <input type="range" min="2" max="20" step="1" value={zoom} onChange={(e) => setZoom(clamp(Number(e.target.value), 2, 20))} />
          </label>

          <div className="field purchase-box">
            <span>Current purchase</span>
            <p className="purchase-summary">{selectionCount} pixels selected | Total: {selectionCount} tokens</p>
            <div className="purchase-actions">
              <button type="button" onClick={clearSelection} disabled={selectionCount === 0}>Clear selection</button>
              <button type="button" className="danger" onClick={buySelectedPixels} disabled={!isAuthenticated || selectionCount === 0 || buying}>{buying ? 'Buying...' : 'Buy selection'}</button>
            </div>
          </div>

          <div className="field media-field">
            <span>GIF/Image Media</span>
            <input ref={fileInputRef} type="file" accept="image/gif,image/*" onChange={handleMediaFileChange} style={{ display: 'none' }} />
            <div className="file-input-row">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!myLocalId || !canPlaceMediaByAreaRule || mediaSlotsRemaining <= 0}>Choose file</button>
              <span className="file-name-display">{normalizedMediaDraft?.fileName ?? 'No file chosen'}</span>
            </div>
            <p className="media-meta">{canPlaceMediaByAreaRule ? '23x23 rule unlocked.' : '23x23 rule locked: buy a 23x23 block.'}</p>
            <p className="media-meta">Slots: {mediaSlotsUsed}/{mediaSlotCapacity} used.</p>
            {myLocalId > 0 && <p className={`media-meta ${mediaSlotsRemaining > 0 ? 'media-ok' : 'media-error'}`}>{mediaSlotsRemaining > 0 ? `Can insert ${mediaSlotsRemaining} image(s).` : `Limit reached. Need ${pixelsMissingForNextMedia}px more.`}</p>}
            {normalizedMediaDraft && (
              <>
                <p className="media-meta">File: {normalizedMediaDraft.fileName} | ({normalizedMediaDraft.x},{normalizedMediaDraft.y}) | {normalizedMediaDraft.width}x{normalizedMediaDraft.height}</p>
                <div className="purchase-actions">
                  <button type="button" onClick={insertMediaAtDraft} disabled={!mediaDraftValidation.isValid}>Insert</button>
                  <button type="button" onClick={clearMediaDraft}>Cancel</button>
                  <button type="button" onClick={removeLastMediaFromActiveAccount} disabled={activeAccountMedia.length === 0}>Remove last</button>
                </div>
                <p className={`media-meta ${mediaDraftValidation.isValid ? 'media-ok' : 'media-error'}`}>{mediaDraftValidation.message}</p>
              </>
            )}
          </div>

          <div className="field button-field">
            <span>Link Button</span>
            <p className={`media-meta ${canUseLinkButtons ? 'media-ok' : 'media-error'}`}>{canUseLinkButtons ? `Unlocked (${activeAccountOwnedPixels}px).` : `Minimum ${MIN_PIXELS_FOR_LINK_BUTTON}px (need ${pixelsMissingForLinkButtons}px more).`}</p>
            <label className="field inline-field"><span>Text</span><input type="text" value={linkButtonTextInput} onChange={(e) => updateLinkButtonDraftText(e.target.value)} maxLength={60} placeholder="E.g.: Visit site" /></label>
            <label className="field inline-field"><span>Link</span><input type="text" value={linkButtonUrlInput} onChange={(e) => updateLinkButtonDraftUrl(e.target.value)} placeholder="https://yoursite.com" /></label>
            <div className="purchase-actions">
              <button type="button" onClick={createLinkButtonDraft} disabled={!myLocalId || !canUseLinkButtons}>Create draft</button>
              <button type="button" onClick={insertLinkButtonAtDraft} disabled={!normalizedLinkButtonDraft || !linkButtonDraftValidation.isValid}>Insert</button>
              <button type="button" onClick={clearLinkButtonDraft} disabled={!normalizedLinkButtonDraft}>Cancel</button>
              <button type="button" onClick={removeLastLinkButtonFromActiveAccount} disabled={activeAccountLinkButtons.length === 0}>Remove last</button>
            </div>
            {normalizedLinkButtonDraft && (
              <>
                <p className="media-meta">Draft: ({normalizedLinkButtonDraft.x},{normalizedLinkButtonDraft.y}) | {normalizedLinkButtonDraft.width}x{normalizedLinkButtonDraft.height}</p>
                <p className={`media-meta ${linkButtonDraftValidation.isValid ? 'media-ok' : 'media-error'}`}>{linkButtonDraftValidation.message}</p>
              </>
            )}
          </div>

          <button type="button" onClick={clearMyColors} disabled={!myLocalId}>Clear my colors</button>
        </div>
      </header>

      <section className="board-shell">
        <div className="board" role="application" aria-label="Pixel board">
          <div className="canvas-stack" style={canvasStackStyle}>
            <canvas ref={canvasRef} className="pixel-canvas" style={{ width: canvasStyleSize, height: canvasStyleSize }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopInteraction} onPointerCancel={handlePointerCancel} onPointerLeave={handlePointerLeave} onContextMenu={(e) => e.preventDefault()} />
            <canvas ref={ownedHighlightCanvasRef} className={`owned-highlight-canvas ${showOwnedBlink ? 'blink-active' : ''}`} style={{ width: canvasStyleSize, height: canvasStyleSize }} />
            {placedMedia.map((m) => (
              <img key={m.id} className="placed-media" src={m.url} alt="" draggable={false} style={{ left: `${(m.x / GRID_SIZE) * 100}%`, top: `${(m.y / GRID_SIZE) * 100}%`, width: `${(m.width / GRID_SIZE) * 100}%`, height: `${(m.height / GRID_SIZE) * 100}%` }} />
            ))}
            {normalizedMediaDraft && (
              <div className={`media-draft ${mediaDraftValidation.isValid ? 'media-draft-valid' : 'media-draft-invalid'}`} style={{ left: `${(normalizedMediaDraft.x / GRID_SIZE) * 100}%`, top: `${(normalizedMediaDraft.y / GRID_SIZE) * 100}%`, width: `${(normalizedMediaDraft.width / GRID_SIZE) * 100}%`, height: `${(normalizedMediaDraft.height / GRID_SIZE) * 100}%` }} onPointerDown={handleMediaDraftPointerDown} onPointerMove={handleMediaDraftPointerMove} onPointerUp={endMediaDraftInteraction} onPointerCancel={endMediaDraftInteraction}>
                <img src={normalizedMediaDraft.url} alt="" draggable={false} />
                {['nw','n','ne','e','se','s','sw','w'].map((h) => <span key={h} className={`media-handle media-handle-${h}`} data-handle={h} />)}
              </div>
            )}
            {placedLinkButtons.map((lb) => (
              <a key={lb.id} className="placed-link-button" href={lb.url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()} style={{ left: `${(lb.x / GRID_SIZE) * 100}%`, top: `${(lb.y / GRID_SIZE) * 100}%`, width: `${(lb.width / GRID_SIZE) * 100}%`, height: `${(lb.height / GRID_SIZE) * 100}%` }}>{lb.text}</a>
            ))}
            {normalizedLinkButtonDraft && (
              <div className={`link-button-draft ${linkButtonDraftValidation.isValid ? 'link-button-valid' : 'link-button-invalid'}`} style={{ left: `${(normalizedLinkButtonDraft.x / GRID_SIZE) * 100}%`, top: `${(normalizedLinkButtonDraft.y / GRID_SIZE) * 100}%`, width: `${(normalizedLinkButtonDraft.width / GRID_SIZE) * 100}%`, height: `${(normalizedLinkButtonDraft.height / GRID_SIZE) * 100}%` }} onPointerDown={handleLinkButtonDraftPointerDown} onPointerMove={handleLinkButtonDraftPointerMove} onPointerUp={endLinkButtonDraftInteraction} onPointerCancel={endLinkButtonDraftInteraction}>
                <span className="link-button-draft-text">{normalizedLinkButtonDraft.text || 'Button'}</span>
                {['nw','n','ne','e','se','s','sw','w'].map((h) => <span key={h} className={`media-handle media-handle-${h}`} data-handle={h} />)}
              </div>
            )}
            <canvas ref={selectionCanvasRef} className="selection-canvas" style={{ width: canvasStyleSize, height: canvasStyleSize }} />
            <div className="pixel-grid-overlay" />
            <canvas ref={previewCanvasRef} className="preview-canvas" style={{ width: canvasStyleSize, height: canvasStyleSize }} />
          </div>
        </div>
      </section>

      <section className="history">
        <h2>Purchase history</h2>
        {!walletAddress && <p>Connect your wallet to view purchases.</p>}
        {walletAddress && purchases.length === 0 && <p>No purchases recorded.</p>}
        {walletAddress && purchases.length > 0 && (
          <ul>
            {purchases.slice(0, 8).map((p, i) => (
              <li key={p.txSignature || i}>{p.pixelCount} pixels | <a href={`https://solscan.io/tx/${p.txSignature}`} target="_blank" rel="noopener noreferrer">{p.txSignature?.slice(0, 12)}...</a></li>
            ))}
          </ul>
        )}
      </section>

      <footer className="hint"><p>{status}</p></footer>
    </main>
    </>
  )
}

export default App
