import { useRef, useState } from 'react'
import { Film, Image as ImageIcon, Plus, RefreshCw, Upload } from 'lucide-react'

export default function MediaLibraryPanel({ assets, error, onRefresh, onAddAsset, onImportFiles }) {
  const [query, setQuery] = useState('')
  const fileInputRef = useRef(null)
  const matchingAssets = assets.filter((asset) => asset.filename.toLowerCase().includes(query.toLowerCase()))
  const videoAssets = matchingAssets.filter((asset) => asset.type === 'video')
  const imageAssets = matchingAssets.filter((asset) => asset.type !== 'video')

  const renderAssets = (items) => items.map((asset) => (
    <button key={asset.id} className="edit-asset" onClick={() => onAddAsset(asset)} title="添加到时间线">
      <span className="edit-asset-thumb">{asset.type === 'video' ? <video src={asset.url} muted preload="metadata" /> : <img src={asset.url} alt="" />}</span>
      <span className="edit-asset-name">{asset.type === 'video' ? <Film size={13} /> : <ImageIcon size={13} />}{asset.filename}</span>
      <Plus size={14} />
    </button>
  ))

  return (
    <aside className="editing-media-panel">
      <div className="edit-panel-heading"><span>素材库</span><button title="上传本地素材" onClick={() => fileInputRef.current?.click()}><Plus size={16} /></button></div>
      <input ref={fileInputRef} type="file" accept="video/*,image/*" multiple hidden onChange={(event) => { onImportFiles(event.target.files); event.target.value = '' }} />
      <button className="edit-upload-drop" onClick={() => fileInputRef.current?.click()}><Upload size={18} /><span>导入本地图片或视频</span></button>
      <div className="edit-library-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索生成素材" /><button onClick={onRefresh}><RefreshCw size={14} /></button></div>
      {error && <div className="edit-error">{error}</div>}
      <div className="edit-asset-list">
        <section className="edit-asset-section">
          <h3 className="edit-asset-section-title"><Film size={14} />视频 <span>{videoAssets.length}</span></h3>
          {videoAssets.length ? renderAssets(videoAssets) : <p className="edit-category-empty">没有匹配的视频</p>}
        </section>
        <section className="edit-asset-section">
          <h3 className="edit-asset-section-title"><ImageIcon size={14} />图片 <span>{imageAssets.length}</span></h3>
          {imageAssets.length ? renderAssets(imageAssets) : <p className="edit-category-empty">没有匹配的图片</p>}
        </section>
        {!assets.length && !error && <p className="edit-empty">还没有素材。可以从本地导入，生成结果也会自动出现在这里。</p>}
      </div>
    </aside>
  )
}
