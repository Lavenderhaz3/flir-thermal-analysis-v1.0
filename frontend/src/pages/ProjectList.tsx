import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';
import type { Project, EquipmentTrend } from '../types';
import TrendChart from '../components/TrendChart';

const MODEL_OPTIONS = [
  { value: 'none', label: '无（人工标注）' },
  { value: 'transformer', label: '变压器' },
  { value: 'switchgear', label: '开关柜' },
  { value: 'cable', label: '电缆接头' },
  { value: 'busbar', label: '母线' },
  { value: 'insulator', label: '绝缘子' },
];

interface EquipItem { area: string; name: string; count: number; }

export default function ProjectList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [modelType, setModelType] = useState('none');
  const [template, setTemplate] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Equipment history search ──────────────────────────
  const [areaList, setAreaList] = useState<string[]>([]);
  const [equipList, setEquipList] = useState<EquipItem[]>([]);
  const [searchArea, setSearchArea] = useState('');
  const [searchName, setSearchName] = useState('');
  const [trendData, setTrendData] = useState<EquipmentTrend | null>(null);
  const [searching, setSearching] = useState(false);
  const [tracked, setTracked] = useState<EquipItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('tracked') || '[]'); } catch { return []; }
  });

  const toggleTrack = (area: string, name: string) => {
    setTracked(prev => {
      const exists = prev.find(t => t.area === area && t.name === name);
      const next = exists ? prev.filter(t => !(t.area === area && t.name === name))
                          : [...prev, { area, name, count: 0 }];
      localStorage.setItem('tracked', JSON.stringify(next));
      return next;
    });
  };

  const isTracked = (area: string, name: string) =>
    tracked.some(t => t.area === area && t.name === name);

  const load = async () => {
    const res = await api.get('/projects/');
    setProjects(res.data);
  };

  const loadEquipList = async () => {
    try {
      const [areasRes, listRes] = await Promise.all([
        api.get('/equipment/areas'),
        api.get('/equipment/list'),
      ]);
      setAreaList(areasRes.data);
      setEquipList(listRes.data);
    } catch { /* no data yet */ }
  };

  useEffect(() => { load(); loadEquipList(); }, [location.pathname]);

  const areas = areaList;
  const namesForArea = equipList
    .filter(e => e.area === searchArea)
    .map(e => e.name)
    .sort();

  const handleSearch = async () => {
    if (!searchArea || !searchName) return;
    setSearching(true);
    try {
      const res = await api.get('/equipment/trend', {
        params: { name: searchName, area: searchArea },
      });
      setTrendData(res.data);
    } catch {
      setTrendData(null);
      alert('未找到该设备的历史数据');
    } finally {
      setSearching(false);
    }
  };

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
    loadEquipList();
  };

  const deleteProject = async (id: number, projectName: string) => {
    if (!confirm(`确认删除项目「${projectName}」？\n此操作不可撤销，所有图片和标注将永久删除。`)) return;
    await api.delete(`/projects/${id}`);
    load();
    loadEquipList();
  };

  const modelLabel = (v: string) => MODEL_OPTIONS.find(m => m.value === v)?.label || v;

  const filteredProjects = projects
    .filter(p => !searchQuery || p.name.includes(searchQuery))
    .slice(0, 20);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>FLIR图谱分析</h1>
      </div>

      {/* ── Main Layout: 60% projects | 40% search ──────────── */}
      <div style={{ display: 'flex', gap: 20, marginTop: 16, alignItems: 'flex-start' }}>

        {/* Left: Project table */}
        <div style={{ flex: '0 0 60%', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '8px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
            >
              + 创建项目
            </button>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索项目名称..."
              style={{ flex: 1, padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14 }}
            />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
              {filteredProjects.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}>{p.id}</td>
                  <td style={{ padding: 8 }}>
                    <a href={`/project/${p.id}`} style={{ color: '#2563eb', fontWeight: 500 }}>{p.name}</a>
                  </td>
                  <td style={{ padding: 8, fontSize: 13, color: '#666' }}>{modelLabel(p.model_type || 'none')}</td>
                  <td style={{ padding: 8 }}>{p.image_count ?? 0}</td>
                  <td style={{ padding: 8, fontSize: 13, color: '#888' }}>{new Date(p.created_at).toLocaleString()}</td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    <button onClick={() => deleteProject(p.id, p.name)} title="删除项目"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16, padding: '2px 6px' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#999')}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {projects.length === 0 && (
            <div style={{ textAlign: 'center', color: '#999', marginTop: 60 }}>暂无项目，点击「创建项目」开始</div>
          )}
        </div>

        {/* Right: Equipment history search */}
        <div style={{ flex: '0 0 40%', minWidth: 280,
          padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa',
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 15 }}>📊 设备历史测温查询</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>
              区域
              <select
                value={searchArea}
                onChange={e => { setSearchArea(e.target.value); setSearchName(''); setTrendData(null); }}
                style={{ display: 'block', marginTop: 4, padding: '6px 10px', borderRadius: 4, border: '1px solid #d1d5db', minWidth: 120 }}
              >
                <option value="">-- 选择区域 --</option>
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              设备
              <select
                value={searchName}
                onChange={e => { setSearchName(e.target.value); setTrendData(null); }}
                disabled={!searchArea}
                style={{ display: 'block', marginTop: 4, padding: '6px 10px', borderRadius: 4, border: '1px solid #d1d5db', minWidth: 120 }}
              >
                <option value="">-- 选择设备 --</option>
                {namesForArea.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button
              onClick={handleSearch}
              disabled={!searchArea || !searchName || searching}
              style={{
                padding: '6px 20px', background: '#2563eb', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
                opacity: (!searchArea || !searchName) ? 0.5 : 1,
              }}
            >
              {searching ? '查询中...' : '查询'}
            </button>
          </div>

          {/* ── Search Results ──────────────────────────────── */}
          {trendData && trendData.points.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {/* Trend chart */}
                <div style={{ flex: '0 0 340px' }}>
                  <TrendChart trend={trendData} />
                </div>
                {/* Image thumbnails */}
                <div style={{ flex: '1 1 300px', maxHeight: 340, overflowY: 'auto' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>
                    {trendData.equipment_name} @ {trendData.area} · {trendData.points.length} 次记录
                    <button
                      onClick={() => toggleTrack(trendData.area, trendData.equipment_name)}
                      style={{
                        marginLeft: 10, padding: '2px 10px', fontSize: 12,
                        background: isTracked(trendData.area, trendData.equipment_name) ? '#dc2626' : '#059669',
                        color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer',
                      }}
                    >
                      {isTracked(trendData.area, trendData.equipment_name) ? '取消跟踪' : '+ 添加到跟踪'}
                    </button>
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                    {trendData.points.map(p => (
                      <div
                        key={p.image_id}
                        onClick={() => navigate(`/project/${p.project_id}/image/${p.image_id}`)}
                        style={{
                          border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
                          cursor: 'pointer', background: '#fff',
                          transition: 'box-shadow 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)')}
                        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                      >
                        <div style={{ padding: '6px 8px', fontSize: 12 }}>
                          <div style={{ fontWeight: 500, marginBottom: 2 }}>{p.date}</div>
                          <div style={{ color: '#dc2626' }}>{p.t_max?.toFixed(1)}°C</div>
                          <div style={{ color: '#888', fontSize: 11 }}>{p.project_name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* ── Tracked Equipment ──────────────────────────── */}
          {tracked.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>📌 跟踪设备</h4>
              {tracked.map(t => (
                <div
                  key={`${t.area}-${t.name}`}
                  onClick={() => { setSearchArea(t.area); setSearchName(t.name); handleSearch(); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', marginBottom: 4, borderRadius: 4,
                    background: '#f0f9ff', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <span>{t.name} <span style={{ color: '#888' }}>@{t.area}</span></span>
                  <button
                    onClick={e => { e.stopPropagation(); toggleTrack(t.area, t.name); }}
                    style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 14 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
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
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="例如：2025-05-主变区巡检" autoFocus
                onKeyDown={e => e.key === 'Enter' && create()}
                style={{ width: '100%', padding: 8, boxSizing: 'border-box', borderRadius: 4, border: '1px solid #ccc' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>设备识别模型</div>
              <select value={modelType} onChange={e => setModelType(e.target.value)}
                style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }}>
                {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 20 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Word 报告模板（可选）</div>
              <input type="file" accept=".docx" onChange={e => setTemplate(e.target.files?.[0] || null)}
                style={{ width: '100%' }} />
              {template && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>已选择: {template.name}</div>}
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)}
                style={{ padding: '8px 20px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>取消</button>
              <button onClick={create} disabled={!name.trim()}
                style={{ padding: '8px 24px', background: name.trim() ? '#2563eb' : '#93c5fd',
                  color: '#fff', border: 'none', borderRadius: 4, cursor: name.trim() ? 'pointer' : 'default' }}>创建</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
