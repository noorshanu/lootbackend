const {
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { devWallet } = require('./wallet');
const { getConnection } = require('./connection');
const {
  Liquidity,
  Token,
  TokenAmount,
  Percent,
  Currency,
  CurrencyAmount,
  TokenAccount,
  TOKEN_PROGRAM_ID: RAYDIUM_TOKEN_PROGRAM_ID,
  SPL_ACCOUNT_LAYOUT,
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  MAINNET_PROGRAM_ID,
  jsonInfo2PoolKeys,
} = require('@raydium-io/raydium-sdk');
const axios = require('axios');
const https = require('https');

async function swapAndTransfer(tokenMint, userWallet, amountInSol) {
  const connection = getConnection();
  try {
    console.log('[DEBUG] Starting swap and transfer:', {
      tokenMint,
      userWallet: userWallet.toString(),
      amountInSol
    });

    // Step 1: Setup tokens
    const SOL = new Token(
      TOKEN_PROGRAM_ID,
      new PublicKey('So11111111111111111111111111111111111111112'),
      9,
      'SOL',
      'SOL'
    );

    const targetToken = new Token(
      TOKEN_PROGRAM_ID,
      new PublicKey(tokenMint),
      9, // We'll get the actual decimals from the token account
      'TARGET',
      'TARGET'
    );

    // Step 2: Get or create token accounts
    const userTokenAccount = await getOrCreateTokenAccount(tokenMint, userWallet);
    const devTokenAccount = await getOrCreateTokenAccount(tokenMint, devWallet.publicKey);
    const devSolAccount = await getOrCreateTokenAccount(
      'So11111111111111111111111111111111111111112',
      devWallet.publicKey
    );

    // Step 3: Get pool info from Raydium API using streaming
    const pools = await new Promise((resolve, reject) => {
      let data = '';
      const req = https.get('https://api.raydium.io/v2/sdk/liquidity/mainnet.json', (res) => {
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            resolve(parsedData);
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', (error) => {
        reject(error);
      });
    });

    if (!pools || !Array.isArray(pools)) {
      throw new Error('Invalid response from Raydium API');
    }

    // Find the pool that matches our token
    const poolInfo = pools.find(pool => 
      pool.baseMint === tokenMint || pool.quoteMint === tokenMint
    );

    if (!poolInfo) {
      throw new Error(`No Raydium pool found for token ${tokenMint}`);
    }

    console.log('[DEBUG] Found Raydium pool:', poolInfo.id);

    // Convert pool info to Raydium SDK format
    const pool = jsonInfo2PoolKeys(poolInfo);

    // Step 4: Get pool state
    const poolState = await Liquidity.fetchInfo({
      connection,
      poolKeys: pool,
    });

    // Step 5: Calculate swap amount
    const amountIn = new TokenAmount(SOL, amountInSol * LAMPORTS_PER_SOL);
    const slippage = new Percent(1, 100); // 1% slippage

    // Step 6: Compute swap
    const { innerTransactions } = await Liquidity.makeSwapTransaction({
      connection,
      poolKeys: pool,
      userKeys: {
        tokenAccounts: [
          {
            pubkey: devSolAccount,
            accountInfo: await connection.getAccountInfo(devSolAccount),
            programId: TOKEN_PROGRAM_ID,
          },
          {
            pubkey: devTokenAccount,
            accountInfo: await connection.getAccountInfo(devTokenAccount),
            programId: TOKEN_PROGRAM_ID,
          },
        ],
        owner: devWallet.publicKey,
      },
      amountIn,
      amountOut: null, // Let Raydium calculate the output amount
      fixedSide: 'in',
      slippage,
    });

    // Step 7: Execute swap
    const swapTx = innerTransactions[0].transaction;
    swapTx.feePayer = devWallet.publicKey;
    swapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    swapTx.sign(devWallet);

    const swapSignature = await connection.sendRawTransaction(swapTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    console.log('[DEBUG] Swap transaction sent:', swapSignature);
    await connection.confirmTransaction(swapSignature, 'confirmed');
    console.log('[DEBUG] Swap transaction confirmed');

    // Step 8: Transfer token to user
    const tokenBalance = await connection.getTokenAccountBalance(devTokenAccount);
    const transferAmount = BigInt(tokenBalance.value.amount);

    const transferIx = createTransferInstruction(
      devTokenAccount,
      userTokenAccount,
      devWallet.publicKey,
      transferAmount
    );

    const transferTx = new Transaction().add(transferIx);
    transferTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transferTx.feePayer = devWallet.publicKey;
    transferTx.sign(devWallet);

    const transferSignature = await connection.sendRawTransaction(transferTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    await connection.confirmTransaction(transferSignature, 'confirmed');
    console.log('[DEBUG] Transfer transaction confirmed');

    return {
      swapSignature,
      transferSignature,
      amount: transferAmount.toString(),
    };
  } catch (error) {
    console.error('[ERROR] swapAndTransfer failed:', error);
    throw error;
  }
}

// Helper
async function getOrCreateTokenAccount(tokenMint, owner) {
  const connection = getConnection();
  const mint = new PublicKey(tokenMint);
  const ownerPubkey = new PublicKey(owner);
  const ata = await getAssociatedTokenAddress(mint, ownerPubkey);

  const accountInfo = await connection.getAccountInfo(ata);
  if (!accountInfo) {
    const ix = createAssociatedTokenAccountInstruction(
      devWallet.publicKey, // payer
      ata, // ata
      ownerPubkey, // owner
      mint, // mint
      TOKEN_PROGRAM_ID, // token program id
      ASSOCIATED_TOKEN_PROGRAM_ID // ata program id
    );

    const tx = new Transaction().add(ix);
    tx.feePayer = devWallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(devWallet);

    try {
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('[DEBUG] Created token account:', ata.toString());
    } catch (error) {
      console.error('[ERROR] Failed to create token account:', error);
      throw error;
    }
  }

  return ata;
}

module.exports = {
  swapAndTransfer
};