import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
import axios from 'axios'
import 'reactflow/dist/style.css'
import { useCanvasElements } from '../hooks/useCanvasElements'
import ImageNode from './ImageNode'
import ModelNode from './ModelNode'
import DirectorStageNode from './DirectorStageNode'
import CameraAngleNode from './CameraAngleNode'
import Toolbar from './Toolbar'
import RightPanel from './RightPanel'
import ProjectBar from './ProjectBar'

const TOOLBAR_WIDTH = 240
const RIGHT_PANEL_WIDTH = 300
const FREE_CANVAS_CACHE_KEY = 'ai-image-video-generator:free-canvas:workspace:v1'

// 自定义节点类型映射
const nodeTypes = { imageNode: ImageNode, modelNode: ModelNode, cameraNode: CameraAngleNode, directorStageNode: DirectorStageNode }

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
  const routerLocation = useLocation()
  const openedShotRef = useRef(null)
  const openedProjectRef = useRef(null)
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
    updateNode,
    clearAll,
    bringToFront,
    toSaveData,
    loadFromData,
    setNodes,
  } = useCanvasElements()

  const [loading, setLoading] = useState(false)
  const [currentProject, setCurrentProject] = useState(null)
  const [cacheReady, setCacheReady] = useState(false)

  const handleModelUpload = async (file) => {
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await axios.post('/api/upload-model', formData)
      const model = res.data
      addNode({
        type: 'modelNode',
        src: model.url,
        width: 320,
        height: 240,
        mediaType: 'model',
        data: { format: model.format, filename: model.filename, sizeBytes: model.size_bytes },
        position: { x: 120 + nodes.length * 25, y: 160 + nodes.length * 25 },
      })
    } catch (err) {
      alert('模型上传失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 从已选图片创建相机节点；机位参数和源图关系都会保存在画布中。
  const handleAddCamera = () => {
    const el = selectedElement
    if (!el || el.type !== 'image') return
    const cameraId = addNode({
      type: 'cameraNode',
      width: 270,
      height: 390,
      mediaType: 'camera',
      position: { x: (el.x || 0) + (el.width || 256) + 100, y: el.y || 0 },
      data: {
        sourceId: el.id,
        sourceImageUrl: el.src,
        yaw: 0,
        pitch: 0,
        distance: 1,
        outputWidth: 1024,
        outputHeight: 1024,
        onGenerate: handleCameraGenerate,
      },
    })
    addEdgeBetween(el.id, cameraId)
  }

  // 由相机节点触发：将姿态发送到 Qwen 2511 多角度工作流，并把结果接回画布。
  async function handleCameraGenerate({ nodeId, sourceImageUrl, sourceId, yaw, pitch, distance, outputWidth = 1024, outputHeight = 1024 }) {
    if (!sourceImageUrl) return
    setLoading(true)
    updateNode(nodeId, { generating: true })
    try {
      const res = await axios.post('/api/camera-angle', {
        image_url: sourceImageUrl,
        yaw,
        pitch,
        distance,
        width: outputWidth,
        height: outputHeight,
      })
      const item = res.data.images?.[0]
      if (!item) throw new Error('未返回角度图片')
      const imgUrl = item.url || item.local_url
      const cameraNode = nodes.find((node) => node.id === nodeId)
      const previewScale = Math.min(300 / outputWidth, 300 / outputHeight)
      const resultId = addNode({
        src: imgUrl,
        width: Math.round(outputWidth * previewScale),
        height: Math.round(outputHeight * previewScale),
        position: {
          x: (cameraNode?.position.x || 300) + (cameraNode?.data.width || 270) + 120,
          y: cameraNode?.position.y || 180,
        },
        data: { camera: res.data.camera, cameraPrompt: res.data.prompt },
      })
      if (sourceId) addEdgeBetween(sourceId, resultId)
      addEdgeBetween(nodeId, resultId)
      updateNode(nodeId, { lastPrompt: res.data.prompt, lastCamera: res.data.camera })
    } catch (err) {
      alert('相机角度生成失败: ' + formatErr(err))
    } finally {
      updateNode(nodeId, { generating: false })
      setLoading(false)
    }
  }

  const restoreCanvas = (canvas) => {
    loadFromData(canvas)
    // JSON 不保存函数；恢复相机节点时重新绑定生成回调。
    setTimeout(() => setNodes((existing) => existing.map((node) => node.type === 'cameraNode'
      ? { ...node, data: { ...node.data, onGenerate: handleCameraGenerate } }
      : node)), 0)
  }

  // 缓存只恢复上一次离开页面时的工作区，不替代用户主动保存的自由画布 JSON。
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(FREE_CANVAS_CACHE_KEY) || 'null')
      if (cached?.canvas?.nodes) {
        restoreCanvas(cached.canvas)
        setCurrentProject(cached.currentProject || null)
      }
    } catch (err) {
      console.warn('restore free canvas cache failed', err)
    } finally {
      setCacheReady(true)
    }
  }, [])

  useEffect(() => {
    if (!cacheReady) return
    try {
      localStorage.setItem(FREE_CANVAS_CACHE_KEY, JSON.stringify({
        currentProject,
        canvas: toSaveData(),
        cachedAt: new Date().toISOString(),
      }))
    } catch (err) {
      // 本地存储不足时不影响正常画布使用和正式保存。
      console.warn('save free canvas cache failed', err)
    }
  }, [cacheReady, currentProject, nodes, edges, toSaveData])

  // 从镜头表进入时，画布绑定于该镜头 JSON，而不是独立的 project 文件。
  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search)
    const breakdown = params.get('shot_breakdown')
    const shotId = params.get('shot')
    const key = breakdown && shotId ? `${breakdown}/${shotId}` : null
    if (!key || openedShotRef.current === key) return
    openedShotRef.current = key
    axios.get(`/api/shot_breakdowns/${encodeURIComponent(breakdown)}/shots/${encodeURIComponent(shotId)}/canvas`).then((res) => {
      restoreCanvas(res.data.canvas)
      setCurrentProject(res.data.shot?.shot_no || shotId)
    }).catch((err) => {
      openedShotRef.current = null
      alert('打开镜头自由画布失败: ' + formatErr(err))
    })
  }, [routerLocation.search])

  // 普通自由画布项目与镜头画布完全独立，仍可随时保存、打开和删除。
  const handleSaveProject = async (name) => {
    const res = await axios.post('/api/projects/save', { name, ...toSaveData() })
    if (res.data.success) setCurrentProject(res.data.name)
  }

  const handleLoadProject = async (name) => {
    const res = await axios.get(`/api/projects/${encodeURIComponent(name)}`)
    if (res.data.success && res.data.project) {
      restoreCanvas(res.data.project)
      setCurrentProject(res.data.project.name || name)
    }
  }

  const handleNewProject = () => {
    clearAll()
    setCurrentProject(null)
  }

  // 保留以前的 /free_canvas?project=项目名 直接打开方式。
  useEffect(() => {
    const projectName = new URLSearchParams(routerLocation.search).get('project')
    if (!projectName || openedProjectRef.current === projectName) return
    openedProjectRef.current = projectName
    handleLoadProject(projectName).catch((err) => {
      openedProjectRef.current = null
      alert('打开自由画布项目失败: ' + formatErr(err))
    })
  }, [routerLocation.search])

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

  // 蒙版局部重绘：原图与黑白 mask 交给 FLUX.2 Klein，结果自动连回源图。
  const handleInpaint = async ({ prompt, maskImage, width, height }) => {
    const el = selectedElement
    if (!el || el.type !== 'image') return false
    setLoading(true)
    try {
      const res = await axios.post('/api/inpaint-image', {
        prompt,
        base_image: el.src,
        mask_image: maskImage,
        model: 'comfyui-flux2-inpaint',
        width,
        height,
        grow_mask_by: 8,
      })
      const item = res.data.images?.[0]
      if (!item) throw new Error('未返回局部重绘图片')
      const imgUrl = item.url || item.local_url
      const maxPreview = 320
      const scale = Math.min(maxPreview / width, maxPreview / height)
      const resultId = addNode({
        src: imgUrl,
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        position: { x: (el.x || 0) + (el.width || 256) + 100, y: el.y || 0 },
        data: { operation: 'inpaint', prompt },
      })
      addEdgeBetween(el.id, resultId)
      return true
    } catch (err) {
      alert('Inpainting 失败: ' + formatErr(err))
      return false
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
  const handleRefineGenerate = async (prompt, sourceUrl = null, width = 0, height = 0, label = 'refine', position = null) => {
    const el = selectedElement
    if (!el) return
    setLoading(true)
    try {
      const res = await axios.post('/api/refine-generate', {
        image: sourceUrl || el.src,
        prompt,
        model: 'flux-kontext',
        width,
        height,
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
            position: position || { x: (el.x || 0) + (el.width || 256) + 100, y: el.y || 0 },
          })
          addEdgeBetween(el.id, resultId)
        }
        imgEl.src = imgUrl
      } else {
        alert('细化失败：未返回图片')
      }
    } catch (err) {
      alert(`${label === 'refine' ? '细化' : label}失败: ` + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 模型三视图第一步：让 Qwen 生成正视图提示词，返回前端供用户检查和编辑
  const handleModelViewPrompt = async (instruction) => {
    const el = selectedElement
    if (!el) return null
    setLoading(true)
    try {
      const promptRes = await axios.post('/api/model-view-prompt', {
        image: el.src,
        instruction,
      })
      const frontPrompt = promptRes.data.prompt
      if (!frontPrompt) throw new Error('Qwen 未返回正视图提示词')
      return frontPrompt
    } catch (err) {
      alert('正视图提示词生成失败: ' + formatErr(err))
      return null
    } finally {
      setLoading(false)
    }
  }

  // 模型三视图第二步：使用用户确认后的提示词生成正视图，再生成侧视图和背视图
  const handleModelViews = async (frontPrompt) => {
    const el = selectedElement
    if (!el || !frontPrompt?.trim()) return
    setLoading(true)
    try {
      const generate = async (sourceUrl, prompt, label, y) => {
        const res = await axios.post('/api/refine-generate', {
          image: sourceUrl,
          prompt,
          model: 'flux-kontext',
          width: 768,
          height: 1344,
        })
        const item = res.data.images?.[0]
        if (!item) throw new Error(`${label}未返回图片`)
        const imgUrl = item.url || item.local_url
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => {
          imgEl.onload = resolve
          imgEl.onerror = reject
          imgEl.src = imgUrl
        })
        const resultId = addNode({
          src: imgUrl,
          width: 192,
          height: 336,
          position: { x: (el.x || 0) + (el.width || 256) + 120, y },
        })
        return { id: resultId, url: imgUrl }
      }

      const baseX = el.y || 0
      const front = await generate(
        el.src,
        frontPrompt.trim(),
        '正视图',
        baseX,
      )
      const sidePrompt = 'Using this character front view as the reference, generate the exact same character in a strict left side view, full body, natural standing pose, hands naturally down, no props, 9:16 portrait composition, preserve the original image style, pure white studio background and studio lighting.'
      const backPrompt = 'Using this character front view as the reference, generate the exact same character in a strict back view, full body, natural standing pose, hands naturally down, no props, 9:16 portrait composition, preserve the original image style, pure white studio background and studio lighting.'
      const side = await generate(front.url, sidePrompt, '侧视图', baseX + 360)
      const back = await generate(front.url, backPrompt, '背视图', baseX + 720)
      addEdgeBetween(el.id, front.id)
      addEdgeBetween(front.id, side.id)
      addEdgeBetween(front.id, back.id)
    } catch (err) {
      alert('模型三视图生成失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // 图片分割：支持 2×2（1分4）和 2×4（1分8）平均切图；结果自动上传并连回源图。
  const handleSplit = async (mode = '4') => {
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
      const cols = 2
      const rows = mode === '8' ? 4 : 2
      const tileW = Math.floor(w / cols)
      const tileH = Math.floor(h / rows)
      const regions = []
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          regions.push({
            sx: col * tileW,
            sy: row * tileH,
            col,
            row,
          })
        }
      }
      const baseX = (el.x || 0) + (el.width || 256) + 80
      const baseY = el.y || 0
      const thumbMax = 200

      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]
        const canvas = document.createElement('canvas')
        canvas.width = tileW
        canvas.height = tileH
        const ctx = canvas.getContext('2d')
        ctx.drawImage(imgEl, r.sx, r.sy, tileW, tileH, 0, 0, tileW, tileH)

        // 转 blob → 上传后端 → 拿到 /static/... URL
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        const formData = new FormData()
        formData.append('file', blob, `split_${i}.png`)
        const res = await axios.post('/api/upload-image', formData)
        const imgUrl = res.data.url

        // 缩略图尺寸
        let tw = tileW, th = tileH
        if (tw > thumbMax || th > thumbMax) {
          const ratio = Math.min(thumbMax / tw, thumbMax / th)
          tw = Math.round(tw * ratio)
          th = Math.round(th * ratio)
        }
        const resultId = addNode({
          src: imgUrl,
          width: tw,
          height: th,
          position: { x: baseX + r.col * (thumbMax + 20), y: baseY + r.row * (thumbMax + 20) },
        })
        addEdgeBetween(el.id, resultId)
      }
    } catch (err) {
      alert('分割失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // YOLO 实例分割：提取人物前景与透明背景，结果自动连回源图
  const handleYoloSplit = async (confidence = 0.25) => {
    const el = selectedElement
    if (!el) return
    setLoading(true)
    try {
      const res = await axios.post('/api/yolo-split', {
        image: el.src,
        classes: ['person'],
        confidence,
      })
      const results = res.data.images || []
      if (!results.length) throw new Error('YOLO 未返回拆分结果')
      const baseX = (el.x || 0) + (el.width || 256) + 100
      for (let i = 0; i < results.length; i++) {
        const item = results[i]
        const imgEl = new window.Image()
        imgEl.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => {
          imgEl.onload = resolve
          imgEl.onerror = reject
          imgEl.src = item.url
        })
        const maxSize = 320
        let w = imgEl.naturalWidth || el.width || 256
        let h = imgEl.naturalHeight || el.height || 256
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h)
          w = Math.round(w * ratio)
          h = Math.round(h * ratio)
        }
        const resultId = addNode({
          src: item.url,
          width: w,
          height: h,
          position: { x: baseX, y: (el.y || 0) + i * (h + 24) },
        })
        addEdgeBetween(el.id, resultId)
      }
    } catch (err) {
      alert('YOLO 拆分失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
  }

  // Qwen3 生成视频提示词：选中图片 + 用户基本需求 → 返回完整提示词
  const handleGenerateVideoPrompt = async (instruction) => {
    const el = selectedElement
    if (!el) return null
    setLoading(true)
    try {
      const res = await axios.post('/api/generate-video-prompt', {
        image: el.src,
        instruction: instruction || '',
      })
      if (res.data.success) {
        return res.data.prompt
      }
    } catch (err) {
      alert('生成提示词失败: ' + formatErr(err))
    } finally {
      setLoading(false)
    }
    return null
  }

  // 图生视频：选中图片 → 生成视频 → 自动连线
  const handleImageToVideo = async (prompt, duration = 5, aspect = '16:9', modelType = 'pruned', referenceElements = null) => {
    const imgs = referenceElements?.length ? referenceElements : (selectedElements.length > 0 ? selectedElements : selectedElement ? [selectedElement] : [])
    if (imgs.length === 0) return
    if (imgs.length > 9) {
      alert('最多支持 9 张参考图，请减少选中数量')
      return
    }
    // 12GB 显存软警告：>8s 容易 OOM
    if (duration > 8 && !confirm(`视频时长 ${duration}s 在 12GB 显存上可能 OOM，是否继续？`)) {
      return
    }
    // 分辨率映射
    const [width, height] = aspect === '9:16' ? [768, 1344] : [1344, 768]
    setLoading(true)
    try {
      const res = await axios.post('/api/image-to-video', {
        model: 'comfyui-minimax',
        reference_images: imgs.map((el) => el.src),
        duration,
        prompt: prompt || '',
        width,
        height,
        workflow_type: modelType,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      <ProjectBar
        currentName={currentProject}
        onSave={handleSaveProject}
        onLoad={handleLoadProject}
        onNew={handleNewProject}
        onDelete={handleNewProject}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* 左侧工具栏 */}
      <Toolbar
        onAddModel={handleModelUpload}
        onAddDirectorStage={() => addNode({
          type: 'directorStageNode',
          width: 900,
          height: 580,
          mediaType: 'director-stage',
          position: { x: 120 + nodes.length * 20, y: 100 + nodes.length * 20 },
          data: {
            stage: {
              coordinateSystem: 'dcc-z-up',
              objects: [{ id: 'ground', kind: 'ground', name: '地面', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#2f3742' }],
              selectedObjectId: 'ground',
              camera: { position: [5.5, 6.5, 3.8], target: [0, 0, 1] },
            },
          },
        })}
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
        onGenerateVideoPrompt={handleGenerateVideoPrompt}
        onYoloSplit={handleYoloSplit}
        onUpscale={handleUpscale}
        onSplit={handleSplit}
        onRefineAnalyze={handleRefineAnalyze}
        onRefineGenerate={handleRefineGenerate}
        onGenerateModelViewPrompt={handleModelViewPrompt}
        onModelViews={handleModelViews}
        onAddCamera={handleAddCamera}
        onInpaint={handleInpaint}
        onUpdateDirectorStage={(stage) => updateNode(selectedId, { stage })}
        onRemove={() => removeNode(selectedId)}
        onBringToFront={() => bringToFront(selectedId)}
      />
      </div>
    </div>
  )
}
