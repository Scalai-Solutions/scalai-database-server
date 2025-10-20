# Knowledge Base - Delete Last Resource Fix

## Issue
Retell API doesn't allow deleting the last source from a knowledge base. The API returns:
```
400 cannot delete the last source, delete the knowledge base instead
```

## Root Cause
When trying to delete the last resource from a KB, we were calling `deleteKnowledgeBaseSource()` which Retell doesn't allow. The entire knowledge base must be deleted instead.

Additionally, there was a data sync issue: MongoDB's resource count could differ from Retell's actual source count, causing the check to fail.

## Solution

### 1. Check Retell's Actual Source Count (Not MongoDB)
**Before (Wrong):**
```javascript
// ❌ Checking MongoDB count (could be out of sync)
const isLastResource = kb.resources.length === 1;
```

**After (Correct):**
```javascript
// ✅ Check actual source count from Retell (source of truth)
const retellKB = await retell.getKnowledgeBase(kb.knowledgeBaseId);
const actualSourceCount = retellKB.knowledge_base_sources?.length || 0;
const isLastResource = actualSourceCount === 1;
```

### 2. Delete Entire KB When Last Resource

```javascript
if (isLastResource) {
  // Delete the entire KB from Retell
  await retell.deleteKnowledgeBase(kb.knowledgeBaseId);
  
  // Delete KB from MongoDB
  await kbCollection.deleteOne({ _id: kb._id });
  
  // Remove KB ID from agents
  if (kb.type === SCOPE_TYPES.LOCAL) {
    // Remove from specific agent
    await agentsCollection.updateOne(
      { subaccountId, agentId: kb.agentId },
      { $pull: { knowledgeBaseIds: kb.knowledgeBaseId } }
    );
  } else {
    // Remove from all agents in subaccount
    await agentsCollection.updateMany(
      { subaccountId },
      { $pull: { knowledgeBaseIds: kb.knowledgeBaseId } }
    );
  }
} else {
  // Delete single source (normal case)
  await retell.deleteKnowledgeBaseSource(kb.knowledgeBaseId, resource.sourceId);
  
  // Remove resource from MongoDB
  await kbCollection.updateOne(
    { _id: kb._id },
    { $pull: { resources: { resourceId: resourceId } } }
  );
}
```

## Behavior

### Scenario 1: Delete Resource (KB has 2+ sources)
```
1. Fetch KB from Retell → Count sources
2. actualSourceCount = 2+ ✅
3. Delete single source from Retell ✅
4. Update MongoDB (remove resource) ✅
5. KB remains with other resources ✅
```

**Response:**
```json
{
  "success": true,
  "message": "Resource deleted successfully",
  "data": {
    "resourceId": "res_123",
    "knowledgeBaseId": "kb_456",
    "knowledgeBaseDeleted": false
  }
}
```

### Scenario 2: Delete Last Resource (KB has 1 source)
```
1. Fetch KB from Retell → Count sources
2. actualSourceCount = 1 ✅
3. Delete entire KB from Retell ✅
4. Delete KB record from MongoDB ✅
5. Remove KB ID from all agents ✅
6. Invalidate caches ✅
```

**Response:**
```json
{
  "success": true,
  "message": "Resource deleted successfully (knowledge base removed as it was the last resource)",
  "data": {
    "resourceId": "res_123",
    "knowledgeBaseId": "kb_456",
    "knowledgeBaseDeleted": true
  }
}
```

## Logging

The system now logs detailed information:

```javascript
// Before deletion
Logger.info('Checking resource count before deletion', {
  operationId,
  mongoResourceCount: 3,
  retellSourceCount: 1,  // ← Actual count from Retell
  isLastResource: true
});

// If last resource
Logger.info('Deleting last resource - will delete entire KB', {
  operationId,
  knowledgeBaseId: 'kb_456',
  sourceCount: 1
});

Logger.info('Knowledge base deleted (was last resource)', {
  operationId,
  knowledgeBaseId: 'kb_456'
});

// If not last resource
Logger.info('Resource deleted from KB', {
  operationId,
  knowledgeBaseId: 'kb_456',
  remainingResources: 2
});
```

## Why Check Retell Instead of MongoDB?

MongoDB can get out of sync with Retell due to:
1. **Failed operations** - Retell succeeds but MongoDB fails
2. **Manual changes** - Direct Retell API calls outside our system
3. **Partial rollbacks** - Error handling that only cleans up one side
4. **Race conditions** - Concurrent operations

By checking Retell's actual source count, we ensure:
- ✅ Always accurate count
- ✅ Prevents "cannot delete last source" error
- ✅ Handles out-of-sync scenarios gracefully

## Next Resource Addition

After the KB is deleted:
1. User adds new resource to same scope
2. System checks for KB → Not found
3. Creates new KB with resource in one call ✅
4. Links new KB to agents ✅

## Testing

### Test Case 1: Delete Last Resource
```bash
# Add one resource
curl -X POST /api/knowledge-base/sub123/resources \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"text","scope":"global","text":"Test","title":"Test"}'

# Delete it (should delete entire KB)
curl -X DELETE /api/knowledge-base/sub123/resources/{resourceId} \
  -H "Authorization: Bearer $TOKEN"

# Expected: KB deleted, message confirms it was last resource
```

### Test Case 2: Delete One of Many Resources
```bash
# Add two resources
curl -X POST /api/knowledge-base/sub123/resources ...
curl -X POST /api/knowledge-base/sub123/resources ...

# Delete one
curl -X DELETE /api/knowledge-base/sub123/resources/{resourceId} \
  -H "Authorization: Bearer $TOKEN"

# Expected: Only resource deleted, KB still exists with other resource
```

## Files Modified

- ✅ `/src/controllers/knowledgeBaseController.js` - Delete resource logic with Retell source count check

## Related Issues

- Fixed: "400 cannot delete the last source" error
- Fixed: MongoDB/Retell sync issues causing wrong resource count
- Added: Automatic KB cleanup when last resource deleted
- Added: Agent KB ID cleanup

## References

- Retell API Docs: Knowledge Base deletion
- `/src/controllers/knowledgeBaseController.js:799-977` - Delete resource implementation

