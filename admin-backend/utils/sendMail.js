
/**
 * sendMail.js – Fonction utilitaire pour envoyer des emails via SMTP (Brevo)
 * 
 * Utilise nodemailer pour envoyer un email avec les options :
 *  - to : destinataire (email)
 *  - subject : sujet de l'email
 *  - text : contenu texte brut
 *  - html : contenu HTML (optionnel)
 * 
 * Configure un transporteur SMTP avec les identifiants Brevo (smtp-relay.brevo.com).
 * Supporte TLS sur le port 587.
 */

const nodemailer = require('nodemailer');

const sendMail = async ({ to, subject, text, html }) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587, // Use 465 for SSL
    secure: false, // True for 465, false for other ports
    auth: {
      user: '7516bb001@smtp-brevo.com', // Your Brevo email
      pass: 'Y47HMxNK5DVT38gB', // SMTP key from Brevo
    },
  });

  await transporter.sendMail({
    from: '"AnomaLens" <no-reply@yourdomain.com>',
    to,
    subject,
    text,
    html,
  });
};

module.exports = sendMail;

