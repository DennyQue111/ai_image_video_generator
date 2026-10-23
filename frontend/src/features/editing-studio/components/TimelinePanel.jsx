import { Film } from 'lucide-react'
import { formatTime } from '../utils/format'

export default function TimelinePanel({ clips, selectedId, activeClipId, playhead, totalDuration, onSeekClip, onSetPlayhead, onMoveClip, dragId }) {
  return (
    <section className="editing-timeline">
      <div className="timeline-header"><div><strong>时间线</strong><span>{clips.length} 个片段 · {formatTime(totalDuration)}</span></div><div className="timeline-hint">拖动片段可调整顺序</div></div>
      <div className="timeline-ruler"><span>00:00</span>{Array.from({ length: Math.max(1, Math.ceil(totalDuration / 5)) }, (_, index) => <span key={index + 1}>{formatTime((index + 1) * 5)}</span>)}</div>
      <div className="timeline-track-label"><Film size={14} />视频 / 图片</div>
      <div className="timeline-track" onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); onSetPlayhead(Math.max(0, Math.min(totalDuration, (event.clientX - rect.left) / 72))) } }}>
        {clips.map((clip) => {
          const width = Math.max(72, (clip.end - clip.start) * 72)
          return <button key={clip.id} draggable onDragStart={() => { dragId.current = clip.id }} onDragOver={(event) => event.preventDefault()} onDrop={() => onMoveClip(clip.id)} onClick={() => onSeekClip(clip.id)} className={`timeline-clip ${selectedId === clip.id ? 'selected' : ''} ${activeClipId === clip.id ? 'under-playhead' : ''}`} style={{ width }} title={clip.name}>
            <span className="timeline-clip-thumb">{clip.type === 'video' ? <video src={clip.src} muted preload="metadata" /> : <img src={clip.src} alt="" />}</span><span className="timeline-clip-label">{clip.name}</span><span className="timeline-clip-duration">{formatTime(clip.end - clip.start)}</span>
          </button>
        })}
        {!clips.length && <span className="timeline-placeholder">将左侧素材添加到时间线</span>}
        {totalDuration > 0 && <div className="timeline-playhead" style={{ left: `${Math.min(playhead * 72, Math.max(totalDuration * 72, 1))}px` }} />}
      </div>
      <div className="timeline-footer"><span>当前以顺序视频轨道进行剪切和拼接；音频、多轨、转场与导出将逐步加入。</span><span>项目自动保存在此浏览器</span></div>
    </section>
  )
}
