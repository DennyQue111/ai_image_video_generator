import { useState, useRef } from 'react'
import { Loader2, Sparkles, Upload, X, Copy, Check, Wand2 } from 'lucide-react'
import axios from 'axios'
import '../styles/GeneratorCommon.css'

const STYLE_TYPE_COLORS = {
  realistic: {
    bg: 'rgba(59, 130, 246, 0.15)',
    color: '#60a5fa',
    border: 'rgba(59, 130, 246, 0.4)',
  },
  'artistic/animation': {
    bg: 'rgba(168, 85, 247, 0.15)',
    color: '#c084fc',
    border: 'rgba(168, 85, 247, 0.4)',
  },
  'graphic/other': {
    bg: 'rgba(249, 115, 22, 0.15)',
    color: '#fb923c',
    border: 'rgba(249, 115, 22, 0.4)',
  },
}

const STYLE_DETAIL_FIELDS = [
  { key: 'generalStyle', label: '总体风格' },
  { key: 'colors', label: '色彩' },
  { key: 'materialOrTextures', label: '材质纹理' },
  { key: 'lighting', label: '光照' },
  { key: 'cameraDetails', label: '相机参数' },
  { key: 'atmosphere', label: '氛围' },
]

const copyBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '12px',
}

const cardBoxStyle = {
  padding: '12px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  fontSize: '14px',
  lineHeight: 1.6,
}

export default function ImageToPrompt() {
  const [imagePreview, setImagePreview] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    const previewUrl = URL.createObjectURL(file)
    setImagePreview(previewUrl)
    setImageUrl('')

    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await axios.post('/api/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImageUrl(res.data.url)
    } catch (err) {
      setError(err.response?.data?.detail || '图片上传失败')
      setImagePreview('')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (file) await handleFile(file)
    e.target.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const removeImage = () => {
    setImagePreview('')
    setImageUrl('')
    setResult(null)
    setError('')
  }

  const handleCopy = async (text, field) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(''), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  const handleAnalyze = async () => {
    if (!imageUrl) {
      setError('请先上传图片并等待上传完成')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await axios.post('/api/gemini-image-to-prompt', {
        image: imageUrl,
        model: 'gemini-2.5-flash',
      })
      if (response.data.success) {
        setResult(response.data.data)
      } else {
        setError(response.data.error || '分析失败')
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const styleTypeStyle = result?.styleType
    ? STYLE_TYPE_COLORS[result.styleType] || STYLE_TYPE_COLORS['graphic/other']
    : null

  return (
    <div className="generator-page">
      <div className="generator-card">
        <h2 className="generator-card-title">
          <Wand2 size={20} />
          图生提示词
        </h2>

        {error && <div className="error-message">{error}</div>}

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">上传图片</label>
            {!imagePreview ? (
              <div
                className="image-upload-zone"
                style={
                  isDragging
                    ? { borderColor: 'var(--accent)', color: 'var(--text-primary)' }
                    : undefined
                }
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <Upload size={28} />
                <div>点击或拖拽上传图片</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  支持 PNG、JPG、WEBP
                </div>
              </div>
            ) : (
              <div className="image-preview-list">
                <div
                  className="image-preview-item"
                  style={{ width: 200, height: 200 }}
                >
                  <img src={imagePreview} alt="preview" />
                  {uploading && (
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
                    onClick={removeImage}
                    disabled={uploading}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="image-upload-input"
              accept="image/*"
              onChange={handleFileChange}
            />
          </div>
        </div>

        <button
          className="generate-btn"
          onClick={handleAnalyze}
          disabled={loading || uploading || !imageUrl}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Sparkles size={18} />
          )}
          {loading ? '分析中...' : '分析图片'}
        </button>
      </div>

      <div className="result-card">
        <h3 className="result-title">分析结果</h3>
        {loading ? (
          <div
            className="result-empty"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Loader2 className="animate-spin" size={24} />
            <div>正在调用 Gemini 分析图片...</div>
          </div>
        ) : !result ? (
          <div className="result-empty">暂无结果，上传图片后点击分析按钮</div>
        ) : (
          <>
            {result.styleType && (
              <div style={{ marginBottom: '16px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 12px',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: styleTypeStyle.bg,
                    color: styleTypeStyle.color,
                    border: `1px solid ${styleTypeStyle.border}`,
                  }}
                >
                  {result.styleType}
                </span>
              </div>
            )}

            {result.fullPrompt && (
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    className="form-label"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    完整提示词 (Full Prompt)
                  </span>
                  <button
                    style={copyBtnStyle}
                    onClick={() => handleCopy(result.fullPrompt, 'fullPrompt')}
                  >
                    {copiedField === 'fullPrompt' ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    {copiedField === 'fullPrompt' ? '已复制' : '复制'}
                  </button>
                </div>
                <div style={{ ...cardBoxStyle, whiteSpace: 'pre-wrap' }}>
                  {result.fullPrompt}
                </div>
              </div>
            )}

            {result.styleSignature && (
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    className="form-label"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    风格签名 (Style Signature)
                  </span>
                  <button
                    style={copyBtnStyle}
                    onClick={() =>
                      handleCopy(result.styleSignature, 'styleSignature')
                    }
                  >
                    {copiedField === 'styleSignature' ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    {copiedField === 'styleSignature' ? '已复制' : '复制'}
                  </button>
                </div>
                <div style={{ ...cardBoxStyle, fontFamily: 'monospace', fontSize: '13px' }}>
                  {result.styleSignature}
                </div>
              </div>
            )}

            {result.subjectDescription && (
              <div style={{ marginBottom: '16px' }}>
                <span
                  className="form-label"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: '8px',
                    display: 'block',
                  }}
                >
                  主体描述 (Subject)
                </span>
                <div style={cardBoxStyle}>{result.subjectDescription}</div>
              </div>
            )}

            {result.styleDetails && (
              <div>
                <span
                  className="form-label"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: '8px',
                    display: 'block',
                  }}
                >
                  风格细节 (Style Details)
                </span>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {STYLE_DETAIL_FIELDS.map(({ key, label }) => {
                    const value = result.styleDetails?.[key]
                    return (
                      <div key={key} style={cardBoxStyle}>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            marginBottom: '4px',
                          }}
                        >
                          {label}
                        </div>
                        <div style={{ lineHeight: 1.5, wordBreak: 'break-word' }}>
                          {value || '—'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
