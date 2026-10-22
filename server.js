const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_PATH || 'elitepro.db');
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('Set SESSION_SECRET to a long random secret before starting.');
  process.exit(1);
}

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 balance_paise INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 reward_paise INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS task_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 task_id INTEGER NOT NULL,
 proof TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(task_id) REFERENCES tasks(id),
 UNIQUE(user_id, task_id)
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount_paise INTEGER NOT NULL,
 kind TEXT NOT NULL,
 note TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount_paise INTEGER NOT NULL,
 upi_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);
const taskCount = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
if (!taskCount) {
  db.prepare('INSERT INTO tasks(title,description,reward_paise) VALUES (?,?,?)')
    .run('Daily creator task', 'Complete the task described by the site administrator and submit proof for review.', 1000);
}
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'elitepro.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const getUser = (req) => req.session.userId
  ? db.prepare('SELECT id, username, balance_paise, created_at FROM users WHERE id=?').get(req.session.userId)
  : null;
function auth(req, res, next) {
  if (!getUser(req)) return res.status(401).json({ error: 'Please log in first.' });
  next();
}
app.post('/api/signup', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or underscores.' });
  if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare('INSERT INTO users(username,password_hash) VALUES (?,?)').run(username, hash);
    req.session.userId = Number(info.lastInsertRowid);
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'That username may already be taken.' });
  }
});
app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Incorrect username or password.' });
  req.session.userId = user.id;
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, (req, res) => {
  const user = getUser(req);
  res.json({ username: user.username, balancePaise: user.balance_paise });
});
app.get('/api/tasks', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT t.id,t.title,t.description,t.reward_paise AS rewardPaise,
    s.status AS submissionStatus
    FROM tasks t LEFT JOIN task_submissions s ON s.task_id=t.id AND s.user_id=?
    WHERE t.active=1 ORDER BY t.id DESC
  `).all(req.session.userId));
});
app.post('/api/tasks/:id/submit', auth, (req, res) => {
  const taskId = Number(req.params.id);
  const proof = String(req.body.proof || '').trim();
  if (!Number.isInteger(taskId) || proof.length < 5 || proof.length > 500) return res.status(400).json({ error: 'Enter a short proof or reference (5–500 characters).' });
  const task = db.prepare('SELECT id FROM tasks WHERE id=? AND active=1').get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  try {
    db.prepare('INSERT INTO task_submissions(user_id,task_id,proof) VALUES (?,?,?)').run(req.session.userId, taskId, proof);
    res.json({ ok: true, message: 'Submitted for review. Rewards are added only after admin approval.' });
  } catch {
    res.status(409).json({ error: 'You have already submitted this task.' });
  }
});
app.get('/api/history', auth, (req, res) => {
  const userId = req.session.userId;
  res.json({
    ledger: db.prepare('SELECT amount_paise AS amountPaise,kind,note,created_at AS createdAt FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 50').all(userId),
    withdrawals: db.prepare('SELECT amount_paise AS amountPaise,status,created_at AS createdAt FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50').all(userId)
  });
});
app.post('/api/withdraw', auth, (req, res) => {
  const amount = Math.round(Number(req.body.amount) * 100);
  const upiId = String(req.body.upiId || '').trim();
  if (!Number.isInteger(amount) || amount < 1000 || amount > 1000000) return res.status(400).json({ error: 'Minimum withdrawal is ₹10; maximum request is ₹10,000.' });
  if (!/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) return res.status(400).json({ error: 'Enter a valid UPI ID.' });
  const transact = db.transaction(() => {
    const user = db.prepare('SELECT balance_paise FROM users WHERE id=?').get(req.session.userId);
    if (!user || user.balance_paise < amount) throw new Error('Insufficient available balance.');
    db.prepare('UPDATE users SET balance_paise=balance_paise-? WHERE id=?').run(amount, req.session.userId);
    db.prepare('INSERT INTO withdrawals(user_id,amount_paise,upi_id) VALUES (?,?,?)').run(req.session.userId, amount, upiId);
    db.prepare('INSERT INTO ledger(user_id,amount_paise,kind,note) VALUES (?,?,?,?)').run(req.session.userId, -amount, 'withdrawal_hold', 'Withdrawal request pending review');
  });
  try { transact(); res.json({ ok: true, message: 'Withdrawal request received. This starter does not send money automatically; an authorized admin must review and pay it.' }); }
  catch (e) { res.status(400).json({ error: e.message || 'Could not create withdrawal request.' }); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'ElitePro' }));

app.listen(PORT, () => console.log(`ElitePro running on port ${PORT}`));
