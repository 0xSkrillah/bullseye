/**
 * Shows whether the configured buyer can pay on X Layer testnet. Prints the
 * buyer's public address and balances only; the key itself is never printed.
 *
 *   npm run wallet
 */
import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "../apps/api/src/adapters/xlayer.js";
import { friendlyErrors, readPrivateKey } from "./lib.js";

friendlyErrors();

const TOKENS = [
  { name: "USD₮0", address: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c", note: "default asset of the OKX x402 SDK on testnet; what Bullseye charges in" },
  { name: "USDC_TEST", address: "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d", note: "what the OKX mock merchant charges in" },
] as const;

const buyer = privateKeyToAccount(readPrivateKey("BUYER_PRIVATE_KEY")).address;
const payTo = process.env.PAY_TO_ADDRESS ?? null;
const price = Number(process.env.BRIEF_PRICE_USD ?? "3.00");
const chain = createPublicClient({ chain: xLayerTestnet, transport: http(process.env.XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech") });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

console.log(`network   X Layer testnet (eip155:${await chain.getChainId()})`);
console.log(`buyer     ${buyer}`);
console.log(`pay to    ${payTo ?? "PAY_TO_ADDRESS is not set"}`);
if (payTo && payTo.toLowerCase() === buyer.toLowerCase()) console.log("          note: buyer and seller are the same address; use two wallets for a meaningful demo");
console.log(`OKB       ${formatUnits(await chain.getBalance({ address: buyer }), 18)}  (not needed: the facilitator submits the transfer)`);

let canPay = false;
for (const token of TOKENS) {
  const balance = Number(formatUnits(await chain.readContract({ address: token.address, abi: erc20, functionName: "balanceOf", args: [buyer] }), 6));
  console.log(`${token.name.padEnd(9)} ${balance}  (${token.note})`);
  if (token.name === "USD₮0" && balance >= price) canPay = true;
}
console.log(canPay ? `\nREADY: the buyer holds enough USD₮0 for one Brief at $${price.toFixed(2)}.` : `\nNOT READY: the buyer needs at least ${price.toFixed(2)} testnet USD₮0. Faucet: https://www.okx.com/xlayer/faucet/xlayerfaucet  (or lower BRIEF_PRICE_USD and the budget/reserves with it).`);
process.exit(canPay ? 0 : 1);
