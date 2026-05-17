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
  const hotImages = images.filter(img => img.t_max != null).sort((a, b) => (b.t_max ?? -Infinity) - (a.t_max ?? -Infinity));
  const hottest = hotImages[0];
  const equipmentCount = new Set(images.map(img => `${img.area || 'unknown'}-${img.equipment || img.filename}`)).size;
  const dateCount = new Set(images.map(img => img.date).filter(Boolean)).size;

  return (
    <div className="app-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow"><a href="/">← 返回主页</a></p>
          <h1 className="page-title">项目内容</h1>
          <p className="subtle" style={{ margin: '8px 0 0', fontWeight: 650 }}>{project.name}</p>
        </div>
        <span className="status-pill">{images.length} 张图谱</span>
      </div>

      <section className="project-overview">
        <div className="stat-tile">
          <span>图谱数量</span>
          <strong>{images.length}</strong>
        </div>
        <div className="stat-tile">
          <span>覆盖设备</span>
          <strong>{images.length > 0 ? equipmentCount : 0}</strong>
        </div>
        <div className="stat-tile">
          <span>巡检日期</span>
          <strong>{dateCount}</strong>
        </div>
        <div className="stat-tile stat-tile--hot">
          <span>最高温</span>
          <strong>{hottest?.t_max != null ? `${hottest.t_max.toFixed(1)}°C` : '--'}</strong>
        </div>
        <div className="project-actions">
          <label className="btn btn-primary">
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
              className="btn btn-success"
            >
              生成报告 (.docx)
            </button>
          )}
        </div>
      </section>

      {/* Report parameter form */}
      {showReportForm && (
        <div className="panel report-form">
          <div className="panel__head">
            <h3 className="panel__title">报告参数</h3>
          </div>
          <div className="panel__body">
          <div style={{ marginBottom: 10 }}>
            <label className="label">
              正常设备温度 (°C) *
            </label>
            <input
              type="number" step="0.1"
              value={normalTemp}
              onChange={e => setNormalTemp(e.target.value)}
              placeholder="例如: 25.0"
              className="field"
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">
              环境温度覆盖 (°C) — 可选，留空则自动使用 FLIR 相机记录值
            </label>
            <input
              type="number" step="0.1"
              value={ambientOverride}
              onChange={e => setAmbientOverride(e.target.value)}
              placeholder="留空 = 自动"
              className="field"
            />
          </div>
          <div className="toolbar">
            <button
              onClick={handleReport}
              disabled={generating}
              className="btn btn-success"
            >
              {generating ? '生成中...' : '确认生成'}
            </button>
            <button
              onClick={() => setShowReportForm(false)}
              className="btn btn-secondary"
            >
              取消
            </button>
          </div>
          <p className="formula-note">
            相对温差 = (最高温 − 正常温度) / (最高温 − 环境温度) × 100%
          </p>
          </div>
        </div>
      )}

      <div className="section-bar">
        <h2 className="panel__title">设备图谱</h2>
        <span className="subtle">点击图片进入测温标注</span>
      </div>

      <div className="image-grid image-grid--inspection">
        {images.map(img => (
          <div key={img.id}
            onClick={() => navigate(`/project/${id}/image/${img.id}`)}
            className="image-card">
            <div className="image-card__media">
              <img src={img.preview_url} alt={img.filename} />
              <span className="image-card__date">{img.date || '未知日期'}</span>
            </div>
            <div className="image-card__body">
              <div className="image-card__title">{img.equipment || img.filename}</div>
              <div className="image-card__meta">
                <span>{img.area || '未知区域'}</span>
                <span>{img.filename}</span>
              </div>
              <div className="metric-row">
                <span className="metric-hot">最高: {img.t_max?.toFixed(1)}°C</span>
                <span className="metric-cool">最低: {img.t_min?.toFixed(1)}°C</span>
                <span>平均: {img.t_mean?.toFixed(1)}°C</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {images.length === 0 && (
        <div className="empty-state">暂无图片，上传 JPG 或 ZIP 后开始分析</div>
      )}
    </div>
  );
}
