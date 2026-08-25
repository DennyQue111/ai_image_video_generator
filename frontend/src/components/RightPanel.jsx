import { useState } from 'react'
import { Sparkles, Video, ScanText, Trash2, Copy, ArrowUp } from 'lucide-react'

/**
 * 右侧属性面板
 * 选中画布元素时显示操作选项：
 * - 图生图：用选中的图作为源图，输入 prompt 生成新图
 * - 图生视频：用选中的图生成视频
 * - 分析：图生提示词，返回描述文本
 */
export default function RightPanel({
  selectedElement,
  loading,
  onImageToImage,
  onImageToVideo,
  onImageToPrompt,
  onRemove,
  onBringToFront,
}) {
  const [activeTab, setActiveTab] = useState('i2i')
  const [i2iPrompt, setI2iPrompt] = useState('')
  const [i2iModel, setI2iModel] = useState('gemini-2.5-flash-image')
  const [i2vPrompt, setI2vPrompt] = useState('')
  const [analyzedPrompt, setAnalyzedPrompt] = useState('')

  // 未选中元素时的空状态
  if (!selectedElement) {
    return (
      <div className="right-panel">
        <div style={{ color: '#555', textAlign: 'center', marginTop: '40%', fontSize: 14 }}>
          选中画布上的图片<br />查看操作选项
        </div>
      </div>
    )
  }

  const handleAnalyze = async () => {
    const result = await onImageToPrompt()
    if (result) setAnalyzedPrompt(result)
  }

  return (
    <div className="right-panel">
      {/* 选中元素预览 */}
      <div style={{ textAlign: 'center' }}>
        {selectedElement.type === 'video' ? (
          <video
            src={selectedElement.src}
            style={{ maxWidth: '100%', borderRadius: 8 }}
            controls
            muted
            loop
          />
        ) : (
          <img
            src={selectedElement.src}
            style={{ maxWidth: '100%', borderRadius: 8 }}
            alt="selected"
          />
        )}
      </div>

      {/* Tab 切换 */}
      <div className="right-panel-tabs">
        <div
          className={`right-panel-tab ${activeTab === 'i2i' ? 'active' : ''}`}
          onClick={() => setActiveTab('i2i')}
        >
          图生图
        </div>
        <div
          className={`right-panel-tab ${activeTab === 'i2v' ? 'active' : ''}`}
          onClick={() => setActiveTab('i2v')}
        >
          图生视频
        </div>
        <div
          className={`right-panel-tab ${activeTab === 'analyze' ? 'active' : ''}`}
          onClick={() => setActiveTab('analyze')}
        >
          分析
        </div>
      </div>

      {/* 图生图 Tab */}
      {activeTab === 'i2i' && (
        <div>
          <div className="panel-label">模型</div>
          <select
            className="canvas-input"
            value={i2iModel}
            onChange={(e) => setI2iModel(e.target.value)}
            style={{ marginTop: 4 }}
          >
            <option value="gemini-2.5-flash-image">Gemini 2.5 Flash（多图合成）</option>
            <option value="comfyui-qwen-image-edit">QwenImage Edit（单图编辑）</option>
            <option value="comfyui-flux-kontext">Flux Kontext（多图融合）</option>
          </select>

          <div className="panel-label" style={{ marginTop: 8 }}>提示词</div>
          <textarea
            className="canvas-textarea"
            placeholder="描述想要的编辑效果..."
            value={i2iPrompt}
            onChange={(e) => setI2iPrompt(e.target.value)}
            rows={4}
            style={{ marginTop: 4 }}
          />
          <button
            className="canvas-btn canvas-btn-primary"
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
            disabled={loading || !i2iPrompt.trim()}
            onClick={() => onImageToImage(i2iPrompt, i2iModel)}
          >
            <Sparkles size={16} /> {loading ? '生成中...' : '图生图'}
          </button>
        </div>
      )}

      {/* 图生视频 Tab */}
      {activeTab === 'i2v' && (
        <div>
          <div className="panel-label">提示词（可选）</div>
          <textarea
            className="canvas-textarea"
            placeholder="描述视频动作..."
            value={i2vPrompt}
            onChange={(e) => setI2vPrompt(e.target.value)}
            rows={3}
            style={{ marginTop: 4 }}
          />
          <button
            className="canvas-btn canvas-btn-success"
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
            disabled={loading}
            onClick={() => onImageToVideo(i2vPrompt)}
          >
            <Video size={16} /> {loading ? '生成中...' : '图生视频'}
          </button>
        </div>
      )}

      {/* 分析 Tab */}
      {activeTab === 'analyze' && (
        <div>
          <button
            className="canvas-btn canvas-btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={loading}
            onClick={handleAnalyze}
          >
            <ScanText size={16} /> {loading ? '分析中...' : '分析图片提示词'}
          </button>
          {analyzedPrompt && (
            <div style={{ marginTop: 8 }}>
              <div className="panel-label">分析结果</div>
              <textarea
                className="canvas-textarea"
                value={analyzedPrompt}
                readOnly
                rows={5}
                style={{ marginTop: 4 }}
              />
              <button
                className="canvas-btn canvas-btn-success"
                style={{ width: '100%', marginTop: 4, justifyContent: 'center' }}
                onClick={() => {
                  setI2iPrompt(analyzedPrompt)
                  setActiveTab('i2i')
                }}
              >
                <Copy size={16} /> 用此提示词做图生图
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* 底部元素操作 */}
      <button
        className="canvas-btn canvas-btn-primary"
        style={{ justifyContent: 'center' }}
        onClick={onBringToFront}
      >
        <ArrowUp size={16} /> 置顶
      </button>
      <button
        className="canvas-btn canvas-btn-danger"
        style={{ justifyContent: 'center' }}
        onClick={onRemove}
      >
        <Trash2 size={16} /> 删除
      </button>
    </div>
  )
}
