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
  selectedElements = [],
  loading,
  onImageToImage,
  onImageToVideo,
  onImageToPrompt,
  onUpscale,
  onSplit,
  onRefineAnalyze,
  onRefineGenerate,
  onRemove,
  onBringToFront,
}) {
  const [activeTab, setActiveTab] = useState('i2i')
  const [i2iSubTab, setI2iSubTab] = useState('preset') // 图生图子页签：preset / upscale / split / refine
  const [i2iPrompt, setI2iPrompt] = useState('')
  const [i2iModel, setI2iModel] = useState('gemini-2.5-flash-image')
  const [i2iWidth, setI2iWidth] = useState(1024) // 图生图输出宽（像素 px）
  const [i2iHeight, setI2iHeight] = useState(1024) // 图生图输出高（像素 px）
  const [i2vPrompt, setI2vPrompt] = useState('')
  const [i2vDuration, setI2vDuration] = useState(5) // 视频时长（秒），范围 2-15
  const [analyzedPrompt, setAnalyzedPrompt] = useState('')

  // 放大子页签：放大倍数
  const [upscaleRatio, setUpscaleRatio] = useState(2)
  // 细化子页签：LLM 生成的提示词（null=未生成，字符串=已生成可编辑）
  const [refinePrompt, setRefinePrompt] = useState(null)

  const multiCount = selectedElements.length

  // 图生图分辨率预设（单位：像素 px），与文生图一致
  const i2iPresets = [
    { label: '1:1', w: 1024, h: 1024 },
    { label: '16:9', w: 1344, h: 768 },
    { label: '9:16', w: 768, h: 1344 },
    { label: '1920×1080', w: 1920, h: 1080 },
  ]

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
          {/* 子页签切换：预设 / 放大 */}
          <div className="right-panel-subtabs">
            <div
              className={`right-panel-subtab ${i2iSubTab === 'preset' ? 'active' : ''}`}
              onClick={() => setI2iSubTab('preset')}
            >
              预设
            </div>
            <div
              className={`right-panel-subtab ${i2iSubTab === 'upscale' ? 'active' : ''}`}
              onClick={() => setI2iSubTab('upscale')}
            >
              放大
            </div>
            <div
              className={`right-panel-subtab ${i2iSubTab === 'split' ? 'active' : ''}`}
              onClick={() => setI2iSubTab('split')}
            >
              分割
            </div>
            <div
              className={`right-panel-subtab ${i2iSubTab === 'refine' ? 'active' : ''}`}
              onClick={() => setI2iSubTab('refine')}
            >
              细化
            </div>
          </div>

          {/* 选中数量提示 */}
          <div style={{
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            background: multiCount > 1 ? 'rgba(59,130,246,0.15)' : 'rgba(45,45,74,0.4)',
            color: multiCount > 1 ? '#60a5fa' : '#888',
            border: `1px solid ${multiCount > 1 ? '#3b82f6' : '#2a2a4a'}`,
            marginBottom: 8,
          }}>
            {multiCount > 1
              ? `已选 ${multiCount} 张图 · 多图融合模式`
              : '已选 1 张图 · 单图编辑模式'}
          </div>

          {i2iSubTab === 'preset' && (
            <>
          <div className="panel-label">模型</div>
          <select
            className="canvas-input"
            value={i2iModel}
            onChange={(e) => setI2iModel(e.target.value)}
            style={{ marginTop: 4 }}
          >
            <option value="gemini-2.5-flash-image">Gemini 2.5 Flash（多图合成）</option>
            <option value="comfyui-qwen-image-edit">QwenImage Edit（单图编辑）</option>
            <option value="comfyui-flux-kontext">Flux.2 Klein 多图编辑</option>
          </select>
          {multiCount > 1 && i2iModel === 'comfyui-qwen-image-edit' && (
            <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 4 }}>
              QwenImage Edit 仅支持单图，多图请选 Gemini 或 Flux.2 多图编辑
            </div>
          )}

          <div className="panel-label" style={{ marginTop: 8 }}>提示词</div>
          <textarea
            className="canvas-textarea"
            placeholder="描述想要的编辑效果..."
            value={i2iPrompt}
            onChange={(e) => setI2iPrompt(e.target.value)}
            rows={4}
            style={{ marginTop: 4 }}
          />

          {/* 分辨率配置（单位：像素 px），与文生图一致 */}
          <div className="panel-label" style={{ marginTop: 8 }}>输出尺寸 (px)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>宽</label>
              <input
                type="number"
                className="canvas-input"
                value={i2iWidth}
                min={64}
                step={1}
                onChange={(e) => setI2iWidth(Math.max(64, parseInt(e.target.value) || 0))}
                style={{ marginTop: 2 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>高</label>
              <input
                type="number"
                className="canvas-input"
                value={i2iHeight}
                min={64}
                step={1}
                onChange={(e) => setI2iHeight(Math.max(64, parseInt(e.target.value) || 0))}
                style={{ marginTop: 2 }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {i2iPresets.map((p) => (
              <button
                key={p.label}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '6px 4px',
                  background: i2iWidth === p.w && i2iHeight === p.h ? '#3b82f6' : '#0d0d1a',
                  color: i2iWidth === p.w && i2iHeight === p.h ? '#fff' : '#aaa',
                  border: `1px solid ${i2iWidth === p.w && i2iHeight === p.h ? '#3b82f6' : '#2a2a4a'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                  transition: 'all 0.15s',
                }}
                title={`${p.w}×${p.h}`}
                onClick={() => { setI2iWidth(p.w); setI2iHeight(p.h) }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            className="canvas-btn canvas-btn-primary"
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
            disabled={loading || !i2iPrompt.trim() || (multiCount > 1 && i2iModel === 'comfyui-qwen-image-edit')}
            onClick={() => onImageToImage(i2iPrompt, i2iModel, i2iWidth, i2iHeight)}
          >
            <Sparkles size={16} /> {loading ? '生成中...' : (multiCount > 1 ? `多图融合（${multiCount} 张）` : '图生图')}
          </button>
            </>
          )}

          {/* 放大子页签：选中单图 → 一键超清放大 */}
          {i2iSubTab === 'upscale' && (
            <div>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                background: 'rgba(45,45,74,0.4)',
                color: '#aaa',
                border: '1px solid #2a2a4a',
                marginBottom: 8,
                lineHeight: 1.6,
              }}>
                使用 SeedVR2 对当前选中图片进行超清放大，保留原始结构细节。
              </div>

              <div className="panel-label">放大倍数</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {[2, 3, 4].map((r) => (
                  <button
                    key={r}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      background: upscaleRatio === r ? '#3b82f6' : '#0d0d1a',
                      color: upscaleRatio === r ? '#fff' : '#aaa',
                      border: `1px solid ${upscaleRatio === r ? '#3b82f6' : '#2a2a4a'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      transition: 'all 0.15s',
                    }}
                    onClick={() => setUpscaleRatio(r)}
                  >
                    {r}×
                  </button>
                ))}
              </div>

              {multiCount > 1 && (
                <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 8 }}>
                  放大仅支持单图，请只选中一张图片。
                </div>
              )}

              <div style={{ color: '#666', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                倍数越高越吃显存，12GB 建议 2×。大图（短边超过 768）会被自动限制到安全分辨率以防崩溃。放大后结果作为新节点连到原图。
              </div>

              <button
                className="canvas-btn canvas-btn-success"
                style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
                disabled={loading || multiCount > 1}
                onClick={() => onUpscale && onUpscale(upscaleRatio)}
              >
                {loading ? '放大中...' : '一键超清放大'}
              </button>
            </div>
          )}

          {/* 分割子页签：选中单图 → 1分4 → 4 块自动连线到原图 */}
          {i2iSubTab === 'split' && (
            <div>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                background: 'rgba(45,45,74,0.4)',
                color: '#aaa',
                border: '1px solid #2a2a4a',
                marginBottom: 8,
                lineHeight: 1.6,
              }}>
                将当前图片按 2×2 网格平均切成 4 块，每块作为独立节点。适用于 HDR 场景图分块后再逐块放大。
              </div>

              {multiCount > 1 && (
                <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 8 }}>
                  分割仅支持单图，请只选中一张图片。
                </div>
              )}

              <button
                className="canvas-btn canvas-btn-primary"
                style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
                disabled={loading || multiCount > 1}
                onClick={() => onSplit && onSplit()}
              >
                1分4
              </button>
            </div>
          )}

          {/* 细化子页签：第一步 Qwen3-VL 分析 → 第二步 用户编辑提示词 → Flux.2 生图 */}
          {i2iSubTab === 'refine' && (
            <div>
              {multiCount > 1 && (
                <div style={{ color: '#f59e0b', fontSize: 11, marginBottom: 8 }}>
                  细化仅支持单图，请只选中一张图片。
                </div>
              )}

              {/* 第一步：生成提示词 */}
              <button
                className="canvas-btn canvas-btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={loading || multiCount > 1}
                onClick={async () => {
                  const prompt = await onRefineAnalyze()
                  if (prompt) setRefinePrompt(prompt)
                }}
              >
                {loading ? '分析中...' : '生成细化提示词'}
              </button>

              {/* 第二步：可编辑提示词 + 提交生图 */}
              {refinePrompt !== null && (
                <>
                  <div className="panel-label" style={{ marginTop: 8 }}>细化提示词（可编辑）</div>
                  <textarea
                    className="canvas-textarea"
                    value={refinePrompt}
                    onChange={(e) => setRefinePrompt(e.target.value)}
                    rows={6}
                    style={{ marginTop: 4, fontSize: 12 }}
                  />
                  <button
                    className="canvas-btn canvas-btn-success"
                    style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}
                    disabled={loading || !refinePrompt.trim()}
                    onClick={() => onRefineGenerate && onRefineGenerate(refinePrompt)}
                  >
                    {loading ? '生成中...' : '提交 Flux 细化'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 图生视频 Tab */}
      {activeTab === 'i2v' && (
        <div>
          {/* 选中数量提示 */}
          <div style={{
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            background: multiCount > 1 ? 'rgba(59,130,246,0.15)' : 'rgba(45,45,74,0.4)',
            color: multiCount > 1 ? '#60a5fa' : '#888',
            border: `1px solid ${multiCount > 1 ? '#3b82f6' : '#2a2a4a'}`,
            marginBottom: 8,
          }}>
            {multiCount > 1
              ? `已选 ${multiCount} 张图 · 多参考图模式（最多 9 张）`
              : '已选 1 张图 · 单图生视频'}
          </div>

          <div className="panel-label">提示词（可选）</div>
          <textarea
            className="canvas-textarea"
            placeholder="描述视频动作..."
            value={i2vPrompt}
            onChange={(e) => setI2vPrompt(e.target.value)}
            rows={3}
            style={{ marginTop: 4 }}
          />

          <div className="panel-label" style={{ marginTop: 10 }}>视频时长（秒）</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input
              type="range"
              min={2}
              max={15}
              step={1}
              value={i2vDuration}
              onChange={(e) => setI2vDuration(parseInt(e.target.value))}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <span style={{ color: '#e0e0e0', fontSize: 14, minWidth: 32, textAlign: 'right' }}>
              {i2vDuration}s
            </span>
          </div>
          <input
            type="number"
            className="canvas-input"
            min={2}
            max={15}
            step={1}
            value={i2vDuration}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              if (!isNaN(v)) setI2vDuration(Math.min(15, Math.max(2, v)))
            }}
            style={{ marginTop: 4 }}
          />
          <div style={{ color: '#888', fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
            范围 2–15 秒。时长越长越容易 OOM，12GB 显存建议 ≤8s，9s 以上请谨慎尝试。
          </div>

          <button
            className="canvas-btn canvas-btn-success"
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
            disabled={loading}
            onClick={() => onImageToVideo(i2vPrompt, i2vDuration)}
          >
            <Video size={16} /> {loading ? '生成中...' : (multiCount > 1 ? `多图生视频（${multiCount} 张）` : '图生视频')}
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

      <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px solid #2a2a4a' }} />

      {/* 元素操作 */}
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
