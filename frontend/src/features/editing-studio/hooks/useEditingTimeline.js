import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const PROJECT_KEY = 'ai-image-video-generator:editing-studio:v1'
const TRACKS_KEY = 'ai-image-video-generator:editing-studio:tracks:v1'
const DEFAULT_TRACKS = [{ id: 'video-1', type: 'video', name: '视频 1' }, { id: 'audio-1', type: 'audio', name: '音频 1' }]

function normalizeClips(clips = []) {
  let cursor = 0
  return clips.map((clip) => {
    const timelineStart = Number.isFinite(clip.timelineStart) ? clip.timelineStart : cursor
    cursor = Math.max(cursor, timelineStart + Math.max(0, clip.end - clip.start))
    return { ...clip, timelineStart }
  })
}

function readSavedClips() {
  try { return normalizeClips(JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]')) } catch { return [] }
}

function readSavedTracks() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRACKS_KEY) || 'null')
    return Array.isArray(saved) && saved.some((track) => track.type === 'video')
      ? [...saved.filter((track) => track.type === 'video'), ...saved.filter((track) => track.type === 'audio')]
      : DEFAULT_TRACKS
  } catch { return DEFAULT_TRACKS }
}

export function useEditingTimeline() {
  const [library, setLibrary] = useState([])
  const [clips, setClips] = useState(readSavedClips)
  const [selectedId, setSelectedId] = useState(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tracks, setTracks] = useState(readSavedTracks)
  const [undoCount, setUndoCount] = useState(0)
  const [libraryError, setLibraryError] = useState('')
  const videoRef = useRef(null)
  const undoStack = useRef([])
  const historyState = useRef(null)
  historyState.current = { clips, tracks, selectedId, playhead }

  const rememberUndo = () => {
    undoStack.current = [...undoStack.current, historyState.current].slice(-10)
    setUndoCount(undoStack.current.length)
  }

  const undo = () => {
    const previous = undoStack.current.pop()
    if (!previous) return
    setUndoCount(undoStack.current.length)
    setClips(previous.clips)
    setTracks(previous.tracks)
    setSelectedId(previous.selectedId)
    setPlayhead(previous.playhead)
    setPlaying(false)
  }

  const loadProject = (project = {}) => {
    setClips(normalizeClips(project.clips || []))
    setTracks(Array.isArray(project.tracks) && project.tracks.length ? project.tracks : DEFAULT_TRACKS)
    setSelectedId(null)
    setPlayhead(0)
    setPlaying(false)
    undoStack.current = []
    setUndoCount(0)
  }

  const selected = clips.find((clip) => clip.id === selectedId) || null
  const totalDuration = clips.reduce((end, clip) => Math.max(end, clip.timelineStart + Math.max(0, clip.end - clip.start)), 0)
  const activeInfo = useMemo(() => {
    const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
    const clip = sorted.find((item) => playhead >= item.timelineStart && playhead < item.timelineStart + (item.end - item.start))
      || (playhead >= totalDuration && sorted.at(-1))
    if (!clip) return null
    const duration = Math.max(0, clip.end - clip.start)
    return { clip, timelineStart: clip.timelineStart, sourceTime: clip.start + Math.max(0, Math.min(duration, playhead - clip.timelineStart)) }
  }, [clips, playhead, totalDuration])

  useEffect(() => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(clips.filter((clip) => !clip.temporary)))
  }, [clips])

  useEffect(() => { localStorage.setItem(TRACKS_KEY, JSON.stringify(tracks)) }, [tracks])

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
    rememberUndo()
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
      trackId: tracks.find((track) => track.type === 'video')?.id,
    }
    setClips((items) => {
      const timelineStart = items.reduce((end, item) => Math.max(end, item.timelineStart + item.end - item.start), 0)
      return [...items, { ...clip, timelineStart }]
    })
    setSelectedId(id)
  }

  const addLocalFiles = async (files) => {
    const imports = Array.from(files || []).filter((file) => file.type.startsWith('video/') || file.type.startsWith('image/'))
    if (!imports.length) return
    try {
      const newClips = await Promise.all(imports.map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const response = await axios.post('/api/editing-media/upload', formData)
        const type = response.data.type
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          assetId: response.data.asset_id,
          name: file.name,
          src: response.data.url,
          type,
          start: 0,
          end: type === 'image' ? 5 : 10,
          sourceDuration: type === 'image' ? 5 : 10,
          grade: { brightness: 100, contrast: 100, saturation: 100 },
          trackId: historyState.current.tracks.find((track) => track.type === 'video')?.id,
        }
      }))
      rememberUndo()
      setClips((items) => {
        let timelineStart = items.reduce((end, item) => Math.max(end, item.timelineStart + item.end - item.start), 0)
        return [...items, ...newClips.map((clip) => {
          const placed = { ...clip, timelineStart }
          timelineStart += clip.end - clip.start
          return placed
        })]
      })
      setSelectedId(newClips.at(-1).id)
    } catch (error) {
      alert(`导入素材失败：${error.response?.data?.detail || error.message || String(error)}`)
    }
  }

  const updateClip = (id, patch, recordUndo = true) => {
    if (recordUndo) rememberUndo()
    setClips((items) => items.map((clip) => clip.id === id ? { ...clip, ...patch } : clip))
  }

  const selectClip = (id) => setSelectedId(id)

  const removeSelected = () => {
    if (!selected) return
    rememberUndo()
    const index = clips.findIndex((clip) => clip.id === selected.id)
    setClips((items) => items.filter((clip) => clip.id !== selected.id))
    setSelectedId(clips[index + 1]?.id || clips[index - 1]?.id || null)
  }

  const splitSelected = () => {
    if (!selected || selected.type !== 'video') return
    const index = clips.findIndex((clip) => clip.id === selected.id)
    const offset = playhead - selected.timelineStart
    const cutAt = selected.start + offset
    if (cutAt <= selected.start + 0.15 || cutAt >= selected.end - 0.15) return
    rememberUndo()
    const left = { ...selected, id: `${selected.id}-a-${Date.now()}`, end: cutAt, name: `${selected.name} · A` }
    const right = { ...selected, id: `${selected.id}-b-${Date.now()}`, start: cutAt, timelineStart: playhead, name: `${selected.name} · B` }
    setClips((items) => [...items.slice(0, index), left, right, ...items.slice(index + 1)])
    setSelectedId(right.id)
  }

  const moveClip = (sourceId, trackId, requestedStart) => {
    rememberUndo()
    setClips((items) => {
      const moving = items.find((clip) => clip.id === sourceId)
      if (!moving) return items
      const duration = moving.end - moving.start
      const others = items.filter((clip) => clip.id !== sourceId && (clip.trackId || 'video-1') === trackId)
      let desiredStart = Math.max(0, Number(requestedStart) || 0)
      const collision = others.find((clip) => desiredStart < clip.timelineStart + clip.end - clip.start && desiredStart + duration > clip.timelineStart)
      if (collision) {
        const midpoint = collision.timelineStart + (collision.end - collision.start) / 2
        desiredStart = desiredStart < midpoint
          ? Math.max(0, collision.timelineStart - duration)
          : collision.timelineStart + collision.end - collision.start
      }
      const candidates = [desiredStart]
      others.forEach((clip) => {
        candidates.push(Math.max(0, clip.timelineStart - duration))
        candidates.push(clip.timelineStart + clip.end - clip.start)
      })
      candidates.sort((a, b) => Math.abs(a - desiredStart) - Math.abs(b - desiredStart))
      const start = candidates.find((candidate) => others.every((clip) => candidate + duration <= clip.timelineStart + 0.01 || candidate >= clip.timelineStart + clip.end - clip.start - 0.01))
        ?? Math.max(0, ...others.map((clip) => clip.timelineStart + clip.end - clip.start))
      return items.map((clip) => clip.id === sourceId ? { ...clip, trackId, timelineStart: start } : clip)
    })
  }

  const addTrack = (type, relativeId) => {
    rememberUndo()
    setTracks((items) => {
    const count = items.filter((track) => track.type === type).length + 1
    const next = [...items]
    const relativeIndex = next.findIndex((track) => track.id === relativeId)
    const insertAt = relativeIndex >= 0 ? relativeIndex + (type === 'video' ? 0 : 1) : next.findIndex((track) => track.type === type) + 1
    next.splice(Math.max(0, insertAt), 0, { id: `${type}-${Date.now()}`, type, name: `${type === 'video' ? '视频' : '音频'} ${count}` })
    return [...next.filter((track) => track.type === 'video'), ...next.filter((track) => track.type === 'audio')]
    })
  }

  const removeTrack = (trackId) => {
    const track = tracks.find((item) => item.id === trackId)
    if (!track || tracks.filter((item) => item.type === track.type).length <= 1) return
    rememberUndo()
    const remainingTracks = tracks.filter((item) => item.id !== trackId)
    const replacement = remainingTracks.find((item) => item.type === track.type)
    setTracks(remainingTracks)
    if (track.type === 'video') {
      setClips((items) => items.map((clip) => (clip.trackId || 'video-1') === trackId ? { ...clip, trackId: replacement.id } : clip))
    }
  }

  const handleMetadata = (event) => {
    if (!activeInfo?.clip || !Number.isFinite(event.currentTarget.duration)) return
    const clip = activeInfo.clip
    if (clip.sourceDuration === 10 && clip.end === 10) {
      updateClip(clip.id, { sourceDuration: event.currentTarget.duration, end: event.currentTarget.duration }, false)
    }
  }

  const onVideoEnded = () => {
    // The master clock owns timeline progression; native video ending must not
    // jump the playhead past clips or gaps.
  }

  const onVideoTime = (event) => {
    // The master playback clock below advances across clips and image holds;
    // this handler is retained for the preview element's media event binding.
    if (!playing || !activeInfo) return
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || activeInfo?.clip?.type !== 'video') return
    const targetTime = Math.min(activeInfo.sourceTime, Math.max(0, video.duration - 0.05 || activeInfo.sourceTime))
    const seekThreshold = playing ? 0.35 : 0.015
    if (Math.abs(video.currentTime - targetTime) > seekThreshold) video.currentTime = targetTime
    if (playing) video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [activeInfo?.clip?.id, activeInfo?.sourceTime, playing])

  useEffect(() => {
    if (!playing || totalDuration <= 0) return undefined
    const timer = window.setInterval(() => {
      setPlayhead((time) => {
        const next = time + 0.04
        if (next >= totalDuration) {
          window.clearInterval(timer)
          setPlaying(false)
          return 0
        }
        return next
      })
    }, 40)
    return () => window.clearInterval(timer)
  }, [playing, totalDuration])

  return {
    library, clips, setClips, tracks, addTrack, removeTrack, selected, selectedId, playhead, setPlayhead, playing, setPlaying,
    libraryError, videoRef, activeInfo, totalDuration, loadLibrary, addAsset,
    addLocalFiles, updateClip, selectClip, removeSelected, splitSelected, moveClip, undo, canUndo: undoCount > 0, loadProject,
    handleMetadata, onVideoTime, onVideoEnded,
  }
}
