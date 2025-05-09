const { getConnection, isDevnet, getWalletBalance } = require('../solana/connection');
const { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { swapAndTransfer } = require('../solana/jupiter');
const axios = require('axios');

// Configuration for different lootbox tiers
const LOOTBOX_TIERS = {
  JEETER: {
    minBet: 0.02,
    maxMultiplier: 2,
    winChance: 0.95,  // 75% chance to win
    name: 'Jeeter Box',
    minRewardPercent: 0.08, // 8% of bet
    maxRewardPercent: 0.3   // 30% of bet
  },
  DEGEN: {
    minBet: 0.02,
    maxMultiplier: 5,
    winChance: 0.65,  // 65% chance to win
    name: 'Degen Box',
    minRewardPercent: 0.1,  // 10% of bet
    maxRewardPercent: 0.4   // 40% of bet
  },
  GAMBLER: {
    minBet: 0.05,
    maxMultiplier: 10,
    winChance: 0.55,  // 55% chance to win
    name: 'Gambler Box',
    minRewardPercent: 0.15, // 15% of bet
    maxRewardPercent: 0.5   // 50% of bet
  }
};

// Dev wallet address (replace with actual dev wallet)
const DEV_WALLET =  'CTVG23xJQEqgPYjR5K79mfhpg7CW81esxXURHwndwHRF';

// DexScreener API endpoint for Solana pairs
const DEXSCREENER_SOLANA_API = 'https://api.dexscreener.com/latest/dex/search?q=SOL/USDC';

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
        pair.volume.h24 > 0 &&
        pair.chainId === 'solana' // Ensure we only get Solana pairs
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
      dexId: selectedPair.dexId,
      liquidity: selectedPair.liquidity?.usd || 0,
      priceChange: selectedPair.priceChange?.h24 || 0
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
      dexId: 'unknown',
      liquidity: 0,
      priceChange: 0
    };
  }
};

// Helper function to get random reward
const getRandomReward = async () => {
  try {
    // Get trending token from DexScreener
    const trendingToken = await getTrendingToken();
    console.log('[DEBUG] Selected trending token:', trendingToken);

    // Calculate random reward amount (between 0.01 and 0.1 SOL)
    const minAmount = 0.01;
    const maxAmount = 0.1;
    const amount = minAmount + Math.random() * (maxAmount - minAmount);
    
    return {
      token: trendingToken.address,
      amount: amount,
      tokenInfo: {
        symbol: trendingToken.symbol,
        name: trendingToken.name,
        priceUsd: trendingToken.priceUsd
      }
    };
  } catch (error) {
    console.error('[ERROR] Failed to get random reward:', error);
    // Fallback to USDC if trending token fetch fails
    return {
      token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint address
      amount: 0.01,
      tokenInfo: {
        symbol: 'USDC',
        name: 'USD Coin',
        priceUsd: '1.00'
      }
    };
  }
};

const openLootbox = async (req, res) => {
  const connection = getConnection();
  try {
    const { walletAddress } = req.body;
    console.log('[DEBUG] Opening lootbox for wallet:', walletAddress);

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Validate wallet address
    try {
      new PublicKey(walletAddress);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Get random reward
    const reward = await getRandomReward();
    console.log('[DEBUG] Selected reward:', reward);

    // Process token reward
    try {
      console.log('[DEBUG] Processing token reward:', {
        token: reward.token,
        amount: reward.amount
      });

      // Swap SOL for token and transfer to user in one step
      const result = await swapAndTransfer(
        reward.token,
        walletAddress,
        reward.amount
      );

      console.log('[DEBUG] Swap and transfer successful:', {
        swapSignature: result.swapSignature,
        transferSignature: result.transferSignature,
        amount: result.amount
      });

      return res.json({
        success: true,
        reward: {
          type: 'token',
          token: reward.token,
          tokenInfo: reward.tokenInfo,
          amount: result.amount,
          swapSignature: result.swapSignature,
          transferSignature: result.transferSignature
        }
      });
    } catch (error) {
      console.error('[ERROR] Failed to process token reward:', error);
      throw error;
    }
  } catch (error) {
    console.error('[ERROR] Failed to open lootbox:', error);
    return res.status(500).json({ 
      error: 'Failed to open lootbox',
      details: error.message 
    });
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

module.exports = {
  openLootbox,
  getLootboxHistory
}; 