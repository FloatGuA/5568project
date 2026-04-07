// test/Liquidation.test.cjs
// Unit + integration tests for LendingPool.liquidate()
// Run: npm test

const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRECISION = ethers.parseEther("1"); // 1e18
const MAX_UINT  = ethers.MaxUint256;

// ─────────────────────────────────────────────
//  Shared setup
// ─────────────────────────────────────────────

describe("Liquidation", function () {
  let owner, alice, bob, liquidator;
  let c5d, weth, pool;

  // Prices
  const C5D_PRICE_INIT  = ethers.parseEther("1");     // $1
  const WETH_PRICE_INIT = ethers.parseEther("2000");  // $2000
  const WETH_PRICE_DROP = ethers.parseEther("1000");  // $1000 (price crash)

  // Standard position that becomes liquidatable after price drop:
  //   Alice deposits 1 WETH  → liq-weighted collateral = $2000 * 80% = $1600
  //   Alice borrows  1400 C5D → HF = 1600/1400 ≈ 1.14  (healthy)
  //   Price drops   WETH → $1000
  //   After drop:  collateral = $1000 * 80% = $800,  HF = 800/1400 ≈ 0.57  (liquidatable)
  const ALICE_WETH_DEPOSIT = ethers.parseEther("1");
  const ALICE_C5D_BORROW   = ethers.parseEther("1400");

  let snapshotId;

  before(async function () {
    [owner, alice, bob, liquidator] = await ethers.getSigners();

    const Stablecoin  = await ethers.getContractFactory("Stablecoin");
    const MockWETH    = await ethers.getContractFactory("MockWETH");
    const LendingPool = await ethers.getContractFactory("LendingPool");

    c5d  = await Stablecoin.deploy();
    weth = await MockWETH.deploy();
    pool = await LendingPool.deploy();

    const poolAddr = await pool.getAddress();

    await pool.addSupportedToken(await c5d.getAddress(),  75, 80, 2, 10,  C5D_PRICE_INIT);
    await pool.addSupportedToken(await weth.getAddress(), 75, 80, 2, 20, WETH_PRICE_INIT);

    // Mint balances
    await c5d.mint(alice.address,      ethers.parseEther("100000"));
    await c5d.mint(bob.address,        ethers.parseEther("100000"));
    await c5d.mint(liquidator.address, ethers.parseEther("100000"));
    await weth.mint(alice.address,     ethers.parseEther("50"));
    await weth.mint(bob.address,       ethers.parseEther("50"));

    // Approvals
    for (const signer of [alice, bob, liquidator]) {
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

  // ── Helper: build a liquidatable position ──────────────
  // Alice deposits WETH, bob provides C5D liquidity, alice borrows,
  // then WETH price crashes to make Alice's HF < 1.
  async function buildLiquidatablePosition() {
    await pool.connect(alice).deposit(await weth.getAddress(), ALICE_WETH_DEPOSIT);
    await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
    await pool.connect(alice).borrow(await c5d.getAddress(), ALICE_C5D_BORROW);
    // Crash WETH price → Alice's HF drops below 1
    await pool.setTokenPrice(await weth.getAddress(), WETH_PRICE_DROP);
  }

  // ═══════════════════════════════════════════════
  //  1. Guard conditions
  // ═══════════════════════════════════════════════

  describe("1. Guard conditions", function () {
    it("reverts if debt token is not supported", async function () {
      await buildLiquidatablePosition();
      const Extra = await ethers.getContractFactory("Stablecoin");
      const extra = await Extra.deploy();
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await extra.getAddress(),
          ethers.parseEther("100"),
          await weth.getAddress()
        )
      ).to.be.revertedWith("Debt token not supported");
    });

    it("reverts if collateral token is not supported", async function () {
      await buildLiquidatablePosition();
      const Extra = await ethers.getContractFactory("Stablecoin");
      const extra = await Extra.deploy();
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          ethers.parseEther("100"),
          await extra.getAddress()
        )
      ).to.be.revertedWith("Collateral token not supported");
    });

    it("reverts if liquidator tries to liquidate themselves", async function () {
      // Alice needs to be the one trying to liquidate herself
      await buildLiquidatablePosition();
      await c5d.mint(alice.address, ethers.parseEther("10000"));
      await c5d.connect(alice).approve(await pool.getAddress(), MAX_UINT);
      await expect(
        pool.connect(alice).liquidate(
          alice.address,
          await c5d.getAddress(),
          ethers.parseEther("100"),
          await weth.getAddress()
        )
      ).to.be.revertedWith("Cannot liquidate yourself");
    });

    it("reverts if repayAmount = 0", async function () {
      await buildLiquidatablePosition();
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          0,
          await weth.getAddress()
        )
      ).to.be.revertedWith("Repay amount must be > 0");
    });

    it("reverts if position is healthy (HF >= 1)", async function () {
      // Alice deposits WETH and borrows conservatively — HF stays above 1
      await pool.connect(alice).deposit(await weth.getAddress(), ALICE_WETH_DEPOSIT);
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("500"));
      // HF = (2000 * 80%) / 500 = 3.2 → healthy

      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          ethers.parseEther("100"),
          await weth.getAddress()
        )
      ).to.be.revertedWith("Position is healthy, HF >= 1");
    });

    it("reverts if borrower has no debt in the specified token", async function () {
      // Alice deposits C5D and borrows WETH (debt is in WETH, not C5D)
      // WETH stays at $2000; alice borrows 3 WETH = $6000 debt
      // C5D collateral: 10000 * $1 * 80% = $8000 → HF = 8000/6000 ≈ 1.33 (healthy)
      // Then C5D drops to $0.5 → collateral = $4000, HF = 4000/6000 ≈ 0.67 (liquidatable)
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(bob).deposit(await weth.getAddress(), ethers.parseEther("10"));
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(alice).borrow(await weth.getAddress(), ethers.parseEther("3"));
      await pool.setTokenPrice(await c5d.getAddress(), ethers.parseEther("0.5"));

      // Liquidator tries to repay C5D — but alice's debt is WETH, not C5D
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          ethers.parseEther("100"),
          await weth.getAddress()
        )
      ).to.be.revertedWith("Borrower has no debt in this token");
    });

    it("reverts if repayAmount exceeds close factor (50% of debt)", async function () {
      await buildLiquidatablePosition();
      // debt = 1400 C5D, max repay = 700; try 701
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          ethers.parseEther("701"),
          await weth.getAddress()
        )
      ).to.be.revertedWith("Exceeds close factor (max 50% of debt)");
    });

    it("reverts if borrower has insufficient collateral to cover seizure", async function () {
      // Build position where alice has very little WETH but big C5D debt
      // Alice deposits 0.1 WETH ($200 at $2000) and borrows 150 C5D (HF = 160/150 ≈ 1.07)
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("0.1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("150"));
      // Drop price: WETH → $100 → collateral = $8, HF = 8/150 ≈ 0.05
      await pool.setTokenPrice(await weth.getAddress(), ethers.parseEther("100"));

      // Liquidator wants to repay 75 C5D (50% of 150)
      // collateralSeized = 75 * 1 * 105 / 100 / 100 = 0.7875 WETH
      // Alice only has 0.1 WETH → insufficient
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          ethers.parseEther("75"),
          await weth.getAddress()
        )
      ).to.be.revertedWith("Borrower has insufficient collateral");
    });
  });

  // ═══════════════════════════════════════════════
  //  2. Correct liquidation mechanics
  // ═══════════════════════════════════════════════

  describe("2. Liquidation mechanics", function () {
    beforeEach(async function () {
      await buildLiquidatablePosition();
    });

    it("liquidation reduces borrower's debt", async function () {
      const debtBefore = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      const repayAmount = ethers.parseEther("700"); // 50% of 1400

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        repayAmount,
        await weth.getAddress()
      );

      const debtAfter = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      expect(debtAfter).to.be.closeTo(debtBefore - repayAmount, ethers.parseEther("0.01"));
    });

    it("liquidation reduces borrower's collateral", async function () {
      const collBefore = await pool.getSupplyBalance(alice.address, await weth.getAddress());
      const repayAmount = ethers.parseEther("700");

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        repayAmount,
        await weth.getAddress()
      );

      const collAfter = await pool.getSupplyBalance(alice.address, await weth.getAddress());
      expect(collAfter).to.be.lt(collBefore);
    });

    it("liquidator receives correct collateral amount with 5% bonus", async function () {
      // repayAmount = 700 C5D at $1 each
      // WETH price after drop = $1000
      // collateralSeized = 700 * 1 * 105 / 1000 / 100 = 0.735 WETH
      const repayAmount = ethers.parseEther("700");
      const expected = ethers.parseEther("0.735"); // 700 * 1.05 / 1000

      const wethBefore = await weth.balanceOf(liquidator.address);
      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        repayAmount,
        await weth.getAddress()
      );
      const wethAfter = await weth.balanceOf(liquidator.address);

      expect(wethAfter - wethBefore).to.be.closeTo(expected, ethers.parseEther("0.001"));
    });

    it("liquidator spends the correct amount of debt token", async function () {
      const repayAmount = ethers.parseEther("700");
      const c5dBefore = await c5d.balanceOf(liquidator.address);

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        repayAmount,
        await weth.getAddress()
      );

      const c5dAfter = await c5d.balanceOf(liquidator.address);
      expect(c5dBefore - c5dAfter).to.equal(repayAmount);
    });

    it("borrower's Health Factor improves after liquidation (mild price crash)", async function () {
      // beforeEach already set: alice has 1 WETH collateral + 1400 C5D debt, WETH at $1000
      // Restore WETH to $1700 (mild drop) so HF is between 0.84 and 1.0:
      //   collateral = 1 * $1700 * 80% = $1360, debt ≈ $1400 → HF ≈ 0.971 ✓ (> 0.84 threshold)
      //
      // After 50% liquidation (repay 700 C5D):
      //   seize = 700 * 1.05 / 1700 ≈ 0.4324 WETH
      //   remaining collateral = 0.5676 * $1700 * 80% = $771
      //   remaining debt = $700 → HF ≈ 1.10 > 0.971 ✓
      await pool.setTokenPrice(await weth.getAddress(), ethers.parseEther("1700"));

      const hfBefore = await pool.getHealthFactor(alice.address);
      expect(hfBefore).to.be.lt(PRECISION); // HF < 1

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        ethers.parseEther("700"),
        await weth.getAddress()
      );

      const hfAfter = await pool.getHealthFactor(alice.address);
      expect(hfAfter).to.be.gt(hfBefore);
    });

    it("emits Liquidated event with correct arguments", async function () {
      const repayAmount = ethers.parseEther("700");
      const expectedSeized = ethers.parseEther("0.735");

      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          repayAmount,
          await weth.getAddress()
        )
      ).to.emit(pool, "Liquidated")
        .withArgs(
          liquidator.address,
          alice.address,
          await c5d.getAddress(),
          repayAmount,
          await weth.getAddress(),
          expectedSeized
        );
    });

    it("partial liquidation (less than 50%) is allowed", async function () {
      const repayAmount = ethers.parseEther("100"); // well under 50%
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          repayAmount,
          await weth.getAddress()
        )
      ).to.emit(pool, "Liquidated");

      const debtAfter = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
      expect(debtAfter).to.be.closeTo(
        ALICE_C5D_BORROW - repayAmount,
        ethers.parseEther("0.01")
      );
    });

    it("exactly 50% repay (close factor boundary) is allowed", async function () {
      const maxRepay = ethers.parseEther("700"); // exactly 50% of 1400
      await expect(
        pool.connect(liquidator).liquidate(
          alice.address,
          await c5d.getAddress(),
          maxRepay,
          await weth.getAddress()
        )
      ).to.emit(pool, "Liquidated");
    });

    it("global market totals decrease after liquidation", async function () {
      const [, totalBorrowedBefore] = await pool.getMarketData(await c5d.getAddress());
      const [totalSuppliedBeforeWeth] = await pool.getMarketData(await weth.getAddress());

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        ethers.parseEther("700"),
        await weth.getAddress()
      );

      const [, totalBorrowedAfter] = await pool.getMarketData(await c5d.getAddress());
      const [totalSuppliedAfterWeth] = await pool.getMarketData(await weth.getAddress());

      expect(totalBorrowedAfter).to.be.lt(totalBorrowedBefore);
      expect(totalSuppliedAfterWeth).to.be.lt(totalSuppliedBeforeWeth);
    });
  });

  // ═══════════════════════════════════════════════
  //  3. Bonus calculation accuracy
  // ═══════════════════════════════════════════════

  describe("3. Bonus calculation accuracy", function () {
    it("5% bonus: 1000 C5D repaid → 1.05 WETH seized at WETH=$1000", async function () {
      // Alice deposits 2 WETH ($4000), borrows 3000 C5D
      // HF = (4000*80%) / 3000 = 3200/3000 ≈ 1.067 (healthy)
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("2"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("3000"));
      // Drop WETH to $1000: collateral = $2000*80% = $1600, HF = 1600/3000 ≈ 0.53
      await pool.setTokenPrice(await weth.getAddress(), WETH_PRICE_DROP);

      // repay 1000 C5D (< 50% of 3000)
      // collateralSeized = 1000 * 1 * 105 / 1000 / 100 = 1.05 WETH
      const repayAmount = ethers.parseEther("1000");
      const expected    = ethers.parseEther("1.05");

      const wethBefore = await weth.balanceOf(liquidator.address);
      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        repayAmount,
        await weth.getAddress()
      );
      const wethAfter = await weth.balanceOf(liquidator.address);

      expect(wethAfter - wethBefore).to.equal(expected);
    });

    it("5% bonus: WETH repaid → correct C5D seized", async function () {
      // Bob deposits 10000 C5D ($10000) as collateral, borrows 4 WETH ($8000)
      // HF = (10000 * 80%) / 8000 = 8000/8000 = 1.0 (borderline healthy at deposit)
      // Drop C5D to $0.5: collateral = $4000 * 80% = $4000 → wait
      // 10000 C5D * $0.5 * 80% = $4000, debt = 4 WETH * $2000 = $8000 → HF = 0.5 < 1 ✓
      await pool.connect(alice).deposit(await c5d.getAddress(), ethers.parseEther("50000")); // liquidity
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("10"));  // WETH liquidity
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("10000"));
      await pool.connect(bob).borrow(await weth.getAddress(), ethers.parseEther("4")); // $8000 debt
      // Drop C5D price: collateral = 10000 * 0.5 * 80% = $4000, HF = 4000/8000 = 0.5 < 1
      await pool.setTokenPrice(await c5d.getAddress(), ethers.parseEther("0.5"));

      // Liquidator repays 2 WETH ($4000, = 50% of 4 WETH debt)
      // collateralSeized = 2 * 2000 * 105 / 0.5e18 ... using price units:
      // collateralSeized = repayAmount * debtPrice * 105 / collateralPrice / 100
      //                  = 2e18 * 2000e18 * 105 / 0.5e18 / 100
      //                  = 2 * 2000 * 105 / 0.5 / 100 = 8400 C5D
      await weth.mint(liquidator.address, ethers.parseEther("10"));
      await weth.connect(liquidator).approve(await pool.getAddress(), MAX_UINT);

      const repayAmount = ethers.parseEther("2");   // 2 WETH
      const expected    = ethers.parseEther("8400"); // 8400 C5D

      const c5dBefore = await c5d.balanceOf(liquidator.address);
      await pool.connect(liquidator).liquidate(
        bob.address,
        await weth.getAddress(),
        repayAmount,
        await c5d.getAddress()
      );
      const c5dAfter = await c5d.balanceOf(liquidator.address);

      expect(c5dAfter - c5dBefore).to.equal(expected);
    });
  });

  // ═══════════════════════════════════════════════
  //  4. Integration: multi-user scenarios
  // ═══════════════════════════════════════════════

  describe("4. Integration", function () {
    it("other users' positions are unaffected by liquidation", async function () {
      // buildLiquidatablePosition has bob deposit 50000 C5D as liquidity provider
      await buildLiquidatablePosition();

      // Record bob's state AFTER setup (bob is a pure supplier, no borrows)
      const bobC5dSupply = await pool.getSupplyBalance(bob.address, await c5d.getAddress());
      const hfBobBefore  = await pool.getHealthFactor(bob.address);

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        ethers.parseEther("700"),
        await weth.getAddress()
      );

      // Bob's supply balance and HF should be unchanged
      expect(await pool.getSupplyBalance(bob.address, await c5d.getAddress())).to.be.closeTo(
        bobC5dSupply, ethers.parseEther("0.01")
      );
      expect(await pool.getHealthFactor(bob.address)).to.equal(hfBobBefore);
    });

    it("position can be liquidated twice (if still unhealthy after first)", async function () {
      // Use a deeper price crash scenario so position stays unhealthy after partial liquidation
      // 2 WETH deposited @ $1000 = $2000; liq-weighted = $1600; borrow 1400 C5D
      // After 50% liquidation: debt = 700, seize = 700 * 1.05 / 1000 = 0.735 WETH
      // remaining WETH = 1.265; liq-weighted = $1012; HF = 1012/700 ≈ 1.45 → HEALTHY
      // So two liquidations are possible only when position stays under 1 after first.
      // Let's use: 1 WETH at $800 → collateral = $640; borrow 700 C5D → HF = 640/700 ≈ 0.914
      // close factor repay = 350; seize = 350 * 1.05 / 800 = 0.459375 WETH
      // remaining: 0.540625 WETH * $800 * 80% = $345.6; debt = 350; HF = 345.6/350 ≈ 0.987 < 1 ✓
      await pool.connect(alice).deposit(await weth.getAddress(), ethers.parseEther("1"));
      await pool.connect(bob).deposit(await c5d.getAddress(), ethers.parseEther("50000"));
      await pool.connect(alice).borrow(await c5d.getAddress(), ethers.parseEther("700"));
      await pool.setTokenPrice(await weth.getAddress(), ethers.parseEther("800"));
      // HF = (1 * 800 * 80%) / 700 = 640/700 ≈ 0.914 < 1 ✓

      // First liquidation: 50% of 700 = 350
      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        ethers.parseEther("350"),
        await weth.getAddress()
      );

      const hfAfterFirst = await pool.getHealthFactor(alice.address);

      if (hfAfterFirst < PRECISION) {
        // Still unhealthy: compute safe second repay (limited by remaining collateral)
        const remainingDebt       = await pool.getBorrowBalance(alice.address, await c5d.getAddress());
        const remainingCollateral = await pool.getSupplyBalance(alice.address, await weth.getAddress());
        const wethPrice           = await pool.tokenPricesUSD(await weth.getAddress());
        const c5dPrice            = await pool.tokenPricesUSD(await c5d.getAddress());

        // Max repay before collateral runs out: collateral * price / (1.05 * debtPrice)
        const maxByCollateral = remainingCollateral * wethPrice * 100n / (c5dPrice * 105n);
        const maxByCloseFactor = remainingDebt * 50n / 100n;
        const secondRepay = maxByCollateral < maxByCloseFactor ? maxByCollateral : maxByCloseFactor;

        if (secondRepay > 0n) {
          await expect(
            pool.connect(liquidator).liquidate(
              alice.address,
              await c5d.getAddress(),
              secondRepay,
              await weth.getAddress()
            )
          ).to.emit(pool, "Liquidated");
        }
      }
    });

    it("liquidator profits: received collateral value > repaid debt value", async function () {
      await buildLiquidatablePosition();

      const repayAmount = ethers.parseEther("700");
      const wethPrice   = WETH_PRICE_DROP; // $1000

      const c5dBefore  = await c5d.balanceOf(liquidator.address);
      const wethBefore = await weth.balanceOf(liquidator.address);

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        repayAmount,
        await weth.getAddress()
      );

      const c5dSpent    = c5dBefore  - await c5d.balanceOf(liquidator.address);
      const wethGained  = await weth.balanceOf(liquidator.address) - wethBefore;

      // USD value: spent $700, gained (0.735 WETH * $1000) = $735
      const spentUSD  = c5dSpent  * C5D_PRICE_INIT  / PRECISION;
      const gainedUSD = wethGained * wethPrice / PRECISION;

      expect(gainedUSD).to.be.gt(spentUSD);
    });

    it("pool remains solvent after liquidation (can still serve other withdrawals)", async function () {
      await buildLiquidatablePosition();

      await pool.connect(liquidator).liquidate(
        alice.address,
        await c5d.getAddress(),
        ethers.parseEther("700"),
        await weth.getAddress()
      );

      // Bob should still be able to withdraw his C5D
      const bobSupply = await pool.getSupplyBalance(bob.address, await c5d.getAddress());
      await expect(
        pool.connect(bob).withdraw(await c5d.getAddress(), bobSupply / 2n)
      ).to.not.be.reverted;
    });
  });
});
