const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

function generateCode() {
  return (Math.floor(100000 + Math.random() * 900000)).toString();
}

function hashCode(code) {
  return crypto.createHmac('sha256', JWT_SECRET).update(code).digest('hex');
}

function verifyCode(code, hash) {
  const h = hashCode(code);
  return h === hash;
}

module.exports = { generateCode, hashCode, verifyCode };
