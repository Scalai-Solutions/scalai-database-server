const jwt = require('jsonwebtoken');
const config = require('../../config/config');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, config.jwt.secret, (err, decoded) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    req.user = decoded;
    next();
  });
};

// Optional middleware - only authenticate if token is provided
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    // No token provided, continue without authentication
    return next();
  }

  jwt.verify(token, config.jwt.secret, (err, decoded) => {
    if (!err) {
      req.user = decoded;
    }
    // Continue regardless of token validity for optional auth
    next();
  });
};

module.exports = {
  authenticateToken,
  optionalAuth
}; 
 