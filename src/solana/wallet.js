// src/solana/wallet.js

const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
require('dotenv').config(); // Load .env variables

// Load private key from environment variable
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY;

if (!DEV_WALLET_PRIVATE_KEY) {
  console.error('[ERROR] DEV_WALLET_PRIVATE_KEY environment variable is not set');
  process.exit(1);
}

let devWallet;
try {
  const privateKeyBytes = bs58.decode(DEV_WALLET_PRIVATE_KEY);
  devWallet = Keypair.fromSecretKey(privateKeyBytes);
  console.log('[DEBUG] Dev wallet public key:', devWallet.publicKey.toString());
} catch (error) {
  console.error('[ERROR] Failed to initialize dev wallet:', error);
  process.exit(1);
}

module.exports = {
  devWallet,
};