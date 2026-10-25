import { Clapperboard, Pause, Play, Columns } from 'lucide-react'
import { formatTime, gradeFilter } from '../utils/format'

export default function PreviewPanel({ activeInfo, videoRef, playhead, totalDuration, playing, onTogglePlayback, onSeek, onLoadedMetadata, onVideoTime, onVideoEnded, selectedClip, splitPreview, onToggleSplit }) {
  const renderClip = (clip, isTimeline = false) => clip ? clip.type === 'video' ? (
    <video ref={isTimeline ? videoRef : undefined} src={clip.src} muted={!isTimeline || !playing} playsInline controls={!isTimeline} onLoadedMetadata={isTimeline ? onLoadedMetadata : undefined} onTimeUpdate={isTimeline ? onVideoTime : undefined} onEnded={isTimeline ? onVideoEnded : undefined} style={{ filter: gradeFilter(clip.grade) }} />
  ) : <img src={clip.src} alt="预览" style={{ filter: gradeFilter(clip.grade) }} /> : <div className="edit-preview-placeholder"><Clapperboard size={38} /><span>{isTimeline ? '从素材库添加镜头开始剪辑' : '选择一个片段预览'}</span></div>
  return (
    <section className="editing-preview-column">
      <div className="edit-preview-heading"><span>预览</span><div className="edit-preview-actions"><span>{formatTime(playhead)} / {formatTime(totalDuration)}</span><button className={`edit-icon-button ${splitPreview ? 'active' : ''}`} title={splitPreview ? '关闭分屏预览' : '分屏预览'} aria-label="切换分屏预览" onClick={onToggleSplit}><Columns size={16} /></button></div></div>
      <div className={`edit-preview-stages ${splitPreview ? 'split' : ''}`}>
        {splitPreview && <div className="edit-preview-pane"><div className="edit-preview-pane-title">片段预览 · {selectedClip?.name || '未选择片段'}</div><div className="edit-preview-stage">{renderClip(selectedClip)}</div></div>}
        <div className="edit-preview-pane"><div className="edit-preview-pane-title">时间线预览</div><div className="edit-preview-stage">{renderClip(activeInfo?.clip, true)}</div></div>
      </div>
      <div className="edit-transport">
        <button className="edit-play-button" onClick={onTogglePlayback}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '播放'}</button>
        <input aria-label="播放头位置" type="range" min="0" max={Math.max(totalDuration, 0.1)} step="0.05" value={Math.min(playhead, totalDuration)} onChange={(event) => onSeek(Number(event.target.value))} />
        <span>{formatTime(playhead)}</span>
      </div>
    </section>
  )
}
