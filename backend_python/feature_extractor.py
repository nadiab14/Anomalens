from transformers import CLIPProcessor, CLIPModel
import torch
from typing import List
from PIL.Image import Image

class FeatureExtractor:
    """
    Classe permettant d’extraire les embeddings (représentations vectorielles) d’un ensemble d’images
    à l’aide du modèle CLIP (Contrastive Language-Image Pretraining).

    Le modèle est utilisé ici pour encoder uniquement les images (pas de texte) en vecteurs 
    dans un espace sémantique commun, utile pour la détection d’anomalies, la recherche ou la classification.
    """
    def __init__(self, device: str = "cuda" if torch.cuda.is_available() else "cpu"):
        """
        Initialise le modèle CLIP et son processeur.

        Args:
            device (str) : Périphérique d'exécution, 'cuda' si disponible, sinon 'cpu'.
        """
        self.device = device
        self.model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(device)
        self.processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

    def get_batch_embeddings(self, frames: List[Image]) -> torch.Tensor:
        """
        Extrait les embeddings d’un lot d’images (par exemple, les frames d’un clip).

        Args:
            frames (List[PIL.Image]) : liste d’objets PIL représentant les images à encoder.

        Returns:
            torch.Tensor : tenseur de forme (N, D) contenant les embeddings des images,
                           où N est le nombre d’images et D la dimension des vecteurs.
        """
        inputs = self.processor(images=frames, return_tensors="pt", padding=True).to(self.device)
        with torch.no_grad():
            return self.model.get_image_features(**inputs)