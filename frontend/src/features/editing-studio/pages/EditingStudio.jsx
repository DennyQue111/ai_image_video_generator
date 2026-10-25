import { Clapperboard, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import ClipPropertiesPanel from '../components/ClipPropertiesPanel'
import MediaLibraryPanel from '../components/MediaLibraryPanel'
import PreviewPanel from '../components/PreviewPanel'
import TimelinePanel from '../components/TimelinePanel'
import { useEditingTimeline } from '../hooks/useEditingTimeline'
import '../styles/EditingStudio.css'

export default function EditingStudio() {
  const timeline = useEditingTimeline()
  const [splitPreview, setSplitPreview] = useState(false)
  const [compactClips, setCompactClips] = useState(false)
  const [libraryWidth, setLibraryWidth] = useState(260)
  const [propertiesWidth, setPropertiesWidth] = useState(260)
  const [timelineHeight, setTimelineHeight] = useState(230)
  const {
    library, clips, tracks, addTrack, removeTrack, selected, selectedId, playhead, setPlayhead, playing, setPlaying,
    libraryError, videoRef, dragId, activeInfo, totalDuration, loadLibrary, addAsset, moveClipToTrack,
    addLocalFiles, updateClip, seekToClip, removeSelected, splitSelected, moveClip,
    handleMetadata, onVideoTime, onVideoEnded,
  } = timeline

  const togglePlayback = () => {
    if (!clips.length) return
    if (playhead >= totalDuration) setPlayhead(0)
    setPlaying((value) => !value)
  }

  return (
    <main className="editing-studio">
      <header className="editing-toolbar">
        <div className="editing-brand"><Clapperboard size={20} /><div><strong>剪辑台</strong><span>基础时间线 · 本地项目</span></div></div>
        <div className="editing-toolbar-actions">
          <button className="edit-tool-button" onClick={loadLibrary}><RefreshCw size={15} />刷新素材</button>
          <button className="edit-export-button" disabled title="MP4 导出将在下一阶段接入">导出视频（开发中）</button>
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
        <ClipPropertiesPanel clip={selected} onUpdate={updateClip} onSplit={splitSelected} onRemove={removeSelected} />
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
        onSeekClip={seekToClip}
        onSetPlayhead={(time) => { setPlaying(false); setPlayhead(time) }}
        onMoveClip={moveClip}
        onMoveClipToTrack={moveClipToTrack}
        dragId={dragId}
        tracks={tracks}
        onAddTrack={addTrack}
        onRemoveTrack={removeTrack}
        playing={playing}
        onTogglePlayback={togglePlayback}
        compactClips={compactClips}
        onToggleCompact={() => setCompactClips((value) => !value)}
        style={{ height: timelineHeight }}
      />
    </main>
  )
}
