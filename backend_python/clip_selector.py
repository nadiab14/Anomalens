import torch.nn.functional as F
import os
import shutil

class ClipSelector:
    """
    Classe permettant de sélectionner les clips vidéo les plus diversifiés à partir
    de leurs embeddings, selon une stratégie basée sur la dissimilarité cosinus.

    Attributs :
        OUTPUT_DIR (str) : répertoire où les clips sélectionnés peuvent être sauvegardés.
        TOP_K (int) : nombre maximum de clips à sélectionner.
    """
    def __init__(self, output_dir, top_k=4):
        """
    Classe permettant de sélectionner les clips vidéo les plus diversifiés à partir
    de leurs embeddings, selon une stratégie basée sur la dissimilarité cosinus.

    Attributs :
        OUTPUT_DIR (str) : répertoire où les clips sélectionnés peuvent être sauvegardés.
        TOP_K (int) : nombre maximum de clips à sélectionner.
    """
        self.OUTPUT_DIR = output_dir
        self.TOP_K = top_k
        print(f"🔄 ClipSelector initialized with top_k={top_k}")  # Add this line
        os.makedirs(self.OUTPUT_DIR, exist_ok=True)

    def _score_value(self, meta):
        try:
            return float(meta.get("score", 0.0))
        except Exception:
            return 0.0

    def _embedding_distance(self, a, b):
        emb_a = a.get("embedding")
        emb_b = b.get("embedding")
        if emb_a is None or emb_b is None:
            return 0.0
        try:
            return 1 - F.cosine_similarity(emb_a, emb_b, dim=0).item()
        except Exception:
            return 0.0

    def select_diverse_clips(self, clips_metadata, score_threshold=None):
        """
        Sélectionne les clips les plus diversifiés parmi ceux fournis.

        La diversité est mesurée à l’aide de la distance cosinus entre les embeddings
        des clips. On choisit itérativement le clip le plus distant (en termes de similarité)
        du groupe déjà sélectionné.

        Args:
            clips_metadata (list[dict]) : liste de dictionnaires, chaque dictionnaire
                contenant au moins la clé "embedding" avec un tenseur PyTorch représentant le clip.

        Returns:
            list[dict] : sous-ensemble des clips sélectionnés, de longueur ≤ TOP_K.
        """
        if not clips_metadata:
            return []

        ranked = sorted(
            [meta for meta in clips_metadata if isinstance(meta, dict)],
            key=lambda meta: (
                -self._score_value(meta),
                float(meta.get("timestamp", 0.0)) if isinstance(meta.get("timestamp"), (int, float)) else 0.0,
            ),
        )
        if not ranked:
            return []

        if score_threshold is not None:
            above_threshold = [m for m in ranked if self._score_value(m) >= float(score_threshold)]
            below_threshold = [m for m in ranked if self._score_value(m) < float(score_threshold)]
            ranked = above_threshold + below_threshold

        selected = [ranked[0]]
        used = {0}

        for _ in range(1, min(self.TOP_K, len(ranked))):
            best_objective = -1e9
            best_idx = -1
            for i, meta in enumerate(ranked):
                if i in used:
                    continue

                dists = [self._embedding_distance(meta, s) for s in selected]
                min_dist = min(dists) if dists else 0.0
                score_bias = self._score_value(meta)
                # Prioritize anomaly score first, then spread selected clips to avoid duplicates.
                objective = (0.75 * score_bias) + (0.25 * min_dist)
                if objective > best_objective:
                    best_objective = objective
                    best_idx = i
            if best_idx != -1:
                selected.append(ranked[best_idx])
                used.add(best_idx)

        selected.sort(
            key=lambda meta: (
                -self._score_value(meta),
                float(meta.get("timestamp", 0.0)) if isinstance(meta.get("timestamp"), (int, float)) else 0.0,
            )
        )
        return selected
