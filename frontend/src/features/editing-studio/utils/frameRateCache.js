import axios from 'axios'

const requests = new Map()

export function getSourceFrameRate(assetId) {
  if (!assetId) return Promise.resolve(null)
  if (!requests.has(assetId)) {
    requests.set(assetId, axios.get('/api/editing-media/frame-rate', { params: { asset_id: assetId } })
      .then((response) => Number(response.data.fps) > 0 ? Number(response.data.fps) : null)
      .catch(() => null))
  }
  return requests.get(assetId)
}
