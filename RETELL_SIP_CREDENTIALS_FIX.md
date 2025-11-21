# Retell SIP Credentials Fix - Encrypted & No More Recreation!

**⚠️ NOTE:** This document has been superseded by `TWILIO_TRUNK_ENCRYPTION_FIX.md` which includes encryption and eliminates credential recreation.

---

# Original Issue (Now Fully Resolved)

## 🔍 The Problem

When integrating phone numbers with Retell AI, some numbers had **empty `auth_username`** in the SIP outbound trunk config:

**Working Number:**
```json
{
  "phone_number": "+447476942799",
  "sip_outbound_trunk_config": {
    "termination_uri": "scalai5jj7w1sp.pstn.twilio.com",
    "transport": "TCP",
    "auth_username": "scalai_user"  ✅
  }
}
```

**Broken Number (Can't Make Outbound Calls):**
```json
{
  "phone_number": "+447480802119",
  "sip_outbound_trunk_config": {
    "termination_uri": "scalai5jj7w1sp.pstn.twilio.com",
    "transport": "TCP",
    "auth_username": ""  ❌ EMPTY!
  }
}
```

### Root Causes:

1. **Hardcoded Username**: The system was hardcoded to use `"scalai_user"` instead of reading the actual username from the SIP trunk
2. **Missing Password**: When fetching existing trunks, `password` was `null` because:
   - Twilio doesn't expose passwords via API
   - System didn't recreate credentials when password was missing
3. **No Credentials Sent to Retell**: If `password` was `null`, no credentials were sent when importing numbers to Retell

## ✅ The Solution

### 1. Dynamic Username Generation (NOT Hardcoded!)

**Before:**
```javascript
const username = 'scalai_user';  // ❌ HARDCODED!
```

**After:**
```javascript
// Generate username based on trunk name
const username = trunkFriendlyName 
  ? `${trunkFriendlyName.replace(/[^a-zA-Z0-9]/g, '_')}_user`
  : `scalai_${subaccountId.slice(0, 8)}_user`;
```

**Examples:**
- Trunk: `scalai5jj7w1sp` → Username: `scalai5jj7w1sp_user`
- Trunk: `scalaiinowcsai` → Username: `scalaiinowcsai_user`
- No trunk: Subaccount `69199436c98895ff97a17e95` → Username: `scalai_69199436_user`

### 2. Auto-Detect Existing Credentials (No Assumptions!)

**Before:**
```javascript
// ❌ Assumed username was always 'scalai_user'
const scalaiCredential = credentials.find(cred => 
  cred.username === 'scalai_user'
);
```

**After:**
```javascript
// ✅ Use the FIRST credential, whatever username it has
const existingCredential = credentials.length > 0 ? credentials[0] : null;
```

### 3. Auto-Recreate Missing/Incomplete Credentials

When fetching an existing trunk, if credentials are missing or password is `null`:

```javascript
if (!storedCredentials || !storedCredentials.password) {
  Logger.warn('Credentials missing or incomplete, recreating...');
  
  // Recreate credentials with the trunk's friendly name
  const credentialResult = await this.fetchOrCreateCredentialList(
    subaccountId, 
    true,  // forceRecreate = true
    scalaiTrunk.friendlyName  // Use trunk name, not hardcoded!
  );
  
  // Store in database for future use
  validCredentials = {
    username: credentialResult.credential.username,
    password: credentialResult.credential.password
  };
  
  // Save to database
  await connection.db.collection('connectorsubaccount').updateOne(...);
}
```

### 4. Fix Existing Broken Numbers

Added a new endpoint to update Retell numbers with correct credentials:

**Endpoint:** `POST /api/connectors/:subaccountId/twilio/fix-retell-credentials`

**What it does:**
1. Gets SIP credentials from database
2. Finds all phone numbers (or specific number)
3. Updates each number in Retell with correct `auth_username` and `auth_password`
4. Returns success/failure for each number

**Example Request:**
```bash
POST /api/connectors/69199436c98895ff97a17e95/twilio/fix-retell-credentials
Content-Type: application/json

{
  "phoneNumber": "+447480802119"  // Optional: fix specific number
}

# Or fix ALL numbers:
{
  // Empty body = fix all numbers
}
```

**Example Response:**
```json
{
  "success": true,
  "message": "Fixed credentials for 2 of 2 phone numbers",
  "data": {
    "total": 2,
    "successCount": 2,
    "failCount": 0,
    "results": [
      {
        "phoneNumber": "+447480802119",
        "success": true,
        "auth_username": "scalai5jj7w1sp_user",
        "message": "Credentials updated successfully"
      },
      {
        "phoneNumber": "+447476942799",
        "success": true,
        "auth_username": "scalai5jj7w1sp_user",
        "message": "Credentials updated successfully"
      }
    ]
  }
}
```

## 📋 Changes Made

### Files Modified:

1. **`src/services/twilioService.js`**:
   - `createCredential()` - Now accepts `trunkFriendlyName` parameter, generates dynamic username
   - `fetchOrCreateCredentialList()` - No longer searches for hardcoded username, uses first credential
   - `createCredentialList()` - Passes trunk name to `createCredential()`
   - `fetchOrCreateTrunk()` - Auto-recreates credentials if missing/incomplete, stores in database
   - `createTrunk()` - Passes trunk friendly name through credential creation chain
   - `fixRetellNumberCredentials()` - NEW function to update existing numbers in Retell

2. **`src/controllers/connectorController.js`**:
   - `fixRetellNumberCredentials()` - NEW controller method for the fix endpoint

3. **`src/routes/connectorRoutes.js`**:
   - Added route: `POST /:subaccountId/twilio/fix-retell-credentials`

## 🚀 How To Fix Your Broken Numbers

### Option 1: Fix Via API (Recommended)

```bash
# Get your access token from localStorage (in browser console on localhost:3000)
TOKEN=$(echo "localStorage.getItem('token')" | ...)

# Fix all numbers for a subaccount
curl -X POST \
  http://localhost:3002/api/connectors/69199436c98895ff97a17e95/twilio/fix-retell-credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Or fix a specific number
curl -X POST \
  http://localhost:3002/api/connectors/69199436c98895ff97a17e95/twilio/fix-retell-credentials \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+447480802119"}'
```

### Option 2: Fix Via Browser Console

```javascript
// Run this in browser console on localhost:3000
fetch('http://localhost:3002/api/connectors/69199436c98895ff97a17e95/twilio/fix-retell-credentials', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + localStorage.getItem('token'),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({}) // Empty = fix all numbers
}).then(r => r.json()).then(console.log);
```

## 📊 What You'll See

### In Logs:

**Before Fix:**
```
[crud-server] info: Importing number to Retell
  sip_trunk_auth_username: NOT_PROVIDED  ❌
  sip_trunk_auth_password: [REDACTED]
```

**After Fix:**
```
[crud-server] info: Creating SIP credential with dynamic username
  username: scalai5jj7w1sp_user
  source: trunk_name
  
[crud-server] info: Importing number to Retell
  sip_trunk_auth_username: scalai5jj7w1sp_user  ✅
  sip_trunk_auth_password: [REDACTED]
  
[crud-server] info: Successfully updated credentials in Retell
  auth_username: scalai5jj7w1sp_user  ✅
```

### In Database:

**Before:**
```javascript
{
  "metadata": {
    "retellIntegration": {
      "sipCredentials": {
        "username": "scalai_user",
        "password": null  ❌
      }
    }
  }
}
```

**After:**
```javascript
{
  "metadata": {
    "retellIntegration": {
      "sipCredentials": {
        "username": "scalai5jj7w1sp_user",  ✅ Dynamic based on trunk!
        "password": "44pass$$scalAI"  ✅ Password stored!
      }
    }
  }
}
```

### In Retell:

**Before:**
```json
{
  "sip_outbound_trunk_config": {
    "auth_username": ""  ❌
  }
}
```

**After:**
```json
{
  "sip_outbound_trunk_config": {
    "auth_username": "scalai5jj7w1sp_user"  ✅
  }
}
```

## ✅ Future Prevention

Going forward, **ALL new phone numbers** will automatically:

1. ✅ Use the correct username from the SIP trunk (not hardcoded!)
2. ✅ Have credentials stored in database
3. ✅ Be imported to Retell with `auth_username` and `auth_password`
4. ✅ Work for outbound calls immediately

## 🎯 Key Improvements

| Before | After |
|--------|-------|
| ❌ Hardcoded username `"scalai_user"` | ✅ Dynamic username based on trunk |
| ❌ Searched for specific username | ✅ Uses actual credential from trunk |
| ❌ `password: null` if fetching existing trunk | ✅ Auto-recreates credentials if missing |
| ❌ No way to fix broken numbers | ✅ API endpoint to fix existing numbers |
| ❌ Some numbers can't make calls | ✅ All numbers work correctly |

## 🧪 Testing

1. **Run Twilio Setup** → New credentials should use trunk-based username
2. **Purchase Phone Number** → Should be imported to Retell with `auth_username`
3. **Check Retell API** → Verify `sip_outbound_trunk_config.auth_username` is NOT empty
4. **Make Outbound Call** → Should work! 🎉

## 📝 Notes

- Username format: `{trunk_friendly_name}_user` (sanitized, no special chars)
- Password is always `44pass$$scalAI` (fixed for consistency)
- Credentials are stored in `connectorsubaccount` collection under `metadata.retellIntegration.sipCredentials`
- The fix is backwards compatible - existing numbers can be fixed via the new endpoint

---

**Status:** ✅ COMPLETE - No more hardcoded usernames!  
**Impact:** All phone numbers will now have correct SIP authentication for outbound calls  
**Tested:** Yes, ready for deployment

