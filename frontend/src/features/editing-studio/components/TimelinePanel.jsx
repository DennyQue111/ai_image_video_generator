import { Film, Music2, Pause, Play, Shrink, Maximize2, Plus, Minus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatTime } from '../utils/format'

const MIN_PPS = 18
const MAX_PPS = 180

export default function TimelinePanel({ clips, tracks, selectedId, activeClipId, playhead, totalDuration, onSelectClip, onSetPlayhead, onMoveClip, onAddTrack, onRemoveTrack, playing, onTogglePlayback, compactClips, onToggleCompact, zoomPercent, onZoomChange, style }) {
  const scrubPointerId = useRef(null)
  const clipDrag = useRef(null)
  const suppressClick = useRef(null)
  const [dragPreview, setDragPreview] = useState(null)
  const scrollRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(720)
  const pixelsPerSecond = MAX_PPS - (zoomPercent / 100) * (MAX_PPS - MIN_PPS)
  const trackWidth = Math.max(totalDuration * pixelsPerSecond, viewportWidth - 95, 720)
  const rulerCount = Math.max(1, Math.ceil(trackWidth / (pixelsPerSecond * 5)))

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth))
    observer.observe(element)
    setViewportWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const updateFromPointer = (event, track) => {
    const rect = track.getBoundingClientRect()
    onSetPlayhead(Math.max(0, Math.min(totalDuration, (event.clientX - rect.left) / pixelsPerSecond)))
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
  const handleClipPointerDown = (event, clip) => {
    if (event.button !== 0) return
    event.preventDefault()
    onSelectClip(clip.id)
    const button = event.currentTarget
    const track = button.closest('.timeline-track')
    clipDrag.current = {
      pointerId: event.pointerId,
      clipId: clip.id,
      sourceTrackId: clip.trackId || 'video-1',
      trackElement: track,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffsetX: event.clientX - button.getBoundingClientRect().left,
      candidateStart: clip.timelineStart,
      targetTrackId: clip.trackId || 'video-1',
      moved: false,
    }
    button.setPointerCapture(event.pointerId)
  }
  const handleClipPointerMove = (event) => {
    const session = clipDrag.current
    if (!session || session.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY) < 3 && !session.moved) return
    session.moved = true
    const rect = session.trackElement.getBoundingClientRect()
    session.candidateStart = Math.max(0, (event.clientX - rect.left - session.grabOffsetX) / pixelsPerSecond)
    const hoveredTrack = document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline-track')
    session.targetTrackId = hoveredTrack?.dataset.trackType === 'video' ? hoveredTrack.dataset.trackId : session.sourceTrackId
    setDragPreview({ clipId: session.clipId, timelineStart: session.candidateStart })
  }
  const finishClipDrag = (event, cancelled = false) => {
    const session = clipDrag.current
    if (!session || session.pointerId !== event.pointerId) return
    clipDrag.current = null
    setDragPreview(null)
    if (session.moved && !cancelled) {
      const hoveredTrack = document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline-track')
      const trackId = hoveredTrack?.dataset.trackType === 'video' ? hoveredTrack.dataset.trackId : session.sourceTrackId
      onMoveClip(session.clipId, trackId, session.candidateStart)
      onSelectClip(session.clipId)
      suppressClick.current = session.clipId
      window.setTimeout(() => { if (suppressClick.current === session.clipId) suppressClick.current = null }, 0)
    }
  }

  return (
    <section className={`editing-timeline ${compactClips ? 'compact' : ''}`} style={style}>
      <div className="timeline-header">
        <strong>时间线</strong>
        <div className="timeline-actions">
          <span className="timeline-timecode" title="播放头位置">{formatTime(playhead)}</span>
          <button className="edit-icon-button" title={playing ? '暂停时间线' : '播放时间线'} aria-label="播放或暂停时间线" onClick={onTogglePlayback}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <div className="timeline-zoom-control" title="向左放大，向右缩小">
            <SlidersHorizontal size={15} />
            <input aria-label="时间线缩放" type="range" min="0" max="100" value={zoomPercent} onChange={(event) => onZoomChange(Number(event.target.value))} />
          </div>
        </div>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-ruler" style={{ width: 95 + trackWidth, '--timeline-pps': `${pixelsPerSecond}px`, '--timeline-tick': `${pixelsPerSecond * 5}px` }}>
          <span className="timeline-ruler-gutter">00:00</span>
          {Array.from({ length: rulerCount }, (_, index) => <span key={index + 1}>{formatTime((index + 1) * 5)}</span>)}
        </div>
        {tracks.map((track) => {
          const trackClips = track.type === 'video' ? clips.filter((clip) => (clip.trackId || 'video-1') === track.id) : []
          return <div className="timeline-row" key={track.id}>
            <div className="timeline-track-label">
              <div className="timeline-track-controls">
                <button className="timeline-add-track" title={track.type === 'video' ? '在上方添加视频轨道' : '在下方添加音频轨道'} aria-label={track.type === 'video' ? '在上方添加视频轨道' : '在下方添加音频轨道'} onClick={() => onAddTrack(track.type, track.id)}><Plus size={13} /></button>
                <button className="timeline-remove-track" title={tracks.filter((item) => item.type === track.type).length <= 1 ? '至少保留一条该类型轨道' : '删除此轨道'} aria-label="删除此轨道" disabled={tracks.filter((item) => item.type === track.type).length <= 1} onClick={() => onRemoveTrack(track.id)}><Minus size={13} /></button>
              </div>
              {track.type === 'video' ? <Film size={14} /> : <Music2 size={14} />}<span>{track.name}</span>
            </div>
            <div
              className={`timeline-track ${track.type === 'audio' ? 'audio-track' : ''}`}
              data-track-id={track.id}
              data-track-type={track.type}
              style={{ width: trackWidth, '--timeline-pps': `${pixelsPerSecond}px`, '--timeline-tick': `${pixelsPerSecond * 5}px` }}
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={endTrackScrub}
              onPointerCancel={endTrackScrub}
            >
              {trackClips.map((clip) => {
                const width = Math.max(compactClips ? 12 : 24, (clip.end - clip.start) * pixelsPerSecond)
                return <button
                  key={clip.id}
                  onPointerDown={(event) => handleClipPointerDown(event, clip)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={(event) => finishClipDrag(event)}
                  onPointerCancel={(event) => finishClipDrag(event, true)}
                  onClick={(event) => {
                    if (suppressClick.current === clip.id) { suppressClick.current = null; event.preventDefault(); return }
                    onSelectClip(clip.id)
                  }}
                  className={`timeline-clip ${selectedId === clip.id ? 'selected' : ''} ${activeClipId === clip.id ? 'under-playhead' : ''}`}
                  style={{ width, left: (dragPreview?.clipId === clip.id ? dragPreview.timelineStart : clip.timelineStart) * pixelsPerSecond }}
                  title={clip.name}
                >
                  <span className="timeline-clip-thumb">{clip.type === 'video' ? <video src={clip.src} muted preload="metadata" /> : <img src={clip.src} alt="" />}</span>
                  <span className="timeline-clip-label">{clip.name}</span>
                  <span className="timeline-clip-duration">{formatTime(clip.end - clip.start)}</span>
                </button>
              })}
              {track.type === 'video' && !trackClips.length && <span className="timeline-placeholder">将素材添加到时间线</span>}
              {track.type === 'audio' && <span className="timeline-placeholder">音频轨道</span>}
              {totalDuration > 0 && <div className="timeline-playhead" style={{ left: `${playhead * pixelsPerSecond}px` }} />}
            </div>
          </div>
        })}
      </div>
      <div className="timeline-footer">
        <span>项目自动保存在此浏览器</span>
        <button className="timeline-compact-toggle" onClick={onToggleCompact} title={compactClips ? '展开片段显示' : '紧凑片段显示'} aria-label={compactClips ? '展开片段显示' : '紧凑片段显示'}>{compactClips ? <Maximize2 size={15} /> : <Shrink size={15} />}{compactClips ? '展开片段' : '紧凑显示'}</button>
      </div>
    </section>
  )
}
