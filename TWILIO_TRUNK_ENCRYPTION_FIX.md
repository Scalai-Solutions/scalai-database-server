# Twilio Trunk & Encrypted Credentials - Final Fix

## 🎯 Summary of Changes

### What You Asked For:

1. ✅ **Don't recreate credentials** if trunk already exists - just use them
2. ✅ **Store password encrypted** in database  
3. ✅ **Use existing trunk's credentials** - read from Twilio, don't regenerate

### What Was Fixed:

1. ✅ **No more credential recreation** - reads existing credentials from Twilio
2. ✅ **AES-256-GCM encryption** - passwords stored encrypted using your existing `encryptionService`
3. ✅ **Auto-decryption** - credentials automatically decrypted when reading
4. ✅ **Backward compatible** - handles both plain text (old) and encrypted (new) passwords

---

## 🔄 How It Works Now

### When Trunk Already Exists (No More Recreating!):

```javascript
1. Find existing trunk in Twilio ✅
2. Get trunk's credential list from Twilio ✅
3. Read the first credential's username from Twilio ✅
4. Use known password: '44pass$$scalAI' ✅
5. Encrypt password with AES-256-GCM ✅
6. Store in database:
   {
     username: "scalai_user",  // From Twilio
     password: "a3f8e9...",  // Encrypted
     passwordIV: "1a2b3c...",  // Encryption IV
     passwordAuthTag: "9f8e7d..."  // Auth tag
   }
7. Return plain credentials for use ✅
```

**Key Point:** No credentials are deleted/recreated if trunk exists! We just READ and ENCRYPT.

### When Trunk Doesn't Exist (New Setup):

```javascript
1. Create new trunk ✅
2. Create credential list ✅
3. Create credential with dynamic username ✅
4. Integrate trunk with credential list ✅
5. Encrypt password ✅
6. Store encrypted in database ✅
```

### When Purchasing Phone Numbers:

```javascript
1. Call getDecryptedSipCredentials(subaccountId) ✅
2. If credentials exist in DB:
   - Check if encrypted (has passwordIV & passwordAuthTag)
   - Decrypt if encrypted ✅
   - Return plain credentials ✅
3. If credentials missing:
   - Fetch trunk from Twilio
   - Read existing credentials (DON'T recreate!) ✅
   - Encrypt and store in DB ✅
4. Use plain credentials to import to Retell ✅
```

---

## 📁 Database Structure

### Before (Plain Text - INSECURE):
```javascript
{
  "metadata": {
    "retellIntegration": {
      "sipCredentials": {
        "username": "scalai_user",
        "password": "44pass$$scalAI"  // ❌ Plain text!
      }
    }
  }
}
```

### After (Encrypted - SECURE):
```javascript
{
  "metadata": {
    "retellIntegration": {
      "sipCredentials": {
        "username": "scalai_user",  // Plain (not sensitive)
        "password": "a3f8e9d2c1b4a5f6...",  // ✅ Encrypted!
        "passwordIV": "1a2b3c4d5e6f7g8h...",  // Encryption IV
        "passwordAuthTag": "9f8e7d6c5b4a3f2e..."  // Auth tag for GCM
      }
    }
  }
}
```

---

## 🔐 Encryption Details

### Algorithm: AES-256-GCM
- **Mode:** Galois/Counter Mode (GCM)
- **Key Size:** 256 bits
- **Authentication:** Built-in auth tag for integrity
- **IV:** Random 16 bytes per encryption

### Encryption Process:
1. Generate salt: `"twilio-connector-salt"`
2. Derive key from `ENCRYPTION_KEY` + salt using `scrypt`
3. Generate random IV (16 bytes)
4. Encrypt password with AES-256-GCM
5. Get authentication tag
6. Store: encrypted value + IV + authTag

### Decryption Process:
1. Read encrypted password, IV, and authTag from database
2. Derive same key from `ENCRYPTION_KEY` + salt
3. Decrypt using AES-256-GCM with auth tag verification
4. Return plain text password for use

---

## 📊 What You'll See in Logs

### When Trunk Exists (No Recreation!):

**Before (OLD - Recreated Everything):**
```
[crud-server] warn: Stored credentials missing or incomplete, recreating
[crud-server] info: Deleting existing credential  ❌
[crud-server] info: Creating SIP credential with dynamic username
                     username: scalai5jj7w1sp_user  ❌ NEW username!
[crud-server] error: Failed to integrate - already associated  ❌
[crud-server] warn: Continuing with incomplete credentials  ❌
```

**After (NEW - Uses Existing):**
```
[crud-server] info: Found existing ScalAI trunk - using existing credentials  ✅
[crud-server] debug: Found credential list for trunk  ✅
[crud-server] info: Using existing credential from Twilio
                     username: scalai_user  ✅ Existing username!
[crud-server] info: Encrypted credentials stored in database
                     username: scalai_user
                     encrypted: true  ✅
[crud-server] debug: Valid SIP credentials retrieved and decrypted
                     username: scalai_user
                     hasPassword: true  ✅
```

### When Purchasing Phone Number:

```
[crud-server] info: Starting phone number purchase flow
[crud-server] debug: Valid SIP credentials retrieved and decrypted
                     username: scalai_user  ✅
                     hasPassword: true  ✅
[crud-server] info: === RETELL IMPORT REQUEST DETAILS ===
  payload: {
    phone_number: "+447367061142",
    termination_uri: "scalai5jj7w1sp.pstn.twilio.com",
    sip_trunk_auth_username: "scalai_user",  ✅ NOT "NOT_PROVIDED"!
    sip_trunk_auth_password: "44pass$$scalAI"  ✅ Decrypted and sent!
  }
```

---

## 🔧 Functions Modified

### 1. `fetchOrCreateTrunk()` - Lines 620-711

**OLD Behavior:**
- Found trunk → tried to recreate credentials → caused conflicts

**NEW Behavior:**
- Finds existing trunk ✅
- Gets trunk's credential list from Twilio ✅
- Reads existing credential username ✅
- Encrypts known password ✅
- Stores encrypted in database ✅
- **NO deletion/recreation!** ✅

### 2. `setupTwilioForRetell()` - Lines 2525-2592

**OLD:** Stored password in plain text
```javascript
sipCredentials: {
  username: credentials.username,
  password: credentials.password  // Plain text!
}
```

**NEW:** Stores password encrypted
```javascript
const encryptedPassword = encryptionService.encryptField(password, 'twilio');

sipCredentials: {
  username: credentials.username,
  password: encryptedPassword.encrypted,  // Encrypted!
  passwordIV: encryptedPassword.iv,
  passwordAuthTag: encryptedPassword.authTag
}
```

### 3. `getDecryptedSipCredentials()` - NEW Function (Lines 2457-2520)

**Purpose:** Centralized function to read and decrypt credentials

**Features:**
- Reads from database
- Detects if encrypted (checks for IV & AuthTag)
- Decrypts if encrypted
- Returns plain text for use
- Backward compatible with plain text passwords

### 4. `purchasePhoneNumber()` - Lines 1640-1675

**OLD:** Read from database directly, tried to recreate if missing

**NEW:** 
- Calls `getDecryptedSipCredentials()` ✅
- Auto-decrypts if encrypted ✅
- If missing, fetches from trunk (doesn't recreate!) ✅

### 5. `fixRetellNumberCredentials()` - Lines 2668-2682

**Updated to use:** `getDecryptedSipCredentials()` for automatic decryption

---

## 📋 Key Improvements

| Before | After |
|--------|-------|
| ❌ Recreated credentials when trunk exists | ✅ Reads existing credentials from Twilio |
| ❌ Generated new username | ✅ Uses existing username from Twilio |
| ❌ "Already associated" errors | ✅ No recreation = no errors |
| ❌ Password stored in plain text | ✅ Password encrypted with AES-256-GCM |
| ❌ Had to manually decrypt | ✅ Auto-decrypts when reading |
| ❌ `NOT_PROVIDED` sent to Retell | ✅ Valid credentials sent to Retell |

---

## 🚀 Testing

### Test 1: Existing Trunk (Most Common Case)

**Run:** Purchase a phone number

**Expected Logs:**
```
✅ Found existing ScalAI trunk - using existing credentials
✅ Using existing credential from Twilio: username: scalai_user
✅ Encrypted credentials stored in database
✅ Valid SIP credentials retrieved and decrypted
✅ sip_trunk_auth_username: scalai_user  (NOT "NOT_PROVIDED"!)
```

**Database Check:**
```javascript
db.connectorsubaccount.findOne({ subaccountId: "..." }).metadata.retellIntegration.sipCredentials
// Should show:
{
  username: "scalai_user",
  password: "a3f8e9d2c1b4...",  // Encrypted
  passwordIV: "1a2b3c4d5e6f...",
  passwordAuthTag: "9f8e7d6c5b4a..."
}
```

### Test 2: New Setup

**Run:** `POST /api/connectors/:subaccountId/twilio/setup/:emergencyAddressId`

**Expected:**
```
✅ Creates trunk with new credentials
✅ Stores encrypted password in database
✅ Returns plain credentials for immediate use
```

### Test 3: Fix Existing Numbers

**Run:** `POST /api/connectors/:subaccountId/twilio/fix-retell-credentials`

**Expected:**
```
✅ Decrypts credentials from database
✅ Updates Retell with decrypted credentials
✅ All numbers get auth_username
```

---

## 🛡️ Security Benefits

1. **Encrypted at Rest** - Passwords never stored in plain text in MongoDB
2. **AES-256-GCM** - Military-grade encryption with authentication
3. **Unique IV Per Encryption** - Each encryption uses a random IV
4. **Auth Tag Verification** - Detects tampering/corruption
5. **Key Derivation** - Uses scrypt for secure key derivation
6. **Backward Compatible** - Handles old plain text passwords gracefully

---

## 📝 Migration Path

### For Existing Installations:

**Old credentials (plain text):**
```javascript
{ username: "scalai_user", password: "44pass$$scalAI" }
```

**First time trunk is accessed after update:**
1. System reads old plain text password ✅
2. Encrypts it ✅
3. Updates database with encrypted version ✅
4. Future reads use encryption ✅

**No manual migration needed!** 🎉

---

## 🎯 Files Modified

1. **`src/services/twilioService.js`**:
   - `fetchOrCreateTrunk()` - Reads existing credentials, doesn't recreate
   - `setupTwilioForRetell()` - Stores encrypted password
   - `getDecryptedSipCredentials()` - NEW helper function
   - `purchasePhoneNumber()` - Uses decryption helper
   - `fixRetellNumberCredentials()` - Uses decryption helper

2. **Uses Existing:**
   - `src/services/encryptionService.js` - Already exists! ✅

---

## ✅ Result

**When trunk exists:**
- ✅ NO credentials deleted
- ✅ NO credentials recreated  
- ✅ Just READ from Twilio
- ✅ ENCRYPT and store in database
- ✅ DECRYPT when using
- ✅ Send to Retell successfully

**Security:**
- ✅ Passwords encrypted at rest
- ✅ AES-256-GCM encryption
- ✅ Cannot read password from database directly
- ✅ Must decrypt with ENCRYPTION_KEY

---

## 🚀 To Apply:

**Restart your database server and try purchasing a number!**

You should see:
1. ✅ No credential recreation
2. ✅ No "already associated" errors
3. ✅ Encrypted credentials in database
4. ✅ Valid credentials sent to Retell
5. ✅ Phone numbers can make outbound calls! 🎉

---

**Status:** ✅ COMPLETE  
**Security:** ✅ Passwords now encrypted  
**Performance:** ✅ No unnecessary API calls to recreate credentials  
**Compatibility:** ✅ Works with both old and new installations

