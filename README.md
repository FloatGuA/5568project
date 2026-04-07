# COMP5568 — Decentralized Lending Protocol

> The Hong Kong Polytechnic University — COMP5568 Final Project

A decentralized lending and borrowing protocol on Ethereum, inspired by Aave / Compound. Supports two ERC-20 assets, over-collateralized borrowing, a dynamic interest rate model, liquidation, and flash loans.

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Solidity ^0.8.20, OpenZeppelin |
| Local blockchain | Hardhat 2 (chainId: 1337) |
| Frontend | React 18, Vite, Tailwind CSS |
| Web3 | ethers.js v6 |
| Routing | React Router v6 |

## Smart Contracts

| Contract | Description |
|----------|-------------|
| `Stablecoin.sol` | C5D mock stablecoin, 1 C5D = $1, includes `faucet()` |
| `MockWETH.sol` | Mock WETH, 1 WETH = $2,000, includes `faucet()` |
| `LendingPool.sol` | Core protocol: all lending, risk, liquidation, and flash loan logic |
| `IFlashLoanReceiver.sol` | Interface that flash loan receiver contracts must implement |
| `MockFlashLoanReceiver.sol` | Test-only flash loan receiver |

### Risk Parameters

| Asset | LTV | Liquidation Threshold | Base Rate | Slope |
|-------|-----|-----------------------|-----------|-------|
| C5D  | 80% | 85% | 2%/yr | 10%/yr |
| WETH | 75% | 80% | 2%/yr | 20%/yr |

### Interest Rate Model (Linear)

```
U          = totalBorrowed / totalSupplied
BorrowAPR  = baseRate + slope × U
SupplyAPR  = BorrowAPR × U × 90%   (10% reserve factor)
```

### Health Factor

```
HF = Σ(supplyBalance × price × liquidationThreshold) / Σ(borrowBalance × price)

HF ≥ 1.0  →  position is safe
HF < 1.0  →  position can be liquidated
```

### Liquidation

- Close factor: 50% of debt per call
- Liquidation bonus: 5% extra collateral to liquidator
- `collateralSeized = repayAmount × debtPrice × 1.05 / collateralPrice`

### Flash Loan

- Fee: 9 basis points (0.09%)
- Pull repayment model: receiver must `approve` pool for `amount + fee` inside `executeOperation()`

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
│   └── deploy.cjs                # Deploy script
├── frontend/
│   └── src/
│       ├── components/lending/
│       │   ├── Dashboard.jsx         # Position overview
│       │   ├── LendingPage.jsx       # Supply / Withdraw
│       │   ├── BorrowPage.jsx        # Borrow / Repay
│       │   ├── LiquidationPage.jsx   # Liquidate positions
│       │   └── FlashLoanPage.jsx     # Flash loan info
│       ├── config/
│       │   ├── lendingContracts.js   # Contract addresses (auto-updated by deploy)
│       │   └── lendingAbis.js        # Contract ABIs
│       ├── context/
│       │   └── Web3Context.jsx       # Global wallet state
│       └── App.jsx                   # Routes
├── hardhat.config.cjs
├── package.json
├── SYSTEM_TEST.md                # System test guide
└── report.md                     # Project report
```

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

Deploys all contracts and writes addresses to `frontend/src/config/lendingContracts.js`.

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

Import the private key from Terminal 1 into MetaMask.

## Commands

| Command | Description |
|---------|-------------|
| `npm run node` | Start Hardhat local chain |
| `npm run compile` | Compile Solidity contracts |
| `npm run deploy` | Deploy to local chain |
| `npm run test` | Run all 101 tests |
| `npm run frontend` | Start React frontend |
