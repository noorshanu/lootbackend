const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { setupSolanaConnection, checkDevnetStatus } = require('./solana/connection');
const lootboxRoutes = require('./routes/lootbox.routes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Debug middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/lootbox', lootboxRoutes);

// Health check endpoint with devnet status
app.get('/health', async (req, res) => {
  try {
    const devnetStatus = await checkDevnetStatus();
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      devnet: {
        operational: devnetStatus,
        network: process.env.SOLANA_NETWORK || 'devnet'
      }
    });
  } catch (error) {
    console.error('[ERROR] Health check failed:', error);
    res.status(500).json({ 
      status: 'error',
      error: error.message 
    });
  }
});

// Initialize Solana connection
const startServer = async () => {
  try {
    console.log('[DEBUG] Starting server initialization...');
    
    // Setup Solana connection
    await setupSolanaConnection();
    
    // Check devnet status
    await checkDevnetStatus();
    
    app.listen(PORT, () => {
      console.log(`[DEBUG] Server is running on port ${PORT}`);
      console.log(`[DEBUG] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('[ERROR] Failed to start server:', error);
    process.exit(1);
  }
};

startServer(); 