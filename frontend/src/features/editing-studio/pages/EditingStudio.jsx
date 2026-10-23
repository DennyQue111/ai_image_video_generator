import { Clapperboard, RefreshCw } from 'lucide-react'
import ClipPropertiesPanel from '../components/ClipPropertiesPanel'
import MediaLibraryPanel from '../components/MediaLibraryPanel'
import PreviewPanel from '../components/PreviewPanel'
import TimelinePanel from '../components/TimelinePanel'
import { useEditingTimeline } from '../hooks/useEditingTimeline'
import '../styles/EditingStudio.css'

export default function EditingStudio() {
  const timeline = useEditingTimeline()
  const {
    library, clips, selected, selectedId, playhead, setPlayhead, playing, setPlaying,
    libraryError, videoRef, dragId, activeInfo, totalDuration, loadLibrary, addAsset,
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

      <section className="editing-workspace">
        <MediaLibraryPanel assets={library} error={libraryError} onRefresh={loadLibrary} onAddAsset={addAsset} onImportFiles={addLocalFiles} />
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
        />
        <ClipPropertiesPanel clip={selected} onUpdate={updateClip} onSplit={splitSelected} onRemove={removeSelected} />
      </section>

      <TimelinePanel
        clips={clips}
        selectedId={selectedId}
        activeClipId={activeInfo?.clip?.id}
        playhead={playhead}
        totalDuration={totalDuration}
        onSeekClip={seekToClip}
        onSetPlayhead={(time) => { setPlaying(false); setPlayhead(time) }}
        onMoveClip={moveClip}
        dragId={dragId}
      />
    </main>
  )
}
