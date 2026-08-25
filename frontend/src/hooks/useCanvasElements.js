import { useState, useCallback, useRef } from 'react'
import { useNodesState, useEdgesState, addEdge } from 'reactflow'

let idCounter = 0
const genId = () => `node_${Date.now()}_${idCounter++}`

/**
 * 画布节点/连线状态管理 hook（基于 React Flow）
 * 管理节点（图片/视频）和连线（生成关系）
 */
export function useCanvasElements() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedId, setSelectedId] = useState(null)
  const edgeIdRef = useRef(0)

  // 添加节点，返回节点 id
  const addNode = useCallback(
    (nodeData) => {
      const id = nodeData.id || genId()
      const newNode = {
        id,
        type: 'imageNode',
        position: nodeData.position || { x: 250, y: 200 },
        data: {
          src: nodeData.src,
          width: nodeData.width || 256,
          height: nodeData.height || 256,
          mediaType: nodeData.mediaType || 'image',
          ...nodeData.data,
        },
      }
      setNodes((prev) => [...prev, newNode])
      setSelectedId(id)
      return id
    },
    [setNodes]
  )

  // 删除节点和相关连线
  const removeNode = useCallback(
    (id) => {
      setNodes((prev) => prev.filter((n) => n.id !== id))
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id))
      setSelectedId((prev) => (prev === id ? null : prev))
    },
    [setNodes, setEdges]
  )

  // 更新节点数据
  const updateNode = useCallback(
    (id, dataUpdates) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...dataUpdates } } : n
        )
      )
    },
    [setNodes]
  )

  // 选中节点
  const selectNode = useCallback(
    (id) => {
      setSelectedId(id)
      setNodes((prev) =>
        prev.map((n) => ({ ...n, selected: n.id === id }))
      )
    },
    [setNodes]
  )

  // 手动连线回调
  const onConnect = useCallback(
    (params) => {
      setEdges((prev) =>
        addEdge({ ...params, animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } }, prev)
      )
    },
    [setEdges]
  )

  // 自动添加连线（执行操作后，连接源节点和结果节点）
  const addEdgeBetween = useCallback(
    (sourceId, targetId) => {
      const edgeId = `edge_${Date.now()}_${edgeIdRef.current++}`
      setEdges((prev) => [
        ...prev,
        {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourceHandle: 'output',
          targetHandle: 'input',
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 2 },
        },
      ])
    },
    [setEdges]
  )

  // 清空画布
  const clearAll = useCallback(() => {
    setNodes([])
    setEdges([])
    setSelectedId(null)
  }, [setNodes, setEdges])

  // 置顶节点（移动到数组末尾，React Flow 会最后渲染）
  const bringToFront = useCallback(
    (id) => {
      setNodes((prev) => {
        const node = prev.find((n) => n.id === id)
        if (!node) return prev
        return [...prev.filter((n) => n.id !== id), { ...node, selected: true }]
      })
    },
    [setNodes]
  )

  // 选中的节点对象
  const selectedNode = nodes.find((n) => n.id === selectedId) || null

  // 兼容 RightPanel 的 selectedElement 格式
  const selectedElement = selectedNode
    ? {
        id: selectedNode.id,
        src: selectedNode.data.src,
        width: selectedNode.data.width,
        height: selectedNode.data.height,
        type: selectedNode.data.mediaType,
        x: selectedNode.position.x,
        y: selectedNode.position.y,
      }
    : null

  return {
    nodes,
    edges,
    selectedId,
    selectedElement,
    selectedNode,
    addNode,
    removeNode,
    updateNode,
    selectNode,
    onConnect,
    onNodesChange,
    onEdgesChange,
    addEdgeBetween,
    clearAll,
    bringToFront,
    setNodes,
    setEdges,
  }
}
