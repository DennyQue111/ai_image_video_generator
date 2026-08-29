import { useState } from 'react'
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
import axios from 'axios'
import 'reactflow/dist/style.css'
import { useCanvasElements } from '../hooks/useCanvasElements'
import ImageNode from './ImageNode'
import Toolbar from './Toolbar'
import RightPanel from './RightPanel'

const TOOLBAR_WIDTH = 240
const RIGHT_PANEL_WIDTH = 300

// 自定义节点类型映射
const nodeTypes = { imageNode: ImageNode }

// 统一格式化后端错误，避免 alert 显示 [object Object]
function formatErr(err) {
  const detail = err?.response?.data?.detail
  if (detail) {
    if (typeof detail === 'string') return detail
    try {
      // FastAPI 校验错误是数组，序列化成可读文本
      return JSON.stringify(detail)
    } catch {
      return String(detail)
    }
  }
  return err?.message || String(err)
}

export default function FreeCanvas() {
  const {
    nodes,
    edges,
    selectedId,
    selectedElement,
    addNode,
    removeNode,
    selectNode,
    onConnect,
    onNodesChange,
    onEdgesChange,
    addEdgeBetween,
    clearAll,
    bringToFront,
  } = useCanvasElements()

  const [loading, setLoading] = useState(false)

  // 文生图：调用后端 → 结果加到画布中央
  const handleTextToImage = async (prompt, model = 'comfyui-flux2', width = 1024, height = 1024) => {
    setLoading(true)
    try {
      // 按模型设置合理默认参数
      const isComfyui = model.startsWith('comfyui')
      const isFlux2 = model === 'comfyui-flux2'
      // Flux2 的 latent 要求宽高是 16 的倍数，自动对齐
      const align16 = (v) => Math.max(16, Math.round(v / 16) * 16)
      const finalWidth = isFlux2 ? align16(width) : width
      const finalHeight = isFlux2 ? align16(height) : height
      const payload = {
        prompt,
        model,
        width: finalWidth,
        height: finalHeight,
        seed: -1,
      }
      if (isFlux2) {
        payload.steps = 20
        payload.cfg = 3.5
      } else if (isComfyui) {
        // QwenImage 文生图
        payload.steps = 8
        payload.cfg = 1.0
      }
      const res = await axios.post('/api/text-to-image', payload)
      if (res.data.success && res.data.images?.[0]) {
        const img = res.data.images[0]
        const imgUrl = img.url || img.local_url
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        imgEl.onload = () => {
          const maxSize = 256
          let w = imgEl.width || 256
          let h = imgEl.height || 256
          if (w > maxSize || h > maxSize) {
            const ratio = Math.min(maxSize / w, maxSize / h)
            w = Math.round(w * ratio)
            h = Math.round(h * ratio)
          }
          // 文生图无源图，放在画布左侧
          addNode({
            src: imgUrl,
            width: w,
            height: h,
            position: { x: 100, y: 150 + nodes.length * 30 },
          })
        }
        imgEl.src = imgUrl
      } else {
        alert('生成失败：未返回图片')
      }
    } catch (err) {
      console.error('Text to image failed:', err)
      alert('生成失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图生图：选中图片作为源图 → 生成结果 → 自动连线
  const handleImageToImage = async (prompt, model = 'gemini-2.5-flash-image') => {
    if (!selectedElement) return
    setLoading(true)
    try {
      const res = await axios.post('/api/image-to-image', {
        prompt,
        // 后端 ImageInput 期望 { url, description } 对象数组
        images: [{ url: selectedElement.src }],
        model,
        width: 1024,
        height: 1024,
      })
      if (res.data.success && res.data.images?.[0]) {
        const img = res.data.images[0]
        const imgUrl = img.url || img.local_url
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        imgEl.onload = () => {
          const maxSize = 256
          let w = imgEl.width || selectedElement.width
          let h = imgEl.height || selectedElement.height
          if (w > maxSize || h > maxSize) {
            const ratio = Math.min(maxSize / w, maxSize / h)
            w = Math.round(w * ratio)
            h = Math.round(h * ratio)
          }
          // 结果放在源图右侧 + 自动连线
          const resultId = addNode({
            src: imgUrl,
            width: w,
            height: h,
            position: {
              x: selectedElement.x + selectedElement.width + 100,
              y: selectedElement.y,
            },
          })
          addEdgeBetween(selectedId, resultId)
        }
        imgEl.src = imgUrl
      }
    } catch (err) {
      alert('图生图失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图生视频：选中图片 → 生成视频 → 自动连线
  const handleImageToVideo = async (prompt) => {
    if (!selectedElement) return
    setLoading(true)
    try {
      const res = await axios.post('/api/image-to-video', {
        model: 'comfyui-minimax',
        reference_images: [selectedElement.src],
        duration: 5,
        prompt: prompt || '',
      })
      if (res.data.success && res.data.videos?.[0]) {
        const vid = res.data.videos[0]
        const vidUrl = vid.url || vid.local_url
        // 视频节点放在源图右侧 + 自动连线
        const resultId = addNode({
          src: vidUrl,
          width: 320,
          height: 180,
          mediaType: 'video',
          position: {
            x: selectedElement.x + selectedElement.width + 100,
            y: selectedElement.y,
          },
        })
        addEdgeBetween(selectedId, resultId)
      } else {
        alert('图生视频失败：未返回视频')
      }
    } catch (err) {
      alert('图生视频失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图生提示词：选中图片 → 分析 → 返回描述文本
  const handleImageToPrompt = async () => {
    if (!selectedElement) return null
    setLoading(true)
    try {
      const res = await axios.post('/api/gemini-image-to-prompt', {
        image: selectedElement.src,
      })
      if (res.data.success) {
        const data = res.data.data || {}
        return data.fullPrompt || data.subjectDescription || ''
      }
    } catch (err) {
      alert('图生提示词失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
    return null
  }

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* 左侧工具栏 */}
      <Toolbar
        onAddImage={(el) =>
          addNode({
            src: el.src,
            width: 256,
            height: 256,
            position: { x: 100 + nodes.length * 20, y: 150 + nodes.length * 20 },
          })
        }
        onTextToImage={handleTextToImage}
        onClear={() => {
          if (nodes.length === 0 || confirm('确定清空画布吗？')) clearAll()
        }}
        loading={loading}
      />

      {/* 中间画布 — React Flow 节点式画布 */}
      <div className="canvas-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: '#3b82f6', strokeWidth: 2 },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#2a2a4a" gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={() => '#3b82f6'}
            maskColor="rgba(13, 13, 26, 0.7)"
            style={{ background: '#1a1a2e' }}
          />
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="canvas-hint">
            上传图片或使用文生图开始创作
            <br />
            从图片右侧端口拖线可连接到其他图片
          </div>
        )}
      </div>

      {/* 右侧面板 */}
      <RightPanel
        selectedElement={selectedElement}
        loading={loading}
        onImageToImage={handleImageToImage}
        onImageToVideo={handleImageToVideo}
        onImageToPrompt={handleImageToPrompt}
        onRemove={() => removeNode(selectedId)}
        onBringToFront={() => bringToFront(selectedId)}
      />
    </div>
  )
}
