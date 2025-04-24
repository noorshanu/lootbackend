const { Connection, clusterApiUrl, LAMPORTS_PER_SOL } = require('@solana/web3.js');

let connection;
let isDevnet = false;

const setupSolanaConnection = async () => {
  try {
    // Connect to Solana network (mainnet-beta for production, devnet for testing)
    const network = process.env.SOLANA_NETWORK || 'devnet';
    console.log(`[DEBUG] Attempting to connect to Solana ${network}...`);
    
    connection = new Connection(clusterApiUrl(network), 'confirmed');
    
    // Verify connection by getting recent blockhash
    const recentBlockhash = await connection.getRecentBlockhash();
    console.log(`[DEBUG] Successfully connected to ${network}`);
    console.log(`[DEBUG] Recent blockhash: ${recentBlockhash.blockhash}`);
    
    // Check if we're on devnet
    isDevnet = network === 'devnet';
    if (isDevnet) {
      console.log('[DEBUG] Running on devnet - some features may be limited');
    }

    // Get network version
    const version = await connection.getVersion();
    console.log(`[DEBUG] Solana version: ${version['solana-core']}`);

    return true;
  } catch (error) {
    console.error('[ERROR] Failed to setup Solana connection:', error);
    throw error;
  }
};

const getConnection = () => {
  if (!connection) {
    console.error('[ERROR] Solana connection not initialized');
    throw new Error('Solana connection not initialized');
  }
  return connection;
};

const checkDevnetStatus = async () => {
  try {
    if (!isDevnet) {
      console.log('[DEBUG] Not running on devnet - skipping devnet checks');
      return false;
    }

    console.log('[DEBUG] Checking devnet status...');
    
    // Check if we can get recent blocks
    const recentBlocks = await connection.getRecentBlockhash();
    console.log(`[DEBUG] Recent blockhash: ${recentBlocks.blockhash}`);
    
    // Check if we can get slot
    const slot = await connection.getSlot();
    console.log(`[DEBUG] Current slot: ${slot}`);
    
    // Check if we can get cluster nodes
    const nodes = await connection.getClusterNodes();
    console.log(`[DEBUG] Number of cluster nodes: ${nodes.length}`);
    
    console.log('[DEBUG] Devnet is operational');
    return true;
  } catch (error) {
    console.error('[ERROR] Devnet status check failed:', error);
    return false;
  }
};

// Add a function to get wallet balance instead
const getWalletBalance = async (pubKey) => {
  try {
    if (!connection) {
      throw new Error('Solana connection not initialized');
    }
    const balance = await connection.getBalance(pubKey);
    console.log('[DEBUG] Wallet balance:', balance / 1e9, 'SOL');
    return balance;
  } catch (error) {
    console.error('[ERROR] Failed to get wallet balance:', error);
    throw error;
  }
};

module.exports = {
  setupSolanaConnection,
  getConnection,
  checkDevnetStatus,
  isDevnet,
  getWalletBalance
}; 