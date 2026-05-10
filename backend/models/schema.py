import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from .database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    images = relationship(
        "Image", back_populates="project", cascade="all, delete-orphan"
    )


class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    filename = Column(String, nullable=False)
    original_path = Column(String, nullable=False)
    thermal_npy_path = Column(String, nullable=True)
    preview_path = Column(String, nullable=True)
    date = Column(String, nullable=True)
    area = Column(String, nullable=True)
    equipment = Column(String, nullable=True)
    t_min = Column(Float, nullable=True)
    t_max = Column(Float, nullable=True)
    t_mean = Column(Float, nullable=True)
    thermal_width = Column(Integer, nullable=True)
    thermal_height = Column(Integer, nullable=True)
    display_width = Column(Integer, nullable=True)
    display_height = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="images")
    annotations = relationship(
        "Annotation", back_populates="image", cascade="all, delete-orphan"
    )


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"), nullable=False)
    box_coords = Column(JSON, nullable=False)
    version = Column(Integer, default=1)
    t_max = Column(Float, nullable=True)
    t_min = Column(Float, nullable=True)
    t_mean = Column(Float, nullable=True)
    status = Column(String, default="draft")
    reviewed_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    image = relationship("Image", back_populates="annotations")
