import { Clapperboard, Pause, Play } from 'lucide-react'
import { formatTime, gradeFilter } from '../utils/format'

export default function PreviewPanel({ activeInfo, videoRef, playhead, totalDuration, playing, onTogglePlayback, onSeek, onLoadedMetadata, onVideoTime, onVideoEnded }) {
  return (
    <section className="editing-preview-column">
      <div className="edit-preview-heading"><span>预览</span><span>{formatTime(playhead)} / {formatTime(totalDuration)}</span></div>
      <div className="edit-preview-stage">
        {activeInfo?.clip ? activeInfo.clip.type === 'video' ? (
          <video ref={videoRef} src={activeInfo.clip.src} muted={!playing} playsInline onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onVideoTime} onEnded={onVideoEnded} style={{ filter: gradeFilter(activeInfo.clip.grade) }} />
        ) : <img src={activeInfo.clip.src} alt="预览" style={{ filter: gradeFilter(activeInfo.clip.grade) }} /> : <div className="edit-preview-placeholder"><Clapperboard size={38} /><span>从左侧素材库添加镜头开始剪辑</span></div>}
      </div>
      <div className="edit-transport">
        <button className="edit-play-button" onClick={onTogglePlayback}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '播放'}</button>
        <input aria-label="播放头位置" type="range" min="0" max={Math.max(totalDuration, 0.1)} step="0.05" value={Math.min(playhead, totalDuration)} onChange={(event) => onSeek(Number(event.target.value))} />
        <span>{formatTime(playhead)}</span>
      </div>
    </section>
  )
}
