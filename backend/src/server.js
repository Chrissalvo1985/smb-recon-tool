const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const scanRoutes = require('./routes/scan');
const shareRoutes = require('./routes/share');
const logger = require('./utils/logger');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3005"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3005;
const FRONTEND_BUILD = path.join(__dirname, '../../frontend/build');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

app.use('/api/scan', scanRoutes);
app.use('/api/share', shareRoutes);

app.use(express.static(FRONTEND_BUILD));

app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res, next) => {
  res.sendFile(path.join(FRONTEND_BUILD, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make io accessible to routes
app.set('io', io);

server.listen(PORT, () => {
  logger.info(`SMB Recon Tool running on http://localhost:${PORT}`);
});

module.exports = { app, server, io };