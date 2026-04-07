# COMP5568 Final Project Report
## Decentralized Lending & Borrowing Protocol

**Course:** COMP5568 — Advanced Topics in Blockchain and Decentralized Applications  
**Institution:** The Hong Kong Polytechnic University  
**Submission Date:** April 2026

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Project Requirements](#2-project-requirements)
   - 2.1 Required (Baseline) Features
   - 2.2 Optional (Bonus) Features
   - 2.3 Completion Summary
3. [System Architecture](#3-system-architecture)
4. [Core Features](#4-core-features)
   - 4.1 Web3 Wallet Integration
   - 4.2 Supported Assets
   - 4.3 Core Lending Operations
   - 4.4 Risk Management
   - 4.5 Interest Rate Model
   - 4.6 Dashboard
5. [Bonus Features](#5-bonus-features)
   - 5.1 Liquidation Mechanism
   - 5.2 Flash Loan
6. [Smart Contract Design](#6-smart-contract-design)
7. [Testing](#7-testing)
8. [Design Decisions & Trade-offs](#8-design-decisions--trade-offs)
9. [Known Limitations](#9-known-limitations)
10. [Conclusion](#10-conclusion)

---

## 1. Introduction

This project implements a fully functional **Decentralized Lending and Borrowing Protocol** on the Ethereum blockchain, inspired by real-world protocols such as Aave and Compound. Users can deposit assets to earn interest, borrow against their collateral, and manage their risk exposure through a real-time health factor dashboard.

Beyond the required baseline features, the protocol implements two optional bonus features: a liquidation mechanism and flash loans.

The system is deployed on a local Hardhat chain (chainId 1337) and includes a React-based frontend connected via MetaMask. All smart contract logic is validated by 101 automated unit and integration tests.

---

## 2. Project Requirements

This section restates the assignment requirements as specified in the course specification, and maps each item to its implementation status.

### 2.1 Required (Baseline) Features

The following five areas are mandatory for all groups.

**R1 — Web3 Wallet Integration**

> Integrate a Web3 wallet such as MetaMask.

Users connect MetaMask to the frontend. The application requests permission to read the wallet address and sign transactions. All write operations (deposit, withdraw, borrow, repay, liquidate, claim rewards) are sent through the connected signer.

**R2 — Lending Pool Mechanics**

> Support at least two ERC-20 tokens (e.g., a stablecoin + a volatile asset). Users must be able to perform four core operations: Deposit (Supply), Withdraw, Borrow, and Repay.

Two tokens are supported: **C5D** (a mock stablecoin pegged at $1) and **WETH** (a mock wrapped ETH valued at $2,000). All four operations are implemented in `LendingPool.sol` and exposed through dedicated frontend pages.

**R3 — Risk Management**

> Implement over-collateralization logic, real-time Health Factor display, and Loan-to-Value (LTV) limits.

Borrowing requires collateral that exceeds the loan value. The Health Factor (HF) is computed as the weighted collateral value divided by total debt; the position becomes liquidatable when HF < 1. The LTV ratio caps how much a user may borrow against each collateral asset. HF is displayed in real time on the Dashboard and Borrow pages.

**R4 — Interest Rate Model**

> Implement a dynamic interest rate model based on Utilization Rate (linear or kinked model). Accrue interest per block for both depositors and borrowers.

A linear model is used: `BorrowAPR = baseRate + slope × U`, where U is the utilization rate. Interest accrues every block via a Compound-style cumulative index mechanism — no per-user iteration is required.

**R5 — Dashboard**

> Display the user's current position: total collateral, total debt, current APY (supply/borrow), Health Factor, and other relevant data.

The Dashboard page shows total collateral value (USD), total debt (USD), health factor, per-asset supply and borrow balances, per-market APYs, utilization rates, and total value locked.

---

### 2.2 Optional (Bonus) Features

Two bonus features have been implemented.

**B1 — Liquidation Mechanism**

> When Health Factor < 1, allow a third party to liquidate the position. Implement a liquidation spread / bonus to incentivize liquidators.

Implemented in `liquidate()`. Any address can repay up to 50% of an undercollateralized borrower's debt (close factor) and receive the equivalent collateral value plus a fixed **5% liquidation bonus**.

**B2 — Flash Loan**

> Implement a flash loan interface compatible with the lending pool.

Implemented in `flashLoan()`. The pull-model interface (`IFlashLoanReceiver`) allows any contract to borrow an arbitrary amount within a single transaction, provided it repays `amount + fee` (9 basis points) before the call returns.

---

### 2.3 Completion Summary

| # | Requirement | Category | Status |
|---|-------------|----------|--------|
| R1 | Web3 wallet integration (MetaMask) | Required | Complete |
| R2 | Two ERC-20 tokens (C5D + WETH) | Required | Complete |
| R2 | Deposit / Withdraw / Borrow / Repay | Required | Complete |
| R3 | Over-collateralization logic | Required | Complete |
| R3 | Real-time Health Factor | Required | Complete |
| R3 | LTV limits | Required | Complete |
| R4 | Utilization-based interest rate model | Required | Complete |
| R4 | Per-block interest accrual | Required | Complete |
| R5 | Dashboard (collateral, debt, APY, HF) | Required | Complete |
| B1 | Liquidation mechanism with bonus | Bonus | Complete |
| B2 | Flash loan interface | Bonus | Complete |

---

## 3. System Architecture

The system is organized into three layers:

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                 │
│                                                              │
│  Dashboard · Supply · Borrow · Liquidate · Flash Loan        │
│                                                              │
│       ↕  ethers.js v6  (readProvider + MetaMask signer)     │
└──────────────────────────┬──────────────────────────────────┘
                           │  JSON-RPC  (port 8545)
┌──────────────────────────▼──────────────────────────────────┐
│               Hardhat Local Chain  (chainId 1337)            │
│                                                              │
│             LendingPool.sol                                  │
│         ↕ IERC20            ↕ IFlashLoanReceiver             │
│   Stablecoin.sol      MockWETH.sol                           │
└─────────────────────────────────────────────────────────────┘
```

**Key architectural choices:**

- **Read/write separation in the frontend.** All read-only calls use a `JsonRpcProvider` that connects directly to the Hardhat node, bypassing MetaMask. Write transactions are sent through the MetaMask signer. This eliminates a known MetaMask bug where `eth_call` responses are occasionally stale.

- **Single monolithic contract.** All lending logic lives in `LendingPool.sol`. This simplifies composability and avoids cross-contract call overhead for core operations. The only external contract call at runtime is to the `IFlashLoanReceiver` interface during flash loans.

- **Hardhat chainId 1337 (not 31337).** The MetaMask Blockaid security plugin intercepts transactions on chainId 31337, preventing confirmation. Using the standard local-chain id 1337 avoids this issue without any other configuration changes.

---

## 4. Core Features

### 4.1 Web3 Wallet Integration

The frontend integrates with MetaMask via ethers.js v6. A `Web3Context` React context manages the wallet state (account address, signer, connection status) and is shared across all pages. Users connect once and all subsequent pages inherit the session.

The context also handles network switching: if the user is connected to the wrong chain, it prompts MetaMask to add/switch to the local Hardhat network automatically.

### 4.2 Supported Assets

Two ERC-20 tokens are deployed as representative asset classes:

| Token | Symbol | Price | Represents |
|-------|--------|-------|------------|
| Stablecoin | C5D | $1.00 USD | Stable asset (analogous to USDC) |
| Mock WETH | WETH | $2,000 USD | Volatile asset (analogous to ETH) |

Both contracts include a `faucet()` function that mints test tokens to any caller, enabling end-to-end demonstration without external bridging.

Risk parameters per asset:

| Asset | LTV | Liquidation Threshold | Base Rate | Slope |
|-------|-----|-----------------------|-----------|-------|
| C5D  | 80% | 85% | 2%/yr | 10%/yr |
| WETH | 75% | 80% | 2%/yr | 20%/yr |

The LTV is always lower than the liquidation threshold, creating a buffer zone that gives borrowers time to add collateral before their position becomes liquidatable.

### 4.3 Core Lending Operations

All four required operations are implemented in `LendingPool.sol`:

**`deposit(address token, uint256 amount)`** — Transfers `amount` of `token` from the caller to the pool. The caller's balance is recorded as a scaled amount (`amount * 1e18 / supplyIndex`) so that interest accrues automatically as the supply index grows. Emits `Deposit`.

**`withdraw(address token, uint256 amount)`** — Allows withdrawal of any amount up to the caller's current supply balance. Passing `type(uint256).max` withdraws everything. A health factor check prevents withdrawal that would undercollateralize an active borrow position. Emits `Withdraw`.

**`borrow(address token, uint256 amount)`** — Borrows `amount` of `token` from the pool, subject to: (a) sufficient pool liquidity, and (b) health factor remaining ≥ 1.0 after the borrow. Interest accrues on the borrow position immediately via the index mechanism. Emits `Borrow`.

**`repay(address token, uint256 amount)`** — Repays a borrow position. Passing `type(uint256).max` repays the full outstanding balance. The repayment amount is capped at the actual debt to prevent over-payment. Emits `Repay`.

All four functions call `_accrueInterest(token)` at the start to bring the market state up to date before any balance calculations are performed.

### 4.4 Risk Management

**Over-collateralization.** Every borrow is collateralized by the user's existing supply positions. The maximum borrowable amount is determined by the Loan-to-Value (LTV) ratio of each collateral asset.

**Health Factor (HF).** The health factor quantifies the safety margin of a position:

```
HF = Σ (supplyBalance_i × price_i × liquidationThreshold_i / 100)
   / Σ (borrowBalance_i × price_i)
```

HF is computed with 18-decimal precision (1e18 = 1.0). When HF drops below 1.0, the position is eligible for liquidation. If a user has no outstanding borrows, HF returns `type(uint256).max` (effectively infinite).

The frontend displays HF with a color-coded badge: green (> 1.5), yellow (1.0–1.5), red (< 1.0).

**LTV enforcement.** Before accepting a borrow, the contract checks that the new HF (computed using the liquidation threshold, not LTV) would remain ≥ 1.0. This means a user cannot borrow right up to the liquidation threshold — there is an implicit safety buffer between the LTV cap and the liquidation threshold.

### 4.5 Interest Rate Model

The protocol uses a **linear interest rate model** based on the utilization rate of each market:

```
U   = totalBorrowed / totalSupplied               (utilization rate, 0–100%)
APR_borrow = baseRate + slope × U
APR_supply = APR_borrow × U × (1 − reserveFactor)
```

A 10% reserve factor is applied: 90% of borrow interest flows to suppliers, and 10% is retained by the protocol as reserves.

**Index-based per-block accrual.** Interest is not accumulated on a per-user basis. Instead, two cumulative indexes (`borrowIndex`, `supplyIndex`) grow each block:

```
newBorrowIndex = borrowIndex × (1 + borrowRatePerBlock × blockDelta)
newSupplyIndex = supplyIndex × (1 + supplyRatePerBlock × blockDelta)
```

User balances are stored as _scaled amounts_: `scaledAmount = principal / indexAtEntryTime`. The current balance is always `scaledAmount × currentIndex`. This design, identical to Compound's cToken mechanism, means interest is applied to all positions simultaneously by updating a single number — no per-user loops are needed.

### 4.6 Dashboard

The dashboard aggregates all user and market data in a single view:

- **Position summary:** total collateral value (USD), total debt (USD), current health factor
- **Per-market breakdown:** supply balance, borrow balance, supply APY, borrow APY, max borrowable amount
- **Market overview:** total value locked (TVL), total borrowed, utilization rate for each asset

The frontend polls `getMarketData()` and `getUserData()` — two batched view functions that return all relevant data in a single call — to minimize RPC round-trips.

---

## 5. Bonus Features

Two bonus features have been implemented.

### 5.1 Liquidation Mechanism

When a borrower's health factor drops below 1.0, any third party may call `liquidate()` to repay part of the debt and receive discounted collateral.

**Function signature:**
```solidity
function liquidate(
    address borrower,
    address debtToken,
    uint256 repayAmount,
    address collateralToken
) external
```

**Rules:**
- The borrower's HF must be strictly below 1.0 at the time of the call.
- The liquidator may repay at most 50% of the borrower's current debt in `debtToken` (the _close factor_). This prevents a single liquidation from wiping out a position entirely, which could lead to bad debt if the market moves rapidly.
- The liquidator receives collateral worth the repaid debt value plus a fixed **5% liquidation bonus**:

```
collateralSeized = repayAmount × debtPrice × 105 / collateralPrice / 100
```

**Frontend (LiquidationPage):** Scans the first ten Hardhat accounts for positions with HF < 1. Displays a sortable table with health factor, collateral value, debt value, and a one-click liquidation form with a "50% MAX" auto-fill button. Shows the expected collateral received in real time before submission.

### 5.2 Flash Loan

Flash loans allow borrowing any amount within a single transaction, provided the full amount plus a fee is returned before the transaction ends.

**Function signature:**
```solidity
function flashLoan(
    address receiver,
    address token,
    uint256 amount,
    bytes calldata data
) external
```

**Implementation (pull repayment model):**

1. The pool transfers `amount` to `receiver`.
2. The pool calls `receiver.executeOperation(token, amount, fee, data)`.
3. Inside `executeOperation`, the receiver must approve the pool for `amount + fee`.
4. The pool calls `transferFrom(receiver, pool, amount + fee)`.
5. The pool verifies: `balanceAfter ≥ balanceBefore + fee`.

The fee is **9 basis points** (0.09%), matching Aave v2. The pull model is preferred over push because it requires the receiver to explicitly authorize the repayment — there is no way to accidentally forget to repay, and the final balance check provides a redundant safety assertion.

**IFlashLoanReceiver interface:**
```solidity
interface IFlashLoanReceiver {
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}
```

**Frontend (FlashLoanPage):** Displays pool liquidity per asset, fee rate in basis points, a fee simulator, and a complete code example showing how to implement a flash loan receiver contract.

---

## 6. Smart Contract Design

### Contract Inventory

| Contract | Purpose |
|----------|---------|
| `LendingPool.sol` | Core protocol: all lending, risk, liquidation, and flash loan logic |
| `Stablecoin.sol` | Mock ERC-20 C5D ($1), includes `faucet()` |
| `MockWETH.sol` | Mock ERC-20 WETH ($2000), includes `faucet()` |
| `IFlashLoanReceiver.sol` | Interface that flash loan receivers must implement |
| `MockFlashLoanReceiver.sol` | Test-only mock flash loan receiver |

### Key Data Structures

**`TokenConfig`** — static configuration per supported asset:
```solidity
struct TokenConfig {
    bool    supported;
    uint256 ltv;                   // max borrow % (e.g. 75)
    uint256 liquidationThreshold;  // liquidation trigger % (e.g. 80)
    uint256 baseRatePerYear;       // base borrow APR %
    uint256 slopePerYear;          // slope APR % at 100% utilization
}
```

**`MarketState`** — dynamic per-market state:
```solidity
struct MarketState {
    uint256 totalScaledSupply;  // Σ(amount × 1e18 / supplyIndex at deposit time)
    uint256 totalScaledBorrow;  // Σ(amount × 1e18 / borrowIndex at borrow time)
    uint256 borrowIndex;        // cumulative borrow interest multiplier (starts at 1e18)
    uint256 supplyIndex;        // cumulative supply interest multiplier (starts at 1e18)
    uint256 lastUpdateBlock;    // block number of last _accrueInterest call
}
```

### Protocol Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `PRECISION` | 1e18 | Fixed-point denominator |
| `BLOCKS_PER_YEAR` | 2,102,400 | ~15s/block on Ethereum |
| `RESERVE_FACTOR` | 10 | 10% of interest to protocol |
| `LIQUIDATION_BONUS` | 5 | 5% bonus to liquidators |
| `CLOSE_FACTOR` | 50 | Max 50% of debt per liquidation |
| `FLASH_LOAN_FEE` | 9 | 9 basis points (0.09%) |

---

## 7. Testing

The test suite comprises **101 tests across 3 files**, all passing.

| File | Tests | Scope |
|------|-------|-------|
| `test/LendingPool.test.cjs` | 58 | Deployment, token config, deposit, withdraw, borrow, repay, health factor, interest rate model, all view functions, full lifecycle integration |
| `test/Liquidation.test.cjs` | 23 | Guard conditions, collateral seizure math, bonus accuracy, multi-user integration |
| `test/FlashLoan.test.cjs` | 20 | Guard conditions, pull repayment, fee precision (9 bps), pool state integrity |

**Test design principles:**

- Each `describe` block takes an `evm_snapshot` in `beforeEach` and reverts in `afterEach`. This gives every test a clean, isolated state without redeploying contracts.
- `before()` deploys contracts once per file, keeping the full suite runtime under 4 seconds.
- Tests validate both the happy path and guard conditions (reverts with specific error messages).
- All BigInt comparisons use `closeTo` with an explicit tolerance where block-mining overhead introduces ±1 block of variance.

```
$ npm test
  101 passing (2s)
```

---

## 8. Design Decisions & Trade-offs

**Index-based interest accrual vs. per-user computation**

The Compound-style cumulative index approach updates a single number per market per block. Individual user balances are computed on-demand as `scaledAmount × currentIndex`. This is O(1) regardless of the number of users and requires no iteration. The trade-off is that full repayment can leave a 1 wei residual due to integer rounding in `scaledAmount = repayAmount × 1e18 / borrowIndex` — when `scaledAmount` rounds down to 0 at the final repayment, a tiny scaled debt remains. This is an accepted and documented limitation (see §8).

**Fixed 5% liquidation bonus vs. per-asset configuration**

A global constant (`LIQUIDATION_BONUS = 5`) was chosen over a per-token parameter in `TokenConfig`. For a two-asset protocol in an educational context, a global constant is simpler and easier to reason about. A real production protocol (Aave) uses per-asset liquidation incentives because assets have different volatility profiles.

**Pull repayment for flash loans vs. push (balance check only)**

The pull model requires the receiver to `approve` the pool for `amount + fee` within the same transaction. This is safer than the push model (where the pool checks `balanceAfter ≥ balanceBefore + fee` without a specific transferFrom) because it makes the repayment explicit and auditable. The balance check is kept as a redundant assertion.

---

## 9. Known Limitations

| Limitation | Impact | Notes |
|-----------|--------|-------|
| `repay(MAX_UINT)` leaves 1 wei residual | Minor; blocks full collateral withdrawal if any debt remains | Inherent to index-based accounting; documented in tests |
| LiquidationPage scans only the first 10 Hardhat accounts | Demo limitation; cannot discover arbitrary addresses | Production system would use event indexing (e.g., The Graph) |
| Linear interest rate model | Suboptimal incentive structure at extreme utilization rates | A kinked model (higher slope above optimal utilization) would better discourage 100% utilization |

---

## 10. Conclusion

This project delivers a complete decentralized lending protocol that implements all required baseline features and all five bonus features specified in the assignment rubric.

**Baseline features:** MetaMask wallet integration, a two-asset lending pool (C5D stablecoin and WETH), all four core operations (deposit, withdraw, borrow, repay), over-collateralization with real-time health factor tracking, LTV limits, a utilization-based linear interest rate model with per-block index accrual, and a real-time dashboard.

**Bonus features:** A liquidation mechanism with a close factor and liquidation bonus; flash loans with a pull-model repayment interface compatible with the `IFlashLoanReceiver` standard.

The implementation prioritizes correctness and clarity over production-readiness. The 101-test suite provides high confidence that the core invariants (health factor calculations, interest accrual, liquidation math, flash loan fee accounting) hold under a wide range of scenarios. Design decisions were guided by the same principles that underpin real DeFi protocols — index-based accounting, pull-model repayments — applied at the appropriate scale for an educational project.

---

*Report generated for COMP5568 Final Project submission.*
