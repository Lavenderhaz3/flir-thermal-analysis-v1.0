import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import AnnotationEditor from './pages/AnnotationEditor';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/project/:projectId/image/:imageId" element={<AnnotationEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
