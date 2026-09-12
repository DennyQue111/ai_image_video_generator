import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderOpen, Save, FilePlus, Trash2, ChevronDown, Loader2,
  Plus, X, Upload, Image as ImageIcon, Clapperboard, Library,
} from 'lucide-react'
import axios from 'axios'
import '../styles/ProjectManagement.css'

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

let shotIdCounter = 0
const genShotId = () => `shot_${Date.now()}_${shotIdCounter++}`

const emptyShot = () => ({
  id: genShotId(),
  scene_number: '',
  shot_no: '',
  duration: '',
  prompt: '',
  shot_type: '',
  camera_movement: '',
  location: '',
  time_of_day: '',
  characters: [],
  dialogue: '',
  notes: '',
  reference_images: [],
})

const emptyConcepts = () => ({ characters: [], locations: [], props: [] })
const normalizeConcepts = (value = {}) => Object.fromEntries(
  ['characters', 'locations', 'props'].map((type) => [type, (value[type] || []).map((item, index) => ({
    ...item,
    id: item.id || `${type}_${Date.now()}_${index}`,
    description: item.description || '',
    reference_images: item.reference_images || (item.image_url ? [item.image_url] : []),
  }))])
)

const normalizeImportedData = (raw) => {
  const source = raw.shot_breakdown || raw
  const sceneMap = source.scenes && !Array.isArray(source.scenes) ? source.scenes : {}
  const shots = (source.shots || []).map((shot) => {
    const scene = sceneMap[shot.scene] || {}
    return {
      ...emptyShot(),
      ...shot,
      id: shot.id || genShotId(),
      scene_number: shot.scene_number || shot.scene || '',
      shot_no: shot.shot_no || shot.shot_number || '',
      duration: shot.duration ?? shot.duration_seconds ?? '',
      prompt: shot.prompt || shot.description || shot.action || '',
      location: shot.location || scene.name || '',
      time_of_day: shot.time_of_day || scene.time || '',
      characters: Array.isArray(shot.characters) ? shot.characters : [],
      reference_images: shot.reference_images || [],
    }
  })
  const supplied = source.concepts || raw.concepts
  const characters = supplied?.characters || Object.entries(source.characters || {}).map(([id, item]) => ({
    id,
    name: item.name || id,
    description: item.description || item.visual || '',
    reference_images: item.reference_images || [],
  }))
  const locations = supplied?.locations || Object.entries(sceneMap).map(([id, item]) => ({
    id,
    name: item.name || id,
    description: item.description || item.environment || '',
    reference_images: item.reference_images || [],
  }))
  return {
    name: source.name || source.title || raw.name || '',
    shots,
    concepts: normalizeConcepts({ characters, locations, props: supplied?.props || source.props || [] }),
  }
}

/**
 * 镜头表（分镜表）管理页面
 * - 顶部项目栏：新建/保存/加载/删除（存后端 shot_breakdown 接口）
 * - 表格：镜头号 / 时长 / 提示词 / 参考图（多图上传+浏览）
 */
export default function ProjectManagement() {
  const [shots, setShots] = useState([])
  const [concepts, setConcepts] = useState(emptyConcepts)
  const [activeSection, setActiveSection] = useState('shots')
  const [currentName, setCurrentName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [shotBreakdowns, setShotBreakdowns] = useState([])
  const [open, setOpen] = useState(false)
  const [previewShot, setPreviewShot] = useState(null) // 浏览参考图的镜头
  const dropdownRef = useRef(null)
  const jsonInputRef = useRef(null)

  // 拉取镜头表列表
  const refresh = useCallback(async () => {
    try {
      const res = await axios.get('/api/shot_breakdowns')
      if (res.data.success) setShotBreakdowns(res.data.shot_breakdowns || [])
    } catch (err) {
      console.error('list shot breakdowns failed', err)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setNameInput(currentName || '')
  }, [currentName])

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ========== 行编辑 ==========
  const addShot = () => {
    setShots((prev) => [...prev, emptyShot()])
  }

  const removeShot = (id) => {
    setShots((prev) => prev.filter((s) => s.id !== id))
  }

  const updateShot = (id, field, value) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }

  // ========== 参考图上传 ==========
  const handleUploadRefImages = async (shotId, files) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      const urls = []
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await axios.post('/api/upload-image', formData)
        if (res.data.url) urls.push(res.data.url)
      }
      setShots((prev) =>
        prev.map((s) =>
          s.id === shotId
            ? { ...s, reference_images: [...(s.reference_images || []), ...urls] }
            : s
        )
      )
    } catch (err) {
      alert('参考图上传失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const removeRefImage = (shotId, idx) => {
    setShots((prev) =>
      prev.map((s) =>
        s.id === shotId
          ? { ...s, reference_images: (s.reference_images || []).filter((_, i) => i !== idx) }
          : s
      )
    )
  }

  // ========== 项目保存/加载/新建/删除 ==========
  const handleSave = async () => {
    const name = nameInput.trim() || 'untitled'
    setBusy(true)
    try {
      const res = await axios.post('/api/shot_breakdowns/save', { name, shots, concepts })
      if (res.data.success) {
        setCurrentName(res.data.name)
        await refresh()
      }
    } catch (err) {
      alert('保存失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const handleLoad = async (name) => {
    setBusy(true)
    try {
      const res = await axios.get(`/api/shot_breakdowns/${encodeURIComponent(name)}`)
      if (res.data.success && res.data.shot_breakdown) {
        const loaded = (res.data.shot_breakdown.shots || []).map((s) => ({
          ...emptyShot(),
          ...s,
          id: s.id || genShotId(),
          shot_no: s.sh_no || s.shot_no || '',
          reference_images: s.reference_images || [],
        }))
        setShots(loaded)
        setConcepts(normalizeConcepts(res.data.shot_breakdown.concepts || {}))
        setCurrentName(res.data.shot_breakdown.name || name)
        setOpen(false)
      }
    } catch (err) {
      alert('加载失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const handleNew = async () => {
    if (shots.length > 0 && !confirm('新建将清空当前镜头表，未保存内容会丢失，是否继续？')) return
    setShots([])
    setConcepts(emptyConcepts())
    setCurrentName('')
  }

  const handleDelete = async () => {
    if (!currentName) return
    if (!confirm(`确定删除镜头表「${currentName}」吗？此操作不可恢复。`)) return
    setBusy(true)
    try {
      await axios.delete(`/api/shot_breakdowns/${encodeURIComponent(currentName)}`)
      setShots([])
      setConcepts(emptyConcepts())
      setCurrentName('')
      await refresh()
    } catch (err) {
      alert('删除失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const handleImportJson = async (file) => {
    if (!file) return
    try {
      const imported = normalizeImportedData(JSON.parse(await file.text()))
      setShots(imported.shots)
      setConcepts(imported.concepts)
      setCurrentName('')
      setNameInput(imported.name || file.name.replace(/\.json$/i, ''))
    } catch (err) {
      alert('导入失败：不是有效的镜头表 JSON。\n' + formatErr(err))
    } finally {
      if (jsonInputRef.current) jsonInputRef.current.value = ''
    }
  }

  return (
    <div className="pm-page">
      {/* 顶部项目栏 */}
      <div className="project-bar" ref={dropdownRef}>
        <button className="project-btn" onClick={handleNew} disabled={busy} title="新建镜头表">
          <FilePlus size={16} />
        </button>
        <input
          className="project-name-input"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="镜头表名称"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          disabled={busy}
        />
        <button className="project-btn project-btn-primary" onClick={handleSave} disabled={busy} title="保存（同名覆盖）">
          {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          <span>保存</span>
        </button>
        <input ref={jsonInputRef} type="file" accept="application/json,.json" hidden onChange={(e) => handleImportJson(e.target.files?.[0])} />
        <button className="project-btn" onClick={() => jsonInputRef.current?.click()} disabled={busy} title="导入镜头表 JSON">
          <Upload size={16} />
          <span>导入 JSON</span>
        </button>
        <div className="project-dropdown-wrap">
          <button className="project-btn" onClick={() => setOpen((o) => !o)} disabled={busy} title="打开镜头表">
            <FolderOpen size={16} />
            <ChevronDown size={14} />
          </button>
          {open && (
            <div className="project-dropdown">
              {shotBreakdowns.length === 0 && (
                <div className="project-dropdown-empty">暂无已保存镜头表</div>
              )}
              {shotBreakdowns.map((s) => (
                <div
                  key={s.name}
                  className={`project-dropdown-item ${s.name === currentName ? 'active' : ''}`}
                  onClick={() => handleLoad(s.name)}
                >
                  <div className="project-dropdown-name">{s.name}</div>
                  <div className="project-dropdown-meta">
                    {s.updated_at} · {s.size > 1024 ? `${(s.size / 1024).toFixed(1)}KB` : `${s.size}B`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {currentName && (
          <button className="project-btn project-btn-danger" onClick={handleDelete} disabled={busy} title="删除当前镜头表">
            <Trash2 size={16} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <div className="project-bar-title">
          {currentName ? `当前镜头表：${currentName}` : '未保存镜头表'}
        </div>
      </div>

      <div className="pm-section-tabs">
        <button className={`pm-section-tab ${activeSection === 'shots' ? 'active' : ''}`} onClick={() => setActiveSection('shots')}>
          <Clapperboard size={16} /> 镜头表
        </button>
        <button className={`pm-section-tab ${activeSection === 'concepts' ? 'active' : ''}`} onClick={() => setActiveSection('concepts')}>
          <Library size={16} /> Concept 表
        </button>
      </div>

      {activeSection === 'shots' && <>
      {/* 镜头表工具条 */}
      <div className="pm-toolbar">
        <button className="pm-add-btn" onClick={addShot} disabled={busy}>
          <Plus size={16} /> 添加镜头
        </button>
        <div className="pm-count">共 {shots.length} 个镜头</div>
      </div>

      {/* 镜头表表格 */}
      <div className="pm-table-wrap">
        {shots.length === 0 ? (
          <div className="pm-empty">点击「添加镜头」开始创建分镜表，或从上方打开已保存的镜头表</div>
        ) : (
          <table className="pm-table">
            <thead>
              <tr>
                <th style={{ width: 75 }}>场次</th>
                <th style={{ width: 80 }}>镜头号</th>
                <th style={{ width: 70 }}>时长</th>
                <th style={{ width: 150 }}>地点 / 时间</th>
                <th style={{ width: 180 }}>景别 / 运镜</th>
                <th style={{ minWidth: 280 }}>镜头描述</th>
                <th style={{ minWidth: 180 }}>角色 / 对白</th>
                <th style={{ width: 180 }}>参考图</th>
                <th style={{ width: 60 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, idx) => (
                <tr key={shot.id}>
                  <td>
                    <input className="pm-input pm-input-sm" value={shot.scene_number || ''} onChange={(e) => updateShot(shot.id, 'scene_number', e.target.value)} placeholder="SAE" />
                  </td>
                  <td>
                    <input
                      className="pm-input pm-input-sm"
                      value={shot.shot_no}
                      onChange={(e) => updateShot(shot.id, 'shot_no', e.target.value)}
                      placeholder={`S${idx + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      className="pm-input pm-input-sm"
                      value={shot.duration}
                      onChange={(e) => updateShot(shot.id, 'duration', e.target.value)}
                      placeholder="5s"
                    />
                  </td>
                  <td>
                    <input className="pm-input pm-input-sm" value={shot.location || ''} onChange={(e) => updateShot(shot.id, 'location', e.target.value)} placeholder="地点" />
                    <input className="pm-input pm-input-sm pm-stacked" value={shot.time_of_day || ''} onChange={(e) => updateShot(shot.id, 'time_of_day', e.target.value)} placeholder="日/夜" />
                  </td>
                  <td>
                    <input className="pm-input pm-input-sm" value={shot.shot_type || ''} onChange={(e) => updateShot(shot.id, 'shot_type', e.target.value)} placeholder="景别/焦段" />
                    <textarea className="pm-textarea pm-stacked" value={shot.camera_movement || shot.camera || ''} onChange={(e) => updateShot(shot.id, 'camera_movement', e.target.value)} rows={2} placeholder="机位与运镜" />
                  </td>
                  <td>
                    <textarea
                      className="pm-textarea"
                      value={shot.prompt}
                      onChange={(e) => updateShot(shot.id, 'prompt', e.target.value)}
                      placeholder="画面动作与镜头内容..."
                      rows={4}
                    />
                  </td>
                  <td>
                    <input className="pm-input pm-input-sm" value={(shot.characters || []).join('、')} onChange={(e) => updateShot(shot.id, 'characters', e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean))} placeholder="角色，用顿号分隔" />
                    <textarea className="pm-textarea pm-stacked" value={shot.dialogue || ''} onChange={(e) => updateShot(shot.id, 'dialogue', e.target.value)} rows={2} placeholder="对白" />
                  </td>
                  <td>
                    <RefImageCell
                      shot={shot}
                      onUpload={(files) => handleUploadRefImages(shot.id, files)}
                      onPreview={() => setPreviewShot(shot)}
                      onRemove={(i) => removeRefImage(shot.id, i)}
                      busy={busy}
                    />
                  </td>
                  <td>
                    <button className="pm-row-del" onClick={() => removeShot(shot.id)} title="删除该镜头">
                      <X size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>}

      {activeSection === 'concepts' && (
        <ConceptManagement concepts={concepts} setConcepts={setConcepts} busy={busy} />
      )}

      {/* 参考图浏览弹窗 */}
      {previewShot && (
        <RefImageModal shot={previewShot} onClose={() => setPreviewShot(null)} onRemove={(i) => {
          removeRefImage(previewShot.id, i)
          setPreviewShot((prev) => prev ? {
            ...prev,
            reference_images: (prev.reference_images || []).filter((_, idx) => idx !== i),
          } : prev)
        }} />
      )}
    </div>
  )
}

const CONCEPT_GROUPS = [
  { key: 'characters', label: '角色' },
  { key: 'locations', label: '场景' },
  { key: 'props', label: '道具' },
]

function ConceptManagement({ concepts, setConcepts, busy }) {
  const [uploading, setUploading] = useState('')

  const addConcept = (type) => {
    const item = { id: `concept_${Date.now()}`, name: '', description: '', reference_images: [] }
    setConcepts((prev) => ({ ...prev, [type]: [...(prev[type] || []), item] }))
  }

  const updateConcept = (type, id, field, value) => {
    setConcepts((prev) => ({
      ...prev,
      [type]: (prev[type] || []).map((item) => item.id === id ? { ...item, [field]: value } : item),
    }))
  }

  const removeConcept = (type, id) => {
    setConcepts((prev) => ({ ...prev, [type]: (prev[type] || []).filter((item) => item.id !== id) }))
  }

  const uploadConceptImages = async (type, item, files) => {
    if (!files?.length) return
    const key = `${type}_${item.id}`
    setUploading(key)
    try {
      const urls = []
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await axios.post('/api/upload-image', formData)
        if (res.data.url) urls.push(res.data.url)
      }
      updateConcept(type, item.id, 'reference_images', [...(item.reference_images || []), ...urls])
    } catch (err) {
      alert('参考图上传失败: ' + formatErr(err))
    } finally {
      setUploading('')
    }
  }

  return (
    <div className="concept-manager">
      <div className="concept-manager-note">这里只维护角色、场景和道具资料，不调用任何生图或视频模型。</div>
      {CONCEPT_GROUPS.map(({ key, label }) => (
        <section className="concept-group" key={key}>
          <div className="concept-group-header">
            <div><strong>{label}</strong><span>{(concepts[key] || []).length} 项</span></div>
            <button className="pm-add-btn" onClick={() => addConcept(key)} disabled={busy}><Plus size={15} /> 添加{label}</button>
          </div>
          {(concepts[key] || []).length === 0 ? (
            <div className="concept-group-empty">暂无{label}资料</div>
          ) : (
            <div className="concept-grid-simple">
              {(concepts[key] || []).map((item, index) => {
                const images = item.reference_images?.length ? item.reference_images : (item.image_url ? [item.image_url] : [])
                const itemKey = `${key}_${item.id}`
                return (
                  <article className="concept-card-simple" key={item.id || index}>
                    <div className="concept-card-image">
                      {images[0] ? <img src={images[0]} alt={item.name || label} /> : <ImageIcon size={30} />}
                    </div>
                    <div className="concept-card-fields">
                      <input className="pm-input" value={item.name || ''} onChange={(e) => updateConcept(key, item.id, 'name', e.target.value)} placeholder={`${label}名称`} />
                      <textarea className="pm-textarea" value={item.description || ''} onChange={(e) => updateConcept(key, item.id, 'description', e.target.value)} rows={4} placeholder={`${label}的稳定视觉描述、身份或环境信息`} />
                      <div className="concept-card-actions">
                        <label className="ref-mini-btn concept-upload" title="上传参考图">
                          {uploading === itemKey ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                          <input type="file" accept="image/*" multiple hidden disabled={!!uploading} onChange={(e) => uploadConceptImages(key, item, e.target.files)} />
                        </label>
                        <span>{images.length ? `${images.length} 张参考图` : '无参考图'}</span>
                        <button className="pm-row-del" onClick={() => removeConcept(key, item.id)} title={`删除${label}`}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * 参考图单元格：缩略图列表 + 上传按钮 + 浏览按钮
 */
function RefImageCell({ shot, onUpload, onPreview, onRemove, busy }) {
  const fileRef = useRef(null)
  const imgs = shot.reference_images || []

  return (
    <div className="ref-cell">
      <div className="ref-thumbs">
        {imgs.slice(0, 4).map((url, i) => (
          <div key={i} className="ref-thumb" title={url}>
            <img src={url} alt="" />
          </div>
        ))}
        {imgs.length > 4 && (
          <div className="ref-thumb ref-thumb-more">+{imgs.length - 4}</div>
        )}
        {imgs.length === 0 && (
          <div className="ref-empty">无</div>
        )}
      </div>
      <div className="ref-actions">
        <button
          className="ref-mini-btn"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="上传参考图"
        >
          <Upload size={13} />
        </button>
        {imgs.length > 0 && (
          <button className="ref-mini-btn" onClick={onPreview} title="浏览全部">
            <ImageIcon size={13} />
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          onUpload(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}

/**
 * 参考图浏览弹窗：大图轮播 + 删除
 */
function RefImageModal({ shot, onClose, onRemove }) {
  const imgs = shot.reference_images || []
  const [idx, setIdx] = useState(0)
  const cur = imgs[idx]

  const prev = () => setIdx((i) => (i - 1 + imgs.length) % imgs.length)
  const next = () => setIdx((i) => (i + 1) % imgs.length)

  return (
    <div className="ref-modal-overlay" onClick={onClose}>
      <div className="ref-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ref-modal-header">
          <span>{shot.shot_no || '镜头'} 的参考图（{idx + 1}/{imgs.length}）</span>
          <button className="ref-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {cur ? (
          <>
            <div className="ref-modal-body">
              <button className="ref-nav" onClick={prev} disabled={imgs.length <= 1}>‹</button>
              <img src={cur} alt="" />
              <button className="ref-nav" onClick={next} disabled={imgs.length <= 1}>›</button>
            </div>
            <div className="ref-modal-footer">
              <button className="pm-row-del pm-row-del-wide" onClick={() => {
                onRemove(idx)
                if (idx >= imgs.length - 1) setIdx((i) => Math.max(0, i - 1))
              }}>
                <Trash2 size={14} /> 删除此图
              </button>
            </div>
          </>
        ) : (
          <div className="ref-modal-empty">暂无参考图</div>
        )}
      </div>
    </div>
  )
}
