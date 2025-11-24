import { describe, it, expect } from 'vitest';
import { 
  validateOrderPayload, 
  validateSlippage, 
  validateAddress, 
  validateAmount,
  ValidationError 
} from '../../src/utils/validation';

describe('Validation', () => {
  describe('validateAddress', () => {
    it('should accept valid Solana addresses', () => {
      const validAddress = 'So11111111111111111111111111111111111111112';
      expect(() => validateAddress(validAddress)).not.toThrow();
    });

    it('should reject empty addresses', () => {
      expect(() => validateAddress('')).toThrow(ValidationError);
      expect(() => validateAddress('')).toThrow('Address must be a non-empty string');
    });

    it('should reject addresses with invalid length', () => {
      expect(() => validateAddress('short')).toThrow(ValidationError);
      expect(() => validateAddress('short')).toThrow('Invalid Solana address length');
    });

    it('should reject addresses with invalid characters', () => {
      expect(() => validateAddress('So111111111111111111111111111111111111111@')).toThrow(ValidationError);
      expect(() => validateAddress('So111111111111111111111111111111111111111@')).toThrow('invalid characters');
    });
  });

  describe('validateSlippage', () => {
    it('should accept valid slippage values', () => {
      expect(() => validateSlippage(0.01)).not.toThrow();
      expect(() => validateSlippage(0.5)).not.toThrow();
      expect(() => validateSlippage(0)).not.toThrow();
      expect(() => validateSlippage(1)).not.toThrow();
    });

    it('should reject negative slippage', () => {
      expect(() => validateSlippage(-0.1)).toThrow(ValidationError);
      expect(() => validateSlippage(-0.1)).toThrow('must be between 0 and 1');
    });

    it('should reject slippage > 1', () => {
      expect(() => validateSlippage(1.5)).toThrow(ValidationError);
      expect(() => validateSlippage(1.5)).toThrow('must be between 0 and 1');
    });

    it('should reject non-numeric slippage', () => {
      expect(() => validateSlippage(NaN)).toThrow(ValidationError);
      expect(() => validateSlippage('0.5' as any)).toThrow('must be a valid number');
    });
  });

  describe('validateAmount', () => {
    it('should accept positive amounts', () => {
      expect(() => validateAmount(1.5)).not.toThrow();
      expect(() => validateAmount(0.001)).not.toThrow();
    });

    it('should reject zero amount', () => {
      expect(() => validateAmount(0)).toThrow(ValidationError);
      expect(() => validateAmount(0)).toThrow('must be greater than 0');
    });

    it('should reject negative amounts', () => {
      expect(() => validateAmount(-1)).toThrow(ValidationError);
    });

    it('should reject non-finite amounts', () => {
      expect(() => validateAmount(Infinity)).toThrow(ValidationError);
      expect(() => validateAmount(Infinity)).toThrow('must be finite');
    });
  });

  describe('validateOrderPayload', () => {
    const validPayload = {
      userWallet: 'So11111111111111111111111111111111111111112',
      tokenIn: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      tokenOut: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      amountIn: 1.5,
      slippage: 0.01,
    };

    it('should accept valid order payloads', () => {
      expect(() => validateOrderPayload(validPayload)).not.toThrow();
    });

    it('should reject missing userWallet', () => {
      const invalid = { ...validPayload, userWallet: undefined };
      expect(() => validateOrderPayload(invalid)).toThrow('userWallet is required');
    });

    it('should reject missing tokenIn', () => {
      const invalid = { ...validPayload, tokenIn: undefined };
      expect(() => validateOrderPayload(invalid)).toThrow('tokenIn is required');
    });

    it('should reject missing amountIn', () => {
      const invalid = { ...validPayload, amountIn: undefined };
      expect(() => validateOrderPayload(invalid)).toThrow('amountIn is required');
    });

    it('should reject zero amountIn', () => {
      const invalid = { ...validPayload, amountIn: 0 };
      expect(() => validateOrderPayload(invalid)).toThrow('amountIn must be greater than 0');
    });

    it('should reject negative amountIn', () => {
      const invalid = { ...validPayload, amountIn: -1 };
      expect(() => validateOrderPayload(invalid)).toThrow('amountIn must be greater than 0');
    });

    it('should reject invalid slippage', () => {
      const invalid = { ...validPayload, slippage: 1.5 };
      expect(() => validateOrderPayload(invalid)).toThrow('must be between 0 and 1');
    });

    it('should reject same tokenIn and tokenOut', () => {
      const invalid = { 
        ...validPayload, 
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'So11111111111111111111111111111111111111112'
      };
      expect(() => validateOrderPayload(invalid)).toThrow('tokenIn and tokenOut must be different');
    });
  });
});
