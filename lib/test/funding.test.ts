import { describe, expect, it } from "vitest";
import { keccak256, zeroAddress } from "viem";
import { decodeFundingData, encodeFundingData } from "../src/index.ts";

describe("funding data", () => {
  const d = { precommitment: 123456789n, ciphertext: "0xc0ffee", relayer: "0x000000000000000000000000000000000000bEEF", fee: 50_000n } as const;

  it("matches Solidity's abi.encode(uint256, bytes, address, uint256)", () => {
    // cast abi-encode "f(uint256,bytes,address,uint256)" 123456789 0xc0ffee 0x…beef 50000 | cast keccak
    expect(keccak256(encodeFundingData(d))).toBe("0xc2ae5f0ac5bcadf8f1c60d82d2d4c6084ed4b56a44c60b11f32c7ec4babb52b5");
  });

  it("round-trips", () => {
    expect(decodeFundingData(encodeFundingData(d))).toEqual(d);
  });

  it("refuses a fee on self-submit", () => {
    expect(() => encodeFundingData({ ...d, relayer: zeroAddress })).toThrow();
    expect(() => encodeFundingData({ ...d, relayer: zeroAddress, fee: 0n })).not.toThrow();
  });
});
