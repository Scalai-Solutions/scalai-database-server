const Logger = require('../utils/logger');

/**
 * Mock Session Middleware
 * Detects X-Mock-Session header and attaches mock session info to request
 * All operations for mock sessions will be routed to Redis instead of MongoDB
 */
const mockSessionMiddleware = (req, res, next) => {
  try {
    // Check for mock session header
    const mockSessionHeader = req.headers['x-mock-session'];
    
    if (mockSessionHeader) {
      // Validate session ID format
      if (typeof mockSessionHeader !== 'string' || mockSessionHeader.length === 0) {
        Logger.warn('Invalid mock session header format', {
          header: mockSessionHeader,
          path: req.path
        });
        return next();
      }

      // Attach mock session info to request
      req.mockSession = {
        isMock: true,
        sessionId: mockSessionHeader,
        detectedAt: new Date().toISOString(),
        path: req.path,
        method: req.method
      };

      Logger.info('🎭 Mock session detected', {
        sessionId: mockSessionHeader,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        subaccountId: req.params?.subaccountId || req.body?.subaccountId
      });

      // Add response header to indicate mock mode
      res.setHeader('X-Mock-Session-Active', 'true');
      res.setHeader('X-Mock-Session-Id', mockSessionHeader);
    } else {
      // No mock session - normal MongoDB operations
      req.mockSession = {
        isMock: false
      };
    }

    next();
  } catch (error) {
    Logger.error('Error in mock session middleware', {
      error: error.message,
      stack: error.stack,
      path: req.path
    });
    
    // Don't fail the request - just continue without mock session
    req.mockSession = {
      isMock: false
    };
    next();
  }
};

module.exports = mockSessionMiddleware;

