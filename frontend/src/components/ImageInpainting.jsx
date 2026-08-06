import { useState, useRef, useEffect } from 'react'
import {
  Loader2,
  Sparkles,
  Brush,
  Eraser,
  Upload,
  MoveHorizontal,
  Image as ImageIcon,
} from 'lucide-react'
import axios from 'axios'
import '../styles/GeneratorCommon.css'

const GEMINI_MODELS = [
  { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite (快速)' },
  { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash (高质量)' },
  { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro (旗舰)' },
  { value: 'imagen-3.0-generate-002', label: 'Imagen 3.0' },
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (兼容)' },
]

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4']

const toolbarBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text-primary)',
  fontSize: '13px',
  cursor: 'pointer',
}

export default function ImageInpainting() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(GEMINI_MODELS[0].value)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [brushSize, setBrushSize] = useState(30)
  const [baseImageSrc, setBaseImageSrc] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [comparePos, setComparePos] = useState(50)
  const [isDragging, setIsDragging] = useState(false)

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const fileInputRef = useRef(null)
  const compareRef = useRef(null)
  const isDrawingRef = useRef(false)
  const lastPosRef = useRef(null)

  // 初始化 / 重置 canvas：尺寸匹配显示区域，填充黑色（黑色=锁定，白色=修复）
  const setupCanvas = () => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const rect = img.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  // 窗口尺寸变化时重新匹配 canvas 并保留已绘内容
  useEffect(() => {
    if (!baseImageSrc) return
    const handleResize = () => {
      const img = imgRef.current
      const canvas = canvasRef.current
      if (!img || !canvas) return
      const rect = img.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (canvas.width === w && canvas.height === h) return
      const snapshot = document.createElement('canvas')
      snapshot.width = canvas.width
      snapshot.height = canvas.height
      snapshot.getContext('2d').drawImage(canvas, 0, 0)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(snapshot, 0, 0, w, h)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [baseImageSrc])

  const handleBaseImageUpload = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setBaseImageSrc(ev.target.result)
      setResult(null)
      setComparePos(50)
      setError('')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const clearMask = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const getPos = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    let clientX, clientY
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const drawDot = (x, y) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const drawLineTo = (from, to) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = 'white'
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const startDraw = (e) => {
    e.preventDefault()
    isDrawingRef.current = true
    const pos = getPos(e)
    lastPosRef.current = pos
    drawDot(pos.x, pos.y)
  }

  const moveDraw = (e) => {
    if (!isDrawingRef.current) return
    e.preventDefault()
    const pos = getPos(e)
    if (lastPosRef.current) {
      drawLineTo(lastPosRef.current, pos)
    } else {
      drawDot(pos.x, pos.y)
    }
    lastPosRef.current = pos
  }

  const endDraw = () => {
    isDrawingRef.current = false
    lastPosRef.current = null
  }

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入修复提示词')
      return
    }
    if (!baseImageSrc) {
      setError('请先上传底图')
      return
    }
    if (!canvasRef.current) {
      setError('画布未就绪')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const formData = {
        prompt,
        model,
        base_image: baseImageSrc,
        mask_image: canvasRef.current.toDataURL('image/png'),
        aspect_ratio: aspectRatio,
      }
      const response = await axios.post('/api/gemini-inpaint', formData)
      if (response.data.success) {
        setResult(response.data)
        setComparePos(50)
      } else {
        setError(response.data.error || '生成失败')
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  // ===== 对比滑块拖拽 =====
  const updateCompareFromEvent = (e) => {
    const container = compareRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    let clientX
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX
    } else {
      clientX = e.clientX
    }
    let pct = ((clientX - rect.left) / rect.width) * 100
    pct = Math.max(0, Math.min(100, pct))
    setComparePos(pct)
  }

  const startCompare = (e) => {
    e.preventDefault()
    setIsDragging(true)
    updateCompareFromEvent(e)
  }

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e) => {
      e.preventDefault()
      updateCompareFromEvent(e)
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging])

  return (
    <div className="generator-page">
      <div className="generator-card">
        <h2 className="generator-card-title">
          <Brush size={20} />
          Gemini 图像修复 (Inpainting)
        </h2>

        {error && <div className="error-message">{error}</div>}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">模型</label>
            <select
              className="form-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {GEMINI_MODELS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">比例</label>
            <select
              className="form-select"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">修复提示词</label>
            <textarea
              className="form-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述需要修复 / 重绘的区域内容..."
              rows={4}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">底图 & 遮罩绘制</label>

            {!baseImageSrc ? (
              <div
                className="image-upload-zone"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={28} />
                <div>点击上传底图</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  上传后在底图上用白色笔刷标记需要修复的区域
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    marginBottom: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Brush size={16} />
                    <input
                      type="range"
                      min={12}
                      max={80}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: '12px', minWidth: '44px' }}>
                      {brushSize}px
                    </span>
                  </div>
                  <button
                    type="button"
                    style={toolbarBtnStyle}
                    onClick={clearMask}
                  >
                    <Eraser size={14} />
                    清除遮罩
                  </button>
                  <button
                    type="button"
                    style={toolbarBtnStyle}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} />
                    更换底图
                  </button>
                </div>

                <div
                  ref={containerRef}
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    maxWidth: '100%',
                    lineHeight: 0,
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                  }}
                >
                  <img
                    ref={imgRef}
                    src={baseImageSrc}
                    alt="base"
                    onLoad={setupCanvas}
                    style={{
                      display: 'block',
                      maxWidth: '100%',
                      maxHeight: '500px',
                      height: 'auto',
                    }}
                  />
                  <canvas
                    ref={canvasRef}
                    onMouseDown={startDraw}
                    onMouseMove={moveDraw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    onTouchStart={startDraw}
                    onTouchMove={moveDraw}
                    onTouchEnd={endDraw}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      mixBlendMode: 'screen',
                      opacity: 0.7,
                      touchAction: 'none',
                      cursor: 'crosshair',
                    }}
                  />
                </div>

                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '8px',
                  }}
                >
                  白色 = 需修复区域，黑色 = 保留区域（mix-blend-mode: screen 半透明显示）
                </div>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              className="image-upload-input"
              accept="image/*"
              onChange={handleBaseImageUpload}
            />
          </div>
        </div>

        <button
          className="generate-btn"
          onClick={handleSubmit}
          disabled={loading || !baseImageSrc}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Sparkles size={18} />
          )}
          {loading ? '生成中...' : '生成修复'}
        </button>
      </div>

      <div className="result-card">
        <h3 className="result-title">生成结果</h3>
        {!result ? (
          <div className="result-empty">暂无结果，点击上方按钮生成</div>
        ) : (
          <>
            <div
              ref={compareRef}
              onMouseDown={startCompare}
              onTouchStart={startCompare}
              style={{
                position: 'relative',
                width: '100%',
                userSelect: 'none',
                cursor: 'ew-resize',
                borderRadius: 'var(--radius)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
              }}
            >
              {/* 底层：修复后图片（左侧显示） */}
              <img
                src={result.images[0].url}
                alt="result"
                draggable={false}
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
              {/* 叠加层：原图（右侧显示，按 comparePos 裁剪） */}
              <img
                src={baseImageSrc}
                alt="original"
                draggable={false}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  clipPath: `inset(0 0 0 ${comparePos}%)`,
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  padding: '2px 8px',
                  fontSize: '12px',
                  color: 'white',
                  background: 'rgba(0,0,0,0.5)',
                  borderRadius: '4px',
                  pointerEvents: 'none',
                }}
              >
                修复后
              </span>
              <span
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  padding: '2px 8px',
                  fontSize: '12px',
                  color: 'white',
                  background: 'rgba(0,0,0,0.5)',
                  borderRadius: '4px',
                  pointerEvents: 'none',
                }}
              >
                原图
              </span>
              {/* 可拖动分割线 */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${comparePos}%`,
                  width: '2px',
                  background: 'white',
                  transform: 'translateX(-1px)',
                  boxShadow: '0 0 6px rgba(0,0,0,0.5)',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#333',
                  }}
                >
                  <MoveHorizontal size={16} />
                </div>
              </div>
            </div>
            <div className="result-info">
              <div>模型: {result.model}</div>
              <div>文件名: {result.images[0].filename}</div>
              <div>URL: {result.images[0].url}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
