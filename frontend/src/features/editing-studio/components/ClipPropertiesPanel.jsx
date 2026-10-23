import { Film, Image as ImageIcon, Scissors, Trash2, Volume2 } from 'lucide-react'
import { formatTime } from '../utils/format'

export default function ClipPropertiesPanel({ clip, onUpdate, onSplit, onRemove }) {
  return (
    <aside className="editing-properties">
      <div className="edit-panel-heading"><span>片段属性</span></div>
      {!clip ? <p className="edit-empty">选择时间线中的片段，调整入点、出点和基础色彩。</p> : <>
        <div className="edit-selected-name">{clip.type === 'video' ? <Film size={15} /> : <ImageIcon size={15} />}{clip.name}</div>
        <div className="edit-property-group"><label>入点 <span>{formatTime(clip.start)}</span></label><input type="range" min="0" max={Math.max(clip.sourceDuration - 0.1, 0.1)} step="0.1" value={clip.start} onChange={(event) => onUpdate(clip.id, { start: Math.min(Number(event.target.value), clip.end - 0.1) })} /></div>
        <div className="edit-property-group"><label>出点 <span>{formatTime(clip.end)}</span></label><input type="range" min={Math.min(clip.start + 0.1, clip.sourceDuration)} max={Math.max(clip.sourceDuration, 0.2)} step="0.1" value={Math.min(clip.end, clip.sourceDuration)} onChange={(event) => onUpdate(clip.id, { end: Math.max(Number(event.target.value), clip.start + 0.1) })} /></div>
        <div className="edit-grade-title"><Volume2 size={14} />基础调色（预览）</div>
        {[['brightness', '亮度'], ['contrast', '对比度'], ['saturation', '饱和度']].map(([key, label]) => <div className="edit-property-group" key={key}><label>{label}<span>{clip.grade?.[key] ?? 100}%</span></label><input type="range" min="0" max="200" value={clip.grade?.[key] ?? 100} onChange={(event) => onUpdate(clip.id, { grade: { ...clip.grade, [key]: Number(event.target.value) } })} /></div>)}
        <div className="edit-property-actions"><button onClick={onSplit} disabled={clip.type !== 'video'}><Scissors size={14} />在播放头分割</button><button className="danger" onClick={onRemove}><Trash2 size={14} />删除片段</button></div>
      </>}
    </aside>
  )
}
