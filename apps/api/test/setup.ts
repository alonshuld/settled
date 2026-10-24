process.env.DATABASE_URL ??= 'postgresql://settled:settled@localhost:5432/settled';
process.env.CRON_SECRET ??= 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.BETTER_AUTH_SECRET ??= 'test-auth-secret-test-auth-secret-1234';
process.env.APP_URL = 'http://localhost:3000';
