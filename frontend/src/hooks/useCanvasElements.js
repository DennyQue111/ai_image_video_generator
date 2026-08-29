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
  const [selectedIds, setSelectedIds] = useState([])
  const edgeIdRef = useRef(0)

  // React Flow 原生选中变化回调（支持多选：Ctrl/Cmd+点击 或 框选）
  const onSelectionChange = useCallback(({ nodes: selNodes }) => {
    setSelectedIds(selNodes.map((n) => n.id))
  }, [])

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
      setSelectedIds([id])
      return id
    },
    [setNodes, setSelectedIds]
  )

  // 删除节点和相关连线
  const removeNode = useCallback(
    (id) => {
      setNodes((prev) => prev.filter((n) => n.id !== id))
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id))
      setSelectedIds((prev) => prev.filter((sid) => sid !== id))
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

  // 选中节点（单选模式；多选由 React Flow 原生交互 + onSelectionChange 处理）
  const selectNode = useCallback(
    (id) => {
      setNodes((prev) =>
        prev.map((n) => ({ ...n, selected: id ? n.id === id : false }))
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
    setSelectedIds([])
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

  // 当前选中的节点 id（多选时取最后一个，作为“主”选中用于单图操作）
  const selectedId = selectedIds[selectedIds.length - 1] || null

  // 所有选中节点
  const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id))
  const selectedNode =
    selectedNodes.find((n) => n.id === selectedId) || selectedNodes[0] || null

  // 节点 → 兼容 RightPanel 的元素格式
  const toCompat = (n) => ({
    id: n.id,
    src: n.data.src,
    width: n.data.width,
    height: n.data.height,
    type: n.data.mediaType,
    x: n.position.x,
    y: n.position.y,
  })

  // 单个选中（兼容现有单图操作：图生视频、分析等）
  const selectedElement = selectedNode ? toCompat(selectedNode) : null
  // 多个选中（用于多图融合）
  const selectedElements = selectedNodes.map(toCompat)

  // 序列化当前画布为可保存数据（只存必要字段 + URL 引用，不存 selected 等运行时状态）
  const toSaveData = useCallback(() => {
    const cleanNodes = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        src: n.data.src,
        width: n.data.width,
        height: n.data.height,
        mediaType: n.data.mediaType,
      },
    }))
    const cleanEdges = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }))
    return { nodes: cleanNodes, edges: cleanEdges }
  }, [nodes, edges])

  // 从加载的数据还原画布（替换当前内容）
  const loadFromData = useCallback(
    (data) => {
      if (!data || !Array.isArray(data.nodes)) return
      setNodes(
        data.nodes.map((n) => ({
          id: n.id,
          type: n.type || 'imageNode',
          position: n.position || { x: 250, y: 200 },
          data: {
            src: n.data?.src,
            width: n.data?.width || 256,
            height: n.data?.height || 256,
            mediaType: n.data?.mediaType || 'image',
          },
        }))
      )
      setEdges(
        (data.edges || []).map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || 'output',
          targetHandle: e.targetHandle || 'input',
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 2 },
        }))
      )
      setSelectedIds([])
    },
    [setNodes, setEdges]
  )

  return {
    nodes,
    edges,
    selectedId,
    selectedIds,
    selectedElement,
    selectedElements,
    selectedNode,
    addNode,
    removeNode,
    updateNode,
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
    setNodes,
    setEdges,
  }
}
