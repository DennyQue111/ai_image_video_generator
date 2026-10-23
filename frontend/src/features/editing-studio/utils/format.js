export const formatTime = (value) => {
  const safe = Math.max(0, Number(value) || 0)
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toFixed(1).padStart(4, '0')}`
}

export const gradeFilter = (grade = {}) =>
  `brightness(${grade.brightness ?? 100}%) contrast(${grade.contrast ?? 100}%) saturate(${grade.saturation ?? 100}%)`
