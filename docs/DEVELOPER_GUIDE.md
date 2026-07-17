Developer Guide
Setting Up the Development Environment
1. Prerequisites

    Node.js 18.x or 20.x
    PostgreSQL (Local or Cloud)
    Git

2. Installation

Clone the repository and install dependencies:

git clone https://github.com/yourusername/cs-hub-ai.gitcd cs-hub-ainpm install

3. Environment Setup

Create a .env file in the root directory:
env
 
  
 
 
DATABASE_URL="postgresql://user:password@localhost:5432/cs_hub?schema=public"
NEXTAUTH_SECRET="your_dev_secret"
NEXTAUTH_URL="http://localhost:3000"
OPENAI_API_KEY="sk-..."
 
 
4. Database Setup

Initialize your database schema:
bash
 
  
 
 
npx prisma db push
 
 

To view your database visually:
bash
 
  
 
 
npx prisma studio
 
 
5. Running the App

Start the development server:
bash
 
  
 
 
npm run dev
 
 

Visit http://localhost:3000.
Coding Standards
TypeScript

     Strict mode is enabled. Always define types for function parameters and return values.
     Avoid any. Use unknown if the type is truly unknown, then narrow it down.

React Components

     Use functional components with hooks.
     Use "use client" directive ONLY when necessary (e.g., event handlers, state).
     Prefer Server Components for data fetching and static rendering.

API Routes

     Always wrap logic in try/catch blocks.
     Validate inputs using zod schemas before processing.
     Return standardized JSON error responses: { error: "Message", details: {} }.

Database (Prisma)

     Always use the shared Prisma instance from src/lib/prisma.ts to avoid connection exhaustion.
     Use transactions for multi-record operations to ensure data integrity.

text
 
  
 
 
Enter your code here...