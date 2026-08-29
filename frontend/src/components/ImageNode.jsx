import { memo } from 'react'
import { Handle, Position } from 'reactflow'

/**
 * React Flow 自定义节点组件
 * 渲染图片或视频，带 input（左侧）和 output（右侧）端口
 * 用户可从 output 拖线到其他节点的 input
 */
function ImageNode({ data, selected }) {
  // 节点容器固定尺寸，图片用 object-fit:contain 居中显示，不拉伸压缩
  const width = data.width || 256
  const height = data.height || 256

  return (
    <div className={`rf-image-node ${selected ? 'rf-node-selected' : ''}`}>
      {/* 输入端口（左侧）——接收来自源图的连线 */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ background: '#3b82f6', border: '2px solid #fff', width: 10, height: 10 }}
      />

      {/* 节点内容：图片或视频，保持原比例居中 */}
      <div className="rf-node-media" style={{ width, height }}>
        {data.mediaType === 'video' ? (
          <video
            src={data.src}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <img src={data.src} alt="" draggable={false} />
        )}
      </div>

      {/* 输出端口（右侧）——拖线到下一个操作 */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ background: '#10b981', border: '2px solid #fff', width: 10, height: 10 }}
      />
    </div>
  )
}

export default memo(ImageNode)
