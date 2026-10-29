import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Loader2, Save, Settings2, Trash2 } from 'lucide-react'
import axios from 'axios'

function formatErr(error) { return error?.response?.data?.detail || error?.message || String(error) }

export default function EditingProjectBar({ currentName, onNameChange, onSave, onLoad, onDelete, frameRate, onFrameRateChange }) {
  const [projects, setProjects] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState(currentName || '')
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    <div className="editing-project-dropdown">
      <button className={`edit-tool-button ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen((value) => !value)} title="项目配置" aria-label="项目配置"><Settings2 size={15} />配置</button>
      {settingsOpen && <div className="editing-settings-menu">
        <label htmlFor="editing-project-fps">时间线帧速率</label>
        <select id="editing-project-fps" value={frameRate || 24} onChange={(event) => onFrameRateChange(Number(event.target.value))}>
          {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
        </select>
        <small>{frameRate ? '帧率由项目首个视频素材确定，可在此调整。' : '添加首个视频素材后将自动采用其帧率。'}</small>
      </div>}
    </div>
    <button className="editing-project-delete" onClick={remove} disabled={busy || !currentName} title="删除项目" aria-label="删除项目"><Trash2 size={16} /></button>
  </div>
}
