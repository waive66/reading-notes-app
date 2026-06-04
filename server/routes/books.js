const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');
const { SECRET } = require('./auth');

const router = express.Router();

// 云部署时图片上传到本地目录（也可改用云存储）
let upload;
try {
  const storage = multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
    }
  });
  upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    }
  });
} catch (e) {
  upload = multer({ dest: '/tmp/uploads' });
}

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

// Get all books for current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query('SELECT * FROM books WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single book with its notes
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const bookResult = await db.query('SELECT * FROM books WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ error: 'Book not found' });

    const notesResult = await db.query('SELECT * FROM notes WHERE book_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ ...bookResult.rows[0], notes: notesResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a book
router.post('/', authMiddleware, upload.single('cover'), async (req, res) => {
  try {
    const { title, author } = req.body;
    if (!title) return res.status(400).json({ error: 'Book title is required' });

    const coverImage = req.file ? `/uploads/${req.file.filename}` : '';
    const db = getDb();
    const result = await db.query(
      'INSERT INTO books (user_id, title, author, cover_image) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.userId, title, author || '', coverImage]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a book
router.put('/:id', authMiddleware, upload.single('cover'), async (req, res) => {
  try {
    const db = getDb();
    const bookResult = await db.query('SELECT * FROM books WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ error: 'Book not found' });

    const book = bookResult.rows[0];
    const { title, author } = req.body;
    const coverImage = req.file ? `/uploads/${req.file.filename}` : book.cover_image;

    const result = await db.query(
      'UPDATE books SET title = $1, author = $2, cover_image = $3 WHERE id = $4 RETURNING *',
      [title || book.title, author !== undefined ? author : book.author, coverImage, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a book
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query('DELETE FROM books WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ message: 'Book deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
