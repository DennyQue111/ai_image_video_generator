import { useState, useEffect } from 'react'
import { Sparkles, Video, Scissors, Trash2, ArrowUp, FolderOpen } from 'lucide-react'
import axios from 'axios'

/**
 * 右侧属性面板
 * 选中画布元素时显示操作选项：
 * - 图生图：用选中的图作为源图，输入 prompt 生成新图
 * - 图生视频：用选中的图生成视频
 * - 图片拆分：使用 YOLO 提取人物与背景
 */
export default function RightPanel({
  selectedElement,
  selectedElements = [],
  loading,
  onImageToImage,
  onImageToVideo,
  onGenerateVideoPrompt,
  onYoloSplit,
  onUpscale,
  onSplit,
  onRefineAnalyze,
  onRefineGenerate,
  onModelViews,
  onRemove,
  onBringToFront,
}) {
  const [activeTab, setActiveTab] = useState('i2i')
  const [i2iSubTab, setI2iSubTab] = useState('preset') // 图生图子页签：preset / upscale / split / skill
  const [skillSubTab, setSkillSubTab] = useState('refine')
  const [i2iPrompt, setI2iPrompt] = useState('')
  const [i2iModel, setI2iModel] = useState('gemini-2.5-flash-image')
  const [i2iWidth, setI2iWidth] = useState(1024) // 图生图输出宽（像素 px）
  const [i2iHeight, setI2iHeight] = useState(1024) // 图生图输出高（像素 px）
  const [i2vPrompt, setI2vPrompt] = useState('')
  const [i2vDuration, setI2vDuration] = useState(5) // 视频时长（秒），范围 2-15

  // 放大子页签：放大倍数
  const [upscaleRatio, setUpscaleRatio] = useState(2)
  // 细化子页签：LLM 生成的提示词（null=未生成，字符串=已生成可编辑）
  const [refinePrompt, setRefinePrompt] = useState(null)
  const [modelViewInstruction, setModelViewInstruction] = useState('提取图片中的主要人物，生成这个人物的模型三视图。默认保留原图的图片风格。')
  // 图生视频：分辨率选择（16:9 或 9:16）
  const [i2vAspect, setI2vAspect] = useState('16:9')
  // 图生视频：模型版本选择（pruned 截肢版 | int8 完整版）
  const [i2vModel, setI2vModel] = useState('pruned')

  // 源文件真实分辨率
  const [naturalSize, setNaturalSize] = useState(null)

  useEffect(() => {
    setNaturalSize(null)
    if (!selectedElement?.src) return
    if (selectedElement.type === 'model') return
    if (selectedElement.type === 'video') {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        setNaturalSize({ w: v.videoWidth, h: v.videoHeight })
      }
      v.src = selectedElement.src
    } else {
      const img = new window.Image()
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      }
      img.src = selectedElement.src
    }
  }, [selectedElement?.src])

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

  return (
    <div className="right-panel">
      {/* 选中元素预览 */}
      <div style={{ textAlign: 'center' }}>
        {selectedElement.type === 'model' ? (
          <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', borderRadius: 8, color: '#cbd5e1', fontSize: 13 }}>
            3D 模型节点
          </div>
        ) : selectedElement.type === 'video' ? (
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
        <div style={{ fontSize: 11, color: '#777', marginTop: 4, textAlign: 'center' }}>
          {selectedElement.type === 'model'
            ? `${selectedElement.format?.toUpperCase() || '3D'} · ${selectedElement.sizeBytes ? `${(selectedElement.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '模型'}`
            : (naturalSize ? `${naturalSize.w} × ${naturalSize.h}` : '加载中...')}
        </div>
        {selectedElement.src && selectedElement.src.startsWith('/static/') && (
          <button
            className="canvas-btn"
            style={{ width: '100%', marginTop: 4, justifyContent: 'center', fontSize: 11, background: '#1a1a2e', color: '#ccc', border: '1px solid #3a3a5a' }}
            onClick={async () => {
              try {
                await axios.post('/api/open-in-folder', { url: selectedElement.src })
              } catch (err) {
                alert('打开文件夹失败: ' + (err?.response?.data?.detail || err.message))
              }
            }}
          >
            <FolderOpen size={12} /> 打开所在文件夹
          </button>
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
          className={`right-panel-tab ${activeTab === 'split' ? 'active' : ''}`}
          onClick={() => setActiveTab('split')}
        >
          图片拆分
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
              className={`right-panel-subtab ${i2iSubTab === 'skill' ? 'active' : ''}`}
              onClick={() => setI2iSubTab('skill')}
            >
              Skill
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

        </div>
      )}

      {/* Skill Tab */}
      {activeTab === 'i2i' && i2iSubTab === 'skill' && (
        <div>
          <div className="right-panel-subtabs">
            <div
              className={`right-panel-subtab ${skillSubTab === 'refine' ? 'active' : ''}`}
              onClick={() => setSkillSubTab('refine')}
            >
              细化
            </div>
            <div
              className={`right-panel-subtab ${skillSubTab === 'modelViews' ? 'active' : ''}`}
              onClick={() => setSkillSubTab('modelViews')}
            >
              模型三视图
            </div>
          </div>

          {skillSubTab === 'refine' && (
            <div>
              {multiCount > 1 && (
                <div style={{ color: '#f59e0b', fontSize: 11, marginBottom: 8 }}>
                  细化仅支持单图，请只选中一张图片。
                </div>
              )}
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

          {skillSubTab === 'modelViews' && (
            <div>
              <div className="panel-label">模型三视图要求</div>
              <textarea
                className="canvas-textarea"
                value={modelViewInstruction}
                onChange={(e) => setModelViewInstruction(e.target.value)}
                rows={6}
                style={{ marginTop: 4, fontSize: 12 }}
                placeholder="例如：提取图片中间的人物，生成这个人物的模型三视图；保留原图风格。"
              />
              <div style={{ color: '#777', fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                将按 9:16 生成正视图、侧视图、背视图。正视图提示词由 Qwen3-VL 生成，后两张使用固定视图提示词。
              </div>
              <button
                className="canvas-btn canvas-btn-success"
                style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
                disabled={loading || multiCount > 1 || !modelViewInstruction.trim()}
                onClick={() => onModelViews && onModelViews(modelViewInstruction)}
              >
                {loading ? '正在生成三视图...' : '生成模型三视图'}
              </button>
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
          <button
            className="canvas-btn"
            style={{ width: '100%', marginTop: 4, justifyContent: 'center', fontSize: 12, background: '#1a1a2e', color: '#fff', border: '1px solid #3a3a5a' }}
            disabled={loading || !selectedElement}
            onClick={async () => {
              const prompt = await onGenerateVideoPrompt(i2vPrompt)
              if (prompt) setI2vPrompt(prompt)
            }}
          >
            {loading ? '生成中...' : 'Qwen3 生成提示词'}
          </button>

          <div className="panel-label" style={{ marginTop: 10 }}>模型版本</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              className={`canvas-btn ${i2vModel === 'pruned' ? 'canvas-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
              onClick={() => setI2vModel('pruned')}
            >
              截肢版
            </button>
            <button
              className={`canvas-btn ${i2vModel === 'int8' ? 'canvas-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
              onClick={() => setI2vModel('int8')}
            >
              INT8 完整版
            </button>
          </div>

          <div className="panel-label" style={{ marginTop: 10 }}>分辨率</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              className={`canvas-btn ${i2vAspect === '16:9' ? 'canvas-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}
              onClick={() => setI2vAspect('16:9')}
            >
              16:9 横屏
            </button>
            <button
              className={`canvas-btn ${i2vAspect === '9:16' ? 'canvas-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}
              onClick={() => setI2vAspect('9:16')}
            >
              9:16 竖屏
            </button>
          </div>

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
            onClick={() => onImageToVideo(i2vPrompt, i2vDuration, i2vAspect, i2vModel)}
          >
            <Video size={16} /> {loading ? '生成中...' : (multiCount > 1 ? `多图生视频（${multiCount} 张）` : '图生视频')}
          </button>
        </div>
      )}

      {/* 图片拆分 Tab */}
      {activeTab === 'split' && (
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
            使用 YOLO 实例分割当前图片中的人物，生成“人物前景”和“透明背景”两个新节点。首次运行需要下载模型权重。
          </div>
          <button
            className="canvas-btn canvas-btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={loading}
            onClick={() => onYoloSplit && onYoloSplit(0.25)}
          >
            <Scissors size={16} /> {loading ? '拆分中...' : 'YOLO 拆分人物 / 背景'}
          </button>
          <div style={{ color: '#666', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            当前是基础测试：只提取 person 类别。复杂场景、多人遮挡和细发丝边缘可能需要后续调整模型或增加 SAM 精修。
          </div>
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
