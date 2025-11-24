export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateAddress(address: string): void {
  if (!address || typeof address !== 'string') {
    throw new ValidationError('Address must be a non-empty string');
  }
  // Basic Solana address validation (base58, 32-44 chars typically)
  if (address.length < 32 || address.length > 44) {
    throw new ValidationError('Invalid Solana address length');
  }
  // Check for valid base58 characters
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
    throw new ValidationError('Address contains invalid characters');
  }
}

export function validateSlippage(slippage: number): void {
  if (typeof slippage !== 'number' || isNaN(slippage)) {
    throw new ValidationError('Slippage must be a valid number');
  }
  if (slippage < 0 || slippage > 1) {
    throw new ValidationError('Slippage must be between 0 and 1 (0% to 100%)');
  }
}

export function validateAmount(amount: number, fieldName = 'amount'): void {
  if (typeof amount !== 'number' || isNaN(amount)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }
  if (amount <= 0) {
    throw new ValidationError(`${fieldName} must be greater than 0`);
  }
  if (!isFinite(amount)) {
    throw new ValidationError(`${fieldName} must be finite`);
  }
}

export function validateOrderPayload(payload: any): void {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Order payload must be an object');
  }

  // Validate required fields exist
  if (!payload.userWallet) {
    throw new ValidationError('userWallet is required');
  }
  if (!payload.tokenIn) {
    throw new ValidationError('tokenIn is required');
  }
  if (!payload.tokenOut) {
    throw new ValidationError('tokenOut is required');
  }
  if (payload.amountIn === undefined || payload.amountIn === null) {
    throw new ValidationError('amountIn is required');
  }

  // Validate addresses
  validateAddress(payload.userWallet);
  validateAddress(payload.tokenIn);
  validateAddress(payload.tokenOut);

  // Validate amount
  validateAmount(payload.amountIn, 'amountIn');

  // Validate slippage if provided
  if (payload.slippage !== undefined) {
    validateSlippage(payload.slippage);
  }

  // Validate tokens are different
  if (payload.tokenIn === payload.tokenOut) {
    throw new ValidationError('tokenIn and tokenOut must be different');
  }

  if ((process.env.DEX_MODE || 'mock') === 'devnet') {
    const solMint = 'So11111111111111111111111111111111111111112';
    const devnetUsdcMint = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
    const tokens = [payload.tokenIn, payload.tokenOut];
    const hasSol = tokens.includes(solMint);
    const hasDevnetUsdc = tokens.includes(devnetUsdcMint);
    if (!(hasSol && hasDevnetUsdc)) {
      throw new ValidationError('Devnet mode currently supports only SOL/USDC swaps');
    }
  }
}
