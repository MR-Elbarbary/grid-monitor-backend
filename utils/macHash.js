const crypto = require('node:crypto');
const QRCode = require('qrcode');


function generatemacHash(mac) {
  const hash = crypto.createHash('sha256');
  hash.update(mac);
  return hash.digest('hex');
}

function validateMacHash(mac, hash) {
  const generatedHash = generatemacHash(mac);
  return generatedHash === hash;
}

function generateHashQRCode(hash) {
  return QRCode.toDataURL(hash);
}



module.exports = {
  generatemacHash,
  validateMacHash,
  generateHashQRCode
};