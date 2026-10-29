export const formatTime = (value) => {
  const safe = Math.max(0, Number(value) || 0)
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toFixed(1).padStart(4, '0')}`
}

export const formatTimecode = (value, fps = 24) => {
  const safeFps = Math.max(1, Math.round(Number(fps) || 24))
  const safe = Math.max(0, Number(value) || 0)
  const totalFrames = Math.floor(safe * safeFps + 1e-6)
  const frame = totalFrames % safeFps
  const totalSeconds = Math.floor(totalFrames / safeFps)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frame).padStart(2, '0')}`
}

export const gradeFilter = (grade = {}) =>
  `brightness(${grade.brightness ?? 100}%) contrast(${grade.contrast ?? 100}%) saturate(${grade.saturation ?? 100}%)`
