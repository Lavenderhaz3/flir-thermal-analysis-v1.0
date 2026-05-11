import { useState, useEffect } from 'react';
import api from '../api/client';
import type { Project } from '../types';

const MODEL_OPTIONS = [
  { value: 'none', label: '无（人工标注）' },
  { value: 'transformer', label: '变压器' },
  { value: 'switchgear', label: '开关柜' },
  { value: 'cable', label: '电缆接头' },
  { value: 'busbar', label: '母线' },
  { value: 'insulator', label: '绝缘子' },
];

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [modelType, setModelType] = useState('none');
  const [template, setTemplate] = useState<File | null>(null);

  const load = async () => {
    const res = await api.get('/projects/');
    setProjects(res.data);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    const form = new FormData();
    form.append('name', name.trim());
    form.append('model_type', modelType);
    if (template) form.append('template', template);

    await api.post('/projects/', form);
    setName('');
    setModelType('none');
    setTemplate(null);
    setShowCreate(false);
    load();
  };

  const deleteProject = async (id: number, projectName: string) => {
    if (!confirm(`确认删除项目「${projectName}」？\n此操作不可撤销，所有图片和标注将永久删除。`)) return;
    await api.delete(`/projects/${id}`);
    load();
  };

  const modelLabel = (v: string) => MODEL_OPTIONS.find(m => m.value === v)?.label || v;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>FLIR 红外测温分析系统</h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 15 }}
        >
          + 创建项目
        </button>
      </div>

      {/* ── Create Project Modal ─────────────────────────────── */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h2 style={{ marginTop: 0 }}>创建项目</h2>

            <label style={{ display: 'block', marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>项目名称</div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="例如：2025-05-主变区巡检"
                style={{ width: '100%', padding: 8, boxSizing: 'border-box', borderRadius: 4, border: '1px solid #ccc' }}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && create()}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>设备识别模型</div>
              <select
                value={modelType}
                onChange={e => setModelType(e.target.value)}
                style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
              >
                {MODEL_OPTIONS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'block', marginBottom: 20 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Word 报告模板（可选）</div>
              <input
                type="file"
                accept=".docx"
                onChange={e => setTemplate(e.target.files?.[0] || null)}
                style={{ width: '100%' }}
              />
              {template && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  已选择: {template.name}
                </div>
              )}
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreate(false)}
                style={{ padding: '8px 20px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={create}
                disabled={!name.trim()}
                style={{
                  padding: '8px 24px', background: name.trim() ? '#2563eb' : '#93c5fd',
                  color: '#fff', border: 'none', borderRadius: 4, cursor: name.trim() ? 'pointer' : 'default',
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── End Modal ────────────────────────────────────────── */}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: 8 }}>ID</th>
            <th style={{ padding: 8 }}>项目名称</th>
            <th style={{ padding: 8 }}>识别模型</th>
            <th style={{ padding: 8 }}>图片数</th>
            <th style={{ padding: 8 }}>创建时间</th>
            <th style={{ padding: 8, width: 50 }}></th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{p.id}</td>
              <td style={{ padding: 8 }}>
                <a href={`/project/${p.id}`} style={{ color: '#2563eb', fontWeight: 500 }}>
                  {p.name}
                </a>
              </td>
              <td style={{ padding: 8, fontSize: 13, color: '#666' }}>
                {modelLabel(p.model_type || 'none')}
              </td>
              <td style={{ padding: 8 }}>{p.image_count ?? 0}</td>
              <td style={{ padding: 8, fontSize: 13, color: '#888' }}>
                {new Date(p.created_at).toLocaleString()}
              </td>
              <td style={{ padding: 8, textAlign: 'center' }}>
                <button
                  onClick={() => deleteProject(p.id, p.name)}
                  title="删除项目"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#999', fontSize: 16, padding: '2px 6px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#999')}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {projects.length === 0 && (
        <div style={{ textAlign: 'center', color: '#999', marginTop: 60 }}>
          暂无项目，点击「创建项目」开始
        </div>
      )}
    </div>
  );
}
