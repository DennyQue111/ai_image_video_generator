import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const PROJECT_KEY = 'ai-image-video-generator:editing-studio:v1'

function readSavedClips() {
  try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]') } catch { return [] }
}

export function useEditingTimeline() {
  const [library, setLibrary] = useState([])
  const [clips, setClips] = useState(readSavedClips)
  const [selectedId, setSelectedId] = useState(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const videoRef = useRef(null)
  const dragId = useRef(null)

  const selected = clips.find((clip) => clip.id === selectedId) || null
  const totalDuration = clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0)
  const activeInfo = useMemo(() => {
    let cursor = 0
    for (const clip of clips) {
      const duration = Math.max(0, clip.end - clip.start)
      if (playhead <= cursor + duration || clip === clips.at(-1)) {
        return { clip, timelineStart: cursor, sourceTime: clip.start + Math.max(0, Math.min(duration, playhead - cursor)) }
      }
      cursor += duration
    }
    return null
  }, [clips, playhead])

  useEffect(() => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(clips.filter((clip) => !clip.temporary)))
  }, [clips])

  const loadLibrary = async () => {
    setLibraryError('')
    try {
      const response = await axios.get('/api/media-library')
      setLibrary(response.data.assets || [])
    } catch (error) {
      setLibraryError(error.response?.data?.detail || '读取生成素材失败')
    }
  }

  useEffect(() => { loadLibrary() }, [])

  const addAsset = (asset) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const isImage = asset.type === 'image'
    const clip = {
      id,
      assetId: asset.id,
      name: asset.filename,
      src: asset.url,
      type: asset.type,
      start: 0,
      end: isImage ? 5 : 10,
      sourceDuration: isImage ? 5 : 10,
      grade: { brightness: 100, contrast: 100, saturation: 100 },
    }
    setClips((items) => [...items, clip])
    setSelectedId(id)
  }

  const addLocalFiles = (files) => {
    Array.from(files || []).forEach((file) => {
      if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) return
      const url = URL.createObjectURL(file)
      const type = file.type.startsWith('video/') ? 'video' : 'image'
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setClips((items) => [...items, {
        id,
        assetId: `local:${file.name}`,
        name: file.name,
        src: url,
        type,
        start: 0,
        end: type === 'image' ? 5 : 10,
        sourceDuration: type === 'image' ? 5 : 10,
        grade: { brightness: 100, contrast: 100, saturation: 100 },
        temporary: true,
      }])
      setSelectedId(id)
    })
  }

  const updateClip = (id, patch) => setClips((items) => items.map((clip) => clip.id === id ? { ...clip, ...patch } : clip))

  const seekToClip = (id) => {
    const index = clips.findIndex((clip) => clip.id === id)
    if (index < 0) return
    const time = clips.slice(0, index).reduce((sum, clip) => sum + clip.end - clip.start, 0)
    setPlayhead(time)
    setSelectedId(id)
  }

  const removeSelected = () => {
    if (!selected) return
    const index = clips.findIndex((clip) => clip.id === selected.id)
    setClips((items) => items.filter((clip) => clip.id !== selected.id))
    setSelectedId(clips[index + 1]?.id || clips[index - 1]?.id || null)
  }

  const splitSelected = () => {
    if (!selected || selected.type !== 'video') return
    const index = clips.findIndex((clip) => clip.id === selected.id)
    const offset = playhead - clips.slice(0, index).reduce((sum, clip) => sum + clip.end - clip.start, 0)
    const cutAt = selected.start + offset
    if (cutAt <= selected.start + 0.15 || cutAt >= selected.end - 0.15) return
    const left = { ...selected, id: `${selected.id}-a-${Date.now()}`, end: cutAt, name: `${selected.name} · A` }
    const right = { ...selected, id: `${selected.id}-b-${Date.now()}`, start: cutAt, name: `${selected.name} · B` }
    setClips((items) => [...items.slice(0, index), left, right, ...items.slice(index + 1)])
    setSelectedId(right.id)
  }

  const moveClip = (targetId) => {
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId || sourceId === targetId) return
    setClips((items) => {
      const next = [...items]
      const from = next.findIndex((clip) => clip.id === sourceId)
      const to = next.findIndex((clip) => clip.id === targetId)
      if (from < 0 || to < 0) return items
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const handleMetadata = (event) => {
    if (!activeInfo?.clip || !Number.isFinite(event.currentTarget.duration)) return
    const clip = activeInfo.clip
    if (clip.sourceDuration === 10 && clip.end === 10) {
      updateClip(clip.id, { sourceDuration: event.currentTarget.duration, end: event.currentTarget.duration })
    }
  }

  const onVideoEnded = () => {
    if (activeInfo && activeInfo.timelineStart + activeInfo.clip.end - activeInfo.clip.start < totalDuration) {
      setPlayhead(activeInfo.timelineStart + activeInfo.clip.end - activeInfo.clip.start + 0.01)
    } else {
      setPlaying(false)
      setPlayhead(0)
    }
  }

  const onVideoTime = (event) => {
    if (!playing || !activeInfo) return
    const current = event.currentTarget.currentTime
    if (current >= activeInfo.clip.end - 0.06) {
      onVideoEnded()
      return
    }
    if (Math.abs(current - activeInfo.sourceTime) > 0.6) return
    setPlayhead(activeInfo.timelineStart + Math.max(0, current - activeInfo.clip.start))
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || activeInfo?.clip?.type !== 'video') return
    const targetTime = Math.min(activeInfo.sourceTime, Math.max(0, video.duration - 0.05 || activeInfo.sourceTime))
    if (Math.abs(video.currentTime - targetTime) > 0.35) video.currentTime = targetTime
    if (playing) video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [activeInfo?.clip?.id, activeInfo?.sourceTime, playing])

  useEffect(() => {
    if (!playing || activeInfo?.clip?.type !== 'image') return undefined
    const timer = window.setTimeout(() => {
      if (playhead + 0.08 >= totalDuration) { setPlayhead(0); setPlaying(false) }
      else setPlayhead((time) => time + 0.08)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [playing, activeInfo?.clip?.id, playhead, totalDuration])

  return {
    library, clips, setClips, selected, selectedId, playhead, setPlayhead, playing, setPlaying,
    libraryError, videoRef, dragId, activeInfo, totalDuration, loadLibrary, addAsset,
    addLocalFiles, updateClip, seekToClip, removeSelected, splitSelected, moveClip,
    handleMetadata, onVideoTime, onVideoEnded,
  }
}
