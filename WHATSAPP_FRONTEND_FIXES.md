# WhatsApp Integration - Frontend Fixes Guide

## Issues Fixed

### 1. ✅ QR Reloading Disconnecting Phone
**Problem:** When the frontend repeatedly called `/connect` to reload QR codes, it was disconnecting the existing WhatsApp connection.

**Fix:** The backend now checks if WhatsApp is already connected before creating a new connector. If connected, it returns connection details without disconnecting.

### 2. ✅ Messages Not Getting Replies
**Problem:** When connectors were recreated during QR reloading, message handlers were lost, so incoming messages weren't processed.

**Fix:** Message handlers are now always registered, even when reusing existing connectors. The backend ensures handlers persist.

### 3. ✅ Connection Status Returns Full Details
**Fix:** The `/status` endpoint now properly returns phone number, platform, and pushname when connected.

## Frontend Implementation Guide

### Step 1: Check Status First, Then Connect

**❌ DON'T DO THIS:**
```javascript
// Bad: Always calling connect will disconnect existing connections
async function loadQRCode() {
  const response = await fetch(`/api/whatsapp/${subaccountId}/${agentId}/connect`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  if (data.data.qrCodeDataUrl) {
    setQRCode(data.data.qrCodeDataUrl);
  }
}
```

**✅ DO THIS INSTEAD:**
```javascript
// Good: Check status first, only connect if not already connected
async function initializeWhatsApp() {
  // Step 1: Check current status
  const statusResponse = await fetch(`/api/whatsapp/${subaccountId}/${agentId}/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const statusData = await statusResponse.json();
  
  // Step 2: If already connected, show connection details
  if (statusData.data.isConnected) {
    setConnected(true);
    setPhoneNumber(statusData.data.phoneNumber);
    setPlatform(statusData.data.platform);
    setPushname(statusData.data.pushname);
    setQRCode(null); // Hide QR code
    return; // Stop here - don't call connect
  }
  
  // Step 3: Only call connect if not connected
  const connectResponse = await fetch(`/api/whatsapp/${subaccountId}/${agentId}/connect`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const connectData = await connectResponse.json();
  
  // Step 4: Check if connection was already established (auto-connected)
  if (connectData.data.alreadyConnected) {
    setConnected(true);
    setPhoneNumber(connectData.data.phoneNumber);
    setPlatform(connectData.data.platform);
    setPushname(connectData.data.pushname);
    setQRCode(null);
  } else if (connectData.data.qrCodeDataUrl) {
    // Show QR code for scanning
    setQRCode(connectData.data.qrCodeDataUrl);
    setConnected(false);
    // Start polling for connection status
    pollConnectionStatus();
  }
}
```

### Step 2: Poll Status Instead of Reloading QR

**❌ DON'T DO THIS:**
```javascript
// Bad: Reloading QR disconnects the phone
setInterval(() => {
  loadQRCode(); // This disconnects existing connections!
}, 5000);
```

**✅ DO THIS INSTEAD:**
```javascript
// Good: Poll status endpoint, don't reload QR
let statusPollInterval = null;

function pollConnectionStatus() {
  // Clear any existing interval
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
  }
  
  statusPollInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/whatsapp/${subaccountId}/${agentId}/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (data.data.isConnected) {
        // Connected! Stop polling and show connection details
        clearInterval(statusPollInterval);
        statusPollInterval = null;
        
        setConnected(true);
        setPhoneNumber(data.data.phoneNumber);
        setPlatform(data.data.platform);
        setPushname(data.data.pushname);
        setQRCode(null); // Hide QR code
        
        // Show success message
        showNotification('WhatsApp connected successfully!');
      } else if (data.data.hasQR && data.data.qrCodeDataUrl) {
        // QR code available, update it
        setQRCode(data.data.qrCodeDataUrl);
      }
      // If not connected and no QR, keep waiting
    } catch (error) {
      console.error('Error polling status:', error);
    }
  }, 3000); // Poll every 3 seconds
}

// Stop polling when component unmounts or connection is established
function stopPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}
```

### Step 3: Complete React Component Example

```jsx
import React, { useState, useEffect } from 'react';

function WhatsAppIntegration({ subaccountId, agentId, token }) {
  const [connected, setConnected] = useState(false);
  const [qrCode, setQRCode] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [pushname, setPushname] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusPollInterval, setStatusPollInterval] = useState(null);

  // Initialize on mount
  useEffect(() => {
    initializeWhatsApp();
    
    // Cleanup on unmount
    return () => {
      if (statusPollInterval) {
        clearInterval(statusPollInterval);
      }
    };
  }, []);

  async function initializeWhatsApp() {
    setLoading(true);
    try {
      // Step 1: Check current status
      const statusResponse = await fetch(
        `/api/whatsapp/${subaccountId}/${agentId}/status`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const statusData = await statusResponse.json();
      
      // Step 2: If already connected, show details
      if (statusData.data.isConnected) {
        setConnected(true);
        setPhoneNumber(statusData.data.phoneNumber);
        setPlatform(statusData.data.platform);
        setPushname(statusData.data.pushname);
        setQRCode(null);
        setLoading(false);
        return;
      }
      
      // Step 3: Call connect only if not connected
      const connectResponse = await fetch(
        `/api/whatsapp/${subaccountId}/${agentId}/connect`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const connectData = await connectResponse.json();
      
      // Step 4: Handle response
      if (connectData.data.alreadyConnected) {
        // Auto-connected from cached session
        setConnected(true);
        setPhoneNumber(connectData.data.phoneNumber);
        setPlatform(connectData.data.platform);
        setPushname(connectData.data.pushname);
        setQRCode(null);
      } else if (connectData.data.qrCodeDataUrl) {
        // Show QR code and start polling
        setQRCode(connectData.data.qrCodeDataUrl);
        setConnected(false);
        startPolling();
      }
    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      alert('Failed to initialize WhatsApp connection');
    } finally {
      setLoading(false);
    }
  }

  function startPolling() {
    // Clear any existing interval
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
    }
    
    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/whatsapp/${subaccountId}/${agentId}/status`,
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );
        const data = await response.json();
        
        if (data.data.isConnected) {
          // Connected! Stop polling
          clearInterval(interval);
          setStatusPollInterval(null);
          
          setConnected(true);
          setPhoneNumber(data.data.phoneNumber);
          setPlatform(data.data.platform);
          setPushname(data.data.pushname);
          setQRCode(null);
          
          alert('WhatsApp connected successfully!');
        } else if (data.data.hasQR && data.data.qrCodeDataUrl) {
          // Update QR code if it changed
          setQRCode(data.data.qrCodeDataUrl);
        }
      } catch (error) {
        console.error('Error polling status:', error);
      }
    }, 3000); // Poll every 3 seconds
    
    setStatusPollInterval(interval);
  }

  function handleDisconnect() {
    if (window.confirm('Are you sure you want to disconnect WhatsApp?')) {
      fetch(`/api/whatsapp/${subaccountId}/${agentId}/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(() => {
        setConnected(false);
        setPhoneNumber(null);
        setPlatform(null);
        setPushname(null);
        setQRCode(null);
        if (statusPollInterval) {
          clearInterval(statusPollInterval);
          setStatusPollInterval(null);
        }
      })
      .catch(error => {
        console.error('Error disconnecting:', error);
        alert('Failed to disconnect WhatsApp');
      });
    }
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="whatsapp-integration">
      {connected ? (
        <div className="connected-state">
          <h3>✅ WhatsApp Connected</h3>
          <div className="connection-details">
            <p><strong>Phone Number:</strong> {phoneNumber}</p>
            <p><strong>Platform:</strong> {platform}</p>
            {pushname && <p><strong>Name:</strong> {pushname}</p>}
          </div>
          <button onClick={handleDisconnect} className="disconnect-btn">
            Disconnect WhatsApp
          </button>
        </div>
      ) : (
        <div className="qr-state">
          <h3>Connect WhatsApp</h3>
          {qrCode ? (
            <>
              <img src={qrCode} alt="WhatsApp QR Code" style={{ width: 300, height: 300 }} />
              <p>Scan this QR code with your WhatsApp mobile app</p>
              <p className="instructions">
                Open WhatsApp → Menu → Linked Devices → Link a Device
              </p>
            </>
          ) : (
            <p>Generating QR code...</p>
          )}
        </div>
      )}
    </div>
  );
}

export default WhatsAppIntegration;
```

## API Response Formats

### GET `/api/whatsapp/:subaccountId/:agentId/status`

**When Connected:**
```json
{
  "success": true,
  "data": {
    "isConnected": true,
    "isActive": true,
    "hasQR": false,
    "qrCodeDataUrl": null,
    "phoneNumber": "1234567890",
    "platform": "android",
    "pushname": "My Business"
  }
}
```

**When Not Connected (QR Available):**
```json
{
  "success": true,
  "data": {
    "isConnected": false,
    "isActive": false,
    "hasQR": true,
    "qrCodeDataUrl": "data:image/png;base64,...",
    "status": "pending"
  }
}
```

**When Not Initialized:**
```json
{
  "success": true,
  "data": {
    "isConnected": false,
    "isActive": false,
    "hasQR": false,
    "qrCodeDataUrl": null,
    "status": "not_initialized"
  }
}
```

### POST `/api/whatsapp/:subaccountId/:agentId/connect`

**When Already Connected:**
```json
{
  "success": true,
  "data": {
    "alreadyConnected": true,
    "message": "WhatsApp is already connected",
    "phoneNumber": "1234567890",
    "platform": "android",
    "pushname": "My Business",
    "isConnected": true,
    "isActive": true
  }
}
```

**When QR Generated:**
```json
{
  "success": true,
  "data": {
    "qrCode": "2@XXX...",
    "qrCodeDataUrl": "data:image/png;base64,...",
    "message": "Scan this QR code with WhatsApp mobile app"
  }
}
```

## Key Points

1. **Always check status first** before calling `/connect`
2. **Never call `/connect` repeatedly** - it will disconnect existing connections
3. **Poll `/status` endpoint** instead of reloading QR codes
4. **Stop polling** once `isConnected: true` is received
5. **Show connection details** (phone number, platform, name) when connected
6. **Hide QR code** when connected

## Testing Checklist

- [ ] Status check works before connecting
- [ ] QR code appears when not connected
- [ ] QR code disappears when connected
- [ ] Connection details show when connected
- [ ] Polling stops when connected
- [ ] Calling `/connect` when already connected doesn't disconnect
- [ ] Messages receive replies after connection
- [ ] Disconnect works properly

