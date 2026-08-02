import { useState, useEffect, useRef } from 'react'
import { Loader2, Film, Upload, X } from 'lucide-react'
import axios from 'axios'
import '../styles/GeneratorCommon.css'

const MODEL_OPTIONS = [
  {
    group: 'ComfyUI 工作流',
    options: [
      { value: 'comfyui-ltx', label: 'LTX 2.3 图生视频' },
    ],
  },
]

export default function ImageToVideo() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('comfyui-ltx')
  const [firstFrameUrl, setFirstFrameUrl] = useState('')
  const [firstFramePreview, setFirstFramePreview] = useState('')
  const [dialogue, setDialogue] = useState('')
  const [voiceInstruct, setVoiceInstruct] = useState('')
  const [duration, setDuration] = useState(0)
  const [fps, setFps] = useState(24)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    setError('')
    const previewUrl = URL.createObjectURL(file)
    setFirstFramePreview(previewUrl)

    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await axios.post('/api/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setFirstFrameUrl(res.data.url)
    } catch (err) {
      setError(err.response?.data?.detail || '首帧图片上传失败')
      setFirstFramePreview('')
    } finally {
      setUploading(false)
    }
  }

  const removeImage = () => {
    setFirstFrameUrl('')
    setFirstFramePreview('')
  }

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入视频 prompt')
      return
    }
    if (!firstFrameUrl) {
      setError('请上传首帧图片')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await axios.post('/api/image-to-video', {
        prompt,
        first_frame_image: firstFrameUrl,
        model,
        dialogue,
        voice_instruct: voiceInstruct,
        duration,
        fps,
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

  return (
    <div className="generator-page">
      <div className="generator-card">
        <h2 className="generator-card-title">
          <Film size={20} />
          图生视频
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
            <label className="form-label">首帧图片</label>
            {!firstFramePreview ? (
              <div
                className="image-upload-zone"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={28} />
                <div>点击上传首帧图片</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  支持 PNG、JPG、WEBP
                </div>
              </div>
            ) : (
              <div className="image-preview-list">
                <div className="image-preview-item" style={{ width: 160, height: 160 }}>
                  <img src={firstFramePreview} alt="first frame" />
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

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">视频 Prompt（英文）</label>
            <textarea
              className="form-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述视频画面的运动、镜头、氛围..."
              rows={4}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">对白（可选，会生成 TTS 音频）</label>
            <input
              type="text"
              className="form-input"
              value={dialogue}
              onChange={(e) => setDialogue(e.target.value)}
              placeholder="输入中文对白..."
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group full">
            <label className="form-label">声音描述（可选）</label>
            <input
              type="text"
              className="form-input"
              value={voiceInstruct}
              onChange={(e) => setVoiceInstruct(e.target.value)}
              placeholder="例如：20多岁女性的声音..."
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">时长（秒，0 为工作流默认）</label>
            <input
              type="number"
              step="0.5"
              className="form-input"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">帧率</label>
            <input
              type="number"
              className="form-input"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            />
          </div>
        </div>

        <button className="generate-btn" onClick={handleSubmit} disabled={loading || uploading}>
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Film size={18} />}
          {loading ? '生成中...' : '生成视频'}
        </button>
      </div>

      <div className="result-card">
        <h3 className="result-title">生成结果</h3>
        {!result ? (
          <div className="result-empty">暂无结果，点击上方按钮生成</div>
        ) : (
          <>
            <div className="result-media">
              <video
                src={result.videos[0].url}
                controls
                loop
                className="result-video"
              />
            </div>
            <div className="result-info">
              <div>模型: {result.model}</div>
              <div>文件名: {result.videos[0].filename}</div>
              <div>URL: {result.videos[0].url}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
