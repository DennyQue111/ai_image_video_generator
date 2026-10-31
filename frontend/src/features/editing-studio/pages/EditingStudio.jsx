import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import axios from 'axios'
import ClipPropertiesPanel from '../components/ClipPropertiesPanel'
import EditingProjectBar from '../components/EditingProjectBar'
import MediaLibraryPanel from '../components/MediaLibraryPanel'
import PreviewPanel from '../components/PreviewPanel'
import TimelinePanel from '../components/TimelinePanel'
import ExportDialog from '../components/ExportDialog'
import { useEditingTimeline } from '../hooks/useEditingTimeline'
import '../styles/EditingStudio.css'

export default function EditingStudio() {
  const timeline = useEditingTimeline()
  const [splitPreview, setSplitPreview] = useState(false)
  const [compactClips, setCompactClips] = useState(false)
  const [libraryWidth, setLibraryWidth] = useState(260)
  const [propertiesWidth, setPropertiesWidth] = useState(260)
  const [timelineHeight, setTimelineHeight] = useState(230)
  const [zoomPercent, setZoomPercent] = useState(66.67)
  const [currentProject, setCurrentProject] = useState(() => localStorage.getItem('ai-image-video-generator:editing-studio:current-project') || '')
  const [exportOpen, setExportOpen] = useState(false)
  const {
    library, clips, tracks, addTrack, removeTrack, selected, selectedId, playhead, setPlayhead, playing, setPlaying,
    frameRate, setProjectFrameRate,
    libraryError, videoRef, activeInfo, totalDuration, loadLibrary, addAsset,
    addLocalFiles, updateClip, selectClip, removeSelected, splitSelected, moveClip, trimClip, undo, canUndo, loadProject,
    handleMetadata, onVideoTime, onVideoEnded,
  } = timeline

  const togglePlayback = () => {
    if (!clips.length) return
    if (playhead >= totalDuration) setPlayhead(0)
    setPlaying((value) => !value)
  }

  useEffect(() => {
    const handleShortcut = (event) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (event.ctrlKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        splitSelected()
      } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (canUndo) undo()
      } else if (event.key === 'Backspace' && selected) {
        event.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [splitSelected, removeSelected, selected, undo, canUndo])

  const saveProject = async (name) => {
    const response = await axios.post('/api/editing-projects/save', {
      name,
      clips: clips.filter((clip) => !clip.temporary),
      tracks,
      frame_rate: frameRate,
    })
    setCurrentProject(response.data.name)
    localStorage.setItem('ai-image-video-generator:editing-studio:current-project', response.data.name)
    return response.data.name
  }

  const openProject = async (name) => {
    const response = await axios.get(`/api/editing-projects/${encodeURIComponent(name)}`)
    loadProject(response.data.project)
    setCurrentProject(response.data.project.name || name)
    localStorage.setItem('ai-image-video-generator:editing-studio:current-project', response.data.project.name || name)
  }

  const refreshProject = async (name) => {
    await openProject(name)
  }

  const deleteProject = async (name) => {
    await axios.delete(`/api/editing-projects/${encodeURIComponent(name)}`)
    loadProject({})
    setCurrentProject('')
    localStorage.removeItem('ai-image-video-generator:editing-studio:current-project')
  }

  return (
    <main className="editing-studio">
      <header className="editing-toolbar">
        <EditingProjectBar currentName={currentProject} onNameChange={setCurrentProject} onSave={saveProject} onLoad={openProject} onDelete={deleteProject} onRefreshProject={refreshProject} frameRate={frameRate} onFrameRateChange={setProjectFrameRate} />
        <div className="editing-toolbar-actions">
          <button className="edit-tool-button" onClick={loadLibrary}><RefreshCw size={15} />刷新素材</button>
          <button className="edit-export-button" disabled={!clips.length} onClick={() => setExportOpen(true)}>导出视频</button>
        </div>
      </header>

      <section className="editing-workspace" style={{ '--library-width': `${libraryWidth}px`, '--properties-width': `${propertiesWidth}px` }}>
        <MediaLibraryPanel assets={library} error={libraryError} onRefresh={loadLibrary} onAddAsset={addAsset} onImportFiles={addLocalFiles} />
        <div className="edit-resize-handle edit-resize-horizontal" role="separator" aria-label="调整素材库宽度" onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const start = event.clientX; const initial = libraryWidth
          const move = (e) => setLibraryWidth(Math.max(180, Math.min(440, initial + e.clientX - start)))
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
        }} />
        <PreviewPanel
          activeInfo={activeInfo}
          videoRef={videoRef}
          playhead={playhead}
          totalDuration={totalDuration}
          timelineFrameRate={frameRate || 24}
          playing={playing}
          onTogglePlayback={togglePlayback}
          onSeek={(time) => { setPlaying(false); setPlayhead(time) }}
          onLoadedMetadata={handleMetadata}
          onVideoTime={onVideoTime}
          onVideoEnded={onVideoEnded}
          selectedClip={selected}
          splitPreview={splitPreview}
          onToggleSplit={() => setSplitPreview((value) => !value)}
        />
        <div className="edit-resize-handle edit-resize-horizontal" role="separator" aria-label="调整属性栏宽度" onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const start = event.clientX; const initial = propertiesWidth
          const move = (e) => setPropertiesWidth(Math.max(190, Math.min(420, initial - (e.clientX - start))))
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
        }} />
        <ClipPropertiesPanel clip={selected} onUpdate={updateClip} onFrameRateChange={(clipId, fps) => {
          const isFirstVideo = clips.filter((clip) => clip.type === 'video').sort((a, b) => a.timelineStart - b.timelineStart)[0]?.id === clipId
          if (!frameRate && isFirstVideo) setProjectFrameRate(fps)
        }} />
      </section>

      <div className="edit-resize-handle edit-resize-vertical" role="separator" aria-label="调整时间线高度" onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = event.clientY; const initial = timelineHeight
        const move = (e) => setTimelineHeight(Math.max(150, Math.min(520, initial - (e.clientY - start))))
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
      }} />

      <TimelinePanel
        clips={clips}
        selectedId={selectedId}
        activeClipId={activeInfo?.clip?.id}
        playhead={playhead}
        totalDuration={totalDuration}
        onSelectClip={selectClip}
        onClearSelection={() => selectClip(null)}
        onSetPlayhead={(time) => { setPlaying(false); setPlayhead(time) }}
        onMoveClip={moveClip}
        onTrimClip={trimClip}
        tracks={tracks}
        onAddTrack={addTrack}
        onRemoveTrack={removeTrack}
        playing={playing}
        onTogglePlayback={togglePlayback}
        compactClips={compactClips}
        onToggleCompact={() => setCompactClips((value) => !value)}
        zoomPercent={zoomPercent}
        onZoomChange={setZoomPercent}
        frameRate={frameRate || 24}
        onNudgePlayhead={(direction) => setPlayhead((time) => Math.max(0, Math.min(totalDuration, time + direction / (frameRate || 24))))}
        onNudgeClip={(id, direction) => {
      const clip = clips.find((item) => item.id === id)
      if (clip) moveClip(id, clip.trackId || (clip.type === 'audio' ? 'audio-1' : 'video-1'), Math.max(0, clip.timelineStart + direction / (frameRate || 24)))
        }}
        style={{ height: timelineHeight }}
      />
      {exportOpen && <ExportDialog clips={clips} frameRate={frameRate || 24} onClose={() => setExportOpen(false)} />}
    </main>
  )
}
