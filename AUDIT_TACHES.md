# Audit rapide — tâches proposées

## 1) Corriger une coquille typographique
- **Constat** : le commentaire d'en-tête de `admin-backend/routes/userRoutes.js` mentionne `routes/user.js`, alors que le fichier réel est `userRoutes.js`.
- **Tâche** : harmoniser le nom de fichier dans le commentaire d'en-tête (`routes/userRoutes.js`).
- **Pourquoi c'est utile** : réduit la confusion lors de la navigation dans le code et évite les erreurs de référence dans la documentation interne.
- **Critère d'acceptation** : le commentaire d'en-tête référence le chemin exact du fichier.

## 2) Corriger un bug fonctionnel
- **Constat** : dans `frontend/src/App.js`, la route `/admin` monte directement `AdminDashboard` sans garde d'authentification/autorisation, alors qu'un HOC `withAuth` existe (`frontend/src/utils/withauth.js`).
- **Tâche** : protéger `/admin` (et potentiellement les routes sensibles comme `/chatpage`) avec `withAuth` + rôle `admin`.
- **Pourquoi c'est utile** : évite l'accès non autorisé côté client à des écrans d'administration.
- **Critère d'acceptation** : un utilisateur sans token valide ou sans rôle `admin` est redirigé vers `/login` ou `/unauthorized`.

## 3) Corriger un commentaire / anomalie de documentation
- **Constat** : `frontend/README.md` est encore le README générique de Create React App et ne documente pas l'application (routes métier, variables d'environnement, lancement via Docker Compose, etc.).
- **Tâche** : remplacer le contenu par une documentation projet orientée Anomalens (setup local, scripts utiles, architecture frontend/backend, dépannage).
- **Pourquoi c'est utile** : accélère l'onboarding et réduit les erreurs d'exécution.
- **Critère d'acceptation** : README mis à jour avec instructions réelles du projet et vérifiées.

## 4) Améliorer un test
- **Constat** : `frontend/src/App.test.js` contient encore le test par défaut CRA (`learn react`), non aligné avec les routes et composants actuels.
- **Tâche** : remplacer par des tests de routage réalistes (ex. redirection `/` -> `/login`, rendu de la page SignIn, protection des routes privées si implémentée).
- **Pourquoi c'est utile** : augmente la valeur du test et détecte les régressions de navigation.
- **Critère d'acceptation** : tests verts et assertions sur des éléments réellement présents dans l'UI actuelle.
