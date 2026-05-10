import { useState, useEffect } from 'react';
import api from '../api/client';
import type { Project } from '../types';

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');

  const load = async () => {
    const res = await api.get('/projects/');
    setProjects(res.data);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await api.post(`/projects/?name=${encodeURIComponent(name)}`);
    setName('');
    load();
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <h1>FLIR 红外测温分析系统</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
          placeholder="项目名称"
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={create} style={{ padding: '8px 16px' }}>创建项目</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th>ID</th><th>名称</th><th>图片数</th><th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{p.id}</td>
              <td>
                <a href={`/project/${p.id}`} style={{ color: '#2563eb' }}>
                  {p.name}
                </a>
              </td>
              <td>{p.image_count ?? 0}</td>
              <td>{new Date(p.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
