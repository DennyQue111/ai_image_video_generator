import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow } from 'reactflow'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

const DEFAULT_STAGE = {
  objects: [
    { id: 'ground', kind: 'ground', name: '地面', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#2f3742' },
  ],
  selectedObjectId: 'ground',
  // DCC 约定：X 横向、Y 纵深、Z 向上；Three.js 内部会交换 Y/Z。
  coordinateSystem: 'dcc-z-up',
  camera: { position: [5.5, 6.5, 3.8], target: [0, 0, 1] },
  views: [],
}


function cloneStage(stage) {
  return JSON.parse(JSON.stringify(stage || DEFAULT_STAGE))
}

function scaleValues(value) {
  return Array.isArray(value) ? value : [value || 1, value || 1, value || 1]
}

// 导演台对用户和 JSON 使用 DCC 的 Z-up；Three.js 仍然使用 Y-up。
const toThreeVector = (values, isDcc) => isDcc ? [values[0], values[2], values[1]] : values
const fromThreeVector = (values, isDcc) => isDcc ? [values[0], values[2], values[1]] : values

function makeHuman(color) {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 })
  const dark = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.85 })
  const add = (geometry, materialToUse, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, materialToUse)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  add(new THREE.SphereGeometry(0.18, 20, 16), material, 0, 1.72, 0)
  add(new THREE.CapsuleGeometry(0.22, 0.58, 6, 12), material, 0, 1.22, 0)
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 10), dark, -0.12, 0.48, 0)
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.62, 10), dark, 0.12, 0.48, 0)
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.56, 10), material, -0.31, 1.24, 0)
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.56, 10), material, 0.31, 1.24, 0)
  return group
}

function makeObject(item, isDcc) {
  const color = item.color || '#64748b'
  const root = new THREE.Group()
  let object
  if (item.kind === 'ground') {
    object = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide }))
    object.rotation.x = -Math.PI / 2
  } else if (item.kind === 'wall') {
    object = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.7, 0.18), new THREE.MeshStandardMaterial({ color, roughness: 0.88 }))
    object.position.y = 1.35
  } else if (item.kind === 'crate') {
    object = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02 }))
    object.position.y = 0.45
  } else if (item.kind === 'barrel') {
    object = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.85, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.58 }))
    object.position.y = 0.425
  } else {
    object = makeHuman(color)
  }
  root.add(object)
  root.position.fromArray(toThreeVector(item.position || [0, 0, 0], isDcc))
  const rotation = item.rotation || [0, 0, 0]
  root.rotation.set(...toThreeVector(rotation, isDcc))
  root.scale.fromArray(toThreeVector(scaleValues(item.scale), isDcc))
  root.traverse((child) => { child.userData.directorId = item.id })
  root.userData.directorId = item.id
  return root
}

function DirectorStageNode({ data, selected, id }) {
  const mountRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const rendererRef = useRef(null)
  const currentViewRef = useRef(null)
  const stageRef = useRef(null)
  const transformHistoryRef = useRef({ undo: [], redo: [], pending: null })
  const [transformMode, setTransformMode] = useState('translate')
  const { setNodes } = useReactFlow()
  const stage = useMemo(() => {
    const source = data.stage || {}
    return {
      ...DEFAULT_STAGE,
      ...source,
      coordinateSystem: source.coordinateSystem || 'three-y-up',
      camera: { ...DEFAULT_STAGE.camera, ...(source.camera || {}) },
    }
  }, [data.stage])
  const isDcc = stage.coordinateSystem === 'dcc-z-up'
  stageRef.current = stage
  const commitStage = (next) => {
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, stage: next } }
      : node))
  }

  const handleResize = (_, params) => {
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, style: { ...node.style, width: Math.round(params.width), height: Math.round(params.height) }, data: { ...node.data, width: Math.round(params.width), height: Math.round(params.height) } }
      : node))
  }

  // 旧导演台最初按 Three.js Y-up 存储；只迁移一次，交换 Y/Z 后保留同一画面位置。
  useEffect(() => {
    if (stage.coordinateSystem !== 'three-y-up') return
    const next = cloneStage(stage)
    next.coordinateSystem = 'dcc-z-up'
    next.objects = next.objects.map((item) => ({
      ...item,
      position: fromThreeVector(item.position || [0, 0, 0], true),
      rotation: fromThreeVector(item.rotation || [0, 0, 0], true),
      scale: fromThreeVector(scaleValues(item.scale), true),
    }))
    next.camera = {
      position: fromThreeVector(next.camera.position, true),
      target: fromThreeVector(next.camera.target, true),
    }
    next.views = (next.views || []).map((view) => ({
      ...view,
      camera: {
        position: fromThreeVector(view.camera.position, true),
        target: fromThreeVector(view.camera.target, true),
      },
    }))
    currentViewRef.current = null
    commitStage(next)
  }, [stage.coordinateSystem])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!selected) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      const hasModifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (hasModifier && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        const history = transformHistoryRef.current
        const previous = history.undo.pop()
        if (!previous) return
        history.redo.push(cloneStage(stageRef.current))
        commitStage(previous)
        return
      }
      if ((hasModifier && key === 'y') || (hasModifier && event.shiftKey && key === 'z')) {
        event.preventDefault()
        const history = transformHistoryRef.current
        const following = history.redo.pop()
        if (!following) return
        history.undo.push(cloneStage(stageRef.current))
        commitStage(following)
        return
      }
      const modes = { w: 'translate', e: 'rotate', r: 'scale' }
      const mode = !hasModifier && modes[key]
      if (mode) {
        event.preventDefault()
        setTransformMode(mode)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, id])

  useEffect(() => {
    if (!mountRef.current) return undefined
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#111827')
    scene.fog = new THREE.Fog('#111827', 9, 24)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
    const visibleView = currentViewRef.current || stage.camera
    camera.position.fromArray(toThreeVector(visibleView.position, isDcc))
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.replaceChildren(renderer.domElement)
    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enableDamping = true
    orbit.target.fromArray(toThreeVector(visibleView.target, isDcc))
    orbit.update()
    const objectsById = new Map()
    stage.objects.forEach((item) => {
      const object = makeObject(item, isDcc)
      scene.add(object)
      objectsById.set(item.id, object)
    })
    const transform = new TransformControls(camera, renderer.domElement)
    const transformHelper = transform.getHelper()
    transform.setMode(transformMode)
    transform.setSpace('world')
    // Three 内部 Y-up；色彩在导演台中按 DCC 语义重映射：X 红、Y(纵深)绿、Z(高度)蓝。
    transformHelper.traverse((child) => {
      if (!child.material || !['Y', 'Z'].includes(child.name)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      const color = child.name === 'Y' ? 0x3b82f6 : 0x22c55e
      materials.forEach((material) => { if (material.color) material.color.setHex(color) })
    })
    const selectedObject = objectsById.get(stage.selectedObjectId)
    if (selectedObject && selectedObject.userData.directorId !== 'ground') transform.attach(selectedObject)
    transform.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value })
    transform.addEventListener('mouseDown', () => {
      transformHistoryRef.current.pending = cloneStage(stage)
    })
    transform.addEventListener('objectChange', () => {
      const object = transform.object
      const item = stage.objects.find((entry) => entry.id === object?.userData.directorId)
      if (transformMode === 'scale' && item?.lockAspect && object) {
        const uniform = Math.max(0.1, object.scale.x, object.scale.y, object.scale.z)
        object.scale.setScalar(uniform)
      }
    })
    transform.addEventListener('mouseUp', () => {
      const object = transform.object
      if (!object) return
      const itemId = object.userData.directorId
      const next = cloneStage(stage)
      next.objects = next.objects.map((item) => item.id === itemId ? {
        ...item,
        position: fromThreeVector(object.position.toArray(), isDcc).map((value) => Number(value.toFixed(2))),
        rotation: fromThreeVector(object.rotation.toArray().slice(0, 3), isDcc).map((value) => Number(value.toFixed(3))),
        scale: fromThreeVector(object.scale.toArray(), isDcc).map((value) => Number(value.toFixed(2))),
      } : item)
      const history = transformHistoryRef.current
      if (history.pending && JSON.stringify(history.pending) !== JSON.stringify(next)) {
        history.undo.push(history.pending)
        if (history.undo.length > 50) history.undo.shift()
        history.redo = []
      }
      history.pending = null
      commitStage(next)
    })
    scene.add(transformHelper)
    scene.add(new THREE.HemisphereLight(0xbdd8ff, 0x172033, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.8)
    key.position.set(4, 7, 4)
    key.castShadow = true
    scene.add(key)
    const rim = new THREE.PointLight(0x60a5fa, 9, 10)
    rim.position.set(-3, 3, -3)
    scene.add(rim)
    scene.add(new THREE.GridHelper(12, 24, 0x4b5563, 0x263141))
    // 面向用户的 DCC 世界轴：X=红（横向）、Y=绿（纵深）、Z=蓝（向上）。
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.5, 0xef4444))
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1.5, 0x22c55e))
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1.5, 0x3b82f6))
    const resize = () => {
      const width = mount.clientWidth || 640
      const height = mount.clientHeight || 380
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const selectFromPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects([...objectsById.values()], true).find((entry) => entry.object.userData.directorId)
      if (!hit) return
      const next = cloneStage(stage)
      next.selectedObjectId = hit.object.userData.directorId
      commitStage(next)
    }
    renderer.domElement.addEventListener('dblclick', selectFromPointer)
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      orbit.update()
      renderer.render(scene, camera)
    }
    render()
    cameraRef.current = camera
    controlsRef.current = orbit
    rendererRef.current = renderer
    return () => {
      currentViewRef.current = { position: fromThreeVector(camera.position.toArray(), isDcc), target: fromThreeVector(orbit.target.toArray(), isDcc) }
      cancelAnimationFrame(frame)
      renderer.domElement.removeEventListener('dblclick', selectFromPointer)
      observer.disconnect()
      transform.dispose()
      orbit.dispose()
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [stage, isDcc, transformMode])

  const saveNamedView = (requestedName = '') => {
    if (!cameraRef.current || !controlsRef.current) return
    const name = requestedName.trim()
    if (!name) return
    const next = cloneStage(stage)
    const view = {
      id: name,
      name,
      camera: {
        position: fromThreeVector(cameraRef.current.position.toArray(), isDcc).map((value) => Number(value.toFixed(2))),
        target: fromThreeVector(controlsRef.current.target.toArray(), isDcc).map((value) => Number(value.toFixed(2))),
      },
    }
    next.views = (next.views || []).filter((entry) => entry.name !== name)
    next.views.push(view)
    commitStage(next)
  }

  useEffect(() => {
    const handleCommand = (event) => {
      const command = event.detail
      if (!command || command.stageId !== id) return
      if (command.action === 'saveView') saveNamedView(command.name)
      if (command.action === 'switchView') {
        const view = (stage.views || []).find((entry) => entry.name === command.name)
        if (!view || !cameraRef.current || !controlsRef.current) return
        currentViewRef.current = view.camera
        cameraRef.current.position.fromArray(toThreeVector(view.camera.position, isDcc))
        controlsRef.current.target.fromArray(toThreeVector(view.camera.target, isDcc))
        controlsRef.current.update()
      }
      if (command.action === 'exportFrame') exportFrame()
    }
    window.addEventListener('director-stage-command', handleCommand)
    return () => window.removeEventListener('director-stage-command', handleCommand)
  }, [id, stage, isDcc])

  const exportFrame = () => {
    const renderer = rendererRef.current
    if (!renderer) return
    const anchor = document.createElement('a')
    anchor.href = renderer.domElement.toDataURL('image/png')
    anchor.download = `director-stage-${Date.now()}.png`
    anchor.click()
  }

  return (
    <div className={`director-stage-node ${selected ? 'rf-node-selected' : ''}`} style={{ width: '100%', height: '100%' }}>
      <NodeResizer isVisible={selected} minWidth={620} minHeight={470} color="#f59e0b" onResizeEnd={handleResize} />
      <Handle type="target" position={Position.Left} id="input" style={{ background: '#f59e0b' }} />
      <div className="director-stage-header director-stage-drag-handle">🎬 导演台 · {({ translate: '移动', rotate: '旋转', scale: '缩放' })[transformMode]}模式 <span>W/E/R 工具 · Ctrl+Z 撤销</span></div>
      <div className="director-stage-body">
        <div className="director-stage-viewport" ref={mountRef} />
      </div>
      <Handle type="source" position={Position.Right} id="output" style={{ background: '#f59e0b' }} />
    </div>
  )
}

export default memo(DirectorStageNode)
