# AI Insights Setup Guide

## Quick Start

### 1. Install Dependencies

The OpenAI package has already been installed:
```bash
npm install openai
```

### 2. Configure Environment Variables

Add to your `.env` file:

```env
# ============================================
# AI INSIGHTS CONFIGURATION
# ============================================

# Required: Your OpenAI API Key
# Get from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-your-api-key-here

# Optional: OpenAI Model (default: gpt-4o-mini)
# Options: gpt-4o-mini, gpt-4o, gpt-4-turbo, gpt-3.5-turbo
OPENAI_MODEL=gpt-4o-mini

# Optional: Max tokens for response (default: 2000)
# Range: 500-4000 (higher = more detailed but costly)
OPENAI_MAX_TOKENS=2000

# Optional: Temperature for AI creativity (default: 0.7)
# Range: 0.0-1.0 (0 = deterministic, 1 = creative)
OPENAI_TEMPERATURE=0.7
```

### 3. Test the Setup

```bash
# Start your server
npm start

# Test the API (replace with your actual token and subaccount ID)
curl -X GET "http://localhost:3002/api/ai-insights/your_subaccount_id" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Getting Your OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Click **"Create new secret key"**
5. Copy the key (starts with `sk-proj-...` or `sk-...`)
6. Add it to your `.env` file

⚠️ **Important**: 
- Keep your API key secret
- Never commit it to version control
- Rotate keys regularly for security

## Model Selection Guide

### gpt-4o-mini (Recommended)
- **Cost**: ~$0.01-0.03 per insight
- **Speed**: Fast (2-3 seconds)
- **Quality**: Good for most use cases
- **Best for**: Production, cost-conscious deployments

### gpt-4o
- **Cost**: ~$0.05-0.10 per insight
- **Speed**: Fast (3-4 seconds)
- **Quality**: Excellent, more nuanced insights
- **Best for**: High-value customers, detailed analysis

### gpt-4-turbo
- **Cost**: ~$0.03-0.06 per insight
- **Speed**: Medium (3-4 seconds)
- **Quality**: Very good balance
- **Best for**: Balanced cost/quality needs

### gpt-3.5-turbo (Budget)
- **Cost**: ~$0.005-0.01 per insight
- **Speed**: Very fast (1-2 seconds)
- **Quality**: Basic but functional
- **Best for**: Development, testing, high-volume low-cost

## Cost Management

### Monthly Cost Estimates

**With default caching (24 hours):**
- 1 subaccount: ~$0.30 - $0.90/month (gpt-4o-mini)
- 10 subaccounts: ~$3 - $9/month
- 100 subaccounts: ~$30 - $90/month

**Without caching (forcing every request):**
- Costs can increase 10-50x
- Not recommended for production

### Cost Optimization Tips

1. **Use the 24-hour cache** (default behavior)
   ```bash
   # Good: Uses cache
   GET /api/ai-insights/sub_abc123
   
   # Use sparingly: Forces new generation
   GET /api/ai-insights/sub_abc123?force=true
   ```

2. **Choose the right model**
   - Development/Testing: `gpt-4o-mini`
   - Production: `gpt-4o-mini` (start here)
   - Premium features: Upgrade to `gpt-4o` if needed

3. **Set reasonable token limits**
   ```env
   # Good balance
   OPENAI_MAX_TOKENS=2000
   
   # More detailed (higher cost)
   OPENAI_MAX_TOKENS=3000
   
   # Minimal (lower cost)
   OPENAI_MAX_TOKENS=1000
   ```

4. **Monitor usage**
   - Check OpenAI dashboard regularly
   - Set up usage alerts in OpenAI platform
   - Review monthly bills

### Setting Up Usage Limits in OpenAI

1. Go to [OpenAI Settings](https://platform.openai.com/account/limits)
2. Set a **monthly budget limit**
3. Configure **usage alerts** (e.g., at 50%, 75%, 90%)
4. Review usage regularly

## Implementation Details

### How It Works

1. **User requests insights**: `GET /api/ai-insights/:subaccountId`

2. **System checks cache**:
   - If insights exist and < 24 hours old → return cached (instant)
   - If insights > 24 hours old or `force=true` → generate new

3. **Generate new insights**:
   - Fetch activities from last 7 days
   - Aggregate statistics
   - Send summary to OpenAI
   - Parse and store insights
   - Return to user

4. **Store in database**:
   - Saved in `ai_insights` collection
   - Includes timestamp, model used, activity count
   - Available for historical comparison

### Cache Strategy

```javascript
// Automatic caching (recommended)
const insights = await fetch('/api/ai-insights/sub_abc123');
// First request: 3-5 seconds (generates)
// Next 24 hours: <100ms (cached)

// Force new generation (use sparingly)
const freshInsights = await fetch('/api/ai-insights/sub_abc123?force=true');
// Always 3-5 seconds + OpenAI costs
```

### Data Flow

```
User Request
    ↓
Check Cache (< 24 hours?)
    ↓ (yes)
Return Cached Insights (fast)
    ↓ (no)
Fetch Last 7 Days Activities
    ↓
Aggregate Statistics
    ↓
Generate AI Prompt
    ↓
Call OpenAI API
    ↓
Parse Response
    ↓
Store in Database
    ↓
Return Insights
```

## Testing

### 1. Basic Test

```bash
# Get insights (will generate first time)
curl -X GET "http://localhost:3002/api/ai-insights/sub_abc123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected response time:
- First request: 3-5 seconds
- Subsequent requests (24h): <100ms

### 2. Force Generation Test

```bash
# Force new generation
curl -X GET "http://localhost:3002/api/ai-insights/sub_abc123?force=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: Always 3-5 seconds

### 3. History Test

```bash
# Get insights history
curl -X GET "http://localhost:3002/api/ai-insights/sub_abc123/history?limit=5" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: <50ms

### 4. Error Handling Test

```bash
# Test without API key (should fail gracefully)
# Remove OPENAI_API_KEY from .env temporarily
curl -X GET "http://localhost:3002/api/ai-insights/sub_abc123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: Error message about missing API key

## Monitoring

### Server Logs

Monitor logs for:
```
[INFO] AI Insights Service initialized { model: 'gpt-4o-mini', enabled: true }
[INFO] Generating AI insights { subaccountId: 'sub_abc123', force: false }
[INFO] Using cached insights { subaccountId: 'sub_abc123', age: 3600000 }
[INFO] AI insights generated and stored { activitiesAnalyzed: 156 }
```

### OpenAI Dashboard

Monitor in [OpenAI Usage Dashboard](https://platform.openai.com/usage):
- Total requests
- Token usage
- Costs
- Error rates

### Database

Check `ai_insights` collection:
```javascript
db.ai_insights.find().sort({ generatedAt: -1 }).limit(10)
```

## Troubleshooting

### Issue: "AI Insights service is not enabled"

**Cause**: Missing or invalid `OPENAI_API_KEY`

**Solution**:
1. Check `.env` file has `OPENAI_API_KEY=sk-...`
2. Verify key is valid in OpenAI dashboard
3. Restart server after adding key

### Issue: Slow response times

**Cause**: Network latency to OpenAI servers

**Solution**:
1. This is normal for first generation (3-5 seconds)
2. Use caching (default) for instant subsequent requests
3. Consider upgrading server location closer to OpenAI servers

### Issue: High costs

**Cause**: Too many forced regenerations

**Solution**:
1. Remove `force=true` from most requests
2. Let 24-hour cache work
3. Switch to cheaper model (gpt-4o-mini)
4. Reduce `OPENAI_MAX_TOKENS`

### Issue: Empty or poor insights

**Cause**: Not enough activity data

**Solution**:
1. Generate some test activities first
2. Wait until you have meaningful data
3. System returns "No activities" message if < 1 activity

### Issue: Rate limit errors

**Cause**: Too many requests to OpenAI

**Solution**:
1. Respect 24-hour cache
2. Don't force regeneration frequently
3. Implement request queuing if needed

## Production Checklist

- [ ] OpenAI API key added to `.env`
- [ ] Model selected (`gpt-4o-mini` recommended)
- [ ] Usage limits set in OpenAI dashboard
- [ ] Cost alerts configured
- [ ] Server logs monitored
- [ ] Test insights generation works
- [ ] Test caching works (second request is fast)
- [ ] Rate limiting in place (20 req/min)
- [ ] Error handling tested
- [ ] Documentation reviewed by team

## Security Best Practices

1. **Environment Variables**
   - Never commit `.env` to git
   - Use secrets management in production
   - Rotate keys regularly

2. **API Key Protection**
   - Keep keys secret
   - Use different keys for dev/staging/prod
   - Monitor for unauthorized usage

3. **Access Control**
   - Ensure JWT authentication is working
   - Verify users can only access their subaccount insights
   - Enable RBAC if available

4. **Rate Limiting**
   - Keep rate limits in place (20 req/min)
   - Monitor for abuse patterns
   - Block suspicious IPs if needed

## Support

For issues or questions:
1. Check logs: `logs/database-server.log`
2. Review OpenAI status: https://status.openai.com/
3. Verify API key in OpenAI dashboard
4. Check documentation: `AI_INSIGHTS_API.md`

## Next Steps

After setup:
1. Generate first insights for a test subaccount
2. Review the insights quality
3. Adjust model/settings if needed
4. Integrate into your dashboard UI
5. Set up monitoring and alerts
6. Train team on using insights
