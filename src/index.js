const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { setupSolanaConnection, checkDevnetStatus, getConnection } = require('./solana/connection');
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

// Root endpoint
app.get('/', async (req, res) => {
  try {
    const devnetStatus = await checkDevnetStatus();
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    
    res.json({
      status: 'API is working',
      timestamp: new Date().toISOString(),
      network: {
        operational: devnetStatus,
        network: network
      },
      endpoints: {
        health: '/health',
        lootbox: '/api/lootbox'
      }
    });
  } catch (error) {
    console.error('[ERROR] Root endpoint check failed:', error);
    res.status(500).json({
      status: 'API error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

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
        network: process.env.SOLANA_NETWORK || 'mainnet-beta'
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

async function startServer() {
  try {
    console.log('[DEBUG] Starting server initialization...');
    
    // Initialize Solana connection
    const connection = getConnection();
    console.log('[DEBUG] Solana connection initialized');
    
    // Get recent blockhash to verify connection
    const recentBlockhash = await connection.getRecentBlockhash();
    console.log(`[DEBUG] Recent blockhash: ${recentBlockhash.blockhash}`);
    
    // Get network version
    const version = await connection.getVersion();
    console.log(`[DEBUG] Solana version: ${version['solana-core']}`);

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[DEBUG] Server is running on port ${PORT}`);
      console.log(`[DEBUG] Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('[ERROR] Failed to start server:', error);
    process.exit(1);
  }
}

startServer(); 