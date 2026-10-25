import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

const PROJECT_KEY = 'ai-image-video-generator:editing-studio:v1'
const TRACKS_KEY = 'ai-image-video-generator:editing-studio:tracks:v1'

function readSavedClips() {
  try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]') } catch { return [] }
}

function readSavedTracks() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRACKS_KEY) || 'null')
    return Array.isArray(saved) && saved.some((track) => track.type === 'video')
      ? [...saved.filter((track) => track.type === 'video'), ...saved.filter((track) => track.type === 'audio')]
      : [{ id: 'video-1', type: 'video', name: '视频 1' }, { id: 'audio-1', type: 'audio', name: '音频 1' }]
  } catch { return [{ id: 'video-1', type: 'video', name: '视频 1' }, { id: 'audio-1', type: 'audio', name: '音频 1' }] }
}

export function useEditingTimeline() {
  const [library, setLibrary] = useState([])
  const [clips, setClips] = useState(readSavedClips)
  const [selectedId, setSelectedId] = useState(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tracks, setTracks] = useState(readSavedTracks)
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
        trackId: tracks.find((track) => track.type === 'video')?.id,
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

  const moveClipToTrack = (trackId) => {
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId) return
    setClips((items) => items.map((clip) => clip.id === sourceId ? { ...clip, trackId } : clip))
  }

  const addTrack = (type, relativeId) => setTracks((items) => {
    const count = items.filter((track) => track.type === type).length + 1
    const next = [...items]
    const relativeIndex = next.findIndex((track) => track.id === relativeId)
    const insertAt = relativeIndex >= 0 ? relativeIndex + (type === 'video' ? 0 : 1) : next.findIndex((track) => track.type === type) + 1
    next.splice(Math.max(0, insertAt), 0, { id: `${type}-${Date.now()}`, type, name: `${type === 'video' ? '视频' : '音频'} ${count}` })
    return [...next.filter((track) => track.type === 'video'), ...next.filter((track) => track.type === 'audio')]
  })

  const removeTrack = (trackId) => {
    const track = tracks.find((item) => item.id === trackId)
    if (!track || tracks.filter((item) => item.type === track.type).length <= 1) return
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
    library, clips, setClips, tracks, addTrack, removeTrack, moveClipToTrack, selected, selectedId, playhead, setPlayhead, playing, setPlaying,
    libraryError, videoRef, dragId, activeInfo, totalDuration, loadLibrary, addAsset,
    addLocalFiles, updateClip, seekToClip, removeSelected, splitSelected, moveClip,
    handleMetadata, onVideoTime, onVideoEnded,
  }
}
