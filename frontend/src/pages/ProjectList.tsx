import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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

  const handleSearch = async (area = searchArea, name = searchName) => {
    if (!area || !name) return;
    setSearching(true);
    try {
      const res = await api.get('/equipment/trend', {
        params: { name, area },
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

  const trendArea = trendData?.area || '';

  return (
    <div className="app-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">红外巡检工作台</p>
          <h1 className="page-title">FLIR图谱分析</h1>
        </div>
      </div>

      {/* ── Main Layout: 60% projects | 40% search ──────────── */}
      <div className="dashboard-grid">

        {/* Left: Project table */}
        <section className="panel panel--scroll">
          <div className="panel__head">
            <h2 className="panel__title">项目列表</h2>
            <span className="status-pill">{projects.length} 个项目</span>
          </div>
          <div className="panel__body">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button
              onClick={() => setShowCreate(true)}
              className="btn btn-primary"
            >
              + 创建项目
            </button>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索项目名称..."
              className="field"
              style={{ flex: 1, minWidth: 180 }}
            />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>项目名称</th>
                <th>识别模型</th>
                <th>图片数</th>
                <th>创建时间</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>
                    <a href={`/project/${p.id}`} style={{ fontWeight: 700 }}>{p.name}</a>
                  </td>
                  <td className="subtle">{modelLabel(p.model_type || 'none')}</td>
                  <td><span className="status-pill">{p.image_count ?? 0}</span></td>
                  <td className="subtle">{new Date(p.created_at).toLocaleString()}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => deleteProject(p.id, p.name)} title="删除项目"
                      className="btn-danger-ghost">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {projects.length === 0 && (
            <div className="empty-state" style={{ marginTop: 18 }}>暂无项目，点击「创建项目」开始</div>
          )}
          </div>
        </section>

        {/* Right: Equipment history search */}
        <aside className="panel">
          <div className="panel__head">
            <h2 className="panel__title">设备历史测温查询</h2>
          </div>
          <div className="panel__body">
          <div className="search-grid">
            <label className="label">
              区域
              <select
                value={searchArea}
                onChange={e => { setSearchArea(e.target.value); setSearchName(''); setTrendData(null); }}
                className="select"
              >
                <option value="">-- 选择区域 --</option>
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="label">
              设备
              <select
                value={searchName}
                onChange={e => { setSearchName(e.target.value); setTrendData(null); }}
                disabled={!searchArea}
                className="select"
              >
                <option value="">-- 选择设备 --</option>
                {namesForArea.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button
              onClick={() => handleSearch()}
              disabled={!searchArea || !searchName || searching}
              className="btn btn-primary"
            >
              {searching ? '查询中...' : '查询'}
            </button>
          </div>

          {/* ── Search Results ──────────────────────────────── */}
          {trendData && trendData.points.length > 0 && (
            <div className="search-result-panel">
              <div className="result-summary">
                <div>
                  <div className="result-kicker">查询结果</div>
                  <h3 className="result-title">
                    {trendData.equipment_name}
                    <span className="subtle"> @ {trendData.area || '未知区域'}</span>
                  </h3>
                </div>
                <div className="result-actions">
                  <span className="status-pill">{trendData.points.length} 次记录</span>
                  {trendArea && (
                    <button
                      onClick={() => toggleTrack(trendArea, trendData.equipment_name)}
                      className={`btn ${isTracked(trendArea, trendData.equipment_name) ? 'btn-secondary' : 'btn-success'}`}
                    >
                      {isTracked(trendArea, trendData.equipment_name) ? '取消跟踪' : '添加到跟踪'}
                    </button>
                  )}
                </div>
              </div>
              <div className="trend-result">
                {/* Trend chart */}
                <div>
                  <TrendChart trend={trendData} />
                </div>
              </div>
            </div>
          )}
          {/* ── Tracked Equipment ──────────────────────────── */}
          {tracked.length > 0 && (
            <div className="tracked-panel">
              <div className="tracked-head">
                <h4>跟踪设备</h4>
                <span className="subtle">{tracked.length} 个</span>
              </div>
              <div className="tracked-list">
              {tracked.map(t => (
                <div
                  key={`${t.area}-${t.name}`}
                  onClick={() => { setSearchArea(t.area); setSearchName(t.name); handleSearch(t.area, t.name); }}
                  className="tracked-item"
                >
                  <span><strong>{t.name}</strong> <span className="subtle">@{t.area}</span></span>
                  <button
                    onClick={e => { e.stopPropagation(); toggleTrack(t.area, t.name); }}
                    className="btn-danger-ghost"
                  >✕</button>
                </div>
              ))}
              </div>
            </div>
          )}
          </div>
        </aside>
      </div>

      {/* ── Create Project Modal ─────────────────────────────── */}
      {showCreate && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>创建项目</h2>
            <label className="label" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>项目名称</div>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="例如：2025-05-主变区巡检" autoFocus
                onKeyDown={e => e.key === 'Enter' && create()}
                className="field"
              />
            </label>
            <label className="label" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>设备识别模型</div>
              <select value={modelType} onChange={e => setModelType(e.target.value)}
                className="select">
                {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label className="label" style={{ marginBottom: 20 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Word 报告模板（可选）</div>
              <input type="file" accept=".docx" onChange={e => setTemplate(e.target.files?.[0] || null)}
                style={{ width: '100%' }} />
              {template && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>已选择: {template.name}</div>}
            </label>
            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)}
                className="btn btn-secondary">取消</button>
              <button onClick={create} disabled={!name.trim()}
                className="btn btn-primary">创建</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
