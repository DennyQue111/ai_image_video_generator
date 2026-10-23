import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { Clapperboard, Film, Image as ImageIcon, Play, Pause, Plus, RefreshCw, Scissors, Trash2, Upload, Volume2 } from 'lucide-react'
import '../styles/EditingStudio.css'

const PROJECT_KEY = 'ai-image-video-generator:editing-studio:v1'
const fmt = (value) => {
  const safe = Math.max(0, Number(value) || 0)
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toFixed(1).padStart(4, '0')}`
}
const filterFor = (grade = {}) => `brightness(${grade.brightness ?? 100}%) contrast(${grade.contrast ?? 100}%) saturate(${grade.saturation ?? 100}%)`

export default function EditingStudio() {
  const [library, setLibrary] = useState([])
  const [clips, setClips] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]') } catch { return [] }
  })
  const [selectedId, setSelectedId] = useState(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [query, setQuery] = useState('')
  const [libraryError, setLibraryError] = useState('')
  const videoRef = useRef(null)
  const imageInputRef = useRef(null)
  const dragId = useRef(null)

  const selected = clips.find((clip) => clip.id === selectedId) || null
  const totalDuration = clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0)
  const activeInfo = useMemo(() => {
    let cursor = 0
    for (const clip of clips) {
      const duration = Math.max(0, clip.end - clip.start)
      if (playhead <= cursor + duration || clip === clips.at(-1)) {
        return { clip, timelineStart: cursor, sourceTime: clip.start + Math.max(0, Math.min(duration, playhead - cursor)) }
      }
      cursor += duration
    }
    return null
  }, [clips, playhead])

  useEffect(() => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(clips.filter((clip) => !clip.temporary)))
  }, [clips])

  const loadLibrary = async () => {
    setLibraryError('')
    try {
      const response = await axios.get('/api/media-library')
      setLibrary(response.data.assets || [])
    } catch (error) {
      setLibraryError(error.response?.data?.detail || '读取生成素材失败')
    }
  }

  useEffect(() => { loadLibrary() }, [])

  const addAsset = (asset) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const clip = {
      id,
      assetId: asset.id,
      name: asset.filename,
      src: asset.url,
      type: asset.type,
      start: 0,
      end: asset.type === 'image' ? 5 : 10,
      sourceDuration: asset.type === 'image' ? 5 : 10,
      grade: { brightness: 100, contrast: 100, saturation: 100 },
    }
    setClips((items) => [...items, clip])
    setSelectedId(id)
  }

  const addLocalFiles = (files) => {
    Array.from(files || []).forEach((file) => {
      if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) return
      const url = URL.createObjectURL(file)
      addAsset({ id: `local:${file.name}:${Date.now()}`, filename: file.name, type: file.type.startsWith('video/') ? 'video' : 'image', url, temporary: true })
      setClips((items) => items.map((clip) => clip.src === url ? { ...clip, temporary: true } : clip))
    })
  }

  const updateClip = (id, patch) => setClips((items) => items.map((clip) => clip.id === id ? { ...clip, ...patch } : clip))

  const seekToClip = (id) => {
    const index = clips.findIndex((clip) => clip.id === id)
    if (index < 0) return
    const time = clips.slice(0, index).reduce((sum, clip) => sum + clip.end - clip.start, 0)
    setPlayhead(time)
    setSelectedId(id)
  }

  const removeSelected = () => {
    if (!selected) return
    const index = clips.findIndex((clip) => clip.id === selected.id)
    setClips((items) => items.filter((clip) => clip.id !== selected.id))
    setSelectedId(clips[index + 1]?.id || clips[index - 1]?.id || null)
  }

  const splitSelected = () => {
    if (!selected || selected.type !== 'video') return
    const index = clips.findIndex((clip) => clip.id === selected.id)
    const offset = playhead - clips.slice(0, index).reduce((sum, clip) => sum + clip.end - clip.start, 0)
    const cutAt = selected.start + offset
    if (cutAt <= selected.start + 0.15 || cutAt >= selected.end - 0.15) return
    const left = { ...selected, id: `${selected.id}-a-${Date.now()}`, end: cutAt, name: `${selected.name} · A` }
    const right = { ...selected, id: `${selected.id}-b-${Date.now()}`, start: cutAt, name: `${selected.name} · B` }
    setClips((items) => [...items.slice(0, index), left, right, ...items.slice(index + 1)])
    setSelectedId(right.id)
  }

  const moveClip = (targetId) => {
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId || sourceId === targetId) return
    setClips((items) => {
      const next = [...items]
      const from = next.findIndex((clip) => clip.id === sourceId)
      const to = next.findIndex((clip) => clip.id === targetId)
      if (from < 0 || to < 0) return items
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const handleMetadata = (event) => {
    if (!activeInfo?.clip || !Number.isFinite(event.currentTarget.duration)) return
    const duration = event.currentTarget.duration
    const clip = activeInfo.clip
    if (clip.sourceDuration === 10 && clip.end === 10) {
      updateClip(clip.id, { sourceDuration: duration, end: duration })
    }
  }

  const onVideoTime = (event) => {
    if (!playing || !activeInfo) return
    const current = event.currentTarget.currentTime
    if (current >= activeInfo.clip.end - 0.06) {
      onVideoEnded()
      return
    }
    if (Math.abs(current - activeInfo.sourceTime) > 0.6) return
    setPlayhead(activeInfo.timelineStart + Math.max(0, current - activeInfo.clip.start))
  }

  const onVideoEnded = () => {
    if (activeInfo && activeInfo.timelineStart + activeInfo.clip.end - activeInfo.clip.start < totalDuration) {
      setPlayhead(activeInfo.timelineStart + activeInfo.clip.end - activeInfo.clip.start + 0.01)
    } else {
      setPlaying(false)
      setPlayhead(0)
    }
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || activeInfo?.clip?.type !== 'video') return
    const targetTime = Math.min(activeInfo.sourceTime, Math.max(0, video.duration - 0.05 || activeInfo.sourceTime))
    if (Math.abs(video.currentTime - targetTime) > 0.35) video.currentTime = targetTime
    if (playing) video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [activeInfo?.clip?.id, activeInfo?.sourceTime, playing])

  useEffect(() => {
    if (!playing || activeInfo?.clip?.type !== 'image') return undefined
    const timer = window.setTimeout(() => {
      if (playhead + 0.08 >= totalDuration) { setPlayhead(0); setPlaying(false) }
      else setPlayhead((time) => time + 0.08)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [playing, activeInfo?.clip?.id, playhead, totalDuration])

  const filteredLibrary = library.filter((asset) => asset.filename.toLowerCase().includes(query.toLowerCase()))

  return (
    <main className="editing-studio">
      <header className="editing-toolbar">
        <div className="editing-brand"><Clapperboard size={20} /><div><strong>剪辑台</strong><span>基础时间线 · 本地项目</span></div></div>
        <div className="editing-toolbar-actions">
          <button className="edit-tool-button" onClick={loadLibrary}><RefreshCw size={15} />刷新素材</button>
          <button className="edit-export-button" disabled title="MP4 导出将在下一阶段接入">导出视频（开发中）</button>
        </div>
      </header>

      <section className="editing-workspace">
        <aside className="editing-media-panel">
          <div className="edit-panel-heading"><span>素材库</span><button title="上传本地素材" onClick={() => imageInputRef.current?.click()}><Plus size={16} /></button></div>
          <input ref={imageInputRef} type="file" accept="video/*,image/*" multiple hidden onChange={(event) => { addLocalFiles(event.target.files); event.target.value = '' }} />
          <button className="edit-upload-drop" onClick={() => imageInputRef.current?.click()}><Upload size={18} /><span>导入本地图片或视频</span></button>
          <div className="edit-library-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索生成素材" /><button onClick={loadLibrary}><RefreshCw size={14} /></button></div>
          {libraryError && <div className="edit-error">{libraryError}</div>}
          <div className="edit-asset-list">
            {filteredLibrary.map((asset) => (
              <button key={asset.id} className="edit-asset" onClick={() => addAsset(asset)} title="添加到时间线">
                <span className="edit-asset-thumb">{asset.type === 'video' ? <video src={asset.url} muted preload="metadata" /> : <img src={asset.url} alt="" />}</span>
                <span className="edit-asset-name">{asset.type === 'video' ? <Film size={13} /> : <ImageIcon size={13} />}{asset.filename}</span>
                <Plus size={14} />
              </button>
            ))}
            {!filteredLibrary.length && !libraryError && <p className="edit-empty">还没有生成素材。可以先从本地导入，生成结果也会自动出现在这里。</p>}
          </div>
        </aside>

        <section className="editing-preview-column">
          <div className="edit-preview-heading"><span>预览</span><span>{fmt(playhead)} / {fmt(totalDuration)}</span></div>
          <div className="edit-preview-stage">
            {activeInfo?.clip ? activeInfo.clip.type === 'video' ? (
              <video ref={videoRef} src={activeInfo.clip.src} muted={!playing} playsInline onLoadedMetadata={handleMetadata} onTimeUpdate={onVideoTime} onEnded={onVideoEnded} style={{ filter: filterFor(activeInfo.clip.grade) }} />
            ) : <img src={activeInfo.clip.src} alt="预览" style={{ filter: filterFor(activeInfo.clip.grade) }} /> : <div className="edit-preview-placeholder"><Clapperboard size={38} /><span>从左侧素材库添加镜头开始剪辑</span></div>}
          </div>
          <div className="edit-transport">
            <button className="edit-play-button" onClick={() => { if (!clips.length) return; if (playhead >= totalDuration) setPlayhead(0); setPlaying((value) => !value) }}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '播放'}</button>
            <input aria-label="播放头位置" type="range" min="0" max={Math.max(totalDuration, 0.1)} step="0.05" value={Math.min(playhead, totalDuration)} onChange={(event) => { setPlaying(false); setPlayhead(Number(event.target.value)) }} />
            <span>{fmt(playhead)}</span>
          </div>
        </section>

        <aside className="editing-properties">
          <div className="edit-panel-heading"><span>片段属性</span></div>
          {!selected ? <p className="edit-empty">选择时间线中的片段，调整入点、出点和基础色彩。</p> : <>
            <div className="edit-selected-name">{selected.type === 'video' ? <Film size={15} /> : <ImageIcon size={15} />}{selected.name}</div>
            <div className="edit-property-group"><label>入点 <span>{fmt(selected.start)}</span></label><input type="range" min="0" max={Math.max(selected.sourceDuration - 0.1, 0.1)} step="0.1" value={selected.start} onChange={(event) => updateClip(selected.id, { start: Math.min(Number(event.target.value), selected.end - 0.1) })} /></div>
            <div className="edit-property-group"><label>出点 <span>{fmt(selected.end)}</span></label><input type="range" min={Math.min(selected.start + 0.1, selected.sourceDuration)} max={Math.max(selected.sourceDuration, 0.2)} step="0.1" value={Math.min(selected.end, selected.sourceDuration)} onChange={(event) => updateClip(selected.id, { end: Math.max(Number(event.target.value), selected.start + 0.1) })} /></div>
            <div className="edit-grade-title"><Volume2 size={14} />基础调色（预览）</div>
            {[["brightness", "亮度"], ["contrast", "对比度"], ["saturation", "饱和度"]].map(([key, label]) => <div className="edit-property-group" key={key}><label>{label}<span>{selected.grade?.[key] ?? 100}%</span></label><input type="range" min="0" max="200" value={selected.grade?.[key] ?? 100} onChange={(event) => updateClip(selected.id, { grade: { ...selected.grade, [key]: Number(event.target.value) } })} /></div>)}
            <div className="edit-property-actions"><button onClick={splitSelected} disabled={selected.type !== 'video'}><Scissors size={14} />在播放头分割</button><button className="danger" onClick={removeSelected}><Trash2 size={14} />删除片段</button></div>
          </>}
        </aside>
      </section>

      <section className="editing-timeline">
        <div className="timeline-header"><div><strong>时间线</strong><span>{clips.length} 个片段 · {fmt(totalDuration)}</span></div><div className="timeline-hint">拖动片段可调整顺序</div></div>
        <div className="timeline-ruler"><span>00:00</span>{Array.from({ length: Math.max(1, Math.ceil(totalDuration / 5)) }, (_, index) => <span key={index + 1}>{fmt((index + 1) * 5)}</span>)}</div>
        <div className="timeline-track-label"><Film size={14} />视频 / 图片</div>
        <div className="timeline-track" onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); setPlaying(false); setPlayhead(Math.max(0, Math.min(totalDuration, (event.clientX - rect.left) / 72))) } }}>
          {clips.map((clip) => {
            const width = Math.max(72, (clip.end - clip.start) * 72)
            const isActive = activeInfo?.clip.id === clip.id
            return <button key={clip.id} draggable onDragStart={() => { dragId.current = clip.id }} onDragOver={(event) => event.preventDefault()} onDrop={() => moveClip(clip.id)} onClick={() => seekToClip(clip.id)} className={`timeline-clip ${selectedId === clip.id ? 'selected' : ''} ${isActive ? 'under-playhead' : ''}`} style={{ width }} title={clip.name}>
              <span className="timeline-clip-thumb">{clip.type === 'video' ? <video src={clip.src} muted preload="metadata" /> : <img src={clip.src} alt="" />}</span><span className="timeline-clip-label">{clip.name}</span><span className="timeline-clip-duration">{fmt(clip.end - clip.start)}</span>
            </button>
          })}
          {!clips.length && <span className="timeline-placeholder">将左侧素材添加到时间线</span>}
          {totalDuration > 0 && <div className="timeline-playhead" style={{ left: `${Math.min(playhead * 72, Math.max(totalDuration * 72, 1))}px` }} />}
        </div>
        <div className="timeline-footer"><span>当前以顺序视频轨道进行剪切和拼接；音频、多轨、转场与导出将逐步加入。</span><span>项目自动保存在此浏览器</span></div>
      </section>
    </main>
  )
}
