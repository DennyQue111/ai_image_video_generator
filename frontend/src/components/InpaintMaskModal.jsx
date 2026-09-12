import { useEffect, useRef, useState } from 'react'
import { Brush, Eraser, Sparkles, X } from 'lucide-react'

const align16 = (value) => Math.max(256, Math.round(value / 16) * 16)

export default function InpaintMaskModal({ imageUrl, loading, onClose, onGenerate }) {
  const imageRef = useRef(null)
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastRef = useRef(null)
  const [prompt, setPrompt] = useState('')
  const [brushSize, setBrushSize] = useState(36)
  const [erasing, setErasing] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ width: 1024, height: 1024 })

  useEffect(() => {
    const stop = () => { drawingRef.current = false; lastRef.current = null }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  const setupCanvas = () => {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!image || !canvas) return
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
  }

  const point = (event) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
      scale: canvas.width / rect.width,
    }
  }

  const paint = (from, to) => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#ef4444'
    ctx.fillStyle = '#ef4444'
    ctx.lineWidth = brushSize * to.scale
    ctx.lineCap = 'round'
    if (from) {
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke()
    } else {
      ctx.beginPath(); ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
    if (!erasing) setHasMask(true)
  }

  const onPointerDown = (event) => {
    event.preventDefault()
    drawingRef.current = true
    const next = point(event)
    paint(null, next)
    lastRef.current = next
  }
  const onPointerMove = (event) => {
    if (!drawingRef.current) return
    event.preventDefault()
    const next = point(event)
    paint(lastRef.current, next)
    lastRef.current = next
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas?.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasMask(false)
  }

  const exportMask = () => {
    const visible = canvasRef.current
    const strokes = document.createElement('canvas')
    strokes.width = visible.width
    strokes.height = visible.height
    const strokesCtx = strokes.getContext('2d')
    strokesCtx.drawImage(visible, 0, 0)
    // 先利用可视红色笔迹的 alpha 生成纯白笔迹，再叠到黑色背景上。
    strokesCtx.globalCompositeOperation = 'source-in'
    strokesCtx.fillStyle = '#fff'
    strokesCtx.fillRect(0, 0, strokes.width, strokes.height)

    const mask = document.createElement('canvas')
    mask.width = visible.width
    mask.height = visible.height
    const ctx = mask.getContext('2d')
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, mask.width, mask.height)
    ctx.drawImage(strokes, 0, 0)
    return mask.toDataURL('image/png')
  }

  const submit = async () => {
    if (!prompt.trim() || !hasMask) return
    let width = naturalSize.width
    let height = naturalSize.height
    const maxSide = Math.max(width, height)
    if (maxSide > 1536) {
      const ratio = 1536 / maxSide
      width *= ratio; height *= ratio
    }
    await onGenerate({ prompt: prompt.trim(), maskImage: exportMask(), width: align16(width), height: align16(height) })
  }

  return (
    <div className="inpaint-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose() }}>
      <div className="inpaint-modal">
        <div className="inpaint-modal-header"><b>FLUX.2 Inpainting</b><button onClick={onClose} disabled={loading}><X size={18} /></button></div>
        <div className="inpaint-toolbar">
          <label><Brush size={15} /> 笔刷 <input type="range" min="8" max="120" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} /> {brushSize}px</label>
          <button className={!erasing ? 'active' : ''} onClick={() => setErasing(false)}><Brush size={14} /> 绘制</button>
          <button className={erasing ? 'active' : ''} onClick={() => setErasing(true)}><Eraser size={14} /> 擦除</button>
          <button onClick={clear}>清除 Mask</button>
        </div>
        <div className="inpaint-stage">
          <div className="inpaint-image-wrap">
            <img ref={imageRef} src={imageUrl} alt="inpaint source" onLoad={setupCanvas} draggable={false} />
            <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} />
          </div>
        </div>
        <div className="inpaint-footer">
          <textarea className="canvas-textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述白色 Mask 区域要生成什么，例如：移除人物并自然补全背景" />
          <div className="inpaint-help">红色区域会被重绘，其他区域保持原图。</div>
          <button className="canvas-btn canvas-btn-primary" disabled={loading || !hasMask || !prompt.trim()} onClick={submit}><Sparkles size={16} /> {loading ? '重绘中...' : '开始 Inpainting'}</button>
        </div>
      </div>
    </div>
  )
}
