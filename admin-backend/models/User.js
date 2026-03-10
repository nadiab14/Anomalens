

/**
 * User.js – Modèle Mongoose pour les utilisateurs
 *
 * Ce modèle gère les informations des comptes utilisateurs, notamment :
 * - Les informations personnelles (nom, email)
 * - Les rôles d’accès (admin, user, etc.)
 * - L’état d’activation du compte
 * - Les jetons d’activation et de réinitialisation de mot de passe
 */
const mongoose = require('mongoose');  // Add this line at the top
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'user' },
  isActive: { type: Boolean, default: false },
  activationToken: String,
  tokenExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date
});

module.exports = mongoose.model('User', userSchema);