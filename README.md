# ElitePro starter (real-backend foundation)

This is a starter application, not a finished or legally reviewed earning business. It includes:
- Responsive dashboard inspired by the supplied screenshot
- Account signup/login with password hashing and server-side sessions
- Task submission and admin-review status field
- Balance ledger and withdrawal request records
- SQLite persistence

## Important before using real money
This starter does **not** automatically pay users and does not verify YouTube subscriptions. Rewards are not credited until a trusted admin review flow is built. Do not advertise guaranteed earnings or show balances that users have not actually earned. You must define a legitimate funding source, fair task rules, fraud prevention, privacy policy, terms, age eligibility, and support process. Use a compliant payment provider and follow its onboarding/KYC requirements. Never ask users for OTPs or banking passwords.

## Run locally
Requires Node.js 20+.
1. Extract this folder.
2. In the folder run `npm install`.
3. Set a long random `SESSION_SECRET` environment variable.
4. Run `npm start`.
5. Open `http://localhost:3000`.

For production, use HTTPS, a persistent database and session store, rate limiting, CSRF protections, backups, logging, and a secure admin interface. Do not deploy with default or shared secrets. The current SQLite balance and withdrawal flow is only a starter; it needs an audited admin review/refund process before real payouts.

## Environment
- `SESSION_SECRET`: required, long random secret
- `PORT`: optional (hosting provider usually sets this)
- `DB_PATH`: optional persistent path for SQLite
- `NODE_ENV=production`: enables secure session cookie
