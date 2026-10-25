import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Loader2, Save, Trash2 } from 'lucide-react'
import axios from 'axios'

function formatErr(error) { return error?.response?.data?.detail || error?.message || String(error) }

export default function EditingProjectBar({ currentName, onNameChange, onSave, onLoad, onDelete }) {
  const [projects, setProjects] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState(currentName || '')
  const dropdownRef = useRef(null)

  const refresh = async () => {
    try {
      const response = await axios.get('/api/editing-projects')
      if (response.data.success) setProjects(response.data.projects || [])
    } catch (error) {
      console.error('读取剪辑台项目失败', error)
    }
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => { setNameInput(currentName || '') }, [currentName])
  useEffect(() => {
    const close = (event) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const save = async () => {
    const name = nameInput.trim()
    if (!name) return alert('请先输入剪辑台项目名称。')
    setBusy(true)
    try { const savedName = await onSave(name); onNameChange(savedName || name); setNameInput(savedName || name); await refresh() } catch (error) { alert(`保存失败：${formatErr(error)}`) } finally { setBusy(false) }
  }

  const load = async (name) => {
    setBusy(true)
    try { await onLoad(name); onNameChange(name); setNameInput(name); setOpen(false) } catch (error) { alert(`加载失败：${formatErr(error)}`) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!currentName || !window.confirm('是否确认删除这个项目的所有内容？')) return
    setBusy(true)
    try { await onDelete(currentName); onNameChange(''); await refresh() } catch (error) { alert(`删除失败：${formatErr(error)}`) } finally { setBusy(false) }
  }

  return <div className="editing-project-bar">
    <div className="editing-project-dropdown" ref={dropdownRef}>
      <button className="edit-tool-button" onClick={() => setOpen((value) => !value)} disabled={busy} title="选择剪辑台项目" aria-label="选择剪辑台项目">
        {busy ? <Loader2 size={15} className="spin" /> : <FolderOpen size={15} />}<ChevronDown size={13} />
      </button>
      {open && <div className="editing-project-menu">
        {!projects.length && <div className="editing-project-empty">暂无已保存的剪辑台项目</div>}
        {projects.map((project) => <button key={project.name} className={`editing-project-option ${project.name === currentName ? 'active' : ''}`} onClick={() => load(project.name)}>
          <span>{project.name}</span><small>{project.updated_at}</small>
        </button>)}
      </div>}
    </div>
    <input className="editing-project-name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save() }} placeholder="剪辑台项目名称" aria-label="剪辑台项目名称" disabled={busy} />
    <button className="edit-tool-button" onClick={save} disabled={busy} title="保存项目"><Save size={15} />保存</button>
    <button className="editing-project-delete" onClick={remove} disabled={busy || !currentName} title="删除项目" aria-label="删除项目"><Trash2 size={16} /></button>
  </div>
}
