#!/bin/bash
cd "$(dirname "$0")/server"
node -e "
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./database');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
(async () => {
  await initDb();
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/books', require('./routes/books'));
  app.use('/api/notes', require('./routes/notes'));
  app.listen(3001, () => console.log('Backend ready on http://localhost:3001'));
})();
" &
sleep 2
cd "$(dirname "$0")/client"
npx vite --host 0.0.0.0 &
sleep 3
echo "=== ALL READY ==="
echo "Frontend: http://localhost:5173"
echo "Backend:  http://localhost:3001"
wait
