import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const PROJECT_KEY = 'ai-image-video-generator:editing-studio:v1'
const TRACKS_KEY = 'ai-image-video-generator:editing-studio:tracks:v1'
const FPS_KEY = 'ai-image-video-generator:editing-studio:fps:v1'
const DEFAULT_TRACKS = [{ id: 'video-1', type: 'video', name: '视频 1' }, { id: 'audio-1', type: 'audio', name: '音频 1' }]

function normalizeClips(clips = [], tracks = DEFAULT_TRACKS) {
  let cursor = 0
  const normalized = clips.map((clip) => {
    const timelineStart = Number.isFinite(clip.timelineStart) ? clip.timelineStart : cursor
    cursor = Math.max(cursor, timelineStart + Math.max(0, clip.end - clip.start))
    const normalized = { ...clip, timelineStart }
    if (normalized.type === 'audio' && !normalized.linkedClipId && normalized.parentClipId) normalized.linkedClipId = normalized.parentClipId
    return normalized
  })
  const audioTrack = tracks.find((track) => track.type === 'audio')
  const linkedIds = new Set(normalized.map((clip) => clip.linkedClipId))
  return [...normalized, ...normalized.filter((clip) => clip.type === 'video' && !linkedIds.has(clip.id)).map((clip) => ({
    ...clip, id: `${clip.id}-audio`, type: 'audio', trackId: audioTrack?.id || 'audio-1', linkedClipId: clip.id,
    name: `${clip.name} · 音频`, grade: undefined,
  }))]
}

function readSavedClips() {
  try { return normalizeClips(JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]'), readSavedTracks()) } catch { return [] }
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
  const [frameRate, setFrameRate] = useState(() => {
    const saved = Number(localStorage.getItem(FPS_KEY))
    return saved > 0 ? saved : null
  })
  const [undoCount, setUndoCount] = useState(0)
  const [libraryError, setLibraryError] = useState('')
  const videoRef = useRef(null)
  const undoStack = useRef([])
  const historyState = useRef(null)
  historyState.current = { clips, tracks, selectedId, playhead, frameRate }

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
    setFrameRate(previous.frameRate)
    setPlaying(false)
  }

  const loadProject = (project = {}) => {
    const nextTracks = Array.isArray(project.tracks) && project.tracks.length ? project.tracks : DEFAULT_TRACKS
    setClips(normalizeClips(project.clips || [], nextTracks))
    setTracks(nextTracks)
    setFrameRate(Number(project.frame_rate) > 0 ? Number(project.frame_rate) : null)
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
  useEffect(() => {
    if (frameRate) localStorage.setItem(FPS_KEY, String(frameRate))
    else localStorage.removeItem(FPS_KEY)
  }, [frameRate])

  const setProjectFrameRate = (value) => {
    const next = Math.max(1, Math.min(120, Number(value) || 24))
    rememberUndo()
    setFrameRate(next)
    return next
  }

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
    const timelineStart = clips.reduce((end, item) => Math.max(end, item.timelineStart + item.end - item.start), 0)
    const videoTrackId = tracks.find((track) => track.type === 'video')?.id
    const audioTrackId = tracks.find((track) => track.type === 'audio')?.id
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
      trackId: videoTrackId,
      timelineStart,
    }
    const linkedAudio = !isImage ? { ...clip, id: `${id}-audio`, type: 'audio', trackId: audioTrackId, linkedClipId: id, name: `${asset.filename} · 音频`, grade: undefined } : null
    setClips((items) => [...items, clip, ...(linkedAudio ? [linkedAudio] : [])])
    if (!frameRate && asset.type === 'video' && asset.id) {
      axios.get('/api/editing-media/frame-rate', { params: { asset_id: asset.id } })
        .then((response) => { if (Number(response.data.fps) > 0) setFrameRate(Number(response.data.fps)) })
        .catch(() => {})
    }
    setSelectedId(id)
  }

  const addLocalFiles = async (files) => {
    const imports = Array.from(files || []).filter((file) => file.type.startsWith('video/') || file.type.startsWith('image/'))
    if (!imports.length) return
    try {
      const importedClips = await Promise.all(imports.map(async (file) => {
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
      const newClips = []
      setClips((items) => {
        let timelineStart = items.reduce((end, item) => Math.max(end, item.timelineStart + item.end - item.start), 0)
        importedClips.forEach((clip) => {
          const placed = { ...clip, timelineStart }
          newClips.push(placed)
          timelineStart += clip.end - clip.start
          if (clip.type === 'video') newClips.push({ ...placed, id: `${clip.id}-audio`, type: 'audio', trackId: historyState.current.tracks.find((track) => track.type === 'audio')?.id, linkedClipId: clip.id, name: `${clip.name} · 音频`, grade: undefined })
        })
        return [...items, ...newClips]
      })
      const firstVideo = importedClips.find((clip) => clip.type === 'video')
      if (!frameRate && firstVideo?.assetId) {
        axios.get('/api/editing-media/frame-rate', { params: { asset_id: firstVideo.assetId } })
          .then((response) => { if (Number(response.data.fps) > 0) setFrameRate(Number(response.data.fps)) })
          .catch(() => {})
      }
      setSelectedId(importedClips.at(-1).id)
    } catch (error) {
      alert(`导入素材失败：${error.response?.data?.detail || error.message || String(error)}`)
    }
  }

  const updateClip = (id, patch, recordUndo = true) => {
    if (recordUndo) rememberUndo()
    setClips((items) => {
      const target = items.find((clip) => clip.id === id)
      const linkedId = target?.type === 'audio' ? target.linkedClipId : target?.id
      return items.map((clip) => {
        if (clip.id === id) return { ...clip, ...patch }
        if (linkedId && clip.linkedClipId === linkedId && ('start' in patch || 'end' in patch || 'timelineStart' in patch)) return { ...clip, ...Object.fromEntries(['start', 'end', 'timelineStart'].filter((key) => key in patch).map((key) => [key, patch[key]])) }
        return clip
      })
    })
  }

  const selectClip = (id) => setSelectedId(id)

  const trimClip = (id, edge, requestedDelta) => {
    const clip = clips.find((item) => item.id === id)
    if (!clip) return
    const frame = 1 / (frameRate || 24)
    const delta = Math.round(requestedDelta / frame) * frame
    const linkedId = clip.type === 'audio' ? clip.linkedClipId : clip.id
    const pair = clips.filter((item) => item.id === linkedId || item.linkedClipId === linkedId)
    const minStart = Math.max(0, ...pair.map((item) => item.start - item.timelineStart))
    const nextStart = edge === 'left' ? Math.max(0, clip.start + Math.max(-clip.timelineStart, -clip.start, -minStart, delta)) : clip.start
    const appliedDelta = nextStart - clip.start
    const maxSource = Math.min(...pair.map((item) => Number.isFinite(item.sourceDuration) ? item.sourceDuration : item.end))
    const nextEnd = edge === 'right' ? Math.max(clip.start + frame, Math.min(maxSource, clip.end + delta)) : clip.end
    if (edge === 'left' && (Math.abs(appliedDelta) < frame / 2 || nextStart >= clip.end - frame)) return
    if (edge === 'right' && Math.abs(nextEnd - clip.end) < frame / 2) return
    rememberUndo()
    setClips((items) => items.map((item) => {
      if (item.id !== linkedId && item.linkedClipId !== linkedId) return item
      return edge === 'left'
        ? { ...item, start: item.start + appliedDelta, timelineStart: item.timelineStart + appliedDelta }
        : { ...item, end: nextEnd }
    }))
  }

  const removeSelected = () => {
    if (!selected) return
    rememberUndo()
    const index = clips.findIndex((clip) => clip.id === selected.id)
    const linkedId = selected.type === 'audio' ? selected.linkedClipId : selected.id
    const removeIds = selected.type === 'audio' ? new Set([selected.id, linkedId]) : new Set([selected.id, ...clips.filter((clip) => clip.linkedClipId === linkedId).map((clip) => clip.id)])
    setClips((items) => items.filter((clip) => !removeIds.has(clip.id)))
    const remaining = clips.filter((clip) => !removeIds.has(clip.id))
    setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id || null)
  }

  const splitSelected = () => {
    const videoSelected = selected?.type === 'audio' ? clips.find((clip) => clip.id === selected.linkedClipId) : selected
    if (!videoSelected || videoSelected.type !== 'video') return
    const source = videoSelected
    const index = clips.findIndex((clip) => clip.id === source.id)
    const offset = playhead - source.timelineStart
    const cutAt = source.start + offset
    if (cutAt <= source.start + 0.15 || cutAt >= source.end - 0.15) return
    rememberUndo()
    const audio = clips.find((clip) => clip.linkedClipId === source.id)
    const leftId = `${source.id}-a-${Date.now()}`, rightId = `${source.id}-b-${Date.now()}`
    const left = { ...source, id: leftId, end: cutAt, name: `${source.name} · A` }
    const right = { ...source, id: rightId, start: cutAt, timelineStart: playhead, name: `${source.name} · B` }
    const leftAudio = audio ? { ...audio, id: `${leftId}-audio`, linkedClipId: leftId, end: cutAt, name: `${audio.name} · A` } : null
    const rightAudio = audio ? { ...audio, id: `${rightId}-audio`, linkedClipId: rightId, start: cutAt, timelineStart: playhead, name: `${audio.name} · B` } : null
    const related = [left, ...(leftAudio ? [leftAudio] : []), right, ...(rightAudio ? [rightAudio] : [])]
    setClips((items) => [...items.filter((clip) => clip.id !== source.id && clip.linkedClipId !== source.id), ...related])
    setSelectedId(right.id)
  }

  const moveClip = (sourceId, trackId, requestedStart) => {
    rememberUndo()
    setClips((items) => {
      const selectedMoving = items.find((clip) => clip.id === sourceId)
      const moving = selectedMoving?.type === 'audio' ? items.find((clip) => clip.id === selectedMoving.linkedClipId) || selectedMoving : selectedMoving
      if (!moving) return items
      const duration = moving.end - moving.start
      const movingIds = new Set([moving.id, ...items.filter((clip) => clip.linkedClipId === moving.id).map((clip) => clip.id)])
      const otherTrackId = selectedMoving?.trackId || (selectedMoving?.type === 'audio' ? 'audio-1' : 'video-1')
      const actualTrackId = trackId
      const others = items.filter((clip) => !movingIds.has(clip.id) && (clip.trackId || (clip.type === 'audio' ? 'audio-1' : 'video-1')) === otherTrackId)
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
      return items.map((clip) => {
        if (clip.id === sourceId) return { ...clip, timelineStart: start, trackId: actualTrackId }
        return movingIds.has(clip.id) ? { ...clip, timelineStart: start } : clip
      })
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
    setClips((items) => items.map((clip) => (clip.trackId || (clip.type === 'audio' ? 'audio-1' : 'video-1')) === trackId ? { ...clip, trackId: replacement.id } : clip))
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
    library, clips, setClips, tracks, addTrack, removeTrack, selected, selectedId, playhead, setPlayhead, playing, setPlaying, frameRate, setProjectFrameRate,
    libraryError, videoRef, activeInfo, totalDuration, loadLibrary, addAsset,
    addLocalFiles, updateClip, selectClip, removeSelected, splitSelected, moveClip, trimClip, undo, canUndo: undoCount > 0, loadProject,
    handleMetadata, onVideoTime, onVideoEnded,
  }
}
