#!/bin/bash

# Telegram Inviter Worker - Google Cloud Run Deployment Script
# This script deploys the worker to Google Cloud Run

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Telegram Inviter Worker - Cloud Run Deployment ===${NC}\n"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is logged in
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${YELLOW}Logging in to Google Cloud...${NC}"
    gcloud auth login
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}No project selected. Please enter your Google Cloud Project ID:${NC}"
    read -r PROJECT_ID
    gcloud config set project "$PROJECT_ID"
fi

echo -e "${GREEN}Using project: ${PROJECT_ID}${NC}\n"

# Enable required APIs
echo -e "${YELLOW}Enabling required Google Cloud APIs...${NC}"
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Set region
REGION="us-central1"
echo -e "${GREEN}Using region: ${REGION}${NC}\n"

# Build and deploy using Cloud Build
echo -e "${YELLOW}Building and deploying to Cloud Run...${NC}"
gcloud builds submit --config cloudbuild.yaml

# Get the service URL
SERVICE_URL=$(gcloud run services describe telegram-inviter-worker --region=$REGION --format='value(status.url)')

echo -e "\n${GREEN}✓ Deployment successful!${NC}"
echo -e "${GREEN}Service URL: ${SERVICE_URL}${NC}\n"

# Set environment variables
echo -e "${YELLOW}Now you need to set environment variables in Cloud Run:${NC}"
echo -e "1. Go to: https://console.cloud.google.com/run/detail/${REGION}/telegram-inviter-worker/variables?project=${PROJECT_ID}"
echo -e "2. Add these environment variables:"
echo -e "   - SUPABASE_URL: https://hmjmlqmwfarqlrhrkyla.supabase.co"
echo -e "   - SUPABASE_SERVICE_ROLE_KEY: <your-service-role-key>"
echo -e "   - WORKER_ID: telegram-inviter"
echo -e "   - BATCH_SIZE: 10"
echo -e "   - POLL_INTERVAL: 5000"
echo -e "   - LOG_LEVEL: info\n"

echo -e "${YELLOW}Or set them via CLI:${NC}"
echo -e "gcloud run services update telegram-inviter-worker \\"
echo -e "  --region=$REGION \\"
echo -e "  --set-env-vars=\"SUPABASE_URL=https://hmjmlqmwfarqlrhrkyla.supabase.co,WORKER_ID=telegram-inviter,BATCH_SIZE=10,POLL_INTERVAL=5000,LOG_LEVEL=info\" \\"
echo -e "  --set-secrets=\"SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest\"\n"

echo -e "${GREEN}Deployment complete!${NC}"
