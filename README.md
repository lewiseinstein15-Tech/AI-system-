Computer Science Hub AI

An elite AI-powered learning platform for Computer Science students, featuring a ChatGPT-style interface, role-based access, and comprehensive knowledge engines.
Tech Stack

    Framework: Next.js 14 (App Router, Server Components, API Routes)
    Language: TypeScript
    Database: PostgreSQL with Prisma ORM
    Authentication: NextAuth.js (JWT, Role-Based)
    AI: OpenAI API (GPT-4, Streaming Responses)
    Styling: Tailwind CSS (Black & Neon Green Theme)
    UI Components: Radix UI, Lucide Icons
    Deployment: Docker, GitHub Actions

Features

    AI Chat Interface: ChatGPT-style layout with streaming responses, markdown rendering, and syntax highlighting.
    Role-Based Access: Student, Lecturer, and Administrator roles.
    Student Dashboard: Progress tracking, saved notes, assignments, and recommended topics.
    Admin Dashboard: User management, database backup/restore, and system settings.
    Knowledge Engine: Support for programming, mathematics, algorithms, data structures, and more.
    Security: JWT authentication, password hashing (bcrypt), input validation (Zod), and secure headers.
    Responsive Design: Optimized for mobile, tablet, and desktop.

Getting Started
Prerequisites

    Node.js 18+ and npm
    PostgreSQL database
    OpenAI API Key

Installation

    Clone the repository:

    git clone https://github.com/yourusername/cs-hub-ai.gitcd cs-hub-ai

    Install dependencies:
    bash
     
      
     
     
    npm install
     
     

    Set up environment variables:
    Create a .env file in the root directory based on .env.example.

    Initialize the database:
    bash
     
      
     
     
    npx prisma db push
     
     

    Run the development server:
    bash
     
      
     
     
    npm run dev
     
     

The application will be available at http://localhost:3000.
Deployment
Docker

    Build and run with Docker Compose:
    bash
     
      
     
     
    docker-compose up -d
     
     

    The app will be available at http://localhost:3000.

CI/CD

The GitHub Actions workflow (.github/workflows/ci.yml) automatically builds, tests, and pushes the Docker image to DockerHub on every push to the main branch.
Project Structure
text
 
  
 
 
cs-hub-ai/
├── src/
│   ├── app/              # Next.js App Router (Pages, API routes)
│   ├── components/       # Reusable React components
│   ├── lib/              # Utilities, Prisma client, Auth config
│   └── hooks/            # Custom React hooks
├── prisma/
│   └── schema.prisma     # Database schema
├── public/               # Static assets
├── .github/workflows/    # CI/CD pipeline
├── Dockerfile            # Docker configuration
├── docker-compose.yml    # Docker Compose configuration
└── package.json          # Project dependencies
 
 
License

MIT
```