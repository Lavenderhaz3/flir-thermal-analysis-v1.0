import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text } from 'react-konva';
import Konva from 'konva';
import api from '../api/client';
import type { ImageDetail, AnnotationData, BoxCoords } from '../types';

export default function AnnotationEditor() {
  const { projectId, imageId } = useParams<{ projectId: string; imageId: string }>();
  const [image, setImage] = useState<ImageDetail | null>(null);
  const [imgObj, setImgObj] = useState<HTMLImageElement | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [newBox, setNewBox] = useState<BoxCoords | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  // Load image data
  useEffect(() => {
    api.get(`/images/${imageId}`).then(res => setImage(res.data));
  }, [imageId]);

  // Load annotations
  const loadAnnotations = useCallback(async () => {
    const res = await api.get(`/images/${imageId}/annotations/`);
    setAnnotations(res.data);
  }, [imageId]);
  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Load FLIR JPEG for canvas
  useEffect(() => {
    if (!image) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = image.preview_url;
    img.onload = () => setImgObj(img);
  }, [image]);

  if (!image || !imgObj) return <div style={{ padding: 20 }}>Loading...</div>;

  // Scale: display coords → thermal matrix coords
  const scaleX = (image.display_width || imgObj.naturalWidth) / (image.thermal_width || imgObj.naturalWidth);
  const scaleY = (image.display_height || imgObj.naturalHeight) / (image.thermal_height || imgObj.naturalHeight);

  // Fit canvas to viewport
  const maxW = Math.min(window.innerWidth - 40, imgObj.naturalWidth);
  const maxH = Math.min(window.innerHeight - 160, imgObj.naturalHeight);
  const fitScale = Math.min(maxW / imgObj.naturalWidth, maxH / imgObj.naturalHeight, 1);

  const toThermalCoords = (box: BoxCoords): BoxCoords => ({
    x1: Math.round(box.x1 / scaleX),
    y1: Math.round(box.y1 / scaleY),
    x2: Math.round(box.x2 / scaleX),
    y2: Math.round(box.y2 / scaleY),
  });

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Click on empty area → start drawing new box
    if (e.target === e.target.getStage()) {
      setSelectedId(null);
      const pos = e.target.getStage()!.getPointerPosition()!;
      setDrawing(true);
      setNewBox({ x1: pos.x / fitScale, y1: pos.y / fitScale, x2: pos.x / fitScale, y2: pos.y / fitScale });
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawing || !newBox) return;
    const pos = e.target.getStage()!.getPointerPosition()!;
    setNewBox({ ...newBox, x2: pos.x / fitScale, y2: pos.y / fitScale });
  };

  const handleMouseUp = async () => {
    if (!drawing || !newBox) return;
    setDrawing(false);

    // Convert to thermal coords and save
    const thermalCoords = toThermalCoords(newBox);
    try {
      const res = await api.post(`/images/${imageId}/annotations/`, {
        box_coords: thermalCoords,
      });
      setAnnotations(prev => [...prev, res.data]);
    } catch (err) {
      console.error('Failed to save annotation', err);
    }
    setNewBox(null);
  };

  const handleDragEnd = async (annId: number, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const box: BoxCoords = {
      x1: node.x() / fitScale,
      y1: node.y() / fitScale,
      x2: (node.x() + node.width()) / fitScale,
      y2: (node.y() + node.height()) / fitScale,
    };
    try {
      const res = await api.put(`/annotations/${annId}`, {
        box_coords: toThermalCoords(box),
      });
      setAnnotations(prev => prev.map(a => a.id === annId ? res.data : a));
    } catch (err) {
      console.error('Failed to update annotation', err);
    }
  };

  const handleTransformEnd = async (annId: number, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX_node = node.scaleX();
    const scaleY_node = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const box: BoxCoords = {
      x1: node.x() / fitScale,
      y1: node.y() / fitScale,
      x2: (node.x() + node.width() * scaleX_node) / fitScale,
      y2: (node.y() + node.height() * scaleY_node) / fitScale,
    };
    try {
      const res = await api.put(`/annotations/${annId}`, {
        box_coords: toThermalCoords(box),
      });
      setAnnotations(prev => prev.map(a => a.id === annId ? res.data : a));
    } catch (err) {
      console.error('Failed to update annotation', err);
    }
  };

  const displayBox = (box: BoxCoords) => ({
    x: Math.min(box.x1, box.x2) * fitScale,
    y: Math.min(box.y1, box.y2) * fitScale,
    width: Math.abs(box.x2 - box.x1) * fitScale,
    height: Math.abs(box.y2 - box.y1) * fitScale,
  });

  return (
    <div style={{ padding: 10 }}>
      <p>
        <a href={`/project/${projectId}`} style={{ color: '#2563eb' }}>← 返回项目</a>
        {' · '}{image.filename}
        {' · '}最高温: {image.t_max?.toFixed(1)}°C
        {' · '}最低温: {image.t_min?.toFixed(1)}°C
        {' · '}平均温: {image.t_mean?.toFixed(1)}°C
      </p>
      <div style={{ border: '1px solid #ccc', display: 'inline-block' }}>
        <Stage
          width={imgObj.naturalWidth * fitScale}
          height={imgObj.naturalHeight * fitScale}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          ref={stageRef}
        >
          <Layer>
            <KonvaImage image={imgObj}
              width={imgObj.naturalWidth * fitScale}
              height={imgObj.naturalHeight * fitScale}
            />

            {/* Saved annotations */}
            {annotations.map(ann => {
              const box = displayBox(ann.box_coords);
              return (
                <Rect
                  key={ann.id}
                  id={`ann-${ann.id}`}
                  {...box}
                  stroke="#00ff00"
                  strokeWidth={2}
                  draggable
                  onClick={() => setSelectedId(ann.id)}
                  onDragEnd={(e) => handleDragEnd(ann.id, e)}
                  onTransformEnd={(e) => handleTransformEnd(ann.id, e)}
                />
              );
            })}

            {/* Temperature labels */}
            {annotations.map(ann => {
              const box = displayBox(ann.box_coords);
              return (
                <Text
                  key={`label-${ann.id}`}
                  x={box.x}
                  y={box.y - 18}
                  text={ann.t_max != null ? `${ann.t_max.toFixed(1)}°C` : '...'}
                  fontSize={14}
                  fill="#00ff00"
                  stroke="#000"
                  strokeWidth={2}
                  fillAfterStrokeEnabled
                />
              );
            })}

            {/* Drawing box */}
            {drawing && newBox && (
              <Rect {...displayBox(newBox)} stroke="#ffff00" strokeWidth={2} dash={[4, 4]} />
            )}

            {/* Transformer for selected annotation */}
            {selectedId != null && (
              <Transformer
                ref={trRef}
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
                }
              />
            )}
          </Layer>
        </Stage>
      </div>

      {/* Annotation list */}
      <div style={{ marginTop: 16 }}>
        <h3>标注列表</h3>
        {annotations.map(ann => (
          <div key={ann.id} style={{ marginBottom: 8, padding: 8, background: '#f8f8f8', borderRadius: 4 }}>
            框 {ann.id}: 最高 {ann.t_max?.toFixed(1)}°C / 最低 {ann.t_min?.toFixed(1)}°C / 平均 {ann.t_mean?.toFixed(1)}°C
            {' '}<button onClick={async () => {
              await api.delete(`/annotations/${ann.id}`);
              loadAnnotations();
            }} style={{ color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer' }}>删除</button>
          </div>
        ))}
        {annotations.length === 0 && <div style={{ color: '#999' }}>在热像图上拖拽鼠标画框选择设备区域</div>}
      </div>
    </div>
  );
}
