import { useState, useRef } from 'react'
import { Upload, Sparkles, Trash2, Loader2 } from 'lucide-react'
import axios from 'axios'

// 统一格式化后端错误，避免 alert 显示 [object Object]
function formatErr(err) {
  const detail = err?.response?.data?.detail
  if (detail) {
    if (typeof detail === 'string') return detail
    try {
      return JSON.stringify(detail)
    } catch {
      return String(detail)
    }
  }
  return err?.message || String(err)
}

/**
 * 左侧工具栏
 * - 上传图片到画布
 * - 文生图（模型选择 + prompt 输入框 + 生成按钮）
 * - 清空画布
 */
export default function Toolbar({ onAddImage, onTextToImage, onClear, loading }) {
  const [t2iPrompt, setT2iPrompt] = useState('')
  const [t2iModel, setT2iModel] = useState('comfyui-flux2')
  const [t2iWidth, setT2iWidth] = useState(1024)
  const [t2iHeight, setT2iHeight] = useState(1024)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const fileInputRef = useRef(null)

  // 上传图片文件
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await axios.post('/api/upload-image', formData)
      if (res.data.url) {
        onAddImage({ src: res.data.url, width: 512, height: 512 })
      }
    } catch (err) {
      console.error('Upload failed:', err)
      alert('上传失败: ' + formatErr(err))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // 文生图
  const handleGenerate = async () => {
    if (!t2iPrompt.trim()) return
    setGenerating(true)
    try {
      await onTextToImage(t2iPrompt.trim(), t2iModel, t2iWidth, t2iHeight)
    } finally {
      setGenerating(false)
    }
  }

  const isLoading = loading || generating

  // 分辨率预设（单位：像素 px）
  const presets = [
    { label: '1:1', w: 1024, h: 1024 },
    { label: '16:9', w: 1344, h: 768 },
    { label: '9:16', w: 768, h: 1344 },
    { label: '1920×1080', w: 1920, h: 1080 },
  ]

  return (
    <div style={styles.toolbar}>
      {/* 上传图片 */}
      <button
        onClick={() => fileInputRef.current?.click()}
        style={styles.btnPrimary}
        disabled={uploading || isLoading}
        title="上传图片到画布"
      >
        {uploading ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
        <span>{uploading ? '上传中' : '上传图片'}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <div style={styles.divider} />

      {/* 文生图 */}
      <div style={styles.sectionLabel}>文生图</div>
      <select
        style={styles.select}
        value={t2iModel}
        onChange={(e) => setT2iModel(e.target.value)}
      >
        <optgroup label="ComfyUI 工作流">
          <option value="comfyui-flux2">Flux.2 Klein 9B FP8</option>
          <option value="comfyui-qwen-image">QwenImage 文生图</option>
        </optgroup>
        <optgroup label="Google Gemini">
          <option value="gemini-3.1-flash-lite-image">Gemini 3.1 Flash Lite（快速）</option>
          <option value="gemini-3.1-flash-image">Gemini 3.1 Flash（高质量）</option>
          <option value="gemini-3.1-pro-image">Gemini 3.1 Pro（最高质量）</option>
        </optgroup>
      </select>

      {/* 分辨率配置（单位：像素 px） */}
      <div style={styles.sizeRow}>
        <div style={styles.sizeField}>
          <label style={styles.sizeLabel}>宽 (px)</label>
          <input
            type="number"
            style={styles.sizeInput}
            value={t2iWidth}
            min={64}
            step={1}
            onChange={(e) => setT2iWidth(Math.max(64, parseInt(e.target.value) || 0))}
          />
        </div>
        <div style={styles.sizeField}>
          <label style={styles.sizeLabel}>高 (px)</label>
          <input
            type="number"
            style={styles.sizeInput}
            value={t2iHeight}
            min={64}
            step={1}
            onChange={(e) => setT2iHeight(Math.max(64, parseInt(e.target.value) || 0))}
          />
        </div>
      </div>
      <div style={styles.presetRow}>
        {presets.map((p) => (
          <button
            key={p.label}
            style={{
              ...styles.presetBtn,
              ...(t2iWidth === p.w && t2iHeight === p.h ? styles.presetBtnActive : {}),
            }}
            onClick={() => {
              setT2iWidth(p.w)
              setT2iHeight(p.h)
            }}
            title={`${p.w}×${p.h}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <textarea
        style={styles.textarea}
        placeholder="输入提示词生成图片..."
        value={t2iPrompt}
        onChange={(e) => setT2iPrompt(e.target.value)}
        rows={4}
      />
      <button
        onClick={handleGenerate}
        style={{ ...styles.btnPrimary, ...(isLoading ? styles.btnDisabled : {}) }}
        disabled={isLoading || !t2iPrompt.trim()}
      >
        {generating ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
        <span>{generating ? '生成中' : '生成'}</span>
      </button>

      <div style={styles.divider} />

      {/* 清空画布 */}
      <button onClick={onClear} style={styles.btnDanger} title="清空画布">
        <Trash2 size={18} />
        <span>清空</span>
      </button>

      {/* 底部填充 */}
      <div style={{ flex: 1 }} />
    </div>
  )
}

const styles = {
  toolbar: {
    width: 240,
    minWidth: 240,
    height: '100vh',
    background: '#1a1a2e',
    borderRight: '1px solid #2a2a4a',
    display: 'flex',
    flexDirection: 'column',
    padding: '12px',
    gap: '8px',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  btnPrimary: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'background 0.2s',
  },
  btnDanger: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  divider: {
    height: 1,
    background: '#2a2a4a',
    margin: '4px 0',
  },
  sectionLabel: {
    color: '#888',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  textarea: {
    width: '100%',
    background: '#0d0d1a',
    border: '1px solid #2a2a4a',
    borderRadius: '8px',
    color: '#e0e0e0',
    padding: '10px',
    fontSize: '13px',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
  },
  select: {
    width: '100%',
    background: '#0d0d1a',
    border: '1px solid #2a2a4a',
    borderRadius: '8px',
    color: '#e0e0e0',
    padding: '10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    cursor: 'pointer',
  },
  sizeRow: {
    display: 'flex',
    gap: 8,
  },
  sizeField: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sizeLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
  },
  sizeInput: {
    width: '100%',
    background: '#0d0d1a',
    border: '1px solid #2a2a4a',
    borderRadius: '6px',
    color: '#e0e0e0',
    padding: '8px',
    fontSize: 13,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
  },
  presetRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  presetBtn: {
    flex: 1,
    minWidth: 0,
    padding: '6px 4px',
    background: '#0d0d1a',
    color: '#aaa',
    border: '1px solid #2a2a4a',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  presetBtnActive: {
    background: '#3b82f6',
    color: '#fff',
    borderColor: '#3b82f6',
  },
}
