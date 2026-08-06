import { useState, useEffect, useRef } from 'react'
import { Loader2, Sparkles, Image as ImageIcon, X, Upload } from 'lucide-react'
import axios from 'axios'
import '../styles/GeneratorCommon.css'

const MODEL_OPTIONS = [
  {
    group: 'ComfyUI 工作流',
    options: [
      { value: 'comfyui-qwen-image-edit', label: 'QwenImage Edit（单图编辑）' },
    ],
  },
  {
    group: 'Google Gemini',
    options: [
      { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite (快速)' },
      { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash (高质量)' },
      { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro (旗舰)' },
      { value: 'imagen-3.0-generate-002', label: 'Imagen 3.0' },
      { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image（多图合成）' },
    ],
  },
]

export default function ImageToImage() {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [model, setModel] = useState('comfyui-qwen-image-edit')
  const [style, setStyle] = useState('')
  const [styles, setStyles] = useState([])
  const [images, setImages] = useState([]) // { file, url, description, uploading }
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const fileInputRef = useRef(null)

  useEffect(() => {
    axios.get('/api/styles').then((res) => {
      if (res.data.success) {
        setStyles(res.data.styles)
      }
    })
  }, [])

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return

    const newImages = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      description: '',
      uploading: true,
    }))

    setImages((prev) => [...prev, ...newImages])

    for (const img of newImages) {
      const formData = new FormData()
      formData.append('file', img.file)
      try {
        const res = await axios.post('/api/upload-image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        setImages((prev) =>
          prev.map((p) =>
            p.url === img.url
              ? { ...p, serverUrl: res.data.url, uploading: false }
              : p
          )
        )
      } catch (err) {
        setImages((prev) => prev.filter((p) => p.url !== img.url))
        setError(err.response?.data?.detail || `上传失败: ${img.file.name}`)
      }
    }
  }

  const removeImage = (url) => {
    setImages((prev) => prev.filter((p) => p.url !== url))
  }

  const updateDescription = (url, description) => {
    setImages((prev) =>
      prev.map((p) => (p.url === url ? { ...p, description } : p))
    )
  }

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入 prompt')
      return
    }
    const readyImages = images.filter((img) => img.serverUrl && !img.uploading)
    if (!readyImages.length) {
      setError('请至少上传一张图片并等待上传完成')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await axios.post('/api/image-to-image', {
        prompt,
        negative_prompt: negativePrompt,
        model,
        style,
        aspect_ratio: isGemini ? aspectRatio : undefined,
        images: readyImages.map((img) => ({
          url: img.serverUrl,
          description: img.description,
        })),
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

  const isGemini = model.startsWith('gemini') || model.startsWith('imagen')

  return (
    <div className="generator-page">
      <div className="generator-card">
        <h2 className="generator-card-title">
          <ImageIcon size={20} />
          图生图
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

        {isGemini && (
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
            <label className="form-label">编辑要求 / 总体描述</label>
            <textarea
              className="form-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想如何修改或合成图片..."
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

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">参考图片</label>
            <div
              className="image-upload-zone"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={28} />
              <div>点击上传图片</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>
                支持 PNG、JPG、WEBP
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="image-upload-input"
              accept="image/*"
              multiple
              onChange={handleFileChange}
            />

            <div className="image-preview-list">
              {images.map((img) => (
                <div key={img.url} className="image-preview-item">
                  <img src={img.url} alt="preview" />
                  {img.uploading && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Loader2 className="animate-spin" color="white" />
                    </div>
                  )}
                  <button
                    className="image-preview-remove"
                    onClick={() => removeImage(img.url)}
                    disabled={img.uploading}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {images.length > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {images.map((img, idx) => (
                  <input
                    key={img.url}
                    type="text"
                    className="form-input"
                    placeholder={`图片 ${idx + 1} 描述（可选）`}
                    value={img.description}
                    onChange={(e) => updateDescription(img.url, e.target.value)}
                    disabled={img.uploading}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <button className="generate-btn" onClick={handleSubmit} disabled={loading || images.some((i) => i.uploading)}>
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
