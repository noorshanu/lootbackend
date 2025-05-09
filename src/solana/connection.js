const { Connection } = require('@solana/web3.js');

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/?api-key=f0a85b3e-ea88-4b16-bcbc-21203079e68b";

// Create connection with proper configuration
const connection = new Connection(
  RPC_ENDPOINT,
  {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000, // 60 seconds
    wsEndpoint: 'wss://mainnet.helius-rpc.com/?api-key=f0a85b3e-ea88-4b16-bcbc-21203079e68b',
  }
);

// Helper function to get connection
function getConnection() {
  return connection;
}

// Helper function to check if we're on devnet
function isDevnet() {
  return false; // We're always on mainnet-beta
}

// Helper function to get wallet balance
async function getWalletBalance(publicKey) {
  try {
    const balance = await connection.getBalance(publicKey);
    return balance;
  } catch (error) {
    console.error('[ERROR] Failed to get wallet balance:', error);
    throw error;
  }
}

module.exports = {
  getConnection,
  isDevnet,
  getWalletBalance
}; 