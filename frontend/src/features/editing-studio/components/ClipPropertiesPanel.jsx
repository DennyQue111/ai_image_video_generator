import { Film, Image as ImageIcon, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSourceFrameRate } from '../utils/frameRateCache'
import { formatTimecode } from '../utils/format'

export default function ClipPropertiesPanel({ clip, onUpdate, onFrameRateChange, projectFrameRate = 24 }) {
  const [activeTab, setActiveTab] = useState('clip')
  const [frameRate, setFrameRate] = useState(null)
  const [frameRateState, setFrameRateState] = useState('idle')

  useEffect(() => {
    if (!clip || clip.type !== 'video' || !clip.assetId) {
      setFrameRate(null)
      setFrameRateState('idle')
      return undefined
    }
    let cancelled = false
    setFrameRate(null)
    setFrameRateState('loading')
    getSourceFrameRate(clip.assetId).then((fps) => {
      if (cancelled) return
      setFrameRate(fps)
      setFrameRateState(fps ? 'ready' : 'unavailable')
      if (fps) onFrameRateChange?.(clip.id, fps)
    })
    return () => { cancelled = true }
  }, [clip?.id, clip?.type, clip?.assetId])

  const frameRateLabel = frameRateState === 'loading'
    ? '读取中…'
    : frameRateState === 'ready'
      ? `${Number.isInteger(frameRate) ? frameRate : frameRate.toFixed(2)} fps`
      : '不可读取'
  const durationFrameRate = clip?.type === 'video' ? (frameRate || clip.sourceFrameRate || projectFrameRate) : projectFrameRate
  return (
    <aside className="editing-properties">
      <div className="edit-property-tabs" role="tablist" aria-label="片段属性页签">
        <button role="tab" aria-selected={activeTab === 'clip'} className={activeTab === 'clip' ? 'active' : ''} onClick={() => setActiveTab('clip')}><Film size={14} />片段属性</button>
        <button role="tab" aria-selected={activeTab === 'grade'} className={activeTab === 'grade' ? 'active' : ''} onClick={() => setActiveTab('grade')}><Palette size={14} />调色</button>
      </div>
      {!clip ? <p className="edit-empty">选择时间线中的片段查看属性或调整色彩。</p> : activeTab === 'clip' ? <div className="edit-property-content">
        <div className="edit-selected-name">{clip.type === 'video' ? <Film size={15} /> : <ImageIcon size={15} />}{clip.name}</div>
        <div className="edit-clip-detail"><span>素材类型</span><strong>{clip.type === 'video' ? '视频' : '图片'}</strong></div>
        <div className="edit-clip-detail"><span>片段时长</span><strong>{formatTimecode(clip.end - clip.start, durationFrameRate)}</strong></div>
        {clip.type === 'video' && <div className="edit-clip-detail"><span>素材帧速率</span><strong>{frameRateLabel}</strong></div>}
      </div> : <div className="edit-property-content">
        <div className="edit-grade-title"><Palette size={14} />基础调色 · 预览</div>
        {[['brightness', '亮度'], ['contrast', '对比度'], ['saturation', '饱和度']].map(([key, label]) => <div className="edit-property-group" key={key}><label>{label}<span>{clip.grade?.[key] ?? 100}%</span></label><input type="range" min="0" max="200" value={clip.grade?.[key] ?? 100} onChange={(event) => onUpdate(clip.id, { grade: { ...clip.grade, [key]: Number(event.target.value) } })} /></div>)}
      </div>}
    </aside>
  )
}
