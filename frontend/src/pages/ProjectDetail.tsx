import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import type { ImageSummary, Project } from '../types';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get(`/projects/${id}`);
    setProject(res.data);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      const form = new FormData();
      form.append('file', files[i]);
      await api.post(`/projects/${id}/images/`, form);
    }
    setUploading(false);
    load();
  };

  const handleReport = async () => {
    const res = await api.post(`/projects/${id}/report/`, null, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ?? 'report'}_测温报告.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!project) return <div style={{ padding: 20 }}>Loading...</div>;

  const images: ImageSummary[] = project.images ?? [];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
      <p><a href="/" style={{ color: '#2563eb' }}>← 返回项目列表</a></p>
      <h1>{project.name}</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <label style={{
          padding: '8px 16px', background: '#2563eb', color: '#fff',
          borderRadius: 4, cursor: 'pointer',
        }}>
          {uploading ? '上传中...' : '上传图片 (JPG/ZIP)'}
          <input type="file" accept=".jpg,.jpeg,.zip" multiple
            onChange={handleUpload} style={{ display: 'none' }}
            disabled={uploading}
          />
        </label>
        {images.length > 0 && (
          <button onClick={handleReport}
            style={{ padding: '8px 16px', background: '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            生成报告 (.docx)
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {images.map(img => (
          <div key={img.id}
            onClick={() => navigate(`/project/${id}/image/${img.id}`)}
            style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
            <img src={img.preview_url} alt={img.filename}
              style={{ width: '100%', height: 200, objectFit: 'cover' }} />
            <div style={{ padding: 10 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{img.filename}</div>
              <div style={{ fontSize: 13, color: '#666' }}>
                {img.area && `${img.area} · `}{img.equipment && `${img.equipment} · `}{img.date}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 12, fontSize: 13 }}>
                <span style={{ color: '#dc2626' }}>最高: {img.t_max?.toFixed(1)}°C</span>
                <span style={{ color: '#2563eb' }}>最低: {img.t_min?.toFixed(1)}°C</span>
                <span>平均: {img.t_mean?.toFixed(1)}°C</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
