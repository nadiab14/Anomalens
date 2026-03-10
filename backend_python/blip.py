
from transformers import BlipProcessor, BlipForConditionalGeneration
from PIL import Image
import torch

# Load once
processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
model.eval()

def generate_caption(image: Image.Image) -> tuple[str, None]:
    """1
    Génère automatiquement une légende (caption) pour une image donnée en utilisant le modèle BLIP.

    Args:
        image (PIL.Image.Image): L’image en entrée, sous forme d’objet PIL.

    Returns:
        tuple:
            - str: La légende générée décrivant le contenu de l’image.
            - None: Valeur de retour supplémentaire pour compatibilité avec un format d’appel spécifique.
    """
    image = image.convert('RGB')
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        output = model.generate(**inputs)
    caption = processor.decode(output[0], skip_special_tokens=True)
    return caption, None  # Return two values to match unpacking


