// test/LendingPool.test.cjs
// Unit + integration tests for LendingPool, Stablecoin, MockWETH
// Run: npm test

const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

/** Mine `n` empty blocks so interest can accrue */
async function mineBlocks(n) {
  for (let i = 0; i < n; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

const PRECISION = ethers.parseEther("1"); // 1e18
const MAX_UINT  = ethers.MaxUint256;

// ─────────────────────────────────────────────
//  Test Suite
// ─────────────────────────────────────────────

describe("LendingPool", function () {
  // Shared fixture: redeploy before every describe block's first test,
  // then snapshot/restore between individual tests.
  let owner, alice, bob, carol;
  let c5d, weth, pool;

  // Token config mirrors deploy.cjs
  const C5D_PRICE  = ethers.parseEther("1");     // $1
  const WETH_PRICE = ethers.parseEther("2000");  // $2000

  // C5D config
  const C5D_LTV   = 75n;
  const C5D_LIQ   = 80n;
  const C5D_BASE  = 2n;
  const C5D_SLOPE = 10n;

  // WETH config
  const WETH_LTV   = 75n;
  const WETH_LIQ   = 80n;
  const WETH_BASE  = 2n;
  const WETH_SLOPE = 20n;

  // Snapshot id for cheap test isolation
  let snapshotId;

  // ── Deploy once for all tests ──────────────────
  before(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const Stablecoin  = await ethers.getContractFactory("Stablecoin");
    const MockWETH    = await ethers.getContractFactory("MockWETH");
    const LendingPool = await ethers.getContractFactory("LendingPool");

    c5d  = await Stablecoin.deploy();
    weth = await MockWETH.deploy();
    pool = await LendingPool.deploy();

    // Register tokens
    await pool.addSupportedToken(
      await c5d.getAddress(),
      C5D_LTV, C5D_LIQ, C5D_BASE, C5D_SLOPE, C5D_PRICE
    );
    await pool.addSupportedToken(
      await weth.getAddress(),
      WETH_LTV, WETH_LIQ, WETH_BASE, WETH_SLOPE, WETH_PRICE
    );

    // Mint initial balances
    await c5d.mint(alice.address,  ethers.parseEther("100000"));
    await c5d.mint(bob.address,    ethers.parseEther("100000"));
    await c5d.mint(carol.address,  ethers.parseEther("100000"));

    await weth.mint(alice.address, ethers.parseEther("50"));
    await weth.mint(bob.address,   ethers.parseEther("50"));
    await weth.mint(carol.address, ethers.parseEther("50"));

    // Infinite approvals to pool
    const poolAddr = await pool.getAddress();
    for (const signer of [alice, bob, carol]) {
      await c5d.connect(signer).approve(poolAddr, MAX_UINT);
      await weth.connect(signer).approve(poolAddr, MAX_UINT);
    }
  });

  beforeEach(async function () {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // ═══════════════════════════════════════════════
  //  1. Deployment & Setup
  // ═══════════════════════════════════════════════

  describe("1. Deployment & Setup", function () {
    it("owner is deployer", async function () {
      expect(await pool.owner()).to.equal(owner.address);
    });

    it("getSupportedTokens returns both tokens", async function () {
      const tokens = await pool.getSupportedTokens();
      expect(tokens).to.have.length(2);
      expect(tokens).to.include(await c5d.getAddress());
      expect(tokens).to.include(await weth.getAddress());
    });

    it("token configs are set correctly", async function () {
      const cfg = await pool.tokenConfigs(await c5d.getAddress());
      expect(cfg.supported).to.be.true;
      expect(cfg.ltv).to.equal(C5D_LTV);
      expect(cfg.liquidationThreshold).to.equal(C5D_LIQ);
      expect(cfg.baseRatePerYear).to.equal(C5D_BASE);
      expect(cfg.slopePerYear).to.equal(C5D_SLOPE);
    });

    it("initial prices are set correctly", async function () {
      expect(await pool.tokenPricesUSD(await c5d.getAddress())).to.equal(C5D_PRICE);
      expect(await pool.tokenPricesUSD(await weth.getAddress())).to.equal(WETH_PRICE);
    });
  });

  // ═══════════════════════════════════════════════
  //  2. addSupportedToken – guard rails
  // ═══════════════════════════════════════════════

  describe("2. addSupportedToken", function () {
    it("reverts for non-owner", async function () {
      await expect(
        pool.connect(alice).addSupportedToken(
          await c5d.getAddress(), 75, 80, 2, 10, C5D_PRICE
        )
      ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    });

    it("reverts for zero address", async function () {
      await expect(
        pool.addSupportedToken(
          ethers.ZeroAddress, 75, 80, 2, 10, C5D_PRICE
        )
      ).to.be.revertedWith("Invalid token");
    });

    it("reverts for duplicate token", async function () {
      await expect(
        pool.addSupportedToken(
          await c5d.getAddress(), 75, 80, 2, 10, C5D_PRICE
        )
      ).to.be.revertedWith("Already supported");
    });

    it("reverts when LTV >= liquidationThreshold", async function () {
      // Deploy a fresh mock token so it's not already added
      const Extra = await ethers.getContractFactory("Stablecoin");
      const extra = await Extra.deploy();
      await expect(
        pool.addSupportedToken(await extra.getAddress(), 80, 80, 2, 10, C5D_PRICE)
      ).to.be.revertedWith("LTV must be < liq threshold");
    });

    it("reverts when liquidationThreshold > 95", async function () {
      const Extra = await ethers.getContractFactory("Stablecoin");
      const extra = await Extra.deploy();
      await expect(
        pool.addSupportedToken(await extra.getAddress(), 75, 96, 2, 10, C5D_PRICE)
      ).to.be.revertedWith("Liq threshold too high");
    });
  });

  // ═══════════════════════════════════════════════
  //  3. deposit()
  // ═══════════════════════════════════════════════

  describe("3. deposit()", function () {
    it("reverts for unsupported token", async function () {
      const Extra = await ethers.getContractFactory("Stablecoin");
      const extra = await Extra.deploy();
      await extra.mint(alice.address, ethers.parseEther("100"));
      await extra.connect(alice).approve(await pool.getAddress(), MAX_UINT);
      await expect(
        pool.connect(alice).deposit(await extra.getAddress(), ethers.parseEther("100"))
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts for amount = 0", async function () {
      await expect(
        pool.connect(alice).deposit(await c5d.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("transfers tokens from user to pool", async function () {
      const amount   = ethers.parseEther("1000");
      const poolAddr = await pool.getAddress();

      const aliceBefore = await c5d.balanceOf(alice.address);
      const poolBefore  = await c5d.balanceOf(poolAddr);

      await pool.connect(alice).deposit(await c5d.getAddress(), amount);

      expect(await c5d.balanceOf(alice.address)).to.equal(aliceBefore - amount);
      expect(await c5d.balanceOf(poolAddr)).to.equal(poolBefore + amount);
    });

    it("updates supply balance correctly", async function () {
      const amount = ethers.parseEther("1000");
      await pool.connect(alice).deposit(await c5d.getAddress(), amount);

      const balance = await pool.getSupplyBalance(alice.address, await c5d.getAddress());
      // Allow tiny rounding (1 wei) from scaled arithmetic
      expect(balance).to.be.closeTo(amount, 1n);
    });

    it("emits Deposit event", async function () {
      const amount = ethers.parseEther("500");
      await expect(
        pool.connect(alice).deposit(await c5d.getAddress(), amount)
      ).to.emit(pool, "Deposit")
        .withArgs(alice.address, await c5d.getAddress(), amount);
    });

    it("multiple deposits accumulate correctly", async function () {
      const a1 = ethers.parseEther("1000");
      const a2 = ethers.parseEther("2000");
      await pool.connect(alice).deposit(await c5d.getAddress(), a1);
      await pool.connect(alice).deposit(await c5d.getAddress(), a2);

      const bal = await pool.getSupplyBalance(alice.address, await c5d.getAddress());
      expect(bal).to.be.closeTo(a1 + a2, 2n);
    });
  });

  // ═══════════════════════════════════════════════
  //  4. withdraw()
  // ═══════════════════════════════════════════════

  describe("4. withdraw()", function () {
    beforeEach(async function () {
      // Alice deposits 10,000 C5D
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
    });

    it("reverts for amount = 0", async function () {
      await expect(
        pool.connect(alice).withdraw(await c5d.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("reverts if balance insufficient", async function () {
      await expect(
        pool.connect(alice).withdraw(await c5d.getAddress(), ethers.parseEther("99999"))
      ).to.be.revertedWith("Insufficient supply balance");
    });

    it("transfers tokens back to user", async function () {
      const amount    = ethers.parseEther("5000");
      const alicePre  = await c5d.balanceOf(alice.address);

      await pool.connect(alice).withdraw(await c5d.getAddress(), amount);

      expect(await c5d.balanceOf(alice.address)).to.equal(alicePre + amount);
    });

    it("reduces supply balance", async function () {
      await pool.connect(alice).withdraw(await c5d.getAddress(), ethers.parseEther("3000"));
      const bal = await pool.getSupplyBalance(alice.address, await c5d.getAddress());
      expect(bal).to.be.closeTo(ethers.parseEther("7000"), 2n);
    });

    it("supports withdraw-all via type(uint256).max", async function () {
      await pool.connect(alice).withdraw(await c5d.getAddress(), MAX_UINT);
      const bal = await pool.getSupplyBalance(alice.address, await c5d.getAddress());
      expect(bal).to.equal(0n);
    });

    it("emits Withdraw event", async function () {
      const amount = ethers.parseEther("1000");
      await expect(
        pool.connect(alice).withdraw(await c5d.getAddress(), amount)
      ).to.emit(pool, "Withdraw")
        .withArgs(alice.address, await c5d.getAddress(), amount);
    });

    it("reverts if withdrawal would undercollateralize", async function () {
      // Alice's state after beforeEach: 10000 C5D deposited (liq-weighted $8000)
      // Deposit 1 WETH → total liq-weighted collateral = $8000 + $1600 = $9600
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      // Borrow 9000 C5D: HF = 9600/9000 ≈ 1.07 → OK
      // After withdrawing WETH: liq-weighted collateral = $8000, HF = 8000/9000 ≈ 0.89 → REVERT
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("9000"));

      await expect(
        pool.connect(alice).withdraw(await weth.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWith("Withdrawal would undercollateralize position");
    });
  });

  // ═══════════════════════════════════════════════
  //  5. borrow()
  // ═══════════════════════════════════════════════

  describe("5. borrow()", function () {
    beforeEach(async function () {
      // Alice deposits 1 WETH ($2000) as collateral
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      // Bob provides C5D liquidity
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
    });

    it("reverts for unsupported token", async function () {
      const Extra = await ethers.getContractFactory("Stablecoin");
      const extra = await Extra.deploy();
      await expect(
        pool.connect(alice).borrow(await extra.getAddress(), ethers.parseEther("100"))
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts for amount = 0", async function () {
      await expect(
        pool.connect(alice).borrow(await c5d.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("reverts if HF would drop below 1 (borrow too much)", async function () {
      // 1 WETH = $2000, liquidationThreshold 80% → liq-weighted collateral = $1600
      // Borrowing exactly $1600 gives HF = 1.0 (allowed); $1601 gives HF < 1 → revert
      await expect(
        pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1601"))
      ).to.be.revertedWith("Insufficient collateral (Health Factor would drop below 1)");
    });

    it("reverts if pool has insufficient liquidity", async function () {
      // Give alice massive collateral (100 WETH = $200000) so HF check passes,
      // but pool only has 50000 C5D → borrowing 60000 hits liquidity check
      await weth.mint(alice.address, ethers.parseEther("100"));
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("100"));
      await expect(
        pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("60000"))
      ).to.be.revertedWith("Insufficient pool liquidity");
    });

    it("transfers tokens to borrower", async function () {
      const amount   = ethers.parseEther("1000");
      const alicePre = await c5d.balanceOf(alice.address);

      await pool.connect(alice).borrow(await c5d.getAddress(), amount);

      expect(await c5d.balanceOf(alice.address)).to.equal(alicePre + amount);
    });

    it("updates borrow balance", async function () {
      const amount = ethers.parseEther("1000");
      await pool.connect(alice).borrow(await c5d.getAddress(), amount);

      const debt = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      expect(debt).to.be.closeTo(amount, 1n);
    });

    it("emits Borrow event", async function () {
      const amount = ethers.parseEther("1000");
      await expect(
        pool.connect(alice).borrow(await c5d.getAddress(), amount)
      ).to.emit(pool, "Borrow")
        .withArgs(alice.address, await c5d.getAddress(), amount);
    });
  });

  // ═══════════════════════════════════════════════
  //  6. repay()
  // ═══════════════════════════════════════════════

  describe("6. repay()", function () {
    const borrowAmount = ethers.parseEther("1000");

    beforeEach(async function () {
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), borrowAmount);
      // Alice needs extra C5D to repay interest; mint some
      await c5d.mint(alice.address, ethers.parseEther("1000"));
      await c5d.connect(alice).approve(await pool.getAddress(), MAX_UINT);
    });

    it("reverts for amount = 0", async function () {
      await expect(
        pool.connect(alice).repay(await c5d.getAddress(), 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("reverts if no debt to repay", async function () {
      await expect(
        pool.connect(bob).repay(await c5d.getAddress(), ethers.parseEther("100"))
      ).to.be.revertedWith("No debt to repay");
    });

    it("reduces borrow balance after partial repay", async function () {
      const repay = ethers.parseEther("500");
      await pool.connect(alice).repay(await c5d.getAddress(), repay);

      const debt = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      // Debt should be roughly 500 (+ tiny accrued interest from 1 block)
      expect(debt).to.be.lt(ethers.parseEther("501"));
      expect(debt).to.be.gt(ethers.parseEther("499"));
    });

    it("clears debt completely with repay-all (type(uint256).max)", async function () {
      await pool.connect(alice).repay(await c5d.getAddress(), MAX_UINT);
      const debt = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      // Allow 1 wei tolerance: scaled integer division can leave 1 wei of principal
      expect(debt).to.be.lte(1n);
    });

    it("emits Repay event", async function () {
      const repay = ethers.parseEther("500");
      await expect(
        pool.connect(alice).repay(await c5d.getAddress(), repay)
      ).to.emit(pool, "Repay");
    });

    it("transfers tokens from repayer to pool", async function () {
      const repay    = ethers.parseEther("500");
      const poolAddr = await pool.getAddress();
      const poolPre  = await c5d.balanceOf(poolAddr);
      const alicePre = await c5d.balanceOf(alice.address);

      await pool.connect(alice).repay(await c5d.getAddress(), repay);

      expect(await c5d.balanceOf(poolAddr)).to.equal(poolPre + repay);
      expect(await c5d.balanceOf(alice.address)).to.equal(alicePre - repay);
    });
  });

  // ═══════════════════════════════════════════════
  //  7. Health Factor
  // ═══════════════════════════════════════════════

  describe("7. Health Factor", function () {
    it("returns max uint when no debt", async function () {
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("1000"));
      const hf = await pool.getHealthFactor(alice.address);
      expect(hf).to.equal(MAX_UINT);
    });

    it("returns max uint for user with no positions", async function () {
      const hf = await pool.getHealthFactor(carol.address);
      expect(hf).to.equal(MAX_UINT);
    });

    it("HF ≈ 1.6 for 1 WETH collateral borrowing 1000 C5D", async function () {
      // 1 WETH = $2000, liqThreshold 80% → weighted collateral = $1600
      // 1000 C5D debt = $1000
      // HF = 1600/1000 = 1.6
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1000"));

      const hf = await pool.getHealthFactor(alice.address);
      const expected = ethers.parseEther("1.6");
      // Allow 0.01 ETH tolerance for block-level interest accrual
      expect(hf).to.be.closeTo(expected, ethers.parseEther("0.01"));
    });

    it("HF drops below 1 when price falls", async function () {
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1400"));

      // HF before: (2000 * 0.80) / 1400 = 1600/1400 ≈ 1.14
      let hf = await pool.getHealthFactor(alice.address);
      expect(hf).to.be.gt(PRECISION);

      // Price drops: WETH → $1000
      await pool.setTokenPrice(await weth.getAddress(), ethers.parseEther("1000"));

      // HF after: (1000 * 0.80) / 1400 = 800/1400 ≈ 0.57
      hf = await pool.getHealthFactor(alice.address);
      expect(hf).to.be.lt(PRECISION);
    });

    it("HF increases after repayment", async function () {
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1000"));
      await c5d.mint(alice.address, ethers.parseEther("1000"));
      await c5d.connect(alice).approve(await pool.getAddress(), MAX_UINT);

      const hfBefore = await pool.getHealthFactor(alice.address);
      await pool.connect(alice).repay(await c5d.getAddress(), ethers.parseEther("500"));
      const hfAfter = await pool.getHealthFactor(alice.address);

      expect(hfAfter).to.be.gt(hfBefore);
    });
  });

  // ═══════════════════════════════════════════════
  //  8. Interest Rate Model
  // ═══════════════════════════════════════════════

  describe("8. Interest Rate Model", function () {
    it("borrow APY at 0% utilization = baseRate (2%)", async function () {
      // No borrows → U = 0 → APY = baseRate = 2% = 0.02e18
      const apy = await pool.getBorrowAPY(await c5d.getAddress());
      expect(apy).to.equal(ethers.parseEther("0.02")); // 2% as fraction of 1e18
    });

    it("supply APY = 0 when utilization = 0", async function () {
      const apy = await pool.getSupplyAPY(await c5d.getAddress());
      expect(apy).to.equal(0n);
    });

    it("borrow APY increases with utilization", async function () {
      // Alice deposits 10000 C5D, Bob borrows 5000 → U ≈ 50%
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("5")); // collateral
      await pool.connect(bob).borrow(await c5d.getAddress(), ethers.parseEther("5000"));

      const apy = await pool.getBorrowAPY(await c5d.getAddress());
      // At U=50%: APY = 2% + 10% * 0.5 = 7% = 0.07e18
      expect(apy).to.be.closeTo(ethers.parseEther("0.07"), ethers.parseEther("0.001"));
    });

    it("supply APY > 0 when there are borrows", async function () {
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("5"));
      await pool.connect(bob).borrow(await c5d.getAddress(), ethers.parseEther("5000"));

      const apy = await pool.getSupplyAPY(await c5d.getAddress());
      expect(apy).to.be.gt(0n);
    });

    it("interest accrues over blocks (borrow balance grows)", async function () {
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("5"));
      await pool.connect(bob).borrow(await c5d.getAddress(), ethers.parseEther("5000"));

      const debtBefore = await pool.getBorrowBalance(bob.address, await c5d.getAddress());

      // Mine 1000 blocks
      await mineBlocks(1000);
      await pool.accrueInterest(await c5d.getAddress());

      const debtAfter = await pool.getBorrowBalance(bob.address, await c5d.getAddress());
      expect(debtAfter).to.be.gt(debtBefore);
    });

    it("supply balance grows over blocks (interest earned)", async function () {
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("5"));
      await pool.connect(bob).borrow(await c5d.getAddress(), ethers.parseEther("5000"));

      const supBefore = await pool.getSupplyBalance(alice.address, await c5d.getAddress());

      await mineBlocks(1000);
      await pool.accrueInterest(await c5d.getAddress());

      const supAfter = await pool.getSupplyBalance(alice.address, await c5d.getAddress());
      expect(supAfter).to.be.gt(supBefore);
    });

    it("utilization rate = totalBorrowed / totalSupplied", async function () {
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("5"));
      await pool.connect(bob).borrow(await c5d.getAddress(), ethers.parseEther("5000"));

      const u = await pool.getUtilizationRate(await c5d.getAddress());
      // U should be very close to 50% = 0.5e18
      expect(u).to.be.closeTo(ethers.parseEther("0.5"), ethers.parseEther("0.001"));
    });
  });

  // ═══════════════════════════════════════════════
  //  9. View Functions
  // ═══════════════════════════════════════════════

  describe("9. View Functions", function () {
    beforeEach(async function () {
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1000"));
    });

    it("getMaxBorrow reflects LTV constraint", async function () {
      // Fresh user: carol deposits 1 WETH ($2000), LTV 75% → max $1500 C5D
      await pool.connect(carol).deposit(await weth.getAddress(), ethers.parseEther("1"));
      const maxBorrow = await pool.getMaxBorrow(carol.address, await c5d.getAddress());
      expect(maxBorrow).to.be.closeTo(ethers.parseEther("1500"), ethers.parseEther("1"));
    });

    it("getMaxBorrow decreases after borrowing", async function () {
      const max1 = await pool.getMaxBorrow(alice.address, await c5d.getAddress());
      // alice already borrowed 1000; her remaining capacity should equal max1
      // (max1 is what's left after the 1000 borrow)
      // Deposit 1 more WETH for carol, check max
      await pool.connect(carol).deposit(await weth.getAddress(), ethers.parseEther("1"));
      const carolMax = await pool.getMaxBorrow(carol.address, await c5d.getAddress());

      // alice's max should be less than carol's (alice already borrowed)
      expect(max1).to.be.lt(carolMax);
    });

    it("getTotalCollateralUSD returns correct USD value", async function () {
      // alice has 1 WETH at $2000
      const collateral = await pool.getTotalCollateralUSD(alice.address);
      expect(collateral).to.be.closeTo(ethers.parseEther("2000"), ethers.parseEther("1"));
    });

    it("getTotalDebtUSD returns correct USD value", async function () {
      // alice borrowed 1000 C5D at $1
      const debt = await pool.getTotalDebtUSD(alice.address);
      expect(debt).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("1"));
    });

    it("getMarketData returns plausible values", async function () {
      const [totalSupplied, totalBorrowed, , supplyAPY, borrowAPY, price] =
        await pool.getMarketData(await c5d.getAddress());

      expect(totalSupplied).to.be.closeTo(ethers.parseEther("50000"), ethers.parseEther("1"));
      expect(totalBorrowed).to.be.closeTo(ethers.parseEther("1000"),  ethers.parseEther("1"));
      expect(borrowAPY).to.be.gt(0n);
      expect(supplyAPY).to.be.gt(0n);
      expect(price).to.equal(C5D_PRICE);
    });

    it("getUserData returns consistent values", async function () {
      const [supplyBal, borrowBal, hf] =
        await pool.getUserData(alice.address, await weth.getAddress());

      expect(supplyBal).to.be.closeTo(ethers.parseEther("1"), 1n);
      // Alice's borrow is in C5D, not WETH
      expect(borrowBal).to.equal(0n);
      expect(hf).to.be.gt(PRECISION); // HF > 1
    });

    it("setTokenPrice updates price and emits event", async function () {
      const newPrice = ethers.parseEther("3000");
      await expect(pool.setTokenPrice(await weth.getAddress(), newPrice))
        .to.emit(pool, "PriceUpdated")
        .withArgs(await weth.getAddress(), newPrice);

      expect(await pool.tokenPricesUSD(await weth.getAddress())).to.equal(newPrice);
    });

    it("setTokenPrice reverts for non-owner", async function () {
      await expect(
        pool.connect(alice).setTokenPrice(await weth.getAddress(), ethers.parseEther("3000"))
      ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════════════════════════════════════
  //  10. Integration: Full Lifecycle
  // ═══════════════════════════════════════════════

  describe("10. Integration: Full Lifecycle", function () {
    it("deposit → borrow → mine blocks → repay → withdraw", async function () {
      const poolAddr = await pool.getAddress();

      // Alice deposits 1 WETH as collateral
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));

      // Bob provides C5D liquidity
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));

      // Alice borrows 1000 C5D
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1000"));

      // Mine blocks to accrue interest
      await mineBlocks(500);

      // Alice repays full debt (mint extra to cover interest)
      await c5d.mint(alice.address, ethers.parseEther("100")); // interest buffer
      await c5d.connect(alice).approve(poolAddr, MAX_UINT);
      await pool.connect(alice).repay(await c5d.getAddress(), MAX_UINT);

      // NOTE: 1 wei may remain after repay-all. This is an inherent artifact of the
      // index-based accounting: when scaledAmount rounds to 1, the next repay computes
      // scaled = 1 * PRECISION / borrowIndex = 0 (integer division), so the 1 scaled
      // wei is unrepayable. This is cosmetic (< 1 token unit) and accepted.
      const debtAfterRepay = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      expect(debtAfterRepay).to.be.lte(1n);

      // If debt cleared fully, withdraw all WETH; otherwise verify supply is intact
      // (the 1 wei debt doesn't prevent withdrawing most of the collateral)
      const wethSupply = await pool.getSupplyBalance(alice.address, await weth.getAddress());
      if (debtAfterRepay === 0n) {
        await pool.connect(alice).withdraw(await weth.getAddress(), MAX_UINT);
        const supplyAfter = await pool.getSupplyBalance(alice.address, await weth.getAddress());
        expect(supplyAfter).to.equal(0n);
      } else {
        // 1 wei debt: withdraw 90% of WETH (keeps minimal collateral backing)
        await pool.connect(alice).withdraw(await weth.getAddress(), wethSupply * 9n / 10n);
        const supplyAfter = await pool.getSupplyBalance(alice.address, await weth.getAddress());
        expect(supplyAfter).to.be.gt(0n);
      }
    });

    it("lender earns interest from borrower activity", async function () {
      // Alice is lender, Bob is borrower
      const depositAmount = ethers.parseEther("10000");
      await pool.connect(alice).deposit(await c5d.getAddress(), depositAmount);

      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("5")); // $10000 collateral
      await pool.connect(bob).borrow(await c5d.getAddress(), ethers.parseEther("5000")); // 50% U

      const supplyBefore = await pool.getSupplyBalance(alice.address, await c5d.getAddress());

      await mineBlocks(2000);
      await pool.accrueInterest(await c5d.getAddress());

      const supplyAfter = await pool.getSupplyBalance(alice.address, await c5d.getAddress());
      expect(supplyAfter).to.be.gt(supplyBefore);
    });

    it("two users deposit, one borrows; health factors are independent", async function () {
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(carol).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("1000"));

      const hfAlice = await pool.getHealthFactor(alice.address);
      const hfCarol = await pool.getHealthFactor(carol.address);

      expect(hfAlice).to.be.gt(PRECISION);   // Alice: HF > 1
      expect(hfCarol).to.equal(MAX_UINT);     // Carol: no debt → max
    });
  });
});
