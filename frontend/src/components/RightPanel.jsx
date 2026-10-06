import { useState, useEffect } from 'react'
import { Sparkles, Video, Scissors, Trash2, ArrowUp, FolderOpen, Camera, Brush } from 'lucide-react'
import axios from 'axios'
import InpaintMaskModal from './InpaintMaskModal'

const DIRECTOR_KINDS = { wall: '墙体', crate: '木箱', barrel: '油桶', human: '人形占位' }
const DIRECTOR_COLORS = { wall: '#6b7280', crate: '#9a6b3f', barrel: '#315b78', human: '#4f8ee8' }
const scaleValues = (value) => Array.isArray(value) ? value : [value || 1, value || 1, value || 1]
const cloneStage = (stage) => JSON.parse(JSON.stringify(stage))

function DirectorStagePanel({ stage, nodeId, onUpdate, onBringToFront, onRemove }) {
  const [addKind, setAddKind] = useState('wall')
  const [viewName, setViewName] = useState('')
  const selected = stage?.objects?.find((item) => item.id === stage.selectedObjectId) || stage?.objects?.[0]
  const updateStage = (next) => onUpdate(next)
  const updateSelected = (changes) => {
    if (!selected) return
    const next = cloneStage(stage)
    next.objects = next.objects.map((item) => item.id === selected.id ? { ...item, ...changes } : item)
    updateStage(next)
  }
  const addObject = () => {
    const next = cloneStage(stage)
    const count = next.objects.filter((item) => item.kind === addKind).length + 1
    const objectId = `${addKind}_${Date.now().toString(36)}`
    next.objects.push({ id: objectId, kind: addKind, name: `${DIRECTOR_KINDS[addKind]} ${count}`, position: [count * 0.65, 0, count * 0.25], rotation: [0, 0, 0], scale: [1, 1, 1], lockAspect: false, color: DIRECTOR_COLORS[addKind] })
    next.selectedObjectId = objectId
    updateStage(next)
  }
  const removeSelected = () => {
    if (!selected || selected.kind === 'ground') return
    const next = cloneStage(stage)
    next.objects = next.objects.filter((item) => item.id !== selected.id)
    next.selectedObjectId = next.objects[0]?.id || ''
    updateStage(next)
  }
  const updateVector = (field, index, rawValue) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    const values = [...(selected[field] || [0, 0, 0])]
    values[index] = field === 'scale' ? Math.max(0.1, value) : value
    if (field === 'scale' && selected.lockAspect) values.fill(Math.max(0.1, value))
    updateSelected({ [field]: values })
  }
  const updateHeading = (rawValue) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    const rotation = [...(selected.rotation || [0, 0, 0])]
    rotation[2] = (value * Math.PI) / 180
    updateSelected({ rotation })
  }
  const command = (action) => window.dispatchEvent(new CustomEvent('director-stage-command', { detail: { stageId: nodeId, action, name: viewName } }))

  return (
    <div className="right-panel director-side-panel">
      <div className="director-side-title">🎬 导演台控制</div>
      <div className="director-stage-label">添加占位物</div>
      <div className="director-stage-add-row">
        <select value={addKind} onChange={(event) => setAddKind(event.target.value)}>{Object.entries(DIRECTOR_KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
        <button onClick={addObject}>添加</button>
      </div>
      <div className="director-stage-label">场景物体</div>
      <select value={selected?.id || ''} onChange={(event) => updateStage({ ...cloneStage(stage), selectedObjectId: event.target.value })}>
        {(stage.objects || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {selected && selected.kind !== 'ground' && <>
        <button className="director-stage-remove" onClick={removeSelected}>删除当前物体</button>
        <div className="director-stage-label">位置（DCC 米）</div>
        <div className="director-stage-number-row">
          {['X 横向', 'Y 纵深', 'Z 高低'].map((label, index) => <label key={label}>{label}<input type="number" step="0.1" value={selected.position?.[index] ?? 0} onChange={(event) => updateVector('position', index, event.target.value)} /></label>)}
        </div>
        <div className="director-stage-number-row"><label>旋转 Z 轴 °<input type="number" step="1" value={Math.round(((selected.rotation?.[2] || 0) * 180) / Math.PI)} onChange={(event) => updateHeading(event.target.value)} /></label></div>
        <div className="director-stage-label">缩放</div>
        <label className="director-stage-checkbox"><input type="checkbox" checked={Boolean(selected.lockAspect)} onChange={(event) => updateSelected({ lockAspect: event.target.checked })} /> 固定比例</label>
        <div className="director-stage-number-row">
          {['X', 'Y', 'Z'].map((label, index) => <label key={label}>{label}<input type="number" min="0.1" step="0.1" value={scaleValues(selected.scale)[index]} onChange={(event) => updateVector('scale', index, event.target.value)} /></label>)}
        </div>
      </>}
      <div className="director-stage-label">命名视角</div>
      <div className="director-stage-camera-row"><input list={`director-view-options-${nodeId}`} value={viewName} placeholder="输入或选择视角名称" onChange={(event) => setViewName(event.target.value)} /><datalist id={`director-view-options-${nodeId}`}>{(stage.views || []).map((view) => <option key={view.id || view.name} value={view.name} />)}</datalist></div>
      <div className="director-stage-camera-row director-stage-camera-actions">
        <button disabled={!viewName.trim()} onClick={() => command('saveView')}>保存</button>
        <button disabled={!(stage.views || []).some((view) => view.name === viewName)} onClick={() => command('switchView')}>切换</button>
        <button onClick={() => command('exportFrame')}>导出 PNG</button>
      </div>
      <div className="director-side-note">DCC 轴：X 红＝横向，Y 绿＝纵深，Z 蓝＝向上。右键旋转、滚轮缩放视图。</div>
      <button className="canvas-btn canvas-btn-primary" style={{ justifyContent: 'center', marginTop: 12 }} onClick={onBringToFront}><ArrowUp size={16} /> 置顶</button>
      <button className="canvas-btn canvas-btn-danger" style={{ justifyContent: 'center' }} onClick={onRemove}><Trash2 size={16} /> 删除导演台</button>
    </div>
  )
}

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
  onGenerateModelViewPrompt,
  onModelViews,
  onAddCamera,
  onInpaint,
  onUpdateDirectorStage,
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
  // Qwen 生成的正视图提示词；展示给用户确认并允许在提交 Flux 前修改
  const [modelViewFrontPrompt, setModelViewFrontPrompt] = useState(null)
  // 图生视频：分辨率选择（16:9 或 9:16）
  const [i2vAspect, setI2vAspect] = useState('16:9')
  // 图生视频：模型版本选择（pruned 截肢版 | int8 完整版）
  const [i2vModel, setI2vModel] = useState('pruned')
  const [i2vSubTab, setI2vSubTab] = useState('preset')
  const [shotProjects, setShotProjects] = useState([])
  const [shotProjectId, setShotProjectId] = useState('')
  const [shotOptions, setShotOptions] = useState([])
  const [shotId, setShotId] = useState('')
  const [characterRefId, setCharacterRefId] = useState('')
  const [frameRefId, setFrameRefId] = useState('')
  const [shotVideoPrompt, setShotVideoPrompt] = useState('')
  const [shotVideoDuration, setShotVideoDuration] = useState(5)
  const [shotLoading, setShotLoading] = useState(false)
  const [showInpaint, setShowInpaint] = useState(false)

  // 源文件真实分辨率
  const [naturalSize, setNaturalSize] = useState(null)

  useEffect(() => {
    setNaturalSize(null)
    setModelViewFrontPrompt(null)
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

  useEffect(() => {
    if (i2vSubTab !== 'shot') return
    axios.get('/api/shot_breakdowns/projects').then((res) => {
      const items = res.data.projects || []
      setShotProjects(items)
      setShotProjectId((value) => value || items[0]?.project_id || '')
    }).catch((err) => console.error('load shot projects failed', err))
  }, [i2vSubTab])

  useEffect(() => {
    if (!shotProjectId) { setShotOptions([]); setShotId(''); return }
    axios.get(`/api/shot_breakdowns/projects/${encodeURIComponent(shotProjectId)}/shots`).then((res) => {
      const items = res.data.shots || []
      setShotOptions(items)
      setShotId(items[0]?.id || '')
    }).catch((err) => { console.error('load project shots failed', err); setShotOptions([]); setShotId('') })
  }, [shotProjectId])

  useEffect(() => {
    const imageIds = selectedElements.filter((item) => item.type === 'image').map((item) => item.id)
    setCharacterRefId((value) => imageIds.includes(value) ? value : (imageIds[0] || ''))
    setFrameRefId((value) => imageIds.includes(value) && value !== imageIds[0] ? value : (imageIds[1] || ''))
  }, [selectedElements])

  const multiCount = selectedElements.length
  const selectedImageElements = selectedElements.filter((item) => item.type === 'image')
  const characterRef = selectedImageElements.find((item) => item.id === characterRefId)
  const frameRef = selectedImageElements.find((item) => item.id === frameRefId)

  const generateShotPrompt = async () => {
    if (!shotProjectId || !shotId) return alert('请先选择项目和镜头。')
    if (!characterRef || !frameRef || characterRef.id === frameRef.id) return alert('请在画布中选中两张不同图片，并分别指定人物概念图和镜头参考帧。')
    setShotLoading(true)
    try {
      const res = await axios.post('/api/shot-video-prompt', {
        project_id: shotProjectId,
        shot_id: shotId,
        reference_images: [characterRef.src, frameRef.src],
      })
      if (res.data.success) {
        setShotVideoPrompt(res.data.prompt || '')
        setShotVideoDuration(res.data.duration || 5)
      }
    } catch (err) {
      alert('镜头提示词生成失败: ' + (err?.response?.data?.detail || err.message))
    } finally {
      setShotLoading(false)
    }
  }

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

  // 模型节点使用独立面板，不显示图片专用的图生图/图生视频/拆分功能
  if (selectedElement.type === 'model') {
    return (
      <div className="right-panel">
        <div style={{ textAlign: 'center' }}>
          <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', borderRadius: 8, color: '#cbd5e1', fontSize: 13 }}>3D 模型</div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 6 }}>
            {selectedElement.format?.toUpperCase() || 'GLB'} · {selectedElement.sizeBytes ? `${(selectedElement.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '模型文件'}
          </div>
        </div>
        <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: 'rgba(45,45,74,0.4)', color: '#aaa', fontSize: 12, lineHeight: 1.6 }}>
          当前模型节点支持预览、缩放和连线。拓扑、UV、贴图和动画操作将在后续 Skill 节点中接入。
        </div>
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #2a2a4a' }} />
        <button className="canvas-btn canvas-btn-primary" style={{ justifyContent: 'center' }} onClick={onBringToFront}><ArrowUp size={16} /> 置顶</button>
        <button className="canvas-btn canvas-btn-danger" style={{ justifyContent: 'center' }} onClick={onRemove}><Trash2 size={16} /> 删除</button>
      </div>
    )
  }

  // 导演台是共享 3D 预演场景，不复用图片的生成与拆分操作。
  if (selectedElement.type === 'director-stage') {
    return <DirectorStagePanel stage={selectedElement.stage} nodeId={selectedElement.id} onUpdate={onUpdateDirectorStage} onBringToFront={onBringToFront} onRemove={onRemove} />
  }

  // 相机参数与生成操作直接在相机节点中完成，右侧仅保留节点管理操作。
  if (selectedElement.type === 'camera') {
    return (
      <div className="right-panel">
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(124,58,237,.12)', border: '1px solid #4c3a70', color: '#ddd6fe', fontSize: 13, lineHeight: 1.65 }}>
          <Camera size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          多视角相机节点<br />
          在节点内拖动圆盘或调整滑块，再点击“生成当前角度”。
        </div>
        <button className="canvas-btn canvas-btn-primary" style={{ justifyContent: 'center' }} onClick={onBringToFront}><ArrowUp size={16} /> 置顶</button>
        <button className="canvas-btn canvas-btn-danger" style={{ justifyContent: 'center' }} onClick={onRemove}><Trash2 size={16} /> 删除</button>
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
        {selectedElement.type === 'image' && (
          <button
            className="canvas-btn"
            style={{ width: '100%', marginTop: 6, justifyContent: 'center', fontSize: 12, background: '#5b21b6', color: '#fff', border: '1px solid #7c3aed' }}
            onClick={onAddCamera}
          >
            <Camera size={14} /> 添加多视角相机
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
          <button
            className="canvas-btn"
            style={{ width: '100%', marginTop: 6, justifyContent: 'center', background: '#7c3aed' }}
            disabled={loading || multiCount !== 1 || selectedElement.type !== 'image'}
            onClick={() => setShowInpaint(true)}
          >
            <Brush size={16} /> Inpainting
          </button>
          {multiCount > 1 && <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 4 }}>Inpainting 仅支持单张图片。</div>}
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

          {/* 分割子页签：选中单图 → 按网格平均切成多块并自动连线到原图 */}
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
                将当前图片按网格平均切块，每块作为独立节点。`1分4` 为 2×2，`1分8` 为每行 2 张、共 4 行。
              </div>

              {multiCount > 1 && (
                <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 8 }}>
                  分割仅支持单图，请只选中一张图片。
                </div>
              )}

              <div className="split-action-row">
                <button
                  className="canvas-btn canvas-btn-primary canvas-btn-compact"
                  disabled={loading || multiCount > 1}
                  onClick={() => onSplit && onSplit('4')}
                >
                  1分4
                </button>
                <button
                  className="canvas-btn canvas-btn-primary canvas-btn-compact"
                  disabled={loading || multiCount > 1}
                  onClick={() => onSplit && onSplit('8')}
                >
                  1分8
                </button>
              </div>
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
                onClick={async () => {
                  const prompt = await onGenerateModelViewPrompt?.(modelViewInstruction)
                  if (prompt) setModelViewFrontPrompt(prompt)
                }}
              >
                {loading ? '正在生成提示词...' : '生成模型三视图'}
              </button>
              {modelViewFrontPrompt !== null && (
                <>
                  <div className="panel-label" style={{ marginTop: 10 }}>正视图提示词（可编辑）</div>
                  <textarea
                    className="canvas-textarea"
                    value={modelViewFrontPrompt}
                    onChange={(e) => setModelViewFrontPrompt(e.target.value)}
                    rows={8}
                    style={{ marginTop: 4, fontSize: 12 }}
                    placeholder="Qwen3-VL 生成的正视图提示词会显示在这里，你可以修改后再提交。"
                  />
                  <button
                    className="canvas-btn canvas-btn-primary"
                    style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}
                    disabled={loading || !modelViewFrontPrompt.trim()}
                    onClick={() => onModelViews?.(modelViewFrontPrompt)}
                  >
                    {loading ? '正在生成三视图...' : '提交生成模型三视图'}
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
          <div className="right-panel-subtabs">
            <div className={`right-panel-subtab ${i2vSubTab === 'preset' ? 'active' : ''}`} onClick={() => setI2vSubTab('preset')}>预设</div>
            <div className={`right-panel-subtab ${i2vSubTab === 'shot' ? 'active' : ''}`} onClick={() => setI2vSubTab('shot')}>镜头表生成</div>
          </div>
          {i2vSubTab === 'preset' && <>
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
          </>}

          {i2vSubTab === 'shot' && (
            <div>
              <div style={{ color: '#aaa', fontSize: 12, lineHeight: 1.55, marginBottom: 8 }}>
                选择项目和镜头后，Qwen3-VL:8b 将读取该镜头 JSON，并结合两张指定参考图生成 MiniMax H3 提示词。
              </div>
              <div className="panel-label">项目（project_id）</div>
              <select className="canvas-input" value={shotProjectId} onChange={(e) => setShotProjectId(e.target.value)} style={{ marginTop: 4 }}>
                {shotProjects.length === 0 && <option value="">暂无镜头表项目</option>}
                {shotProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.project_id} · {project.project_name}（{project.shot_count} 镜）</option>)}
              </select>
              <div className="panel-label" style={{ marginTop: 8 }}>镜头</div>
              <select className="canvas-input" value={shotId} onChange={(e) => setShotId(e.target.value)} style={{ marginTop: 4 }} disabled={!shotProjectId}>
                {shotOptions.length === 0 && <option value="">暂无镜头</option>}
                {shotOptions.map((shot) => <option key={shot.id} value={shot.id}>{shot.shot_no}{shot.scene ? ` · ${shot.scene}` : ''}{shot.duration ? ` · ${shot.duration}s` : ''}</option>)}
              </select>
              <div className="panel-label" style={{ marginTop: 10 }}>画布参考图（需先选中两张图片）</div>
              <select className="canvas-input" value={characterRefId} onChange={(e) => setCharacterRefId(e.target.value)} disabled={selectedImageElements.length < 2} style={{ marginTop: 4 }}>
                <option value="">人物概念图</option>
                {selectedImageElements.map((image, index) => <option key={image.id} value={image.id}>人物概念图：图片 {index + 1}</option>)}
              </select>
              <select className="canvas-input" value={frameRefId} onChange={(e) => setFrameRefId(e.target.value)} disabled={selectedImageElements.length < 2} style={{ marginTop: 4 }}>
                <option value="">镜头参考帧</option>
                {selectedImageElements.map((image, index) => <option key={image.id} value={image.id}>镜头参考帧：图片 {index + 1}</option>)}
              </select>
              <div style={{ color: selectedImageElements.length === 2 ? '#7dd3fc' : '#f59e0b', fontSize: 11, marginTop: 5 }}>
                当前选中 {selectedImageElements.length} 张图片；需要两张不同的图片。
              </div>
              <button className="canvas-btn" style={{ width: '100%', marginTop: 8, justifyContent: 'center', background: '#1a1a2e', color: '#fff', border: '1px solid #3a3a5a' }} disabled={shotLoading || !shotId || selectedImageElements.length < 2} onClick={generateShotPrompt}>
                {shotLoading ? 'Qwen3 生成中...' : '生成镜头视频提示词'}
              </button>
              <div className="panel-label" style={{ marginTop: 10 }}>MiniMax 提示词（可编辑）</div>
              <textarea className="canvas-textarea" rows={8} value={shotVideoPrompt} onChange={(e) => setShotVideoPrompt(e.target.value)} placeholder="生成后可在这里检查或编辑提示词" style={{ marginTop: 4 }} />
              <div className="panel-label" style={{ marginTop: 8 }}>视频时长</div>
              <input className="canvas-input" type="number" min={2} max={15} value={shotVideoDuration} onChange={(e) => setShotVideoDuration(Math.max(2, Math.min(15, Number(e.target.value) || 5)))} style={{ marginTop: 4 }} />
              <button className="canvas-btn canvas-btn-success" style={{ width: '100%', marginTop: 8, justifyContent: 'center' }} disabled={loading || !shotVideoPrompt.trim() || !characterRef || !frameRef || characterRef.id === frameRef.id} onClick={() => onImageToVideo(shotVideoPrompt, shotVideoDuration, '16:9', 'int8', [characterRef, frameRef])}>
                <Video size={16} /> {loading ? '生成中...' : '使用 MiniMax INT8 生成镜头视频'}
              </button>
            </div>
          )}
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

      {showInpaint && (
        <InpaintMaskModal
          imageUrl={selectedElement.src}
          loading={loading}
          onClose={() => setShowInpaint(false)}
          onGenerate={async (params) => {
            const ok = await onInpaint?.(params)
            if (ok) setShowInpaint(false)
          }}
        />
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
