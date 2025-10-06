const crypto = require('crypto');
const config = require('./config/config');

// Enhanced decryptApiKey method with better error handling and logging
function decryptApiKey(encrypted, iv, authTag) {
  try {
    console.log('=== Decryption Debug Info ===');
    console.log('Encrypted length:', encrypted.length);
    console.log('IV length:', iv.length);
    console.log('AuthTag length:', authTag.length);
    console.log('Encryption key exists:', !!config.encryption.key);
    console.log('Encryption key length:', config.encryption.key ? config.encryption.key.length : 0);
    
    const algorithm = 'aes-256-cbc';
    const secretKey = crypto.scryptSync(config.encryption.key, 'retell-salt', 32);
    
    console.log('Secret key length:', secretKey.length);
    console.log('IV buffer:', Buffer.from(iv, 'hex'));
    
    const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    console.log('Decryption successful, length:', decrypted.length);
    console.log('===============================');
    
    return decrypted;
  } catch (error) {
    console.log('=== Decryption Error ===');
    console.log('Error message:', error.message);
    console.log('Error code:', error.code);
    console.log('Stack:', error.stack);
    console.log('=========================');
    throw new Error('Failed to decrypt API key: ' + error.message);
  }
}

module.exports = { decryptApiKey };
