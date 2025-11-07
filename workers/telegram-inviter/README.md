# Telegram Inviter Worker

External Node.js worker service for processing Telegram member invitations.

## Overview

This worker runs as a separate process and handles the heavy lifting of Telegram member invitations. It polls Supabase for pending invitation sessions and processes them using the Telegram API.

## Why External Worker?

Supabase Deno Edge Functions don't support persistent TCP connections, which are required by the Telegram library (GramJS). Therefore, invitation operations run in an external Node.js worker.

## Deployment Options

### Option 1: Google Cloud Run (Recommended) ⭐

**Pros:**
- **Free tier:** 2M requests/month, 360,000 GB-seconds/month
- **Auto-scaling:** Scales to zero when idle (pay only for usage)
- **Persistent TCP:** Full support for long-running Telegram connections
- **Long timeout:** Up to 60 minutes per request
- **Low cost:** ~$2-5/month for moderate use
- **Container-based:** Uses Docker for consistent deployments

**Cons:**
- Requires Google Cloud account and credit card
- Slightly more complex initial setup

#### Quick Start with Cloud Run

1. **Install Google Cloud SDK:**
   ```bash
   # macOS
   brew install google-cloud-sdk
   
   # Windows/Linux: Download from
   # https://cloud.google.com/sdk/docs/install
   ```

2. **Deploy with one command:**
   ```bash
   cd workers/telegram-inviter
   chmod +x deploy.sh
   ./deploy.sh
   ```

   The script will:
   - Build the Docker image
   - Push to Google Container Registry
   - Deploy to Cloud Run
   - Configure auto-scaling and timeouts

3. **Set Environment Variables:**
   
   After deployment, configure these via Cloud Run console or CLI:
   
   **Via CLI (Recommended):**
   ```bash
   # Get your Supabase service role key from:
   # https://supabase.com/dashboard/project/hmjmlqmwfarqlrhrkyla/settings/api
   
   gcloud run services update telegram-inviter-worker \
     --region=us-central1 \
     --set-env-vars="SUPABASE_URL=https://hmjmlqmwfarqlrhrkyla.supabase.co,WORKER_ID=telegram-inviter,BATCH_SIZE=10,POLL_INTERVAL=5000,LOG_LEVEL=info"
   
   # Add secret (more secure for sensitive data):
   echo "your-service-role-key" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
   
   gcloud run services update telegram-inviter-worker \
     --region=us-central1 \
     --set-secrets="SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest"
   ```
   
   **Via Console:**
   - Go to: https://console.cloud.google.com/run
   - Click on "telegram-inviter-worker"
   - Go to "Variables & Secrets" tab
   - Add environment variables

4. **Verify Deployment:**
   ```bash
   # Check logs
   gcloud run services logs read telegram-inviter-worker --region=us-central1
   
   # Get service URL
   gcloud run services describe telegram-inviter-worker --region=us-central1 --format='value(status.url)'
   ```

#### Manual Cloud Run Deployment

If you prefer manual control:

```bash
# Set your project ID
export PROJECT_ID="your-project-id"

# Build the Docker image
docker build -t gcr.io/$PROJECT_ID/telegram-inviter-worker .

# Push to Google Container Registry
docker push gcr.io/$PROJECT_ID/telegram-inviter-worker

# Deploy to Cloud Run
gcloud run deploy telegram-inviter-worker \
  --image gcr.io/$PROJECT_ID/telegram-inviter-worker \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --max-instances 1 \
  --min-instances 0
```

#### Cloud Run Configuration

The `cloudbuild.yaml` file configures:
- **Memory:** 512Mi (sufficient for worker operations)
- **CPU:** 1 core
- **Timeout:** 3600 seconds (1 hour)
- **Scaling:** 0-1 instances (auto-scales to zero when idle)
- **Region:** us-central1 (can be changed)

#### Monitoring & Logs

**View Logs:**
```bash
gcloud run services logs read telegram-inviter-worker --region=us-central1 --limit=50
```

**Cloud Console:**
- Logs: https://console.cloud.google.com/run/detail/us-central1/telegram-inviter-worker/logs
- Metrics: https://console.cloud.google.com/run/detail/us-central1/telegram-inviter-worker/metrics

---

### Option 2: Railway.app

**Pros:**
- Easier setup (GitHub integration)
- Free tier: $5/month credit
- Automatic deployments on git push

**Cons:**
- Runs continuously (uses more credits)
- Limited free tier

#### Railway Deployment

1. Create GitHub repository with `workers/telegram-inviter` content
2. Sign up at [railway.app](https://railway.app)
3. Create new project from GitHub repo
4. Set Root Directory to `workers/telegram-inviter`
5. Add environment variables in Railway dashboard:
   - `SUPABASE_URL=https://hmjmlqmwfarqlrhrkyla.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` (from Supabase dashboard)
   - `WORKER_ID=telegram-inviter`
   - `BATCH_SIZE=10`
   - `POLL_INTERVAL=5000`
   - `LOG_LEVEL=info`
6. Deploy automatically

---

### Option 3: Self-Hosted (VPS/Local)

For running on your own server or computer.

#### Local Development

```bash
cd workers/telegram-inviter
npm install
npm run dev
```

#### PM2 (Recommended for self-hosting)

PM2 keeps your worker running continuously and auto-restarts on system reboot.

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

2. **Build the project:**
   ```bash
   npm install
   npm run build
   ```

3. **Create `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

4. **Start with PM2:**
   ```bash
   pm2 start dist/index.js --name telegram-inviter
   ```

5. **Auto-start on boot:**
   ```bash
   pm2 startup
   pm2 save
   ```

**Useful PM2 commands:**
```bash
pm2 logs telegram-inviter    # View logs
pm2 status                    # Check status
pm2 restart telegram-inviter  # Restart worker
pm2 stop telegram-inviter     # Stop worker
pm2 delete telegram-inviter   # Remove from PM2
```

#### Docker (Self-hosted)

```bash
# Build
docker build -t telegram-inviter .

# Run
docker run -d \
  --name telegram-inviter \
  --env-file .env \
  --restart unless-stopped \
  telegram-inviter
```

---

## How It Works

1. **Heartbeat:** Sends status to `worker_heartbeats` table every 60 seconds
2. **Session Polling:** Checks for "running" sessions every 5 seconds
3. **Account Connection:** Connects to Telegram via GramJS (TCP works perfectly!)
4. **Invitation Process:**
   - Resolves target group entity
   - Checks invitation permissions
   - Invites members using round-robin across accounts
5. **Error Handling:**
   - **FLOOD_WAIT:** Pauses account, requeues member
   - **Permanent errors:** Marks member as "failed"
   - **Temporary errors:** Requeues member for retry
6. **Real-time Updates:** Updates Supabase tables in real-time

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | ✅ | - | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | - | Service role key (keep secret!) |
| `WORKER_ID` | ❌ | `telegram-inviter` | Worker identifier |
| `BATCH_SIZE` | ❌ | `10` | Members processed per batch |
| `POLL_INTERVAL` | ❌ | `5000` | Polling interval (ms) |
| `LOG_LEVEL` | ❌ | `info` | Log level (debug, info, warn, error) |

**Get your service role key:**
https://supabase.com/dashboard/project/hmjmlqmwfarqlrhrkyla/settings/api

## Logs

The worker outputs detailed logs:

```
[2025-11-07T12:00:00.000Z] [INFO] 🚀 Starting Telegram Inviter Worker...
[2025-11-07T12:00:01.000Z] [INFO] ✅ Supabase client initialized
[2025-11-07T12:00:01.500Z] [INFO] 💓 Heartbeat sent
[2025-11-07T12:00:02.000Z] [INFO] 📋 Processing session abc-123
[2025-11-07T12:00:03.000Z] [INFO] 🔌 Connecting account +1234567890...
[2025-11-07T12:00:05.000Z] [INFO] ✅ Connected: +1234567890
[2025-11-07T12:00:06.000Z] [INFO] 🎯 Target group resolved: Test Group
[2025-11-07T12:00:07.000Z] [INFO] ✅ Successfully invited user 123456789
```

## Troubleshooting

### Worker not running

- Verify `.env` file is correct
- Check `SUPABASE_SERVICE_ROLE_KEY` is valid
- View logs: `npm run dev` (local) or Cloud Run/Railway dashboard

### No invitations happening

- Check worker heartbeat: UI shows "Worker Offline" warning?
- Verify accounts have invitation permissions
- Check for FLOOD_WAIT errors in logs

### Connection errors

- Verify Telegram account `session_string` values are valid
- Check API credentials are correct
- Ensure network allows outbound TCP connections

## Cost Estimates

### Google Cloud Run (Recommended)
- **Free tier:** Covers most hobby/personal projects
- **Light usage (100 invitations/day):** ~$0-2/month
- **Moderate usage (1000 invitations/day):** ~$2-5/month
- **Heavy usage:** Scales automatically, pay for what you use

### Railway.app
- **Free tier:** $5/month credit
- **Continuous running:** Uses ~$5-8/month

### Self-Hosted
- **VPS (DigitalOcean, Linode):** $5-6/month
- **Local/Raspberry Pi:** Free (electricity only)

## Security

**⚠️ CRITICAL:** Keep `SUPABASE_SERVICE_ROLE_KEY` secret!

- ✅ Use only in worker environment (Cloud Run, Railway, Docker)
- ✅ Use Google Cloud Secrets for sensitive data
- ❌ Never commit to Git
- ❌ Never expose in browser/frontend code

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Supabase      │      │  Cloud Run       │      │   Telegram      │
│   Database      │◄────►│  Worker          │◄────►│   API           │
│                 │      │  (Node.js)       │      │                 │
│ • Tasks         │      │                  │      │ • Groups        │
│ • Sessions      │      │ • Polls DB       │      │ • Members       │
│ • Members       │      │ • Processes      │      │ • Invitations   │
│ • Heartbeats    │      │ • Updates DB     │      │                 │
└─────────────────┘      └──────────────────┘      └─────────────────┘
        ▲                                                    
        │                                                    
        │                ┌──────────────────┐              
        └───────────────►│   Web App        │              
                         │   (React)        │              
                         │                  │              
                         │ • Monitors       │              
                         │ • Controls       │              
                         └──────────────────┘              
```

## Support

For issues or questions:
1. Check logs first (most issues are logged)
2. Verify environment variables
3. Check Supabase connection
4. Review Telegram API credentials

## License

MIT
