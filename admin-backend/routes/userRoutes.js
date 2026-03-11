

/**
 * routes/userRoutes.js – Gestion des utilisateurs (CRUD, authentification, activation, mot de passe)
 * 
 * Routes fournies :
 * - GET /                : Liste tous les utilisateurs
 * - POST /addUser        : Création d'un nouvel utilisateur avec envoi d'email d'activation
 * - POST /createAdmin    : Création sécurisée d'un administrateur (clé secrète requise)
 * - DELETE /:id          : Suppression d'un utilisateur par ID
 * - GET /activate        : Activation du compte via token d'activation dans query string
 * - POST /:id/reset-password : Réinitialisation du mot de passe d'un utilisateur (admin ou auto)
 * - POST /login          : Connexion utilisateur avec JWT
 * - POST /forgot-password : Demande de réinitialisation de mot de passe (envoi mail)
 * - POST /reset-password/:token : Réinitialisation effective du mot de passe via token
 * - POST /change-password : Changement du mot de passe pour utilisateur connecté (JWT requis)
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');
const sendMail = require('../utils/sendMail');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');




// Generate activation token
const generateToken = () => {
  return crypto.randomBytes(20).toString('hex');
};

// Get all users
router.get('/', async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// Add new user
router.post('/addUser', async (req, res) => {
  try {
    const { password, email, name, ...rest } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = generateToken();
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = new User({
      name,
      email,
      password: hashedPassword,
      isActive: false,
      activationToken,
      tokenExpires,
      ...rest
    });

    await user.save();

    // Send activation email
    // const activationLink = `http://localhost:3000/activate?token=${activationToken}`; ca marche pas hekka 


    const activationLink = `http://localhost:3000`;
    
    await sendMail({
      to: email,
      subject: 'Activez votre compte',
      text: `Bonjour ${name},\n\nVotre compte a été créé. Veuillez l'activer en cliquant sur le lien suivant:\n\n${activationLink}\n\nEmail: ${email}\nMot de passe: ${password}\n\nCe lien expirera dans 24 heures.`,
      html: `
        <h2>Bienvenue, ${name}!</h2>
        <p>Votre compte a été créé avec succès. Veuillez l'activer en cliquant sur le lien ci-dessous:</p>
        <p><a href="${activationLink}" target="_blank">Activer mon compte</a></p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Mot de passe:</strong> ${password}</p>
        <br>
        <p>Cordialement,</p>
        <p>L'équipe d'administration</p>
      `
    });

    res.status(201).json({ 
      message: 'User created successfully. Activation email sent.',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating user.' });
  }
});



router.post('/createAdmin', async (req, res) => {
  try {
    const { password, email, name, secretKey } = req.body;
    
    // Validate admin secret key
    if (secretKey !==process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ error: 'Unauthorized: Invalid admin secret key' });
    }

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email, role: 'admin' });
    if (existingAdmin) {
      return res.status(400).json({ error: 'Admin already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = new User({
      name,
      email,
      password: hashedPassword,
      role: 'admin',
      isActive: true // Admin is active immediately
    });

    await admin.save();

    res.status(201).json({
      message: 'Admin created successfully',
      user: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating admin' });
  }
});

// Delete user by ID
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting user' });
  }
});



// activate route
router.get('/activate', async (req, res) => {
  try {
    const { token } = req.query;

    // 1. Find user by token and check expiration
    const user = await User.findOne({
      activationToken: token,
      tokenExpires: { $gt: Date.now() }, // Check if token is still valid
    });

    if (!user) {
      return res.status(400).send('Activation link is invalid or expired.');
    }

    // 2. Activate account and clear token fields
    user.isActive = true;
    user.activationToken = undefined; // Clear the token
    user.tokenExpires = undefined;    // Clear the expiration

    await user.save();

    // 3. Redirect with success message
    res.redirect('http://localhost:3000/signIn?activation=success');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error during activation.');
  }
});



router.post('/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).send({ message: 'Utilisateur non trouvé.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    res.status(200).send({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    res.status(500).send({ message: 'Erreur serveur.' });
  }
});


// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({ 
        message: 'Votre compte n\'est pas encore activé. Vérifiez votre email.' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        role: user.role,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Connexion réussie',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion' });
  }
});


// Route pour demander la réinitialisation de mot de passe
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé avec cet email' });
    }

    // Générer un token sécurisé
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 heure

    // Sauvegarder le token dans la base de données
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // Créer le lien de réinitialisation
    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;

    // Envoyer l'email
    await sendMail({
      to: user.email,
      subject: 'Réinitialisation de votre mot de passe',
      text: `Bonjour ${user.name},\n\nVous avez demandé à réinitialiser votre mot de passe. Veuillez cliquer sur le lien suivant pour continuer:\n\n${resetUrl}\n\nCe lien expirera dans 1 heure.\n\nSi vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.`,
      html: `
        <h2>Réinitialisation de mot de passe</h2>
        <p>Bonjour ${user.name},</p>
        <p>Vous avez demandé à réinitialiser votre mot de passe. Veuillez cliquer sur le lien ci-dessous pour continuer:</p>
        <p><a href="${resetUrl}" target="_blank">Réinitialiser mon mot de passe</a></p>
        <p>Ce lien expirera dans <strong>1 heure</strong>.</p>
        <p>Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
      `
    });

    res.status(200).json({ message: 'Email de réinitialisation envoyé avec succès' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la demande de réinitialisation' });
  }
});

// Endpoint pour réinitialiser le mot de passe
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ 
        message: 'Le mot de passe doit contenir au moins 8 caractères' 
      });
    }

    // Vérifier le token et son expiration
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        message: 'Le lien de réinitialisation est invalide ou expiré' 
      });
    }

    // Mettre à jour le mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Envoyer email de confirmation (optionnel)
    await sendMail({
      to: user.email,
      subject: 'Confirmation de réinitialisation de mot de passe',
      text: `Bonjour ${user.name},\n\nVotre mot de passe a été réinitialisé avec succès.\n\nSi vous n'avez pas effectué cette action, veuillez contacter immédiatement l'administration.`,
      html: `
        <h2>Mot de passe réinitialisé</h2>
        <p>Bonjour ${user.name},</p>
        <p>Votre mot de passe a été réinitialisé avec succès.</p>
        <p>Si vous n'avez pas effectué cette action, veuillez contacter immédiatement l'administration.</p>
      `
    });

    res.status(200).json({ message: 'Mot de passe mis à jour avec succès' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Erreur lors de la réinitialisation du mot de passe' });
  }
});





// Change password for authenticated user
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    // Find user by authenticated user ID
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    // Check if new password is different
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent' });
    }

    // Hash and save new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    await user.save();

    res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Erreur serveur lors du changement de mot de passe' });
  }
});

module.exports = router;
