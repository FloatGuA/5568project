// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IFlashLoanReceiver.sol";

/**
 * @title LendingPool
 * @notice Decentralized Lending & Borrowing Protocol for COMP5521
 *
 * Core features:
 *  - Deposit (Supply) / Withdraw
 *  - Borrow / Repay
 *  - Over-collateralization with Health Factor
 *  - Loan-to-Value (LTV) limits
 *  - Dynamic interest rate model based on Utilization Rate
 *  - Per-block interest accrual (index-based, same as Compound/Aave)
 *
 * Interest Rate Model (Linear / "Kinked" simplified):
 *   Utilization Rate U = totalBorrowed / totalSupplied
 *   Borrow APR        = baseRate + slope * U
 *   Supply APR        = Borrow APR * U * (1 - reserveFactor)
 *
 * Health Factor:
 *   HF = (totalCollateralUSD * liquidationThreshold) / totalDebtUSD
 *   HF < 1.0 → position can be liquidated
 */
contract LendingPool is Ownable, ReentrancyGuard {

    // ─────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────

    uint256 public constant PRECISION              = 1e18;
    uint256 public constant BLOCKS_PER_YEAR        = 2102400; // ~15s/block on Ethereum
    uint256 public constant RESERVE_FACTOR         = 10;      // 10% of interest → protocol reserve
    uint256 public constant LIQUIDATION_BONUS      = 5;       // 5% bonus paid to liquidator
    uint256 public constant CLOSE_FACTOR           = 50;      // liquidator may repay up to 50% of debt
    uint256 public constant FLASH_LOAN_FEE         = 9;       // 9 basis points = 0.09% (same as Aave v2)

    // ─────────────────────────────────────────────
    //  Data Structures
    // ─────────────────────────────────────────────

    /**
     * @dev Configuration for each supported token.
     * @param ltv                Max borrow as % of collateral value (e.g. 75 = 75%)
     * @param liquidationThreshold  Threshold for liquidation (e.g. 80 = 80%), always > ltv
     * @param baseRatePerYear    Minimum borrow rate per year in % (e.g. 2 = 2%)
     * @param slopePerYear       Additional rate per year at 100% utilization (e.g. 20 = 20%)
     */
    struct TokenConfig {
        bool     supported;
        uint256  ltv;
        uint256  liquidationThreshold;
        uint256  baseRatePerYear;
        uint256  slopePerYear;
    }

    /**
     * @dev Per-token market state.
     *
     * Index-based accounting (same pattern as Compound):
     *   scaledAmount = principalAmount * PRECISION / indexAtTime
     *   currentAmount = scaledAmount * currentIndex / PRECISION
     *
     * This way, just updating the index automatically applies interest
     * to every user position without looping.
     */
    struct MarketState {
        uint256 totalScaledSupply;   // Sum of (supplyAmount * PRECISION / supplyIndex at deposit)
        uint256 totalScaledBorrow;   // Sum of (borrowAmount * PRECISION / borrowIndex at borrow)
        uint256 borrowIndex;         // Cumulative borrow interest multiplier (starts at PRECISION)
        uint256 supplyIndex;         // Cumulative supply interest multiplier (starts at PRECISION)
        uint256 lastUpdateBlock;     // Block number of last interest accrual
    }

    struct UserSupply {
        uint256 scaledAmount;   // user's scaled supply balance
    }

    struct UserBorrow {
        uint256 scaledAmount;   // user's scaled borrow balance
    }

    // ─────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────

    address[] public supportedTokens;

    mapping(address => TokenConfig)  public tokenConfigs;
    mapping(address => MarketState)  public markets;
    mapping(address => uint256)      public tokenPricesUSD; // price in USD, scaled by 1e18

    // user → token → position
    mapping(address => mapping(address => UserSupply)) public userSupplies;
    mapping(address => mapping(address => UserBorrow)) public userBorrows;


    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event Deposit  (address indexed user, address indexed token, uint256 amount);
    event Withdraw (address indexed user, address indexed token, uint256 amount);
    event Borrow   (address indexed user, address indexed token, uint256 amount);
    event Repay    (address indexed user, address indexed token, uint256 amount);
    event PriceUpdated(address indexed token, uint256 newPrice);
    event FlashLoan(
        address indexed receiver,
        address indexed token,
        uint256 amount,
        uint256 fee
    );
    event Liquidated(
        address indexed liquidator,
        address indexed borrower,
        address indexed debtToken,
        uint256 repayAmount,
        address collateralToken,
        uint256 collateralSeized
    );
    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─────────────────────────────────────────────
    //  Admin Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Add a new token to the lending pool.
     * @param token                  ERC20 token address
     * @param ltv                    Max LTV in % (e.g. 75)
     * @param liquidationThreshold   Liquidation threshold in % (e.g. 80)
     * @param baseRatePerYear        Base borrow rate in % per year (e.g. 2)
     * @param slopePerYear           Slope in % per year at 100% utilization (e.g. 20)
     * @param initialPriceUSD        Initial USD price scaled by 1e18
     */
    function addSupportedToken(
        address token,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 baseRatePerYear,
        uint256 slopePerYear,
        uint256 initialPriceUSD
    ) external onlyOwner {
        require(token != address(0),               "Invalid token");
        require(!tokenConfigs[token].supported,    "Already supported");
        require(ltv < liquidationThreshold,        "LTV must be < liq threshold");
        require(liquidationThreshold <= 95,        "Liq threshold too high");

        tokenConfigs[token] = TokenConfig({
            supported:            true,
            ltv:                  ltv,
            liquidationThreshold: liquidationThreshold,
            baseRatePerYear:      baseRatePerYear,
            slopePerYear:         slopePerYear
        });

        markets[token] = MarketState({
            totalScaledSupply: 0,
            totalScaledBorrow: 0,
            borrowIndex:       PRECISION,
            supplyIndex:       PRECISION,
            lastUpdateBlock:   block.number
        });

        tokenPricesUSD[token] = initialPriceUSD;
        supportedTokens.push(token);
    }

    /**
     * @notice Update token price manually (used when no Chainlink feed is configured).
     */
    function setTokenPrice(address token, uint256 priceUSD) external onlyOwner {
        require(tokenConfigs[token].supported, "Not supported");
        tokenPricesUSD[token] = priceUSD;
        emit PriceUpdated(token, priceUSD);
    }

    /**
     * @notice Get the current USD price of a token (18-decimal precision).
     */
    function getTokenPrice(address token) public view returns (uint256) {
        return tokenPricesUSD[token];
    }

    // ─────────────────────────────────────────────
    //  Core User Actions
    // ─────────────────────────────────────────────

    /**
     * @notice Supply tokens to the lending pool and earn interest.
     *         Supplied tokens also count as collateral for borrowing.
     * @param token   ERC20 token address
     * @param amount  Amount to supply (in token's native decimals)
     */
    function deposit(address token, uint256 amount) external nonReentrant {
        require(tokenConfigs[token].supported, "Token not supported");
        require(amount > 0,                    "Amount must be > 0");

        _accrueInterest(token);

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // Convert amount to scaled units and add to user's position
        uint256 scaled = amount * PRECISION / markets[token].supplyIndex;
        userSupplies[msg.sender][token].scaledAmount += scaled;
        markets[token].totalScaledSupply += scaled;

        emit Deposit(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw previously supplied tokens (+ accrued interest).
     * @param token   ERC20 token address
     * @param amount  Amount to withdraw. Pass type(uint256).max to withdraw all.
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        _accrueInterest(token);

        uint256 currentBalance = _supplyBalanceOf(msg.sender, token);

        // Allow "withdraw all"
        if (amount == type(uint256).max) {
            amount = currentBalance;
        }

        require(currentBalance >= amount, "Insufficient supply balance");
        require(
            _isHealthyAfterWithdraw(msg.sender, token, amount),
            "Withdrawal would undercollateralize position"
        );

        uint256 scaled = amount * PRECISION / markets[token].supplyIndex;
        userSupplies[msg.sender][token].scaledAmount -= scaled;
        markets[token].totalScaledSupply -= scaled;

        IERC20(token).transfer(msg.sender, amount);

        emit Withdraw(msg.sender, token, amount);
    }

    /**
     * @notice Borrow tokens against your deposited collateral.
     *         Requires Health Factor to remain >= 1.0 after borrowing.
     * @param token   ERC20 token to borrow
     * @param amount  Amount to borrow
     */
    function borrow(address token, uint256 amount) external nonReentrant {
        require(tokenConfigs[token].supported, "Token not supported");
        require(amount > 0,                    "Amount must be > 0");

        _accrueInterest(token);

        // Check enough liquidity in the pool
        uint256 availableLiquidity = IERC20(token).balanceOf(address(this));
        require(availableLiquidity >= amount, "Insufficient pool liquidity");

        // Check that HF would stay >= 1 after this borrow
        require(
            _isHealthyAfterBorrow(msg.sender, token, amount),
            "Insufficient collateral (Health Factor would drop below 1)"
        );

        uint256 scaled = amount * PRECISION / markets[token].borrowIndex;
        userBorrows[msg.sender][token].scaledAmount += scaled;
        markets[token].totalScaledBorrow += scaled;

        IERC20(token).transfer(msg.sender, amount);

        emit Borrow(msg.sender, token, amount);
    }

    /**
     * @notice Repay borrowed tokens (+ accrued interest).
     * @param token   ERC20 token to repay
     * @param amount  Amount to repay. Pass type(uint256).max to repay all debt.
     */
    function repay(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        _accrueInterest(token);

        uint256 currentDebt = _borrowBalanceOf(msg.sender, token);
        require(currentDebt > 0, "No debt to repay");

        // Allow "repay all"
        if (amount == type(uint256).max) {
            amount = currentDebt;
        }

        uint256 repayAmount = amount > currentDebt ? currentDebt : amount;

        IERC20(token).transferFrom(msg.sender, address(this), repayAmount);

        uint256 scaled = repayAmount * PRECISION / markets[token].borrowIndex;
        // Guard against underflow due to rounding
        UserBorrow storage ub = userBorrows[msg.sender][token];
        ub.scaledAmount = ub.scaledAmount > scaled ? ub.scaledAmount - scaled : 0;
        markets[token].totalScaledBorrow = markets[token].totalScaledBorrow > scaled
            ? markets[token].totalScaledBorrow - scaled
            : 0;

        emit Repay(msg.sender, token, repayAmount);
    }

    /**
     * @notice Liquidate an undercollateralized position.
     *
     * When a borrower's Health Factor drops below 1.0, any third party may call
     * this function to repay part of their debt and receive discounted collateral.
     *
     * Rules:
     *  - borrower's HF must be < 1.0 at the time of the call
     *  - repayAmount must not exceed CLOSE_FACTOR (50%) of the borrower's current debt
     *  - liquidator receives collateral worth repayAmount + LIQUIDATION_BONUS (5%)
     *
     * @param borrower        Address of the undercollateralized user
     * @param debtToken       Token the liquidator will repay on behalf of the borrower
     * @param repayAmount     Amount of debtToken to repay (must be <= 50% of borrower's debt)
     * @param collateralToken Token the liquidator will receive as reward
     */
    function liquidate(
        address borrower,
        address debtToken,
        uint256 repayAmount,
        address collateralToken
    ) external nonReentrant {
        require(tokenConfigs[debtToken].supported,       "Debt token not supported");
        require(tokenConfigs[collateralToken].supported, "Collateral token not supported");
        require(borrower != msg.sender,                  "Cannot liquidate yourself");
        require(repayAmount > 0,                         "Repay amount must be > 0");

        _accrueInterest(debtToken);
        _accrueInterest(collateralToken);

        // 1. Health Factor must be below 1
        require(getHealthFactor(borrower) < PRECISION, "Position is healthy, HF >= 1");

        // 2. Enforce close factor: cannot repay more than 50% of borrower's debt
        uint256 borrowerDebt = _borrowBalanceOf(borrower, debtToken);
        require(borrowerDebt > 0, "Borrower has no debt in this token");
        uint256 maxRepay = borrowerDebt * CLOSE_FACTOR / 100;
        require(repayAmount <= maxRepay, "Exceeds close factor (max 50% of debt)");

        // 3. Calculate collateral to seize (debt value + 5% bonus), in collateral token units
        //    collateralSeized = repayAmount * debtPrice * (100 + bonus) / (collateralPrice * 100)
        uint256 debtPrice        = getTokenPrice(debtToken);
        uint256 collateralPrice  = getTokenPrice(collateralToken);
        uint256 collateralSeized = repayAmount
            * debtPrice
            * (100 + LIQUIDATION_BONUS)
            / collateralPrice
            / 100;

        // 4. Borrower must have enough collateral to cover the seizure
        uint256 borrowerCollateral = _supplyBalanceOf(borrower, collateralToken);
        require(borrowerCollateral >= collateralSeized, "Borrower has insufficient collateral");

        // Pull debt repayment from liquidator
        IERC20(debtToken).transferFrom(msg.sender, address(this), repayAmount);

        // 6. Reduce borrower's debt
        uint256 debtScaled = repayAmount * PRECISION / markets[debtToken].borrowIndex;
        UserBorrow storage ub = userBorrows[borrower][debtToken];
        ub.scaledAmount = ub.scaledAmount > debtScaled ? ub.scaledAmount - debtScaled : 0;
        markets[debtToken].totalScaledBorrow = markets[debtToken].totalScaledBorrow > debtScaled
            ? markets[debtToken].totalScaledBorrow - debtScaled
            : 0;

        // 7. Reduce borrower's collateral supply
        uint256 collateralScaled = collateralSeized * PRECISION / markets[collateralToken].supplyIndex;
        UserSupply storage us = userSupplies[borrower][collateralToken];
        us.scaledAmount = us.scaledAmount > collateralScaled ? us.scaledAmount - collateralScaled : 0;
        markets[collateralToken].totalScaledSupply = markets[collateralToken].totalScaledSupply > collateralScaled
            ? markets[collateralToken].totalScaledSupply - collateralScaled
            : 0;

        // 8. Transfer seized collateral to liquidator
        IERC20(collateralToken).transfer(msg.sender, collateralSeized);

        emit Liquidated(msg.sender, borrower, debtToken, repayAmount, collateralToken, collateralSeized);
    }

    /**
     * @notice Borrow any amount of a supported token within a single transaction.
     *
     * The caller (or `receiver`) must implement IFlashLoanReceiver.executeOperation().
     * Before executeOperation() returns, the receiver must approve this contract to
     * pull back `amount + fee`. If the pool balance does not increase by at least
     * `fee` after the call, the entire transaction reverts.
     *
     * Fee: FLASH_LOAN_FEE basis points (9 bps = 0.09%) of `amount`.
     *
     * @param receiver  Contract that implements IFlashLoanReceiver.
     * @param token     ERC-20 token to borrow.
     * @param amount    Amount to borrow.
     * @param data      Arbitrary data forwarded to executeOperation.
     */
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant {
        require(tokenConfigs[token].supported, "Token not supported");
        require(amount > 0,                    "Amount must be > 0");

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool liquidity");

        // Fee in token units: amount * 9 / 10000
        uint256 fee = amount * FLASH_LOAN_FEE / 10000;

        // 1. Send tokens to receiver
        IERC20(token).transfer(receiver, amount);

        // 2. Call receiver — it must repay amount + fee before returning
        bool success = IFlashLoanReceiver(receiver).executeOperation(token, amount, fee, data);
        require(success, "Flash loan callback failed");

        // 3. Pull repayment: receiver must have approved this contract for amount + fee
        IERC20(token).transferFrom(receiver, address(this), amount + fee);

        // 4. Verify the pool is at least as well-off as before (+ fee)
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Flash loan not fully repaid");

        emit FlashLoan(receiver, token, amount, fee);
    }

    // ─────────────────────────────────────────────
    //  Interest Accrual  (the "engine")
    // ─────────────────────────────────────────────

    /**
     * @dev Update borrow/supply indexes for a token based on blocks elapsed.
     *
     * Linear Interest Rate Model:
     *   U   = totalBorrowed / totalSupplied        (utilization rate)
     *   APR = baseRate + slope * U                 (annual borrow rate)
     *   Rate per block = APR / BLOCKS_PER_YEAR
     *
     * Index update:
     *   newBorrowIndex = borrowIndex * (1 + ratePerBlock * blockDelta)
     *   newSupplyIndex = supplyIndex * (1 + supplyRatePerBlock * blockDelta)
     */
    function _accrueInterest(address token) internal {
        MarketState storage market = markets[token];
        uint256 blockDelta = block.number - market.lastUpdateBlock;
        if (blockDelta == 0) return;

        uint256 totalBorrowed = market.totalScaledBorrow * market.borrowIndex / PRECISION;
        uint256 totalSupplied = market.totalScaledSupply * market.supplyIndex / PRECISION;

        uint256 utilizationRate = (totalSupplied == 0)
            ? 0
            : totalBorrowed * PRECISION / totalSupplied;

        TokenConfig memory cfg = tokenConfigs[token];

        // Borrow APR as a fraction of PRECISION (e.g. 5% → 0.05 * 1e18)
        uint256 borrowAPR = (cfg.baseRatePerYear * PRECISION / 100)
            + (cfg.slopePerYear * utilizationRate / 100);         // slope * U / 100

        uint256 borrowRatePerBlock = borrowAPR / BLOCKS_PER_YEAR;
        uint256 borrowInterest     = borrowRatePerBlock * blockDelta; // fraction of PRECISION

        // Update borrow index
        market.borrowIndex = market.borrowIndex + market.borrowIndex * borrowInterest / PRECISION;

        // Update supply index: lenders receive (1 - reserveFactor) fraction of interest
        if (totalBorrowed > 0 && totalSupplied > 0) {
            uint256 supplyAPR        = borrowAPR * utilizationRate / PRECISION
                                       * (100 - RESERVE_FACTOR) / 100;
            uint256 supplyRatePerBlock = supplyAPR / BLOCKS_PER_YEAR;
            uint256 supplyInterest     = supplyRatePerBlock * blockDelta;
            market.supplyIndex = market.supplyIndex + market.supplyIndex * supplyInterest / PRECISION;
        }

        market.lastUpdateBlock = block.number;
    }

    // Public wrapper so the frontend can trigger it explicitly
    function accrueInterest(address token) external {
        require(tokenConfigs[token].supported, "Not supported");
        _accrueInterest(token);
    }

    // ─────────────────────────────────────────────
    //  Health Factor Logic
    // ─────────────────────────────────────────────

    /**
     * @notice Calculate Health Factor for a user.
     * @return HF scaled by PRECISION (1e18 = 1.0). Returns max uint if no debt.
     *
     * HF = Σ(supplyBalance_i * price_i * liqThreshold_i / 100)
     *    / Σ(borrowBalance_i * price_i)
     */
    function getHealthFactor(address user) public view returns (uint256) {
        (uint256 collateralValue, uint256 debtValue) = _positionValues(user);
        if (debtValue == 0) return type(uint256).max;
        return collateralValue * PRECISION / debtValue;
    }

    function _positionValues(address user)
        internal view
        returns (uint256 totalCollateralUSD, uint256 totalDebtUSD)
    {
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            uint256 price = getTokenPrice(token);

            uint256 supplyBal = _supplyBalanceOf(user, token);
            if (supplyBal > 0) {
                // Weighted by liquidation threshold
                totalCollateralUSD +=
                    supplyBal * price / PRECISION
                    * tokenConfigs[token].liquidationThreshold / 100;
            }

            uint256 borrowBal = _borrowBalanceOf(user, token);
            if (borrowBal > 0) {
                totalDebtUSD += borrowBal * price / PRECISION;
            }
        }
    }

    function _isHealthyAfterBorrow(
        address user,
        address borrowToken,
        uint256 borrowAmount
    ) internal view returns (bool) {
        (uint256 collateral, uint256 debt) = _positionValues(user);
        uint256 newDebt = debt + borrowAmount * getTokenPrice(borrowToken) / PRECISION;
        if (newDebt == 0) return true;
        return collateral * PRECISION / newDebt >= PRECISION;
    }

    function _isHealthyAfterWithdraw(
        address user,
        address supplyToken,
        uint256 withdrawAmount
    ) internal view returns (bool) {
        (uint256 collateral, uint256 debt) = _positionValues(user);
        if (debt == 0) return true;

        uint256 removedCollateral =
            withdrawAmount * getTokenPrice(supplyToken) / PRECISION
            * tokenConfigs[supplyToken].liquidationThreshold / 100;

        if (removedCollateral >= collateral) return false;
        uint256 newCollateral = collateral - removedCollateral;
        return newCollateral * PRECISION / debt >= PRECISION;
    }

    // ─────────────────────────────────────────────
    //  Internal Balance Helpers
    // ─────────────────────────────────────────────

    function _supplyBalanceOf(address user, address token)
        internal view returns (uint256)
    {
        uint256 scaled = userSupplies[user][token].scaledAmount;
        if (scaled == 0) return 0;
        return scaled * markets[token].supplyIndex / PRECISION;
    }

    function _borrowBalanceOf(address user, address token)
        internal view returns (uint256)
    {
        uint256 scaled = userBorrows[user][token].scaledAmount;
        if (scaled == 0) return 0;
        return scaled * markets[token].borrowIndex / PRECISION;
    }

    // ─────────────────────────────────────────────
    //  Public View Functions (for frontend)
    // ─────────────────────────────────────────────

    function getSupplyBalance(address user, address token)
        external view returns (uint256)
    {
        return _supplyBalanceOf(user, token);
    }

    function getBorrowBalance(address user, address token)
        external view returns (uint256)
    {
        return _borrowBalanceOf(user, token);
    }

    /// @notice Current Utilization Rate for a token (0 – 1e18 = 0% – 100%)
    function getUtilizationRate(address token) public view returns (uint256) {
        MarketState memory m = markets[token];
        uint256 totalBorrowed = m.totalScaledBorrow * m.borrowIndex / PRECISION;
        uint256 totalSupplied = m.totalScaledSupply * m.supplyIndex / PRECISION;
        if (totalSupplied == 0) return 0;
        return totalBorrowed * PRECISION / totalSupplied;
    }

    /// @notice Annual Percentage Yield for borrowers (as fraction of PRECISION)
    function getBorrowAPY(address token) public view returns (uint256) {
        uint256 U   = getUtilizationRate(token);
        TokenConfig memory cfg = tokenConfigs[token];
        return (cfg.baseRatePerYear * PRECISION / 100) + (cfg.slopePerYear * U / 100);
    }

    /// @notice Annual Percentage Yield for suppliers (as fraction of PRECISION)
    function getSupplyAPY(address token) public view returns (uint256) {
        uint256 U       = getUtilizationRate(token);
        uint256 bAPY    = getBorrowAPY(token);
        return bAPY * U / PRECISION * (100 - RESERVE_FACTOR) / 100;
    }

    /// @notice Total collateral value in USD (raw, without threshold weighting)
    function getTotalCollateralUSD(address user) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            uint256 bal = _supplyBalanceOf(user, token);
            total += bal * getTokenPrice(token) / PRECISION;
        }
        return total;
    }

    /// @notice Total debt value in USD
    function getTotalDebtUSD(address user) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            uint256 bal = _borrowBalanceOf(user, token);
            total += bal * getTokenPrice(token) / PRECISION;
        }
        return total;
    }

    /**
     * @notice Maximum amount the user can borrow of a given token
     *         given their current collateral and LTV limits.
     */
    function getMaxBorrow(address user, address borrowToken)
        external view returns (uint256)
    {
        uint256 totalLTVWeightedCollateralUSD = 0;
        uint256 totalDebtUSD = 0;

        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address token = supportedTokens[i];
            uint256 price = getTokenPrice(token);

            uint256 supplyBal = _supplyBalanceOf(user, token);
            if (supplyBal > 0) {
                totalLTVWeightedCollateralUSD +=
                    supplyBal * price / PRECISION * tokenConfigs[token].ltv / 100;
            }

            uint256 borrowBal = _borrowBalanceOf(user, token);
            if (borrowBal > 0) {
                totalDebtUSD += borrowBal * price / PRECISION;
            }
        }

        if (totalLTVWeightedCollateralUSD <= totalDebtUSD) return 0;
        uint256 availableUSD = totalLTVWeightedCollateralUSD - totalDebtUSD;
        return availableUSD * PRECISION / getTokenPrice(borrowToken);
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }

    /**
     * @notice Get all relevant market data for a token in one call.
     */
    function getMarketData(address token) external view returns (
        uint256 totalSupplied,
        uint256 totalBorrowed,
        uint256 utilizationRate,
        uint256 supplyAPY,
        uint256 borrowAPY,
        uint256 price
    ) {
        MarketState memory m = markets[token];
        totalSupplied   = m.totalScaledSupply * m.supplyIndex / PRECISION;
        totalBorrowed   = m.totalScaledBorrow * m.borrowIndex / PRECISION;
        utilizationRate = getUtilizationRate(token);
        supplyAPY       = getSupplyAPY(token);
        borrowAPY       = getBorrowAPY(token);
        price           = getTokenPrice(token);
    }

    /**
     * @notice Get all relevant user data for a token in one call.
     */
    function getUserData(address user, address token) external view returns (
        uint256 supplyBalance,
        uint256 borrowBalance,
        uint256 healthFactor,
        uint256 maxBorrow
    ) {
        supplyBalance = _supplyBalanceOf(user, token);
        borrowBalance = _borrowBalanceOf(user, token);
        healthFactor  = getHealthFactor(user);
        // maxBorrow per token computed inline to avoid re-entry to external
        uint256 totalLTVWeightedCollateralUSD = 0;
        uint256 totalDebtUSD = 0;
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address t = supportedTokens[i];
            uint256 sb = _supplyBalanceOf(user, t);
            if (sb > 0) totalLTVWeightedCollateralUSD += sb * getTokenPrice(t) / PRECISION * tokenConfigs[t].ltv / 100;
            uint256 bb = _borrowBalanceOf(user, t);
            if (bb > 0) totalDebtUSD += bb * getTokenPrice(t) / PRECISION;
        }
        maxBorrow = totalLTVWeightedCollateralUSD <= totalDebtUSD
            ? 0
            : (totalLTVWeightedCollateralUSD - totalDebtUSD) * PRECISION / getTokenPrice(token);
    }
}
