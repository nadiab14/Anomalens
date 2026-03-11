# Frontend Anomalens

Application React pour l'interface utilisateur d'Anomalens.

## Pré-requis

- Node.js 18+
- npm 9+

## Installation

```bash
npm install
```

## Lancement en développement

```bash
npm start
```

L'application est servie sur `http://localhost:3000`.

## Tests

```bash
npm test -- --watchAll=false
```

## Build production

```bash
npm run build
```

## Structure utile

- `src/App.js` : routes principales de l'application
- `src/components/SignIn.js` : authentification (connexion / reset)
- `src/components/AdminDashboard.jsx` : écran d'administration
- `src/utils/withauth.js` : garde d'accès côté frontend par rôle

## Notes de sécurité

- Les contrôles côté frontend améliorent l'UX mais **ne remplacent pas** les contrôles d'autorisation côté backend.
- Vérifier que les endpoints backend critiques exigent un token JWT valide et les rôles attendus.
