import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import FreeCanvas from './components/FreeCanvas'
import ProjectManagement from './components/ProjectManagement'
import './styles/Canvas.css'

/**
 * 顶部页签导航
 */
function TabNav() {
  return (
    <nav className="app-tabnav">
      <NavLink to="/free_canvas" className={({ isActive }) => `app-tab ${isActive ? 'active' : ''}`}>
        自由画布
      </NavLink>
      <NavLink to="/project_management" className={({ isActive }) => `app-tab ${isActive ? 'active' : ''}`}>
        镜头表管理
      </NavLink>
      <div style={{ flex: 1 }} />
      <div className="app-tab-title">AI 图片视频生成器</div>
    </nav>
  )
}

/**
 * 布局壳子：顶部页签 + 路由出口
 */
function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <TabNav />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Routes>
          <Route path="/" element={<FreeCanvas />} />
          <Route path="/free_canvas" element={<FreeCanvas />} />
          <Route path="/project_management" element={<ProjectManagement />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  )
}
