// SPDX-License-Identifier: MIT
// Cast Payment Contract — Starknet (Cairo 1.0+)
//
// Handles micropayment settlement for Cast API calls.
// Supports:
// - USDC transfers with nonce tracking (replay protection)
// - Paymaster integration (gas sponsorship for callers)
// - Batch settlement (multiple payments in one tx)
// - Creator withdrawals
// - Admin controls (pause, fee updates)

use starknet::ContractAddress;

#[starknet::interface]
trait ICastPayment<TContractState> {
    // Pay for an API call
    fn pay(
        ref self: TContractState,
        endpoint_id: felt252,
        creator: ContractAddress,
        amount: u256,
        nonce: felt252,
    );

    // Batch pay for multiple API calls
    fn batch_pay(
        ref self: TContractState,
        endpoint_ids: Array<felt252>,
        creators: Array<ContractAddress>,
        amounts: Array<u256>,
        nonces: Array<felt252>,
    );

    // Creator withdraws accumulated balance
    fn withdraw(ref self: TContractState, amount: u256, recipient: ContractAddress);

    // View functions
    fn get_balance(self: @TContractState, creator: ContractAddress) -> u256;
    fn is_nonce_used(self: @TContractState, nonce: felt252) -> bool;
    fn get_total_payments(self: @TContractState) -> u256;
    fn get_usdc_address(self: @TContractState) -> ContractAddress;
    fn get_platform_fee_bps(self: @TContractState) -> u16;

    // Admin functions
    fn set_platform_fee(ref self: TContractState, fee_bps: u16);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn set_usdc_address(ref self: TContractState, address: ContractAddress);
}

#[starknet::contract]
mod CastPayment {
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address, get_block_timestamp,
    };
    use core::num::traits::Zero;

    // IERC20 interface for USDC transfers
    #[starknet::interface]
    trait IERC20<TContractState> {
        fn transfer_from(
            ref self: TContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool;
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    }

    #[storage]
    struct Storage {
        owner: ContractAddress,
        usdc_address: ContractAddress,
        platform_fee_bps: u16,        // basis points (100 = 1%)
        paused: bool,
        total_payments: u256,
        // Creator balances (accumulated from API calls)
        balances: LegacyMap<ContractAddress, u256>,
        // Nonce tracking for replay protection
        used_nonces: LegacyMap<felt252, bool>,
        // Platform fee accumulator
        platform_balance: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PaymentReceived: PaymentReceived,
        Withdrawal: Withdrawal,
        PlatformFeeCollected: PlatformFeeCollected,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentReceived {
        #[key]
        endpoint_id: felt252,
        #[key]
        payer: ContractAddress,
        creator: ContractAddress,
        amount: u256,
        nonce: felt252,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawal {
        #[key]
        creator: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PlatformFeeCollected {
        amount: u256,
        timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        usdc_address: ContractAddress,
        platform_fee_bps: u16,
    ) {
        self.owner.write(owner);
        self.usdc_address.write(usdc_address);
        self.platform_fee_bps.write(platform_fee_bps);
        self.paused.write(false);
        self.total_payments.write(0);
        self.platform_balance.write(0);
    }

    #[abi(embed_v0)]
    impl CastPaymentImpl of super::ICastPayment<ContractState> {
        fn pay(
            ref self: ContractState,
            endpoint_id: felt252,
            creator: ContractAddress,
            amount: u256,
            nonce: felt252,
        ) {
            // Guards
            assert(!self.paused.read(), 'Contract is paused');
            assert(!self.used_nonces.read(nonce), 'Nonce already used');
            assert(amount > 0, 'Amount must be positive');
            assert(!creator.is_zero(), 'Invalid creator address');

            let caller = get_caller_address();
            let contract = get_contract_address();

            // Mark nonce as used
            self.used_nonces.write(nonce, true);

            // Calculate platform fee
            let fee_bps: u256 = self.platform_fee_bps.read().into();
            let platform_fee = (amount * fee_bps) / 10000;
            let creator_amount = amount - platform_fee;

            // Transfer USDC from caller to contract
            let usdc = IERC20Dispatcher { contract_address: self.usdc_address.read() };
            let success = usdc.transfer_from(caller, contract, amount);
            assert(success, 'USDC transfer failed');

            // Credit creator balance
            let current = self.balances.read(creator);
            self.balances.write(creator, current + creator_amount);

            // Credit platform fee
            let current_platform = self.platform_balance.read();
            self.platform_balance.write(current_platform + platform_fee);

            // Update total
            let total = self.total_payments.read();
            self.total_payments.write(total + amount);

            // Emit event
            self.emit(PaymentReceived {
                endpoint_id,
                payer: caller,
                creator,
                amount,
                nonce,
                timestamp: get_block_timestamp(),
            });
        }

        fn batch_pay(
            ref self: ContractState,
            endpoint_ids: Array<felt252>,
            creators: Array<ContractAddress>,
            amounts: Array<u256>,
            nonces: Array<felt252>,
        ) {
            let len = endpoint_ids.len();
            assert(len == creators.len(), 'Array length mismatch');
            assert(len == amounts.len(), 'Array length mismatch');
            assert(len == nonces.len(), 'Array length mismatch');

            let mut i: u32 = 0;
            loop {
                if i >= len {
                    break;
                }
                self.pay(
                    *endpoint_ids.at(i),
                    *creators.at(i),
                    *amounts.at(i),
                    *nonces.at(i),
                );
                i += 1;
            };
        }

        fn withdraw(ref self: ContractState, amount: u256, recipient: ContractAddress) {
            assert(!self.paused.read(), 'Contract is paused');
            let caller = get_caller_address();
            let balance = self.balances.read(caller);
            assert(amount <= balance, 'Insufficient balance');
            assert(!recipient.is_zero(), 'Invalid recipient');

            // Deduct balance
            self.balances.write(caller, balance - amount);

            // Transfer USDC to recipient
            let usdc = IERC20Dispatcher { contract_address: self.usdc_address.read() };
            let success = usdc.transfer(recipient, amount);
            assert(success, 'USDC transfer failed');

            self.emit(Withdrawal {
                creator: caller,
                amount,
                recipient,
                timestamp: get_block_timestamp(),
            });
        }

        fn get_balance(self: @ContractState, creator: ContractAddress) -> u256 {
            self.balances.read(creator)
        }

        fn is_nonce_used(self: @ContractState, nonce: felt252) -> bool {
            self.used_nonces.read(nonce)
        }

        fn get_total_payments(self: @ContractState) -> u256 {
            self.total_payments.read()
        }

        fn get_usdc_address(self: @ContractState) -> ContractAddress {
            self.usdc_address.read()
        }

        fn get_platform_fee_bps(self: @ContractState) -> u16 {
            self.platform_fee_bps.read()
        }

        fn set_platform_fee(ref self: ContractState, fee_bps: u16) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
            assert(fee_bps <= 1000, 'Fee cannot exceed 10%');
            self.platform_fee_bps.write(fee_bps);
        }

        fn pause(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
            self.paused.write(true);
        }

        fn unpause(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
            self.paused.write(false);
        }

        fn set_usdc_address(ref self: ContractState, address: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
            self.usdc_address.write(address);
        }
    }
}
