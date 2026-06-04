const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { SECRET } = require('./auth');

const router = express.Router();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Create a note for a book
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { book_id, content } = req.body;
    if (!book_id || !content) return res.status(400).json({ error: 'Book ID and content are required' });

    const db = getDb();
    const book = await db.query('SELECT id FROM books WHERE id = $1 AND user_id = $2', [book_id, req.user.userId]);
    if (book.rows.length === 0) return res.status(404).json({ error: 'Book not found' });

    const result = await db.query(
      'INSERT INTO notes (user_id, book_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.user.userId, book_id, content]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a note
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const db = getDb();
    const result = await db.query(
      'UPDATE notes SET content = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [content, req.params.id, req.user.userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a note
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
