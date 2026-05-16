#!/usr/bin/env node
import { createInterface } from "node:readline";
import { convertQRIS, parseQRIS, QRISError, validateQRIS } from "./index";

const USAGE = `@andhikapraa/qris — Static → Dynamic QRIS Converter

Interactive:
  qris

Non-interactive:
  qris <staticQris> <amount> [fixed|percentage <feeValue>]

Examples:
  qris 00020101021126...6304ABCD 350135
  qris 00020101021126...6304ABCD 10000 fixed 2000
  qris 00020101021126...6304ABCD 10000 percentage 0.7`;

type Fee = { type: "fixed" | "percentage"; value: number };

/** Convert + print, or print the error and exit non-zero. */
function emit(qris: string, amount: number, fee?: Fee): void {
  try {
    process.stdout.write(`${convertQRIS(qris, { amount, fee })}\n`);
  } catch (err) {
    if (err instanceof QRISError) {
      process.stderr.write(`[x] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

function runNonInteractive(args: string[]): void {
  const [qris, amountArg, feeType, feeValue] = args;
  if (!qris || !amountArg) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }
  const amount = Number(amountArg);
  let fee: Fee | undefined;
  if (feeType === "fixed" || feeType === "percentage") {
    fee = { type: feeType, value: Number(feeValue) };
  } else if (feeType) {
    process.stderr.write(`[x] unknown fee type "${feeType}" (use fixed|percentage)\n`);
    process.exit(1);
  }
  emit(qris, amount, fee);
}

async function runInteractive(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  console.log("\n  @andhikapraa/qris — Static → Dynamic Converter\n");
  const qris = await ask("[?] Input QRIS string: ");

  const validation = validateQRIS(qris);
  if (!validation.valid) {
    console.log("\n[x] Invalid QRIS:");
    for (const e of validation.errors) console.log(`    - ${e}`);
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

  const amount = Number.parseInt(await ask("\n[?] Input nominal (Rupiah): "), 10);
  const useFee = await ask("[?] Add service fee? (y/n): ");
  let fee: Fee | undefined;
  if (useFee.toLowerCase() === "y") {
    const feeType = await ask("[?] Fixed or Percentage? (f/p): ");
    if (feeType.toLowerCase() === "f") {
      fee = { type: "fixed", value: Number.parseInt(await ask("[?] Fee amount (Rupiah): "), 10) };
    } else if (feeType.toLowerCase() === "p") {
      fee = { type: "percentage", value: Number.parseFloat(await ask("[?] Fee percentage: ")) };
    }
  }

  console.log("\n  Result:\n");
  emit(qris, amount, fee);
  rl.close();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "-h" || args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  if (args.length > 0) {
    runNonInteractive(args);
    return;
  }
  await runInteractive();
}

main();
