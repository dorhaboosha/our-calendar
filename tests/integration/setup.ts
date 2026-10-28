import "dotenv/config";

// Runs before each test file imports app code, so every Prisma client the app
// creates points at the test database, never the development one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
