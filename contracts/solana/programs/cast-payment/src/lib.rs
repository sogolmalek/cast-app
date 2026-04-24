//! Cast Payment — on-chain receipt + nonce registry for x402 AUDD payments.
//!
//! The Cast x402 middleware verifies AUDD transfers by inspecting token balance
//! deltas of the transaction directly (see backend/src/adapters/SolanaVerifier.js),
//! so this program is optional for the happy path. It is provided as a canonical
//! on-chain anchor for:
//!
//!   1. Nonce registry — a PDA per (payer, nonce) that prevents replay even if
//!      the Cast server's local DB is lost or forked. The verifier can cheaply
//!      query `PaymentReceipt` accounts to decide whether a nonce is spent.
//!   2. Atomic pay+record — a single instruction that (a) CPIs an SPL transfer
//!      of AUDD from the payer to a recipient and (b) writes the receipt PDA.
//!      This gives callers a one-tx UX: no separate transfer + off-chain proof.
//!   3. Auditability — every x402 payment is reconstructable from on-chain data.
//!
//! The AUDD mint is passed in at instruction time and validated; there is no
//! hardcoded mint, so the same program works on devnet and mainnet.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("CastPay1111111111111111111111111111111111111");

#[program]
pub mod cast_payment {
    use super::*;

    /// Pay for an x402 API call: transfer AUDD from payer to recipient and
    /// record a non-replayable receipt.
    ///
    /// The receipt PDA is derived from (payer, nonce_hash). Creating it again
    /// with the same inputs fails at the runtime level because the account
    /// already exists — that is our replay guard.
    pub fn pay_and_record(
        ctx: Context<PayAndRecord>,
        amount: u64,
        nonce_hash: [u8; 32],
        endpoint_id: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, CastError::ZeroAmount);

        // CPI: SPL token transfer (AUDD) from payer → recipient.
        let cpi_accounts = Transfer {
            from: ctx.accounts.payer_ata.to_account_info(),
            to: ctx.accounts.recipient_ata.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Write receipt. `init` on this account implicitly prevents replay:
        // a second tx with the same (payer, nonce_hash) finds the PDA already
        // initialised and aborts.
        let receipt = &mut ctx.accounts.receipt;
        receipt.payer = ctx.accounts.payer.key();
        receipt.recipient = ctx.accounts.recipient.key();
        receipt.mint = ctx.accounts.audd_mint.key();
        receipt.amount = amount;
        receipt.endpoint_id = endpoint_id;
        receipt.nonce_hash = nonce_hash;
        receipt.timestamp = Clock::get()?.unix_timestamp;
        receipt.bump = ctx.bumps.receipt;

        emit!(PaymentRecorded {
            payer: receipt.payer,
            recipient: receipt.recipient,
            mint: receipt.mint,
            amount,
            nonce_hash,
            endpoint_id,
            timestamp: receipt.timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce_hash: [u8; 32])]
pub struct PayAndRecord<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The recipient wallet (Cast's escrow or a creator's wallet). Not a signer.
    /// CHECK: address constraint only — we just need it to derive the ATA.
    pub recipient: UncheckedAccount<'info>,

    /// AUDD mint — any mint is accepted at the program level. Which mint
    /// counts as "AUDD" is enforced by the Cast verifier off-chain against
    /// its configured `auddMint` for the active network.
    pub audd_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = audd_mint,
        associated_token::authority = payer,
    )]
    pub payer_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = audd_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        space = 8 + PaymentReceipt::SIZE,
        seeds = [b"receipt", payer.key().as_ref(), nonce_hash.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, PaymentReceipt>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct PaymentReceipt {
    pub payer: Pubkey,          // 32
    pub recipient: Pubkey,      // 32
    pub mint: Pubkey,           // 32
    pub amount: u64,            //  8
    pub endpoint_id: [u8; 32],  // 32 — hash of Cast endpoint slug
    pub nonce_hash: [u8; 32],   // 32 — hash of off-chain nonce string
    pub timestamp: i64,         //  8
    pub bump: u8,               //  1
}

impl PaymentReceipt {
    pub const SIZE: usize = 32 + 32 + 32 + 8 + 32 + 32 + 8 + 1;
}

#[event]
pub struct PaymentRecorded {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub nonce_hash: [u8; 32],
    pub endpoint_id: [u8; 32],
    pub timestamp: i64,
}

#[error_code]
pub enum CastError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
}
