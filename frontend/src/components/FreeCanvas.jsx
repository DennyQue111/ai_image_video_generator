import { useState } from 'react'
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
import axios from 'axios'
import 'reactflow/dist/style.css'
import { useCanvasElements } from '../hooks/useCanvasElements'
import ImageNode from './ImageNode'
import Toolbar from './Toolbar'
import RightPanel from './RightPanel'
import ProjectBar from './ProjectBar'

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
    selectedElements,
    addNode,
    removeNode,
    selectNode,
    onSelectionChange,
    onConnect,
    onNodesChange,
    onEdgesChange,
    addEdgeBetween,
    clearAll,
    bringToFront,
    toSaveData,
    loadFromData,
  } = useCanvasElements()

  const [loading, setLoading] = useState(false)
  const [currentProject, setCurrentProject] = useState(null) // 当前项目名（null=未保存）

  // 保存项目
  const handleSaveProject = async (name) => {
    const data = toSaveData()
    const res = await axios.post('/api/projects/save', { name, ...data })
    if (res.data.success) {
      setCurrentProject(res.data.name)
    }
  }

  // 加载项目
  const handleLoadProject = async (name) => {
    const res = await axios.get(`/api/projects/${encodeURIComponent(name)}`)
    if (res.data.success && res.data.project) {
      loadFromData(res.data.project)
      setCurrentProject(res.data.project.name || name)
    }
  }

  // 新建项目（清空画布）
  const handleNewProject = async () => {
    clearAll()
    setCurrentProject(null)
  }

  // 删除当前项目后清空
  const handleDeletedProject = async () => {
    clearAll()
    setCurrentProject(null)
  }

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
  // 支持多图融合：选中多个节点时把所有图都作为输入
  const handleImageToImage = async (prompt, model = 'gemini-2.5-flash-image', width = 1024, height = 1024) => {
    const imgs = selectedElements.length > 0 ? selectedElements : selectedElement ? [selectedElement] : []
    if (imgs.length === 0) return
    // Flux2 latent 要求宽高各为 16 的倍数，就近对齐
    const isFlux2 = model === 'comfyui-flux-kontext'
    const align16 = (v) => Math.max(16, Math.round(v / 16) * 16)
    const finalWidth = isFlux2 ? align16(width) : width
    const finalHeight = isFlux2 ? align16(height) : height
    setLoading(true)
    try {
      const res = await axios.post('/api/image-to-image', {
        prompt,
        // 后端 ImageInput 期望 { url, description } 对象数组
        images: imgs.map((el) => ({ url: el.src })),
        model,
        width: finalWidth,
        height: finalHeight,
      })
      if (res.data.success && res.data.images?.[0]) {
        const img = res.data.images[0]
        const imgUrl = img.url || img.local_url
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        imgEl.onload = () => {
          const maxSize = 256
          let w = imgEl.width || imgs[0].width
          let h = imgEl.height || imgs[0].height
          if (w > maxSize || h > maxSize) {
            const ratio = Math.min(maxSize / w, maxSize / h)
            w = Math.round(w * ratio)
            h = Math.round(h * ratio)
          }
          // 结果放在所有源图最右侧 + 从每个源图都连线到结果
          const maxX = Math.max(...imgs.map((el) => el.x + el.width))
          const minY = Math.min(...imgs.map((el) => el.y))
          const resultId = addNode({
            src: imgUrl,
            width: w,
            height: h,
            position: { x: maxX + 100, y: minY },
          })
          imgs.forEach((el) => addEdgeBetween(el.id, resultId))
        }
        imgEl.src = imgUrl
      }
    } catch (err) {
      alert('图生图失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图生图·放大：选中单图 → SeedVR2 超清放大 → 结果作为新节点连线到原图
  const handleUpscale = async (ratio = 2) => {
    const el = selectedElement
    if (!el) return
    setLoading(true)
    try {
      const res = await axios.post('/api/upscale-image', {
        image_url: el.src,
        ratio,
        model: 'comfyui-seedvr2',
      })
      if (res.data.success && res.data.images?.[0]) {
        const img = res.data.images[0]
        const imgUrl = img.url || img.local_url
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        imgEl.onload = () => {
          const maxSize = 320
          let w = imgEl.width || el.width
          let h = imgEl.height || el.height
          if (w > maxSize || h > maxSize) {
            const r = Math.min(maxSize / w, maxSize / h)
            w = Math.round(w * r)
            h = Math.round(h * r)
          }
          const resultId = addNode({
            src: imgUrl,
            width: w,
            height: h,
            position: { x: (el.x || 0) + (el.width || 256) + 100, y: el.y || 0 },
          })
          addEdgeBetween(el.id, resultId)
        }
        imgEl.src = imgUrl
      }
    } catch (err) {
      alert('放大失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 细化第一步：Qwen3-VL 分析图片 → 返回提示词（不生图）
  const handleRefineAnalyze = async () => {
    const el = selectedElement
    if (!el) return null
    setLoading(true)
    try {
      const res = await axios.post('/api/refine-analyze', { image: el.src })
      if (res.data.success) {
        return res.data.prompt
      }
    } catch (err) {
      alert('分析失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
    return null
  }

  // 细化第二步：用户确认提示词 → Flux.2 生图 → 结果连线到原图
  const handleRefineGenerate = async (prompt) => {
    const el = selectedElement
    if (!el) return
    setLoading(true)
    try {
      const res = await axios.post('/api/refine-generate', { image: el.src, prompt })
      if (res.data.success && res.data.images?.[0]) {
        const img = res.data.images[0]
        const imgUrl = img.url || img.local_url
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        imgEl.onload = () => {
          const maxSize = 320
          let w = imgEl.width || el.width
          let h = imgEl.height || el.height
          if (w > maxSize || h > maxSize) {
            const r = Math.min(maxSize / w, maxSize / h)
            w = Math.round(w * r)
            h = Math.round(h * r)
          }
          const resultId = addNode({
            src: imgUrl,
            width: w,
            height: h,
            position: { x: (el.x || 0) + (el.width || 256) + 100, y: el.y || 0 },
          })
          addEdgeBetween(el.id, resultId)
        }
        imgEl.src = imgUrl
      } else {
        alert('细化失败：未返回图片')
      }
    } catch (err) {
      alert('细化失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图片分割：选中单图 → 按上下左右各平均切成 4 块 → 上传后端 → 4 个新节点连线到原图
  const handleSplit = async () => {
    const el = selectedElement
    if (!el) return
    setLoading(true)
    try {
      const imgEl = new window.Image()
      imgEl.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        imgEl.onload = resolve
        imgEl.onerror = () => reject(new Error('图片加载失败，无法分割'))
        imgEl.src = el.src
      })
      const w = imgEl.naturalWidth
      const h = imgEl.naturalHeight
      const halfW = Math.floor(w / 2)
      const halfH = Math.floor(h / 2)
      const regions = [
        { sx: 0,     sy: 0 },
        { sx: halfW, sy: 0 },
        { sx: 0,     sy: halfH },
        { sx: halfW, sy: halfH },
      ]
      const baseX = (el.x || 0) + (el.width || 256) + 80
      const baseY = el.y || 0
      const thumbMax = 200

      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]
        const canvas = document.createElement('canvas')
        canvas.width = halfW
        canvas.height = halfH
        const ctx = canvas.getContext('2d')
        ctx.drawImage(imgEl, r.sx, r.sy, halfW, halfH, 0, 0, halfW, halfH)

        // 转 blob → 上传后端 → 拿到 /static/... URL
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        const formData = new FormData()
        formData.append('file', blob, `split_${i}.png`)
        const res = await axios.post('/api/upload-image', formData)
        const imgUrl = res.data.url

        // 缩略图尺寸
        let tw = halfW, th = halfH
        if (tw > thumbMax || th > thumbMax) {
          const ratio = Math.min(thumbMax / tw, thumbMax / th)
          tw = Math.round(tw * ratio)
          th = Math.round(th * ratio)
        }
        const col = i % 2
        const row = Math.floor(i / 2)
        const resultId = addNode({
          src: imgUrl,
          width: tw,
          height: th,
          position: { x: baseX + col * (thumbMax + 20), y: baseY + row * (thumbMax + 20) },
        })
        addEdgeBetween(el.id, resultId)
      }
    } catch (err) {
      alert('分割失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图生视频：选中图片 → 生成视频 → 自动连线
  const handleImageToVideo = async (prompt, duration = 5) => {
    const imgs = selectedElements.length > 0 ? selectedElements : selectedElement ? [selectedElement] : []
    if (imgs.length === 0) return
    if (imgs.length > 9) {
      alert('最多支持 9 张参考图，请减少选中数量')
      return
    }
    // 12GB 显存软警告：>8s 容易 OOM
    if (duration > 8 && !confirm(`视频时长 ${duration}s 在 12GB 显存上可能 OOM，是否继续？`)) {
      return
    }
    setLoading(true)
    try {
      const res = await axios.post('/api/image-to-video', {
        model: 'comfyui-minimax',
        reference_images: imgs.map((el) => el.src),
        duration,
        prompt: prompt || '',
      })
      if (res.data.success && res.data.videos?.[0]) {
        const vid = res.data.videos[0]
        const vidUrl = vid.url || vid.local_url
        // 视频节点放在所有源图最右侧 + 从每个源图连线到结果
        const maxX = Math.max(...imgs.map((el) => (el.x || 0) + (el.width || 256)))
        const minY = Math.min(...imgs.map((el) => el.y || 0))
        const resultId = addNode({
          src: vidUrl,
          width: 320,
          height: 180,
          mediaType: 'video',
          position: { x: maxX + 100, y: minY },
        })
        imgs.forEach((el) => addEdgeBetween(el.id, resultId))
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
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 顶部项目栏 */}
      <ProjectBar
        currentName={currentProject}
        onSave={handleSaveProject}
        onLoad={handleLoadProject}
        onNew={handleNewProject}
        onDelete={handleDeletedProject}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
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
          onSelectionChange={onSelectionChange}
          onPaneClick={() => selectNode(null)}
          deleteKeyCode={['Delete', 'Backspace']}
          multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
          selectionOnDrag
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
            选中图片做图生图/图生视频；Ctrl+点击可选多张图做融合
          </div>
        )}
      </div>

      {/* 右侧面板 */}
      <RightPanel
        selectedElement={selectedElement}
        selectedElements={selectedElements}
        loading={loading}
        onImageToImage={handleImageToImage}
        onImageToVideo={handleImageToVideo}
        onImageToPrompt={handleImageToPrompt}
        onUpscale={handleUpscale}
        onSplit={handleSplit}
        onRefineAnalyze={handleRefineAnalyze}
        onRefineGenerate={handleRefineGenerate}
        onRemove={() => removeNode(selectedId)}
        onBringToFront={() => bringToFront(selectedId)}
      />
      </div>
    </div>
  )
}
