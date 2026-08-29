import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderOpen, Save, FilePlus, Trash2, ChevronDown, Loader2,
  Plus, X, Upload, Image as ImageIcon,
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
  shot_no: '',
  duration: '',
  prompt: '',
  reference_images: [],
})

/**
 * 镜头表（分镜表）管理页面
 * - 顶部项目栏：新建/保存/加载/删除（存后端 storyboard 接口）
 * - 表格：镜头号 / 时长 / 提示词 / 参考图（多图上传+浏览）
 */
export default function ProjectManagement() {
  const [shots, setShots] = useState([])
  const [currentName, setCurrentName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [storyboards, setStoryboards] = useState([])
  const [open, setOpen] = useState(false)
  const [previewShot, setPreviewShot] = useState(null) // 浏览参考图的镜头
  const dropdownRef = useRef(null)

  // 拉取镜头表列表
  const refresh = useCallback(async () => {
    try {
      const res = await axios.get('/api/storyboards')
      if (res.data.success) setStoryboards(res.data.storyboards || [])
    } catch (err) {
      console.error('list storyboards failed', err)
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
      const res = await axios.post('/api/storyboards/save', { name, shots })
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
      const res = await axios.get(`/api/storyboards/${encodeURIComponent(name)}`)
      if (res.data.success && res.data.storyboard) {
        const loaded = (res.data.storyboard.shots || []).map((s) => ({
          id: s.id || genShotId(),
          shot_no: s.sh_no || s.shot_no || '',
          duration: s.duration || '',
          prompt: s.prompt || '',
          reference_images: s.reference_images || [],
        }))
        setShots(loaded)
        setCurrentName(res.data.storyboard.name || name)
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
    setCurrentName('')
  }

  const handleDelete = async () => {
    if (!currentName) return
    if (!confirm(`确定删除镜头表「${currentName}」吗？此操作不可恢复。`)) return
    setBusy(true)
    try {
      await axios.delete(`/api/storyboards/${encodeURIComponent(currentName)}`)
      setShots([])
      setCurrentName('')
      await refresh()
    } catch (err) {
      alert('删除失败: ' + formatErr(err))
    } finally {
      setBusy(false)
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
        <div className="project-dropdown-wrap">
          <button className="project-btn" onClick={() => setOpen((o) => !o)} disabled={busy} title="打开镜头表">
            <FolderOpen size={16} />
            <ChevronDown size={14} />
          </button>
          {open && (
            <div className="project-dropdown">
              {storyboards.length === 0 && (
                <div className="project-dropdown-empty">暂无已保存镜头表</div>
              )}
              {storyboards.map((s) => (
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
                <th style={{ width: 80 }}>镜头号</th>
                <th style={{ width: 90 }}>时长</th>
                <th>提示词</th>
                <th style={{ width: 220 }}>参考图</th>
                <th style={{ width: 60 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, idx) => (
                <tr key={shot.id}>
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
                    <textarea
                      className="pm-textarea"
                      value={shot.prompt}
                      onChange={(e) => updateShot(shot.id, 'prompt', e.target.value)}
                      placeholder="画面描述、动作、镜头语言..."
                      rows={2}
                    />
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
