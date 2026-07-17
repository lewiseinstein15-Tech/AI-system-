API Documentation

Base URL: /api
Authentication
POST /api/auth/register

Registers a new user.

     Body: { "name": "string", "email": "string", "password": "string" }
     Response: 201 Created

POST /api/auth/login (Handled by NextAuth)

Logs in a user and returns a JWT session token.

     Body: { "email": "string", "password": "string" }

Conversations & Chat
GET /api/conversations

Fetches all conversations for the authenticated user.
POST /api/conversations

Creates a new conversation.

     Body: { "title": "string" }

GET /api/conversations/[id]

Fetches a specific conversation and its messages.
PATCH /api/conversations/[id]

Renames a conversation.

     Body: { "title": "string" }

DELETE /api/conversations/[id]

Deletes a conversation.
POST /api/chat

Streams an AI response based on message history.

     Body: { "messages": [{ "role": "user", "content": "string" }], "conversationId": "string (optional)" }
     Response: Streaming Text Response

Notes
GET /api/notes

Fetches all notes for the authenticated user.
POST /api/notes

Creates a new note.

     Body: { "title": "string", "content": "string" }

PATCH /api/notes/[id]

Updates a note.
DELETE /api/notes/[id]

Deletes a note.
Flashcards
GET /api/flashcards

Fetches all flashcards for the user.
POST /api/flashcards

Creates a flashcard.

     Body: { "front": "string", "back": "string" }

DELETE /api/flashcards/[id]

Deletes a flashcard.
Admin
GET /api/admin/users

(Admin Only) Fetches all users in the system.
GET /api/subjects

Fetches all subjects.
POST /api/subjects

(Admin/Lecturer Only) Creates a new subject.