Deployment Guide

This guide covers deploying the Computer Science Hub AI application using Docker and manual setups.
Prerequisites

     A PostgreSQL database (e.g., Supabase, Neon, or self-hosted).
     An OpenAI API Key.
     Docker and Docker Compose installed (for Docker deployment).

Environment Variables

Ensure you have the following environment variables set in your .env file or hosting platform:

DATABASE_URL="postgresql://user:password@host:port/dbname?schema=public"
NEXTAUTH_SECRET="generate_a_random_string"
NEXTAUTH_URL="https://your-domain.com"
OPENAI_API_KEY="sk-..."
Option 1: Docker Deployment (Recommended)

    Clone the repository:
    git clone https://github.com/yourusername/cs-hub-ai.git
    cd cs-hub-ai

    Configure Environment:
    Update the docker-compose.yml file with your actual NEXTAUTH_SECRET, NEXTAUTH_URL, and OPENAI_API_KEY.

    Build and Run:
    docker-compose up -d --build

    Run Database Migrations:
    Once the container is running, execute Prisma migrations inside the container:
    docker-compose exec app npx prisma db push

The app will be available at http://localhost:3000.
Option 2: Vercel Deployment (Frontend + Serverless)

    Push your repository to GitHub.
    Go to Vercel (https://vercel.com) and import the repository.
    Add your environment variables in the Vercel project settings.
    Deploy. Vercel will automatically run npm install, prisma generate, and npm run build.

Post-Deployment Steps

    Create an Admin User:
    Register a normal user through the UI.
    Then, manually change their role in your PostgreSQL database:
    UPDATE "User" SET role = 'ADMIN' WHERE email = 'your-email@example.com';

    Verify Webhooks/Health: 
    Ensure your NEXTAUTH_URL exactly matches your deployed domain to avoid authentication callback errors.