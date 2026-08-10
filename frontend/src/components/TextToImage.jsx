import { useState, useEffect } from 'react'
import { Loader2, Sparkles, Image as ImageIcon } from 'lucide-react'
import axios from 'axios'
import '../styles/GeneratorCommon.css'

const MODEL_OPTIONS = [
  {
    group: 'ComfyUI 工作流',
    options: [
      { value: 'comfyui-qwen-image', label: 'QwenImage 文生图' },
      { value: 'comfyui-flux-dev', label: 'Flux.1 Dev FP8（高质量，非商用）' },
      { value: 'comfyui-flux-schnell', label: 'Flux.1 Schnell FP8（快速，可商用）' },
    ],
  },
  {
    group: 'Google Gemini',
    options: [
      { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite (快速)' },
      { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash (高质量)' },
      { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro (旗舰)' },
      { value: 'imagen-3.0-generate-002', label: 'Imagen 3.0' },
      { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (兼容)' },
    ],
  },
]

export default function TextToImage() {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [model, setModel] = useState('comfyui-qwen-image')
  const [style, setStyle] = useState('')
  const [styles, setStyles] = useState([])
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const [steps, setSteps] = useState(8)
  const [cfg, setCfg] = useState(1.0)
  const [seed, setSeed] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')

  useEffect(() => {
    axios.get('/api/styles').then((res) => {
      if (res.data.success) {
        setStyles(res.data.styles)
      }
    })
  }, [])

  // 切换模型时，设置合适的 ComfyUI 参数默认值
  useEffect(() => {
    if (model === 'comfyui-flux-dev') {
      setSteps(20)
      setCfg(1.0)
    } else if (model === 'comfyui-flux-schnell') {
      setSteps(4)
      setCfg(0)
    } else if (model === 'comfyui-qwen-image') {
      setSteps(8)
      setCfg(1.0)
    }
  }, [model])

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入 prompt')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await axios.post('/api/text-to-image', {
        prompt,
        negative_prompt: negativePrompt,
        model,
        style,
        width,
        height,
        steps,
        cfg,
        seed,
        aspect_ratio: isComfyUI ? undefined : aspectRatio,
      })
      if (response.data.success) {
        setResult(response.data)
      } else {
        setError(response.data.error || '生成失败')
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const isComfyUI = model.startsWith('comfyui')

  return (
    <div className="generator-page">
      <div className="generator-card">
        <h2 className="generator-card-title">
          <ImageIcon size={20} />
          文生图
        </h2>

        {error && <div className="error-message">{error}</div>}

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">模型</label>
            <select className="form-select" value={model} onChange={(e) => setModel(e.target.value)}>
              {MODEL_OPTIONS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">风格</label>
            <select className="form-select" value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="">无风格</option>
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">Prompt</label>
            <textarea
              className="form-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的图片..."
              rows={4}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">Negative Prompt</label>
            <textarea
              className="form-textarea"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="不想出现的内容..."
              rows={2}
            />
          </div>
        </div>

        {isComfyUI && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">宽度</label>
              <input
                type="number"
                className="form-input"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">高度</label>
              <input
                type="number"
                className="form-input"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">步数</label>
              <input
                type="number"
                className="form-input"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                disabled={model === 'comfyui-flux-schnell'}
              />
            </div>
            <div className="form-group">
              <label className="form-label">CFG</label>
              <input
                type="number"
                step="0.1"
                className="form-input"
                value={cfg}
                onChange={(e) => setCfg(Number(e.target.value))}
                disabled={model === 'comfyui-flux-schnell'}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Seed (-1 随机)</label>
              <input
                type="number"
                className="form-input"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        {!isComfyUI && (
          <div className="form-row">
            <div className="form-group full">
              <label className="form-label">比例</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['1:1', '16:9', '9:16', '4:3', '3:4'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`form-select ${aspectRatio === r ? 'active' : ''}`}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: aspectRatio === r ? '1px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: aspectRatio === r ? 'var(--accent)' : 'var(--bg-primary)',
                      color: aspectRatio === r ? 'white' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                    onClick={() => setAspectRatio(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <button className="generate-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
          {loading ? '生成中...' : '生成图片'}
        </button>
      </div>

      <div className="result-card">
        <h3 className="result-title">生成结果</h3>
        {!result ? (
          <div className="result-empty">暂无结果，点击上方按钮生成</div>
        ) : (
          <>
            <div className="result-media">
              <img
                src={result.images[0].url}
                alt={result.images[0].filename}
                className="result-image"
              />
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
