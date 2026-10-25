import { Film, Music2, Pause, Play, Shrink, Maximize2, Plus, Minus } from 'lucide-react'
import { useRef } from 'react'
import { formatTime } from '../utils/format'

export default function TimelinePanel({ clips, tracks, selectedId, activeClipId, playhead, totalDuration, onSeekClip, onSetPlayhead, onMoveClip, onMoveClipToTrack, dragId, onAddTrack, onRemoveTrack, playing, onTogglePlayback, compactClips, onToggleCompact, style }) {
  const scrubPointerId = useRef(null)
  const trackWidth = Math.max(totalDuration * 72, 720)
  const updateFromPointer = (event, track) => {
    const rect = track.getBoundingClientRect()
    onSetPlayhead(Math.max(0, Math.min(totalDuration, (event.clientX - rect.left) / 72)))
  }
  const handleTrackPointerDown = (event) => {
    if (event.target.closest('button')) return
    const track = event.currentTarget
    scrubPointerId.current = event.pointerId
    track.setPointerCapture(event.pointerId)
    updateFromPointer(event, track)
  }
  const handleTrackPointerMove = (event) => {
    if (scrubPointerId.current === event.pointerId) updateFromPointer(event, event.currentTarget)
  }
  const endTrackScrub = (event) => {
    if (scrubPointerId.current === event.pointerId) scrubPointerId.current = null
  }
  return (
    <section className={`editing-timeline ${compactClips ? 'compact' : ''}`} style={style}>
      <div className="timeline-header"><div><strong>时间线</strong><span>{clips.length} 个片段 · {formatTime(totalDuration)}</span></div><div className="timeline-actions"><span className="timeline-hint">拖动片段可调整顺序</span><button className="edit-icon-button" title={playing ? '暂停时间线' : '播放时间线'} aria-label="播放或暂停时间线" onClick={onTogglePlayback}>{playing ? <Pause size={16} /> : <Play size={16} />}</button></div></div>
      <div className="timeline-scroll">
      <div className="timeline-ruler" style={{ minWidth: trackWidth }}><span className="timeline-ruler-gutter">时间</span>{Array.from({ length: Math.max(1, Math.ceil(totalDuration / 5)) }, (_, index) => <span key={index + 1}>{formatTime((index + 1) * 5)}</span>)}</div>
      {tracks.map((track) => <div className="timeline-row" key={track.id}>
        <div className="timeline-track-label"><div className="timeline-track-controls"><button className="timeline-add-track" title={track.type === 'video' ? '在上方添加视频轨道' : '在下方添加音频轨道'} aria-label={track.type === 'video' ? '在上方添加视频轨道' : '在下方添加音频轨道'} onClick={() => onAddTrack(track.type, track.id)}><Plus size={13} /></button><button className="timeline-remove-track" title={tracks.filter((item) => item.type === track.type).length <= 1 ? '至少保留一条该类型轨道' : '删除此轨道'} aria-label="删除此轨道" disabled={tracks.filter((item) => item.type === track.type).length <= 1} onClick={() => onRemoveTrack(track.id)}><Minus size={13} /></button></div>{track.type === 'video' ? <Film size={14} /> : <Music2 size={14} />}<span>{track.name}</span></div>
        <div className={`timeline-track ${track.type === 'audio' ? 'audio-track' : ''}`} style={{ minWidth: trackWidth }} onPointerDown={handleTrackPointerDown} onPointerMove={handleTrackPointerMove} onPointerUp={endTrackScrub} onPointerCancel={endTrackScrub} onDragOver={(event) => { if (track.type === 'video') event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (track.type === 'video') onMoveClipToTrack(track.id) }}>
        {track.type === 'video' && clips.filter((clip) => (clip.trackId || 'video-1') === track.id).map((clip) => {
          const width = Math.max(compactClips ? 24 : 72, (clip.end - clip.start) * 72)
          return <button key={clip.id} draggable onDragStart={() => { dragId.current = clip.id }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); onMoveClip(clip.id) }} onClick={() => onSeekClip(clip.id)} className={`timeline-clip ${selectedId === clip.id ? 'selected' : ''} ${activeClipId === clip.id ? 'under-playhead' : ''}`} style={{ width }} title={clip.name}>
            <span className="timeline-clip-thumb">{clip.type === 'video' ? <video src={clip.src} muted preload="metadata" /> : <img src={clip.src} alt="" />}</span><span className="timeline-clip-label">{clip.name}</span><span className="timeline-clip-duration">{formatTime(clip.end - clip.start)}</span>
          </button>
        })}
        {track.type === 'video' && !clips.some((clip) => (clip.trackId || 'video-1') === track.id) && <span className="timeline-placeholder">将素材添加到时间线</span>}
        {track.type === 'audio' && <span className="timeline-placeholder">音频轨道</span>}
        {totalDuration > 0 && <div className="timeline-playhead" style={{ left: `${Math.min(playhead * 72, Math.max(totalDuration * 72, 1))}px` }} />}
        </div>
      </div>)}
      </div>
      <div className="timeline-footer"><span>项目自动保存在此浏览器</span><button className="timeline-compact-toggle" onClick={onToggleCompact} title={compactClips ? '展开片段显示' : '紧凑片段显示'} aria-label={compactClips ? '展开片段显示' : '紧凑片段显示'}>{compactClips ? <Maximize2 size={15} /> : <Shrink size={15} />}{compactClips ? '展开片段' : '紧凑显示'}</button></div>
    </section>
  )
}
