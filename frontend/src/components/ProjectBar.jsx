import { useState, useEffect, useRef } from 'react'
import { FolderOpen, Save, FilePlus, Trash2, ChevronDown, Loader2 } from 'lucide-react'
import axios from 'axios'

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
 * 顶部项目栏
 * - 新建：清空画布
 * - 保存：把当前画布存为 JSON（同名覆盖）
 * - 打开：下拉列表选择已保存项目加载
 * - 删除：删除当前项目
 */
export default function ProjectBar({ currentName, onSave, onLoad, onNew, onDelete }) {
  const [projects, setProjects] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const dropdownRef = useRef(null)

  // 拉取项目列表
  const refresh = async () => {
    try {
      const res = await axios.get('/api/projects')
      if (res.data.success) setProjects(res.data.projects || [])
    } catch (err) {
      console.error('list projects failed', err)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // 同步当前项目名到输入框
  useEffect(() => {
    setNameInput(currentName || '')
  }, [currentName])

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSave = async () => {
    const name = nameInput.trim() || 'untitled'
    setBusy(true)
    try {
      await onSave(name)
      await refresh()
    } catch (err) {
      alert('保存失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const handleLoad = async (name) => {
    setBusy(true)
    try {
      await onLoad(name)
      setOpen(false)
    } catch (err) {
      alert('加载失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!currentName) return
    if (!confirm(`确定删除项目「${currentName}」吗？此操作不可恢复。`)) return
    setBusy(true)
    try {
      await axios.delete(`/api/projects/${encodeURIComponent(currentName)}`)
      await onDelete()
      await refresh()
    } catch (err) {
      alert('删除失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }

  const handleNew = async () => {
    if (!confirm('新建项目将清空当前画布，未保存的内容会丢失，是否继续？')) return
    await onNew()
    setNameInput('')
  }

  return (
    <div className="project-bar" ref={dropdownRef}>
      <button className="project-btn" onClick={handleNew} disabled={busy} title="新建项目（清空画布）">
        <FilePlus size={16} />
      </button>

      <input
        className="project-name-input"
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        placeholder="项目名称"
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
        }}
        disabled={busy}
      />

      <button
        className="project-btn project-btn-primary"
        onClick={handleSave}
        disabled={busy}
        title="保存项目（同名覆盖）"
      >
        {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
        <span>保存</span>
      </button>

      <div className="project-dropdown-wrap">
        <button
          className="project-btn"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          title="打开项目"
        >
          <FolderOpen size={16} />
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="project-dropdown">
            {projects.length === 0 && (
              <div className="project-dropdown-empty">暂无已保存项目</div>
            )}
            {projects.map((p) => (
              <div
                key={p.name}
                className={`project-dropdown-item ${p.name === currentName ? 'active' : ''}`}
                onClick={() => handleLoad(p.name)}
              >
                <div className="project-dropdown-name">{p.name}</div>
                <div className="project-dropdown-meta">
                  {p.updated_at} · {p.size > 1024 ? `${(p.size / 1024).toFixed(1)}KB` : `${p.size}B`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {currentName && (
        <button
          className="project-btn project-btn-danger"
          onClick={handleDelete}
          disabled={busy}
          title="删除当前项目"
        >
          <Trash2 size={16} />
        </button>
      )}

      <div style={{ flex: 1 }} />
      <div className="project-bar-title">
        {currentName ? `当前项目：${currentName}` : '未保存项目'}
      </div>
    </div>
  )
}
