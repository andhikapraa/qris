#!/usr/bin/env node
import { createInterface } from "node:readline";
import { parseQRIS, convertQRIS, validateQRIS, QRISError } from "./index";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

async function main() {
  console.log("\n  @andhikapraa/qris — Static → Dynamic Converter\n");

  const qris = await ask("[?] Input QRIS string: ");

  const validation = validateQRIS(qris);
  if (!validation.valid) {
    console.log("\n[x] Invalid QRIS:");
    validation.errors.forEach((e) => console.log(`    - ${e}`));
    rl.close();
    process.exit(1);
  }

  const parsed = parseQRIS(qris);

  console.log("\n[v] QRIS Parsed:");
  console.log(`    Merchant : ${parsed.merchantName}`);
  console.log(`    City     : ${parsed.merchantCity}`);
  console.log(`    Method   : ${parsed.method}`);
  console.log(
    `    Currency : ${parsed.currency === "360" ? "IDR" : parsed.currency}`
  );

  if (parsed.method === "dynamic") {
    console.log(`    Amount   : ${parsed.amount ?? "-"}`);
    console.log("\n[!] This QRIS is already dynamic.");
    rl.close();
    return;
  }

  const amountStr = await ask("\n[?] Input nominal (Rupiah): ");
  const amount = parseInt(amountStr, 10);

  const useFee = await ask("[?] Add service fee? (y/n): ");
  let fee: { type: "fixed" | "percentage"; value: number } | undefined;

  if (useFee.toLowerCase() === "y") {
    const feeType = await ask("[?] Fixed or Percentage? (f/p): ");
    if (feeType.toLowerCase() === "f") {
      fee = { type: "fixed", value: parseInt(await ask("[?] Fee amount (Rupiah): "), 10) };
    } else if (feeType.toLowerCase() === "p") {
      fee = { type: "percentage", value: parseFloat(await ask("[?] Fee percentage: ")) };
    }
  }

  try {
    const result = convertQRIS(qris, { amount, fee });
    console.log("\n  Result:\n");
    console.log(`${result}\n`);
  } catch (err) {
    if (err instanceof QRISError) {
      console.log(`\n[x] ${err.message}`);
      rl.close();
      process.exit(1);
    }
    throw err;
  }

  rl.close();
}

main();
