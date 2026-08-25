import { useState, useRef } from 'react'
import { Upload, Sparkles, Trash2, Loader2 } from 'lucide-react'
import axios from 'axios'

/**
 * 左侧工具栏
 * - 上传图片到画布
 * - 文生图（prompt 输入框 + 生成按钮）
 * - 清空画布
 */
export default function Toolbar({ onAddImage, onTextToImage, onClear, loading }) {
  const [t2iPrompt, setT2iPrompt] = useState('')
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
      alert('上传失败: ' + (err.response?.data?.detail || err.message))
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
      await onTextToImage(t2iPrompt.trim())
    } finally {
      setGenerating(false)
    }
  }

  const isLoading = loading || generating

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
}
