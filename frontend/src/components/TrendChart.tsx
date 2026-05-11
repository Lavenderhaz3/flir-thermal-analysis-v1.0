import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EquipmentTrend, TrendPoint } from '../types';

interface TrendChartProps {
  trend: EquipmentTrend;
  currentImageId?: number;
}

const LINE_COLOR = '#dc2626';

function formatDate(d: string): string {
  const parts = d.split('-');
  return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d;
}

export default function TrendChart({ trend, currentImageId }: TrendChartProps) {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; point: TrendPoint;
  } | null>(null);

  const points = trend.points;
  if (points.length === 0) return null;

  const allTemps = points.map(p => p.t_max).filter(Boolean) as number[];
  if (allTemps.length === 0) return null;

  const tMin = Math.floor(Math.min(...allTemps));
  const tMax = Math.ceil(Math.max(...allTemps));
  const tRange = tMax - tMin || 1;

  const dates = [...new Set(points.map(p => p.date))].sort();

  const margin = { top: 20, right: 20, bottom: 50, left: 45 };
  const width = 320;
  const height = 300;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const xScale = (i: number) => margin.left + (i / Math.max(dates.length - 1, 1)) * plotW;
  const yScale = (t: number) => margin.top + plotH - ((t - tMin) / tRange) * plotH;

  const handlePointClick = (point: TrendPoint) => {
    navigate(`/project/${point.project_id}/image/${point.image_id}`);
  };

  const dataPoints = points.filter(p => p.t_max !== null);

  const linePath = dataPoints
    .map((p, i) => {
      const di = dates.indexOf(p.date);
      const cmd = i === 0 ? 'M' : 'L';
      return `${cmd}${xScale(di)},${yScale(p.t_max!)}`;
    })
    .join(' ');

  return (
    <div style={{ marginBottom: 8 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px 0', color: '#374151' }}>
        温度趋势 · {trend.equipment_name}
        {trend.area && <span style={{ color: '#9ca3af' }}> @ {trend.area}</span>}
      </h3>
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', background: '#fafafa', borderRadius: 6, border: '1px solid #e5e7eb' }}
        >
          {/* Grid */}
          {Array.from({ length: 5 }, (_, i) => {
            const t = tMin + (tRange * i) / 4;
            const y = yScale(t);
            return (
              <g key={`grid-${i}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y}
                  stroke="#e5e7eb" strokeDasharray="3,3" />
                <text x={margin.left - 6} y={y + 4} textAnchor="end"
                  fontSize={10} fill="#6b7280">{t}°</text>
              </g>
            );
          })}

          {/* X labels */}
          {dates.map((d, i) => (
            <text key={`x-${d}`} x={xScale(i)} y={height - margin.bottom + 16}
              textAnchor="middle" fontSize={9} fill="#6b7280"
              transform={`rotate(-35, ${xScale(i)}, ${height - margin.bottom + 16})`}>
              {formatDate(d)}
            </text>
          ))}

          {/* Line */}
          <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeLinejoin="round" />

          {/* Points */}
          {dataPoints.map(p => {
            const di = dates.indexOf(p.date);
            const cx = xScale(di);
            const cy = yScale(p.t_max!);
            const isCurrent = p.image_id === currentImageId;
            return (
              <g key={p.image_id}>
                {isCurrent && (
                  <circle cx={cx} cy={cy} r={9} fill="none"
                    stroke={LINE_COLOR} strokeWidth={2.5} strokeDasharray="3,2" />
                )}
                <circle cx={cx} cy={cy} r={isCurrent ? 6 : 5}
                  fill={isCurrent ? '#fff' : LINE_COLOR}
                  stroke={LINE_COLOR} strokeWidth={isCurrent ? 2.5 : 1.5}
                  style={{ cursor: isCurrent ? 'default' : 'pointer' }}
                  onClick={() => !isCurrent && handlePointClick(p)}
                  onMouseEnter={(e) => {
                    if (isCurrent) return;
                    const rect = (e.target as Element).getBoundingClientRect();
                    const svgRect = svgRef.current?.getBoundingClientRect();
                    if (svgRect) {
                      setTooltip({
                        x: rect.left - svgRect.left + 14,
                        y: rect.top - svgRect.top - 10,
                        point: p,
                      });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              </g>
            );
          })}
        </svg>

        {tooltip && (
          <div style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y,
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 11,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            <div>{tooltip.point.date}</div>
            <div>最高: {tooltip.point.t_max?.toFixed(1)}°C</div>
            <div style={{ color: '#9ca3af', fontSize: 9 }}>点击查看</div>
          </div>
        )}
      </div>
    </div>
  );
}
