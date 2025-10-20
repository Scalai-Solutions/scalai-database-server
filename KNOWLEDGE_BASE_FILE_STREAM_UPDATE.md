# Knowledge Base Creation with Resources - Complete Implementation

## Summary
Updated the knowledge base controller to create KBs with all resources in one call and properly handle file uploads using disk storage and file streams, matching the Retell SDK's expected format and the working implementation pattern.

## Changes Made

### 1. Changed Multer Storage to Disk Storage (`knowledgeBaseRoutes.js`)

**Old Approach:**
```javascript
const storage = multer.memoryStorage(); // Stores files in memory as buffers
```

**New Approach:**
```javascript
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const fs = require('fs');
    const uploadDir = 'uploads/knowledge-base';
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
  }
});
```

**Why:**
- Disk storage allows creating file streams with `fs.createReadStream()`
- Retell SDK requires proper file streams (not buffers)
- Enables proper cleanup after processing

### 2. Updated KB Creation Logic (`knowledgeBaseController.js`)

**Key Changes:**

**A. Create KB WITH Resources in One Call:**
```javascript
if (!existingKB) {
  // KB doesn't exist - create it WITH the resource in one call
  const kbConfig = {
    knowledge_base_name: `Global KB - ${subaccountId}`,
    knowledge_base_texts: initialSources?.knowledge_base_texts || [],
    knowledge_base_urls: initialSources?.knowledge_base_urls || [],
    knowledge_base_files: initialSources?.knowledge_base_files || []
  };
  const kbResponse = await retell.createKnowledgeBase(kbConfig);
}
```

**B. File Stream Creation from Disk:**
```javascript
else if (type === RESOURCE_TYPES.DOCUMENT) {
  // For file uploads, create read stream from disk path
  const fileStream = fs.createReadStream(file.path);
  sources.knowledge_base_files = [fileStream];
}
```

**C. File Cleanup After Processing:**
```javascript
// Clean up uploaded file after successful processing
if (file && file.path && fs.existsSync(file.path)) {
  fs.unlinkSync(file.path);
  Logger.info('Uploaded file cleaned up', { operationId, filePath: file.path });
}

// Also cleanup on error
catch (error) {
  if (file && file.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}
```

### 3. Added Upload Directory to `.gitignore`

```
# Uploads
uploads/
```

## How It Works

### Current Architecture
The system maintains:
- **ONE global knowledge base** per subaccount (holds all global resources)
- **ONE local knowledge base** per agent (holds agent-specific resources)

### File Upload Flow (Updated)

1. **Client uploads file** → Multer saves it to `uploads/knowledge-base/` directory
2. **Controller receives file** → File path available at `req.file.path`
3. **Check if KB exists:**
   - **KB doesn't exist** → Create KB WITH the resource in one Retell API call
   - **KB exists** → Add source to existing KB
4. **Create file stream** → Use `fs.createReadStream(file.path)`
5. **Calls Retell SDK** → Sends stream to `createKnowledgeBase()` or `addKnowledgeBaseSources()`
6. **Retell processes file** → Returns KB/source metadata
7. **Saves metadata** → Stores resource info in MongoDB
8. **Cleanup** → Delete uploaded file from disk with `fs.unlinkSync()`

### Example Usage (Matching Retell SDK Format)

The implementation now matches the Retell SDK pattern exactly:

```javascript
// Retell SDK Example (from documentation)
const knowledgeBaseResponse = await client.knowledgeBase.create({
  knowledge_base_name: "Sample KB",
  knowledge_base_texts: [
    {
      text: "Hello, how are you?",
      title: "Sample Question",
    },
  ],
  knowledge_base_urls: [
    "https://www.retellai.com",
    "https://docs.retellai.com",
  ],
  knowledge_base_files: [
    fs.createReadStream("../sample.txt"), // ← Stream expected
  ],
});
```

**Our implementation (when KB doesn't exist):**
```javascript
// Prepare sources
const sources = {
  knowledge_base_texts: [{ text, title }],
  knowledge_base_urls: [url],
  knowledge_base_files: [fs.createReadStream(file.path)] // ← Create stream from disk
};

// Create KB with all resources in one call
const kbConfig = {
  knowledge_base_name: `Global KB - ${subaccountId}`,
  ...sources
};
const kbResponse = await retell.createKnowledgeBase(kbConfig);
```

**Our implementation (when KB exists):**
```javascript
// Create file stream from disk
const fileStream = fs.createReadStream(file.path);
sources.knowledge_base_files = [fileStream];

// Add to existing KB
await retell.addKnowledgeBaseSources(kb.knowledgeBaseId, sources);

// Clean up file
fs.unlinkSync(file.path);
```

## Why This Update Was Needed

### Previous Issues
1. **Memory Buffer Approach:**
   - Multer stored files as **buffers** in memory (`req.file.buffer`)
   - Retell SDK expects **proper file streams** (like `fs.createReadStream()`)
   - Converting buffers to streams wasn't fully compatible

2. **Empty KB Creation:**
   - Previous approach created empty KBs first, then added sources
   - Not optimal - two API calls instead of one
   - Risk of creating empty KBs if source addition failed

3. **No File Cleanup:**
   - No mechanism to clean up uploaded files
   - Could lead to disk space issues over time

### Solution
1. **Disk Storage:**
   - Store files temporarily on disk with multer disk storage
   - Create proper file streams with `fs.createReadStream()`
   - Full compatibility with Retell SDK

2. **Create KB with Resources:**
   - Create KB with all resources in one Retell API call
   - More efficient (single API call)
   - Atomic operation - all or nothing

3. **File Cleanup:**
   - Delete uploaded files after successful processing
   - Delete files on error as well
   - Prevents disk space buildup

## Benefits

1. **Proper SDK Compatibility** - Matches expected Retell SDK format exactly
2. **Efficient API Usage** - Creates KB with resources in one call when possible
3. **Better Resource Management** - Files are cleaned up after processing
4. **More Reliable** - Uses proven working pattern from production code
5. **Proper Error Handling** - Cleanup happens on both success and failure
6. **Disk Space Management** - No leftover files accumulating on server

## Testing

To test the file upload functionality:

```bash
# Upload a document to global KB
curl -X POST http://localhost:3001/api/knowledge-base/{subaccountId}/resources \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "type=document" \
  -F "scope=global" \
  -F "file=@/path/to/your/document.pdf"

# Upload a document to local KB (agent-specific)
curl -X POST http://localhost:3001/api/knowledge-base/{subaccountId}/resources \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "type=document" \
  -F "scope=local" \
  -F "agentId=agent_xyz" \
  -F "file=@/path/to/your/document.txt"
```

## Related Files

- `/src/controllers/knowledgeBaseController.js` - Updated resource addition logic and file handling
- `/src/routes/knowledgeBaseRoutes.js` - Changed multer to disk storage
- `/src/utils/retell.js` - Retell SDK wrapper (unchanged, already correct)
- `/.gitignore` - Added uploads/ directory

## Important Notes

### File Management
- **File size limit:** 50MB (configured in multer)
- **Upload directory:** `uploads/knowledge-base/`
- **Filename format:** `file-{timestamp}-{random}-{originalname}`
- **Cleanup:** Files deleted immediately after processing (success or error)
- **Git:** Upload directory is gitignored

### Supported File Types
As per Retell documentation:
- PDF, TXT, DOC, DOCX, and other document formats
- Check Retell docs for full list

### Key Behavioral Changes

1. **First Resource Addition:**
   - Creates KB with the resource in one call
   - More efficient than creating empty KB + adding source

2. **Subsequent Resource Additions:**
   - Adds source to existing KB
   - Uses `addKnowledgeBaseSources()` method

3. **File Lifecycle:**
   - Upload → Save to disk → Create stream → Send to Retell → Delete file
   - Total disk time: seconds (only during API processing)

### Error Handling

The system includes comprehensive cleanup:
- Deletes uploaded files on any error
- Rolls back KB creation if source addition fails  
- Logs all cleanup attempts for debugging

