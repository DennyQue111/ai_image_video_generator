import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import '../features/free-canvas/styles/Canvas.css'

const FreeCanvas = lazy(() => import('../features/free-canvas/pages/FreeCanvas'))
const ProjectManagement = lazy(() => import('../features/project-management/pages/ProjectManagement'))
const EditingStudio = lazy(() => import('../features/editing-studio/pages/EditingStudio'))

/**
 * 顶部页签导航
 */
function TabNav() {
  return (
    <nav className="app-tabnav">
      <NavLink to="/free_canvas" className={({ isActive }) => `app-tab ${isActive ? 'active' : ''}`}>
        自由画布
      </NavLink>
      <NavLink to="/shot_breakdown" className={({ isActive }) => `app-tab ${isActive ? 'active' : ''}`}>
        镜头表管理
      </NavLink>
      <NavLink to="/editing" className={({ isActive }) => `app-tab ${isActive ? 'active' : ''}`}>
        剪辑台
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
        <Suspense fallback={<div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>正在加载页面…</div>}>
          <Routes>
            <Route path="/" element={<FreeCanvas />} />
            <Route path="/free_canvas" element={<FreeCanvas />} />
            <Route path="/shot_breakdown" element={<ProjectManagement />} />
            <Route path="/editing" element={<EditingStudio />} />
          </Routes>
        </Suspense>
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
