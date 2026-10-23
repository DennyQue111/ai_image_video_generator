import { memo, useCallback } from 'react'
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow'
import { Camera, Sparkles } from 'lucide-react'

const normalizeYaw = (value) => ((Math.round(value) % 360) + 360) % 360

function CameraAngleNode({ data, selected, id }) {
  const { setNodes } = useReactFlow()
  const yaw = normalizeYaw(data.yaw ?? 0)
  const pitch = Number(data.pitch ?? 0)
  const distance = Number(data.distance ?? 1)
  const outputWidth = Number(data.outputWidth ?? 1024)
  const outputHeight = Number(data.outputHeight ?? 1024)

  const update = useCallback((updates) => {
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...updates } }
      : node))
  }, [id, setNodes])

  const updateYawFromPointer = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left - rect.width / 2
    const y = event.clientY - rect.top - rect.height / 2
    update({ yaw: normalizeYaw((Math.atan2(x, -y) * 180) / Math.PI) })
  }, [update])

  return (
    <div className={`rf-camera-node ${selected ? 'rf-node-selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={230} minHeight={350} color="#a78bfa" onResizeEnd={(_, params) => update({ width: Math.round(params.width), height: Math.round(params.height) })} />
      <Handle type="target" position={Position.Left} id="input" style={{ background: '#3b82f6', border: '2px solid #fff', width: 10, height: 10 }} />
      <div className="camera-node-drag-handle camera-node-header">
        <Camera size={16} /> <span>多视角相机</span>
      </div>
      <div className="camera-node-content nodrag" style={{ width: data.width || 270 }}>
        <div
          className="camera-orbit"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateYawFromPointer(event) }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateYawFromPointer(event) }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
          title="在圆盘内拖动，调整水平机位"
        >
          <div className="camera-orbit-ring" />
          <div className="camera-subject">●</div>
          <div className="camera-direction" style={{ transform: `rotate(${yaw}deg)` }}><span>▴</span></div>
          <div className="camera-orbit-label">{Math.round(yaw)}°</div>
        </div>

        <label>水平旋转 <b>{Math.round(yaw)}°</b></label>
        <input type="range" min="0" max="359" value={yaw} onChange={(e) => update({ yaw: Number(e.target.value) })} />
        <label>垂直俯仰 <b>{Math.round(pitch)}°</b></label>
        <input type="range" min="-30" max="60" step="1" value={pitch} onChange={(e) => update({ pitch: Number(e.target.value) })} />
        <label>相机距离</label>
        <div className="camera-distance-options">
          {[['0.6', '近景'], ['1', '中景'], ['1.8', '广角']].map(([value, label]) => (
            <button key={value} className={distance === Number(value) ? 'active' : ''} onClick={() => update({ distance: Number(value) })}>{label}</button>
          ))}
        </div>
        <label>画面比例</label>
        <div className="camera-aspect-options">
          {[
            ['1:1', 1024, 1024],
            ['16:9', 1344, 768],
            ['9:16', 768, 1344],
            ['4:3', 1024, 768],
          ].map(([label, width, height]) => (
            <button
              key={label}
              className={outputWidth === width && outputHeight === height ? 'active' : ''}
              onClick={() => update({ outputWidth: width, outputHeight: height })}
            >{label}</button>
          ))}
        </div>
        <div className="camera-snap-note">生成时自动对齐至最接近的 96 个训练机位</div>
        {data.lastPrompt && <div className="camera-prompt">{data.lastPrompt}</div>}
        <button className="camera-generate" disabled={data.generating || !data.sourceImageUrl} onClick={() => data.onGenerate?.({ nodeId: id, sourceImageUrl: data.sourceImageUrl, sourceId: data.sourceId, yaw, pitch, distance, outputWidth, outputHeight })}>
          <Sparkles size={15} /> {data.generating ? '生成中...' : '生成当前角度'}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="output" style={{ background: '#a78bfa', border: '2px solid #fff', width: 10, height: 10 }} />
    </div>
  )
}

export default memo(CameraAngleNode)
