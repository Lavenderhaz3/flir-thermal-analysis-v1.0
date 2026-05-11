export interface Project {
  id: number;
  name: string;
  model_type?: string;  // "none" | "transformer" | "switchgear" | ...
  created_at: string;
  image_count?: number;
  images?: ImageSummary[];
}

export interface ImageSummary {
  id: number;
  filename: string;
  date: string | null;
  area: string | null;
  equipment: string | null;
  t_min: number | null;
  t_max: number | null;
  t_mean: number | null;
  preview_url: string;
}

export interface ImageDetail extends ImageSummary {
  project_id: number;
  equipment_id: number | null;
  thermal_width: number;
  thermal_height: number;
  display_width: number;
  display_height: number;
  annotations: AnnotationData[];
}

export interface TrendPoint {
  date: string;
  t_max: number | null;
  t_mean: number | null;
  image_id: number;
  project_id: number;
  project_name: string | null;
  area: string | null;
  filename: string;
}

export interface EquipmentTrend {
  equipment_id: number;
  equipment_name: string;
  area: string | null;
  device_type: string | null;
  points: TrendPoint[];
}

export interface AnnotationData {
  id: number;
  box_coords: BoxCoords;
  t_max: number | null;
  t_min: number | null;
  t_mean: number | null;
  max_position?: { x: number; y: number };
  source?: string;  // "manual" | "auto"
  status: string;
  version?: number;
}

export interface BoxCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
