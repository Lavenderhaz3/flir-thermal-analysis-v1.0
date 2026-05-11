import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import type { ImageSummary, Project } from '../types';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [normalTemp, setNormalTemp] = useState('');
  const [ambientOverride, setAmbientOverride] = useState('');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get(`/projects/${id}`);
    setProject(res.data);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    let errors = 0;
    for (let i = 0; i < files.length; i++) {
      const form = new FormData();
      form.append('file', files[i]);
      try {
        await api.post(`/projects/${id}/images/`, form);
      } catch (err) {
        errors++;
        console.error(`Upload failed: ${files[i].name}`, err);
      }
    }
    setUploading(false);
    // Reset input so the same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (errors > 0) {
      alert(`${errors}/${files.length} 个文件上传失败，请检查文件是否为 FLIR 红外 JPEG 格式`);
    }
    load();
  };

  const handleReport = async () => {
    const normal = parseFloat(normalTemp);
    if (isNaN(normal)) {
      alert('请输入有效的正常设备温度');
      return;
    }
    setGenerating(true);
    try {
      const body: Record<string, unknown> = { normal_temp: normal };
      const ambOverride = parseFloat(ambientOverride);
      if (!isNaN(ambOverride)) {
        body.ambient_temp_override = ambOverride;
      }
      const res = await api.post(`/projects/${id}/report/`, body, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name ?? 'report'}_测温报告.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setShowReportForm(false);
    } catch (err) {
      console.error('Report generation failed', err);
      alert('报告生成失败，请检查后端是否正常运行');
    } finally {
      setGenerating(false);
    }
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
            ref={fileInputRef}
            onChange={handleUpload} style={{ display: 'none' }}
            disabled={uploading}
          />
        </label>
        {images.length > 0 && (
          <button
            onClick={() => setShowReportForm(!showReportForm)}
            style={{ padding: '8px 16px', background: '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            生成报告 (.docx)
          </button>
        )}
      </div>

      {/* Report parameter form */}
      {showReportForm && (
        <div style={{
          marginBottom: 20, padding: 16,
          border: '1px solid #d1d5db', borderRadius: 8,
          background: '#f9fafb', maxWidth: 400,
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 15 }}>报告参数</h3>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#374151' }}>
              正常设备温度 (°C) *
            </label>
            <input
              type="number" step="0.1"
              value={normalTemp}
              onChange={e => setNormalTemp(e.target.value)}
              placeholder="例如: 25.0"
              style={{
                width: '100%', padding: '6px 10px',
                border: '1px solid #d1d5db', borderRadius: 4,
                fontSize: 14, boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#6b7280' }}>
              环境温度覆盖 (°C) — 可选，留空则自动使用 FLIR 相机记录值
            </label>
            <input
              type="number" step="0.1"
              value={ambientOverride}
              onChange={e => setAmbientOverride(e.target.value)}
              placeholder="留空 = 自动"
              style={{
                width: '100%', padding: '6px 10px',
                border: '1px solid #d1d5db', borderRadius: 4,
                fontSize: 14, boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleReport}
              disabled={generating}
              style={{
                padding: '6px 16px', background: '#059669', color: '#fff',
                border: 'none', borderRadius: 4, cursor: generating ? 'wait' : 'pointer',
                fontSize: 14,
              }}
            >
              {generating ? '生成中...' : '确认生成'}
            </button>
            <button
              onClick={() => setShowReportForm(false)}
              style={{
                padding: '6px 16px', background: '#e5e7eb', color: '#374151',
                border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
              }}
            >
              取消
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 10, marginBottom: 0 }}>
            相对温差 = (最高温 − 正常温度) / (最高温 − 环境温度) × 100%
          </p>
        </div>
      )}

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
