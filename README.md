# COMP5568 — Decentralized Lending Protocol

> The Hong Kong Polytechnic University — COMP5568 Final Project

A decentralized lending and borrowing protocol on Ethereum, inspired by Aave / Compound. Supports two ERC-20 assets, over-collateralized borrowing, a dynamic interest rate model, liquidation, and flash loans.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Smart Contracts](#smart-contracts)
- [Interest Rate Model](#interest-rate-model)
- [Risk Parameters](#risk-parameters)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Running Tests](#running-tests)
- [Design Decisions](#design-decisions)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Commands Reference](#commands-reference)

---

## Features

### Required (Baseline)

| Feature | Status |
|---------|--------|
| MetaMask wallet integration | ✅ |
| Two ERC-20 tokens (C5D stablecoin + WETH) | ✅ |
| Deposit (Supply) | ✅ |
| Withdraw | ✅ |
| Borrow | ✅ |
| Repay | ✅ |
| Over-collateralization logic | ✅ |
| Real-time Health Factor | ✅ |
| LTV limits | ✅ |
| Dynamic interest rate model (utilization-based linear) | ✅ |
| Per-block interest accrual (index mechanism) | ✅ |
| Dashboard (collateral, debt, APY, health factor) | ✅ |

### Bonus

| Feature | Status |
|---------|--------|
| Liquidation mechanism (close factor + 5% bonus) | ✅ |
| Flash Loan (pull-model, 9 bps fee) | ✅ |

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  Dashboard │ Supply/Withdraw │ Borrow/Repay │ Liquidate │ Flash │
└────────────────────────┬────────────────────────────────────────┘
                         │  ethers.js v6
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LendingPool.sol                            │
│                                                                 │
│  deposit()     withdraw()     borrow()      repay()             │
│  liquidate()   flashLoan()    accrueInterest()                  │
│  getHealthFactor()            getBorrowBalance()                │
└────────┬──────────────┬──────────────┬──────────────────────────┘
         │              │              │
         ▼              ▼              ▼
   Stablecoin.sol   MockWETH.sol   IFlashLoanReceiver.sol
   (C5D, $1)        (WETH, $2000)  (flash loan interface)
```

### Transaction Flows

**Deposit & Borrow:**
```
User → approve(LendingPool, amount)
     → deposit(token, amount)          # transfers token, records supply index
     → borrow(token, amount)           # checks LTV, transfers token out
```

**Repay & Withdraw:**
```
User → approve(LendingPool, debt)
     → repay(token, amount)            # accrues interest, reduces borrow balance
     → withdraw(token, amount)         # checks HF remains ≥ 1, transfers back
```

**Liquidation:**
```
Liquidator → approve(LendingPool, repayAmount)
           → liquidate(borrower, debtToken, collateralToken, repayAmount)
             # seizes collateral = repayAmount × debtPrice × 1.05 / collateralPrice
```

**Flash Loan:**
```
Caller → flashLoan(receiver, token, amount, params)
       ← executeOperation(token, amount, fee, params)   # inside receiver
       → receiver approves pool for (amount + fee)
       # pool pulls funds back; reverts if not repaid
```

---

## Smart Contracts

| Contract | Description |
|----------|-------------|
| `LendingPool.sol` | Core protocol: all lending, risk, liquidation, and flash loan logic |
| `Stablecoin.sol` | C5D mock stablecoin, 1 C5D = $1, includes `faucet()` |
| `MockWETH.sol` | Mock WETH, 1 WETH = $2,000, includes `faucet()` |
| `IFlashLoanReceiver.sol` | Interface that flash loan receiver contracts must implement |
| `MockFlashLoanReceiver.sol` | Test-only flash loan receiver |

### LendingPool — Key State Variables

```solidity
// Per-token market data
mapping(address => TokenConfig)   tokenConfig;    // LTV, liquidation threshold, prices
mapping(address => MarketState)   marketState;    // total supply, total borrow, indices

// Per-user per-token balances (stored as scaled indices, not raw amounts)
mapping(address => mapping(address => UserPosition)) userPositions;
```

### Index Mechanism (Interest Accrual)

Interest is not stored as a raw amount. Instead, a global **borrow index** and **supply index** grow every time `accrueInterest()` is called. User balances are derived by:

```
actualBorrow = storedBorrow × currentBorrowIndex / userBorrowIndex
actualSupply = storedSupply × currentSupplyIndex / userSupplyIndex
```

This allows O(1) interest accrual without iterating over all users.

---

## Interest Rate Model

### Linear (Utilization-Based)

```
U          = totalBorrowed / totalSupplied
BorrowAPR  = baseRate + slope × U
SupplyAPR  = BorrowAPR × U × (1 - reserveFactor)   // reserveFactor = 10%
```

### Per-Block Accrual

Rates are expressed annually and converted to per-block rates assuming **2,102,400 blocks/year** (≈ 15 s/block):

```
ratePerBlock = APR / 2_102_400
newIndex     = oldIndex × (1 + ratePerBlock × blockDelta)
```

### Example (C5D at 50% utilization)

| Metric | Calculation | Value |
|--------|-------------|-------|
| Utilization | 500 / 1000 | 50% |
| Borrow APR | 2% + 10% × 0.5 | **7.00%** |
| Supply APR | 7% × 50% × 90% | **3.15%** |

---

## Risk Parameters

| Asset | Price | LTV | Liquidation Threshold | Base Rate | Slope |
|-------|-------|-----|-----------------------|-----------|-------|
| C5D  | $1    | 80% | 85% | 2%/yr | 10%/yr |
| WETH | $2,000 | 75% | 80% | 2%/yr | 20%/yr |

### Health Factor

```
HF = Σ(supplyBalance × price × liquidationThreshold)
     ─────────────────────────────────────────────────
     Σ(borrowBalance × price)

HF ≥ 1.0  →  position is safe
HF < 1.0  →  position can be liquidated
```

### Liquidation

| Parameter | Value |
|-----------|-------|
| Close factor | 50% of debt per call |
| Liquidation bonus | 5% extra collateral |
| Formula | `collateralSeized = repayAmount × debtPrice × 1.05 / collateralPrice` |

### Flash Loan

| Parameter | Value |
|-----------|-------|
| Fee | 9 basis points (0.09%) |
| Repayment model | Pull — receiver must `approve` pool for `amount + fee` inside `executeOperation()` |
| Atomicity | Entire borrow + repay in one transaction; reverts if fee not paid |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Solidity ^0.8.20, OpenZeppelin |
| Local blockchain | Hardhat 2 (chainId: 1337) |
| Frontend | React 18, Vite, Tailwind CSS |
| Web3 | ethers.js v6 |
| Routing | React Router v6 |

---

## Project Structure

```
5568project/
├── contracts/
│   ├── LendingPool.sol           # Core protocol
│   ├── Stablecoin.sol            # C5D stablecoin
│   ├── MockWETH.sol              # Mock WETH
│   ├── IFlashLoanReceiver.sol    # Flash loan interface
│   └── MockFlashLoanReceiver.sol # Test mock
├── test/
│   ├── LendingPool.test.cjs      # 58 tests — core lending
│   ├── Liquidation.test.cjs      # 23 tests — liquidation
│   └── FlashLoan.test.cjs        # 20 tests — flash loan
├── scripts/
│   └── deploy.cjs                # Deploy all contracts, auto-writes addresses
├── frontend/
│   └── src/
│       ├── components/lending/
│       │   ├── Dashboard.jsx         # Position overview
│       │   ├── LendingPage.jsx       # Supply / Withdraw
│       │   ├── BorrowPage.jsx        # Borrow / Repay
│       │   ├── LiquidationPage.jsx   # Liquidate positions
│       │   └── FlashLoanPage.jsx     # Flash loan info & simulator
│       ├── config/
│       │   ├── lendingContracts.js   # Contract addresses (auto-updated by deploy)
│       │   └── lendingAbis.js        # Contract ABIs
│       ├── context/
│       │   └── Web3Context.jsx       # Global wallet state
│       └── App.jsx                   # Routes
├── hardhat.config.cjs
├── package.json
├── SYSTEM_TEST.md                # Manual system test guide (12 test cases)
├── GUIDE.md                      # Extended walkthrough
└── report.md                     # Project report
```

---

## Quick Start

Three terminal windows required.

### Terminal 1 — Start local blockchain

```bash
npm run node
```

Hardhat prints 20 test accounts. Copy the first private key.

### Terminal 2 — Deploy contracts

```bash
npm run deploy
```

Deploys all contracts and writes addresses to `frontend/src/config/lendingContracts.js`. Expected output:

```
Deployment complete!
  C5D:          0x5FbDB2315678afecb367f032d93F642f64180aa3
  WETH:         0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  LendingPool:  0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

### Terminal 3 — Start frontend

```bash
npm run frontend
# → http://localhost:3000
```

### MetaMask Setup

| Field | Value |
|-------|-------|
| Network name | Localhost 8545 |
| RPC URL | http://127.0.0.1:8545 |
| Chain ID | 1337 |
| Currency symbol | ETH |

Import the private key from Terminal 1 into MetaMask. Initial balances after deploy:

| Asset | Amount |
|-------|--------|
| C5D | 100,000 |
| WETH | 50 |
| ETH | ~10,000 |

---

## Running Tests

```bash
npm run test
```

101 tests across three suites:

| Suite | File | Tests | Coverage |
|-------|------|-------|----------|
| Core lending | `LendingPool.test.cjs` | 58 | deposit, withdraw, borrow, repay, interest accrual, index math |
| Liquidation | `Liquidation.test.cjs` | 23 | healthy/unhealthy positions, close factor, bonus calculation |
| Flash loan | `FlashLoan.test.cjs` | 20 | successful loan, fee enforcement, failed repayment revert |

All 101 tests must pass before submitting.

---

## Design Decisions

### Why a linear interest rate model (not kinked)?

A kinked model (like Aave's) introduces a sharp rate jump at an optimal utilization point to protect liquidity. For this project, a single-slope linear model is simpler to reason about and sufficient to demonstrate the utilization → rate → incentive feedback loop. The slope values (10% for C5D, 20% for WETH) are chosen to reflect higher volatility risk for WETH.

### Why separate liquidation threshold from LTV?

LTV (the maximum a user can borrow) and the liquidation threshold (when a position becomes liquidatable) are intentionally different. The gap between them — e.g., LTV 80% vs. threshold 85% for C5D — creates a safety buffer. Without this buffer, any small price movement would immediately liquidate a position at maximum LTV.

### Why a pull-model for flash loans?

The receiver calls `approve(pool, amount + fee)` inside `executeOperation()`, and the pool pulls the funds back at the end. This is simpler and safer than a push model: the pool retains control and can verify the full repayment atomically. If the receiver does not approve, the pool's `transferFrom` fails and the entire transaction reverts.

### Why per-block index accrual instead of continuous compounding?

Continuous compounding requires exponential math (e^x) which is expensive on-chain. The index approach approximates compound interest using `(1 + r)^n` expanded per block, which is computationally cheap and matches Compound's cToken model. The error vs. true continuous compounding is negligible at typical block rates.

### Why mock prices instead of an oracle?

Integrating Chainlink on a local Hardhat chain requires forking mainnet or deploying mock aggregators. To keep the focus on lending mechanics, prices are stored as simple state variables settable by the owner. This also allows the liquidation tests to manipulate prices deterministically.

---

## Security Considerations

### Reentrancy

External token calls (`transfer`, `transferFrom`) follow the **Checks-Effects-Interactions** pattern: all state updates (balances, indices) are written before any external call. Flash loans update the pool state before calling `executeOperation`, then verify the balance afterward.

### Integer Overflow / Underflow

Solidity ^0.8.20 includes built-in overflow checks. Intermediate interest calculations use scaled fixed-point arithmetic (1e18 precision) to avoid precision loss from division before multiplication.

### Access Control

`setTokenPrice` and token registration functions are restricted to the contract owner (deployer). In production this would be replaced by a decentralized oracle and a governance-controlled parameter setter.

### Flash Loan Atomicity

The pool records its token balance before calling the receiver and verifies it increased by at least the fee after the call returns. Any manipulation within `executeOperation` that fails to restore the balance will cause the entire transaction to revert.

### Known Limitations (academic scope)

- Prices are hardcoded/owner-settable (no real oracle)
- Single-block liquidation can be sandwich-attacked in production
- No governance token or timelock on parameter changes
- Interest compounds per-call to `accrueInterest()`, not automatically per-block

---

## Troubleshooting

**MetaMask shows wrong balance after redeploying**

Reset the account nonce: MetaMask → Settings → Advanced → Reset Account.

**`npm run deploy` fails with "nonce too high"**

The local chain was restarted. Reset the MetaMask account (see above) and redeploy.

**Frontend shows "contract not deployed" or zero balances**

The deploy script writes addresses to `frontend/src/config/lendingContracts.js`. Ensure `npm run deploy` completed successfully and the frontend was restarted after deployment.

**Hardhat node port already in use**

```bash
lsof -ti:8545 | xargs kill -9
```

**Test failures after changing contract code**

Recompile before running tests:

```bash
npm run compile && npm run test
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run node` | Start Hardhat local chain (port 8545) |
| `npm run compile` | Compile all Solidity contracts |
| `npm run deploy` | Deploy to local chain, write addresses to frontend config |
| `npm run test` | Run all 101 tests |
| `npm run frontend` | Start React dev server (port 3000) |
