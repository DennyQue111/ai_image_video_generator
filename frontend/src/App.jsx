import { useState } from 'react'
import { Image, Video, Sparkles } from 'lucide-react'
import TextToImage from './components/TextToImage'
import ImageToImage from './components/ImageToImage'
import ImageToVideo from './components/ImageToVideo'
import './styles/App.css'

const TABS = [
  { id: 'text-to-image', label: '文生图', icon: Image },
  { id: 'image-to-image', label: '图生图', icon: Image },
  { id: 'image-to-video', label: '图生视频', icon: Video },
]

function App() {
  const [activeTab, setActiveTab] = useState('text-to-image')

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-content">
          <div className="app-logo">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="app-title">AI 图片视频生成器</h1>
            <p className="app-subtitle">文生图 · 图生图 · 图生视频</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="nav-tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {activeTab === 'text-to-image' && <TextToImage />}
        {activeTab === 'image-to-image' && <ImageToImage />}
        {activeTab === 'image-to-video' && <ImageToVideo />}
      </main>

      <footer className="app-footer">
        <p>ComfyUI + Gemini 双后端 · 简化版生成工具</p>
      </footer>
    </div>
  )
}

export default App
