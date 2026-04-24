import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash, randomBytes } from "crypto";
import { assert } from "chai";
import { CastPayment } from "../target/types/cast_payment";

/**
 * Integration tests for the cast-payment Anchor program.
 *
 * The program provides atomic "pay and record" for Cast's x402 flow:
 *   - CPIs an SPL transfer of AUDD from payer → recipient
 *   - Creates a PaymentReceipt PDA at ["receipt", payer, nonce_hash]
 *   - Second call with same (payer, nonce_hash) fails → replay guard
 *
 * These tests use a local AUDD-shaped mint (6 decimals) on the test validator.
 */
describe("cast-payment", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CastPayment as Program<CastPayment>;

  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  let auddMint: PublicKey;
  let payerAta: PublicKey;
  let recipientAta: PublicKey;

  const hash32 = (s: string) => Array.from(createHash("sha256").update(s).digest());
  const findReceiptPda = (payerKey: PublicKey, nonceHash: number[]) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), payerKey.toBuffer(), Buffer.from(nonceHash)],
      program.programId,
    )[0];

  before(async () => {
    // Fund payer
    const airdrop = await provider.connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdrop, "confirmed");

    // AUDD-shaped mint: 6 decimals, payer is mint authority for test convenience
    auddMint = await createMint(provider.connection, payer, payer.publicKey, null, 6);

    payerAta = await createAssociatedTokenAccount(provider.connection, payer, auddMint, payer.publicKey);
    recipientAta = getAssociatedTokenAddressSync(auddMint, recipient.publicKey);

    // Mint 100 AUDD to payer
    await mintTo(provider.connection, payer, auddMint, payerAta, payer, 100_000_000n);
  });

  it("pays and records a receipt atomically", async () => {
    const nonceHash = hash32("nonce-1-" + Date.now());
    const endpointId = hash32("endpoint/temp-converter");
    const amount = new BN(1_000); // 0.001 AUDD (6 decimals)
    const receipt = findReceiptPda(payer.publicKey, nonceHash);

    await program.methods
      .payAndRecord(amount, nonceHash, endpointId)
      .accounts({
        payer: payer.publicKey,
        recipient: recipient.publicKey,
        auddMint,
        payerAta,
        recipientAta,
        receipt,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([payer])
      .rpc();

    const recipientAcc = await getAccount(provider.connection, recipientAta);
    assert.equal(recipientAcc.amount.toString(), "1000", "recipient received 0.001 AUDD");

    const receiptAcc = await program.account.paymentReceipt.fetch(receipt);
    assert.equal(receiptAcc.amount.toString(), "1000");
    assert.equal(receiptAcc.payer.toBase58(), payer.publicKey.toBase58());
    assert.equal(receiptAcc.mint.toBase58(), auddMint.toBase58());
  });

  it("rejects replay of the same nonce", async () => {
    const nonceHash = hash32("replay-nonce-" + randomBytes(4).toString("hex"));
    const endpointId = hash32("endpoint/replay-test");
    const amount = new BN(1_000);
    const receipt = findReceiptPda(payer.publicKey, nonceHash);

    const accounts = {
      payer: payer.publicKey,
      recipient: recipient.publicKey,
      auddMint,
      payerAta,
      recipientAta,
      receipt,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };

    await program.methods.payAndRecord(amount, nonceHash, endpointId).accounts(accounts).signers([payer]).rpc();

    let threw = false;
    try {
      await program.methods.payAndRecord(amount, nonceHash, endpointId).accounts(accounts).signers([payer]).rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "second call with same nonce must fail — replay guard broken otherwise");
  });

  it("rejects zero-amount payments", async () => {
    const nonceHash = hash32("zero-" + randomBytes(4).toString("hex"));
    const endpointId = hash32("endpoint/zero");
    const receipt = findReceiptPda(payer.publicKey, nonceHash);

    let threw = false;
    try {
      await program.methods
        .payAndRecord(new BN(0), nonceHash, endpointId)
        .accounts({
          payer: payer.publicKey,
          recipient: recipient.publicKey,
          auddMint,
          payerAta,
          recipientAta,
          receipt,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([payer])
        .rpc();
    } catch (err: any) {
      threw = /ZeroAmount/i.test(err.toString());
    }
    assert.isTrue(threw, "zero amount must be rejected with ZeroAmount error");
  });
});
