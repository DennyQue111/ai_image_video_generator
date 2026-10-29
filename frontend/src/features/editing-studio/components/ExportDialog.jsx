import { useEffect, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import axios from 'axios'

const videoFormats = ['mp4', 'mov', 'webm']
const audioFormats = ['mp3', 'wav', 'aac', 'm4a']

export default function ExportDialog({ clips, frameRate, onClose }) {
  const [mode, setMode] = useState('video')
  const [filename, setFilename] = useState('剪辑台导出')
  const [format, setFormat] = useState('mp4')
  const [resolution, setResolution] = useState('source')
  const [quality, setQuality] = useState('high')
  const [includeAudio, setIncludeAudio] = useState(true)
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const formats = mode === 'audio' ? audioFormats : videoFormats

  useEffect(() => { if (!formats.includes(format)) setFormat(formats[0]) }, [mode])
  useEffect(() => {
    if (!job?.export_id || ['completed', 'error'].includes(job.status)) return undefined
    const timer = window.setInterval(async () => {
      try {
        const response = await axios.get(`/api/editing-exports/${job.export_id}`)
        setJob((current) => ({ ...current, ...response.data }))
      } catch (requestError) {
        setError(requestError.response?.data?.detail || requestError.message)
      }
    }, 800)
    return () => window.clearInterval(timer)
  }, [job?.export_id, job?.status])

  const startExport = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const response = await axios.post('/api/editing-exports', {
        clips: clips.filter((clip) => !clip.temporary),
        video_clips: clips.filter((clip) => clip.type === 'video' || clip.type === 'image'),
        audio_clips: clips.filter((clip) => clip.type === 'audio'),
        mode, filename, format, resolution, quality,
        frame_rate: frameRate || 24,
        audio: mode === 'video' && includeAudio,
      })
      setJob({ export_id: response.data.export_id, status: 'queued', progress: 0 })
    } catch (requestError) {
      setError(requestError.response?.data?.detail || requestError.message)
    }
  }

  const download = () => {
    if (!job?.export_id) return
    const link = document.createElement('a')
    link.href = `/api/editing-exports/${job.export_id}/download`
    link.download = `${filename}.${format}`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return <div className="editing-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && job?.status !== 'processing') onClose() }}>
    <form className="editing-export-dialog" onSubmit={startExport}>
      <header><strong>导出时间线</strong><button type="button" className="edit-icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button></header>
      {!job && <>
        <label className="export-field">导出内容<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="video">视频轨 + 音频轨</option><option value="audio">仅导出音频轨</option></select></label>
        <label className="export-field">文件名称<input value={filename} onChange={(event) => setFilename(event.target.value)} required maxLength={100} /></label>
        <div className="export-row">
          <label className="export-field">格式<select value={format} onChange={(event) => setFormat(event.target.value)}>{formats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
          {mode === 'video' && <label className="export-field">分辨率<select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="source">跟随素材（最高 1080p）</option><option value="1080p">1920 × 1080</option><option value="720p">1280 × 720</option><option value="480p">854 × 480</option></select></label>}
        </div>
        {mode === 'video' && <>
          <label className="export-field">画质<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="high">高质量（文件较大）</option><option value="medium">中质量（均衡）</option><option value="low">低质量（文件较小）</option></select></label>
          <label className="export-check"><input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} />包含视频原声</label>
        </>}
        <p className="export-hint">视频从视频轨合成，声音从音频轨合成；片段之间的空白位置会填充黑帧或静音。输出帧率为 {frameRate || 24} fps。</p>
        <footer><button type="button" className="edit-tool-button" onClick={onClose}>取消</button><button className="edit-export-button" type="submit" disabled={!clips.length}>开始导出</button></footer>
      </>}
      {job && <div className="export-progress">
        {job.status === 'completed' ? <><p>导出完成：{filename}.{format}</p><button type="button" className="edit-export-button" onClick={download}><Download size={15} />下载文件</button></> : job.status === 'error' ? <p className="edit-error">导出失败：{job.error || error}</p> : <p><Loader2 size={16} className="spin" />正在导出…</p>}
        {job.status !== 'error' && job.status !== 'completed' && <progress max="100" value={job.progress || 0} />}
        <footer><button type="button" className="edit-tool-button" onClick={onClose} disabled={job.status === 'processing'}>关闭</button></footer>
      </div>}
      {error && !job && <p className="edit-error">{error}</p>}
    </form>
  </div>
}
