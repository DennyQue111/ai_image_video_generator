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
  } else if (item.kind === 'building') {
    const group = new THREE.Group()
    const width = item.dimensions?.[0] || 3.6
    const depth = item.dimensions?.[1] || 3.2
    const height = item.dimensions?.[2] || 5.5
    const floors = Math.max(1, Math.round(height / 2.4))
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.88 }))
    body.position.y = height / 2
    body.castShadow = true; body.receiveShadow = true; group.add(body)
    const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.16, depth + 0.14), new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.8 }))
    trim.position.y = height + 0.08; trim.castShadow = true; group.add(trim)
    const windowMaterial = new THREE.MeshStandardMaterial({ color: item.windowColor || '#78b8cf', roughness: 0.3, metalness: 0.18, emissive: '#183c4b', emissiveIntensity: 0.2 })
    for (let floor = 0; floor < floors; floor++) {
      const y = 0.75 + floor * 2.4
      for (const x of [-width * 0.3, 0, width * 0.3]) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.86, 0.07), windowMaterial)
        pane.position.set(x, y, depth / 2 + 0.045); group.add(pane)
      }
    }
    object = group
  } else if (item.kind === 'road') {
    object = new THREE.Group()
    const asphalt = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 4), new THREE.MeshStandardMaterial({ color: '#252a31', roughness: 0.95 }))
    asphalt.position.y = 0.04; object.add(asphalt)
    for (let x = -2.7; x <= 2.7; x += 1.8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.018, 0.12), new THREE.MeshStandardMaterial({ color: '#e6c96e', roughness: 0.8 }))
      dash.position.set(x, 0.09, 0); object.add(dash)
    }
  } else if (item.kind === 'sidewalk') {
    object = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 1.4), new THREE.MeshStandardMaterial({ color: '#9ca3a0', roughness: 0.94 }))
    object.position.y = 0.09
  } else if (item.kind === 'water') {
    object = new THREE.Mesh(new THREE.BoxGeometry(18, 0.06, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.28, transparent: true, opacity: 0.9 }))
    object.position.y = 0.03
  } else if (item.kind === 'paving') {
    object = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(8, 0.18, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.98 }))
    slab.position.y = 0.09; object.add(slab)
    const seamMat = new THREE.MeshStandardMaterial({ color: '#62594d', roughness: 1 })
    for (let offset = -3.5; offset <= 3.5; offset += 1) {
      const seamX = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 8), seamMat); seamX.position.set(offset, 0.185, 0); object.add(seamX)
      const seamZ = new THREE.Mesh(new THREE.BoxGeometry(8, 0.012, 0.035), seamMat); seamZ.position.set(0, 0.185, offset); object.add(seamZ)
    }
  } else if (item.kind === 'streetlight') {
    object = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: '#29313b', metalness: 0.72, roughness: 0.38 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 4.2, 10), mat); pole.position.y = 2.1; object.add(pole)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.07), mat); arm.position.set(0.34, 4.12, 0); object.add(arm)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.22), new THREE.MeshStandardMaterial({ color: '#ffe7a3', emissive: '#ffc65c', emissiveIntensity: 1.3 })); lamp.position.set(0.65, 4.02, 0); object.add(lamp)
  } else if (item.kind === 'tower') {
    object = new THREE.Group()
    const height = item.dimensions?.[2] || 16
    const radius = item.dimensions?.[0] || 0.9
    const levels = Math.max(4, Math.round(height / 1.8))
    for (let level = 0; level < levels; level++) {
      const t = level / levels
      const r = radius * (1 - t * 0.62)
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r, height / levels + 0.06, 12), new THREE.MeshStandardMaterial({ color: level % 3 === 0 ? '#8aa5b2' : color, roughness: 0.42, metalness: 0.28 }))
      floor.position.y = (level + 0.5) * height / levels; object.add(floor)
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.38, height * 0.18, 10), new THREE.MeshStandardMaterial({ color: '#b7c6cc', metalness: 0.45, roughness: 0.32 }))
    spire.position.y = height * 1.08; object.add(spire)
  } else if (item.kind === 'sphere') {
    object = new THREE.Mesh(new THREE.SphereGeometry(item.dimensions?.[0] || 1, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.25 }))
  } else if (item.kind === 'cone') {
    const radius = item.dimensions?.[0] || 1.2
    const height = item.dimensions?.[2] || 3
    object = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2 }))
    object.position.y = height / 2
  } else if (item.kind === 'cylinder') {
    const radius = item.dimensions?.[0] || 1
    const height = item.dimensions?.[2] || 4
    object = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.18 }))
    object.position.y = height / 2
  } else if (item.kind === 'ferrisWheel') {
    const group = new THREE.Group()
    const radius = item.dimensions?.[0] || 5
    const centerY = item.dimensions?.[2] || 6
    const frameMat = new THREE.MeshStandardMaterial({ color, metalness: 0.72, roughness: 0.38 })
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#d9a85e', roughness: 0.7 })
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 8, 48), frameMat)
    rim.position.y = centerY; group.add(rim)
    const spokeCount = 12
    for (let i = 0; i < spokeCount; i++) {
      const angle = i * Math.PI * 2 / spokeCount
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, radius * 2, 6), frameMat)
      spoke.position.set(0, centerY, 0)
      spoke.rotation.z = angle
      group.add(spoke)
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.38), cabinMat)
      cabin.position.set(Math.sin(angle) * radius, centerY + Math.cos(angle) * radius, 0)
      group.add(cabin)
    }
    for (const side of [-1, 1]) {
      const support = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, centerY, 8), frameMat)
      support.position.set(side * radius * 0.35, centerY / 2, 0)
      support.rotation.z = side * -0.28
      group.add(support)
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, Math.hypot(radius * 0.55, centerY), 8), frameMat)
      brace.position.set(side * radius * 0.27, centerY * 0.48, 0)
      brace.rotation.z = side * 0.48
      group.add(brace)
    }
    object = group
  } else if (item.kind === 'rollercoaster') {
    const group = new THREE.Group()
    const trackMat = new THREE.MeshStandardMaterial({ color: '#8b4e2d', metalness: 0.62, roughness: 0.48 })
    const railMat = new THREE.MeshStandardMaterial({ color: '#c58c4d', metalness: 0.68, roughness: 0.36 })
    const points = [new THREE.Vector3(-11, 1, 0), new THREE.Vector3(-8, 11, 0), new THREE.Vector3(-5, 17, 0), new THREE.Vector3(-1, 8, 0), new THREE.Vector3(3, 4, 0), new THREE.Vector3(7, 12, 0), new THREE.Vector3(10, 9, 0), new THREE.Vector3(13, 2, 0)]
    const curve = new THREE.CatmullRomCurve3(points)
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.12, 8, false), trackMat))
    const secondRail = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.1, 8, false), railMat)
    secondRail.position.z = 0.38; group.add(secondRail)
    for (let i = 0; i <= 12; i++) {
      const point = curve.getPoint(i / 12)
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, Math.max(0.3, point.y), 7), trackMat)
      post.position.set(point.x, point.y / 2, point.z + 0.18); group.add(post)
    }
    object = group
  } else if (item.kind === 'carousel') {
    const group = new THREE.Group()
    const iron = new THREE.MeshStandardMaterial({ color: '#473b34', metalness: 0.48, roughness: 0.55 })
    const faded = new THREE.MeshStandardMaterial({ color: '#b8856e', roughness: 0.78, side: THREE.DoubleSide })
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.5, 0.5, 24), iron); platform.position.y = 0.35; group.add(platform)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.2, 16), faded); roof.position.y = 6.1; group.add(roof)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 5.6, 12), iron); hub.position.y = 3.2; group.add(hub)
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5, 8), iron)
      post.position.set(Math.cos(angle) * 3.25, 3, Math.sin(angle) * 3.25); group.add(post)
      const horse = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 0.7), new THREE.MeshStandardMaterial({ color: i % 2 ? '#d0b386' : '#879394' }))
      horse.position.set(Math.cos(angle) * 2.4, 1.25 + (i % 2) * 0.35, Math.sin(angle) * 2.4); group.add(horse)
    }
    object = group
  } else if (item.kind === 'fountain') {
    const group = new THREE.Group()
    const stone = new THREE.MeshStandardMaterial({ color: '#918b7e', roughness: 0.93 })
    const water = new THREE.MeshStandardMaterial({ color: '#577b82', roughness: 0.24, metalness: 0.18 })
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.6, 32), stone); basin.position.y = 0.35; group.add(basin)
    const waterTop = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.08, 32), water); waterTop.position.y = 0.68; group.add(waterTop)
    const tier = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 0.55, 20), stone); tier.position.y = 1.1; group.add(tier)
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.95, 2.5, 10), stone); pedestal.position.y = 2.5; group.add(pedestal)
    const statue = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.3, 4, 8), new THREE.MeshStandardMaterial({ color: '#736e66', roughness: 0.9 })); body.position.y = 4.55; statue.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), body.material); head.position.set(0, 5.55, 0); statue.add(head)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.35, 7), body.material)
      arm.position.set(side * 0.65, 4.75, 0); arm.rotation.z = side * -0.6; statue.add(arm)
    }
    group.add(statue)
    object = group
  } else if (item.kind === 'floatingCube') {
    object = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshStandardMaterial({ color: '#243d50', roughness: 0.3, metalness: 0.65, emissive: '#123347', emissiveIntensity: 0.36 }))
  } else if (item.kind === 'desertMountain') {
    const radius = item.dimensions?.[0] || 12
    const height = item.dimensions?.[2] || 10
    object = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }))
    object.position.y = height / 2
  } else if (item.kind === 'ruin') {
    const group = new THREE.Group()
    const stone = new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 0.6), stone); wall.position.y = 2; group.add(wall)
    const gap = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.75), new THREE.MeshStandardMaterial({ color: '#111827' })); gap.position.set(0, 1.2, 0.05); group.add(gap)
    const broken = new THREE.Mesh(new THREE.BoxGeometry(2, 0.45, 0.9), stone); broken.position.set(-1.7, 4, 0); broken.rotation.z = -0.22; group.add(broken)
    object = group
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
  const transformHistoryRef = useRef({ undo: [], redo: [], pending: null, lastStage: null })
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
  transformHistoryRef.current.lastStage = transformHistoryRef.current.lastStage || cloneStage(stage)
  const commitStage = (next) => {
    const history = transformHistoryRef.current
    const previous = history.lastStage || cloneStage(stageRef.current)
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      history.undo.push(cloneStage(previous))
      if (history.undo.length > 50) history.undo.shift()
      history.redo = []
    }
    history.lastStage = cloneStage(next)
    stageRef.current = next
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
      const hasModifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (hasModifier && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        const history = transformHistoryRef.current
        const previous = history.undo.pop()
        if (!previous) return
        history.redo.push(cloneStage(history.lastStage || stageRef.current))
        history.lastStage = cloneStage(previous)
        stageRef.current = previous
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, stage: previous } }
          : node))
        return
      }
      if ((hasModifier && key === 'y') || (hasModifier && event.shiftKey && key === 'z')) {
        event.preventDefault()
        const history = transformHistoryRef.current
        const following = history.redo.pop()
        if (!following) return
        history.undo.push(cloneStage(history.lastStage || stageRef.current))
        history.lastStage = cloneStage(following)
        stageRef.current = following
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, stage: following } }
          : node))
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
    scene.background = new THREE.Color('#8db6d2')
    const depth = Math.max(100, stage.depth || 1000)
    scene.fog = new THREE.Fog('#8db6d2', Math.max(9, depth * 0.15), Math.max(24, depth * 0.8))
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, depth)
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
    // Only the selected director-stage node owns wheel zoom; otherwise let React Flow handle it.
    orbit.enableZoom = Boolean(selected)
    orbit.zoomSpeed = 0.9
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
  }, [stage, isDcc, transformMode, selected])

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
