# classification_force_results.py
import os
from huggingface_hub import login
import torch
import cv2
import numpy as np
from transformers import VideoMAEForVideoClassification

_HF_TOKEN = os.getenv("HUGGINGFACE_HUB_TOKEN", "").strip() or os.getenv("HF_TOKEN", "").strip()
if _HF_TOKEN:
    login(token=_HF_TOKEN)

# Configuration garantissant des résultats
FRAME_SIZE = (224, 224)
BUFFER_SIZE = 16  # Doit être exactement 16 pour VideoMAE
#STRIDE = 1      # Incrément fixe
DEVICE = "cpu"     # Force CPU pour stabilité

class GuaranteedClassifier:
    """
    Classificateur vidéo basé sur le modèle pré-entraîné VideoMAE.

    Ce classificateur extrait des séquences de 16 frames depuis une vidéo,
    les redimensionne, les convertit en tenseurs, puis effectue une prédiction
    sur la catégorie d'action ou d'événement.

    Attributs :
        model : modèle VideoMAE pré-entraîné pour la classification d'actions.
        cap : objet VideoCapture pour lire les frames de la vidéo.
        total_frames : nombre total de frames dans la vidéo.
        fps : fréquence des images de la vidéo (images par seconde).
        stride : espacement entre les frames sélectionnées.
    """
    def __init__(self, video_path, stride=1):
        """
        Initialise le modèle et prépare la vidéo.

        Args:
            video_path (str): chemin vers le fichier vidéo à traiter.
            stride (int): espacement entre les frames sélectionnées pour le clip (par défaut: 1).
        """
        self.model = VideoMAEForVideoClassification.from_pretrained(
            "OPear/videomae-large-finetuned-UCF-Crime"
        ).to(DEVICE).eval()
        
        self.cap = cv2.VideoCapture(video_path)
        self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.stride = stride  # Store stride as instance variable        
        
    def process_video(self):
        """
        Traite un segment de la vidéo et effectue la classification.

        Returns:
            dict: contient la classe prédite, la confiance, le nombre de frames utilisées,
                  et le stride appliqué.
        """
        
        frames = []
        for _ in range(BUFFER_SIZE * self.stride):  # Use self.stride
            ret, frame = self.cap.read()
            if not ret: break
            frames.append(cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), FRAME_SIZE))
        
        clip = np.stack(frames[::self.stride])  # Use self.stride # Sélection stratégique
        tensor = torch.tensor(clip, dtype=torch.float32).permute(0, 3, 1, 2).unsqueeze(0) / 255.0
        
        with torch.no_grad():
            outputs = self.model(tensor.to(DEVICE))
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            conf, pred_id = torch.max(probs, dim=-1)
            
        return {
            "class": ["Abuse", "Arrest", "Arson", "Assault", "Burglary", 
                     "Explosion", "Fighting", "Normal", "RoadAccident", 
                     "Robbery", "Shooting", "Shoplifting", "Stealing", 
                     "Vandalism"][pred_id.item()],
            "confidence": f"{conf.item():.2%}",
            "processed_frames": len(frames[::self.stride]),  # Use self.stride
            "stride_used": self.stride  # Add this to return the stride used
        }

# Utilisation
if __name__ == "__main__":
    import sys
    classifier = GuaranteedClassifier(sys.argv[1])
    results = classifier.process_video()
    print("\n=== RÉSULTATS GARANTIS ===")
    print(f"Classe prédite: {results['class']}")
    print(f"Confiance: {results['confidence']}")
    print(f"Frames analysés: {results['processed_frames']}")
