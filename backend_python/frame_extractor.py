"""
frame_extractor.py – Extraction de clips à partir de vidéos

Ce module contient la classe FrameExtractor, qui permet :
- d’obtenir les métadonnées d’une vidéo (FPS, nombre de frames, dimensions…)
- d’extraire des clips de taille fixe à partir d’une vidéo (par glissement ou segment)

Les clips sont retournés sous forme de listes d’images PIL.
"""
import cv2
import os
from PIL import Image
import numpy as np
from typing import Generator, List, Optional

class FrameExtractor:
    """
    Classe responsable de l'extraction de clips d’images depuis une vidéo.

    Paramètres :
    - frame_size : tuple (largeur, hauteur) → taille de redimensionnement de chaque frame
    - clip_length : nombre de frames par clip extrait
    """
    def __init__(self, frame_size=(224, 224), clip_length=16):
        self.frame_size = frame_size
        self.clip_length = clip_length
        
    def get_video_info(self, video_path: str) -> dict:
        """
        Récupère les métadonnées d'une vidéo : FPS, nombre total de frames, dimensions, durée.
        Gère aussi les vidéos live stream ou avec métadonnées corrompues.

        Retourne :
        - dict contenant 'fps', 'total_frames', 'duration', 'width', 'height'
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")
        
        # Handle live cameras (total_frames = 0)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # Fallback for invalid metadata
        if fps <= 0 or fps > 1000:  # Sanity check
            fps = 30.0  # Default FPS
        
        if total_frames < 0:  # Handle corrupted metadata
            total_frames = 0  # Treat as live stream
            
        video_info = {
            "fps": fps,
            "total_frames": total_frames,
            "duration": total_frames / fps if fps > 0 else 0,
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        }
        
        cap.release()
        return video_info

    def extract_clips(
        self, 
        video_path: str, 
        start_frame: int = 0, 
        end_frame: Optional[int] = None
    ) -> Generator[tuple[List[Image.Image], float], None, None]:
        
        """
        Extrait des clips à partir d’une vidéo entre deux indices de frames.

        Paramètres :
        - video_path : chemin vers la vidéo
        - start_frame : index de la première frame à lire
        - end_frame : index de la dernière frame à lire (optionnel)

        Retourne :
        - Un générateur qui yield des tuples (clip, start_time)
            - clip : liste de `clip_length` images PIL
            - start_time : timestamp (en secondes) du début du clip
        """

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0 or fps > 1000:
            fps = 30.0  # Default FPS
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if total_frames <= 0:
            end_frame = None
        elif end_frame is None or end_frame > total_frames:
            end_frame = total_frames

        frame_buffer = []
        current_frame = 0

        while True:
            ret, frame = cap.read()
            if not ret or (end_frame is not None and current_frame >= end_frame):
                if frame_buffer:
                    clip_start_time = (current_frame - len(frame_buffer)) / fps
                    print(f"Clip from {clip_start_time:.2f} seconds")
                    yield frame_buffer, clip_start_time
                break

            if current_frame >= start_frame:
                frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frame = Image.fromarray(frame).resize(self.frame_size)
                frame_buffer.append(frame)

                if len(frame_buffer) == self.clip_length:
                    clip_start_time = (current_frame - self.clip_length + 1) / fps
                    print(f"Clip from {clip_start_time:.2f} seconds")
                    yield frame_buffer, clip_start_time
                    frame_buffer = []

            current_frame += 1

        cap.release()