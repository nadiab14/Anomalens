/**
 * authMiddleware.js – Middleware d'authentification JWT
 *
 * Ce middleware vérifie la présence et la validité d’un jeton JWT (JSON Web Token)
 * dans l'en-tête Authorization des requêtes entrantes.
 *
 * Si le token est valide, il ajoute l'ID utilisateur (userId) dans `req` pour les prochains middlewares.
 * Sinon, il renvoie une réponse 401 (non autorisé).
 */
const jwt = require('jsonwebtoken');


module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentification requise' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Vérifiez la structure du token décodé
    console.log('Token décodé:', decoded);
    
    if (!decoded.userId ) {
      return res.status(401).json({ message: 'Token invalide' });
    }

    req.userId = decoded.userId; // Stockez directement l'ID
    next();
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    res.status(401).json({ 
      message: error.name === 'TokenExpiredError' 
        ? 'Session expirée' 
        : 'Authentification échouée' 
    });
  }
};