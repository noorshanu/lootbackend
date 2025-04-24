const { getConnection, isDevnet, getWalletBalance } = require('../solana/connection');
const { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const axios = require('axios');

// Configuration for different lootbox tiers
const LOOTBOX_TIERS = {
  JEETER: {
    minBet: 0.01,
    maxMultiplier: 2,
    winChance: 0.25,
    name: 'Jeeter Box',
    minRewardPercent: 0.08, // 8% of bet
    maxRewardPercent: 0.3   // 30% of bet
  },
  DEGEN: {
    minBet: 0.02,
    maxMultiplier: 5,
    winChance: 0.15,
    name: 'Degen Box',
    minRewardPercent: 0.1,  // 10% of bet
    maxRewardPercent: 0.4   // 40% of bet
  },
  GAMBLER: {
    minBet: 0.05,
    maxMultiplier: 10,
    winChance: 0.10,
    name: 'Gambler Box',
    minRewardPercent: 0.15, // 15% of bet
    maxRewardPercent: 0.5   // 50% of bet
  }
};

// Dev wallet address (replace with actual dev wallet)
const DEV_WALLET = process.env.DEV_WALLET_ADDRESS || 'C9vPRSmmV3aQtGc7diwAtPLpYTSwApFU51W7oeJgyBT8';

// DexScreener API endpoint for Solana pairs
const DEXSCREENER_SOLANA_API = 'https://api.dexscreener.com/latest/dex/pairs/solana';

const openLootbox = async (req, res) => {
  try {
    console.log('[DEBUG] ====== Starting Lootbox Flow ======');
    console.log('[DEBUG] Request body:', JSON.stringify(req.body, null, 2));
    const { walletAddress, tier, amount, signature } = req.body;

    // Validate input
    if (!walletAddress || !tier || !amount) {
      console.log('[DEBUG] Missing required parameters:', { walletAddress, tier, amount });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Log transaction signature if provided
    if (signature) {
      console.log('[DEBUG] Transaction signature:', signature);
    }

    const lootboxConfig = LOOTBOX_TIERS[tier.toUpperCase()];
    if (!lootboxConfig) {
      console.log('[DEBUG] Invalid lootbox tier:', tier);
      return res.status(400).json({ error: 'Invalid lootbox tier' });
    }

    // Validate bet amount
    if (amount < lootboxConfig.minBet) {
      console.log('[DEBUG] Bet amount too low:', { amount, minBet: lootboxConfig.minBet });
      return res.status(400).json({ 
        error: `Minimum bet for ${lootboxConfig.name} is ${lootboxConfig.minBet} SOL` 
      });
    }

    // Check if wallet is valid
    let userPubKey;
    let userBalanceBefore;
    try {
      userPubKey = new PublicKey(walletAddress);
      console.log('[DEBUG] Valid wallet address:', userPubKey.toString());
      
      // Check wallet balance BEFORE transaction
      const connection = getConnection();
      userBalanceBefore = await getWalletBalance(userPubKey);
      console.log('[DEBUG] User wallet balance BEFORE transaction:', userBalanceBefore / LAMPORTS_PER_SOL, 'SOL');
    } catch (error) {
      console.error('[ERROR] Invalid wallet address:', walletAddress);
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check dev wallet balance before transaction
    let devBalanceBefore;
    try {
      const connection = getConnection();
      const devPubKey = new PublicKey(DEV_WALLET);
      devBalanceBefore = await getWalletBalance(devPubKey);
      console.log('[DEBUG] Dev wallet balance BEFORE transaction:', devBalanceBefore / LAMPORTS_PER_SOL, 'SOL');
      console.log('[DEBUG] Dev wallet address:', DEV_WALLET);
    } catch (error) {
      console.error('[ERROR] Failed to check dev wallet balance:', error);
    }

    // Verify transaction signature if provided
    if (signature) {
      try {
        const connection = getConnection();
        const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
        
        if (!tx) {
          console.error('[ERROR] Transaction not found:', signature);
          return res.status(400).json({ error: 'Transaction not found' });
        }
        
        // Verify transaction details
        const expectedAmount = amount * LAMPORTS_PER_SOL;
        const actualAmount = tx.meta.postBalances[0] - tx.meta.preBalances[0];
        
        console.log('[DEBUG] Transaction verification:', {
          signature,
          expectedAmount,
          actualAmount,
          fromAddress: tx.transaction.message.accountKeys[0].toString(),
          toAddress: tx.transaction.message.accountKeys[1].toString()
        });
        
        // Verify the transaction is from the user's wallet to the dev wallet
        const fromAddress = tx.transaction.message.accountKeys[0].toString();
        const toAddress = tx.transaction.message.accountKeys[1].toString();
        
        if (fromAddress !== userPubKey.toString()) {
          console.error('[ERROR] Transaction not from user wallet:', { 
            expected: userPubKey.toString(), 
            actual: fromAddress 
          });
          return res.status(400).json({ error: 'Transaction not from user wallet' });
        }
        
        if (toAddress !== DEV_WALLET) {
          console.error('[ERROR] Transaction not to dev wallet:', { 
            expected: DEV_WALLET, 
            actual: toAddress 
          });
          return res.status(400).json({ error: 'Transaction not to dev wallet' });
        }
        
        // Verify the transaction amount is close to the expected amount (allowing for fees)
        const feeTolerance = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL tolerance for fees
        if (Math.abs(actualAmount - expectedAmount) > feeTolerance) {
          console.error('[ERROR] Transaction amount mismatch:', { 
            expected: expectedAmount, 
            actual: actualAmount,
            difference: Math.abs(actualAmount - expectedAmount)
          });
          return res.status(400).json({ error: 'Transaction amount mismatch' });
        }
        
        console.log('[DEBUG] Transaction verified successfully');
        
        // Check user wallet balance after transaction
        try {
          const userBalanceAfter = await getWalletBalance(userPubKey);
          console.log('[DEBUG] User wallet balance AFTER transaction:', userBalanceAfter / LAMPORTS_PER_SOL, 'SOL');
          
          // Calculate the difference
          const userBalanceDiff = userBalanceBefore - userBalanceAfter;
          console.log('[DEBUG] User wallet balance decreased by:', userBalanceDiff / LAMPORTS_PER_SOL, 'SOL');
          
          if (userBalanceDiff < 0) {
            console.warn('[WARNING] User wallet balance INCREASED after transaction! This is unexpected.');
          } else if (userBalanceDiff === 0) {
            console.warn('[WARNING] User wallet balance UNCHANGED after transaction! No SOL was deducted.');
          } else {
            console.log('[DEBUG] Successfully confirmed SOL deducted from user wallet!');
          }
        } catch (error) {
          console.error('[ERROR] Failed to check user wallet balance after transaction:', error);
        }
        
        // Check dev wallet balance after transaction
        try {
          const devPubKey = new PublicKey(DEV_WALLET);
          const devBalanceAfter = await getWalletBalance(devPubKey);
          console.log('[DEBUG] Dev wallet balance AFTER transaction:', devBalanceAfter / LAMPORTS_PER_SOL, 'SOL');
          
          // Calculate the difference
          const devBalanceDiff = devBalanceAfter - devBalanceBefore;
          console.log('[DEBUG] Dev wallet received:', devBalanceDiff / LAMPORTS_PER_SOL, 'SOL');
          
          if (devBalanceDiff < 0) {
            console.warn('[WARNING] Dev wallet balance decreased after transaction!');
          } else if (devBalanceDiff === 0) {
            console.warn('[WARNING] Dev wallet balance unchanged after transaction!');
          } else {
            console.log('[DEBUG] Successfully confirmed SOL received in dev wallet!');
          }
        } catch (error) {
          console.error('[ERROR] Failed to check dev wallet balance after transaction:', error);
        }
      } catch (error) {
        console.error('[ERROR] Failed to verify transaction:', error);
        return res.status(400).json({ error: 'Failed to verify transaction' });
      }
    } else {
      console.log('[DEBUG] No transaction signature provided, skipping verification');
      console.log('[WARNING] No transaction signature provided - this means no SOL will be deducted from the user wallet!');
    }

    // Determine if user wins
    const isWinner = Math.random() < lootboxConfig.winChance;
    console.log('[DEBUG] Lootbox result:', { 
      isWinner, 
      winChance: lootboxConfig.winChance,
      tier: lootboxConfig.name,
      amount: amount
    });
    
    if (isWinner) {
      // Calculate reward amount (random between minRewardPercent and maxRewardPercent of bet)
      const rewardPercent = lootboxConfig.minRewardPercent + 
        Math.random() * (lootboxConfig.maxRewardPercent - lootboxConfig.minRewardPercent);
      const rewardAmount = amount * rewardPercent;
      
      console.log('[DEBUG] Winner reward calculated:', { 
        rewardPercent: rewardPercent.toFixed(2), 
        rewardAmount: rewardAmount.toFixed(4),
        originalAmount: amount
      });

      // Get trending token from DexScreener
      const trendingToken = await getTrendingToken();
      console.log('[DEBUG] Selected trending token:', trendingToken);
      
      // In a real implementation, the dev wallet would:
      // 1. Use the received SOL to purchase the trending token
      // 2. Transfer the purchased tokens to the user's wallet
      
      // For now, we'll simulate this process
      console.log('[DEBUG] Simulating token purchase and transfer by dev wallet');
      console.log(`[DEBUG] Dev wallet ${DEV_WALLET} would purchase ${rewardAmount} SOL worth of ${trendingToken.symbol}`);
      console.log(`[DEBUG] Dev wallet would then transfer the purchased tokens to user wallet ${userPubKey.toString()}`);
      
      // In a real implementation, you would:
      // 1. Create a transaction from dev wallet to purchase the token
      // 2. Create a transaction from dev wallet to transfer the token to the user
      // 3. Sign and send these transactions using the dev wallet's private key
      
      // For now, we'll just return the expected result
      const response = {
        success: true,
        message: 'Congratulations! You won!',
        reward: {
          amount: rewardAmount.toFixed(4),
          token: trendingToken,
          percent: (rewardPercent * 100).toFixed(1)
        },
        transaction: {
          from: DEV_WALLET,
          to: userPubKey.toString(),
          token: trendingToken.symbol,
          amount: rewardAmount.toFixed(4)
        }
      };
      console.log('[DEBUG] Sending winner response:', JSON.stringify(response, null, 2));
      return res.json(response);
    } else {
      console.log('[DEBUG] User lost, processing loss');
      
      // In a real implementation, you would:
      // 1. Verify the transaction to the dev wallet was successful
      // 2. Record the loss in a database
      
      console.log(`[DEBUG] User lost ${amount} SOL to dev wallet ${DEV_WALLET}`);
      
      const response = {
        success: false,
        message: 'Better luck next time!',
        amount: amount,
        tier: lootboxConfig.name
      };
      console.log('[DEBUG] Sending loser response:', JSON.stringify(response, null, 2));
      return res.json(response);
    }
  } catch (error) {
    console.error('[ERROR] Error opening lootbox:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    console.log('[DEBUG] ====== Ending Lootbox Flow ======');
  }
};

const getLootboxHistory = async (req, res) => {
  try {
    console.log('[DEBUG] ====== Starting History Request ======');
    const { walletAddress } = req.params;
    console.log('[DEBUG] Fetching lootbox history for wallet:', walletAddress);
    
    // Validate wallet address
    try {
      const pubKey = new PublicKey(walletAddress);
      console.log('[DEBUG] Valid wallet address:', pubKey.toString());
      
      // Check wallet balance
      const connection = getConnection();
      const balance = await getWalletBalance(pubKey);
      console.log('[DEBUG] Wallet balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    } catch (error) {
      console.error('[ERROR] Invalid wallet address:', walletAddress);
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // TODO: Implement history tracking
    // This would involve querying a database for the user's history
    
    const response = {
      history: [] // Placeholder for actual history implementation
    };
    console.log('[DEBUG] Sending history response:', JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error('[ERROR] Error fetching history:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    console.log('[DEBUG] ====== Ending History Request ======');
  }
};

// Helper function to get trending token from DexScreener
const getTrendingToken = async () => {
  try {
    console.log('[DEBUG] ====== Starting Trending Token Fetch ======');
    console.log('[DEBUG] Fetching trending tokens from DexScreener');
    // Fetch top Solana pairs from DexScreener
    const response = await axios.get(DEXSCREENER_SOLANA_API);
    
    if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
      console.error('[ERROR] No pairs found from DexScreener');
      throw new Error('No pairs found from DexScreener');
    }

    console.log('[DEBUG] Total pairs found:', response.data.pairs.length);

    // Filter for valid pairs and sort by volume
    const validPairs = response.data.pairs
      .filter(pair => 
        pair.baseToken && 
        pair.baseToken.address && 
        pair.priceUsd && 
        pair.volume && 
        pair.volume.h24 > 0
      )
      .sort((a, b) => b.volume.h24 - a.volume.h24);

    console.log('[DEBUG] Valid pairs found:', validPairs.length);

    if (validPairs.length === 0) {
      console.error('[ERROR] No valid pairs found');
      throw new Error('No valid pairs found');
    }

    // Randomly select one from top 10 pairs (or less if fewer pairs available)
    const topPairs = validPairs.slice(0, Math.min(10, validPairs.length));
    const selectedPair = topPairs[Math.floor(Math.random() * topPairs.length)];
    console.log('[DEBUG] Selected trending pair:', {
      symbol: selectedPair.baseToken.symbol,
      name: selectedPair.baseToken.name,
      priceUsd: selectedPair.priceUsd,
      volume24h: selectedPair.volume.h24,
      dexId: selectedPair.dexId
    });

    const result = {
      address: selectedPair.baseToken.address,
      symbol: selectedPair.baseToken.symbol,
      name: selectedPair.baseToken.name,
      priceUsd: selectedPair.priceUsd,
      volume24h: selectedPair.volume.h24,
      dexId: selectedPair.dexId
    };
    console.log('[DEBUG] ====== Ending Trending Token Fetch ======');
    return result;
  } catch (error) {
    console.error('[ERROR] Error fetching trending token from DexScreener:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    // Return a fallback token in case of error
    return {
      address: 'fallback_token_address',
      symbol: 'FALLBACK',
      name: 'Fallback Token',
      priceUsd: '0',
      volume24h: '0',
      dexId: 'unknown'
    };
  }
};

module.exports = {
  openLootbox,
  getLootboxHistory
}; 