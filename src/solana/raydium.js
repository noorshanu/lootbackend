// src/solana/raydium.js

const {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} = require('@solana/spl-token');
const raydium = require('@raydium-io/raydium-sdk');
const { devWallet } = require('./wallet');
const { getConnection } = require('./connection');

// Raydium program IDs
const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const AMM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

// Raydium SOL/USDC pool
const SOL_USDC_POOL = {
  id: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
  baseMint: 'So11111111111111111111111111111111111111112',
  quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  lpMint: '8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu',
  baseDecimals: 9,
  quoteDecimals: 6,
  lpDecimals: 9,
  version: 4,
  programId: RAYDIUM_PROGRAM_ID,
  authority: new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'),
  openOrders: new PublicKey('HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc'),
  targetOrders: new PublicKey('CZza3Ej4Mc58MnxWA385itCC9jCo3L1D7zc3LKy1bZMR'),
  baseVault: new PublicKey('DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz'),
  quoteVault: new PublicKey('HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz'),
  withdrawQueue: new PublicKey('G7xeGGGyvX3yF7gQKhP1ZvT4dPLnqJfLzV4nYXmK7qVZ'),
  lpVault: new PublicKey('7JPjo8tRhM9ZkWP7c4o2Jc6rtyZn7RUJHBgZXWhUDm1P'),
  marketVersion: 3,
  marketProgramId: new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'),
  marketId: new PublicKey('9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT'),
  marketAuthority: new PublicKey('14ivtgssEBoBjuZJtSAPKYgpUK7hmmMuPBDnMKd2ukd6'),
  marketBaseVault: new PublicKey('14ivtgssEBoBjuZJtSAPKYgpUK7hmmMuPBDnMKd2ukd6'),
  marketQuoteVault: new PublicKey('CEQdAFKdycHugujQg9k2wbmxjcpdYZyVLfV9WerTnafJ'),
  marketBids: new PublicKey('14ivtgssEBoBjuZJtSAPKYgpUK7hmmMuPBDnMKd2ukd6'),
  marketAsks: new PublicKey('CEQdAFKdycHugujQg9k2wbmxjcpdYZyVLfV9WerTnafJ'),
  marketEventQueue: new PublicKey('5KKsLVU6TcbVDK4BS6K1DGDxnh4Q9xjYJ8XaDCG5t8ht'),
};

// Helper function to confirm transaction with retry
async function confirmTransactionWithRetry(signature, maxRetries = 3) {
  const connection = getConnection();
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log(`[DEBUG] Attempting to confirm transaction ${signature} (attempt ${retries + 1}/${maxRetries})`);
      
      const status = await connection.getSignatureStatus(signature);
      console.log('[DEBUG] Transaction status:', status);

      if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
        console.log('[DEBUG] Transaction already confirmed');
        return status;
      }

      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      console.log('[DEBUG] Transaction confirmation result:', confirmation);

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      return confirmation;
    } catch (error) {
      console.error(`[ERROR] Confirmation attempt ${retries + 1} failed:`, error);
      retries++;
      if (retries === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function getOrCreateTokenAccount(tokenMint, owner) {
  const connection = getConnection();
  try {
    console.log('[DEBUG] Getting/creating token account for:', {
      tokenMint,
      owner: owner.toString()
    });

    const tokenMintPubkey = new PublicKey(tokenMint);
    const ownerPubkey = new PublicKey(owner);
    const ata = await getAssociatedTokenAddress(tokenMintPubkey, ownerPubkey);
    console.log('[DEBUG] Associated token address:', ata.toString());

    const accountInfo = await connection.getAccountInfo(ata);
    console.log('[DEBUG] Existing account info:', accountInfo ? 'Found' : 'Not found');

    if (!accountInfo) {
      console.log('[DEBUG] Creating new token account...');
      const createIx = createAssociatedTokenAccountInstruction(
        devWallet.publicKey,
        ata,
        ownerPubkey,
        tokenMintPubkey
      );

      const transaction = new Transaction().add(createIx);
      console.log('[DEBUG] Sending create account transaction...');
      
      const signature = await connection.sendTransaction(transaction, [devWallet]);
      console.log('[DEBUG] Create account transaction sent:', signature);
      
      await confirmTransactionWithRetry(signature);
      console.log('[DEBUG] Token account created successfully');
    }

    return ata;
  } catch (error) {
    console.error('[ERROR] Failed to get/create token account:', error);
    throw error;
  }
}

async function swapSolForToken(tokenMint, amountInSol) {
  const connection = getConnection();
  try {
    console.log('[DEBUG] Starting SOL to token swap:', {
      tokenMint,
      amountInSol
    });

    const tokenAccount = await getOrCreateTokenAccount(tokenMint, devWallet.publicKey);
    console.log('[DEBUG] Token account ready:', tokenAccount.toString());

    // Convert SOL amount to lamports (integer)
    const amountInLamports = Math.floor(amountInSol * LAMPORTS_PER_SOL);
    console.log('[DEBUG] Amount in lamports:', amountInLamports);

    // Get token decimals
    const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));
    const decimals = tokenInfo.value?.data?.parsed?.info?.decimals || 9;
    console.log('[DEBUG] Token decimals:', decimals);

    // Create token instance
    const token = new raydium.Token(new PublicKey(tokenMint), decimals);
    console.log('[DEBUG] Token instance created:', {
      mint: token.mint.toString(),
      decimals: token.decimals
    });

    console.log('[DEBUG] Creating swap transaction...');
    const swapTx = await raydium.Liquidity.makeSwapTransaction({
      connection,
      poolKeys: SOL_USDC_POOL,
      userKeys: {
        tokenAccounts: [tokenAccount],
        owner: devWallet.publicKey,
      },
      amountIn: new raydium.TokenAmount(raydium.Currency.SOL, amountInLamports),
      amountOut: new raydium.TokenAmount(token, 0),
      fixedSide: 'in',
      slippage: new raydium.Percent(1, 100),
    });
    console.log('[DEBUG] Swap transaction created');

    console.log('[DEBUG] Sending swap transaction...');
    const signature = await connection.sendTransaction(swapTx, [devWallet]);
    console.log('[DEBUG] Swap transaction sent:', signature);

    await confirmTransactionWithRetry(signature);
    console.log('[DEBUG] Swap transaction confirmed');

    return { signature, tokenAccount };
  } catch (error) {
    console.error('[ERROR] Swap failed:', error);
    throw error;
  }
}

async function transferTokens(tokenMint, userWallet, amount) {
  const connection = getConnection();
  try {
    console.log('[DEBUG] Starting token transfer:', {
      tokenMint,
      userWallet: userWallet.toString(),
      amount: amount.toString()
    });

    const userATA = await getOrCreateTokenAccount(tokenMint, userWallet);
    const devATA = await getOrCreateTokenAccount(tokenMint, devWallet.publicKey);
    console.log('[DEBUG] Token accounts ready:', {
      userATA: userATA.toString(),
      devATA: devATA.toString()
    });

    // Get token decimals
    const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));
    const decimals = tokenInfo.value?.data?.parsed?.info?.decimals || 9;
    console.log('[DEBUG] Token decimals:', decimals);

    // Create token instance
    const token = new raydium.Token(new PublicKey(tokenMint), decimals);
    console.log('[DEBUG] Token instance created:', {
      mint: token.mint.toString(),
      decimals: token.decimals
    });

    // Convert amount to proper token amount (integer)
    const tokenAmount = Math.floor(amount * Math.pow(10, decimals));
    console.log('[DEBUG] Token amount in smallest unit:', tokenAmount);

    const transferIx = createTransferInstruction(
      devATA,
      userATA,
      devWallet.publicKey,
      tokenAmount
    );
    console.log('[DEBUG] Transfer instruction created');

    const tx = new Transaction().add(transferIx);
    console.log('[DEBUG] Sending transfer transaction...');
    
    const signature = await connection.sendTransaction(tx, [devWallet]);
    console.log('[DEBUG] Transfer transaction sent:', signature);

    await confirmTransactionWithRetry(signature);
    console.log('[DEBUG] Transfer transaction confirmed');

    return signature;
  } catch (error) {
    console.error('[ERROR] Transfer failed:', error);
    throw error;
  }
}

module.exports = {
  swapSolForToken,
  transferTokens,
};