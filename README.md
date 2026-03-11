# Anomalens

Anomalens est une application de surveillance video assistee par IA. Le depot regroupe trois services :

- un frontend React pour l'interface utilisateur ;
- un backend Node.js/Express pour l'authentification et l'historique ;
- un backend Python/Flask pour l'analyse video, la detection d'anomalies et le chat multimodal.

## Structure du depot

```text
Anomalens/
|- frontend/          # application React
|- admin-backend/     # API Express + MongoDB
|- backend_python/    # pipeline IA Flask
|- docker-compose.yml
```

## Prerequis

- Docker Desktop + Docker Compose
- ou, pour un lancement local :
- Node.js 18+
- npm 9+
- Python 3.10+ recommande
- MongoDB accessible localement ou a distance
- ffmpeg / ffprobe disponibles si vous lancez le backend Python hors Docker

## Demarrage rapide avec Docker

Depuis la racine du projet :

```bash
docker compose up --build
```

Services exposes :

- frontend : `http://localhost:3000`
- backend Python : `http://localhost:5000`
- backend admin : `http://localhost:5001`

Variables utiles lues par `docker-compose.yml` :

- `OPENROUTER_API_KEY`
- `MONGO_URI`
- `REACT_APP_API_BASE_URL`
- `REACT_APP_BACKEND_URL`
- `PUBLIC_BACKEND_BASE_URL`

## Lancement local sans Docker

### 1. Backend admin

Dans `admin-backend/` :

```bash
npm install
npm start
```

Variables d'environnement attendues :

- `MONGO_URI`
- `PORT` (par defaut `5001`)
- `JWT_SECRET`
- `ADMIN_SECRET_KEY`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_USER`
- `EMAIL_PASS`

API principale :

- `/api/users`
- `/api/historique`

### 2. Backend Python

Dans `backend_python/` :

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Variables d'environnement courantes :

- `OPENROUTER_API_KEY`
- `NODE_BACKEND_URL` (ex. `http://localhost:5001/api/historique`)
- `PUBLIC_BACKEND_BASE_URL` (ex. `http://localhost:5000`)
- `ANOMALY_THRESHOLD`
- `YOLO_ENABLED`
- `YOLO_MODEL`
- `FFMPEG`
- `FFPROBE`

Endpoints principaux :

- `GET /`
- `POST /upload`
- `GET|POST /stream_results`
- `POST /chat_llm`
- `GET /api/runtime_status`
- `GET|POST /api/clip_params`

Le backend ecrit aussi des fichiers dans `backend_python/uploads/` et `backend_python/output_clips/`.

### 3. Frontend

Dans `frontend/` :

```bash
npm install
npm start
```

Variables d'environnement :

- `REACT_APP_API_BASE_URL` (backend admin, ex. `http://localhost:5001`)
- `REACT_APP_BACKEND_URL` (backend Python, ex. `http://localhost:5000`)

Routes principales :

- `/login`
- `/admin`
- `/dashboard`
- `/analysis`
- `/chatpage`

## Flux applicatif

1. L'utilisateur se connecte via le frontend.
2. Le frontend echange avec `admin-backend` pour l'authentification et l'historique.
3. Les videos sont envoyees au backend Flask.
4. Le backend Python extrait les frames, detecte les anomalies, genere des clips et peut enrichir l'analyse via OpenRouter.
5. Les evenements detectes sont remontes vers le backend admin pour historisation.

## Fichiers utiles

- `docker-compose.yml` : orchestration locale des trois services
- `frontend/README.md` : notes specifiques au frontend
- `AUDIT_TACHES.md` : suivi/audit de taches du projet

## Notes

- Le depot contient deja des fichiers `.env` locaux. Avant de partager ou deployer le projet, verifiez qu'aucun secret reel ne reste versionne.
- Le backend Python charge des modeles IA et peut etre lourd au premier demarrage.
