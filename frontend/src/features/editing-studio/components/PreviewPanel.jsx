import { Clapperboard, Pause, Play, Columns } from 'lucide-react'
import { formatTime, formatTimecode, gradeFilter } from '../utils/format'
import { useEffect, useState } from 'react'
import axios from 'axios'

export default function PreviewPanel({ activeInfo, videoRef, playhead, totalDuration, playing, onTogglePlayback, onSeek, onLoadedMetadata, onVideoTime, onVideoEnded, selectedClip, splitPreview, onToggleSplit, timelineFrameRate = 24 }) {
  const [sourceFrameRate, setSourceFrameRate] = useState(24)
  const [sourceDuration, setSourceDuration] = useState(0)
  const sourceTime = selectedClip && selectedClip.type === 'video'
    ? Math.min(Math.max(0, playhead - (selectedClip.timelineStart || 0)) + (selectedClip.start || 0), selectedClip.end || Number.POSITIVE_INFINITY)
    : Math.max(0, playhead - (selectedClip?.timelineStart || 0))
  useEffect(() => {
    setSourceFrameRate(24)
    setSourceDuration(0)
    if (!selectedClip || selectedClip.type !== 'video' || !selectedClip.assetId) return undefined
    let cancelled = false
    axios.get('/api/editing-media/frame-rate', { params: { asset_id: selectedClip.assetId } })
      .then((response) => { if (!cancelled && Number(response.data.fps) > 0) setSourceFrameRate(Number(response.data.fps)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedClip?.id, selectedClip?.type, selectedClip?.assetId])
  const renderClip = (clip, isTimeline = false) => clip ? clip.type === 'video' ? (
    <video ref={isTimeline ? videoRef : undefined} src={clip.src} muted={!isTimeline || !playing} playsInline controls={!isTimeline} onLoadedMetadata={isTimeline ? onLoadedMetadata : undefined} onTimeUpdate={isTimeline ? onVideoTime : undefined} onEnded={isTimeline ? onVideoEnded : undefined} style={{ filter: gradeFilter(clip.grade) }} />
  ) : <img src={clip.src} alt="预览" style={{ filter: gradeFilter(clip.grade) }} /> : <div className="edit-preview-placeholder"><Clapperboard size={38} /><span>{isTimeline ? '从素材库添加镜头开始剪辑' : '选择一个片段预览'}</span></div>
  return (
    <section className="editing-preview-column">
      <div className="edit-preview-heading"><span>预览</span><div className="edit-preview-actions"><span>{formatTimecode(playhead, timelineFrameRate)} / {formatTimecode(totalDuration, timelineFrameRate)}</span><button className={`edit-icon-button ${splitPreview ? 'active' : ''}`} title={splitPreview ? '关闭分屏预览' : '分屏预览'} aria-label="切换分屏预览" onClick={onToggleSplit}><Columns size={16} /></button></div></div>
      <div className={`edit-preview-stages ${splitPreview ? 'split' : ''}`}>
        {splitPreview && <div className="edit-preview-pane"><div className="edit-preview-pane-title">片段预览 · {selectedClip?.name || '未选择片段'}<span className="edit-preview-timecode">{formatTimecode(sourceTime, sourceFrameRate)}{sourceDuration > 0 ? ` / ${formatTimecode(sourceDuration, sourceFrameRate)}` : ''}</span></div><div className="edit-preview-stage">{selectedClip?.type === 'video' ? <video src={selectedClip.src} muted controls playsInline onLoadedMetadata={(event) => setSourceDuration(event.currentTarget.duration || 0)} style={{ filter: gradeFilter(selectedClip.grade) }} /> : renderClip(selectedClip)}</div></div>}
        <div className="edit-preview-pane"><div className="edit-preview-pane-title">时间线预览<span className="edit-preview-timecode">{formatTimecode(playhead, timelineFrameRate)} / {formatTimecode(totalDuration, timelineFrameRate)}</span></div><div className="edit-preview-stage">{renderClip(activeInfo?.clip, true)}</div></div>
      </div>
      <div className="edit-transport">
        <button className="edit-play-button" onClick={onTogglePlayback}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '播放'}</button>
        <input aria-label="播放头位置" type="range" min="0" max={Math.max(totalDuration, 0.1)} step="0.05" value={Math.min(playhead, totalDuration)} onChange={(event) => onSeek(Number(event.target.value))} />
        <span>{formatTimecode(playhead, timelineFrameRate)}</span>
      </div>
    </section>
  )
}
