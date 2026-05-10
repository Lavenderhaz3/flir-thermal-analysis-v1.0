export interface Project {
  id: number;
  name: string;
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
  thermal_width: number;
  thermal_height: number;
  display_width: number;
  display_height: number;
  annotations: AnnotationData[];
}

export interface AnnotationData {
  id: number;
  box_coords: BoxCoords;
  t_max: number | null;
  t_min: number | null;
  t_mean: number | null;
  status: string;
  version?: number;
}

export interface BoxCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
