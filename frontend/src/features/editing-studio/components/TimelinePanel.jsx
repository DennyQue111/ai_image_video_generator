import { Film, Music2, Pause, Play, Shrink, Maximize2, Plus, Minus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatTime, formatTimecode } from '../utils/format'

const MIN_PPS = 18
const MAX_PPS = 180

export default function TimelinePanel({ clips, tracks, selectedId, selectedIds = [], activeClipId, playhead, totalDuration, onSelectClip, onSelectClips, onClearSelection, onSetPlayhead, onMoveClip, onTrimClip, onAddTrack, onRemoveTrack, playing, onTogglePlayback, compactClips, onToggleCompact, zoomPercent, onZoomChange, style, frameRate = 24, onNudgePlayhead, onNudgeClip }) {
  const scrubPointerId = useRef(null)
  const trackGesture = useRef(null)
  const clipDrag = useRef(null)
  const trimDrag = useRef(null)
  const suppressClick = useRef(null)
  const [dragPreview, setDragPreview] = useState(null)
  const [marquee, setMarquee] = useState(null)
  const scrollRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(720)
  const [focused, setFocused] = useState(false)
  const pixelsPerSecond = MAX_PPS - (zoomPercent / 100) * (MAX_PPS - MIN_PPS)
  const trackWidth = Math.max(totalDuration * pixelsPerSecond, viewportWidth - 95, 720)
  const rulerCount = Math.max(1, Math.ceil(trackWidth / (pixelsPerSecond * 5)))

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!focused || event.ctrlKey || event.altKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      if (event.shiftKey) {
        const boundary = playhead
        const side = event.key === 'ArrowRight' ? 1 : -1
        const ids = clips.filter((clip) => side > 0
          ? clip.timelineStart >= boundary - 0.0001
          : clip.timelineStart + clip.end - clip.start <= boundary + 0.0001
        ).map((clip) => clip.id)
        onSelectClips?.(ids)
        return
      }
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      if (selectedId) onNudgeClip?.(selectedId, direction)
      else onNudgePlayhead?.(direction)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focused, selectedId, clips, playhead, onSelectClips, onNudgeClip, onNudgePlayhead])

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
    onSetPlayhead(Math.round(Math.max(0, Math.min(totalDuration, (event.clientX - rect.left) / pixelsPerSecond)) * frameRate) / frameRate)
  }
  const handleTrackPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest('button, .timeline-clip, .timeline-playhead')) return
    const track = event.currentTarget
    trackGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, endX: event.clientX, endY: event.clientY, track, moved: false }
    track.setPointerCapture(event.pointerId)
  }
  const handlePlayheadPointerDown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const track = event.currentTarget.closest('.timeline-track')
    scrubPointerId.current = event.pointerId
    track.setPointerCapture(event.pointerId)
    updateFromPointer(event, track)
  }
  const handleTrackPointerMove = (event) => {
    const gesture = trackGesture.current
    if (gesture?.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
      if (distance >= 4) gesture.moved = true
      if (gesture.moved) {
        gesture.endX = event.clientX
        gesture.endY = event.clientY
        setMarquee({ left: Math.min(gesture.startX, event.clientX), top: Math.min(gesture.startY, event.clientY), width: Math.abs(event.clientX - gesture.startX), height: Math.abs(event.clientY - gesture.startY) })
      }
    }
    if (scrubPointerId.current === event.pointerId) updateFromPointer(event, event.currentTarget)
  }
  const endTrackScrub = (event) => {
    const gesture = trackGesture.current
    if (gesture?.pointerId === event.pointerId) {
      trackGesture.current = null
      if (gesture.moved) {
        const ids = [...(scrollRef.current?.querySelectorAll('.timeline-clip[data-clip-id]') || [])]
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            const left = Math.min(gesture.startX, event.clientX), right = Math.max(gesture.startX, event.clientX)
            const top = Math.min(gesture.startY, event.clientY), bottom = Math.max(gesture.startY, event.clientY)
            return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom
          }).map((element) => element.dataset.clipId)
        onSelectClips?.(ids)
      } else {
        onClearSelection?.()
        updateFromPointer(event, gesture.track)
      }
      setMarquee(null)
      return
    }
    if (scrubPointerId.current === event.pointerId) scrubPointerId.current = null
  }
  const handleClipPointerDown = (event, clip) => {
    if (event.button !== 0) return
    if (event.shiftKey) { event.stopPropagation(); return }
    const edge = selectedId === clip.id ? event.target.closest('.timeline-trim-handle')?.dataset.edge : null
    if (edge) {
      event.preventDefault()
      event.stopPropagation()
      trimDrag.current = { pointerId: event.pointerId, clipId: clip.id, edge, startX: event.clientX, delta: 0 }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!selectedIds.includes(clip.id)) onSelectClip(clip.id)
    const draggedIds = selectedIds.includes(clip.id) ? selectedIds : [clip.id]
    const dragged = new Set(draggedIds)
    draggedIds.forEach((id) => {
      const selected = clips.find((item) => item.id === id)
      if (selected?.type === 'video') clips.filter((item) => item.linkedClipId === selected.id).forEach((audio) => dragged.add(audio.id))
      if (selected?.type === 'audio' && selected.linkedClipId) dragged.add(selected.linkedClipId)
    })
    const button = event.currentTarget
    const track = button.closest('.timeline-track')
    clipDrag.current = {
      pointerId: event.pointerId,
      clipId: clip.id,
      clipType: clip.type,
      sourceTrackId: clip.trackId || 'video-1',
      trackElement: track,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffsetX: event.clientX - button.getBoundingClientRect().left,
      candidateStart: clip.timelineStart,
      originalStart: clip.timelineStart,
      targetTrackId: clip.trackId || 'video-1',
      element: button,
      clipIds: [...dragged],
      elements: [...(scrollRef.current?.querySelectorAll('.timeline-clip[data-clip-id]') || [])].filter((element) => dragged.has(element.dataset.clipId)),
      moved: false,
    }
    button.setPointerCapture(event.pointerId)
  }
  const handleClipPointerMove = (event) => {
    if (trimDrag.current?.pointerId === event.pointerId) {
      trimDrag.current.delta = (event.clientX - trimDrag.current.startX) / pixelsPerSecond
      setDragPreview({ clipId: trimDrag.current.clipId, edge: trimDrag.current.edge, delta: trimDrag.current.delta })
      return
    }
    const session = clipDrag.current
    if (!session || session.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY) < 3 && !session.moved) return
    session.moved = true
    const rect = session.trackElement.getBoundingClientRect()
    session.candidateStart = Math.max(0, Math.round(((event.clientX - rect.left - session.grabOffsetX) / pixelsPerSecond) * frameRate) / frameRate)
    const hoveredTrack = document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline-track')
    session.targetTrackId = hoveredTrack?.dataset.trackType === (session.clipType === 'audio' ? 'audio' : 'video') ? hoveredTrack.dataset.trackId : session.sourceTrackId
    const translate = `translate3d(${(session.candidateStart - session.originalStart) * pixelsPerSecond}px, 0, 0)`
    session.elements.forEach((element) => { element.style.transform = translate })
  }
  const finishClipDrag = (event, cancelled = false) => {
    if (trimDrag.current?.pointerId === event.pointerId) {
      const session = trimDrag.current
      trimDrag.current = null
      setDragPreview(null)
      if (!cancelled) onTrimClip?.(session.clipId, session.edge, session.delta)
      suppressClick.current = session.clipId
      window.setTimeout(() => { if (suppressClick.current === session.clipId) suppressClick.current = null }, 0)
      return
    }
    const session = clipDrag.current
    if (!session || session.pointerId !== event.pointerId) return
    clipDrag.current = null
    session.elements.forEach((element) => { element.style.transform = '' })
    if (session.moved && !cancelled) {
      const hoveredTrack = document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline-track')
      const trackId = hoveredTrack?.dataset.trackType === (session.clipType === 'audio' ? 'audio' : 'video') ? hoveredTrack.dataset.trackId : session.sourceTrackId
      onMoveClip(session.clipId, trackId, session.candidateStart, session.clipIds)
      suppressClick.current = session.clipId
      window.setTimeout(() => { if (suppressClick.current === session.clipId) suppressClick.current = null }, 0)
    }
  }

  return (
    <section className={`editing-timeline ${compactClips ? 'compact' : ''} ${focused ? 'keyboard-focused' : ''}`} style={style} onPointerDownCapture={() => setFocused(true)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      <div className="timeline-header">
        <strong>时间线</strong>
        <div className="timeline-actions">
          <span className="timeline-timecode" title={`播放头位置 · ${frameRate} fps`}>{formatTimecode(playhead, frameRate)}</span>
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
          {Array.from({ length: rulerCount }, (_, index) => <span key={index + 1}>{formatTimecode((index + 1) * 5, frameRate)}</span>)}
        </div>
        {tracks.map((track) => {
          const trackClips = clips.filter((clip) => (clip.trackId || (clip.type === 'audio' ? 'audio-1' : 'video-1')) === track.id && (track.type === 'audio' ? clip.type === 'audio' : clip.type !== 'audio'))
          return <div className="timeline-row" key={track.id}>
            <div className="timeline-track-label" onPointerDown={(event) => { if (!event.target.closest('button')) onClearSelection?.() }}>
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
                const trim = dragPreview?.clipId === clip.id && dragPreview.edge ? dragPreview : null
                const previewDelta = trim ? Math.round(trim.delta * frameRate) / frameRate : 0
                const leftDelta = trim?.edge === 'left' ? Math.max(-clip.timelineStart, -clip.start, Math.min(clip.end - clip.start - 1 / frameRate, previewDelta)) : 0
                const rightDelta = trim?.edge === 'right' ? Math.max(-(clip.end - clip.start) + 1 / frameRate, Math.min((clip.sourceDuration || clip.end) - clip.end, previewDelta)) : 0
                const width = Math.max(compactClips ? 12 : 24, (clip.end - clip.start - leftDelta + rightDelta) * pixelsPerSecond)
                return <button
                  key={clip.id}
                  onPointerDown={(event) => handleClipPointerDown(event, clip)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={(event) => finishClipDrag(event)}
                  onPointerCancel={(event) => finishClipDrag(event, true)}
                  onClick={(event) => {
                    if (suppressClick.current === clip.id) { suppressClick.current = null; event.preventDefault(); return }
                    onSelectClip(clip.id, event.shiftKey)
                  }}
                  data-clip-id={clip.id}
                  className={`timeline-clip ${selectedIds.includes(clip.id) || selectedId === clip.id ? 'selected' : ''} ${activeClipId === clip.id ? 'under-playhead' : ''}`}
                  style={{ width, left: (clip.timelineStart + leftDelta) * pixelsPerSecond }}
                  title={clip.name}
                >
                  {clip.type === 'audio' ? <><span className="timeline-audio-wave" aria-hidden="true">▂▅▃▇▅▂▆▄▇▃▅▂▆▃▇▄▅▂▆▃▇▅▂▆▄▇▃▅▂</span><span className="timeline-clip-label">{clip.name}</span></> : <><span className="timeline-clip-thumb">{clip.type === 'video' ? <video src={clip.src} muted preload="metadata" /> : <img src={clip.src} alt="" />}</span><span className="timeline-clip-label">{clip.name}</span></>}
                  <span className="timeline-clip-duration">{formatTime(clip.end - clip.start)}</span>
                  {selectedId === clip.id && <><span className="timeline-trim-handle left" data-edge="left" aria-label="拖动调整片段入点" /><span className="timeline-trim-handle right" data-edge="right" aria-label="拖动调整片段出点" /></>}
                </button>
              })}
              {track.type === 'video' && !trackClips.length && <span className="timeline-placeholder">将素材添加到时间线</span>}
              {track.type === 'audio' && !trackClips.length && <span className="timeline-placeholder">将视频素材的原声放入此轨道</span>}
              {totalDuration > 0 && <div className="timeline-playhead" style={{ left: `${playhead * pixelsPerSecond}px` }} onPointerDown={handlePlayheadPointerDown} />}
            </div>
          </div>
        })}
      </div>
      {marquee && <div className="timeline-selection-marquee" aria-hidden="true" style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />}
      <div className="timeline-footer">
        <span>项目自动保存在此浏览器</span>
        <button className="timeline-compact-toggle" onClick={onToggleCompact} title={compactClips ? '展开片段显示' : '紧凑片段显示'} aria-label={compactClips ? '展开片段显示' : '紧凑片段显示'}>{compactClips ? <Maximize2 size={15} /> : <Shrink size={15} />}{compactClips ? '展开片段' : '紧凑显示'}</button>
      </div>
    </section>
  )
}
