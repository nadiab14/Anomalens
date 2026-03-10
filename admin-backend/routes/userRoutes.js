

/**
 * routes/user.js – Gestion des utilisateurs (CRUD, authentification, activation, mot de passe)
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
      return res.status(400).json({ error: 'Admin with this email already exists' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const adminUser = new User({
      name,
      email,
      password: hashedPassword,
      role: 'admin', // Explicitly set role
      isActive: true, // Admins are typically activated immediately
      emailVerified: true // Skip email verification for admins
    });

    await adminUser.save();

    // For security, don't send password back or in email
    res.status(201).json({ 
      message: 'Admin created successfully',
      admin: {
        _id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
        createdAt: adminUser.createdAt
      }
    });

  } catch (err) {
    console.error('Admin creation error:', err);
    res.status(500).json({ error: 'Error creating admin account' });
  }
});



// Delete user by ID
router.delete('/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted' });
});







// Activation route - Final version
router.get('/activate', async (req, res) => {
  try {
    const { token } = req.query;
    
    // 1. Find user with matching token that hasn't expired
    const user = await User.findOne({ 
      activationToken: token,
      tokenExpires: { $gt: Date.now() } // Check if token is still valid
    });

    if (!user) {
      return res.redirect('http://localhost:3000/signIn?activation=invalid');
    }

    // 2. Update user in database
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { 
        isActive: true,
        activationToken: undefined, // Clear the token
        tokenExpires: undefined    // Clear the expiration
      },
      { new: true } // Return the updated document
    );

    if (!updatedUser) {
      throw new Error('User update failed');
    }

    // 3. Redirect with success message
    res.redirect('http://localhost:3000/signIn?activation=success');
    
  } catch (err) {
    console.error('Activation error:', err);
    res.redirect('http://localhost:3000/signIn?activation=error');
  }
});

// Reset password
router.post('/:id/reset-password', async (req, res) => {
  try {
    const userId = req.params.id;
    console.log(userId);
    const newPassword = req.body.newPassword;
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await User.findByIdAndUpdate(userId, { password: hashedPassword });
    
    res.status(200).send({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    res.status(500).send({ error: 'Erreur serveur.' });
  }
});

// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Vérifier si l'utilisateur existe
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    
    // 3. Comparer les mots de passe
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // 4. Générer un token JWT (si vous utilisez JWT)
    const token = jwt.sign(
      { userId: user._id, name:user.name, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    if (user && isMatch && !user.isActive ) {
      user.isActive = true;
      await user.save(); // Save the updated user document to the database

    }


    
   
    // 5. Réponse avec token et infos utilisateur
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});






// ... (le reste du code reste inchangé jusqu'à la partie forgot-password)

// Endpoint pour demander une réinitialisation
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Générer un token de réinitialisation
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 heure

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // Envoyer l'email (style similaire à la création de compte)
    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;
    
    await sendMail({
      to: user.email,
      subject: 'Réinitialisation de votre mot de passe',
      text: `Bonjour ${user.name},\n\nVous avez demandé à réinitialiser votre mot de passe. Veuillez cliquer sur le lien suivant pour continuer:\n\n${resetUrl}\n\nCe lien expirera dans 1 heure.\n\nSi vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.`,
      html: `
        <h2>Bonjour ${user.name},</h2>
        <p>Vous avez demandé à réinitialiser votre mot de passe. Veuillez cliquer sur le lien ci-dessous pour continuer:</p>
        <p><a href="${resetUrl}" target="_blank">Réinitialiser mon mot de passe</a></p>
        <p><em>Ce lien expirera dans 1 heure.</em></p>
        <br>
        <p>Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
        <br>
        <p>Cordialement,</p>
        <p>L'équipe d'administration</p>
      `
    });

    res.status(200).json({ message: 'Email de réinitialisation envoyé' });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({ message: 'Erreur lors de la demande de réinitialisation' });
  }
});






// Endpoint pour réinitialiser le mot de passe
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword, confirmPassword } = req.body;

    // Validation
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Tous les champs sont requis' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Les mots de passe ne correspondent pas' });
    }

    // Trouver l'utilisateur avec le token valide
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Token invalide ou expiré' });
    }

    // Mettre à jour le mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Envoyer un email de confirmation
    await sendMail({
      to: user.email,
      subject: 'Confirmation de réinitialisation de mot de passe',
      text: `Bonjour ${user.name},\n\nVotre mot de passe a été réinitialisé avec succès.\n\nSi vous n'avez pas effectué cette action, veuillez contacter immédiatement l'administration.`,
      html: `
        <h2>Bonjour ${user.name},</h2>
        <p>Votre mot de passe a été réinitialisé avec succès.</p>
        <p>Si vous n'avez pas effectué cette action, veuillez contacter immédiatement l'administration.</p>
        <br>
        <p>Cordialement,</p>
        <p>L'équipe d'administration</p>
      `
    });

    res.status(200).json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({ message: 'Erreur lors de la réinitialisation du mot de passe' });
  }
});








// Change password route
router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  console.log("ok-------------------------------------");
  try {
    // Get token from Authorization header
    const authHeader = req.header('Authorization') || req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token missing or malformed' });
    }

    const token = authHeader.split(' ')[1];
    
    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    // Verify and decode token
    const decoded = jwt.decode(token);
    
    // Changed from decoded.user.id to decoded.id since we're attaching the entire payload
    const user = await User.findById(decoded.userId);
    console.log(decoded);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    // Check if new password is different
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent' });
    }

    // Hash and save new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (err) {
    console.error('Erreur serveur:', err);
    
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token invalide' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    
    res.status(500).json({ error: 'Erreur serveur lors du changement' });
  }
});






module.exports = router;
