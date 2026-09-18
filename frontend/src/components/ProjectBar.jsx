import { useState, useEffect, useRef } from 'react'
import { FolderOpen, Save, FilePlus, Trash2, ChevronDown, Loader2, Brush } from 'lucide-react'
import axios from 'axios'

function formatErr(err) { return err?.response?.data?.detail || err?.message || String(err) }

/** 独立自由画布项目栏；存储在 outputs/_temp/freeCanvas。 */
export default function ProjectBar({ currentName, onSave, onLoad, onNew, onDelete }) {
  const [projects, setProjects] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const dropdownRef = useRef(null)
  const refresh = async () => {
    try { const res = await axios.get('/api/projects'); if (res.data.success) setProjects(res.data.projects || []) } catch (err) { console.error(err) }
  }
  useEffect(() => { refresh() }, [])
  useEffect(() => { setNameInput(currentName || '') }, [currentName])
  useEffect(() => {
    const close = (event) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const save = async () => {
    setBusy(true)
    try { await onSave(nameInput.trim() || 'untitled'); await refresh() } catch (err) { alert('保存失败: ' + formatErr(err)) } finally { setBusy(false) }
  }
  const load = async (name) => {
    setBusy(true)
    try { await onLoad(name); setOpen(false) } catch (err) { alert('加载失败: ' + formatErr(err)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!currentName || !confirm(`确定删除自由画布项目「${currentName}」吗？此操作不可恢复。`)) return
    setBusy(true)
    try { await axios.delete(`/api/projects/${encodeURIComponent(currentName)}`); await onDelete(); await refresh() } catch (err) { alert('删除失败: ' + formatErr(err)) } finally { setBusy(false) }
  }
  const cleanupUploads = async () => {
    setBusy(true)
    try {
      const preview = await axios.get('/api/uploads/orphans')
      if (!preview.data.success) return
      const { count, total_size_kb } = preview.data
      if (count === 0) {
        alert('没有未被 JSON 引用的上传图片。')
        return
      }
      if (!confirm(`发现 ${count} 个未被引用的上传图片（约 ${total_size_kb} KB）。\n确认删除吗？此操作不可恢复。`)) return
      const result = await axios.post('/api/uploads/cleanup')
      if (result.data.success) alert(`清理完成：删除 ${result.data.deleted} 个文件，释放 ${result.data.freed_kb} KB。`)
    } catch (err) {
      alert('清理失败: ' + formatErr(err))
    } finally {
      setBusy(false)
    }
  }
  return <div className="project-bar" ref={dropdownRef}>
    <button className="project-btn" onClick={() => { if (confirm('新建会清空当前画布，是否继续？')) onNew() }} disabled={busy} title="新建自由画布"><FilePlus size={16} /></button>
    <input className="project-name-input" value={nameInput} onChange={(event) => setNameInput(event.target.value)} placeholder="自由画布项目名称" onKeyDown={(event) => event.key === 'Enter' && save()} disabled={busy} />
    <button className="project-btn project-btn-primary" onClick={save} disabled={busy} title="保存自由画布项目">{busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}<span>保存</span></button>
    <div className="project-dropdown-wrap"><button className="project-btn" onClick={() => setOpen((value) => !value)} disabled={busy} title="打开自由画布项目"><FolderOpen size={16} /><ChevronDown size={14} /></button>
      {open && <div className="project-dropdown">{projects.length === 0 && <div className="project-dropdown-empty">暂无自由画布项目</div>}{projects.map((project) => <div key={project.name} className={`project-dropdown-item ${project.name === currentName ? 'active' : ''}`} onClick={() => load(project.name)}><div className="project-dropdown-name">{project.name}</div><div className="project-dropdown-meta">{project.updated_at}</div></div>)}</div>}
    </div>
    {currentName && <button className="project-btn project-btn-danger" onClick={remove} disabled={busy} title="删除自由画布项目"><Trash2 size={16} /></button>}
    <div style={{ flex: 1 }} /><div className="project-bar-title">{currentName ? `自由画布：${currentName}` : '未保存自由画布'}</div>
    <button className="project-btn" onClick={cleanupUploads} disabled={busy} title="清理未被任何自由画布、镜头表或 Concept 表引用的上传图片">{busy ? <Loader2 size={16} className="spin" /> : <Brush size={16} />}</button>
  </div>
}
