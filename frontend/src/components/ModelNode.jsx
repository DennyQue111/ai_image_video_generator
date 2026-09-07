import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position } from 'reactflow'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

function ModelNode({ data, selected }) {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('加载中…')

  useEffect(() => {
    if (!mountRef.current || data.format !== 'glb') {
      setStatus('当前预览暂支持 GLB')
      return undefined
    }
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#111827')
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000)
    camera.position.set(2.5, 1.8, 3.5)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth || 256, mount.clientHeight || 256)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2))
    const key = new THREE.DirectionalLight(0xffffff, 2)
    key.position.set(3, 5, 4)
    scene.add(key)
    scene.add(new THREE.GridHelper(4, 12, 0x475569, 0x1e293b))
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    let frame = 0
    let disposed = false
    const loader = new GLTFLoader()
    loader.load(data.src, (gltf) => {
      if (disposed) return
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center)
      const scale = 2 / Math.max(size.x, size.y, size.z, 0.001)
      model.scale.setScalar(scale)
      scene.add(model)
      controls.target.set(0, size.y * scale * 0.35, 0)
      controls.update()
      setStatus('GLB 已加载')
    }, undefined, () => setStatus('模型加载失败'))
    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      controls.dispose()
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [data.src, data.format])

  return (
    <div className={`rf-image-node ${selected ? 'rf-node-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="input" style={{ background: '#3b82f6', border: '2px solid #fff', width: 10, height: 10 }} />
      <div className="rf-node-media" style={{ width: data.width || 320, height: data.height || 240, position: 'relative' }}>
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
        <span style={{ position: 'absolute', left: 6, bottom: 5, color: '#cbd5e1', fontSize: 10, background: 'rgba(15,23,42,.8)', padding: '2px 5px', borderRadius: 3 }}>{status}</span>
      </div>
      <Handle type="source" position={Position.Right} id="output" style={{ background: '#10b981', border: '2px solid #fff', width: 10, height: 10 }} />
    </div>
  )
}

export default memo(ModelNode)
