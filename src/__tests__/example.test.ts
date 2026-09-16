import { describe, it, expect } from 'vitest';

describe('example', () => {
  it('should add two numbers correctly', () => {
    const result = 1 + 2;
    expect(result).toBe(3);
  });

  it('should match strings', () => {
    const message = 'hello world';
    expect(message).toBe('hello world');
  });

  it('should handle arrays', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });
});
