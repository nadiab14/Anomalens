"""
paramsController.py – Gestion des paramètres d’extraction des clips vidéo

Ce module utilise une base de données SQLite pour stocker temporairement les
paramètres essentiels à l’extraction des clips vidéo :
- clip_length : nombre d’images par clip
- top_k : nombre de clips à sélectionner par segment
- stride : pas de glissement entre deux clips

Les paramètres sont réinitialisés à chaque redémarrage du serveur.
"""
import sqlite3
from typing import List, Dict, Any, Tuple

# Default parameters that will ALWAYS be used on server restart
DEFAULT_PARAMS = {
    'clip_length': 16,
    'top_k': 4,
    'stride': 1
}

def initialize_database():
    """
    Initialise ou réinitialise la base de données SQLite.
    
    À chaque démarrage du serveur, cette fonction :
    - Crée la table clip_parameters si elle n'existe pas
    - Supprime tous les anciens paramètres
    - Réinsère les valeurs par défaut définies dans DEFAULT_PARAMS
    """
    conn = sqlite3.connect('video_clips.db')
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute('''CREATE TABLE IF NOT EXISTS clip_parameters
                   (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    clip_length INTEGER NOT NULL,
                    top_k INTEGER NOT NULL,
                    stride INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # ALWAYS delete all existing rows and insert defaults
    cursor.execute("DELETE FROM clip_parameters")
    cursor.execute('''INSERT INTO clip_parameters 
                   (clip_length, top_k, stride)
                   VALUES (?, ?, ?)''',
                   (DEFAULT_PARAMS['clip_length'], 
                    DEFAULT_PARAMS['top_k'], 
                    DEFAULT_PARAMS['stride']))
    
    conn.commit()
    conn.close()

def insert_clip_parameters(params: Dict[str, int]) -> Tuple[bool, str, Dict[str, int]]:
    """
    Insère de nouveaux paramètres dans la base de données.

    ⚠️ Ces paramètres sont temporaires : ils seront réinitialisés au prochain redémarrage
    du serveur, car `initialize_database()` supprime toujours les anciennes valeurs.

    Paramètres :
    - params : dictionnaire contenant 'clip_length', 'top_k' et 'stride'

    Retourne :
    - Tuple (succès: bool, message: str, données: dict)
    """
    try:
        # Extract parameters with defaults as fallback
        clip_length = int(params.get('clip_length', DEFAULT_PARAMS['clip_length']))
        top_k = int(params.get('top_k', DEFAULT_PARAMS['top_k']))
        stride = int(params.get('stride', DEFAULT_PARAMS['stride']))

        # Store in database (will be reset on next server start)
        conn = sqlite3.connect('video_clips.db')
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM clip_parameters")
        cursor.execute('''INSERT INTO clip_parameters 
                       (clip_length, top_k, stride)
                       VALUES (?, ?, ?)''',
                       (clip_length, top_k, stride))
        
        conn.commit()
        conn.close()
        
        return True, "Parameters updated temporarily (will reset on server restart)", {
            'clip_length': clip_length,
            'top_k': top_k,
            'stride': stride
        }

    except ValueError as e:
        return False, f"Invalid parameter format: {str(e)}", {}
    except sqlite3.Error as e:
        return False, f"Database error: {str(e)}", {}
    except Exception as e:
        return False, f"Unexpected error: {str(e)}", {}

def fetch_clip_parameters() -> List[Dict[str, Any]]:
    """
    Fetch current parameters from database
    """"""
    Récupère les paramètres en vigueur depuis la base de données.

    Retourne :
    - Une liste contenant un dictionnaire avec les colonnes suivantes :
      'id', 'clip_length', 'top_k', 'stride', 'created_at'
    - Si la table est vide (ce qui ne devrait jamais arriver), retourne DEFAULT_PARAMS
    """
    conn = sqlite3.connect('video_clips.db')
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM clip_parameters ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        
        if row:
            columns = [column[0] for column in cursor.description]
            return [dict(zip(columns, row))]
        else:
            # This should never happen since initialize_database() always inserts defaults
            return [DEFAULT_PARAMS]
    finally:
        conn.close()