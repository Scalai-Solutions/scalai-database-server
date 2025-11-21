# Twilio Setup & Purchase Fixes

## Issues Fixed

### 1. ✅ RBAC Resource Resolution 404 Error During Twilio Setup

**Problem:**
When setting up Twilio with `POST /api/connectors/:subaccountId/twilio/setup/:emergencyAddressId`, the system logged:
```
Resource resolution failed: Request failed with status code 404
```

**Root Cause:**
The connector endpoints weren't registered in the auth server's RBAC system, causing resource resolution failures.

**Solution:**
- Created and ran `/scalai-auth-server/scripts/register-connector-resource.js`
- Registered the `connection` resource with all 23 connector endpoints
- Properly mapped the Twilio setup endpoint to require `admin` permission

**Result:**
- ✅ All connector routes now properly resolve to the `connection` resource
- ✅ No more fallback to default permissions
- ✅ Proper permission checking: Twilio setup requires `admin` permission

**To Apply the Fix:**
Clear the RBAC cache by running this in your browser console (while on localhost:3000):
```javascript
fetch('http://localhost:3002/api/cache/clear', { 
  method: 'DELETE',
  headers: { 
    'Authorization': 'Bearer ' + localStorage.getItem('token') 
  }
}).then(r => r.json()).then(console.log)
```

Or simply restart your database-server.

---

### 2. ✅ Phone Number "Not Available" Error with Automatic Retry + Bundle Type Matching

**Problem:**
When purchasing a phone number that appeared in the available list:
```
Error: +447414108337 is not available.
```

**Root Cause:**
Race condition - phone numbers shown as available might be purchased by others before your purchase completes.

**Additional Problem (Fixed in v2):**
First version of retry logic found alternative numbers but didn't match the bundle type:
```
Error: Bundle type mismatch - trying to purchase local number with mobile bundle
```

**Solution:**
Added intelligent retry logic to `twilioService.purchasePhoneNumber()` with **bundle-aware matching**:

1. **Smart Number Type Detection**
   - Detects number type from phone pattern (e.g., +447 = mobile, +441 = local)
   - Falls back to searching available numbers if pattern detection fails
   - Stores original number type for retry logic

2. **Automatic Retry (up to 3 attempts) with Type Matching**
   - Detects "not available" errors
   - **Only searches for numbers of the SAME TYPE** as the original
   - Verifies alternative matches the original type (critical for bundle validation)
   - Purchases the first available alternative of matching type
   - Notifies user if a different number was purchased

3. **Bundle Type Validation**
   - Ensures mobile bundles only get mobile numbers
   - Ensures local bundles only get local numbers
   - Prevents bundle type mismatch errors during retry
   - Clear error messages if no matching alternatives found

4. **Enhanced Response**
   - Returns the actual purchased number
   - Indicates if an alternative was used
   - Logs the change in activity logs

**Example Success Response:**
```json
{
  "success": true,
  "message": "Original number was unavailable. Successfully purchased alternative number: +447414108338",
  "data": {
    "twilioNumber": { ... },
    "retellNumber": { ... }
  },
  "info": {
    "requestedNumber": "+447414108337",
    "purchasedNumber": "+447414108338",
    "note": "The requested number was no longer available, so an alternative was purchased automatically"
  }
}
```

**Example Log Output (Successful Retry with Type Match):**
```
[crud-server] info: Number type for purchase
                     phoneNumber: +447414108337
                     numberType: mobile
                     countryCode: GB
[crud-server] warn: Phone number no longer available, attempting to find alternative
                     attempt: 1
[crud-server] info: Searching for alternative number of same type
                     originalNumber: +447414108337
                     searchType: mobile
[crud-server] info: Found alternative phone number of same type, retrying purchase
                     originalNumber: +447414108337
                     newNumber: +447414108338
                     numberType: mobile
                     originalType: mobile
                     bundleCompatible: true
                     attempt: 1
[crud-server] info: Phone number purchased
                     purchasedNumber: +447414108338
                     wasAlternativeNumber: true
```

**Example Error (No Matching Alternatives):**
```
[crud-server] error: Alternative number type mismatch
                      originalNumber: +447414108337
                      originalType: mobile
                      alternativeNumber: +441204961629
                      alternativeType: local
                      bundleSid: BU3d5be36ba71da67b804b80c766250783
Error: +447414108337 is no longer available. Alternative numbers found are of 
       different type (local vs mobile) and won't match your bundle. 
       Please search for mobile numbers specifically.
```

**What Changed in v2:**
- ✅ Added pattern-based number type detection (detects from phone number format)
- ✅ Retry logic now **ONLY searches for same number type** (mobile → mobile, local → local)
- ✅ Validates alternative number type matches original before purchase
- ✅ Better error messages when no matching alternatives available
- ✅ Prevents bundle type mismatch errors during automatic retry

**UK Phone Number Type Detection:**
- `+447xxxxxxxxx` (13 digits) → **mobile**
- `+441xxxxxxxxx` or `+4420xxxxxxxx` → **local**
- `+448xxxxxxxxx` → **tollFree**

---

## Registered Connector Endpoints

The following endpoints are now properly registered in the RBAC system under the `connection` resource:

### Core Connector Routes
- `GET /api/connectors/available` → `read`
- `POST /api/connectors/:subaccountId` → `write`
- `GET /api/connectors/:subaccountId` → `read`
- `GET /api/connectors/:subaccountId/:connectorId` → `read`
- `PUT /api/connectors/:subaccountId/:connectorId` → `write`
- `DELETE /api/connectors/:subaccountId/:connectorId` → `delete`

### Phone Number Management
- `GET /api/connectors/:subaccountId/phone-numbers` → `read`
- `PUT /api/connectors/:subaccountId/phone-numbers/:phoneNumber` → `write`
- `DELETE /api/connectors/:subaccountId/phone-numbers/:phoneNumber` → `delete`

### Twilio Emergency Address
- `GET /api/connectors/:subaccountId/twilio/getEmergencyAddress` → `read`
- `POST /api/connectors/:subaccountId/twilio/setEmergencyAddress` → `write`
- `POST /api/connectors/:subaccountId/twilio/createEmergencyAddress` → `write`

### Twilio Setup (This was causing the error!)
- `POST /api/connectors/:subaccountId/twilio/setup/:emergencyAddressId` → `admin` ⭐

### Twilio Phone Numbers
- `GET /api/connectors/:subaccountId/twilio/phoneNumbers` → `read`
- `GET /api/connectors/:subaccountId/twilio/availablePhoneNumbers` → `read`
- `POST /api/connectors/:subaccountId/twilio/phoneNumbers/purchase` → `write`

### Twilio Configuration
- `PUT /api/connectors/:subaccountId/twilio/emergencyAddress` → `admin`
- `PUT /api/connectors/:subaccountId/twilio/bundle` → `admin`
- `GET /api/connectors/:subaccountId/twilio` → `read`
- `POST /api/connectors/:subaccountId/twilio/verify` → `write`
- `DELETE /api/connectors/:subaccountId/twilio/cache` → `delete`

### Other Integrations
- `POST /api/connectors/:subaccountId/handlegooglecalendar` → `write`
- `POST /api/connectors/:subaccountId/metadata/update` → `write` (service-to-service)

---

## Permission Model

### Default Permissions:
- **Super Admin**: Full access (read, write, delete, admin)
- **Admin**: Full access (read, write, delete, admin)
- **User**: Limited access (read, write only)

### Settings:
- `requiresSubaccount`: true
- `globalAdminAccess`: true (Super admins can access all connectors)
- Rate limits: 100 requests per user, 500 per subaccount per minute

---

## Testing

### Test RBAC Resolution (After clearing cache):
1. Try Twilio setup again
2. Check logs - should see:
   ```
   Resource resolution cache hit
   Resolved resource information:
     resourceName: "connection"
     requiredPermission: "admin"
   ```
3. **NO MORE 404 errors!**

### Test Phone Purchase:
1. Search for available numbers
2. Try to purchase one
3. If unavailable, system automatically:
   - Searches for alternatives
   - Purchases the first available
   - Returns clear message about the change

---

## Files Modified

### Auth Server:
- `scripts/register-connector-resource.js` (NEW) - Resource registration script
- Database: `connection` resource created/updated with 23 endpoints

### Database Server:
- `src/services/twilioService.js` - Added automatic retry logic for phone purchases
- `src/controllers/connectorController.js` - Enhanced response with alternative number info
- `scripts/clear-rbac-cache.js` (NEW) - Helper script to clear RBAC cache

---

## Next Steps

1. ✅ Clear RBAC cache (see instructions above)
2. ✅ Test Twilio setup - no more 404 errors
3. ✅ Test phone number purchase - automatic retry on "not available"
4. 🎉 Enjoy seamless Twilio integration!

---

## Notes

- The retry logic will attempt up to 3 alternative numbers
- All attempts are logged for debugging
- Activity logs track whether an alternative number was purchased
- Frontend will receive clear messaging about number substitution
- No changes needed to frontend code - works automatically!

